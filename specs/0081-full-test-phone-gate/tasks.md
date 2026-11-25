# Tasks

Mỗi task một PR vào `staging`, nhánh `claude/<thread>-<mã việc>` (nhóm Codex đã dừng 19/11), lớp `feature`, `Spec: PHONEGATE-0081`, sau khi spec `approved`.
G11-T03 là chính PR spec này. Số task = số nhiệm vụ trong gói.

- [ ] T19 (G11-T19) Thư viện cổng, màn chặn và `/tests`. `depends: spec approved; xem bảng gói mục 6`
- [ ] T20 (G11-T20) Nối cổng vào các phòng thi. `depends: spec approved; xem bảng gói mục 6`

Bảng phụ thuộc của cả gói và chi tiết từng nhiệm vụ (gói mục 6, chép nguyên):

| Mã | Tên | Phần | Phụ thuộc | Phiên | Độ khó |
|---|---|---|---|---|---|
| G11-T19 | Thư viện cổng + màn chặn (có dòng phụ tiếng Việt) + `/tests` | D | T03 | 1 | 3 |
| G11-T20 | Nối cổng vào các phòng thi cũ và `ExamRoom` | D | T19 | 1 | 3 |

### G11-T19 — Thư viện cổng, màn chặn và `/tests`
- Mục đích: 5.4 (module, hook, component); FR-050, 054.
- Đầu vào: tờ `ThanhPhanKhungTrang` mục 6, `ThiThu` ghi chú cuối; `frontend/public/js/runtime-config.js`.
- Việc làm: `full-test-device-gate.mjs` + test node `frontend/tests/full-test-device-gate.test.mjs` (767 → blocked, 768 → allowed, cấu hình 800 → 799 blocked, cấu hình hỏng → 768); hook; `full-test-phone-block.tsx` (có dòng phụ tiếng Việt `lang="vi"`, prop `viNote`), `full-test-narrow-notice.tsx`; thêm khoá `fullTestMinViewportPx` vào runtime config; nối vào trang `/tests` (nếu G07 đã có) hoặc trang danh sách thi thử hiện có (`(authed-full-test)` / `(authed-mock-exam)` — ghi rõ trong PR).
- Đầu ra: 1 PR.
- Nghiệm thu: test node + React pass; bước bấm: Chrome DevTools 390×844 mở trang danh sách thi thử → không có nút vào full test, thấy dòng Cảnh báo, nút vào mini test vẫn có; 820×1180 → có nút.
- Không làm: không đổi backend.
- Vướng mắc → cách gỡ: SSR không biết độ rộng → hook trả `measuring`, nút vào thi chỉ render sau đo (tránh nhấp nháy bằng chỗ giữ cùng kích thước); trình duyệt phóng to (zoom) làm `innerWidth` nhỏ hơn 768 trên máy tính → đúng là bị chặn (thước là CSS px), ghi vào trợ giúp.
- Ước lượng: 1 phiên · 3.

### G11-T20 — Nối cổng vào các phòng thi
- Mục đích: FR-050…053, 055 cho mọi lối vào ở 5.4.
- Đầu vào: các file trang ở 5.4; `GOI-08` mục 2 và 5.1 (`ExamRoom`).
- Việc làm: với mỗi lối vào: đặt `ExamEntryGate` bọc trước mọi effect tạo lượt; kiểm và ghi bảng trong PR: file · endpoint tạo lượt · tạo khi mở trang hay khi bấm · đã gate trước chưa; thêm `narrowDuringAttempt` → dải nhắc; journey trình duyệt hiện có cho từng trình chạy lại (`frontend/tooling/verify-*-flow.mjs` liên quan, theo bảng G08 mục 9).
- Đầu ra: 1 PR.
- Nghiệm thu: test React mỗi lối vào: độ rộng 390 → không có lời gọi `fetch` tới endpoint tạo lượt (mock fetch đếm 0); 1024 → có; mini test ở 390 → vào được (có lời gọi tạo lượt); lượt đang chạy rồi đổi 1024 → 390 → không điều hướng, không gọi submit, dải nhắc hiện.
- Không làm: không gate mini test, chế độ luyện, bài giao luyện, bài kiểm tra của khoá.
- Vướng mắc → cách gỡ: trình tạo lượt ngay trong render đầu (không phải effect) → tách lời gọi vào effect sau gate, kèm test cũ của trình phải xanh; endpoint tạo lượt không idempotent → ghi `CHƯA AN TOÀN`, báo người điều phối, không sửa backend ở PR này.
- Ước lượng: 1 phiên · 3.
