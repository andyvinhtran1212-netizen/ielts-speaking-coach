# Implementation plan

Hợp đồng dưới đây lấy từ gói mục 5.4, 5.5 và đối chiếu với staging `31725a9b`. Chỗ ghi `CHƯA KIỂM` là việc người thực thi kiểm ở bước 1 của nhiệm vụ tương ứng, rồi ghi kết quả vào PR.

## Architecture impact

- **Backend:**
  - Router mới `backend/routers/course_learner.py` (prefix `/api/course`), gắn trong `main.py` với `dependencies=_ACTIVE_LEARNER` như các router học viên khác.
  - Service mới `backend/services/course_outline.py` (`public_outline`, `next_lesson`, `lesson_states`).
  - Route bài thử công khai `GET /api/courses/{slug}/preview/{lesson_code}` đặt trong `routers/courses_public.py` của G04, như một hàm mới (G04 sở hữu file; PR T29 chỉ thêm hàm và test). Lý do: cùng prefix, cùng cách tra `slug`.
  - Route admin `PATCH /admin/course-lessons/{id}` (`routers/admin_course_lessons.py`).
  - Script `backend/scripts/import_course_lessons.py`.
- **Quyền:** chỉ qua `services/entitlements.py::has_course_access(user_id, course_id)` của G04. Backend đọc `course_lessons` bằng client service role **sau** khi kiểm quyền. RLS không phụ thuộc `entitlements` (gói 5.5).
- **Frontend:**
  - Route group mới `app/(authed-course)/course/learn/[courseCode]/[lessonCode]/page.tsx` trong `LearnerShell`, vẽ khi `learnerV2Enabled(me)` (LEARNERCORE-0063 FR-072). Group mới, vì trang cần layout riêng (`LearnerShell` cộng CSS trình phát), và cổng sở hữu route đòi mỗi route một chủ. Không đổi tên group nào đang có (ràng buộc của LEARNERNAV-0062). Cờ tắt thì trang hiện `RedirectNotice` về `liveHref` của mục Lộ trình trong `NAV_PLAN` (`learner-sections.ts`), không ghi cứng `/my-class`: đường này dời ở đợt 8 của LEARNERNAV-0062.
  - Trang công khai `app/(public-commerce)/courses/[slug]/preview/[lessonCode]/page.tsx` (route group của G05).
  - Component `frontend/components/ui/video-player.tsx`.
  - `frontend/lib/course-learner-api.ts` (typed qua `browser-api.ts`).
- **CSP:** `frontend/tooling/content-security-policy.mjs` thêm `frame-src` ở mọi môi trường (gộp với nguồn Vercel toolbar hiện có ở preview). Sửa `docs/CONTENT_SECURITY_POLICY.md` và test CSP.
- **Registry** (LEARNERNAV-0062):
  - `/course/learn/[courseCode]/[lessonCode]` là `live` khi T19 merge, kind `child`, section `course`, parent `/course`.
  - `/courses/[slug]/preview/[lessonCode]` là `audience: 'public'`, `section: 'public'`, kind `child`, parent `/courses/[slug]`, theo đúng dạng hai dòng `/courses` đang có trong `route-registry.mjs`.

## Data and contracts

### 5.1 Migration (T18, số 506 đã giữ chỗ trong `register.tsv`)

File là `506_course_lessons.sql`. Số 506 được giữ chỗ trong `register.tsv` ngày 23/11 (PR giữ số riêng); PR T18 đổi dòng đó từ `reserved` sang `present`. Dải 420–439 không dùng: 420 đã thuộc LEARNERCORE-0063 và 421 thuộc `review_notes_flag_once`. Thêm dòng `register.tsv` cùng PR. Có file rollback `backend/migrations/rollback/<số>_course_lessons.sql`. Rollback từ chối khi `course_lesson_progress` có dòng, trừ khi `aver.allow_course_lessons_rollback = 'on'`, theo mẫu rollback của mig 383.

```sql
CREATE TABLE IF NOT EXISTS public.course_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  stage_no int NOT NULL CHECK (stage_no > 0),
  stage_title text NOT NULL CHECK (char_length(stage_title) BETWEEN 1 AND 200),
  lesson_no int NOT NULL CHECK (lesson_no > 0),
  lesson_code text NOT NULL CHECK (lesson_code ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  summary text,
  body_md text,
  video_source text CHECK (video_source IN ('youtube','private_host')),
  video_ref text,
  video_seconds int CHECK (video_seconds IS NULL OR video_seconds > 0),
  practice_bank_id uuid REFERENCES public.quiz_banks(id) ON DELETE SET NULL,
  is_published boolean NOT NULL DEFAULT false,
  is_preview boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_lessons_code_key UNIQUE (course_id, lesson_code),
  CONSTRAINT course_lessons_no_key UNIQUE (course_id, lesson_no),
  CONSTRAINT course_lessons_video_pair CHECK ((video_source IS NULL) = (video_ref IS NULL)),
  CONSTRAINT course_lessons_preview_published CHECK (NOT is_preview OR is_published)
);
-- trigger update_updated_at_column như mig 175

CREATE TABLE IF NOT EXISTS public.course_lesson_progress (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  video_position_seconds int NOT NULL DEFAULT 0 CHECK (video_position_seconds >= 0),
  max_position_seconds int NOT NULL DEFAULT 0 CHECK (max_position_seconds >= 0),
  completed_at timestamptz,
  opened_at timestamptz NULL,          -- null tới khi trang bài đã vẽ và gửi opened: true
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_course_lesson_progress_user_opened
  ON public.course_lesson_progress (user_id, opened_at DESC) WHERE opened_at IS NOT NULL;
```

Quyền:
- RLS bật cả hai bảng; `REVOKE ALL … FROM PUBLIC, anon`.
- `course_lessons`: policy `course_lessons_admin_all` FOR ALL TO authenticated USING/WITH CHECK `public.is_current_user_admin()`, theo mẫu mig 176/344. **Không** có policy đọc cho học viên.
- `course_lesson_progress`: policy SELECT `user_id = auth.uid()` cho authenticated. Không có policy ghi; backend ghi bằng service role.

Ràng buộc `course_lessons_preview_published` thực thi FR-048 ở DB.

`CHƯA KIỂM` ở T18:
- (a) `quiz_banks.id` là uuid (`\d quiz_banks`);
- (b) tên trigger dùng chung `update_updated_at_column` còn đúng;
- (c) `backend/migrations/README.md` có yêu cầu dòng `forward-policy.tsv` cho bảng mới không.

### 5.2 API học viên (`/api/course`, cần token, có `_ACTIVE_LEARNER`)

| Method · path | Response 200 | Lỗi |
|---|---|---|
| `GET /api/course/{course_code}/lessons` | `{"course":{"code","title","access":{"expires_at"\|null,"can_renew":bool}},"coming_soon":bool,"stages":[{"stage_no","title","lessons":[{"lesson_id","lesson_code","lesson_no","title","kind","video_seconds"\|null,"has_practice":bool,"state":"done\|current\|next\|todo"}]}]}` | 404 `course_not_found`; 403 `course_access_required` / `course_access_expired`; 503 `course_access_unavailable` |
| `GET /api/course/{course_code}/lessons/{lesson_code}` | `{"lesson_id","lesson_code","title","stage":{"stage_no","title"},"body_md"\|null,"video":{"source","ref"\|null,"seconds","available":bool}\|null,"practice":null,"progress":{"video_position_seconds","completed":bool},"prev":{"lesson_code","title"}\|null,"next":{…}\|null}` | như trên; 404 `lesson_not_found` (không có hoặc chưa `is_published`) |
| `PATCH /api/course/lessons/{lesson_id}/progress` body `{video_position_seconds, completed?, opened?}` | `{"video_position_seconds","max_position_seconds","completed":bool}` | 404 `lesson_not_found`; 403; 422 `position_invalid`; 503 |

Quy tắc:
- **Thứ tự kiểm:** tra `courses.code` (404) → `has_course_access` (lỗi → 503, sai → 403) → tra bài (404). Mã khoá hoặc bài lạ cho 404 trước 403 chỉ ở mức khoá. Với bài, kiểm quyền trước rồi mới tra bài, nên người không có quyền không dò được bài nào tồn tại.
- **Phân biệt hết hạn:** `course_access_expired` khi `list_access` có quyền cho khoá đó nhưng đã quá `expires_at`. Khi đó trả kèm `can_renew`, tính bằng `entitlements.can_renew(...)` từ `status`/`expires_at` của `list_access` và sản phẩm của khoá, như `me_access.py` đang làm. `AccessItem` không có trường `can_renew`.
- **`practice`:** luôn `null` cho tới khi có spec đường tự học (câu hỏi mở 2). `has_practice` chỉ để Lộ trình hiện biểu tượng.
- **Ghi tiến độ:**
  - `GET` chỉ đọc, không ghi gì (pytest đếm lời gọi ghi = 0). Mốc "đã mở" (`opened_at`) do frontend gửi sau khi trang bài đã vẽ: `PATCH` với `{video_position_seconds: <vị trí hiện tại>, opened: true}` đặt `opened_at = now()` (upsert dòng). Request bị huỷ trước khi vẽ thì không đổi `current`;
  - `PATCH` kẹp `video_position_seconds` vào `[0, video_seconds]` (bài không có video → `0`), đặt `max_position_seconds = greatest(cũ, mới)`;
  - đặt `completed_at = coalesce(completed_at, now())` khi đủ ngưỡng FR-046;
  - toàn bộ trong một `UPDATE … RETURNING` hoặc một hàm RPC nhỏ, để hai tab không ghi đè `max`.
- **Video riêng tắt ở server:** `video_available(lesson) = (video_source == 'youtube')`. Với `private_host`, mọi API (bài học, bài thử, admin xem trước) trả `ref: null, available: false`; không có biến cấu hình nào làm lộ `video_ref` của nguồn này. `PATCH` progress dùng cùng hàm: video không phát được thì nhận `completed: true` như bài đọc.
- **Không log** `body_md`, `video_ref`, email.

### 5.3 `services/course_outline.py`

- `public_outline(product) -> {"lesson_count": int|None, "chapters": list|None}`, nhận đúng dòng `course_products` mà `_outline_for(product)` của G04 có, để có cả `course_id` và `slug`:
  - chỉ đọc bài `is_published`, nhóm theo `stage_no` (tên chương = `stage_title`);
  - mỗi bài trả `{title, kind, duration_min, is_preview, preview_href}`, với `preview_href = f"/courses/{product.slug}/preview/{lesson_code}"` khi `is_preview`;
  - 0 bài thì trả `None, None`;
  - T19 thay thân `routers/courses_public.py::_outline_for(product)` của G04 bằng lời gọi hàm này, kèm test của G04 cho hình JSON. Nếu G04-T03 chưa merge thì để hàm sẵn và nối sau.
- `lesson_states(user_id, course_id) -> dict[lesson_id, state]`, theo FR-045.
- `next_lesson(user_id) -> {"course_code","course_title","stage_no","stage_title","lesson_no","lesson_count","lesson_code","title","video_seconds","video_position_seconds","practice_items"}|None`. Đủ trường cho thẻ LEARNERCORE-0063 FR-021: khoá, chặng, số bài, tên bài, thời lượng video, số câu luyện, vị trí xem dở, và nút "Học tiếp từ phút M" (`video_position_seconds > 0`) hoặc "Bắt đầu bài":
  - **Chọn khoá:** trong các khoá online có quyền còn hạn (`list_access`) có ít nhất một bài `is_published`, lấy khoá có `opened_at` mới nhất. Nếu chưa mở bài nào ở khoá nào (vừa mua), lấy khoá có quyền bắt đầu (`starts_at`) mới nhất;
  - **Chọn bài:** bài `current`, không có thì bài `next`. Khoá chưa mở bài nào thì là bài `is_published` đầu tiên theo `lesson_no`, với `video_position_seconds = 0`;
  - **Khoá đã xong hết** mọi bài `is_published`: bỏ qua, xét khoá kế tiếp theo cùng thứ tự;
  - **Trả `None`** khi không có khoá online còn hạn nào có bài `is_published` chưa xong (đã học xong mọi khoá cũng là `None`, FR-021 ẩn thẻ);
  - `practice_items` = số câu của `practice_bank_id` (đếm câu của bộ câu theo cách `quiz_banks` hiện dùng, `CHƯA KIỂM` tên bảng câu ở T19b); không có bộ câu thì `null`;
  - lỗi thì ném lỗi; `student_today` của LEARNERCORE-0063 đưa phần `next_lesson` vào `degraded`.
- **Bộ chuyển cho LEARNERCORE-0063.** Hợp đồng `next_lesson` của 0063 (plan dòng 50) dùng tên trường khác. `_next_lesson_for` trong `student_today` là bộ chuyển duy nhất, không truy vấn thêm:
  - `course_name` ← `course_title`; `resume_seconds` ← `video_position_seconds`;
  - `href` ← `/course/learn/{course_code}/{lesson_code}`;
  - `course_code`, `stage_no`, `lesson_code`, `lesson_no`, `lesson_count`, `title`, `video_seconds`, `practice_items` giữ nguyên; `stage_title` bỏ.
  - Test hợp đồng (T19b): bài xem dở ở giây 125 → `resume_seconds = 125`, `href` đúng, đủ 11 trường của 0063 và không thiếu trường nào.

### 5.4 Bài thử công khai (T29)

`GET /api/courses/{slug}/preview/{lesson_code}` (không cần token, nằm trong `ACTIVATION_EXEMPT_ROUTES`):
- sản phẩm phải công khai (`is_public`, `archived_at is null`; trạng thái `open` hoặc `coming_soon`);
- bài phải `is_preview AND is_published` và cùng `course_id`; sai bất kỳ điều kiện nào → 404 `preview_not_found`;
- trả `{title, stage, body_md, video}`, không có `progress`/`prev`/`next`/`practice`; `video` theo cùng luật `video_available` (`private_host` → `ref: null, available: false`);
- có token và `has_course_access` đúng → thêm `"learner_href": "/course/learn/<code>/<lesson_code>"`, frontend chuyển hướng;
- giới hạn tần suất 60 lần/phút/IP băm (`request_safety`).

Trang `app/(public-commerce)/courses/[slug]/preview/[lessonCode]/page.tsx`: `notFound()` khi cờ `AVER_PUBLIC_COMMERCE` tắt hoặc API trả 404; `robots: { index: false }`.

### 5.5 Admin (T28)

`PATCH /admin/course-lessons/{id}` `{is_published?: bool, is_preview?: bool}`:
- chỉ admin (`require_admin` hiện có);
- tắt `is_published` thì đặt luôn `is_preview = false`;
- bật `is_preview` khi bài chưa published → 409 `preview_requires_published`;
- ghi `governance_audit` (`action = 'course_lesson_flags'`).

`GET /admin/courses/{course_id}/lessons` trả danh sách cho thẻ Chương trình, có cả bài chưa published.

### 5.6 Định dạng thư mục nạp bài (T28)

```
<source>/
  course.yaml            # code: C1 (phải khớp --course)
  S01-<slug>/stage.yaml  # stage_no: 1, title: "…"
  S01-<slug>/B01.md      # front-matter YAML + thân Markdown
```

Front-matter của bài:
- `lesson_code`, `lesson_no`, `title`, `summary?`. `lesson_no` đánh số liên tục trên **cả khoá**, không đánh lại từ 1 ở mỗi chặng (UNIQUE `(course_id, lesson_no)`; thứ tự bài = `lesson_no`, `stage_no` chỉ để nhóm);
- `video: {source: youtube|private_host, ref, seconds}?`;
- `practice_bank_slug?`, tra ra `quiz_banks.id`; không thấy thì lỗi dòng đó.

Script:
- kiểm cùng ràng buộc như DB trước khi ghi;
- khi `--execute`, ghi upsert theo `(course_id, lesson_code)` trong một giao dịch;
- cập nhật nội dung (`title`, `summary`, `body_md`, `video_*`, `practice_bank_id`, `stage_*`, `lesson_no`) nhưng không đổi `is_published`/`is_preview`;
- có `lesson_no` trùng thì dừng cả lô.

Mẫu test nằm ở `backend/tests/fixtures/course_lessons/` (3 bài thử, nội dung giả).

### 5.7 Trình phát (T19)

`video-player.tsx` có props `source`, `ref`, `seconds`, `startAt`, `onProgress(position)`, `onEnded`:
- `youtube`: **không** nạp script `iframe_api`, vì nó cần thêm nguồn vào `script-src` (gói T19 vướng mắc a). Cách làm:
  - iframe `https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&origin=<origin của trang>&start=<startAt>&rel=0`;
  - sau sự kiện `load`, gửi `postMessage(JSON.stringify({event:'listening'}), 'https://www.youtube-nocookie.com')` để iframe bắt đầu phát `infoDelivery`;
  - chỉ nhận thông điệp khi `event.origin === 'https://www.youtube-nocookie.com'` **và** `event.source === iframe.contentWindow`; đọc `info.currentTime`, `info.playerState`;
  - `CHƯA KIỂM` (T19b, trên staging): `infoDelivery` có `currentTime` qua miền nocookie. Không có thì lưu vị trí bằng đồng hồ phía trang (bắt đầu từ `startAt`, cộng khi nhận `playerState = 1`) và ghi rõ sai số trong PR.
- `available: false` (gồm mọi bài `private_host` ở bản này): không dựng `<video>`, không có `src`; hiện "Video chưa sẵn sàng" và nút "Đánh dấu đã đọc".

## UI and interaction

- Trang bài giảng theo tờ `BaiGiang.dc.html` và `ThanhPhanHocTap.dc.html` (trình phát). Màn hình dưới 1024px: mục lục thu thành nút "Trong bài này".
- Chỉ dùng token màu của G03 ở cả hai chế độ sáng/tối; trình phát giữ nền tối cố định.
- Bàn phím: trình phát bắt tiêu điểm được. "Bài trước"/"Bài sau" là liên kết thật (`<a>`), không phải nút JS.
- Câu chữ lỗi xưng "bạn", không hiện mã lỗi (FR-042).

## Work decomposition

Xem `tasks.md`. Thứ tự: T18 (bảng) → T28 (script + cờ admin) → T19 (API + trang + CSP + nối `_outline_for`) → T29 (bài thử).

## Rollout and rollback

Chi tiết ở `rollout.md`:
- migration áp staging trước dưới khoá advisory, mỗi lần áp anh Andy gõ duyệt;
- bảng rỗng lúc đầu, nên không ai thấy gì cho tới khi nạp bài và bật `is_published`;
- trang học viên theo cờ `learner_v2`; trang bài thử theo `AVER_PUBLIC_COMMERCE`;
- CSP `frame-src` là đổi header mọi trang, nên lên riêng một PR.

## Verification strategy

- **Migration (T18):** test PG thật theo mẫu `test_*_postgres.py`:
  - chạy hai lần không lỗi; rollback chạy được và từ chối khi có tiến độ;
  - `anon` và `authenticated` không phải admin đọc `course_lessons` ra 0 dòng;
  - học viên chỉ SELECT được dòng tiến độ của mình;
  - các CHECK (`video_pair`, `preview_published`, `lesson_code`) chặn đúng.
- **API (T19):** pytest với supabase giả:
  - không quyền / hết hạn → 403 không lộ nội dung;
  - lỗi `has_course_access` → 503;
  - mở bài cuối khi chưa học → 200;
  - bài chưa published → 404;
  - tiến độ: tua lùi ghi được, `max` không giảm, ngưỡng 0,9, `completed` sớm bị bỏ qua, bài đọc nhận `completed`, hai lần ghi đồng thời giữ `max` lớn nhất;
  - `state` đủ bốn giá trị;
  - `next_lesson`: không có khoá online → `None`; vừa mua, chưa mở bài nào → bài đầu tiên, vị trí 0; đã xem dở → đúng bài và vị trí; đủ trường cho FR-021;
  - `public_outline` không có `body_md`/`video_ref`, 0 bài trả `None`.
- **Bài thử (T29):** pytest `is_preview=false` → 404; bài khoá khác → 404; khách 200; người có quyền nhận `learner_href`.
- **Script (T28):** chạy thử không ghi; `--execute` hai lần idempotent; `lesson_no` trùng dừng lô; không bao giờ đổi cờ.
- **CSP:** `node --test frontend/tests/content-security-policy*.test.mjs` có `frame-src` chứa `https://www.youtube-nocookie.com`, `script-src` không đổi.
- **React/node:** trình phát (YouTube, private rỗng, `startAt`), lưu mỗi 15 giây và khi `pagehide`, trang 403 có "Xem khoá", "sắp có".
- **Lệnh chuẩn mỗi PR:** `python3 backend/scripts/validate_specs.py`; `git diff --exit-code frontend/types/api.d.ts` sau sinh lại; `node frontend/tooling/route-ownership-check.mjs`.
