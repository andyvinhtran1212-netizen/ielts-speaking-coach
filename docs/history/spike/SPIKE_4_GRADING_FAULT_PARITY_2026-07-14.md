# SPIKE 4 — Grading fixture: payload/UI/DB parity, ambiguous commit, partial persistence

Plan Phase 2, critical-risk spike #4. **Artifact:** ma trận fault + persistence
được code-verify TOÀN BỘ và live-verify đường quan trọng nhất (backend local
`GRADING_PROVIDER_MODE=fixture` + `GRADING_FIXTURE_FAULT` trỏ staging Supabase
— staging env KHÔNG bị đổi config).

## Trình tự persist (happy path)

Storage audio → **responses upsert** (grading.py:1002, sau khi mọi AI call
xong) → grading_events (best-effort) → tokens_used (best-effort) →
grammar_recommendations (best-effort, practice). Ba bước cuối fail-soft — mất
chúng không mất bài chấm.

## Ma trận fault (`GRADING_FIXTURE_FAULT`)

| Fault | Client nhận | DB sau đó |
|---|---|---|
| `timeout` / `429` / `5xx` / `malformed` | **HTTP 200 + stub** `{_stub:true, _error, response_id, partial:false}` — KHÔNG phải HTTP error | **responses row ĐÃ persist**: transcript + signals đầy đủ, `grading_status="failed"`, band null |
| persist full-row fail | 200 stub, `partial:true` | core-row (cột con) persisted |
| persist cả core-row fail | **500 `response_persist_failed`** (P0-2, fail-loud) | KHÔNG có row — `/complete` sẽ 422 |

**Live-verified (2026-07-14, session `bd113b35`, row `92629b94`):**
- fault=timeout → 200 `_stub:true` + row `grading_status=failed`, transcript
  fixture persisted, band null ✓
- replay CÙNG (session, question) không fault → **CÙNG row id**, `failed` →
  `completed`, band 6.0, **đúng 1 row** ✓

## Ambiguous commit

Cửa sổ: sau upsert (:981), trước khi client nhận 200. Retry cùng
(session_id, question_id) → read-then-write tìm thấy row → **UPDATE, không
duplicate**; unique index migration 077 chặn cả race 2 request song song.
→ **Retry sau timeout LUÔN an toàn** (semantics latest-wins — cùng kết luận
SPIKE 2). Client Next có thể tự tin retry-on-network-error cho grading.

## Fixture parity (những gì fixture ≠ production)

Chạy ĐỦ trên fixture: validator + band snapping/cross-check, heuristic caps
(word count), reliability caps, off-topic penalty, grammar_recommendations
attach, toàn bộ persistence. **Gaps (chấp nhận, ghi nhận):** (1) sample/improved
answer KHÔNG regenerate (client=None); (2) pronunciation là hằng fixture
(78.0/80/76/95); (3) transcript Whisper là văn bản cố định 74 từ, duration
45s — nghĩa là E2E fixture không thể test các gate phụ thuộc audio thật
(audio_too_short với bản ghi ngắn thật, transcript rỗng). Các gate đó vẫn
CHẠY trên giá trị fixture (45s pass mọi min/max).

## Phán quyết

**Exit criteria: ĐẠT.** Mọi partial-persistence state được enumerate + đường
nguy hiểm nhất live-proven; không có fault mode nào tạo duplicate hay mất-bài-
chấm-im-lặng (P0-2 fail-loud đúng thiết kế). Hợp đồng cho UI Next: stub 200
`_stub:true` phải render "AI tạm thời không chấm được — bản ghi đã lưu" (KHÔNG
phải error page), và retry cùng câu là an toàn.
