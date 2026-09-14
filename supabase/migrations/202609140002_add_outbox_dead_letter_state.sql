-- Permanently rejected events must leave the delivery queue explicitly instead
-- of consuming retries forever or masquerading as successfully published.

alter table public.outbox_events
add column if not exists dead_lettered_at timestamptz;

alter table public.outbox_events
drop constraint if exists outbox_events_delivery_lifecycle;

alter table public.outbox_events
add constraint outbox_events_delivery_lifecycle check (
  (publish_lease_token is null) = (publish_lease_expires_at is null)
  and not (published_at is not null and dead_lettered_at is not null)
  and (
    (published_at is null and dead_lettered_at is null)
    or (
      published_at is not null
      and last_error_code is null
      and publish_lease_token is null
      and publish_lease_expires_at is null
    )
    or (
      dead_lettered_at is not null
      and last_error_code is not null
      and publish_lease_token is null
      and publish_lease_expires_at is null
    )
  )
);

drop index if exists public.outbox_events_delivery_idx;

create index outbox_events_delivery_idx
  on public.outbox_events (available_at, occurred_at, event_id)
  where published_at is null and dead_lettered_at is null;
