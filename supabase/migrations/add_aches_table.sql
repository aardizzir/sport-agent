-- Migration: add_aches_table
-- Tabla para registrar molestias físicas reportadas durante las conversaciones

create table if not exists public.aches (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  conversation_id uuid       references public.conversations(id) on delete set null,
  body_zone      text        not null,
  intensity      int         check (intensity >= 1 and intensity <= 10),
  description    text,
  reported_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- Índices
create index if not exists aches_user_id_idx
  on public.aches (user_id);

create index if not exists aches_user_reported_idx
  on public.aches (user_id, reported_at desc);

-- Row Level Security
alter table public.aches enable row level security;

create policy "aches_select_own"
  on public.aches for select
  using (auth.uid() = user_id);

create policy "aches_insert_own"
  on public.aches for insert
  with check (auth.uid() = user_id);

create policy "aches_update_own"
  on public.aches for update
  using (auth.uid() = user_id);

create policy "aches_delete_own"
  on public.aches for delete
  using (auth.uid() = user_id);
