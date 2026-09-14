"""Authentication interfaces; production JWT verification is an S3 gate."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol
from uuid import UUID

from contracts.s2a.models import ErrorCode, Principal

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


def parse_bearer_token(authorization: str | None) -> str:
    if authorization is None:
        raise AtlasError(ErrorCode.UNAUTHENTICATED, "Bearer token required", 401)
    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token or " " in token:
        raise AtlasError(ErrorCode.UNAUTHENTICATED, "Invalid authorization header", 401)
    if len(token) > 4096:
        raise AtlasError(ErrorCode.UNAUTHENTICATED, "Invalid authorization header", 401)
    return token
