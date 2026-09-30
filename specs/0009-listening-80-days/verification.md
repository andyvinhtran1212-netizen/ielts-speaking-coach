# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | Full day/item/source inventory and stable-ID validation | PENDING |
| FR-002 | Immutable source and release SHA-256 attestation | PENDING |
| FR-003 | Full question-block geometry and source-content review | PENDING |
| FR-004 | Asset coverage validation plus special-day journeys | PENDING |
| FR-005 | Collection navigation, resource and eligible practice journeys | PENDING |
| FR-006 | Report-only/source numbering/denominator regression tests | PENDING |
| FR-007 | Complete authored explanation and limitation inventory | PENDING |
| FR-008 | Independent item-audit ledger and correctness exclusion tests | PENDING |
| FR-009 | Private asset authorization and truthful timing tests | PENDING |
| FR-010 | Pre-reveal protected-field and image leakage checks | PENDING |
| FR-011 | Saved/first/revised/reloaded/technical-error journeys | PENDING |
| FR-012 | Dry-run/idempotency/publish/archive coexistence tests | PENDING |
| FR-013 | OpenAPI/type, migration and compatibility checks | PENDING |
| FR-014 | Mobile/desktop, light/dark, keyboard and failure-state journeys | PENDING |
| FR-015 | Independent review, local gates and exact release evidence | PENDING |

## Initial evidence

Worktree: `/Volumes/Kingston SSD/Code/ielts-listening-80-days`.
Discovery branch: `codex/listening-80-days`; starting staging SHA: `10b45543`.
Implementation branch: `codex/listening-80-days-implementation`. The approved
specification landed at `018c2c6702f541a21c59a626bb19c815eab205a1`; implementation
was rebased onto observed staging `2467dfe044f9ea6aa404a2e6abe7a217f43a718a`
and recorded at `d22b9a15a2037c492b0c0cf13ff07f77759ccf04` before this evidence update.
Read-only source/web/reviewer findings are in the task's external
`80-days-listening-preview/phase-1-*` folders. Their source inventory is evidence
for preparation only, not published content or completed semantic review.

## Release evidence

- Specification-only approval: PR #1547 merged on 2026-09-30 as staging SHA
  `018c2c6702f541a21c59a626bb19c815eab205a1`. Independent reviewer accepted
  all six specification documents; required checks passed for PR head
  `c93b637b84a93153172f70a78dcd9b0a49a7e806`. Local validator contract tests:
  88 passed. Pre-push backend baseline: 8,884 passed, 355 skipped; skipped
  provider/live/PostgreSQL tests do not certify those contracts.
- Implementation PR #1558 targets staging. Its first head was
  `46dc942219fd0724220af0afe5d1129aff14bd11`; its checks do not certify the
  subsequent consolidated correction. Independent runtime review closed
  R1–R10, then found R11/R12: protected warning prose and solved resource titles
  leaked through public day metadata. The shared public projection now emits
  neutral state copy and unopened-study descriptors; explicit study retains
  protected explanations and resource content. Stored release/importer/schema
  bytes are unchanged. Round4 independent review accepted the correction and
  actual80-day/195-form scan: all104 study positions and110 unopened study blocks
  are neutral; all104 protected items and93 zero-item resources retain their
  original explicit-study content. New exact-head CI remains pending;
  merge/publication are held.
- Consolidated correction local gates: source boundary 49 passed; complete
  backend 9,024 passed / 358 skipped; frontend contracts 9,271 passed; React
  27 passed; strict/legacy type checks and production build passed. The initial
  sandbox frontend run failed on localhost binding; the permitted rerun passed.
  Skips do not certify live service contracts. Logs are bound in the external
  runtime reset audit, not treated as staging or production evidence.
- Full80 local package and independent source/projection/package review: PASS.
  Package `80-days-listening-source-v1`, manifest SHA-256
  `29819c11a65c71762d7912c919c459df306ed61209a36311a8e23c0d21f83841`.
  Complete native importer: 80 lessons, 195 forms, 1,572 practiced items,
  104 protected study-only positions (1,676 original positions total),
  638 vocabulary terms, 69 stimuli, 663 runtime assets, zero timing segments.
  Every item remains false/self_review with no band or automatic correctness.
  Day76 has two audio-covered forms with 19 practiced positions; unresolved19
  and original21–41 remain study. Day77 and vocabulary61–70 have zero forms.
- Actual full80 disposable PostgreSQL RPC: created/reused the same package UUID
  and exact80/195/1572/69 counts; invalid missing controlled-transcript source
  provenance was rejected with no partial package rows. No hosted or Storage
  writes; local PG does not certify Supabase Auth/PostgREST/Storage.
- Staging schema: canonical advisory-locked migration304 applied, followed by
  readback confirming293 ledger entries and the source namespace/nullable timing
  contract. Four prior package metadata fingerprints and19 attempt ID/status
  fingerprints were unchanged; this limited snapshot does not prove every
  historical answer/reveal/timestamp field. The private listening-audio upload
  stopped on a client timeout before the package RPC. Genuine complete-row
  baseline, completed unpublished import/retry and663 asset readbacks remain
  pending; partial uploads are not a package completion certificate.
- Staging SHA, integrated checks and live source-collection journeys: pending.
- Production promotion SHA, deployed markers and package publication: pending.

### Bound external evidence

- `80-days-listening-preview/phase-2-review/full80-independent-package-review.json`: independent actual full80/native package acceptance, SHA-256 `2bb1e65b72d890ecefa1e12a02593870cb004324d6d7dc7875967f78f7a35a4e`.
- `80-days-listening-releases/source-v1-20260930`: frozen local release; external `source-v1-20260930-dry-run.json` records actual pure importer result.
- `80-days-listening-preview/phase-2-review/full80-local-postgres-projection.json`: actual complete local RPC created/reused/rollback evidence.
- `80-days-listening-preview/phase-2-review/release-projection-extension-78-80-review.json` plus revision3 `release-projection-extension-26-74-review.json`: final exact normalized tuples, with the original Day53 typed-prompt correction and review-hash rebinding explicitly superseded.

The requirement matrix above stays PENDING for end-to-end release closure; local preparation and code gates do not prove staging or production behavior.
