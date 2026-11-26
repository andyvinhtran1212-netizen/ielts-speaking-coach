# Tasks

PR đợt dùng lớp `high-risk` (spec `risk: high`: xoá file đang được phục vụ công khai `/js/*`), `Spec: LEGACYJS-0075`, chỉ sau khi spec `approved`. T001 (bộ thu thập) không xoá gì nên làm được ngay sau khi spec duyệt dù Q-b1 chưa trả lời. G10-T05 là chính PR spec này. Chỉ một PR đợt mở tại một thời điểm.

- [ ] T001 (G10-T06) Khôi phục collector Gate F **và test của nó** từ `ef47b02de^` (`frontend/tooling/gate-f-asset-inventory.mjs`, `frontend/tests/gate-f-asset-inventory.test.mjs` 130 dòng; hoặc ghi vì sao bỏ) và thêm `frontend/tooling/capture-public-js.mjs`; tự kiểm trên `verify-admin-classes-flow.mjs`. Không xoá file nào. `depends: spec approved`
- [ ] T002 (G10-T07-W1) `admin-listening-*.js`. `depends: T001, Q-b1 = đồng ý`
- [ ] T003 (G10-T07-W2) `admin-mock-*.js`, `admin-exam-content.js`. `depends: T002`
- [ ] T004 (G10-T07-W3a/b) `admin-classes.js`, `admin-students-panel.js`, `admin-users.js`, `admin-access-codes.js`, `admin-codes-util.js`; sửa chú thích `tsconfig.legacy.json`. `depends: T003`
  - 23/11 (G10-T07-W3, R129): tách theo họ trang. **W3a** = `admin-users.js`, `admin-access-codes.js`, `admin-codes-util.js` + chú thích `tsconfig.legacy.json` (16 file test). **W3b** = `admin-classes.js`, `admin-students-panel.js` (xếp chồng trên W3a). Các test nhắc cả hai họ (`admin-confirm-danger`, `admin-toast`, `admin-progressive-loading-toggle`, `sprint-17-5-reassignment`, `sprint-18-1-ia`, `sprint-18-3-components`, `admin-students-redesign`) chỉ bỏ assertion của họ đang xoá ở mỗi PR. W3a → PR #2629; W3b → PR xếp chồng trên #2629 (27 file test, gap ghi trong ledger).
- [ ] T005 (G10-T07-W4a/b) `admin-*.js` còn lại. `depends: T004`
  - 23/11 (G10-T07-W4, R156): 24 file còn lại tách thành **3** PR (không phải 2) để mỗi PR ≤ 30 file test. **W4a** = `admin-overview.js`, `admin-dashboard.js`, `admin-feedback.js`, `admin-alerts.js`, `admin-ai-usage.js`, `admin-usage.js`, `admin-usage-util.js`, `admin-foot-traffic.js`, `admin-instructors.js`, `admin-embed.js` (18 file test). **W4b** = `admin-error-logs.js`, `admin-grammar-{analytics,articles,recommend}.js`, `admin-speaking-{sessions,topics}.js`, `admin-vocab-{d1,exercises,lemmas,stats}.js`, `admin-writing-queue.js`. **W4c** = `admin-reading.js`, `admin-reading-preview.js`, `admin-reading-attempts.js` (ba file tham chiếu lẫn nhau). Mỗi PR xếp chồng trên PR trước; W4a xếp trên #2646.
  - 23/11: W4b xong (PR xếp chồng trên #2657). **W4c tạm dừng**: anh Andy ra lệnh 23/11 20:31 VN dừng mở việc mới để ưu tiên merge.
- [ ] T006 (G10-T07-W5a/b/c) `listening-*.js` học viên. `depends: T005; nên trước khi G08 sửa phòng thi Listening`
- [ ] T007 (G10-T07-W6a/b/c) `reading-*.js`, `components/reading-*.js`, `mock-exam-runner.js`, `exam-player.js`, `full-test.js`. `depends: T006`

Mỗi task: đo lại bằng T001 trên base mới nhất; bảng bằng chứng FR-006 trong thân PR; hàng ledger cho mỗi test sửa/retire; nghiệm thu theo `plan.md` "Verification strategy". W7+ không thuộc spec này.
