# Tasks

Mỗi task một PR vào `staging`, nhánh `codex/<task>`, lớp `feature`, `Spec: GRAMMARFIG-0084`, sau khi spec `approved`.
G11-T06 là chính PR spec này. Số task = số nhiệm vụ trong gói.

- [ ] T33 (G11-T33) Renderer khối `figure` và CSS. `depends: spec approved; xem bảng gói mục 6`
- [ ] T34 (G11-T34) Nội dung sơ đồ thí điểm. `depends: spec approved; xem bảng gói mục 6`

Bảng phụ thuộc của cả gói và chi tiết từng nhiệm vụ (gói mục 6, chép nguyên):

| Mã | Tên | Phần | Phụ thuộc | Phiên | Độ khó |
|---|---|---|---|---|---|
| G11-T33 | Renderer khối `figure` + CSS | G3 | T06 | 2 | 4 |
| G11-T34 | Nội dung sơ đồ thí điểm 5 bài | G3 | T33 | 1 | 2 |

### G11-T33 — Renderer khối `figure` và CSS
- Mục đích: 5.7.4; FR-114. G13-B06 (GOI-13) thêm renderer cho phần mở rộng, làm sau T33 (sửa 18/11 theo GOI-13).
- Đầu vào: `backend/services/grammar_learning_blocks.py`, `grammar_content.py` dòng 300–380, `backend/tests/test_grammar_learning_blocks.py`, `test_anchor_drift.py`; tờ `GrammarWikiMinhHoa`, `GrammarWikiBai`; `page-shell.tsx`.
- Việc làm: kiểu `figure` với mười lược đồ; đánh số; giới hạn 4; CSS; test backend mỗi kiểu (khối đúng → HTML có `role="img"`, `aria-label`, `lang="en"`, `Hình N`; chuỗi có `<script>` → bị escape; khối sai → bị bỏ, có cảnh báo, bài vẫn render); test frontend hợp đồng không cần (HTML do backend dựng).
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: `cd backend && python -m pytest tests/test_grammar_learning_blocks.py tests/test_grammar_content_render_fixes.py tests/test_anchor_drift.py -q` pass; mở một bài thử local thấy hình đúng tờ ở 1280 và 390.
- Không làm: không đổi năm kiểu khối cũ; không thêm thư viện Markdown.
- Vướng mắc → cách gỡ: CSS bài đọc đang do G06-T07 dựng lại → xếp hàng sau PR đó hoặc đặt file CSS riêng chỉ nạp ở trang bài Grammar; HTML được làm sạch ở frontend (nếu có bộ lọc thẻ/thuộc tính) → CHƯA KIỂM: `grep -rn "sanitize\|DOMPurify" frontend/app/(public-content)/grammar frontend/lib | head`; có thì thêm `figure`, `figcaption`, `role`, `aria-label`, `lang` vào danh sách cho phép.
- Ước lượng: 2 phiên · 4.

### G11-T34 — Nội dung sơ đồ thí điểm
- Mục đích: năm bài có sơ đồ thật để anh Andy duyệt hướng.
- Đầu vào: T33; danh sách bài (mục 10 câu 22); tờ `GrammarWikiMinhHoa`.
- Việc làm: thêm khối `figure` vào năm file `backend/content/<category>/<slug>.md`; mỗi hình một câu ví dụ đúng ngữ pháp, `alt_vi` đọc thành câu.
- Đầu ra: 1 PR content.
- Nghiệm thu: test backend Grammar pass; không đổi anchor; ảnh từng bài đính PR.
- Không làm: không sửa văn bài ngoài chỗ đặt khối và câu dẫn "(Hình N)".
- Vướng mắc → cách gỡ: bài thuộc `_archive` → chọn bài khác; câu ví dụ lấy từ bài đã có để không phát sinh nội dung chưa duyệt.
- Ước lượng: 1 phiên · 2.
