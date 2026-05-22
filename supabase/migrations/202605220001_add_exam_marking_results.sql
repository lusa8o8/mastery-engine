alter table public.exam_simulations
drop constraint if exists exam_simulations_status_check;

alter table public.exam_simulations
add constraint exam_simulations_status_check check (
  status in ('generating', 'generated', 'in_progress', 'submitted', 'marking', 'marked', 'marking_failed', 'failed')
);

alter table public.exam_simulations
add column if not exists marked_at timestamptz,
add column if not exists marking_model text,
add column if not exists marking_prompt_version text,
add column if not exists marking_summary jsonb not null default '{}'::jsonb,
add column if not exists marking_error text;

create table if not exists public.exam_simulation_marking_results (
  id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.exam_simulations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_index integer not null,
  question_number text,
  topic text,
  sub_topic text,
  marks_awarded numeric,
  marks_available numeric,
  correctness text not null default 'not_markable' check (
    correctness in ('correct', 'partially_correct', 'incorrect', 'not_markable')
  ),
  error_type text not null default 'not_markable' check (
    error_type in (
      'none',
      'concept_gap',
      'method_gap',
      'algebra_error',
      'notation_error',
      'incomplete_answer',
      'misread_question',
      'time_pressure',
      'exam_technique',
      'not_markable'
    )
  ),
  confidence numeric,
  feedback_summary text,
  lost_mark_reasons jsonb not null default '[]'::jsonb,
  recommended_mastery_topics jsonb not null default '[]'::jsonb,
  raw_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (simulation_id, question_index)
);

create index if not exists exam_simulation_marking_results_user_simulation_idx
  on public.exam_simulation_marking_results (user_id, simulation_id, question_index);

drop trigger if exists set_exam_simulation_marking_results_updated_at on public.exam_simulation_marking_results;
create trigger set_exam_simulation_marking_results_updated_at
before update on public.exam_simulation_marking_results
for each row
execute function public.set_updated_at();

alter table public.exam_simulation_marking_results enable row level security;

drop policy if exists "Users can read their exam marking results" on public.exam_simulation_marking_results;
create policy "Users can read their exam marking results"
on public.exam_simulation_marking_results
for select
using (auth.uid() = user_id);

drop policy if exists "Users can create their exam marking results" on public.exam_simulation_marking_results;
create policy "Users can create their exam marking results"
on public.exam_simulation_marking_results
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their exam marking results" on public.exam_simulation_marking_results;
create policy "Users can update their exam marking results"
on public.exam_simulation_marking_results
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their exam marking results" on public.exam_simulation_marking_results;
create policy "Users can delete their exam marking results"
on public.exam_simulation_marking_results
for delete
using (auth.uid() = user_id);
