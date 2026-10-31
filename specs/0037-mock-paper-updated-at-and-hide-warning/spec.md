---
id: PAPERUPDATEDAT-0037
title: Every change to a Reading or Listening paper advances updated_at, and admins see that a Mock Test hides its public source
status: approved
risk: high
owner: product
---

# Every change to a Reading or Listening paper advances updated_at, and admins see that a Mock Test hides its public source

Approval: approved by Vinh on 2026-10-28 at 21:33 (UTC+7) (see
[`approval-decision.md`](approval-decision.md)).
Migration number: **338** (337 is claimed by A-10 CLASSARCHIVE-0030 in job
q-13f; 336 by #1853).
Origin: Security Auditor investigation of the AVR-READ-002 `is_public` flip on
production, 2026-10-28
(`/workspace/cc-jobs/security-auditor/avr-read-002-ispublic-flip-1028.md`).

## Tóm tắt (tiếng Việt)

Khi admin ẩn/hiện một đề Reading hay Listening (hoặc sửa đề), cột `updated_at`
của đề không đổi, nên ai nhìn `updated_at` sẽ tưởng đề không bị đụng tới. Đó là
lý do vụ AVR-READ-002 bị ẩn trên prod lúc 09:15 ngày 28/10 bị hiểu sai. Migration
338 thêm trigger để mọi lệnh UPDATE trên đề Reading/Listening, đoạn Reading,
câu hỏi Reading và phần Listening đều tự cập nhật `updated_at`. Cơ chế khoá đề
thi thử (`trg_mock_paper_policy`) và việc ghi lịch sử thay đổi giữ nguyên.

Trên form tạo Mock Test, khi admin chọn một đề Reading/Listening đang công khai
làm đề nguồn, form hiện cảnh báo rõ: lưu đề nháp sẽ ẨN đề nguồn khỏi kho luyện
tập công khai. Câu chữ cảnh báo là bản đề xuất, chờ Content Manager duyệt. Hành
vi ẩn đề nguồn không thay đổi.

## Problem

`reading_tests.updated_at` and `listening_tests.updated_at` have only a
`DEFAULT now()` (086, 065). No BEFORE UPDATE trigger maintains them, every
writer of `is_public`/`status`/`metadata` leaves `updated_at` out of its SET
list, and `fn_guard_mock_paper_policy` (306) deliberately ignores it. So a
visibility flip, a lock/share change or a content edit leaves `updated_at`
untouched. On production AVR-READ-002 went `is_public` true → false at
2026-10-28 02:15:04Z through the admin Reading visibility toggle (release event
`741f775e`, policy_revision 0 → 1) while `updated_at` stayed at 2026-05-30,
which led operators to a wrong "no audit trail" conclusion. The opposite flip
(exposing a paper) would be equally invisible in `updated_at`.
`reading_passages`, `reading_questions` and `listening_content` have the same
gap; `listening_exercises` already has `trg_listening_exercises_updated_at`
(208).

Separately, creating a Mock Test with a public Reading/Listening source runs
`fn_copy_mock_draft_paper`, which hides the source
(`fn_mutate_mock_paper_policy(..., '{"is_public":false}')`, 316:28-31;
`ExamCreate.private_content_copy: Literal[True]`, admin_mock_exams.py:104). The
create form only says the source "may have been seen before it is hidden"; it
never states plainly that saving removes the source from the public library.

## Scope

- Migration 338: `BEFORE UPDATE … FOR EACH ROW EXECUTE FUNCTION
  public.update_updated_at_column()` triggers on `reading_tests`,
  `listening_tests`, `reading_passages`, `reading_questions` and
  `listening_content`, with preconditions and catalog postconditions.
- Admin Mock Test create form: a warning shown when the selected Reading or
  Listening source is public, its wording in one constant
  (`PUBLIC_SOURCE_HIDE_WARNING`), listed in the PR for Content Manager review.
- Tests: static and PostgreSQL tests for 338; a React test for the warning.
- `backend/migrations/README.md` note.

## Non-goals

- Changing the hide-on-copy behaviour (whether a Mock Test should hide its
  public source is a separate product decision).
- A general content audit table, pgaudit, or requiring an actor GUC on policy
  writes (auditor fixes 2, 3 and 5).
- Backfilling historical `updated_at` values.
- Requiring a confirmation tick or returning `hidden_sources[]` from the API.
- Changing `listening_exercises` (already maintained by 208).

## Users and journeys

- An operator or agent reads `updated_at` on a Reading/Listening paper after an
  admin hides, shows, locks, shares, re-imports or edits it, and sees when it
  last changed.
- An admin creates a Mock Test from a public Reading/Listening source and is
  told, before saving, that the source will be hidden from the public library.
- Learners: no visible change.

## Requirements

- **FR-001:** Every `UPDATE` of a row in `reading_tests`, `listening_tests`,
  `reading_passages`, `reading_questions` or `listening_content` sets that row's
  `updated_at` to the transaction time (`now()`), whichever writer runs it
  (admin RPCs such as `fn_mutate_mock_paper_policy`, the Mock Test copy, direct
  PostgREST/service-role updates, raw SQL), including a value the writer sets
  explicitly. `INSERT` is unchanged.
- **FR-002:** `trg_mock_paper_policy` and the other existing guards keep their
  behaviour: a policy change still bumps `policy_revision` once and writes one
  `mock_correction_release_events` row; a policy-only or `updated_at`-only
  change does not bump `mock_content_revision`; a content change bumps it as
  before; guard refusals still abort the update. The guards fire before the new
  trigger.
- **FR-003:** Migration 338 is forward-only in one transaction with
  `lock_timeout = '5s'`, changes no row, is re-runnable, aborts unless
  `public.update_updated_at_column()`, the 306 `trg_mock_paper_policy` triggers,
  the five `updated_at` columns and 208's `trg_listening_exercises_updated_at`
  exist, and fails unless each table ends with exactly one enabled
  `update_<table>_updated_at` BEFORE UPDATE row trigger that sorts after every
  guard trigger on that table.
- **FR-004:** On the admin Mock Test create form, when the selected Listening or
  Reading source is public (`is_public` from the picker), a warning
  (`role="alert"`) states that saving the draft creates a private copy and
  hides the source from the public practice library. It does not show for a
  private source, an empty picker or Writing prompts. The wording lives in one
  exported constant and is a proposal pending Content Manager review.
- **FR-005:** Hide-on-copy is unchanged: the create payload still sends
  `private_content_copy: true` with `*_is_public: false`, and the backend still
  hides a public source.
- **FR-006:** A permitted Listening package status transition (publish or
  archive through `set_listening_content_package_status`, which sets
  `app.listening_package_status_transition` to that package) succeeds on the
  package's `listening_tests` rows while `trg_mock_paper_policy` is active: the
  row takes the new `status` and `is_public`, `policy_revision` rises by exactly
  one, one `mock_correction_release_events` row is written, and `updated_at`
  advances. `fn_protect_listening_package_child` additionally accepts only the
  `policy_revision` change that `fn_guard_mock_paper_policy` derives in that
  transition; every other package-row change, a visibility or status change
  outside a package transition, and raw content edits are still refused with
  `listening_package_child_immutable` and leave no release event. Migration 353
  is forward-only in one transaction with `lock_timeout = '5s'`, changes no row,
  and is re-runnable.

## Acceptance scenarios

### Scenario 1 — visibility flip is visible in updated_at

- **Given** a published public Reading paper with an old `updated_at`
- **When** an admin hides it through `PATCH /admin/reading/content/tests/{test_id}/visibility`
- **Then** `is_public` is false, `policy_revision` rose by one, one release event exists, and `updated_at` is the time of the change

### Scenario 2 — Mock Test from a public source

- **Given** a public Reading source in the Mock Test picker
- **When** the admin selects it
- **Then** the warning appears under the Reading picker before saving; saving creates the private copy and hides the source (and its `updated_at` advances)

### Scenario 3 — private source

- **Given** a source that is already private
- **When** the admin selects it
- **Then** no hide warning is shown

## Edge cases

- `listening.py` uses `updated_at` as an optimistic-concurrency token on
  `listening_content`: the token now advances on every write (including ones
  that did not set it), which only makes stale-editor detection stricter; the
  route already returns the stored value.
- `reading-exam.js` keys its per-test local cache on `updated_at`; a policy or
  metadata change now also resets that cache. It holds no answers (answers are
  server-side).
- Admin lists ordered by `updated_at desc` now reorder after visibility, lock
  and share changes.
- 80-day Listening package rows: `fn_protect_listening_package_child`
  allow-lists `updated_at`, but not the `policy_revision` that 306 bumps on a
  status/visibility change, so a permitted package publish/archive was refused
  with `listening_package_child_immutable` (found by PC-J242 on local PG17,
  2026-10-30). Amendment 1 adds FR-006 and migration 353.
- A superuser can still disable triggers; that bypass is out of scope.

## Success criteria

- On staging after apply, the read-only catalog query in the 338 header lists
  exactly the five triggers, enabled.
- A staging visibility toggle on a QA Reading paper advances `updated_at` and
  writes one release event.
- Existing mock paper policy / private draft suites stay green.

## Decisions

1. Use the existing `public.update_updated_at_column()` (033, pinned by 108)
   rather than a new function.
2. Cover `listening_content` as Listening's passage table; leave
   `listening_exercises` to 208.
3. Warning only, no confirmation tick (owner scope, 2026-10-28 21:33).

## Open questions

- Content Manager: final Vietnamese wording of `PUBLIC_SOURCE_HIDE_WARNING`.
