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

## Batch behavior thứ mười ba: `/reading/test`

Batch `codex/nextjs-reading-test` chuyển thư viện L3 Full Tests từ module
legacy khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount state theo
  `user.id`;
- giữ nguyên GET `/api/reading/test`, filter module, giới hạn 50 và bắt buộc
  `test_type=full` để mini test không lọt sang tab này;
- giữ nguyên fallback 3 parts / 40 câu / 60 phút, band, catalog code và origin
  stamp `from=full` khi mở exam;
- request bị abort khi đổi filter/account hoặc unmount; response cũ không được
  ghi đè state mới;
- payload lỗi hình dạng được chuẩn hóa và nội dung authored do React escape;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **8/29 route**.

## Batch behavior thứ mười bốn: `/reading/mini-test`

Batch `codex/nextjs-reading-mini-test` chuyển thư viện L3 Mini Tests từ module
legacy khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount state theo
  `user.id`;
- giữ nguyên GET `/api/reading/test`, filter module, giới hạn 50 và bắt buộc
  `test_type=mini` để full test không lọt sang tab này;
- giữ default Mini Test là 1 passage; số câu và thời lượng không có dữ liệu thì
  hiện `—` thay vì mượn cấu trúc 3 parts / 40 câu / 60 phút của Full Test;
  giữ band, catalog code và origin stamp `from=mini` khi mở exam;
- request bị abort khi đổi filter/account hoặc unmount; response cũ không được
  ghi đè state mới;
- payload lỗi hình dạng được chuẩn hóa và nội dung authored do React escape;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **7/29 route**.

## Batch behavior thứ mười lăm: `/listening/tests`

Batch `codex/nextjs-listening-tests` chuyển thư viện Listening Full Tests từ
module legacy khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount state theo
  `user.id`;
- giữ nguyên GET phân trang `/api/listening/tests`, giới hạn 100, guard 20 trang
  và bắt buộc `test_type=full` để mini/drill/practice không lọt vào thư viện;
- giữ nguyên điểm tốt nhất, số lần làm, CTA bắt đầu/làm lại, tối đa ba theme,
  player origin `from=full` và lối vào chép chính tả;
- chỉ attempt đã `submitted` mới gắn nhãn `Đã làm`; attempt dang dở vẫn được
  tính vào số lượt hoạt động nhưng còn nằm đúng trong bộ lọc `Chưa làm`;
- request bị abort khi đổi account hoặc unmount; response cũ không được ghi đè
  state mới;
- payload lỗi hình dạng được chuẩn hóa, nội dung authored do React escape và
  overflow phân trang vẫn là lỗi hiển thị thay vì âm thầm cắt dữ liệu;
- browser-flow 12 chốt kiểm summary, filter, submitted contract, CTA, escaping
  và thông báo lỗi chung trên production build;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **6/29 route**.

## Batch behavior thứ mười sáu: `/listening/mini-test`

Batch `codex/nextjs-listening-mini-test` chuyển thư viện Listening Mini Tests
từ module legacy khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount state theo
  `user.id`;
- giữ nguyên GET phân trang `/api/listening/tests`, giới hạn 100, guard 20 trang
  và bắt buộc `test_type=mini` để full/drill/practice không lọt vào thư viện;
- giữ nguyên điểm tốt nhất, số lần làm, CTA bắt đầu/làm lại, tối đa ba theme,
  player origin `from=mini` và lối vào chép chính tả;
- không bịa mẫu số `/40` cho mini test có số câu biến đổi; chỉ attempt đã
  `submitted` mới được tính `Đã luyện`, còn tổng attempt vẫn hiển thị như số
  lượt hoạt động;
- request bị abort khi đổi account hoặc unmount; response cũ không được ghi đè
  state mới;
- payload lỗi hình dạng được chuẩn hóa, nội dung authored do React escape và
  overflow phân trang vẫn là lỗi hiển thị thay vì âm thầm cắt dữ liệu;
- browser-flow kiểm ba số summary, filter submitted, fallback title, score,
  escaping và hai đích CTA trên production build;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **5/29 route**.

## Batch behavior thứ mười bảy: `/listening/skills`

Batch `codex/nextjs-listening-skills` chuyển thư viện Listening Skill Drills từ
module legacy khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount state theo
  `user.id`;
- giữ nguyên GET phân trang `/api/listening/tests`, giới hạn 100, guard 20 trang
  và bắt buộc `test_type=drill`;
- giữ đủ 11 nhóm kỹ năng, thứ tự ladder L1→L4 rồi T1→T4, fallback tiêu đề,
  nav theo dạng, bộ lọc trạng thái, thống kê, CTA player và lối vào chép chính tả;
- chỉ attempt đã `submitted` mới được tính `Đã luyện`; attempt dang dở vẫn nằm
  trong `Chưa làm`, đồng thời summary vẫn đếm đúng tổng bài và số dạng có bài;
- icon được nhúng SVG tĩnh thay vì để Lucide đổi loại node trong cây React,
  loại bỏ hydration race đã có regression gate riêng;
- request bị abort khi đổi account hoặc unmount; payload lỗi hình dạng được
  chuẩn hóa, nội dung authored do React escape và overflow không bị cắt im lặng;
- browser-flow kiểm summary, nav 11 dạng, ladder L/T, filter submitted, CTA,
  escaping và thông báo lỗi chung trên production build;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **4/29 route**.

## Batch behavior thứ mười tám: `/listening/practice`

Batch `codex/nextjs-listening-practice` chuyển thư viện Listening Luyện nhanh
từ module legacy khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount overview/cache
  theo `user.id`;
- overview canonical quyết định tab trap/section/curated nào thực sự xuất hiện;
  thứ tự sư phạm, count và hash tab hiện hành được giữ nguyên;
- từng tab gọi GET phân trang `/api/listening/tests?test_type=practice`, khóa
  `practice_group`, cache riêng, giới hạn 100 và guard 20 trang;
- tab trap vẫn nhóm theo tên bẫy, sort theo số bài giảm dần rồi tên; hai tab
  còn lại giữ danh sách phẳng;
- chỉ attempt đã `submitted` mới đổi CTA sang `Làm lại`; attempt dang dở vẫn
  hiển thị số lượt đã mở nhưng không bị báo sai là hoàn thành;
- request overview/tab bị abort khi đổi account/tab hoặc unmount; payload lỗi
  hình dạng được chuẩn hóa, authored content do React escape và overflow không
  bị cắt im lặng;
- browser-flow kiểm hash selection, tab count, cache, trap grouping, submitted
  completion, escaping, CTA và lỗi chung trên production build;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **3/29 route**.

## Batch behavior thứ mười chín: `/listening`

Batch `codex/nextjs-listening` chuyển Listening hub từ module legacy khởi động
theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount overview theo
  `user.id`;
- count đề thi/content vẫn tuân thủ hợp đồng strict-number; exercise mode giữ
  coercion và đúng thứ tự nhãn đã công bố;
- thư viện chỉ xuất hiện khi vừa có content vừa có mode thực sự chạy được, nên
  không tái tạo các link trần dẫn tới bài cần `content_id`;
- khi overview lỗi, bốn danh sách đề được mở không kèm count, thư viện chưa xác
  minh vẫn ẩn và cảnh báo chung hiện rõ mà không lộ chi tiết backend;
- trạng thái đang tải và rỗng có thông báo accessible riêng; browser-flow khóa
  count-driven cards, mode allowlist, dead-end guard, CTA và fallback lỗi;
- request overview bị abort khi đổi account hoặc unmount; nội dung do React
  render và icon SVG tĩnh không còn hydration race;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **2/29 route**.

## Batch behavior thứ hai mươi: `/listening/browse`

Batch `codex/nextjs-listening-browse` chuyển Kho bài nghe từ module legacy
khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount filter/result
  theo `user.id`;
- ba filter accent/CEFR/section vẫn gọi endpoint canonical, tải đủ các trang với
  limit 100 và guard 20 trang thay vì cắt im lặng;
- card chỉ mở bốn mode backend báo trong `available_modes`, đúng thứ tự cũ và
  luôn encode `content_id`;
- chỉ mảng `available_modes` mới là canonical; null, thiếu hoặc sai kiểu đều
  hiện lookup warning, khác với mảng rỗng là thật sự không có mode;
- request bị abort khi đổi filter/account hoặc unmount; authored content do
  React escape, lỗi backend dùng copy chung và không còn `innerHTML`;
- browser-flow kiểm ba filter, metadata, mode order/link, lookup-failure truth,
  empty/error states và paging contract trên production build;
- route không còn phụ thuộc hard navigation.

Sau batch stacked: hard-navigation debt còn **1/29 route**.

## Batch behavior thứ hai mươi mốt: `/listening/analytics`

Batch `codex/nextjs-listening-analytics` chuyển Thống kê Listening từ module
legacy khởi động theo `DOMContentLoaded` sang behavior React:

- route dùng `AuthProvider`, fail-closed khi hết phiên và remount range/result
  theo `user.id`;
- ba range 7d/30d/all vẫn gọi endpoint canonical; request bị abort khi đổi
  range/account hoặc unmount;
- đủ bốn test type mini/drill/full/practice; điểm tổng weight theo
  `scored_count`, completion theo `attempts_count`, không dùng count bài đã đụng
  làm sai mẫu số;
- weakest mode chỉ hiển thị khi backend trả về key đã biết, giữ nguyên quy tắc
  tối thiểu ba bài nộp ở nguồn canonical;
- summary, bảng mode, chart 14 ngày và recent activity giữ đủ trạng thái; authored
  title do React escape, bỏ `innerHTML`;
- đổi range ẩn đồng bộ số liệu cũ trước khi fetch, request lỗi dùng copy chung
  không lộ chi tiết backend; browser-flow khóa range, mẫu số tổng hợp, chart,
  recent activity, empty/error và escaping trên production build;
- route cuối cùng được gỡ khỏi hard-navigation gate.

Sau batch stacked: hard-navigation debt còn **0/29 route**.

## Gate D hardening sau batch behavior

Branch `codex/nextjs-gate-d-hardening` chuyển hai tín hiệu type contract thành
job fail-closed trong workflow:

- TypeScript chạy cả Next strict config và legacy `@ts-check` sau `npm ci`;
- OpenAPI types được regenerate bằng `openapi-typescript@7.13.0` từ dependency
  tree khóa trong `package-lock.json`, phía sinh schema khóa `pydantic==2.12.5`,
  rồi chạy `git diff --exit-code`; không còn `continue-on-error` hay nhánh
  `|| echo` nuốt lỗi.

Kiểm tra bằng GitHub API ngày 2026-08-10 trả `Branch not protected` cho `main`.
Vì vậy hai check đã fail-closed trong workflow nhưng **chưa** là required checks;
đây vẫn là cấu hình ngoài repo cần đóng trước khi Gate D có thể PASS.

### Shared primitive inventory

| Primitive | Bằng chứng reuse đã sống | Vai trò ổn định |
|---|---|---|
| `AuthedShell` | 15 route-group layout thuộc Home, Speaking, Writing, Reading, Listening, Vocabulary, Quiz và Mock | Cố định auth provider, cascade CSS, runtime config, telemetry và chrome bootstrap |
| `AuthProvider` / `useAuth` | 25 App Router behavior/layout consumers trên nhiều domain | Một state machine phiên; fail-close và account-keyed remount thống nhất |
| `whenGlobalReady` | 25 App Router consumers trên Home, Speaking, Writing, Reading, Listening, Vocabulary và Grammar | Chờ browser globals có timeout/telemetry thay cho polling hoặc `DOMContentLoaded` race |
| `VocabModuleMount` | 3 consumer behavior ở Vocabulary Hub, Flashcards và Exercises | Adapter mount/unmount lifecycle cho domain module được giữ lại |

Inventory này vượt ngưỡng ba implementation và có regression contracts tương
ứng (`authed-shell`, auth lifecycle, global readiness, vocab module lifecycle).

## Bằng chứng local

| Gate | Kết quả |
|---|---|
| Focused route/contract tests | batch 1: 84/84; batch 2: 69/69; batch 3: 9/9; batch 4: 135/135; batch 5: 21/21; batch 6: 91/91; batch 7: 264/264; batch 8: 28/28; batch 9: 102/102; batch 10: 132/132; batch 11: 123/123; batch 12: 143/143; batch 13: 131/131; batch 14: 138/138; batch 15: 25/25 pass + browser-flow 12/12; batch 16: 40/40 pass + browser-flow 12/12; batch 17: 28/28 pass + browser-flow 15/15; batch 18: 49/49 pass + browser-flow 15/15; batch 19: 48/48 pass + browser-flow 14/14; batch 20: 47/47 pass + browser-flow 14/14; batch 21: 12/12 pass + browser-flow 14/14 |
| Gate D workflow contracts | 16/16 pass |
| Backend result contract | 22/22 pass; analytics focused 7/7 pass |
| Full frontend contract suite | 7.232/7.232 pass |
| TypeScript strict + legacy JSDoc | pass trong trạng thái tương đương checkout sạch |
| OpenAPI regeneration | `openapi-typescript@7.13.0` ổn định với backend hiện tại |
| Next production build | pass; cả hai mươi mốt behavior route static prerender |
| Compiled route ownership | 32 routes; zero drift/collision |
| Browser floor scan | 38 chunks + 140 static scripts + 230 inline scripts; Safari/iOS 15 clean |

Authenticated parity trên Preview vẫn phải chạy qua pair đã đăng ký trong
`frontend/tooling/parity-pairs-authed.json`; local không thay thế được secret và
môi trường Preview của gate đó.

## Điều kiện Gate D còn mở

- [ ] Bật branch protection của `main` và require hai check
      `TypeScript strict + legacy JSDoc` và `api.d.ts ↔ OpenAPI drift`.
      GitHub API hiện xác nhận branch chưa được protect; workflow trong repo đã
      fail-closed nhưng chưa có waiver thay thế.
- [x] Chốt inventory shared primitives đã sống qua ít nhất ba implementation.
- [ ] Có authenticated Preview parity cho batch behavior này ở desktop + mobile.
- [ ] Có post-deploy runtime observation theo implementation tag.
- [x] Hard-navigation debt = 0/29; không tăng compatibility shell nếu chưa có
      lý do/expiry rõ ràng.

Gate D chỉ được đổi sang **PASS** khi toàn bộ mục trên có bằng chứng kiểm tra được.
