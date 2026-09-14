"""Tests for the deterministic S3 job runtime."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.atlas_api.jobs import (  # noqa: E402
    IdempotencyConflict,
    InMemoryJobRepository,
    InvalidJobTransition,
    JobNotFound,
    JobOutcome,
    JobRuntime,
    LeaseLost,
)
from contracts.s2a.models import CommandEnvelope, JobStatus  # noqa: E402

TENANT_A = UUID("11111111-1111-4111-8111-111111111111")
TENANT_B = UUID("22222222-2222-4222-8222-222222222222")
JOB_IDS = iter(
    [
        UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
        UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"),
        UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"),
    ]
)


class MutableClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 9, 14, 10, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: int) -> None:
        self.now += timedelta(**kwargs)


def command(
    *,
    tenant: UUID = TENANT_A,
    key: str = "extract:paper-1",
    resource_id: str = "paper-1",
    delivery: int = 1,
) -> CommandEnvelope:
    return CommandEnvelope(
        schema_version="command.v1",
        request_id=UUID(f"30000000-0000-4000-8000-{delivery:012d}"),
        command_id=UUID(f"40000000-0000-4000-8000-{delivery:012d}"),
        command_type="resource.extract",
        principal_id=tenant,
        tenant_id=tenant,
        idempotency_key=key,
        payload_schema_version="resource_extract.v1",
        payload={"resource_id": resource_id},
        requested_at=datetime(2026, 9, 14, 9, tzinfo=timezone.utc),
    )


class S3JobRuntimeTest(unittest.TestCase):
    def setUp(self) -> None:
        global JOB_IDS
        JOB_IDS = iter(
            UUID(f"aaaaaaaa-aaaa-4aaa-8aaa-{number:012d}") for number in range(1, 10)
        )
        self.clock = MutableClock()
        self.repository = InMemoryJobRepository()
        self.runtime = JobRuntime(
            self.repository,
            clock=self.clock,
            id_factory=lambda: next(JOB_IDS),
            lease_duration=timedelta(minutes=5),
        )

    def submit(self, value: CommandEnvelope | None = None, *, attempts: int = 3):
        return self.runtime.submit(
            value or command(),
            workflow_name="resource.extraction",
            workflow_version="v1",
            max_attempts=attempts,
        )

    def test_duplicate_intent_replays_one_job(self) -> None:
        first = self.submit(command(delivery=1))
        replay = self.submit(command(delivery=2))
        self.assertFalse(first.replayed)
        self.assertTrue(replay.replayed)
        self.assertEqual(first.job.job_id, replay.job.job_id)
        self.assertEqual(first.job.command_id, replay.job.command_id)
        self.assertEqual(first.job.status, JobStatus.QUEUED)

    def test_concurrent_duplicate_submissions_create_one_logical_job(self) -> None:
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(
                executor.map(
                    lambda delivery: self.submit(command(delivery=delivery)),
                    range(1, 9),
                )
            )
        self.assertEqual(
            {result.job.job_id for result in results}, {results[0].job.job_id}
        )
        self.assertEqual(sum(not result.replayed for result in results), 1)

    def test_same_key_with_different_intent_fails_closed(self) -> None:
        self.submit()
        with self.assertRaises(IdempotencyConflict):
            self.submit(command(resource_id="paper-2", delivery=2))

    def test_idempotency_and_reads_are_tenant_scoped(self) -> None:
        first = self.submit(command(tenant=TENANT_A))
        second = self.submit(command(tenant=TENANT_B, delivery=2))
        self.assertNotEqual(first.job.job_id, second.job.job_id)
        with self.assertRaises(JobNotFound):
            self.runtime.get(TENANT_B, first.job.job_id)

    def test_claim_and_success_require_active_lease(self) -> None:
        submitted = self.submit()
        lease = self.runtime.claim_next()
        assert lease is not None
        self.assertEqual(lease.job.job_id, submitted.job.job_id)
        self.assertEqual(lease.job.attempt_count, 1)
        completed = self.runtime.finish(lease, JobOutcome.SUCCEEDED)
        self.assertEqual(completed.status, JobStatus.SUCCEEDED)
        self.assertIsNone(self.runtime.claim_next())

    def test_stale_worker_cannot_finish_after_reclaim(self) -> None:
        self.submit()
        stale = self.runtime.claim_next()
        assert stale is not None
        self.clock.advance(minutes=5)
        current = self.runtime.claim_next()
        assert current is not None
        self.assertEqual(current.job.attempt_count, 2)
        with self.assertRaises(LeaseLost):
            self.runtime.finish(stale, JobOutcome.SUCCEEDED)
        self.assertEqual(
            self.runtime.finish(current, JobOutcome.SUCCEEDED).status,
            JobStatus.SUCCEEDED,
        )

    def test_transient_failure_uses_scheduled_bounded_retry(self) -> None:
        self.submit()
        lease = self.runtime.claim_next()
        assert lease is not None
        retry_at = self.clock.now + timedelta(minutes=2)
        queued = self.runtime.finish(lease, JobOutcome.FAILED, retry_at=retry_at)
        self.assertEqual(queued.status, JobStatus.QUEUED)
        self.assertIsNone(self.runtime.claim_next())
        self.clock.advance(minutes=2)
        self.assertIsNotNone(self.runtime.claim_next())

    def test_attempt_limit_produces_terminal_failure(self) -> None:
        self.submit(attempts=1)
        lease = self.runtime.claim_next()
        assert lease is not None
        failed = self.runtime.finish(
            lease,
            JobOutcome.FAILED,
            retry_at=self.clock.now + timedelta(minutes=1),
        )
        self.assertEqual(failed.status, JobStatus.FAILED)
        self.assertIsNotNone(failed.completed_at)

    def test_expired_final_lease_is_failed_by_watchdog(self) -> None:
        submitted = self.submit(attempts=1)
        self.runtime.claim_next()
        self.clock.advance(minutes=5)
        self.assertIsNone(self.runtime.claim_next())
        self.assertEqual(
            self.runtime.get(TENANT_A, submitted.job.job_id).status,
            JobStatus.FAILED,
        )

    def test_cancellation_is_immediate_queued_and_cooperative_running(self) -> None:
        queued = self.submit()
        cancelled = self.runtime.cancel(TENANT_A, queued.job.job_id)
        self.assertEqual(cancelled.status, JobStatus.CANCELLED)
        self.assertEqual(self.runtime.cancel(TENANT_A, queued.job.job_id), cancelled)

        running = self.submit(command(key="extract:paper-2", delivery=2))
        lease = self.runtime.claim_next()
        assert lease is not None
        self.assertEqual(lease.job.job_id, running.job.job_id)
        requested = self.runtime.cancel(TENANT_A, running.job.job_id)
        self.assertEqual(requested.status, JobStatus.RUNNING)
        self.assertEqual(
            self.runtime.finish(lease, JobOutcome.SUCCEEDED).status,
            JobStatus.CANCELLED,
        )

    def test_review_required_remains_open_for_human_decision(self) -> None:
        submitted = self.submit()
        lease = self.runtime.claim_next()
        assert lease is not None
        review = self.runtime.finish(lease, JobOutcome.REVIEW_REQUIRED)
        self.assertEqual(review.status, JobStatus.REVIEW_REQUIRED)
        self.assertIsNone(review.completed_at)
        self.assertEqual(
            self.runtime.cancel(TENANT_A, submitted.job.job_id).status,
            JobStatus.CANCELLED,
        )

    def test_invalid_finish_and_retry_transitions_fail_closed(self) -> None:
        submitted = self.submit()
        with self.assertRaises(InvalidJobTransition):
            self.repository.finish(
                TENANT_A,
                submitted.job.job_id,
                expected_lease_expires_at=self.clock.now + timedelta(minutes=5),
                outcome=JobOutcome.SUCCEEDED,
                now=self.clock.now,
            )
        lease = self.runtime.claim_next()
        assert lease is not None
        with self.assertRaises(InvalidJobTransition):
            self.runtime.finish(
                lease,
                JobOutcome.SUCCEEDED,
                retry_at=self.clock.now + timedelta(minutes=1),
            )
        with self.assertRaises(InvalidJobTransition):
            self.runtime.finish(lease, JobOutcome.FAILED, retry_at=self.clock.now)

    def test_repository_returns_copies(self) -> None:
        submitted = self.submit()
        submitted.job.status = JobStatus.SUCCEEDED
        self.assertEqual(
            self.runtime.get(TENANT_A, submitted.job.job_id).status,
            JobStatus.QUEUED,
        )

    def test_non_positive_lease_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "positive"):
            JobRuntime(
                self.repository,
                clock=self.clock,
                lease_duration=timedelta(0),
            )


if __name__ == "__main__":
    unittest.main()
