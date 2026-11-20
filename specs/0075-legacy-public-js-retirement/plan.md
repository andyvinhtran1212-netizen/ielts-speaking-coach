# Implementation plan

## Architecture impact

Chỉ xoá file tĩnh trong `frontend/public/js/` và sửa test/tooling/CI/tài liệu nhắc chúng. Không đổi route Next, component, backend, DB hay biến môi trường. Vercel ngừng phục vụ URL `/js/<file đã xoá>` (404).

Ràng buộc riêng của gói (GOI-10 mục 8): không PR xoá nào trước khi spec này `approved` trên `staging` **và** Q-b1 = đồng ý; mỗi file xoá có bằng chứng ba lớp (hoặc hai lớp, ghi rõ); không xoá theo thư mục; không sửa file bằng chứng có ngày trong `docs/audits/`.

### Số đo ở `119ad352` (đo lại bằng T06 trước mỗi đợt)

`public/js`: 155 file, 152 file `.js`. Lớp 1 thô (tên file xuất hiện trong `frontend/app components lib proxy.ts next.config.ts instrumentation-client.ts`): 44 được nhắc, 108 không (39.373 dòng).

| Đợt | Họ file (trong 108 file không được Next nhắc) | File · dòng | File test/tooling/CI nhắc tên | PR |
| --- | --- | --- | ---: | --- |
| W1 | `admin-listening-*.js` | 15 · 4.688 | 38 | 1; tách nếu > 30 file test phải sửa |
| W2 | `admin-mock-*.js`, `admin-exam-content.js` | 7 · 2.880 | 27 | 1 |
| W3 | `admin-classes.js`, `admin-students-panel.js`, `admin-users.js`, `admin-access-codes.js`, `admin-codes-util.js` | 5 · 5.695 | 39 | W3a/W3b |
| W4 | `admin-*.js` còn lại | 24 · 6.104 | ≤ 56 (160 file nhắc mọi `admin-*.js`, trừ W1–W3) | W4a/W4b |
| W5 | `listening-*.js` (học viên) | 16 · 6.566 | 72 | W5a/W5b/W5c |
| W6 | `reading-*.js`, `components/reading-*.js`, `mock-exam-runner.js`, `exam-player.js`, `full-test.js` | 13 · 6.808 | 68 | W6a/W6b/W6c |
| W7+ | vocab (trừ `vocab-modules/*`), `instructor-*`, `my-class.js`, `user-pill.js`, `rum-vitals.js`, `confirm-danger.js`, `supabase-sdk-fallback.js`, `legacy-retirement-beacon.js`, file chỉ được nhắc trong chú thích; rồi 14 symlink, `loader.mjs`, `tsconfig.legacy.json` | — | 143+ | spec bổ sung riêng |

Cột "file test nhắc tên" đếm bằng `git grep -l -F <basename> -- frontend/tests frontend/tooling backend/tests .github` gộp theo họ. FR-007 đếm file test **phải sửa**, không phải mọi file nhắc tên.

## Data and contracts

### Bộ thu thập bằng chứng (G10-T06)

**Lớp 1 — tham chiếu tĩnh/động.**

1. Khôi phục collector Gate F: `git show ef47b02de^:frontend/tooling/gate-f-asset-inventory.mjs > frontend/tooling/gate-f-asset-inventory.mjs` (188 dòng, import `typescript` từ `frontend/node_modules`, gốc repo = `../..` từ file). Chạy `node frontend/tooling/gate-f-asset-inventory.mjs --summary` trên cây hiện tại; **CHƯA KIỂM** nó còn chạy được trên cây `119ad352` (nó được viết khi còn HTML trong `public`) — nếu lỗi, sửa tối thiểu trong T06 hoặc bỏ, ghi trong PR.
2. Luôn chạy thêm lệnh tên file (FR-005), quét cả mã Next lẫn `public/js`:

```bash
cd frontend
for f in $(git ls-files 'public/js/**/*.js' 'public/js/*.js'); do
  b=$(basename "$f"); rel=${f#public}
  hits=$(git grep -l -F -e "$b" -e "$rel" -- app components lib proxy.ts next.config.ts instrumentation-client.ts public/js ":!$f" | wc -l)
  echo "$hits $f"
done | sort -n
git grep -nE "/js/\\\$\{|'/js/' *\+|\"/js/\" *\+|\`/js/[^\`]*\\\$\{" -- app components lib public/js   # URL dựng động → giữ cả họ
```

**Lớp 2 — request thật trong mọi hành trình.** `frontend/tooling/capture-public-js.mjs` (khoảng 30 dòng, preload ESM): bọc `chromium.launch` để mọi context ghi URL request khớp `/js/` vào `$CAPTURE_OUT`; truyền nguyên tham số của flow (flow tự `chromium.launch({ executablePath })` trên macOS). Chạy từ thư mục `frontend` để preload và flow cùng resolve `frontend/node_modules/playwright`:

```bash
cd frontend
for flow in tooling/verify-*-flow.mjs; do
  NODE_OPTIONS="--import ./tooling/capture-public-js.mjs" CAPTURE_OUT=/tmp/js-req.txt node "$flow" <base>
done
NODE_OPTIONS="--import ./tooling/capture-public-js.mjs" CAPTURE_OUT=/tmp/js-req.txt npx playwright test -c playwright.reading-native.config.js
NODE_OPTIONS="--import ./tooling/capture-public-js.mjs" CAPTURE_OUT=/tmp/js-req.txt npx playwright test -c playwright.speaking-regression.config.js
sort -u /tmp/js-req.txt
```

Build fixture theo `frontend/tooling/README.md` (`AVER_ENVIRONMENT=test VERCEL_ENV=development AVER_API_BASE=http://127.0.0.1:3999 …`). Ở `119ad352` có 120 file `verify-*-flow.mjs`. Bằng chứng tự kiểm: chạy trên `verify-admin-classes-flow.mjs` → file capture chứa `/js/components/aver-admin-chrome.js` (file Next đang nạp).

**Lớp 3 — log truy cập** (chỉ khi Q-b2 = có): file log anh Andy xuất, lọc path `/js/`, đếm hit theo file 14–30 ngày.

Kết quả thô để ở `/tmp` (không commit); PR đợt dán bảng FR-006.

### Mỗi PR đợt (G10-T07-Wn)

1. Chạy lớp 1 + 2 (+3) cho họ file của đợt; loại mọi file có tham chiếu/request.
2. Liệt kê test nhắc từng file: `git grep -l -F -e "public/js/<f>" -e "js/<f>" -e "<basename>" -- frontend/tests frontend/tooling backend/tests .github`. Mỗi test: (i) chỉ kiểm file bị xoá → retire, hàng ledger ghi test Next thay thế đã có (thường `frontend/tests/<tên>-next-behavior.test.mjs` hoặc `tooling/verify-<tên>-flow.mjs`); (ii) kiểm cả thứ khác → chỉ xoá assertion về file bị xoá, hàng ledger; (iii) không có thay thế → giữ file, chuyển đợt sau.
3. `git rm` từng file (không `git rm -r` thư mục). Bộ lọc CI trỏ file đã xoá: xử lý theo `workflow-path-coverage.test.mjs`.
4. W3: sửa chú thích `frontend/tsconfig.legacy.json` (bỏ `admin-access-codes.js`; chỉ còn `api.js` có `// @ts-check`).
5. Ledger: thêm mục "LEGACYJS-0075 Wn — <ngày>" vào `docs/TEST_INVARIANT_LEDGER.md` (tài liệu sống, không phải file bằng chứng có ngày trong `docs/audits/`).

## Rollout and rollback

Xem `rollout.md`. Mỗi đợt một PR; khôi phục = `git revert` một PR.

## Verification strategy

- Mỗi đợt: BỘ KIỂM frontend đầy đủ (00 §5.3: contract `node --test`, React vitest, `tsc`, `npm run build`), backend nếu đợt chạm `backend/tests`; CI `Next-native browser regression` xanh; `node tooling/run-flow-repeat.mjs --flow <flow> --runs 2` cho mọi flow của nhóm trang; `node --import ./tests/fixtures/legacy-html-retired/loader.mjs --test tests/workflow-path-coverage.test.mjs` qua.
- Trên preview Vercel của PR: `curl -s -o /dev/null -w '%{http_code}' <preview>/js/<file>` → 404 cho mỗi file đã xoá; mở 3 trang của nhóm, không lỗi console mới, không request 404 tới `/js/*`.
- Ảnh mốc (TESTPOLICY-0057, nếu đã có cho nhóm trang): không đổi.
- Sau merge: Scenario 1 trên staging (đợt admin) hoặc mở bài thử bằng tài khoản thử (đợt học viên).
