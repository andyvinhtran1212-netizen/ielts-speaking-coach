---
id: CLASSARCHIVE-0030
title: An archived class is hidden from learners, takes no new learners or work, and closes its open work without losing it
status: approved
risk: high
owner: product
---

# An archived class is hidden from learners, takes no new learners or work, and closes its open work without losing it

Approval: decisions D1–D6 = (a) by Vinh at t259u, 2026-10-28 21:23 (UTC+7),
including the STUDENTARCHIVE-0029 FR-003 amendment (D2). See
[`approval-decision.md`](approval-decision.md). Locked migration number:
**337** (`337_class_archive_enforcement.sql`). Variant A for open work was
decided by Vinh on 2026-10-27 07:39 (UTC+7). Evidence record (path inventory,
staging counts, migration and rollback SQL, production read-only checks):
[`research.md`](research.md). Review that drove this version:
`/workspace/cc-jobs/a10-spec-review-1028.md` (findings F1–F17).

## Tóm tắt (tiếng Việt)

Hôm nay nút "Lưu trữ" lớp chỉ bật cờ `cohorts.is_active=false`, gần như không
đường nào kiểm cờ này. Sau A-10, một lớp **được lưu trữ theo quy tắc mới**:

1. Biến mất khỏi `/my-class` và `/home` của học viên.
2. Không nhận học viên mới qua bất kỳ đường nào. Mã lớp trả thông báo chung "mã
   không hợp lệ" và mã không bị tiêu (D4).
3. Không nhận bài, buổi học hay lượt giao bài mới.
4. Bài đang mở đóng nhận bài mới (Biến thể A). Bài đã nộp, bản nháp và điểm được
   giữ nguyên. Riêng bài Writing **tính giờ đã bắt đầu trước lúc lưu trữ** vẫn
   được làm tiếp và tự nộp khi hết giờ (D3).
5. Khôi phục lớp là mọi thứ quay lại.
6. Có audit ai lưu trữ, lúc nào, lý do gì. Ô lý do là tuỳ chọn (D5).

Hai lỗi nghiêm trọng được xử lý ngay trong spec:

- **Lưu trữ đúng lúc học viên đang kích hoạt mã:** học viên nhận cùng thông báo
  chung như khi mã không dùng được, không bao giờ nhận lỗi 500. Tài khoản quay về
  trạng thái trước khi kích hoạt (chưa kích hoạt thì vẫn chưa kích hoạt) và mã
  không bị tiêu (FR-008).
- **Deploy không làm ai mất lớp:** lớp đã tắt **trước** A-10 (staging có 1 lớp,
  3 học viên, 4 bài Writing đang mở) được giữ nguyên như hôm nay. Migration không
  đánh dấu chúng là "đã lưu trữ theo quy tắc mới". Admin phải chủ động bấm "Áp
  dụng lưu trữ" (hoặc "Khôi phục") cho từng lớp. Ở production, anh Vinh xem danh
  sách từ kiểm tra chỉ đọc P1–P5 (D6) rồi quyết định từng lớp (FR-009).

Khôi phục học viên (0029) bỏ qua các lớp đã lưu trữ và ghi lại các lớp bị bỏ qua
trong audit (D2, sửa FR-003 của 0029). Migration **337** (D1).

## Problem

`cohorts.is_active=false` ("Lưu trữ", migration 060) is a flag that almost no
learner or enrollment path checks. Today an archived class:

- still appears on the learner's `/my-class` and `/home`;
- still accepts submissions;
- still enrolls learners through its class code;
- still receives gives and minted codes from its instructor.

Archive and restore through `PATCH /admin/cohorts/{id}` record no actor, time
or reason (`research.md` §1).

The 2026-10-28 review of the first draft found blocking gaps. All of them are
resolved in this version:

- the live 0029 `fn_restore_student` would abort with a 500 (F1);
- the migration number was stale (F2);
- archive metadata and audit were not atomic, and the Python write would break a
  331 test (F3);
- a consistency CHECK would 500 the old backend during the deploy window and
  after a rollback (F4);
- timed Writing auto-submit would be refused (F5);
- an activation racing an archive would leave an activated account behind a raw
  500 (F6);
- deploying would immediately hide the class of 3 staging learners and close 4
  Writing gives (F11, review risk 6).

## Scope

- Migration 337:
  - archive metadata columns on `cohorts`, normalised by a `cohorts` trigger;
  - append-only `class_lifecycle_audit`;
  - service-role-only RPCs `fn_archive_cohort`, `fn_restore_cohort` and
    `fn_cohort_archive_counts`;
  - four SECURITY DEFINER guards that refuse new membership, class work and
    cohort Writing gives in an archived class;
  - `fn_restore_student` (0029) skips archived classes.
- Backend:
  - archive and restore go through the RPCs;
  - read filters on learner surfaces;
  - 409 `cohort_archived` on every admin and instructor write path;
  - Variant A gates on learner work, with the D3 exception;
  - pre-check and race-safe refusal in `/auth/activate`.
- Frontend:
  - truthful archive/restore confirm dialog with counts and an optional reason;
  - a legacy-class badge and "Áp dụng lưu trữ" action;
  - archived labels on the Writing dashboard and instructor class table;
  - pickers show active classes only.
- Release: no learner-visible change at deploy. Classes inactive before 337
  stay as they are until an admin acts on each one.

## Non-goals

- Ending memberships or changing any work row when a class is archived.
- Revoking class codes on archive. They are refused while the class is
  archived and work again after a restore.
- Instructor archive rights. Archive and restore stay admin-only, as today.
- A specific "this class has ended" message for class codes. D4 keeps the
  generic message; a clearer message would be a separate S5 change for all code
  types.
- Variants B and C for open work (`research.md` §9).
- Automatically applying the new rules to classes that were inactive before 337.

## Users and journeys

- **Admin:** archives a finished class with an optional reason after seeing
  what will close, and can restore it later. For each pre-A-10 inactive class,
  the admin either applies the archive or restores the class.
- **Learner of an archived class:** no longer sees the class. Reads drafts and
  results but cannot start or submit new work, and can finish a timed Writing
  essay that was already running.
- **New learner with the class code:** gets the generic invalid-code message.
  Their account and the code are unchanged.
- **Instructor:** sees the class labelled "Đã lưu trữ" and cannot give work or
  mint codes for it.

## Definitions

- **Archived class:** `cohorts.is_active = false AND cohorts.archived_at IS NOT
  NULL`. Every A-10 rule in this spec applies to archived classes only. After
  337, every archive sets `archived_at`: through the RPC, or through the
  `cohorts` trigger when any other writer flips `is_active` from true to false.
- **Legacy inactive class:** `is_active = false AND archived_at IS NULL`. Only
  classes that were already inactive before 337 are in this state. They behave
  exactly as they do today.

## Requirements

- **FR-001:** Archived classes are hidden from learner surfaces:
  - `/my-class` (`GET /class/me`), the `/home` class tile and its to-do count,
    and `GET /class/my-assignments` all omit them;
  - a learner whose only classes are archived gets the "chưa có lớp" state (`has_class=false`);
  - the filter covers both the membership source and the legacy `students.cohort_id` pointer of `active_cohort_ids_for_student`;
  - history and admin callers opt in with `include_archived=True`.
- **FR-002:** No path adds a learner to an archived class:
  - **Class-code activation:** refused before Step 2 and Step 3 of `/auth/activate` with the existing generic 400 message (D4=a). The code is not consumed, no `students` or membership row is written, and `access_code_audit` gets action `enroll_rejected_cohort_archived`.
  - **Admin and instructor writes:** single add, bulk add, add by issuing a code, generating a class code, changing a code's or a learner's `cohort_id`, and instructor minting all return 409 `{"code":"cohort_archived","message":…}`.
  - **Database:** refuses any membership becoming active in an archived class with `cohort_archived`. The check runs in a SECURITY DEFINER guard that locks the class row `FOR SHARE`.
  - **Precedence:** an archived learner in an archived class gets `student_archived` first.
- **FR-003:** An archived class receives no new work:
  - no class assignment, class item, cohort Writing give or class lesson can be created for it (409; the database guards cover assignments, items and gives);
  - late-joiner backfill creates nothing for it, and the roster backfill script skips it;
  - individual gives (`cohort_id IS NULL`) to a learner whose only class is archived stay allowed;
  - replaying an idempotent fan-out request that completed before the archive returns its original receipt.
- **FR-004:** Open work of an archived class takes no new starts, draft edits or submissions (Variant A; 409 `cohort_archived`):
  - submitted work, drafts, essays, grades and feedback are never changed by archive or restore;
  - Writing gives remain listed on `/writing/dashboard` with `class_archived=true`, and their drafts are readable;
  - **D3=a exception:** a timed Writing give with `started_at < cohorts.archived_at` may still save, submit and auto-submit until it is submitted;
  - a timed course session started before the archive still finishes and is finalised by the reaper;
  - every other learner entry point is refused, including class items, grammar lessons, grammar diagnostic, Advanced Vocabulary, timed course starts and new mock sittings;
  - a mock sitting refused this way gets a truthful "class closed" message, not "not in class".
- **FR-005:** Restoring a class returns it and every still-active membership to `/my-class`. Its work reopens under the existing deadlines with no change to work rows, and its class codes enroll again. Learners removed from the class while it was archived do not come back.
- **FR-006:** Archive and restore are atomic and audited:
  - `PATCH /admin/cohorts/{id}` routes any `is_active` change to `fn_archive_cohort` or `fn_restore_cohort`. Each RPC locks the class row `FOR UPDATE` and, in one transaction, writes the flag, `archived_at/by/reason` and one `class_lifecycle_audit` row with the counts from `fn_cohort_archive_counts`;
  - a repeat archive or restore is idempotent and writes no audit row;
  - a name or description edit writes no audit row;
  - the reason is optional, trimmed, at most 500 characters, and empty becomes NULL (D5=a);
  - clients (`anon`, `authenticated`) cannot read the audit, write the archive columns or execute any new function.
- **FR-007:** STUDENTARCHIVE-0029 and the existing guards keep working:
  - `fn_restore_student` skips memberships in archived classes, records them as `skipped_archived_cohort_ids` in its audit row and receipt, never points `students.cohort_id` at an archived class, and keeps `students WHERE id = p_student_id FOR UPDATE`, `SECURITY DEFINER`, its `search_path`, its signature and its ACL (D2=a; 0029 FR-003 amended);
  - 337 adds no client grant;
  - 337 does not name, drop, replace or bypass any migration-331 object;
  - the trigger name `trg_guard_writing_give_cohort_active` is kept.
- **FR-008:** An archive that lands during an activation never yields a 500 or an activated account without a consumed code:
  - if Step 3b of `/auth/activate` hits `cohort_archived`, the request reverts this request's Step 3 changes to `users` (`is_active`, `access_code_used`, `permissions`, and `role` if it promoted) to the values read in Step 2;
  - it does not claim the code, writes `access_code_audit` `enroll_rejected_cohort_archived` with `detail.race = true`, and returns the same generic 400 as FR-002;
  - no database text is ever echoed;
  - if the revert itself fails, the response is 503 `activation_incomplete` with "Kích hoạt chưa hoàn tất. Mã CHƯA được sử dụng — vui lòng thử lại sau ít phút hoặc liên hệ admin.", a critical log line with the request id, and the audit row carries `compensation_failed: true`;
  - an activation whose Step 3b committed before the archive completes normally: the learner is enrolled and the class is then hidden.
- **FR-009:** Deploying 337 and the A-10 code changes nothing a learner sees or can do:
  - 337 sets `archived_at` on no existing row and backfills nothing;
  - its postcondition fails if the number of archived classes (Definitions) after apply differs from the number before. That is 0 on a first apply and unchanged on a re-apply;
  - legacy inactive classes keep today's behaviour for learners, enrollment and work, and admin surfaces label them "Lưu trữ cũ — chưa áp dụng";
  - an admin applies the rules only by an explicit "Áp dụng lưu trữ" (`fn_archive_cohort`, audit `detail.legacy_upgrade = true`) or clears the state with "Khôi phục".
  - On staging, the 3 learners of "QA Course 1 Resume 20261010" keep their class, and its 4 open Writing gives keep accepting work. Their `/my-class` and `/writing/my-assignments` responses are byte-identical before and after deploy.
- **FR-010:** Admin copy is truthful:
  - the archive confirm dialog states that learners will no longer see the class, cannot join it, and that open work stops accepting submissions. It shows the counts from `fn_cohort_archive_counts` (active members, open Writing gives, open class items, unused class codes) and an optional reason field;
  - the restore dialog states that learners see the class again and work reopens under the existing deadlines;
  - admin class detail disables add-learner, give and lesson actions while the class is archived;
  - all strings pass Content review.
- **FR-011:** Every intermediate deploy state is safe:
  - with 337 applied and the old backend still serving, `PATCH {is_active:true|false}` never fails. The `cohorts` trigger normalises the metadata, and there is no consistency CHECK;
  - a "light" rollback (drop the RPCs and guards, keep the columns, trigger and table) leaves the old backend working;
  - a full rollback re-creates the 326 `fn_restore_student` body before dropping the columns, and refuses while audit rows or `archived_by` values exist.

## Acceptance scenarios

### Scenario 1 — archive hides the class and keeps the work

- **Given** an E2E learner in classes E2E-A and E2E-B, with a pending Writing give and a draft in E2E-B
- **When** an admin archives E2E-B with reason "Kết thúc khoá"
- **Then**:
  - `/my-class` shows only E2E-A;
  - the give is listed with `class_archived=true` and its draft is readable but cannot be saved, started or submitted (409);
  - the draft text is unchanged;
  - one `archive` audit row exists with the counts and the reason.

### Scenario 2 — nobody joins an archived class

- **Given** archived class E2E-B
- **When** a new learner activates its class code, and an admin or instructor adds a learner, issues a code, mints a code, gives work or creates a lesson
- **Then**:
  - the learner gets the generic 400, the code stays unused, the account stays inactive, and no row is created;
  - every admin and instructor write returns 409 `cohort_archived`.

### Scenario 3 — archive during activation

- **Given** a fresh learner past the Step 1c pre-check of `/auth/activate` with E2E-B's code
- **When** E2E-B is archived before Step 3b
- **Then**:
  - the response is the generic 400, not a 500;
  - `users.is_active` is false again, the code is unused, and no student or membership row exists;
  - the audit has `enroll_rejected_cohort_archived` with `race=true`.

### Scenario 4 — timed Writing started before the archive

- **Given** a timed give in E2E-B started 5 minutes before the archive
- **When** the learner keeps writing and the timer expires
- **Then** autosave and the auto-submit succeed, and the essay is graded normally.

### Scenario 5 — deploy changes nothing for existing inactive classes

- **Given** staging's legacy inactive class with 3 learners and 4 open Writing gives
- **When** 337 is applied and the A-10 backend and frontend are deployed
- **Then**:
  - the 3 learners' `/my-class` and `/writing/my-assignments` responses are byte-identical to the pre-deploy snapshot;
  - no class has `archived_at` set;
  - admin sees the class as "Lưu trữ cũ — chưa áp dụng".

### Scenario 6 — restore

- **Given** archived E2E-B
- **When** an admin restores it
- **Then** the class returns to `/my-class`, gives reopen under their deadlines, drafts are intact, a `restore` audit row exists, and the class code enrolls again.

### Scenario 7 — restoring an archived learner

- **Given** a learner archived through 0029 whose former classes are E2E-A (active) and E2E-B (archived)
- **When** the admin restores the learner
- **Then**:
  - the restore succeeds;
  - the E2E-A membership is active;
  - E2E-B is listed in `skipped_archived_cohort_ids`;
  - `students.cohort_id` is E2E-A.

## Edge cases

- **Archive vs enroll or give:** the guards lock the class row `FOR SHARE` and
  `fn_archive_cohort` locks it `FOR UPDATE`. If the archive commits first, the
  write is refused. If the write commits first, it is kept and counted. The
  lock order is students (326 functions), then cohorts, and no path takes them
  in reverse.
- **Archive during an activation, after Step 3b committed:** the enrollment
  stands, the Step 6 backfill refusal is logged as a warning, and activation
  returns 200.
- **Re-submitting one's own redeemed class code after the archive:** the
  generic 400 from the pre-check. The account, membership and code are
  unchanged.
- **Legacy `students.cohort_id` pointing at an archived class:** hidden by the
  read filter. A `PATCH /admin/students/{id}` that changes only the name does
  not trip the guard: the sync trigger is `AFTER UPDATE OF cohort_id`.
- **`writing_assignments` guard scope:** it is INSERT-only. No path moves a
  give into an archived class by UPDATE.
- **Old backend archives in the deploy window:** the `cohorts` trigger stamps
  `archived_at`, so the archive is enforced, with no actor and no audit row. The
  runbook asks admins not to archive or restore during the window.
- **Timed-course retry start after the archive:** this is a new start and is
  refused. Whether any reaper or retry path inserts class items after a start
  is verified in T002a.
- **A class archived through 0030 and then deleted:** the audit has no FK, so
  its rows remain.

## Success criteria

- Zero learner-visible changes at deploy (FR-009 snapshot equality on staging).
- Zero 500s on `/auth/activate`, `PATCH /admin/cohorts/{id}` and the 0029
  restore caused by an archived class.
- Every archive and restore performed through the app has exactly one audit
  row.
- No new submission is accepted in an archived class except the D3 timed
  exception.

## Open questions

- None block implementation.
- Content review of the Vietnamese strings (`ui-states.md`) is required before
  merge of the implementation PR.
- Production per-class decisions follow the D6 read-only check (`rollout.md`).
