"""Authentication adapters for the Atlas application trust boundary."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from datetime import datetime, timezone
import json
from time import monotonic
from typing import Any, Awaitable, Callable, Protocol
from urllib.parse import urlsplit
from uuid import UUID

import httpx
import jwt
from jwt import PyJWK

from contracts.s2a.models import AuthMethod, ErrorCode, Principal

from .config import Settings
from .errors import AtlasError


class Authenticator(Protocol):
    async def authenticate(self, bearer_token: str, request_id: UUID) -> Principal: ...


class LockedAuthenticator:
    """Fail closed until a verified production adapter is configured."""

    async def authenticate(self, _bearer_token: str, _request_id: UUID) -> Principal:
        raise AtlasError(
            ErrorCode.DEPENDENCY_FAILED,
            "Authentication service is not ready",
            503,
            retryable=True,
        )


class FixtureAuthenticator:
    """Injected test adapter; it is forbidden in production mode."""

    def __init__(self, principals_by_token: Mapping[str, Principal]) -> None:
        if not principals_by_token:
            raise ValueError("FixtureAuthenticator requires at least one fixture")
        self._principals_by_token = dict(principals_by_token)

    async def authenticate(self, bearer_token: str, _request_id: UUID) -> Principal:
        principal = self._principals_by_token.get(bearer_token)
        if principal is None:
            raise AtlasError(ErrorCode.UNAUTHENTICATED, "Invalid bearer token", 401)
        return principal


JwksFetcher = Callable[[], Awaitable[Mapping[str, Any]]]


class JwksProvider:
    """Small bounded JWKS cache with explicit rotation and failure behavior."""

    _MAX_DOCUMENT_BYTES = 256 * 1024
    _MAX_KEYS = 10
    _ALGORITHMS = frozenset({"ES256", "RS256"})

    def __init__(
        self,
        jwks_url: str,
        *,
        cache_seconds: int = 600,
        timeout_seconds: float = 5.0,
        fetcher: JwksFetcher | None = None,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        if not 1 <= cache_seconds <= 600:
            raise ValueError("JWKS cache must be between 1 and 600 seconds")
        if not 0.1 <= timeout_seconds <= 15:
            raise ValueError("JWKS timeout must be between 0.1 and 15 seconds")
        self._jwks_url = jwks_url
        self._cache_seconds = cache_seconds
        self._timeout_seconds = timeout_seconds
        self._fetcher = fetcher
        self._clock = clock
        self._keys: dict[str, PyJWK] = {}
        self._expires_at = 0.0
        self._unknown_refresh_after = 0.0
        self._lock = asyncio.Lock()

    async def key_for(self, kid: str, algorithm: str) -> PyJWK:
        now = self._clock()
        cached = self._keys.get(kid)
        if now < self._expires_at and cached is not None:
            return self._matching_key(cached, algorithm)

        # A newly seen kid may force a refresh while the cache is fresh. The
        # lock and cooldown prevent a burst from stampeding the discovery URL.
        async with self._lock:
            now = self._clock()
            cached = self._keys.get(kid)
            if now < self._expires_at and cached is not None:
                return self._matching_key(cached, algorithm)
            if now < self._expires_at and now < self._unknown_refresh_after:
                raise AtlasError(ErrorCode.UNAUTHENTICATED, "Invalid bearer token", 401)
            await self._refresh()
            refreshed = self._keys.get(kid)
            if refreshed is None:
                raise AtlasError(ErrorCode.UNAUTHENTICATED, "Invalid bearer token", 401)
            return self._matching_key(refreshed, algorithm)

    @staticmethod
    def _matching_key(key: PyJWK, algorithm: str) -> PyJWK:
        if key.algorithm_name != algorithm:
            raise AtlasError(ErrorCode.UNAUTHENTICATED, "Invalid bearer token", 401)
        return key

    async def _refresh(self) -> None:
        try:
            document = await (self._fetcher() if self._fetcher else self._fetch_remote())
            keys = self._parse(document)
        except AtlasError:
            raise
        except Exception as error:
            raise AtlasError(
                ErrorCode.DEPENDENCY_FAILED,
                "Authentication service is unavailable",
                503,
                retryable=True,
            ) from error
        self._keys = keys
        refreshed_at = self._clock()
        self._expires_at = refreshed_at + self._cache_seconds
        # Invalid tokens with random kids must not turn the discovery endpoint
        # into an attacker-controlled request loop. Standby rotation keys are
        # already advertised by Supabase before they become active.
        self._unknown_refresh_after = refreshed_at + min(60, self._cache_seconds)

    async def _fetch_remote(self) -> Mapping[str, Any]:
        timeout = httpx.Timeout(self._timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            async with client.stream("GET", self._jwks_url) as response:
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > self._MAX_DOCUMENT_BYTES:
                        raise ValueError("JWKS response is too large")
        value = json.loads(body)
        if not isinstance(value, Mapping):
            raise ValueError("JWKS response must be an object")
        return value

    def _parse(self, document: Mapping[str, Any]) -> dict[str, PyJWK]:
        raw_keys = document.get("keys")
        if not isinstance(raw_keys, list) or not 1 <= len(raw_keys) <= self._MAX_KEYS:
            raise ValueError("JWKS must contain a bounded non-empty key list")
        parsed: dict[str, PyJWK] = {}
        for raw_key in raw_keys:
            if not isinstance(raw_key, dict):
                raise ValueError("JWKS keys must be objects")
            kid = raw_key.get("kid")
            algorithm = raw_key.get("alg")
            key_type = raw_key.get("kty")
            if not isinstance(kid, str) or not 1 <= len(kid) <= 200 or kid in parsed:
                raise ValueError("JWKS kid is missing, invalid, or duplicated")
            if algorithm not in self._ALGORITHMS:
                raise ValueError("JWKS algorithm is not allowed")
            if (algorithm == "ES256" and key_type != "EC") or (
                algorithm == "RS256" and key_type != "RSA"
            ):
                raise ValueError("JWKS key type does not match its algorithm")
            if raw_key.get("use") not in {None, "sig"}:
                raise ValueError("JWKS key is not a signing key")
            operations = raw_key.get("key_ops")
            if operations is not None and (
                not isinstance(operations, list) or "verify" not in operations
            ):
                raise ValueError("JWKS key cannot verify signatures")
            parsed[kid] = PyJWK.from_dict(raw_key, algorithm=algorithm)
        return parsed


class SupabaseJwtAuthenticator:
    """Verify Supabase access tokens locally; retain only the frozen principal."""

    _ALGORITHMS = ("ES256", "RS256")

    def __init__(
        self,
        issuer: str,
        audience: str,
        jwks: JwksProvider,
        *,
        clock_skew_seconds: int = 30,
    ) -> None:
        if not 0 <= clock_skew_seconds <= 120:
            raise ValueError("JWT clock skew must be between 0 and 120 seconds")
        self._issuer = issuer
        self._audience = audience
        self._jwks = jwks
        self._clock_skew_seconds = clock_skew_seconds

    async def authenticate(self, bearer_token: str, _request_id: UUID) -> Principal:
        try:
            header = jwt.get_unverified_header(bearer_token)
            kid = header.get("kid")
            algorithm = header.get("alg")
            if (
                not isinstance(kid, str)
                or not 1 <= len(kid) <= 200
                or algorithm not in self._ALGORITHMS
            ):
                raise jwt.InvalidTokenError()
            key = await self._jwks.key_for(kid, algorithm)
            claims = jwt.decode(
                bearer_token,
                key.key,
                algorithms=[algorithm],
                audience=self._audience,
                issuer=self._issuer,
                leeway=self._clock_skew_seconds,
                options={"require": ["iss", "aud", "exp", "iat", "sub", "role"]},
            )
            return self._principal_from_claims(claims)
        except AtlasError:
            raise
        except (jwt.PyJWTError, TypeError, ValueError, KeyError) as error:
            raise AtlasError(ErrorCode.UNAUTHENTICATED, "Invalid bearer token", 401) from error

    @staticmethod
    def _principal_from_claims(claims: Mapping[str, Any]) -> Principal:
        if claims.get("role") != "authenticated" or claims.get("is_anonymous") is True:
            raise ValueError("unsupported principal role")
        subject = UUID(claims["sub"])
        app_metadata = claims.get("app_metadata")
        if not isinstance(app_metadata, Mapping):
            raise ValueError("missing application metadata")
        provider = app_metadata.get("provider")
        methods = {
            entry.get("method"): entry.get("timestamp")
            for entry in claims.get("amr", [])
            if isinstance(entry, Mapping)
        }
        providers = app_metadata.get("providers")
        provider_set = (
            {item for item in providers if isinstance(item, str)}
            if isinstance(providers, list)
            else set()
        )
        if "oauth" in methods and (provider == "google" or "google" in provider_set):
            auth_method = AuthMethod.GOOGLE
            authentication_timestamp = methods["oauth"]
        elif provider == "email" and "password" in methods:
            auth_method = AuthMethod.PASSWORD
            authentication_timestamp = methods["password"]
        else:
            raise ValueError("unsupported authentication method")
        if not isinstance(authentication_timestamp, int) or isinstance(
            authentication_timestamp, bool
        ):
            raise ValueError("invalid authentication timestamp")
        authenticated_at = datetime.fromtimestamp(authentication_timestamp, tz=timezone.utc)
        return Principal(
            schema_version="principal.v1",
            principal_id=subject,
            tenant_id=subject,
            auth_method=auth_method,
            authenticated_at=authenticated_at,
        )


def build_production_authenticator(settings: Settings) -> SupabaseJwtAuthenticator:
    """Create the production adapter only from a pinned Supabase project URL."""

    if not settings.supabase_url:
        raise ValueError("SUPABASE_URL is required in production mode")
    parsed = urlsplit(settings.supabase_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not parsed.hostname.endswith(".supabase.co")
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("SUPABASE_URL must be an HTTPS project origin")
    origin = f"https://{parsed.hostname}"
    issuer = f"{origin}/auth/v1"
    jwks = JwksProvider(
        f"{issuer}/.well-known/jwks.json",
        cache_seconds=settings.jwks_cache_seconds,
        timeout_seconds=settings.jwks_timeout_seconds,
    )
    return SupabaseJwtAuthenticator(
        issuer,
        settings.jwt_audience,
        jwks,
        clock_skew_seconds=settings.jwt_clock_skew_seconds,
    )


def parse_bearer_token(authorization: str | None) -> str:
    if authorization is None:
        raise AtlasError(ErrorCode.UNAUTHENTICATED, "Bearer token required", 401)
    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token or " " in token:
        raise AtlasError(ErrorCode.UNAUTHENTICATED, "Invalid authorization header", 401)
    if len(token) > 4096:
        raise AtlasError(ErrorCode.UNAUTHENTICATED, "Invalid authorization header", 401)
    return token
