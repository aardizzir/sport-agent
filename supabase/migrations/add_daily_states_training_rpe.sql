-- Migration: add_daily_states_training_rpe (ANATA Personal · Fase 4)
-- "Después de entrenar: ¿Qué tan duro fue? 1-10" (esfuerzo percibido).
alter table public.daily_states
  add column if not exists training_rpe int check (training_rpe between 1 and 10);
