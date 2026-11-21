# Rollout and rollback

## Preconditions

- Spec này `approved` trên `staging`. Ảnh mốc cho 3 trang thí điểm có trước hoặc trong PR T001.
- Không PR nào khác đang mở chạm group của đợt (kiểm `git grep` đường dẫn group trên các PR mở); G09 tạm không sửa trang của đợt trong lúc PR mở.

## Staging

- Mỗi đợt một PR; merge vào `staging` sau khi CI xanh và preview Vercel mở được mọi trang của đợt.
- Sau merge: Staging E2E xanh; admin thử mở từng trang của đợt và chuyển trang bằng sidebar giữa trang cũ/mới.

## Production

- Chỉ qua PR promotion `staging → main` anh Andy duyệt. Không migration, không biến môi trường.

## Rollback and repair

- `git revert` PR đợt: group trở lại thư mục cũ với layout cũ (Git giữ nguyên nội dung).
- Nếu chỉ một trang lệch giao diện: revert cả PR, sửa layout con trong PR làm lại; không vá CSS.

## Observability

- Lệch giao diện hiện ở ảnh mốc (CI advisory `visual-baseline` của TESTPOLICY-0057) và ở danh sách `<link>`; lỗi route hiện ở `route-ownership-check.mjs` và build Next.
