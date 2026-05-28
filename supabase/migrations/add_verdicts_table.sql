-- Migration: add_verdicts_table
-- Tabla para persistir los veredictos generados por ANATA al final de cada conversación

create table if not exists public.verdicts (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  conversation_id uuid        references public.conversations(id) on delete set null,
  recommendation  text,
  load_level      text,
  rest_days       int         not null default 0,
  raw_json        jsonb,
  created_at      timestamptz not null default now()
);

-- Índices
create index if not exists verdicts_user_id_idx
  on public.verdicts (user_id);

create index if not exists verdicts_user_created_idx
  on public.verdicts (user_id, created_at desc);

-- Row Level Security
alter table public.verdicts enable row level security;

create policy "verdicts_select_own"
  on public.verdicts for select
  using (auth.uid() = user_id);

create policy "verdicts_insert_own"
  on public.verdicts for insert
  with check (auth.uid() = user_id);
