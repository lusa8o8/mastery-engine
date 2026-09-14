"""Failure-matrix tests for the bounded S3 worker and publisher loops."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.atlas_api.jobs import (  # noqa: E402
    InMemoryJobRepository,
    JobOutcome,
    JobRuntime,
)
from backend.atlas_api.outbox import OutboxLease, OutboxLeaseLost  # noqa: E402
from backend.atlas_api.publisher import (  # noqa: E402
    EventRegistry,
    EventRoute,
    OutboxPublisher,
    TransientPublishError,
)
from backend.atlas_api.retry import RetryPolicy  # noqa: E402
from backend.atlas_api.worker import (  # noqa: E402
    PermanentWorkflowError,
    ReviewRequiredError,
    TransientWorkflowError,
    WorkflowDefinition,
    WorkflowDisposition,
    WorkflowRegistry,
    WorkflowWorker,
)
from contracts.s2a.models import (  # noqa: E402
    CommandEnvelope,
    ErrorCode,
    JobStatus,
    OutboxEvent,
)


TENANT = UUID("11111111-1111-4111-8111-111111111111")
NOW = datetime(2026, 9, 14, 14, tzinfo=timezone.utc)


class MutableClock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


def command(key: str = "worker:paper-1") -> CommandEnvelope:
    return CommandEnvelope(
        schema_version="command.v1",
        request_id=UUID("22222222-2222-4222-8222-222222222222"),
        command_id=UUID("33333333-3333-4333-8333-333333333333"),
        command_type="resource.extract",
        principal_id=TENANT,
        tenant_id=TENANT,
        idempotency_key=key,
        payload_schema_version="resource_extract.v1",
        payload={"resource_id": "paper-1"},
        requested_at=NOW,
    )


async def verified(_context, _candidate) -> WorkflowDisposition:
    return WorkflowDisposition.SUCCEEDED


def definition(execute, verify=verified, *, timeout: float = 1) -> WorkflowDefinition:
    return WorkflowDefinition(
        workflow_name="resource.extraction",
        workflow_version="v1",
        execute=execute,
        verify=verify,
        timeout_seconds=timeout,
    )


class WorkerLoopTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.clock = MutableClock()
        self.repository = InMemoryJobRepository()
        identifiers = iter(
            [
                UUID("44444444-4444-4444-8444-444444444441"),
                UUID("44444444-4444-4444-8444-444444444442"),
            ]
        )
        self.runtime = JobRuntime(
            self.repository,
            clock=self.clock,
            id_factory=lambda: next(identifiers),
        )

    def submit(self, *, attempts: int = 3):
        return self.runtime.submit(
            command(),
            workflow_name="resource.extraction",
            workflow_version="v1",
            max_attempts=attempts,
        )

    def worker(self, workflow: WorkflowDefinition) -> WorkflowWorker:
        return WorkflowWorker(
            self.runtime,
            WorkflowRegistry([workflow]),
            retry_policy=RetryPolicy(jitter_ratio=0),
            jitter=lambda: 0.5,
        )

    async def test_success_runs_execute_then_independent_postcondition(self) -> None:
        calls: list[str] = []

        async def execute(context):
            calls.append("execute")
            self.assertEqual(context.command.payload["resource_id"], "paper-1")
            return {"stored": True}

        async def verify(_context, candidate):
            calls.append("verify")
            self.assertEqual(candidate, {"stored": True})
            return WorkflowDisposition.SUCCEEDED

        submitted = self.submit()
        result = await self.worker(definition(execute, verify)).run_batch()
        self.assertTrue(result.idle_reached)
        self.assertEqual(calls, ["execute", "verify"])
        self.assertEqual(result.traces[0].status, "succeeded")
        self.assertEqual(
            self.runtime.get(TENANT, submitted.job.job_id).status,
            JobStatus.SUCCEEDED,
        )

    async def test_verifier_and_explicit_signal_route_to_human_review(self) -> None:
        async def execute(_context):
            return "ambiguous"

        async def needs_review(_context, _candidate):
            return WorkflowDisposition.REVIEW_REQUIRED

        first = self.submit()
        trace = await self.worker(definition(execute, needs_review)).run_once()
        assert trace is not None
        self.assertEqual(trace.status, "review_required")
        self.assertEqual(
            self.runtime.get(TENANT, first.job.job_id).status,
            JobStatus.REVIEW_REQUIRED,
        )

        second_command = command("worker:paper-2").model_copy(
            update={"command_id": UUID("33333333-3333-4333-8333-333333333334")}
        )
        self.runtime.submit(
            second_command,
            workflow_name="resource.extraction",
            workflow_version="v1",
        )

        async def explicit(_context):
            raise ReviewRequiredError()

        explicit_trace = await self.worker(definition(explicit)).run_once()
        assert explicit_trace is not None
        self.assertEqual(explicit_trace.status, "review_required")

    async def test_transient_failure_and_timeout_schedule_bounded_retry(self) -> None:
        async def transient(_context):
            raise TransientWorkflowError(ErrorCode.RATE_LIMITED)

        submitted = self.submit()
        trace = await self.worker(definition(transient)).run_once()
        assert trace is not None
        job = self.runtime.get(TENANT, submitted.job.job_id)
        self.assertEqual(trace.status, "queued")
        self.assertEqual(trace.error_code, ErrorCode.RATE_LIMITED)
        self.assertEqual(job.available_at, NOW + timedelta(seconds=5))

        self.clock.now = job.available_at

        async def slow(_context):
            await asyncio.sleep(1)

        timeout_trace = await self.worker(
            definition(slow, timeout=0.001)
        ).run_once()
        assert timeout_trace is not None
        self.assertEqual(timeout_trace.status, "queued")
        self.assertEqual(timeout_trace.error_code, ErrorCode.DEPENDENCY_FAILED)

    async def test_unknown_and_unexpected_handlers_fail_without_error_text(self) -> None:
        async def execute(_context):
            raise RuntimeError("student answer and provider-secret")

        submitted = self.submit()
        trace = await self.worker(definition(execute)).run_once()
        assert trace is not None
        self.assertEqual(trace.status, "failed")
        self.assertEqual(trace.error_code, ErrorCode.INTERNAL_ERROR)
        self.assertNotIn("student", str(trace))
        self.assertEqual(
            self.runtime.get(TENANT, submitted.job.job_id).status, JobStatus.FAILED
        )

        other = JobRuntime(
            InMemoryJobRepository(),
            clock=self.clock,
            id_factory=lambda: UUID("55555555-5555-4555-8555-555555555555"),
        )
        other.submit(
            command(), workflow_name="unknown.workflow", workflow_version="v1"
        )
        unknown_worker = WorkflowWorker(
            other,
            WorkflowRegistry([definition(execute)]),
            jitter=lambda: 0.5,
        )
        unknown = await unknown_worker.run_once()
        assert unknown is not None
        self.assertEqual(unknown.status, "failed")
        self.assertEqual(unknown.error_code, ErrorCode.INVALID_INPUT)

    async def test_cancellation_during_handler_wins_over_success(self) -> None:
        submitted = self.submit()

        async def execute(context):
            self.runtime.cancel(TENANT, context.job.job_id)
            return "done"

        trace = await self.worker(definition(execute)).run_once()
        assert trace is not None
        self.assertEqual(trace.status, "cancelled")
        self.assertEqual(
            self.runtime.get(TENANT, submitted.job.job_id).status,
            JobStatus.CANCELLED,
        )

    async def test_permanent_failure_and_final_retry_are_terminal(self) -> None:
        async def permanent(_context):
            raise PermanentWorkflowError(ErrorCode.INVALID_INPUT)

        self.submit()
        trace = await self.worker(definition(permanent)).run_once()
        assert trace is not None
        self.assertEqual(trace.status, "failed")
        self.assertEqual(trace.error_code, ErrorCode.INVALID_INPUT)

        repository = InMemoryJobRepository()
        runtime = JobRuntime(
            repository,
            clock=self.clock,
            id_factory=lambda: UUID("66666666-6666-4666-8666-666666666666"),
        )
        runtime.submit(
            command(),
            workflow_name="resource.extraction",
            workflow_version="v1",
            max_attempts=1,
        )

        async def transient(_context):
            raise TransientWorkflowError()

        worker = WorkflowWorker(
            runtime,
            WorkflowRegistry([definition(transient)]),
            jitter=lambda: 0.5,
        )
        final = await worker.run_once()
        assert final is not None
        self.assertEqual(final.status, "failed")

    async def test_registry_and_batch_bounds_fail_closed(self) -> None:
        async def execute(_context):
            return None

        item = definition(execute)
        with self.assertRaisesRegex(ValueError, "unique"):
            WorkflowRegistry([item, item])
        with self.assertRaisesRegex(ValueError, "workflow_name"):
            WorkflowDefinition("bad route", "v1", execute, verified)
        with self.assertRaisesRegex(ValueError, "max_jobs"):
            await self.worker(item).run_batch(max_jobs=0)
        short_lease_runtime = JobRuntime(
            InMemoryJobRepository(),
            clock=self.clock,
            lease_duration=timedelta(seconds=30),
        )
        with self.assertRaisesRegex(ValueError, "lease margin"):
            WorkflowWorker(short_lease_runtime, WorkflowRegistry([item]))


def event(
    *,
    event_id: int = 1,
    attempts: int = 0,
    event_type: str = "workflow.job_succeeded",
) -> OutboxEvent:
    return OutboxEvent(
        schema_version="outbox_event.v1",
        event_id=UUID(f"77777777-7777-4777-8777-{event_id:012d}"),
        request_id=UUID("88888888-8888-4888-8888-888888888888"),
        correlation_id=UUID("88888888-8888-4888-8888-888888888888"),
        event_schema_version="workflow_job_event.v1",
        tenant_id=TENANT,
        aggregate_type="workflow_job",
        aggregate_id=UUID("99999999-9999-4999-8999-999999999999"),
        event_type=event_type,
        payload={"job_id": "safe-id", "status": "succeeded"},
        occurred_at=NOW,
        available_at=NOW,
        publish_attempt_count=attempts,
    )


class FakeOutboxRepository:
    def __init__(self, events: list[OutboxEvent], *, lose_ack: bool = False) -> None:
        self.events = list(events)
        self.acknowledged: list[OutboxLease] = []
        self.retried: list[tuple[OutboxLease, ErrorCode, timedelta]] = []
        self.dead: list[tuple[OutboxLease, ErrorCode]] = []
        self.lose_ack = lose_ack

    def claim_next(self):
        if not self.events:
            return None
        value = self.events.pop(0)
        claimed = OutboxEvent.model_validate(
            {**value.model_dump(), "publish_attempt_count": value.publish_attempt_count + 1}
        )
        return OutboxLease(
            claimed, UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        )

    def acknowledge(self, lease):
        if self.lose_ack:
            raise OutboxLeaseLost("lost")
        self.acknowledged.append(lease)
        return lease.event

    def record_failure(self, lease, error_code, *, retry_delay):
        self.retried.append((lease, error_code, retry_delay))
        return lease.event

    def dead_letter(self, lease, error_code):
        self.dead.append((lease, error_code))
        return lease.event


async def delivered(_event) -> None:
    return None


class PublisherLoopTest(unittest.IsolatedAsyncioTestCase):
    def publisher(self, repository, deliver=delivered, *, timeout=1):
        return OutboxPublisher(
            repository,
            EventRegistry([EventRoute("workflow.job_succeeded", deliver, timeout)]),
            retry_policy=RetryPolicy(jitter_ratio=0),
            jitter=lambda: 0.5,
        )

    async def test_success_is_acknowledged_and_batch_stops_when_idle(self) -> None:
        repository = FakeOutboxRepository([event()])
        batch = await self.publisher(repository).run_batch()
        self.assertTrue(batch.idle_reached)
        self.assertEqual(batch.traces[0].status, "published")
        self.assertEqual(len(repository.acknowledged), 1)

    async def test_transient_failure_retries_and_twentieth_attempt_dead_letters(self) -> None:
        async def transient(_event):
            raise TransientPublishError(ErrorCode.RATE_LIMITED)

        repository = FakeOutboxRepository([event(), event(event_id=2, attempts=19)])
        publisher = self.publisher(repository, transient)
        first = await publisher.run_once()
        second = await publisher.run_once()
        assert first is not None and second is not None
        self.assertEqual(first.status, "retry_scheduled")
        self.assertEqual(repository.retried[0][2], timedelta(seconds=5))
        self.assertEqual(second.status, "dead_lettered")
        self.assertEqual(repository.dead[0][1], ErrorCode.RATE_LIMITED)

    async def test_unknown_event_and_unexpected_sink_error_dead_letter(self) -> None:
        unknown_repo = FakeOutboxRepository(
            [event(event_type="workflow.unregistered")]
        )
        unknown = await self.publisher(unknown_repo).run_once()
        assert unknown is not None
        self.assertEqual(unknown.status, "dead_lettered")
        self.assertEqual(unknown.error_code, ErrorCode.INVALID_INPUT)

        async def broken(_event):
            raise RuntimeError("provider-secret and student content")

        broken_repo = FakeOutboxRepository([event(event_id=2)])
        broken_trace = await self.publisher(broken_repo, broken).run_once()
        assert broken_trace is not None
        self.assertEqual(broken_trace.status, "dead_lettered")
        self.assertEqual(broken_trace.error_code, ErrorCode.INTERNAL_ERROR)
        self.assertNotIn("provider-secret", str(broken_trace))

    async def test_timeout_retries_and_stale_ack_does_not_overwrite(self) -> None:
        async def slow(_event):
            await asyncio.sleep(1)

        timeout_repo = FakeOutboxRepository([event()])
        timed = await self.publisher(timeout_repo, slow, timeout=0.001).run_once()
        assert timed is not None
        self.assertEqual(timed.status, "retry_scheduled")
        self.assertEqual(timed.error_code, ErrorCode.DEPENDENCY_FAILED)

        stale_repo = FakeOutboxRepository([event(event_id=2)], lose_ack=True)
        stale = await self.publisher(stale_repo).run_once()
        assert stale is not None
        self.assertEqual(stale.status, "lease_lost")
        self.assertEqual(stale.error_code, ErrorCode.CONFLICT)

    async def test_registry_and_batch_bounds_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "unique"):
            EventRegistry(
                [
                    EventRoute("workflow.job_succeeded", delivered),
                    EventRoute("workflow.job_succeeded", delivered),
                ]
            )
        with self.assertRaisesRegex(ValueError, "max_events"):
            await self.publisher(FakeOutboxRepository([])).run_batch(max_events=0)

        class ShortLeaseRepository(FakeOutboxRepository):
            lease_duration = timedelta(seconds=5)

        with self.assertRaisesRegex(ValueError, "lease margin"):
            self.publisher(ShortLeaseRepository([]))


class RetryPolicyTest(unittest.TestCase):
    def test_backoff_is_exponential_bounded_and_deterministic_with_sample(self) -> None:
        policy = RetryPolicy(
            base_delay=timedelta(seconds=5),
            maximum_delay=timedelta(seconds=20),
            jitter_ratio=0,
        )
        self.assertEqual(policy.delay(1, 0.5), timedelta(seconds=5))
        self.assertEqual(policy.delay(2, 0.5), timedelta(seconds=10))
        self.assertEqual(policy.delay(9, 0.5), timedelta(seconds=20))
        with self.assertRaises(ValueError):
            policy.delay(0, 0.5)


if __name__ == "__main__":
    unittest.main()
