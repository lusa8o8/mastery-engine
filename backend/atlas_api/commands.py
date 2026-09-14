"""Authenticated, allowlisted submission of durable workflow commands."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
import json
import re
from typing import Any, Literal, Protocol
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from psycopg import Error as PsycopgError

from contracts.s2a.models import (
    CommandEnvelope,
    ErrorCode,
    Principal,
    WorkflowJob,
)

from .errors import AtlasError
from .jobs import IdempotencyConflict, JobRuntime, SubmissionResult


class CommandRequest(BaseModel):
    """Client-owned command intent; identity fields are intentionally absent."""

    model_config = ConfigDict(extra="forbid")

    command_type: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    payload_schema_version: str = Field(
        pattern=r"^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$"
    )
    payload: dict[str, Any]

    @field_validator("payload")
    @classmethod
    def payload_is_bounded(cls, value: dict[str, Any]) -> dict[str, Any]:
        encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=True)
        if len(encoded.encode("utf-8")) > 64 * 1024:
            raise ValueError("payload exceeds 64 KiB")
        return value


class CommandSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["command_submission.v1"]
    job: WorkflowJob
    replayed: bool


@dataclass(frozen=True)
class CommandRoute:
    """One closed mapping from public command intent to a workflow version."""

    command_type: str
    payload_schema_version: str
    payload_model: type[BaseModel]
    workflow_name: str
    workflow_version: str
    max_attempts: int = 3

    def __post_init__(self) -> None:
        if re.fullmatch(r"[a-z][a-z0-9_.-]{2,63}", self.command_type) is None:
            raise ValueError("command_type is invalid")
        if (
            re.fullmatch(
                r"[a-z][a-z0-9_.-]+\.v[1-9][0-9]*", self.payload_schema_version
            )
            is None
        ):
            raise ValueError("payload_schema_version is invalid")
        if re.fullmatch(r"[a-z][a-z0-9_.-]{2,63}", self.workflow_name) is None:
            raise ValueError("workflow_name is invalid")
        if re.fullmatch(r"v[1-9][0-9]*", self.workflow_version) is None:
            raise ValueError("workflow_version is invalid")
        if not isinstance(self.payload_model, type) or not issubclass(
            self.payload_model, BaseModel
        ):
            raise ValueError("payload_model must be a Pydantic model")
        if not 1 <= self.max_attempts <= 10:
            raise ValueError("max_attempts must be between 1 and 10")


class CommandRegistry:
    def __init__(self, routes: Iterable[CommandRoute]) -> None:
        self._routes: dict[tuple[str, str], CommandRoute] = {}
        for route in routes:
            key = (route.command_type, route.payload_schema_version)
            if key in self._routes:
                raise ValueError("command route is duplicated")
            self._routes[key] = route

    def resolve(self, command_type: str, payload_schema_version: str) -> CommandRoute:
        route = self._routes.get((command_type, payload_schema_version))
        if route is None:
            raise AtlasError(
                ErrorCode.INVALID_INPUT,
                "Command type or payload version is not supported",
                422,
            )
        return route


class CommandService(Protocol):
    def submit(
        self,
        principal: Principal,
        request_id: UUID,
        idempotency_key: str,
        request: CommandRequest,
    ) -> CommandSubmission: ...


class LockedCommandService:
    """Fail closed until an allowlist and durable repository are configured."""

    def submit(
        self,
        _principal: Principal,
        _request_id: UUID,
        _idempotency_key: str,
        _request: CommandRequest,
    ) -> CommandSubmission:
        raise AtlasError(
            ErrorCode.DEPENDENCY_FAILED,
            "Command service is not ready",
            503,
            retryable=True,
        )


class RegisteredCommandService:
    """Build a trusted envelope, submit once, then verify the postcondition."""

    def __init__(
        self,
        runtime: JobRuntime,
        registry: CommandRegistry,
        *,
        clock: Callable[[], datetime],
        id_factory: Callable[[], UUID] = uuid4,
    ) -> None:
        self._runtime = runtime
        self._registry = registry
        self._clock = clock
        self._id_factory = id_factory

    def submit(
        self,
        principal: Principal,
        request_id: UUID,
        idempotency_key: str,
        request: CommandRequest,
    ) -> CommandSubmission:
        route = self._registry.resolve(
            request.command_type, request.payload_schema_version
        )
        try:
            validated_payload = route.payload_model.model_validate(
                request.payload
            ).model_dump(mode="json")
        except ValidationError as error:
            raise AtlasError(
                ErrorCode.INVALID_INPUT,
                "Command payload validation failed",
                422,
                details={"location": "payload"},
            ) from error

        command = CommandEnvelope(
            schema_version="command.v1",
            request_id=request_id,
            command_id=self._id_factory(),
            command_type=route.command_type,
            principal_id=principal.principal_id,
            tenant_id=principal.tenant_id,
            idempotency_key=idempotency_key,
            payload_schema_version=route.payload_schema_version,
            payload=validated_payload,
            requested_at=self._clock(),
        )
        try:
            result = self._runtime.submit(
                command,
                workflow_name=route.workflow_name,
                workflow_version=route.workflow_version,
                max_attempts=route.max_attempts,
            )
        except IdempotencyConflict as error:
            raise AtlasError(
                ErrorCode.CONFLICT,
                "Idempotency key was already used for different command intent",
                409,
            ) from error
        except PsycopgError as error:
            # Database errors can include connection details and SQL fragments.
            # Preserve neither; callers only need a retry-safe typed outcome.
            raise AtlasError(
                ErrorCode.DEPENDENCY_FAILED,
                "Command store is unavailable",
                503,
                retryable=True,
            ) from error
        self._verify_postcondition(principal, route, result)
        return CommandSubmission(
            schema_version="command_submission.v1",
            job=result.job,
            replayed=result.replayed,
        )

    @staticmethod
    def _verify_postcondition(
        principal: Principal, route: CommandRoute, result: SubmissionResult
    ) -> None:
        job = result.job
        if (
            job.tenant_id != principal.tenant_id
            or job.workflow_name != route.workflow_name
            or job.workflow_version != route.workflow_version
        ):
            raise AtlasError(
                ErrorCode.INTERNAL_ERROR,
                "Command submission postcondition failed",
                500,
            )
