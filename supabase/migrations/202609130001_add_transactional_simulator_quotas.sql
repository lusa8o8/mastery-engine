-- Make simulator quota decisions and their state change one server-owned action.

alter table public.exam_simulations
add column if not exists generation_requested_at timestamptz,
add column if not exists marking_requested_at timestamptz;

create or replace function public.claim_exam_generation(
  p_confidence_at_creation integer,
  p_patterns_snapshot jsonb,
  p_model text,
  p_prompt_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier text;
  v_stored_limit integer;
  v_generation_limit integer;
  v_stored_count integer;
  v_generation_count integer;
  v_simulation public.exam_simulations;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'AUTH_REQUIRED');
  end if;

  -- Serialize quota claims for this student so two tabs cannot race the count.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select coalesce(plan_tier, 'free')
  into v_tier
  from public.user_entitlements
  where user_id = v_user_id;
  v_tier := coalesce(v_tier, 'free');

  v_stored_limit := case v_tier when 'pro' then 20 when 'premium' then 5 else 1 end;
  v_generation_limit := case v_tier when 'pro' then 10 when 'premium' then 3 else 1 end;

  select count(*)
  into v_stored_count
  from public.exam_simulations
  where user_id = v_user_id
    and status in ('generated', 'in_progress', 'submitted', 'marking', 'marked', 'marking_failed');

  if v_stored_count >= v_stored_limit then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SIMULATOR_STORED_LIMIT',
      'limit', v_stored_limit,
      'plan_tier', v_tier
    );
  end if;

  select count(*)
  into v_generation_count
  from public.exam_simulations
  where user_id = v_user_id
    and created_at >= now() - interval '30 days'
    and status <> 'failed';

  if v_generation_count >= v_generation_limit then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SIMULATOR_GENERATION_LIMIT',
      'limit', v_generation_limit,
      'plan_tier', v_tier
    );
  end if;

  insert into public.exam_simulations (
    user_id,
    status,
    source,
    confidence_at_creation,
    patterns_snapshot,
    model,
    prompt_version
  )
  values (
    v_user_id,
    'generating',
    'pattern_generated',
    p_confidence_at_creation,
    coalesce(p_patterns_snapshot, '{}'::jsonb),
    p_model,
    p_prompt_version
  )
  returning * into v_simulation;

  return jsonb_build_object('ok', true, 'simulation', to_jsonb(v_simulation));
end;
$$;

create or replace function public.claim_exam_marking(
  p_simulation_id uuid,
  p_model text,
  p_prompt_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier text;
  v_marking_limit integer;
  v_marking_count integer;
  v_simulation public.exam_simulations;
  v_limit_message text;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'AUTH_REQUIRED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 1));

  select coalesce(plan_tier, 'free')
  into v_tier
  from public.user_entitlements
  where user_id = v_user_id;
  v_tier := coalesce(v_tier, 'free');
  v_marking_limit := case v_tier when 'pro' then 10 when 'premium' then 3 else 1 end;

  select count(*)
  into v_marking_count
  from public.exam_simulations
  where user_id = v_user_id
    and id <> p_simulation_id
    and submitted_at >= now() - interval '30 days'
    and (
      status in ('marking', 'marked')
      or (status = 'marking_failed' and marking_requested_at is not null)
    );

  if v_marking_count >= v_marking_limit then
    v_limit_message := 'Your plan''s 30-day marking limit has been reached. This attempt is saved, but Atlas will not mark it yet.';
    update public.exam_simulations
    set status = 'marking_failed',
        submitted_at = coalesce(submitted_at, now()),
        marking_model = p_model,
        marking_prompt_version = p_prompt_version,
        marking_error = v_limit_message
    where id = p_simulation_id
      and user_id = v_user_id
      and status in ('in_progress', 'submitted', 'marking_failed')
    returning * into v_simulation;

    if v_simulation.id is null then
      return jsonb_build_object('ok', false, 'error_code', 'SIMULATION_NOT_FOUND');
    end if;

    return jsonb_build_object(
      'ok', false,
      'error_code', 'SIMULATOR_MARKING_LIMIT',
      'limit', v_marking_limit,
      'plan_tier', v_tier,
      'simulation', to_jsonb(v_simulation)
    );
  end if;

  update public.exam_simulations
  set status = 'marking',
      submitted_at = coalesce(submitted_at, now()),
      marking_model = p_model,
      marking_prompt_version = p_prompt_version,
      marking_requested_at = null,
      marking_error = null
  where id = p_simulation_id
    and user_id = v_user_id
    and status in ('in_progress', 'submitted', 'marking_failed')
  returning * into v_simulation;

  if v_simulation.id is null then
    return jsonb_build_object('ok', false, 'error_code', 'SIMULATION_NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true, 'simulation', to_jsonb(v_simulation));
end;
$$;

revoke all on function public.claim_exam_generation(integer, jsonb, text, text) from public, anon;
revoke all on function public.claim_exam_marking(uuid, text, text) from public, anon;
grant execute on function public.claim_exam_generation(integer, jsonb, text, text) to authenticated, service_role;
grant execute on function public.claim_exam_marking(uuid, text, text) to authenticated, service_role;

-- New simulation rows must come through the quota transaction. Existing rows
-- remain editable only in the columns used by the current simulator UI.
drop policy if exists "Users can create their exam simulations" on public.exam_simulations;
revoke all on public.exam_simulations, public.exam_simulation_answers,
  public.exam_simulation_marking_results, public.user_entitlements from anon;
grant select, delete on public.exam_simulations to authenticated;
grant select, insert, update, delete on public.exam_simulation_answers,
  public.exam_simulation_marking_results to authenticated;
grant select on public.user_entitlements to authenticated;
grant all on public.exam_simulations, public.exam_simulation_answers,
  public.exam_simulation_marking_results, public.user_entitlements to service_role;
revoke insert, update on public.exam_simulations from authenticated;
grant update (
  status,
  exam_json,
  error,
  started_at,
  current_question_index,
  marked_at,
  marking_summary,
  marking_error
) on public.exam_simulations to authenticated;

-- Usage accounting is server-owned once every model boundary records usage.
drop policy if exists "Users can create their token logs" on public.token_logs;
revoke insert, update, delete on public.token_logs from authenticated;
