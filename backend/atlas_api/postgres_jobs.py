"""Psycopg repository preserving the deterministic S3 job semantics."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from contracts.s2a.models import CommandEnvelope, JobStatus, WorkflowJob

from .jobs import (
    IdempotencyConflict,
    InvalidJobTransition,
    JobLease,
    JobNotFound,
    JobOutcome,
    JobRuntimeError,
    LeaseLost,
    SubmissionResult,
    _intent_fingerprint,
    _transition,
    _validated_copy,
)


JOB_COLUMNS = """
job_id, request_id, tenant_id, command_id, workflow_name, workflow_version,
status, attempt_count, max_attempts, available_at, created_at, updated_at,
lease_expires_at, cancel_requested_at, completed_at
"""


class PostgresJobRepository:
    """Durable repository using one database transaction per public method.

    The connection factory should return a fresh Psycopg connection configured
    for the trusted backend role. Browser credentials are never accepted here.
    PostgreSQL time is authoritative so clock skew between workers cannot steal
    or extend leases.
    """

    def __init__(
        self,
        connection_factory: Callable[[], Connection[Any]],
        *,
        event_id_factory: Callable[[], UUID] = uuid4,
        maintenance_limit: int = 100,
    ) -> None:
        if maintenance_limit < 1 or maintenance_limit > 1000:
            raise ValueError("maintenance_limit must be between 1 and 1000")
        self._connection_factory = connection_factory
        self._event_id_factory = event_id_factory
        self._maintenance_limit = maintenance_limit

    @staticmethod
    def _job(row: dict[str, Any]) -> WorkflowJob:
        return WorkflowJob.model_validate(
            {"schema_version": "workflow_job.v1", **row}
        )

    @staticmethod
    def _database_now(cursor: Any) -> datetime:
        cursor.execute("select now() as database_now")
        return cursor.fetchone()["database_now"]

    @staticmethod
    def _select_job(
        cursor: Any, tenant_id: UUID, job_id: UUID, *, for_update: bool = False
    ) -> WorkflowJob:
        suffix = " for update" if for_update else ""
        cursor.execute(
            f"select {JOB_COLUMNS} from public.workflow_jobs "
            f"where tenant_id = %s and job_id = %s{suffix}",
            (tenant_id, job_id),
        )
        row = cursor.fetchone()
        if row is None:
            # Tenant mismatch and missing identifier deliberately look identical.
            raise JobNotFound("job not found")
        return PostgresJobRepository._job(row)

    @staticmethod
    def _store_job(cursor: Any, job: WorkflowJob) -> WorkflowJob:
        values = job.model_dump(mode="python")
        values["status"] = job.status.value
        cursor.execute(
            f"""
            update public.workflow_jobs
            set status = %(status)s,
                attempt_count = %(attempt_count)s,
                available_at = %(available_at)s,
                updated_at = %(updated_at)s,
                lease_expires_at = %(lease_expires_at)s,
                cancel_requested_at = %(cancel_requested_at)s,
                completed_at = %(completed_at)s
            where tenant_id = %(tenant_id)s and job_id = %(job_id)s
            returning {JOB_COLUMNS}
            """,
            values,
        )
        row = cursor.fetchone()
        if row is None:
            raise JobNotFound("job not found")
        return PostgresJobRepository._job(row)

    def _insert_event(
        self,
        cursor: Any,
        job: WorkflowJob,
        *,
        event_type: str,
        occurred_at: datetime,
    ) -> None:
        # The outbox contains operational identifiers only, never command payload,
        # source documents, prompts, student messages, or model output.
        payload = {
            "job_id": str(job.job_id),
            "status": job.status.value,
            "workflow_name": job.workflow_name,
            "workflow_version": job.workflow_version,
            "attempt_count": job.attempt_count,
        }
        cursor.execute(
            """
            insert into public.outbox_events (
              event_id, request_id, correlation_id, event_schema_version,
              tenant_id, aggregate_type, aggregate_id, event_type, payload,
              occurred_at, available_at
            ) values (
              %s, %s, %s, 'workflow_job_event.v1',
              %s, 'workflow_job', %s, %s, %s, %s, %s
            )
            """,
            (
                self._event_id_factory(),
                job.request_id,
                job.request_id,
                job.tenant_id,
                job.job_id,
                event_type,
                Jsonb(payload),
                occurred_at,
                occurred_at,
            ),
        )

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
        del now  # PostgreSQL time is authoritative for durable records.
        fingerprint = _intent_fingerprint(command)
        with self._connection_factory() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                database_now = self._database_now(cursor)
                cursor.execute(
                    """
                    insert into public.platform_commands (
                      command_id, request_id, principal_id, tenant_id,
                      command_type, idempotency_key, intent_fingerprint,
                      payload_schema_version, payload, requested_at, created_at
                    ) values (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    on conflict (tenant_id, idempotency_key) do nothing
                    returning command_id
                    """,
                    (
                        command.command_id,
                        command.request_id,
                        command.principal_id,
                        command.tenant_id,
                        command.command_type,
                        command.idempotency_key,
                        fingerprint,
                        command.payload_schema_version,
                        Jsonb(command.model_dump(mode="json")["payload"]),
                        command.requested_at,
                        database_now,
                    ),
                )
                inserted = cursor.fetchone()
                if inserted is None:
                    cursor.execute(
                        """
                        select command_id, intent_fingerprint
                        from public.platform_commands
                        where tenant_id = %s and idempotency_key = %s
                        for update
                        """,
                        (command.tenant_id, command.idempotency_key),
                    )
                    existing = cursor.fetchone()
                    if existing is None:
                        raise JobRuntimeError("idempotency record disappeared")
                    if existing["intent_fingerprint"] != fingerprint:
                        raise IdempotencyConflict(
                            "idempotency key was already used for different command intent"
                        )
                    cursor.execute(
                        f"select {JOB_COLUMNS} from public.workflow_jobs "
                        "where tenant_id = %s and command_id = %s",
                        (command.tenant_id, existing["command_id"]),
                    )
                    row = cursor.fetchone()
                    if row is None:
                        raise JobRuntimeError("idempotent command has no workflow job")
                    return SubmissionResult(self._job(row), True)

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
                    available_at=database_now,
                    created_at=database_now,
                    updated_at=database_now,
                )
                values = job.model_dump(mode="python")
                values["status"] = job.status.value
                cursor.execute(
                    f"""
                    insert into public.workflow_jobs (
                      job_id, request_id, tenant_id, command_id, workflow_name,
                      workflow_version, status, attempt_count, max_attempts,
                      available_at, created_at, updated_at, lease_expires_at,
                      cancel_requested_at, completed_at
                    ) values (
                      %(job_id)s, %(request_id)s, %(tenant_id)s, %(command_id)s,
                      %(workflow_name)s, %(workflow_version)s, %(status)s,
                      %(attempt_count)s, %(max_attempts)s, %(available_at)s,
                      %(created_at)s, %(updated_at)s, %(lease_expires_at)s,
                      %(cancel_requested_at)s, %(completed_at)s
                    ) returning {JOB_COLUMNS}
                    """,
                    values,
                )
                stored = self._job(cursor.fetchone())
                self._insert_event(
                    cursor,
                    stored,
                    event_type="workflow.job_queued",
                    occurred_at=database_now,
                )
                return SubmissionResult(stored, False)

    def get(self, tenant_id: UUID, job_id: UUID) -> WorkflowJob:
        with self._connection_factory() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                return self._select_job(cursor, tenant_id, job_id)

    def get_command(
        self, tenant_id: UUID, command_id: UUID
    ) -> CommandEnvelope:
        with self._connection_factory() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    select request_id, command_id, command_type, principal_id,
                           tenant_id, idempotency_key, payload_schema_version,
                           payload, requested_at
                    from public.platform_commands
                    where tenant_id = %s and command_id = %s
                    """,
                    (tenant_id, command_id),
                )
                row = cursor.fetchone()
                if row is None:
                    raise JobNotFound("command not found")
                return CommandEnvelope.model_validate(
                    {"schema_version": "command.v1", **row}
                )

    def request_cancellation(
        self, tenant_id: UUID, job_id: UUID, *, now: datetime
    ) -> WorkflowJob:
        del now
        with self._connection_factory() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                database_now = self._database_now(cursor)
                job = self._select_job(cursor, tenant_id, job_id, for_update=True)
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
                        cancel_requested_at=database_now,
                        completed_at=database_now,
                        lease_expires_at=None,
                        updated_at=database_now,
                    )
                    event_type = "workflow.job_cancelled"
                elif job.status == JobStatus.RUNNING:
                    updated = _validated_copy(
                        job,
                        cancel_requested_at=job.cancel_requested_at or database_now,
                        updated_at=database_now,
                    )
                    event_type = "workflow.job_cancellation_requested"
                else:
                    raise InvalidJobTransition(
                        "job cannot be cancelled from this state"
                    )
                stored = self._store_job(cursor, updated)
                self._insert_event(
                    cursor, stored, event_type=event_type, occurred_at=database_now
                )
                return stored

    def claim_next(
        self, *, now: datetime, lease_duration: timedelta
    ) -> JobLease | None:
        del now
        if lease_duration <= timedelta(0):
            raise ValueError("lease_duration must be positive")
        with self._connection_factory() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                database_now = self._database_now(cursor)
                for _ in range(self._maintenance_limit):
                    cursor.execute(
                        f"""
                        select {JOB_COLUMNS}
                        from public.workflow_jobs
                        where (status = 'queued' and available_at <= %s)
                           or (status = 'running' and lease_expires_at <= %s)
                        order by available_at, created_at, job_id
                        limit 1
                        for update skip locked
                        """,
                        (database_now, database_now),
                    )
                    row = cursor.fetchone()
                    if row is None:
                        return None
                    job = self._job(row)
                    if job.cancel_requested_at is not None:
                        updated = _transition(
                            job,
                            JobStatus.CANCELLED,
                            lease_expires_at=None,
                            completed_at=database_now,
                            updated_at=database_now,
                        )
                        event_type = "workflow.job_cancelled"
                    elif job.attempt_count >= job.max_attempts:
                        updated = _transition(
                            job,
                            JobStatus.FAILED,
                            lease_expires_at=None,
                            completed_at=database_now,
                            updated_at=database_now,
                        )
                        event_type = "workflow.job_attempts_exhausted"
                    else:
                        lease_expires_at = database_now + lease_duration
                        updated = _transition(
                            job,
                            JobStatus.RUNNING,
                            attempt_count=job.attempt_count + 1,
                            lease_expires_at=lease_expires_at,
                            completed_at=None,
                            updated_at=database_now,
                        )
                        stored = self._store_job(cursor, updated)
                        self._insert_event(
                            cursor,
                            stored,
                            event_type="workflow.job_claimed",
                            occurred_at=database_now,
                        )
                        return JobLease(stored, lease_expires_at)
                    stored = self._store_job(cursor, updated)
                    self._insert_event(
                        cursor,
                        stored,
                        event_type=event_type,
                        occurred_at=database_now,
                    )
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
        del now
        with self._connection_factory() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                database_now = self._database_now(cursor)
                job = self._select_job(cursor, tenant_id, job_id, for_update=True)
                if job.status != JobStatus.RUNNING:
                    raise InvalidJobTransition("only a running job may be finished")
                if (
                    job.lease_expires_at != expected_lease_expires_at
                    or job.lease_expires_at is None
                    or job.lease_expires_at <= database_now
                ):
                    raise LeaseLost("job lease is no longer active")

                if job.cancel_requested_at is not None:
                    updated = _transition(
                        job,
                        JobStatus.CANCELLED,
                        lease_expires_at=None,
                        completed_at=database_now,
                        updated_at=database_now,
                    )
                    event_type = "workflow.job_cancelled"
                elif retry_delay is not None:
                    if outcome != JobOutcome.FAILED:
                        raise InvalidJobTransition(
                            "only a failed attempt may request retry"
                        )
                    if retry_delay <= timedelta(0):
                        raise InvalidJobTransition("retry_delay must be positive")
                    if job.attempt_count >= job.max_attempts:
                        updated = _transition(
                            job,
                            JobStatus.FAILED,
                            lease_expires_at=None,
                            completed_at=database_now,
                            updated_at=database_now,
                        )
                        event_type = "workflow.job_failed"
                    else:
                        updated = _transition(
                            job,
                            JobStatus.QUEUED,
                            lease_expires_at=None,
                            available_at=database_now + retry_delay,
                            updated_at=database_now,
                        )
                        event_type = "workflow.job_retry_scheduled"
                else:
                    status = JobStatus(outcome.value)
                    completed_at = (
                        None if status == JobStatus.REVIEW_REQUIRED else database_now
                    )
                    updated = _transition(
                        job,
                        status,
                        lease_expires_at=None,
                        completed_at=completed_at,
                        updated_at=database_now,
                    )
                    event_type = f"workflow.job_{status.value}"
                stored = self._store_job(cursor, updated)
                self._insert_event(
                    cursor,
                    stored,
                    event_type=event_type,
                    occurred_at=database_now,
                )
                return stored
