---
id: READINGGRAMMAR-0012
title: Correct L1 Reading grammar analysis without replacing passage questions
status: implementing
risk: medium
owner: product
---

# L1 Reading grammar-focus correction

## Problem

The published `the-tragedy-of-the-commons` grammar analysis incorrectly calls
`had managed` the main-clause verb. In the quoted source, `Ostrom showed` is the
main clause and `that communities had managed…` is its content-clause complement.
The production read probe confirmed the stored error on 2026-09-30.

The existing Reading import rewrites passage content/metadata and deletes then
reinserts comprehension questions. The L1 admin list omits full metadata and
the existing admin detail routes cover L3 tests. No current compatible API can
make a reviewed grammar-focus-only correction while preserving unrelated
metadata and question identities. The local staging probe contains no copy of
this production passage; it is not evidence of a repaired production record.

Risk is medium: the new admin capability edits explanatory content only,
preserves all question/grading/history data and reuses existing permissions,
database and audit boundaries. It introduces no schema or scoring change.

## Scope

- Admin-only read and revision-checked correction of `metadata.grammar_focus`
  on one existing L1 Vocab Reading passage.
- Preserve every unrelated passage/metadata value and every question ID,
  payload, answer, order and hash. Use the current database and audit mechanism.
- Provide a bounded operational API that can support the authorized canonical
  content correction after independent review and staging verification.

## Non-goals

- L2/L3 editing, passage import/recreation, generic metadata/content editor,
  frontend editing screens, generated analysis or new paid AI calls.
- Changing learner grading/checks, attempts, question keys or result history.
- New tables/functions/schema, RLS/role/permission changes, credentials in
  request bodies, generic SQL administration or an audit/receipt platform.
- Silently repairing production during deployment or treating recommendations
  in the PDF as authorization for unrelated product features.

## Users and journeys

- An authorized admin reads the exact passage and current grammar points,
  reviews a one-field textual correction, then saves against that revision.
- A second editor changes metadata or reimports content concurrently; a stale
  correction is rejected without overwriting the intervening edit.
- An operator loses the save ACK, retries the same bounded operation and can
  determine whether it already committed without repeating its mutation.

## Requirements

- **FR-001:** `GET /admin/reading/content/passages/{slug}/grammar-focus` reads
  only an existing `library=l1_vocab` passage, regardless of publication status,
  after the existing `require_admin` guard. Its concrete response contains
  `passage_id` (UUID), `slug`, `library` (`l1_vocab`), `title`, `status`
  (`draft|published|archived`), `body_markdown`, `grammar_focus`, `updated_at`
  (timezone-aware timestamp), `revision` (opaque 64-hex SHA-256),
  `source_sha256`, `unrelated_metadata_sha256` and `questions_sha256`.
  No raw unrelated metadata, private question answers or other-library record
  is returned. Fingerprints are canonical and stable across JSON key order;
  question fingerprints include identities and persisted values in stable order.
- **FR-002:** `PATCH` at the same path accepts only `expected_revision`
  (64-hex SHA-256), `operation_id` (UUID) and a replacement `grammar_focus`
  array. Each item permits only `point`, `example`, `analysis`, `review`, `tip`;
  `point` is a non-blank string (max 500 characters), optional fields are strings
  when present (`example` max 5000, `analysis` max 10000, `review` max 5000,
  `tip` max 3000). At most 20 entries and 256KiB UTF-8 JSON are accepted.
  Unknown keys, null/non-string fields, malformed revision/ID and oversized
  values fail 422 before any write. Do not coerce or drop malformed entries.
  Preserve accepted text, array order and omitted optional keys. An explicit
  empty array is an intentional removal, never inferred from invalid input.
- **FR-003:** The server reads current canonical state and merges only
  `grammar_focus` into the existing metadata object. The atomic compare-and-set
  guards exact original whole metadata and `updated_at`, passage identity,
  L1 library and source body/title/status used for review, and verifies the
  reviewed question fingerprint. It updates only
  metadata and `updated_at`. Do not depend on timestamp alone: the existing
  importer does not guarantee bumping it. Every unrelated metadata key,
  translation, image/glossary/passage field and question identity/value survives.
  A stored metadata object, including `{}`, is valid. Absent/null focus means
  the existing empty-focus state, as on current student reads; explicit `[]`
  is also valid. Entries require a non-blank point and string optional fields
  when present; omitted/empty optional strings are valid legacy data. A
  non-object metadata value, non-array non-null focus, malformed entry,
  timestamp or source state fails explicitly before write. Never turn invalid
  input into an empty replacement. Serialize the parent scope before receipt
  lookup, fingerprint computation or CAS, including no-op requests. The transaction holds parent `FOR UPDATE`
  plus stable-order existing question `FOR SHARE` locks through commit.
  Parent locking alone does not fence child DELETE/UPDATE; verify protection
  of new child INSERTs under the existing immediate foreign key. These locks
  guarantee a stable operation, not a permanent fence against later imports.
- **FR-004:** The revision fingerprints the identity, reviewed source,
  canonical whole metadata, `updated_at` and stable question fingerprint. Any
  drift produces 409 with a
  clear conflict code and current revision; nothing is overwritten. No
  last-write-wins retry or automatic reread/reapply is allowed. Simultaneous
  corrections serialize through the existing database transaction boundary.
  A concurrent reimport remains detectable even if it changes only body or
  metadata without changing the timestamp. A missing/non-L1 passage is404.
- **FR-005:** `operation_id` is scoped to authenticated actor and passage.
  An identical retry uses its committed audit receipt and returns
  `already_applied`, including the operation's committed revision and current
  revision; it does not write or claim the current state still equals the saved
  state if a later edit occurred. Reusing the ID with a different expected
  revision or focus is409. A no-op at the current expected revision returns
  `unchanged` without bumping the timestamp. Lost ACK, concurrent identical
  retries and response serialization failure cannot duplicate the content
  update or its committed audit receipt. No new receipt store is introduced.
- **FR-006:** A settled updated/unchanged operation appends one existing `governance_audit`
  row in the same transaction, action `reading_grammar_focus_edit`, server
  actor ID, no target instructor, and structured detail with passage identity,
  operation ID/fingerprint/outcome, before/after revision and focus hashes, original
  focus and committed new focus. The receipt also retains the committed
  `source_sha256`, `unrelated_metadata_sha256` and `questions_sha256`, so a
  later source/import change cannot erase the component evidence of this
  operation. No bearer token, credential, raw unrelated
  metadata or question key enters the log. Failure to commit the receipt leaves
  content unchanged. An unchanged operation records its receipt without
  updating the passage; identical retries append no second row. Existing
  audit schema/ownership remains unchanged; no
  audit row is edited/deleted. Receipt lookup is a bounded parameterized server
  query restricted to action, actor, passage and operation, with a maximum of
  two candidates to detect duplicates. Do not download/scan all logs or cast
  other action's non-JSON detail. Corrupt/ambiguous matching receipts fail
  503 rather than guessing success. Validate receipt actor, passage, operation,
  payload fingerprint and outcome before accepting a retry. The API returns 200 only after settled commit,
  not after merely initiating an update.
- **FR-007:** Success wire contracts expose `outcome`
  (`updated|unchanged|already_applied`), `operation_id`, `committed_revision`,
  `current_revision`, current `updated_at` and `grammar_focus`, plus unchanged
  source/unrelated-metadata/question fingerprints for the committed operation.
  Current revision/focus/fingerprints are distinguished from that receipt on
  `already_applied`, including whether the current revision still equals the
  committed one; later changes are never labeled unchanged. Auth failures
  remain401/403. Conflicts409, validation422, missing passage404 and unavailable
  atomic database/audit or malformed canonical state503 have concrete safe
  error contracts; they never echo SQL, credentials or raw metadata. Define
  OpenAPI models and runtime validation. Existing import/list/student contracts
  and old clients remain unchanged; no frontend feature is required.
- **FR-008:** Before any canonical content repair, independent academic review
  approves the replacement analysis against the actual current passage text,
  correctly separating implicit participle subject, main clause, content-clause
  subject/verb and past-perfect timeline. For F02 change only the first
  `analysis` string; preserve the other four fields in that item and every other
  item byte for byte. Record read-before/proposed diff/expected revision,
  settled receipt/read-after and unchanged fingerprints. Use representative
  complex-sentence fixtures to prevent fixing one label by introducing another
  false rule. Do not claim repair from a staging fixture or PDF screenshot.
- **FR-009:** Approval lands separately before endpoint code. Exact-SHA staging
  verification proves read/update/reload, non-admin denial, no-op, lost-ACK
  retry, ID reuse, competing edits, unchanged-timestamp reimport, malformed data,
  database/audit failure and complete preservation of unrelated values/questions.
  Use synthetic fixtures because the production passage is absent in staging.
  Production content correction is a separately recorded operation after
  release review; preserve the read-before backup and restore only the old
  grammar-focus field through a fresh revision-checked operation if required.
  Old importers retain their existing behavior; update an original source
  package when it is identified to avoid later reintroducing the explanation.

## Acceptance scenarios

### One analysis changes, questions survive

- **Given** the actual L1 record with four grammar points, translation and its
  original comprehension questions
- **When** the reviewed first-analysis correction commits against the read
  revision and the page reloads
- **Then** the learner reads `showed` as past simple in the main clause and
  `had managed` as past perfect in the that-clause. Only that analysis and
  `updated_at` changed; unrelated fingerprints and all question IDs/values match.

### Competing edit or unchanged-timestamp reimport

- **Given** an admin has read revision A
- **When** another writer changes metadata or source text while retaining the
  old timestamp, and the admin submits revision A
- **Then** save returns409, and both metadata and question records remain
  exactly as they were after the competing operation.

### Lost ACK and later edits

- **Given** operation X committed but its response was lost
- **When** X is retried unchanged, including after another edit
- **Then** it returns the committed receipt without a write, distinguishes
  current from committed revision, and never repeats the old correction over
  the newer edit. Changed payload reuse of X is409.

### Invalid state, permission or audit failure

- **Given** a learner token, invalid request, unavailable atomic database,
  malformed persisted metadata, or an audit failure
- **When** read/save is requested
- **Then** the defined denial/error is explicit; no passage/question/audit
  partial mutation or credential disclosure occurs.

## Edge cases

- Unicode Markdown text, omitted versus empty optional strings, duplicate point
  labels, zero entries, malformed stored focus and unrelated metadata.
- Slug/library/status/body changes, stale timestamps, JSON key-order changes,
  concurrent identical/different retries, lost ACK and no-op requests.
- Large translated metadata, database transport limits, missing configured
  transactional connection, audit failure and late edits before restore.
- Lost-ACK retry after a later source or question import: committed component
  fingerprints come from the receipt; current fingerprints come from the new
  canonical read. An aggregate revision cannot reconstruct old components.
- Legacy import can subsequently replace metadata/questions as it does today;
  this narrow editor neither invokes that route nor silently changes its contract.

## Success criteria

- Requirement-linked tests and exact-SHA staging evidence pass.
- Canonical read-after proves the reviewed analysis; all unrelated passage,
  metadata and question fingerprints reconcile exactly for the repair.
- Concurrent/stale/duplicate requests cannot lose another edit or replace
  questions. No schema/RLS/role/new-persistence changes occur.

## Approval record

Approved2026-09-30 under the user's authorization to complete validated
remediation with controlled agents and independent review. The root coordinator
approved the bounded product/API scope. The content council reviewed the
academic correction proposal and available source paths; the admin engineering
council independently reviewed CAS, locking, retries, atomic audit and restore.
Review added parent/child locks and FK insert verification, bounded receipt
lookup, corrupt/duplicate receipt handling and valid legacy empty-focus states.

This approval is for the separately landed behavioral contract. It does not
certify an endpoint, actual database concurrency, canonical repair or deployed
SHA. The exact current source and replacement analysis require a separate
academic read-before review under FR-008 before the content mutation.

## Open questions

None in the approved bounded behavior. Actual configured transaction/audit
availability and locking/FK behavior are implementation/staging prerequisites,
not permission to weaken CAS or add a new database platform.
