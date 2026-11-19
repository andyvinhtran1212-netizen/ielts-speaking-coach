# Implementation plan

## Architecture impact

Chỉ test và CI frontend: `frontend/playwright.visual.config.js`, `frontend/tests/visual/`, workflow mới `.github/workflows/visual-baseline.yml` (job advisory, tên không trùng job bắt buộc), và hai đoạn chính sách trong `AGENTS.md`, `backend/tests/README.md`, mẫu PR.

Ràng buộc riêng của gói (mục 8):

1. Mục (b), (c), (d), (e), (g): không PR mã nào trước khi spec tương ứng được duyệt trên `staging`.
2. Mục (c): PR tách chỉ cắt-dán và đổi đường dẫn; mọi thay đổi logic, đổi tên, dọn import là PR khác.
3. Mục (b): mỗi file xoá có bằng chứng ba lớp (hoặc hai lớp khi chưa có log, ghi rõ); không xoá theo thư mục.
4. Mục (e): không viết lại lịch sử, không LFS, không đổi URL, không xoá thư mục `versions/`; T19 chỉ khi anh Andy duyệt bằng chữ.
5. Không sửa `components/authed-shell.tsx` (cascade) trong gói này.
6. Không sửa file bằng chứng có ngày trong `docs/audits/`.

## Data and contracts

### 5.1 Ảnh chụp mốc (mục a)

- File: `frontend/playwright.visual.config.js`, `frontend/tests/visual/*.spec.js`, `frontend/tests/visual/fixtures.js` (phiên giả, chặn API), ảnh ở `frontend/tests/visual/__screenshots__/{projectName}/{testFileName}/{arg}.png` (`snapshotPathTemplate`).
- `webServer`: mảng hai server — `node tooling/next-native-fixture-api.mjs` (url `http://127.0.0.1:3999/health`) và `npx next start -p 3213` (url `http://localhost:3213/grammar`), `reuseExistingServer: false`. Build trước bằng lệnh fixture ở mục 2.
- `projects`: `desktop-light` (1280×800), `desktop-dark`, `mobile-light` (390×844), `mobile-dark`; `browserName: 'chromium'`.
- Mỗi test: `page.clock.setFixedTime(new Date('2026-11-16T03:00:00Z'))`; `addInitScript` đặt `av-theme`; chờ `document.fonts.ready`; `expect(page).toHaveScreenshot('<ten>.png', { animations: 'disabled', caret: 'hide', fullPage: false, maxDiffPixelRatio: 0.002, mask: [<vùng thời gian thực, avatar>] })`.
- Danh sách màn đợt 1 (T03): `/grammar` (công khai, server render), `/login`, `/home`, `/admin` (tổng quan), `/admin/listening/tests`, `/practice` (hoặc trang học viên mà fixture có sẵn dữ liệu — người thực thi xem `verify-next-responsive-flow.mjs`). Đợt 2 (T04): mọi màn mà G03/G07/G09 đã liệt kê sẽ đổi; tối thiểu 20 màn.
- Chạy cố định trong container `mcr.microsoft.com/playwright:v1.60.0-noble` (phiên bản phải khớp `package-lock.json`). Lệnh cập nhật cục bộ: `docker run --rm -v "$PWD":/w -w /w/frontend mcr.microsoft.com/playwright:v1.60.0-noble bash -lc "npm ci && <lệnh build fixture> && npx playwright test -c playwright.visual.config.js --update-snapshots"`.
- CI: workflow mới `.github/workflows/visual-baseline.yml`, job `visual-baseline` (tên không trùng job bắt buộc nào), `container: mcr.microsoft.com/playwright:v1.60.0-noble`, trigger `pull_request` theo đường dẫn ở FR-10a-005 + `workflow_dispatch`; `actions/upload-artifact` thư mục `test-results/visual` khi lỗi.

## Rollout and rollback

Job advisory, không bắt buộc (Q-a1); quay lui = xoá workflow hoặc revert PR. Không ảnh hưởng runtime.

## Verification strategy

`npx playwright test -c playwright.visual.config.js` trong container `mcr.microsoft.com/playwright:v1.60.0-noble`; ba lần chạy liên tiếp; PR thử đổi màu để thấy job đỏ.
