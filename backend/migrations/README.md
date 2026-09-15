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
sequence is dense. As of 2026-09-15 the highest is `264`, so the next new
migration is `265`.

## Conventions

- Idempotent where possible: `CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE`,
  and a no-op dedup step before adding a UNIQUE index (see
  `077_responses_unique_session_question.sql`, `124_questions_unique_session_part_order.sql`).
- Functions pin `SET search_path = public, pg_temp` (hardening — see 108/113).

## Forward policy and hosted ledger status (closed 2026-09-15)

The Next.js renderer migration is complete. The former ledger ambiguity is now
represented explicitly in `forward-policy.tsv` rather than being left for the
numeric directory scan to guess:

- `233` is a completed production-only recovery and is retired from replay;
- `234–239` are the independent Curated Vocabulary feature group. Staging has
  the group; production requires an explicit
  `MIGRATION_FEATURES=curated_vocab` release;
- `240–244` and `247–256` are retired Gate F evidence/admission experiments.
  Their runtime flags remain off and a normal forward run skips them;
- `245–246` and `257–262` are active Mock/correction/release migrations.

On 2026-09-15, production `233` and staging `245`, `246`, `257`, `259`, `260`
were fingerprinted against their durable postconditions and recorded under the
shared advisory lock without replaying schema or data DML. Migration `262`
repairs the importer drift discovered during that verification and is applied
normally to both environments.

`DRY_RUN=1` must list only genuinely active pending migrations. A retired or
pending-feature file is reported as `policy skip`; it is not silently treated as
an applied ledger row. Do not use `--baseline` to override this policy.

## Historical production ledger reconciliation (173–204)

The one-time production drift was reconciled and verified during the Next.js
migration. Its dedicated reconciler has been retired; do not replay or baseline
this historical range. Normal forward migrations continue through the shared
advisory-locked runner below. The completed audit remains in `docs/` as history,
not as an operational procedure.

## Historical staging Next.js ledger reconciliation (215–221)

Staging received the durable renderer-affinity contracts before their ledger
rows were consistently recorded. Do **not** replay the range or use
`--baseline`: migration 217's one-time backfill would now misclassify a fresh
claim-v1 Speaking session whose affinity is legitimately still `NULL`.

This reconciliation is complete. The commands below are retained only to
explain the historical evidence and must not be used as a general-purpose
forward runner:

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

## Historical production forward scope 213–225

Production applied this range through the standard locked forward runner.
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

Migration 225 is the forward-only correction for an admitted Speaking grading
request racing `finalize-full-test`: an unexpired response INSERT may finish
after its parent becomes `submitted`, while the router continues to reject any
new request that starts after submission. This prevents a valid in-flight grade
from being dropped and later misclassified as `analysis_failed`.

```bash
ALLOW_PROD=1 DRY_RUN=1 ./backend/scripts/apply_migrations.sh "$DATABASE_URL"
ALLOW_PROD=1 ./backend/scripts/apply_migrations.sh "$DATABASE_URL"
python backend/scripts/verify_prod_nextjs_migrations.py "$DATABASE_URL"
```

The verifier refuses every database except the pinned production Supabase
project and executes `verify_prod_nextjs_migrations_213_225.sql` inside a
read-only transaction. It proves the exact 213–225 ledger range, Mock
collection columns/constraints, affinity functions/tables/policies/triggers,
pronunciation table fingerprints, RLS/table grants and the TTL/lease contract.

## Historical forward scope 226–229

Migrations 226–229 were originally authored on `main` with prefixes 216–219
while the long-lived Next.js staging branch already owned those numbers for
renderer affinity. The integration branch renumbered them forward instead of
creating two meanings for one ledger row:

- 226 stores canonical multi-section course results;
- 227 adds the normalized multi-class membership source of truth;
- 228 restores idempotent individual Writing assignment creation after 227;
- 229 codifies the quiz RPC and Writing view hardening already present on the
  hosted databases.

All four were applied through the normal advisory-locked forward runner. They are
additive or idempotent so a hosted database that already has some durable
effects outside the ledger converges safely and records the unambiguous new
prefixes.

## Forward scope 230–264

- 230 versions writing drafts/submissions, reading/listening results and
  pronunciation grading by the canonical full-course attempt. Existing rows
  are attached to their current run without deleting history; a later full
  retry can therefore submit every required section again.
- 231 snapshots the hybrid question-count weights onto legacy course
  assignments that predate weight snapshots. This keeps the denominator tied
  to sections that actually exist and prevents later bank edits from changing
  an assignment under learners' feet.

Migrations 230–232 preserve full-course attempt history and reconcile legacy
course weights. Migration 233 is the one data-scoped exception described
above. Migrations 234–239 add optional curated vocabulary; 240–244 add optional
core attempt evidence; 245–246 add the active Mock/Cambridge correction
foundation; 247–256 add optional core admission and Writing provenance; and
257–261 add active correction persistence, public visibility and atomic
assignment/explanation policy contracts.

Migration 262 restores the structured Cambridge 15 Test 4 Reading Q07
explanation after the canonical importer had overwritten migration 246's richer
tips and removed its trap analysis. The importer and migration now share the
same canonical payload.

Migration 263 atomically anchors the per-student timer and creates the first
quiz session before a timed Course bank releases its answer-bearing questions.
It prevents both pre-start question exposure and a half-started timer with no
session available for canonical timeout submission.

Migration 264 closes the remaining authorization race by locking and rechecking
the published assignment, release/deadline window, and canonical active cohort
membership inside that same start transaction.

Apply any genuinely pending active file only through the advisory-locked
forward runner. Do not run a data-deleting reset or use `--baseline` to silence
hosted drift. A pending feature group requires its explicit
`MIGRATION_FEATURES` opt-in after staging validation.
