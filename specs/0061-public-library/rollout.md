# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging` (`approval-decision.md` nguyên văn câu duyệt của anh Andy).
- Số 400 chưa bị file hay PR khác dùng (kiểm `backend/migrations/register.tsv` và PR đang mở ngay trước khi viết T002); PR T002 thêm hàng 400.
- G03 component nền đã merge trước T007/T008. Các phụ thuộc còn lại có trạng thái dự phòng ở `plan.md` ("Phụ thuộc chưa có").
- Manifest Writing: mọi bộ sẽ xuất bản có `review.status='approved'` và `review.by/at` (câu N1).

## Staging

Thứ tự (gói mục 6 T01): migration staging → API → trang → nội dung → bật sitemap.

1. Áp `400_public_library.sql` lên staging bằng runner có khoá advisory (AGENTS.md "Staging-first"), chạy postcondition và truy vấn ở `verification.md` "Data evidence" **trước** khi merge mã dùng bảng. Ghi DB staging chỉ khi anh Andy gõ duyệt trực tiếp trong thread chạy lệnh (quy trình máy anh).
2. Merge API (T006, T011, T013, T016), rồi trang (T008–T015). Trang hoạt động với bảng rỗng: danh sách hiện trạng thái rỗng, `/library` ẩn số.
3. T018: `--check` sạch → dry-run → `--execute` với `publish:false` hết → dry-run lại "không còn khác biệt" → lô đầu 50 bộ đã ký `publish:true` → kiểm 10 trang ngẫu nhiên 1280/390 → các lô còn lại. Speaking chỉ nhập khi có tệp theo hợp đồng từ repo VIDEO MAKING.
4. T017 (sitemap, robots) merge sau khi có bộ đã xuất bản trên staging.
5. Quyền tải tệp (FR-064): với một đề thử, kiểm nháp (404) → đăng, tải tệp một lần để làm nóng cache (200, `no-store`) → gỡ → gọi lại đúng URL ngay và sau 300 s (404 cả hai); URL object công khai `.../storage/v1/object/public/library-media/...` lỗi ở mọi trạng thái. Ghi băng thông route tệp sau một tuần để biết chi phí đi qua backend.
6. CSP Speaking: kiểm `curl -I` route `/library/speaking/<slug>` có `frame-src https://www.youtube-nocookie.com` và `/` không có, trên Preview/staging.

Máy cloud hiện không vào được staging: bước xem staging ghi "chờ anh Andy kiểm tay trên staging" nếu không có đường khác; không tự tạo tài khoản QA (04-VIEC-DE-LAI câu 11).

## Production

- Chỉ qua PR `staging → main` (`docs/STAGING_FIRST_RELEASE_FLOW.md`); migration 400 lên production cần anh Andy gõ duyệt, chạy dưới khoá advisory trước khi mã phụ thuộc lên.
- Nhập nội dung production cần một thay đổi riêng được duyệt (script từ chối project khác staging); không thuộc spec này.
- Kiểm sau khi lên: `/library` 200 khi chưa đăng nhập; một URL Grammar cũ cùng mã HTTP; `/grammar/<c>/khong-co` 404; header CSP chỉ ở route Speaking.

## Rollback and repair

- Gỡ nội dung nhanh: `published=false` hàng loạt qua `/admin/library` (T020) hoặc manifest `publish:false` + `--execute`; trang đề trả 404 ngay khi cache hết hạn (`cacheable_json`); route tệp trả 404 ngay vì đọc `published` mỗi yêu cầu và không phát URL Storage nào (FR-064). Kiểm: tải tệp trước khi gỡ để làm nóng cache, gỡ, gọi lại đúng URL ngay và sau 300 s → cả hai 404.
- Code: migration 400 chỉ thêm bảng và bucket, không đổi bảng cũ → deploy lại bản trước được; route `/library*` biến mất, không ảnh hưởng trang khác.
- Grammar/Vocabulary: mỗi PR T014 (a/b/c), T015 revert độc lập; URL và frontmatter không đổi nên không cần chuyển hướng.
- CSP: revert PR CSP riêng của T013 → trang Speaking rơi về nhánh `<video>`/audio, không khung trống (FR-033).
- Rollback schema (chỉ khi chưa có dữ liệu người dùng cần giữ): `backend/migrations/rollback/400_public_library.sql` xoá năm bảng và bucket `library-media` (xoá object trước). Trước khi chạy: `select count(*) from library_marks;` — có dấu của người dùng thì không chạy, chỉ tắt nội dung.
- Sửa lệch: dry-run in kế hoạch `INSERT/UPDATE/UNPUBLISH`; `--execute` đưa DB về manifest; `W_HASH` dừng bộ có nguồn đổi.

## Observability

- Bản ghi lô nhập (G09-T36): mỗi `--execute` một lô với số `insert/update/unpublish/skip` và đường dẫn báo lỗi; thẻ `import` của `/admin/library` đọc lô gần nhất. Khi helper chưa có: đầu ra lệnh dán vào PR T018.
- Log backend (logger, không bảng mới): `library_mark_write` (shelf, kind, kết quả; không ghi `user_id` ngoài id nội bộ), `library_sample_not_found` (slug, để thấy link chết), `admin_library_publish` (số đề, số bị loại, lý do).
- Chỉ số kiểm tay: số `published` theo kệ (`/api/library/summary`) so với manifest; số URL `/library/writing-samples/` trong sitemap = số `published`.
- Chủ sở hữu: người thực thi gói G06; anh Andy nhận báo cáo khi số lệch.
