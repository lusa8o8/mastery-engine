"""Authenticated, tenant-scoped reads of durable workflow status and results."""

from __future__ import annotations

from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from psycopg import Error as PsycopgError

from contracts.s2a.models import ErrorCode, Principal, WorkflowJob

from .errors import AtlasError
from .jobs import JobNotFound, JobRuntime, WorkflowResult


class JobSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["job_snapshot.v1"]
    job: WorkflowJob
    result: WorkflowResult | None = None


class JobQueryService(Protocol):
    def get(self, principal: Principal, job_id: UUID) -> JobSnapshot: ...


class LockedJobQueryService:
    def get(self, _principal: Principal, _job_id: UUID) -> JobSnapshot:
        raise AtlasError(
            ErrorCode.DEPENDENCY_FAILED,
            "Job query service is not ready",
            503,
            retryable=True,
        )


class RegisteredJobQueryService:
    """Read a job and its accepted result through one derived tenant scope."""

    def __init__(self, runtime: JobRuntime) -> None:
        self._runtime = runtime

    def get(self, principal: Principal, job_id: UUID) -> JobSnapshot:
        try:
            job, result = self._runtime.get_snapshot(
                principal.tenant_id, job_id
            )
        except JobNotFound as error:
            # A foreign job ID must be indistinguishable from a missing one.
            raise AtlasError(ErrorCode.NOT_FOUND, "Job not found", 404) from error
        except PsycopgError as error:
            raise AtlasError(
                ErrorCode.DEPENDENCY_FAILED,
                "Job store is unavailable",
                503,
                retryable=True,
            ) from error
        return JobSnapshot(
            schema_version="job_snapshot.v1",
            job=job,
            result=result,
        )
