alter table public.token_logs
add column if not exists estimated_cost_usd numeric,
add column if not exists input_cost_per_m numeric,
add column if not exists output_cost_per_m numeric,
add column if not exists cost_currency text not null default 'USD';

create index if not exists token_logs_user_context_created_idx
  on public.token_logs (user_id, context, created_at desc);
