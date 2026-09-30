# Implementation plan

The bounded behavioral contract has independent approval. No endpoint implementation, production mutation or new
credential discovery belongs in the specification approval change.

## Architecture impact

- Add bounded L1 grammar-focus GET/PATCH to the current admin Reading router.
- Reuse existing `require_admin`, configured SQLAlchemy/async database transaction
  boundary and append-only governance audit; no new engine/platform/schema/RLS.
- `admin_reading.py` already imports `require_admin` from `routers.admin`.
  Extend that existing dependency to reference `_require_db_engine` only when
  the PATCH handler runs; pass its existing engine into the new pure service.
  The service must not import routers or instantiate a second engine/pool.
  `admin.py` has no import of `admin_reading.py`; its similarly named dashboard
  service is a different module. Validate this dependency boundary in tests.
- Keep import/list/student/question/grading APIs unchanged. This is an
  operational capability for the authorized content correction, not a UI editor.

## Data and contracts

- Concrete request/success/error models as FR001–007; strict shape/size handling.
- Read canonical identity/source/metadata/timestamp and complete stable question
  fingerprint server-side; project only the field and source needed for review.
- Parameterized transaction guards whole original JSONB metadata, timestamp
  and reviewed source identity/body/title/status. Update only grammar_focus and
  timestamp, append the bounded receipt in the same commit. Lock the passage
  before receipt lookup, fingerprint computation and CAS, including no-op and
  already-applied paths, so identical races cannot double-write without a new
  uniqueness index. Validate stored actor/passage/payload/outcome on replay.
  Lock current questions `FOR SHARE` in stable ID order and verify the existing
  immediate passage FK blocks child inserts behind parent `FOR UPDATE`; test
  delete/reinsert in the legacy import's separate transactions, including a
  paused empty interval. Parent lock alone cannot protect child deletion.
- Receipt lookup uses server-side action+actor+passage+operation predicates,
  bounded candidates and safe parsing of only matching new-action detail.
  Existing impersonation/other plain TEXT details are never JSON-cast. A corrupt
  matching receipt or duplicate candidates produce a safe unavailable response.
- Existing import does not reliably bump timestamps. Timestamp-only optimistic
  matching is insufficient. Full metadata equality through PostgREST can put
  long translations into a URL; do not assume this is a compatible transport.
  Use the established configured SQL transaction boundary with bound JSONB
  values, tested against production-shaped large metadata. If unavailable,
  report explicit503 and block rollout rather than weaken CAS/add schema.
- Receipt details retain original/new focus and hashes only. No unrelated
  metadata, question key, credential or client-claimed actor is logged.
- Empty metadata/absent or null focus is a valid legacy empty state. Optional
  item fields may be omitted/empty strings; malformed present fields are not
  coerced, dropped or treated as empty. Read and write contracts distinguish this.

## UI and interaction

- No new editing UI. Existing student grammar panel reloads its canonical data.
- Operational responses distinguish current/committed revision after retry and
  never claim a save before commit. Existing learner/admin UI states are unchanged.

## Work decomposition

1. Approve bounded behavior and independent academic correction.
2. Implement strict wire models/revision and transactional CAS/receipt helpers.
3. Add admin GET/PATCH without invoking importer or question mutations.
4. Cover ownership, concurrent legacy writes, retries, malformed/large metadata,
   database/audit failure and unchanged persisted values/question identities.
5. Exact-SHA staging with synthetic passage, independent review, release.
6. Read actual production state; review exact one-field diff; perform and verify
   the authorized correction separately, preserving backup/receipt evidence.

## Rollout and rollback

- No migration. Verify configured transaction/audit availability in staging and
  production environment without printing credentials.
- Land approved spec separately, then stage the exact implementation SHA before
  promotion. Production write requires its reviewed current-state evidence.
- Code rollback removes the new API without modifying saved content/questions.
  Content restore uses original focus plus a fresh current revision; never
  overwrite other current metadata or replay a whole original passage snapshot.

## Verification strategy

- Strict request/response/error tests; JSON/timestamp/source revision stability;
  real-database atomicity/CAS/retry tests where configured; full question/value
  preservation fixtures; authenticated live synthetic staging and learner reload.
- Academic parse/timeline review; actual read-before/read-after and explicit
  production/SHA/receipt evidence remain pending.
