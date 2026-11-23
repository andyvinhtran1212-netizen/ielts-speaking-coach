---
id: LEARNERNAV-0062
title: Signed-in learners find every page under the same five sections, and 17 old learner URLs move to their new home while every bookmark and shared link still opens the right page
status: draft
risk: high
owner: product
---

# Signed-in learners find every page under the same five sections, and 17 old learner URLs move to their new home while every bookmark and shared link still opens the right page

Status: **draft** — soạn ngày 23/11/2026 cho nhiệm vụ `G07-T01` (thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-07-loi-hoc-vien.md` mục 4.1–4.2, 5.1, 5.2, 7, 8, 9 và mục 10 câu 1–4. Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi nguyên văn kèm thời điểm vào `approval-decision.md` cùng thư mục và `status` đổi sang `approved`. Số spec 0062 lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6. Spec này không có migration.

`risk: high` vì đợt 7b dời phòng thi thử đang chạy (`/mock-exam`), luồng kết thúc bài thi thuộc nhóm high-risk của `specs/README.md`. Các đợt khác là mức feature nhưng nằm chung spec để một sổ đường dẫn có một chủ.

## Tóm tắt (tiếng Việt)

**Người dùng thấy gì.**
- Mọi trang học viên đã đăng nhập (trừ trang tập trung như phòng thi, trình ghi âm) có đúng 5 mục: Hôm nay · Lộ trình · Luyện tập · Thi thử · Thư viện, cùng menu tài khoản. Mỗi trang sáng đúng một mục là mục cha của nó; không còn trang nào "mượn" Hôm nay.
- Trang cấp hai có breadcrumb trên máy tính và một dòng "‹ <trang cha>" trên điện thoại, trang cha lấy từ danh mục trang, không từ lịch sử trình duyệt.
- 17 đường dẫn học viên đổi chỗ để nằm dưới đúng mục (ví dụ `/my-class` → `/course/assigned`, `/full-test` → `/tests`, `/flashcards` → `/vocabulary/flashcards`). Link cũ, bookmark, link chia sẻ và URL HTML cũ `/pages/*.html` vẫn mở đúng trang mới trong **một** bước chuyển hướng, giữ nguyên query.
- Phòng thi đổi URL vẫn toàn tiếng Anh; người đang thi lúc triển khai không mất bài.

**Đã có ở staging `31725a9b` (G03, không làm lại).** Khung `LearnerShell` (UIBASE-0056 T14, #2445) đã vẽ 5 mục, menu tài khoản, thanh dưới, breadcrumb từ `frontend/components/ui/shell/learner-sections.ts` và danh mục trang `frontend/lib/route-registry.mjs`; `/library` đã chạy (#2447); mục nav trỏ trang chưa có dùng trang tạm qua `NAV_PLAN` + `liveHref` (#2452, có guard test). Spec này cấp **dữ liệu** (mục, trang cha, loại trang của từng trang G07 chạm), **dời đường dẫn**, và một ngoại lệ có chủ đích ở khung: lối "Sang Giáo viên" trong menu tài khoản của `LearnerShell` (FR-003, task T03s), vì G03 chỉ có lối sang Quản trị và #2459 (Q71) chỉ sửa thanh cũ `aver-chrome.js`.

**Chia đợt.** 9 đợt, mỗi đợt một PR, thứ tự từ ít rủi ro tới nhiều rủi ro (plan.md). Đợt 9 (Quick Check) chờ anh trả lời câu hỏi mở 2.

**Ngôn ngữ.** Phần thân viết tiếng Việt theo gói; tiêu đề mục giữ tiếng Anh để `validate_specs.py` đọc được. Mã yêu cầu đánh lại từ `FR-07-NNN` sang `FR-NNN`, giữ số; yêu cầu thêm từ hợp đồng 5.1 và ràng buộc mục 8 nhận số mới sau số cuối (FR-015…FR-018).

## Quyết định đã có

- **`/exam` về Thi thử** (00 mục 2 điểm 22, anh Andy 18/11/2026; gói mục 10 câu 3): `/exam` chuyển hướng 307 tới `/tests` ở đợt 7a, 308 ở T24.
- **Đề tự chọn chỉ có full test từng kỹ năng và mini test** (00 mục 2 điểm 22): `/tests` kế thừa trang chọn kỳ thi hiện có; spec này chỉ dời URL, nội dung hub thuộc LEARNERCORE-0063 (G07-T16).
- **Spec 0056 đã duyệt** (anh Andy 20/11/2026): khung học viên, danh mục trang và breadcrumb là component của G03; G07 không thêm biến thể khung.

## Problem

Học viên đăng nhập hiện thấy thanh điều hướng cũ 8 mục (`public/js/components/aver-chrome.js`), một số trang dùng "Hôm nay" làm mục lấp chỗ (`/profile`, `/exam`, `/mock/result`, `/speaking/result`), và 6 trang kết quả không có thanh điều hướng. Đường dẫn không theo mục: bài lớp ở `/course-exercises`, `/advanced-vocabulary`, `/grammar-lessons/assigned`; thẻ từ ở `/flashcards`; kết quả Speaking full test ở `/full-test-result`; phòng thi thử ở `/mock-exam`. Khung 5 mục mới của G03 cần mỗi trang thuộc đúng một mục và có trang cha thật, nên đường dẫn phải dời. Dời sai làm hỏng bookmark, link chia sẻ thẻ từ (công khai), link bài được giao do backend sinh (so bằng chuỗi tuyệt đối ở `frontend/lib/my-class-model.mjs`), và lượt thi đang chạy.

## Scope

- Dữ liệu điều hướng học viên: mục, trang cha, loại trang (`nav`/`child`/`deep-link-only`/`focus`/`redirect`) của mọi trang G07 chạm, nạp vào `frontend/lib/route-registry.mjs` của G03 (bảng ở plan.md mục "Data and contracts").
- 17 đường dẫn đổi chỗ (bảng 5.1 của gói, kèm dòng 17 `/exam`), chuyển hướng tạm 307, cập nhật mọi liên kết nội bộ ở frontend, `public/js/practice.js` và backend, cùng các test và tooling ghim đường dẫn.
- URL HTML cũ `/pages/*.html` trỏ thẳng tới đường dẫn mới.
- Chốt 307 → 308 khi anh Andy nói (G07-T24).

## Non-goals

- Component khung, thanh dưới, breadcrumb, thanh tập trung, test CI của danh mục trang → UIBASE-0056 (G03).
- Nội dung các trang mới `/course`, `/practice`, `/tests` (hub), `/progress`, `/account`, `/help`, `/start`, Hôm nay mới → LEARNERCORE-0063 (G07-T02, T13–T17).
- Bên trong phòng thi, trình luyện, logic runner, nộp bài, đồng hồ → G08. Spec này không đổi một dòng logic nào của runner.
- `/courses`, `/enroll/...`, `/activate` → G05. `/library/**` → LIBRARY-0061 (G06).
- Đổi `/instructor` → `/teach`: không làm.
- Không đổi tên nhóm route `(…)`; không đổi `frontend/components/authed-shell.tsx` hay `pageStylesheets` của layout đang sống.

## Users and journeys

- Học viên lớp: từ Hôm nay hoặc Lộ trình mở bài được giao; bookmark `/my-class` cũ vẫn tới danh sách bài.
- Học viên tự học: mở thẻ từ, điền từ, Quick Check từ mục Luyện tập/Thư viện; link chia sẻ bộ thẻ cũ vẫn mở khi chưa đăng nhập.
- Học viên thi thử: vào `/tests`, mở đề, phòng thi ở `/tests/mock/session`; xem phiếu ở `/tests/mock/result`.
- Người nhận link cũ từ email, Zalo hoặc bookmark: một bước chuyển hướng, đủ query.

## Requirements

- **FR-001:** Mọi trang học viên đã đăng nhập, trừ trang loại `focus`, hiện đúng 5 mục theo thứ tự Hôm nay `/home` · Lộ trình `/course` · Luyện tập `/practice` · Thi thử `/tests` · Thư viện `/library`, nhãn tiếng Việt, không có mục thứ sáu. Mục trỏ tới trang chưa có thì trỏ trang tạm đang chạy theo `NAV_PLAN` + `liveHref` của `learner-sections.ts` (không bao giờ trỏ tới 404). Trang tạm hiện là `/my-class` (Lộ trình) và `/full-test` (Thi thử), chính là hai URL spec này dời: đợt 7a đánh dấu `/tests` là `live` cùng commit, đợt 8 đổi trang tạm của Lộ trình sang `/course/assigned` nếu `/course` còn `planned`.
- **FR-002:** Mỗi trang có đúng một mục "đang ở", bằng mục của trang theo danh mục trang. Không trang nào dùng "Hôm nay" làm mục lấp chỗ; trang tài khoản (`/progress`, `/account`, `/profile`, `/help`, `/notifications`) và trang "Lần đầu vào" không làm sáng mục nào.
- **FR-003:** Menu tài khoản theo thứ tự cố định: Tiến độ `/progress` · Khoá học và lượt AI `/account` · Hồ sơ `/profile` · Trợ giúp `/help` · đổi vai trò (sang Quản trị chỉ khi `/auth/me.role == 'admin'`; sang Giáo viên khi role là `instructor` hoặc `admin`) · Đăng xuất. Lối sang Giáo viên trong `LearnerShell` do spec này làm (task T03s); khi chưa có vai trò xác nhận từ máy chủ hoặc phiên hết hạn thì không hiện lối đổi vai trò nào. Thanh trên có chỗ cho chuông và thẻ "N quá hạn" của NOTIFY-0079 và nút tra nhanh của G03.
- **FR-004:** Dưới 768px có thanh dưới 5 mục; 768–1023px có nút "Menu: <mục đang ở>"; từ 1024px có 5 mục một hàng. Component của G03; G07 chỉ cấp dữ liệu.
- **FR-005:** Trong danh mục trang, chỉ trang bài có giờ hoặc đang ghi âm mang `kind: 'focus'` (chế độ tập trung, không thanh 5 mục); trang kết quả và trang xem lại mang `kind: 'child'` để khi vào khung mới chúng có thanh điều hướng và chân trang gọn. Việc đưa các trang kết quả đang trần vào khung mới thuộc LEARNERCORE-0063 và G08, không thuộc spec này.
- **FR-006:** Trang cấp hai trở xuống: máy tính có breadcrumb `Mục › Hub › Trang`, mục cuối không phải liên kết; điện thoại chỉ có "‹ <tên trang cha>". Trang cha lấy từ danh mục trang, không từ lịch sử trình duyệt. Chỉ `from=my-class` (→ "‹ Bài được giao") và `from=mock-result` (→ "‹ Kết quả thi thử") được đổi trang cha.
- **FR-007:** Không còn nhãn "← Back", "Quay lại", "Trở về", "workspace" trên trang học viên do G07 chạm vào.
- **FR-010:** Mỗi đường dẫn cũ ở bảng dời đường dẫn (plan.md, 17 dòng; dòng 15–16 chờ câu hỏi mở 2), kể cả khi kèm query, chuyển sang đường dẫn mới và giữ nguyên query; đích là trang có thật.
- **FR-011:** URL HTML cũ `/pages/*.html` của các trang đã dời trỏ thẳng tới đường dẫn mới trong một bước, không qua đường dẫn cũ.
- **FR-012:** Mọi liên kết nội bộ (frontend, `public/js/practice.js`, backend) trỏ tới đường dẫn mới. Backend được phép chuyển sau frontend; trong khoảng giữa, frontend chấp nhận cả hai dạng link backend sinh và luôn dựng URL mới (FR-016).
- **FR-013:** Đường dẫn công khai không đổi: `/`, `/login`, `/grammar/**`, `/vocabulary` (trang wiki). `/flashcard-study` đổi chỗ nhưng link chia sẻ cũ (`stack=wiki:…`, `stack=examlist:…`) vẫn mở được bộ thẻ khi chưa đăng nhập.
- **FR-014:** Trang tập trung đổi URL (phòng thi thử) vẫn hiện toàn bộ nhãn tiếng Anh; tập đường dẫn phòng thi của `components/exam-language-bridge.tsx` có URL mới, và giữ URL cũ một thời gian để trang đã mở trước lúc triển khai không đổi ngôn ngữ giữa chừng.
- **FR-015:** Chuyển hướng của spec này là tạm thời (`permanent: false`, 307) cho tới khi anh Andy nói chốt; khi đó đổi sang 308 trong một PR (G07-T24). Chuyển hướng áp cho mọi người dùng, không bật/tắt theo cờ.
- **FR-016:** Giá trị query dùng làm định danh giữ nguyên qua mọi lần dời: `from=my-class`, `session_id`, `session`, `sitting`, `code`, `bank`, `item`, `view`, `assignment_item`, `stack`, `p1`, `p2`, `p3`. Frontend nhận link bài giao dạng cũ (`/grammar-lessons/assigned?assignment_item=…`, `/grammar-checkup?assignment_item=…`) lẫn dạng mới từ backend và luôn trả URL mới.
- **FR-017:** Học viên đang thi thử lúc triển khai đợt 7b không mất câu trả lời: trang đã tải tiếp tục chạy, lệnh điều hướng của mã đã tải đi qua chuyển hướng 307 giữ query và tới đúng lượt thi.
- **FR-018:** Trang đã dời không còn là trang ở đường dẫn cũ (không có hai bản sống cùng lúc), và mỗi cặp cũ → mới có đúng một quy tắc chuyển hướng viết literal trong `frontend/next.config.ts` để `tooling/route-ownership-check.mjs` thấy được va chạm.

## Acceptance scenarios

### Scenario 1 — Link cũ một bước

- **Given** bookmark `/my-class`, `/full-test`, `/mock/result?sitting=<id thử>`, `/pages/my-class.html`
- **When** học viên đã đăng nhập mở từng link
- **Then** trình duyệt nhận đúng một 307 tới `/course/assigned`, `/tests`, `/tests/mock/result?sitting=<id thử>`, `/course/assigned`, đủ query, trang mở đúng

### Scenario 2 — Link chia sẻ thẻ từ khi chưa đăng nhập

- **Given** khách chưa đăng nhập có link `/flashcard-study?stack=wiki:food`
- **When** mở link
- **Then** 307 tới `/vocabulary/flashcards/study?stack=wiki:food` và thấy bộ thẻ

### Scenario 3 — Mục "đang ở"

- **Given** học viên mở `/tests/mock/result?sitting=…`, `/profile`, `/course/exercises?bank=…`
- **When** trang vẽ xong
- **Then** lần lượt sáng mục Thi thử, không mục nào, và Lộ trình; breadcrumb máy tính của trang đầu là `Thi thử › Kết quả thi thử`

### Scenario 4 — Bài Grammar được giao khi backend chưa đổi

- **Given** frontend đợt 3 đã lên, backend vẫn trả `grammar_lesson_path = /grammar-lessons/assigned?assignment_item=<id>`
- **When** học viên bấm bài trên trang bài được giao
- **Then** mở `/course/grammar-lesson?assignment_item=<id>` và lưu được một câu

### Scenario 5 — Phòng thi dời khi đang thi (đợt 7b)

- **Given** tài khoản QA đang làm kỳ thi thử QA ở URL cũ trên staging
- **When** triển khai bản đợt 7b rồi bấm chuyển sang phần Speaking và quay lại
- **Then** không mất câu trả lời, nhãn vẫn tiếng Anh, URL mới là `/tests/mock/session?…`

### Scenario 6 — Quay lại 307

- **Given** đợt nào đó gây lỗi trên staging
- **When** revert PR đợt đó
- **Then** đường dẫn cũ sống lại, quy tắc chuyển hướng của đợt biến mất, không còn trình duyệt nào nhớ 307

## Edge cases

- URL cũ kèm query và kèm `#hash` (hash do trình duyệt giữ).
- `/grammar-checkup/review` trần và `/course/grammar-checkup/review` trần đều về `/course/grammar-checkup`; `/grammar-checkup/review/:routeId` khác số đoạn nên không va chạm với quy tắc trần.
- Đích có sẵn query (`/progress?tab=quick-check`, nếu câu hỏi mở 2 chọn vậy) gộp với query cũ: phải kiểm trên bản Next của repo bằng `next start` + `curl -sI` trước khi viết quy tắc.
- Con trỏ làm tiếp lưu trong localStorage theo tài khoản (trang điền từ) có thể chứa URL cũ: đọc được cả hai dạng.
- `robots.ts` so tiền tố: thêm `'/course/'` (có gạch chéo cuối), không thêm `'/course'` trần vì sẽ chặn `/courses` công khai của G05.
- Từ dành riêng dưới `/course/`: `assigned`, `class`, `exercises`, `vocabulary`, `grammar-lesson`, `grammar-checkup`, `learn`; bài học dùng `/course/learn/[courseCode]/[lessonCode]`. Dưới `/vocabulary/`: `flashcards`, `fill-in`, `quick-check` — route động `/vocabulary/[slug]` của G06 (nếu có) sẽ bị các tên này che.
- Học viên đang thi đúng lúc triển khai (FR-017); `?code=` trên URL thi không được biến thành trao đổi PKCE (`detectSessionInUrl: false` đã chặn, không sửa `lib/supabase-browser.ts`).
- 308 đã bị trình duyệt nhớ thì không lùi được: lý do chỉ chốt 308 ở T24.
- Không thực hiện trên production: nộp bài, bật cờ, chạy migration.

## Success criteria

- `node frontend/tooling/route-ownership-check.mjs` in `clean` và bản `--manifest` sau build sạch ở mọi PR đợt.
- 0 link nội bộ trỏ tới đường dẫn cũ sau đợt cuối (kiểm bằng grep có ghi trong PR T24).
- Kịch bản 1–5 qua trên staging bằng tài khoản QA trước khi đề nghị chốt 308.
- Không có báo lỗi học viên "link không mở được" trong 14 ngày sau đợt cuối.

## Related specifications

- UIBASE-0056 (G03): `LearnerShell`, `route-registry.mjs`, `learner-sections.ts`, breadcrumb, `FocusShell`.
- LEARNERCORE-0063 (G07-T02): trang mới `/course`, `/practice`, `/tests` hub, `/progress`, `/account`, `/help`, `/start`; cờ `learner_v2`.
- LIBRARY-0061 (G06): `/library` và các kệ; tên dành riêng dưới `/vocabulary/`.
- NOTIFY-0079: slot chuông và thẻ "N quá hạn".
- PHONEGATE-0081: cổng điện thoại trên `/tests`.

## Open questions

Các câu sau còn mở; người thực thi dùng mặc định tạm ở cột cuối cho tới khi anh Andy trả lời.

| # | Câu hỏi | Đề xuất | Mặc định tạm |
|---|---|---|---|
| 1 | Trang Lớp học thành `/course/assigned` (trang con) hay `/course?tab=assigned` như báo cáo 12? | `/course/assigned`: giữ layout và CSS hiện có của trang lớp; dạng `?tab=` buộc trộn CSS cũ vào trang Lộ trình mới | `/course/assigned` |
| 2 | Quick Check (`/quiz`, `/quiz/progress`) chuyển về đâu? Player dùng chung cho Grammar (wiki công khai link vào), nên `/vocabulary/quick-check` sai nghĩa với bài Grammar | `/practice/quick-check` và `/progress?tab=quick-check` | Chưa chuyển; đợt 9 chờ |
| 3 | ĐÃ TRẢ LỜI (00 mục 2 điểm 22): `/exam` về `/tests` | — | 307 ở đợt 7a |
| 4 | Chuyển hướng 307 trong giai đoạn chuyển rồi mới 308, hay 308 ngay? 308 bị trình duyệt nhớ, không lùi được | 307 tới khi xong cả 9 đợt và 14 ngày ổn định, rồi 308 (T24) | 307 |
| 5 | (mới, khi soạn spec) Thẻ từ, điền từ và hub Từ vựng sáng mục nào? Gói 5.2 ghi `/vocabulary/**` thuộc Thư viện; danh mục trang G03 đã merge đặt chúng ở Luyện tập | Luyện tập: đây là trình luyện có lưu tiến độ, còn Thư viện là chỗ đọc; giữ đúng mã đã merge, không đổi lại dòng của G03 | Luyện tập (theo mã) |

Ghi chú nguồn: gói ghi đầu vào `S/reports/12-navigation-ia.md` mục A.3–A.5; báo cáo này không nằm trong repo hay thư mục chung của project ở thời điểm soạn. Nội dung spec lấy theo gói (đã chép các kết luận của báo cáo 12 vào bảng 5.1, 5.2) và đối chiếu với mã ở staging `31725a9b`; chỗ gói và mã khác nhau, mã thắng và được ghi ở plan.md.
