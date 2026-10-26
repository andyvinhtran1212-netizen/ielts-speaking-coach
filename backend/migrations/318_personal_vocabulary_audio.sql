-- Persist prepared pronunciation without adding personal words to the shared bank.
BEGIN;
ALTER TABLE public.user_vocabulary
  ADD COLUMN IF NOT EXISTS audio_headword text NOT NULL DEFAULT '';
COMMENT ON COLUMN public.user_vocabulary.audio_headword IS
  'Prepared pronunciation for this headword; existing row ownership/RLS applies.';
COMMIT;
