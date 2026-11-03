-- Down for mig 357 (PC-J365/1h1), SVCPRIV-0042 FR-009: intentionally a no-op.
--
-- 357 revoked CREATE on schema public from service_role, anon, authenticated
-- and PUBLIC. Granting it back reopens SA P2-SA-2 / SA-R4-3: an API role could
-- plant a pg_catalog-shadowing overload in public that owner-run SECURITY
-- DEFINER code and migration DO blocks then execute as the owner. No backend
-- path needs CREATE on public, so there is nothing to restore.
--
-- Changing this needs a new spec and a forward migration (the same rule as F5
-- for the down of 356). The FR-006 guard (backend/tests/test_public_schema_create_guard.py)
-- rejects GRANT CREATE/ALL ON SCHEMA public to these roles in migrations,
-- rollback/ and scripts.
DO $down$
BEGIN
    RAISE NOTICE 'mig357_down_noop: CREATE on schema public is not restored';
END $down$;
