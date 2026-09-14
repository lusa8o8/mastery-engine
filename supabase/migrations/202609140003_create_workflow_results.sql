-- Validated worker outputs are committed in the same transaction as job
-- success. Browser clients cannot read operational results directly; the
-- authenticated Atlas API enforces tenant ownership and response contracts.

create table if not exists public.workflow_results (
  job_id uuid primary key,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  output_schema_version text not null check (
    output_schema_version ~ '^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$'
  ),
  output jsonb not null check (jsonb_typeof(output) = 'object'),
  created_at timestamptz not null,
  constraint workflow_results_job_tenant_fk
    foreign key (job_id, tenant_id)
    references public.workflow_jobs(job_id, tenant_id)
    on delete cascade
);

alter table public.workflow_results enable row level security;

revoke all on public.workflow_results from public, anon, authenticated;
grant select, insert, update, delete on public.workflow_results to service_role;
