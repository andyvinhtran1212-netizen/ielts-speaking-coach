# Rollout and rollback

## Preconditions

- Spec được anh Vinh duyệt; Leader đã cấp số migration `371`; SA review xong
  phần chống lạm dụng; Q-3 (API key riêng) quyết xong.
- Env Railway: `TRIAL_HASH_SALT`, `AI_BUDGET_TRIAL_*`, `TRIAL_*` hạn mức,
  `TRIAL_KILL_SWITCH=off`, khoá Turnstile (**bắt buộc**, FR-009). Không ghi giá trị khoá
  vào repo/log.
- Cờ `free_trial_enabled`, `speaking_ui_v2`, `writing_ui_v2` = TẮT.

## Staging

1. Áp migration `371` trên staging; query xác nhận RLS bật trên đủ 6 bảng dùng
   thử (danh sách trong `plan.md`), REVOKE đúng; bucket audio dùng thử riêng đã
   tạo và `public=false`, phát lại chỉ qua signed URL TTL ≤ 10 phút sau kiểm
   chủ sở hữu (FR-033).
   SA N26: xác nhận trong Supabase API settings (`db_schemas`/exposed schemas)
   **không** có `trial_private`; `GET /rest/v1/v_user_activation_evidence` với
   `Accept-Profile: trial_private` → 406/lỗi quyền; service_role đọc được view
   (job bất biến chạy xanh). Lặp lại bước này trên production trước khi bật cờ.
2. Deploy SHA chính xác; pytest + node test xanh.
3. Bật `free_trial_enabled` trên staging; trần staging nhỏ (0,50 USD/ngày) để
   thử chạm trần thật.
4. Journey: tài khoản dùng thử Speaking + Writing; bài thiếu chữ/dán/lạc đề;
   chạm trần → trạng thái đóng; **song song** tài khoản học viên lớp nộp bài giao
   và được chấm bình thường (FR-002).
5. 48 h: so chi phí thật/lượt với `plan.md`; nếu lệch > 30 % báo FD chỉnh trần.

## Production

- **Điều kiện chặn mở (FR-009, FR-033, FR-036; SA N4):** khi cờ còn TẮT, admin gọi
  `GET /api/admin/trial/readiness` trên prod: mọi boolean (trừ `flag_enabled`)
  phải `true`, `would_be_open=true`. Sau khi bật cờ: `activate` không token →
  403. Thiếu bất kỳ điều kiện nào thì không bật.
- API key Anthropic/OpenAI riêng cho dùng thử có spend limit ở provider (Q-3).

- Anh Vinh duyệt bật. Bật cờ với trần ngày giảm một nửa trong 3 ngày đầu, theo
  dõi rồi nâng lên số đã chốt.
- Thành công: không vượt trần, 0 lỗi chấm học viên lớp, tỉ lệ nghi dán < 20 %.

## Rollback and repair

- Tắt `free_trial_enabled` (tức thì) hoặc `TRIAL_KILL_SWITCH=on` (mọi giá trị khác `off`, env, ≤ 1
  request). Code rollback an toàn: route lớp không phụ thuộc bảng dùng thử.
- Reservation treo: sweeper AIBUDGET-0033 hết hạn theo ước tính; lượt
  `reserved` > 15 phút được `fn_trial_settle(..., 'released')`.
- Rollback code giữ migration `371`. Chỉ chạy migration down sau khi dừng
  route/job dùng thử và chốt reservation; xử lý dữ liệu theo FR-033 trước khi
  gỡ đối tượng riêng của dùng thử (kể cả bucket/view/schema). Giữ nguyên
  `users.first_activated_at` cùng hàm/trigger đơn điệu, không xoá mốc backfill.
  Nếu `371` có sửa `fn_ai_budget_reserve`, down khôi phục định nghĩa/chữ ký/quyền
  trước `371` theo bản T001 lưu; không xoá reservation/chi tiêu nền tảng.
  Đối chiếu `plan.md` và kiểm chứng rollback trong `verification.md`.

## Observability

- `ai_usage_logs.feature` dùng thử (FR-022); log `[trial]` có reason/scope,
  không có email/IP/nội dung. Cảnh báo email 50/80/100 % trần tổng, chạm trần
  ngày. Chủ sở hữu: anh Vinh; Leader theo dõi.
