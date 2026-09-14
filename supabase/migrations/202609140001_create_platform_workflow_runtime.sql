-- Durable S3 workflow runtime. These tables are owned by the trusted backend;
-- browser clients cannot submit, claim, mutate, or inspect operational records.

create table if not exists public.platform_commands (
  command_id uuid primary key,
  request_id uuid not null,
  principal_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  command_type text not null check (command_type ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  idempotency_key text not null check (
    char_length(idempotency_key) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  intent_fingerprint text not null check (intent_fingerprint ~ '^[0-9a-f]{64}$'),
  payload_schema_version text not null check (
    payload_schema_version ~ '^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$'
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  requested_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint platform_commands_personal_tenant check (tenant_id = principal_id),
  constraint platform_commands_tenant_idempotency_key unique (tenant_id, idempotency_key),
  constraint platform_commands_command_tenant unique (command_id, tenant_id)
);

create table if not exists public.workflow_jobs (
  job_id uuid primary key,
  request_id uuid not null,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  command_id uuid not null,
  workflow_name text not null check (workflow_name ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  workflow_version text not null check (workflow_version ~ '^v[1-9][0-9]*$'),
  status text not null check (
    status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'review_required')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  completed_at timestamptz,
  constraint workflow_jobs_command_tenant_fk
    foreign key (command_id, tenant_id)
    references public.platform_commands(command_id, tenant_id)
    on delete cascade,
  constraint workflow_jobs_job_tenant unique (job_id, tenant_id),
  constraint workflow_jobs_attempt_bound check (attempt_count <= max_attempts),
  constraint workflow_jobs_timestamp_order check (
    updated_at >= created_at and available_at >= created_at
  ),
  constraint workflow_jobs_lifecycle check (
    (status = 'running' and lease_expires_at is not null and completed_at is null)
    or
    (status in ('queued', 'review_required') and lease_expires_at is null and completed_at is null)
    or
    (status in ('succeeded', 'failed', 'cancelled') and lease_expires_at is null and completed_at is not null)
  )
);

create table if not exists public.workflow_steps (
  step_id uuid primary key,
  job_id uuid not null,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  step_key text not null check (
    char_length(step_key) between 1 and 128
    and step_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  step_name text not null check (step_name ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  step_version text not null check (step_version ~ '^v[1-9][0-9]*$'),
  required boolean not null default true,
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text check (
    error_code in (
      'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
      'INVALID_INPUT', 'RATE_LIMITED', 'DEPENDENCY_FAILED', 'INTERNAL_ERROR'
    )
  ),
  constraint workflow_steps_job_tenant_fk
    foreign key (job_id, tenant_id)
    references public.workflow_jobs(job_id, tenant_id)
    on delete cascade,
  constraint workflow_steps_job_key unique (job_id, step_key),
  constraint workflow_steps_attempt_bound check (attempt_count <= max_attempts),
  constraint workflow_steps_lifecycle check (
    (status = 'pending' and lease_expires_at is null and completed_at is null and error_code is null)
    or
    (status = 'running' and lease_expires_at is not null and started_at is not null and completed_at is null and error_code is null)
    or
    (status in ('succeeded', 'skipped') and lease_expires_at is null and completed_at is not null and error_code is null)
    or
    (status = 'failed' and lease_expires_at is null and completed_at is not null and error_code is not null)
  )
);

create table if not exists public.outbox_events (
  event_id uuid primary key,
  request_id uuid not null,
  correlation_id uuid not null,
  causation_event_id uuid references public.outbox_events(event_id),
  event_schema_version text not null check (
    event_schema_version ~ '^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$'
  ),
  tenant_id uuid not null references auth.users(id) on delete cascade,
  aggregate_type text not null check (aggregate_type ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  aggregate_id uuid not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null,
  available_at timestamptz not null,
  publish_attempt_count integer not null default 0 check (publish_attempt_count between 0 and 20),
  published_at timestamptz,
  last_error_code text check (
    last_error_code in (
      'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
      'INVALID_INPUT', 'RATE_LIMITED', 'DEPENDENCY_FAILED', 'INTERNAL_ERROR'
    )
  ),
  publish_lease_token uuid,
  publish_lease_expires_at timestamptz,
  constraint outbox_events_timestamp_order check (
    available_at >= occurred_at
    and (published_at is null or published_at >= occurred_at)
  ),
  constraint outbox_events_delivery_lifecycle check (
    (publish_lease_token is null) = (publish_lease_expires_at is null)
    and (
      published_at is null
      or (
        last_error_code is null
        and publish_lease_token is null
        and publish_lease_expires_at is null
      )
    )
  )
);

create index if not exists workflow_jobs_claim_idx
  on public.workflow_jobs (available_at, created_at, job_id)
  where status = 'queued';

create index if not exists workflow_jobs_expired_lease_idx
  on public.workflow_jobs (lease_expires_at, job_id)
  where status = 'running';

create index if not exists workflow_jobs_tenant_created_idx
  on public.workflow_jobs (tenant_id, created_at desc);

create index if not exists outbox_events_delivery_idx
  on public.outbox_events (available_at, occurred_at, event_id)
  where published_at is null;

alter table public.platform_commands enable row level security;
alter table public.workflow_jobs enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.outbox_events enable row level security;

-- The FastAPI service is the authorization boundary. Keeping these tables out
-- of PostgREST also prevents payloads and operational metadata from leaking.
revoke all on public.platform_commands from public, anon, authenticated;
revoke all on public.workflow_jobs from public, anon, authenticated;
revoke all on public.workflow_steps from public, anon, authenticated;
revoke all on public.outbox_events from public, anon, authenticated;

grant select, insert, update, delete on public.platform_commands to service_role;
grant select, insert, update, delete on public.workflow_jobs to service_role;
grant select, insert, update, delete on public.workflow_steps to service_role;
grant select, insert, update, delete on public.outbox_events to service_role;
