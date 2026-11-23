-- Migration: add_daily_summaries_table (ANATA Personal · Fase 2)
-- Resumen "Tu cuerpo hoy" que genera el cron cada mañana (mode daily_summary).
-- El Worker escribe con la service role key; la app lee con RLS.

create table if not exists public.daily_summaries (
  user_id             uuid        not null references auth.users(id) on delete cascade,
  date                date        not null,
  headline            text        not null,
  summary_text        text        not null,             -- líneas unidas con salto de línea
  lines               jsonb,                            -- las 3-5 líneas por separado
  color               text        check (color in ('go','caution','stop')), -- null = sin datos
  calibrating_metrics text[]      not null default '{}',
  flags               text[]      not null default '{}', -- reglas de ANATA activas
  status              text        not null default 'ok' check (status in ('ok','no_data')),
  verdict_id          uuid        references public.verdicts(id) on delete set null,
  data_signature      text,                             -- para no regenerar si no cambió nada
  model               text,
  prompt_version      text,
  word_count          int,
  created_at          timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.daily_summaries enable row level security;

create policy "daily_summaries_select_own"
  on public.daily_summaries for select
  using (auth.uid() = user_id);

create policy "daily_summaries_update_own"
  on public.daily_summaries for update
  using (auth.uid() = user_id);
