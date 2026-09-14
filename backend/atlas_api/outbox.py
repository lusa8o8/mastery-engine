"""Leased transactional-outbox delivery for the trusted backend."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from psycopg import Connection
from psycopg.rows import dict_row

from contracts.s2a.models import ErrorCode, OutboxEvent


class OutboxLeaseLost(RuntimeError):
    pass


@dataclass(frozen=True)
class OutboxLease:
    event: OutboxEvent
    lease_token: UUID


OUTBOX_COLUMNS = """
event_id, request_id, correlation_id, causation_event_id,
event_schema_version, tenant_id, aggregate_type, aggregate_id, event_type,
payload, occurred_at, available_at, publish_attempt_count, published_at,
last_error_code
"""

OUTBOX_UPDATE_COLUMNS = """
event.event_id, event.request_id, event.correlation_id, event.causation_event_id,
event.event_schema_version, event.tenant_id, event.aggregate_type,
event.aggregate_id, event.event_type, event.payload, event.occurred_at,
event.available_at, event.publish_attempt_count, event.published_at,
event.last_error_code
"""


class PostgresOutboxRepository:
    """Claims events for at-least-once delivery using private lease metadata.

    Consumers must deduplicate by event_id: a publisher can deliver an event and
    crash before acknowledging it. The lease makes concurrent publication
    unlikely but does not pretend distributed delivery can be exactly once.
    """

    def __init__(
        self,
        connection_factory: Callable[[], Connection[Any]],
        *,
        token_factory: Callable[[], UUID] = uuid4,
        lease_duration: timedelta = timedelta(minutes=1),
    ) -> None:
        if lease_duration <= timedelta(0):
            raise ValueError("lease_duration must be positive")
        self._connection_factory = connection_factory
        self._token_factory = token_factory
        self._lease_duration = lease_duration

    @staticmethod
    def _event(row: dict[str, Any]) -> OutboxEvent:
        return OutboxEvent.model_validate(
            {"schema_version": "outbox_event.v1", **row}
        )

    def claim_next(self) -> OutboxLease | None:
        with self._connection_factory() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute("select now() as database_now")
                database_now = cursor.fetchone()["database_now"]
                lease_token = self._token_factory()
                lease_expires_at = database_now + self._lease_duration
                cursor.execute(
                    f"""
                    with candidate as (
                      select event_id
                      from public.outbox_events
                      where published_at is null
                        and available_at <= %s
                        and publish_attempt_count < 20
                        and (
                          publish_lease_expires_at is null
                          or publish_lease_expires_at <= %s
                        )
                      order by available_at, occurred_at, event_id
                      limit 1
                      for update skip locked
                    )
                    update public.outbox_events as event
                    set publish_attempt_count = event.publish_attempt_count + 1,
                        publish_lease_token = %s,
                        publish_lease_expires_at = %s
                    from candidate
                    where event.event_id = candidate.event_id
                    returning {OUTBOX_UPDATE_COLUMNS}
                    """,
                    (database_now, database_now, lease_token, lease_expires_at),
                )
                row = cursor.fetchone()
                if row is None:
                    return None
                return OutboxLease(self._event(row), lease_token)

    def acknowledge(self, lease: OutboxLease) -> OutboxEvent:
        with self._connection_factory() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute("select now() as database_now")
                database_now = cursor.fetchone()["database_now"]
                cursor.execute(
                    f"""
                    update public.outbox_events as event
                    set published_at = %s,
                        last_error_code = null,
                        publish_lease_token = null,
                        publish_lease_expires_at = null
                    where event.event_id = %s
                      and event.published_at is null
                      and event.publish_lease_token = %s
                      and event.publish_lease_expires_at > %s
                    returning {OUTBOX_UPDATE_COLUMNS}
                    """,
                    (
                        database_now,
                        lease.event.event_id,
                        lease.lease_token,
                        database_now,
                    ),
                )
                row = cursor.fetchone()
                if row is None:
                    raise OutboxLeaseLost("outbox lease is no longer active")
                return self._event(row)

    def record_failure(
        self,
        lease: OutboxLease,
        error_code: ErrorCode,
        *,
        retry_delay: timedelta,
    ) -> OutboxEvent:
        with self._connection_factory() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute("select now() as database_now")
                database_now = cursor.fetchone()["database_now"]
                if retry_delay <= timedelta(0):
                    raise ValueError("retry_delay must be positive")
                cursor.execute(
                    f"""
                    update public.outbox_events as event
                    set available_at = %s,
                        last_error_code = %s,
                        publish_lease_token = null,
                        publish_lease_expires_at = null
                    where event.event_id = %s
                      and event.published_at is null
                      and event.publish_lease_token = %s
                      and event.publish_lease_expires_at > %s
                    returning {OUTBOX_UPDATE_COLUMNS}
                    """,
                    (
                        database_now + retry_delay,
                        error_code.value,
                        lease.event.event_id,
                        lease.lease_token,
                        database_now,
                    ),
                )
                row = cursor.fetchone()
                if row is None:
                    raise OutboxLeaseLost("outbox lease is no longer active")
                return self._event(row)
