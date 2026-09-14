"""Atlas S2A common platform contracts.

These models describe boundaries shared by later services. They deliberately
exclude domain payloads: each domain pack owns and versions those separately.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AuthMethod(str, Enum):
    PASSWORD = "password"
    GOOGLE = "google"


class Principal(StrictModel):
    schema_version: Literal["principal.v1"]
    principal_id: UUID
    tenant_id: UUID
    auth_method: AuthMethod
    authenticated_at: datetime

    @model_validator(mode="after")
    def personal_tenant_matches_principal(self) -> "Principal":
        # Atlas currently uses one personal tenant per Supabase user. A future
        # institution tenant must introduce a new principal schema explicitly.
        if self.tenant_id != self.principal_id:
            raise ValueError("tenant_id must equal principal_id for principal.v1")
        return self


class AuthReturnTarget(StrictModel):
    schema_version: Literal["auth_return_target.v1"]
    origin: str = Field(min_length=8, max_length=255)
    return_path: str = Field(default="/home", min_length=1, max_length=512)


def validate_auth_return_target(
    target: AuthReturnTarget, allowed_origins: set[str]
) -> None:
    """Reject open redirects; configured origins stay outside client input."""
    parsed = urlsplit(target.origin)
    normalized_origin = f"{parsed.scheme}://{parsed.netloc}"
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or target.origin != normalized_origin
        or normalized_origin not in allowed_origins
    ):
        raise ValueError("origin is not an allowed Atlas origin")
    path = target.return_path
    if not path.startswith("/") or path.startswith("//") or "\\" in path:
        raise ValueError("return_path must be a relative Atlas application path")


class CommandEnvelope(StrictModel):
    schema_version: Literal["command.v1"]
    command_id: UUID
    command_type: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    principal_id: UUID
    tenant_id: UUID
    idempotency_key: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    payload_schema_version: str = Field(pattern=r"^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$")
    payload: dict[str, Any]
    requested_at: datetime

    @model_validator(mode="after")
    def command_scope_matches_principal(self) -> "CommandEnvelope":
        if self.tenant_id != self.principal_id:
            raise ValueError("command tenant_id must match principal_id")
        return self


class ErrorCode(str, Enum):
    UNAUTHENTICATED = "UNAUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    INVALID_INPUT = "INVALID_INPUT"
    RATE_LIMITED = "RATE_LIMITED"
    DEPENDENCY_FAILED = "DEPENDENCY_FAILED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorEnvelope(StrictModel):
    schema_version: Literal["error.v1"]
    request_id: UUID
    code: ErrorCode
    message: str = Field(min_length=1, max_length=240)
    http_status: int = Field(ge=400, le=599)
    retryable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REVIEW_REQUIRED = "review_required"


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


class WorkflowJob(StrictModel):
    schema_version: Literal["workflow_job.v1"]
    job_id: UUID
    tenant_id: UUID
    command_id: UUID
    workflow_name: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    workflow_version: str = Field(pattern=r"^v[1-9][0-9]*$")
    status: JobStatus
    attempt_count: int = Field(default=0, ge=0)
    max_attempts: int = Field(default=3, ge=1, le=10)
    created_at: datetime
    updated_at: datetime
    lease_expires_at: datetime | None = None
    completed_at: datetime | None = None


class WorkflowStep(StrictModel):
    schema_version: Literal["workflow_step.v1"]
    step_id: UUID
    job_id: UUID
    tenant_id: UUID
    step_key: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    step_name: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    status: StepStatus
    attempt_count: int = Field(default=0, ge=0)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_code: ErrorCode | None = None


class ModelCallStatus(str, Enum):
    RESERVED = "reserved"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    REJECTED = "rejected"


class ModelCallRecord(StrictModel):
    schema_version: Literal["model_call.v1"]
    model_call_id: UUID
    tenant_id: UUID
    job_id: UUID
    step_id: UUID
    route: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    provider: str = Field(min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=120)
    prompt_version: str = Field(pattern=r"^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$")
    output_schema_version: str = Field(pattern=r"^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$")
    status: ModelCallStatus
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cost_usd_micros: int = Field(default=0, ge=0)
    started_at: datetime
    completed_at: datetime | None = None


class OutboxEvent(StrictModel):
    schema_version: Literal["outbox_event.v1"]
    event_id: UUID
    event_schema_version: str = Field(pattern=r"^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$")
    tenant_id: UUID
    aggregate_type: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    aggregate_id: UUID
    event_type: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    payload: dict[str, Any]
    occurred_at: datetime
    available_at: datetime
    published_at: datetime | None = None


class AuditOutcome(str, Enum):
    SUCCEEDED = "succeeded"
    DENIED = "denied"
    FAILED = "failed"


class AuditEvent(StrictModel):
    schema_version: Literal["audit_event.v1"]
    audit_event_id: UUID
    request_id: UUID
    tenant_id: UUID
    principal_id: UUID
    auth_method: AuthMethod
    action: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,79}$")
    target_type: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    target_id: UUID | None = None
    outcome: AuditOutcome
    reason_code: str | None = Field(default=None, max_length=80)
    occurred_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


CONTRACT_MODELS: dict[str, type[BaseModel]] = {
    "principal": Principal,
    "auth_return_target": AuthReturnTarget,
    "command": CommandEnvelope,
    "error": ErrorEnvelope,
    "workflow_job": WorkflowJob,
    "workflow_step": WorkflowStep,
    "model_call": ModelCallRecord,
    "outbox_event": OutboxEvent,
    "audit_event": AuditEvent,
}
