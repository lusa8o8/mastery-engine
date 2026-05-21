alter table public.exam_simulations
add column if not exists current_question_index integer not null default 0;

create table if not exists public.exam_simulation_answers (
  id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.exam_simulations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_index integer not null,
  question_number text,
  answer_text text not null default '',
  flagged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (simulation_id, question_index)
);

create index if not exists exam_simulation_answers_user_simulation_idx
  on public.exam_simulation_answers (user_id, simulation_id, question_index);

drop trigger if exists set_exam_simulation_answers_updated_at on public.exam_simulation_answers;
create trigger set_exam_simulation_answers_updated_at
before update on public.exam_simulation_answers
for each row
execute function public.set_updated_at();

alter table public.exam_simulation_answers enable row level security;

drop policy if exists "Users can read their exam answers" on public.exam_simulation_answers;
create policy "Users can read their exam answers"
on public.exam_simulation_answers
for select
using (auth.uid() = user_id);

drop policy if exists "Users can create their exam answers" on public.exam_simulation_answers;
create policy "Users can create their exam answers"
on public.exam_simulation_answers
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their exam answers" on public.exam_simulation_answers;
create policy "Users can update their exam answers"
on public.exam_simulation_answers
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their exam answers" on public.exam_simulation_answers;
create policy "Users can delete their exam answers"
on public.exam_simulation_answers
for delete
using (auth.uid() = user_id);
