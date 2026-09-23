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
sequence is dense. As of 2026-09-23 the highest is `296`, so the next new
migration is `297`.

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

## Forward scope 230–294

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

Migrations 265–268 make timed progress/finalization and Course assessment bank
replacement transactional and history-safe. Migration 269 gives assignment
creation and bank replacement the same bank-row lock, then verifies an exact
preflight revision before persisting the assignment's shape snapshot.
Migration 270 extends the same locked authorization boundary to every later
timed Course run/revision session; a bank read may only adopt, while an explicit
start creates the entitled session before releasing assignment/membership locks.
Migration 271 gives new Course assessment banks the same transactional import
guarantee: the bank row and complete question set commit together or not at all.

Migration 272 freezes a timed Course assignment's class deadline after the
first learner opens it. A marker on the assignment row makes concurrent start
and due-date writes serialize on one canonical record, preventing the browser
and server from enforcing different cutoffs.

Migration 273 makes the timeout envelope atomic: any final answers restored
after a transient eager-save failure are inserted at the canonical cutoff in
the same transaction that records the immutable `time_cap` session ending.

Migration 274 bounds that final-answer envelope to the same 15-second grace
used by the timeout reaper. It preserves lost-response idempotency while
preventing the recovery path from becoming an unlimited post-exam write lane.

Migration 275 makes a terminal retry prove that every submitted client ID is
already present, instead of reporting success after the reaper wins the lock.
Migration 276 closes the remaining open-session loophole: timeout finalization
is verification-only, rejects every client ID not admitted before the cutoff,
and derives score totals from the canonical attempt ledger rather than the
client summary.

Migration 277 atomically closes an expired on-time retry entitlement only when
no retake/full-retry generation exists. It shares the assignment-item row lock
with timed session creation, then leaves a durable marker so the minute reaper
does not scan settled historical sessions forever.

Migration 278 makes assignment deletion respect the same timed-attempt truth.
The locked delete RPC now refuses an assignment once its timer marker or any
item `opened_at` exists, and treats every attached Course quiz session as
durable learner work instead of waiting for `ended_by = 'completed'`.

Migration 279 makes timed progress admission respect the current retry
generation under the same item lock. A stale full-run tab can no longer write
after a near-pass authorizes only a retake, nor can an earlier run cross into a
new full-retry generation.

Migration 280 snapshots each timed Course item's duration and effective cutoff
when `opened_at` is first set. It locks later edits to the assignment duration
and the item snapshot, so the player, progress gate, finalizer, and reaper keep
one immutable boundary for the whole attempt.

Migration 281 adds the assignment-only Advanced Vocabulary learner-evidence
ledger, protected initial Listening attempts, immutable stage/section writes,
and atomic finalization. Anonymous and authenticated PostgREST roles receive no
direct bank, solution, or learner-evidence access; the backend service role owns
all runtime reads and writes. Apply it before importing the 30 core banks.

Migration 282 adds the immutable Practice-selection ledger and enforces the
Advanced persistence boundary under membership → assignment → item row locks.
It also restricts every direct client bank policy, guards attempt-1 section
evidence and terminal finalization, blocks hard deletion of immutable Advanced
banks, and revalidates publication plus the frozen runtime snapshot when an
assignment is issued.

Migration 284 adds the database boundary for one-sitting Course assignments.
It rejects retake sessions for that mode and prevents stale or internal paths
from creating sessions or answers after the canonical result has been handed
in. The normal mastery mode remains unchanged.

Migration 285 removes any explicit `anon` or `authenticated` EXECUTE grants
left by an existing Supabase environment on migration 284's trigger-only guard
functions. Runtime use remains internal to their table triggers.

Migration 286 adds the append-only AI usage ledger. Migration 287 safely remaps
an existing complete Advanced Vocabulary core-30 package to Course 5 and is a
no-op on a clean database before content import. Migrations 288–290 add the
single batch-graded Controlled Rewrite submission, repair its portable JSONB
count, and align its immutable completion evidence. Migration 291 reinstalls
the assignment-item deletion guard with the complete union of Practice,
stage, question, Listening, and Controlled Rewrite evidence stores. Migration
292 makes the Practice gate migration-first compatible: it derives the
canonical 28/20 selections from imported questions, backfills legacy attempt
evidence, and lets a pre-selection backend atomically create only that canonical
selection on its first answer.
Migration 293 gives the Advanced importer one database transaction for the
bank metadata, canonical 48 questions, and explicit publication decision, so
neither failure nor concurrent assignment can observe a mixed revision.
Migration 294 makes that lock-and-transaction boundary canonical for the
existing admin quiz import route and adds the explicit
`preserve|published|unpublished` publication contract without changing the
new-bank default for ordinary quiz banks.
Migration 295 adds immutable General/IELTS Listening content packages,
report-only attempt truth, and service-role-only atomic import and publication
contracts without changing existing diagnostic Listening rows.
Migration 296 records the first answer revealed during standalone General/IELTS
Listening programme practice through a service-role-only, owner-checked RPC.

Apply any genuinely pending active file only through the advisory-locked
forward runner. Do not run a data-deleting reset or use `--baseline` to silence
hosted drift. A pending feature group requires its explicit
`MIGRATION_FEATURES` opt-in after staging validation.
