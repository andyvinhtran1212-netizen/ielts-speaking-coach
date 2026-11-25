---
id: REGIVE-0103
title: A teacher can give a class a course lesson bank it already received, and a retried give still creates it once
status: draft
risk: high
owner: product
---

# Re-give a course lesson bank to the same class

Status: **draft, awaiting Andy's approval of this text.** Background in the
project thread "Cho giao lại bài đã giao, chỉ ghi chú" (25/11): Andy asked for
the change (09:36Z), chose Course banks only with Speaking deferred, chose the
unique-index migration, and chose on 14:56Z to write this spec before #2694
merges. He has not yet approved the text. Spec number 0103 is the next free
number (0102 is held by SCOREPAIR). Migration number **509** (503–507 are held
by open PRs). Production carries the same change as hotfix #2693, under the
exception Andy confirmed.

## Tóm tắt (tiếng Việt)

Ở Admin > Lớp & Học viên > lớp > tab Bài tập > "Giao bài lớp", một Bộ bài tập
(course) lớp đã nhận trước đó đang bị khoá, và giao lại thì báo lỗi 409. Sau
thay đổi này, bài đó vẫn chọn được, kèm ghi chú "Đã giao ngày DD/MM/YYYY · giao
lại được". Giao lại có chủ ý tạo một bài mới; kết quả bài cũ giữ nguyên. Bấm lại
cùng một lần giao (mạng chập chờn, bấm hai lần) không tạo bài thứ hai; một chỉ
mục duy nhất trong DB (migration 509) chặn cả trường hợp hai yêu cầu chạy cùng
lúc. Speaking vẫn mỗi lớp một lần như hiện nay.

## Problem

`POST /admin/cohorts/{cohort_id}/assignments` with `skill='course'` refuses a
lesson bank that the class already received (409), and the course-banks catalog
marks it `already_given`, so the homework editor disables it. Teachers want to
re-give an earlier bank for revision. Removing the refusal alone would let a
retry after a lost response, or two in-flight requests, fan out a second
assignment to the whole class.

## Scope

- Course daily gives: drop the per-class duplicate refusal; each deliberate give
  is a new `class_assignments` row with its own items.
- Catalog and editor: show when the bank was last given to this class and keep
  it selectable.
- Retry safety: the give carries `give_request_id`; a retry of the same intent
  returns the first receipt; a database unique index decides concurrent
  duplicates.

## Non-goals

- Speaking topics and lesson sets stay one per class (migration 182 unique
  index). Re-giving them needs dropping that index and is deferred.
- No change to Grammar lesson gives (already idempotent through migration 312).
- No change to learner play, scoring or results; the learner side already picks
  the unfinished, then newest, item when a bank has several assignments.
- No data backfill. Existing rows carry no request id and are untouched.

## Users and journeys

- **Admin / teacher:** opens a class, "Giao bài lớp", picks a Course bank that
  shows "Đã giao ngày … · giao lại được", reads the note that a re-give creates a
  new assignment and keeps old results, and gives it.
- **Learner:** sees the new assignment next to the old one; old results remain.

## Requirements

- **FR-001:** A course daily give that carries `give_request_id`, of a bank this class already received, is accepted and creates a new assignment with fresh items; no 409 for a previous give. The course-banks catalog returns `last_given_at` (the latest give's `created_at` for this class, read in pages) and `can_regive: true`; the Speaking catalogs return `last_given_at` and `can_regive: false` and keep refusing a second give.
- **FR-002:** The Next homework editor keeps a bank with `already_given` and `can_regive: true` selectable, labels it "Đã giao ngày DD/MM/YYYY · giao lại được" in Vietnam time, and shows "Lớp này đã được giao bài này ngày …" with a note that a re-give creates a new assignment and keeps previous results. Items with `can_regive` false stay disabled as before.
- **FR-003:** A course give carries `give_request_id`. The editor sends the same id for a retry of the same intent and a new id after the editor closes. The server stores the id and a fingerprint of the request (all fields except the id) in `content_config`. A later request with the same class and id and the same fingerprint returns the stored receipt without creating anything; the same id with a different fingerprint gets 409 and creates nothing.
- **FR-004:** Migration 509 adds the partial unique index `uq_course_give_request` on `class_assignments (cohort_id, content_config->>'give_request_id') WHERE skill='course' AND content_config ? 'give_request_id'`. When two requests with the same id are in flight, exactly one row is created; the loser catches the violation and returns the winner's receipt. Rows without an id, other classes and other skills are unaffected. The rollback drops the index. 509 is `pending_feature course_give_request`: it is applied on each environment under the advisory lock with the owner's typed approval, before code that relies on it reaches that environment.
- **FR-005:** A course give without `give_request_id` (an old tab, or a frontend older than the backend) keeps the previous behaviour: a second give of the same bank to the same class gets 409 and creates nothing, with a message telling the teacher to reload the page and give again from the new editor. A first give without an id still works. This holds in every deploy order of frontend and backend, because migration 509 does not cover rows without an id.

## Acceptance scenarios

### Scenario 1: deliberate re-give

- **Given** a staging test class that already has Course bank X with a learner result
- **When** the admin gives X again from the editor
- **Then** the picker showed "Đã giao ngày …", a second assignment exists, and the first assignment's result is unchanged

### Scenario 2: retry of the same give

- **Given** a give of bank X with request id R that succeeded
- **When** the same request (same class, id R, same fields) is sent again, sequentially or in parallel
- **Then** both responses carry the same assignment id and only one assignment row has id R

### Scenario 3: reused id with a changed intent

- **Given** a stored give with id R
- **When** a request with id R and a different bank or due date arrives
- **Then** the server returns 409 and creates nothing

### Scenario 4: old client without a request id

- **Given** a staging test class that already has Course bank X
- **When** a give of X is sent without `give_request_id` (the old payload), once and then again as a resend
- **Then** both get 409 with the reload message and no new assignment exists; a give of X with a new id then succeeds

## Edge cases

- A give without `give_request_id` (old client) is refused for a bank the class already has (FR-005); the current Next editor always sends one for Course gives.
- The receipt lookup itself fails: the give returns 500 rather than risk a duplicate; the unique index still prevents a second row with the same id.
- The class is archived between the replay check and the insert: the existing migration 337 guard still refuses.

## Success criteria

- On staging, a re-give of a course bank creates a new assignment and keeps the old result; a repeated id produces one row.
- 509 is present and valid (`indisunique`, `indisvalid`) on staging, then production, before the code reaches each environment.

## Open questions

- None blocking. Speaking re-give is a separate decision.
