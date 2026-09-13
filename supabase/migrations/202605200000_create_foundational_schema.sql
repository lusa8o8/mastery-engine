-- S1 foundation baseline.
--
-- This migration intentionally sorts before the existing exam migrations so a
-- clean Supabase project can replay the full history. Every table operation is
-- additive because these legacy tables already exist in the linked project.

create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  file_url text not null,
  file_type text check (file_type in ('pdf', 'image')),
  uploaded_at timestamptz default now(),
  name text,
  assessment_type text,
  instructions text[],
  time_minutes integer,
  total_questions integer,
  attempt_questions integer,
  calculators_allowed boolean
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid references public.papers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  raw_text text not null,
  topic text,
  sub_type text,
  source text check (source in ('extracted', 'ai_generated')),
  difficulty_hint text,
  created_at timestamptz default now(),
  section text,
  question_number text,
  marks integer
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  topic text not null,
  current_layer text default 'foundation',
  created_at timestamptz default now(),
  sub_type text,
  summary text,
  last_active_at timestamptz
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete cascade,
  role text not null,
  content text not null,
  viz jsonb,
  created_at timestamptz default now()
);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete cascade,
  question_id uuid references public.questions(id),
  layer text not null,
  user_answer text,
  is_correct boolean,
  error_type text check (
    error_type in (
      'conceptual_gap',
      'trap_failure',
      'careless',
      'time_pressure',
      'recall_failure'
    )
  ),
  created_at timestamptz default now()
);

create table if not exists public.token_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete cascade,
  input_tokens integer not null,
  output_tokens integer not null,
  model text not null,
  context text,
  created_at timestamptz default now()
);

-- Browser access must always be constrained to the authenticated principal.
alter table public.papers enable row level security;
alter table public.questions enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.attempts enable row level security;
alter table public.token_logs enable row level security;

drop policy if exists "Users own their papers" on public.papers;
create policy "Users own their papers"
on public.papers
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users own their questions" on public.questions;
create policy "Users own their questions"
on public.questions
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users own their sessions" on public.sessions;
create policy "Users own their sessions"
on public.sessions
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users own their messages" on public.messages;
create policy "Users own their messages"
on public.messages
for all
to authenticated
using (
  exists (
    select 1
    from public.sessions
    where sessions.id = messages.session_id
      and sessions.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.sessions
    where sessions.id = messages.session_id
      and sessions.user_id = (select auth.uid())
  )
);

drop policy if exists "Users own their attempts" on public.attempts;
create policy "Users own their attempts"
on public.attempts
for all
to authenticated
using (
  exists (
    select 1
    from public.sessions
    where sessions.id = attempts.session_id
      and sessions.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.sessions
    where sessions.id = attempts.session_id
      and sessions.user_id = (select auth.uid())
  )
);

-- Students may see their own usage and preserve the prototype's client-side
-- logging for now. They cannot alter or delete usage already recorded.
drop policy if exists "Users own their token logs" on public.token_logs;
drop policy if exists "Users can read their token logs" on public.token_logs;
drop policy if exists "Users can create their token logs" on public.token_logs;
create policy "Users can read their token logs"
on public.token_logs
for select
to authenticated
using ((select auth.uid()) = user_id);
create policy "Users can create their token logs"
on public.token_logs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

-- Explicit grants keep the baseline reproducible instead of relying on remote
-- default privileges. The service role remains the trusted server writer.
revoke all on public.papers, public.questions, public.sessions,
  public.messages, public.attempts, public.token_logs from anon;
grant select, insert, update, delete on public.papers, public.questions,
  public.sessions, public.messages, public.attempts to authenticated;
grant select, insert on public.token_logs to authenticated;
grant all on public.papers, public.questions, public.sessions,
  public.messages, public.attempts, public.token_logs to service_role;

-- The object key contract is `<authenticated user UUID>/<generated filename>`.
-- Enforce the same size/type envelope at Storage as the upload UI.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'papers',
  'papers',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated read 1ikfdyf_0" on storage.objects;
drop policy if exists "authenticated upload 1ikfdyf_0" on storage.objects;
drop policy if exists "Users own their paper files" on storage.objects;
drop policy if exists "Users can upload their paper files" on storage.objects;
drop policy if exists "Users can update their paper files" on storage.objects;
drop policy if exists "Users can delete their paper files" on storage.objects;

create policy "Users own their paper files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'papers'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

create policy "Users can upload their paper files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'papers'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

create policy "Users can update their paper files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'papers'
  and split_part(name, '/', 1) = (select auth.uid())::text
)
with check (
  bucket_id = 'papers'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

create policy "Users can delete their paper files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'papers'
  and split_part(name, '/', 1) = (select auth.uid())::text
);
