# Tasks

Mỗi task một PR vào `staging`, nhánh `codex/<task>`, lớp `feature`, `Spec: TESTPOLICY-0057`, sau khi spec `approved`. G10-T01 là chính PR spec này.

- [ ] T002 (G10-T02) Viết chính sách test vào hướng dẫn. `depends: spec approved`
- [ ] T003 (G10-T03) Dựng bộ ảnh chụp mốc đợt 1 và job CI. `depends: G10-T02`
- [ ] T004 (G10-T04) Mở rộng ảnh mốc cho màn G03/G07/G09 sẽ đổi. `depends: G10-T03`

Chi tiết (gói mục 6, chép nguyên):

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
