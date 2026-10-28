# PC-J05 — Điều tra trang/nút chậm trên staging (PERF-1, PERF-2)

**Ngày:** 28/10/2026 · **Môi trường:** staging (`origin/staging` 0c32f3f26, Railway deployment `df60dfb9`) · **Loại:** điều tra, chưa sửa code.
**Phạm vi đo:** chỉ đọc. Dùng log HTTP và log ứng dụng của Railway staging. Trình duyệt đăng nhập bằng tài khoản QA_ACTIVE, chỉ gửi GET, mọi POST analytics đều bị chặn. Gọi API trực tiếp bằng GET với token của QA_ACTIVE. Không ghi dữ liệu staging, không đụng production.

## Tóm tắt (người dùng thấy gì và vì sao)

- **Chậm không phải vì DB.** Ở mức PostgREST, từng truy vấn vẫn nhanh. Cái chậm là **toàn bộ backend chỉ có một tiến trình, một event loop** (`uvicorn main:app`, 1 replica, không có `--workers`). Cả 624 route trong `backend/routers/` đều là `async def`, và chúng gọi `supabase_admin….execute()`, tức HTTP **đồng bộ**. Mỗi lời gọi như vậy chặn cả event loop trong một chuyến khứ hồi xuyên vùng (Railway `asia-southeast1` ↔ Supabase). Hệ quả: các request mà trình duyệt bắn song song bị xếp hàng nối đuôi nhau. Request của người dùng này còn phải chờ request của người dùng khác.
- **Bằng chứng trực tiếp.** Bộ đo `[loop-lag]` có sẵn (`services/loop_monitor.py`) ghi trên staging hôm nay (02:12–03:08Z), khi chỉ có vài phiên QA:
  - event loop bị chặn tối đa **4 676 ms**;
  - 38/49 cửa sổ 1 phút có lần chặn > 1 s;
  - p95 của từng cửa sổ lên tới 1 578 ms. Khi rảnh thì gần 0–1 ms.
- **Vì sao số đo hôm nay thấp hơn trong phiếu.** Thời gian chờ cộng dồn theo **tổng tải của mọi người dùng**, nên số trong phiếu (20–30 s) xuất hiện khi staging đông. Hôm nay tải nhẹ nên đo được 4–8 s / trang và 5–13 s / nút. Log của các deployment trước đã bị Railway xoá (deployment `REMOVED`), nên không tìm lại được đúng lượt 30 s.
- **Nút Giao bài / Nhận chấm.** Bản thân POST chỉ mất 0,9–1,4 s. Nút bị khoá lâu vì sau POST, frontend **chờ tải lại cả 6 danh sách** của dashboard (`loadAll`). Riêng "Nhận chấm" còn phải đợi thêm một lần tải trang `/instructor/grade`, trong đó `/auth/me` chạy một mình trước khi 3 request dữ liệu được gửi.

## 1. Số đo trước khi sửa (baseline cho Web Manager đo lại)

### 1a. Trang học viên: trình duyệt headless, QA_ACTIVE, từ box agent

`lastApi` là thời điểm request API cuối cùng xong, tính từ lúc điều hướng. `dcl` là DOMContentLoaded.

| Trang | dcl | lastApi (lần 1 / lần 2) | Request quyết định |
|---|---|---|---|
| /home | 0,8 s | 6,1 s / 5,8 s | 5 GET song song **cùng xong một thời điểm** sau 3,8–4,3 s |
| /writing/dashboard | 0,9 s | 5,2 s / 5,5 s | permissions, my-assignments, my-essays song song 2,3–2,5 s, rồi prompt-bank 0,6 s |
| /my-class | 0,7 s | 3,2 s / 3,5 s | /api/class/me 1,0–1,3 s, /auth/me 1,3–1,6 s |
| /vocabulary/hub | 0,8 s | 8,0 s | /api/vocabulary-sets 5,9 s; /auth/me bị gọi **2 lần** |
| /grammar/exercises | 0,7 s | 3,6 s | /auth/me và kp-mastery 1,8 s |
| /full-test | 0,9 s | 3,8 s | /api/mock-exams 1,7 s |
| /reading/skill | 0,8 s | 4,0 s | /api/reading/skill 2,0 s |
| /reading/mini-test | 1,1 s | 3,5 s | /api/reading/test 1,2 s |
| /listening/tests | 1,1 s | 3,7 s | /api/listening/tests 1,3 s |

Mọi trang có đăng nhập đều chờ `/auth/check-active` (0,45–1,0 s) **xong rồi** mới gửi request dữ liệu đầu tiên.

### 1b. A/B có kiểm soát: cùng một bộ GET, gửi lần lượt và gửi song song

Thời gian lấy từ phía server (`totalDuration` trong log HTTP của Railway), staging, 03:11–03:12Z. Mỗi chế độ chạy 3 vòng.

| Endpoint | Gửi riêng (trung vị) | Khi gửi cùng 5 GET khác |
|---|---|---|
| GET /api/grammar/categories (đã cache, không đụng DB) | **10 ms** | **1 593 ms** |
| GET /api/student/permissions | 657 ms | 1,9–3,7 s |
| GET /api/writing/my-essays | 467 ms | 1,9–3,7 s |
| GET /api/class/me | 457 ms | 1,9–4,0 s |
| GET /api/writing/my-assignments | ~0,9–1,1 s | 1,9–4,2 s |
| GET /api/student/home-summary | 2 324 ms | 3,0–4,3 s |

Một endpoint 10 ms trở thành 1,6 s chỉ vì gửi cùng lúc với request khác. Đây là dấu hiệu xếp hàng trên event loop, không phải DB chậm.

### 1c. Nút giảng viên, dựng lại từ log HTTP staging (phiên QA giảng viên lúc 02:47–02:59Z)

| Thao tác | POST | Tải lại dashboard (6 GET) | Mở /instructor/grade | Từ lúc bấm đến khi dùng được |
|---|---|---|---|---|
| Giao bài (`POST /instructor/assignments`, 02:55:37) | 992 ms | 3,7 s, cả 6 GET xong cùng một ms | – | **≈ 5,0 s** "Đang giao…" |
| Nhận chấm (claim f1161469…, 02:47:37) | 1 426 ms | 4,8 s | /auth/me 1,0 s → queue 1,4 s, essay và versions 2,7 s | **≈ 13,5 s** |
| Nhận chấm (claim 11553ed3…, 02:59:23) | 978 ms | 3,2 s | /auth/me 1,1 s → queue 1,3 s, essay và versions 3,4 s | **≈ 12,2 s** |

## 2. Top 5 endpoint/luồng chậm

Lấy từ 3 865 dòng log HTTP staging, 02:12–03:12Z. Bỏ OPTIONS và analytics.

| # | Endpoint / luồng | p50 · p95 (log) | Nguyên nhân chính (file:dòng) | Đề xuất sửa (job con) |
|---|---|---|---|---|
| 1 | **Dashboard /instructor: 6 GET** (`/instructor/cohorts`, `students`, `prompts`, `codes`, `assignments`, `reviews/queue`), tải lại sau **mỗi** lần Giao bài hoặc Nhận chấm | 3,4–3,6 s · 4,8 s | (a) Frontend `mutate()` và `claimAndGrade()` chờ `loadAll` đủ 6 GET mới mở khoá nút hoặc điều hướng (`frontend/app/(authed-instructor)/instructor/instructor-dashboard.tsx:180-211`, `:309-326`). (b) Mỗi GET phải qua `require_instructor`, gồm 1 lời gọi Auth và 2 select `users` đồng bộ (`backend/routers/admin.py:110-138`). (c) `reviews/queue` và `claim` gọi `instructor_owned_essay_ids`, quét **không giới hạn** 3 bảng rồi nhét mọi id vào `.in_()` (`backend/services/instructor_access.py:121-153`, `backend/services/instructor_workflow.py:134-156`). Trong khi đó `_essay_owned_by` (`instructor_access.py:174`) đã có sẵn kiểu kiểm tra EXISTS hẹp. | **J05-C** (backend, nhỏ): `claim` dùng `_essay_owned_by` thay cho quét toàn bộ (cùng ngữ nghĩa, đã ghi trong docstring). **J05-D** (frontend, làm chung PC-J10 vì trùng file): sau mutation chỉ refetch các danh sách bị ảnh hưởng (Giao bài: `assignments`; Nhận chấm: `queue`), vẫn giữ nguyên tắc "refetch canonical sau mutation". |
| 2 | **GET /api/student/home-summary** (/home, /vocabulary/hub) | 4,3 s · 5,6 s; **2,3 s khi gửi riêng** | `get_home_summary` chạy **khoảng 16 truy vấn đồng bộ tuần tự** qua 7 phần (`backend/services/student_home_aggregator.py:47`), trên event loop. | **J05-E**: chạy các phần song song, mỗi thread một client riêng, theo đúng tiền lệ `get_dashboard_payload_concurrent` (`backend/services/dashboard_aggregator.py:104-136`, `routers/dashboard.py:67-74`). |
| 3 | **GET /api/class/me** (/my-class, /home) | 3,9 s · 5,3 s; 0,45–0,76 s khi gửi riêng | Khoảng 20–30 truy vấn đồng bộ trong một request (`backend/routers/class_student.py:955`). Có các bước **ghi trong GET**: `reconcile_test_attempts` và `reconcile_course_items`. Bước sau đọc mục bài giao của **cả lớp**, không lọc theo học viên (`backend/services/quiz_service.py:3330`, `:3405-3409`). Ngoài ra có N+1 `quiz_sessions` cho mỗi mục khoá học đã hết hạn (`quiz_service.py:472`, `:542`). | **J05-F**: lọc `reconcile_course_items` theo học viên đang xem (cần AT xác nhận vì đây là đường sửa dữ liệu), và gộp N+1 thành một truy vấn. |
| 4 | **/writing/dashboard**: `/api/writing/my-assignments` + `my-essays` + `/api/student/permissions` + `prompt-bank` | 2,3 s · 3,4 s (từng cái) | Quyền Writing bị tính **3 lần trong 3 request**: `/auth/me`, `/student/permissions`, `/my-assignments`. Lần cuối dùng bản không cache `get_user_access_code_permissions` (`backend/routers/writing_student.py:222`). Mỗi lần tính là 2–3 truy vấn. `prompt-bank` lại xác thực token lần thứ hai. | **J05-G**: dùng chung bộ nhớ quyền theo request; bỏ lần xác thực lặp ở `prompt-bank`. |
| 5 | **GET /auth/me** (mọi trang, do `<aver-chrome>` và trang staff gọi) | 1,6 s · 5,4 s; 161 lượt / 1 giờ | 1 lời gọi Auth và khoảng 6 truy vấn đồng bộ: `users select *`, **UPDATE `last_seen_at` mỗi lần gọi** (`backend/routers/auth.py:233-236`), 2–3 truy vấn quyền, rồi select lại `users` cho feature flag. /vocabulary/hub gọi nó 2 lần. Trang staff gọi nó **một mình** trước khi tải dữ liệu. | Throttle `last_seen_at` đã có ở **PR #1791** (PC-J02, chờ duyệt), nên không làm lại. **J05-H**: bỏ lần gọi `/auth/me` thứ hai trên /vocabulary/hub (thuộc PC-J04). |

Ngoài top 5: `/api/vocabulary-sets` có p50 5,5 s, thuộc PC-J04. `/api/mock-exams/my-sittings` p50 4,0 s, và `/health/ready` 2,8–3,9 s vì gửi 20 truy vấn PostgREST tuần tự trên event loop; mỗi lần probe gọi nó cũng làm request khác phải chờ.

## 3. Nguyên nhân gốc chung (áp dụng cho mọi dòng ở trên)

1. **Một event loop, mọi truy vấn DB đều đồng bộ.** `database.py:52` tạo một client đồng bộ dùng chung. `USE_ASYNC_DB=off` trên staging (log khởi động `[async-db] USE_ASYNC_DB=off`). Không route nào trong các luồng trên dùng `aexecute` hay `to_thread`. Timeout PostgREST là 120 s (`database.py:48`), nên một truy vấn treo có thể làm treo mọi người dùng tới 2 phút.
2. **Mỗi chuyến khứ hồi DB đi xuyên vùng.** Railway chạy ở `asia-southeast1`. Supabase staging ở vùng khác: pooler là `aws-1-ap-northeast-1`, còn comment trong code ghi khoảng 56 ms tới `ap-south-1`. Mỗi `.execute()` tốn khoảng 50–150 ms, trong khi một trang cần 10–40 lượt như vậy.
3. **Chi phí auth mỗi request, không cache giữa các request.** Learner: 1 lời gọi Auth và 1 select `is_active` (`services/activation_gate.py:150-207`). Staff: 1 lời gọi Auth và 2 select `users`. Admin giả danh `?as_instructor=` còn thêm 2 select và 1 insert audit.

Không có lời gọi AI hay gửi email nào nằm trên đường request của các luồng này.

## 4. Job con đề xuất (mỗi job một PR riêng, base `staging`, merge sau promote)

| Job | Ưu tiên | Nội dung | Rủi ro | Cần quyết định? |
|---|---|---|---|---|
| **J05-A** | P2 | Bỏ chặn event loop trên các route nóng: auth gate, `require_instructor`, `/auth/me`, permissions, 6 GET instructor, writing dashboard, class/me. Đây là gốc của mọi số ở trên. | Trung bình | **Có, xem D1** |
| **J05-B** | P2 | Chạy uvicorn nhiều worker, ví dụ `--workers 2`, trên Railway staging. Cách giảm xếp hàng nhanh nhất mà không sửa code. | Trung bình: 3 vòng reaper (`main.py:711-783`) sẽ chạy ở **mỗi** worker; cache trong tiến trình và bộ nhớ theo request bị tách theo worker; RAM tăng. | **Có, xem D2** |
| J05-C | P3 | `claim` dùng `_essay_owned_by` | Thấp | Không |
| J05-D | P3 | Dashboard instructor chỉ refetch danh sách bị ảnh hưởng; Nhận chấm điều hướng ngay khi claim đã xác nhận | Thấp–TB | Làm chung PC-J10 (trùng `instructor-dashboard.tsx`) |
| J05-E | P2 | `home-summary` chạy song song theo tiền lệ dashboard | Thấp | Không |
| J05-F | P3 | `/api/class/me`: lọc reconcile theo học viên, gộp N+1 | TB (đường sửa dữ liệu) | AT xác nhận |
| J05-G | P3 | Writing dashboard: không tính quyền 3 lần | Thấp | Không |
| J05-H | P3 | /vocabulary/hub gọi `/auth/me` 2 lần | Thấp | Gộp vào PC-J04 |

Bật `ENABLE_SERVER_TIMING=true` trên staging sẽ giúp Web Manager đọc được phân rã auth/db/app của từng request khi đo lại. Đây là thay đổi cấu hình Railway, nên làm sau khi hết đóng băng.

## 5. Quyết định cần chủ sản phẩm / Leader

- **D1: Cách bỏ chặn event loop.** Code hiện cố ý **không** đưa client đồng bộ dùng chung vào `to_thread` vì cho rằng `httpx.Client` và query builder không an toàn khi dùng chung giữa các thread (`services/db_async.py:18-24`). Hướng đã thiết kế sẵn là facade `aexecute` cùng cờ `USE_ASYNC_DB`, hiện đang "parked". Có ba lựa chọn:
  - (a) Chuyển dần các route nóng sang `aexecute`, rồi bật `USE_ASYNC_DB` trên staging trước.
  - (b) Theo tiền lệ `dashboard_aggregator`: mỗi thread dùng client riêng, rồi `to_thread`.
  - (c) Xem lại và chấp nhận dùng chung `httpx.Client` giữa các thread. Đây là thay đổi lập trường của repo.

  Đề xuất: (a) cho đường auth và permissions vì chúng chạy trên mọi request; (b) cho các aggregator.
- **D2: Có chạy nhiều worker uvicorn trên Railway không**, và có tách 3 reaper ra chạy ở một worker hoặc tiến trình riêng không. Lệnh khởi động nằm trong cài đặt dịch vụ Railway, không nằm trong repo.
- **D3: Có đặt Railway và Supabase cùng vùng không** (hạ tầng, dài hạn). Cần xác nhận vùng thực của dự án Supabase staging và production.

## 6. Cách đo lại (Web Manager)

Script nằm ngoài repo, chỉ chạy được trên staging, chỉ gửi GET:
- `/workspace/qa/perf-j05/scripts/measure.mjs`: trình duyệt, waterfall API cho từng trang (`PAGES=/home,/writing/dashboard,/my-class RUNS=2`). Cần storage state của QA_ACTIVE (`login.mjs --storage-state …`).
- `/workspace/qa/perf-j05/scripts/ab.py`: A/B gửi lần lượt và gửi song song (bảng 1b).
- `/workspace/qa/perf-j05/scripts/agg.py`, `solo.py`: p50/p95 theo route, và so sánh gửi riêng với chồng lấn, từ `railway logs --http --json`.
- Lấy chỉ số event loop bằng `railway logs -e staging -s ielts-speaking-coach --json --since 1h | grep loop-lag`.

Tiêu chí đạt (theo phiếu): trang chính < 3 s, Giao bài / Nhận chấm < 3 s. Tiêu chí kỹ thuật kèm theo: `lag_ms_p95` < 100 ms khi có 3–5 phiên QA đồng thời.
