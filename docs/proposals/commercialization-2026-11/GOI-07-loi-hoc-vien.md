# GÓI 07 — Lõi trải nghiệm học viên sau đăng nhập

**Khớp chéo ngày 18/11/2026:** Hôm nay có năm trạng thái theo tờ HomNayTrangThai và Main ("Vừa có kết quả", "Lỗi đang lặp lại", mục tiêu và số tuần tới ngày thi), `/home` và trang lần đầu mở cho tài khoản `is_active=false` (T26 mới); "Lần đầu vào" theo tờ TroGiupLanDau thay `/onboarding` (KHÔNG có ô hỏi đồng ý dùng bản ghi âm — tính năng này đã hoãn theo quyết định 18/11/2026); phiếu Speaking hiện đoạn được chấm phát âm; Tài khoản có lịch sử lượt một kho chung, `credit_source` lớp/online, "Lần đăng nhập gần đây", "Đăng xuất khỏi mọi thiết bị" (component của G05-T20); bỏ khoá tuần tự trong khoá online (FR-07-043 ĐÃ BỎ); mỗi "việc nên sửa" có liên kết học; khối "Hết lượt chấm" dùng chung (T27 mới); Thi thử: đề tự chọn chỉ có full test từng kỹ năng và mini test, khối "Mock test được giao" đọc danh sách người dự thi của G09-T31, Overall chỉ ở mock test được giao; cấp `course_lessons` cho `lesson_count`/`chapters` của G04; bộ đếm quá hạn và khối `course_test` của GOI-11 đã đưa vào thân (bỏ ghi chú 17/11); "Giáo viên" thay chữ cũ; robots `'/course/'`; số spec 0062–0065 theo `01-KE-HOACH-TONG.md` mục 6. Ước lượng: 28 nhiệm vụ, 28 PR, khoảng 45 phiên.

**Cập nhật 18/11/2026 chiều (00 mục 2 điểm 23):** (1) "Lần đăng nhập gần đây" có nguồn dữ liệu: `GET /api/account/login-events` của G04-T16 (bảng `learner_login_events`, migration 387) — FR-07-064, T17; mục 10 câu 16 đóng. (2) "Đổi email đăng nhập": thành phần `ChangeEmail` của G05-T24, G07-T17 chỉ gắn vào Hồ sơ — FR-07-064b; câu 20 đóng. (3) "Lỗi đang lặp lại": nguồn là "Sổ lỗi cá nhân" của GOI-12 (đã viết; hàm `services/error_book.py::today_block`, G12-A04); khối hiện khi API sổ lỗi có dữ liệu, ẩn khi chưa có — FR-07-029b, mục 5.3, T13, T14; câu 14 viết lại. (4) Lượt chưa dùng: bỏ nhãn "Chuyển 50%"; đăng ký lại thì chuyển toàn bộ, bảo lưu tối đa 60 ngày; hiện `carry_balance`, `carry_expires_at` — FR-07-060. (5) Bài làm xem được tới 45 ngày sau khi khoá hết hạn: `content_visible_until` của G04 — FR-07-060b. (6) Mock test `self_paced`: đã bắt đầu thì các phần chạy liền nhau, không nghỉ giữa các phần — T16; câu 18 đóng. (7) Full test Writing = 2 lượt đã xác nhận; đoạn viết ngắn ở Kiến thức nền = 1 lượt. (8) Người làm gói này là người thực thi (project Claude Code của repo). Số nhiệm vụ, PR, phiên không đổi (28 / 28 / khoảng 45): các việc thêm nằm trong T13, T14, T17 và không thêm backend ở gói này.

Người đọc: người thực thi (project Claude Code của repo). Đọc `00-QUY-UOC-CHUNG.md` trước. Mọi đường dẫn file dưới đây tính từ gốc repo `ielts-speaking-coach`, đã mở kiểm ở `staging @ 93c7085` (16/11/2026). Chỗ ghi `CHƯA KIỂM` thì người thực thi phải kiểm bằng lệnh được nêu trước khi làm.

## 1. Tóm tắt

- **Mục tiêu.** Học viên đăng nhập xong thấy một khung 5 mục cố định (Hôm nay · Lộ trình · Luyện tập · Thi thử · Thư viện + menu tài khoản; thanh dưới trên điện thoại). "Hôm nay" cho biết bài tiếp theo trong khoá, bài giáo viên giao đến hạn, bài đang làm dở và lượt AI còn lại. "Lộ trình" gom khoá online và khoá của lớp, thay trang Lớp học. Trang bài giảng chạy video hai nguồn + bài đọc + bài tập. Mọi phiếu kết quả có ba lối ra (xem lại, làm lại, bài tiếp), ghi rõ nguồn chấm, ẩn điểm khi bài Writing của lớp đang chờ giáo viên duyệt (Speaking luôn AI chấm và trả ngay), cho gửi yêu cầu chấm lại có lý do; mỗi "việc nên sửa" có liên kết học. Tài khoản chưa có khoá đăng nhập xong vẫn vào Hôm nay (trạng thái "Chưa có khoá"), không bị đẩy về `/login`. 16 đường dẫn học viên đổi chỗ, đường cũ chuyển hướng.
- **Lớp thay đổi** (theo `specs/README.md`): gói gồm 4 spec.
  - `LEARNERNAV-0062` — điều hướng, sổ đường dẫn, 16 chuyển hướng: **feature**; riêng đợt đổi `/mock-exam` là **high-risk** (đụng luồng phòng thi đang chạy).
  - `LEARNERCORE-0063` — Hôm nay, Lộ trình, hub Luyện tập/Thi thử, Tài khoản, Tiến độ, Trợ giúp, lần đầu vào, API `/api/student/today`: **feature**.
  - `COURSELESSON-0064` — mô hình bài học của khoá online + trang bài giảng: **high-risk** (migration, RLS, quyền vào khoá).
  - `RESULTSHEET-0065` — phiếu kết quả + đổi luồng yêu cầu chấm lại: **high-risk** (chấm lại, migration).
  - Số spec đã cấp ở `01-KE-HOACH-TONG.md` mục 6: `LEARNERNAV-0062`, `LEARNERCORE-0063`, `COURSELESSON-0064`, `RESULTSHEET-0065` (chỗ nào trong file này còn ghi `00NN` thì đọc là các số này). Anh Andy là người duy nhất vận hành repo; người thực thi kiểm số chưa bị file nào trong `staging` hay PR đang mở dùng rồi ghi vào sổ đăng ký trong repo. Dải migration của gói: 420–439.
- **Phụ thuộc.**
  - Phải xong trước: **G03** (khung học viên 5 mục, thanh dưới, thanh tập trung, breadcrumb, danh mục trang dùng chung, token `--av2-`, component `frontend/components/ui/`). Không có G03 thì chỉ làm được T01–T04 (spec), T05, T13 và các đợt đổi đường dẫn T06–T12 (đổi URL không cần giao diện mới).
  - **G04** (bản 18/11): `GET /api/me/courses`, `GET /api/me/credits` (một kho lượt chung, `credits.by_kind` online/lớp), mã lỗi 402 `insufficient_credits` kèm `credit_source`, trường `pronunciation.sample` (mục 5.16), ba route `/api/account/session*` (mục 5.13), cổng kích hoạt và danh sách route miễn trừ. Cần cho khối lượt AI, nhóm "Khoá online của bạn", T17 (`/account`), T18–T19 (quyền vào bài học), T26, T27. Chiều ngược lại: G07-T18/T19 cấp dữ liệu `course_lessons` cho `lesson_count`/`chapters` của `GET /api/courses*` qua điểm ghép `routers/courses_public.py::_outline_for` của G04.
  - **G05**: `/courses` (nút "Xem các khoá"), đăng nhập quay lại đúng trang và đích sau đăng nhập (FR-05-031: lần đầu → trang "Lần đầu vào" của G07; còn lại → `/home`), nhập mã kích hoạt (`/activate`), component hộp "Đăng xuất khỏi mọi thiết bị" và màn 8a–8c của G05-T20 (G07 gắn vào Hồ sơ, không dựng lại), khối liên hệ chung và `site-info` (G05-T23) cho `/help`, lối chấm thử (G05-T21) cho trạng thái "Chưa có khoá". G05 dùng cờ tạm `AVER_HOME_OPEN_TO_INACTIVE` cho tới khi T26 merge.
  - **G09-T31** (danh sách người dự thi `mock_exam_audiences`, chế độ `live`/`self_paced`): khối "Mock test được giao" ở `/tests` (T16).
  - **GOI-11**: phần A (`services/learner_overdue.py` — cùng bộ đếm quá hạn cho chuông, Hôm nay, Lộ trình; chuông gắn vào `LearnerShell`), phần E (khối `course_test` — bài kiểm tra của khoá ở chế độ "giáo viên công bố" không hiện `score` thô), phần F (`frontend/lib/course-access-labels.mjs`).
  - **G06**: trình phát YouTube và mở `frame-src` trong CSP (Thư viện có video đề Speaking). Nếu G06 làm trước thì T19 dùng lại, không làm lần hai.
  - **G08**: thanh tập trung bên trong các trình luyện/phòng thi; phiếu kết quả Listening/Reading/Quick Check dùng component phiếu của G07 (T20).
  - **G02**: các sửa nhanh "không hiện band khi thiếu dữ liệu", "không 0/0". G07 không làm lại; nếu G02 chưa merge thì G07 áp quy tắc trên màn của mình.
- **Ước lượng** (giả định: 1 phiên ≈ một nhiệm vụ trọn vẹn kèm test; G03 đã merge; không tính thời gian chờ duyệt): **32 nhiệm vụ, 33 PR, khoảng 54 phiên agent** (bảng mục 6; tối 18/11 thêm T28–T31 theo rà soát chéo; bản 16/11 là 26 PR / 38 phiên — tăng vì thêm T26, T27 và mở rộng T13, T14, T16, T17, T22), độ khó chung **4/5** — vì chuyển hướng toàn cục không bật/tắt theo người được, hàng chục test đang ghim đường dẫn và tên thư mục, hai spec high-risk (migration bài học, chấm lại) và việc mở cổng kích hoạt cho `/home`. Đây là ước lượng, không phải cam kết.

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085)

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Trang học viên | `frontend/app/(<nhóm>)/<url>/page.tsx` | 69 trang học viên; mỗi nhóm route `(authed-…)` có `layout.tsx` riêng gọi `AuthedShell` |
| Khung `<head>` + script chung | `frontend/components/authed-shell.tsx` | Thứ tự cascade cố định: tokens → components → ds → CSS trang → tailwind. Không đổi (quy ước 4.11). Mỗi layout phải `export const instant = false` |
| Thanh điều hướng học viên cũ | `frontend/public/js/components/aver-chrome.js` L69 `VALID_ACTIVE`, L436–486 template 8 mục, L443 `href="/my-class"`, L612–619 speculation rules | 130 file test nhắc `aver-chrome`. G03 thay thanh này; G07 chỉ sửa href khi đổi đường dẫn nếu thanh cũ còn chạy |
| Giá trị `active` mỗi trang | `<aver-chrome active="…">` trong từng `page.tsx` | Đếm được: listening 19, vocabulary 12, grammar 10, reading 6, home 5, speaking 3, class 2, writing 2, mock 1, my-class 1 |
| Chuyển hướng | `frontend/next.config.ts` hàm `redirects()` | (a) `...LEGACY_RETIREMENT_REDIRECTS` = 139 quy tắc sinh từ 129 URL HTML cũ; (b) 14 quy tắc `/pages/*.html` viết tay; (c) `/admin/access-codes` (308); (d) 3 quy tắc tạm thời 307: `/writing`, `/grammar-checkup/review`, `/signup`. `vercel.json` không có redirect |
| Sinh 139 quy tắc HTML cũ | `frontend/tooling/legacy-url-redirects.mjs`, `legacy-url-mapping.mjs` (`EXACT_REPLACEMENTS`, `canonicalNextRouteForLegacy`, `replacementOwner`), `legacy-url-paths.mjs` | Đích suy từ tên file, ví dụ `/pages/my-class.html` → `/my-class`. Băm nguồn (129 URL) không đổi; băm JSON quy tắc bị ghim trong test (dòng dưới) |
| Test ghim quy tắc HTML cũ | `frontend/tests/legacy-url-redirects.test.mjs` | L66–75: đúng 139 quy tắc, sha256 `75544da3…c5`. L139–150: **mọi đích phải là route App Router có thật** → xoá trang cũ mà không đổi đích sẽ đỏ |
| Kiểm sở hữu route | `frontend/tooling/route-ownership-check.mjs` | `configSources()` đọc `next.config.ts` bằng regex `\{ source: '([^']+)'` → chỉ thấy quy tắc viết **literal, nháy đơn, đúng dạng** trong `next.config.ts`. Một URL vừa là trang vừa là `source` redirect → lỗi SHADOWED. Workflow `.github/workflows/route-manifest.yml` build và chạy `--manifest` |
| Test redirect mục | `frontend/tests/section-index-redirects.test.mjs` | Dịch `next.config.ts` bằng TypeScript rồi gọi `redirects()` — đây là kiểu test hành vi nên dùng lại cho 16 chuyển hướng mới. Đang ghim `/grammar-checkup/review` → `/grammar-checkup`, 307 |
| CSP nonce theo mục | `frontend/proxy.ts` L182–192 (matcher), `frontend/tooling/content-security-policy.mjs` L178–181 `nonceRouteAllowed` | Hai regex liệt kê tay: `admin|advanced-vocabulary|course-exercises|d1-exercise|exam|exercises|flashcard-study|flashcards|full-test|full-test-result|grammar-checkup|grammar-lessons|home|instructor|listening|mock|mock-exam|my-class|onboarding|practice|profile|quiz|reading|result|speaking|writing` + `/vocabulary/.+`. `frontend/tests/csp-nonce-report-only.test.mjs` L246: proxy phải khớp **đúng** tập trang có layout `AuthedShell` |
| CSP chặn iframe | `frontend/tooling/content-security-policy.mjs` L100–115 | Production không có `frame-src` → rơi về `default-src 'self'` → iframe YouTube bị chặn. `media-src` đã cho `https:` |
| Robots | `frontend/app/robots.ts` | Liệt kê tiền tố riêng tư. Disallow là so tiền tố: thêm `'/course'` sẽ chặn luôn `/courses` công khai (G05) |
| Ngôn ngữ thi | `frontend/components/exam-language-bridge.tsx` L7 | Tập cứng `'/reading/exam/session', '/listening/test/session', '/mock-exam'` → đổi URL phòng thi phải sửa ở đây |
| Liên kết sinh trong JS cũ còn chạy | `frontend/public/js/practice.js` L246 (`/full-test-result`), L3717 (`/mock-exam?sitting=` lúc chuyển Speaking trong thi thử), L5679 (`/my-class`) | `practice.js` vẫn được nạp bởi `app/(authed-practice)/practice-runtime-scripts.tsx` |
| Liên kết sinh ở backend | `backend/routers/class_student.py` L865, L898, L969 (`grammar_lesson_path = /grammar-lessons/assigned?assignment_item=…`), L975 (`grammar_path = /grammar-checkup?assignment_item=…`) | `frontend/lib/my-class-model.mjs` L468–479 so **bằng chuỗi tuyệt đối** với đường dẫn mong đợi, khác là trả `null` (bài không mở được) |
| Liên kết sinh ở frontend | `lib/listening-review-model.mjs` L55, `lib/reading-review-model.mjs` L26 (`from=my-class` → `/my-class`), `lib/speaking-session-result-model.mjs` L575, `app/(authed-my-class)/my-class/my-class-workspace.tsx` L601, L606, `app/(authed-admin)/(mock-reviews)/admin/mock-reviews/admin-mock-reviews.tsx` (`/full-test-result?session_id=`), `lib/quiz-player-model.mjs` L288 | Giữ **giá trị** `from=my-class` (là định danh, có thể đã nằm trong link lưu ở nơi khác); chỉ đổi href |
| Lọc đường dẫn CI trình duyệt | `.github/workflows/next-native-browser.yml` L170–209 | Ghim `frontend/app/(authed)/grammar-checkup/**`, `(authed)/course-exercises/**`, `(authed)/grammar-lessons/**`, `(authed-flashcards)/**`, `(authed-full-test)/**`, `(authed-mock-exam)/**`, `(authed-quiz-player)/**`, `(authed-quiz-progress)/**`. Dời thư mục mà không sửa → job trình duyệt lặng lẽ không chạy |
| Bản đồ trang | `docs/SITE_OVERVIEW.md` §4; test `frontend/tests/site-overview-coverage.test.mjs` | Mọi đường dẫn trong bảng §4 phải là trang có thật; phủ ≥ 85% trang |
| Sổ route | `docs/ROUTE_LEDGER.md` | Dòng học viên L164–267 (ví dụ `/my-class` L238). Chỉ test admin đọc file này; dòng học viên cập nhật tay |
| Phân loại đăng nhập trang | `frontend/tests/route-auth-guard-inventory.test.mjs` L26–50 | `GUARDED` ghim `'/course-exercises': 'app/(authed)/course-exercises/course-behavior.tsx'`, `/grammar-checkup`, `/grammar-checkup/review/[routeId]`, `/advanced-vocabulary`; `PUBLIC_BY_DESIGN` có `/flashcard-study` |
| Bảng điểm trang chủ | `backend/routers/student_home.py` `GET /api/student/home-summary`, `GET /api/student/permissions`; `backend/services/student_home_aggregator.py` (7 phần chạy song song, phần hỏng vào `_errors`) | Không có bài tiếp theo, không có lượt AI |
| Bài được giao | `backend/routers/class_student.py`: `GET /api/class/my-assignments` (L658), `GET /api/class/me` (L1066, `summary=true` bản gọn), `POST /api/class/assignments/{item_id}/start` (L698); hàm `_visible_assignments` (L493), `_decorate` (L268: `item_id, state, submitted_at, score, passed_at, course_action, writing_expected, is_late, is_missing, assignment{id,cohort_id,cohort_name,title,skill,instructions,due_at,content_config}`) | Không có lớp → `{"has_class": false}`, không phải 404 |
| Bài làm dở | cột `resume_expires_at` (TTL 24 giờ) trên `sessions`, `reading_test_attempts`, `listening_test_attempts`, `dictation_attempts`, `writing_assignments` (migration `224_active_player_resume_ttl.sql`); `GET /api/listening/overview` trả khối `resume` (`backend/routers/listening.py` L5720) | Chưa có API gom bài dở của mọi kỹ năng |
| Khoá, lớp, bài của lớp | `courses` (mig 175: `code` C1–C5, `name`, `sort_order`, `is_active`), `cohorts.course_id`, `class_lessons` (mig 176: **theo `cohort_id`**, `lesson_no`, `title`, `body_md`, `attachments`), `class_assignments`, `quiz_banks(course_id, lesson_no)` (mig 186) | Không có bảng bài học thuộc **khoá** (báo cáo 07 a.3). Bộ câu của khoá bị ẩn khỏi danh sách công khai: `backend/services/quiz_service.py` L883–896 `list_published_banks` trả `[]` cho `skill_area=course` |
| Cờ tính năng | `users.feature_flags` JSONB + `backend/services/feature_flags.py` (`_per_user_flag`, mặc định từ chối); bảng `runtime_flags` (mig 155) + `backend/services/runtime_flags.py` (bộ đệm 15 giây) + `PATCH /admin/runtime-flags/{key}` (`backend/routers/admin_flags.py`); `GET /auth/me` trả các cờ (`backend/routers/auth.py` L310–360, model `backend/models/auth.py` `AuthMeResponse`) | Tiền lệ "hai khoá": `vocab_curated_enabled = feature_flags.vocab_curated_enabled AND runtime_flags('vocab_units_read')`. Bật cờ từng người: `POST /admin/users/{user_id}/vocab-flag` (`backend/routers/admin.py` L5065) |
| Đọc `/auth/me` ở frontend | `frontend/lib/auth-wire-model.mjs` L47–60 `normalizeAuthMe` | Trả `null` (coi như lỗi đăng nhập) nếu một trong 5 cờ không phải boolean → **không** thêm cờ mới vào danh sách bắt buộc này |
| Kiểu API | `frontend/types/api.d.ts` sinh bằng `openapi-typescript`; `.github/workflows/typecheck.yml` L64–76 sinh lại và `git diff --exit-code` | Đổi `response_model` backend thì phải sinh lại `api.d.ts` trong cùng PR |
| Cổng kích hoạt | `backend/services/activation_gate.py` `require_active_learner`, `ACTIVATION_EXEMPT_ROUTES`; `backend/tests/test_activation_gate_inventory.py` | Endpoint học viên mới tự bị chặn nếu tài khoản chưa kích hoạt |
| Chấm lại Writing | bảng `essay_regrade_requests` (mig 084: `essay_id` UNIQUE, `student_id`, `reason` TEXT, `status` pending/accepted/rejected/fulfilled, `admin_response`, `admin_id`, `actioned_at`, `fulfilled_at`); mig 085 `CHECK (char_length(reason) BETWEEN 50 AND 500)`; mig 205 chuyển trạng thái nguyên tử | API học viên: `POST/GET /api/writing/essays/{essay_id}/regrade-request` (`backend/routers/writing_student.py` L2774, L2815; body `reason` 50–500 ký tự; 409 nếu chưa `delivered` hoặc đã gửi). Admin: `GET/GET/PATCH /admin/writing/regrade-requests[/{id}]` (`backend/routers/admin_writing_regrade.py`), màn `app/(authed-admin-writing-regrade)/admin/writing/regrade-requests/admin-writing-regrade-requests.tsx`. Trang kết quả hiện dùng ô chữ tự do: `app/(authed-writing-result)/writing/result/writing-result-behavior.tsx` L167–220 |
| Luồng trả bài Writing | `backend/routers/writing_student.py` L1–24, L520–600 | Nhận xét và band chỉ trả khi `status == 'delivered'`; trạng thái `queued → grading → graded → reviewed → delivered`. Có trường `band_source` ∈ `ai`/`teacher`/`unknown` (`_band_source` L481). **Hiện không có luồng "AI chấm trả ngay" cho Writing** — mọi bài đều qua người duyệt |
| Chấm lại Speaking | chỉ có phía admin: `POST /admin/sessions/{id}/regrade`, `/admin/responses/{id}/regrade` (`backend/routers/admin.py` L4622, L4732) | Học viên không gửi được yêu cầu |
| Phiếu thi thử | `app/(authed-mock-result)/mock/result/mock-result-behavior.tsx` L308–333 | Vẽ vòng Overall từ `finalBands.overall` backend trả; báo cáo 09c thấy 9.0 từ một kỹ năng |

## 3. Phạm vi

**Trong phạm vi**
1. Dữ liệu điều hướng học viên: 5 mục, mục tài khoản, quy tắc "đang ở", loại trang (hub/con/tập trung/chỉ deep-link/chuyển hướng), trang cha cho breadcrumb — nạp vào danh mục trang của G03.
2. 16 đường dẫn đổi chỗ, chuyển hướng, cập nhật mọi liên kết và test liên quan, chia 9 đợt.
3. Trang mới: `/course` (Lộ trình) và các trang con, `/practice` (hub), `/tests` (hub, kế thừa `/full-test`), `/progress`, `/account`, `/help`, trang "Lần đầu vào" (thay `/onboarding`). Làm mới `/home` (Hôm nay) sau cờ, đủ năm trạng thái của tờ HomNayTrangThai. Đưa `/profile` vào khung mới.
4. API đọc mới `GET /api/student/today`.
5. Mô hình bài học của khoá online (`course_lessons`, `course_lesson_progress`) và trang bài giảng có video hai nguồn.
6. Phiếu kết quả dùng chung (ba lối ra, nguồn chấm, chờ duyệt, chấm lại) cho Writing, Speaking (`/result`), thi thử.
7. Cờ bật giao diện mới theo người.
8. Mở `/home`, trang "Lần đầu vào" và API `/api/student/today` cho tài khoản đã đăng nhập nhưng `users.is_active=false` (T26).
9. (ĐÃ BỎ — hoãn theo quyết định 18/11/2026) Màn hỏi đồng ý dùng bản ghi âm để cải thiện chấm bài ở lần đầu vào và công tắc ở Tài khoản: không dựng ở đợt này. Bản ghi âm giữ tối đa 60 ngày rồi xoá, không dùng cho mục đích khác.
10. Khối "Hết lượt chấm" dùng chung và liên kết học ở mỗi "việc nên sửa" (T27).
11. Dữ liệu `lesson_count`/`chapters` cho trang khoá công khai của G05 (thay thân `_outline_for` của G04 khi có `course_lessons`).

**Ngoài phạm vi**
- Khung, thanh, breadcrumb, thanh tập trung dạng component; danh mục trang và test CI của nó → **G03**.
- Bảng quyền/lượt/đơn, API số dư lượt, trừ lượt khi nộp, chọn đoạn chấm phát âm, cổng một phiên → **G04**. Luồng trả kết quả theo G04 mục 5.7: Speaking luôn AI chấm và trả ngay; chỉ Writing của lớp offline chờ giáo viên duyệt.
- `/courses`, `/enroll/...`, `/account/orders`, đăng nhập (Google hoặc mã 6 số), nhập mã kích hoạt, đăng nhập quay lại trang cũ, giao diện "một phiên" 8a–8c và hộp "Đăng xuất khỏi mọi thiết bị" → **G05**. `/library` và các kệ → **G06**.
- Bên trong phòng thi/trình luyện (thanh tập trung, nộp bài, màn hết giờ, "Abandon test") và phiếu Listening/Reading/Quick Check → **G08** (dùng component phiếu của G07). Phía học viên của kỳ thi được giao (phòng chờ, làm lần lượt từng phần) → **G08**; G07 chỉ dựng khối danh sách ở `/tests`.
- Chuông, thẻ quá hạn, trang `/notifications`, màn học viên của bài kiểm tra khoá → **GOI-11** (T11, T27).
- Admin (hàng chờ chấm lại kiểu mới, hồ sơ học viên) → **G09**. G07 chỉ đảm bảo màn admin chấm lại hiện có vẫn đọc được dữ liệu mới.
- Đổi `/instructor` → `/teach`: không làm.

## 4. Yêu cầu (FR)

### 4.1 Điều hướng
- **FR-07-001** Mọi trang học viên đã đăng nhập (trừ trang tập trung) hiện đúng 5 mục theo thứ tự Hôm nay `/home` · Lộ trình `/course` · Luyện tập `/practice` · Thi thử `/tests` · Thư viện `/library`, nhãn tiếng Việt, không có mục thứ sáu.
- **FR-07-002** Mỗi trang có đúng một mục "đang ở" = mục cha của trang theo danh mục trang. Không trang nào dùng "Hôm nay" làm mục lấp chỗ (hiện `/profile`, `/exam`, `/mock/result`, `/speaking/result` đang làm vậy). Bảng ánh xạ ở 5.2.
- **FR-07-003** Menu tài khoản theo thứ tự cố định: Tiến độ `/progress` · Khoá học và lượt AI `/account` · Hồ sơ `/profile` · Trợ giúp `/help` · (Đổi vai trò: sang Quản trị — chỉ khi `/auth/me.role == 'admin'`; sang Giáo viên khi role `instructor` hoặc `admin`) · Đăng xuất. Thanh trên có thêm chuông và thẻ "N quá hạn" của GOI-11 (slot của `LearnerShell`, G03), nút tra nhanh (G03).
- **FR-07-004** Dưới 768px: thanh dưới 5 mục; 768–1023px: nút "Menu: <mục đang ở>"; từ 1024px: 5 mục một hàng (component G03, G07 chỉ cấp dữ liệu).
- **FR-07-005** Chế độ tập trung chỉ cho trang loại `focus` (bài có giờ hoặc đang ghi âm). Trang kết quả và xem lại luôn có thanh điều hướng và chân trang gọn.
- **FR-07-006** Trang cấp hai trở xuống: máy tính có breadcrumb `Mục › Hub › Trang`, mục cuối không phải liên kết; điện thoại chỉ có "‹ <tên trang cha>". Trang cha lấy từ danh mục trang, không từ lịch sử trình duyệt. Chỉ `from=my-class` (→ "‹ Bài được giao") và `from=mock-result` (→ "‹ Kết quả thi thử") được đổi trang cha.
- **FR-07-007** Không còn nhãn "← Back", "Quay lại", "Trở về", "workspace" trên trang học viên do G07 chạm vào.

### 4.2 Đổi đường dẫn
- **FR-07-010** Mỗi đường dẫn cũ ở bảng 5.1 (kể cả kèm query) chuyển sang đường dẫn mới, giữ nguyên query; đích là trang có thật.
- **FR-07-011** URL HTML cũ (`/pages/*.html`) trỏ thẳng tới đường dẫn mới (một bước), không qua đường dẫn cũ.
- **FR-07-012** Mọi liên kết nội bộ (frontend, `practice.js`, backend) trỏ tới đường dẫn mới; backend được phép chuyển sau frontend (xem T08).
- **FR-07-013** Đường dẫn công khai không đổi: `/`, `/login`, `/grammar/**`, `/vocabulary` (trang wiki), `/flashcard-study` đổi chỗ nhưng link chia sẻ cũ vẫn mở được bộ thẻ.
- **FR-07-014** Trang tập trung đổi URL (phòng thi) vẫn hiện toàn bộ nhãn tiếng Anh.

### 4.3 Hôm nay (tờ Main — trạng thái "có khoá, đang học"; tờ HomNayTrangThai — các trạng thái khác; tờ Mobile)
- **FR-07-019** (mới) Chọn trạng thái theo thứ tự của tờ HomNayTrangThai: có khoá đang học (mục 1 tờ Main; chưa học bài nào → "Ngày đầu có khoá", mục 4) → có đơn đang chờ xác nhận hoặc cần bổ sung (mục 3) → chưa có khoá (mục 2). Dải "sắp hết hạn / đã hết hạn / hết lượt" (mục 5) chồng lên trạng thái có khoá. Dữ liệu: `access`, `orders_open`, `credits` của `/api/student/today` (5.3). Mọi tài khoản đã đăng nhập, kể cả `is_active=false`, đều thấy Hôm nay trong khung học viên 5 mục (T26).
- **FR-07-020** Tiêu đề "Chào <tên>. Hôm nay bạn có <N> việc." với N = số bài được giao chưa nộp có hạn trong hôm nay và ngày mai (và bài đã quá hạn) + 1 nếu còn bài tiếp theo của lộ trình; "Làm tiếp khi rảnh" không đếm. N = 0 → "Hôm nay không có bài đến hạn." Không bao giờ hiện "0 việc". Bài quá hạn xác định bằng `services/learner_overdue.py` của GOI-11 (mục 5.1.5) để chuông, Hôm nay, Lộ trình cho cùng một số.
- **FR-07-021** Thẻ "Bài tiếp theo trong lộ trình": khoá, chặng, số bài, tên bài, thời lượng video, số câu luyện, vị trí xem dở; nút "Học tiếp từ phút M" hoặc "Bắt đầu bài". Ẩn hẳn khi không có khoá online (không để thẻ trống).
- **FR-07-022** (bổ sung 18/11 tối) Dòng kỳ thi được giao theo tờ HomNayTrangThai mục 7a nằm trong khối này suốt khoảng mở (từ `mock_exams`), không cộng vào N; kỳ có phần đang dở thì khối cảnh báo "bài thi đang dở" thắng dòng này. Khối "Bài được giao, hạn hôm nay và ngày mai": tối đa 5 dòng, quá hạn lên đầu và ghi "Đã quá hạn" có nhãn chữ, rồi hạn gần nhất; dòng dưới "Còn n bài hạn sau ngày mai, không tính vào việc hôm nay." + "Xem bài được giao"; nút mở **đúng bài** (không về danh sách Writing — lỗi báo cáo 09c số 9). Bài kiểm tra của khoá đọc khối `course_test` của GOI-11 (mục 5.5.6); không hiện `score` thô của bài ở chế độ "giáo viên công bố".
- **FR-07-023** Khối "Làm tiếp khi rảnh": bài có `resume_expires_at > now()`, tối đa 4, nút "Làm tiếp".
- **FR-07-024** Khối lượt chấm AI: **một con số còn lại, một kho chung cho Writing và Speaking** (G04); học viên lớp: nhãn "Lượt chấm AI lớp cấp cho bạn · cấp kèm mã lớp" và câu "Hết lượt thì liên hệ giáo viên để được cấp thêm"; học viên online: nhãn theo khoá, kèm hạn dùng lượt khi có (`credits.usable_until`). Có cả hai nguồn → hai dòng theo `credits.by_kind`. Dòng "Luyện Listening, Reading, từ vựng và ngữ pháp không tính lượt." Học viên lớp dùng mã cũ không kèm lượt (không đo): ẩn khối và số trên thanh. Khi API lượt chưa có hoặc lỗi: ẩn khối, không hiện 0.
- **FR-07-025** Khối "Vừa có kết quả": tối đa hai bài được trả kể từ lần vào Hôm nay trước, mới nhất trước, nút "Mở phiếu" mở thẳng phiếu; đã mở phiếu hoặc không có bài mới thì ẩn cả khối. Band theo kỹ năng không nằm ở Hôm nay (chỉ ở Tiến độ, theo 5.6). Thay khối "Kết quả gần đây" của bản 16/11.
- **FR-07-026** Một khối lỗi chỉ làm hỏng khối đó (dùng `degraded` của API), các khối khác vẫn hiện.
- **FR-07-027** Trạng thái "Chưa có khoá" (HomNayTrangThai mục 2; bản điện thoại ở Main mục 6): thay các khối trên bằng lối "Xem các khoá" (`/courses`), "Nhập mã kích hoạt của lớp" (`/activate`), lối Thư viện và khối chấm thử; thanh trên thay "Lượt chấm AI còn" bằng "Chấm thử hôm nay còn N bài" (N từ `GET /api/trial/status` của GOI-11; chấm thử tạm dừng hoặc tài khoản không dùng được thì bỏ chữ này và dùng câu biến thể của tờ).
- **FR-07-028** (mới) Trạng thái "Đơn chờ xác nhận / cần bổ sung" (mục 3): hiện mã đơn, khoá, trạng thái đơn theo nhãn học viên của G04 mục 5.5, nút "Mở trang đơn" (`/enroll/[orderCode]` của G05); đơn `needs_info` có nhãn Cảnh báo và hạn bổ sung (`supplement_by`). Thanh trên không có số lượt. Khối "Học trước trong lúc chờ" (HV-12) là đề xuất chưa duyệt: không dựng (mục 10 câu 17).
- **FR-07-029** (mới) Dải mục 5 khi khoá online sắp hết hạn (còn không quá `ENROLL_RENEW_WINDOW_DAYS` — G04 trả `can_renew`), đã hết hạn, hoặc vừa hết lượt: nhãn hành động "Đăng ký lại" lấy từ `frontend/lib/course-access-labels.mjs` (GOI-11 phần F); hết lượt dùng khối "Hết lượt chấm" chung (FR-07-055). Ẩn dải sắp hết hạn khi đã có đơn đăng ký lại đang mở.
- **FR-07-029a** (mới) Dòng "Mục tiêu <band> · còn N tuần tới ngày thi" chỉ hiện khi đã đặt mục tiêu (ở "Lần đầu vào" hoặc Tiến độ); chưa có ngày thi thì chỉ "Mục tiêu <band>"; bấm mở `/progress`. Câu nhịp học ở khối Tiến độ khoá tính theo ngày thi khi có, không thì theo hạn khoá.
- **FR-07-029b** (mới) Khối "Lỗi đang lặp lại": đúng lỗi số 1 của Tiến độ, chỉ khi có từ 2 bài có nhận xét; nút "Ôn 10 phút" mở mục chữa lỗi trong bài Grammar Wiki (G06) hoặc bài trong lộ trình nếu khoá có bài đó; "Xem cả n lỗi" → `/progress`. **Nguồn dữ liệu (00 mục 2 điểm 23): "Sổ lỗi cá nhân" của GOI-12** (gói đang được viết; tên bảng và API theo GOI-12, file này không đặt tên thay). Phụ thuộc: khối hiện khi API sổ lỗi trả dữ liệu cho người đó; **ẩn** khi GOI-12 chưa merge, API lỗi, hoặc chưa đủ dữ liệu. G07 không tự tổng hợp lỗi từ nhận xét, không dựng bảng riêng.


### 4.4 Lộ trình
- **FR-07-030** `/course` có ba thẻ: "Các khoá và bài học" (`/course`), "Bài được giao (n)" (`/course/assigned`), "Buổi học và tài liệu lớp" (chỉ hiện khi có lớp). n = số bài chưa nộp; n = 0 thì không ghi số.
- **FR-07-031** "Khoá online của bạn": mỗi quyền còn hạn (G04 `entitlements`, nguồn khoá online) một dòng: tên, "còn X ngày", tiến độ, lượt AI còn. Tiếp theo "Khoá online khác · dự kiến" từ `course_products` đang mở/sắp mở, nút "Xem khoá" → `/courses/[slug]`. Không có khoá: câu trống trong tờ LoTrinh + "Xem các khoá".
- **FR-07-032** "Khoá của lớp": lớp, giáo viên, khoá của lớp (từ `/api/class/me`), các khoá được cấp quyền luyện lại. Không có lớp: câu trống + "Nhập mã kích hoạt".
- **FR-07-033** Chỉ một dạng học viên → nhóm còn lại thu gọn, không biến mất (xem `onlineCollapsed`/`classCollapsed` trong tờ LoTrinh).
- **FR-07-034** Danh sách bài của khoá đang chọn: chặng → bài, trạng thái Đã xong / Đang học / Tiếp theo / Chưa làm. **Bài trong khoá online mở tự do** (tờ LoTrinh, HV-21): thứ tự và nhãn "Tiếp theo" chỉ là gợi ý; không có trạng thái "Chưa mở" do thứ tự. Riêng bài kiểm tra giữa chặng có thể có điều kiện (dòng đó ghi rõ điều kiện, màu đánh dấu) — có giữ điều kiện hay không: mục 10 câu 15.
- **FR-07-035** Học viên lớp chưa có khoá online mở `/course` thì vào thẳng `/course/assigned`.
- **FR-07-036** Ghi chú luồng chấm dưới mỗi nhóm: online: "AI chấm và trả nhận xét ngay"; lớp: "Speaking: AI chấm và trả ngay. Writing: AI chấm, giáo viên duyệt rồi mới trả" (00 mục 2 điểm 20; tờ ghi khác thì 00 thắng).
- **FR-07-037** (mới) Khoá online đã hết hạn: dòng khoá có nhãn "Đã hết hạn" và nút "Đăng ký lại"; Lộ trình giữ vị trí học; mở bài giảng bị chặn ở máy chủ (FR-07-042).

### 4.5 Trang bài giảng
- **FR-07-040** `/course/learn/[courseCode]/[lessonCode]`: breadcrumb `Lộ trình › <khoá> › Chặng k`, mục lục "Trong bài này", video, bài đọc Markdown, khối luyện tập, nút bài trước/bài sau.
- **FR-07-041** Video: nguồn `youtube` nhúng `youtube-nocookie.com`; nguồn `private_host` phát từ máy chủ riêng cấu hình được. Lưu vị trí xem mỗi 15 giây và khi rời trang; mở lại tiếp từ vị trí đó.
- **FR-07-042** Học viên không có quyền vào khoá → không đọc được nội dung bài (chặn ở backend), trang hiện lối "Xem khoá".
- **FR-07-043** **ĐÃ BỎ** — "bài sau mở khi bài trước xong". Lý do: bài trong khoá online mở tự do (tờ LoTrinh, HV-21; trang khoá của G05 ghi "mọi bài mở được"). Xem xong video đủ ngưỡng cấu hình và nộp khối luyện tập (nếu có) chỉ để ghi bài là "Đã xong"; API không trả `locked` vì thứ tự.
- **FR-07-044** (mới, khớp G04/G05) Khi có `course_lessons`, `GET /api/courses` trả `lesson_count` và `GET /api/courses/{slug}` trả `chapters:[{title, lessons:[{title, kind, duration_min, is_preview, preview_href}]}]` từ các bài `is_published` của khoá: G07-T19 thay thân `routers/courses_public.py::_outline_for(product)` của G04 (điểm ghép duy nhất, GOI-04 mục 5.9). Không lộ `body_md`, `video_ref` của bài không phải bài xem thử.

### 4.6 Phiếu kết quả
- **FR-07-050** Mọi phiếu có mục "Làm gì tiếp" với đúng ba lối: xem lại (chú thích/câu sai), làm lại (bài này), bài tiếp (bài giao kế tiếp → bài tiếp trong lộ trình → hub kỹ năng). Lối làm lại dùng lượt AI thì ghi "sẽ dùng 1 lượt chấm AI. Bạn còn X lượt".
- **FR-07-051** Dòng "Nguồn chấm": "AI chấm, trả ngay" hoặc "AI chấm, giáo viên duyệt rồi trả" kèm nguồn quyền (khoá online / lớp) và câu "Đây là điểm ước lượng…, không phải điểm thi." Speaking luôn là "AI chấm, trả ngay" kể cả bài của lớp; Speaking thi thử do giáo viên chấm từ bản ghi (ghi "Giáo viên chấm").
- **FR-07-052** Bài **Writing của lớp** đang chờ giáo viên duyệt: không hiện band, tiêu chí hay nhận xét; hiện tiến trình 4 bước (Đã nộp · AI đã chấm · Giáo viên đang duyệt · Trả kết quả) và câu báo sẽ có thông báo. Không có trạng thái chờ duyệt cho Speaking.
- **FR-07-053** Yêu cầu chấm lại: chọn một trong 5 lý do (tờ KetQuaWriting) + ghi chú ≤ 300 ký tự, bắt buộc khi chọn "Khác"; mỗi bài một lần; sau khi gửi hiện "Đã gửi yêu cầu chấm lại · <thời gian>", lý do, trạng thái; điểm giữ nguyên tới khi có kết quả mới; không trừ lượt.
- **FR-07-054** Overall band **chỉ có ở mock test được giao** (00 mục 2 điểm 22). Full test từng kỹ năng và mini test (đề tự chọn) không bao giờ có Overall. Mock test được giao: kỳ không đủ bốn kỹ năng → không có Overall; đủ bốn kỹ năng nhưng còn phần đang chấm → "Chưa có Overall: còn chờ chấm <kỹ năng>", từng phần hiện "Đang chấm" (G08); đề gọi bằng tên, không mã nội bộ.
- **FR-07-055** (mới) Khối "Hết lượt chấm" dùng chung (tờ GiaHanThemLuot): một component cho mọi nơi nhận 402 `insufficient_credits` hoặc số dư 0 (Hôm nay, phiếu kết quả, màn nộp Writing/Speaking của G08, `/tests`). Theo `credit_source` của G04: `class` → câu "Liên hệ giáo viên để được cấp thêm", không có nút đăng ký; `online` → nút "Đăng ký lại khoá · kèm N lượt" (N từ `ai_credits` của sản phẩm; đăng ký thêm lượt lẻ chưa mở — GOI-04 Q14) chỉ khi `can_renew=true`; `can_renew=false` (khoá còn hạn lâu hơn `ENROLL_RENEW_WINDOW_DAYS`) → không có nút đăng ký, câu "Liên hệ Aver để được cấp thêm lượt" kèm khối liên hệ của G05-T23 (phương án B (mặc định tạm 18/11, chờ anh Andy xác nhận)). Bài đang viết/ghi được lưu nháp, không trừ lượt.
- **FR-07-056** (mới) Mỗi dòng "việc nên sửa" trên phiếu Writing và Speaking có một liên kết học khi tìm được đích: bài Grammar Wiki (mục chữa lỗi), mục từ vựng của Thư viện, hoặc bài trong lộ trình. Không tìm được đích thì dòng không có liên kết (không dẫn về trang chung). Bảng ánh xạ lỗi → đích: 5.9.
- **FR-07-057** (mới, khớp G04 mục 5.16) Phiếu Speaking hiện đoạn được chấm phát âm: `sample.scope='segment'` → "Phát âm được chấm trên một đoạn trích N giây (từ m:ss đến m:ss); ba tiêu chí còn lại chấm trên toàn bộ bài." và nút "Nghe đoạn được chấm phát âm" phát bản ghi gốc từ `start_s` tới `end_s`; `full` → "Phát âm được chấm trên toàn bộ câu trả lời."; `not_sampled` → câu máy chủ trả, không hiện band phát âm cho câu đó. Bản ghi đã quá hạn giữ (tối đa 60 ngày) → vẫn hiện dòng chữ, ẩn nút nghe.
- **FR-07-058** (mới) Dòng lượt ở lối "làm lại": "sẽ dùng 1 lượt chấm AI. Bạn còn X lượt, Writing và Speaking dùng chung." Đơn vị theo G04: Writing 1 bài = 1 lượt; Speaking 1 bài Part 2, hoặc 1 cụm 2–3 câu Part 1 hay Part 3 = 1 lượt; full test Speaking mô phỏng = 3 lượt; full test Writing = 2 lượt (đã xác nhận, 00 mục 2 điểm 23); đoạn viết ngắn ở trang Kiến thức nền nộp cho AI nhận xét = 1 lượt (`feature='short_writing_feedback'` của G04; trang thuộc Thư viện, gói khác).

### 4.7 Tài khoản, tiến độ, trợ giúp, lần đầu vào
- **FR-07-060** `/account` (tờ TaiKhoan): hai nhóm riêng "Khoá online" và "Khoá của lớp" từ `GET /api/me/courses` (thứ tự: còn hạn, sắp hết hạn lên đầu, rồi đã hết hạn); khoá online có "còn N ngày", nút "Đăng ký lại" khi `can_renew`; khoá của lớp ghi "mã do admin cấp", không có nút "Đăng ký lại". "Lượt chấm AI còn lại": **một kho chung Writing và Speaking**, tách dòng theo nguồn `online` / `class` (`credits.by_kind`). Lịch sử lượt từ `GET /api/me/credits`, mới nhất trước, 20 dòng mỗi lần, nhãn dòng lấy `label_vi` của G04 (Cộng khi mở khoá, Cộng kèm mã lớp, Cộng khi lớp chuyển sang tính lượt, Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại, Lượt chuyển hết hạn bảo lưu, Cấp thêm bởi admin, Chấm bài, Hoàn lượt khi chấm lỗi, Điều chỉnh bởi admin, Hết hạn cùng khoá — G07 in đúng `label_vi`, không gõ lại; tờ TaiKhoan còn nhãn "Chuyển 50%…": không dùng), cột số dư sau dòng. **Lượt chuyển (00 mục 2 điểm 23):** khoá online có `credits.carry_balance > 0` thì hiện thêm một dòng dưới số dư: "Trong đó N lượt chuyển từ kỳ trước, dùng đến hết <ngày của `carry_expires_at`>."; `carry_balance = 0` hoặc thiếu trường → không có dòng này. Khoá online sắp hoặc đã hết hạn mà còn lượt: câu giải thích cạnh nút "Đăng ký lại" lấy từ `course-access-labels.mjs`: "Đăng ký lại thì toàn bộ lượt chưa dùng được chuyển sang kỳ mới và dùng thêm được N ngày; không đăng ký lại thì lượt hết hiệu lực khi khoá hết hạn." (N = `credit_carry_valid_days` của `GET /api/courses`; thiếu số thì bỏ vế "dùng thêm được N ngày"; không gõ cứng 60 hay 100). Nút "Nhập mã kích hoạt của lớp" (→ `/activate` của G05), "Đăng ký thêm khoá", "Đơn đăng ký của tôi" (→ `/account/orders` của G05).
- **FR-07-060b** (mới, 00 mục 2 điểm 23) Bài làm sau khi khoá hết hạn: khi `GET /api/me/courses` trả `content_visible_until` khác null, `/account` và `/progress` hiện một dòng "Bài đã nộp và nhận xét xem được đến hết <ngày>." (thay chỗ tờ TaiKhoan, GiaHanThemLuot ghi "thêm XXX ngày"; số ngày đọc từ `content_days_after_expiry`, không gõ cứng 45). Null → không có dòng. Câu về bản ghi âm giữ nguyên: tối đa 60 ngày kể từ lúc ghi, mốc nào tới trước thì áp. Phiếu hoặc lịch sử trả 410 `content_expired` → trang hiện "Bài này đã hết thời hạn xem." kèm lối về `/progress`, không hiện mã lỗi.
- **FR-07-061** `/progress`: mỗi kỹ năng một dòng: số bài đã làm, kết quả gần nhất (theo 5.6), liên kết lịch sử hiện có; mục tiêu band và ngày thi (sửa được, cùng chỗ lưu với "Lần đầu vào"); tab `quick-check` nếu đợt 9 được duyệt.
- **FR-07-062** `/help` (tờ TroGiupLanDau màn 1): câu hỏi thường gặp sáu nhóm cố định, tìm không phân biệt hoa thường và dấu; khối liên hệ dùng chung với trang pháp lý (component và `site-info` của G05-T23, không gõ lại giá trị).
- **FR-07-063** **ĐÃ BỎ** — công tắc "cho phép dùng bản ghi âm đã ẩn danh để cải thiện chấm bài" ở Tài khoản. Hoãn theo quyết định 18/11/2026 (tránh vấn đề pháp lý); nếu làm lại sau thì phải là lựa chọn tự bật và có rà pháp lý. Tờ TaiKhoan còn vẽ công tắc này: không dựng. Câu về lưu trữ trên trang chỉ ghi: bản ghi âm giữ tối đa 60 ngày rồi xoá.
- **FR-07-064** (mới) Khối "Phiên đăng nhập" ở Hồ sơ (tờ TaiKhoan): "Cách đăng nhập đang dùng" (Google nếu đã từng vào bằng Google, mã qua email; không có mật khẩu); "Lần đăng nhập gần đây" 3 dòng từ `GET /api/account/login-events?limit=3` (G04-T16, GOI-04 mục 5.13b): nhãn thiết bị (`device_label`, thiếu thì theo `device_kind`: "Máy tính", "Điện thoại", "Máy tính bảng", "Thiết bị khác"), giờ theo giờ Việt Nam, cách đăng nhập (`google` → "Google", `email_code` → "Mã qua email", `unknown` → không ghi), kết quả theo `outcome`: `signed_in` → "Đã đăng nhập", `pending` → "Chờ chọn thiết bị", `claimed` → "Đã chuyển sang thiết bị này", `claim_refused_timed` → "Bị từ chối: bạn đang làm bài có giờ", `displaced` → "Đã đăng xuất vì đăng nhập ở thiết bị khác", `signed_out_all` → "Đã đăng xuất khỏi mọi thiết bị"; dòng `is_current` ghi thêm "Thiết bị này"; giá trị `outcome` lạ → chỉ hiện thiết bị và giờ. Cột "nơi gần đúng" **ẩn** vì G04 trả `approx_location` luôn null (không lưu địa chỉ mạng). `enabled=false` (cờ `single_session_learners` tắt), `items` rỗng, API lỗi hoặc G04-T16 chưa merge → ẩn cả khối con này, phần còn lại của Hồ sơ vẫn hiện; nút "Đăng xuất khỏi mọi thiết bị" mở hộp hỏi lại là **component của G05-T20** (gọi `POST /api/account/sessions/revoke-all`; có bài có giờ → hiện `deferred_timed`).
- **FR-07-064b** (mới, 00 mục 2 điểm 23) "Đổi email đăng nhập" ở Hồ sơ (tờ TaiKhoan: "Xác nhận bằng mã 6 số gửi tới email mới; đổi xong có thư báo về email cũ."): G07 **gắn** thành phần `ChangeEmail` của G05-T24 (GOI-05 mục 5.6b; route `POST /auth/email-change/request`, `POST /auth/email-change/verify`) vào khối "Email đăng nhập"; không dựng lại luồng, không gọi thẳng hai route. Đổi xong: trang đọc lại `/auth/me` để hiện email mới. G05-T24 chưa merge hoặc cờ `email_code_login` tắt → khối chỉ hiện email hiện tại, không có nút "Đổi email đăng nhập".
- **FR-07-065** (mới) "Lần đầu vào" (tờ TroGiupLanDau màn 2; thay `/onboarding` và thay màn chào `/welcome` đã bỏ của G05): hiện một lần sau lần đăng nhập đầu tiên (`onboarding_completed=false`), trừ khi người dùng đến với `next` hợp lệ (G05 FR-05-031). Mỗi bước là một trang thường, không tour, không lớp phủ. Bước mục tiêu là tuỳ chọn; bước chọn hướng chọn sẵn theo dữ liệu (có quyền khoá online → "đã đăng ký khoá online"; có lớp → ẩn bước và về bài được giao; không có gì → "chưa có khoá nào"). "Bỏ qua" ở bước nào cũng về `/home` và không hiện lại. Chạy được với tài khoản `is_active=false` (T26).
- **FR-07-066** **ĐÃ BỎ** — ô hỏi đồng ý dùng bản ghi âm ở "Lần đầu vào". Hoãn theo quyết định 18/11/2026; không gọi API đồng ý nào (G04 đã bỏ mục 5.17 và G04-T14).


## 5. Hợp đồng kỹ thuật

### 5.1 Bảng đổi đường dẫn (16, thêm dòng 17 `/exam` ngày 18/11)

Quy ước: giữ **nhóm route** và toàn bộ file component, chỉ dời **thư mục đoạn URL**. Ví dụ `app/(authed)/course-exercises/` → `app/(authed)/course/exercises/`. Lý do: giữ nguyên layout, stylesheet, thứ tự cascade và phần lớn đường dẫn import; giảm số test vỡ.

| # | Cũ | Mới | Thư mục hiện tại → mới | Đợt | Ghi chú |
|---|---|---|---|---|---|
| 1 | `/flashcards` | `/vocabulary/flashcards` | `(authed-flashcards)/flashcards` → `(authed-flashcards)/vocabulary/flashcards` | 1 | Cờ `flashcard_enabled` vẫn áp |
| 2 | `/flashcard-study` | `/vocabulary/flashcards/study` | `(flashcard-study)/flashcard-study` → `(flashcard-study)/vocabulary/flashcards/study` | 1 | Hybrid công khai (`stack=wiki:…`, `examlist:…`); link chia sẻ phải mở được |
| 3 | `/d1-exercise` | `/vocabulary/fill-in` | `(authed-d1-exercise)/d1-exercise` → `(authed-d1-exercise)/vocabulary/fill-in` | 2 | |
| 4 | `/course-exercises` | `/course/exercises` | `(authed)/course-exercises` → `(authed)/course/exercises` | 3 | Query `bank`, `view`, `item` giữ nguyên |
| 5 | `/advanced-vocabulary` | `/course/vocabulary` | `(authed-advanced-vocab)/advanced-vocabulary` → `(authed-advanced-vocab)/course/vocabulary` | 3 | Query `bank`, `item` |
| 6 | `/grammar-lessons/assigned` | `/course/grammar-lesson` | `(authed)/grammar-lessons/assigned` → `(authed)/course/grammar-lesson` | 3 | Query `assignment_item` |
| 7 | `/grammar-checkup` | `/course/grammar-checkup` | `(authed)/grammar-checkup` → `(authed)/course/grammar-checkup` | 4 | Sửa luôn quy tắc 307 `/grammar-checkup/review` → `/course/grammar-checkup` và thêm `/course/grammar-checkup/review` → `/course/grammar-checkup` |
| 8 | `/grammar-checkup/review/:routeId` | `/course/grammar-checkup/review/:routeId` | thư mục con `review/[routeId]` đi theo #7 | 4 | Query `session` |
| 9 | `/full-test-result` | `/speaking/full-test/result` | `(authed-full-test-result)/full-test-result` → `(authed-full-test-result)/speaking/full-test/result` | 5 | Query `p1`, `p2`, `p3`, `session_id`. Sửa `practice.js` L246 và `admin-mock-reviews.tsx` |
| 10 | `/speaking/result` | `/tests/mock/speaking-report` | `(authed-speaking-result)/speaking/result` → `(authed-speaking-result)/tests/mock/speaking-report` | 6 | Query `sitting` |
| 11 | `/mock/result` | `/tests/mock/result` | `(authed-mock-result)/mock/result` → `(authed-mock-result)/tests/mock/result` | 6 | Query `sitting` |
| 12 | `/full-test` | `/tests` | `(authed-full-test)/full-test` → `(authed-full-test)/tests` | 7a | `/tests` lúc đầu là trình chọn kỳ thi hiện có; T16 làm giàu thành hub |
| 13 | `/mock-exam` | `/tests/mock/session` | `(authed-mock-exam)/mock-exam` → `(authed-mock-exam)/tests/mock/session` | 7b | **high-risk**. Query `code`, `sitting`. Sửa `exam-language-bridge.tsx` L7, `practice.js` L3717 |
| 14 | `/my-class` | `/course/assigned` (đề xuất) | `(authed-my-class)/my-class` → `(authed-my-class)/course/assigned` | 8 | Báo cáo 12 ghi `/course?tab=assigned`; xem Cần quyết #1. Cần `/course` có sẵn (T15) |
| 15 | `/quiz` | chờ quyết (báo cáo 12: `/vocabulary/quick-check`) | `(authed-quiz-player)/quiz` | 9 | Player dùng chung cho Grammar: wiki công khai link `/quiz?bank=` (`grammar/exercises/grammar-exercises-behavior.tsx` L60, `grammar/[category]/[slug]/article-behavior.tsx` L395). Cần quyết #2 |
| 16 | `/quiz/progress` | chờ quyết (báo cáo 12: `/progress?tab=quick-check`) | `(authed-quiz-progress)/quiz/progress` | 9 | Cần `/progress` (T17) |
| 17 | `/exam` | `/tests` | không dời thư mục; chuyển hướng 307 ở `next.config.ts` (chạy trước trang), 308 ở T24 | 7a (G07-T12a) | Thêm 18/11 theo 00 mục 2 điểm 22 |

Không đổi: `/exercises` (đã là trang chuyển hướng, giữ đích), `/listening/lessons/[lessonId]`, `/reading` (đang `redirect('/reading/vocab')`, đổi thành hub thuộc T25), `/practice/session`, `/result`, `/writing/**`, `/listening/**`, `/reading/**` còn lại, `/vocabulary/hub|sets|study|learn|practice|exam`, `/profile`, `/onboarding`.

Từ dành riêng dưới `/course/`: `assigned`, `class`, `exercises`, `vocabulary`, `grammar-lesson`, `grammar-checkup`, `learn`. Bài học dùng `/course/learn/[courseCode]/[lessonCode]` để mã khoá không bao giờ trùng một từ dành riêng. Dưới `/vocabulary/`: `flashcards`, `fill-in`, `quick-check` — báo G06 nếu G06 định đặt route động `/vocabulary/[slug]` (sẽ bị các tên này che).

**Cơ chế chuyển hướng.** Viết literal trong `frontend/next.config.ts`, khối `redirects()`, ngay sau ba quy tắc tạm thời hiện có, đúng dạng một dòng để `route-ownership-check.mjs` đọc được:
```ts
// G07 — đổi đường dẫn học viên (LEARNERNAV). permanent:false trong giai đoạn chuyển (xem T24).
{ source: '/flashcards', destination: '/vocabulary/flashcards', permanent: false },
{ source: '/grammar-checkup/review/:routeId', destination: '/course/grammar-checkup/review/:routeId', permanent: false },
```
- Không dùng `has`/`missing`; query cũ tự đi theo. `CHƯA KIỂM` trên bản Next của repo: đích có sẵn query (`/progress?tab=quick-check`) gộp với query cũ thế nào → kiểm bằng `npm run build && npx next start -p 3100` rồi `curl -sI 'http://localhost:3100/quiz/progress?skill_area=vocab'`, xem dòng `location:`. Đọc `frontend/node_modules/next/dist/docs/` mục redirects trước (cảnh báo trong `frontend/AGENTS.md`).
- Không đưa các quy tắc này vào module riêng rồi spread: `configSources()` chỉ đọc chữ trong `next.config.ts`, đặt ở module khác là mất kiểm va chạm.
- Chuyển hướng chạy trước proxy và trước trang, áp cho **mọi người dùng** — không bật/tắt theo cờ được.

### 5.2 Danh mục trang (nạp vào module của G03)

Mỗi trang G07 chạm: `{ url, section, parent, kind }`. `section` ∈ `today|course|practice|tests|library`.

| Trang | section | parent | kind |
|---|---|---|---|
| `/home` | today | — | hub |
| `/course`, `/course/assigned`, `/course/class` | course | — (là thẻ của Lộ trình) | hub |
| `/course/learn/[courseCode]`, `/course/learn/[courseCode]/[lessonCode]` | course | `/course` | child |
| `/course/exercises`, `/course/vocabulary`, `/course/grammar-lesson`, `/course/grammar-checkup` | course | `/course/assigned` | deep-link-only (cần query) |
| `/course/grammar-checkup/review/[routeId]` | course | `/course/grammar-checkup` | deep-link-only |
| `/practice` | practice | — | hub |
| `/speaking`, `/writing/dashboard`, `/listening`, `/reading` | practice | `/practice` | hub |
| `/result`, `/writing/result`, `/speaking/full-test/result`, `/listening/review`, `/reading/review`, `/listening/programmes/result/[attemptId]`, `/listening/exercise-book`, `/listening/exercise-book/attempts/[attemptId]/review` | practice | hub kỹ năng tương ứng | child (có thanh điều hướng — hiện 6 trang trong số này đang trần) |
| `/practice/session`, `/listening/test/session`, `/reading/exam/session`, `/listening/dictation/session`, `/listening/programmes/form/[testId]`, `/listening/exercise-book/tests/[testId]` | practice | hub kỹ năng | focus (G08 làm thanh) |
| `/tests` | tests | — | hub |
| `/tests/mock/session` | tests | `/tests` | focus |
| `/tests/mock/result`, `/tests/mock/speaking-report` | tests | `/tests` | child |
| `/vocabulary/**` signed-in, `/grammar/**`, `/library/**` | library | `/library` | child |
| `/progress`, `/account`, `/profile`, `/help` | (không mục nào sáng) | — | account |
| `/surveys/[surveyId]` (GOI-13 phần A) | (không mục nào sáng; trang tập trung, không có thanh 5 mục) | `/home` | focus |
| `/practice/close-reading`, `/practice/close-reading/[module]/[item]`, `/practice/close-reading/[module]/summary` (GOI-13 phần D) | practice | `/practice` | hub · focus · child |
| trang "Lần đầu vào" (thay `/onboarding`; đường dẫn mới `/start`, `/onboarding` chuyển hướng 307 về đó — tên đường dẫn là mặc định tạm, mục 10 câu 19) | — | `/home` | trang thường trong khung học viên, không đánh dấu mục nào (tờ TroGiupLanDau màn 2) |
| `/notifications` (GOI-11 T11) | (không mục nào sáng) | `/home` | account |

`/profile` còn được gắn khối `MyTestimonials` ("Nhận xét của tôi", mục Quyền riêng tư) do GOI-13 G13-A11 làm (sửa 18/11 theo GOI-13); ba dòng `/surveys/[surveyId]` và `/practice/close-reading*` ở trên thuộc GOI-13.

Khi G03 chưa có trang đích (ví dụ `/library` của G06 chưa merge), mục nav vẫn hiện nhưng trỏ tới trang tạm hiện có: Thư viện → `/grammar`. Ghi rõ trong PR.

### 5.3 API `GET /api/student/today`

- File: thêm route vào `backend/routers/student_home.py` (prefix `/api/student` sẵn có); logic ở `backend/services/student_today.py` (mới); model `backend/models/student_today.py` (mới), khai `response_model`. **Route này được thêm vào `ACTIVATION_EXEMPT_ROUTES`** (T26) với lý do "tài khoản chưa có khoá cần trang Hôm nay; route chỉ đọc dữ liệu của chính người gọi": với `is_active=false` các phần `next_lesson`, `assigned`, `resume` trả rỗng mà không truy vấn bảng bài học/bài làm. Cổng một phiên của G04 (`session_gate.ensure_current`) vẫn áp: 409 `session_not_current` → frontend mở lại màn 8a/8b của G05-T20.
- Chạy các phần song song theo mẫu `get_home_summary_concurrent` (mỗi phần một client `thread_supabase_admin`, lọc tường minh theo `user_id`/`student_id`), phần lỗi vào `degraded`.
```json
{
  "student": {"name": "Minh Anh"},
  "next_lesson": null | {
    "course_code": "C1", "course_name": "…", "stage_no": 2, "lesson_code": "B14", "lesson_no": 14,
    "lesson_count": 40, "title": "…", "video_seconds": 1084, "practice_items": 12,
    "resume_seconds": 372, "href": "/course/learn/C1/B14"
  },
  "assigned": [ { ...đúng dạng một phần tử `assignments` của /api/class/my-assignments... } ],
  "assigned_total_open": 3,
  "resume": [ {"kind": "listening|reading|speaking|dictation|writing", "title": "…", "progress": {"done": 1, "total": 4} | null,
               "href": "/listening/…", "expires_at": "2026-11-17T09:00:00Z"} ],
  "state": "learning|first_day|order_pending|no_course",
  "banner": null | "expiring|expired|out_of_credits",
  "access": [ ...nguyên dạng một phần tử `items` của GET /api/me/courses (G04 mục 5.9): kind, source, state, expires_at, days_left, can_renew, credits... ],
  "credits": null | {"total": 0, "by_kind": {"online": 0, "class": 0}},
  "orders_open": [ {"order_code": "AVER-…", "status": "awaiting_transfer|transfer_reported|needs_info", "product_title": "…", "supplement_by": null} ],
  "goal": null | {"target_band": 6.5, "exam_date": "2027-03-14" | null, "weeks_left": 17 | null},
  "new_results": [ {"kind": "writing|speaking", "title": "…", "returned_at": "…", "href": "/writing/result?essay_id=…"} ],
  "repeat_error": null | {"label": "…", "count": 4, "of": 5, "review_href": "/grammar/…#chua-loi" | null, "total_errors": 4},
  "trial_today_left": null | 3,
  "open_surveys": [ {"survey_id": "…", "course_name": "…", "closes_at": "…"} ],
  "mock_exams": [ {"exam_id": "…", "title": "…", "mode": "live|self_paced", "state": "…", "closes_at": "…", "total_minutes": 165, "href": "/tests/…"} ],
  "degraded": ["credits"]
}
```
- `assigned`: gọi `_visible_assignments(student, now, cohort_ids)` của `routers/class_student.py` qua một hàm bọc trong service (không dời, không sửa hàm gốc); lọc chưa nộp; sắp quá hạn trước rồi hạn gần nhất; cắt 5. Frontend dựng href bằng chính hàm của `frontend/lib/my-class-model.mjs` (cùng dạng dữ liệu, không viết bộ dựng URL thứ hai).
- `resume`: đọc 5 bảng có `resume_expires_at > now()` và trạng thái đang làm của người đó; cắt 4, mới nhất trước. `CHƯA KIỂM`: tên cột trạng thái và cột tiêu đề từng bảng → `grep -n "resume_expires_at\|status" backend/migrations/224_active_player_resume_ttl.sql` và đọc migration tạo từng bảng.
- `next_lesson`: `null` cho tới khi T18 có bảng; sau T18 lấy bài đầu tiên chưa xong của khoá online có quyền còn hạn và mở gần nhất.
- `access`, `credits`, `orders_open`: gọi service của G04 (`GET /api/me/courses`, `GET /api/enrollment-orders/me` lọc đơn mở); chưa có thì `[]`/`null` và **không** đưa vào `degraded` (chưa có ≠ lỗi). `credits` là **một kho chung** (không tách Writing/Speaking), tách theo nguồn `online`/`class`.
- `state`: theo thứ tự FR-07-019; `first_day` = có quyền khoá online còn hạn và chưa có dòng tiến độ bài học nào. `banner`: `expiring` khi có quyền online `can_renew` và chưa hết hạn; `expired` khi mọi quyền online đã hết hạn; `out_of_credits` khi `credits.total = 0` và người đó có nguồn lượt.
- `goal`: mục tiêu band và ngày thi của học viên (cùng chỗ lưu với Tiến độ). `CHƯA KIỂM` cột hiện có: `grep -n "target_band\|exam_date" backend/migrations/013_extend_user_profile.sql backend/routers/auth.py | head`; chưa có cột ngày thi → thêm trong migration của T18 hoặc migration riêng trong dải 420–439, ghi trong spec LEARNERCORE.
- `new_results`: bài Writing `delivered` và phiên Speaking có kết quả kể từ `users.today_seen_at` (cột mới, cập nhật khi `/api/student/today` trả xong — `CHƯA KIỂM` có cột tương đương chưa); tối đa 2. Bài kiểm tra khoá ở chế độ công bố không vào đây (GOI-11 sinh thông báo riêng).
- `repeat_error`: lỗi số 1 của "Sổ lỗi cá nhân" (GOI-12 G12-A04, `today_block`; chưa mở — 00 mục 2 điểm 23). Route này **chỉ đọc** qua một hàm ghép duy nhất `_repeat_error_for(user_id) -> dict | None` trong service của T13; ở PR T13 hàm trả `None` (GOI-12 chưa có). Khi GOI-12 merge, PR của GOI-12 (hoặc một PR nhỏ của G07 ngay sau) nối hàm này vào service sổ lỗi theo đúng tên hàm và API của GOI-12; file này không đặt tên bảng hay API cho sổ lỗi. Hàm lỗi hoặc chưa đủ dữ liệu → `null` (không đưa vào `degraded`), giao diện ẩn khối. Khung trả về giữ như trên (`label`, `count`, `of`, `review_href`, `total_errors`); GOI-12 trả khung khác thì hàm ghép chuyển đổi, và ghi chỗ khác trong PR.
- `open_surveys`: khảo sát sau khoá đang mở của lớp người đó (mặc định `[]`), do GOI-13 cấp: hàm `open_surveys_for(user_id)` ở G13-A05, thẻ Hôm nay ở G13-A11; G07 chỉ chừa trường, không tự làm (sửa 18/11 theo GOI-13).
- `mock_exams`: kỳ thi được giao cho người đó còn trong khoảng mở, từ API học viên của kỳ thi (G08-T22); `[]` khi chưa có (thêm 18/11 theo rà soát, tờ HomNayTrangThai mục 7a).
- `trial_today_left`: chỉ khi `state='no_course'`; lấy từ `services/trial_caps.py` của GOI-11 (tổng còn trong trần ngày); chấm thử tạm dừng, không đủ điều kiện, hoặc GOI-11 chưa merge → `null`.
- Quá hạn: dùng `services/learner_overdue.py` của GOI-11 khi đã có (cùng định nghĩa với thẻ "N quá hạn"); chưa có thì lọc `is_missing` của `_decorate` như bản 16/11.
- Sau khi thêm model: sinh lại `frontend/types/api.d.ts` (lệnh ở mục 7).

### 5.4 API bài học (sau T18)
- `GET /api/course/{course_code}/lessons` → `{course, stages:[{stage_no, title, lessons:[{lesson_code, lesson_no, title, video_seconds, practice_items, state: "done|current|next|todo"}]}]}` — không có `locked` theo thứ tự (FR-07-043 ĐÃ BỎ); bài kiểm tra giữa chặng có thể có `gate: {"text_vi": "…"}` nếu giữ điều kiện (mục 10 câu 15).
- `GET /api/course/{course_code}/lessons/{lesson_code}` → nội dung bài (`body_md`, video `{source, ref, seconds}`, `practice: {bank_id|null}`, `prev`, `next`). 403 khi không có quyền (thông điệp tiếng Việt, không mã lỗi trên giao diện).
- `PATCH /api/course/lessons/{lesson_id}/progress` body `{video_position_seconds:int ≥0, completed?:bool}`; idempotent, chỉ tăng `video_position_seconds` khi lớn hơn giá trị cũ hoặc `completed` chuyển true.
- Router mới `backend/routers/course_learner.py`, prefix `/api/course`, gắn vào `main.py` cùng `_ACTIVE_LEARNER` như các router học viên khác.
- Hàm đọc cho trang khoá công khai (FR-07-044): `services/course_outline.py::public_outline(course_id) -> {"lesson_count": int, "chapters": [...]}`; T19 nối vào `routers/courses_public.py::_outline_for` của G04 (sửa đúng thân hàm đó, kèm test; G04-T03 chưa merge thì để hàm sẵn và nối sau). `kind` suy từ bài: có `video_source` → `video`; có `practice_bank_id` mà không video → `practice`; còn lại → `reading`. `duration_min = ceil(video_seconds/60)`. `preview_href` chỉ có khi `is_preview`.

### 5.5 Bảng (T18, migration high-risk; số trong dải 420–439 đã cấp ở `01-KE-HOACH-TONG.md` mục 6)
```
course_lessons
  id uuid pk default gen_random_uuid()
  course_id uuid not null references courses(id)
  stage_no int not null check (stage_no > 0)
  stage_title text not null
  lesson_no int not null check (lesson_no > 0)
  lesson_code text not null            -- 'B14'
  title text not null
  summary text
  body_md text
  video_source text check (video_source in ('youtube','private_host'))   -- null = bài không có video
  video_ref text                       -- id YouTube hoặc khoá/đường dẫn trên máy chủ riêng
  video_seconds int check (video_seconds is null or video_seconds > 0)
  practice_bank_id uuid references quiz_banks(id)   -- null = không có khối luyện
  is_published boolean not null default false
  is_preview boolean not null default false         -- bài xem thử trên trang khoá công khai (G05 FR-05-007)
  created_at/updated_at timestamptz (trigger update_updated_at_column như mig 175)
  unique (course_id, lesson_code), unique (course_id, lesson_no)
  check ((video_source is null) = (video_ref is null))

course_lesson_progress
  user_id uuid not null references users(id) on delete cascade
  lesson_id uuid not null references course_lessons(id) on delete cascade
  video_position_seconds int not null default 0 check (>= 0)
  completed_at timestamptz
  updated_at timestamptz not null default now()
  primary key (user_id, lesson_id)
```
- RLS bật cả hai bảng. `course_lessons`: admin toàn quyền (`public.is_current_user_admin()`); học viên **không** có policy đọc trực tiếp — backend đọc bằng service role sau khi kiểm quyền (giữ đúng kiểu hiện có, tránh RLS phụ thuộc bảng `entitlements` của G04). `course_lesson_progress`: học viên SELECT dòng của mình; ghi qua backend.
- Có file rollback trong `backend/migrations/rollback/` theo mẫu các migration gần nhất, và dòng trong `backend/migrations/forward-policy.tsv` nếu README yêu cầu (`CHƯA KIỂM` — đọc README trước).
- Không thêm `course_lesson_id` vào `class_lessons` trong gói này (Cần quyết #5).

### 5.6 Quy tắc hiện band (áp cho mọi khối G07)
| Kỹ năng | Hiện band khi | Thiếu thì |
|---|---|---|
| Writing | ≥ 1 bài `delivered` có `overall_band_score` | "chưa có bài đã chấm" |
| Speaking | ≥ 1 buổi đã chấm có band | "chưa có buổi đã chấm" |
| Listening/Reading | ≥ 1 đề đủ 40 câu đã nộp | "chưa đủ bài" + "Cần ít nhất một đề đủ 40 câu để có band <kỹ năng>." Bài ngắn chỉ ghi "Đúng a trên b câu", b > 0 |
| Overall | **chỉ ở mock test được giao** có đủ 4 kỹ năng và cả 4 đã có band | "Chưa có Overall: còn chờ chấm …"; kỳ không đủ bốn kỹ năng, full test từng kỹ năng, mini test: không có dòng Overall |
Không bao giờ hiện "0/0", "—" đứng một mình, mã đề nội bộ.

### 5.7 Chấm lại (T21, migration high-risk)
```
ALTER TABLE essay_regrade_requests
  ADD COLUMN reason_code text CHECK (reason_code IN
     ('score_lower','feedback_mismatch','ai_false_flag','wrong_submission','other')),
  ADD COLUMN note text CHECK (note IS NULL OR char_length(note) <= 300);
-- Ràng buộc mới: bản ghi có reason_code thì không bị buộc 50–500 ký tự.
ALTER TABLE essay_regrade_requests DROP CONSTRAINT essay_regrade_reason_length;
ALTER TABLE essay_regrade_requests ADD CONSTRAINT essay_regrade_reason_shape CHECK (
  (reason_code IS NULL AND char_length(reason) BETWEEN 50 AND 500)
  OR (reason_code IS NOT NULL AND char_length(reason) BETWEEN 1 AND 500
      AND (reason_code <> 'other' OR char_length(coalesce(note,'')) > 0)));
```
- `reason` vẫn NOT NULL: lưu nhãn tiếng Việt của lý do (để màn admin cũ đọc được ngay mà không sửa).
- `POST /api/writing/essays/{essay_id}/regrade-request` nhận **một trong hai** dạng: cũ `{reason}` (50–500) hoặc mới `{reason_code, note?}`. Trả 422 cho dạng lẫn lộn. 409 giữ nguyên ý nghĩa. Thông điệp 409 đổi "Em đã gửi…" → "Bạn đã gửi…".
- `GET …/regrade-request` trả thêm `reason_code`, `note`.
- `admin_writing_regrade.py` list/detail trả thêm hai cột; màn admin hiện "Lý do: <nhãn> · Ghi chú: <note>". Không đổi luồng accept/reject.

### 5.8 Cờ giao diện mới
- Kiểm trước: G03 đã định nghĩa cờ cho khung mới chưa (`grep -rn "learner_v2\|shell_v2\|av2" backend/services frontend/lib`). Có thì dùng đúng cờ đó, không tạo cờ thứ hai.
- Chưa có thì T05 tạo theo tiền lệ hai khoá: `learner_v2_enabled = runtime_flags('learner_v2_all', default=False) OR (feature_flags.learner_v2 is True AND runtime_flags('learner_v2', default=False))`. `runtime_flags('learner_v2')` = công tắc tắt khẩn; `learner_v2_all` = bật cho mọi người.
- `AuthMeResponse` thêm `learner_v2_enabled: bool = False`. Frontend đọc `me.learner_v2_enabled === true`, **không** thêm vào danh sách bắt buộc của `normalizeAuthMe` (frontend Vercel có thể lên trước backend Railway; thêm vào danh sách là mọi người bị coi như mất phiên).
- Bật theo người: `POST /admin/users/{user_id}/learner-v2-flag` chép mẫu `vocab-flag` (L5065). "Theo nhóm/lớp": không có cơ chế sẵn; làm bằng script chạy vòng các thành viên lớp (Cần quyết #13).
- Cờ chỉ quyết định giao diện (cây React nào được vẽ). Chuyển hướng 5.1 không theo cờ.

### 5.9 Mở `/home` cho tài khoản chưa kích hoạt, khối dùng chung (T26, T27)
- **Hiện trạng:** `AuthedShell` với `activationGate` đẩy tài khoản `is_active=false` về `/login`; cổng backend `require_active_learner` chặn mọi route học viên ngoài `ACTIVATION_EXEMPT_ROUTES`. G05 đang dùng cờ tạm `AVER_HOME_OPEN_TO_INACTIVE` và đích tạm `/courses` (GOI-05 mục 10 câu 13).
- **T26:** (1) layout của `/home`, trang "Lần đầu vào", `/account`, `/profile`, `/help` không dùng `activationGate` khi cờ `learner_v2` bật cho người đó — vẫn bắt buộc đăng nhập; (2) thêm `GET /api/student/today` vào `ACTIVATION_EXEMPT_ROUTES` kèm lý do và cập nhật `tests/test_activation_gate_inventory.py`; các route `/api/me/*`, `/api/enrollment-orders/*`, `/api/account/session*` đã được G04 miễn; (3) mọi trang học viên khác (Lộ trình, Luyện tập, phòng thi) giữ cổng: tài khoản chưa kích hoạt bấm vào thấy trang "Cần có khoá" với hai lối "Xem các khoá" và "Nhập mã kích hoạt", không bị đăng xuất; (4) khi T26 đã merge và bật, G05 gỡ cờ tạm `AVER_HOME_OPEN_TO_INACTIVE` (việc của G05, ghi trong PR để báo).
- **`CreditsEmptyNotice`** (`frontend/components/ui/credits-empty-notice.tsx`, T27): props `source: 'online'|'class'`, `renewHref?`, `renewCredits?`; câu chữ theo tờ GiaHanThemLuot. G08 dùng lại ở màn nộp Writing/Speaking khi nhận 402 `insufficient_credits` (đọc `credit_source` trong `detail`).
- **Liên kết học cho "việc nên sửa"** (T27): `frontend/lib/fix-link-model.mjs::fixLink(fix, ctx) -> {href, label} | null`; đầu vào là mã lỗi/nhãn tiêu chí backend đã trả trên phiếu (`CHƯA KIỂM` trường nào mang mã lỗi ở phiếu Writing và Speaking: đọc `writing-top-fixes.tsx` và payload `/result`); bảng ánh xạ mã lỗi → `{grammar_slug, anchor}` hoặc mục từ vựng là dữ liệu trong `frontend/lib/fix-link-map.json`, bắt đầu với các mã có bài Grammar Wiki tương ứng; không có ánh xạ → `null` (không hiện liên kết). Không gọi AI để sinh liên kết.

## 6. Nhiệm vụ (theo thứ tự phụ thuộc)

Bảng tổng:

| Mã | Việc | Lớp | Phụ thuộc | Phiên | Khó |
|---|---|---|---|---|---|
| G07-T01 | Spec LEARNERNAV | spec | — | 1 | 2 |
| G07-T02 | Spec LEARNERCORE | spec | — | 1 | 2 |
| G07-T03 | Spec COURSELESSON | spec | — | 1 | 3 |
| G07-T04 | Spec RESULTSHEET | spec | — | 1 | 3 |
| G07-T05 | Cờ `learner_v2` | feature | T02 duyệt | 1 | 3 |
| G07-T06 | Đợt 1: thẻ từ (#1–2) | feature | T01 | 1 | 3 |
| G07-T07 | Đợt 2: điền từ (#3) | feature | T06 | 1 | 2 |
| G07-T08 | Đợt 3: bài lớp (#4–6) | feature | T07 | 2 | 4 |
| G07-T09 | Đợt 4: Grammar check-up (#7–8) | feature | T08 | 1 | 3 |
| G07-T10 | Đợt 5: kết quả Speaking full test (#9) | feature | T09 | 1 | 3 |
| G07-T11 | Đợt 6: phiếu thi thử (#10–11) | feature | T10 | 1 | 3 |
| G07-T12a | Đợt 7a: `/full-test` → `/tests` (#12) | feature | T11 | 1 | 3 |
| G07-T12b | Đợt 7b: `/mock-exam` (#13) | high-risk | T12a, spec duyệt rollout | 2 | 4 |
| G07-T13 | API `/api/student/today` (thêm `state`, `banner`, `orders_open`, `goal`, `new_results`, `repeat_error`) | feature | T02 | 2 | 3 |
| G07-T14 | Hôm nay mới, năm trạng thái (Main, HomNayTrangThai, Mobile) | feature | G03, T05, T13 | 3 | 4 |
| G07-T15 | Lộ trình `/course` + Đợt 8 (#14) | feature | G03, T08, T13 | 2 | 4 |
| G07-T16 | Hub `/practice`, `/tests` (đề tự chọn + khối "Mock test được giao") | feature | G03, T12a; G09-T31 cho khối được giao | 2 | 3 |
| G07-T17 | `/account`, `/progress`, `/help`, `/profile`, "Lần đầu vào" (TroGiupLanDau) | feature | G03, G04 API, G05-T20 (component phiên), G05-T23 | 3 | 3 |
| G07-T18 | Migration bài học | high-risk | T03 duyệt, G04 `entitlements` | 1 | 4 |
| G07-T19 | API + trang bài giảng + video | high-risk | T18, G06/CSP | 2 | 4 |
| G07-T20 | Khung phiếu + Writing | feature | G03, T04 | 2 | 3 |
| G07-T21 | Chấm lại có lý do | high-risk | T20 | 2 | 4 |
| G07-T22 | Phiếu Speaking (đoạn chấm phát âm) và thi thử | feature | T20, T11; G04-T13 | 2 | 3 |
| G07-T23 | Đợt 9: Quick Check (#15–16) | feature | Cần quyết #2, T17 | 1 | 3 |
| G07-T24 | 307 → 308, dọn cây Home cũ | small | anh Andy nói, cờ 100% | 1 | 2 |
| G07-T25 | 4 hub kỹ năng theo mẫu (tờ HubKyNang, LuyenTap, DanhSachDe đã có) | feature | G03 | 4 | 3 |
| G07-T26 | (mới) Mở `/home`, "Lần đầu vào", `/api/student/today` cho tài khoản `is_active=false` | high-risk (auth) | T05, T13; G04-T03 | 1 | 4 |
| G07-T27 | (mới) Khối "Hết lượt chấm" dùng chung + liên kết học ở "việc nên sửa" | feature | T20; G04-T07/T08 (mã lỗi 402) | 2 | 3 |
| G07-T28 | (mới 18/11 tối) Script nạp bài học khoá online + thẻ Chương trình chỉ đọc | feature | T18; G09-T36 (lô nhập) | 2 | 3 |
| G07-T29 | (mới 18/11 tối) Trang bài học thử công khai (tờ BaiHocThu) | feature | T19, T28; G05 khung công khai | 2 | 3 |
| G07-T30 | (mới 18/11 tối) `/course/assigned` theo tờ LoTrinhBaiDuocGiao, thẻ "Buổi học và tài liệu lớp" (LopBuoiHoc), "Tự luyện bài này" (2 PR) | feature; route tự luyện high-risk | T15; G04-T03 | 3 | 4 |
| G07-T31 | (mới 18/11 tối) Trang xem lại `/listening/review`, `/reading/review` (tờ XemLaiBaiLam) | feature | G03, T05 | 2 | 3 |
| | **Tổng: 32 nhiệm vụ, 33 PR** | | | **54** | |

Tối 18/11 (rà soát chéo): thêm T28 (2), T29 (2), T30 (3, 2 PR), T31 (2) — 28 → 32 nhiệm vụ, 45 → 54 phiên. So với bản 16/11 (26 nhiệm vụ / 38 phiên): thêm T26 (1), T27 (2); T13 +1, T14 +1, T16 +1, T17 +1. Không nhiệm vụ nào bị bỏ; hai yêu cầu con ĐÃ BỎ ghi ở FR-07-043 (khoá tuần tự) và FR-07-063/066 (đồng ý dùng bản ghi âm — hoãn).

### G07-T01 — Spec LEARNERNAV (điều hướng + đổi đường dẫn)
- Mục đích: có spec được duyệt trước khi đổi URL.
- Đầu vào: `specs/README.md`, `specs/_meta/constitution.md`, `specs/_templates/{spec,plan,tasks,verification,rollout}.md`, mục 4.1–4.2, 5.1, 5.2, 7 của gói này; `S/reports/12-navigation-ia.md` A.3–A.5.
- Việc làm: 1) Tạo `specs/<NNNN>-learner-navigation/` với `spec.md` (front-matter `id: LEARNERNAV-<NNNN>`, `status: draft`, `risk: high` vì có đợt 7b), `plan.md` (9 đợt), `tasks.md` (T06–T12b, T15 phần đổi URL, T23, T24), `verification.md` (kịch bản 9.1–9.3), `rollout.md` (307 trước, 308 sau; cách lùi: xoá dòng redirect + khôi phục thư mục bằng `git revert`; nhắc rằng 308 đã bị trình duyệt nhớ thì không lùi được). 2) Chép FR-07-001…014, bảng 5.1, 5.2, ca biên mục 9.4, câu hỏi mở #1–#4. 3) Thêm dòng vào bảng "Active index" của `specs/README.md`. 4) `python backend/scripts/validate_specs.py`.
- Đầu ra: một PR chỉ chứa spec. **DỪNG chờ anh Andy duyệt.**
- Nghiệm thu: `validate_specs.py` qua; `git diff --check` sạch; PR không có file ngoài `specs/`.
- Không làm: không viết mã, không tự đổi `status` sang `approved`.
- Ước lượng: 1 phiên · 2.

### G07-T02 — Spec LEARNERCORE
- Như T01, thư mục `specs/<NNNN>-learner-core/`, `risk: medium`, thêm `ui-states.md` (rỗng/đang tải/lỗi/một khối hỏng cho Hôm nay, Lộ trình, Tài khoản; trạng thái lần đầu vào). Nội dung: FR-07-020…036, 060…062, hợp đồng 5.3, 5.6, 5.8; câu hỏi mở #9, #11, #12, #13. Ghi rõ "Luyện tập/Thi thử/Tiến độ/Tài khoản/Trợ giúp/Hồ sơ chưa có tờ thiết kế riêng". DỪNG chờ duyệt. 1 phiên · 2.

### G07-T03 — Spec COURSELESSON (high-risk)
- Như T01, `specs/<NNNN>-course-lessons/`, `risk: high`, đủ `rollout.md`, `ui-states.md`. Nội dung: FR-07-040…043, 5.4, 5.5, phụ thuộc G04 (tên bảng `entitlements`, hàm kiểm quyền), câu hỏi #5, #6, #10. Mô tả nhập dữ liệu: bảng rỗng lúc đầu; trang Lộ trình hiện "sắp có" khi khoá chưa có bài `is_published`. DỪNG chờ duyệt. 1 phiên · 3.

### G07-T04 — Spec RESULTSHEET (high-risk)
- Như T01, `specs/<NNNN>-result-sheet/`, `risk: high`. Nội dung: FR-07-050…054, 5.6, 5.7, câu hỏi #7, #8, #9. Ghi rằng hai dạng body cũ/mới cùng tồn tại để frontend cũ còn gửi được. DỪNG chờ duyệt. 1 phiên · 3.

### G07-T05 — Cờ giao diện mới
- Mục đích: bật Hôm nay/Lộ trình mới cho từng người trên staging.
- Đầu vào: 5.8; `backend/routers/auth.py` L246–360; `backend/models/auth.py`; `backend/routers/admin.py` L5060–5100; `frontend/lib/auth-wire-model.mjs`.
- Việc làm: 1) Kiểm cờ của G03 (lệnh ở 5.8); có thì dừng nhiệm vụ này, ghi "dùng cờ G03" vào PR T14. 2) Thêm hàm `is_learner_v2_enabled`/`ais_…` vào `backend/services/feature_flags.py` theo mẫu `vocab_curated`. 3) Thêm trường vào `/auth/me` và `AuthMeResponse`. 4) Endpoint admin bật/tắt theo người. 5) Hàm frontend `learnerV2Enabled(me)` trong `frontend/lib/auth-wire-model.mjs` (đọc mềm). 6) Sinh lại `api.d.ts`.
- Nghiệm thu: `cd backend && python -m pytest tests/test_auth_response_models.py tests/test_activation_gate_inventory.py -q` qua; test mới (pytest) cho 4 tổ hợp cờ; `node --test frontend/tests/auth-wire-model.test.mjs` qua và có ca "thiếu trường → false, không null"; `git diff --exit-code frontend/types/api.d.ts` sau khi sinh lại.
- Không làm: không thêm cờ vào danh sách bắt buộc `normalizeAuthMe`; không bật `learner_v2_all` ở đâu cả.
- Vướng mắc → gỡ: (a) `test_auth_response_models.py` so khoá trả về với model — thêm trường cả hai nơi cùng commit. (b) Nhánh `USE_ASYNC_DB` có hai đường (L333–340): thêm đọc cờ vào **cả hai**, có test cho mỗi nhánh.
- Ước lượng: 1 phiên · 3.

### G07-T06 — Đợt 1: `/flashcards`, `/flashcard-study`
- Mục đích: đợt mẫu, ít người dùng (sau cờ `flashcard_enabled`), để kiểm toàn bộ quy trình đổi URL.
- Đầu vào: 5.1, mục 7; danh sách test ứng viên: `chrome-spacing-canonical`, `flashcard-study-next-behavior`, `flashcard-study-next-model`, `flashcards-next-behavior`, `home-cutover`, `pricing-baseline-shared-sources`, `react/vocabulary-class-sets`, `route-auth-guard-inventory`, `speaking-cutover`, `subheading-pattern-canonical`, `vocab-exam-next-behavior`, `vocab-exam-split`, `vocab-landing.test.js`, `vocab-module-loader`, `vocab-topic-study`, `vocabulary-hub-next-behavior`, `vocabulary-legacy-return`, `vocabulary-redesign` (18 file, nhiều file chỉ nhắc trong chú thích).
- Việc làm (cùng một commit cho bước 1–4, vì cổng sở hữu route chặn trạng thái nửa vời):
  1. `git mv` hai thư mục đoạn URL theo 5.1.
  2. Thêm 2 dòng redirect literal (5.1) vào `next.config.ts`.
  3. `tooling/legacy-url-mapping.mjs`: thêm `EXACT_REPLACEMENTS` `'/pages/flashcards.html': '/vocabulary/flashcards'`, `'/pages/flashcard-study.html': '/vocabulary/flashcards/study'`; sửa `replacementOwner` nếu cần (đích dưới `/vocabulary/` đã ra `vocabulary`).
  4. `proxy.ts` matcher và `nonceRouteAllowed`: bỏ `flashcards`, `flashcard-study` (đã có `/vocabulary/.+`).
  5. Sửa href: `vocabulary-hub-behavior.tsx`, `speaking-behavior.tsx`, `flashcard-study-player.tsx`, `lib/flashcard-study-model.mjs`, `components/legacy-module.tsx`; `public/js/vocab-modules/*.js`, `public/js/flashcard-study.js` **chỉ khi** file còn được trang nào nạp (`grep -rn "vocab-modules\|flashcard-study.js" frontend/app frontend/components`).
  6. `app/robots.ts`: bỏ `/flashcards`, `/flashcard-study`; thêm `/vocabulary/flashcards`.
  7. `.github/workflows/next-native-browser.yml`: lọc `(authed-flashcards)/**` vẫn đúng (nhóm giữ tên) — kiểm lại dòng L170–174.
  8. Test: sửa đúng chỗ ghim đường dẫn; cập nhật sha256 ở `legacy-url-redirects.test.mjs` L72 (ghi băm cũ → mới và lý do trong PR); `route-auth-guard-inventory` đổi `'/flashcard-study'` → `'/vocabulary/flashcards/study'`; thêm test hành vi `frontend/tests/learner-route-moves.test.mjs` theo mẫu `section-index-redirects.test.mjs`: với mỗi dòng của một bảng `MOVES` trong test → đúng một redirect, đích là trang có thật, nguồn không còn là trang, `permanent === false`.
  9. `docs/SITE_OVERVIEW.md` §4 và `docs/ROUTE_LEDGER.md`: đổi đường dẫn hai dòng.
- Đầu ra: một PR.
- Nghiệm thu: `node frontend/tooling/route-ownership-check.mjs` in `clean`; bộ hợp đồng frontend đầy đủ qua; `npm --prefix frontend run test:react` qua; `npm run build` qua và `node frontend/tooling/route-ownership-check.mjs --manifest` sạch; `curl -sI localhost:3100/flashcard-study?stack=wiki:food` → `307`, `location: /vocabulary/flashcards/study?stack=wiki:food`; mở link đó khi **chưa đăng nhập** thấy bộ thẻ.
- Không làm: không đổi giao diện; không đổi tên nhóm route; không sửa `public/js/components/aver-chrome.js` (không có link flashcards).
- Vướng mắc → gỡ: (a) Test vỡ vì đọc `app/(authed-flashcards)/flashcards/page.tsx` theo đường dẫn → đổi đường dẫn trong test, không đổi nội dung khẳng định. (b) Hơn 30 test vỡ → dừng, gửi danh sách (quy ước 7). (c) `csp-nonce-report-only` báo trang AuthedShell không khớp → kiểm `/vocabulary/.+` đã bao `/vocabulary/flashcards`; nếu test suy tiền tố khác, đọc `pageRoutes()` L56 rồi sửa regex, không sửa test.
- Ước lượng: 1 phiên · 3.

### G07-T07 — Đợt 2: `/d1-exercise` → `/vocabulary/fill-in`
- Như T06. Test ứng viên: `auth-me-single-flight`, `d1-attempt-idempotency`, `d1-canonical-completion`, `d1-exercise-next-behavior`, `d1-exercise-next-model`, `d1-source-label`, `d1-srs-indicator`, `next-native-browser-workflow`, `react/auth-me-single-flight-pages`, `react/vocabulary-read-timeout`, `vocab-module-loader`, `vocabulary-hub-next-behavior`. Tooling: `verify-d1-exercise-flow.mjs`, `verify-vocabulary-class-sets-flow.mjs`. Legacy: `'/pages/d1-exercise.html'`. Bỏ `d1-exercise` khỏi hai regex nonce; robots thêm `/vocabulary/fill-in`. Nút quay lại của trang (đang về `/exercises`) đổi thành "‹ Từ vựng" → `/vocabulary/hub`.
- Vướng mắc: account-keyed localStorage resume pointer (ROUTE_LEDGER L260) có thể chứa URL cũ → kiểm `grep -n "localStorage" "app/(authed-d1-exercise)" -r`; nếu lưu đường dẫn đầy đủ thì đọc được cả dạng cũ.
- 1 phiên · 2.

### G07-T08 — Đợt 3: `/course-exercises`, `/advanced-vocabulary`, `/grammar-lessons/assigned`
- Mục đích: dồn bài của lớp về dưới `/course/`.
- Đầu vào: 5.1; tờ `BaiTapPhatAm`, `TuVungHocVien`, `NguPhapHocVien` (đối chiếu trang bài của lớp; khung mới dựng ở G08-T26); `lib/my-class-model.mjs` L440–480; `my-class-workspace.tsx` L595–610; `backend/routers/class_student.py` L860–980; 21 test ứng viên (B1 ở mục 7).
- Việc làm: 1) `git mv` ba thư mục; 3 redirect. 2) `lib/my-class-model.mjs`: chấp nhận **cả** `/grammar-lessons/assigned?assignment_item=<id>` **và** `/course/grammar-lesson?assignment_item=<id>` từ backend, luôn trả URL mới. 3) `my-class-workspace.tsx` L601, L606 đổi sang URL mới. 4) Hai regex nonce: bỏ `course-exercises`, `advanced-vocabulary`, `grammar-lessons`; thêm `course`. 5) `route-auth-guard-inventory.test.mjs` `GUARDED`: đổi khoá và đường dẫn file. 6) Workflow `next-native-browser.yml` L178–180: thêm `frontend/app/(authed)/course/**` thay cho hai dòng cũ của nhóm này (giữ dòng `grammar-checkup` tới T09). 7) robots: bỏ `/course-exercises`, thêm `/course/` (có gạch cuối) — không thêm `'/course'` trần. 8) Backend **không** đổi trong PR này.
- Đầu ra: một PR frontend. Sau khi PR này lên staging và chạy ổn, mở PR nhỏ thứ hai (tính trong nhiệm vụ này) đổi `class_student.py` L865/L898/L969 sang `/course/grammar-lesson?…` và sửa `backend/tests/test_assigned_grammar_lessons.py`.
- Nghiệm thu: như T06; thêm: tài khoản QA staging có bài Grammar được giao → từ `/my-class` bấm mở → tới `/course/grammar-lesson?assignment_item=…` và lưu được một câu; mở URL cũ `/course-exercises?bank=…&item=…` → 307 tới URL mới với đủ query.
- Không làm: không gộp với đổi `/my-class`.
- Vướng mắc → gỡ: (a) Railway và Vercel triển khai lệch nhau: nếu backend đổi đường dẫn trước, frontend cũ trả `null` → bài không mở được. Vì vậy frontend chấp nhận hai dạng trước, backend đổi sau. (b) `course-*.test.mjs` đọc file trong `app/(authed)/course-exercises/` bằng đường dẫn → chỉ đổi đường dẫn. (c) `react/learner-route-auth-boot.test.tsx` import component theo đường dẫn → sửa import.
- Ước lượng: 2 phiên · 4.

### G07-T09 — Đợt 4: Grammar check-up
- Như T06. Thêm: sửa quy tắc 307 `/grammar-checkup/review` và thêm `/course/grammar-checkup/review` (mục 5.1 #7); sửa `SECTION_REDIRECTS` trong `section-index-redirects.test.mjs`; `my-class-model.mjs` L465, L476 chấp nhận hai dạng `grammar_path`; `grammar-checkup.tsx` 8 liên kết nội bộ; workflow L178. Backend L975 đổi ở PR sau như T08. Test: `grammar-openapi-contract`, `my-class-next-behavior`, `react/grammar-checkup-account-switch`, `react/learner-route-auth-boot`, `route-auth-guard-inventory`, `section-index-redirects`, `ui-copy-vietnamese-pcj148`.
- Vướng mắc: redirect có tham số `:routeId` phải viết đúng `'/grammar-checkup/review/:routeId'`; kiểm `samePath` của `route-ownership-check` không báo va chạm với `/grammar-checkup/review` (khác số đoạn → không va chạm).
- 1 phiên · 3.

### G07-T10 — Đợt 5: `/full-test-result` → `/speaking/full-test/result`
- Như T06. Sửa `public/js/practice.js` L246 (nhánh native), `admin-mock-reviews.tsx` (link `session_id`), `EXACT_REPLACEMENTS['/pages/full-test-result.html']`. Bỏ `full-test-result` khỏi hai regex nonce (đã có `speaking`). Trang này phải **có thanh điều hướng** (hiện trần): nếu G03 chưa merge thì chỉ đổi URL, phần thanh để T22. Test ứng viên 18 file (C1 mục 7) — đa số chỉ ghim chuỗi trong chú thích; chạy bộ đầy đủ để biết file nào thật sự vỡ.
- Vướng mắc: `practice.js` có hai nhánh (`_getNativeView()` → URL Next, ngược lại `/pages/full-test-result.html`) — chỉ sửa nhánh Next; nhánh HTML đã đi qua manifest.
- 1 phiên · 3.

### G07-T11 — Đợt 6: `/speaking/result`, `/mock/result`
- Như T06. `EXACT_REPLACEMENTS` hai dòng `/pages/speaking-result.html`, `/pages/mock-result.html` đổi đích. Bỏ `mock` khỏi hai regex nonce (không còn trang dưới `/mock/`), thêm `tests`. Liên kết: `lib/listening-review-model.mjs`, `lib/reading-review-model.mjs` (lối về kết quả thi thử), `home-behavior.tsx` (ô kết quả thi thử), `speaking-result-behavior.tsx` L4 liên kết. Robots: bỏ `/mock`, thêm `/tests`. Test ứng viên 15 file (C2).
- Vướng mắc: `metadata-title-matches-legacy.test.mjs` so tiêu đề trang theo cặp legacy→next; đổi `p.next` cho hai cặp.
- 1 phiên · 3.

### G07-T12a — Đợt 7a: `/full-test` → `/tests`
- Như T06. `(authed-full-test)/full-test` → `(authed-full-test)/tests`. `EXACT_REPLACEMENTS['/pages/full-test.html'] = '/tests'`; `replacementOwner`: thêm `route === '/tests' || route.startsWith('/tests/')` → `'mock-exam'`. Liên kết: `home/page-shell.tsx`, `mock-exam-runner.tsx` ("Back to Full Test" → `/tests`), `session-result-behavior.tsx`, `full-test-result-behavior.tsx`, `speaking-result-behavior.tsx`. Workflow L197 nhóm giữ tên → không đổi. Bỏ `full-test` khỏi hai regex nonce. Thêm chuyển hướng `/exam` → `/tests` (5.1 dòng 17; 00 mục 2 điểm 22).
- 1 phiên · 3.

### G07-T12b — Đợt 7b: `/mock-exam` → `/tests/mock/session` (high-risk)
- Mục đích: dời phòng thi mà không làm hỏng lượt thi đang chạy.
- Đầu vào: `app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx`, `components/exam-language-bridge.tsx`, `public/js/practice.js` L3700–3720, `public/js/mock-exam-hook.js` (nạp bởi `(authed-listening-player)/layout.tsx`), `lib/supabase-browser.ts` L10–15, `tests/release-invariants.test.mjs` L110–125.
- Việc làm: 1) Dời thư mục; redirect `/mock-exam` → `/tests/mock/session`. 2) `exam-language-bridge.tsx`: thêm `/tests/mock/session` (giữ `/mock-exam` trong tập một thời gian để trang đang mở trước lúc triển khai không đổi ngôn ngữ giữa chừng — ghi ngày gỡ trong PR). 3) `practice.js` L3717 và `mock-exam-hook.js`: dùng URL mới. 4) `EXACT_REPLACEMENTS['/pages/mock-exam.html']`, `release-invariants.test.mjs` cặp `nextPath`. 5) Hai regex nonce: bỏ `mock-exam`. 6) Tooling: `verify-mock-exam-flow.mjs` và các `write-flows/*` có `/mock-exam` (danh sách ở mục 7).
- Nghiệm thu: bộ đầy đủ qua; trên staging với **tài khoản QA và kỳ thi thử QA** (không dùng kỳ thi của học viên thật): vào `/tests` → mở đề → URL là `/tests/mock/session?…`, nhãn tiếng Anh; chuyển sang phần Speaking rồi quay lại không mất câu trả lời; mở URL cũ có `sitting=` → tới đúng lượt thi.
- Không làm: không đổi logic runner, nộp bài, đồng hồ.
- Vướng mắc → gỡ: (a) Học viên đang thi đúng lúc triển khai: trang đã tải vẫn chạy (không điều hướng), lệnh `location.href` cũ trong `practice.js` đã tải sẽ đi qua redirect 307 giữ query → vẫn đúng. Kiểm bằng cách mở phiên thi trên staging, triển khai preview mới, bấm chuyển phần. (b) `?code=` trên URL thi không được đổi thành trao đổi PKCE — `detectSessionInUrl: false` đã chặn; không sửa `supabase-browser.ts`. (c) Triển khai ngoài giờ có lịch thi thử — hỏi anh Andy lịch trong PR.
- 2 phiên · 4.

### G07-T13 — API `GET /api/student/today`
- Đầu vào: 5.3; `backend/services/student_home_aggregator.py` L48–160; `backend/routers/class_student.py` L268–330, L493, L658–695.
- Việc làm: service, model, route theo 5.3 bản 18/11 (gồm `state`, `banner`, `orders_open`, `goal`, `new_results`, `repeat_error` qua hàm ghép `_repeat_error_for` — trả `None` cho tới khi GOI-12 có, `trial_today_left`); test pytest với supabase giả (mẫu các test aggregator hiện có — `grep -rln "home_summary\|_assemble_home_summary" backend/tests`): không lớp; có lớp + 2 bài quá hạn + 1 bài đã nộp; một phần ném lỗi → `degraded`; bài dở hết hạn bị bỏ; bốn giá trị `state` theo đúng thứ tự FR-07-019; `credits` là một con số chung; đơn `needs_info` có `supplement_by`; `_repeat_error_for` trả `None` → `repeat_error` là `null`; thay hàm ghép bằng bản giả trả một lỗi → `repeat_error` đúng khung; hàm ghép ném lỗi → `repeat_error` là `null` và `degraded` không đổi. Sinh lại `api.d.ts`.
- Nghiệm thu: `cd backend && python -m pytest tests/ -q` qua; `test_activation_gate_inventory.py` qua (ngoại lệ cho route này thêm ở T26, không ở PR này); `git diff --exit-code frontend/types/api.d.ts` sau sinh lại.
- Không làm: không sửa `/api/student/home-summary`; không sửa `_visible_assignments`.
- Vướng mắc: import `routers.class_student` từ service có thể vòng import (`routers.class_student` import service khác) → import trong thân hàm như `student_home.py` làm với `account_display_name`.
- 2 phiên · 3.

### G07-T14 — Hôm nay mới (`/home`, tờ Main + HomNayTrangThai + Mobile)
- Đầu vào: `thiet-ke/Main.dc.html` (mục 1 đã duyệt; mục 6 bản điện thoại "chưa có khoá"), `HomNayTrangThai.dc.html` (mục 2–5 và ghi chú), `Mobile.dc.html`, `GiaHanThemLuot.dc.html`, `ThanhPhanKhungTrang.dc.html` mục 1, 3; `app/(authed-home)/home/*`; `app/(authed-home)/layout.tsx`; component G03.
- Việc làm: 1) Cây mới `app/(authed-home)/home/today-v2.tsx` (+ file con), vẽ khi `learnerV2Enabled(me)`; cây cũ giữ nguyên khi tắt. 2) Gọi `/api/student/today` một lần; chọn trạng thái theo `state` + `banner` (FR-07-019); khối theo FR-07-020…029b; href bài giao dựng bằng `lib/my-class-model.mjs`. 3) "Vừa có kết quả" và "Lỗi đang lặp lại" từ `new_results`, `repeat_error` (null → ẩn khối; `repeat_error` chỉ khác null khi sổ lỗi của GOI-12 có dữ liệu — FR-07-029b). 4) Lượt AI một kho chung theo G04; chưa có API thì ẩn khối. 5) Dải mục 5 dùng nhãn của `course-access-labels.mjs` và `CreditsEmptyNotice` (T27; chưa có thì dùng `Notice` của G03 với cùng câu chữ). 6) Test React (`frontend/tests/react/today-v2.test.tsx`): bốn `state`, ba `banner`, một khối hỏng, N = 0 → "Hôm nay không có bài đến hạn.", quá hạn lên đầu, học viên lớp mã cũ không có khối lượt, có mục tiêu không có ngày thi.
- Nghiệm thu: `npm --prefix frontend run test:react` qua; trên staging bật cờ cho tài khoản QA → ảnh 1280px và 390px khớp tờ (ghi khác biệt); tắt cờ → giao diện cũ y nguyên (so ảnh trước/sau).
- Không làm: không xoá cây cũ (T24); không sửa `home.css`.
- Vướng mắc → gỡ: (0) Tờ HomNayTrangThai: theo 00 mục 6 (sửa 18/11), tờ Đợt 4, 5 đã duyệt, tờ vẽ sau vẫn là bản nháp — khối nào là đề xuất ("Học trước trong lúc chờ") thì không dựng; trạng thái "chưa có khoá" chỉ tới được sau T26, trước đó test bằng dữ liệu giả. (a) `home.css` có luật toàn cục `* {box-sizing}`, `html, body`, `a { color: inherit; text-decoration: none }` (L19–30) áp lên cả cây mới — component G03 phải tự đặt màu/gạch chân liên kết; kiểm bằng ảnh, không sửa `home.css`. (b) Layout là server component, không đọc được cờ người dùng (auth chỉ ở client, ADR-003) → không đổi `pageStylesheets` theo cờ; CSS v2 của G03 nạp cho mọi người nhưng phải nằm trong lớp/tiền tố `--av2-` để không đổi trang cũ. (c) 13 test nhắc `(authed-home)` — vì cây cũ giữ nguyên nên không được vỡ; vỡ là dấu hiệu đã sửa nhầm file cũ.
- 3 phiên · 4.

### G07-T15 — Lộ trình `/course` + Đợt 8 (`/my-class` → `/course/assigned`)
- Đầu vào: `thiet-ke/LoTrinh.dc.html`, `LoTrinhBaiDuocGiao.dc.html`, `LopBuoiHoc.dc.html` (giao diện đầy đủ của hai tờ sau dựng ở T30); `app/(authed-my-class)/*`; `/api/class/me`; API G04.
- Việc làm: 1) Nhóm route mới `app/(authed-course)/` với `layout.tsx` (`AuthedShell`, `instant = false`, stylesheet v2 của G03) và `course/page.tsx`. 2) Hai nhóm khoá (FR-07-031…036); danh sách bài lấy `GET /api/course/{code}/lessons` khi T19 có, trước đó hiện "Bài học của khoá sẽ mở dần" (không để trống). 3) PR thứ hai trong nhiệm vụ: Đợt 8 — dời `(authed-my-class)/my-class` → `(authed-my-class)/course/assigned`, redirect, `aver-chrome.js` L443 và L613 (nếu thanh cũ còn chạy), `practice.js` L5679, `lib/*-review-model.mjs`, `speaking-session-result-model.mjs`, `EXACT_REPLACEMENTS['/pages/my-class.html']`, bỏ `my-class` khỏi hai regex nonce, robots (thêm đúng chuỗi `'/course/'` có gạch chéo cuối — `'/course'` sẽ chặn luôn `/courses` công khai của G05), 17 test (B3 mục 7) gồm `tests/staging-e2e/mobile-navigation.spec.js`. Trang `/course/assigned` hiện đầu thẻ Lộ trình (component G03) phía trên `MyClassWorkspace` nguyên vẹn.
- Nghiệm thu: tài khoản QA chỉ lớp → `/course` chuyển tới `/course/assigned`; tài khoản chỉ online → nhóm lớp thu gọn có "Nhập mã kích hoạt"; URL cũ `/my-class` → 307 `/course/assigned`; `canonical-inbound-links.test.mjs` cập nhật và qua.
- Vướng mắc: `(authed-my-class)/layout.tsx` dùng `utilityLayer={false}` và CSS lớp học cũ → đầu thẻ v2 phải hiển thị đúng khi không có tailwind; kiểm ảnh. Không chuyển `MyClassWorkspace` sang nhóm route mới (đổi cascade của trang đang sống).
- 2 phiên · 4.

### G07-T16 — Hub `/practice` và `/tests` (tờ LuyenTap, ThiThu)
- `/practice`: nhóm route mới `(authed-practice-hub)` (tránh đụng layout `(authed-practice)` đang nạp `practice.js`) với `practice/page.tsx`: khối "Làm tiếp" (từ `resume` của `/api/student/today`), 4 thẻ kỹ năng trỏ tới hub hiện có.
- `/tests` (trang đã dời ở T12a), ba khối theo 00 mục 2 điểm 22:
  1. **Đề tự chọn**: chỉ có **full test từng kỹ năng** và **mini test**; làm lúc nào cũng được, làm lại được. Không có full test bốn kỹ năng một mạch, không có nút "Thi thử 4 kỹ năng". Tờ ThiThu còn vẽ đề bốn kỹ năng tự chọn: 00 thắng, ghi khác biệt trong PR.
  2. **Mock test được giao**: chỉ hiện khi học viên có trong danh sách người dự thi của một kỳ thi (G09-T31, bảng `mock_exam_audiences`); chế độ `live` (cùng giờ) hoặc `self_paced` (bắt đầu lúc nào cũng được trong khoảng thời gian được mở, làm một lần; **đã bắt đầu thì các phần chạy liền nhau, không nghỉ giữa các phần** — 00 mục 2 điểm 23; dòng của kỳ `self_paced` ghi tổng thời lượng và câu "Làm liền một mạch khoảng N phút. Đã bắt đầu thì không dừng giữa các phần.", N cộng từ thời lượng các phần do API trả); trạng thái: Sắp diễn ra · Đang mở · Đã thi, chờ kết quả · Đã có kết quả · Đã đóng, bạn chưa thi; kỳ không đủ bốn kỹ năng ghi rõ các phần có. Học viên chưa được giao kỳ nào: **không có khối này** (không có câu trống mời thi). Đọc API học viên của kỳ thi sau khi G08 đổi cổng (`GET /api/mock-exams…` — `CHƯA KIỂM` endpoint danh sách của học viên: `grep -n "@router.get" backend/routers/mock_exams.py`); G09-T31/G08 chưa merge → khối dùng dữ liệu hiện có (`mock_exam_assignments`, `cohort_id`) và ghi rõ trong PR.
  3. **Bảng kết quả**: mọi lượt đã nộp, mới nhất trước; cột Overall chỉ có giá trị ở mock test được giao đủ bốn kỹ năng (5.6).
- Dưới ngưỡng 768px: nút vào full test thay bằng dòng Cảnh báo (cổng của GOI-11 T19); nút mini test giữ nguyên. Không đủ lượt cho đề có Writing/Speaking: dòng vẫn hiện, "Không đủ lượt", nút "Xem cách thêm lượt" (mở `CreditsEmptyNotice`).
- Nghiệm thu: test React: tài khoản không được giao kỳ nào → không có khối 2; có một kỳ `self_paced` thiếu Speaking → hiện ba phần, không Overall; không có nút đề bốn kỹ năng tự chọn ở bất kỳ trạng thái nào.
- Vướng mắc: thêm `practice/page.tsx` ở nhóm khác với `practice/session` — hợp lệ trong App Router; chạy `route-ownership-check --manifest` sau build để chắc. Phía học viên của mock test được giao đã có tờ `MockTestDuocGiao` (18/11) → dựng khối 2 theo tờ đó và tờ ThiThu.
- 2 phiên · 3.


### G07-T17 — Tài khoản, Tiến độ, Trợ giúp, Hồ sơ, "Lần đầu vào"
- Đầu vào: tờ `TaiKhoan`, `TienDo`, `TroGiupLanDau`, `GiaHanThemLuot`, `TaiKhoanDangNhap` màn 5 (hộp đăng xuất mọi thiết bị — component của G05-T20); GOI-04 mục 5.9 (`/api/me/courses`, `/api/me/credits`, `/api/account/login-events`), 5.13, 5.13b, 5.14; GOI-05 mục 5.6b (thành phần `ChangeEmail` của G05-T24).
- `/account` (FR-07-060), `/progress` (FR-07-061, chỉ dùng API sẵn có: `/api/quiz/progress`, `/api/listening/overview`, `/api/writing/my-essays`, lịch sử Speaking), `/help` (FR-07-062), `/profile` trong khung mới + sửa nhãn "SESSIONS/TUẦN" → "buổi mỗi tuần" + khối "Phiên đăng nhập" (FR-07-064), trang "Lần đầu vào" (FR-07-065) thay `/onboarding` (chuyển hướng 307). Mỗi trang một nhóm route mới có `AuthedShell`; thêm `account|progress|help|start` vào hai regex nonce; robots thêm các tiền tố tương ứng.
- Không làm: không dựng ô hỏi hay công tắc "đồng ý dùng bản ghi âm" (FR-07-063, 066 ĐÃ BỎ — hoãn); không dựng hộp "Đăng xuất khỏi mọi thiết bị" lần hai (dùng component G05-T20; G05-T20 chưa merge thì ẩn nút); không tự dựng luồng đổi email đăng nhập (gắn `ChangeEmail` của G05-T24 — FR-07-064b; chưa merge thì ẩn nút); không ghi hay sửa `learner_login_events` (chỉ đọc API của G04-T16); không hiện cột "nơi gần đúng"; không gõ cứng 45, 60, 100 (đọc từ API G04).
- Nghiệm thu: test React: lịch sử lượt hiện một cột số dư chung, không có cột kỹ năng; khoá của lớp không có nút "Đăng ký lại"; tài khoản có `onboarding_completed=false` và không có `next` → tới trang lần đầu, "Bỏ qua" về `/home` và lần sau không hiện lại; trang lần đầu không gọi API nào có chữ `consent`; `login-events` trả 3 dòng với `outcome` = `signed_in`, `claim_refused_timed`, `displaced` → ba dòng đúng câu ở FR-07-064, dòng `is_current` có "Thiết bị này", không có cột nơi; `login-events` trả `enabled=false` hoặc lỗi 500 → không có tiêu đề "Lần đăng nhập gần đây" trong DOM, nút "Đăng xuất khỏi mọi thiết bị" vẫn còn; `carry_balance=7`, `carry_expires_at` có giá trị → có dòng "Trong đó 7 lượt chuyển từ kỳ trước, dùng đến hết …"; `carry_balance=0` → không có dòng đó; không có chuỗi "50%" trong DOM của `/account`; `content_visible_until` có giá trị → có dòng "Bài đã nộp và nhận xét xem được đến hết …", null → không có; thành phần `ChangeEmail` giả (mock) được vẽ trong khối "Email đăng nhập" khi cờ bật và không được vẽ khi cờ tắt.
- Vướng mắc: G04 chưa có API → `/account` hiện khối "Khoá của lớp" từ `/api/class/me` và câu "Thông tin khoá online sẽ có khi bạn đăng ký" — không hiện số 0. G04-T16 hoặc G05-T24 chưa merge → ẩn khối "Lần đăng nhập gần đây" và nút "Đổi email đăng nhập" (FR-07-064, 064b); nối sau bằng một PR nhỏ cùng nhiệm vụ này, không mở nhiệm vụ mới.
- Thêm 18/11 tối (phương án A (mặc định tạm 18/11, chờ anh Andy xác nhận)): khối "Dữ liệu của tôi" và "Yêu cầu xoá tài khoản và dữ liệu" ở `/account` theo tờ TaiKhoan, nút "Tải các phiếu của khoá này (PDF)" theo tờ GiaHanThemLuot, gọi API của G04-T18 (FR-04-052); G04-T18 chưa merge hoặc anh chọn để sau thì ẩn hai khối.
- 3 phiên · 3.


### G07-T18 — Migration `course_lessons`, `course_lesson_progress` (high-risk)
- Đầu vào: 5.5; `backend/migrations/README.md`; mig 175, 176, 344 (mẫu RLS); `specs/<COURSELESSON>` đã duyệt.
- Việc làm: một file migration + rollback; test pytest kiểm ràng buộc (mẫu: `grep -rln "postgres" backend/tests | head` để tìm test chạy Postgres thật như `test_vocab_curated_postgres.py`).
- Nghiệm thu: migration chạy hai lần không lỗi (`IF NOT EXISTS`); rollback chạy được; RLS: học viên không đọc được `course_lessons` bằng khoá anon.
- Không làm: không nhập nội dung khoá (script nạp ở T28); không đụng dây chuyền Hermes.
- 1 phiên · 4.

### G07-T19 — API bài học, trang bài giảng, trình phát hai nguồn (high-risk)
- Đầu vào: 5.4; `thiet-ke/BaiGiang.dc.html`, `ThanhPhanHocTap.dc.html` (trình phát video); `tooling/content-security-policy.mjs`; `docs/CONTENT_SECURITY_POLICY.md`.
- Việc làm: 1) Router `course_learner.py` (kiểm quyền bằng hàm G04). 2) Trang `app/(authed-course)/course/learn/[courseCode]/[lessonCode]/page.tsx`. 3) Trình phát: dùng của G06 nếu đã có; chưa có thì tạo `frontend/components/ui/video-player.tsx` (props `source: 'youtube'|'private_host'`, `ref`, `startAt`, `onProgress(seconds)`). 4) CSP: thêm `frame-src 'self' https://www.youtube-nocookie.com` cho production; nguồn riêng thêm origin lấy từ biến build `AVER_PRIVATE_VIDEO_ORIGIN` (rỗng → không thêm, trình phát hiện "Video chưa sẵn sàng"). Cập nhật doc CSP và test CSP. 5) Nút "Bắt đầu luyện" theo Cần quyết #6; mặc định ẩn khi `practice` null. 6) Không khoá bài theo thứ tự (FR-07-043 ĐÃ BỎ): API trả 200 cho mọi bài `is_published` của khoá người đó có quyền. 7) `services/course_outline.py::public_outline` và nối vào `_outline_for` của G04 (FR-07-044, 5.4).
- Nghiệm thu: pytest cho 403/200/tiến độ chỉ tăng; mở bài cuối khi chưa học bài nào → 200; `GET /api/courses/{slug}` của sản phẩm thử có 3 bài published trả `lesson_count=3` và `chapters` không chứa `body_md`; test CSP qua; trên staging với một bài mẫu do admin nhập (dữ liệu thử) video YouTube phát, tải lại trang tiếp đúng vị trí.
- Vướng mắc: (a) Đổi CSP là đổi header mọi trang — chỉ thêm `frame-src`, không đụng `script-src`. (b) YouTube trong iframe đặt cookie bên thứ ba → dùng `youtube-nocookie.com`.
- 2 phiên · 4.

### G07-T20 — Khung phiếu kết quả + phiếu Writing
- Đầu vào: `thiet-ke/KetQuaWriting.dc.html`, `PhieuKetQua.dc.html` mục 1–4; `writing-result-behavior.tsx`; `writing-top-fixes.tsx`.
- Việc làm: component `frontend/components/ui/result-next-steps.tsx` (ba lối ra), `result-grading-source.tsx` (nguồn chấm), `result-pending-review.tsx` (4 bước); áp lên `/writing/result`: `status != 'delivered'` → trạng thái chờ duyệt; nguồn chấm từ `band_source` (`ai` + chưa qua giáo viên → "AI chấm, trả ngay"; `teacher` → "…giáo viên duyệt rồi trả"; `unknown` → không hiện dòng). Trạng thái chờ duyệt chỉ áp cho Writing có `review_mode='teacher_review'` hoặc bài của lớp (G04 mục 5.7). Bài tiếp: bài giao chưa nộp kế tiếp (từ `/api/class/my-assignments`) → hub Writing. Xuất component để G08 dùng; ghi props trong PR.
- Vướng mắc: 4 test nhắc `(authed-writing-result)`; cây mới sau cờ như T14 để không vỡ.
- 2 phiên · 3.

### G07-T21 — Yêu cầu chấm lại có lý do (high-risk)
- Đầu vào: 5.7; `writing_student.py` L2762–2830; `admin_writing_regrade.py`; mig 084, 085, 205.
- Việc làm: migration + rollback; API hai dạng body; màn học viên (form 5 lý do + ghi chú, đếm ký tự, "Khác" bắt buộc ghi chú); màn admin hiện thêm hai cột; pytest: dạng cũ vẫn qua, dạng mới qua, lẫn lộn 422, trùng 409, "other" thiếu note 422.
- Nghiệm thu: bộ backend đầy đủ qua; trên staging gửi một yêu cầu cho bài thử của tài khoản QA, admin thấy lý do + ghi chú, từ chối được.
- Không làm: không mở chấm lại cho Speaking (Cần quyết #8).
- Vướng mắc: đổi CHECK trên bảng đang có dữ liệu thật — mọi dòng cũ có `reason_code IS NULL` và đã thoả 50–500, nên ràng buộc mới vẫn đúng; chạy `SELECT count(*) FROM essay_regrade_requests WHERE char_length(reason) NOT BETWEEN 50 AND 500` trên staging trước (chỉ đọc), ghi kết quả vào PR.
- 2 phiên · 4.

### G07-T22 — Phiếu Speaking (`/result`) và thi thử (`/tests/mock/result`)
- Áp component T20. Phiếu Speaking: dòng "Nguồn chấm" luôn "AI chấm, trả ngay" (không có trạng thái chờ duyệt); dòng và nút đoạn được chấm phát âm theo FR-07-057 từ `pronunciation.sample` của G04-T13 (trường chưa có → không hiện dòng); dòng lượt theo FR-07-058. Thi thử: Overall theo 5.6 và FR-07-054 — chỉ ở mock test được giao; nếu backend vẫn trả `overall` khi thiếu kỹ năng hoặc cho đề tự chọn thì frontend tự ẩn và báo lại trong PR (sửa backend là việc của G02 nếu đã nhận). Trạng thái "Đang chấm" từng phần của kỳ làm lần lượt: dùng component của G08. `/speaking/full-test/result` có thanh điều hướng. 8 test nhắc `(authed-session-result)`, 4 nhắc `(authed-mock-result)` — cây mới sau cờ.
- 2 phiên · 3.


### G07-T23 — Đợt 9: Quick Check
- Chỉ làm khi anh Andy trả lời Cần quyết #2. Như T06; thêm `lib/quiz-player-model.mjs` L288, `grammar/exercises/grammar-exercises-behavior.tsx` L60, `grammar/[category]/[slug]/article-behavior.tsx` L395 (trang công khai SEO — đổi href không đổi URL trang), `vocab-practice-behavior.tsx`, `vocabulary-hub-behavior.tsx`; `EXACT_REPLACEMENTS` `/pages/quiz.html`, `/pages/quiz-progress.html`; workflow L207–209. Test 9 file (A2).
- 1 phiên · 3.

### G07-T24 — Chốt 308 và dọn
- Khi anh Andy nói: đổi `permanent: false` → `true` cho các dòng G07; sửa test `learner-route-moves`. Khi cờ `learner_v2_all` bật ≥ 14 ngày không lỗi: xoá cây Home/phiếu cũ và các test chỉ phục vụ cây cũ (liệt kê từng test trong PR, quy ước 4.8).
- 1 phiên · 2.

### G07-T25 — Bốn hub kỹ năng theo một mẫu (tờ HubKyNang, LuyenTap, DanhSachDe)
- Mẫu: Làm tiếp → Gợi ý → Thư viện → Lịch sử cho `/speaking`, `/writing/dashboard`, `/listening`, `/reading` (bỏ `redirect('/reading/vocab')`). Các tờ Đợt 4 nay đã có trong `thiet-ke/` (phân xử 15 của 01 mục 6) nhưng chưa được anh Andy duyệt: dựng theo tờ, ghi trong PR là bản nháp. 4 phiên · 3.

### G07-T26 — (mới) Mở `/home`, "Lần đầu vào" và `/api/student/today` cho tài khoản `is_active=false` (high-risk: auth)
- Mục đích: tài khoản chưa có khoá (đăng nhập bằng Google hoặc mã 6 số, chưa có đơn được xác nhận, chưa nhập mã lớp) vào được Hôm nay ở trạng thái "Chưa có khoá" hoặc "Đơn chờ xác nhận" (00 mục 2 điểm 20, GOI-05 "Thay đổi so với bản 16/11").
- Đầu vào: 5.9; `frontend/components/authed-shell.tsx` (prop `activationGate`), `backend/services/activation_gate.py` (`ACTIVATION_EXEMPT_ROUTES`), `backend/tests/test_activation_gate_inventory.py`, `frontend/tests/route-auth-guard-inventory.test.mjs`; GOI-05 FR-05-031 và mục 10 câu 13.
- Việc làm: theo 5.9 mục T26 (bốn bước); spec: ghi vào LEARNERCORE-0063 như một phần high-risk (auth) hoặc amendment riêng nếu LEARNERCORE đã duyệt ở mức `feature`.
- Nghiệm thu: test backend: tài khoản `is_active=false` gọi `GET /api/student/today` → 200 với `state` ∈ `no_course`, `order_pending`, các danh sách rỗng, không truy vấn bảng bài làm; gọi một route học viên khác → vẫn 403 như cũ. Test React: tài khoản chưa kích hoạt mở `/home` không bị đẩy về `/login`; mở `/course` thấy trang "Cần có khoá". Staging: tài khoản QA mới tạo bằng mã email → `/home` trạng thái "Chưa có khoá".
- Không làm: không đổi `require_active_learner`; không mở route nộp bài, luyện tập, phòng thi cho tài khoản chưa kích hoạt; không sửa thứ tự cascade trong `authed-shell.tsx`.
- Vướng mắc → cách gỡ: `activationGate` là prop theo layout (server component không đọc được cờ người dùng) → bỏ cổng ở layout và kiểm trong cây client sau khi có `me`; cổng một phiên trả 409 `session_not_current` cho `/api/student/today` → mở màn 8a/8b của G05-T20, không coi là lỗi.
- 1 phiên · 4.

### G07-T27 — (mới) Khối "Hết lượt chấm" dùng chung và liên kết học ở "việc nên sửa"
- Mục đích: FR-07-055, 056.
- Đầu vào: tờ `GiaHanThemLuot` (khối chung, màn 3, 4), `KetQuaWriting`, `PhieuKetQua` mục 1; GOI-04 mục 5.9 (402 `insufficient_credits`, `credit_source`); 5.9.
- Việc làm: `CreditsEmptyNotice`; `fix-link-model.mjs` + `fix-link-map.json`; gắn vào phiếu Writing (T20) và Speaking (T22), Hôm nay (T14), `/tests` (T16); ghi props trong PR để G08 dùng ở màn nộp bài.
- Nghiệm thu: test node cho `fixLink` (có ánh xạ → href đúng; không có → null); test React: `source='class'` không có nút đăng ký, có câu "Liên hệ giáo viên để được cấp thêm"; `source='online'`, `can_renew=true` có nút "Đăng ký lại khoá"; `source='online'`, `can_renew=false` không có nút đăng ký, có câu "Liên hệ Aver để được cấp thêm lượt" và khối liên hệ; không chuỗi "mua", "giá".
- Không làm: không gọi AI; không tạo đơn "thêm lượt" lẻ (GOI-04 Q14).
- 2 phiên · 3.


### G07-T28 — (mới 18/11 tối) Script nạp bài học khoá online
- Mục đích: khoá online có đường nạp bài học (00 mục 2 điểm 19: nội dung nhập qua script backend); nghiệm thu T19 cần bài mẫu do admin nhập.
- Đầu vào: 5.4, 5.5 (`course_lessons`); T18 đã merge; helper lô nhập của G09-T36 (`import_batch_log`); tờ `AdminKhoaHoc` thẻ "Chương trình"; spec COURSELESSON-0064 (thêm FR cho script trước khi viết mã; spec đã duyệt thì PR sửa spec).
- Việc làm: `backend/scripts/import_course_lessons.py` (mặc định chạy thử, `--execute` mới ghi; ghi lô qua `import_batch_log` của G09-T36) nạp `course_lessons` từ thư mục nội dung của khoá. Thẻ Chương trình của `/admin/courses/[id]` (G09-T13) chỉ đọc danh sách bài và bật/tắt `is_preview`, `is_published`; route admin cho hai cờ này làm trong nhiệm vụ này nếu G04/G09 chưa có.
- Nghiệm thu: chạy thử in số bài thêm/sửa, không ghi; `--execute` hai lần cùng thư mục không tạo dòng trùng; lô có trong nhật ký lô nhập; trên staging nạp 3 bài thử cho một sản phẩm thử → `lesson_count=3` ở API khoá công khai.
- Không làm: không soạn nội dung bài giảng; không đụng dây chuyền Hermes; không dựng trang tải lên.
- Vướng mắc → cách gỡ: chưa có nguồn bài giảng của sáu khoá (câu "dữ liệu sáu khoá", `01` mục 7.2 câu 13) → test với thư mục mẫu trong `backend/tests/fixtures/`, không nạp dữ liệu thật; G09-T36 chưa merge → ghi lô vào log và báo trong PR.
- 2 phiên · 3.

### G07-T29 — (mới 18/11 tối) Trang bài học thử công khai (tờ BaiHocThu)
- Mục đích: lối "Học thử" ở trang khoá (`preview_href` của G05) dẫn tới một bài thật; tờ AdminKhoaHoc: chọn bài học thử thì bài đó mở trên trang khoá công khai.
- Đầu vào: tờ `BaiHocThu`; T19 (trang bài giảng, trình phát); 5.4; GOI-05 (khung công khai, `preview_href`).
- Việc làm: route công khai do `preview_href` trỏ tới (tên chốt trong spec COURSELESSON-0064), không cần tài khoản, chỉ mở bài `is_preview=true` và `is_published=true`; API công khai đọc đúng một bài thử; người đã có quyền khoá thì chuyển sang bài đó trong Lộ trình; khung công khai của G03.
- Nghiệm thu: bài `is_preview=false` → 404; khách chưa đăng nhập mở được bài thử; người có quyền → chuyển tới `/course/learn/…`; ảnh chụp 1280px và 390px.
- Không làm: không mở bài thường cho khách; không ghi tiến độ cho khách.
- Vướng mắc → cách gỡ: chưa có bài nào được đánh dấu thử → trang khoá không hiện lối "Học thử" (G05 ẩn khi `preview_href` null).
- 2 phiên · 3.

### G07-T30 — (mới 18/11 tối) Bài được giao và buổi học theo tờ LoTrinhBaiDuocGiao, LopBuoiHoc
- Mục đích: dựng lại giao diện `/course/assigned` và thẻ "Buổi học và tài liệu lớp" (FR-07-030) theo tờ; quy tắc trên tờ: nhóm Quá hạn · Đến hạn · Chờ duyệt · Đã trả, nút theo trạng thái, nhãn "Xem bài đã nộp" (HV-26), "Tự luyện bài này" cho bài đã đóng (HV-22), trạng thái "Đã nộp · chờ giáo viên công bố" ở buổi học.
- Đầu vào: tờ `LoTrinhBaiDuocGiao`, `LopBuoiHoc` (ghi chú cho lập trình); T15 (`/course/assigned` đang giữ `MyClassWorkspace`); `/api/class/my-assignments`; G04 `charge_plan` (lượt lớp); GOI-11 phần E (chế độ "giáo viên công bố").
- Việc làm: 1) `/course/assigned` theo tờ sau cờ `learner_v2` (cây cũ giữ khi tắt). 2) Thẻ "Buổi học và tài liệu lớp". 3) "Tự luyện bài này" cho bài đã đóng: Listening/Reading/từ vựng/ngữ pháp tự chấm, không tính vào bài giao; Writing/Speaking dùng lượt lớp (G04 `charge_plan`). Backend: route tự luyện bài đã đóng — PR riêng, high-risk nếu đụng chấm, cần FR trong spec LEARNERCORE-0063 trước khi viết mã.
- Đầu ra: 2 PR (giao diện · route tự luyện).
- Nghiệm thu: test React theo bốn nhóm; bài đã đóng có "Tự luyện bài này" và nộp bài tự luyện không đổi trạng thái bài giao; buổi có bài kiểm tra chờ công bố hiện "Đã nộp · chờ giáo viên công bố"; ảnh chụp 1280px và 390px.
- Không làm: không sửa `_visible_assignments`; không đổi luồng chấm bài giao.
- 3 phiên · 4.

### G07-T31 — (mới 18/11 tối) Trang xem lại bài làm theo tờ XemLaiBaiLam
- Mục đích: `/listening/review`, `/reading/review` theo tờ: bộ lọc "Chỉ câu sai", ghi chú cá nhân tối đa 500 ký tự, "Báo lỗi đề".
- Đầu vào: tờ `XemLaiBaiLam`; hai trang hiện có; component G03; route phản hồi đề hiện có (`CHƯA KIỂM`: `grep -rn "feedback" backend/routers | head`).
- Việc làm: áp khung mới sau cờ; ba khối trên. Ghi chú cá nhân cần bảng mới thì lấy số trong dải 420–439 của gói, ghi vào sổ.
- Nghiệm thu: test React: lọc câu sai; ghi chú quá 500 ký tự bị chặn; "Báo lỗi đề" gửi được một lần mỗi câu; ảnh chụp 1280px và 390px.
- Không làm: không đổi cách chấm.
- 2 phiên · 3.


## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| Thêm redirect trước khi xoá trang | `COLLISION: app route /x is SHADOWED by config source /x` | Dời thư mục và thêm redirect trong **cùng commit** | Không |
| Xoá trang mà quên đích HTML cũ | `legacy-url-redirects.test.mjs`: `/pages/x.html redirects to missing /x` | Thêm dòng `EXACT_REPLACEMENTS`; cập nhật sha256 L72 (chạy test, lấy băm thực tế in ra bằng `node -e` theo cùng công thức), ghi băm cũ/mới trong PR | Số quy tắc khác 139 → dừng: đã lỡ thêm/bớt nguồn |
| Viết redirect ngoài `next.config.ts` hoặc nháy kép | `route-ownership-check` không thấy, không báo va chạm | Viết literal `{ source: '…', …}` nháy đơn trong `next.config.ts` | Không |
| Regex nonce lệch tập trang | `csp-nonce-report-only` L246: "AuthedShell, not matched" | Sửa **cả** `proxy.ts` matcher và `nonceRouteAllowed` cùng lúc, cùng thứ tự chữ cái | Test đòi khớp trang công khai mới của G05/G06 → báo gói đó |
| Robots chặn trang công khai | `/courses` của G05 bị Disallow | Dùng `'/course/'`; trang `/course` không cần Disallow riêng vì có `robots: {index:false}` trong metadata (kiểm `export const metadata` của trang) | Không |
| Lọc đường dẫn workflow cũ | PR dời thư mục mà job "next-native-browser" không chạy | Sửa `paths` trong `.github/workflows/next-native-browser.yml`; không đổi tên job | Không |
| Test đọc chuỗi mã nguồn vỡ do dời thư mục | `ENOENT …/app/(authed)/course-exercises/…` | Đổi đường dẫn trong test, giữ nguyên khẳng định; không viết test mới kiểu này | > 30 test vỡ ngoài dự kiến → dừng, gửi danh sách |
| Backend và frontend triển khai lệch | Bài Grammar được giao không mở được | Frontend nhận hai dạng trước; backend đổi ở PR sau | Không |
| Kiểu API lệch | CI typecheck: `git diff --exit-code types/api.d.ts` đỏ | `cd backend && SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_KEY=test-key python -c "import json; from main import app; open('/tmp/openapi.json','w').write(json.dumps(app.openapi()))"` rồi `cd frontend && ./node_modules/.bin/openapi-typescript /tmp/openapi.json -o types/api.d.ts` | Không |
| Thêm cờ bắt buộc vào `normalizeAuthMe` | Mọi người bị đẩy ra `/login` khi backend chưa lên | Đọc mềm, mặc định false | Không |
| CSS cũ đè cây mới | Liên kết mất gạch chân, khoảng cách lệch trên `/home` mới | Sửa ở component v2 (G03), không sửa CSS trang cũ, không đổi `authed-shell.tsx` | Cần đổi thứ tự cascade → dừng, hỏi |
| Đụng file của gói khác | G08 đang sửa cùng `mock-exam-runner.tsx` | Gói đứng trước trong bảng phụ thuộc làm trước, gói sau rebase (quy ước 7) | Hai PR mở cùng file → hỏi |
| Đếm test ứng viên quá cao | Danh sách grep có file chỉ nhắc trong chú thích | Chạy bộ đầy đủ, chỉ sửa file thực sự đỏ; ghi danh sách thật trong PR | |

Danh sách test ứng viên theo đợt (đếm bằng grep tên thư mục + URL, bỏ `fixtures/legacy-html-retired`): Đợt 1: 18 · Đợt 2: 12 · Đợt 3: 21 · Đợt 4: 7 · Đợt 5: 18 · Đợt 6: 15 · Đợt 7a+7b: 10 · Đợt 8: 17 · Đợt 9: 9. Luôn thêm 5 test dùng chung: `legacy-url-redirects`, `section-index-redirects`, `csp-nonce-report-only`, `route-auth-guard-inventory`, `site-overview-coverage`. Lệnh tự đếm lại: `cd frontend && grep -rlE "<chuỗi>" tests | grep -v fixtures/legacy-html-retired | sort -u`. Tooling `verify-*-flow.mjs` có đường dẫn cũ (ví dụ `verify-mock-exam-flow.mjs`, `verify-d1-exercise-flow.mjs`, `verify-quiz-flow.mjs`, `verify-advanced-vocabulary-flow.mjs`, `verify-assigned-grammar-flow.mjs`, `verify-learner-route-auth-boot-flow.mjs`, `verify-error-states-flow.mjs`, `verify-chrome-early-render-flow.mjs`, `write-flows/course-exercises-verdict.mjs`, `write-flows/reading-exam-mock-sitting.mjs`, `write-flows/speaking-start.mjs`) — sửa trong đúng đợt.

**Thứ tự chuyển và lý do.** Đợt 1–2 trước: trang sau cờ tính năng, ít người, không chấm bài. Đợt 3–4: bài lớp, có cầu nối backend nhưng redirect giữ được link cũ. Đợt 5–6: trang kết quả chỉ đọc. Đợt 7a/7b: phòng thi — rủi ro cao nhất, làm khi các đợt trước đã chạy ổn trên staging và ngoài lịch thi. Đợt 8 (`/my-class`) cần `/course` có thật. Đợt 9 chờ quyết. Màn mới: trang thêm mới (`/practice`, `/account`, `/progress`, `/help`, `/course`) không thay gì nên làm sớm; `/home` và phiếu kết quả thay màn đang dùng nên đi sau cờ.

## 8. Ràng buộc riêng của gói

1. Không đổi tên nhóm route `(…)` khi dời; chỉ dời thư mục đoạn URL.
2. Không đổi `frontend/components/authed-shell.tsx`, không đổi `pageStylesheets` của layout đang sống.
3. Không sửa nội dung `public/js/components/aver-chrome.js` ngoài href đổi đường dẫn (G03 thay cả file).
4. Không đổi giá trị query dùng làm định danh (`from=my-class`, `session_id`, `sitting`, `bank`, `item`, `assignment_item`).
5. Redirect của G07 để `permanent: false` tới T24.
6. Mỗi đợt đổi URL một PR; không trộn với thay giao diện.
7. Phòng thi đổi URL giữ nguyên toàn bộ nhãn tiếng Anh; phiếu kết quả tiếng Việt.
8. Không hiện số lượt, band, ngày hết hạn tự bịa khi API chưa có: ẩn khối.
9. Mọi thử trên staging dùng tài khoản QA và dữ liệu thử; không nộp bài, không gửi chấm lại trên production.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

### 9.1 Kịch bản đầu-cuối (staging, tài khoản QA)
1. **Học viên chỉ lớp.** Given tài khoản QA thuộc lớp thử có 2 bài quá hạn, 1 bài hạn ngày mai, cờ `learner_v2` bật. When mở `/home`. Then thấy "Hôm nay bạn có 3 việc", hai bài quá hạn có nhãn "Đã quá hạn" lên đầu, không thẻ "Bài tiếp theo", bấm bài Writing mở đúng trình soạn của bài đó.
2. **Học viên chỉ online.** Given tài khoản QA có quyền Khoá Ngữ pháp nền tảng thử (G04) và 1 bài học thử `is_published`. When mở `/course`. Then nhóm "Khoá online của bạn" có khoá, nhóm lớp thu gọn có "Nhập mã kích hoạt"; bấm bài → `/course/learn/<code>/<lesson>`, video phát; tải lại tiếp đúng vị trí.
3. **Chưa có khoá.** Given tài khoản mới tạo bằng mã email, `is_active=false`, không lớp, không khoá, không đơn (sau T26). When đăng nhập. Then tới trang "Lần đầu vào" (không có ô hỏi đồng ý dùng bản ghi âm); "Bỏ qua" → `/home` trạng thái "Chưa có khoá": "Xem các khoá", "Nhập mã kích hoạt của lớp", lối Thư viện, khối chấm thử; không có số 0; không bị đẩy về `/login`.
3b. **Đơn chờ xác nhận.** Given tài khoản QA có một đơn `needs_info` (sản phẩm thử của G04). When mở `/home`. Then thấy trạng thái đơn có nhãn Cảnh báo và hạn bổ sung, nút "Mở trang đơn"; thanh trên không có số lượt.
3c. **Hết lượt.** Given học viên lớp thử có mã kèm lượt, số dư 0. When mở `/home` và phiếu Writing. Then khối "Hết lượt chấm" với câu "Liên hệ giáo viên để được cấp thêm", không có nút đăng ký.
4. **Link cũ.** Given bookmark `/my-class`, `/full-test`, `/mock/result?sitting=<id thử>`, `/flashcard-study?stack=wiki:food` (chưa đăng nhập), `/pages/my-class.html`. When mở. Then một bước chuyển hướng tới trang mới, đủ query, trang mở đúng.
5. **Phiếu chờ duyệt.** Given bài Writing thử ở trạng thái `graded`. When mở `/writing/result?essay_id=…`. Then không band, có 4 bước, không có nút chấm lại.
6. **Chấm lại.** Given bài thử `delivered`. When chọn "Khác", để trống ghi chú. Then nút Gửi bị khoá và có câu nhắc; ghi chú 10 ký tự → gửi được; mở lại thấy "Đã gửi yêu cầu chấm lại"; admin thấy lý do + ghi chú.
7. **Thi thử.** Given tài khoản QA không được giao kỳ thi nào. When mở `/tests`. Then chỉ có full test từng kỹ năng và mini test, không có khối "Mock test được giao", không có cột Overall có giá trị. Given kỳ thi QA được giao chỉ có Listening. When mở `/tests/mock/result?sitting=…`. Then không có Overall.
7b. **Phiếu Speaking.** Given bài Speaking Part 2 thử dài hơn 35 giây, cờ `pron_sample_window` bật (G04-T13). When mở phiếu. Then có dòng "Phát âm được chấm trên một đoạn trích…" và nút nghe đúng đoạn; mỗi "việc nên sửa" có ánh xạ thì có liên kết học.
8. **Tắt khẩn.** Given cờ `learner_v2` runtime tắt. When tải lại `/home` sau 15 giây. Then giao diện cũ.

### 9.2 Lệnh bắt buộc mỗi PR
Bộ lệnh ở `00-QUY-UOC-CHUNG.md` mục 5.3, cộng `node frontend/tooling/route-ownership-check.mjs` và (khi đổi URL) `cd frontend && npm run build && node tooling/route-ownership-check.mjs --manifest`.

### 9.3 Ảnh
1280px và 390px cho Hôm nay, Lộ trình, Bài giảng, phiếu Writing (đủ ba trạng thái: AI trả ngay, chờ duyệt, đã duyệt), mỗi màn cả trạng thái rỗng và lỗi một khối.

### 9.4 Ca biên phải có test
- URL cũ kèm query và kèm `#hash` (hash do trình duyệt giữ).
- `/grammar-checkup/review` trần và `/course/grammar-checkup/review` trần.
- Học viên vừa lớp vừa online (hai dòng lượt theo nguồn, một tổng); lớp đã lưu trữ (không hiện); quyền khoá hết hạn hôm nay; học viên lớp mã cũ không kèm lượt (không có khối lượt).
- Tài khoản `is_active=false` có đơn mở và không có đơn; 409 `session_not_current` ở `/api/student/today`.
- Bài dở hết `resume_expires_at` đúng phút mở trang.
- `assigned` rỗng nhưng `has_class: true`.
- API lượt trả lỗi → khối ẩn, các khối khác còn.
- Tên khoá/bài dài trên 390px (cắt "…").
- Không thực hiện trên production: nộp bài, gửi chấm lại, bật cờ, chạy migration.

## 10. Cần anh Andy quyết

| # | Câu hỏi | Đề xuất | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| 1 | Trang Lớp học thành `/course/assigned` (thẻ là trang con) hay `/course?tab=assigned` như báo cáo 12? | `/course/assigned`: giữ được layout và CSS hiện có của trang lớp; dạng `?tab=` buộc trộn CSS cũ vào trang Lộ trình mới | `/course/assigned` |
| 2 | Quick Check (`/quiz`, `/quiz/progress`) chuyển về đâu? Player dùng chung cho Grammar (wiki công khai link vào), nên `/vocabulary/quick-check` sai nghĩa với bài Grammar | `/practice/quick-check` và `/progress?tab=quick-check` | Chưa chuyển (đợt 9 chờ); vẫn tính là 2 trong 16 |
| 3 | **ĐÃ TRẢ LỜI (00 mục 2 điểm 22):** `/exam` chuyển hướng về Thi thử `/tests` (5.1 dòng 17, G07-T12a) | — | Chuyển hướng 307 ở T12a |
| 4 | Chuyển hướng 307 trong giai đoạn chuyển rồi mới 308, hay 308 ngay? 308 bị trình duyệt nhớ, không lùi được | 307 tới khi xong cả 9 đợt + 14 ngày ổn định, rồi 308 (T24) | 307 |
| 5 | **ĐÃ PHÂN XỬ** (01 mục 6 phân xử 2): `course_lessons` thuộc G07, chỉ khoá online; G07 cấp `lesson_count`/`chapters` cho G04 (FR-07-044) | — | Như phân xử |
| 6 | Khối luyện tập trong bài giảng: bộ câu khoá hiện chỉ mở qua bài lớp giao (`list_published_banks` ẩn `course`). Khoá online mở bằng cách nào: tự tạo "bài giao cá nhân" hay đường tự học mới? | Đường tự học mới có kiểm quyền G04, spec riêng (đụng chấm bài) | Ẩn nút "Bắt đầu luyện" |
| 7 | Lý do chấm lại: dùng danh sách 5 lý do + ghi chú ≤ 300 ký tự (tờ thiết kế) thay cho ô chữ 50–500 ký tự hiện tại? | Có, migration 5.7, giữ dạng cũ song song | Giữ dạng cũ tới khi spec RESULTSHEET duyệt |
| 8 | Chấm lại Speaking (tờ có, backend chưa có): làm trong G07 hay sau? | Sau, spec riêng | Ẩn nút ở phiếu Speaking |
| 9 | **ĐÃ TRẢ LỜI** (00 mục 2 điểm 3, 20; G04-T08): Writing khoá online và tự luyện AI trả ngay; Writing lớp offline giáo viên duyệt; Speaking luôn trả ngay | — | G07 hiển thị theo dữ liệu thật (`band_source`, `status`, `review_mode`) |
| 10 | Máy chủ video riêng là dịch vụ nào (origin, cách ký URL)? | Cấu hình `AVER_PRIVATE_VIDEO_ORIGIN` | Chỉ YouTube chạy; nguồn riêng báo "Video chưa sẵn sàng" |
| 11 | **ĐÃ TRẢ LỜI (00 mục 6, sửa 18/11):** các tờ Đợt 4 (HubKyNang, LuyenTap, DanhSachDe) đã được anh duyệt ngày 17/11 | — | Dựng theo tờ |
| 12 | **ĐÃ TRẢ LỜI** (00 mục 2 điểm 20): xác nhận đơn là kích hoạt tài khoản; tài khoản chưa có khoá vẫn về Hôm nay trạng thái "Chưa có khoá" | — | T26 mở `/home`; các trang học khác giữ cổng |
| 13 | Bật giao diện mới theo người là đủ, hay cần theo lớp? | Theo người + script bật cho thành viên một lớp | Theo người |
| 14 | **ĐÃ TRẢ LỜI một phần** (00 mục 2 điểm 23): "Lỗi đang lặp lại" (Hôm nay) và "lỗi số 1" (Tiến độ) THÊM vào gói; nguồn là "Sổ lỗi cá nhân" của GOI-12 (đã viết; hàm `today_block`, G12-A04). Còn mở: khối bật ngay khi GOI-12 merge hay chờ anh xem dữ liệu thật trên staging trước | Bật theo dữ liệu: có dữ liệu sổ lỗi thì hiện | `repeat_error = null`, ẩn khối cho tới khi API sổ lỗi có dữ liệu (FR-07-029b, mục 5.3) |
| 15 | Bài kiểm tra giữa chặng của khoá online có giữ điều kiện "học xong các bài của chặng" không (tờ LoTrinh ghi "có thể giữ")? | Không giữ ở đợt đầu | Không giữ |
| 16 | **ĐÃ TRẢ LỜI** (00 mục 2 điểm 23): "Lần đăng nhập gần đây" THÊM vào gói — bảng `learner_login_events` và `GET /api/account/login-events` thuộc G04-T16, giao diện ở G07-T17 (FR-07-064). Còn mở (cùng GOI-04 Q18): có hiện "nơi gần đúng" như tờ TaiKhoan không — cần dịch vụ tra vị trí theo địa chỉ mạng, G04 không lưu IP | Không hiện nơi | Ẩn cột nơi; ẩn cả khối khi API chưa có hoặc cờ `single_session_learners` tắt |
| 17 | Khối "Học trước trong lúc chờ" ở trạng thái đơn chờ xác nhận (HV-12, tờ ghi là đề xuất chưa duyệt) | Không làm đợt đầu | Không dựng |
| 18 | **ĐÃ TRẢ LỜI** (00 mục 2 điểm 23): mock test "làm trong khoảng thời gian" KHÔNG được nghỉ giữa các phần; đã bắt đầu thì các phần chạy liền nhau (T16; chi tiết ở GOI-08 T22 và GOI-09 mục 5.5). Các ca biên còn mở (mất mạng, bắt đầu gần cuối khoảng mở): GOI-09 Q31, GOI-08 câu 13 | — | Theo GOI-08, GOI-09 |
| 19 | Đường dẫn của trang "Lần đầu vào" | `/start`; `/onboarding` chuyển hướng 307 | `/start` |
| 20 | **ĐÃ TRẢ LỜI** (00 mục 2 điểm 23): "Đổi email đăng nhập" THÊM vào gói — đặt ở G05-T24 (backend và thành phần `ChangeEmail`), G07-T17 gắn vào Hồ sơ (FR-07-064b). Câu còn mở về tài khoản từng vào bằng Google nằm ở GOI-05 câu 19 | — | Gắn `ChangeEmail`; G05-T24 chưa merge thì ẩn nút |
| 21 | (mới, 18/11 chiều) Câu chữ về lượt chuyển và thời hạn xem bài ở `/account` (FR-07-060, 060b) chưa có trên tờ TaiKhoan, GiaHanThemLuot (tờ còn ghi "Chuyển 50%" và "thêm XXX ngày") | Dùng câu ở FR-07-060, 060b; sửa tờ khi anh duyệt | Như đề nghị, ghi khác biệt với tờ trong PR |
