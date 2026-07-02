# Anchor Backfill — Hướng dẫn (Authoring Guide)

> **Mục tiêu:** thêm **deep-link anchors** cho ~63 bài Grammar Wiki chưa có, để: (a) TOC/link sâu cuộn tới đúng mục, (b) cho phép feedback chấm bài trỏ tới **đúng section** (mapping cấp-section) trong tương lai.
>
> **Khung giá trị trung thực:** hiện `feedback-anchor-mapping.yaml` **đã resolve đủ** (mọi mapping active trỏ tới bài đã có anchor) → backfill KHÔNG mở khoá feedback đang chạy; nó *chuẩn bị nền* cho deep-link + mapping cấp-section sau này. Đây là việc "nâng chất nền", không phải fix gấp.
>
> File này là **hợp đồng bắt buộc**: sai là CI đỏ (`verify_anchor_drift.py` là HARD gate). Đã đối chiếu với `backend/services/grammar_content.py` + `backend/scripts/verify_anchor_drift.py`.

---

## 0. Anchor gồm 2 phần — PHẢI có cả hai

1. **Body marker** trong nội dung: một dòng `<!-- anchor: <id> -->` **ngay trên** heading cần neo. Loader biến nó thành `<a id="<id>">` để trình duyệt cuộn tới.
2. **Khai báo frontmatter** trong list `anchors:` — `{ id, location, type }`. Đây là "sổ đăng ký" cho matcher feedback.

> Chỉ có 1 trong 2 = **drift** = CI đỏ. Marker không khai báo → reverse-drift. Khai báo không marker → hotlink rơi về đầu trang. `location` không khớp heading → location-mismatch.

---

## 1. Quy tắc từng trường (frontmatter `anchors:`)

| Trường | Quy tắc |
|--------|---------|
| `id` | ASCII kebab-dot, regex `[A-Za-z0-9_.-]+`. **Convention:** `<slug>.<section>[.<detail>]`. Slug giữ nguyên gạch nối; các tầng ngăn bằng **dấu chấm**. VD: `past-perfect.compare-with.past-simple`, `articles.indefinite.when-to-use`. **Duy nhất toàn hệ thống** (không trùng id giữa các bài). |
| `location` | **Chép nguyên văn dòng heading** (kể cả `##`/`###`). Loader chuẩn hoá bằng cách bỏ `#` + trim, nên `'## Tóm tắt'` và `'Tóm tắt'` đều khớp — cứ chép cả `##` cho an toàn. Đặt trong nháy đơn nếu có ký tự đặc biệt. |
| `type` | Một trong: `overview` · `structure` · `section` · `concept` · `pitfall` · `compare-with`. |

## 2. Body marker

```
<!-- anchor: past-perfect.overview -->
## Tóm tắt
```
- Marker đứng **một dòng riêng, ngay trên heading** (không chèn dòng trống giữa marker và heading).
- `id` trong marker **trùng khít** `id` khai báo frontmatter.

---

## 3. Nên neo những section nào (5–9 anchor/bài)

Ưu tiên các mục "có giá trị điều hướng / hay bị trỏ tới khi chấm":
- `overview` → `## Tóm tắt`.
- `structure` → `### Cấu trúc` (nếu có).
- `section` → mỗi mục **Cách dùng** chính.
- `concept` → mục khái niệm quan trọng (vd `### Dấu hiệu nhận biết`, `### since vs for`).
- `compare-with` → mỗi `## So sánh ... vs ...`.
- `pitfall` → các lỗi quan trọng trong `## Lỗi thường gặp` (neo từng `### Lỗi N: ...` đáng chú ý, ít nhất lỗi #1).

Không cần neo mọi heading (bỏ qua "Bài tập luyện", "Tóm tắt nhanh", "Ví dụ" phụ nếu không quan trọng).

---

## 4. TUYỆT ĐỐI KHÔNG
- **Không sửa văn xuôi / nội dung bài** — chỉ THÊM dòng marker + block `anchors:`.
- Không đổi `slug`, `category`, heading text (đổi heading sẽ phá `location`).
- Không đặt id trùng bài khác.
- Không neo bài đang `status: updating` (chưa có thân bài ổn định) — bỏ qua.

---

## 5. Ràng buộc CI phải qua
1. **`verify_anchor_drift.py`** (HARD, mặc định strict): mọi anchor khai báo có marker khớp; `location` khớp heading thật; không reverse-drift; mọi mapping active vẫn resolve.
2. **`backend/tests/test_grammar_quiz_banks.py`** không liên quan — nhưng lưu ý gate #3.
3. ⚠️ **`test_grammar_loader_anchors.py::test_loader_returns_empty_anchors_for_articles_without`** yêu cầu **tồn tại ≥1 bài KHÔNG có anchor**. → **KHÔNG backfill 3 bài cuối cùng** một lượt cho tới khi con người cập nhật test này. Xem "Điều phối" trong `ANCHOR_BACKFILL_LIST.md`.

---

## 6. Quy trình cho agent (mỗi bài)
1. Nhận 1 bài từ `docs/ANCHOR_BACKFILL_LIST.md` (đường dẫn `backend/content/<cat>/<slug>.md`).
2. Đọc bài; nếu `status: updating` → bỏ qua, ghi chú.
3. Liệt kê heading (`grep -nE "^#{2,3} "`).
4. Chọn 5–9 section theo §3; đặt `id` theo §1.
5. Thêm block `anchors:` vào **cuối frontmatter** (ngay trước `---` đóng).
6. Thêm `<!-- anchor: id -->` ngay trên mỗi heading tương ứng (§2).
7. **Self-check:** `cd <repo> && python3 backend/scripts/verify_anchor_drift.py` → phải exit 0, không violation nào cho bài của bạn.
8. Không đụng bài khác.

---

## 7. Tham chiếu
- **Bài mẫu chuẩn (đã làm, PASS gate):** `backend/content/tenses/past-perfect.md` — xem block `anchors:` + các marker trong thân bài, và bài anchored gốc `tenses/present-perfect.md`.
- Danh sách bài cần backfill: `docs/ANCHOR_BACKFILL_LIST.md`.
- Prompt fan-out: `docs/ANCHOR_BACKFILL_AGENT_PROMPT.md`.
- Gate: `backend/scripts/verify_anchor_drift.py` (đọc docstring để hiểu 2 lớp kiểm).
