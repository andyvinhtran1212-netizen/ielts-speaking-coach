-- Migration: 207_writing_student_submit_idempotency.sql
-- Mô tả: bind one student-side Writing submit request UUID and exact essay
-- payload hash to the canonical assignment. This lets either frontend stack
-- reconcile an ambiguous POST response without creating another essay/job.

ALTER TABLE writing_assignments
    ADD COLUMN IF NOT EXISTS student_submit_request_id UUID,
    ADD COLUMN IF NOT EXISTS student_submit_text_sha256 TEXT;

-- A partially applied/manual predecessor could have left only one value.
-- Normalize that impossible receipt before adding the pair invariant; no
-- production behavior consumed these columns before this migration.
UPDATE writing_assignments
   SET student_submit_request_id = NULL,
       student_submit_text_sha256 = NULL
 WHERE (student_submit_request_id IS NULL)
    <> (student_submit_text_sha256 IS NULL);

DO $$
BEGIN
    ALTER TABLE writing_assignments
        ADD CONSTRAINT writing_assignments_student_submit_pair_check
        CHECK (
            (student_submit_request_id IS NULL AND student_submit_text_sha256 IS NULL)
            OR
            (student_submit_request_id IS NOT NULL
             AND student_submit_text_sha256 ~ '^[0-9a-f]{64}$')
        );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_writing_assignments_student_submit_request
    ON writing_assignments(student_submit_request_id)
    WHERE student_submit_request_id IS NOT NULL;

COMMENT ON COLUMN writing_assignments.student_submit_request_id IS
    'Client UUID for the one canonical student submission; used for safe replay/readback after an ambiguous response.';
COMMENT ON COLUMN writing_assignments.student_submit_text_sha256 IS
    'SHA-256 of the normalized essay text bound to student_submit_request_id; rejects request-id reuse with different content.';
