---
id: TESTPOLICY-0057
title: New tests check behaviour instead of source text, and an advisory visual baseline shows every intended or accidental change to key screens
status: draft
risk: medium
owner: product
---

# New tests check behaviour instead of source text, and an advisory visual baseline shows every intended or accidental change to key screens

Status: **draft** — soạn ngày 18/11/2026 cho nhiệm vụ `G10-T01` (đợt A, thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-10-repo-pha-2-cau-truc.md` và `00-QUY-UOC-CHUNG.md` mục 2 (bản trên `staging` sau PR #2331). Chưa dòng mã nào chạy theo spec này; mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy (BAN-GIAO mục 7). Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6. Spec này không có migration.

## Tóm tắt (tiếng Việt)

GOI-10 mục (a). Bảng mục, lớp PR và rủi ro của cả gói:

| Mục | Mã spec đề xuất | Lớp PR | `risk` trong spec | Lý do |
| --- | --- | --- | --- | --- |
| (a) chính sách test + ảnh chụp mốc | `TESTPOLICY-NNNN` | feature | medium | thêm job CI và quy ước mới |
| (b) gỡ JS cũ theo đợt | `LEGACYJS-NNNN` | feature | high → PR `high-risk` | xoá file đang được phục vụ công khai `/js/*` |
| (c) tách module backend | `BACKENDSPLIT-NNNN` | high-risk | high | `routers/listening.py` chứa chấm bài, lưu kết quả, kết thúc bài thi (00 §4.7, không hạ cấp) |
| (d) gộp route group admin | `ADMINGROUP-NNNN` | feature | medium | đổi cấu trúc `frontend/app`, có rủi ro cascade CSS |
| (e) media ra khỏi git | `MEDIAOUT-NNNN` | high-risk | high | bài giao của học viên phụ thuộc URL media bất biến |
| (f) rà spec `implementing` | không spec mới | small | — | chỉ cập nhật `IMPLEMENTATION_STATUS.md`/status có bằng chứng |
| (g) số migration không va chạm | `MIGNUM-NNNN` | high-risk | high | quy trình migration |

- **Mục tiêu.** Làm repo dễ sửa song song cho người thực thi trong đợt thương mại hoá: (a) có chính sách test mới và một bộ ảnh chụp giao diện làm mốc để G03/G07/G09 đổi giao diện mà biết mình làm vỡ gì; (b) gỡ khoảng 39.000 dòng JS cũ không trang Next nào nạp, theo đợt nhóm trang; (c) tách ba module backend lớn nhất (`routers/listening.py` 9.558 dòng, `routers/admin.py` 6.273, `services/quiz_service.py` 7.373) mà không đổi import, route hay mục tiêu monkeypatch của test; (d) gộp 39 route group admin thành một; (e) đưa 2.975 file mp3 ra khỏi cây làm việc mà giữ nguyên URL; (f) rà 30 spec đang `implementing`; (g) quy tắc cấp số migration không va chạm. Người dùng cuối không thấy thay đổi nào; nếu thấy là lỗi.
- **Phụ thuộc.** G01 phải merge trước: G01-T01 (chỉ mục docs), G01-T02 (sổ spec, dùng cho mục f), G01-T06 (`backend/migrations/register.tsv`, dùng cho mục g). Mục (a) đi trước (b), (d) và đi trước các PR giao diện lớn của G03/G07/G09. Chi tiết "mục nào mở đường cho gói nào" ở mục 6.0.

## Problem

Hiện trạng repo mà gói đã đọc (staging @ 93c7085), các dòng liên quan mục (a):

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
| --- | --- | --- |
| Playwright | `@playwright/test` và `playwright` **1.60.0** (`frontend/package-lock.json`). 6 config: `frontend/playwright.config.js` (e2e fixture tĩnh qua `python3 -m http.server 4173`), `.staging`, `.production-smoke`, `.reading-native`, `.speaking-regression`, `.spike` (`.review-redesign` bị G01-T04 xoá) | **Không có** `toHaveScreenshot`/`toMatchSnapshot` ở đâu cả (`git grep toHaveScreenshot` → rỗng). Các spec chỉ chụp ảnh khi lỗi (`screenshot: 'only-on-failure'`). |
| Hành trình trình duyệt có fixture | `frontend/tooling/verify-*-flow.mjs` (khoảng 122 file), `frontend/tooling/next-native-fixture-api.mjs`, `supabase-session.mjs`, `admin-mfa-stub.mjs`, `run-flow-repeat.mjs`, `frontend/tooling/README.md` | Mỗi flow `import { chromium } from 'playwright'`, dựng phiên giả trong localStorage, chặn API bằng `page.route`. Lệnh build fixture: `AVER_ENVIRONMENT=test VERCEL_ENV=development AVER_API_BASE=http://127.0.0.1:3999 AVER_SUPABASE_URL=https://example.supabase.co AVER_SUPABASE_ANON_KEY=test-anon-key npm run build` (tooling/README). CI chạy chúng trong `.github/workflows/next-native-browser.yml` job `browser-regression` (1.711 dòng, khoảng 136 bước). |
| Font | `frontend/app/layout.tsx:5` dùng `next/font/google` (`JetBrains_Mono`, `Lora`, `Plus_Jakarta_Sans`) | Font tải lúc build, tự phục vụ → ảnh chụp ổn định sau build; build cần mạng. |
| Chủ đề sáng/tối | `components/authed-shell.tsx` `ANTI_FLASH` đọc `localStorage['av-theme']` | Ảnh chụp cố định chủ đề bằng `addInitScript` đặt `av-theme`. |
| Test đọc mã nguồn | báo cáo 01 B1: 562/639 file test frontend gốc dùng `readFileSync`; 289/806 test backend đọc text | `docs/adr/ADR-005-test-retirement.md`: không xoá test theo tên file; mỗi test cũ phải có kết luận trong `docs/TEST_INVARIANT_LEDGER.md` (545 dòng) và test thay thế trong cùng PR. |

## Scope

- Mục (a) của GOI-10: các FR dưới đây và nhiệm vụ G10-T02, G10-T03, G10-T04.

## Non-goals

- Gõ kiểu cho `frontend/lib/*.mjs` (báo cáo 01 mục 2.5) và tách `next-native-browser.yml` (2.8) — chưa có trong yêu cầu; đề xuất làm gói sau nếu anh Andy muốn.
- Gộp route group phía học viên (CSS học viên có luật toàn cục, ví dụ `home.css` theo chú thích `authed-shell.tsx:10-13`) — G07 tự quyết khi đổi 16 đường dẫn.
- Viết lại lịch sử Git, LFS, đổi URL media, đổi số migration cũ, đổi tên thư mục spec, đổi tên job CI bắt buộc.
- Thiết kế lại giao diện admin (G09), nền giao diện mới `components/ui/` và token `--av2-` (G03).
- Các mục khác của GOI-10 có spec riêng. Không thêm kiểm tự động chặn test đọc mã nguồn (Q-a2).

## Users and journeys

- Người thực thi các gói đợt thương mại hoá: biết mình đổi giao diện gì qua ảnh mốc; viết test kiểm hành vi.
- Anh Andy (người vận hành repo duy nhất): duyệt ảnh mốc đổi có chủ ý.

## Requirements

Đánh số theo gói (FR-10a-NNN → FR-NNN).

- **FR-001:** `AGENTS.md` mục "Testing / verification expectations" và `backend/tests/README.md` nêu: test mới kiểm hành vi; không đọc file mã nguồn (`.py .ts .tsx .js .mjs .css .md`) rồi so chuỗi; được đọc dữ liệu/cấu hình bằng parser (JSON/YAML/TSV) để kiểm dữ liệu.
- **FR-002:** Mẫu PR có ô đánh dấu "New tests assert behaviour, not source text (AGENTS.md › Testing)".
- **FR-003:** `npx playwright test -c playwright.visual.config.js` chụp và so ảnh cho danh sách màn ở 5.1, 4 dự án (1280×800 sáng/tối, 390×844 sáng/tối), với dữ liệu fixture, đồng hồ cố định, tắt hoạt ảnh.
- **FR-004:** Ảnh mốc được commit dưới `frontend/tests/visual/__screenshots__/`; chạy lại không đổi giao diện → 0 khác biệt trên 3 lần chạy liên tiếp.
- **FR-005:** CI có job "Visual baseline" (advisory, không bắt buộc) chạy khi PR chạm `frontend/app/**`, `frontend/components/**`, `frontend/public/css/**`, `frontend/tests/visual/**`; khi khác ảnh, tải lên artifact ảnh khác biệt.
- **FR-006:** Có lệnh cập nhật ảnh mốc tái lập được trên máy của người thực thi (container Playwright cùng phiên bản với CI).

## Acceptance scenarios

### Scenario 1 — giao diện không đổi

- **Given** giao diện không đổi
- **When** chạy bộ ảnh 3 lần liên tiếp
- **Then** 0 khác biệt (FR-004)

### Scenario 2 — đổi màu nút admin

- **Given** một PR đổi màu nút trong `admin-buttons.css`
- **When** job `visual-baseline` chạy
- **Then** màn admin báo khác biệt và artifact có ảnh diff (FR-005)

### Scenario 3 — cập nhật ảnh mốc có chủ ý (gói mục 9, E2E-1)

- **Given** staging sau G10-T03
- **When** một PR của G03 đổi token màu
- **Then** job `visual-baseline` đỏ, artifact có ảnh diff; khi PR cập nhật ảnh mốc có chủ ý và ghi lý do, job xanh

## Edge cases

- Trang có ngày giờ: đồng hồ cố định `page.clock.setFixedTime(new Date('2026-11-16T03:00:00Z'))`.
- Trang có ảnh/video ngoài: `mask` vùng đó.
- Dark mode lần đầu tải: anti-flash đặt `data-theme` trước khi vẽ; ảnh chụp đặt `av-theme` bằng `addInitScript`.
- Font chưa tải xong: chờ `document.fonts.ready` trước khi chụp.

## Success criteria

- Ba lần chạy liên tiếp không đổi giao diện cho 0 khác biệt; một đổi màu có chủ ý làm job đỏ kèm ảnh diff.

## Related specifications

- UIBASE-0056 (G03): test ảnh chụp của `/ui-library` chạy trong job "Next-native browser regression" sẵn có; spec này thêm job advisory riêng cho các màn đang có. Hai bộ không chồng file: G03 dùng `frontend/tests/visual/ui-library.spec.mjs`, spec này dùng các file còn lại trong `frontend/tests/visual/`.
- `docs/adr/ADR-005-test-retirement.md`: chính sách gỡ test đọc mã nguồn hiện có.
- LEGACYJS-0075, ADMINGROUP-0077 (G10 mục b, d): đi sau spec này, dùng ảnh mốc làm bằng chứng không đổi giao diện.

## Open questions

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm |
| --- | --- | --- | --- |
| Q-a1 | Job `visual-baseline` advisory hay bắt buộc? | Advisory 4 tuần, sau đó bắt buộc nếu tỉ lệ đỏ giả < 5% | Advisory |
| Q-a2 | Có thêm kiểm tự động chặn test mới đọc mã nguồn không? | Không; dùng ô trong mẫu PR + review | Không |
