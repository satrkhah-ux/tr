begin;
-- «تعليمات الإدارة لمُراد» and what Murad learns (the owner, 2026-10-24: «اضف مكان لاستلام التعليمات الادارية»،
-- «اريده ان يتعلم من كل المحادثات»). Read and written by the server only (service role): RLS on, no policies.
create table if not exists public.murad_instructions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('page', 'whatsapp')),
  phone text,
  author_id uuid references public.employees(id) on delete set null,
  text text not null,
  kind text not null check (kind in ('decision', 'lesson', 'train', 'undo', 'reset', 'unclear')),
  actions jsonb not null default '[]'::jsonb,
  status text not null default 'applied' check (status in ('applied', 'not_understood', 'undone', 'failed')),
  -- murad_control and the reception scope before and after, so «تراجع» puts them back
  before jsonb,
  after jsonb,
  reply text,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists murad_instructions_created on public.murad_instructions (created_at desc);
alter table public.murad_instructions enable row level security;

create table if not exists public.murad_lessons (
  id uuid primary key default gen_random_uuid(),
  -- teaching: the management's own words; conversation: read from a past conversation
  source text not null check (source in ('teaching', 'conversation')),
  kind text,
  question text,
  answer text not null,
  conversation_id bigint,
  instruction_id uuid references public.murad_instructions(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists murad_lessons_active on public.murad_lessons (active, source, created_at desc);
create index if not exists murad_lessons_conversation on public.murad_lessons (conversation_id);
alter table public.murad_lessons enable row level security;
commit;
