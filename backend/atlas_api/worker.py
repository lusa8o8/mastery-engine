"""Bounded, allowlisted workflow worker orchestration."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from random import SystemRandom
import re
from time import perf_counter
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ValidationError

from contracts.s2a.models import CommandEnvelope, ErrorCode, WorkflowJob

from .jobs import JobOutcome, JobRuntime, LeaseLost, WorkflowResult
from .retry import RetryPolicy


class WorkflowDisposition(str, Enum):
    SUCCEEDED = "succeeded"
    REVIEW_REQUIRED = "review_required"


class TransientWorkflowError(RuntimeError):
    def __init__(self, error_code: ErrorCode = ErrorCode.DEPENDENCY_FAILED) -> None:
        if error_code not in {ErrorCode.DEPENDENCY_FAILED, ErrorCode.RATE_LIMITED}:
            raise ValueError("transient workflow errors require a retryable code")
        super().__init__(error_code.value)
        self.error_code = error_code


class PermanentWorkflowError(RuntimeError):
    def __init__(self, error_code: ErrorCode = ErrorCode.INTERNAL_ERROR) -> None:
        super().__init__(error_code.value)
        self.error_code = error_code


class ReviewRequiredError(RuntimeError):
    """A trustworthy partial result needs judgment rather than blind retry."""


@dataclass(frozen=True)
class WorkflowContext:
    job: WorkflowJob
    command: CommandEnvelope


@dataclass(frozen=True)
class WorkflowDefinition:
    workflow_name: str
    workflow_version: str
    execute: Callable[[WorkflowContext], Awaitable[Any]]
    verify: Callable[[WorkflowContext, Any], Awaitable[WorkflowDisposition]]
    timeout_seconds: float = 240
    result_model: type[BaseModel] | None = None
    result_schema_version: str | None = None

    def __post_init__(self) -> None:
        if re.fullmatch(r"[a-z][a-z0-9_.-]{2,63}", self.workflow_name) is None:
            raise ValueError("workflow_name is invalid")
        if re.fullmatch(r"v[1-9][0-9]*", self.workflow_version) is None:
            raise ValueError("workflow_version is invalid")
        if self.timeout_seconds <= 0 or self.timeout_seconds > 300:
            raise ValueError("timeout_seconds must be between 0 and 300")
        if (self.result_model is None) != (self.result_schema_version is None):
            raise ValueError(
                "result_model and result_schema_version must be configured together"
            )
        if self.result_model is not None and (
            not isinstance(self.result_model, type)
            or not issubclass(self.result_model, BaseModel)
        ):
            raise ValueError("result_model must be a Pydantic model")
        if self.result_schema_version is not None and re.fullmatch(
            r"[a-z][a-z0-9_.-]+\.v[1-9][0-9]*", self.result_schema_version
        ) is None:
            raise ValueError("result_schema_version is invalid")


class WorkflowRegistry:
    def __init__(self, definitions: Iterable[WorkflowDefinition]) -> None:
        self._definitions: dict[tuple[str, str], WorkflowDefinition] = {}
        for definition in definitions:
            key = (definition.workflow_name, definition.workflow_version)
            if key in self._definitions:
                raise ValueError("workflow definitions must have unique name/version keys")
            self._definitions[key] = definition
        if not self._definitions:
            raise ValueError("at least one workflow definition is required")

    def resolve(self, name: str, version: str) -> WorkflowDefinition | None:
        return self._definitions.get((name, version))

    @property
    def maximum_timeout_seconds(self) -> float:
        return max(item.timeout_seconds for item in self._definitions.values())


@dataclass(frozen=True)
class WorkerTrace:
    request_id: UUID
    job_id: UUID
    workflow_name: str
    workflow_version: str
    attempt_number: int
    status: str
    duration_ms: float
    error_code: ErrorCode | None = None


@dataclass(frozen=True)
class WorkerBatch:
    traces: tuple[WorkerTrace, ...]
    idle_reached: bool


class WorkflowWorker:
    def __init__(
        self,
        runtime: JobRuntime,
        registry: WorkflowRegistry,
        *,
        retry_policy: RetryPolicy = RetryPolicy(),
        jitter: Callable[[], float] = SystemRandom().random,
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._runtime = runtime
        self._registry = registry
        self._retry_policy = retry_policy
        self._jitter = jitter
        self._clock = clock
        if registry.maximum_timeout_seconds + 30 > runtime.lease_duration.total_seconds():
            raise ValueError("workflow timeout must leave 30 seconds of lease margin")

    async def run_once(self) -> WorkerTrace | None:
        lease = await asyncio.to_thread(self._runtime.claim_next)
        if lease is None:
            return None
        started = perf_counter()
        error_code: ErrorCode | None = None
        retry_delay = None
        outcome = JobOutcome.FAILED
        stored_result: WorkflowResult | None = None
        try:
            command = await asyncio.to_thread(self._runtime.command_for, lease)
            definition = self._registry.resolve(
                lease.job.workflow_name, lease.job.workflow_version
            )
            if definition is None:
                raise PermanentWorkflowError(ErrorCode.INVALID_INPUT)
            context = WorkflowContext(job=lease.job, command=command)
            async with asyncio.timeout(definition.timeout_seconds):
                candidate = await definition.execute(context)
                if definition.result_model is not None:
                    candidate = definition.result_model.model_validate(
                        candidate
                    ).model_dump(mode="json")
                disposition = await definition.verify(context, candidate)
            if not isinstance(disposition, WorkflowDisposition):
                raise PermanentWorkflowError(ErrorCode.INVALID_INPUT)
            outcome = JobOutcome(disposition.value)
            if (
                outcome == JobOutcome.SUCCEEDED
                and definition.result_schema_version is not None
            ):
                stored_result = WorkflowResult(
                    schema_version="workflow_result.v1",
                    job_id=lease.job.job_id,
                    tenant_id=lease.job.tenant_id,
                    output_schema_version=definition.result_schema_version,
                    output=candidate,
                    created_at=self._clock(),
                )
        except ValidationError:
            # Invalid handler output is permanent and never persisted.
            error_code = ErrorCode.INVALID_INPUT
        except ReviewRequiredError:
            outcome = JobOutcome.REVIEW_REQUIRED
            error_code = ErrorCode.INVALID_INPUT
        except TransientWorkflowError as error:
            error_code = error.error_code
            retry_delay = self._retry_policy.delay(
                lease.job.attempt_count, self._jitter()
            )
        except TimeoutError:
            error_code = ErrorCode.DEPENDENCY_FAILED
            retry_delay = self._retry_policy.delay(
                lease.job.attempt_count, self._jitter()
            )
        except PermanentWorkflowError as error:
            error_code = error.error_code
        except Exception:
            # Handler text can contain student content or provider secrets.
            error_code = ErrorCode.INTERNAL_ERROR

        try:
            finished = await asyncio.to_thread(
                self._runtime.finish,
                lease,
                outcome,
                retry_delay=retry_delay,
                result=stored_result,
            )
            status = finished.status.value
        except LeaseLost:
            # Another worker owns recovery now; never overwrite its state.
            status = "lease_lost"
            error_code = ErrorCode.CONFLICT
        return WorkerTrace(
            request_id=lease.job.request_id,
            job_id=lease.job.job_id,
            workflow_name=lease.job.workflow_name,
            workflow_version=lease.job.workflow_version,
            attempt_number=lease.job.attempt_count,
            status=status,
            duration_ms=(perf_counter() - started) * 1000,
            error_code=error_code,
        )

    async def run_batch(self, *, max_jobs: int = 100) -> WorkerBatch:
        if max_jobs < 1 or max_jobs > 1000:
            raise ValueError("max_jobs must be between 1 and 1000")
        traces: list[WorkerTrace] = []
        for _ in range(max_jobs):
            trace = await self.run_once()
            if trace is None:
                return WorkerBatch(tuple(traces), True)
            traces.append(trace)
        return WorkerBatch(tuple(traces), False)
