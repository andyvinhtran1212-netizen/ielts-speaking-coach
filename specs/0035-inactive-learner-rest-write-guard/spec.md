---
id: INACTIVEWRITE-0035
title: An inactive account cannot write Vocabulary or flashcard rows through any path, including direct Supabase REST
status: approved
risk: high
owner: product
---

# An inactive account cannot write Vocabulary or flashcard rows through any path, including direct Supabase REST

Approval: approved by Vinh on 2026-10-28, including the three defaults below
(see [`approval-decision.md`](approval-decision.md)).
Locked migration number: **335** (assigned by the Leader on 2026-10-28).
Origin: Security Auditor finding SEC-20261028-02 (P3/Low, 2026-10-28), staging
`zjphffoujxkpltixsbzj`.

## Tóm tắt (tiếng Việt)

Tài khoản chưa kích hoạt (chưa nhập mã, hoặc bị tắt khi lưu trữ học viên) đã bị
FastAPI chặn với lỗi "Tài khoản chưa được kích hoạt". Nhưng nếu gọi thẳng
Supabase REST bằng JWT của chính mình, tài khoản đó vẫn thêm/sửa/xoá được từ
vựng và thẻ flashcard của mình (5 bảng, cộng cờ `is_active` của câu hỏi D1).
Migration 335 thêm chốt chặn trong database: mọi lệnh ghi bằng JWT học viên lên
các bảng này phải là tài khoản đang kích hoạt. Tài khoản chưa kích hoạt thêm
dòng sẽ bị từ chối (403), sửa/xoá sẽ không có dòng nào thay đổi. Học viên đang
học bình thường không thấy thay đổi gì; dữ liệu cũ không bị đụng tới; tài khoản
chưa kích hoạt vẫn đọc được dữ liệu cũ của mình qua REST (như hiện nay).

## Problem

W-03 requires an activated account (`users.is_active`) for every learner
feature, and FastAPI enforces it (`services/activation_gate.py`). Migration 320
deliberately kept `INSERT/UPDATE/DELETE` for `authenticated` on
`user_vocabulary`, `flashcard_stacks`, `flashcard_cards`, `flashcard_reviews`,
`flashcard_review_log` and `UPDATE (is_active)` on `user_d1_questions`, because
`routers/flashcards.py` and `routers/vocabulary_bank.py` write them with the
learner's JWT. Their RLS policies check only ownership (`auth.uid() =
user_id`), with no activation check. So an inactive account can call
`POST /rest/v1/user_vocabulary` (and the other tables) with its own JWT and
write without limit. Rows without IPA/definitions are then picked up by the
admin enrichment batch (`POST /admin/vocab/backfill-enrichment`, Gemini):
small indirect AI spend and attacker-chosen headwords in an admin batch.
Staging catalog on 2026-10-28 confirmed the grants and owner-only policies, and
found no existing inactive-owned vocabulary rows.

## Scope

- Migration 335: a private helper `app_private.is_current_user_active()` and
  RESTRICTIVE `INSERT`/`UPDATE`/`DELETE` policies `TO authenticated` on the six
  tables above; catalog-driven postconditions.
- Tests: static contract plus PostgreSQL behaviour on the post-320 staging
  shape (PostgreSQL 16 and 17), including the exploit as a negative control.
- `backend/migrations/README.md` note.

## Non-goals

- Changing FastAPI, the frontend or the W-03 gate: active accounts see no change.
- Hiding an inactive account's existing rows from its own REST reads (SELECT stays unchanged).
- Moving the learner-JWT writes to `service_role` (larger change of the 320 contract).
- Hardening the admin enrichment batch (skip inactive owners, per-user row cap, prompt-injection filtering): a follow-up; a row cap is a product decision.
- PostgREST rate limiting.

## Users and journeys

- An inactive account (never activated, or deactivated by an archive) tries to write its own vocabulary or flashcards directly through Supabase REST: it is refused, as it already is through FastAPI.
- An active learner uses the Vocabulary bank, flashcards, SRS review and D1 archive/restore as today.
- Admin tools, D1 finalization and the enrichment batch keep writing through `service_role`.

## Requirements

- **FR-001:** For an account whose `users.is_active` is false, NULL or missing, every direct client write with its JWT is refused: an `INSERT` into any of the six tables (including through the SECURITY INVOKER `fn_apply_srs_review_idempotent`) fails with SQLSTATE 42501 (PostgREST 403), and an `UPDATE` or `DELETE` changes no row.
- **FR-002:** For an active account every current write keeps working, the existing ownership checks are unchanged (no write to another account's rows), and reads (SELECT) are unchanged for every account.
- **FR-003:** `service_role`, the table owner and FK cascades are unaffected (they write for any account, including an inactive one).
- **FR-004:** The activation test is `app_private.is_current_user_active()`: SECURITY DEFINER, STABLE, `search_path = ''`, keyed only on `auth.uid()`, in a schema PostgREST does not expose, executable by `authenticated` but not `anon`/PUBLIC; a change to `users.is_active` takes effect on the next statement.
- **FR-005:** Migration 335 is forward-only in one transaction with `lock_timeout = '5s'`, changes no data, is re-runnable, aborts unless 320 is applied, and fails if any `public` table that `authenticated` can write (table- or column-level) lacks the matching restrictive policy, or if the helper is not pinned, is anon-executable or its owner is subject to RLS on `users`.

## Acceptance scenarios

### Scenario 1 — inactive account, direct REST

- **Given** an account with `users.is_active = false` and a valid JWT
- **When** it calls `POST /rest/v1/user_vocabulary` with its own `user_id`
- **Then** the response is 403 (42501) and no row is created; `PATCH`/`DELETE` on its rows change nothing

### Scenario 2 — active learner

- **Given** an active learner
- **When** they add a word, build a stack, review a card or archive a D1 question in the app, or `POST /rest/v1/user_vocabulary` directly
- **Then** the write succeeds (201) as before

### Scenario 3 — activation changes

- **Given** a learner who is archived with deactivation and later restored
- **When** they write after each change
- **Then** the write is refused while inactive and allowed again once active

## Edge cases

- `users` row missing, or `is_active` NULL: treated as inactive (same as `activation_gate.lookup_is_active`).
- Dashboard-created permissive policies: restrictive policies are AND-ed with every permissive policy, so a drifted permissive policy cannot bypass the check.
- A future migration granting a new client write must add the restrictive policy; re-applying 335 detects the gap.
- 320 forbids client-executable SECURITY DEFINER functions in `public`; the helper lives in `app_private`, so re-applying 320 still passes.

## Success criteria

- On staging after apply, the read-only catalog query in the 335 header returns zero rows.
- An inactive QA JWT gets 403 on `POST /rest/v1/user_vocabulary`; an active QA JWT gets 201 (row deleted afterwards).
- Existing Vocabulary/flashcard suites and the staging E2E stay green.

## Decisions (approved by the owner, 2026-10-28)

1. Block `DELETE` too (not only `INSERT`/`UPDATE`): consistent with the FastAPI gate, which already refuses deletes for inactive accounts.
2. Leave reads unchanged: an inactive account may still read its own existing rows through REST.
3. Enrichment-batch hardening and a per-user row cap are a separate follow-up.

## Open questions

- None. The owner confirmed the three defaults above on 2026-10-28.
