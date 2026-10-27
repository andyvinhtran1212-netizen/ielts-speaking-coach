-- Migration: 325_access_codes_code_unique_canonical.sql
--
-- F07 / CODEUNIQ-0028 (specs/0028-access-code-unique-canonical). access_codes.code
-- uniqueness existed only outside the repo (dashboard: access_codes_code_key on
-- staging). Codify it and require the canonical form upper(btrim(code)) that
-- /auth/activate looks up, so the plain unique index is also unique for every
-- way a learner can type the code.
-- NO outer BEGIN: CREATE INDEX CONCURRENTLY cannot run in a transaction block
-- (the runner does not wrap files; see apply_migrations.sh).
-- No data change. Aborts on duplicates or non-canonical codes.

SET lock_timeout = '5s';

-- 1. Precheck (fail loud; dedupe is a reviewed manual step, see research.md §6).
DO $$
DECLARE
    v_exact BIGINT; v_norm BIGINT; v_noncanon BIGINT;
BEGIN
    SELECT count(*) INTO v_exact FROM (
        SELECT code FROM public.access_codes GROUP BY code HAVING count(*) > 1) x;
    SELECT count(*) INTO v_norm FROM (
        SELECT upper(btrim(code)) FROM public.access_codes GROUP BY 1 HAVING count(*) > 1) x;
    SELECT count(*) INTO v_noncanon FROM public.access_codes
     WHERE code <> upper(btrim(code)) OR btrim(code) = '';
    IF v_exact > 0 OR v_norm > 0 OR v_noncanon > 0 THEN
        RAISE EXCEPTION 'access_codes_code_not_unique_or_not_canonical'
            USING DETAIL = format('exact_dup_groups=%s normalized_dup_groups=%s non_canonical=%s',
                                  v_exact, v_norm, v_noncanon);
    END IF;
END $$;

-- 2. Unique index. No-op where access_codes_code_key already exists (staging).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS access_codes_code_key
    ON public.access_codes (code);

-- 3. A failed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS
--    would silently accept: refuse it. Then expose the index as a constraint.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_index i
                WHERE i.indexrelid = to_regclass('public.access_codes_code_key')
                  AND NOT i.indisvalid) THEN
        RAISE EXCEPTION 'access_codes_code_key_invalid'
            USING HINT = 'DROP INDEX CONCURRENTLY public.access_codes_code_key; then re-run 325.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.access_codes'::regclass
                      AND conname = 'access_codes_code_key' AND contype = 'u') THEN
        ALTER TABLE public.access_codes
            ADD CONSTRAINT access_codes_code_key UNIQUE USING INDEX access_codes_code_key;
    END IF;
END $$;

-- 4. Canonical form, in its own transaction.
BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.access_codes'::regclass
                      AND conname = 'chk_access_codes_code_canonical') THEN
        ALTER TABLE public.access_codes
            ADD CONSTRAINT chk_access_codes_code_canonical
            CHECK (code = upper(btrim(code)) AND code <> '') NOT VALID;
    END IF;
END $$;
ALTER TABLE public.access_codes VALIDATE CONSTRAINT chk_access_codes_code_canonical;

-- 5. Postcondition
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
         WHERE c.conrelid = 'public.access_codes'::regclass
           AND c.contype = 'u' AND c.conname = 'access_codes_code_key'
           AND i.indisvalid AND i.indisunique AND i.indnatts = 1
           AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                               WHERE attrelid = 'public.access_codes'::regclass AND attname = 'code')
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.access_codes'::regclass
           AND conname = 'chk_access_codes_code_canonical' AND convalidated
    ) THEN
        RAISE EXCEPTION 'access_codes_code_unique_postcondition_failed';
    END IF;
END $$;
COMMIT;

RESET lock_timeout;
