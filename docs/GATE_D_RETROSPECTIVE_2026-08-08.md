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

## Batch behavior thứ sáu: `/mock/result`

Batch `codex/nextjs-mock-result` chuyển phiếu kết quả TRF sang Client Component
React, giữ endpoint và nguồn thật phía server:

- `sitting` + `user.id` tạo request key; đổi tài khoản/query hoặc rời trang sẽ abort;
- 403 từ endpoint released-result vẫn là trạng thái “chờ giám khảo”, không bị đọc thành lỗi;
- backend tiếp tục khóa ownership/release và cấp final bands, gap states, retest flags;
- partial retake chỉ hiện kỹ năng thật sự đã chấm; mọi gap Listening/Reading/Writing vẫn nói đúng lý do;
- nội dung giám khảo được React escape; không dùng `innerHTML`;
- Home, runner và các trang review đều quay về canonical `/mock/result`.

Sau batch stacked: hard-navigation debt còn **15/29 route**.

## Batch behavior thứ bảy: `/vocabulary/hub`

Batch `codex/nextjs-vocabulary-hub` thay compatibility shell của hub học viên
bằng Client Component React:

- bỏ `dangerouslySetInnerHTML`, bootstrap `vocab-landing.js` và watchdog legacy;
- thống kê + feature flags đọc song song, khóa theo `user.id` và abort khi
  unmount hoặc đổi tài khoản;
- feature card tiếp tục default-deny khi `/auth/me` lỗi hoặc flag không bật;
- hash navigation/back-forward giữ ba mode `vocab-topics`, `flashcards`,
  `exercises` và an toàn khi điều hướng mềm;
- topic metadata được React escape; slug/topic id được URL-encode;
- Flashcards/Exercises dùng API `mount()` sẵn có nhưng được React quản lý vòng
  đời, cleanup khi unmount/account switch;
- mọi entry point của hub trỏ tới canonical `/vocabulary/hub`.

Sau batch stacked: hard-navigation debt còn **14/29 route**.

## Batch behavior thứ tám: `/vocabulary/exam`

Batch `codex/nextjs-vocabulary-exam` chuyển launcher danh sách AWL/TOEIC/THPT
sang Client Component React:

- bỏ script tự khởi động `/js/vocab-exam.js` khỏi route Next;
- giữ nguyên endpoint public, read-only `/api/vocabulary/exam`;
- request abort khi unmount; loading, empty và transport error là ba trạng thái
  riêng;
- family/list rỗng tiếp tục bị loại; slug được URL-encode;
- title/description do nội dung cung cấp được React escape;
- legacy HTML/JS chỉ còn phục vụ parity/rollback.

Sau batch stacked: hard-navigation debt còn **13/29 route**.

## Batch behavior thứ chín: `/flashcards`

Batch `codex/nextjs-flashcards` thay script nội tuyến + interval của route
Flashcards bằng orchestration React có lifecycle:

- route dùng `AuthProvider`, fail-closed khi hết phiên và khóa mount theo
  `user.id`;
- adapter dùng chung chờ `window.api` + Supabase, gọi đúng hợp đồng
  `mount()/unmount()` của module domain;
- cleanup gỡ listener/timer và abort toàn bộ fetch còn chạy, không để response
  của account/route cũ tiếp tục đổi DOM hoặc redirect;
- legacy HTML và module domain vẫn là mốc parity/rollback; không viết lại logic
  stack, preview, tạo/xóa stack;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **12/29 route**.

## Batch behavior thứ mười: `/exercises`

Batch `codex/nextjs-exercises` thay script nội tuyến + interval của route
Exercises bằng orchestration React có lifecycle:

- route dùng `AuthProvider`, fail-closed khi hết phiên và khóa mount theo
  `user.id`;
- adapter dùng chung chờ `window.api` + Supabase, gọi đúng hợp đồng
  `mount()/unmount()` của module domain;
- module abort request `/auth/me`, bỏ mọi response cũ sau unmount và gỡ listener
  back-button đã đăng ký;
- default-deny cho D1/Flashcards và các destination hiện hữu được giữ nguyên;
- authenticated parity pair được bật lại với baseline 4 dòng cho trạng thái
  feature-disabled hợp lệ, chạy ở cả desktop và mobile;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **11/29 route**.

## Batch behavior thứ mười một: `/reading/vocab`

Batch `codex/nextjs-reading-vocab` chuyển thư viện L1 Reading từ module legacy
khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount state theo
  `user.id`;
- giữ nguyên GET `/api/reading/vocab`, hai bộ lọc, giới hạn 50 và destination
  passage hiện hữu;
- request bị abort khi đổi filter/account hoặc unmount; response cũ không được
  ghi đè state mới;
- payload lỗi hình dạng được chuẩn hóa, nội dung authored do React escape;
- loading, empty, error và populated là bốn trạng thái riêng;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **10/29 route**.

## Batch behavior thứ mười hai: `/reading/skill`

Batch `codex/nextjs-reading-skill` chuyển thư viện L2 Reading từ module legacy
khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount state theo
  `user.id`;
- giữ nguyên GET `/api/reading/skill`, filter difficulty/skill, giới hạn 50,
  toàn bộ enum kỹ năng và destination exercise hiện hữu;
- request bị abort khi đổi filter/account hoặc unmount; response cũ không được
  ghi đè state mới;
- payload lỗi hình dạng được chuẩn hóa, label kỹ năng fallback về giá trị
  backend và nội dung authored do React escape;
- thứ tự pill skill → difficulty → topic → minutes được giữ nguyên;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **9/29 route**.

## Bằng chứng local

| Gate | Kết quả |
|---|---|
| Focused route/contract tests | batch 1: 84/84; batch 2: 69/69; batch 3: 9/9; batch 4: 135/135; batch 5: 21/21; batch 6: 91/91; batch 7: 264/264; batch 8: 28/28; batch 9: 102/102; batch 10: 132/132; batch 11: 123/123; batch 12: 143/143 pass |
| Backend result contract | 22/22 pass |
| Full frontend contract suite | 7.078 pass; 0 skip; 0 fail |
| TypeScript strict check | pass |
| Next production build | pass; cả mười hai behavior route static prerender |
| Compiled route ownership | 31 routes; zero drift/collision |
| Browser floor scan | 29 chunks + 140 static scripts + 230 inline scripts; Safari/iOS 15 clean |

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
