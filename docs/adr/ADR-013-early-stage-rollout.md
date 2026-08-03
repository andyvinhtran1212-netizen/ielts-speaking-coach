# ADR-013 — Early-stage rollout profile (thay soak-dài-freeze cho route low-traffic)

**Status:** ACCEPTED 2026-07-25 (chủ dự án ratify) · Sửa: §12.3, ADR-007 §6, B36, DEBT-2026-07-22-H
· **SỬA ĐỔI A1 (2026-08-03)** — thay cửa sổ-thời-gian bằng cổng-bằng-chứng cho route low/zero-traffic; **đọc mục A1 ở cuối trang trước khi áp bất kỳ điều kiện PASS nào ở thân bài**

## Bối cảnh
Sản phẩm còn **early-stage**: <100 user, chưa SEO/marketing, traffic thấp (grammar ~1 view/ngày; nhiều route 0/ngày). **Blast-radius của một lỗi = nhỏ** (ít người bị ảnh hưởng). Đồng thời hạ tầng rollback đã mạnh:
- Vercel **Pro**: Instant Rollback về **bất kỳ deployment eligible** (≤12s), Undo ≤7s, auto-promote ~20s (ADR-007, drilled Gate B).
- Telemetry **tagged** theo implementation/release (ADR-012) → quy kết một-biến qua **tag**, không cần freeze.

Soak-dài-freeze (7/14/21 ngày) được thiết kế cho sản phẩm đã scale. Áp nguyên si vào early-stage tạo 3 vấn đề đã chứng minh:
1. **Sàn không có cơ sở thống kê** (DEBT-H): n=20–30 → KTC 95% vẫn chứa ngưỡng breach; cần n=72. 21 ngày grammar = "20 lượt ÷ 1/ngày", vô nghĩa về power.
2. **False-breach ở n nhỏ**: Pilot 1 dính LCP 4180ms vì **3 outlier mạng khách** trên n=22 — verdict breach dù code không lỗi. Route low-traffic sẽ gặp thường xuyên hơn.
3. **Chi phí freeze cắt cổ**: 21 ngày đóng băng main cho một route ~1 view/ngày = 3 tuần chặn mọi việc khác, đổi lấy một mẫu vẫn quá bé để kết luận.

## Quyết định
Áp **"early-stage rollout profile"** cho route **low/zero-traffic** (mặc định ở giai đoạn này, KHÔNG phải exception). Route có traffic thật đạt sàn (Speaking dư 24×) vẫn dùng soak chuẩn.

**BỎ:**
- Freeze cứng dài + quy tắc "mọi merge reset đồng hồ" cho route low-traffic.
- Sàn "N eligible interactions" (100/20) làm điều kiện PASS cho route low-traffic — nó là số làm tròn không suy từ power.

**THAY bằng, mỗi cutover low-traffic:**
1. **Cutover với telemetry tagged** → quy kết một-biến đến từ **tag** (implementation/release), không từ freeze. Merge khác được phép; tag phân biệt chúng.
2. **Cửa sổ quan sát ngắn 48–72h** — đủ để lộ lỗi *thời-gian-trôi* (cache/ISR hết hạn, token refresh, cold start, cron) + *đa-dạng-client*. KHÔNG nhằm gom mẫu organic có ý nghĩa thống kê.
3. **Synthetic gánh vế số-lượng** — smoke chạy trên production ~10 phút/lần đạt n≥72 trong nửa ngày, tất định; bắt lỗi tất định/diện-rộng. (Giới hạn: synthetic không bắt được lỗi client-cụ-thể như React #418 → vẫn cần vế 2.)
4. **Risk acceptance có ghi rõ** cho từng cutover (route, ngày, ai duyệt, rollback plan). Đây là mặc định early-stage, minh bạch — không phải né gate.

**GIỮ CỨNG (bất kể scale):**
- Rollback-readiness đã drill (ADR-007) + kill-switch mutation (ADR-010).
- **Persistence/security invariant breach → rollback NGAY, bất kể sample size.**
- Telemetry tagged sống (ADR-012) — điều kiện tiên quyết (bài học audit F3 thật sự là cái này, không phải freeze).
- Rollback trigger vẫn canh, nhưng ở chế độ tuyệt đối + **synthetic-n làm mẫu chính**, organic chỉ tham khảo.

## Ma trận sàn mới (thay bảng §12.3)
| Lớp route | Điều kiện PASS |
|---|---|
| Public, traffic ≥3/ngày | Soak chuẩn 7 ngày + n organic đủ (giữ nguyên) |
| **Public/read-only, traffic <3/ngày** (grammar…) | **48–72h quan sát + synthetic n≥72 + risk acceptance** (bỏ "21 ngày", bỏ "20 interactions") |
| Authenticated mutation, traffic thấp | 48–72h + synthetic mutation coverage + N/N−1 consumer test (đã có) + risk acceptance |
| Core grading/exam | **Giữ nghiêm hơn**: cross-version resume phải pass + synthetic n≥72 + ≥72h + risk acceptance có incident-commander (đây là nhóm rủi ro cao nhất — bài thi/bài nói) |
| Zero-traffic | synthetic-only + risk acceptance (đã vậy) |

## Tốt-nghiệp (graduation)
Profile này là **hàm của scale hiện tại**. Tại mỗi gate (đặc biệt **Gate D — broad-scale ready**), re-đánh giá: khi traffic + user tăng (post-SEO/marketing), siết trở lại về sàn thống kê thật. Ghi mốc re-đánh giá vào quantitative register.

## Hệ quả tức thì
- **Pilot 2 (grammar)**: bỏ 21 ngày → 48–72h quan sát + synthetic crawl + risk acceptance. Từ "3 tuần freeze" xuống "~3 ngày".
- **Pilot 3+4 (profile)**: 14 ngày → 48–72h + synthetic mutation + N/N−1 (đã pass) + risk acceptance.
- **Phase 3–6**: phần lớn cutover đi profile early-stage → không còn chuỗi freeze dài nối tiếp; tổng lịch migrate rút ngắn đáng kể.
- **Core flows (Phase 6)** giữ nghiêm nhất (đúng chỗ đáng nghiêm) nhưng vẫn không freeze-21-ngày.

## Rủi ro & phản biện (ghi trung thực)
- **"Nới gate cho tiện?"** — Không: giữ nguyên (thậm chí nhấn mạnh) security/persistence gate + rollback-readiness; chỉ bỏ phần *đo-lường-bất-khả-thi* và *freeze-không-cần-thiết-khi-đã-Pro*. Có tiêu chí tốt-nghiệp rõ để siết lại khi scale.
- **Mất "diagnostic slow burn"?** — 48–72h vẫn lộ lỗi thời-gian-trôi; synthetic lộ lỗi diện rộng nhanh hơn organic. Cái mất là "cảm giác an toàn" của con số ngày lớn, không phải khả năng phát hiện thật.
- **Audit ngoài?** — Hồ sơ MẠNH HƠN: thay "≥N interactions" (mà auditor sẽ hỏi cơ sở, như đã xảy ra) bằng "synthetic n=72, KTC dưới ngưỡng, + risk acceptance ký tên" — trung thực về scale thay vì giả vờ significance.


---

# Sửa đổi A1 (2026-08-03) — cổng parity thay cửa sổ thời gian

**Status:** ĐỀ XUẤT, chờ chủ dự án ratify · Thay các điều kiện PASS ở "Ma trận
sàn mới" cho lớp low/zero-traffic. Phần còn lại của A0 giữ nguyên hiệu lực.

## Vì sao sửa — bằng chứng đo được, không phải ý kiến

A0 nói cửa sổ 48–72h **không** nhằm gom mẫu thống kê (đúng, giữ nguyên), mà để
lộ **lỗi thời-gian-trôi** + **đa dạng client**, và tự bảo vệ ở mục "Rủi ro &
phản biện": *"48–72h vẫn lộ lỗi thời-gian-trôi"*.

Câu đó **chỉ đúng khi có gì đó phát request trong cửa sổ.** Đo thực tế:

| Đo | Số |
|---|---|
| Request tới `/profile` trong trọn 25,1h cửa sổ (02–03/08) | **2 — cả hai của tôi** |
| Lượt organic | **0** |
| Synthetic chạm tới route | **0** — `playwright.production-smoke.config.js` không có `storageState` nên chạy ẩn danh, bị đẩy sang `/login.html` |

Cache hết hạn, token refresh, cold start, cron — **không cái nào hiện ra nếu
không ai gọi**. Với route vừa 0 organic vừa 0 synthetic, cửa sổ trôi qua trong
im lặng. Chờ 48h hay 72h đều cho cùng một thứ, và đó **không** phải "đo được
rằng không có lỗi".

Ngược lại, **cổng parity tìm ra 2 lỗi production thật trên đúng những route đã
qua cửa sổ này**:

| Lỗi | Route | Đã qua cửa sổ? | Vì sao cửa sổ mù |
|---|---|---|---|
| H1 dính chữ dưới 640px (#907) | `/grammar` | có | không lỗi JS, không status xấu — chỉ là chữ sai |
| Mất nút "Lưu bài" + CTA khách **9/20 lượt = 45%** (#908) | trang bài, pilot 2 | có, 48h | tính năng **không xuất hiện**; không exception, không page_view thiếu |

Dụng cụ của cửa sổ là lỗi JS, status, LCP và lượt xem. Cả hai lỗi trên **không
chạm vào cái nào**.

## Quyết định A1

Với route **low/zero-traffic**, thay **chờ-thụ-động-theo-lịch** bằng **ba cổng
chủ động, đo được**:

**G1 — Cổng parity (TRƯỚC cutover, chặn merge).**
So legacy ↔ Next trên **toàn bộ URL inventory** của route (không lấy mẫu), sạch
ở mức `high`. Mọi ngoại lệ phải có `reason`; ngoại lệ không còn khớp gì bị nêu
tên. Công cụ: `frontend/tooling/parity-diff.mjs`. Lưu lại kết quả lần chạy vào
cutover sheet. **Thay vế đúng-đắn-nội-dung.**

**G2 — Probe synthetic chủ động trải theo thời gian (SAU cutover).**
Đây mới là thứ thật sự thay vế **thời-gian-trôi**. Giá trị của cửa sổ chưa bao
giờ nằm ở việc *chờ*, mà ở **những request phát ra trong lúc chờ**. Nên: probe
gọi route mỗi N phút suốt một khoảng xác định, **bao gồm route cần đăng nhập**
— chính lỗ hổng đã làm cửa sổ `/profile` rỗng. PASS tính theo **kết quả probe**,
không theo tờ lịch.

**G3 — Ngưỡng lỗi TUYỆT ĐỐI 0 sau cutover.**
Trigger tương đối ("2× baseline") **không định nghĩa được khi baseline = 0**.
Ngưỡng 0 khả thi chính vì lưu lượng thấp — không có nhiễu để lọc.

**G4 — Giữ cứng, không đổi:** rollback-readiness (ADR-007), kill-switch
(ADR-010), telemetry tagged (ADR-012), **persistence/security breach → rollback
NGAY bất kể mẫu**, và tiêu chí tốt-nghiệp tại Gate D.

## Ma trận sàn — A1 thay các dòng low/zero-traffic của A0

| Lớp route | Điều kiện PASS (A1) |
|---|---|
| Public, traffic ≥3/ngày | **KHÔNG ĐỔI** — soak chuẩn 7 ngày + n organic đủ |
| Public/read-only, traffic <3/ngày | **G1** + **G2 (probe ẩn danh, n≥72 trải ≥24h)** + G3 + risk acceptance. **Bỏ** yêu cầu "48–72h quan sát organic" |
| Authenticated mutation, traffic thấp | **G1** + **G2 probe CÓ ĐĂNG NHẬP** + synthetic mutation coverage + N/N−1 consumer test + G3 + risk acceptance |
| Core grading/exam | **NGHIÊM HƠN A0**: giữ nguyên mọi điều kiện cũ (cross-version resume + n≥72 + ≥72h + incident commander) **và thêm G1 bắt buộc** |
| Zero-traffic | **G1** + **G2** + G3 + risk acceptance (thay cách ghi "synthetic-only" của A0, vốn mơ hồ về việc probe có chạm route hay không) |

## Cái A1 KHÔNG thay được — ghi thẳng, không giấu

- **Đa dạng client thì MẤT THẬT.** Cửa sổ có mục tiêu thứ hai là để người dùng
  thật trên thiết bị/trình duyệt/mạng thật chạm vào. Parity chạy **một** trình
  duyệt; probe cũng **một**. Với 0 traffic thì cửa sổ cũng chẳng có client nào,
  nên thực tế A1 không làm tệ hơn — nhưng **về nguyên tắc đây là năng lực bị
  bỏ**, không phải được thay. Giảm nhẹ: `legacy-browser-scan` (tĩnh, đã gác CI),
  blast-radius nhỏ, rollback ≤12s. **Chấp nhận có ý thức.**
- **Cổng parity không thấy:** hình ảnh/bố cục, hành vi sau tương tác, shadow
  root `closed`, và nhãn link nằm từ dòng thứ hai trở đi. Danh sách đầy đủ ghi
  trong khối "GIỚI HẠN ĐÃ BIẾT" ở `frontend/tooling/parity-core.mjs`.
- **A1 không nới bất kỳ gate an toàn nào.** Nó đổi *cách đo*, không đổi *mức*.

## Tiền lệ `/profile` — ghi sổ cho đúng

Cửa sổ `/profile` đóng ở T+25,1h ngày 03/08 theo **ngoại lệ chính sách** do chủ
dự án duyệt (PR #905). Dưới A1, ca đó **chỉ trở thành hợp quy khi G2 có thật** —
tức khi probe **có đăng nhập** cho `/profile` được dựng. Chưa dựng, nên **nó vẫn
là ngoại lệ đang mở**, và rủi ro thời-gian-trôi vẫn treo. Không dùng A1 để hợp
thức hoá ngược một quyết định đã ra.

## Việc phải làm trước khi A1 dùng được đầy đủ

1. **Dựng G2**: probe synthetic có đăng nhập (chỉ đọc, không ghi) — chặn ca
  `/profile` và mọi cutover authenticated sau này.
2. **Gác G1 trong CI** cho các route đã port, để cổng parity là bắt buộc chứ
  không phải chạy tay.

Chưa có (1) thì lớp `Authenticated mutation` **chưa** dùng được A1 và vẫn theo
A0. Ghi rõ để bản sửa này không tự cấp cho mình hiệu lực mà hạ tầng chưa đỡ nổi.
