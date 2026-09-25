-- LISTENING-0007: operator-controlled, package-specific v1.0 start drain.
-- A drain blocks INSERT only. Existing attempt resume, answer save and submit
-- remain available until the 24-hour attempt window closes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.listening_programme_start_drain_gates (
    package_id TEXT PRIMARY KEY,
    draining BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO public.listening_programme_start_drain_gates (package_id)
VALUES ('general-listening-practice-v1.0.0'),
       ('ielts-listening-practice-v1.0.0')
ON CONFLICT (package_id) DO NOTHING;

ALTER TABLE public.listening_programme_start_drain_gates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listening_programme_start_drain_gates
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_listening_programme_start_drain()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_package_id TEXT;
    v_draining BOOLEAN;
BEGIN
    SELECT package.package_id INTO v_package_id
      FROM public.listening_tests AS test
      JOIN public.listening_content_packages AS package
        ON package.id = test.content_package_id
     WHERE test.id = NEW.test_id;

    IF v_package_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- FOR SHARE conflicts with the operator's UPDATE of this gate row.
    -- Consequently every committed INSERT is ordered before activation or
    -- observes draining=true; a zero-live-attempt count is not racy.
    SELECT gate.draining INTO v_draining
      FROM public.listening_programme_start_drain_gates AS gate
     WHERE gate.package_id = v_package_id
     FOR SHARE;

    IF v_draining IS TRUE THEN
        RAISE EXCEPTION 'listening_programme_new_starts_paused'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guard_listening_programme_start_drain()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_listening_programme_start_drain
    ON public.listening_test_attempts;
CREATE TRIGGER trg_guard_listening_programme_start_drain
    BEFORE INSERT ON public.listening_test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_listening_programme_start_drain();

COMMENT ON TABLE public.listening_programme_start_drain_gates IS
'Operator-only package-specific gate. Activate v1.0 rows only after release approval; never changes existing attempts.';
COMMENT ON FUNCTION public.fn_guard_listening_programme_start_drain() IS
'Rejects new attempts for a draining Listening package while preserving updates and resumes of existing attempts.';

COMMIT;
