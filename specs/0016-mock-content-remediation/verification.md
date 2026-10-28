# Verification

## Requirement coverage

All rows below are **planned acceptance**, not passing implementation evidence.
Approval of intent does not claim the current green baseline satisfies these new rules.

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

### Reconciled state (2026-10-29)

This record covers runtime only. It does not change any FR row above. Every row
stays PENDING until T009/T010 independent acceptance.

| PR | Merge SHA on staging | Scope |
| --- | --- | --- |
| [#1574](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1574) | `cf2be7354da609dc2445ef62a6cc3fb20873f03d` | T002–T006 core; migrations 306/307/308 |
| [#1597](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1597) | `845c66db86e278ed45459e30fb096aa6b441a1de` | Finalization after section collection; migrations 310/311 |
| [#1633](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1633) | `602bdda0129c8e0267f39a923f0920e5890b36dd` | Private mock draft copies; migration 315 |
| [#1637](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1637) | `c9acb2e8bf00c10146b16276b865213c75211e59` | Shared-source resume and programme guard; migration 316 |

Promotions to main that carry these merges (`git merge-base --is-ancestor`):
[#1586](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1586) `96e6b698e3810ba3ce510569fe0c9462396449c1` (#1574),
[#1599](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1599) `1237dc8c7c623e5e4e0e2592a4ab0982f8c99ca0` (#1597),
[#1636](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1636) `db7ad80730907722d0fb16bd76919008d2ab1e9f` (#1633, #1637).

Applied migrations (`applied_at`, UTC). Source: the staging and production
ledger snapshots captured read-only on 2026-10-28 for the 2026-10-28 promotion
(operator evidence, not committed). The apply notes in #1574 and #1597 (staging),
#1586 and #1599 (production) and #1636/#1637 (both) match for 306/307/310/311/315/316.
Only the snapshots record 308. `backend/migrations/forward-policy.tsv` keeps it
an opt-in `pending_feature`, so the forward runner skips it unless the
`mock_content_remediation_activation` group is selected. No database was read
for this record.

| Migration | Staging | Production |
| --- | --- | --- |
| `306_mock_paper_policy_and_admission.sql` | 2026-10-02 17:32 | 2026-10-04 15:59 |
| `307_mock_attempt_review_flags.sql` | 2026-10-02 17:32 | 2026-10-04 15:59 |
| `308_activate_mock_paper_admission.sql` (opt-in) | 2026-10-03 03:39 | 2026-10-06 09:09 |
| `310_mock_attempt_submitted_finalization.sql` | 2026-10-05 09:25 | 2026-10-05 15:48 |
| `311_mock_submitted_parent_lifecycle.sql` | 2026-10-05 09:46 | 2026-10-05 15:48 |
| `315_mock_exam_private_draft_copies.sql` | 2026-10-11 03:56 | 2026-10-11 04:04 |
| `316_mock_draft_shared_resume_and_package_guard.sql` | 2026-10-11 04:17 | 2026-10-11 04:26 |

The 306–316 range also holds 309 and 312–314. Those belong to the Grammar specs
0014/0015/0017, not this spec.

Still open:

- FR-013 / T007: neither review workspace has a "Bỏ trống" (blank) filter or
  count yet. Blanks are counted as wrong. Owned by PC-J46.
- FR-016 / FR-017 / T008: `traceability.json` has `verified_fixed_findings: 0`.
  No content revision is prepared, deployed or promoted.
- T010 waits on T008 and T009. T013 waits on T012.
