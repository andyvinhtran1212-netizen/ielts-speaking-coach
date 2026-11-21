# Rollout and rollback

## Preconditions

- Spec này `approved` trên `staging` (anh Andy; `approval-decision.md`).
- Người điều phối xác nhận không PR mở nào chạm khối sắp dời (Q-c2). Ở `119ad352` không PR mở nào chạm `backend/routers/listening.py`, `backend/routers/admin.py` hay `backend/services/quiz_service.py`.
- Mỗi PR làm trên base `staging` mới nhất; nếu staging đổi khối đang dời, làm lại cắt-dán từ đầu, không merge tay.

## Staging

- Mỗi PR một bước (T001 … T010), merge vào `staging` theo thứ tự; PR sau chỉ mở khi PR trước đã merge và CI staging xanh.
- Sau mỗi merge: CI integrated + Staging E2E xanh trên SHA đó; xem log Railway staging 48 giờ (lỗi `NameError`, `AttributeError`, `PydanticUserError`, 500 mới trên `/api/listening/*`, `/admin/listening/*`).
- Sau T008 (PR7): Scenario 10 bằng tài khoản thử; ghi SHA và kết quả vào `verification.md`.

## Production

- Theo `docs/STAGING_FIRST_RELEASE_FLOW.md`: chỉ qua PR promotion `staging → main` mà anh Andy duyệt. Không có migration hay biến môi trường.
- Nên promote từng bước hoặc gộp vài bước đã qua 48 giờ trên staging; không promote một bước chưa qua Staging E2E.

## Rollback and repair

- Mỗi PR độc lập: `git revert` một PR trả về bước trước (vì bước trước cũng giữ nguyên route/OpenAPI). Revert theo thứ tự ngược nếu nhiều bước.
- `NameError`/`AttributeError` trên staging hoặc production: revert PR gần nhất ngay, không vá tại chỗ; thêm ca vào `test_listening_package_seams.py` trong PR làm lại.
- Không có dữ liệu nào phải sửa.

## Observability

- Tên logger không đổi (`routers.listening`, FR-010), nên mọi bộ lọc log hiện có vẫn khớp.
- Lỗi import hiện ngay lúc khởi động (`import main` thất bại → deploy Railway không lên, healthcheck đỏ) thay vì lúc chạy; lỗi lúc chạy (`NameError`) đã bị test FR-007 chặn trước merge.
