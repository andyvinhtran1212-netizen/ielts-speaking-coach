# ADR-013 — Early-stage rollout profile (thay soak-dài-freeze cho route low-traffic)

**Status:** ACCEPTED 2026-07-25 (chủ dự án ratify) · Sửa: §12.3, ADR-007 §6, B36, DEBT-2026-07-22-H

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
