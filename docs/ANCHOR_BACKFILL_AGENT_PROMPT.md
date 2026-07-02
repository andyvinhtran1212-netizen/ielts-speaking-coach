# Agent Prompt — Anchor Backfill hàng loạt

> Cách dùng: với mỗi agent, copy khối `=== PROMPT ===`, thay `{{ASSIGNMENT}}` bằng danh sách bài từ `docs/ANCHOR_BACKFILL_LIST.md` (4–10 bài/agent). Các agent sửa file độc lập → chạy song song được, nhưng LƯU Ý điều phối bên dưới.

## ⚠️ Điều phối bắt buộc
- **Luôn chừa lại ≥1 bài KHÔNG anchor** trong toàn hệ thống (test `test_grammar_loader_anchors.py` yêu cầu). Đừng giao hết 63 bài; giữ lại cụm `grammar-for-writing` (3 bài) làm bài chưa-anchor, HOẶC báo người phụ trách cập nhật test trước khi làm nốt.
- Bài `status: updating` → BỎ QUA.

## Ví dụ ASSIGNMENT
```
- backend/content/tenses/past-continuous.md
- backend/content/tenses/present-perfect-continuous.md
- backend/content/verb-patterns/modal-verbs.md
- backend/content/verb-patterns/phrasal-verbs.md
```

## === PROMPT ===

Bạn là biên tập viên metadata cho Grammar Wiki (IELTS). Nhiệm vụ: thêm **deep-link anchors** cho các bài được giao, xuất chỉnh sửa **in-place**, đảm bảo qua HARD gate `verify_anchor_drift.py`.

Thư mục làm việc: `/Users/trantrongvinh/code/ielts-speaking-coach`

### BÀI ĐƯỢC GIAO
{{ASSIGNMENT}}

### BƯỚC 0 — Đọc chuẩn
1. `docs/ANCHOR_BACKFILL_GUIDE.md` — hợp đồng đầy đủ.
2. `backend/content/tenses/past-perfect.md` — bài MẪU đã làm (xem block `anchors:` cuối frontmatter + các dòng `<!-- anchor: ... -->` trong thân bài). BẮT CHƯỚC đúng cách này.

### VỚI MỖI bài
1. Đọc toàn bài. Nếu `status: updating` → bỏ qua, ghi chú.
2. `grep -nE "^#{2,3} "` để lấy danh sách heading.
3. Chọn **5–9 section** để neo (ưu tiên: `## Tóm tắt`=overview; `### Cấu trúc`=structure; mỗi mục Cách dùng chính=section; khái niệm quan trọng như `### Dấu hiệu nhận biết`=concept; mỗi `## So sánh ... vs ...`=compare-with; ít nhất `### Lỗi 1`=pitfall). Bỏ qua "Bài tập luyện", "Tóm tắt nhanh", ví dụ phụ.
4. Đặt `id` = `<slug>.<section>[.<detail>]` (ASCII kebab-dot, DUY NHẤT toàn hệ thống). VD `modal-verbs.usage.obligation`.
5. Thêm block `anchors:` vào **cuối frontmatter** (ngay trước `---` đóng), mỗi mục:
   ```
     - id: <id>
       location: '<chép nguyên văn dòng heading, kể cả ##>'
       type: overview|structure|section|concept|pitfall|compare-with
   ```
6. Thêm `<!-- anchor: <id> -->` **một dòng riêng, ngay trên** heading tương ứng (không chèn dòng trống giữa marker và heading). `id` trong marker phải trùng khít frontmatter.

### RÀNG BUỘC CỨNG (sai là CI đỏ)
- Mỗi anchor khai báo PHẢI có body marker khớp; mỗi marker PHẢI được khai báo (không thừa/thiếu).
- `location` PHẢI khớp một heading THẬT trong bài (chép nguyên văn; đừng đổi heading).
- KHÔNG sửa văn xuôi/nội dung; KHÔNG đổi slug/category/heading. Chỉ THÊM marker + block anchors.
- id KHÔNG trùng với bài khác.

### BƯỚC CUỐI — Self-check (bắt buộc, lặp đến khi sạch)
```
cd /Users/trantrongvinh/code/ielts-speaking-coach && python3 backend/scripts/verify_anchor_drift.py
```
Phải in `OK ...` và exit 0, KHÔNG có violation nào cho bài của bạn (missing_marker / location_mismatch / reverse_drift). Sửa đến khi sạch.

### TRẢ VỀ
Mỗi bài: đường dẫn, số anchor đã thêm, danh sách id, kết quả self-check (PASS). Ghi rõ bài nào bỏ qua (updating) + lý do.

## === HẾT PROMPT ===
