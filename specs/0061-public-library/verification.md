# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi bằng chứng **dự kiến** theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=planned in T008–T015; curl HTML khi tắt JS chứa nội dung chính; kịch bản 1, 3 | PENDING |
| FR-002 | kind=test; ref=planned in T008; test React khung theo phiên (khách/đã đăng nhập), không chuyển hướng | PENDING |
| FR-003 | kind=test; ref=planned in T007 course-link-line, T008–T015; test: đúng một lối/trang, ẩn khi có khoá G04, hiện khi thiếu dữ liệu | PENDING |
| FR-004 | kind=test; ref=planned in T006 /summary, T008; test API trường null; test React không hiện 0 hay 0/0 | PENDING |
| FR-005 | kind=test; ref=planned in T009, T013; test React URL ↔ trạng thái, đổi lọc về trang 1; kịch bản 2 | PENDING |
| FR-010 | kind=test; ref=planned in T006, T009; test React chọn Task 1 vô hiệu Dạng; test API tham số sai 422 | PENDING |
| FR-011 | kind=test; ref=planned in T009; test React 12 dòng, giữ chỗ, lỗi + Tải lại, rỗng, một trang ẩn phân trang | PENDING |
| FR-012 | kind=test; ref=planned in T009; test React dòng là một liên kết; HTML chứa câu đề đầy đủ; ảnh 390px | PENDING |
| FR-013 | kind=test; ref=planned in T010; test React tham số xem/muc/cap; mặc định 7.5 | PENDING |
| FR-014 | kind=test; ref=planned in T010 frontend/lib/delta-highlight.mjs; test hàm thuần khớp/không khớp/chỉ bản thấp/trùng hai lần; kịch bản 4 | PENDING |
| FR-015 | kind=test; ref=planned in T006, T010; test API không có trường cấm; grep HTML problem_solution|TR:|CC:|LR:|GRA: | PENDING |
| FR-016 | kind=test; ref=planned in T010; test React Task 1 có hình, mục 3 Đặc điểm chính, đánh số lại | PENDING |
| FR-017 | kind=test; ref=planned in T010; test React liên kết mục từ chỉ khi tồn tại, related ≤ 4, prev/next | PENDING |
| FR-018 | kind=test; ref=planned in T010; test React ba trạng thái khoá/lượt; CHỜ G08 khi chưa có đề điền sẵn | PENDING |
| FR-019 | kind=test; ref=planned in T002, T003b, T006; test API unpublished 404, slug cũ 308; test script E_NOT_APPROVED; kịch bản 5, 10 | PENDING |
| FR-020 | kind=test; ref=planned in T011; test API groups[]; một bài hai nhóm cùng URL | PENDING |
| FR-021 | kind=test; ref=planned in T007; test React mục lục mục đang đọc (IntersectionObserver giả); 390px đóng | PENDING |
| FR-022 | kind=test; ref=planned in T007, T011; test bấm số tô data-anchor; test thay thẻ trích, bài gỡ thì bỏ | PENDING |
| FR-023 | kind=test; ref=planned in T011; test API ngày cập nhật = updated_at | PENDING |
| FR-030 | kind=test; ref=planned in T013; test React bộ lọc Part/chủ đề/video/q, nhóm rỗng ẩn | PENDING |
| FR-031 | kind=test; ref=planned in T013; test React nhãn chữ tình trạng video; test API đề không sample_text không lên kệ | PENDING |
| FR-032 | kind=test; ref=planned in T013 video-player; test React không gọi playVideo khi tải; curl -I header CSP chỉ ở route speaking; kịch bản 6 | PENDING |
| FR-033 | kind=test; ref=planned in T013 frontend/lib/library-cues.mjs; test activeCueIndex; test React video lỗi → mốc không bấm, không video → audio thu gọn | PENDING |
| FR-034 | kind=test; ref=planned in T013; test React nhãn chữ và số ở lề cho vocab/structure, không band | PENDING |
| FR-035 | kind=test; ref=planned in T013; test React ba trạng thái nút; thứ tự trước/sau | PENDING |
| FR-036 | kind=test; ref=planned in T013; test React có video hoặc audio thì luôn có chữ Giọng đọc tổng hợp | PENDING |
| FR-040 | kind=test; ref=planned in T014; curl mã HTTP 5 bài + 1 bài lạ 404; verify-grammar-404-ssr-flow.mjs; git diff --stat backend/content rỗng; kịch bản 7 | PENDING |
| FR-041 | kind=test; ref=planned in T014 (b); test React Theo nhóm/A–Z, tìm bỏ dấu, không kết quả | PENDING |
| FR-042 | kind=test; ref=planned in T014 (a); test React kiểm tra nhanh không gửi mạng, câu trống, đổi đáp án xoá kết quả | PENDING |
| FR-043 | kind=test; ref=planned in T014 (a), T016; test React nút Đã đọc chỉ khi đăng nhập, bật/tắt | PENDING |
| FR-044 | kind=test; ref=planned in T014 (a); test render giữ figure.gw-fig và chú thích Hình N; không hình khi G11-T33 chưa merge | PENDING |
| FR-050 | kind=test; ref=planned in T015; curl canonical mục từ; next-metadata test; kịch bản 8 | PENDING |
| FR-051 | kind=test; ref=planned in T015; test React gợi ý ↑ ↓ Enter Esc, ≤ 3 từ gần | PENDING |
| FR-052 | kind=test; ref=planned in T015; test React nút nghe; test trình duyệt computed style IPA Source Sans 3 | PENDING |
| FR-053 | kind=test; ref=planned in T015; test React khách → lời nhắc /login?next=…; staging journey đăng nhập rồi lưu; kịch bản 8 | PENDING |
| FR-054 | kind=test; ref=planned in T015; test React ẩn phần rỗng; Trong bài mẫu Writing chỉ khi có bài xuất bản | PENDING |
| FR-060 | kind=test; ref=planned in T009, T013, T016; test React cột Của bạn/Bạn kèm chữ; kịch bản 9 | PENDING |
| FR-061 | kind=test; ref=planned in T002, T016; test backend A không đọc/ghi dấu B, PUT hai lần một hàng, is_active=false dùng được, cascade | PENDING |
| FR-062 | kind=test; ref=planned in T017; test sitemap model dữ liệu giả; curl sitemap.xml đếm /library/writing-samples/ = số published | PENDING |
| FR-064 | kind=test; ref=planned in T002, T006 tests/test_library_media.py; nháp 404, đã đăng 302 URL ký 300 s, gỡ 404, no-store; staging journey: URL object công khai của bucket trả lỗi, URL ký cũ hết hạn ≤ 300 s sau khi gỡ; kịch bản 11 | PENDING |
| FR-063 | kind=test; ref=planned in T008 frontend/lib/library-shelves.mjs; test React mảng thêm kệ giả → sáu kệ, 390px không vỡ; kịch bản 12 | PENDING |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` sinh lại trong T006, T011, T013, T016, T020; job `.github/workflows/typecheck.yml` phải xanh.
- Backward compatibility: URL Grammar và `/vocabulary?cat=&slug=` giữ nguyên mã HTTP (FR-040, FR-050); `GET /api/writing/tips*`, `/api/grammar/*`, `/api/vocabulary/*` không đổi hình dạng; `saved_articles` giữ nguyên.

## Data evidence

- Migration/schema query: sau khi áp 400 trên staging — `select relname, relrowsecurity from pg_class where relname in ('library_topics','writing_samples','writing_sample_slug_history','speaking_samples','library_marks');` (cả năm `true`); `select grantee, privilege_type from information_schema.role_table_grants where table_name in (...) and grantee in ('anon','authenticated');` (rỗng); `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='library-media';` (`public = false`); `select policyname from pg_policies where schemaname='storage' and tablename='objects' and qual::text like '%library-media%';` (rỗng).
- Immediate state versus full reload: sau `--execute`, chạy lại dry-run ra "không còn khác biệt"; số `published` trên staging = số `publish:true` trong manifest; sau bật/tắt dấu, tải lại trang vẫn đúng dấu.

## UI evidence

- Viewports/themes/input methods: 1280px và 390px mỗi màn ở `ui-states.md`, ảnh đặt cạnh tờ thiết kế trong PR; bàn phím (Tab, Enter, ↑ ↓, Esc) cho bộ lọc, gợi ý tra từ, trình phát, mục lục; chế độ sáng (ảnh đề Task 1 luôn sáng, 00 mục 2 điểm 17).

## Release evidence

- Staging SHA and checks: ghi SHA merge của từng PR, kết quả CI, ảnh 10 trang ngẫu nhiên sau T018; tách rõ: đã ở staging · đã lên production · người dùng đã nghiệm thu.
- Production verification: chỉ xem sau khi anh Andy cho phép, không ghi gì; script nhập không chạy trên production trong spec này.
