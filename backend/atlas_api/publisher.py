"""Bounded, allowlisted transactional-outbox publisher orchestration."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import timedelta
from random import SystemRandom
import re
from time import perf_counter
from typing import Protocol
from uuid import UUID

from contracts.s2a.models import ErrorCode, OutboxEvent

from .outbox import OutboxLease, OutboxLeaseLost
from .retry import RetryPolicy


class TransientPublishError(RuntimeError):
    def __init__(self, error_code: ErrorCode = ErrorCode.DEPENDENCY_FAILED) -> None:
        if error_code not in {ErrorCode.DEPENDENCY_FAILED, ErrorCode.RATE_LIMITED}:
            raise ValueError("transient publisher errors require a retryable code")
        super().__init__(error_code.value)
        self.error_code = error_code


@dataclass(frozen=True)
class EventRoute:
    event_type: str
    deliver: Callable[[OutboxEvent], Awaitable[None]]
    timeout_seconds: float = 30

    def __post_init__(self) -> None:
        if re.fullmatch(r"[a-z][a-z0-9_.-]{2,63}", self.event_type) is None:
            raise ValueError("event_type is invalid")
        if self.timeout_seconds <= 0 or self.timeout_seconds > 60:
            raise ValueError("timeout_seconds must be between 0 and 60")


class EventRegistry:
    def __init__(self, routes: Iterable[EventRoute]) -> None:
        self._routes: dict[str, EventRoute] = {}
        for route in routes:
            if route.event_type in self._routes:
                raise ValueError("event routes must be unique")
            self._routes[route.event_type] = route
        if not self._routes:
            raise ValueError("at least one event route is required")

    def resolve(self, event_type: str) -> EventRoute | None:
        return self._routes.get(event_type)

    @property
    def maximum_timeout_seconds(self) -> float:
        return max(route.timeout_seconds for route in self._routes.values())


class OutboxRepository(Protocol):
    def claim_next(self) -> OutboxLease | None: ...

    def acknowledge(self, lease: OutboxLease) -> OutboxEvent: ...

    def record_failure(
        self,
        lease: OutboxLease,
        error_code: ErrorCode,
        *,
        retry_delay: timedelta,
    ) -> OutboxEvent: ...

    def dead_letter(
        self, lease: OutboxLease, error_code: ErrorCode
    ) -> OutboxEvent: ...


@dataclass(frozen=True)
class PublisherTrace:
    request_id: UUID
    event_id: UUID
    event_type: str
    attempt_number: int
    status: str
    duration_ms: float
    error_code: ErrorCode | None = None


@dataclass(frozen=True)
class PublisherBatch:
    traces: tuple[PublisherTrace, ...]
    idle_reached: bool


class OutboxPublisher:
    def __init__(
        self,
        repository: OutboxRepository,
        registry: EventRegistry,
        *,
        retry_policy: RetryPolicy = RetryPolicy(),
        jitter: Callable[[], float] = SystemRandom().random,
    ) -> None:
        self._repository = repository
        self._registry = registry
        self._retry_policy = retry_policy
        self._jitter = jitter
        lease_duration = getattr(repository, "lease_duration", None)
        if (
            lease_duration is not None
            and registry.maximum_timeout_seconds + 5 > lease_duration.total_seconds()
        ):
            raise ValueError("publisher timeout must leave 5 seconds of lease margin")

    async def run_once(self) -> PublisherTrace | None:
        lease = await asyncio.to_thread(self._repository.claim_next)
        if lease is None:
            return None
        started = perf_counter()
        error_code: ErrorCode | None = None
        status: str
        try:
            route = self._registry.resolve(lease.event.event_type)
            if route is None:
                error_code = ErrorCode.INVALID_INPUT
                await asyncio.to_thread(
                    self._repository.dead_letter, lease, error_code
                )
                status = "dead_lettered"
            else:
                try:
                    async with asyncio.timeout(route.timeout_seconds):
                        await route.deliver(lease.event)
                except TransientPublishError as error:
                    error_code = error.error_code
                    status = await self._retry_or_dead_letter(lease, error_code)
                except TimeoutError:
                    error_code = ErrorCode.DEPENDENCY_FAILED
                    status = await self._retry_or_dead_letter(lease, error_code)
                except Exception:
                    # Unknown sink failures are not guessed to be retryable.
                    error_code = ErrorCode.INTERNAL_ERROR
                    await asyncio.to_thread(
                        self._repository.dead_letter, lease, error_code
                    )
                    status = "dead_lettered"
                else:
                    await asyncio.to_thread(self._repository.acknowledge, lease)
                    status = "published"
        except OutboxLeaseLost:
            status = "lease_lost"
            error_code = ErrorCode.CONFLICT
        return PublisherTrace(
            request_id=lease.event.request_id,
            event_id=lease.event.event_id,
            event_type=lease.event.event_type,
            attempt_number=lease.event.publish_attempt_count,
            status=status,
            duration_ms=(perf_counter() - started) * 1000,
            error_code=error_code,
        )

    async def _retry_or_dead_letter(
        self, lease: OutboxLease, error_code: ErrorCode
    ) -> str:
        if lease.event.publish_attempt_count >= 20:
            await asyncio.to_thread(
                self._repository.dead_letter, lease, error_code
            )
            return "dead_lettered"
        delay = self._retry_policy.delay(
            lease.event.publish_attempt_count, self._jitter()
        )
        await asyncio.to_thread(
            self._repository.record_failure,
            lease,
            error_code,
            retry_delay=delay,
        )
        return "retry_scheduled"

    async def run_batch(self, *, max_events: int = 100) -> PublisherBatch:
        if max_events < 1 or max_events > 1000:
            raise ValueError("max_events must be between 1 and 1000")
        traces: list[PublisherTrace] = []
        for _ in range(max_events):
            trace = await self.run_once()
            if trace is None:
                return PublisherBatch(tuple(traces), True)
            traces.append(trace)
        return PublisherBatch(tuple(traces), False)
