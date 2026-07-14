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
| JS transferred (gzip, tổng) | **95 KB** | **247 KB** | +152 KB — **xem tách bên dưới** |
| API call / pageload | 1 (`/api/public-stats`) | 1 (`/api/public-stats`) | 0 — không request thừa |

### Tách JS (đo thật, KHÔNG gộp — review #750)

Turbopack đặt tên chunk bằng hash nên không tách được từ URL; tách bằng cách
**diff tập chunk giữa `/landing-preview` và `/next-probe`** (route Next tối
giản): chunk chung = shared runtime, chunk chỉ-landing = route-specific.

| Nhóm | Bytes | Bản chất |
|---|---|---|
| Next shared runtime/framework | **~147 KB** | Một-lần, dùng chung mọi route Next — VERIFIED: `/next-probe` (gần như không code app) load y hệt 150.7 KB các chunk này; immutable cache `/_next/static` |
| **Landing route-specific** (page + `landing-behavior.tsx`) | **~0.9 KB** | Chi phí JS RIÊNG của pilot 1 — nhỏ vì behavior chỉ ~85 dòng wiring DOM |
| lucide + runtime-config | ~95 KB | Load bởi **CẢ HAI** stack (legacy `/` cũng 95 KB) → KHÔNG phải chi phí migration; ứng viên tối ưu về sau (tree-shake icons) |

## Đọc số

1. **Không có lý do hiệu năng nào chặn cutover**: score parity 98/98, LCP/FCP
   Next nhỉnh hơn, CLS 0 cả hai, API count bằng nhau.
2. **Tách rõ (đã đo, không gộp)**: chi phí JS RIÊNG của pilot 1 chỉ **~0.9 KB**
   (page + `landing-behavior.tsx`); **~147 KB là shared runtime một-lần** dùng
   chung mọi route Next về sau (Gate C ghi nhận như nền tảng đã trả); ~95 KB
   lucide/runtime-config là chung với legacy, không phải chi phí migration.
   Hệ quả giám sát: **per-route JS growth về sau sẽ HIỆN RÕ** vì mỗi route mới
   chỉ thêm chunk nhỏ của riêng nó trên nền shared — theo dõi con số
   route-specific này ở từng cutover (dùng chính chunk-diff ở trên), đừng để
   nó trôi vào "đã trả rồi".
3. TBT +31 ms xa ngưỡng cảnh báo (200 ms). Web Vitals THỰC (field) sẽ so theo
   tag `implementation` trên dashboard ADR-012 sau cutover — trigger rollback
   đã freeze: LCP p75 > 1.5× baseline trong 24h.

## Điều kiện còn lại trước cutover pilot 1 (checklist §1)

- Nightly streak: **7/20** tại thời điểm đo (nightly +1/đêm, dispatch bù được).
- Traffic baseline re-run ≤72h trước cutover (`backend/scripts/traffic_baseline.sh`).
- Đo lại bảng này ≤72h trước cutover (script hóa trong session cutover).
