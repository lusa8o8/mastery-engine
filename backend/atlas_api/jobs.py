"""Deterministic, tenant-scoped workflow job runtime.

This module contains no provider or database code. It defines the state and
repository semantics that the later Postgres adapter must preserve exactly.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
import hashlib
import json
from threading import RLock
from typing import Protocol
from uuid import UUID, uuid4

from contracts.s2a.models import CommandEnvelope, JobStatus, WorkflowJob


class JobRuntimeError(RuntimeError):
    """Base class for deterministic job-runtime failures."""


class JobNotFound(JobRuntimeError):
    pass


class IdempotencyConflict(JobRuntimeError):
    pass


class InvalidJobTransition(JobRuntimeError):
    pass


class LeaseLost(JobRuntimeError):
    pass


class JobOutcome(str, Enum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    REVIEW_REQUIRED = "review_required"


ALLOWED_TRANSITIONS: dict[JobStatus, frozenset[JobStatus]] = {
    JobStatus.QUEUED: frozenset({JobStatus.RUNNING, JobStatus.CANCELLED}),
    JobStatus.RUNNING: frozenset(
        {
            JobStatus.RUNNING,  # An expired lease is reclaimed as a new attempt.
            JobStatus.QUEUED,
            JobStatus.SUCCEEDED,
            JobStatus.FAILED,
            JobStatus.CANCELLED,
            JobStatus.REVIEW_REQUIRED,
        }
    ),
    JobStatus.REVIEW_REQUIRED: frozenset({JobStatus.CANCELLED}),
    JobStatus.SUCCEEDED: frozenset(),
    JobStatus.FAILED: frozenset(),
    JobStatus.CANCELLED: frozenset(),
}


@dataclass(frozen=True)
class SubmissionResult:
    job: WorkflowJob
    replayed: bool


@dataclass(frozen=True)
class JobLease:
    """Compare-and-set receipt required to finish a claimed job."""

    job: WorkflowJob
    expected_lease_expires_at: datetime


class JobRepository(Protocol):
    def submit(
        self,
        command: CommandEnvelope,
        *,
        workflow_name: str,
        workflow_version: str,
        max_attempts: int,
        now: datetime,
        job_id: UUID,
    ) -> SubmissionResult: ...

    def get(self, tenant_id: UUID, job_id: UUID) -> WorkflowJob: ...

    def get_command(
        self, tenant_id: UUID, command_id: UUID
    ) -> CommandEnvelope: ...

    def request_cancellation(
        self, tenant_id: UUID, job_id: UUID, *, now: datetime
    ) -> WorkflowJob: ...

    def claim_next(
        self, *, now: datetime, lease_duration: timedelta
    ) -> JobLease | None: ...

    def finish(
        self,
        tenant_id: UUID,
        job_id: UUID,
        *,
        expected_lease_expires_at: datetime,
        outcome: JobOutcome,
        now: datetime,
        retry_delay: timedelta | None = None,
    ) -> WorkflowJob: ...


def _validated_copy(job: WorkflowJob, **updates: object) -> WorkflowJob:
    values = job.model_dump()
    values.update(updates)
    return WorkflowJob.model_validate(values)


def _transition(job: WorkflowJob, status: JobStatus, **updates: object) -> WorkflowJob:
    if status not in ALLOWED_TRANSITIONS[job.status]:
        raise InvalidJobTransition(
            f"transition from {job.status.value} to {status.value} is not allowed"
        )
    return _validated_copy(job, status=status, **updates)


def _intent_fingerprint(command: CommandEnvelope) -> str:
    """Hash command intent, excluding per-delivery IDs and timestamps."""

    intent = {
        "command_type": command.command_type,
        "principal_id": str(command.principal_id),
        "tenant_id": str(command.tenant_id),
        "payload_schema_version": command.payload_schema_version,
        "payload": command.model_dump(mode="json")["payload"],
    }
    encoded = json.dumps(
        intent, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class InMemoryJobRepository:
    """Atomic fixture repository used to prove semantics before Postgres.

    All reads return deep copies, preventing callers from mutating stored state.
    The lock models the transaction boundary required of the durable adapter.
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._jobs: dict[UUID, WorkflowJob] = {}
        self._commands: dict[UUID, CommandEnvelope] = {}
        self._idempotency: dict[tuple[UUID, str], tuple[str, UUID]] = {}

    @staticmethod
    def _copy(job: WorkflowJob) -> WorkflowJob:
        return job.model_copy(deep=True)

    def submit(
        self,
        command: CommandEnvelope,
        *,
        workflow_name: str,
        workflow_version: str,
        max_attempts: int,
        now: datetime,
        job_id: UUID,
    ) -> SubmissionResult:
        fingerprint = _intent_fingerprint(command)
        key = (command.tenant_id, command.idempotency_key)
        with self._lock:
            existing = self._idempotency.get(key)
            if existing is not None:
                existing_fingerprint, existing_job_id = existing
                if existing_fingerprint != fingerprint:
                    raise IdempotencyConflict(
                        "idempotency key was already used for different command intent"
                    )
                return SubmissionResult(self._copy(self._jobs[existing_job_id]), True)

            job = WorkflowJob(
                schema_version="workflow_job.v1",
                request_id=command.request_id,
                job_id=job_id,
                tenant_id=command.tenant_id,
                command_id=command.command_id,
                workflow_name=workflow_name,
                workflow_version=workflow_version,
                status=JobStatus.QUEUED,
                attempt_count=0,
                max_attempts=max_attempts,
                available_at=now,
                created_at=now,
                updated_at=now,
            )
            self._jobs[job_id] = job
            self._commands[command.command_id] = command.model_copy(deep=True)
            self._idempotency[key] = (fingerprint, job_id)
            return SubmissionResult(self._copy(job), False)

    def get(self, tenant_id: UUID, job_id: UUID) -> WorkflowJob:
        with self._lock:
            job = self._jobs.get(job_id)
            # Do not reveal whether another tenant owns the identifier.
            if job is None or job.tenant_id != tenant_id:
                raise JobNotFound("job not found")
            return self._copy(job)

    def get_command(
        self, tenant_id: UUID, command_id: UUID
    ) -> CommandEnvelope:
        with self._lock:
            command = self._commands.get(command_id)
            if command is None or command.tenant_id != tenant_id:
                raise JobNotFound("command not found")
            return command.model_copy(deep=True)

    def request_cancellation(
        self, tenant_id: UUID, job_id: UUID, *, now: datetime
    ) -> WorkflowJob:
        with self._lock:
            job = self.get(tenant_id, job_id)
            if job.status in {
                JobStatus.SUCCEEDED,
                JobStatus.FAILED,
                JobStatus.CANCELLED,
            }:
                return job
            if job.status in {JobStatus.QUEUED, JobStatus.REVIEW_REQUIRED}:
                updated = _transition(
                    job,
                    JobStatus.CANCELLED,
                    cancel_requested_at=now,
                    completed_at=now,
                    lease_expires_at=None,
                    updated_at=now,
                )
            elif job.status == JobStatus.RUNNING:
                updated = _validated_copy(
                    job, cancel_requested_at=job.cancel_requested_at or now, updated_at=now
                )
            else:
                raise InvalidJobTransition("job cannot be cancelled from this state")
            self._jobs[job_id] = updated
            return self._copy(updated)

    def claim_next(
        self, *, now: datetime, lease_duration: timedelta
    ) -> JobLease | None:
        if lease_duration <= timedelta(0):
            raise ValueError("lease_duration must be positive")
        with self._lock:
            candidates = sorted(
                self._jobs.values(),
                key=lambda job: (job.available_at, job.created_at, str(job.job_id)),
            )
            for job in candidates:
                expired = (
                    job.status == JobStatus.RUNNING
                    and job.lease_expires_at is not None
                    and job.lease_expires_at <= now
                )
                due = job.status == JobStatus.QUEUED and job.available_at <= now
                if not (expired or due):
                    continue
                if job.cancel_requested_at is not None:
                    cancelled = _transition(
                        job,
                        JobStatus.CANCELLED,
                        lease_expires_at=None,
                        completed_at=now,
                        updated_at=now,
                    )
                    self._jobs[job.job_id] = cancelled
                    continue
                if job.attempt_count >= job.max_attempts:
                    exhausted = _transition(
                        job,
                        JobStatus.FAILED,
                        lease_expires_at=None,
                        completed_at=now,
                        updated_at=now,
                    )
                    self._jobs[job.job_id] = exhausted
                    continue
                lease_expires_at = now + lease_duration
                claimed = _transition(
                    job,
                    JobStatus.RUNNING,
                    attempt_count=job.attempt_count + 1,
                    lease_expires_at=lease_expires_at,
                    completed_at=None,
                    updated_at=now,
                )
                self._jobs[job.job_id] = claimed
                return JobLease(self._copy(claimed), lease_expires_at)
            return None

    def finish(
        self,
        tenant_id: UUID,
        job_id: UUID,
        *,
        expected_lease_expires_at: datetime,
        outcome: JobOutcome,
        now: datetime,
        retry_delay: timedelta | None = None,
    ) -> WorkflowJob:
        with self._lock:
            job = self.get(tenant_id, job_id)
            if job.status != JobStatus.RUNNING:
                raise InvalidJobTransition("only a running job may be finished")
            if (
                job.lease_expires_at != expected_lease_expires_at
                or job.lease_expires_at is None
                or job.lease_expires_at <= now
            ):
                raise LeaseLost("job lease is no longer active")
            if job.cancel_requested_at is not None:
                updated = _transition(
                    job,
                    JobStatus.CANCELLED,
                    lease_expires_at=None,
                    completed_at=now,
                    updated_at=now,
                )
            elif retry_delay is not None:
                if outcome != JobOutcome.FAILED:
                    raise InvalidJobTransition("only a failed attempt may request retry")
                if retry_delay <= timedelta(0):
                    raise InvalidJobTransition("retry_delay must be positive")
                if job.attempt_count >= job.max_attempts:
                    updated = _transition(
                        job,
                        JobStatus.FAILED,
                        lease_expires_at=None,
                        completed_at=now,
                        updated_at=now,
                    )
                else:
                    updated = _transition(
                        job,
                        JobStatus.QUEUED,
                        lease_expires_at=None,
                        available_at=now + retry_delay,
                        updated_at=now,
                    )
            else:
                status = JobStatus(outcome.value)
                completed_at = now if status != JobStatus.REVIEW_REQUIRED else None
                updated = _transition(
                    job,
                    status,
                    lease_expires_at=None,
                    completed_at=completed_at,
                    updated_at=now,
                )
            self._jobs[job_id] = updated
            return self._copy(updated)


class JobRuntime:
    """Small application service with injectable time and identifier sources."""

    def __init__(
        self,
        repository: JobRepository,
        *,
        clock: Callable[[], datetime],
        id_factory: Callable[[], UUID] = uuid4,
        lease_duration: timedelta = timedelta(minutes=5),
    ) -> None:
        if lease_duration <= timedelta(0):
            raise ValueError("lease_duration must be positive")
        self._repository = repository
        self._clock = clock
        self._id_factory = id_factory
        self._lease_duration = lease_duration

    @property
    def lease_duration(self) -> timedelta:
        return self._lease_duration

    def submit(
        self,
        command: CommandEnvelope,
        *,
        workflow_name: str,
        workflow_version: str,
        max_attempts: int = 3,
    ) -> SubmissionResult:
        return self._repository.submit(
            command,
            workflow_name=workflow_name,
            workflow_version=workflow_version,
            max_attempts=max_attempts,
            now=self._clock(),
            job_id=self._id_factory(),
        )

    def get(self, tenant_id: UUID, job_id: UUID) -> WorkflowJob:
        return self._repository.get(tenant_id, job_id)

    def command_for(self, lease: JobLease) -> CommandEnvelope:
        return self._repository.get_command(
            lease.job.tenant_id, lease.job.command_id
        )

    def cancel(self, tenant_id: UUID, job_id: UUID) -> WorkflowJob:
        return self._repository.request_cancellation(
            tenant_id, job_id, now=self._clock()
        )

    def claim_next(self) -> JobLease | None:
        return self._repository.claim_next(
            now=self._clock(), lease_duration=self._lease_duration
        )

    def finish(
        self,
        lease: JobLease,
        outcome: JobOutcome,
        *,
        retry_delay: timedelta | None = None,
    ) -> WorkflowJob:
        return self._repository.finish(
            lease.job.tenant_id,
            lease.job.job_id,
            expected_lease_expires_at=lease.expected_lease_expires_at,
            outcome=outcome,
            now=self._clock(),
            retry_delay=retry_delay,
        )
