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
sequence is dense. As of 2026-08-18 the highest is `221`, so the next new
migration is `222`.

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
