-- Migration: add_patterns_table (Sesión 05)
-- Patrones longitudinales detectados por ANATA a partir de aches y verdicts.
-- El Worker lee/escribe esta tabla en cada request (detectAndUpdatePatterns).
--
-- NOTA sobre `pattern_key`: no estaba en el diseño original de la sesión, pero
-- es necesario para hacer upserts idempotentes desde el Worker vía PostgREST
-- (no podemos correr GROUP BY/HAVING server-side, así que agregamos en JS y
-- escribimos un row por patrón). `pattern_key` identifica el patrón dentro de
-- su (user_id, type):
--   recurring_ache -> body_zone normalizado (ej. "isquiotibial izquierdo")
--   fatigue_day    -> "dow-<0..6>" (0 = domingo)

create table if not exists public.patterns (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  type         text        not null,
  -- 'recurring_ache' | 'fatigue_day' | 'discipline_correlation' |
  -- 'sleep_impact' | 'recovery_pattern'
  pattern_key  text        not null default '',
  description  text        not null,
  body_zone    text,
  discipline   text,
  occurrences  int         not null default 1,
  confidence   text        not null default 'low', -- 'low' | 'medium' | 'high'
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, type, pattern_key)
);

create index if not exists patterns_user_active_idx
  on public.patterns (user_id, is_active);

-- Row Level Security: cada usuario solo ve/edita sus propios patrones.
alter table public.patterns enable row level security;

create policy "patterns_all_own"
  on public.patterns for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
