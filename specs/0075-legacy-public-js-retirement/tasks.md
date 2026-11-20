# Tasks

PR đợt dùng lớp `high-risk` (spec `risk: high`: xoá file đang được phục vụ công khai `/js/*`), `Spec: LEGACYJS-0075`, chỉ sau khi spec `approved`. T001 (bộ thu thập) không xoá gì nên làm được ngay sau khi spec duyệt dù Q-b1 chưa trả lời. G10-T05 là chính PR spec này. Chỉ một PR đợt mở tại một thời điểm.

- [ ] T001 (G10-T06) Khôi phục collector Gate F từ `ef47b02de^` (hoặc ghi vì sao bỏ) và thêm `frontend/tooling/capture-public-js.mjs`; tự kiểm trên `verify-admin-classes-flow.mjs`. Không xoá file nào. `depends: spec approved`
- [ ] T002 (G10-T07-W1) `admin-listening-*.js`. `depends: T001, Q-b1 = đồng ý`
- [ ] T003 (G10-T07-W2) `admin-mock-*.js`, `admin-exam-content.js`. `depends: T002`
- [ ] T004 (G10-T07-W3a/b) `admin-classes.js`, `admin-students-panel.js`, `admin-users.js`, `admin-access-codes.js`, `admin-codes-util.js`; sửa chú thích `tsconfig.legacy.json`. `depends: T003`
- [ ] T005 (G10-T07-W4a/b) `admin-*.js` còn lại. `depends: T004`
- [ ] T006 (G10-T07-W5a/b/c) `listening-*.js` học viên. `depends: T005; nên trước khi G08 sửa phòng thi Listening`
- [ ] T007 (G10-T07-W6a/b/c) `reading-*.js`, `components/reading-*.js`, `mock-exam-runner.js`, `exam-player.js`, `full-test.js`. `depends: T006`

Mỗi task: đo lại bằng T001 trên base mới nhất; bảng bằng chứng FR-006 trong thân PR; hàng ledger cho mỗi test sửa/retire; nghiệm thu theo `plan.md` "Verification strategy". W7+ không thuộc spec này.
