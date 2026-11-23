# Verification

## Requirement coverage

Mọi dòng đang `PENDING`, vì spec còn ở trạng thái `draft`. Bằng chứng ghi dưới đây là bằng chứng **dự kiến**.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-050 | kind=test; ref=planned React result-next-steps three exits, hidden exit without target; node result-next-step-model order and source failure fallback (T27, T20) | PENDING |
| FR-051 | kind=test; ref=planned React result-grading-source six cases review_mode ai_instant/teacher_review/NULL × band_source ai/teacher (AI-band reviewed by teacher → "AI chấm, giáo viên duyệt rồi trả" with estimate line; teacher-changed band → "Giáo viên chấm" without estimate line), unknown hides line (flagged essay moved straight to delivered must yield band_source unknown, checked at T20), Speaking always "AI chấm, trả ngay" (T20, T22) | PENDING |
| FR-052 | kind=test; ref=planned React pending-review: no band, criteria or comments in DOM, aria-current step; pending/grading shows "AI đang chấm" with 4 steps (teacher_review/NULL) or 3 steps (ai_instant) and no band (T20); journey=staging scenario 3 | PENDING |
| FR-053 | kind=test; ref=planned pytest old body 201, old body with padding that is < 50 chars after strip → 422 regrade_reason_invalid (not 500), migration re-run is a no-op, new body 201, ambiguous 422, other without note 422, note > 300 422, duplicate 409, GET and admin list include reason_code/note; PG CHECK; rollback file RAISEs with any reason_code row and has no override; code-only rollback with fake data (existing `other` + note: old admin reads note in reason, accept/reject/fulfil OK, old body insert OK, redeploy keeps reason_code/note) (T21); journey=staging scenario 1, 2 | PENDING |
| FR-054 | kind=test; ref=planned node band-display-model overallLine for assigned 4-skill complete, pending skills, fewer skills, mini test with backend overall → null (T27, T22); journey=staging scenario 4 | PENDING |
| FR-055 | kind=test; ref=planned React CreditsEmptyNotice class / online can_renew true / online can_renew false, no "mua" or "giá" (T27) | PENDING |
| FR-056 | kind=test; ref=planned node fixLink mapped/unmapped and every grammar slug exists in backend/content (T27) | PENDING |
| FR-057 | kind=test; ref=planned React pronunciation sample line for segment/full/not_sampled, hidden when field absent, hidden button when recording expired (T22) | PENDING |
| FR-058 | kind=test; ref=planned React retry-credit-line units (Writing 1, Speaking Part 2 1, full test Speaking 3, full test Writing 2), hidden on balance error or unmetered (T20, T22) | PENDING |

## Kịch bản staging

Chỉ dùng tài khoản QA và bài thử. Không dùng bài của học viên thật.

1. **Chấm lại dạng mới.** Given bài Writing thử đã trả. When chọn "Khác" mà không ghi chú, rồi thêm ghi chú và gửi. Then lần đầu bị chặn ở form; lần sau gửi được 201; admin thấy "Lý do: Khác · Ghi chú: …" và từ chối được; phiếu hiện "Không chấp nhận" kèm phản hồi.
2. **Dạng cũ.** Given gọi `POST` với `{reason: <60 ký tự>}` bằng tài khoản QA. Then 201; admin thấy nguyên văn.
3. **Chờ duyệt.** Given bài Writing của lớp QA đang chờ giáo viên. When mở phiếu. Then 4 bước, không có band.
4. **Overall.** Given kỳ thi thử QA được giao đủ 4 kỹ năng, còn một phần chưa chấm. Then "Chưa có Overall: còn chờ chấm …"; mini test tự chọn của QA không có dòng Overall.
5. **Hết lượt.** Given tài khoản QA lớp hết lượt. When bấm "Làm lại" trên phiếu. Then khối "Liên hệ giáo viên để được cấp thêm", không có nút đăng ký.

## Contract evidence

- **OpenAPI và type drift:** `RegradeRequestBody` hai dạng và `GET` có thêm hai trường. Sinh lại `frontend/types/api.d.ts` ở T21; CI kiểm bằng `git diff --exit-code`.
- **Tương thích ngược:** body cũ `{reason}` vẫn 201. Hình `GET` giữ nguyên, chỉ thêm trường. RPC danh sách admin không đổi chữ ký.

## Data evidence

- **Migration/schema query:** trước khi áp, chạy `SELECT count(*) FROM essay_regrade_requests WHERE char_length(reason) NOT BETWEEN 50 AND 500;` (phải ra 0). Sau khi áp, chạy `SELECT conname FROM pg_constraint WHERE conrelid='essay_regrade_requests'::regclass;` (có `essay_regrade_reason_shape`, không còn `essay_regrade_reason_length`). Cả hai đều chỉ đọc.
- **Trạng thái ngay sau thao tác so với tải lại trang:** sau khi gửi yêu cầu, phiếu hiện đúng trạng thái `GET` trả; tải lại trang cho cùng kết quả.

## UI evidence

- **Viewports, chế độ màu, cách nhập:** 390px, 820px, 1280px, cả sáng và tối, cho ba phiếu. Form chấm lại thao tác hoàn toàn bằng bàn phím.

## Release evidence

- **Staging SHA và kiểm tra:** ghi SHA staging sau mỗi lần merge, kèm kết quả CI tích hợp và Staging E2E đúng SHA đó.
- **Kiểm trên production:** chỉ đọc, gồm truy vấn ràng buộc trong lần áp đã duyệt và `curl -sI` các trang phiếu (chưa đăng nhập phải chuyển hướng đăng nhập). Không gửi yêu cầu chấm lại.
