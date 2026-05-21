-- Migration: 070_listening_map_image_payload.sql
-- Sprint 13.5.6 — map image generation for plan-label exercises.
--
-- No DDL change. The exercise's structural payload is JSONB so the new
-- map_image_* fields land alongside the existing variant/options/etc.
-- without a schema migration. This file is purely documentary so the
-- forward-only migration chain captures the new payload contract.
--
-- Expected payload structure (for variant = "mcq_letter_label"):
--
--   payload.variant                 = "mcq_letter_label"
--   payload.template_kind           = "plan_label"
--   payload.metadata.map_description       (parser-emitted text)
--   payload.metadata.letter_options        (list[str], A-H by default)
--   payload.questions               (list[{q_num, prompt, options}])
--   payload.map_image_storage_path  (Supabase Storage path, set by admin)
--   payload.map_image_size_bytes    (int, set by admin)
--   payload.map_image_model         ("imagen-4.0-fast-generate-001" | …)
--   payload.map_image_prompt        (Cambridge-style prompt sent to API)
--   payload.map_image_generated_at  (ISO-8601 UTC timestamp)
--
-- Storage bucket (created in the Supabase dashboard, NOT via migration):
--   * Name:    listening-images
--   * Private: yes (admin write + authenticated read policy)
--   * Path:    tests/<test_uuid>/maps/<exercise_uuid>.png

COMMENT ON COLUMN listening_exercises.payload IS
    'JSONB structural payload. Schema depends on variant: '
    'mcq_3option carries questions[{q_num, prompt, options}]; '
    'mcq_letter_label (plan_label) carries questions[] + metadata '
    '{map_description, letter_options}; Sprint 13.5.6 plan-label '
    'exercises may also carry map_image_{storage_path, size_bytes, '
    'model, prompt, generated_at} when an admin has generated a '
    'Cambridge-style floor-plan image via Imagen/Gemini.';
