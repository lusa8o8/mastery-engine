"""Atlas S2A common platform contracts.

These models describe boundaries shared by later services. They deliberately
exclude domain payloads: each domain pack owns and versions those separately.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


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
    authenticated_at: AwareDatetime

    @model_validator(mode="after")
    def personal_tenant_matches_principal(self) -> "Principal":
        # Atlas currently uses one personal tenant per Supabase user. A future
        # institution tenant must introduce a new principal schema explicitly.
        if self.tenant_id != self.principal_id:
            raise ValueError("tenant_id must equal principal_id for principal.v1")
        return self


class TenantAccess(str, Enum):
    OWNER = "owner"


class TenantScope(StrictModel):
    schema_version: Literal["tenant_scope.v1"]
    principal_id: UUID
    tenant_id: UUID
    access: TenantAccess
    resolved_at: AwareDatetime

    @model_validator(mode="after")
    def personal_scope_matches_principal(self) -> "TenantScope":
        if self.tenant_id != self.principal_id or self.access != TenantAccess.OWNER:
            raise ValueError("tenant_scope.v1 permits only the principal's personal tenant")
        return self


class AuthReturnTarget(StrictModel):
    schema_version: Literal["auth_return_target.v1"]
    origin: str = Field(min_length=8, max_length=255)
    return_path: str = Field(default="/home", min_length=1, max_length=512)


def validate_auth_return_target(
    target: AuthReturnTarget,
    allowed_origins: set[str],
    allowed_path_prefixes: set[str],
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
    parsed_path = urlsplit(path)
    if parsed_path.scheme or parsed_path.netloc:
        raise ValueError("return_path must not contain an origin")
    if not any(
        parsed_path.path == prefix or parsed_path.path.startswith(f"{prefix}/")
        for prefix in allowed_path_prefixes
    ):
        raise ValueError("return_path is not an allowed Atlas route")


class CommandEnvelope(StrictModel):
    schema_version: Literal["command.v1"]
    request_id: UUID
    command_id: UUID
    command_type: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    principal_id: UUID
    tenant_id: UUID
    idempotency_key: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    payload_schema_version: str = Field(pattern=r"^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$")
    payload: dict[str, Any]
    requested_at: AwareDatetime

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

    @model_validator(mode="after")
    def code_matches_http_status(self) -> "ErrorEnvelope":
        permitted = {
            ErrorCode.UNAUTHENTICATED: {401},
            ErrorCode.FORBIDDEN: {403},
            ErrorCode.NOT_FOUND: {404},
            ErrorCode.CONFLICT: {409},
            ErrorCode.INVALID_INPUT: {400, 422},
            ErrorCode.RATE_LIMITED: {429},
            ErrorCode.DEPENDENCY_FAILED: {502, 503, 504},
            ErrorCode.INTERNAL_ERROR: {500},
        }
        if self.http_status not in permitted[self.code]:
            raise ValueError("http_status does not match the typed error code")
        return self


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
    request_id: UUID
    job_id: UUID
    tenant_id: UUID
    command_id: UUID
    workflow_name: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    workflow_version: str = Field(pattern=r"^v[1-9][0-9]*$")
    status: JobStatus
    attempt_count: int = Field(default=0, ge=0)
    max_attempts: int = Field(default=3, ge=1, le=10)
    available_at: AwareDatetime
    created_at: AwareDatetime
    updated_at: AwareDatetime
    lease_expires_at: AwareDatetime | None = None
    cancel_requested_at: AwareDatetime | None = None
    completed_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def valid_job_lifecycle(self) -> "WorkflowJob":
        if self.attempt_count > self.max_attempts:
            raise ValueError("attempt_count cannot exceed max_attempts")
        if self.updated_at < self.created_at or self.available_at < self.created_at:
            raise ValueError("job timestamps must not precede created_at")
        if self.status == JobStatus.RUNNING and self.lease_expires_at is None:
            raise ValueError("a running job requires a lease_expires_at")
        if self.status in {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED}:
            if self.completed_at is None:
                raise ValueError("a terminal job requires completed_at")
        elif self.completed_at is not None:
            raise ValueError("a non-terminal job cannot have completed_at")
        return self


class WorkflowStep(StrictModel):
    schema_version: Literal["workflow_step.v1"]
    step_id: UUID
    job_id: UUID
    tenant_id: UUID
    step_key: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    step_name: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    step_version: str = Field(pattern=r"^v[1-9][0-9]*$")
    required: bool = True
    status: StepStatus
    attempt_count: int = Field(default=0, ge=0)
    max_attempts: int = Field(default=3, ge=1, le=10)
    lease_expires_at: AwareDatetime | None = None
    started_at: AwareDatetime | None = None
    completed_at: AwareDatetime | None = None
    error_code: ErrorCode | None = None

    @model_validator(mode="after")
    def valid_step_lifecycle(self) -> "WorkflowStep":
        if self.attempt_count > self.max_attempts:
            raise ValueError("attempt_count cannot exceed max_attempts")
        if self.status == StepStatus.RUNNING:
            if self.started_at is None or self.lease_expires_at is None:
                raise ValueError("a running step requires start and lease timestamps")
        if self.status in {StepStatus.SUCCEEDED, StepStatus.FAILED, StepStatus.SKIPPED}:
            if self.completed_at is None:
                raise ValueError("a terminal step requires completed_at")
        elif self.completed_at is not None:
            raise ValueError("a non-terminal step cannot have completed_at")
        if self.status == StepStatus.FAILED and self.error_code is None:
            raise ValueError("a failed step requires error_code")
        if self.status != StepStatus.FAILED and self.error_code is not None:
            raise ValueError("only a failed step may carry error_code")
        return self


class ModelCallStatus(str, Enum):
    RESERVED = "reserved"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    REJECTED = "rejected"


class ModelCallRecord(StrictModel):
    schema_version: Literal["model_call.v1"]
    model_call_id: UUID
    request_id: UUID
    tenant_id: UUID
    job_id: UUID | None = None
    step_id: UUID | None = None
    route: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    provider: str = Field(min_length=1, max_length=40)
    model: str = Field(min_length=1, max_length=120)
    prompt_version: str = Field(pattern=r"^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$")
    output_schema_version: str = Field(pattern=r"^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$")
    status: ModelCallStatus
    attempt_number: int = Field(default=1, ge=1, le=2)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cost_usd_micros: int = Field(default=0, ge=0)
    started_at: AwareDatetime
    completed_at: AwareDatetime | None = None
    error_code: ErrorCode | None = None

    @model_validator(mode="after")
    def valid_model_call_lifecycle(self) -> "ModelCallRecord":
        if (self.job_id is None) != (self.step_id is None):
            raise ValueError("job_id and step_id must both be present or both be absent")
        terminal = {ModelCallStatus.SUCCEEDED, ModelCallStatus.FAILED, ModelCallStatus.REJECTED}
        if self.status in terminal and self.completed_at is None:
            raise ValueError("a terminal model call requires completed_at")
        if self.status not in terminal and self.completed_at is not None:
            raise ValueError("a non-terminal model call cannot have completed_at")
        if self.status in {ModelCallStatus.FAILED, ModelCallStatus.REJECTED}:
            if self.error_code is None:
                raise ValueError("a failed or rejected model call requires error_code")
        elif self.error_code is not None:
            raise ValueError("only failed or rejected model calls may carry error_code")
        return self


class OutboxEvent(StrictModel):
    schema_version: Literal["outbox_event.v1"]
    event_id: UUID
    request_id: UUID
    correlation_id: UUID
    causation_event_id: UUID | None = None
    event_schema_version: str = Field(pattern=r"^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$")
    tenant_id: UUID
    aggregate_type: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    aggregate_id: UUID
    event_type: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")
    payload: dict[str, Any]
    occurred_at: AwareDatetime
    available_at: AwareDatetime
    publish_attempt_count: int = Field(default=0, ge=0, le=20)
    published_at: AwareDatetime | None = None
    last_error_code: ErrorCode | None = None

    @model_validator(mode="after")
    def valid_delivery_lifecycle(self) -> "OutboxEvent":
        if self.available_at < self.occurred_at:
            raise ValueError("available_at cannot precede occurred_at")
        if self.published_at is not None and self.published_at < self.occurred_at:
            raise ValueError("published_at cannot precede occurred_at")
        if self.published_at is not None and self.last_error_code is not None:
            raise ValueError("a published event cannot retain last_error_code")
        return self


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
    occurred_at: AwareDatetime
    metadata: dict[
        Annotated[str, Field(pattern=r"^[a-z][a-z0-9_.-]{1,63}$")],
        str | int | float | bool | None,
    ] = Field(default_factory=dict, max_length=24)

    @model_validator(mode="after")
    def audit_scope_and_metadata_are_safe(self) -> "AuditEvent":
        if self.tenant_id != self.principal_id:
            raise ValueError("audit tenant_id must match principal_id")
        forbidden_fragments = {"token", "secret", "password", "prompt", "content", "answer"}
        for key in self.metadata:
            if any(fragment in key.lower() for fragment in forbidden_fragments):
                raise ValueError("audit metadata key may contain sensitive content")
        return self


CONTRACT_MODELS: dict[str, type[BaseModel]] = {
    "principal": Principal,
    "tenant_scope": TenantScope,
    "auth_return_target": AuthReturnTarget,
    "command": CommandEnvelope,
    "error": ErrorEnvelope,
    "workflow_job": WorkflowJob,
    "workflow_step": WorkflowStep,
    "model_call": ModelCallRecord,
    "outbox_event": OutboxEvent,
    "audit_event": AuditEvent,
}
