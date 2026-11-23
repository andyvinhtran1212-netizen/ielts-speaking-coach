# Implementation plan

Nguồn: `GOI-07-loi-hoc-vien.md` mục 2, 5.1, 5.2, 6 (T06–T12b, T15 phần đổi URL, T23, T24), 7, 8. Số dòng mã dưới đây gói đo ở staging `93c7085` (16/11/2026); các điểm chính đã đối chiếu lại ở staging `e940c936` (23/11/2026): 139 quy tắc HTML cũ và băm `75544da3…c5` ở `frontend/tests/legacy-url-redirects.test.mjs` L66–73; ba quy tắc tạm 307 (`/writing`, `/grammar-checkup/review`, `/signup`) ở `frontend/next.config.ts` L138–144; tập phòng thi `'/reading/exam/session', '/listening/test/session', '/mock-exam'` ở `components/exam-language-bridge.tsx` L6–8; `app/robots.ts` liệt kê `/course-exercises`, `/flashcards`, `/full-test`, `/mock`, `/my-class`… Người thực thi mỗi đợt đo lại số dòng trước khi sửa.

## Architecture impact

- **Danh mục trang** `frontend/lib/route-registry.mjs` (UIBASE-0056 FR-012): mỗi đợt đổi dòng của trang đã dời (`route`, `owner`, `parent`), thêm dòng `status: 'redirect'` cho đường dẫn cũ, và đổi `parent` của các trang con đang trỏ tới đường cũ (ví dụ `/full-test` → `/tests`). `LearnerShell` đọc mục "đang ở" từ `sectionFor`; không file khung nào đổi.
- **Chuyển hướng** `frontend/next.config.ts` hàm `redirects()`: thêm quy tắc literal, nháy đơn, một dòng, ngay sau ba quy tắc tạm hiện có, có chú thích `// G07 — đổi đường dẫn học viên (LEARNERNAV-0062)`. Không đưa vào module riêng rồi spread: `configSources()` của `tooling/route-ownership-check.mjs` chỉ đọc chữ trong `next.config.ts`.
- **URL HTML cũ**: `frontend/tooling/legacy-url-mapping.mjs` (`EXACT_REPLACEMENTS`, `replacementOwner`) để `/pages/x.html` trỏ thẳng tới đích mới; băm JSON quy tắc ở `legacy-url-redirects.test.mjs` L72 cập nhật mỗi đợt (ghi băm cũ → mới trong PR).
- **CSP nonce**: `frontend/proxy.ts` matcher và `frontend/tooling/content-security-policy.mjs` `nonceRouteAllowed` sửa cùng lúc, cùng thứ tự chữ cái (`csp-nonce-report-only.test.mjs` đòi khớp đúng tập trang có `AuthedShell`).
- **Robots** `frontend/app/robots.ts`: bỏ tiền tố cũ, thêm tiền tố mới; dưới `/course` chỉ thêm `'/course/'`.
- **Liên kết sinh**: frontend (`lib/my-class-model.mjs`, `lib/listening-review-model.mjs`, `lib/reading-review-model.mjs`, `lib/speaking-session-result-model.mjs`, `lib/quiz-player-model.mjs`, các `*-behavior.tsx`), `public/js/practice.js` (L246, L3717, L5679 ở `93c7085`), backend `routers/class_student.py` (`grammar_lesson_path`, `grammar_path`).
- **Phòng thi**: `components/exam-language-bridge.tsx`, `public/js/practice.js`, `public/js/mock-exam-hook.js`; không đổi logic runner.
- **CI**: `.github/workflows/next-native-browser.yml` lọc đường dẫn theo thư mục; dời thư mục mà không sửa thì job trình duyệt lặng lẽ không chạy.
- **Tài liệu**: `docs/SITE_OVERVIEW.md` §4 (test `site-overview-coverage`), `docs/ROUTE_LEDGER.md` dòng học viên.

## Data and contracts

Không có migration, không đổi API, không đổi `response_model`. Hợp đồng duy nhất đổi là URL và link backend sinh.

### Bảng dời đường dẫn (gói 5.1)

Quy ước: giữ **nhóm route** và mọi file component, chỉ dời **thư mục đoạn URL** (ví dụ `app/(authed)/course-exercises/` → `app/(authed)/course/exercises/`), để giữ layout, stylesheet, thứ tự cascade và phần lớn import.

| # | Cũ | Mới | Thư mục hiện tại → mới | Đợt | Query giữ / ghi chú |
|---|---|---|---|---|---|
| 1 | `/flashcards` | `/vocabulary/flashcards` | `(authed-flashcards)/flashcards` → `(authed-flashcards)/vocabulary/flashcards` | 1 | Cờ `flashcard_enabled` vẫn áp |
| 2 | `/flashcard-study` | `/vocabulary/flashcards/study` | `(flashcard-study)/flashcard-study` → `(flashcard-study)/vocabulary/flashcards/study` | 1 | `stack`; trang lai công khai, link chia sẻ phải mở được |
| 3 | `/d1-exercise` | `/vocabulary/fill-in` | `(authed-d1-exercise)/d1-exercise` → `(authed-d1-exercise)/vocabulary/fill-in` | 2 | Nút về đổi thành "‹ Từ vựng" → `/vocabulary/hub` |
| 4 | `/course-exercises` | `/course/exercises` | `(authed)/course-exercises` → `(authed)/course/exercises` | 3 | `bank`, `view`, `item` |
| 5 | `/advanced-vocabulary` | `/course/vocabulary` | `(authed-advanced-vocab)/advanced-vocabulary` → `(authed-advanced-vocab)/course/vocabulary` | 3 | `bank`, `item` |
| 6 | `/grammar-lessons/assigned` | `/course/grammar-lesson` | `(authed)/grammar-lessons/assigned` → `(authed)/course/grammar-lesson` | 3 | `assignment_item` |
| 7 | `/grammar-checkup` | `/course/grammar-checkup` | `(authed)/grammar-checkup` → `(authed)/course/grammar-checkup` | 4 | Sửa quy tắc 307 `/grammar-checkup/review` → `/course/grammar-checkup`; thêm `/course/grammar-checkup/review` → `/course/grammar-checkup` |
| 8 | `/grammar-checkup/review/:routeId` | `/course/grammar-checkup/review/:routeId` | thư mục con `review/[routeId]` đi theo #7 | 4 | `session` |
| 9 | `/full-test-result` | `/speaking/full-test/result` | `(authed-full-test-result)/full-test-result` → `(authed-full-test-result)/speaking/full-test/result` | 5 | `p1`, `p2`, `p3`, `session_id` |
| 10 | `/speaking/result` | `/tests/mock/speaking-report` | `(authed-speaking-result)/speaking/result` → `(authed-speaking-result)/tests/mock/speaking-report` | 6 | `sitting` |
| 11 | `/mock/result` | `/tests/mock/result` | `(authed-mock-result)/mock/result` → `(authed-mock-result)/tests/mock/result` | 6 | `sitting` |
| 12 | `/full-test` | `/tests` | `(authed-full-test)/full-test` → `(authed-full-test)/tests` | 7a | `/tests` lúc đầu là trang chọn kỳ thi hiện có; LEARNERCORE-0063 làm giàu thành hub |
| 13 | `/mock-exam` | `/tests/mock/session` | `(authed-mock-exam)/mock-exam` → `(authed-mock-exam)/tests/mock/session` | 7b | **high-risk**; `code`, `sitting` |
| 14 | `/my-class` | `/course/assigned` | `(authed-my-class)/my-class` → `(authed-my-class)/course/assigned` | 8 | Câu hỏi mở 1; cần `/course` có thật (LEARNERCORE-0063, G07-T15) |
| 15 | `/quiz` | chờ câu hỏi mở 2 (đề xuất `/practice/quick-check`) | `(authed-quiz-player)/quiz` | 9 | Wiki công khai link `/quiz?bank=` |
| 16 | `/quiz/progress` | chờ câu hỏi mở 2 (đề xuất `/progress?tab=quick-check`) | `(authed-quiz-progress)/quiz/progress` | 9 | Cần `/progress` |
| 17 | `/exam` | `/tests` | không dời thư mục; quy tắc 307 chạy trước trang | 7a | Đã quyết (00 mục 2 điểm 22) |

Không đổi: `/exercises` (đã là trang chuyển hướng), `/listening/lessons/[lessonId]`, `/reading` (thành hub ở G07-T25), `/practice/session`, `/result`, `/writing/**`, `/listening/**`, `/reading/**` còn lại, `/vocabulary/hub|sets|study|learn|practice|exam`, `/profile`. `/onboarding` → `/start` thuộc LEARNERCORE-0063 (G07-T17).

Mẫu quy tắc:
```ts
// G07 — đổi đường dẫn học viên (LEARNERNAV-0062). permanent:false trong giai đoạn chuyển (T24).
{ source: '/flashcards', destination: '/vocabulary/flashcards', permanent: false },
{ source: '/grammar-checkup/review/:routeId', destination: '/course/grammar-checkup/review/:routeId', permanent: false },
```
Không dùng `has`/`missing`; query cũ tự đi theo. Trước đợt có đích kèm query, đọc `frontend/node_modules/next/dist/docs/` mục redirects và kiểm bằng `next start` + `curl -sI` (cảnh báo ở `frontend/AGENTS.md`).

### Danh mục trang (gói 5.2, viết theo từ vựng của `route-registry.mjs`)

`section` ∈ `home|course|practice|tests|library|account`; `kind` ∈ `nav|child|deep-link-only|focus|redirect`. Gói dùng `today`/`hub`; ở đây đổi sang đúng giá trị G03 đã merge (`home`, `nav`).

| Trang | section | parent | kind |
|---|---|---|---|
| `/home` | home | — | nav |
| `/course` | course | — | nav |
| `/course/assigned`, `/course/class` | course | `/course` | child |
| `/course/learn/[courseCode]`, `/course/learn/[courseCode]/[lessonCode]` | course | `/course` | child |
| `/course/exercises`, `/course/vocabulary`, `/course/grammar-lesson`, `/course/grammar-checkup` | course | `/course/assigned` | deep-link-only (cần query) |
| `/course/grammar-checkup/review/[routeId]` | course | `/course/grammar-checkup` | deep-link-only |
| `/practice` | practice | — | nav |
| `/speaking`, `/writing/dashboard`, `/listening`, `/reading`, `/vocabulary/hub` | practice | `/practice` | child |
| `/vocabulary/flashcards`, `/vocabulary/flashcards/study`, `/vocabulary/fill-in` | practice | `/vocabulary/hub` | child (câu hỏi mở 5) |
| `/result`, `/writing/result`, `/speaking/full-test/result`, `/listening/review`, `/reading/review`, `/listening/programmes/result/[attemptId]`, `/listening/exercise-book`, `/listening/exercise-book/attempts/[attemptId]/review` | practice | hub kỹ năng tương ứng | child (có thanh điều hướng) |
| `/practice/session`, `/listening/test/session`, `/reading/exam/session`, `/listening/dictation/session`, `/listening/programmes/form/[testId]`, `/listening/exercise-book/tests/[testId]` | practice | hub kỹ năng | focus |
| `/tests` | tests | — | nav |
| `/tests/mock/session` | tests | `/tests` | focus |
| `/tests/mock/result`, `/tests/mock/speaking-report` | tests | `/tests` | child |
| `/grammar/**`, `/vocabulary` (wiki), `/library/**` | library | `/library` | child |
| `/progress`, `/account`, `/profile`, `/help`, `/notifications` | account | `/account` (riêng `/account`: —) | child |
| `/start` ("Lần đầu vào", LEARNERCORE-0063) | account (không mục nào sáng) | `/home` | child |
| mọi đường cũ ở bảng dời | — | — | redirect |

Khác biệt gói ↔ mã đã ghi: (a) `/grammar-checkup` đang là `practice` trong registry; khi dời xuống `/course/` đổi sang `course` theo gói. (b) Gói ghi `/vocabulary/**` signed-in thuộc `library`; registry G03 đặt `/vocabulary/hub` và các trình luyện từ vựng ở `practice` — giữ theo registry cho tới khi anh trả lời câu hỏi mở 5. (c) `/progress`, `/help` có `parent: '/account'` trong registry; giữ (không mục nào sáng nên không ảnh hưởng FR-002).

Mục nav trỏ tới trang chưa có: dùng cơ chế liên kết sống (`liveHref`) đã có trong `learner-sections.ts`; ví dụ Lộ trình trỏ `/my-class` cho tới khi `/course` có thật. Ghi rõ trong PR từng đợt.

## UI and interaction

Không có giao diện mới. Mỗi đợt chỉ đổi URL và href; nhãn nút về đổi theo FR-006/FR-007 trên trang được dời. Trang kết quả đang trần (6 trang ở bảng danh mục) chỉ có thanh điều hướng khi trang đó đã vào khung mới (LEARNERCORE-0063 hoặc G08); nếu chưa thì đợt chỉ đổi URL. Phòng thi giữ nhãn tiếng Anh (FR-014).

## Work decomposition

Một đợt một PR, nối tiếp theo thứ tự (gói mục 7 "Thứ tự chuyển và lý do"): trang sau cờ, ít người, không chấm bài trước; phòng thi sau cùng khi các đợt trước đã ổn trên staging và ngoài lịch thi.

| Đợt | Nhiệm vụ | Dời | Phụ thuộc |
|---|---|---|---|
| 1 | G07-T06 | #1–2 thẻ từ | spec duyệt |
| 2 | G07-T07 | #3 điền từ | đợt 1 |
| 3 | G07-T08 (2 PR: frontend, rồi backend `class_student.py`) | #4–6 bài lớp | đợt 2 |
| 4 | G07-T09 (2 PR như đợt 3) | #7–8 Grammar check-up | đợt 3 |
| 5 | G07-T10 | #9 kết quả Speaking full test | đợt 4 |
| 6 | G07-T11 | #10–11 phiếu thi thử | đợt 5 |
| 7a | G07-T12a | #12 `/full-test` → `/tests`, #17 `/exam` | đợt 6 |
| 7b | G07-T12b (high-risk) | #13 `/mock-exam` | đợt 7a, rollout.md |
| 8 | G07-T15 phần đổi URL | #14 `/my-class` | `/course` của LEARNERCORE-0063 (T15 PR 1), đợt 3 |
| 9 | G07-T23 | #15–16 Quick Check | câu hỏi mở 2, `/progress` |
| chốt | G07-T24 | 307 → 308, dọn cây cũ | anh Andy nói |

Mỗi đợt, trong **cùng một commit**: `git mv` thư mục, thêm redirect, sửa `EXACT_REPLACEMENTS`, sửa hai regex nonce (cổng sở hữu route chặn trạng thái nửa vời: một URL vừa là trang vừa là `source` → `SHADOWED`). Sau đó: href, robots, workflow, test ghim đường dẫn (đổi đường dẫn trong test, giữ nguyên khẳng định), `docs/SITE_OVERVIEW.md`, `docs/ROUTE_LEDGER.md`, dòng registry. Đợt 1 thêm test hành vi `frontend/tests/learner-route-moves.test.mjs` theo mẫu `section-index-redirects.test.mjs` (dịch `next.config.ts`, gọi `redirects()`): với mỗi dòng của bảng `MOVES` → đúng một quy tắc, đích là trang có thật, nguồn không còn là trang, `permanent === false`. Các đợt sau chỉ thêm dòng vào `MOVES`.

Danh sách test ứng viên theo đợt (gói mục 7, đếm bằng grep): đợt 1: 18 · 2: 12 · 3: 21 · 4: 7 · 5: 18 · 6: 15 · 7a+7b: 10 · 8: 17 · 9: 9, cộng 5 test chung `legacy-url-redirects`, `section-index-redirects`, `csp-nonce-report-only`, `route-auth-guard-inventory`, `site-overview-coverage`. Chạy bộ đầy đủ, chỉ sửa file thực sự đỏ; hơn 30 test vỡ ngoài dự kiến thì dừng và gửi danh sách.

Vướng mắc chính và cách gỡ (gói mục 7): thêm redirect trước khi xoá trang → cùng commit; đích HTML cũ thiếu → thêm `EXACT_REPLACEMENTS`, số quy tắc khác 139 là đã lỡ thêm/bớt nguồn → dừng; Railway và Vercel triển khai lệch → frontend nhận hai dạng trước, backend đổi ở PR sau; lọc đường dẫn workflow cũ → sửa `paths`, không đổi tên job; đụng file của gói khác (G08 sửa `mock-exam-runner.tsx`) → gói đứng trước làm trước, gói sau rebase.

## Rollout and rollback

Chi tiết ở `rollout.md`. Tóm tắt: 307 cho tới khi xong mọi đợt và 14 ngày ổn định, rồi 308 ở G07-T24 khi anh Andy nói. Lùi một đợt = `git revert` PR đợt đó (khôi phục thư mục và xoá quy tắc trong cùng commit). 308 đã bị trình duyệt nhớ thì không lùi được.

## Verification strategy

- Mỗi PR: bộ lệnh `00-QUY-UOC-CHUNG.md` mục 5.3, cộng `node frontend/tooling/route-ownership-check.mjs` (in `clean`), `npm --prefix frontend run test:react`, và `cd frontend && npm run build && node tooling/route-ownership-check.mjs --manifest`.
- Hành vi chuyển hướng: `learner-route-moves.test.mjs` (FR-010, FR-015, FR-018); `legacy-url-redirects.test.mjs` (FR-011); `curl -sI` trên `next start` cho từng dòng của đợt, có query (ghi output trong PR).
- Liên kết sinh: test node `my-class-next-behavior`/`my-class-model` hai dạng link (FR-012, FR-016); pytest `test_assigned_grammar_lessons.py` ở PR backend.
- Khung: test của G03 cho `sectionFor`/breadcrumb chạy với dòng registry mới (FR-001…FR-006).
- Staging: kịch bản ở `verification.md`, tài khoản QA và dữ liệu thử; đợt 7b dùng kỳ thi thử QA, không dùng kỳ của học viên thật.
