# Pilot 1 (landing) — baseline đo TRƯỚC cutover · 2026-07-14

Theo phương pháp FREEZE trong `docs/PILOT_ENTRY_CHECKLIST_2026-07-13.md` §5.
Đo trên PRODUCTION (www.averlearning.com, release `eab63de3`), cả hai biến thể
cùng deployment — legacy `/` (sẽ bị thay) và Next `/landing-preview` (ứng viên
cutover). Đo lại một lần nữa trong 72h trước cutover để chốt số vào sheet.

## Lighthouse (mobile, preset perf, median của 3 run, Chromium headless)

| Metric | Legacy `/` | Next `/landing-preview` | Delta |
|---|---|---|---|
| Performance score | **98** (89/98/99) | **98** (97/98/98) | 0 — parity, Next ổn định hơn giữa các run |
| FCP | 1905 ms | 1840 ms | −65 ms |
| LCP | 1905 ms | 1840 ms | −65 ms |
| TBT | 7 ms | 38 ms | +31 ms (hydration React — trong ngân sách) |
| CLS | 0.000 | 0.000 | 0 |
| Speed Index | 2082 ms | 2024 ms | −58 ms |

## Tải trang (Playwright Chromium, transferred bytes, load + 5s deferred)

| Metric | Legacy `/` | Next `/landing-preview` | Delta |
|---|---|---|---|
| JS transferred (gzip) | **93 KB** (2 file) | **241 KB** (8 file) | **+148 KB** — React runtime + Next chunks; một lần rồi cache cho MỌI trang Next sau (shared chunks) |
| Tổng page weight | 217 KB | 368 KB | +151 KB (≈ toàn bộ là JS ở trên) |
| API call / pageload | 1 (`/api/public-stats`) | 1 (`/api/public-stats`) | 0 — không request thừa |

## Đọc số

1. **Không có lý do hiệu năng nào chặn cutover**: score parity 98/98, LCP/FCP
   Next nhỉnh hơn, CLS 0 cả hai, API count bằng nhau.
2. **+148 KB JS là chi phí một-lần của cả chương trình migration**, không phải
   của riêng pilot 1 — framework chunks dùng chung cho mọi route Next về sau
   và nằm trong immutable cache (`/_next/static`). Ghi nhận vào Gate C như
   chi phí nền tảng đã trả.
3. TBT +31 ms xa ngưỡng cảnh báo (200 ms). Web Vitals THỰC (field) sẽ so theo
   tag `implementation` trên dashboard ADR-012 sau cutover — trigger rollback
   đã freeze: LCP p75 > 1.5× baseline trong 24h.

## Điều kiện còn lại trước cutover pilot 1 (checklist §1)

- Nightly streak: **7/20** tại thời điểm đo (nightly +1/đêm, dispatch bù được).
- Traffic baseline re-run ≤72h trước cutover (`backend/scripts/traffic_baseline.sh`).
- Đo lại bảng này ≤72h trước cutover (script hóa trong session cutover).
