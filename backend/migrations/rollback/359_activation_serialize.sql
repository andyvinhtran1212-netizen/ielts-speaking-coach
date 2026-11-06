-- Deploy the preceding backend before dropping its replacement activation RPC.
-- No user, redemption, enrollment, membership or audit data is changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.fn_activation_serialize(uuid, uuid, text, text, jsonb);
NOTIFY pgrst, 'reload schema';
COMMIT;
