# GÓI 10 — Repo pha 2: thay đổi cấu trúc (mỗi mục một spec)

## 1. Tóm tắt

- **Mục tiêu.** Làm repo dễ sửa song song cho người thực thi trong đợt thương mại hoá: (a) có chính sách test mới và một bộ ảnh chụp giao diện làm mốc để G03/G07/G09 đổi giao diện mà biết mình làm vỡ gì; (b) gỡ khoảng 39.000 dòng JS cũ không trang Next nào nạp, theo đợt nhóm trang; (c) tách ba module backend lớn nhất (`routers/listening.py` 9.558 dòng, `routers/admin.py` 6.273, `services/quiz_service.py` 7.373) mà không đổi import, route hay mục tiêu monkeypatch của test; (d) gộp 39 route group admin thành một; (e) đưa 2.975 file mp3 ra khỏi cây làm việc mà giữ nguyên URL; (f) rà 30 spec đang `implementing`; (g) quy tắc cấp số migration không va chạm. Người dùng cuối không thấy thay đổi nào; nếu thấy là lỗi.
- **Lớp thay đổi và spec.** Mỗi mục một thư mục spec (bảng dưới). Mục (f) là `small` (chỉ cập nhật sổ, không cần spec mới). Số spec đã cấp ở `01-KE-HOACH-TONG.md` mục 6 (anh Andy là người duy nhất vận hành repo; bảng đó là sổ cấp số): TESTPOLICY-0057 (mục a), LEGACYJS-0075 (b), BACKENDSPLIT-0076 (c), ADMINGROUP-0077 (d), MEDIAOUT-0078 (e), MIGNUM-0058 (g). Chỗ nào trong file còn ghi `NNNN` thì đọc là các số này; người thực thi kiểm số chưa bị dùng rồi ghi vào sổ đăng ký trong repo và vào thân PR (sửa 18/11 theo rà soát). FR trong gói này đánh `FR-10x-NNN`; khi chép vào `spec.md` đổi thành `FR-001…` theo `specs/_templates/spec.md`.

| Mục | Mã spec đề xuất | Lớp PR | `risk` trong spec | Lý do |
| --- | --- | --- | --- | --- |
| (a) chính sách test + ảnh chụp mốc | `TESTPOLICY-NNNN` | feature | medium | thêm job CI và quy ước mới |
| (b) gỡ JS cũ theo đợt | `LEGACYJS-NNNN` | feature | high → PR `high-risk` | xoá file đang được phục vụ công khai `/js/*` |
| (c) tách module backend | `BACKENDSPLIT-NNNN` | high-risk | high | `routers/listening.py` chứa chấm bài, lưu kết quả, kết thúc bài thi (00 §4.7, không hạ cấp) |
| (d) gộp route group admin | `ADMINGROUP-NNNN` | feature | medium | đổi cấu trúc `frontend/app`, có rủi ro cascade CSS |
| (e) media ra khỏi git | `MEDIAOUT-NNNN` | high-risk | high | bài giao của học viên phụ thuộc URL media bất biến |
| (f) rà spec `implementing` | không spec mới | small | — | chỉ cập nhật `IMPLEMENTATION_STATUS.md`/status có bằng chứng |
| (g) số migration không va chạm | `MIGNUM-NNNN` | high-risk | high | quy trình migration |

- **Phụ thuộc.** G01 phải merge trước: G01-T01 (chỉ mục docs), G01-T02 (sổ spec, dùng cho mục f), G01-T06 (`backend/migrations/register.tsv`, dùng cho mục g). Mục (a) đi trước (b), (d) và đi trước các PR giao diện lớn của G03/G07/G09. Chi tiết "mục nào mở đường cho gói nào" ở mục 6.0.
- **Ước lượng (giả định: spec được duyệt trong 1–2 ngày mỗi cái; CI không kẹt; anh Andy trả lời mục 10 trước khi bắt đầu b và e).** 6 PR spec + khoảng 37 PR mã/tài liệu (tổng khoảng 43 PR), khoảng 51 phiên agent (bảng cuối mục 6). Độ khó 2–5: khó nhất là (c) tách module (5 — hàng trăm mục tiêu monkeypatch và allowlist theo đường dẫn file) và (d) gộp route group (4 — cascade CSS và khoảng 110 file test ghim đường dẫn group).

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085)

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
| --- | --- | --- |
| Playwright | `@playwright/test` và `playwright` **1.60.0** (`frontend/package-lock.json`). 6 config: `frontend/playwright.config.js` (e2e fixture tĩnh qua `python3 -m http.server 4173`), `.staging`, `.production-smoke`, `.reading-native`, `.speaking-regression`, `.spike` (`.review-redesign` bị G01-T04 xoá) | **Không có** `toHaveScreenshot`/`toMatchSnapshot` ở đâu cả (`git grep toHaveScreenshot` → rỗng). Các spec chỉ chụp ảnh khi lỗi (`screenshot: 'only-on-failure'`). |
| Hành trình trình duyệt có fixture | `frontend/tooling/verify-*-flow.mjs` (khoảng 122 file), `frontend/tooling/next-native-fixture-api.mjs`, `supabase-session.mjs`, `admin-mfa-stub.mjs`, `run-flow-repeat.mjs`, `frontend/tooling/README.md` | Mỗi flow `import { chromium } from 'playwright'`, dựng phiên giả trong localStorage, chặn API bằng `page.route`. Lệnh build fixture: `AVER_ENVIRONMENT=test VERCEL_ENV=development AVER_API_BASE=http://127.0.0.1:3999 AVER_SUPABASE_URL=https://example.supabase.co AVER_SUPABASE_ANON_KEY=test-anon-key npm run build` (tooling/README). CI chạy chúng trong `.github/workflows/next-native-browser.yml` job `browser-regression` (1.711 dòng, khoảng 136 bước). |
| Font | `frontend/app/layout.tsx:5` dùng `next/font/google` (`JetBrains_Mono`, `Lora`, `Plus_Jakarta_Sans`) | Font tải lúc build, tự phục vụ → ảnh chụp ổn định sau build; build cần mạng. |
| Chủ đề sáng/tối | `components/authed-shell.tsx` `ANTI_FLASH` đọc `localStorage['av-theme']` | Ảnh chụp cố định chủ đề bằng `addInitScript` đặt `av-theme`. |
| Test đọc mã nguồn | báo cáo 01 B1: 562/639 file test frontend gốc dùng `readFileSync`; 289/806 test backend đọc text | `docs/adr/ADR-005-test-retirement.md`: không xoá test theo tên file; mỗi test cũ phải có kết luận trong `docs/TEST_INVARIANT_LEDGER.md` (545 dòng) và test thay thế trong cùng PR. |
| JS cũ | `frontend/public/js/` 155 file | Đo lại bằng tên file: 46 file được `frontend/app`, `components`, `lib`, `proxy.ts`, `next.config.ts`, `instrumentation-client.ts` nhắc; **109 file (39.433 dòng) không**. Nhưng nạp động không lộ tên: `frontend/components/vocab-module-mount.tsx:88-89` dựng `/js/vocab-modules/${moduleName}.js` → `vocab-modules/flashcards.js`, `exercises.js` **đang chạy** dù không ai nhắc tên. Tên file trùng (`format.js`) có thể đếm thừa. |
| Bộ thu thập Gate F | `docs/audits/GATE_F_ASSET_AUDIT_2026-09-10.md`, `docs/audits/GATE_F_ASSET_INVENTORY_2026-09-10.json` (`deletionAuthorized: false`) | Audit bảo chạy `node frontend/tooling/gate-f-asset-inventory.mjs` — **file này không còn trên staging** (`ls frontend/tooling | grep gate` → rỗng). Không test nào đọc JSON inventory. Bản sao nông nên **CHƯA KIỂM** commit nào xoá nó: người thực thi chạy `git log --all --diff-filter=D --oneline -- frontend/tooling/gate-f-asset-inventory.mjs` trên bản clone đầy đủ. |
| JS cũ còn kiểu | `frontend/tsconfig.legacy.json` | `include: public/js/**/*.js`, `checkJs:false`; chú thích ghi chỉ `api.js` + `admin-access-codes.js` có `// @ts-check`. `admin-access-codes.js` nằm trong 109 file không được Next nhắc → xoá nó phải sửa chú thích. |
| Phục vụ `/js/*` | `frontend/next.config.ts:177-188` (header cache `/js/:path*`) | File trong `public/js` vẫn được Vercel phục vụ công khai. Xoá = URL `/js/<f>` trả 404. |
| Router Listening | `backend/routers/listening.py` | 9.558 dòng, 204 hàm/lớp cấp module, 76 route trên `user_router` (`/api/listening`, dòng 152, `route_class=_ListeningRoute`) và `admin_router` (`/admin/listening`, dòng 214, `_ListeningAdminRoute`). `main.py:93-96` import `user_router`, `admin_router`; `main.py:319,321` include. Ranh giới có sẵn bằng chú thích `# ── …`: helpers 217, schemas 604, user content 711, dictation submit 903, graders 1177–1502, admin content 1538–2166, browse/analytics 2167–2470, test bundle 2471, DOCX convert 3045, skill-drill import 3438, content audit 3831, map image 4899, manual upload 4943, student full-test 5192, test-linked dictation 6425, dictation report 6644, admin attempts 7702. |
| Test bám `routers.listening` | 71 file test import nó | Mẫu phổ biến: `from routers import listening as mod` (28), `monkeypatch.setattr(listening_module, "require_admin", …)` (26+), `setattr(…, "supabase_admin", …)` (40+), chuỗi `"routers.listening._fetch_attempt_or_404"` (11), `_upload_audio_to_bucket` (6)… `require_admin` (dòng 156) được gọi **trong thân hàm** (`await require_admin(authorization)`, 40 chỗ) nên patch thuộc tính module có tác dụng. |
| Đọc text `routers/listening.py` | backend: `tests/test_exam_only_content.py` (7 chỗ `_src("routers/listening.py")`), `tests/test_no_raw_input_echo.py` (khoá `("routers/listening.py", "<hàm>", …)`, khoảng 45 khoá), `tests/test_admin_exam_preview.py`, `tests/test_admin_listening_content_patch.py`, `tests/test_write_flow_fixtures.py`, `tests/sync_in_async_allowlist.tsv` (**186 dòng** khoá `routers/listening.py::<hàm>::<callee>`, callee có dạng `routers.listening._fetch_attempt_or_404`). Frontend: `frontend/tests/admin-listening-audit.test.mjs:28` (`read('backend/routers/listening.py')`), `admin-listening-audit-next-behavior`, `admin-listening-drills-import`, `admin-listening-fulltest-import`, `listening-review-ui`, `write-flow-core`, `react/review-unavailable-solution-context.test.tsx`, 2 fixture JSON, `frontend/tooling/write-flow*.mjs` (chú thích có số dòng). CI: `.github/workflows/next-native-browser.yml:356,434` lọc đường dẫn `'backend/routers/listening.py'`. |
| Bộ quét sync I/O | `backend/tests/sync_io_guard.py:763-773` (`scan_backend` đi qua mọi `.py`, bỏ `tests`, `migrations`, `scripts`), `test_no_sync_io_in_async.py` | Khoá = đường dẫn tương đối + tên hàm + callee. Báo cả "New sync I/O" lẫn allowlist thừa (stale). Không có lệnh tự sinh lại allowlist. |
| Router admin | `backend/routers/admin.py` (`router = APIRouter(prefix="/admin")` dòng 74) | 40 module không phải test `from routers.admin import require_admin` (+ `require_instructor`, `_actor_id`, `_require_db_engine`). 128 file test bám; patch: `setattr(admin, "supabase_admin")` 45, `"require_admin"` 37+26, `"routers.admin.supabase_admin"` 17… `sync_in_async_allowlist.tsv`: 105 dòng `routers/admin.py`. |
| Quiz service | `backend/services/quiz_service.py` | 45 file test bám; `tests/conftest.py:146-152` xoá `quiz_service._bank_content_cache` mỗi test; `test_quiz_bank_cache.py` đọc `quiz_service._bank_content_cache._entries`; dùng `quiz_service._at`, `get_bank_for_play` (23), `reap_expired_course_assessments` (19). allowlist: 8 dòng. |
| Route group | `frontend/app/` 80 group, **39** `(authed-admin-*)`, 75 `page.tsx` trong đó | Mọi layout admin gọi `AuthedShell` với `chrome="admin"`, `bodyClass="av-page av-admin-surface"`, `utilityLayer={false}`, `tailwindLayer={false}` và 4 sheet nền (`aver-design/admin-surface.css` có `dataAverAdminSurface`, `admin-components.css`, `admin-buttons.css`, `admin-status.css`) + 1..16 sheet trang. **Ngoại lệ:** `(authed-admin-writing-grade)` có `bodyClass="av-page font-sans antialiased av-admin-surface"`, không tắt `tailwindLayer`, nạp `admin-writing.css`, `admin-writing-grade.css`, `image-lightbox.css`. Một số group đã nạp nhiều sheet trang cùng lúc (`(authed-admin-listening)` 16 sheet) — bằng chứng sheet admin đã được khoanh phạm vi. Quét nhanh: trong `public/css/admin-*.css` không có selector phần tử cấp gốc (`html`, `body`, `a`…); `aver-design/admin-components.css:36` có `*, *::before, *::after { box-sizing: border-box; }` (sheet nền, mọi trang admin đều nạp). |
| Thứ tự cascade | `frontend/components/authed-shell.tsx` (216 dòng) | Phát `tokens.css` → `components.css` → (`ds.css` nếu utilityLayer) → `pageStylesheets` → (`tailwind.build.css` nếu tailwindLayer). Chú thích dòng 17–19: không dùng React 19 `<link precedence>` vì đổi thứ tự cascade, "làm có chủ đích, có ảnh chụp so sánh". `frontend/tests/authed-shell.test.mjs` ghim markup. |
| Ghim đường dẫn group admin | khoảng 110 file: 83 trong `frontend/tests`, 26 trong `frontend/tests/react`, `next-native-browser.yml` (47 lần nhắc), `docs/ROUTE_LEDGER.md` (75 lần; file ghi "Status: DRAFT" nhưng 42 file test/tooling đọc) | `frontend/tests/workflow-path-coverage.test.mjs` kiểm bộ lọc đường dẫn workflow phủ đủ phụ thuộc của mỗi flow — dời thư mục mà quên sửa bộ lọc sẽ bị test này bắt. |
| Media | 2.975 file `.mp3`, đều dưới `frontend/public/assets/advanced-vocab/` (3.100 file, 1.482 blob khác nhau) | `backend/services/advanced_vocab_service.py:28,241-262` dựng URL `/assets/advanced-vocab/<lesson>/…` và `/assets/advanced-vocab/versions/<lesson>/<checksum>/…`. `docs/ADVANCED_VOCAB_CORE30_DEPLOY.md:20-36`: media phiên bản bất biến, bài giao mở lại phụ thuộc cả hai dạng. `docs/REPOSITORY_MAINTENANCE.md` mục "Media follow-up": kế hoạch 4 bước, cấm viết lại lịch sử/LFS/đổi URL. CSP `frontend/tooling/content-security-policy.mjs:111` `media-src 'self' blob: https:`. Git đã gộp blob trùng trong `.git` — trùng 189 MiB chỉ tốn ở cây làm việc (mỗi worktree) và lần tải lên Vercel, không tốn ở dung lượng clone. |
| Spec | 30 `implementing`: 0001, 0002, 0003, 0004, 0005, 0006 (×2), 0007 (×2), 0008, 0009, 0010, 0011, 0012, 0013, 0015, 0016, 0019, 0020, 0021, 0022 (×2), 0024, 0025, 0026, 0029, 0031, 0034, 0035, 0037 | `validate_specs.py:44-55`: status hợp lệ `draft approved implementing verified shipped superseded`; `verified/shipped` đòi mọi task `[x]` và mọi FR có bằng chứng `PASS|MANUAL|N/A`. Lệch đã thấy: `IMPLEMENTATION_STATUS.md:104` ghi STORAGELIMITS-0038 "implementing (was approved)" nhưng `spec.md` ghi `approved`. |
| Migration | `backend/scripts/apply_migrations.sh:104` `for f in $(ls "$MIG_DIR"/*.sql | sort)` (sắp **từ điển**); `backend/tests/test_client_write_invariant_postgres.py:86` và `test_cohort_response_model.py:129` glob `[0-9][0-9][0-9]_*.sql` | Tên 4 chữ số (`1000_x.sql`) hoặc dấu thời gian (`20261120_x.sql`) sẽ sắp **trước** `380_…` và bị hai glob bỏ sót. `validate_specs.py` `HIGH_RISK_PATH_RE` ép PR chạm `backend/migrations/*.sql` thành `high-risk`. |

## 3. Phạm vi

**Trong phạm vi:** bảy mục (a)–(g) như bảng ở mục 1; mỗi mục: PR spec → các PR thực hiện.

**Ngoài phạm vi:**
- Gõ kiểu cho `frontend/lib/*.mjs` (báo cáo 01 mục 2.5) và tách `next-native-browser.yml` (2.8) — chưa có trong yêu cầu; đề xuất làm gói sau nếu anh Andy muốn.
- Gộp route group phía học viên (CSS học viên có luật toàn cục, ví dụ `home.css` theo chú thích `authed-shell.tsx:10-13`) — G07 tự quyết khi đổi 16 đường dẫn.
- Viết lại lịch sử Git, LFS, đổi URL media, đổi số migration cũ, đổi tên thư mục spec, đổi tên job CI bắt buộc.
- Thiết kế lại giao diện admin (G09), nền giao diện mới `components/ui/` và token `--av2-` (G03).

## 4. Yêu cầu

### (a) Chính sách test và ảnh chụp mốc
- **FR-10a-001** `AGENTS.md` mục "Testing / verification expectations" và `backend/tests/README.md` nêu: test mới kiểm hành vi; không đọc file mã nguồn (`.py .ts .tsx .js .mjs .css .md`) rồi so chuỗi; được đọc dữ liệu/cấu hình bằng parser (JSON/YAML/TSV) để kiểm dữ liệu.
- **FR-10a-002** Mẫu PR có ô đánh dấu "New tests assert behaviour, not source text (AGENTS.md › Testing)".
- **FR-10a-003** `npx playwright test -c playwright.visual.config.js` chụp và so ảnh cho danh sách màn ở 5.1, 4 dự án (1280×800 sáng/tối, 390×844 sáng/tối), với dữ liệu fixture, đồng hồ cố định, tắt hoạt ảnh.
- **FR-10a-004** Ảnh mốc được commit dưới `frontend/tests/visual/__screenshots__/`; chạy lại không đổi giao diện → 0 khác biệt trên 3 lần chạy liên tiếp.
- **FR-10a-005** CI có job "Visual baseline" (advisory, không bắt buộc) chạy khi PR chạm `frontend/app/**`, `frontend/components/**`, `frontend/public/css/**`, `frontend/tests/visual/**`; khi khác ảnh, tải lên artifact ảnh khác biệt.
- **FR-10a-006** Có lệnh cập nhật ảnh mốc tái lập được trên máy của người thực thi (container Playwright cùng phiên bản với CI).

### (b) Gỡ JS cũ
- **FR-10b-001** Mỗi đợt có danh sách ứng viên kèm bằng chứng ba lớp: không có tham chiếu tĩnh/động từ mã Next; không có request trong toàn bộ hành trình `verify-*-flow.mjs` + Playwright suites; (nếu anh Andy cấp) không có hit trong log truy cập 14–30 ngày.
- **FR-10b-002** Mỗi test chỉ kiểm mã của file bị xoá có một kết luận trong `docs/TEST_INVARIANT_LEDGER.md` (port/thay thế/retire kèm test thay thế hiện có) trong cùng PR (ADR-005).
- **FR-10b-003** Sau mỗi đợt: mọi bộ test và job CI bắt buộc xanh; mọi `verify-*-flow.mjs` của nhóm trang liên quan chạy qua; `/js/<file đã xoá>` trả 404 trên preview, mọi trang của nhóm vẫn tải không lỗi console mới.
- **FR-10b-004** Không xoá `practice.js`, 46 file được Next nhắc, họ nạp động (`vocab-modules/*`), `legacy-retirement-beacon.js` (133 test nhắc) trước đợt cuối có spec bổ sung.

### (c) Tách module backend
- **FR-10c-001** `from routers.listening import user_router, admin_router` và mọi tên test đang import từ `routers.listening` vẫn dùng được.
- **FR-10c-002** `monkeypatch.setattr(routers.listening, X, v)` / `mock.patch("routers.listening.X")` vẫn có tác dụng lên mã đã dời sang module con.
- **FR-10c-003** Danh sách route của app (path, methods, name, **thứ tự**) và `frontend/types/api.d.ts` sinh lại không đổi byte.
- **FR-10c-004** Allowlist `sync_in_async_allowlist.tsv` và khoá `test_no_raw_input_echo.py` chỉ đổi đường dẫn file, không tăng số đếm, không thêm khoá mới.
- **FR-10c-005** Cùng các yêu cầu trên cho `routers.admin` (40 module import `require_admin`) và `services.quiz_service` (giữ đúng một đối tượng `_bank_content_cache`).

### (d) Gộp route group admin
- **FR-10d-001** Có một group `(authed-admin)`; mỗi trang admin chuyển vào đó giữ URL, giữ markup `<head>` tương đương và giữ ảnh chụp mốc (5.1) trong ngưỡng.
- **FR-10d-002** Trang admin mới (G09) không cần tạo group riêng.
- **FR-10d-003** `(authed-admin-writing-grade)` giữ group riêng (khác `bodyClass`, có Tailwind) trừ khi spec quyết khác.

### (e) Media ra khỏi git
- **FR-10e-001** Có bảng kê đường dẫn, SHA-256, kích thước của mọi file dưới `frontend/public/assets/advanced-vocab/` (bước 1 của kế hoạch).
- **FR-10e-002** Có bảng kê mọi nơi lưu URL media ở staging và production (bài giao, snapshot, manifest) — bước 2.
- **FR-10e-003** Mọi URL `/assets/advanced-vocab/**` cũ (cả dạng `versions/<lesson>/<checksum>`) vẫn phát được, hỗ trợ `Range`, sau khi file rời khỏi cây.
- **FR-10e-004** Công cụ sinh media mới (`backend/scripts/generate_advanced_vocab_audio.py`, `sync_advanced_vocab_core30.py`) ghi tới nơi lưu mới, không ghi vào `frontend/public/assets`.
- **FR-10e-005** Có đường quay lại (rollback) đã thử trên staging.

### (f) Rà spec
- **FR-10f-001** Mỗi spec `implementing` có một hàng trong `IMPLEMENTATION_STATUS.md` ghi phân loại: `shipped-pending-evidence` (đã deploy, thiếu bằng chứng — liệt kê FR thiếu), `blocked` (tên điều chặn), `in-progress` (task còn mở), `superseded-proposed` (đề xuất thay bằng spec khác, chờ anh Andy).
- **FR-10f-002** Không đổi `status` trong `spec.md` khi chưa đủ bằng chứng theo `validate_specs.py`; chuyển `superseded` chỉ khi anh Andy duyệt.

### (g) Số migration không va chạm
- **FR-10g-001** `register.tsv` (G01-T06) có hàng `block` cấp dải số cho từng gói; người thực thi chỉ lấy số trong dải của gói mình.
- **FR-10g-002** `test_migration_register.py` thất bại khi file/hàng giữ chỗ nằm ngoài mọi dải, hoặc nằm trong dải của gói khác mà owner không khớp tiền tố.
- **FR-10g-003** Quy tắc phụ thuộc: một migration chỉ được phụ thuộc migration số nhỏ hơn; cần phụ thuộc số lớn hơn thì lấy số mới trong dải cao hơn.
- **FR-10g-004** Có ngưỡng cảnh báo khi số cao nhất vượt 900 (trước giới hạn 3 chữ số).

## 5. Hợp đồng kỹ thuật

### 5.1 Ảnh chụp mốc (mục a)

- File: `frontend/playwright.visual.config.js`, `frontend/tests/visual/*.spec.js`, `frontend/tests/visual/fixtures.js` (phiên giả, chặn API), ảnh ở `frontend/tests/visual/__screenshots__/{projectName}/{testFileName}/{arg}.png` (`snapshotPathTemplate`).
- `webServer`: mảng hai server — `node tooling/next-native-fixture-api.mjs` (url `http://127.0.0.1:3999/health`) và `npx next start -p 3213` (url `http://localhost:3213/grammar`), `reuseExistingServer: false`. Build trước bằng lệnh fixture ở mục 2.
- `projects`: `desktop-light` (1280×800), `desktop-dark`, `mobile-light` (390×844), `mobile-dark`; `browserName: 'chromium'`.
- Mỗi test: `page.clock.setFixedTime(new Date('2026-11-16T03:00:00Z'))`; `addInitScript` đặt `av-theme`; chờ `document.fonts.ready`; `expect(page).toHaveScreenshot('<ten>.png', { animations: 'disabled', caret: 'hide', fullPage: false, maxDiffPixelRatio: 0.002, mask: [<vùng thời gian thực, avatar>] })`.
- Danh sách màn đợt 1 (T03): `/grammar` (công khai, server render), `/login`, `/home`, `/admin` (tổng quan), `/admin/listening/tests`, `/practice` (hoặc trang học viên mà fixture có sẵn dữ liệu — người thực thi xem `verify-next-responsive-flow.mjs`). Đợt 2 (T04): mọi màn mà G03/G07/G09 đã liệt kê sẽ đổi; tối thiểu 20 màn.
- Chạy cố định trong container `mcr.microsoft.com/playwright:v1.60.0-noble` (phiên bản phải khớp `package-lock.json`). Lệnh cập nhật cục bộ: `docker run --rm -v "$PWD":/w -w /w/frontend mcr.microsoft.com/playwright:v1.60.0-noble bash -lc "npm ci && <lệnh build fixture> && npx playwright test -c playwright.visual.config.js --update-snapshots"`.
- CI: workflow mới `.github/workflows/visual-baseline.yml`, job `visual-baseline` (tên không trùng job bắt buộc nào), `container: mcr.microsoft.com/playwright:v1.60.0-noble`, trigger `pull_request` theo đường dẫn ở FR-10a-005 + `workflow_dispatch`; `actions/upload-artifact` thư mục `test-results/visual` khi lỗi.

### 5.2 Gói Listening sau khi tách (mục c)

```
backend/routers/listening/
  __init__.py      # tạo user_router, admin_router, _ListeningRoute…; re-export mọi tên cũ; cơ chế "seam" bên dưới
  _common.py       # helpers 217–603 và schemas 604–710 (PR sau mới tách)
  admin_import.py  # 2471–3830 (test bundle, DOCX convert, skill-drill import)
  admin_audit.py   # 3831–4942
  student_fulltest.py  # 5192–6424
  dictation.py     # 903–1176, 6425–7701
  admin_attempts.py    # 7702–hết
```

Tên module con là đề xuất; người thực thi giữ ranh giới theo chú thích `# ── …` thật trong file lúc làm. Cơ chế giữ mục tiêu monkeypatch (dán cuối `__init__.py`, sau khi import module con):

```python
import sys as _sys, types as _types
_SUBMODULES = (admin_import, admin_audit, student_fulltest, dictation, admin_attempts)

class _SeamModule(_types.ModuleType):
    """setattr/delattr trên routers.listening lan xuống module con có cùng tên,
    để monkeypatch.setattr(routers.listening, X, ...) và mock.patch("routers.listening.X")
    tiếp tục tác dụng lên mã đã dời. Không đổi hành vi chạy thật."""
    def __setattr__(self, name, value):
        super().__setattr__(name, value)
        for sub in _SUBMODULES:
            if name in vars(sub):
                setattr(sub, name, value)
    def __delattr__(self, name):
        super().__delattr__(name)
        for sub in _SUBMODULES:
            if name in vars(sub):
                delattr(sub, name)

_sys.modules[__name__].__class__ = _SeamModule
```

Module con import tên dùng chung từ `routers.listening._common` (hoặc từ `database`, `routers.admin` như file gốc) — **không** `from routers.listening import X` ở cấp module con (vòng import khi `__init__` đang chạy). Mọi decorator vẫn dùng đúng đối tượng `user_router`/`admin_router` tạo trong `__init__.py`/`_common.py`.

Lệnh chụp danh sách route (chạy trước và sau, so bằng `diff`):

```bash
cd backend && python - <<'PY' > /tmp/routes-$(git rev-parse --short HEAD).txt
from main import app
for r in app.routes:
    print(getattr(r, "path", ""), sorted(getattr(r, "methods", None) or []), getattr(r, "name", ""), type(r).__name__)
PY
```

`import main` cần biến môi trường cấu hình: **CHƯA KIỂM** biến nào bắt buộc; người thực thi đọc `backend/tests/conftest.py` (đầu file đặt env cho test) và đặt cùng giá trị giả trước lệnh. Bằng chứng hợp đồng API: job `apitype-drift` trong `.github/workflows/typecheck.yml` (sinh lại `frontend/types/api.d.ts` và so).

### 5.3 Group `(authed-admin)` (mục d)

```
frontend/app/(authed-admin)/layout.tsx          # AuthedShell chrome="admin", bodyClass, utilityLayer={false}, tailwindLayer={false}, 4 sheet nền
frontend/app/(authed-admin)/admin/feedback/layout.tsx   # chỉ phát <link rel="stylesheet" href="/css/admin-feedback-next.css" precedence="admin-page" />
frontend/app/(authed-admin)/admin/feedback/page.tsx     # git mv từ (authed-admin-feedback)
```

URL không đổi (group không thêm đoạn URL). Hai câu hỏi phải trả lời bằng bằng chứng trong PR thí điểm (T14), không bằng suy luận: (1) React 19 đặt `<link precedence>` ở vị trí nào trong `<head>` so với 4 sheet nền do `AuthedShell` phát (xem HTML trả về từ `curl` trang và DOM sau hydrate); (2) khi điều hướng phía client từ trang admin A sang B trong cùng group, sheet của A có bị giữ lại không, và có đổi ảnh chụp của B không. Nếu (1) đặt sheet trang **trước** sheet nền hoặc (2) làm đổi ảnh, phương án thay thế: giữ `pageStylesheets` theo **nhóm việc** (gộp 39 group thành khoảng 8 group theo 8 nhóm sidebar của G09: mỗi group nạp mọi sheet trang của nhóm như `(authed-admin-listening)` đang làm).

### 5.4 Dải số migration (mục g)

Thêm `state=block` vào `register.tsv` (cột `number` dạng `400-419`, `owner` = tiền tố gói `G06`). Dải số đã cấp ở `01-KE-HOACH-TONG.md` mục 6 (anh Andy duyệt ở Q-g1; không đề xuất dải khác): G04 381–389; G05 390–399; G06 400–419; G07 420–439; G09 440–459; G08 460–469; GOI-11 470–479; GOI-12 480–489; GOI-13 490–499; từ 500 trở đi dự phòng, cấp thêm theo yêu cầu (sửa 18/11 theo rà soát). Test kiểm FR-10g-002 và in cảnh báo khi `max(number) >= 900`. Không đổi `apply_migrations.sh`.

## 6. Nhiệm vụ

### 6.0 Thứ tự và mục nào mở đường cho gói nào

| Thứ tự | Nhiệm vụ | Mở đường cho | Mức phụ thuộc |
| ---: | --- | --- | --- |
| 1 | (a) T01–T03 chính sách test + ảnh chụp đợt 1 | G03 (đổi token/thành phần cần so ảnh trước/sau), G07, G09, và (d) | **cứng** cho (d); nên có trước PR giao diện lớn đầu tiên của G03 |
| 2 | (f) T20–T21 rà spec | G04 (FREETRIAL-0047 và AIBUDGET-0033 liên quan lượt chấm AI / `credit_ledger`) | mềm: G04 viết spec dễ hơn khi biết spec nào đang dở |
| 3 | (g) T22–T23 dải số migration | G04, G05, G06, G07, G08, G09, GOI-11, GOI-12, GOI-13 | mềm: G01-T06 đã đủ chống trùng; dải số giúp chạy song song không phải hỏi |
| 4 | (c) T08–T10 tách `listening.py` | G08 (phòng thi chung Reading/Listening/Mock: sửa luồng nộp/kết thúc Listening) | mềm: nếu G08 đã sửa `listening.py` thì tách **sau** khi PR G08 đó merge; không chạy song song cùng file |
| 4 | (b) T05–T07 đợt W1–W3 (admin) | G09 (người thực thi grep ra bản JS chết `admin-classes.js` 4.053 dòng trước bản Next) | mềm |
| 5 | (d) T13–T14 thí điểm group admin | G09 (trang admin mới đặt vào `(authed-admin)`) | **nên trước** trang mới đầu tiên của G09 |
| 5 | (c) T11 tách `admin.py` | G09 (danh bạ người dùng + học viên, cấp quyền khoá) | mềm |
| 6 | (b) đợt W5–W6 (Listening/Reading/Mock học viên) | G08 (gỡ `reading-exam.js` 3.441 dòng, `listening-test-player.js` 2.068, `mock-exam-runner.js` 1.003 dễ bị nhầm là phòng thi đang chạy) | mềm |
| 7 | (d) T15 các đợt còn lại; (c) T12 `quiz_service`; (e) T16–T19 media | — | độc lập |

### G10-T01 — Spec TESTPOLICY (mục a) — PR spec, DỪNG chờ duyệt

- **Mục đích:** có spec được duyệt trước khi thêm job CI.
- **Đầu vào:** `specs/_templates/*`, `specs/README.md`, mục 4(a), 5.1 của gói này, `docs/adr/ADR-005-test-retirement.md`.
- **Việc làm:** tạo `specs/NNNN-test-policy-visual-baseline/` với `spec.md` (frontmatter `id: TESTPOLICY-NNNN`, `status: draft`, `risk: medium`), `plan.md` (5.1), `tasks.md` (T02–T04), `verification.md` (một hàng mỗi FR, `PENDING`); thêm hàng vào `specs/README.md` và `IMPLEMENTATION_STATUS.md`. Kịch bản đưa vào `spec.md`:
  - Given giao diện không đổi, When chạy bộ ảnh 3 lần, Then 0 khác biệt.
  - Given một PR đổi màu nút trong `admin-buttons.css`, When job chạy, Then màn admin báo khác biệt và artifact có ảnh diff.
  - Ca biên: trang có ngày giờ (đồng hồ cố định); trang có ảnh/video ngoài (mask); dark mode lần đầu tải (anti-flash); font chưa tải xong (`document.fonts.ready`).
  - Câu hỏi mở: job advisory hay bắt buộc (Q-a1); có thêm lớp chặn tự động test đọc mã nguồn không (Q-a2).
- **Đầu ra:** 1 PR spec. **Dừng chờ anh Andy duyệt** (đổi `status: approved` do anh hoặc theo lệnh anh).
- **Nghiệm thu:** `python backend/scripts/validate_specs.py` qua; CI `Spec and PR metadata` xanh.
- **Không làm:** không viết mã trong PR này.
- **Ước lượng:** 1 phiên · độ khó 2.

### G10-T02 — Viết chính sách test vào hướng dẫn

- **Mục đích:** phiên mới biết test nào được viết.
- **Đầu vào:** `AGENTS.md` mục "Testing / verification expectations" (dòng ~201–209), `backend/tests/README.md`, `frontend/tests/e2e/README.md`, `.github/pull_request_template.md`, `docs/adr/ADR-005-test-retirement.md`.
- **Việc làm:**
  1. `AGENTS.md`: thêm tiểu mục "New tests" — được: gọi route/hàm với DB giả (mẫu: test dùng `monkeypatch.setattr(<module>, "supabase_admin", fake)`); import `frontend/lib/*.mjs` rồi gọi hàm; React qua `frontend/tests/react` (vitest + Testing Library); hành trình Playwright với fixture; ảnh chụp mốc; đọc JSON/YAML/TSV bằng parser để kiểm dữ liệu. Không: đọc `.py/.ts/.tsx/.js/.mjs/.css/.md` rồi `assert.match`/`in`. Test cũ đọc mã: giữ; khi đổi hành vi làm nó vỡ, thay bằng test hành vi trong cùng PR và ghi `docs/TEST_INVARIANT_LEDGER.md` (ADR-005).
  2. Thêm một dòng tương tự vào `backend/tests/README.md` và `frontend/tests/e2e/README.md` (link về `AGENTS.md`).
  3. `.github/pull_request_template.md`: thêm mục `## Tests` với ô `- [ ] New or changed tests assert behaviour, not source text (AGENTS.md › New tests).`
- **Đầu ra:** 1 PR (`feature`, `Spec: TESTPOLICY-NNNN`, map FR-001, FR-002).
- **Nghiệm thu:** `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/staging-first-release-flow.test.mjs frontend/tests/workflow-path-coverage.test.mjs` qua; `cd backend && python -m pytest tests/test_validate_specs.py -q` qua (validator đọc thân PR theo các mục `## Problem`…; thêm mục mới không được phá) và `validate_specs.py --github-event` trên PR xanh.
- **Không làm:** không thêm test/lint kiểm chính sách (Q-a2).
- **Vướng mắc → cách gỡ:** `validate_specs.py` đòi mọi đường dẫn ngoài `specs/` đổi trong PR feature phải nằm trong `implementation=` của một FR → ghi `kind=manual; ref=…; implementation=<sha>:AGENTS.md,<sha>:.github/pull_request_template.md,…` trong thân PR theo mẫu PR.
- **Ước lượng:** 1 phiên · độ khó 1.

### G10-T03 — Dựng bộ ảnh chụp mốc đợt 1 và job CI

- **Mục đích:** có mốc so ảnh trước khi G03/G07/G09 đổi giao diện.
- **Đầu vào:** 5.1; `frontend/tooling/verify-next-responsive-flow.mjs`, `verify-admin-overview-flow.mjs`, `verify-admin-listening-tests-flow.mjs`, `supabase-session.mjs`, `admin-mfa-stub.mjs`, `next-native-fixture-api.mjs`; `frontend/tooling/README.md`; `.github/workflows/next-native-browser.yml` dòng 820–862 (cách CI build và khởi động).
- **Việc làm:**
  1. Tạo `frontend/tests/visual/fixtures.js`: hàm `seedSession(page, { role })` và `routeApi(page, handlers)` chép từ cách các flow trên làm (không import trực tiếp file flow vì flow chạy ngay khi import).
  2. Tạo `frontend/playwright.visual.config.js` và 6 spec ở 5.1 (một file `frontend/tests/visual/core.spec.js` là đủ).
  3. Sinh ảnh trong container (lệnh 5.1), chạy lại 3 lần không `--update-snapshots` → 0 khác biệt. Commit ảnh.
  4. Tạo `.github/workflows/visual-baseline.yml` theo 5.1.
  5. Thêm `frontend/test-results/visual/` vào `.gitignore` nếu chưa bị phủ.
- **Đầu ra:** 1 PR (`feature`, map FR-003…FR-006): config, spec, fixtures, 24 ảnh PNG, workflow.
- **Nghiệm thu:** trong container: `npx playwright test -c playwright.visual.config.js` → 24 passed, chạy 3 lần; thử âm: sửa tạm màu trong `public/css/aver-design/admin-buttons.css` → test `/admin` thất bại, khôi phục; CI job `visual-baseline` xanh trên PR; `node --import … --test frontend/tests/workflow-path-coverage.test.mjs frontend/tests/workflow-post-merge-gates.test.mjs frontend/tests/route-auth-guard-inventory.test.mjs` qua; BỘ KIỂM đầy đủ phía frontend (00 §5.3) qua.
- **Không làm:** không sửa `next-native-browser.yml`; không đặt job thành bắt buộc; không chụp production/staging thật.
- **Vướng mắc → cách gỡ:**
  - Ảnh macOS khác Linux → chỉ sinh ảnh trong container; ghi trong `frontend/tests/e2e/README.md` (hoặc README trong `tests/visual` nếu cần — ưu tiên file sẵn có) lệnh docker.
  - `route-auth-guard-inventory.test.mjs:206` quét mọi `playwright.*.js` để cấm điều hướng tới `/next-probe`, `/recorder-spike` → không nhắc hai route đó trong config/spec mới.
  - Server Component gọi API thật lúc render → phải đi qua fixture API (`AVER_API_BASE=http://127.0.0.1:3999`); trang nào fixture API không trả dữ liệu thì loại khỏi đợt 1 và ghi lý do.
  - Ảnh lệch 1–2 px do khử răng cưa → tăng `maxDiffPixelRatio` tới tối đa 0.005; lệch hơn nữa là bất ổn định thật, tìm nguồn (hoạt ảnh, font, thời gian).
  - Cỡ repo: 24 ảnh × ~150 KB; đợt 2 giữ dưới 15 MB tổng; chỉ chụp khung nhìn, không `fullPage`.
  - `workflow-post-merge-gates.test.mjs` liệt kê cổng phải chạy lại trên `main` theo tiêu chí "dựng lại toàn cây" → job advisory theo PR không thuộc danh sách; nếu test đòi, thêm trigger `push: branches: [main, staging]`.
- **Ước lượng:** 2 phiên · độ khó 4.

### G10-T04 — Mở rộng ảnh mốc cho màn G03/G07/G09 sẽ đổi

- **Mục đích:** mỗi màn sắp đổi có ảnh "trước".
- **Đầu vào:** danh sách màn trong `GOI-03-*.md`, `GOI-07-*.md`, `GOI-09-*.md` (cùng thư mục O); `frontend/tests/visual/*`.
- **Việc làm:** thêm spec theo nhóm (`learner.spec.js`, `admin.spec.js`, `public.spec.js`), tối thiểu 20 màn × 4 dự án; mỗi màn có trạng thái chính (dữ liệu đầy đủ) và một trạng thái rỗng nếu fixture cho phép.
- **Đầu ra:** 1–2 PR.
- **Nghiệm thu:** như T03 (3 lần 0 khác biệt); tổng dung lượng ảnh ghi trong PR.
- **Vướng mắc → cách gỡ:** gói khác chưa viết danh sách màn → lấy 16 đường dẫn học viên trong 00 §2.7 + 8 nhóm admin, ghi "chưa có danh sách từ gói X".
- **Ước lượng:** 2 phiên · độ khó 3.

### G10-T05 — Spec LEGACYJS (mục b) — PR spec, DỪNG chờ duyệt

- **Mục đích:** có quyết định gỡ theo đợt, thay `deletionAuthorized: false` của Gate F.
- **Đầu vào:** mục 4(b), bảng đợt ở T07; `docs/audits/GATE_F_ASSET_AUDIT_2026-09-10.md` (mục "Completion audit"), `docs/adr/ADR-005-test-retirement.md`, `docs/TEST_INVARIANT_LEDGER.md`.
- **Việc làm:** tạo `specs/NNNN-legacy-public-js-retirement/` (spec, plan, tasks, verification, rollout; `ui-states.md` ghi "Not applicable: no UI change; asset removal only"). `rollout.md`: mỗi đợt merge vào staging, quan sát preview/staging, khôi phục bằng `git revert` một PR. Kịch bản:
  - Given đợt W1 đã merge, When mở mọi trang `/admin/listening/**` trên staging, Then không lỗi console mới, không request 404 tới `/js/*`.
  - Given một file ứng viên được nạp bằng URL dựng động, When bộ thu thập chạy, Then file đó bị loại khỏi đợt.
  - Ca biên: tên file trùng ở thư mục khác (`format.js`); script nạp script khác bằng đường dẫn tương đối bên trong `public/js`; fixture HTML trong `frontend/tests/fixtures/**` nạp file (giữ, vì là test cũ của ADR-005).
  - Câu hỏi mở: Q-b1, Q-b2.
- **Đầu ra:** 1 PR spec. **Dừng.**
- **Ước lượng:** 1 phiên · độ khó 2.

### G10-T06 — Bằng chứng ứng viên (bộ thu thập tối thiểu)

- **Mục đích:** FR-10b-001 lớp 1 và 2 làm được bằng lệnh.
- **Đầu vào:** mục 2 (Gate F); `frontend/tooling/verify-*-flow.mjs`; `frontend/components/vocab-module-mount.tsx`.
- **Việc làm:**
  1. Thử khôi phục collector cũ: `git log --all --diff-filter=D --format=%H -- frontend/tooling/gate-f-asset-inventory.mjs | head -1` → nếu có, `git show <sha>^:frontend/tooling/gate-f-asset-inventory.mjs > frontend/tooling/gate-f-asset-inventory.mjs`, chạy `node frontend/tooling/gate-f-asset-inventory.mjs --summary` và dùng kết quả (lớp 1). Không tìm được → lớp 1 = lệnh `git grep` tên file trên `frontend/app components lib proxy.ts next.config.ts instrumentation-client.ts public/js` (để bắt file JS cũ nạp file JS cũ khác) + `git grep -nE "/js/\\$\\{|'/js/' *\\+|\`/js/" -- frontend/app frontend/components frontend/lib` để tìm URL dựng động; mọi họ có URL động bị giữ nguyên.
  2. Lớp 2: tạo `frontend/tooling/capture-public-js.mjs` (preload, khoảng 30 dòng): `import { chromium } from 'playwright'`, bọc `chromium.launch` để mỗi browser trả về có `context.on('request')` ghi URL khớp `/js/` vào file `$CAPTURE_OUT` (một dòng một URL). Chạy toàn bộ flow: `NODE_OPTIONS="--import ./tooling/capture-public-js.mjs" CAPTURE_OUT=/tmp/js-req.txt node tooling/verify-<x>-flow.mjs <base>` cho mọi flow (vòng lặp shell), cộng các suite Playwright (`playwright.reading-native.config.js`, `.speaking-regression`) với cùng `NODE_OPTIONS`.
  3. Kết quả đặt **ngoài repo** (`/tmp/…`), dán bảng tóm tắt theo đợt vào thân PR đợt (AGENTS.md: manifest kiểm toán sinh ra không được commit vào tài liệu).
- **Đầu ra:** 1 PR chỉ thêm `frontend/tooling/capture-public-js.mjs` (và collector khôi phục nếu có), không xoá gì.
- **Nghiệm thu:** chạy trên `verify-admin-classes-flow.mjs` → file capture chứa `/js/components/aver-admin-chrome.js` (file Next đang nạp) — chứng minh bắt được request; bộ contract frontend qua.
- **Không làm:** không commit danh sách ứng viên dạng JSON có ngày.
- **Vướng mắc → cách gỡ:**
  - `NODE_OPTIONS --import` cho ESM preload và đối tượng `chromium` là cùng một instance chỉ khi cùng đường dẫn module → chạy từ thư mục `frontend` để cả hai resolve `frontend/node_modules/playwright`.
  - Flow tự `chromium.launch({ executablePath })` trên macOS (xem `launchChromium` trong flow) → wrapper phải truyền nguyên tham số.
  - Bộ thu thập nhỏ này là công cụ phụ trợ: điều kiện dừng = đủ cho FR-10b-001; không mở rộng thành hệ thống báo cáo.
- **Ước lượng:** 1 phiên · độ khó 3.

### G10-T07-Wn — Gỡ JS cũ theo đợt (mỗi đợt một PR, sau khi T05 duyệt và Q-b1 = có)

| Đợt | Họ file (trong 109 file không được Next nhắc) | Số file · dòng | Số file test/tooling/CI nhắc tên | Gói hưởng lợi |
| --- | --- | --- | --- | --- |
| W1 | `admin-listening-*.js` | 15 · 4.688 | 38 | G09 |
| W2 | `admin-mock-*.js`, `admin-exam-content.js` | 7 · ~2.880 | 27 | G09 |
| W3 | `admin-classes.js`, `admin-students-panel.js`, `admin-users.js`, `admin-access-codes.js`, `admin-codes-util.js` | 5 · ~5.700 | chia nếu > 30 | G09 |
| W4 | admin còn lại: `admin-grammar-*`, `admin-vocab-*`, `admin-speaking-*`, `admin-reading*`, `admin-writing-*`, `admin-feedback.js`, `admin-overview.js`, `admin-dashboard.js`, `admin-alerts.js`, `admin-ai-usage.js`, `admin-usage*.js`, `admin-foot-traffic.js`, `admin-instructors.js`, `admin-embed.js`, `admin-error-logs.js` | ~24 · ~5.300 | ~70 → tách W4a/W4b | G09 |
| W5 | `listening-*.js` (học viên) | 16 · 6.566 | 72 → tách W5a/W5b | G08 |
| W6 | `reading-*.js`, `components/reading-*.js`, `mock-exam-runner.js`, `exam-player.js`, `full-test.js` | 13 · ~6.600 | ~72 → tách | G08 |
| W7+ | vocab (trừ `vocab-modules/*` nạp động), `instructor-*`, `my-class.js`, `user-pill.js`, `rum-vitals.js`, `confirm-danger.js`, `supabase-sdk-fallback.js`, `legacy-retirement-beacon.js`; rồi 14 symlink trong `frontend/`, `tests/fixtures/legacy-html-retired/loader.mjs`, `tsconfig.legacy.json` | — | 143+ | spec bổ sung riêng |

Các số trên đo bằng tên file ở `93c7085`; người thực thi đo lại bằng T06 trước mỗi đợt.

- **Việc làm mỗi đợt:**
  1. Chạy T06 lớp 1 và 2 cho họ file của đợt; loại mọi file có tham chiếu/request. Nếu Q-b2 cho phép, thêm lớp 3 (log).
  2. Liệt kê test nhắc từng file: `git grep -l -F "<file>" -- frontend/tests frontend/tooling backend/tests .github`. Với mỗi test: (i) test chỉ kiểm file bị xoá → retire, thêm hàng vào `docs/TEST_INVARIANT_LEDGER.md` ghi test Next thay thế đã có (thường là `frontend/tests/<tên>-next-behavior.test.mjs` hoặc `tooling/verify-<tên>-flow.mjs`); (ii) test kiểm cả file bị xoá lẫn thứ khác → chỉ xoá phần assertion về file bị xoá, ghi ledger; (iii) không có thay thế → **không xoá file đó**, chuyển sang đợt sau và báo.
  3. `git rm` file; dòng bộ lọc đường dẫn trong `.github/workflows/next-native-browser.yml` trỏ file đã xoá: để nguyên hoặc xoá theo cách `workflow-path-coverage.test.mjs` chấp nhận (chạy test để biết).
  4. W3: sửa chú thích `frontend/tsconfig.legacy.json` (bỏ `admin-access-codes.js`).
  5. Nếu số test phải sửa > 30 → tách PR (00 §7).
- **Nghiệm thu mỗi đợt:** BỘ KIỂM đầy đủ (00 §5.3) qua; CI `Next-native browser regression` xanh; chạy mọi `tooling/verify-<nhóm>-*-flow.mjs` của đợt qua bằng `run-flow-repeat.mjs --runs 2`; ảnh mốc (T03/T04) của nhóm trang không đổi; trên preview: `curl -s -o /dev/null -w '%{http_code}' <preview>/js/<file>` → 404 và mở 3 trang của nhóm không có lỗi console mới.
- **Không làm:** không xoá file trong bảng FR-10b-004; không xoá fixture HTML; không sửa `docs/audits/GATE_F_ASSET_INVENTORY_2026-09-10.json` (bằng chứng có ngày).
- **Vướng mắc → cách gỡ:**
  - Test `readFileSync('public/js/x.js')` qua symlink `frontend/js → public/js` → `git grep` cả `'js/x.js'` lẫn `'public/js/x.js'`.
  - `legacy-freeze.yml` chạy (lọc `frontend/public/**`) và cấm symlink/HTML trong `public` → xoá JS không ảnh hưởng.
  - Script trong `public/js` tự nạp script khác bằng `document.createElement('script')`/`import('./…')` → lớp 1 phải quét cả `public/js`; nếu file A (giữ) nạp B (ứng viên) thì giữ B.
- **Ước lượng:** mỗi đợt 1 phiên · độ khó 3; W1–W6 khoảng 9 PR.

### G10-T08 — Spec BACKENDSPLIT (mục c) — PR spec, DỪNG chờ duyệt

- **Đầu vào:** mục 4(c), 5.2, `docs/REPOSITORY_MAINTENANCE.md` mục "Module follow-up".
- **Việc làm:** tạo `specs/NNNN-backend-module-split/` (spec, plan, tasks, verification, rollout; `ui-states.md` = N/A có lý do). Kịch bản:
  - Given staging trước và sau PR tách, When so danh sách route (5.2) và `api.d.ts`, Then giống hệt.
  - Given test `monkeypatch.setattr(listening, "supabase_admin", fake)`, When gọi endpoint đã dời sang `routers/listening/dictation.py`, Then endpoint dùng `fake`.
  - Ca biên: tên được patch nhưng không tồn tại trong module con (`raising=False`) → `__delattr__` khi undo; `mock.patch` lồng nhau; lớp Pydantic tham chiếu theo chuỗi (`from __future__ import annotations` ở dòng 21) → `model_rebuild`/forward ref phải còn resolve được trong module con.
  - `rollout.md`: một module một PR; làm giữa các PR tính năng Listening; revert một PR là quay lại.
  - Câu hỏi mở: Q-c1, Q-c2.
- **Đầu ra:** 1 PR spec. **Dừng.**
- **Ước lượng:** 1 phiên · độ khó 2.

### G10-T09 — `routers/listening.py` thành package, chưa dời mã (PR1)

- **Mục đích:** đổi đường dẫn file một lần, tách khỏi việc dời mã, để mọi chỗ ghim đường dẫn được sửa trong một PR dễ duyệt.
- **Đầu vào:** mục 2 hàng "Đọc text `routers/listening.py`"; 5.2.
- **Việc làm:**
  1. `git mv backend/routers/listening.py backend/routers/listening/__init__.py`. Không sửa một dòng nội dung nào.
  2. `backend/tests/sync_in_async_allowlist.tsv`: thay tiền tố `routers/listening.py::` bằng `routers/listening/__init__.py::` (186 dòng, `sed` có kiểm số dòng trước/sau). Callee `routers.listening.<x>` giữ nguyên (tên module không đổi).
  3. `backend/tests/test_no_raw_input_echo.py`: thay `"routers/listening.py"` bằng `"routers/listening/__init__.py"` trong khoá (khoảng 45 khoá).
  4. `backend/tests/test_exam_only_content.py` và 3 test backend khác đọc `_src("routers/listening.py")`: đổi đường dẫn. Frontend: `frontend/tests/admin-listening-audit.test.mjs:28` và các test ở mục 2 đọc `backend/routers/listening.py`: đổi đường dẫn. Đây là sửa test có chủ ý (đổi đường dẫn, không đổi điều kiểm) — liệt kê trong PR.
  5. `.github/workflows/next-native-browser.yml:356,434`: `'backend/routers/listening.py'` → `'backend/routers/listening/**'`.
  6. Chú thích có số dòng ở `frontend/tooling/write-flow*.mjs`: đổi tên file, giữ số dòng (file chưa đổi nội dung).
- **Đầu ra:** 1 PR (`high-risk`, `Spec: BACKENDSPLIT-NNNN`).
- **Nghiệm thu:** `git diff -M --stat` cho thấy rename 100%; `cd backend && python -m pytest tests/ -q` qua (đặc biệt `test_no_sync_io_in_async.py`, `test_no_raw_input_echo.py`, `test_exam_only_content.py`); bộ contract frontend + React qua; diff danh sách route (5.2) rỗng; CI `apitype-drift` xanh; `git grep -n "routers/listening.py" -- backend frontend .github` → rỗng (trừ tài liệu lịch sử trong `docs/`).
- **Không làm:** không dời hàm nào.
- **Vướng mắc → cách gỡ:**
  - Python thấy cả `listening.py` lẫn `listening/` → `git mv` đảm bảo chỉ còn một; xoá `__pycache__` cục bộ nếu lỗi import lạ.
  - `workflow-path-coverage.test.mjs` đòi bộ lọc phủ phụ thuộc → glob `backend/routers/listening/**` phủ.
  - Số test phải sửa > 30 → không xảy ra (khoảng 13 file); nếu xảy ra, dừng, báo danh sách.
- **Ước lượng:** 1 phiên · độ khó 3.

### G10-T10 — Dời từng ranh giới của Listening (PR2…PR6)

- **Mục đích:** file `__init__.py` còn dưới 2.000 dòng; mỗi PR một ranh giới.
- **Đầu vào:** 5.2; chú thích `# ── …` trong file; lệnh liệt kê mục tiêu patch: `git grep -hoE "routers\.listening\.[A-Za-z_]+" -- backend/tests | sort -u` và `git grep -hE "setattr\((listening|listening_module|listening_router|mod|router)\b" -- backend/tests`.
- **Việc làm (mỗi PR):**
  1. PR2 (trước tiên): thêm `_SeamModule` vào `__init__.py` với `_SUBMODULES = ()` và một test hành vi `backend/tests/test_listening_package_seams.py` (patch `routers.listening.supabase_admin` rồi gọi một endpoint đã dời → thấy giá trị giả). Dời ranh giới đầu tiên `admin_import.py` (dòng 2471–3830 theo chú thích hiện tại).
  2. PR3: `admin_audit.py`; PR4: `student_fulltest.py`; PR5: `dictation.py`; PR6: `admin_attempts.py` (+ `_common.py` cho helpers/schemas nếu còn cần).
  3. Mỗi PR: dời nguyên khối (cắt-dán, không sửa thân hàm); module con import tên dùng chung từ đúng nơi file gốc import; `__init__.py` `from .<sub> import *` có `__all__` liệt kê mọi tên cũ (kể cả tên bắt đầu `_` mà test dùng — dùng danh sách từ lệnh ở "Đầu vào"); thêm module vào `_SUBMODULES`.
  4. Viết lại khoá allowlist/`test_no_raw_input_echo.py` cho hàm đã dời: đổi `routers/listening/__init__.py::<hàm>` → `routers/listening/<sub>.py::<hàm>`; callee đổi `routers.listening.<x>` → tên đầy đủ mà `sync_io_guard` báo (chạy test, chép khoá từ thông báo lỗi "New sync I/O"/"stale"); tổng số đếm trước = sau.
  5. Test đọc text (`test_exam_only_content.py`…) đọc một chuỗi đã dời sang module con → đổi tham số `_src(...)` sang file con; không đổi chuỗi kiểm.
- **Đầu ra:** 5 PR `high-risk`.
- **Nghiệm thu mỗi PR:** diff danh sách route rỗng (thứ tự route giữ nguyên — vì decorator chạy theo thứ tự import module con, `__init__.py` phải import module con **đúng vị trí** khối mã cũ đứng; nếu không giữ được thứ tự, PR fail); CI `apitype-drift` xanh; `cd backend && python -m pytest tests/ -q` qua; tổng số dòng allowlist không tăng; `wc -l backend/routers/listening/*.py` ghi trong PR.
- **Không làm:** không sửa logic, không đổi tên hàm, không "dọn" import thừa trong cùng PR.
- **Vướng mắc → cách gỡ:**
  - Thứ tự route đổi → FastAPI khớp route theo thứ tự khai báo: `/tests/import` phải đứng trước `/tests/{test_id}`. Cách gỡ: chia `__init__.py` thành phần trên/dưới và đặt `from . import <sub>` đúng chỗ khối cũ; hoặc giữ endpoint có path tham số chung trong cùng module với endpoint path cố định.
  - Vòng import (`admin_import.py` cần hàm của `dictation.py`) → đưa hàm chung vào `_common.py` trước, PR riêng.
  - Test patch tên mà module con dùng qua `from x import name` → `_SeamModule` lan xuống mọi module con có tên đó; kiểm bằng `test_listening_package_seams.py`.
  - `from __future__ import annotations` + Pydantic: model khai báo trong `_common.py` mà route dùng ở module con → import model vào module con, không dùng chuỗi tên.
  - Đang có PR tính năng Listening mở (spec 0005, 0006, 0007, 0009, 0011, 0052, 0054) → không làm PR tách chạm cùng khối; báo người điều phối chọn thời điểm.
- **Ước lượng:** 5 phiên · độ khó 5.

### G10-T11 — Tách `routers/admin.py`

- **Mục đích:** như T09–T10 cho admin.
- **Đầu vào:** `backend/routers/admin.py`, lệnh `git grep -n "^# ──\|^# ===" backend/routers/admin.py`, danh sách 40 module import `routers.admin` (`git grep -l "from routers.admin import" -- backend ':!backend/tests'`).
- **Việc làm:** PR1 rename thành package (như T09: allowlist 105 dòng, khoá raw-input, test đọc text, bộ lọc workflow nếu có); PR2… dời ranh giới theo nhóm chức năng (người thực thi đề xuất ranh giới trong PR spec/plan trước). `require_admin`, `require_instructor`, `_actor_id`, `_require_db_engine` **giữ định nghĩa trong `__init__.py`** (40 module import chúng; patch `routers.admin.require_admin` phải tác dụng).
- **Nghiệm thu:** như T10; thêm `python -c "import routers.admin as a; assert callable(a.require_admin)"`.
- **Vướng mắc → cách gỡ:** endpoint dùng `Depends(require_admin)` (bắt giá trị lúc khai báo) → test của chúng dùng `app.dependency_overrides`, không phụ thuộc seam; không đổi.
- **Ước lượng:** 3 phiên · độ khó 4.

### G10-T12 — Tách `services/quiz_service.py`

- **Mục đích:** như trên cho service lớn nhất.
- **Đầu vào:** `backend/services/quiz_service.py`, `backend/tests/conftest.py:146-152`, `tests/test_quiz_bank_cache.py`.
- **Việc làm:** package `services/quiz_service/` với `_SeamModule`; `_bank_content_cache` định nghĩa **một lần** trong module con và được re-export (cùng đối tượng); `_at`, `get_bank_for_play`, `reap_expired_course_assessments`, `log_progress`, `student_mistakes`, `start_session` giữ truy cập qua `services.quiz_service`.
- **Nghiệm thu:** `python -c "import services.quiz_service as q, services.quiz_service.<sub> as s; assert q._bank_content_cache is s._bank_content_cache"`; `cd backend && python -m pytest tests/ -q -k quiz` rồi bộ đầy đủ qua.
- **Vướng mắc → cách gỡ:** test gán lại (`monkeypatch.setattr(quiz_service, "_bank_content_cache", X)`) → seam lan xuống; test chỉ `.clear()` → cùng đối tượng nên đúng.
- **Ước lượng:** 2 phiên · độ khó 4.

### G10-T13 — Spec ADMINGROUP (mục d) — PR spec, DỪNG chờ duyệt

- **Đầu vào:** mục 4(d), 5.3; `docs/audits/nextjs-optimization-remediation-2026-09-14.md` (NXT-06); `frontend/components/authed-shell.tsx` dòng 1–24.
- **Việc làm:** tạo `specs/NNNN-admin-route-group-consolidation/` (spec, plan, tasks, verification, `ui-states.md`: không đổi trạng thái giao diện, bằng chứng = ảnh mốc). Kịch bản:
  - Given ảnh mốc admin (T04), When chuyển group X vào `(authed-admin)`, Then ảnh 4 dự án không đổi.
  - Given đang ở `/admin/classes`, When bấm sidebar sang `/admin/feedback`, Then giao diện `/admin/feedback` giống tải trực tiếp (ảnh chụp sau điều hướng client = ảnh tải trực tiếp).
  - Ca biên: trang dùng `dataAverAdminSurface`; `aver-admin-chrome.js` tự chèn `admin-surface.css` nếu thiếu; group có 16 sheet; `(authed-admin-writing-grade)`.
  - Câu hỏi mở: Q-d1.
- **Đầu ra:** 1 PR spec. **Dừng.**
- **Ước lượng:** 1 phiên · độ khó 2.

### G10-T14 — Thí điểm `(authed-admin)` với 3 group đơn giản

- **Mục đích:** trả lời hai câu hỏi ở 5.3 bằng bằng chứng.
- **Đầu vào:** `frontend/app/(authed-admin-error-logs)/`, `(authed-admin-feedback)/`, `(authed-admin-foot-traffic)/` (mỗi group 1 trang, 1 sheet trang); `frontend/tests/authed-shell.test.mjs`; `frontend/tooling/route-ownership-check.mjs`; `docs/ROUTE_LEDGER.md`.
- **Việc làm:**
  1. Tạo `frontend/app/(authed-admin)/layout.tsx` (5.3, có `export const instant = false;` như layout cũ).
  2. `git mv` nội dung 3 group vào `(authed-admin)/admin/<đoạn>/`; mỗi đoạn có `layout.tsx` phát `<link precedence>` cho sheet trang.
  3. Ghi lại `<head>` trước/sau: `curl -s http://localhost:<port>/admin/feedback | grep -o '<link rel="stylesheet"[^>]*>'` → dán vào PR.
  4. Chụp ảnh sau điều hướng client (thêm test vào `frontend/tests/visual/admin.spec.js`: vào `/admin/error-logs`, bấm link sang `/admin/feedback`, chụp).
  5. Sửa đường dẫn group trong test/tooling/CI/`docs/ROUTE_LEDGER.md` cho 3 group (dùng `git grep -l "(authed-admin-feedback)\|(authed-admin-error-logs)\|(authed-admin-foot-traffic)" -- frontend .github docs/ROUTE_LEDGER.md`).
  6. Nếu bằng chứng 3 hoặc 4 xấu → dừng, chuyển phương án thay thế ở 5.3, báo.
- **Đầu ra:** 1 PR (`feature`, `Spec: ADMINGROUP-NNNN`).
- **Nghiệm thu:** ảnh mốc 3 trang không đổi; `node frontend/tooling/route-ownership-check.mjs` exit 0; `node --import … --test frontend/tests/authed-shell.test.mjs frontend/tests/route-ledger-matches-app.test.mjs frontend/tests/workflow-path-coverage.test.mjs` qua; bộ contract + React + `tsc` + `npm run build` qua; CI browser regression xanh.
- **Không làm:** không gộp group học viên; không đổi `authed-shell.tsx` (00 §4.11).
- **Vướng mắc → cách gỡ:**
  - Bộ lọc đường dẫn `next-native-browser.yml` ghim `frontend/app/(authed-admin-feedback)/**` → đổi sang đường dẫn mới; nếu quên, `workflow-path-coverage.test.mjs` báo.
  - `route-ledger-matches-app.test.mjs` so `ROUTE_LEDGER.md` với `app/` → sửa ledger cùng PR.
  - Hai layout cùng render `<html>`/`<body>`? Không: `AuthedShell` ở layout group; layout đoạn chỉ trả `<>{link}{children}</>`.
- **Ước lượng:** 2 phiên · độ khó 4.

### G10-T15 — Chuyển các group admin còn lại theo đợt

- **Mục đích:** FR-10d-001 cho 35 group còn lại (trừ writing-grade).
- **Việc làm:** đợt theo nhóm sidebar G09 (grammar ×4, listening, mock ×4, reading ×4, speaking ×3, writing ×10, người dùng/lớp ×5, hệ thống ×5); mỗi PR ≤ 6 group và ≤ 30 file test sửa; như T14 bước 2–5.
- **Nghiệm thu:** như T14 cho từng group.
- **Vướng mắc → cách gỡ:** group nạp sheet của group khác (`(authed-admin-students)` nạp `admin-classes-next.css`) → layout đoạn nạp đủ danh sách như cũ, đúng thứ tự.
- **Ước lượng:** 6 phiên · độ khó 3.

### G10-T16 — Media: bảng kê và kiểm toán tham chiếu (bước 1–2, chỉ đọc)

- **Mục đích:** có số liệu cho spec MEDIAOUT.
- **Đầu vào:** `docs/REPOSITORY_MAINTENANCE.md` mục "Media follow-up"; `backend/services/advanced_vocab_service.py`; `backend/content/advanced_vocab/core30-manifest.json`, `backend/content/advanced_vocab/versions/**`; `backend/services/advanced_vocab_package_validator.py:1925-1940` (giải đường dẫn asset trên đĩa).
- **Việc làm:**
  1. Bước 1: `git ls-files -s frontend/public/assets/advanced-vocab | …` + `shasum -a 256` + kích thước → CSV ở `/tmp` (không commit); tóm tắt (số file, số blob, byte, nhóm trùng) vào thân PR spec.
  2. Bước 2 (chỉ khi Q-e2 cho phép đọc DB): trên **staging** đọc bảng bài giao/snapshot chứa URL `/assets/advanced-vocab` (người thực thi tìm bảng qua `git grep -n "assets/advanced-vocab\|_asset_url" backend`); production chỉ khi anh Andy cho, chỉ `SELECT count`.
  3. **CHƯA KIỂM**: validator ở dòng ~1932 có đòi file media tồn tại trong `frontend/public/assets` không — người thực thi đọc hàm, ghi kết luận.
- **Đầu ra:** không PR mã; báo cáo trong PR spec T17.
- **Ước lượng:** 2 phiên · độ khó 3.

### G10-T17 — Spec MEDIAOUT — PR spec, DỪNG chờ duyệt

- **Việc làm:** `specs/NNNN-advanced-vocab-media-delivery/` (spec, plan, tasks, verification, rollout, ui-states N/A). Phương án trong `plan.md` (anh Andy chọn ở Q-e1): (A) bucket Supabase Storage công khai chép nguyên cây đường dẫn, `next.config.ts` rewrite `/assets/advanced-vocab/:path*` → URL bucket (giữ URL; **CHƯA KIỂM** rewrite ngoài của Vercel có chuyển tiếp header `Range` và trả 206 không — phải thử trên preview); (B) redirect 308 tới URL bucket (trình phát audio theo redirect; CSP đã cho `https:`); (C) giữ trong repo nhưng build-time dedupe. Kịch bản: Given bài giao cũ trỏ `versions/ADV-T07/<sha>/listening/full_test.mp3`, When học viên mở trên staging, Then audio phát và tua được (request `Range` → 206). Ca biên: staging và production là hai project Supabase; checksum bất biến; cache CDN; rollback = bỏ rewrite, khôi phục file bằng `git revert`. Ghi rõ: xoá file khỏi cây **không** làm nhỏ `.git` khi không viết lại lịch sử; lợi ích là mỗi worktree bớt khoảng 374 MiB và lần deploy Vercel nhẹ hơn.
- **Ước lượng:** 1 phiên · độ khó 3.

### G10-T18 — Media: phục vụ từ nơi lưu mới (giữ file trong repo)

- **Việc làm:** theo phương án được duyệt: script tải lên một lần (`backend/scripts/upload_advanced_vocab_media.py`, idempotent, so SHA-256, `--dry-run` mặc định, chạy staging trước, production chỉ khi anh cho); rewrite/redirect trong `frontend/next.config.ts` sau cờ cấu hình `AVER_ADVANCED_VOCAB_MEDIA_ORIGIN` (rỗng = phục vụ từ `public/` như cũ); sửa `generate_advanced_vocab_audio.py`/`sync_advanced_vocab_core30.py` thêm bước tải lên.
- **Nghiệm thu:** trên preview với cờ bật: `curl -sI -H 'Range: bytes=0-99' <preview>/assets/advanced-vocab/<lesson>/listening/full_test.mp3` → 206 (A) hoặc 308 rồi 206 (B); mở một bài Advanced Vocabulary bằng tài khoản thử trên staging, phát và tua audio; tắt cờ → phục vụ lại từ `public/`.
- **Ước lượng:** 3 phiên · độ khó 4.

### G10-T19 — Media: bỏ file khỏi cây

- **Việc làm:** sau ít nhất 14 ngày cờ bật trên production không lỗi (anh Andy xác nhận): `git rm -r frontend/public/assets/advanced-vocab/**/*.mp3` (giữ `.svg/.png` nếu phương án nói giữ), thêm vào `.gitignore`; đổi test `backend/tests/test_advanced_vocab_*` nếu chúng đòi file trên đĩa (chỉ khi T16 bước 3 nói có).
- **Lưu ý ràng buộc:** 00 §4.11 cấm đổi `frontend/public/assets/advanced-vocab/**` — nhiệm vụ này **chỉ làm khi anh Andy duyệt Q-e1 bằng chữ**.
- **Ước lượng:** 1 phiên · độ khó 3.

### G10-T20 — Rà spec `implementing` đợt 1 (15 spec: 0001–0013)

- **Mục đích:** sổ trả lời được "việc gì đang dở và vì sao".
- **Đầu vào:** `specs/IMPLEMENTATION_STATUS.md` (sau G01-T02); `tasks.md`, `verification.md` của 0001, 0002, 0003, 0004, 0005, 0006-admin-mock-test-operations, 0006-listening-guided-feedback, 0007-listening-editorial-revision, 0007-writing-navigation-contract, 0008, 0009, 0010, 0011, 0012, 0013; `gh pr list --state merged --search "<ID>"`.
- **Việc làm:** mỗi spec: đếm task `[x]`/tổng; liệt kê FR còn `PENDING`; tìm PR đã merge liên quan; phân loại theo FR-10f-001; ghi cột "Remaining acceptance / next action" một câu nêu hành động trực tiếp tiếp theo và ai phải làm (người thực thi/anh Andy/giáo viên). Chỉ đổi `status` khi `validate_specs.py` chấp nhận (mọi task `[x]` và mọi FR có `PASS|MANUAL|N/A` với bằng chứng thật).
- **Đầu ra:** 1 PR `small` (`Spec: N/A` — chỉ sổ).
- **Nghiệm thu:** `python backend/scripts/validate_specs.py` qua; mỗi spec đợt 1 có phân loại; danh sách `superseded-proposed` nằm trong thân PR mục "Cần anh Andy quyết".
- **Không làm:** không đánh dấu task `[x]` dựa trên việc mã tồn tại (`IMPLEMENTATION_STATUS.md` GRAMMAR-0001 tự cảnh báo "Do not bulk-check from code presence"); không chạy kiểm trên production.
- **Vướng mắc → cách gỡ:** bằng chứng chỉ có ở staging/production (migration đã áp dụng) → ghi "MANUAL evidence needed: <truy vấn>" chứ không tự chạy production.
- **Ước lượng:** 2 phiên · độ khó 3.

### G10-T21 — Rà spec `implementing` đợt 2 (15 spec: 0015–0037)

- **Đầu vào:** như T20 cho 0015, 0016, 0019, 0020, 0021, 0022-client-write-privilege-lockdown, 0022-revision-explanation-binding, 0024, 0025, 0026, 0029, 0031, 0034, 0035, 0037; và sửa lệch STORAGELIMITS-0038 ở `IMPLEMENTATION_STATUS.md:104`.
- **Việc làm, đầu ra, nghiệm thu:** như T20.
- **Ước lượng:** 2 phiên · độ khó 3.

### G10-T22 — Spec MIGNUM (mục g) — PR spec, DỪNG chờ duyệt

- **Đầu vào:** 5.4; `backend/migrations/register.tsv` và `test_migration_register.py` (G01-T06); `apply_migrations.sh:104`.
- **Việc làm:** `specs/NNNN-migration-number-blocks/` (spec, plan, tasks, verification, rollout, ui-states N/A). Kịch bản:
  - Given G06 có dải 400–419, When phiên làm G09 thêm `405_x.sql`, Then test register thất bại "405 belongs to block G06".
  - Given G07 merge `420_a.sql` trước khi G06 merge `401_b.sql`, When CI dựng DB mới từ đầu (PG17 parity), Then 401 chạy trước 420; `401_b` không được phụ thuộc đối tượng do `420_a` tạo (FR-10g-003); nếu cần, G06 lấy số > 420.
  - Ca biên: số cao nhất ≥ 900; hàng `block` chồng nhau; số giữ chỗ cũ (370–375) nằm ngoài mọi dải mới.
  - Ghi rõ vì sao **không** dùng dấu thời gian hay 4 chữ số: `ls | sort` từ điển ở `apply_migrations.sh:104` và glob `[0-9][0-9][0-9]_*.sql` ở hai test sẽ sắp sai/bỏ sót. Chuyển sang 4 chữ số là spec riêng khi số chạm 900.
- **Ước lượng:** 1 phiên · độ khó 2.

### G10-T23 — Thêm hàng `block` và kiểm dải

- **Việc làm:** thêm hàng `block` theo dải được duyệt vào `register.tsv`; mở rộng `test_migration_register.py` (FR-10g-002, FR-10g-004); thêm 3 câu vào `backend/migrations/README.md` mục "Finding the next number" (lấy số trong dải của gói; phụ thuộc chỉ xuống số nhỏ hơn; ≥ 900 thì báo).
- **Nghiệm thu:** `cd backend && python -m pytest tests/test_migration_register.py -q`; thử âm (hàng `reserved 405 G09-T01` → thất bại); bộ backend đầy đủ qua (test ghim README không vỡ).
- **Không làm:** không sửa file `.sql`, `apply_migrations.sh`, `forward-policy.tsv`. Lớp PR vẫn là `high-risk` vì spec MIGNUM có `risk: high` (validator đòi), dù PR không chạm `*.sql`.
- **Ước lượng:** 1 phiên · độ khó 3.

### Bảng ước lượng tổng

| Nhiệm vụ | PR | Phiên | Độ khó |
| --- | ---: | ---: | ---: |
| T01 spec TESTPOLICY | 1 | 1 | 2 |
| T02 chính sách test | 1 | 1 | 1 |
| T03 ảnh mốc đợt 1 + CI | 1 | 2 | 4 |
| T04 ảnh mốc mở rộng | 1–2 | 2 | 3 |
| T05 spec LEGACYJS | 1 | 1 | 2 |
| T06 bộ thu thập tối thiểu | 1 | 1 | 3 |
| T07 W1–W6 | ~9 | 9 | 3 |
| T08 spec BACKENDSPLIT | 1 | 1 | 2 |
| T09 listening → package | 1 | 1 | 3 |
| T10 dời ranh giới Listening | 5 | 5 | 5 |
| T11 tách admin.py | 3 | 3 | 4 |
| T12 tách quiz_service | 2 | 2 | 4 |
| T13 spec ADMINGROUP | 1 | 1 | 2 |
| T14 thí điểm group admin | 1 | 2 | 4 |
| T15 group admin còn lại | 6 | 6 | 3 |
| T16 kiểm kê media | 0 | 2 | 3 |
| T17 spec MEDIAOUT | 1 | 1 | 3 |
| T18 phục vụ media mới | 1 | 3 | 4 |
| T19 bỏ media khỏi cây | 1 | 1 | 3 |
| T20–T21 rà spec | 2 | 4 | 3 |
| T22 spec MIGNUM | 1 | 1 | 2 |
| T23 dải số migration | 1 | 1 | 3 |
| **Tổng** | **~43** | **~51** | |

## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu nhận biết | Cách gỡ | Khi nào dừng và hỏi |
| --- | --- | --- | --- |
| Test ghim chuỗi/đường dẫn vỡ hàng loạt | > 30 test đỏ sau một thay đổi cấu trúc | Chia PR nhỏ hơn theo nhóm file; sửa đường dẫn trong test, không đổi điều kiểm | > 30 test ngoài dự kiến (00 §7) |
| Validator PR đòi map mọi đường dẫn | `validate_specs.py --github-event` báo đường dẫn không thuộc FR nào | Thêm `implementation=<sha>:<path>` cho FR tương ứng trong thân PR | — |
| Allowlist sync I/O "stale" | `test_no_sync_io_in_async.py` báo khoá không còn | Đổi khoá theo đường dẫn mới, giữ số đếm | Số đếm phải tăng |
| CI path filter bỏ sót sau khi dời | Job "intentionally skipped" khi PR có đổi mã | Sửa bộ lọc trong `next-native-browser.yml`/`backend-tests.yml`; `workflow-path-coverage.test.mjs` bắt | Phải đổi tên job bắt buộc |
| Ảnh chụp không ổn định | Khác ảnh khi chạy lại không đổi gì | Đồng hồ cố định, mask, `document.fonts.ready`, chạy trong container | Không ổn định sau 3 cách |
| hai phiên thực thi cùng sửa `listening.py`/`admin.py` | Xung đột rebase lớn | phiên tính năng (G08/G09) đi trước; PR tách làm lại từ đầu trên base mới (cắt-dán, không merge tay) | Xung đột trong khối đang dời |
| File JS bị nạp theo cách không thấy | Trang lỗi console `Failed to load /js/...` trên preview | Revert PR đợt; thêm file vào danh sách giữ; tìm cách nạp và bổ sung T06 | Luôn báo |

## 8. Ràng buộc riêng của gói

1. Mục (b), (c), (d), (e), (g): không PR mã nào trước khi spec tương ứng được duyệt trên `staging`.
2. Mục (c): PR tách chỉ cắt-dán và đổi đường dẫn; mọi thay đổi logic, đổi tên, dọn import là PR khác.
3. Mục (b): mỗi file xoá có bằng chứng ba lớp (hoặc hai lớp khi chưa có log, ghi rõ); không xoá theo thư mục.
4. Mục (e): không viết lại lịch sử, không LFS, không đổi URL, không xoá thư mục `versions/`; T19 chỉ khi anh Andy duyệt bằng chữ.
5. Không sửa `components/authed-shell.tsx` (cascade) trong gói này.
6. Không sửa file bằng chứng có ngày trong `docs/audits/`.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

- **E2E-1 (a):** Given staging sau T03, When một PR G03 đổi token màu, Then job `visual-baseline` đỏ, artifact có ảnh diff; khi PR cập nhật ảnh mốc có chủ ý, job xanh.
- **E2E-2 (b):** Given W1 đã merge, When đăng nhập tài khoản admin thử trên staging và mở `/admin/listening` cùng các trang con, Then không lỗi console mới; `curl <staging>/js/admin-listening-audit.js` → 404.
- **E2E-3 (c):** Given T10 xong, When chạy `cd backend && python -m pytest tests/ -q` và so danh sách route + `api.d.ts` với SHA trước T09, Then giống hệt; staging làm một bài Listening thử bằng tài khoản thử (không phải production): bắt đầu, nộp, xem kết quả bình thường.
- **E2E-4 (d):** Given T15 xong, When `ls frontend/app | grep authed-admin`, Then chỉ còn `(authed-admin)` và `(authed-admin-writing-grade)`; ảnh mốc admin không đổi.
- **E2E-5 (e):** Given cờ media bật trên staging, When mở bài Advanced Vocabulary cũ và mới, Then audio phát, tua được.
- **E2E-6 (f):** Given T21 xong, When đọc `IMPLEMENTATION_STATUS.md`, Then mỗi spec `implementing` có phân loại và hành động kế tiếp.
- **E2E-7 (g):** Given dải số, When hai phiên thực thi khác gói cùng thêm migration, Then không trùng số và test register xanh.
- **Môi trường:** local, CI, preview Vercel, staging với tài khoản thử. Production: chỉ xem (00 §4.3); không chạy script tải lên, không đọc bảng học viên production khi chưa có cho phép (Q-e2).

## 10. Cần anh Andy quyết

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm |
| --- | --- | --- | --- |
| Q-b1 | Cho gỡ JS cũ `frontend/public/js` theo đợt (thay `deletionAuthorized: false` của Gate F)? Hệ quả: URL `/js/<file>` của file bị gỡ trả 404; test cũ chỉ kiểm file đó được retire theo ADR-005. | Đồng ý, theo đợt W1–W6, mỗi đợt một PR anh duyệt merge | Chỉ làm T05–T06 (spec + bằng chứng), không xoá file |
| Q-b2 | Cho người thực thi đọc log truy cập Vercel (14–30 ngày) cho `/js/*` làm lớp bằng chứng 3? Ai cấp quyền/xuất log? | Anh xuất log một lần hoặc cấp quyền đọc | Chỉ dùng lớp 1–2, ghi "chưa có log" trong PR |
| Q-e1 | Cho đưa media Advanced Vocabulary ra khỏi git (nới 00 §4.11 cho riêng `frontend/public/assets/advanced-vocab/**` khi URL giữ nguyên)? Chọn nơi lưu: (A) Supabase Storage + rewrite, (B) Storage + redirect 308, (C) giữ trong repo, chỉ dedupe lúc build. Một bucket chung hay mỗi môi trường một bucket? | (A) nếu preview chứng minh `Range` → 206, không thì (B); một bucket ở production project, chỉ đọc công khai | Chỉ làm T16 và T17 |
| Q-e2 | Cho người thực thi đọc (chỉ `SELECT`) bảng bài giao/snapshot trên staging; trên production chỉ đếm? | Staging: có; production: anh chạy truy vấn đếm người thực thi soạn sẵn | Chỉ staging |
| Q-1 | Nới quy tắc "Keep historical paths stable" (đã hỏi ở G01 Q1) — áp cho cả việc dời thư mục `frontend/app/(authed-admin-*)` và `backend/routers/listening.py` sang package (đường dẫn file đổi, URL/import không đổi)? | **ĐÃ TRẢ LỜI (00 mục 2 điểm 20)** cho tài liệu; phần áp cho đường dẫn mã giữ mặc định tạm: quy tắc áp cho tài liệu, không áp cho đường dẫn mã khi import/URL giữ nguyên | Làm T09/T14 (không đổi URL/import), ghi trong PR |
| Q-a1 | Job `visual-baseline` advisory hay bắt buộc? | Advisory 4 tuần, sau đó bắt buộc nếu tỉ lệ đỏ giả < 5% | Advisory |
| Q-a2 | Có thêm kiểm tự động chặn test mới đọc mã nguồn không? | Không; dùng ô trong mẫu PR + review | Không |
| Q-c1 | Cơ chế `_SeamModule` (lan monkeypatch xuống module con) có chấp nhận được không, thay vì sửa khoảng 200 test sang đường dẫn module con? | Chấp nhận; ghi trong `__init__.py` và spec | Dùng `_SeamModule` |
| Q-c2 | Thời điểm tách `listening.py` so với các spec Listening đang mở (0005, 0006, 0007, 0009, 0011, 0052, 0054) và G08? | Sau PR Listening đang mở gần nhất merge; trước khi G08 sửa backend Listening | Chờ người điều phối báo "cửa sổ trống" |
| Q-d1 | Gộp 39 group admin thành **1** (cần React `<link precedence>`) hay thành **khoảng 8** theo 8 nhóm sidebar (không đổi cơ chế nạp CSS)? | Quyết sau thí điểm T14; nếu thí điểm sạch → 1 group | Thí điểm T14 rồi dừng hỏi |
| Q-g1 | Dải số migration theo gói như 5.4? | **ĐÃ TRẢ LỜI (00 mục 2 điểm 22):** dải theo bảng 01 mục 6 | Làm T23 |
| Q-f1 | Các spec người thực thi đề xuất `superseded` ở T20–T21 | Anh duyệt từng spec | Giữ `implementing`, ghi đề xuất |
