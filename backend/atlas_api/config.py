"""Small, explicit runtime configuration for the API shell."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import os


class RuntimeMode(str, Enum):
    LOCKED = "locked"
    FIXTURE = "fixture"
    PRODUCTION = "production"


@dataclass(frozen=True)
class Settings:
    service_name: str = "atlas-api"
    service_version: str = "0.1.0"
    runtime_mode: RuntimeMode = RuntimeMode.LOCKED
    docs_enabled: bool = False
    supabase_url: str | None = None
    jwt_audience: str = "authenticated"
    jwks_cache_seconds: int = 600
    jwks_timeout_seconds: float = 5.0
    jwt_clock_skew_seconds: int = 30

    @classmethod
    def from_environment(cls) -> "Settings":
        raw_mode = os.getenv("ATLAS_RUNTIME_MODE", RuntimeMode.LOCKED.value)
        try:
            runtime_mode = RuntimeMode(raw_mode)
        except ValueError as error:
            raise RuntimeError("ATLAS_RUNTIME_MODE must be locked, fixture, or production") from error
        return cls(
            service_name=os.getenv("ATLAS_SERVICE_NAME", "atlas-api"),
            service_version=os.getenv("ATLAS_SERVICE_VERSION", "0.1.0"),
            runtime_mode=runtime_mode,
            docs_enabled=os.getenv("ATLAS_DOCS_ENABLED", "false").lower() == "true",
            supabase_url=os.getenv("SUPABASE_URL"),
            jwt_audience=os.getenv("ATLAS_JWT_AUDIENCE", "authenticated"),
            jwks_cache_seconds=int(os.getenv("ATLAS_JWKS_CACHE_SECONDS", "600")),
            jwks_timeout_seconds=float(os.getenv("ATLAS_JWKS_TIMEOUT_SECONDS", "5")),
            jwt_clock_skew_seconds=int(os.getenv("ATLAS_JWT_CLOCK_SKEW_SECONDS", "30")),
        )
