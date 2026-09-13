-- Reserve non-simulator model capacity before contacting the provider.
-- These are operational safety ceilings, not billing entitlements. They can be
-- adjusted by an administrator without changing browser code or Edge Functions.

create table if not exists public.model_allowance_limits (
  plan_tier text primary key check (plan_tier in ('free', 'premium', 'pro')),
  token_limit_30d bigint not null check (token_limit_30d > 0),
  updated_at timestamptz not null default now()
);

insert into public.model_allowance_limits (plan_tier, token_limit_30d)
values
  ('free', 1000000),
  ('premium', 5000000),
  ('pro', 20000000)
on conflict (plan_tier) do nothing;

create table if not exists public.model_call_allowances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null check (route in ('atlas_chat', 'question_variant', 'paper_extraction')),
  status text not null default 'claimed' check (status in ('claimed', 'completed', 'failed')),
  reserved_input_tokens integer not null check (reserved_input_tokens >= 0),
  reserved_output_tokens integer not null check (reserved_output_tokens > 0),
  actual_input_tokens integer check (actual_input_tokens >= 0),
  actual_output_tokens integer check (actual_output_tokens >= 0),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists model_call_allowances_user_created_idx
  on public.model_call_allowances (user_id, created_at desc);

alter table public.model_call_allowances enable row level security;
alter table public.model_allowance_limits enable row level security;

alter table public.token_logs
add column if not exists model_call_allowance_id uuid
  references public.model_call_allowances(id) on delete set null;

create or replace function public.claim_model_allowance(
  p_user_id uuid,
  p_route text,
  p_reserved_input_tokens integer,
  p_reserved_output_tokens integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_limit bigint;
  v_used bigint;
  v_requested bigint;
  v_claim public.model_call_allowances;
begin
  if p_user_id is null
    or p_route not in ('atlas_chat', 'question_variant', 'paper_extraction')
    or p_reserved_input_tokens < 0
    or p_reserved_output_tokens <= 0 then
    return jsonb_build_object('ok', false, 'error_code', 'INVALID_ALLOWANCE_REQUEST');
  end if;

  -- Only the service-role Edge Functions can execute this function. Serialize
  -- each student's claims so concurrent tabs cannot both pass the same limit.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 2));

  select coalesce(plan_tier, 'free')
  into v_tier
  from public.user_entitlements
  where user_id = p_user_id;
  v_tier := coalesce(v_tier, 'free');

  select token_limit_30d
  into v_limit
  from public.model_allowance_limits
  where plan_tier = v_tier;

  if v_limit is null then
    return jsonb_build_object('ok', false, 'error_code', 'ALLOWANCE_POLICY_MISSING');
  end if;

  select coalesce(sum(
    case
      when status = 'completed' then coalesce(actual_input_tokens, 0) + coalesce(actual_output_tokens, 0)
      else reserved_input_tokens + reserved_output_tokens
    end
  ), 0)
  into v_used
  from public.model_call_allowances
  where user_id = p_user_id
    and created_at >= now() - interval '30 days'
    and (
      status = 'completed'
      or (status = 'claimed' and expires_at > now())
    );

  v_requested := p_reserved_input_tokens::bigint + p_reserved_output_tokens::bigint;
  if v_used + v_requested > v_limit then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'MODEL_ALLOWANCE_EXHAUSTED',
      'plan_tier', v_tier,
      'limit', v_limit,
      'used', v_used,
      'requested', v_requested
    );
  end if;

  insert into public.model_call_allowances (
    user_id, route, reserved_input_tokens, reserved_output_tokens
  ) values (
    p_user_id, p_route, p_reserved_input_tokens, p_reserved_output_tokens
  ) returning * into v_claim;

  return jsonb_build_object(
    'ok', true,
    'allowance_id', v_claim.id,
    'plan_tier', v_tier,
    'remaining', greatest(0, v_limit - v_used - v_requested)
  );
end;
$$;

create or replace function public.settle_model_allowance(
  p_allowance_id uuid,
  p_user_id uuid,
  p_status text,
  p_actual_input_tokens integer default 0,
  p_actual_output_tokens integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated uuid;
begin
  if p_status not in ('completed', 'failed')
    or p_actual_input_tokens < 0
    or p_actual_output_tokens < 0 then
    return false;
  end if;

  update public.model_call_allowances
  set status = p_status,
      actual_input_tokens = p_actual_input_tokens,
      actual_output_tokens = p_actual_output_tokens,
      settled_at = now()
  where id = p_allowance_id
    and user_id = p_user_id
    and status = 'claimed'
  returning id into v_updated;

  return v_updated is not null;
end;
$$;

revoke all on public.model_allowance_limits, public.model_call_allowances from public, anon, authenticated;
grant all on public.model_allowance_limits, public.model_call_allowances to service_role;

revoke all on function public.claim_model_allowance(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.settle_model_allowance(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_model_allowance(uuid, text, integer, integer) to service_role;
grant execute on function public.settle_model_allowance(uuid, uuid, text, integer, integer) to service_role;
