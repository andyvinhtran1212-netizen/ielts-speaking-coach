---
id: LEGACYJS-0075
title: Legacy public scripts that no page loads are removed in reviewed batches, each file backed by reference and request evidence, without any page losing a script it needs
status: draft
risk: high
owner: product
---

# Legacy public scripts that no page loads are removed in reviewed batches, each file backed by reference and request evidence, without any page losing a script it needs

Status: **draft** — soạn ngày 20/11/2026 cho nhiệm vụ `G10-T05` (thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-10-repo-pha-2-cau-truc.md` mục 4(b), G10-T05…T07 và `docs/audits/GATE_F_ASSET_AUDIT_2026-09-10.md` mục "Completion audit". Số liệu đo lại trên `staging @ 119ad352` (20/11). Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6. Spec này không có migration.

## Tóm tắt (tiếng Việt)

Người dùng cuối **không thấy gì thay đổi**; nếu một trang mất script nó cần thì đó là lỗi và PR đợt bị revert. `frontend/public/js/` còn 152 file `.js`. Đo bằng tên file ở `119ad352`: 44 file được mã Next (`app`, `components`, `lib`, `proxy.ts`, `next.config.ts`, `instrumentation-client.ts`) nhắc tên, **108 file (39.373 dòng) không**. Vercel vẫn phục vụ công khai cả 152 file ở `/js/*`. Spec này thay quyết định `deletionAuthorized: false` của Gate F bằng quy trình gỡ **theo đợt**: mỗi file gỡ phải có bằng chứng hai hoặc ba lớp, mỗi test chỉ kiểm file đó có kết luận trong `docs/TEST_INVARIANT_LEDGER.md` (ADR-005), mỗi đợt một PR anh duyệt merge, revert một PR là khôi phục.

Đo lại thấy ba điều gói việc ghi chưa đúng hoặc chưa có:

1. Bộ thu thập Gate F **còn khôi phục được**: bị xoá ở commit `ef47b02de` (12/09/2026, "chore: retire migration-only frontend tooling"); bản trước đó (`ef47b02de^:frontend/tooling/gate-f-asset-inventory.mjs`, 188 dòng) dùng `typescript` để phân tích. Gói ghi "CHƯA KIỂM".
2. Đếm bằng tên file **tính cả chú thích**: ví dụ `app/(authed-mock-result)/mock/result/page.tsx:4` chỉ ghi trong chú thích rằng trang "không còn inject `/js/mock-result.js`", nhưng phép đếm vẫn xếp `mock-result.js` vào nhóm "được Next nhắc". Sai theo hướng an toàn (giữ thừa), nên đợt cuối cần lớp 2 để gỡ những file này.
3. Script Next đang nạp có thể tự chèn script khác: `public/js/components/aver-admin-chrome.js:765` và `aver-chrome.js:526` chèn `/js/error-reporter.js` bằng `document.createElement('script')`. Lớp 1 phải quét cả `public/js`, không chỉ mã Next.

Tên file trùng (`format.js`) mà gói lo: ở `119ad352` không còn tên file trùng nào trong `public/js`; quy tắc vẫn giữ để chặn trường hợp sau này.

## Problem

`frontend/public/js/` là phần còn lại của giao diện HTML cũ trước khi chuyển sang Next App Router. 108 file không trang Next nào nhắc tên vẫn nằm trong repo và vẫn được phục vụ. Hậu quả:

- Người thực thi G08/G09 grep một tính năng và gặp bản JS chết trước bản Next (ví dụ `admin-classes.js` khoảng 4.000 dòng, `reading-exam.js`, `listening-test-player.js`, `mock-exam-runner.js` dễ bị nhầm là phòng thi đang chạy) — sửa nhầm chỗ, hoặc tưởng tính năng đã có.
- Khoảng 160 file test/tooling/CI nhắc tên các file `admin-*.js` không được Next nạp; một phần là test đọc mã nguồn chỉ kiểm file chết, giữ chi phí CI mà không bảo vệ hành vi nào.
- Gate F (09/2026) đã kiểm kê nhưng dừng ở NO-GO vì chưa có phạm vi xoá được duyệt và chưa có cách xử lý test cũ (`GATE_F_ASSET_AUDIT_2026-09-10.md` "Completion audit": "Authorized deletion scope — None selected/approved").

Rủi ro ngược lại là thật: một file không ai nhắc tên vẫn có thể đang chạy (`components/vocab-module-mount.tsx:89` dựng `/js/vocab-modules/${moduleName}.js`, nên `vocab-modules/flashcards.js` và `exercises.js` đang chạy dù không ai nhắc tên). Xoá nhầm = trang lỗi `Failed to load /js/…` cho học viên.

## Scope

- Mục (b) của GOI-10: FR dưới đây và nhiệm vụ G10-T06 (bộ thu thập bằng chứng), G10-T07-W1…W6 (mỗi đợt một PR, đợt lớn tách a/b).
- Chỉ file `.js` trong `frontend/public/js/**` thuộc 108 file không được Next nhắc tên (danh sách đo lại trước mỗi đợt).
- Sửa test/tooling/CI nhắc file bị xoá theo ADR-005; sửa chú thích `frontend/tsconfig.legacy.json` khi xoá `admin-access-codes.js` (W3).

## Non-goals

- Không xoá: `practice.js`; 44 file được Next nhắc; họ nạp động `vocab-modules/*`; `legacy-retirement-beacon.js` (133 file nhắc); `runtime-config.js` (dấu phiên bản, header `no-store` ở `next.config.ts:188`); `error-reporter.js` (được `aver-chrome.js`/`aver-admin-chrome.js` chèn) — trước đợt W7+ có spec bổ sung riêng (FR-004).
- Không xoá fixture HTML dưới `frontend/tests/fixtures/legacy-html-retired/**`, 14 symlink trong `frontend/`, `loader.mjs`, `tsconfig.legacy.json` (W7+, spec riêng).
- Không sửa file bằng chứng có ngày trong `docs/audits/` (kể cả `GATE_F_ASSET_INVENTORY_2026-09-10.json`).
- Không xoá theo thư mục; không thêm redirect hay stub cho URL `/js/<file>` đã xoá (404 là kết quả mong muốn).
- Không commit danh sách ứng viên dạng JSON có ngày (AGENTS.md: manifest kiểm toán sinh ra không commit vào tài liệu).

## Users and journeys

- Người thực thi G08/G09: grep một tính năng chỉ còn thấy bản Next.
- Người review: mở một PR đợt, thấy bảng bằng chứng từng file và kết luận ledger cho từng test.
- Học viên, giáo viên, admin: không thấy khác biệt; mọi trang vẫn tải không lỗi console mới.

## Requirements

Đánh số theo gói (FR-10b-NNN → FR-NNN); FR-005…FR-007 thêm khi đo lại ở `119ad352`.

- **FR-001:** Mỗi đợt có danh sách ứng viên kèm bằng chứng ba lớp: (1) không có tham chiếu tĩnh hay động từ mã Next **và** từ file khác trong `public/js` còn giữ; (2) không có request tới file đó trong toàn bộ hành trình `frontend/tooling/verify-*-flow.mjs` cộng các bộ Playwright; (3) nếu anh Andy cấp (Q-b2), không có hit trong log truy cập 14–30 ngày. Thiếu lớp 3 thì PR ghi rõ "chưa có log".
- **FR-002:** Mỗi test chỉ kiểm mã của file bị xoá có một kết luận trong `docs/TEST_INVARIANT_LEDGER.md` (port / thay thế / retire kèm test thay thế hiện có) trong cùng PR (ADR-005). Test kiểm cả file bị xoá lẫn thứ khác chỉ mất phần assertion về file bị xoá. Không có test thay thế → file đó không xoá trong đợt này.
- **FR-003:** Sau mỗi đợt: mọi bộ test và job CI bắt buộc xanh; mọi `verify-*-flow.mjs` của nhóm trang liên quan chạy qua (`node tooling/run-flow-repeat.mjs --flow <flow> --runs 2`); `/js/<file đã xoá>` trả 404 trên preview; mọi trang của nhóm tải không lỗi console mới và không request 404 nào tới `/js/*`.
- **FR-004:** Không xoá các file ở mục Non-goals trước đợt W7+ có spec bổ sung.
- **FR-005:** Lớp 1 coi một file là "được tham chiếu" khi tên file hoặc đường dẫn `/js/…` của nó xuất hiện ở bất kỳ đâu trong mã Next **hoặc** trong file `public/js` còn giữ, kể cả chú thích (sai về phía giữ). Mọi họ file có URL dựng động (template literal hoặc nối chuỗi có `/js/`) bị giữ nguyên cả họ.
- **FR-006:** Mỗi PR đợt có bảng: file · số dòng · kết quả lớp 1 · lớp 2 · lớp 3 · test nhắc file · kết luận ledger. Kết quả lớp 2 thô (danh sách URL bắt được) để ngoài repo, chỉ dán tóm tắt.
- **FR-007:** Mỗi PR đợt sửa tối đa 30 file test; vượt thì tách PR (W1/W2 một PR; W3, W4, W5, W6 tách a/b theo số đo ở `plan.md`).

## Acceptance scenarios

### Scenario 1 — đợt W1 trên staging (gói E2E-2)

- **Given** đợt W1 (`admin-listening-*.js`, 15 file) đã merge vào `staging`
- **When** đăng nhập tài khoản admin thử trên staging và mở `/admin/listening` cùng mọi trang con
- **Then** không lỗi console mới, không request 404 tới `/js/*`; `curl -s -o /dev/null -w '%{http_code}' https://staging.averlearning.com/js/admin-listening-audit.js` → `404` (FR-003)

### Scenario 2 — file nạp bằng URL dựng động

- **Given** `vocab-module-mount.tsx:89` dựng `/js/vocab-modules/${moduleName}.js`
- **When** bộ thu thập lớp 1 chạy
- **Then** cả họ `vocab-modules/*` (kể cả `_source-link.js` không ai nhắc tên) bị loại khỏi mọi đợt (FR-005)

### Scenario 3 — script đang chạy chèn script khác

- **Given** `components/aver-admin-chrome.js` (Next nạp) chèn `/js/error-reporter.js` bằng `createElement('script')`
- **When** lớp 1 quét `public/js` còn giữ
- **Then** `error-reporter.js` bị giữ dù không file Next nào nhắc nó; nếu một ứng viên A (sắp xoá) là file duy nhất nhắc B, B chỉ thành ứng viên ở lần đo sau khi A đã xoá (FR-005)

### Scenario 4 — tên chỉ còn trong chú thích

- **Given** `mock-result.js` chỉ được nhắc trong chú thích của `app/(authed-mock-result)/mock/result/page.tsx`
- **When** lớp 1 chạy
- **Then** file bị xếp "được tham chiếu" và không vào đợt W1–W6; nó chỉ được xem xét ở W7+ với bằng chứng lớp 2 (không request) và người review xác nhận tham chiếu chỉ là chú thích (FR-005)

### Scenario 5 — test đọc file qua symlink

- **Given** một test `readFileSync('js/admin-listening-audit.js')` qua symlink `frontend/js → public/js`
- **When** người thực thi liệt kê test nhắc file
- **Then** lệnh `git grep` tìm cả `js/<f>` lẫn `public/js/<f>`; test đó có kết luận ledger trong PR (FR-002)

### Scenario 6 — không có test thay thế

- **Given** test T chỉ kiểm một hành vi của file ứng viên F mà chưa có test Next nào kiểm hành vi đó
- **When** soạn PR đợt
- **Then** F không bị xoá trong đợt này, PR ghi "F giữ lại: thiếu test thay thế cho <hành vi>" và chuyển F sang đợt sau (FR-002)

### Scenario 7 — revert một đợt

- **Given** sau khi W2 merge, staging có trang lỗi `Failed to load /js/admin-mock-…js`
- **When** người thực thi revert PR W2
- **Then** file trở lại, trang tải lại bình thường trên staging sau deploy; file gây lỗi vào danh sách giữ, cách nạp mới tìm được bổ sung vào bộ thu thập (FR-001, FR-005)

## Edge cases

- **Script nạp script khác bằng đường dẫn tương đối** (`import('./…')`): ở `119ad352` có 4 chỗ `createElement('script')`/`import('./…')` trong `public/js` (3 file: `components/aver-admin-chrome.js`, `components/aver-chrome.js`, `supabase-sdk-fallback.js`); lớp 1 quét cả chúng.
- **Fixture HTML** trong `frontend/tests/fixtures/**` nạp file ứng viên: giữ fixture (ADR-005); test dùng fixture đó cần kết luận ledger như mọi test khác; nếu fixture không còn chạy được khi thiếu file thì file không xoá.
- **`legacy-freeze.yml`** lọc `frontend/public/**` và cấm symlink/HTML trong `public`: xoá JS không vi phạm.
- **Bộ lọc đường dẫn CI** (`next-native-browser.yml`) trỏ file đã xoá: để nguyên hoặc xoá theo cách `workflow-path-coverage.test.mjs` chấp nhận (chạy test để biết).
- **Cache trình duyệt / CDN:** `/js/*` có `Cache-Control: public, max-age=0, must-revalidate` (`next.config.ts:177-178`), nên không trình duyệt nào giữ bản cũ mà không hỏi lại; không cần chờ hết hạn cache.
- **Trang HTML cũ người dùng đã lưu/đánh dấu:** không còn HTML nào trong `public` (đã chuyển hết sang Next, có redirect 308 từ Gate F), nên không trang cũ nào nạp `/js/*` từ trình duyệt người dùng; lớp 3 (log) là cách duy nhất phát hiện client lạ (ví dụ bản app/WebView cũ).
- **`tsconfig.legacy.json`** `include: public/js/**/*.js`: xoá file không làm hỏng `tsc -p tsconfig.legacy.json`; chú thích nhắc `admin-access-codes.js` phải sửa ở W3.
- **Hai đợt mở song song chạm cùng file test:** chỉ một PR đợt mở tại một thời điểm.

## Success criteria

- Sau W1–W6: số file `.js` trong `public/js` không được Next nhắc giảm từ 108 xuống chỉ còn nhóm W7+ và nhóm bị giữ có lý do ghi trong PR.
- Không lỗi `Failed to load /js/…` nào trên staging hoặc production trong 14 ngày sau mỗi đợt; không đợt nào phải revert vì thiếu script (nếu có, đã revert trong 1 giờ).
- Mỗi test đã sửa/retire có một hàng ledger; không test nào bị skip/xfail.

## Related specifications

- TESTPOLICY-0057 (draft): ảnh chụp mốc (G10-T03/T04) là bằng chứng phụ "giao diện không đổi" của FR-003; khi 0057 chưa có ảnh mốc cho nhóm trang của đợt, PR đợt ghi "chưa có ảnh mốc" và dựa vào flow + console.
- ADMINIA-0074 / G09 và G08: hưởng lợi trực tiếp (W1–W4 admin; W5–W6 học viên Listening/Reading/Mock).
- `docs/adr/ADR-005-test-retirement.md`, `docs/TEST_INVARIANT_LEDGER.md` (545 dòng): quy tắc retire test.

## Open questions

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm |
| --- | --- | --- | --- |
| Q-b1 | Cho gỡ JS cũ `frontend/public/js` theo đợt (thay `deletionAuthorized: false` của Gate F)? Hệ quả: URL `/js/<file>` của file bị gỡ trả 404; test cũ chỉ kiểm file đó được retire theo ADR-005. | Đồng ý, theo đợt W1–W6, mỗi đợt một PR anh duyệt merge | Chỉ làm T06 (bộ thu thập + bằng chứng), không xoá file |
| Q-b2 | Cho người thực thi đọc log truy cập Vercel (14–30 ngày) cho `/js/*` làm lớp bằng chứng 3? Ai cấp quyền/xuất log? | Anh xuất log một lần cho production (Vercel → Logs, lọc path bắt đầu `/js/`) và đặt file vào thư mục dự án; người thực thi chỉ đọc | Chỉ dùng lớp 1–2, ghi "chưa có log" trong PR |
