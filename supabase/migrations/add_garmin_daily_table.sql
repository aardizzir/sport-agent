-- Migration: add_garmin_daily_table (ANATA Personal · Fase 1)
-- Una fila por día con las métricas de la Garmin CIRQA (Personal API oficial).
-- El Worker escribe con la service role key (cron 06:30 Santiago); la app lee con RLS.
--
-- Ajustes frente al doc, según el descubrimiento de la API (spec oficial):
--  * training_readiness: la Personal API NO lo entrega. Queda la columna para el
--    Plan B (captura de pantalla) y el Plan C (manual).
--  * acute_load / load_ratio: la API NO entrega el ratio de Garmin. ANATA los calcula
--    con la "carga de entrenamiento" (activityTrainingLoad) de cada actividad.
--  * Temperatura de la piel: la API no la entrega → sin columna.
--  * Nuevas: body_battery_max, body_battery_sleep_charge, sleep_quality,
--    resting_hr_7d_avg, hrv_weekly_avg_ms, training_load, spo2_avg, steps.

create table if not exists public.garmin_daily (
  user_id                   uuid        not null references auth.users(id) on delete cascade,
  date                      date        not null,
  body_battery_wake         int,          -- batería al despertar
  body_battery_min          int,
  body_battery_max          int,
  body_battery_sleep_charge int,          -- cuánto cargó durmiendo
  sleep_score               int,          -- 0-100
  sleep_quality             text,         -- excellent | good | fair | poor
  sleep_minutes             int,
  stress_avg                int,          -- 0-100
  resting_hr                int,
  resting_hr_7d_avg         int,          -- promedio 7 días que calcula Garmin
  hrv_last_night_ms         int,
  hrv_weekly_avg_ms         int,
  hrv_status                text,         -- balanced | unbalanced | low | poor | none
  training_readiness        int,          -- null por API; llega por captura/manual
  training_load             int,          -- carga de las actividades de ese día
  acute_load                int,          -- suma 7 días (calculada por ANATA)
  load_ratio                numeric,      -- aguda / crónica 28d (calculada por ANATA)
  vo2max                    numeric,
  spo2_avg                  numeric,
  steps                     int,
  feeling                   int check (feeling between 1 and 5), -- Plan C manual
  source                    text        not null default 'api' check (source in ('api','screenshot','manual')),
  raw_json                  jsonb,        -- respuestas completas, para descubrir campos
  fetched_at                timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists garmin_daily_user_date_idx
  on public.garmin_daily (user_id, date desc);

alter table public.garmin_daily enable row level security;

create policy "garmin_daily_select_own"
  on public.garmin_daily for select
  using (auth.uid() = user_id);

create policy "garmin_daily_insert_own"
  on public.garmin_daily for insert
  with check (auth.uid() = user_id);

create policy "garmin_daily_update_own"
  on public.garmin_daily for update
  using (auth.uid() = user_id);

-- Registro de cada sincronización (para saber si el cron corrió y qué faltó).
create table if not exists public.garmin_sync_runs (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  ran_at          timestamptz not null default now(),
  trigger         text,                  -- cron-6h | cron-9h | manual
  ok              boolean     not null,
  dates           date[],
  missing_metrics text[],
  error           text,
  duration_ms     int
);

create index if not exists garmin_sync_runs_user_idx
  on public.garmin_sync_runs (user_id, ran_at desc);

alter table public.garmin_sync_runs enable row level security;

create policy "garmin_sync_runs_select_own"
  on public.garmin_sync_runs for select
  using (auth.uid() = user_id);
