# Gate C — Pilot exit / bounded-ramp decision (2026-08-02)

Theo `docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md` §16 Gate C. Tài liệu
này tập hợp bằng chứng và **đặt quyết định lên bàn chủ dự án** — Gate C yêu cầu
một quyết định tường minh: **go / scope / pause / terminate**. Tôi khuyến nghị,
không tự quyết.

## 1. Điều kiện Gate C — đối chiếu từng dòng

| Yêu cầu §16 | Trạng thái | Bằng chứng |
|---|---|---|
| 4 production pilot đạt parity, gồm authenticated mutation và canonical reload | **Đạt** | Pilot 1 `/` (14/07) · Pilot 2 `/grammar/:cat/:slug` (28/07) · Pilot 3+4 `/profile` (02/08, authed + mutation) |
| Mỗi pilot hoàn tất exposure floor/window | **Đạt có điều chỉnh** | Pilot 1 PASS (ngoại lệ LCP ghi rõ) · Pilot 2 PASS 51h10m · Pilot 3+4 **cửa sổ đang mở tới 04–05/08** |
| Spike media / state-resume / cross-version / grading-data đạt exit criteria | **Đạt** | `docs/SPIKE_1..4_*.md` (#747); S2 còn phát hiện 2 lỗi legacy có sẵn → vá ở #748, #749 |
| Account-switch / two-user cache isolation | **Đạt** | pilot-3 isolation matrix, nằm trong bộ staging E2E 23/23 |
| Investment review: benefits + frozen-vs-actual + quyết định tường minh | **Mục 2–4 dưới** | |

## 2. Frozen estimate vs actual

Bảng freeze (Pilot Entry §5) ước tính **giờ kỹ sư gồm cutover + soak**:

| Pilot | Estimate frozen | Build thực tế | Nhận xét |
|---|---|---|---|
| 1 landing | 6h | ~1h | build rẻ hơn hẳn dự phòng |
| 2 grammar | 8h | ~1.5h (1 vòng rework) | |
| 3 profile read | 8h | ~2h | |
| 4 profile mutation | 8h | ~2.5h | |
| **Tổng build** | **30h** | **~7h** | **≈ 0.23× estimate** |

**Nhưng phần "cutover + soak" mới là chỗ tiêu thật**, và bảng freeze không tách
nó ra. Đo bằng thứ đếm được: **41 PR** thuộc chương trình đã merge từ 13/07,
trong đó **~12 PR sinh ra SAU pilot 1** chỉ để sửa *dụng cụ đo và cổng*, không
thêm một route nào:

- #816/#823 rollback-metrics (cắt-âm-thầm cửa sổ, vế số-lượng)
- #877 font parity chặn cutover pilot 2
- #879 đo được route có tham số + UA
- #881 hồ sơ PASS + đính chính tiêu chí 404 của PPR
- #882 iOS ≤16.3 không hydrate (3 lỗi thật, 2 nằm ngoài Next)
- #884 `doc_release`/`age_ms`
- #885 tripwire Gate B lạc hậu (nightly xanh giả 3 đêm)
- #886 job drift báo động giả
- #887 lỗ phủ telemetry ("0 lỗi" đúng-theo-cấu-tạo)

**Kết luận trung thực: dựng route thì rẻ hơn ước tính ~4×; vận hành cutover an
toàn thì đắt hơn nhiều so với những gì bảng freeze hình dung.** Ngưỡng
"> 2× ở ≥2 pilot → steering review" tính theo giờ *build* thì KHÔNG chạm; tính
theo tổng công sức chương trình thì đã vượt từ lâu.

## 3. Benefits — cái đã mua được, đo được

| Lợi ích | Bằng chứng |
|---|---|
| SEO: title/description **server-rendered** cho bài grammar | trước đây do `grammar.js` gắn phía client; nay có trong HTML gốc |
| Landing ship **0 JS của riêng nó** | pilot 1, chỉ còn runtime Next |
| PPR cho route nội dung | `◐ /grammar/[category]/[slug]`, vỏ tĩnh + thân stream |
| Hiệu năng đo được | smoke n=75: landing 556ms · grammar 848–976ms · **≪ trần 4000ms** |
| Kỷ luật kiểm chứng lan sang phần legacy | 3 lỗi iOS (2 thuộc legacy thuần), lỗ telemetry, beacon mất `user_id` — **đều do quy trình pilot phát hiện, không phải do người dùng báo** |

Cái **chưa** mua được: chưa có primitive dùng chung ổn định (Gate D đòi qua ≥3
implementation); mỗi pilot vẫn chép lại khung legacy.

## 4. Rủi ro nếu mở rộng ngay

1. **Còn ~125 trang legacy** (58 học viên + 67 admin). ROM của chính bản kế
   hoạch: **46–73 person-week** cho Phase 3–7.
2. **Ba lần liên tiếp, cổng của chính chúng ta tự cho điểm sai** (tripwire lạc
   hậu, "0 lỗi" không có kênh báo lỗi, beacon mất `user_id`). Mỗi lần đều được
   một review ngoài bắt, không phải tự phát hiện.
3. Khoảng mù lỗi sớm vẫn còn (cần listener nội tuyến trong `<head>`).
4. TTFB landing ~978ms chưa xử lý.

## 5. Khuyến nghị

**GO có giới hạn — đúng khuôn Gate C cho phép: bounded ramp tối đa 10 route
qua ít nhất 2 domain, KHÔNG mở song song diện rộng.** Lý do: parity đã chứng
minh trên đủ 4 lớp rủi ro (tĩnh, nội dung SSR, authed, mutation), và chi phí
build thấp hơn ước tính; nhưng phần vận hành còn non — bằng chứng là chuỗi lỗi
dụng cụ đo vừa rồi.

Kèm 3 điều kiện trước khi tính tới Gate D:

1. Đóng cửa sổ quan sát pilot 3+4 (04–05/08) trước khi cutover route kế tiếp.
2. Mỗi route mới phải **kiểm ống đo trước, kết luận sau** — quy tắc rút ra từ
   ba lần xanh-giả.
3. Bắt đầu tách **primitive dùng chung** ngay trong 2–3 route đầu của ramp,
   nếu không Phase 3–6 sẽ là chép-dán 125 lần.

## 6. QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN — 2026-08-02: **GO TOÀN BỘ**

Chủ dự án chọn **làm tiếp toàn bộ**, tức migrate diện rộng Phase 3–7, **khác
với khuyến nghị "GO có giới hạn" ở mục 5**. Ghi lại đúng như vậy để hồ sơ trung
thực, không viết lại khuyến nghị cho khớp quyết định.

**Hệ quả phải nói rõ:** §16 quy định quy mô rộng thuộc **Gate D** (primitive ổn
định qua ≥3 implementation, dashboard/alert vận hành, contract validation trên
endpoint quan trọng). Đi thẳng diện rộng = **bỏ qua các điều kiện đó**.

**Cách bù, áp dụng ngay từ route đầu của Phase 3:**

1. **Dựng bộ khung dùng chung TRƯỚC, chép tay SAU.** Route đầu tiên của Phase 3
   phải sinh ra layout/primitive tái dùng được, không phải một bản chép của
   trang legacy. Đây là điều kiện Gate D quan trọng nhất, mình tự áp sớm.
2. **Kiểm ống đo trước, kết luận sau** — quy tắc rút từ 3 lần "xanh giả".
3. **Cửa sổ quan sát pilot 3+4 vẫn chạy tới 04–05/08.** Trong thời gian đó vẫn
   BUILD bình thường, nhưng **cutover route mới thì đợi hết cửa sổ** — không
   phải vì freeze (ADR-013 bỏ freeze), mà để nếu `/profile` có sự cố thì còn
   quy kết được một-biến.

**Quyết định cuối là của chủ dự án.** Nếu chọn *pause*, trạng thái hiện tại vẫn
an toàn: 3 route Next + 125 trang legacy chạy chung một deployment, rollback
≤12s còn nguyên, và không có nợ nào bắt buộc phải trả ngay.
