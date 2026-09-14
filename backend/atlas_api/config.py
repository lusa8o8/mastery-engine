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
        )
