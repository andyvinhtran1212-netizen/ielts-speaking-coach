# Implementation plan

## Architecture impact

Chỉ cấu trúc thư mục `frontend/app/` phía admin, các `layout.tsx` của group admin và đường dẫn group trong test/tooling/CI/`docs/ROUTE_LEDGER.md`. Không đổi URL, component trang, `components/authed-shell.tsx`, CSS, backend hay dữ liệu.

Ràng buộc riêng của gói (GOI-10 mục 8): không PR mã nào trước khi spec này `approved` trên `staging`; không sửa `authed-shell.tsx`.

### Cấu trúc đích

```
frontend/app/(authed-admin)/layout.tsx                 # AuthedShell chrome="admin", bodyClass="av-page av-admin-surface",
                                                       # utilityLayer={false}, tailwindLayer={false}, pageStylesheets = 4 sheet nền
                                                       # export const instant = false;
frontend/app/(authed-admin)/(feedback)/layout.tsx      # chỉ: <><link rel="stylesheet" href="/css/admin-feedback-next.css" />{children}</>
                                                       # export const instant = false;
frontend/app/(authed-admin)/(feedback)/admin/feedback/page.tsx   # git mv từ (authed-admin-feedback)/admin/feedback/page.tsx
frontend/app/(authed-admin-writing-grade)/…            # giữ nguyên (FR-003)
frontend/app/(authed-admin-reading-preview)/…          # giữ nguyên (FR-003)
frontend/app/(authed-admin-writing-tips)/…             # giữ nguyên (FR-003)
```

Quy tắc chuyển một group `(authed-admin-<x>)`:

1. `git mv "frontend/app/(authed-admin-<x>)" "frontend/app/(authed-admin)/(<x>)"` — cả cây con (`admin/**`, component cùng thư mục) đi theo; URL không đổi vì group không thêm đoạn URL.
2. Thay `layout.tsx` của group con: bỏ `AuthedShell` và 4 sheet nền; giữ **đúng thứ tự** các sheet trang còn lại thành `<link rel="stylesheet" href=… />` thường; giữ `export const instant = false;`.
3. Sửa mọi đường dẫn `(authed-admin-<x>)` trong `frontend/tests`, `frontend/tests/react`, `frontend/tooling`, `.github/workflows/next-native-browser.yml`, `docs/ROUTE_LEDGER.md` thành `(authed-admin)/(<x>)` (`git grep -l "(authed-admin-<x>)" -- frontend .github docs/ROUTE_LEDGER.md`).

Không đặt layout ở `(authed-admin)/admin/…` (FR-004): `/admin` (overview) chứa mọi URL admin, và bốn tiền tố `/admin/writing`, `/admin/grammar`, `/admin/reading`, `/admin/speaking` thuộc nhiều group khác nhau.

### Vì sao `<link>` thường, không `precedence` (Q-d1)

| | `<link>` thường ở layout group con (mặc định đề nghị) | `<link precedence>` (gói 5.3) |
| --- | --- | --- |
| Vị trí | trong `<body>`, sau 4 sheet nền do `AuthedShell` phát (admin tắt Tailwind, không có sheet nào chen giữa) — cùng thứ tự tương đối như hôm nay | React treo lên `<head>`, theo nhóm `precedence`; vị trí so với 4 sheet nền (trong `<body>`) phải đo |
| Rời trang (client) | gỡ khi group con unmount | theo tài liệu React 19, không gỡ → rò sang trang sau |
| Server render | có trong HTML | có trong HTML |
| Cơ chế mới | không | có (chú thích `authed-shell.tsx:17-19` đã từ chối vì đổi cascade) |

Thí điểm T14 đo cả hai cho 3 group và dán bằng chứng; chỉ khi `<link>` thường thất bại mới cân nhắc `precedence` hoặc phương án ~8 group.

### Đo ở `119ad352`

| Thứ | Số |
| --- | ---: |
| Group `(authed-admin-*)` | 39 |
| `page.tsx` trong đó | 75 |
| Group giữ riêng (FR-003) | 3 |
| Group sẽ chuyển | 36 |
| Group 1 trang, 1 sheet trang (thí điểm được) | `error-logs`, `feedback`, `foot-traffic`, `instructors`, `mfa`, `usage`, `users`, … (25 group có đúng 5 sheet = 4 nền + 1 trang) |
| Group nhiều sheet nhất | `listening` (15 trang, 15 sheet trang) |
| File test nhắc `(authed-admin-` | 109 trong `frontend/tests` (26 trong `react/`) |
| `next-native-browser.yml` / `docs/ROUTE_LEDGER.md` | 47 / 75 lần |

### Đợt T15 (theo nhóm sidebar của ADMINIA-0074; ≤ 6 group, ≤ 30 file test mỗi PR)

| Đợt | Group |
| --- | --- |
| T15-1 hệ thống | `system`, `error-logs`*, `foot-traffic`*, `usage`, `mfa`, `overview` |
| T15-2 người dùng/lớp | `users`, `students`, `classes`, `instructors` |
| T15-3 grammar + vocab | `grammar`, `grammar-analytics`, `grammar-articles`, `grammar-recommend`, `vocab` |
| T15-4 listening + speaking | `listening`, `speaking`, `speaking-sessions`, `speaking-topics` |
| T15-5 reading + mock | `reading`, `reading-attempts`, `reading-content`, `mock-exams`, `mock-live`, `mock-reviews` |
| T15-6 mock-tests + writing a | `mock-tests`, `writing`, `writing-assignments`, `writing-cohorts`, `writing-instructor-queue` |
| T15-7 writing b | `writing-new`, `writing-prompts`, `writing-queue`, `writing-regrade`, `writing-status` |

\* đã làm ở thí điểm T14 cùng `feedback`. Đợt nào vượt 30 file test thì tách.

## Data and contracts

Không đổi API hay dữ liệu. Hợp đồng giữ: URL (`route-ownership-check.mjs`, `route-ledger-matches-app.test.mjs`), danh sách `<link rel="stylesheet">` của HTML mỗi trang (Scenario 5), ảnh chụp mốc (TESTPOLICY-0057), `authed-shell.test.mjs` (markup `AuthedShell` không đổi vì không sửa file).

Lệnh so `<link>` cho mọi trang của group trong PR (chạy trên SHA trước và SHA PR với server fixture theo `frontend/tooling/README.md`):

```bash
for p in /admin/feedback /admin/error-logs /admin/foot-traffic; do
  echo "== $p"; curl -s "http://localhost:3000$p" | grep -o '<link rel="stylesheet"[^>]*>'
done > /tmp/links-$(git rev-parse --short HEAD).txt
diff /tmp/links-<sha-trước>.txt /tmp/links-<sha-PR>.txt   # phải rỗng
```

Trang có tham số động (`/admin/classes/[cohortId]`…) dùng id fixture có sẵn trong `next-native-fixture-api.mjs`.

## Rollout and rollback

Xem `rollout.md`. Mỗi PR một đợt; revert một PR trả group về thư mục cũ.

## Verification strategy

- Mỗi PR: lệnh so `<link>` rỗng; `node frontend/tooling/route-ownership-check.mjs` exit 0; `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/authed-shell.test.mjs frontend/tests/route-ledger-matches-app.test.mjs frontend/tests/workflow-path-coverage.test.mjs` qua; bộ contract + React + `tsc` + `npm run build` qua; CI `Next-native browser regression` xanh.
- Ảnh mốc: trang của group trong PR không đổi (4 dự án); thí điểm thêm cảnh điều hướng client (`/admin/error-logs` → bấm link sang `/admin/feedback` → chụp) và cảnh rời trang nhiều sheet (Scenario 3) vào `frontend/tests/visual/admin.spec.js`.
- Kiểm DOM sau điều hướng client: `page.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')))` bằng tải trực tiếp (Scenario 2, 3).
- Sau merge: admin thử trên staging mở mỗi trang của đợt và chuyển trang bằng sidebar.
