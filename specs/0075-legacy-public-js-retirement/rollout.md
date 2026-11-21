# Rollout and rollback

## Preconditions

- Spec này `approved` trên `staging`; Q-b1 = đồng ý (anh Andy, bằng chữ) trước PR xoá đầu tiên.
- T001 (bộ thu thập) đã merge; đo lại trên base mới nhất của đợt.
- Không PR đợt nào khác đang mở.

## Staging

- Mỗi đợt một PR vào `staging`, sau khi preview Vercel của PR qua kiểm 404 + console.
- Sau merge: Staging E2E xanh trên SHA đó; Scenario 1 (đợt admin) hoặc bài thử bằng tài khoản thử (đợt học viên); xem lỗi frontend 48 giờ (bảng error logs của admin, lọc `Failed to load` / `/js/`).

## Production

- Chỉ qua PR promotion `staging → main` anh Andy duyệt (`docs/STAGING_FIRST_RELEASE_FLOW.md`). Không migration, không biến môi trường.
- Sau promotion: `curl -s -o /dev/null -w '%{http_code}' https://www.averlearning.com/js/<một file đã xoá>` → 404; mở một trang của nhóm, không lỗi console mới.

## Rollback and repair

- `git revert` PR đợt rồi promote lại: file trở lại nguyên byte (Git giữ lịch sử), Vercel phục vụ lại `/js/<file>`; `Cache-Control: max-age=0, must-revalidate` nên trình duyệt lấy bản mới ngay.
- Ghi file gây lỗi vào danh sách giữ của đợt sau, bổ sung cách nạp mới tìm được vào bộ thu thập T001.
- Không có dữ liệu nào phải sửa.

## Observability

- Lỗi `Failed to load /js/…` và 404 `/js/*` xuất hiện ở console trình duyệt, error logs frontend (`/js/error-reporter.js` gửi về backend) và log Vercel.
- Nếu Q-b2 = có: so log truy cập `/js/<file>` trước và sau đợt.
