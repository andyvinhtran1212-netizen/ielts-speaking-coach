---
id: ENROLL-0060
title: Learners sign in with Google or a six-digit email code and return where they were, check a class activation code before using it, and register for an online course by bank transfer until an admin confirms it
status: draft
risk: high
owner: product
---

# Learners sign in with Google or a six-digit email code and return where they were, check a class activation code before using it, and register for an online course by bank transfer until an admin confirms it

Status: **draft** — soạn ngày 23/11/2026 cho nhiệm vụ `G05-T01` (thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-05-trang-cong-khai-va-dang-ky.md` (bản 18/11 chiều) nhóm B của mục 4, mục 5.2, 5.2b, 5.3, 5.6, 5.6b, 5.7, 5.8, 6, 7, 8, 9, 10. Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi nguyên văn kèm thời điểm vào `approval-decision.md` cùng thư mục và `status` đổi sang `approved`. Số 0060 lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6 và còn trống ở staging `31725a9b`.

`risk: high`: đường đăng nhập mới (auth), mã kích hoạt (sự thật về quyền sở hữu mã), năm migration, RLS và quyền gọi hàm.

## Tóm tắt (tiếng Việt)

**Người dùng thấy gì.**
- `/login` có đúng hai cách vào: "Tiếp tục với Google", hoặc nhập email → nhận mã 6 số → nhập mã. Không mật khẩu. Lần đầu là tạo tài khoản; cùng email thì hai cách vào cùng một tài khoản. Tám trạng thái lỗi rõ ràng; không lộ email nào đã có tài khoản.
- Đăng nhập xong về đúng chỗ đang làm (`next`), lần đầu tới trang "Lần đầu vào" của G07, còn lại về Hôm nay; không còn bị ép nhập mã kích hoạt.
- `/activate`: nhập mã kích hoạt của lớp, bấm "Kiểm tra mã" để xem trước khoá, thời hạn, số lượt (không tiêu mã), rồi mới "Xác nhận mở khoá". Giới hạn 5 lần thử trong 15 phút.
- Đăng ký khoá online: `/courses/[slug]/enroll` tạo đơn → `/enroll/[orderCode]` hiện mã VietQR, theo dõi đơn tới khi admin xác nhận và khoá mở tự hiện ra; `/account/orders` liệt kê đơn.
- Một phiên mỗi tài khoản học viên (màn 8a–8c), hộp "Đăng xuất khỏi mọi thiết bị"; đổi email đăng nhập bằng mã gửi tới email mới; `/contact` gửi được khi chưa đăng nhập; "Báo cho tôi khi mở" gửi đúng một thư khi khoá mở đăng ký.

**Ranh giới với spec khác.** Bốn thư về đơn (đã tạo · nhắc · cần bổ sung · khoá đã mở) do COURSEACCESS-0055 (G04) xếp và gửi; ENROLL-0060 chỉ sở hữu câu chữ mẫu thư (G05-T14), hàm xếp thư `fn_course_open_alerts_enqueue` cho thư `course_open_alert`, và thư báo đổi email gửi qua `learner_email.send_direct` — để hai spec không cùng sở hữu một hành vi (GOI-11 phần C về thư đơn đã bỏ). Máy chủ của "một phiên" và "đăng xuất khỏi mọi thiết bị", bảng `learner_login_events` thuộc G04; spec này dựng giao diện và điểm chạm (FR-052, 053, 061). Trang công khai đọc (`/`, `/courses`, trang khoá, pháp lý, trang lỗi) thuộc PUBLICSITE-0059.

**Hai chỗ chạm FREETRIAL-0047 (spec đã duyệt) — cần anh duyệt như thay đổi yêu cầu của 0047.** (1) FR-030 mở rộng danh sách tiền tố cho phép của `safeNext` (0047 FR-024) thêm `/courses`, `/enroll`, `/activate`, `/account`, `/library`, `/grammar`, `/vocabulary`. (2) Điều kiện provider của 0047 FR-007 (chỉ `google`) mâu thuẫn với đăng nhập bằng mã: đã khớp với GOI-11 FR-11-031 (gói câu 16) — tài khoản mã email được chấm thử như Google, sửa điều kiện trong bản sửa đổi TRIALCAP-0080. Spec này không sửa file của 0047.

**Đường gửi mã 6 số (gói 5.6, câu hỏi mở 4).** Đề nghị **đường A**: OTP email của Supabase Auth, SMTP của Supabase trỏ vào Resend; backend chỉ đếm lần gửi/lần thử rồi chuyển phiên GoTrue nguyên vẹn về trình duyệt. **Phương án B**: backend tự sinh mã, gửi qua Resend (`learner_email.send_direct`), tự kiểm rồi xin phiên. Anh chọn khi duyệt; chi tiết hai đường ở `plan.md`.

**Migration (dải 390–399 của G05, còn trống ở `register.tsv` tại `31725a9b`).** 390 `contact_messages`, 391 `login_code_state` + ba hàm, 392 đổi ngưỡng `fn_activate_attempt_check` thành 5 lần / 15 phút, 393 `account_email_changes`, 394 `course_open_alerts` + `fn_course_open_alerts_enqueue` + `fn_course_open_alert_send_check`, 395 `fn_auth_access_token_hook` (FR-062) (394 đứng sau migration nhãn 381 của G04, số thật **383** `383_course_commerce_core.sql`, đã có trên staging). Thứ tự áp và việc anh làm trên Supabase ở `rollout.md`.

**Đối chiếu staging `31725a9b`.** G04 đã có 383, 384 (lõi khoá, sổ lượt, RPC đơn); 385, 387–389, 502 còn giữ chỗ. Chưa có `/api/me/*`, `/api/enrollment-orders*`, API phiên, `services/learner_email.py` ở `backend/` (kiểm lại khi làm từng task; G04 chưa có thì giao diện làm trên dữ liệu giả cùng kiểu, gói 5.3). Repo chưa từng có đăng nhập bằng mật khẩu hay bằng mã (`grep signInWithOtp|verifyOtp|signInWithPassword` rỗng).

**Ngôn ngữ và đánh số.** `FR-05-030…061` của gói → `FR-030…FR-061`, giữ số và nguyên văn; hai yêu cầu màn chào `/welcome` và đăng nhập email + mật khẩu của gói đã bỏ nên không có số trong spec (số 034 và 045 để trống). Tham chiếu sang nhóm A ghi `PUBLICSITE-0059 FR-0NN`.

## Quyết định đã có

- **Đăng nhập không mật khẩu**: Google, hoặc email + mã 6 số (quyết định 21 của quy ước chung; bỏ G05-T17 và yêu cầu email + mật khẩu của gói).
- **Bỏ màn chào `/welcome`**; thay bằng "Lần đầu vào" của G07, không có ô hỏi đồng ý dùng bản ghi âm (anh Andy 18/11/2026).
- **Lỗi mã kích hoạt**: một câu chung, hai câu riêng "Bạn đã có khoá này", "Bạn đã dùng mã này rồi"; giới hạn 5 lần thử trong 15 phút (00 mục 2 điểm 22; gói câu 9).
- **Xác nhận đơn là kích hoạt tài khoản**; tài khoản chưa có khoá về Hôm nay trạng thái "Chưa có khoá" (00 mục 2 điểm 20).
- **Thư "khoá đã mở đăng ký" làm** (00 mục 2 điểm 23; gói câu 10), một lần mỗi người mỗi khoá.
- **Lượt chưa dùng khi đăng ký lại chuyển toàn bộ, bảo lưu tối đa 2 tháng**; số đọc từ API G04 (00 mục 2 điểm 23).
- **"Nơi đăng nhập gần đúng" không hiện** (`approx_location` luôn null; gói câu 15). **Tài khoản mã email được chấm thử** (gói câu 16).
- **Không cổng thanh toán tự động** (quyết định 4).

## Problem

Hôm nay chỉ đăng nhập được bằng Google; tài khoản mới bị ép nhập mã kích hoạt ngay sau đăng nhập, mã bị tiêu ngay khi gọi (chưa có bước kiểm trước), và đích sau đăng nhập không nhớ người dùng đến từ đâu. Chưa có đường đăng ký khoá online, thanh toán chuyển khoản, theo dõi đơn, liên hệ có lưu, nhận báo khi khoá mở, hay đổi email đăng nhập. Người không có Gmail không vào được.

## Scope

- `/login` hai cách vào, mã 6 số (backend `routers/login_code.py`, bảng 391), tám trạng thái lỗi (FR-046…051).
- `next` và đích sau đăng nhập; bỏ bước ép nhập mã (FR-030, 031, 054).
- `/activate` kiểm trước, `POST /auth/activate/preview`, ngưỡng mới (mig 392), liên kết thư mời (FR-032, 033, 058).
- Luồng đơn: `/courses/[slug]/enroll`, `/enroll/[orderCode]`, `/account/orders`, VietQR (FR-035…042, 055…057).
- `/contact` gửi đi, bảng 390 (FR-043).
- Giao diện một phiên và "Đăng xuất khỏi mọi thiết bị" (FR-052, 053, 061).
- Đổi email đăng nhập, bảng 393, thư báo (FR-059).
- "Báo cho tôi khi mở": bảng, route, hàm xếp thư, mẫu thư (FR-060; nút ở PUBLICSITE-0059 FR-022).
- Câu chữ và bản `.html` của bốn thư đơn trên file mẫu của G04, thư mã đăng nhập, mã đổi email, hai thư mới (G05-T14; FR-042, 044).

## Non-goals

- Lược đồ và API khoá, quyền, sổ lượt, đơn; bật `users.is_active` khi xác nhận đơn; tự mở lại đơn hết hạn; máy chủ của một phiên; outbox và dispatcher thư; bảng `learner_login_events` → COURSEACCESS-0055 (G04). Màn admin xác nhận đơn → G09.
- Trang Hôm nay, "Lần đầu vào", `/help`, `/profile`, khung `/account`, mở `/home` cho tài khoản chưa kích hoạt → LEARNERCORE-0063 (G07).
- Mọi trường, route, cờ về mật khẩu; liên kết đăng nhập trong thư.
- Đổi cài đặt dự án Supabase (SMTP, mẫu thư, "Secure email change", giới hạn) và tạo khoá Resend: việc của anh Andy (`rollout.md`).
- Khối "Học trước trong lúc chờ" chỉ dựng sau cờ tắt mặc định (FR-057, câu 8).
- Cổng thanh toán tự động, webhook ngân hàng.

## Users and journeys

- Khách muốn học: trang khoá → "Đăng ký khoá này" → `/login?next=…` (Google hoặc mã) → màn tạo đơn → chuyển khoản qua QR → chờ xác nhận → khoá mở.
- Học viên lớp offline: liên kết thư mời → đăng nhập → `/activate` với mã điền sẵn → kiểm tra → xác nhận.
- Người không có Gmail: email + mã 6 số.
- Học viên đang mở ở thiết bị khác: màn 8a/8b/8c; "Đăng xuất khỏi mọi thiết bị".
- Học viên đổi email: Hồ sơ › "Đổi email đăng nhập" (G07 gắn thành phần).

## Requirements

- **FR-030:** Mọi lối dẫn tới `/login` (Đăng nhập, Nhập mã kích hoạt, Đăng ký khoá này, "Bắt đầu viết" của chấm thử, Lưu vào sổ từ ở G06) gắn `next=<path+search>`; `next` được kiểm bằng `safeNext` của spec 0047 FR-024, danh sách tiền tố cho phép mở rộng thêm `/courses`, `/enroll`, `/activate`, `/account`, `/library`, `/grammar`, `/vocabulary`. `next` sai → bỏ qua. OAuth `redirectTo` giữ cố định `${origin}/login`; `next` lưu `sessionStorage` và được kiểm lại khi đọc; đăng nhập bằng mã dùng cùng cách lưu.
- **FR-031:** Đích sau đăng nhập, theo thứ tự: (1) có `next` hợp lệ → về đó (kể cả lần đầu: người đến từ "Đăng ký khoá này", từ chấm thử, từ liên kết thư mời không bị chặn bởi màn lần đầu); (2) lần đầu (`onboarding_completed=false`) → trang "Lần đầu vào" của G07; (3) còn lại → `/home`. Tài khoản chưa có khoá cũng về `/home` (G07 hiện trạng thái "Chưa có khoá"), **không** về Thư viện. Không còn bước bắt buộc nhập mã kích hoạt. Tài khoản bị tạm ngưng thấy câu ở màn 9 sau khi đăng nhập xong.
- **FR-032:** `/activate`: nhập mã → "Kiểm tra mã" gọi API xem trước (không tiêu mã) → hiện khoá/lớp, thời hạn, số lượt chấm AI kèm mã, cách chấm (Writing: AI chấm, giáo viên duyệt rồi mới trả; Speaking: AI chấm, trả ngay) → "Xác nhận mở khoá" / "Xác nhận quyền luyện lại" mới ghi nhận. Lỗi (00 mục 2 điểm 22, đã chốt): một câu chung cho ba ca không tìm thấy / hết hạn dùng / đã dùng cho tài khoản khác; hai câu riêng "Bạn đã có khoá này" (mã không bị tiêu) và "Bạn đã dùng mã này rồi"; dán nhầm mã đăng nhập 6 số (kiểm ở trình duyệt, không gửi). Không có cấu hình tách ba ca đầu. Ô nhận dán cả chuỗi có gạch; bỏ khoảng trắng, đổi chữ hoa, tự thêm gạch. Chưa đăng nhập → `/login?next=/activate`.
- **FR-033:** Lượt xem trước mã tính chung giới hạn số lần thử của ACTIVATELIMIT-0034 (không mở đường dò mã): 5 lần thử trong 15 phút cho cả xem trước và kích hoạt (00 mục 2 điểm 22); hết → thông báo `activate_rate_limited` hiện có. Lỗi mã: một câu chung, cộng hai câu riêng an toàn "Bạn đã có khoá này" và "Bạn đã dùng mã này rồi".
- **FR-035:** `/courses/[slug]/enroll` (màn 1): thông tin lấy từ tài khoản; số điện thoại tuỳ chọn; ô đồng ý Điều khoản + Chính sách hoàn tiền bật/tắt nút "Tạo đơn và xem thông tin chuyển khoản"; chỉ khi bấm nút mới gọi API tạo đơn; rời trang trước đó không để lại đơn.
- **FR-036:** Một tài khoản có tối đa một đơn mở mỗi khoá: tạo đơn khi đã có đơn mở → API G04 trả đơn đang mở (200) và trang chuyển tới đơn đó, không tạo đơn thứ hai.
- **FR-037:** `/enroll/[orderCode]` hiện đúng màn theo `status` của đơn: `awaiting_transfer` → màn 2; `transfer_reported` → màn 3; `needs_info` → màn 3 với khối màn 6 (thiếu tiền hoặc chưa tìm thấy khoản chuyển), lời nhắn của admin chép nguyên văn và hạn bổ sung; `confirmed` → màn 4, có thừa tiền thì kèm khối "Thừa tiền · đã mở khoá"; `expired` / `cancelled` → màn 5 với lý do thật của đơn. Nhãn trạng thái phía học viên: Chờ chuyển khoản · Chờ xác nhận · Cần bổ sung · Đã mở khoá · Hết hạn · Đã huỷ. Đơn không thuộc người xem → API trả 404 `order_not_found` như đơn không tồn tại (không lộ tồn tại); trang không hiện màn lỗi mà về `/account/orders` kèm dải "Không tìm thấy đơn đăng ký này." (PUBLICSITE-0059 FR-013, mục 5.5). Mọi màn dùng thanh học viên; số lượt chấm AI trên thanh chỉ hiện từ màn 4.
- **FR-038:** Màn 2: mã VietQR sinh từ tài khoản nhận (cấu hình), số tiền, mã đơn; khối chuyển tay có nút "Sao chép" (số tài khoản không dấu cách, số tiền chỉ chữ số), đổi "Đã sao chép" 3 giây qua `role="status"`; hạn giữ đơn hiện theo `pay_by` của server; có câu "Thông tin chuyển khoản này cũng đã gửi tới <email> ngay khi tạo đơn"; 390px có "Lưu ảnh mã QR".
- **FR-039:** "Tôi đã chuyển khoản" gọi API báo chuyển (idempotent); "Huỷ đơn này" luôn hỏi lại một lần đúng câu chữ ở tờ ThanhToan màn 5 (nút "Huỷ đơn" / "Giữ đơn").
- **FR-040:** Màn 3 tự sang màn 4 khi admin xác nhận, không cần tải lại: hỏi lại trạng thái đơn mỗi 20 giây khi tab đang hiện, dừng khi tab ẩn, dừng hẳn sau 30 phút (hiện "Bạn không cần ở lại trang này").
- **FR-041:** `/account/orders` (màn 7): mới nhất ở trên; mỗi dòng đúng một việc tiếp theo theo trạng thái (Tiếp tục thanh toán · Xem trạng thái · Xem hướng dẫn · Vào học · Xem chi tiết); chưa có đơn → "Bạn chưa đăng ký khoá nào." + "Xem các khoá online" + "Nhập mã kích hoạt của lớp"; không vẽ bảng rỗng.
- **FR-042:** Thư về đơn là bốn thư bắt buộc, do G04 gửi (mẫu `order_created`, `order_pay_reminder`, `order_needs_info`, `order_confirmed`; câu chữ và bản `.html` do G05-T14 hoàn thiện theo tờ EmailMau thư 4, 5, 14, 6): đã tạo đơn (ngay khi tạo) · nhắc chuyển khoản (một lần trước hạn giữ) · đơn cần bạn bổ sung (mỗi lần admin chuyển sang Cần bổ sung hoặc ghi sai lệch số tiền) · khoá đã mở. Báo đã chuyển, huỷ, hết hạn chỉ là thông báo trong ứng dụng. Việc của G05: câu chữ trên màn chỉ nhắc tới thư ở đúng bốn chỗ đó (màn 2 "đã gửi … ngay khi tạo đơn"; màn 3 "khớp thì … bạn nhận email"; khối màn 6 "Chúng tôi đã gửi thư tới …"; màn 4 "Email xác nhận đã gửi tới …"), không hứa thư ở chỗ khác.
- **FR-043:** `/contact` gửi được khi chưa đăng nhập; kiểm ô bắt buộc khi bấm gửi (không khi đang gõ); lỗi dưới ô + tóm tắt đầu biểu mẫu nhận tiêu điểm; nút "Đang gửi…" vô hiệu tới khi có kết quả; không có ô đính kèm; giới hạn tần suất theo IP băm và theo email; lỗi máy chủ giữ nguyên dữ liệu đã nhập.
- **FR-044:** Mọi chữ hiển thị trong gói theo mục 3 quy ước chung: "Đăng ký khoá", "Đơn đăng ký", "Học phí", "Thanh toán", "Đăng ký lại", "giáo viên"; cấm "mua", "bán", "giá", "đơn hàng", "thầy", "giảng viên" ở màn, thư, thông báo. Luôn ghi đủ "mã đăng nhập" hoặc "mã kích hoạt của lớp", không viết trống "mã".
- **FR-046:** (mới) `/login` có đúng hai cách vào: "Tiếp tục với Google", hoặc nhập email → "Gửi mã đăng nhập" → nhập mã 6 số. Không có mật khẩu, không có màn đăng ký riêng, không có quên/đặt lại/đổi mật khẩu, không có thư xác minh email bằng liên kết, không có liên kết đăng nhập trong thư. Lần đầu Google hoặc lần đầu nhập đúng mã cho một email mới là tạo tài khoản. Cùng email thì Google và mã vào cùng một tài khoản.
- **FR-047:** (mới) Màn nhập mã (màn 2): sáu ô chỉ nhận số; ô đầu `autocomplete="one-time-code"`, `inputmode="numeric"`; dán hoặc tự điền vào ô nào cũng rải đủ sáu ô, bỏ khoảng trắng và gạch; Backspace ở ô trống lùi về ô trước; đủ sáu số thì tự gửi một lần và khoá ô; "Gửi lại mã" đếm lùi theo `resend_after_s` của máy chủ; "Dùng email khác" về màn 1.
- **FR-048:** (mới) Tám trạng thái lỗi của màn 3, mỗi trạng thái đúng câu chữ trên tờ: 3a mã chưa đúng, còn N lần thử (xoá ô, con trỏ về ô đầu); 3b hết lần thử, mã bị huỷ, nút "Gửi mã mới"; 3c mã hết hạn; 3d gửi quá nhiều lần, tạm dừng gửi, có nút "Tiếp tục với Google"; 3e thư chưa tới; 3f lỗi mạng (giữ mã trong ô, không tính lần thử); 3g email đã gắn với Google (chỉ hiện sau khi mã đúng, một lần, ở đầu trang đích); 3h dán nhầm mã kích hoạt 12 ký tự (không gửi, chỉ chỗ nhập đúng). Lỗi nằm ngay dưới ô, không dùng "không hợp lệ", "sai".
- **FR-049:** (mới) Mọi giới hạn của mã đăng nhập là cấu hình, không ghi cứng: thời hạn mã, số lần thử mỗi mã, số lần gửi mỗi email trong một cửa sổ, số lần gửi mỗi địa chỉ mạng, thời gian chờ gửi lại (5.6). Gửi mã mới thì mã cũ hết hiệu lực; đăng nhập xong thì mã bị huỷ. Số lần thử mỗi mã được bảo đảm trên đường đi qua backend; giới hạn gửi và công tắc áp ở ranh giới cấp phiên theo FR-062.
- **FR-050:** (mới) Không tiết lộ email đã có tài khoản hay chưa: "Gửi mã đăng nhập" luôn sang màn 2 với cùng câu chữ, cùng mã trạng thái HTTP, cùng hình dạng phản hồi; email mới vẫn nhận mã; các thông báo trước khi mã đúng giống nhau cho mọi email. "Email đã gắn với Google" (3g) và "tài khoản bị tạm ngưng" chỉ hiện sau khi mã đúng.
- **FR-051:** (mới) Hai loại mã không bị nhầm: ô mã đăng nhập nhận ra chuỗi 12 ký tự dạng mã kích hoạt (3h); ô mã kích hoạt nhận ra chuỗi đúng 6 chữ số (lỗi "Đây có vẻ là mã đăng nhập 6 số"); cả hai trang có câu phân biệt hai loại mã theo tờ.
- **FR-052:** (mới) Một phiên mỗi tài khoản học viên (vai trò `user`/`student`; admin và giáo viên không bị giới hạn), áp như nhau cho Google và mã: ngay sau đăng nhập, nếu tài khoản đang mở ở thiết bị khác → màn 8a ("Tiếp tục ở đây" / "Huỷ"; Huỷ là thiết bị này không đăng nhập); nếu bên kia đang làm bài có giờ → màn 8b, **không có nút chiếm phiên**, hiện "còn khoảng N phút" theo máy chủ; thiết bị bị chiếm phiên hiện màn 8c ở lần thao tác kế tiếp, sau khi đã lưu nháp. Cờ của G04 tắt thì không màn nào trong ba màn này xuất hiện.
- **FR-053:** (mới) Hộp "Đăng xuất khỏi mọi thiết bị" (màn 5a–5c): hỏi lại một lần; khi có bài có giờ đang chạy ở thiết bị khác thì chen khối cảnh báo 5b (bài có giờ không bị cắt ngang, thiết bị đó đăng xuất khi bài kết thúc); xong hiện 5c với nút "Đăng nhập lại". Mở được từ 8b, 8c và từ Hồ sơ › Bảo mật (G07 gắn).
- **FR-054:** (mới) Mọi route G05 khi có phiên dùng thanh học viên 5 mục (trừ `/` theo PUBLICSITE-0059 FR-002 và các trang pháp lý dùng khung công khai với chân trang gọn); thanh công khai chỉ cho người chưa đăng nhập. `/login` dùng thanh công khai tối giản.
- **FR-055:** (mới) Màn 4 "Đã mở khoá" ghi dòng "Tài khoản: Đã kích hoạt. Mở luôn phần luyện Reading, Listening, ngữ pháp và từ vựng dành cho tài khoản đã kích hoạt.", hạn học, số lượt cộng thêm ("Writing và Speaking dùng chung", hạn dùng nếu có). Đơn đăng ký lại có lượt chuyển từ kỳ trước thì thêm một dòng riêng "Chuyển từ kỳ trước: N lượt, dùng đến <ngày>" (N và ngày lấy từ `GET /api/me/courses` của G04, mục 5.2; không có thì ẩn dòng, không tự tính); nếu lượt chuyển chưa được ghi lúc trang mở (G04 chuyển chậm nhất một chu kỳ quét 5 phút) thì ghi "Lượt chưa dùng của kỳ trước sẽ được cộng trong ít phút". Sau khi mở khoá bằng mã kích hoạt, màn cùng mẫu ghi "Mở bằng mã kích hoạt" thay cho mã đơn.
- **FR-056:** (mới) Màn 5 "Hết hạn" ghi rõ: đã chuyển tiền thì đừng chuyển lại; khi admin thấy khoản chuyển khớp mã đơn, đơn tự mở lại và khoá mở. Có hai nút "Tạo đơn mới" và "Tôi đã chuyển cho đơn này". Khi đơn `expired` chuyển thành `confirmed` ở máy chủ, trang hiện màn 4 như xác nhận thường.
- **FR-057:** (mới, sau cờ, mặc định TẮT) Khối "Học trước trong lúc chờ · chương 1" ở màn 3 chỉ được vẽ khi cờ `enroll_prelearn_chapter1` bật. Đây là đề xuất chưa duyệt (mục 10 câu 8); cờ tắt thì không vẽ khối, giữ câu "Trong lúc chờ, Thư viện vẫn mở miễn phí".
- **FR-058:** (mới) Liên kết trong thư mời của lớp mở `/activate` với mã điền sẵn vào ô (màn 6b): chỉ điền, không tự kiểm tra, không tự xác nhận; chưa đăng nhập thì qua `/login` rồi quay lại với mã còn trong ô; mã sai/hết hạn/đã dùng hiện đúng lỗi của màn 6, ô vẫn giữ mã để sửa.
- **FR-059:** (mới, 00 mục 2 điểm 23) Đổi email đăng nhập (tờ TaiKhoan, khối "Email đăng nhập": "Xác nhận bằng mã 6 số gửi tới email mới; đổi xong có thư báo về email cũ."). Thành phần `ChangeEmail` do G05 dựng, G07 gắn vào Hồ sơ. Luồng: nhập email mới → "Gửi mã" → nhập mã 6 số gửi tới email MỚI (dùng lại sáu ô và các trạng thái lỗi 3a–3f của FR-047, 048) → đổi xong hiện "Đã đổi email đăng nhập" và email mới ở Hồ sơ. Quy tắc: (a) phải đang đăng nhập; chỉ vai trò học viên (`user`/`student`); (b) mã chỉ gửi tới email mới, không gửi tới email cũ; (c) đổi xong gửi MỘT thư báo về email CŨ (mẫu `email_changed_notice`: giờ đổi, email mới che bớt, cách liên hệ nếu không phải bạn); địa chỉ gửi thư học viên chưa được cấu hình thì không cho bắt đầu đổi; thư báo lỗi lúc gửi sau khi đã đổi thì việc đổi vẫn giữ và lỗi được ghi lại để admin xử lý; (d) cập nhật email trong Supabase Auth và `users.email` qua một bản ghi đổi email có trạng thái (`requested` → `pending` → `auth_changed` → `completed`, lỗi giữa chừng → `needs_reconcile`); chỉ báo "Đã đổi email đăng nhập" khi bản ghi `completed` (Auth và `users.email` khớp, phiên khác đã huỷ); bước nào lỗi thì màn báo "Đang hoàn tất đổi email" và một tác vụ đối soát chạy lại các bước còn thiếu (idempotent) tới khi khớp; vai trò, tạm ngưng và bài có giờ được kiểm lại ở bước xác nhận mã, không chỉ lúc gửi mã; (e) email mới đã thuộc tài khoản khác: màn và phản hồi giống hệt ca email còn trống (vẫn sang bước nhập mã, cùng câu chữ), không mã nào đúng, không câu nào nói "email đã có tài khoản"; (f) đổi xong thì mọi phiên khác của tài khoản bị đăng xuất, phiên đang dùng giữ nguyên; (g) không cho đổi khi tài khoản đang có bài có giờ chạy ở bất kỳ thiết bị nào (câu: "Bạn đang làm bài có giờ. Đổi email sau khi nộp bài."); (h) tài khoản từng đăng nhập bằng Google: mặc định tạm KHÔNG cho đổi, hiện "Tài khoản này đăng nhập bằng Google. Email đi theo tài khoản Google của bạn." (mục 10 câu 19); (i) giới hạn gửi và giới hạn thử dùng chung bảng đếm và cấu hình của mã đăng nhập (FR-049); (j) mỗi lần đổi thành công ghi một dòng nhật ký (ai, email cũ, email mới, lúc nào); (k) cờ `email_code_login` tắt thì khối "Đổi email đăng nhập" không hiện; trên production khối này chưa bật chừng nào "Secure email change" của Supabase còn bật (khi đó GoTrue gửi mã tới cả email cũ, trái (b)). (l) gọi thẳng GoTrue (`PUT /auth/v1/user`, `/auth/v1/verify`) bằng khoá publishable không đổi được email: Send Email Hook chỉ gửi mã đổi email khi có bản ghi `requested` do backend tạo sau khi đã kiểm (a), (g), (h), (i); không có thì không mã nào được gửi. Mọi lệch giữa email trong Supabase Auth và `users.email` mà không có bản ghi đang mở đều được tác vụ đối soát phát hiện, đưa vào `needs_reconcile` và báo chủ dự án. Bản ghi `pending` treo (GoTrue có thể đã đổi nhưng backend chưa kịp ghi) cũng được đối soát theo email thật trong Auth. Không có mật khẩu, không có liên kết xác nhận trong thư.
- **FR-060:** (mới, 00 mục 2 điểm 23) Thư "khoá đã mở đăng ký": khi một khoá chuyển sang đang mở đăng ký, mỗi người đã bấm "Báo cho tôi khi mở" cho khoá đó nhận đúng một thư (mẫu `course_open_alert`): tên khoá, liên kết tới trang khoá, liên kết bỏ nhận. Không gửi cho người đã bỏ nhận và người đã có quyền học khoá đó. Một người một khoá chỉ nhận MỘT thư, suốt đời dòng đăng ký: khoá đóng rồi mở lại không gửi lần hai, kể cả khi người đó bấm "Báo cho tôi khi mở" lần nữa (yêu cầu của chủ dự án 18/11 chiều: "một lần mỗi người mỗi khoá"; mục 10 câu 20). Thư đi qua `learner_email_outbox` của G04 (dòng dùng `to_email`); chậm nhất một chu kỳ quét (5 phút) sau khi khoá mở. Thư này là thư người dùng tự xin, không đọc công tắc `users.notification_email`. Ngay trước **mỗi** lần gửi (kể cả lần thử lại), bên gửi kiểm lại: dòng đăng ký chưa bỏ nhận, địa chỉ trên thư vẫn là địa chỉ của dòng, người đó chưa có quyền học khoá, khoá vẫn mở; sai một điều thì không gửi và ghi lý do. Khoá chống gửi lặp là `dedupe_key = 'open_alert:<id dòng>'` thống nhất với outbox của G04. Phản hồi đăng ký cho khách không bao giờ trả mã bỏ nhận của một dòng đã có; khách bỏ nhận bằng liên kết trong thư hoặc sau khi đăng nhập đúng email đó.
- **FR-061:** (mới) Điểm chạm với "Lần đăng nhập gần đây" (bảng `learner_login_events`, API `GET /api/account/login-events` của G04; giao diện G07): G05 bảo đảm mỗi lần đăng nhập xong, ở cả hai cách vào, trình duyệt gọi `GET /api/account/session/status` đúng một lần trước khi đi tới đích (T20 đã có), để cổng phiên của G04 ghi nhận phiên mới ngay; cách đăng nhập (`google` / `email_code`) G04 tự đọc từ token, nên phiên của đường mã 6 số phải là phiên GoTrue cấp nguyên vẹn (mục 5.2b). G05 không tạo bảng, không tạo API đọc, không gọi hàm ghi.
- **FR-062:** (mới, HOLD 23/11) Giới hạn gửi mã và công tắc `email_code_login` có hiệu lực ở **chính ranh giới cấp phiên của Supabase Auth** (giới hạn theo email chỉ đếm một lần, ở hook; route chỉ đếm theo địa chỉ mạng và tài khoản, và trả đúng lỗi khi hook từ chối), không chỉ ở route backend: (a) Send Email Hook của Supabase Auth gọi backend cho mọi thư mã (đăng nhập và đổi email, kể cả khi ai đó gọi thẳng GoTrue bằng khoá publishable); backend kiểm cờ và bộ đếm gửi theo email rồi mới gửi qua Resend, cờ tắt hoặc vượt giới hạn thì hook trả lỗi và không thư nào đi; (b) Custom Access Token Hook (hàm Postgres) chỉ cho qua tường minh đăng nhập Google, làm mới phiên và phương thức nhân viên đã xác nhận; đăng nhập bằng mã, tạo tài khoản bằng mã và đổi email bị từ chối khi cờ tắt hoặc tài khoản đang bị khoá mã (bảng `login_code_locks` theo `user_id`, backend ghi khi hết lượt thử hoặc khi đăng xuất khỏi mọi thiết bị; email chưa có tài khoản lúc bị khoá chỉ bị chặn trên đường qua backend); mọi phương thức khác bị từ chối (fail-closed); "Confirm email" của Supabase luôn bật; (c) số lần thử mỗi mã (FR-049) chỉ được cam kết trên đường đi qua backend; đường gọi thẳng `/auth/v1/verify` bị chặn bởi giới hạn thử của GoTrue, thời hạn mã và (b), và spec không hứa hơn thế cho tới khi có bằng chứng staging được anh Andy duyệt. Cấu hình Supabase production giữ nguyên (không nới giới hạn) cho tới lần duyệt riêng.

## Acceptance scenarios

### Scenario 1 — Đăng ký khoá quay lại đúng chỗ (gói kịch bản 3)

- **Given** khách ở trang một khoá đang mở
- **When** bấm "Đăng ký khoá này" và đăng nhập Google
- **Then** tới `/login?next=/courses/<slug>/enroll` có dòng "Bạn đang đăng ký <tên khoá>", sau đăng nhập về đúng `/courses/<slug>/enroll`, chưa có đơn nào được tạo

### Scenario 2 — Tài khoản mới bằng mã (gói kịch bản 4)

- **Given** email chưa từng có tài khoản, cờ `email_code_login` bật trên staging
- **When** nhập email, bấm "Gửi mã đăng nhập", nhập đúng 6 số trong thư
- **Then** đã đăng nhập, tài khoản mới được tạo, tới trang lần đầu

### Scenario 3 — Đơn tới khi mở khoá (gói kịch bản 6, 8)

- **Given** học viên ở màn 1 đơn đăng ký trên staging
- **When** chọn ô đồng ý, tạo đơn, bấm "Tôi đã chuyển khoản", rồi admin xác nhận
- **Then** màn 2 có QR và hạn giữ theo `pay_by`, hộp thư thử nhận thư "Đã tạo đơn"; màn 3 không gửi thư; trong ≤ 20 giây màn 3 tự sang màn 4 có dòng "Tài khoản: Đã kích hoạt…"

### Scenario 4 — Mã kích hoạt kiểm trước (gói kịch bản 13)

- **Given** học viên lớp mở `/activate#code=…` khi chưa đăng nhập
- **When** đăng nhập rồi bấm "Kiểm tra mã"
- **Then** về `/activate` với mã còn trong ô, chưa gì được kiểm; sau "Kiểm tra mã" thấy khoá của lớp và thời hạn, mã chưa bị tiêu cho tới khi "Xác nhận"

### Scenario 5 — `next` độc (gói kịch bản 15)

- **Given** `next=//evil.com`
- **When** đăng nhập xong
- **Then** không rời averlearning

## Edge cases

- Mã đăng nhập, email, token không vào URL, log, `localStorage`; `next` chỉ ở `sessionStorage` và được kiểm lại khi đọc (gói mục 8).
- Email chưa yêu cầu mã → `login_code_incorrect` như mã sai; phản hồi `request` giống nhau cho mọi email (FR-050).
- Khoá publishable trong trình duyệt cho phép gọi thẳng GoTrue, bỏ qua bộ đếm backend: Send Email Hook và Custom Access Token Hook giữ giới hạn gửi và công tắc ở ranh giới cấp phiên (FR-062); số lần thử mỗi mã trên đường gọi thẳng chỉ có giới hạn của GoTrue (câu hỏi mở 4).
- Đổi email lỗi giữa chừng (Auth đã đổi, `users.email` chưa): bản ghi `needs_reconcile`, màn không báo xong, tác vụ đối soát chạy lại (FR-059 d).
- Học viên bỏ nhận hoặc có khoá trong lúc thư đang chờ gửi: bên gửi kiểm lại và không gửi (FR-060).
- Hai tài khoản cho một email (Google và mã) nếu gộp danh tính chưa bật: kiểm trên staging trước khi bật cờ.
- `access_codes.is_used/used_by/used_at` không bao giờ bị luồng xem trước đổi; chỉ `/auth/activate` ghi.
- Đơn của người khác → 404 `order_not_found` như không tồn tại, trang về `/account/orders` kèm dải thông báo.
- Đơn `expired` thành `confirmed` ở máy chủ → màn 4 như thường (FR-056).
- Cấu hình ngân hàng thiếu → `orders_paused` hoặc `transfer: null`: màn hiện thông báo thay QR, không tự điền số tài khoản thật.
- Đổi email khi đang có bài có giờ → chặn; email mới đã thuộc tài khoản khác → màn giống hệt ca còn trống; thư báo về email cũ lỗi sau khi đổi → giữ việc đổi, ghi lỗi.
- Khoá đóng rồi mở lại: không ai nhận thư lần hai (FR-060, câu 20).
- Câu chữ cấm ("mua", "bán", "giá", "đơn hàng", "thầy", "giảng viên") không lọt vào màn, thư, thông báo (FR-044).
- Không thực hiện trên production: tạo đơn, nhập mã kích hoạt thật, bật cờ, áp migration khi anh chưa gõ duyệt.

## Success criteria

- Kịch bản 3–15, 17, 19, 20 của gói chạy trên staging, có ảnh; ghi rõ API thật hay giả của G04 ở từng kịch bản.
- Quét QR bằng ít nhất 3 ứng dụng ngân hàng điền đúng tài khoản, số tiền, nội dung `AVER-XXXXXX` (không bấm chuyển).
- 0 dòng log chứa email, mã hay token trong các route mới (kiểm bằng test bắt log).
- `test_activation_gate_inventory.py` xanh với mỗi route mới có lý do miễn trừ.

## Related specifications

- COURSEACCESS-0055 (G04): sản phẩm, quyền, đơn, sổ lượt, outbox, API phiên, `describe_code_grant`.
- PUBLICSITE-0059 (G05 nhóm A): trang khoá, nút "Báo cho tôi khi mở", khối liên hệ, `site-info`.
- FREETRIAL-0047, TRIALCAP-0080: `safeNext` (FR-024), điều kiện provider (FR-007).
- ACTIVATELIMIT-0034: `fn_activate_attempt_check` (mig 334) mà mig 392 thay thân.
- LEARNERCORE-0063 (G07): Hôm nay, "Lần đầu vào", Hồ sơ gắn `ChangeEmail` và hộp đăng xuất mọi thiết bị.
- NOTIFY-0079: thông báo trong ứng dụng cho đổi trạng thái đơn.

## Open questions

Các câu của gói mục 10 thuộc spec này; người thực thi dùng mặc định tạm ở cột cuối cho tới khi anh Andy trả lời. Câu 9, 10, 15, 16 đã có trả lời (mục "Quyết định đã có").

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| 2 | Vẽ ảnh VietQR cục bộ (cần thêm một thư viện QR: frontend gói `qrcode` MIT, hoặc backend `segno` BSD) hay dùng ảnh từ dịch vụ ngoài qua `ENROLL_VIETQR_IMAGE_TEMPLATE` của G04 (gửi số tài khoản, số tiền, mã đơn ra ngoài)? | Cục bộ | Không thêm thư viện, không gọi dịch vụ ngoài: màn 2 hiện khối chuyển tay đầy đủ, chưa có ảnh QR, cho tới khi anh chọn |
| 3 | Các số của mã đăng nhập (tờ ghi XXX): thời hạn mã, số lần thử mỗi mã, số lần gửi mỗi email và mỗi địa chỉ mạng trong bao lâu, thời gian chờ gửi lại | 10 phút · 5 lần · 5 lần mỗi email và 20 lần mỗi địa chỉ mạng trong 30 phút · 45 giây | Như đề nghị, sau cờ `email_code_login` tắt |
| 4 | Đường gửi mã 6 số (mục 5.6): **A** — OTP của Supabase Auth, thư đi qua SMTP của Supabase trỏ vào Resend, backend chỉ đếm lần gửi/lần thử; hay **B** — backend tự sinh mã, gửi bằng Resend API (`learner_email.send_direct`), tự kiểm rồi xin phiên bằng admin API? Có bật thêm ô chống máy của Supabase Auth cho đường gửi mã không? | A (phiên vẫn do Supabase cấp; không giữ bí mật mã trong cơ sở dữ liệu của ta; không thêm đường cấp phiên bằng khoá service); bật ô chống máy khi mở cho production | A, qua hai route backend; chưa bật ô chống máy. Chọn B thì dừng T18, sửa spec, thêm khoảng 1 phiên |
| 5 | (thu hẹp chiều 18/11: dịch vụ gửi đã chốt là Resend) Còn hai việc: (a) địa chỉ gửi và tên người gửi cho thư học viên và thư mã, trên tên miền đã xác minh ở Resend; (b) anh Andy nhập cấu hình SMTP của Resend và dán hai mẫu thư trên Supabase, staging rồi production (sáu việc ở mục 5.6) | (a) Cùng địa chỉ với thư học viên của G04 (`LEARNER_EMAIL_FROM`; GOI-04 Q9 đề nghị `hoc@averlearning.com`), tên người gửi "Aver Learning"; (b) làm theo `rollout.md` khi T18 đã merge | Cờ `email_code_login` tắt; người thực thi không đụng cài đặt; `rollout.md` để trống chỗ địa chỉ gửi |
| 8 | "Học trước chương 1 trong lúc chờ xác nhận" (đề xuất HV-12, có trên tờ ThanhToan màn 3 và HomNayTrangThai mục 3 với nhãn "chờ chủ dự án duyệt") có làm không? Nếu có: gói nào mở quyền xem bài chương 1 cho đơn đang chờ (cần quy tắc quyền ở G04/G07) | Chờ anh quyết; không có mặc định "bật" | Cờ `enroll_prelearn_chapter1` tắt; không vẽ khối, không mở quyền |
| 13 | Trong lúc G07-T26 chưa merge (hôm nay tài khoản chưa kích hoạt vào `/home` là bị đẩy về `/login`), tài khoản chưa có khoá đăng nhập xong tạm tới đâu? Đây là đích tạm kỹ thuật, không thay quyết định "về Hôm nay" | `/courses` (trang của chính gói này, có lối nhập mã kích hoạt và lối chấm thử) | `/courses`; chuyển sang `/home` khi bật `AVER_HOME_OPEN_TO_INACTIVE='1'`; gỡ cờ sau khi G07-T26 đã merge và bật |
| 14 | Đơn "Cần bổ sung": tờ bảo người học gửi biên lai qua kênh liên hệ, không vẽ nút nào; API G04 có bước người học báo "đã bổ sung" kèm ghi chú. Có hiện nút "Tôi đã bổ sung" không? | Có, một nút mở ô ghi chú ngắn | Có nút; câu chữ đưa vào `ui-states.md` chờ duyệt |
| 17 | Khi nào bật `AVER_PUBLIC_COMMERCE` và `email_code_login` trên production? | Sau khi có học phí thật, nội dung pháp lý đã duyệt, SMTP đã cấu hình, và kịch bản mục 9 qua trên staging | Cả hai tắt |
| 19 | (mới) Đổi email đăng nhập với tài khoản từng vào bằng Google: sau khi đổi, nút Google với Gmail cũ vẫn vào đúng tài khoản này (danh tính Google gắn theo tài khoản Google, không theo email), dễ gây hiểu nhầm. Cho đổi không? Admin, giáo viên có được đổi qua màn này không? | Tài khoản có Google: không cho đổi ở đợt này, hiện câu giải thích; muốn đổi thì liên hệ. Admin, giáo viên: không (đổi qua người quản trị) | Như đề nghị: 409 `email_change_google_linked`; chỉ vai trò `user`/`student` |
| 20 | (mới) Khoá đóng rồi mở đăng ký lại: người đã nhận thư lần trước có nhận lần hai không? | Không ai nhận lần hai, kể cả người bấm "Báo cho tôi khi mở" lần nữa (một lần mỗi người mỗi khoá). Nếu anh muốn người bấm lại được báo lại: đổi `dedupe_key` và quy tắc đặt lại `notified_at` | Không gửi lần hai |
| 21 | (mới) Ba thư chưa có trên tờ EmailMau: "khoá đã mở đăng ký" (`course_open_alert`), "email đăng nhập đã đổi" (`email_changed_notice`), mã đổi email. Ai duyệt câu chữ? | Người thực thi soạn theo giọng thư 1 và thư 6 của tờ, đưa vào `ui-states.md`; anh duyệt trong PR spec; bổ sung tờ EmailMau sau | Dùng câu chữ ở mục 5.7 và G05-T14 |
| 22 | (mới) Nhật ký đổi email (`account_email_changes`) lưu email cũ và mới dạng đọc được để admin trả lại tài khoản khi bị chiếm. Có chấp nhận không, giữ bao lâu? | Chấp nhận; giữ theo tài khoản (xoá khi xoá tài khoản) | Như đề nghị; chưa có màn admin đọc bảng này |
