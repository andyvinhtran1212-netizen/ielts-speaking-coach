# Gate D retrospective — 2026-08-08

**Trạng thái:** CHƯA ĐÓNG. Đây là sổ bằng chứng hồi tố sau quyết định owner
"GO TOÀN BỘ" ở Gate C, không phải tuyên bố Gate D đã pass.

## Vì sao có tài liệu này

Gate C ban đầu chỉ khuyến nghị tối đa 10 route. Chương trình sau đó mở rộng lên
29 production App Router routes trước khi Gate D được đóng chính thức. Vì vậy,
từ batch này tiến độ phải tách thành ba lớp:

1. **Route ownership:** URL production do App Router sở hữu.
2. **Behavior migration:** hành vi chạy bằng React lifecycle, không inject module
   legacy và không cần hard navigation.
3. **Legacy retirement:** HTML/JS cũ được gỡ sau parity/rollback window.

Một route chỉ đạt lớp 1 không được báo cáo là hoàn tất migration kiến trúc.

## Baseline tại SHA gốc `c3f09cf8`

- 29 production App Router routes (không tính `/next-probe`, `/recorder-spike`).
- 21/29 route nằm trong hard-navigation gate vì còn chạy module legacy.
- Typecheck và API drift workflow vẫn non-blocking.
- Legacy HTML vẫn được giữ cho parity/rollback; Phase 7 chưa bắt đầu.

## Batch behavior đầu tiên: `/quiz/progress`

Batch `codex/nextjs-behavior-batch` chuyển `/quiz/progress` từ compatibility shell
sang Client Component React thực sự:

- không còn inject `/js/quiz-progress.js` hoặc watchdog;
- auth đi qua `AuthProvider`;
- `/api/quiz/progress` và `/api/quiz/mistakes` giữ nguyên contract;
- request abort khi unmount, logout hoặc đổi tài khoản;
- state được khóa theo `user.id + skill_area`, không ló dữ liệu tài khoản trước;
- nội dung câu hỏi được React escape; URL bài ôn chỉ nhận đường dẫn nội bộ hoặc
  `http(s)`;
- lỗi đọc mistakes không xóa phần progress đã tải;
- các entry point trỏ tới canonical `/quiz/progress`;
- route được gỡ khỏi hard-navigation gate.

Sau batch: hard-navigation debt còn **20/29 route**.

## Batch behavior thứ hai: `/speaking/result`

Batch stacked `codex/nextjs-speaking-result` chuyển trang nhận xét Speaking sang
Client Component React và giữ nguyên endpoint kết quả đã có:

- backend tiếp tục là nguồn chân lý cho ownership và trạng thái `released`;
- request được khóa theo `user.id + sitting`, abort khi unmount/đổi tài khoản;
- authored feedback được React escape, không dùng `innerHTML`;
- entry point từ phiếu TRF trỏ tới canonical `/speaking/result`;
- legacy HTML/JS chỉ còn phục vụ parity/rollback.

Sau batch stacked: hard-navigation debt còn **19/29 route**.

## Batch behavior thứ ba: `/grammar/exercises`

Batch stacked `codex/nextjs-grammar-exercises` chuyển launcher Grammar công khai
sang Client Component React:

- giữ nguyên contract read-only `/api/grammar/exercises`;
- request abort khi unmount và lỗi global/API được hiển thị;
- bank title/code được React escape, không dùng `innerHTML`;
- hai entry point Grammar trỏ tới canonical `/grammar/exercises`;
- legacy HTML/JS chỉ còn phục vụ parity/rollback.

Sau batch stacked: hard-navigation debt còn **18/29 route**.

## Batch behavior thứ tư: `/vocabulary/practice`

Batch `codex/nextjs-vocabulary-practice` chuyển bộ chọn bài Vocabulary sang
Client Component React:

- giữ nguyên contract có auth `/api/quiz/banks?skill_area=vocab`;
- request được khóa theo `user.id`, abort khi unmount hoặc đổi tài khoản;
- bank title/code được React escape, không dùng `innerHTML`;
- Hub, Quiz và Progress quay về canonical `/vocabulary/practice`;
- legacy HTML/JS chỉ còn phục vụ parity/rollback.

Sau batch: hard-navigation debt còn **17/29 route**.

## Batch behavior thứ năm: `/full-test`

Batch `codex/nextjs-full-test` chuyển launcher kỳ thi thử sang Client Component
React, không thay đổi player hay state machine của bài thi:

- giữ nguyên contract có auth `/api/mock-exams`;
- backend tiếp tục quyết định kỳ thi được mở, quyền theo lớp và một sitting sống;
- request khóa theo `user.id`, abort khi unmount hoặc đổi tài khoản;
- exam title/code được React escape, không dùng `innerHTML`;
- Home legacy + Next cùng trỏ tới canonical `/full-test`;
- legacy HTML/JS chỉ còn phục vụ parity/rollback.

Sau batch stacked: hard-navigation debt còn **16/29 route**.

## Bằng chứng local

| Gate | Kết quả |
|---|---|
| Focused route/contract tests | batch 1: 84/84; batch 2: 69/69; batch 3: 9/9; batch 4: 135/135; batch 5: 21/21 pass |
| Backend result contract | 22/22 pass |
| Full frontend contract suite | 7.003/7.003 pass |
| TypeScript strict check | pass |
| Next production build | pass; cả năm behavior route static prerender |
| Compiled route ownership | 31 routes; zero drift/collision |
| Browser floor scan | 23 chunks + 140 static scripts + 230 inline scripts; Safari/iOS 15 clean |

Authenticated parity trên Preview vẫn phải chạy qua pair đã đăng ký trong
`frontend/tooling/parity-pairs-authed.json`; local không thay thế được secret và
môi trường Preview của gate đó.

## Điều kiện Gate D còn mở

- [ ] Chuyển TypeScript/OpenAPI drift thành required blocking checks hoặc ghi
      waiver có owner và ngày hết hạn.
- [ ] Chốt inventory shared primitives đã sống qua ít nhất ba implementation.
- [ ] Có authenticated Preview parity cho batch behavior này ở desktop + mobile.
- [ ] Có post-deploy runtime observation theo implementation tag.
- [ ] Tiếp tục giảm hard-navigation debt theo từng domain; không tăng thêm
      compatibility shell nếu chưa có lý do/expiry rõ ràng.

Gate D chỉ được đổi sang **PASS** khi toàn bộ mục trên có bằng chứng kiểm tra được.
