# Tasks

Mỗi task một PR vào `staging`, lớp `high-risk` (spec `risk: high`; `routers/listening.py` chứa chấm bài, lưu kết quả, kết thúc bài thi — 00 §4.7, không hạ cấp), `Spec: BACKENDSPLIT-0076`, chỉ sau khi spec `approved`. G10-T08 là chính PR spec này. Trước mỗi PR tách Listening, người điều phối xác nhận không có PR mở nào chạm khối sắp dời (Q-c2).

- [ ] T001 (G10-T09) `git mv backend/routers/listening.py backend/routers/listening/__init__.py`, không sửa nội dung; đổi đường dẫn ở allowlist (186 dòng), khoá raw-input (41), test đọc text, 14 file frontend/tooling, `next-native-browser.yml` (2 dòng). `depends: spec approved`
- [ ] T002 (G10-T10 PR2) Tạo `_common.py` (dòng 22–710: import, logger tên `routers.listening`, route class, router, `_admin_targets`, `require_admin`, helpers, schemas), `_reexport`, `_SeamModule`, `_SUBMODULES = (_common,)`; thêm `test_listening_package_seams.py`; sửa hai test AST cả module (Scenario 8). `depends: T001`
- [ ] T003 (G10-T10 PR2b) Dời `_upload_audio_to_bucket`, `_assemble_listening_review`, `_fetch_attempt_or_404`, `_rows_by_id` và bao đóng của chúng vào cuối `_common.py`; lệnh quét phụ thuộc ngược in rỗng. `depends: T002`
- [ ] T004 (G10-T10 PR3) `admin_import.py` (2471–3830). `depends: T003`
- [ ] T005 (G10-T10 PR4) `admin_audit.py` (3831–5191). `depends: T004`
- [ ] T006 (G10-T10 PR5) `student_fulltest.py` (5192–6424). `depends: T005`
- [ ] T007 (G10-T10 PR6) `dictation.py` (6425–7701). `depends: T006`
- [ ] T008 (G10-T10 PR7) `attempts.py` (7702–hết); Scenario 10 trên staging. `depends: T007`
- [ ] T009 (G10-T11) `routers/admin.py` thành package (PR rename như T001, allowlist 105 dòng), rồi dời ranh giới đề xuất trong PR đó; `require_admin`, `require_instructor`, `_actor_id`, `_require_db_engine` ở `__init__.py`. `depends: T008, người điều phối báo cửa sổ`
- [ ] T010 (G10-T12) `services/quiz_service.py` thành package; một đối tượng `_bank_content_cache`. `depends: T009`

Chi tiết mỗi PR tách (T002–T010):

1. Cắt-dán nguyên khối, không sửa thân hàm, không đổi tên, không dọn import. Ngoại lệ duy nhất: dòng `logger` ở T002 (FR-010).
2. Module con mở đầu `from __future__ import annotations`, chép khối import của file gốc mà khối cần, import tên dùng chung từ `._common` hoặc module con đứng trước; không `from routers.listening import …`.
3. `__init__.py`: `from . import <module>; _reexport(<module>)` đúng vị trí khối cũ; thêm module vào `_SUBMODULES`.
4. Khoá allowlist/raw-input của hàm đã dời: đổi đường dẫn file và callee theo thông báo của test; tổng trước = sau.
5. Test đọc text chuỗi của hàm đã dời: đổi tham số đường dẫn, không đổi chuỗi kiểm. Liệt kê mọi test đã sửa trong thân PR.
6. Số test phải sửa > 30 ngoài dự kiến → dừng, báo danh sách (00 §7).

Nghiệm thu mỗi PR: các bước ở `plan.md` mục "Verification strategy"; ghi SHA, lệnh, kết quả vào `verification.md`.
