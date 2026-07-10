# Tech debt: content backfill for the depth/quality gates

*Audit Giai đoạn 3 (#6 reading, #7a quiz, #7 vocab). **PARKED / tech debt**
(quyết định 2026-07-10): các GATE + GENERATOR đã merge (PRs #702/#705), nhưng
CHẠY generator để phủ nội dung + review + merge là một job ops chưa làm — cần
`GEMINI_API_KEY`, tốn phí LLM, và cần người spot-check. Hoãn, làm dần theo pilot.*

## Vì sao parked

Ba gate đo được khoảng trống hiện tại (đã có công cụ chạy):
- Reading solution depth: **1/40** mỗi đề (`python -m scripts.check_reading_solution_depth`).
- Quiz why_wrong: **0/1575** câu (`python -m scripts.check_quiz_why_wrong --rank`).
- Vocab D1: gate chất lượng đã bật ở generation; item-stats chờ đủ attempt.

Lấp khoảng trống = sinh draft bằng LLM + người review. Không tự động-hoá hết
được (spot-check người là bắt buộc để không đẩy hàng loạt sư phạm chưa kiểm
chứng — đúng luận điểm audit).

## Quy trình khi làm (draft → gate máy → adversarial LLM → spot-check người)

Mỗi generator: sinh draft → adversarial-verify LLM → chạy gate máy → ghi file
DRAFT (KHÔNG đụng content live). Người duyệt các mục gắn ⚠ rồi merge cái đạt.

**#6 reading** (`docs/content-samples`/`backend/content/reading/*.md`):
```
export GEMINI_API_KEY=...
python -m scripts.gen_reading_solutions content/reading/l3-academic-reading-test-1.md \
    --out drafts/l3-t1.yaml            # --dry-run xem trước miễn phí
```
→ spot-check ⚠ → dán solution đạt vào md → `check_reading_solution_depth --strict`
trong content-CI khi phủ đủ.

**#7a quiz** (`docs/grammar-quiz-banks/G-*.md`):
```
python -m scripts.check_quiz_why_wrong --rank        # chọn bank gap lớn nhất
python -m scripts.gen_quiz_why_wrong docs/grammar-quiz-banks/<bank>.md --out drafts/ww.yaml
```
→ spot-check → dán `why_wrong` vào bank → `check_quiz_why_wrong --strict` khi xong.

**#7 vocab D1** (`vocabulary_exercises`, DB):
```
python -m scripts.gen_d1_distractor_review --status draft --out drafts/d1-review.yaml
python -m scripts.check_d1_item_stats --flagged-only     # khi có attempt data
```
→ sửa/loại item bị gắn cờ trong admin tool.

## Cách làm khuyến nghị: pilot → đo → scale

Pilot nhỏ (1 đề reading + 10 bank quiz + N bài D1) → đo **tỉ lệ draft duyệt-không-sửa**.
Nếu >80% → scale tự tin; nếu thấp → sửa prompt generator trước khi scale.

## Resume trigger

Có `GEMINI_API_KEY` + thời gian review. Làm theo pilot, không big-bang. Bật cờ
`--strict` của từng gate trong content-CI **sau khi** phủ đủ (bật sớm sẽ đỏ build
ở mức 1/40, 0/1575 hiện tại).

Liên quan: gate ở `backend/services/reading_solution_depth.py`,
`backend/services/quiz_why_wrong.py`, `backend/services/d1_quality.py`.
Gold-set job (khác): `docs/TECH_DEBT_gold_set_A1.md`.
