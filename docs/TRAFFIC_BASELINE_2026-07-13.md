# Traffic baseline & exposure-floor calibration (B36) — 2026-07-13

Nguồn: `backend/scripts/traffic_baseline.sh` (read-only) chạy trên production
2026-07-13T06:54Z. Đây là đầu vào bắt buộc của quantitative register trước
Phase 2 (plan v3 §16, B36): floors phải xuất phát từ traffic đo được, không
phải con số tuyệt đối áp cho mọi route.

## Số liệu 14/28 ngày

| Flow | 14d | 28d | Ghi chú |
|---|---:|---:|---|
| Speaking: sessions created | 727 | 1504 | ~52/ngày — flow lớn nhất |
| Speaking: responses graded | 713 | 1404 | |
| Writing: essays submitted | 44 | 155 | ~3/ngày |
| Reading: test attempts | 85 | 123 | |
| Listening: test attempts | 271 | 327 | |
| Listening: drills / dictation | 0 | 0 | **Zero traffic** — có route, không có users |
| Vocab: quiz attempts / sessions | 1249 / 118 | 1249 / 118 | d14=d28 → toàn bộ trong 14 ngày (feature mới/burst cohort) |
| Vocab: D1 / flashcards | 1 / 0 | 1 / 0 | Zero/near-zero |
| Grammar: article views | 14 | 30 | **~1/ngày** — điểm nghẽn pilot #2. ⚠ Số này đếm theo `created_at` nhưng `article_views` unique theo (user, slug) — lượt đọc lại chỉ bump `view_count`/`last_viewed_at`, nên đây là **cận dưới** (số cặp người-bài MỚI). Script đã sửa sang đếm cặp active theo `last_viewed_at`; chạy lại sát cutover. Kể cả hệ số 3-5×, kết luận low-traffic profile không đổi |
| MCQ exam attempts | 0 | 0 | Zero |
| Mock exam sittings | 18 | 18 | Feature mới (retake vừa ship) |
| Analytics events | 5473 | 9331 | page_view 2399/14d; vocab_wiki_viewed 2868/14d |

Active users 14 ngày: speaking 31 · listening 28 · reading 15 · writing 14.

## Hệ quả cho exposure floors (§12.3)

1. **Grammar article pilot (#2) KHÔNG THỂ đạt floor "100 interactions/7 ngày"** —
   traffic thật ~1 view/ngày → cần ~100 ngày. Đây chính xác là kịch bản B36 dự
   báo. Pilot #2 phải dùng **low-traffic cutover profile** (pre-approved):
   window 21 ngày **và** ≥20 real interactions **và** synthetic crawl toàn bộ
   137+ bài (status/canonical/render diff) **và** kill-path drill; ghi rõ là
   risk acceptance, không giả mạo sample.
2. **Speaking core routes dư floor 24×** (713 graded/14d vs floor 30) — giữ
   nguyên floor 30/14 ngày của plan.
3. **Writing mutation**: 44 essays/14d — floor 50 của plan hụt nhẹ; hạ floor
   writing xuống **30/14 ngày** (vẫn >2/ngày thật) hoặc kéo window 21 ngày.
4. **Listening test**: 271/14d — floor mặc định ổn. Reading: 85/14d — ổn.
5. **Zero-traffic routes** (drills, dictation, flashcards, MCQ exams, D1):
   floor theo interactions là vô nghĩa. Chính sách đề xuất: dark launch +
   synthetic-only verification + atomic cutover với risk acceptance — không
   giữ soak window dài cho route không có người dùng. Đánh dấu các route này
   trong ROUTE_LEDGER để batch migrate sớm (blast radius ≈ 0).
6. **Vocab quiz**: volume cao nhưng bursty (d14=d28) — khi tới lượt domain
   vocab, đo lại 14 ngày sát cutover thay vì dùng số này.

## Bảng floors đề xuất (đưa vào quantitative register trước Phase 2)

| Loại route | Floor đề xuất | Window |
|---|---|---|
| Public/read-only, traffic ≥3/ngày | 100 interactions | 7 ngày |
| Public/read-only, traffic <3/ngày (Grammar…) | 20 interactions + synthetic crawl | 21 ngày |
| Authenticated mutation, traffic ≥3/ngày | 50 attempts | 14 ngày |
| Authenticated mutation, traffic <3/ngày (Writing hiện tại) | 30 attempts | 14–21 ngày |
| Core grading/exam (Speaking/Listening) | 30 attempts + cross-version resume | 14 ngày |
| Zero-traffic routes | synthetic-only + risk acceptance | không soak kéo dài |

Mọi floor vẫn chịu điều khoản bất biến của §12.3: một vi phạm
persistence/security invariant = rollback ngay bất kể sample size.

Đo lại: chạy lại script này sát mỗi cutover (traffic thay đổi theo cohort);
số trong tài liệu này là baseline 2026-07-13, không phải hằng số.
