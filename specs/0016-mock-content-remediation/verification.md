# Verification

## Requirement coverage

All rows below are **planned acceptance**, not passing implementation evidence.
The draft does not claim the current green baseline satisfies these new rules.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | Planned complete anonymous/outsider/enrolled/owner/admin purpose-route matrix; raw JSON and signed-media boundary assertions before payload reads | PENDING |
| FR-002 | Planned real PostgreSQL lifecycle matrix across all shared mocks/classes/retakes and owned active/orphan attempts, including done/closed distinctions and null/malformed dates | PENDING |
| FR-003 | Planned explicit overlap request/audit/expected-revision cases; later link/revision invalidation; public ordinary-paper and legacy-share compatibility | PENDING |
| FR-004 | Planned direct start without frontend attach, atomic binding/readiness/collection races, retry receipt, ambiguous orphan and blank collection tests | PENDING |
| FR-005 | Planned entry-close ongoing resume, per-skill retake/time boundary, sealed submit/review/correction and every dictation transcript route test | PENDING |
| FR-006 | Planned real PostgreSQL two-connection barriers: paper mutation versus mock link/swap/publish, assignment/window changes and attempt admission, plus all legacy writer parity | PENDING |
| FR-007 | Planned typed 409/503 malformed/lost-ack receipts; native UI durable notice after successful/failed reload and duplicate-submit/readback test | PENDING |
| FR-008 | Planned direct PostgreSQL hide/explanation-only/full snapshot/CAS restore, stale admin, permissions and injected mid-approval/audit failure rollback tests | PENDING |
| FR-009 | Planned declared policy/schema tests and Reading/Listening same-policy golden cohort with no numeric/date inference on literal items | PENDING |
| FR-010 | Planned reviewed per-item positive/negative phone/grouping/sign/decimal/unit/date/plural/term/duplicate-label/group-cardinality cohort and source receipts | PENDING |
| FR-011 | Planned before/after historical grade/answer/policy hashes; active legacy versus new revision submit; migration/import/startup no-regrade checks | PENDING |
| FR-012 | Planned canonical owner and anonymous capability flag read/write/reload/second-client/account-switch, concurrent stale response and answer/countdown preservation tests | PENDING |
| FR-013 | Planned persisted blank/incorrect/correct cards/filter/navigation counts in both domain renderers with unchanged grade assertions and legacy unknown provenance | PENDING |
| FR-014 | Planned admission-pinned submission snapshots for each actual question type; direct client-role RLS secrecy and source edit/delete-after-submit; option/group/summary/table/diagram/audio path/window and pre-submit secrecy tests | PENDING |
| FR-015 | Planned absent versus intentionally-empty frozen fields, verified revision/current fallback/unavailable labels, historic partial snapshots and support coverage rendering | PENDING |
| FR-016 | Planned independent 368 finding/80 paper receipt reconciliation, protected withdrawn-claim checks, actual revised hashes and incomplete-audio/source gap audit | PENDING |
| FR-017 | Planned source-grounded item diff/key-selectability/control semantics/group/table/passage tests; actual listening signoff distinct from replay clock cases | PENDING |
| FR-018 | Planned native browser keyboard/focus/notice/navigation/Submit tests at 390/768/1180/1440 in light/dark with reduced motion and account/save error states | PENDING |
| FR-019 | Planned OpenAPI/generated-type drift, old/new-client contract tests, full local suites and exact-SHA staging/promotion/frontend/backend deployed receipts | PENDING |

## Contract evidence

Baseline: five existing backend policy/leak test modules passed 166 tests, zero
skips on staging source SHA `0d9b886c56df87172b4cf09d8ed4232f9ea881f7`; 13
source-extracted synthetic probes demonstrate current branches and the check/write
race. These are discovery evidence, not PostgreSQL or proposed-contract acceptance.

The implementation must publish concrete API schemas and demonstrate every legacy
admin writer's path to the serialized invariant. Generate frontend wire types;
old-client compatibility cannot silently omit authority checks. Each evidence
receipt records exact code SHA, test/fixture scope, skipped prerequisites and
whether it is local, staging or production.

## Data evidence

Run contention/rollback tests on real isolated PostgreSQL, never production
fixtures. Capture unchanged historical answer/grade/version hashes, stable
sitting/attempt IDs, exact full policy before/after values and actor/revision audit.
Local mocks and SQL source string assertions do not prove transaction safety.
Production read inventory locates all 80 IDs but supplies no original audit-time
snapshot; C17R3 restoration stays separate until an authoritative baseline exists.

## UI evidence

Use native Next journeys, not only retired HTML/static selectors. Verify flags on
reload, second supported client and account switch; original version-A review
after version-B edit; blank filters; mutation notice after 409/503 and reload; and
all widths/themes/accessibility inputs in [ui-states.md](ui-states.md). Transcript
and key assertions inspect full response bodies even when the UI does not show
those fields.

## Release evidence

Record implementation PR head, exact merged staging SHA, applied migrations,
integrated checks and live Staging E2E result. After authorized promotion, record
main SHA and both Vercel/Railway runtime SHAs, actual content revision inventory
and scoped learner/admin journeys. Independent acceptance owns the final FR and
368/80 reconciliation; deployment alone does not close content/audio/repair gates.
