create table if not exists public.exam_simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'generating' check (
    status in ('generating', 'generated', 'in_progress', 'submitted', 'marked', 'failed')
  ),
  source text not null default 'pattern_generated',
  confidence_at_creation integer,
  patterns_snapshot jsonb not null default '{}'::jsonb,
  exam_json jsonb,
  model text,
  prompt_version text,
  error text,
  started_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exam_simulations_user_created_idx
  on public.exam_simulations (user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_exam_simulations_updated_at on public.exam_simulations;
create trigger set_exam_simulations_updated_at
before update on public.exam_simulations
for each row
execute function public.set_updated_at();

alter table public.exam_simulations enable row level security;

drop policy if exists "Users can read their exam simulations" on public.exam_simulations;
create policy "Users can read their exam simulations"
on public.exam_simulations
for select
using (auth.uid() = user_id);

drop policy if exists "Users can create their exam simulations" on public.exam_simulations;
create policy "Users can create their exam simulations"
on public.exam_simulations
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their exam simulations" on public.exam_simulations;
create policy "Users can update their exam simulations"
on public.exam_simulations
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their exam simulations" on public.exam_simulations;
create policy "Users can delete their exam simulations"
on public.exam_simulations
for delete
using (auth.uid() = user_id);
