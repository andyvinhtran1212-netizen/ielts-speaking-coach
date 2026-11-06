-- Down for mig 364 (PC-J544), SVCPRIV-0042 FR-001..FR-008: intentionally a no-op.
--
-- 364 revoked TRIGGER, REFERENCES, TRUNCATE and (PG 17) MAINTAIN on every
-- public relation and in the table default ACLs from service_role, anon,
-- authenticated and PUBLIC. Granting them back reopens SA P2-SA-1 on every
-- table: an API role could plant a trigger that owner-run code, FK actions
-- and SECURITY DEFINER RPCs then execute as the owner. No backend path needs
-- any of the four, so there is nothing to restore.
--
-- If a confirmed incident shows a legitimate path refused with 42501, re-grant
-- only that privilege on that table to service_role through a new forward
-- migration under a spec revision (rollout.md, Rollback and repair). The FR-006
-- guard (backend/tests/test_service_role_table_privilege_guard.py) rejects a
-- re-grant in later migrations, in every rollback file and in the scripts.
DO $down$
BEGIN
    RAISE NOTICE 'mig364_down_noop: table maintenance privileges are not restored';
END $down$;
