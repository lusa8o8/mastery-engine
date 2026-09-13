-- Persist the exact source question currently assigned by Atlas.

alter table public.sessions
add column if not exists current_question_id uuid
references public.questions(id) on delete set null;

create index if not exists sessions_current_question_idx
on public.sessions (current_question_id);
