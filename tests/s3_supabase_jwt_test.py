"""Security tests for local verification of Supabase access tokens."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import unittest
from uuid import UUID

from cryptography.hazmat.primitives.asymmetric import ec
import jwt

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.atlas_api.auth import (  # noqa: E402
    JwksProvider,
    SupabaseJwtAuthenticator,
    build_production_authenticator,
)
from backend.atlas_api.config import RuntimeMode, Settings  # noqa: E402
from backend.atlas_api.errors import AtlasError  # noqa: E402
from contracts.s2a.models import AuthMethod, ErrorCode  # noqa: E402


ISSUER = "https://example-ref.supabase.co/auth/v1"
AUDIENCE = "authenticated"
SUBJECT = "11111111-1111-4111-8111-111111111111"
KID = "test-signing-key"


class FakeClock:
    def __init__(self) -> None:
        self.value = 100.0

    def __call__(self) -> float:
        return self.value


def public_jwk(private_key, *, kid: str = KID) -> dict:
    value = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key()))
    value.update({"kid": kid, "alg": "ES256", "use": "sig", "key_ops": ["verify"]})
    return value


def token(
    private_key,
    *,
    provider: str = "email",
    method: str = "password",
    kid: str = KID,
    **claims,
):
    now = datetime.now(timezone.utc)
    payload = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": now + timedelta(minutes=5),
        "iat": now,
        "sub": SUBJECT,
        "role": "authenticated",
        "is_anonymous": False,
        "app_metadata": {"provider": provider, "providers": [provider]},
        "amr": [{"method": method, "timestamp": int(now.timestamp())}],
    }
    payload.update(claims)
    return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": kid})


def authenticator(private_key, *, fetcher=None, clock=None):
    async def default_fetcher():
        return {"keys": [public_jwk(private_key)]}

    provider = JwksProvider(
        f"{ISSUER}/.well-known/jwks.json",
        fetcher=fetcher or default_fetcher,
        clock=clock or FakeClock(),
    )
    return SupabaseJwtAuthenticator(ISSUER, AUDIENCE, provider)


class SupabaseJwtTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.request_id = UUID("22222222-2222-4222-8222-222222222222")

    async def test_password_and_google_tokens_map_to_one_personal_tenant(self) -> None:
        verifier = authenticator(self.private_key)
        password = await verifier.authenticate(token(self.private_key), self.request_id)
        google = await verifier.authenticate(
            token(self.private_key, provider="google", method="oauth"), self.request_id
        )
        linked_google_token = token(
            self.private_key,
            provider="email",
            method="oauth",
            app_metadata={"provider": "email", "providers": ["email", "google"]},
        )
        linked_google = await verifier.authenticate(linked_google_token, self.request_id)
        self.assertEqual(password.principal_id, UUID(SUBJECT))
        self.assertEqual(password.tenant_id, password.principal_id)
        self.assertEqual(password.auth_method, AuthMethod.PASSWORD)
        self.assertEqual(google.auth_method, AuthMethod.GOOGLE)
        self.assertEqual(linked_google.auth_method, AuthMethod.GOOGLE)
        self.assertEqual(password.authenticated_at.microsecond, 0)

    async def test_invalid_signature_and_expired_token_are_rejected(self) -> None:
        verifier = authenticator(self.private_key)
        other_key = ec.generate_private_key(ec.SECP256R1())
        invalid = token(other_key)
        expired = token(
            self.private_key,
            exp=datetime.now(timezone.utc) - timedelta(minutes=2),
        )
        for value in (invalid, expired):
            with self.assertRaises(AtlasError) as caught:
                await verifier.authenticate(value, self.request_id)
            self.assertEqual(caught.exception.code, ErrorCode.UNAUTHENTICATED)
            self.assertEqual(caught.exception.http_status, 401)

    async def test_wrong_issuer_audience_role_and_anonymous_are_rejected(self) -> None:
        verifier = authenticator(self.private_key)
        values = (
            token(self.private_key, iss="https://other.supabase.co/auth/v1"),
            token(self.private_key, aud="other"),
            token(self.private_key, role="service_role"),
            token(self.private_key, is_anonymous=True),
        )
        for value in values:
            with self.assertRaises(AtlasError) as caught:
                await verifier.authenticate(value, self.request_id)
            self.assertEqual(caught.exception.code, ErrorCode.UNAUTHENTICATED)

    async def test_unapproved_authentication_methods_are_rejected(self) -> None:
        verifier = authenticator(self.private_key)
        for value in (
            token(self.private_key, method="magiclink"),
            token(self.private_key, provider="github", method="oauth"),
        ):
            with self.assertRaises(AtlasError) as caught:
                await verifier.authenticate(value, self.request_id)
            self.assertEqual(caught.exception.code, ErrorCode.UNAUTHENTICATED)

    async def test_cached_key_avoids_repeated_discovery_calls(self) -> None:
        calls = 0

        async def fetcher():
            nonlocal calls
            calls += 1
            return {"keys": [public_jwk(self.private_key)]}

        verifier = authenticator(self.private_key, fetcher=fetcher)
        await verifier.authenticate(token(self.private_key), self.request_id)
        await verifier.authenticate(token(self.private_key), self.request_id)
        self.assertEqual(calls, 1)

    async def test_expired_cache_requires_refresh_and_fails_closed(self) -> None:
        clock = FakeClock()
        calls = 0

        async def fetcher():
            nonlocal calls
            calls += 1
            if calls > 1:
                raise RuntimeError("private provider detail")
            return {"keys": [public_jwk(self.private_key)]}

        verifier = authenticator(self.private_key, fetcher=fetcher, clock=clock)
        await verifier.authenticate(token(self.private_key), self.request_id)
        clock.value += 601
        with self.assertRaises(AtlasError) as caught:
            await verifier.authenticate(token(self.private_key), self.request_id)
        self.assertEqual(caught.exception.code, ErrorCode.DEPENDENCY_FAILED)
        self.assertEqual(caught.exception.http_status, 503)
        self.assertTrue(caught.exception.retryable)
        self.assertNotIn("private", caught.exception.message)

    async def test_unknown_key_refreshes_once_then_rejects(self) -> None:
        calls = 0

        async def fetcher():
            nonlocal calls
            calls += 1
            return {"keys": [public_jwk(self.private_key, kid="different-key")]}

        verifier = authenticator(self.private_key, fetcher=fetcher)
        with self.assertRaises(AtlasError) as caught:
            await verifier.authenticate(token(self.private_key), self.request_id)
        self.assertEqual(calls, 1)
        self.assertEqual(caught.exception.code, ErrorCode.UNAUTHENTICATED)

    async def test_unknown_key_refresh_is_throttled_after_cache_population(self) -> None:
        calls = 0

        async def fetcher():
            nonlocal calls
            calls += 1
            return {"keys": [public_jwk(self.private_key)]}

        verifier = authenticator(self.private_key, fetcher=fetcher)
        await verifier.authenticate(token(self.private_key), self.request_id)
        for unknown_kid in ("attacker-one", "attacker-two"):
            with self.assertRaises(AtlasError) as caught:
                await verifier.authenticate(
                    token(self.private_key, kid=unknown_kid), self.request_id
                )
            self.assertEqual(caught.exception.code, ErrorCode.UNAUTHENTICATED)
        self.assertEqual(calls, 1)

    async def test_malformed_or_symmetric_jwks_is_dependency_failure(self) -> None:
        documents = (
            {"keys": []},
            {"keys": [{"kid": "legacy", "alg": "HS256", "kty": "oct", "k": "x"}]},
        )
        for document in documents:
            async def fetcher(document=document):
                return document

            verifier = authenticator(self.private_key, fetcher=fetcher)
            with self.assertRaises(AtlasError) as caught:
                await verifier.authenticate(token(self.private_key), self.request_id)
            self.assertEqual(caught.exception.code, ErrorCode.DEPENDENCY_FAILED)

    def test_production_builder_pins_project_origin_and_cache_limits(self) -> None:
        verifier = build_production_authenticator(
            Settings(
                runtime_mode=RuntimeMode.PRODUCTION,
                supabase_url="https://example-ref.supabase.co",
            )
        )
        self.assertIsInstance(verifier, SupabaseJwtAuthenticator)
        invalid_urls = (
            None,
            "http://example-ref.supabase.co",
            "https://example-ref.supabase.co/attacker-path",
            "https://example.com",
        )
        for value in invalid_urls:
            with self.assertRaises(ValueError):
                build_production_authenticator(
                    Settings(runtime_mode=RuntimeMode.PRODUCTION, supabase_url=value)
                )
        with self.assertRaises(ValueError):
            build_production_authenticator(
                Settings(
                    runtime_mode=RuntimeMode.PRODUCTION,
                    supabase_url="https://example-ref.supabase.co",
                    jwks_cache_seconds=601,
                )
            )


if __name__ == "__main__":
    unittest.main()
