# Tasks

Mỗi task một PR vào `staging`, nhánh `codex/<task>`, lớp `feature`, `Spec: BRANDMARK-0083`, sau khi spec `approved`.
G11-T05 là chính PR spec này. Số task = số nhiệm vụ trong gói.

- [ ] T30 (G11-T30) Logo, favicon, icon ứng dụng, manifest. `depends: spec approved; xem bảng gói mục 6`
- [ ] T31 (G11-T31) Ảnh OG theo route và PNG social. `depends: spec approved; xem bảng gói mục 6`

Bảng phụ thuộc của cả gói và chi tiết từng nhiệm vụ (gói mục 6, chép nguyên):

| Mã | Tên | Phần | Phụ thuộc | Phiên | Độ khó |
|---|---|---|---|---|---|
| G11-T30 | Logo, favicon, icon ứng dụng, manifest | G1 | T05 | 1 | 3 |
| G11-T31 | Ảnh OG theo route + PNG social | G1 | T30 | 1 | 3 |

### G11-T30 — Logo, favicon, icon ứng dụng, manifest
- Mục đích: 5.7.1; FR-110, 111.
- Đầu vào: tờ `NhanDienLogo` (mục 2 Hướng 1, mục 3), `frontend/tests/brand-favicon.test.mjs`, `frontend/app/manifest.ts`, `layout.tsx`, `aver-chrome.js` (~438), `aver-admin-chrome.js` (697–698).
- Việc làm: như 5.7.1, theo thứ tự: hình gốc → script sinh → file sinh → component → manifest/layout → sửa test → khung mới → khung cũ (nếu tới lượt theo 01 mục 3, không thì PR sau).
- Đầu ra: 1 PR.
- Nghiệm thu: `node frontend/tooling/build-brand-assets.mjs --check` thoát 0; bộ test hợp đồng frontend pass (gồm `brand-favicon.test.mjs` đã sửa, `next-metadata.test.mjs`); `curl -s http://localhost:3100/manifest.webmanifest` (sau `npm run build && npx next start -p 3100`) có 4 icon; ảnh favicon 16/32 đính PR.
- Không làm: không xoá tài liệu cũ trong `docs/brand/` (giữ làm lưu trữ).
- Vướng mắc → cách gỡ: test ghim chuỗi `icons: { icon: '/favicon.svg' }` vỡ → sửa đúng dòng đó, ghi lý do; thiếu thư viện sinh PNG → dừng phần PNG, giữ SVG, hỏi (mục 10 câu 19).
- Ước lượng: 1 phiên · 3.

### G11-T31 — Ảnh OG theo route và PNG social
- Mục đích: 5.7.2; FR-112.
- Đầu vào: tờ `NhanDienSocial` mục 1–3; `layout.tsx` dòng 19–55; `frontend/tests/next-metadata.test.mjs`; route thật của G05, G06.
- Việc làm: `opengraph-image.tsx` cho trang chủ và các segment đã tồn tại lúc làm (segment chưa có → để lại danh sách cho G05/G06); font nhúng; `--social` xuất PNG.
- Đầu ra: 1 PR.
- Nghiệm thu: `npm run build` pass; `curl -sI http://localhost:3100/opengraph-image` → `200 image/png`; HTML trang chủ có `og:image` tuyệt đối `https://averlearning.com/...`; test metadata pass.
- Không làm: không đổi `og:title/description`.
- Vướng mắc → cách gỡ: `ImageResponse` không có font tiếng Việt → nạp file TTF Source Serif 4/Source Sans 3 trong repo (subset đủ dấu); thêm `opengraph-image` vào segment làm segment mất `openGraph` kế thừa (bẫy merge nông) → kiểm `og:title` từng trang mẫu.
- Ước lượng: 1 phiên · 3.
