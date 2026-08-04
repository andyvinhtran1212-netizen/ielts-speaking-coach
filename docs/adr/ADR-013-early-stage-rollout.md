# ADR-013 — Early-stage rollout profile (thay soak-dài-freeze cho route low-traffic)

**Status:** ACCEPTED 2026-07-25 (chủ dự án ratify) · Sửa: §12.3, ADR-007 §6, B36, DEBT-2026-07-22-H
· **SỬA ĐỔI A2 — ACCEPTED 2026-08-04**: cửa sổ quan sát BỎ HẲN kể cả khi có mẫu đầy đủ; G2 đổi sang phủ-chế-độ-hỏng. Đọc mục A2 cuối trang.
· **SỬA ĐỔI A1 — ACCEPTED 2026-08-03 (chủ dự án ratify)** — thay cửa sổ-thời-gian bằng cổng-bằng-chứng cho route low/zero-traffic; **đọc mục A1 ở cuối trang trước khi áp bất kỳ điều kiện PASS nào ở thân bài**

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
3. **Synthetic gánh vế số-lượng** *(A2 2026-08-04: `n≥72` ĐÃ BỎ cho G2 — probe tất định nên đếm mẫu không thêm thông tin; xem mục A2)* — smoke chạy trên production ~10 phút/lần đạt n≥72 trong nửa ngày, tất định; bắt lỗi tất định/diện-rộng. (Giới hạn: synthetic không bắt được lỗi client-cụ-thể như React #418 → vẫn cần vế 2.)
4. **Risk acceptance có ghi rõ** cho từng cutover (route, ngày, ai duyệt, rollback plan). Đây là mặc định early-stage, minh bạch — không phải né gate.

**GIỮ CỨNG (bất kể scale):**
- Rollback-readiness đã drill (ADR-007) + kill-switch mutation (ADR-010).
- **Persistence/security invariant breach → rollback NGAY, bất kể sample size.**
- Telemetry tagged sống (ADR-012) — điều kiện tiên quyết (bài học audit F3 thật sự là cái này, không phải freeze).
- Rollback trigger vẫn canh, nhưng ở chế độ tuyệt đối + **synthetic-n làm mẫu chính**, organic chỉ tham khảo.

## Ma trận sàn mới (thay bảng §12.3)

> ⚠ **BẢNG DƯỚI ĐÂY LÀ BẢN 2026-07-25, ĐÃ BỊ A1 + A2 THAY** cho các lớp
> low/zero-traffic. Đọc ma trận đang hiệu lực ở mục **Sửa đổi A1** (đã cập nhật
> theo A2). Giữ lại nguyên văn để đối chiếu lịch sử, không phải để áp dụng.
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

**Status:** **ACCEPTED 2026-08-03 (chủ dự án ratify)** · Thay các điều kiện PASS ở
"Ma trận sàn mới" cho lớp low/zero-traffic. Phần còn lại của A0 giữ nguyên hiệu lực.

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
| ↑ **cơ chế bắt** | \- | \- | so `textContent` của heading, **không phải kiểm bố cục**: JSX nuốt khoảng trắng nên chuỗi khác nhau ở **mọi** bề rộng. G1 chạy 1280px vẫn thấy, dù triệu chứng người dùng chỉ hiện dưới 640px. **Không được đọc ca này thành \"G1 phủ hồi quy bố cục mobile\"** |
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
giờ nằm ở việc *chờ*, mà ở **những request phát ra trong lúc chờ**. Probe gọi
route đều đặn, **bao gồm route cần đăng nhập** — chính lỗ hổng đã làm cửa sổ
`/profile` rỗng.

**Sàn G2 — cả ba con số đều bắt buộc, thiếu một là chưa đạt:**

| | Sàn | Vì sao đúng con số này |
|---|---|---|
| Số mẫu | **n ≥ 72** | giữ nguyên cơ sở power của A0 (DEBT-2026-07-22-H) |
| Khoảng trải | **≥ 24h** | ADR-008 đặt `expire: 86400` cho cache nội dung công khai — dưới 24h thì **không** đi qua lần hết hạn cứng nào |
| Khe hở lớn nhất | **≤ 240 phút** | **suy từ ĐO, không từ mong muốn** — xem mục hiệu chỉnh bên dưới |

### Hiệu chỉnh khe hở: 20 phút → 240 phút (2026-08-04)

*(Mục này là LỊCH SỬ của lần hiệu chỉnh thứ nhất; sàn hiện hành là **360 phút**
theo A2.)* Bản A1 đặt khe hở **≤20 phút** kèm lập luận "72 × 20 = đúng 24h". Lập luận đó
**giả định bộ lập lịch giao đúng nhịp khai**. Đo thật trên GitHub Actions với
cron `*/15` (9 lần chạy / 13,5h):

```
giãn cách: 176 · 157 · 110 · 84 · 85 · 67 · 61 · 69 phút
trung vị 84 · p90 157 · LỚN NHẤT 176   ⇒ chậm hơn lịch khai ~5,6 lần
```

Với sàn 20 phút thì **mọi cặp mẫu liên tiếp đều vượt**, dãy liên tục bị cắt về
`n=1`, và G2 **không bao giờ đạt được** — đã xác nhận bằng verdict thật
(`coverage-interrupted: đứt 69,4 phút; 11 mẫu của đợt cũ không được tính`).

**240 phút = 1,36× giá trị xấu nhất quan sát được.** Con số TẠM, suy từ 8 khoảng
cách trên 13,5h. `evaluateG2` nay in phân bố khe hở thật (p50/p90/max) để lần
chỉnh sau làm bằng số liệu.

**CÁI BỊ MẤT, nói thẳng:** với nhịp thực ~84 phút, một sự cố xuất hiện rồi **tự
khỏi trong dưới ~1,5 giờ** có thể lọt hoàn toàn. Sàn cũ nhắm bắt được nó; sàn
mới chỉ nhắm bắt sự cố kéo dài. Đây là **giới hạn của bộ lập lịch**, không phải
lựa chọn thiết kế. Muốn lấy lại phải đổi cơ chế — job chạy dài tự đếm nhịp bên
trong (~23h runner-minute/ngày), hoặc tự nối chuỗi bằng PAT — cả hai đều đắt
hơn nhiều so với giá trị thu lại ở quy mô hiện tại.

**Hệ quả về thời gian:** ~17 mẫu/ngày ⇒ đạt n≥72 mất **~4,2 ngày**, không phải
24 giờ như A1 dự tính. *(A2 đã BỎ `n≥72`, nên ràng buộc còn lại chỉ là trải
≥24h — mốc thực tế trở lại ~1 ngày.)*

**Cùng gốc, ghi luôn:** cron `41 2 * * *` của cổng parity (quét đầy đủ hằng đêm)
**chưa từng chạy lần nào**. Mọi phát biểu dạng "bộ đầy đủ chạy ở lịch đêm" phải
đọc là *best-effort*, không phải bảo đảm. Lớp bảo vệ thật của G1 là cổng theo
PR.

Với lớp **authenticated**, thêm một điều kiện định tính đo được: phiên probe
phải **sống qua ít nhất một lần token refresh** và có request **trước lẫn sau**
mốc đó — vì token refresh là chế độ hỏng thời-gian-trôi cụ thể của lớp này, và
một probe đăng nhập lại mỗi lần gọi sẽ không bao giờ chạm tới nó.

PASS tính theo **kết quả probe đạt cả ba sàn**, không theo tờ lịch. Sàn ghi
thành số vì bài học của chính A0: gate không đo được thì không phải gate.

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
| Public/read-only, traffic <3/ngày | **G1** + **G2 ẩn danh: trải ≥24h · lỗ ≤360 phút · 0 probe hỏng** + G3 + risk acceptance. **Bỏ** cửa sổ quan sát *(A2: bỏ cho MỌI lớp)*; **bỏ** `n≥72` *(A2)* |
| Authenticated mutation, traffic thấp | **G1** + **G2 CÓ ĐĂNG NHẬP: trải ≥24h · lỗ ≤360 phút · 0 probe hỏng · phiên sống qua ≥1 lần token refresh, có request trước và sau** + synthetic mutation coverage + N/N−1 consumer test + G3 + risk acceptance |
| Core grading/exam | **NGHIÊM HƠN A0**: giữ nguyên mọi điều kiện cũ (cross-version resume + ≥72h + incident commander) **và thêm G1 bắt buộc**. *(A2 bỏ `n≥72` ở đây luôn: cùng lý do — probe tất định)* |
| Zero-traffic | **G1** + **G2 theo đúng sàn của lớp nền của route** (ẩn danh hay có đăng nhập) + G3 + risk acceptance — thay cách ghi "synthetic-only" của A0, vốn mơ hồ cả về việc probe có chạm route lẫn về số lượng |

## Cái A1 KHÔNG thay được — ghi thẳng, không giấu

- **Đa dạng client thì MẤT THẬT.** Cửa sổ có mục tiêu thứ hai là để người dùng
  thật trên thiết bị/trình duyệt/mạng thật chạm vào. Parity chạy **một** trình
  duyệt; probe cũng **một**. Với 0 traffic thì cửa sổ cũng chẳng có client nào,
  nên thực tế A1 không làm tệ hơn — nhưng **về nguyên tắc đây là năng lực bị
  bỏ**, không phải được thay. Giảm nhẹ: `legacy-browser-scan` (tĩnh, đã gác CI),
  blast-radius nhỏ, rollback ≤12s. **Chấp nhận có ý thức.**
- **G1 chạy MỘT bề rộng (1280×900).** Hồi quy chỉ hiện ở bề rộng khác — tràn
  chữ, xuống dòng sai, ẩn/hiện theo breakpoint — **nằm ngoài G1**. Ca H1 ở trên
  bắt được là vì lỗi đó *đồng thời* là khác biệt văn bản, không phải vì G1 biết
  nhìn mobile. Thêm một lượt chạy ở bề rộng nhỏ là việc nên làm, ghi ở mục dưới.
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

1. ~~**Dựng G2**: probe synthetic có đăng nhập (chỉ đọc, không ghi).~~
  **CÔNG CỤ ĐÃ CÓ (PR G2, 2026-08-03)**: `frontend/tooling/authed-probe.mjs`
  (`tick` / `session` / `verdict`) + `frontend/tooling/g2-floor.mjs` (chấm sàn,
  có test) + `.github/workflows/g2-authed-probe.yml`.
  **ĐÃ BẬT 2026-08-03, ĐANG TÍCH LUỸ BẰNG CHỨNG.** Ba điều kiện tiên quyết đã
  xong: tài khoản `g2-probe@averlearning.com`, secret `PROBE_EMAIL`/
  `PROBE_PASSWORD`, và cron. Đo tại lần chạy tay đầu:
  `tick: OK — /auth/profile=200 /auth/check-active=200`.

  **✅ ĐÃ ĐẠT LẦN ĐẦU 2026-08-04.** Verdict thật:

  ```
  G2: n=35 · trải 24.89h · lỗ lớn nhất 221.4′ · hỏng 0 · lớp CÓ ĐĂNG NHẬP
       phân bố lỗ (n=34): p50 15′ · p90 110.4′ · max 221.4′
  ✓ ĐẠT sàn ADR-013-A1
  ```

  Cả bốn điều kiện A2: trải 24,9h ≥ 24h · lỗ 221′ < 360′ · 0/35 probe hỏng ·
  đã qua **một lần token refresh** có request hai phía (phiên `session` kích
  hoạt tay lúc 02:55Z — cron `17 3 * * *` chưa từng tự chạy).

  ⇒ **Ngoại lệ `/profile` (mở từ 03/08) ĐÓNG.** Lớp `Authenticated mutation`
  chuyển từ A0 sang **A1+A2**: từ nay cutover route cần đăng nhập đi theo cổng
  bằng chứng, không còn cửa sổ thời gian.

  **Ghi kèm để không đọc quá lời:** cổng này chứng nhận *route phục vụ được
  liên tục suốt một ngày và sống qua một lần refresh token*. Hết. Với lỗ cho
  phép tới 6 giờ, sự cố ngắn vẫn lọt (xem `G2_FLOOR_TRADEOFF`).

  **Quan sát đáng giữ:** p50 lỗ tụt từ 61′ → 46′ → **15′** sau khi phiên
  `session` chạy — vì nhịp *bên trong* một job không phụ thuộc bộ lập lịch.
  Nếu sau này cần nhịp đều hơn, đường đi là đếm nhịp TRONG job, không phải
  đặt cron dày hơn.

  **Nguyên tắc rút ra khi bật — LỊCH phải chặt hơn SÀN.** Sàn đòi khe hở
  ≤20 phút; đặt cron đúng 20 phút là sát mép, mà cron GitHub Actions trễ vài
  phút là bình thường và mốc mẫu còn tính sau khi runner khởi động + đăng nhập.
  Mô phỏng 26h với độ trễ ≤4 phút: cron 20 phút → khe hở 23 phút → `n=2`,
  không bao giờ đạt; cron 15 phút → khe hở 18 phút → `n=104`, đạt. Đã dùng
  15 phút. Sàn không đổi — chỉ lịch chặt hơn để nuốt độ trễ.
2. **Gác G1 trong CI** cho các route đã port, để cổng parity là bắt buộc chứ
  không phải chạy tay.
3. **Thêm lượt chạy G1 ở bề rộng nhỏ** (ví dụ 375px) — hiện G1 chỉ chạy 1280px
  nên hồi quy theo breakpoint nằm ngoài tầm.

Chưa có (1) thì lớp `Authenticated mutation` **chưa** dùng được A1 và vẫn theo
A0. Ghi rõ để bản sửa này không tự cấp cho mình hiệu lực mà hạ tầng chưa đỡ nổi.


---

# Sửa đổi A2 (2026-08-04) — cửa sổ quan sát mù kể cả khi có đủ mẫu

**Status:** ACCEPTED 2026-08-04 (chủ dự án duyệt sau phiên hội đồng đa vai)

## Đính chính lập luận của A1

A1 bỏ cửa sổ quan sát với lý do **"route 0 lưu lượng thì cửa sổ không sinh được
bằng chứng"**. Lý do đó **đúng nhưng yếu**, và nó suy rộng từ đúng **một** ca
(`/profile`, 0 organic). Hội đồng đa vai chỉ ra đây là suy rộng từ n=1 — cùng
loại lỗi mà chính ADR này phê phán.

Nên ta đo lại trên route **CÓ** lưu lượng. Không cần thí nghiệm mới: hai cutover
đã xong đều nằm trên route có traffic.

## Bằng chứng — đo ngược, không phải mô phỏng

| Cutover | page_view trong 48h | Lỗi client | Đạt sàn n≥20 |
|---|---|---|---|
| **Trang bài Grammar** (pilot 2, 28/07) | **160** (156 next · 4 legacy) | **0** | **CÓ** |
| Trang chủ `/grammar` (03/08) | 4 | 0 | không |

Cửa sổ 48h của pilot 2 **có mẫu đầy đủ** và báo **sạch**.

**Nhưng chính route đó, trong đúng 48 giờ đó, đang mất nút "Lưu bài" và khối CTA
khách ở 45% lượt tải.** Lỗi đua tồn tại từ khi route Next lên sóng (28/07) tới
khi vá (03/08, PR #908). Cửa sổ nhìn thẳng vào nó với 160 mẫu và **không thấy
gì** — vì nó không sinh exception, không sinh status xấu, không làm mất lượt
xem. Tính năng chỉ đơn giản **không xuất hiện**.

Thứ tìm ra nó là **cổng parity G1**.

## Kết luận A2

> **Cửa sổ quan sát theo thời gian BỎ HẲN cho mọi lớp route** — kể cả route có
> lưu lượng đạt sàn. Không phải vì thiếu mẫu, mà vì **nó mù với loại lỗi dự án
> này thực sự gặp**.

Ghi lại để không ai dựng lại nó vì "cho chắc": nó đã được thử với 160 mẫu và
trượt 1/1 lỗi thật.

## Phân vai ba cơ chế — theo số, không theo trực giác

| Cơ chế | Bắt được | Thành tích thật |
|---|---|---|
| **G1 parity** | nội dung/tính năng thiếu, hồi quy render | **2/2** lỗi production thật |
| **G2 probe có đăng nhập** | route chết kéo dài, hỏng token refresh | chưa bắt được gì; thô, rẻ |
| **Cửa sổ thời gian** | — | **0/1** dù có 160 mẫu ⇒ **bỏ** |

## G2 đổi sang phủ-chế-độ-hỏng (bỏ `n≥72`)

`n≥72` đến từ phân tích power cho **lưu lượng organic** — lấy mẫu một quá trình
ngẫu nhiên. Probe của G2 **tất định**: cùng tài khoản, cùng endpoint, cùng đường
đi. 72 lần thành công giống hệt nhau không cho biết nhiều hơn 20 lần, vì chúng
lấy mẫu **thời gian**, không lấy mẫu ngẫu nhiên. Giữ con số đó chỉ tạo vẻ chặt
chẽ giả.

**Điều kiện ĐẠT mới của G2 — cả ba, bỏ đếm mẫu:**

| | Sàn | Cơ sở |
|---|---|---|
| Trải | **≥ 24h** | ADR-008 `expire: 86400` — phải đi qua ít nhất một lần cache hết hạn cứng |
| Lỗ lớn nhất | **≤ 360 phút** | đo **mốc MẪU** (không phải mốc chạy): lớn nhất thật **221 phút**; 360 = 1,63× |
| Probe hỏng | **0** | tất định: một lần hỏng là một lần hỏng |
| *(lớp authenticated)* | ≥1 phiên đi qua token refresh, có request hai phía | chế độ hỏng riêng của lớp này |

Số mẫu tối thiểu **tự suy ra** từ trải/lỗ (≈4 mẫu), không đặt riêng.

**Hiệu chỉnh sàn lỗ, lần thứ hai:** A1 đặt 20 phút; bản nháp đầu của A2 đặt 240
phút dựa trên khoảng cách giữa các **lần chạy** (max 176). Đó là **đo sai đại
lượng** — mốc mẫu tính SAU khi runner khởi động + đăng nhập + gọi HTTP, nên lỗ
thật giữa các **mẫu** lên tới **221 phút**, chỉ còn 8% biên. Nay lấy đúng đại
lượng: **360 phút**.

## Điều A2 KHÔNG bảo đảm — ghi thẳng

- **Sự cố ngắn lọt hết.** Với lỗ cho phép tới 6 giờ, G2 chỉ chứng nhận *"route
  còn phục vụ được suốt một ngày, có đi qua một lần refresh token"*. **Không**
  phải "được giám sát liên tục".
- **Cron GitHub không đáng tin.** Khai `*/15`, chạy thật cách nhau 61–176 phút;
  cron `session` hằng ngày và cron parity hằng đêm **chưa từng chạy lần nào**.
  Phiên token-refresh phải **kích hoạt tay** cho tới khi có cơ chế khác.
- **G1 không phủ được flow lõi.** Cả 2 lỗi G1 bắt được đều ở trang tĩnh đọc-thuần.
  Nó so chữ và link, **không** so state machine ghi âm/chấm điểm. Trước khi đụng
  `/speaking` hay `/result` phải trả lời riêng: cổng nào bảo vệ những flow đó?
