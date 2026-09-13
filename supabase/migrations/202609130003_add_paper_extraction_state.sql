-- Give extraction a durable, retry-safe state instead of inferring completion.

alter table public.papers
add column if not exists extraction_status text not null default 'pending',
add column if not exists extraction_error text,
add column if not exists extraction_started_at timestamptz,
add column if not exists extraction_completed_at timestamptz;

alter table public.papers
drop constraint if exists papers_extraction_status_check;

alter table public.papers
add constraint papers_extraction_status_check
check (extraction_status in ('pending', 'processing', 'completed', 'failed'));

-- Existing papers with extracted questions are already complete.
update public.papers as paper
set extraction_status = 'completed',
    extraction_completed_at = coalesce(extraction_completed_at, now()),
    extraction_error = null
where exists (
  select 1 from public.questions where questions.paper_id = paper.id
);

create index if not exists papers_user_extraction_status_idx
on public.papers (user_id, extraction_status, uploaded_at desc);

create or replace function public.claim_paper_extraction(
  p_paper_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paper public.papers;
begin
  select *
  into v_paper
  from public.papers
  where id = p_paper_id and user_id = p_user_id
  for update;

  if v_paper.id is null then return 'not_found'; end if;
  if v_paper.extraction_status = 'completed' then return 'completed'; end if;
  if v_paper.extraction_status = 'processing'
     and v_paper.extraction_started_at > now() - interval '15 minutes' then
    return 'busy';
  end if;

  update public.papers
  set extraction_status = 'processing',
      extraction_error = null,
      extraction_started_at = now()
  where id = p_paper_id and user_id = p_user_id;

  return 'claimed';
end;
$$;

create or replace function public.complete_paper_extraction(
  p_paper_id uuid,
  p_user_id uuid,
  p_questions jsonb,
  p_metadata jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'Extraction must contain at least one question.';
  end if;

  if not exists (
    select 1
    from public.papers
    where id = p_paper_id
      and user_id = p_user_id
      and extraction_status = 'processing'
  ) then
    raise exception 'Paper is not in a claimable extraction state.';
  end if;

  -- Replacement and state transition are one transaction, making retries safe.
  delete from public.questions where paper_id = p_paper_id;

  insert into public.questions (
    paper_id,
    user_id,
    raw_text,
    topic,
    sub_type,
    source,
    difficulty_hint,
    section,
    question_number,
    marks
  )
  select
    p_paper_id,
    p_user_id,
    question.raw_text,
    question.topic,
    question.sub_type,
    'extracted',
    question.difficulty_hint,
    question.section,
    question.question_number,
    question.marks
  from jsonb_to_recordset(p_questions) as question(
    raw_text text,
    topic text,
    sub_type text,
    difficulty_hint text,
    section text,
    question_number text,
    marks integer
  );

  get diagnostics v_count = row_count;

  update public.papers
  set instructions = case
        when p_metadata is null then instructions
        else array(select jsonb_array_elements_text(coalesce(p_metadata->'instructions', '[]'::jsonb)))
      end,
      time_minutes = case when p_metadata is null then time_minutes else (p_metadata->>'time_minutes')::integer end,
      total_questions = case when p_metadata is null then total_questions else (p_metadata->>'total_questions')::integer end,
      attempt_questions = case when p_metadata is null then attempt_questions else (p_metadata->>'attempt_questions')::integer end,
      calculators_allowed = case when p_metadata is null then calculators_allowed else (p_metadata->>'calculators_allowed')::boolean end,
      extraction_status = 'completed',
      extraction_error = null,
      extraction_completed_at = now()
  where id = p_paper_id and user_id = p_user_id;

  return v_count;
end;
$$;

revoke all on function public.claim_paper_extraction(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.claim_paper_extraction(uuid, uuid)
to service_role;
revoke all on function public.complete_paper_extraction(uuid, uuid, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_paper_extraction(uuid, uuid, jsonb, jsonb)
to service_role;
