# GÓI 02 — Sửa nhanh trên giao diện hiện tại

## 1. Tóm tắt

- **Mục tiêu.** Gỡ những chỗ đang làm học viên mất tin ngay trên giao diện hiện có, không chờ giao diện "Bản in": học viên được xưng "bạn"; không thấy band hay "Overall" khi chưa đủ dữ liệu; không thấy "0/0", mã nội bộ hay tên tham số; tab Reading sáng đúng chỗ; liên kết thiếu thông tin đưa về trang cha kèm một dòng giải thích; có trang Điều khoản, Quyền riêng tư, Liên hệ, Giới thiệu; không còn hộp `alert()` của trình duyệt; đăng nhập xong quay lại đúng trang đang định mở.
- **Lớp thay đổi.** Mỗi nhiệm vụ là một PR `small` hoặc `hotfix`, `Spec: N/A`, theo `specs/README.md` (thân PR phải có vấn đề, hành vi mong đợi, phạm vi và ngoài phạm vi, cách kiểm). Không nhiệm vụ nào được đổi chấm điểm, cách lưu kết quả, RLS, mã kích hoạt hay hành vi AI trả phí; nhiệm vụ nào phát hiện phải đổi những thứ đó thì dừng, báo lại, vì khi đó nó thành `high-risk` và cần spec.
- **Phụ thuộc.** Không phụ thuộc gói nào. Chạy song song với G01 và với việc thiết kế. G03 về sau thay khung trang; các sửa ở đây vẫn có giá trị vì G03 không chuyển trang cũ (trang cũ chỉ đổi khi G05–G09 chuyển chúng).
- **Ước lượng (giả định).** 16 PR (T11 tách 2 PR; T03 chỉ làm nếu anh đồng ý), khoảng 16 phiên agent, độ khó 1–3. Giả định: mỗi phiên làm trọn một nhiệm vụ kèm test hẹp và bộ test frontend đầy đủ; CI xanh trong 1–2 vòng; anh Andy trả lời mục 10 trước khi tới T03, T05 và T08. Đây là ước lượng, không phải cam kết.

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085)

Bản sao chỉ có một commit nên không xem được lịch sử PR. Cột "Trạng thái" nói mã hiện tại còn lỗi hay đã sửa.

| Mục | File/đường dẫn thật | Trạng thái và ghi chú |
|---|---|---|
| (a) "em" ở màn học viên | `frontend/app/(authed-writing)/writing/dashboard/page-shell.tsx` dòng 90, 138, 139, 168, 169, 217, 345, 352, 359, 384, 410 · `.../writing/dashboard/page.tsx` dòng 27 (tiêu đề tab "Bài viết của em") · `.../writing/dashboard/writing-behavior.tsx` dòng 302, 1263, 1305, 1319, 1333, 1580, 1653 · `frontend/app/(authed-writing-result)/writing/result/writing-result-behavior.tsx` dòng 109, 110, 360, 389, 401 (2 chỗ trong một dòng) · `frontend/app/(authed-mock-result)/mock/result/mock-result-behavior.tsx` dòng 327, 465 · `frontend/lib/writing-content-dialog.ts` dòng 163 · `frontend/lib/writing-result-model.mjs` dòng 158 · `frontend/public/js/course-report.js` dòng 69 ("Em chọn"), 353 | **Còn lỗi.** 24 dòng trong `app/`, 2 trong `lib/`, 2 trong `course-report.js` (file này đang được `app/(authed)/course-exercises/course-behavior.tsx` dòng 113 nạp). Báo cáo đếm 27; số chênh do cách đếm. Dùng lệnh ở T01 để đếm lại. |
| (a) "em" do backend trả về | `backend/routers/writing_student.py` dòng 175, 894, 899, 1276, 2133, 2806 · `backend/services/class_archive_service.py` dòng 39 · `backend/services/course_writing_grader.py` dòng 419 | **Còn lỗi.** Chuỗi này hiện thẳng cho học viên (ví dụ thông báo nộp bài, lỗi 409). |
| (a) AI xưng "em" | `backend/models/writing_feedback.py` dòng 424 (`form_of_address` mặc định `'em'`), `backend/routers/writing_student.py` dòng 1082, 1970, `backend/routers/admin_writing.py` dòng 64 | **Ngoài gói.** Đổi là đổi hành vi AI trả phí → `high-risk`. Xem mục 10. |
| (a) "thầy" | grep toàn `frontend/app`, `lib`, `components`, `public/js`, `backend/routers`, `backend/services` | **Không còn chỗ nào.** Có 64 dòng "giảng viên" và 30 dòng "giáo viên" lẫn nhau ở `app/ lib/ components/`. Xem mục 10. |
| (b) Band thẻ kỹ năng ở Trang chủ | Dữ liệu: `backend/services/student_home_aggregator.py` `_build_reading` (dòng 539), `_build_listening` (dòng 564) trả `last_band` của lượt đề gần nhất và `attempts_count` = đề + bài luyện. Hiển thị: `frontend/lib/home-metrics.mjs` (`METRIC_FORMATTERS.reading`, `.listening`, dòng 99–120), gọi từ `frontend/app/(authed-home)/home/home-behavior.tsx` | **Còn lỗi.** Thẻ ghi band của một đề cạnh "7 bài đã hoàn thành", người đọc hiểu là band từ 7 bài. Band lượt mới chỉ có khi đề đủ 40 câu (`backend/services/listening_test_grader.py` `band_for` dòng 374; `reading_test_grader.py` dòng 446), nhưng thẻ không nói band dựa trên mấy đề. |
| (b) "Overall" thi thử | `frontend/app/(authed-mock-result)/mock/result/mock-result-behavior.tsx` `ResultContent` dòng 300–345 vẽ vòng Overall từ `final_bands.overall`. Backend `backend/services/mock_review_workflow.py` dòng 504 tính overall bằng trung bình các kỹ năng *bắt buộc của đề* (đề chỉ có Writing → overall = band Writing). Ô thi thử ở Trang chủ: `home-behavior.tsx` dòng 288–306 | **Còn lỗi.** Đề một kỹ năng ra "9.0 Overall". |
| (c) "0/0 câu đúng" | `frontend/app/(authed-listening-review)/listening/programmes/result/[attemptId]/programme-result.tsx` dòng 85: `{summary.correct_count || 0}/{summary.checked_count || 0}` | **Còn lỗi** ở trang kết quả chương trình. `listening/review/listening-review-workspace.tsx` dòng 472 đã chặn `maxScore > 0` (đã sửa). `practice-run-player.tsx` dòng 350 an toàn vì `maxScore` luôn bằng số câu. |
| (c) Quick Check 100% sau khi vào lại | `frontend/app/(authed-quiz-player)/quiz/quiz-player.tsx` dòng 219–232 dùng `engine.summary()`; `frontend/public/js/quiz-engine.js` dòng 450–462: `counters` bắt đầu từ 0 mỗi lần tạo engine, `resume` chỉ khôi phục độ thuộc từng từ; `frontend/lib/quiz-player-model.mjs` `quizResultModel` dòng 360 | **Còn lỗi.** Phiếu chỉ tính câu trả lời sau lần mở lại nhưng không nói vậy. |
| (d) Mã nội bộ | `home-behavior.tsx` dòng 306 (`'Kết quả: ' + esc(s.code)`; API `/api/mock-exams/my-sittings` có sẵn `title`, xem `backend/services/mock_exam_service.py` dòng 246–247) · `frontend/app/(authed-full-test)/full-test/full-test-behavior.tsx` dòng 62 (`<span className="ft-code">{exam.code}</span>`) · `frontend/app/(public-content)/vocabulary/vocabulary-wiki.tsx` dòng 169–172 ("register … · nguồn …") · `frontend/lib/quiz-history-display-model.mjs` dòng 19–29 (bộ không phải Grammar hiện `code` làm tên) · `writing/dashboard/page-shell.tsx` dòng 50 ("Mã học viên") | **Còn lỗi.** |
| (e) Tab Reading không sáng | `frontend/public/js/components/aver-chrome.js` dòng 69: `VALID_ACTIVE = ['home','writing','class','speaking','listening','grammar','vocabulary']` thiếu `reading`; `_applyActive` dòng 797 | **Còn lỗi.** 7 trang học viên truyền `active="reading"`. Thêm: `app/(authed-advanced-vocab)/advanced-vocabulary/page.tsx` dòng 14 truyền `my-class` (khoá tab là `class`); `app/(authed-full-test)/full-test/page.tsx` dòng 14 truyền `mock` (không có tab). |
| (f) "Duyệt bài thi" | `frontend/public/js/components/aver-admin-chrome.js` dòng 475 trỏ `/admin/mock-tests?tab=review`; `app/(authed-admin-mock-tests)/admin/mock-tests/admin-mock-tests.tsx` dòng 153–157, 313–315 hiện "Chưa có bài thi cần duyệt"/ô chọn đề khi chưa có đề, chỉ nhúng `/admin/mock-reviews?mock_exam_id=…` khi đã có đề (`lib/admin-mock-tests-model.mjs` `mockTestsFrame` dòng 133) | **Đã sửa trong mã staging.** Lỗi "Thiếu mock_exam_id" anh thấy trên production là do production chưa nhận bản này, hoặc do mở thẳng `/admin/mock-reviews` (trang này vẫn báo lỗi, dòng 119 và 140 của `admin-mock-reviews.tsx`). |
| (g) Trang thiếu tham số | Xem bảng ở T10–T12. Mẫu đưa về trang cha phía server đã có: `app/(authed-admin-listening)/admin/listening/segments/page.tsx` (`if (!contentId) redirect('/admin/listening')`) | **Còn lỗi** ở khoảng 24 trang. |
| (h) Trang pháp lý | Không có route `terms/privacy/contact/about` trong `app/`. `app/(marketing)/pricing/page.tsx` là `redirect('/')`, được `frontend/tests/pricing-next-behavior.test.mjs` ghim | **Còn lỗi.** |
| (i) `alert()` | `writing-result-behavior.tsx` dòng 297 · `writing-behavior.tsx` dòng 522, 1083, 1152, 1660 · `home-behavior.tsx` dòng 120 | **Còn 6 chỗ đang chạy.** `public/js/home.js` dòng 233 và `public/js/admin-speaking-sessions.js` dòng 392, 424 không được route Next nào nạp (grep `app/ components/`), không sửa. |
| (j) Quay lại sau đăng nhập | `frontend/lib/login-model.mjs` `loginDestination` dòng 25–29 luôn trả `/home`; `app/(public-auth)/login/login-behavior.tsx` dòng 162–168, 225 (`redirectTo: …/login`), 296–303. Có 63 chỗ `status === 'signed-out'` → `window.location.replace('/login')` | **Còn lỗi.** Có sẵn hàm làm sạch `next` cho admin: `frontend/lib/admin-mfa-model.mjs` `sanitizeAdminNext` dòng 66. `next.config.ts` dòng 161 đặt `Referrer-Policy: strict-origin-when-cross-origin`. |
| Test ghim liên quan | `tests/chrome-unification-canonical.test.mjs` dòng 567–575 (ghim danh sách `VALID_ACTIVE` không có `reading`) · `tests/writing-dashboard-redesign.test.mjs` dòng 472–473 · `tests/writing-result-redesign.test.mjs` dòng 423 · `tests/course-report.test.mjs` dòng 86 · `tests/admin-mock-reviews-next-behavior.test.mjs` · `tests/grammar-compare-next-behavior.test.mjs` · `tests/admin-writing-status-redesign.test.mjs` · `tests/login-next-model.test.mjs`, `tests/login-next-behavior.test.mjs` · `tests/route-ledger-matches-app.test.mjs` · `tests/route-auth-guard-inventory.test.mjs` · `tooling/verify-error-states-flow.mjs` (bước CI "Kiểm trạng thái lỗi…") | Sửa trong cùng PR khi hành vi đổi có chủ ý, ghi rõ trong PR. |

## 3. Phạm vi

**Trong phạm vi:** mười mục (a)–(j) ở trên, trên các trang Next hiện có, giữ nguyên bố cục và CSS hiện tại.

**Ngoài phạm vi:**
- Giao diện mới, token, font, khung trang mới (G03).
- Đổi tên đường dẫn học viên, hub mới `/course`, `/practice`, `/tests`, `/library` (G07).
- Trang khoá học, giá, `/pricing` mới (G05). T13 không đụng `/pricing`.
- Cách AI xưng hô trong nhận xét Writing (cần spec `high-risk`).
- Hộp `confirm()` của trình duyệt: thuộc khung phòng thi chung (G08) và admin (G09).
- Câu chữ admin gọi học viên là "em này" trong `public/js/admin-classes.js`: đó là ngôi thứ ba nói về học viên cho người vận hành, không phải xưng hô với người đọc; G09 rà khi làm lại admin.
- File legacy không route nào nạp (`public/js/home.js`, `tests/fixtures/**`): không sửa.

## 4. Yêu cầu

- **FR-02-001** Không màn học viên nào (Next) xưng "em" với người đọc. Lệnh đếm ở T01 trả 0 dòng trong phạm vi đã nêu.
- **FR-02-002** Thông báo backend trả cho học viên (nộp bài Writing, chấm lại, lớp lưu trữ, chấm câu Writing của khoá) xưng "bạn".
- **FR-02-003** Thẻ Reading/Listening ở Trang chủ chỉ hiện band khi số đề đủ 40 câu có band ≥ ngưỡng cấu hình `HOME_SKILL_BAND_MIN_FULL_TESTS` (mặc định 1); khi đó dòng phụ ghi "Ước lượng từ N đề đủ 40 câu · không phải điểm thi". Dưới ngưỡng: không có số band, ghi "Chưa đủ bài để ước lượng band".
- **FR-02-004** Phiếu kết quả thi thử và ô thi thử ở Trang chủ chỉ hiện số Overall khi đủ số kỹ năng cấu hình `MOCK_OVERALL_MIN_SKILLS` (mặc định 4). Thiếu: không có vòng số, ghi "Chưa có Overall · còn thiếu <tên kỹ năng>". Band từng kỹ năng vẫn hiện.
- **FR-02-005** Không trang nào hiện "0/0". Trang kết quả chương trình Listening khi `checked_count = 0` không hiện ô đúng/đã kiểm.
- **FR-02-006** Phiếu Quick Check sau khi mở lại bài ghi rõ số liệu là "của lượt này"; nếu trước đó đã có câu trả lời trong cùng bài, phiếu có thêm một dòng tổng cộng từ dữ liệu đã lưu.
- **FR-02-007** Học viên không thấy mã đề, mã bộ câu hỏi, dòng "register/nguồn" nội bộ. Khi thiếu tên hiển thị, dùng tên chung ("Bài thi thử", "Bộ câu hỏi"), không lùi về mã.
- **FR-02-008** Ở màn rộng ≥1025px, trang có `active="reading"` làm tab Reading sáng; `/advanced-vocabulary` làm tab Lớp học sáng.
- **FR-02-009** Mục sidebar "Duyệt bài thi" không bao giờ dẫn tới màn lỗi "Thiếu mock_exam_id"; mở thẳng `/admin/mock-reviews` không có tham số thì về `/admin/mock-tests?tab=review` kèm một dòng giải thích.
- **FR-02-010** Mỗi trang trong bảng T11/T12, mở thiếu hoặc sai tham số bắt buộc, đưa về trang cha kèm đúng một dòng giải thích bằng lời thường. Không hiện tên tham số, mã lỗi HTTP hay tiếng Anh ở màn tiếng Việt.
- **FR-02-011** `/terms`, `/privacy`, `/contact`, `/about` trả 200, có khung nội dung ghi rõ "Bản tạm, đang chờ duyệt pháp lý", có liên kết qua lại và từ chân trang trang chủ.
- **FR-02-012** Không còn `alert()` trong `frontend/app`, `frontend/components`, `frontend/lib`. Thông báo thay thế nằm trong trang, có `role="alert"` hoặc `role="status"`.
- **FR-02-013** Người chưa đăng nhập mở một trang cần đăng nhập, đăng nhập xong (tài khoản đã kích hoạt, đã qua onboarding) quay về đúng trang đó, kể cả qua Google OAuth. Đích không cùng nguồn, đích là `/login` hoặc dạng `//…` bị bỏ, về mặc định `/home`.

## 5. Hợp đồng kỹ thuật

### 5.1 Cấu hình mới (backend `backend/config.py`, lớp `Settings`)

| Tên | Kiểu | Mặc định | Dùng ở |
|---|---|---|---|
| `HOME_SKILL_BAND_MIN_FULL_TESTS` | `int` | `1` | `student_home_aggregator._build_reading/_build_listening` |
| `MOCK_OVERALL_MIN_SKILLS` | `int` | `4` | Trả trong payload kết quả thi thử dưới tên `overall_min_skills` để frontend không ghi cứng số 4 (T05) |

Viết theo mẫu field có sẵn (ví dụ `MAX_SESSIONS_PER_USER_PER_DAY: int = 24`, dòng 353). Không đổi giá trị overall đã lưu; chỉ quyết định hiển thị.

### 5.2 Payload `/api/student/home-summary` (thêm trường, không bỏ trường cũ)

`skills.reading` và `skills.listening` thêm:
- `banded_tests_count: int` — số lượt `status='submitted'` có `band_estimate IS NOT NULL`.
- `band_ready: bool` — `banded_tests_count >= HOME_SKILL_BAND_MIN_FULL_TESTS`.
- `last_band` giữ nguyên ý nghĩa; frontend chỉ vẽ khi `band_ready`.

Thêm trường thì OpenAPI đổi: chạy lại sinh `frontend/types/api.d.ts` theo cách repo đang dùng (`openapi-typescript`, xem `README.md` mục OpenAPI). CHƯA KIỂM lệnh sinh chính xác; người thực thi tìm bằng `grep -rn "openapi-typescript" frontend/package.json frontend/tooling README.md`.

### 5.3 Thông báo "đưa về trang cha"

- Trang bị thiếu tham số chuyển hướng phía server: `redirect('<trang cha>?notice=lien-ket-thieu')` (mẫu như `admin/listening/segments/page.tsx`). Trang client-only không có server boundary thì gọi `window.location.replace(...)` trong `useEffect`, cùng tham số.
- Component mới `frontend/components/redirect-notice.tsx` (client): đọc `window.location.search` trong `useEffect` (không dùng `useSearchParams`: dự án bật `cacheComponents` ở `next.config.ts` dòng 50, `useSearchParams` ngoài `<Suspense>` làm hỏng build), nếu có `notice` thì hiện dải `role="status"` một dòng + nút "Đóng", rồi bỏ tham số khỏi URL bằng `history.replaceState`.
- Bảng câu chữ (khoá → câu), đặt trong `frontend/lib/redirect-notice-model.mjs` để test được bằng `node --test`:
  - `lien-ket-thieu` → "Liên kết bạn vừa mở chưa đủ thông tin nên bạn được đưa về {tên trang}."
  - `khong-tim-thay` → "Không tìm thấy nội dung bạn muốn mở nên bạn được đưa về {tên trang}."
  - `{tên trang}` lấy từ tham số `from_label` không được phép (người ngoài sửa được URL); lấy từ bảng `PARENT_LABELS` trong cùng file, khoá theo `location.pathname` của trang cha.
- Vị trí: dải cố định ngay dưới thanh điều hướng. Thanh hiện tại là `<aver-chrome>`/`<aver-admin-chrome>` (Shadow DOM), nên lấy `getBoundingClientRect().bottom` của phần tử đó lúc gắn để đặt `top`. Gắn component một lần trong `components/authed-shell.tsx` (sau `{children}` bên trong `AuthProvider`) và một lần trong `app/(public-content)/layout.tsx` (cho `/grammar`).
- Theo tờ `thiet-ke/ThanhPhanKhungTrang2.dc.html` mục 10: một dòng lời thường, không mã lỗi, không tên tham số.

### 5.4 Quay lại sau đăng nhập

- Hàm mới `frontend/lib/safe-next.mjs` `sanitizeLearnerNext(raw)`: trả `null` nếu không phải chuỗi, không bắt đầu bằng `/`, bắt đầu bằng `//`, có `\` hay ký tự điều khiển, `new URL(raw, 'https://x.invalid')` ra origin khác, hoặc pathname là `/login`, `/onboarding`, `/admin/mfa`. Ngược lại trả `pathname + search + hash`. Viết lại theo đúng các bước của `sanitizeAdminNext` (`lib/admin-mfa-model.mjs` dòng 66–76), không gộp hai hàm (hàm admin còn ép tiền tố `/admin/`).
- Nguồn của `next`, theo thứ tự: tham số `?next=` của `/login`; nếu không có thì `document.referrer` cùng origin (63 chỗ `location.replace('/login')` tự để lại referrer nhờ `Referrer-Policy` hiện có — không phải sửa 63 chỗ). Giá trị đã làm sạch lưu vào `sessionStorage['av-login-next']` ngay khi trang login nạp lần đầu (trước khi bấm Google), vì OAuth quay về `/login?code=…` mất referrer nhưng giữ `sessionStorage` trong cùng tab.
- `loginDestination(profile, next)` (sửa `lib/login-model.mjs`): chưa kích hoạt → `'activate'`; chưa onboarding → `'/onboarding'`; còn lại → `next ?? '/home'`. Dùng xong thì xoá khoá `sessionStorage`.
- Trang login khi có `next` hiện thêm dòng "Đăng nhập để tiếp tục tới trang bạn vừa mở."

## 6. Nhiệm vụ (theo thứ tự)

Thứ tự đụng cùng file (ai đứng trước làm trước, người sau rebase): `writing-behavior.tsx` và `page-shell.tsx` của Writing: T01 → T14. `home-behavior.tsx`: T04 → T05 → T08 → T14. `mock-result-behavior.tsx`: T01 → T05. `authed-shell.tsx`: T11 trước, T10/T12 dùng lại.

### G02-T09 — Tab Reading sáng trên máy tính (làm đầu tiên)
- **Mục đích:** FR-02-008.
- **Đầu vào:** `frontend/public/js/components/aver-chrome.js` dòng 60–70, 435–450, 790–806; `tests/chrome-unification-canonical.test.mjs` dòng 567–575; `tests/react/chrome-early-render.test.tsx`.
- **Việc làm:**
  1. Thêm `'reading'` vào `VALID_ACTIVE` (dòng 69).
  2. `app/(authed-advanced-vocab)/advanced-vocabulary/page.tsx` dòng 14: `active="my-class"` → `active="class"`.
  3. Không đổi `active="mock"` của `/full-test` (không có tab Thi thử trong thanh cũ); ghi trong PR là để G07.
  4. Sửa test ghim ở `chrome-unification-canonical.test.mjs` dòng 575 thêm `'reading'`, ghi lý do trong PR.
  5. Thêm một ca vào `tests/react/chrome-early-render.test.tsx` (hoặc file React mới cùng thư mục): dựng `<aver-chrome active="reading">`, kiểm link `data-tab="reading"` có class `active` và `aria-current="page"`. Test kiểm hành vi, không đọc chuỗi nguồn.
- **Đầu ra:** 1 PR `hotfix`.
- **Nghiệm thu:** `npm --prefix frontend run test:react` qua; bộ hợp đồng frontend qua; mở `/reading/vocab` trên preview ở 1280px thấy tab Reading gạch dưới.
- **Không làm:** không đổi thứ tự, nhãn, số tab.
- **Vướng mắc → cách gỡ:**
  - Test `my-class-page.test.mjs` dòng 751 và `sprint-18-1-ia.test.mjs` đọc `VALID_ACTIVE` bằng regex → chạy cả bộ hợp đồng, nếu vỡ thì chỉ sửa danh sách mong đợi.
  - Cửa hàng web component trong jsdom: xem cách `chrome-early-render.test.tsx` đang `import('/js/components/aver-chrome.js')` (alias `/js/` trong `vitest.config.mts`) và chép đúng cách đó.
- **Ước lượng:** 1 phiên · độ khó 1.

### G02-T01 — Xưng "bạn" trên màn học viên (frontend)
- **Mục đích:** FR-02-001.
- **Đầu vào:** danh sách dòng ở mục 2 (a); `tests/writing-dashboard-redesign.test.mjs` dòng 472–473; `tests/writing-result-redesign.test.mjs` dòng 423; `tests/course-report.test.mjs` dòng 85–86.
- **Việc làm:**
  1. Đếm lại bằng lệnh (bỏ thẻ `<em>`):
     ```bash
     cd frontend && for f in $(grep -rlP "(?<![\p{L}\d_\-.])[Ee]m(?![\p{L}\d_\-])" app lib components public/js/course-report.js); do perl -CSD -ne 'my $l=$_; $l=~s{</?em\b[^>]*>}{}g; print "$ARGV:$.: $l" if $l=~/(?<![\p{L}\d_\-.\$])[Ee]m(?![\p{L}\d_\-])/ && $l!~/^\s*(\/\/|\*)/' "$f"; done
     ```
     Bỏ qua dòng admin (`app/(authed-admin-*)`), biến JS tên `em`, và `listening-test-controller.mjs` (biến `em`, không phải chữ).
  2. Sửa từng câu sang "bạn", giữ nghĩa. Ví dụ: "Em chưa có bài giao nào" → "Bạn chưa có bài được giao"; "Bài viết của em" → "Bài viết của bạn"; "Nhận xét dành cho em" → "Nhận xét dành cho bạn"; "Kết quả bài thi thử của em" → "Kết quả bài thi thử của bạn"; "Em chọn" → "Bạn chọn"; placeholder "VD: Em nghĩ phần Task Response…" → "VD: Tôi nghĩ phần Task Response…".
  3. Không đổi id/class (các file này bị script và test bám theo id/class).
  4. Sửa chuỗi mong đợi trong 3 test đã nêu; liệt kê trong PR.
- **Đầu ra:** 1 PR `small`.
- **Nghiệm thu:** lệnh ở bước 1 không còn dòng học viên nào; bộ hợp đồng frontend, `test:react`, `tsc` qua.
- **Không làm:** không đổi admin, không đổi `tests/fixtures/**`, không đổi chuỗi backend (T02).
- **Vướng mắc → cách gỡ:**
  - `tooling/write-flows/writing-regrade-request.mjs` có câu "Em nghĩ…" làm dữ liệu nhập thử → đó là nội dung học viên gõ, không phải nhãn; để nguyên.
  - `writing-behavior.tsx` dòng 1263 nằm trong `confirm()`; chỉ đổi chữ, không thay hộp (ngoài gói).
- **Ước lượng:** 1 phiên · độ khó 1.

### G02-T02 — Xưng "bạn" trong thông báo backend
- **Mục đích:** FR-02-002.
- **Đầu vào:** `backend/routers/writing_student.py` dòng 175, 894, 899, 1276, 2133, 2806; `backend/services/class_archive_service.py` dòng 39; `backend/services/course_writing_grader.py` dòng 419.
- **Việc làm:** đổi chữ; `grep -rn "<chuỗi cũ>" backend/tests frontend` để sửa test và chỗ frontend so chuỗi (ví dụ `writing-behavior.tsx` dòng 1653 dùng lại câu lớp lưu trữ làm dự phòng — đổi cùng câu).
- **Đầu ra:** 1 PR `small`.
- **Nghiệm thu:** `cd backend && python -m pytest tests/ -q` qua; grep 8 chuỗi cũ trả 0 trong `backend/routers backend/services` (trừ comment).
- **Không làm:** không đổi `form_of_address`, prompt AI, comment trong mã.
- **Vướng mắc → cách gỡ:** chuỗi lỗi 409 có thể bị frontend so khớp để chọn nhánh hiển thị → grep đoạn đầu câu trong `frontend/app frontend/lib` trước khi đổi; nếu có, đổi cả hai trong cùng PR.
- **Ước lượng:** 1 phiên · độ khó 1.

### G02-T03 — Thống nhất "giáo viên" trên màn học viên (chờ anh Andy, câu hỏi 2)
- **Mục đích:** quy ước mục 3 chỉ cho dùng "giáo viên". Không còn "thầy"; nhưng màn học viên trộn "giảng viên"/"giáo viên".
- **Đầu vào:** `grep -rn "giảng viên\|Giảng viên" frontend/app frontend/lib frontend/components | grep -v "authed-admin\|authed-instructor"`.
- **Việc làm:** chỉ khi anh đồng ý: đổi chữ hiển thị ở màn học viên sang "giáo viên". Không đổi tên role, route `/instructor`, khoá dữ liệu, màn admin/giáo viên.
- **Đầu ra:** 1 PR `small`. **Nghiệm thu:** grep trên chỉ còn dòng trong comment. **Ước lượng:** 1 phiên · độ khó 2.
- **Vướng mắc → cách gỡ:** tờ `ThanhPhanKhungTrang2.dc.html` mục 8 vẫn ghi "Khung giảng viên" — đó là nhãn vai trò trong khung staff, không phải màn học viên; giữ.

### G02-T04 — Band thẻ Reading/Listening ở Trang chủ chỉ khi đủ dữ liệu
- **Mục đích:** FR-02-003.
- **Đầu vào:** `backend/services/student_home_aggregator.py` dòng 539–605; `backend/tests/test_student_home_aggregator.py`; `frontend/lib/home-metrics.mjs`; `frontend/tests/home-metrics.test.mjs`; tờ `ThanhPhanHocTap.dc.html` mục 1 ("Khi nào được hiện số").
- **Việc làm:**
  1. Thêm `HOME_SKILL_BAND_MIN_FULL_TESTS` vào `config.py`.
  2. Trong `_build_reading` và `_build_listening`: thêm truy vấn đếm (`select("id", count="exact")…not_.is_("band_estimate","null")`) — hoặc gộp vào truy vấn có sẵn nếu PostgREST cho; trả `banded_tests_count`, `band_ready`.
  3. `home-metrics.mjs`: `reading(s)` và `listening(s)` chỉ dùng `last_band` khi `s.band_ready === true`; dòng phụ "Ước lượng từ N đề đủ 40 câu · không phải điểm thi". Không đủ: `primary` = số bài (`attempts_count`, đơn vị "bài"), dòng phụ "Chưa đủ bài để ước lượng band".
  4. Cập nhật kiểu OpenAPI (mục 5.2).
  5. Test backend: ca 0 đề, 1 đề có band, 3 bài luyện không band; test `home-metrics.test.mjs`: `band_ready` false không bao giờ cho ra số band.
- **Đầu ra:** 1 PR `small` (backend + frontend cùng hợp đồng).
- **Nghiệm thu:** pytest qua; bộ hợp đồng frontend qua; trên staging với tài khoản thử có 1 đề + 6 bài luyện, thẻ Listening ghi "Ước lượng từ 1 đề đủ 40 câu".
- **Không làm:** không đổi `band_estimate` đã lưu, không đổi `band_for`, không đổi Writing/Speaking.
- **Vướng mắc → cách gỡ:**
  - Lượt cũ có thể đã lưu `band_estimate` cho đề không đủ 40 câu (trước khi có `band_for`). CHƯA KIỂM. Người thực thi chạy trên staging (chỉ đọc): `select count(*) from listening_test_attempts where band_estimate is not null and jsonb_array_length(grading_details) <> 40;` (tương tự `reading_test_attempts`). Nếu > 0: thêm điều kiện đếm theo `jsonb_array_length(grading_details) = 40` hoặc báo lại, không tự sửa dữ liệu.
  - `tests/home.test.js` cũng đọc `last_band` → chạy và sửa nếu đổi kỳ vọng.
- **Ước lượng:** 1 phiên · độ khó 3.

### G02-T05 — Không vẽ "Overall" khi chưa đủ kỹ năng
- **Mục đích:** FR-02-004.
- **Đầu vào:** `mock-result-behavior.tsx` dòng 300–345; `home-behavior.tsx` dòng 288–306; `backend/routers/mock_exams.py` (endpoint kết quả) và `backend/services/mock_review_workflow.py` dòng 119–131, 504; tờ `ThanhPhanHocTap.dc.html` mục 1 khối "Overall · chưa đủ bốn kỹ năng".
- **Việc làm:**
  1. Backend: thêm `MOCK_OVERALL_MIN_SKILLS`; endpoint kết quả và `/api/mock-exams/my-sittings` trả thêm `overall_min_skills` (số) và `banded_skill_count` (số kỹ năng có band). Không đổi `final_bands` đã lưu.
  2. `ResultContent`: nếu `banded_skill_count < overall_min_skills` → không vẽ `.trf-ring` có số; thay bằng khối chữ "Chưa có Overall · còn thiếu {danh sách kỹ năng thiếu}" và dòng "Overall cần đủ bốn kỹ năng trong cùng đề thi thử." Thanh từng kỹ năng giữ nguyên.
  3. Ô thi thử Trang chủ (dòng 304): cùng điều kiện; thiếu thì thay số bằng "—" kèm chữ "Chưa có Overall".
  4. Test: test React mới `tests/react/mock-result-overall.test.tsx` dựng `ResultContent` với `final_bands = { writing: 9, overall: 9 }` → không có chữ "9.0" trong vùng Overall; đủ 4 → có.
- **Đầu ra:** 1 PR `small`. **Nghiệm thu:** test mới qua; pytest; bộ frontend.
- **Không làm:** không đổi `compute_overall`, không đổi cách admin chốt band.
- **Vướng mắc → cách gỡ:**
  - `ResultContent` không được export → export riêng cho test, hoặc test qua `MockResultBehavior` với `window.api` giả (xem cách `tests/react/mock-admission-and-review-flags.test.tsx` giả API).
  - Đề chỉ có Listening/Reading/Writing (không Speaking) là chủ ý ở backend → quyết định của anh (mục 10, câu 3).
- **Ước lượng:** 1 phiên · độ khó 2.

### G02-T06 — Bỏ "0/0" ở kết quả chương trình Listening
- **Mục đích:** FR-02-005.
- **Đầu vào:** `programme-result.tsx` dòng 85; `tests/react/listening-programme-learning.test.tsx`.
- **Việc làm:** khi `checked_count` bằng 0 (hoặc không có), không vẽ ô đầu; nếu mọi câu là tự đối chiếu thì ô thay bằng chữ "Bài này để bạn tự đối chiếu, không chấm đúng/sai tự động." Thêm ca test React với `checked_count: 0` → không có chuỗi `0/0`.
- **Đầu ra:** 1 PR `hotfix`. **Nghiệm thu:** test mới qua; `grep -rn "|| 0}/{" frontend/app` không còn mẫu tử số/mẫu số có thể cùng 0 mà không chặn.
- **Không làm:** không đổi cách đếm `completion_count` hay nhãn "Hoàn thành" (đó là chuyện phiếu kết quả của G07).
- **Vướng mắc → cách gỡ:** báo cáo 11 nói câu sai bị đếm là "tự đối chiếu" → đó là cách chấm (`grade_report_only_attempt`), `high-risk`, không sửa ở đây; ghi trong PR là phát hiện để mở việc riêng.
- **Ước lượng:** 1 phiên · độ khó 1.

### G02-T07 — Quick Check không báo 100% sai sự thật sau khi mở lại
- **Mục đích:** FR-02-006.
- **Đầu vào:** `quiz-player.tsx` dòng 210–232, 271, 599–608; `public/js/quiz-engine.js` dòng 167–230, 450–462; `lib/quiz-player-model.mjs` dòng 360–375; `backend/services/quiz_service.py` `get_resume` dòng 2283 (trả `correct_count`, `wrong_count` từng từ, cộng dồn mọi lượt); `tests/quiz-results-ui.test.mjs`.
- **Việc làm:**
  1. Kiểm trước: mở lại bài tạo phiên mới hay nối phiên cũ? Đọc handler `POST /api/quiz/sessions` trong `backend/routers/quiz.py` và hàm service nó gọi. Ghi kết quả vào PR.
  2. Trong `quiz-player.tsx`, giữ `started.resume` khi tạo engine (dòng 271) vào một ref; khi tổng `correct_count + wrong_count` của resume > 0, phiếu tóm tắt đổi tiêu đề số liệu thành "Lượt này" và thêm dòng "Tính cả các lần trước trong bài này: đúng X, sai Y" với X = tổng `correct_count` của resume + `totalCorrect` lượt này, Y tương tự.
  3. Logic tính đặt trong `lib/quiz-player-model.mjs` (hàm mới `quizCumulativeModel(resume, summary)`) và test bằng `node --test` trong `tests/quiz-results-ui.test.mjs` hoặc file test mới.
- **Đầu ra:** 1 PR `small`.
- **Nghiệm thu:** test model qua; kịch bản tay trên staging: trả lời 3 câu (1 sai), rời trang, mở lại, làm hết → phiếu ghi "Lượt này" và dòng tổng có 1 câu sai.
- **Không làm:** không đổi `quizEndPayload`, không đổi số liệu gửi lên `PATCH /api/quiz/sessions/{id}`, không đổi `quiz-engine.js` (thay đổi số đã lưu là `high-risk`).
- **Vướng mắc → cách gỡ:**
  - `word_stats.correct_count` có thể đã gồm câu của lượt này nếu outbox đã đẩy snapshot giữa chừng → dùng resume lúc *bắt đầu* (ref ở bước 2), không đọc lại resume lúc kết thúc.
  - Chế độ ôn (`review`) tạo engine với `resume: []` → không hiện dòng tổng.
- **Ước lượng:** 1 phiên · độ khó 3.

### G02-T08 — Ẩn mã nội bộ khỏi màn học viên
- **Mục đích:** FR-02-007.
- **Đầu vào:** các dòng ở mục 2 (d); `tests/quiz-history-display.test.mjs`, `tests/react/quiz-history-display.test.tsx`.
- **Việc làm:**
  1. `home-behavior.tsx` dòng 306: `s.title || 'Bài thi thử'`, không dùng `s.code`.
  2. `full-test-behavior.tsx` dòng 62: bỏ `<span className="ft-code">`; dòng 64 `exam.title || 'Bài thi thử'`.
  3. `vocabulary-wiki.tsx` dòng 169–172: bỏ khối `va-trace`.
  4. `quiz-history-display-model.mjs`: khi không có tên Grammar thì `label = title || 'Bộ câu hỏi'`, `subtitle = ''`; không trả `code`. Kiểm thêm mã có hậu tố `-<16 hex>` (báo cáo 09b thấy "G-error-clinic-affect-vs-effect-c87d4fdd24ddea27"): mở rộng regex dòng 20 nếu mã thật có dạng đó.
  5. "Mã học viên" ở Writing: làm theo trả lời câu 4 mục 10 (mặc định tạm: giữ).
- **Đầu ra:** 1 PR `small`. **Nghiệm thu:** test cập nhật qua; grep `ft-code\|va-trace` trong `app/` = 0.
- **Không làm:** không đổi API, không đổi admin (admin cần mã).
- **Vướng mắc → cách gỡ:** `quiz-progress-behavior.tsx` dòng 349 gọi `quizHistoryBankDisplay(session.code, undefined, …)` không có title → sẽ ra "Bộ câu hỏi" cho mọi dòng; kiểm API lịch sử phiên có `title` không (đọc `backend/routers/quiz.py` endpoint progress); nếu có thì truyền vào, không thì ghi rõ trong PR.
- **Ước lượng:** 1 phiên · độ khó 2.

### G02-T11 — Trang học viên thiếu tham số đưa về trang cha
- **Mục đích:** FR-02-010 cho màn học viên/giáo viên; dựng `RedirectNotice` (mục 5.3).
- **Đầu vào:** mục 5.3; `tooling/verify-error-states-flow.mjs`; tờ `ThanhPhanKhungTrang2.dc.html` mục 10.
- **Bảng trang (đã kiểm trong mã trừ dòng ghi CHƯA KIỂM):**

  | Trang | Bằng chứng hiện tại | Trang cha đề xuất |
  |---|---|---|
  | `/practice/session` | `lib/practice-session-bootstrap.mjs` dòng 75 "Thiếu session_id…Dashboard" | `/speaking` |
  | `/result` | `session-result-behavior.tsx` dòng 1296 | `/speaking` |
  | `/speaking/result` | `speaking-result-behavior.tsx` dòng 213 | `/speaking` |
  | `/full-test-result` | đọc `p1`/`session_id` dòng 332; hành vi khi thiếu CHƯA KIỂM | `/speaking` |
  | `/mock/result` | `mock-result-behavior.tsx` dòng 416 "Thiếu mã sitting." | `/full-test` |
  | `/mock-exam` | `mock-exam-runner.tsx` dòng 177 "Unable to open the test" | `/full-test` |
  | `/writing/result` | `writing-result-behavior.tsx` dòng 431 | `/writing/dashboard` |
  | `/listening/dictation/session` | `listening-dictation-session.tsx` dòng 331 | `/listening` |
  | `/listening/practice-run` | `practice-run-player.tsx` dòng 69 | `/listening/practice` |
  | `/listening/test/session`, `/listening/review` | CHƯA KIỂM | `/listening` |
  | `/reading/exam/session`, `/reading/review` | `lib/reading-exam-controller.mjs` dòng 23 ném `missing-reading-exam-identity`; giao diện khi thiếu CHƯA KIỂM. `/reading/review` công khai có `share`/`anon` | `/reading/test` |
  | `/quiz` | `INVALID_QUIZ_LINK_MESSAGE` (`lib/quiz-player-model.mjs` dòng 20) | `/grammar/exercises` (hoặc `/vocabulary/hub` khi `skill_area=vocab`) |
  | `/advanced-vocabulary` | dòng 396 "Liên kết bài học thiếu bank hoặc item." | `/vocabulary/hub` |
  | `/course-exercises`, `/d1-exercise`, `/grammar-lessons/assigned` | CHƯA KIỂM | `/my-class` · `/vocabulary/hub` · `/my-class` |
  | `/grammar/compare` (công khai) | `page.tsx` dòng 76 "Lỗi: Thiếu tham số slug." | `/grammar` |
  | `/instructor/grade`, `/instructor/compare` | `lib/instructor-grade-model.mjs` dòng 38, `instructor-compare.tsx` dòng 52 | `/instructor` |

- **Việc làm:**
  1. Tạo `lib/redirect-notice-model.mjs` + test `node --test`, `components/redirect-notice.tsx`; gắn vào `AuthedShell` và `(public-content)/layout.tsx`.
  2. Với mỗi dòng CHƯA KIỂM: mở trang trên `next dev` (cấu hình runtime staging theo `README.md`) không tham số, ghi hành vi vào PR trước khi sửa.
  3. Trang có `page.tsx` server (nhận `searchParams: Promise<…>`): `await searchParams`, thiếu thì `redirect(...)`. Trang chỉ đọc tham số ở client: thêm nhánh `window.location.replace(...)` ngay chỗ đang đặt lỗi thiếu tham số. Lỗi do *sai* mã (API 404) dùng khoá `khong-tim-thay`.
  4. Giữ trạng thái lỗi khác (mất mạng, 403, 500) như cũ — chỉ ca thiếu/sai tham số đổi.
  5. Cập nhật `tooling/verify-error-states-flow.mjs`: các ca `/quiz`, `/mock-exam`, `/grammar-lessons/assigned` thiếu tham số nay kỳ vọng chuyển trang + dải thông báo.
  6. Sửa `tests/grammar-compare-next-behavior.test.mjs` và test khác ghim câu lỗi cũ.
- **Đầu ra:** 2 PR `small`: PR 1 = component + `/practice/session`, `/result`, `/speaking/result`, `/full-test-result`, `/mock/result`, `/mock-exam`, `/writing/result`, `/grammar/compare`; PR 2 = phần còn lại.
- **Nghiệm thu:** test model qua; `verify-error-states-flow.mjs` qua ở local (`node tooling/verify-error-states-flow.mjs http://localhost:<port>` sau `npm run build && npx next start`); grep `Thiếu [a-z_]*_id\|Thiếu tham số\|Unable to open the test` trong `app/ lib/` không còn ở các trang trong bảng.
- **Không làm:** không đổi trang công khai `/reading/review?share=…` (có `share` là hợp lệ); không đổi trang admin (T12).
- **Vướng mắc → cách gỡ:**
  - `/mock-exam` là trang thi tiếng Anh; dải thông báo hiện ở `/full-test` (trang tiếng Việt) nên câu tiếng Việt là đúng.
  - `redirect()` trong Server Component chạy trong `<Suspense>` (mẫu `SegmentsRoute`) — đặt nhánh kiểm tra trong component con async như mẫu, không ở `default export` đồng bộ, nếu không build `cacheComponents` báo lỗi dữ liệu request ngoài Suspense.
  - `tests/csp-nonce-report-only.test.mjs` đếm đúng 2 thẻ `<script` trong `authed-shell.tsx` → `RedirectNotice` là component React, không thêm thẻ `<script>` nội tuyến.
  - `tests/authed-shell.test.mjs` kiểm thứ tự chuỗi trong `authed-shell.tsx` → đặt `<RedirectNotice />` sau khối `<link>`, chạy lại test.
- **Ước lượng:** 2 phiên · độ khó 3.

### G02-T10 — "Duyệt bài thi": xác nhận đã sửa, chặn URL trần
- **Mục đích:** FR-02-009.
- **Đầu vào:** mục 2 (f); `tooling/verify-admin-mock-tests-flow.mjs`, `tooling/verify-admin-mock-reviews-flow.mjs`; `tests/admin-mock-reviews-next-behavior.test.mjs`. Phụ thuộc T11 (component thông báo).
- **Việc làm:**
  1. Trên staging (chỉ xem), bấm sidebar Mock Test → Duyệt bài thi: ghi ảnh/ghi chú vào PR. Mong đợi: không có "Thiếu mock_exam_id".
  2. `app/(authed-admin-mock-reviews)/admin/mock-reviews/page.tsx`: thiếu `mock_exam_id` → `redirect('/admin/mock-tests?tab=review&notice=lien-ket-thieu')`. Giữ nhánh `embed=1` có tham số như cũ.
  3. Sửa `admin-mock-reviews-next-behavior.test.mjs` và verify flow theo hành vi mới.
- **Đầu ra:** 1 PR `small`. **Nghiệm thu:** verify flow admin mock reviews/tests qua ở local; staging sau merge mở `/admin/mock-reviews` trần thì về cockpit.
- **Không làm:** không đổi `NAV_GROUPS` trong `aver-admin-chrome.js` (spec 0049 và G09 lo sidebar).
- **Vướng mắc → cách gỡ:** cockpit nhúng trang review bằng iframe `?embed=1`; nếu đặt redirect trước kiểm `embed`, iframe có thể tự lồng cockpit → kiểm thứ tự: chỉ redirect khi không có `mock_exam_id`, mà `mockTestsFrame` luôn truyền `mock_exam_id`.
- **Ước lượng:** 1 phiên · độ khó 2.

### G02-T12 — Trang admin thiếu tham số đưa về trang cha
- **Mục đích:** FR-02-010 cho admin. Phụ thuộc T11.
- **Bảng:** `/admin/mock-reviews/report` (dòng 28) → `/admin/mock-tests?tab=review` · `/admin/mock-pacing` (dòng 50) → `/admin/mock-tests?tab=live` · `/admin/mock-live` (CHƯA KIỂM) → `/admin/mock-tests?tab=live` · `/admin/reading/preview` (dòng 104) → `/admin/reading/content` · `/admin/grammar-diagnostic` (`report.tsx` dòng 14), `/admin/grammar-lessons` (`report.tsx` dòng 23) → `/admin/classes` · `/admin/writing/status`, `/admin/writing/grade` (CHƯA KIỂM) → `/admin/writing/queue`. Đã đúng, không sửa: `/admin/listening/{segments,gist,tf,mcq,audit-detail}`.
- **Việc làm:** như T11 bước 2–6; sửa `tests/admin-writing-status-redesign.test.mjs` và các verify flow admin tương ứng.
- **Đầu ra:** 1 PR `small`. **Nghiệm thu:** các verify flow admin liên quan qua ở local. **Ước lượng:** 1 phiên · độ khó 2.
- **Vướng mắc → cách gỡ:** trang admin nằm sau `AdminAccessGate`; redirect server chạy trước gate, nên người không phải admin mở URL trần sẽ thấy trang cha rồi mới bị gate chặn — chấp nhận được (không lộ dữ liệu), ghi trong PR.

### G02-T13 — Trang pháp lý tối thiểu
- **Mục đích:** FR-02-011.
- **Đầu vào:** `app/(marketing)/layout.tsx`, `app/(marketing)/page.tsx` dòng 747–780 (chân trang), `docs/ROUTE_LEDGER.md`, `tests/route-ledger-matches-app.test.mjs`, `tests/route-auth-guard-inventory.test.mjs` (`PUBLIC_BY_DESIGN`), `app/sitemap.ts`, `lib/public-sitemap-model.mjs`; tờ `thiet-ke/PhapLy.dc.html` (đọc bố cục và câu chữ khung, không dựng lại giao diện mới).
- **Việc làm:**
  1. Tạo `app/(marketing)/terms/page.tsx`, `privacy/page.tsx`, `contact/page.tsx`, `about/page.tsx` dùng layout marketing sẵn có (đã có anti-flash, `tokens.css`, `components.css`, `index.css`).
  2. Mỗi trang: H1, dòng "Bản tạm · đang chờ duyệt pháp lý · cập nhật {ngày}", các mục khung theo `PhapLy.dc.html` với nội dung `XXX` ở chỗ chưa có (tên pháp nhân, địa chỉ, mã số thuế, email liên hệ, thời gian lưu dữ liệu ghi âm và bài viết, chính sách hoàn học phí). Không viết điều khoản pháp lý thật.
  3. `metadata.title` dạng "Điều khoản — Aver Learning"; `robots: { index: false }` cho tới khi pháp lý duyệt (mặc định tạm, câu hỏi 6).
  4. Thêm 4 liên kết vào chân trang `app/(marketing)/page.tsx`.
  5. Thêm 4 dòng vào `docs/ROUTE_LEDGER.md` (định dạng như dòng `/pricing`), thêm 4 route vào `PUBLIC_BY_DESIGN`.
- **Đầu ra:** 1 PR `small`. **Nghiệm thu:** `curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/terms` = 200 cho cả 4; `route-ledger-matches-app.test.mjs`, `route-auth-guard-inventory.test.mjs`, `index-redesign.test.mjs`, `pilot-landing.test.mjs` qua.
- **Không làm:** không đổi `/pricing` (vẫn `redirect('/')`; `pricing-next-behavior.test.mjs` ghim; G05 đổi). Không dùng chữ "giá", "mua".
- **Vướng mắc → cách gỡ:**
  - `index.css` có luật cho trang chủ; nếu làm vỡ bố cục trang văn bản, thêm lớp bao riêng cho trang pháp lý trong CSS mới `public/css/legal.css` chỉ dùng `var(--av-*)` (file CSS mới bị `hex-budget.test.mjs` giới hạn 0 hex, `primitive-families.test.mjs` cấm họ `*-btn`/`*-modal` mới).
  - `tailwind.build.css` không quét TSX (`tailwind.config.cjs` `content` chỉ có HTML/JS) → không dùng class Tailwind mới trong 4 trang này.
  - `tests/csp-nonce-report-only.test.mjs` khẳng định `/` và `/pricing` không vào nhánh nonce; 4 route mới không thuộc `AuthedShell` nên không phải sửa `proxy.ts`.
- **Ước lượng:** 1 phiên · độ khó 2.

### G02-T14 — Thay 6 hộp `alert()`
- **Mục đích:** FR-02-012.
- **Đầu vào:** 6 dòng ở mục 2 (i); `writing-behavior.tsx` hàm `showSubmissionNotice` dòng 230; `tests/brief-lock-contract.test.mjs` (đọc `public/js/home.js`, không đọc bản Next).
- **Việc làm:**
  1. Writing dashboard (dòng 522, 1083, 1152, 1660): dùng `showSubmissionNotice('error'|'warning', …)`. Dòng 1152 (dán bài dài): `'warning'` "Không dán được đoạn dài {len} ký tự. Bạn hãy tự gõ bài." (bỏ ký tự ⚠).
  2. Writing result (dòng 297): thêm state thông báo lỗi trong trang `role="alert"` gần nút tải file.
  3. Trang chủ (dòng 120): thẻ Writing khoá → hiện khối trong thẻ `role="status"`: "Bạn chưa có quyền dùng Writing. Hỏi giáo viên hoặc quản trị viên lớp để được mở." Không có nút mua/đăng ký (G05 lo).
  4. Thêm test React cho ít nhất ca Trang chủ khoá Writing (bấm thẻ → có chữ trong trang, `window.alert` không bị gọi — `vi.spyOn(window, 'alert')`).
- **Đầu ra:** 1 PR `small`. **Nghiệm thu:** `grep -rn "[^.a-zA-Z_]alert(" frontend/app frontend/components frontend/lib` = 0; test mới qua.
- **Không làm:** không đổi `confirm()`; không sửa `public/js/home.js`.
- **Vướng mắc → cách gỡ:** trang chủ được dựng bằng `insertAdjacentHTML` và vá DOM theo id/class (`page-shell.tsx` dòng 1–12 cảnh báo) → thêm khối khoá bằng cùng cách vá DOM trong `home-behavior.tsx`, không đổi id/class sẵn có.
- **Ước lượng:** 1 phiên · độ khó 2.

### G02-T15 — Đăng nhập xong quay lại trang đang định mở
- **Mục đích:** FR-02-013.
- **Đầu vào:** mục 5.4; `lib/login-model.mjs`; `login-behavior.tsx`; `lib/admin-mfa-model.mjs`; `tests/login-next-model.test.mjs`, `tests/login-next-behavior.test.mjs`, `tests/react/login-after-logout.test.tsx`; `tooling/verify-login-*-flow.mjs` (tên chính xác: `ls frontend/tooling | grep -i login`).
- **Việc làm:**
  1. `lib/safe-next.mjs` + test `node --test` với các ca: `/writing/result?id=1` giữ; `//evil.com`, `https://evil.com`, `/\evil`, `/login`, `/onboarding?x`, `javascript:…`, chuỗi rỗng → `null`.
  2. `login-behavior.tsx`: lúc nạp, nếu URL không có `code`/`access_token` thì tính `next` (tham số `?next=` rồi `document.referrer`), làm sạch, ghi `sessionStorage['av-login-next']` (bọc try/catch). Hai chỗ chuyển trang (dòng 168 và 303) dùng `loginDestination(profile, storedNext)`.
  3. Dòng thông báo "Đăng nhập để tiếp tục tới trang bạn vừa mở." khi có `next`.
  4. Cập nhật test model/behavior.
- **Đầu ra:** 1 PR `small`. Thân PR ghi rõ mục "An toàn chuyển hướng" (danh sách ca bị chặn).
- **Nghiệm thu:** test qua; kịch bản tay trên preview/staging: đăng xuất, mở `/writing/dashboard`, bị đưa về `/login`, đăng nhập Google → về `/writing/dashboard`. Tài khoản chưa kích hoạt vẫn thấy form kích hoạt; chưa onboarding vẫn tới `/onboarding`.
- **Không làm:** không sửa 63 chỗ chuyển `/login` (chúng bị `route-auth-guard-inventory.test.mjs` ghim bằng regex `SIGNED_OUT_GUARD`); không đổi `redirectTo` của Supabase; không đổi luồng admin MFA.
- **Vướng mắc → cách gỡ:**
  - Có trang tự đẩy sang `/login` khi API trả 401 (`public/js/api.js`) — referrer vẫn là trang đó, nên được phủ; nếu thấy referrer rỗng trong ca nào, thêm `?next=` ở đúng chỗ đó và ghi lại.
  - Trình duyệt chặn `sessionStorage` (chế độ riêng tư nghiêm) → chỉ mất tính năng, không chặn đăng nhập; bọc try/catch.
  - Người dùng mở `/login` trực tiếp từ một trang công khai (referrer `/grammar/...`) sẽ được đưa về trang đó — đúng mong muốn; nhưng referrer từ `/` (trang chủ công khai) thì giữ mặc định `/home` (thêm `/` vào danh sách bỏ qua).
- **Ước lượng:** 1 phiên · độ khó 3.

## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| Test đọc chuỗi nguồn vỡ do đổi chữ có chủ ý | `assert.match` lỗi với chuỗi cũ | Sửa chuỗi mong đợi trong cùng PR, liệt kê từng test | Vỡ hơn 30 test ngoài dự kiến |
| Trang Next "port trung thực" từ HTML cũ, bị vá DOM theo id/class | Comment đầu file nói "chép TRUNG THỰC", "parity" (ví dụ `home/page-shell.tsx`) | Chỉ đổi chữ hoặc thêm phần tử mới; không đổi id/class sẵn có | Phải đổi cấu trúc DOM mới sửa được |
| `cacheComponents` (Next 16) | Build lỗi "uncached data accessed outside Suspense" | Đọc request (`searchParams`) trong component con async bọc `<Suspense>`; client dùng `window.location` trong `useEffect` | — |
| Next 16 khác bản quen thuộc | API không như trí nhớ | Đọc `frontend/node_modules/next/dist/docs/` trước khi viết (quy tắc `frontend/AGENTS.md`) | — |
| Sửa chạm tới cách chấm/lưu | Cần đổi `grade_*`, `final_bands`, `quizEndPayload`, prompt AI | Dừng; ghi phát hiện; đây là `high-risk` | Luôn dừng |
| Workflow CI không chạy verify flow vừa sửa | Bước không có trong `next-native-browser.yml` | Tìm bước tương ứng bằng `grep -n "<tên file verify>" .github/workflows/*.yml`; nếu thêm file tooling mới mà workflow đọc, thêm glob (test `workflow-path-coverage.test.mjs` sẽ đòi) | Phải thêm job CI mới |
| Dữ liệu staging khác dự đoán | Truy vấn chỉ đọc cho kết quả bất thường | Ghi số liệu vào PR, không sửa dữ liệu | Cần sửa dữ liệu |

## 8. Ràng buộc riêng của gói

- Không đổi bố cục, CSS dùng chung, `<aver-chrome>`/`<aver-admin-chrome>` ngoài đúng dòng nêu ở T09.
- Không thêm thẻ `<script>` nội tuyến (CSP nonce đang chạy chế độ báo cáo).
- Không thêm class Tailwind mới trong TSX.
- Mọi câu chữ mới: tiếng Việt, xưng "bạn", không emoji, không "giá/mua/bán/đơn hàng".
- Mỗi PR chạy: bộ hợp đồng frontend, `test:react`, hai lệnh `tsc`, `npm run build`; PR có backend chạy thêm `pytest`.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

Môi trường: local (`next dev`/`next start` với cấu hình staging theo `README.md`) và staging sau merge. Production chỉ xem.

- **K1** — Given tài khoản thử học viên trên staging có 1 đề Listening đủ 40 câu và 6 bài luyện, When mở `/home`, Then thẻ Listening ghi band kèm "Ước lượng từ 1 đề đủ 40 câu · không phải điểm thi".
- **K2** — Given một sitting thi thử chỉ có band Writing đã công bố, When mở `/mock/result?sitting=…`, Then không có số Overall, có chữ "Chưa có Overall".
- **K3** — Given đang ở 1280px, When mở `/reading/test`, Then tab Reading gạch dưới.
- **K4** — Given chưa đăng nhập, When mở `/writing/dashboard` rồi đăng nhập, Then về `/writing/dashboard`.
- **K5** — When mở `/practice/session`, `/mock/result`, `/grammar/compare` không tham số, Then về `/speaking`, `/full-test`, `/grammar` kèm một dòng giải thích, không thấy chữ `session_id`, `slug`, "Unable".
- **K6** — When mở `/terms`, `/privacy`, `/contact`, `/about`, Then trang 200, có dòng "Bản tạm · đang chờ duyệt pháp lý".
- **K7** — Given admin trên staging, When bấm Mock Test → Duyệt bài thi, và mở `/admin/mock-reviews` trần, Then không thấy "Thiếu mock_exam_id".
- **K8** — Lệnh grep ở T01, T14 trả 0 dòng.

Không kiểm trên production: K1, K2, K4 (cần đăng nhập và dữ liệu). Sau khi anh promote, có thể xem K3, K6 trên production.

## 10. Cần anh Andy quyết

1. **Ngưỡng band ở thẻ kỹ năng** (`HOME_SKILL_BAND_MIN_FULL_TESTS`). Đề nghị: 1 đề đủ 40 câu, ghi rõ "từ N đề". Mặc định tạm: 1.
2. **"giảng viên" hay "giáo viên" trên màn học viên.** Đề nghị: đổi hết màn học viên sang "giáo viên" (T03), giữ "Giảng viên" làm tên vai trò trong khung staff như tờ thiết kế. Mặc định tạm: chưa làm T03.
3. **Overall cho đề thi thử không có Speaking** (backend hiện cho tính trung bình 3 kỹ năng). Đề nghị: theo tờ thiết kế, chỉ hiện Overall khi đủ 4 kỹ năng. Mặc định tạm: `MOCK_OVERALL_MIN_SKILLS = 4`.
4. **"Mã học viên" ở đầu trang Writing.** Học viên lớp offline có thể cần mã để báo giáo viên. Đề nghị: giữ, đổi nhãn thành "Mã học viên của bạn" và chỉ hiện khi có lớp. Mặc định tạm: giữ nguyên.
5. **AI xưng "em" trong nhận xét Writing** (`form_of_address` mặc định `'em'`). Đổi là thay hành vi AI trả phí, cần spec `high-risk` riêng. Đề nghị: mở spec riêng, mặc định "bạn" cho học viên online, giữ tuỳ chọn cho lớp offline. Mặc định tạm: không đổi.
6. **Trang pháp lý bản tạm có cho máy tìm kiếm đánh chỉ mục không.** Đề nghị: không, tới khi pháp lý duyệt. Mặc định tạm: `noindex`.
7. **Thông tin cho trang Liên hệ/Giới thiệu** (tên pháp nhân, địa chỉ, email, mã số thuế). Mặc định tạm: `XXX`.
