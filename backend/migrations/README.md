# Migrations

Forward-only SQL migrations, applied in numeric order. Each file is named
`NNN_short_description.sql`. New migrations take the next unused number.

## Numbering quirks (read before auto-numbering a new migration)

The sequence is **not** perfectly contiguous. These gaps/suffixes are intentional
and must not be "filled in" by tooling:

- **091 and 092 do not exist.** The sequence jumps `090_reading_anon_attempts.sql`
  → `093_add_sessions_tokens_used.sql`. Numbers were reserved and dropped; do not
  reuse 091/092 — always take the next number **above the current max**.
- **Suffix numbers are deliberate variants**, not duplicates:
  `019/019b`, `022/022b`, `032/032_rollback`.
- **`032_rollback.sql` is a ROLLBACK**, not a forward migration. It lives here for
  colocation with `032_*`, but it reverses that change — do not apply it as part of
  a normal forward run, and ignore it when computing the next number.

## Finding the next number

Take the max numeric prefix across `*.sql` and add 1 — do **not** assume the
sequence is dense. As of 2026-08-20 the highest is `224`, so the next new
migration is `225`.

## Conventions

- Idempotent where possible: `CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE`,
  and a no-op dedup step before adding a UNIQUE index (see
  `077_responses_unique_session_question.sql`, `124_questions_unique_session_part_order.sql`).
- Functions pin `SET search_path = public, pg_temp` (hardening — see 108/113).

## Production Gate E ledger reconciliation (173–204 only)

Production was audited with the durable effects of a specific subset of
173–202 already present outside `_schema_migrations`, while 197, 199 and 203
were recorded normally. Do **not** use `--baseline` and do not run the standard
forward loop against that drifted ledger: it would replay superseded history
before reaching the repair.

Use the dedicated fail-closed procedure instead:

```bash
# Read-only plan first.
DRY_RUN=1 python backend/scripts/reconcile_prod_gate_e_migrations.py "$DATABASE_URL"

# Explicit production authorization after reviewing the plan.
ALLOW_PROD=1 python backend/scripts/reconcile_prod_gate_e_migrations.py "$DATABASE_URL"
```

The procedure has a fixed audited manifest; it applies migration 204 first,
runs `verify_prod_gate_e_reconcile.sql`, records only the audited missing rows,
and then invokes the normal runner in dry-run mode. It refuses to finish if any
file in 173–204 would still replay. A second invocation is a read-only no-op.
The reconciler and `apply_migrations.sh` share a PostgreSQL advisory lock;
the forward runner re-checks every previously missing ledger row after it owns
that lock, so a stale pre-lock snapshot cannot replay reconciled history.

## Staging Next.js ledger reconciliation (215–221 only)

Staging received the durable renderer-affinity contracts before their ledger
rows were consistently recorded. Do **not** replay the range or use
`--baseline`: migration 217's one-time backfill would now misclassify a fresh
claim-v1 Speaking session whose affinity is legitimately still `NULL`.

Use the staging-pinned, fail-closed procedure instead:

```bash
# Read-only contract verification and exact ledger plan.
DRY_RUN=1 python backend/scripts/reconcile_staging_nextjs_migrations.py "$DATABASE_URL"

# Record only the six audited missing rows after locked verification.
python backend/scripts/reconcile_staging_nextjs_migrations.py "$DATABASE_URL"
```

The procedure refuses every database except the pinned staging project,
requires migrations 205–214 and 219 to already exist in the ledger, verifies
the final 215–221 schema/function/ACL/RLS/trigger contracts, and records only
215–218 plus 220–221. It shares the forward runner's advisory lock and finishes
with the standard migration dry-run; no migration in 215–221 may remain pending.

## Production forward scope 213–224

Production applies this range only through the standard locked forward runner.
Migration 222 is safe to encounter when its two tables already exist outside
the ledger: its table/index/RLS statements are idempotent, and the production
verifier pins the complete table fingerprints. Migration 223 must still revoke
all direct client table grants and preserve full `service_role` access.
Migration 224 adds the hard 24-hour active-player resume TTL and the reclaimable
Writing renderer lease. Database guards cover Speaking question/response
writes, Reading/Dictation answer rows, Listening answer RPCs and Writing draft
writes so N-1 application instances cannot bypass expiry. Parent status
triggers additionally reject expired open -> terminal transitions for
Speaking, Reading and Listening plus expired Writing learner finalization that
links an essay, closing the N-1 direct-finalizer path while preserving the
admin Writing status override. Dictation completion reports have a DB guard ordered before the
migration-220 finalizer, so an expired report cannot complete its parent
indirectly. The retention worker must
transition a TTL-expired open Speaking session to `abandoned` before it scrubs
response content. Current Reading, Listening, Dictation, Speaking and Writing
finalizers also bind the expiry/lease predicate to their terminal mutation,
closing the request-straddles-deadline race without blocking admin repair of
terminal records. The postcondition verifier checks columns, bounded
constraints, indexes, pre/post-224 function fingerprints, security/ACLs,
triggers and live data.

```bash
ALLOW_PROD=1 DRY_RUN=1 ./backend/scripts/apply_migrations.sh "$DATABASE_URL"
ALLOW_PROD=1 ./backend/scripts/apply_migrations.sh "$DATABASE_URL"
python backend/scripts/verify_prod_nextjs_migrations.py "$DATABASE_URL"
```

The verifier refuses every database except the pinned production Supabase
project and executes `verify_prod_nextjs_migrations_213_224.sql` inside a
read-only transaction. It proves the exact 213–224 ledger range, Mock
collection columns/constraints, affinity functions/tables/policies/triggers,
pronunciation table fingerprints, RLS/table grants and the TTL/lease contract.
