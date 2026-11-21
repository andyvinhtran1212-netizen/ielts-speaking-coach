# Kế hoạch triển khai — Full Test 4 kỹ năng (audit 2026-07-25)

Nguồn: audit luồng thi full test (mock exam) phía học viên + phía admin, 2026-07-25.
Phạm vi: `mock_exams` / `mock_exam_sittings` / `mock_exam_assignments` và các runner
Reading / Listening / Writing / Speaking khi chạy trong một sitting.

**Nguyên tắc xuyên suốt:** 2 lỗi P0 (A1, A2) có thể **xoá trắng bài thi thật của học
viên**. Mọi việc đo đạc, phân tích, làm đẹp đều xếp sau chúng — thêm biểu đồ lên nền
dữ liệu có thể biến mất là đo cái chưa chắc còn tồn tại.

---

## 0. Quyết định đã chốt (2026-07-25)

| # | Vấn đề | Quyết định |
|---|---|---|
| 1 | Học viên thuộc 2 lớp, mở được sitting ở 2 đề cùng lúc | **CHẶN** — mỗi học viên chỉ một sitting đang thi tại một thời điểm |
| 2 | Audio Listening khi khôi phục bài | **Tua tới đúng vị trí cả lớp đang nghe** (theo đồng hồ chung) |
| 3 | Thu bài và mở phần sau | **TÁCH thành 2 nút** — thu bài xong cả lớp vào phòng chờ, giám thị chủ động mở phần sau |
| 4 | Luyện Listening một mình (ngoài kỳ thi) | **Không sửa** — chỉ khôi phục bài trong phòng thi, giữ bán kính ảnh hưởng nhỏ nhất |

### Hệ quả quan trọng của quyết định 1

Hôm nay một sitting bị kẹt chỉ khoá học viên khỏi **đúng đề đó**. Sau khi chặn
cross-exam, sitting kẹt sẽ khoá họ khỏi **mọi kỳ thi**.

Mà **D3 chính là cỗ máy sinh sitting kẹt vĩnh viễn**: retake không đặt hạn đóng, học
viên không bấm bắt đầu → sitting nằm `registered` mãi mãi. Trước đây chỉ phiền; sau khi
chặn thì thành *"em không vào thi được"* ngay giữa buổi thi thật.

⇒ **D3 và D4 được kéo từ Wave 3 lên Wave 1b**, ship **cùng lô** với việc chặn. Ba PR đó
là một gói, không tách ra merge lẻ.

### Chi tiết đã chốt khi thực hiện quyết định 1

- Chỉ chặn khi **đang thực sự ngồi thi**: `registered`, `lrw_in_progress`.
  **Không** chặn ở `speaking_pending` — trạng thái đó có thể kéo dài nhiều ngày trong khi
  chờ lịch vấn đáp; chặn thì quá tay và sẽ khoá oan học viên.
- Có ràng buộc ở **tầng database** làm chốt chặn cuối, không chỉ chặn bằng code.

---

## 1. Trạng thái — TOÀN BỘ ĐÃ CODE XONG, CHỜ MERGE (2026-07-25)

18/18 PR đã tạo, xếp chồng tuần tự **#832 → #849**. Chưa merge cái nào.

| # | PR | Nội dung |
|---|---|---|
| Wave 0 | [#832](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/832) | Writing chọn bố cục + kéo giãn |
| | [#833](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/833) | Phòng thi trực tiếp |
| Wave 1 | [#834](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/834) | **A1** Listening khôi phục bài ◀ P0 |
| | [#835](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/835) | **A2** Writing lưu nháp lên server ◀ P0 |
| | [#836](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/836) | **A3** Mất mạng thì thử lại |
| | [#837](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/837) | **A4a** Listening autosave bền |
| | [#838](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/838) | **A4b** Ghi đáp án nguyên tử · **mig 161** |
| Wave 1b | [#839](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/839) | **D3** Bắt buộc hạn đóng retake |
| MỘT GÓI | [#840](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/840) | **D4** Gỡ assignment → huỷ sitting + nút gỡ kẹt |
| | [#841](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/841) | **C3** Chặn 2 sitting cùng lúc · **mig 162** (+ finding **E**) |
| Wave 2 | [#842](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/842) | **B2** Chống đua khi mở phần tiếp theo |
| | [#843](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/843) | **B4** Tách thu bài khỏi mở phần sau |
| | [#844](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/844) | **B3** Thu bài chạy nền + lưới an toàn |
| Wave 3 | [#845](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/845) | **D2** Sửa assignment tới sitting đã mở |
| | [#846](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/846) | **D5** Reaper hết N+1 |
| Wave 4 | [#847](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/847) | **A5** Speaking thử lại + gỡ kẹt |
| | [#848](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/848) | Trang "nhịp làm bài" (đo đạc **bậc 1**) |
| | [#849](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/849) | Tín hiệu integrity (**bậc 3**) |

Test: backend **3890 → 3943 passed** (+53), frontend **5364 → 5396 passed** (+32),
0 fail. Không skip / xfail / `--ignore` bất kỳ test nào.

**Test cũ bị SỬA (không xoá, không skip)** — mỗi cái đều ghim đúng hành vi mà PR
tương ứng cố ý thay đổi, và được cập nhật kèm lý do:

| Test | PR | Vì sao |
|---|---|---|
| `debounces auto-save by 2000ms` | #837 | 2s → 500ms cho ngang Reading |
| 3 test `a.assign(...)` không có khung giờ | #839 | hạn đóng thành bắt buộc |
| `test_delete_assignment_forwards` | #840 | `remove()` nhận `admin_id`, trả `voided` |
| 4 test giả định sweep chạy inline | #844 | sweep chuyển sang BackgroundTask |
| `test_writing_reports_not_live_before_submit` | #835 | Writing giờ CÓ dữ liệu sống |

**Bậc 2 của đo đạc** (đường cong số từ Writing theo thời gian) **KHÔNG** có được từ
#835. `submit_writing()` GHI ĐÈ một ảnh chụp duy nhất, chỉ giữ số từ + giờ lưu MỚI
NHẤT của mỗi task, nên không dựng lại được đường cong nào. #848 vì thế chỉ hiển thị
số từ cuối + lần lưu cuối. Muốn đường cong thì phải ghi thêm mẫu (thời điểm, số từ)
nối đuôi ở tầng lưu chính tắc — xem §8, PR-16 (Codex review, PR #850).

---

## 2. Thứ tự triển khai

```
Wave 0   ├─ PR-A   Giao diện Writing (frontend)                   [đã code]
         └─ PR-B   Phòng thi trực tiếp (backend + frontend)       [đã code]

Wave 1   ├─ PR-1   A1  Listening khôi phục bài               ◀ P0
  P0     ├─ PR-2   A2  Writing lưu nháp lên server           ◀ P0
 chống   ├─ PR-3   A3  Mất mạng → thử lại, không chết màn hình
 mất bài ├─ PR-4   A4a Listening autosave bền (client)
         └─ PR-5   A4b Ghi đáp án nguyên tử (RPC · mig 161)

Wave 1b  ├─ #839    D3  Bắt buộc hạn đóng retake (mig 161b)      ◀ tiên quyết
 MỘT GÓI ├─ #840    D4  Gỡ assignment → huỷ sitting              ◀ tiên quyết
 KHÔNG   │           +  Nút "huỷ sitting" cho admin gỡ kẹt
 TÁCH LẺ └─ #841    C3  Chặn 2 sitting cùng lúc (mig 162)        ◀ QĐ 1
 ĐÚNG THỨ TỰ NÀY: C3 bật trước D3/D4 thì các lượt thi kẹt (hạn NULL,
 assignment đã gỡ) khoá học viên khỏi MỌI kỳ thi khác mà chưa có đường gỡ —
 xem §7 và cảnh báo ngay dưới (Codex review, PR #850).

Wave 2   ├─ PR-9   B2  Chống đua khi "mở phần tiếp theo"
 an toàn ├─ PR-10  B4  Tách "thu bài" khỏi "mở phần sau"     ◀ QĐ 3
 thao tác└─ PR-11  B3  Thu bài chạy nền + hiển thị tiến độ

Wave 3   ├─ PR-12  D2  Sửa assignment tới được sitting đã mở
         └─ PR-13  D5  Reaper hết N+1

Wave 4   ├─ PR-14  A5+E Speaking thử lại + sửa copy sai
         ├─ PR-15  Phân tích tiến trình bậc 1 (dữ liệu đã có)
         └─ PR-16  Tín hiệu integrity bậc 3
```

Wave 1 **và** Wave 1b nên xong **trước kỳ thi thật kế tiếp**. Wave 2 trở đi có thể rải.

---

## 3. Wave 0 — đã code, chờ merge

### PR-A · Giao diện Writing: chọn bố cục + kéo giãn

**Người dùng thấy gì:** trong phần Writing, học viên chọn đề nằm **Trái / Phải / Trên /
Dưới** so với khung viết, và kéo thanh chia để đổi tỉ lệ hai bên (25–75%). Lựa chọn được
nhớ cho lần sau. Ảnh biểu đồ Task 1 giờ nằm cạnh khung viết thay vì phải cuộn đi mất.
Đổi tab Task chuyển cả hai bên cùng lúc.

- `frontend/public/pages/mock-exam.html` — CSS `.mw-*`, markup 2 pane + divider
- `frontend/public/js/mock-exam-runner.js` — `setupWritingLayout()`, `applyLayout()`, `applySplit()`

Kéo bằng chuột / chạm / phím mũi tên; `role="separator"` + `aria-valuenow`. Màn <860px
ép về dạng dọc và ẩn picker. Lưu localStorage **toàn cục** (thói quen của người viết,
không phải trạng thái bài thi).

**Rủi ro:** thấp — chỉ động nhánh Writing, không đụng iframe R/L.
**Kiểm chứng:** đã verify bằng trình duyệt cả 4 bố cục + kéo + đổi tab + reload.

### PR-B · Phòng thi trực tiếp

**Người dùng thấy gì (admin):** trang mới `/pages/admin/mock-live/` — một dòng mỗi học
viên, mỗi cột một phần: đã nộp / đang làm / chờ mở / **chưa vào**, kèm **số câu máy chủ
thực sự đã nhận** và giờ câu cuối về. Bộ lọc "Cần chú ý" gom người vắng, người đang làm
mà chưa lưu câu nào (`trắng`), người >5 phút không có câu mới (`im`).

- `backend/services/mock_exam_service.py` — `admin_live_monitor()`, `_expected_roster()`, `_answer_progress()`
- `backend/routers/admin_mock_exams.py` — `GET /admin/mock-exams/{id}/live`
- `frontend/public/pages/admin/mock-live/index.html`, `frontend/public/js/admin-mock-live.js`
- `frontend/public/pages/admin/index.html`, `frontend/public/js/admin-mock-exams.js` — link vào

Sửa luôn **B1**: mẫu số là sĩ số lớp (cohort, hoặc assignments với retake), không phải
số sitting đã tạo. Sửa luôn **C2**: identity bar + confirm nêu mã đề, nút disable khi
request đang bay.

Writing hiện báo *"chưa gửi bản nháp"* thay vì số 0 — **sau PR-2 phải đổi thành số thật**.

**Test:** `backend/tests/test_mock_live_monitor.py` (11 test).

---

## 4. Wave 1 — chống mất bài (P0)

### PR-1 · A1 — Listening khôi phục bài sau khi mất kết nối

**Người dùng thấy gì:** đang thi Listening mà refresh / rớt mạng / trình duyệt tải lại
thì bài **không mất nữa** — các câu đã trả lời được khôi phục và audio nhảy tới đúng vị
trí cả lớp đang nghe.

**Nguyên nhân gốc (4 tầng cộng dồn):**
1. `listening-test-player.js:228` `startAttempt()` không có đường resume; `loadTest()`
   chỉ tải bundle, backend không trả `in_progress`.
2. `backend/routers/listening.py:4581-4589` — POST attempt mới **đánh dấu attempt cũ là
   `abandoned`** rồi tạo attempt rỗng.
3. `frontend/public/js/mock-exam-hook.js:30-38` `setupEmbed()` **tự click nút start** khi
   iframe load → chuỗi trên chạy tự động, học viên không hề chọn.
4. `mock_exam_service.py:576-589` cho phép sitting re-bind sang attempt rỗng (vì attempt
   cũ không ở trạng thái `submitted`).

**Cách sửa:**

| Bước | Việc | File |
|---|---|---|
| 1 | Endpoint mới `GET /api/listening/tests/{test_id}/attempts/in-progress?sitting_id=…` → `{attempt_id, started_at, answers[]}` hoặc `null`. **Không** sửa endpoint bundle dùng chung. **Phải lọc theo `sitting_id`:** `listening_test_attempts.sitting_id` là thứ phân biệt bài THI với bài luyện thường. Chỉ định danh theo (user, test) thì học viên có attempt luyện tập cũ dang dở trên đúng đề sau này được gán vào mock sẽ được resume và attach nhầm attempt đó — chốt ở bước 5 chỉ bảo vệ attempt ĐÃ gắn và ĐÃ có đáp án. Nhánh mock đòi đúng `sitting_id` hiện tại; nhánh luyện đơn lẻ đòi `sitting_id IS NULL` (chiều ngược lại: đang có attempt mock sống thì mở đề đó từ thư viện Listening thường KHÔNG được resume vào bài thi). | `backend/routers/listening.py`, `mock_exam_service.attach_attempt()` |
| 2 | Prestart hiện nút "Tiếp tục bài đang làm"; khôi phục `STATE.answers`, `STATE.attemptId`. | `listening-test-player.js` |
| 3 | `setupEmbed()` ưu tiên nút resume của Listening (mở rộng danh sách selector, giống cách nó đã ưu tiên `exam-resume-btn-prestart` của Reading). | `mock-exam-hook.js` |
| 4 | **Audio (QĐ 2):** seek tới `now − exam.listening_started_at` — đồng hồ lớp dùng chung. Học viên mất phần audio đã trôi qua, đúng như phòng thi thật. | `listening-test-player.js` |
| 5 | Chốt chặn phía server: `attach_attempt` từ chối re-bind sang attempt **rỗng** khi attempt đang gắn đã có đáp án. | `mock_exam_service.py` |

> **Phạm vi (QĐ 4):** chỉ đổi hành vi khi `MockHook.active()`. Luyện tập Listening đơn lẻ
> (`/pages/listening-tests.html`, `/pages/listening-mini-test.html`) giữ nguyên semantics
> hôm nay. Mất bài lúc luyện thì học viên làm lại, không mất điểm thật.

**Test:** attempt in-progress trả đúng chủ; resume không tạo attempt mới; attempt cũ
không bị `abandoned`; `attach_attempt` từ chối swap sang attempt rỗng.
**Verify tay:** vào Listening trong mock → trả lời 5 câu → F5 → 5 câu còn nguyên, audio
đúng vị trí lớp.

---

### PR-2 · A2 — Writing lưu nháp lên server

**Người dùng thấy gì:** bài Writing được lưu lên máy chủ trong lúc viết. Đổi máy, trình
duyệt crash, xoá cache, hết pin — bài vẫn còn. Nếu tab chết trước khi hết giờ, bài đã
viết **vẫn được thu**, thay vì bị ghi nhận là không viết gì.

**Nguyên nhân gốc:** `mock-exam-runner.js:166, 208-213` chỉ lưu localStorage. Endpoint
`POST /api/mock-exams/sittings/{id}/writing` (`routers/mock_exams.py:148`) **đã tồn tại
và làm đúng việc này** — chỉ là client không bao giờ gọi cho tới lúc nộp. Hệ quả nặng
nhất: tab chết → `_force_collect_section('writing')` promote một `writing_submission`
rỗng (`mock_exam_service.py:1641`).

**Cách sửa** (không migration, không endpoint mới):
1. `setupWriting()`: debounce ~15s **hoặc** mỗi ~400 ký tự thay đổi → POST cả hai task.
2. Flush trên `pagehide` + `visibilitychange→hidden` (giống `reading-exam.js:2932-2935`).
3. Khi vào phần Writing: `GET /sittings/{id}` đã trả nguyên `sitting` gồm
   `writing_submission` → so timestamp với bản localStorage, **bản mới hơn thắng**; cần
   lưu kèm timestamp local.
4. Cue "đã lưu lúc HH:MM" / "chưa lưu được" cạnh bộ đếm từ.

**Việc kèm theo (bắt buộc, cùng PR):** `admin_live_monitor._section_state()` đang trả
`live: False` cho Writing kèm ghi chú *"chưa gửi bản nháp"*. Sau PR này Writing **có**
dữ liệu sống → đổi thành `live: True` + số từ thật, và sửa
`test_writing_reports_not_live_before_submit` cho khớp. Bỏ sót bước này thì console sẽ
nói dối theo chiều ngược lại.

**Tải:** 30 học viên × 15s ≈ 2 req/s — không đáng kể.
**Verify tay:** viết 200 từ → kill tab → mở lại → bài còn; kill tab và **không** mở lại
→ admin thu bài → bài vẫn đủ chữ.

---

### PR-3 · A3 — Mất mạng thì thử lại, không chết màn hình

**Người dùng thấy gì:** rớt mạng giữa bài hiện dải cảnh báo "đang mất kết nối — sẽ tự
thử lại", đồng hồ vẫn chạy, mạng về thì tự đồng bộ. Không còn màn hình lỗi cụt đường.

**Nguyên nhân gốc:** `mock-exam-runner.js:402` catch → `fail()` (dòng 39-44) dừng poll,
xoá timer, hiện màn hình lỗi chết, **không retry**. Lỗi poll bị nuốt hoàn toàn (dòng 90)
nên không có tín hiệu nào báo mất mạng.

> Số dòng `submitSection` (378-405) tính theo bản **sau PR-A**; trên `main` hiện tại hàm
> này bắt đầu ở dòng 259.

**Cách sửa:**
1. `loadState` poll: đếm lỗi liên tiếp; ≥2 → banner mất kết nối; vẫn poll với backoff.
   **Không** đụng timer.
2. `submitSection` lỗi: retry có backoff (4 lần) thay vì `fail()`. Đồng hồ đã về 0 nên
   `_force_collect_section` phía server là chốt chặn cuối — client chỉ cần kiên trì.
3. Chỉ `fail()` khi thật sự vô phương: 403 / 404 (sitting biến mất). 409 báo phần đã bị
   thu ⇒ chuyển sang phòng chờ, **không** phải lỗi.
4. Nghe `online` / `offline` để bật/tắt banner và kích retry ngay.

---

### PR-4 · A4a — Listening autosave bền (client)

**Nguyên nhân gốc:**
- `listening-test-player.js:947` — `if (STATE.inflight.has(qNum)) return;` **bỏ luôn giá
  trị mới**, không xếp lại hàng.
- dòng 956-957 — nuốt lỗi im lặng ("Silent"), không retry, không cue.
- debounce 2s (dòng 941) vs 500ms của Reading → cửa sổ mất rộng gấp 4.

**Cách sửa:** port đúng cơ chế Reading đã có (`reading-exam.js:1452-1545`): re-queue khi
va chạm inflight (giữ giá trị mới nhất), retry ladder `[400,1200,3000]`, phân biệt
`retrying`/`failed`, cue trên ô câu hỏi + dòng tổng, nút "Thử lại", listener `online`.
Hạ debounce về 500ms.

> **Nợ kỹ thuật ghi nhận, không làm ở đây:** logic retry sẽ tồn tại 2 bản (Reading +
> Listening). Tách module dùng chung là refactor riêng — trộn vào đây vi phạm quy tắc
> "một vấn đề = một patch".

---

### PR-5 · A4b — Ghi đáp án Listening nguyên tử · **migration 161**

**Nguyên nhân gốc:** `listening.py:4666-4680` đọc cả mảng `answers` JSONB, sửa trong
Python, ghi đè lại. Hai câu khác nhau lưu đồng thời → **lost update**, câu về sau xoá câu
về trước. Reading miễn nhiễm vì dùng bảng riêng 1 dòng/câu (`reading_attempt_answers`,
mig 088).

| | Phương án | Đánh giá |
|---|---|---|
| A | Tạo bảng `listening_attempt_answers` như Reading | Chuẩn nhất nhưng kéo theo migration + backfill + sửa mọi đường đọc (chấm bài, review, audit, admin) — diff rất rộng |
| B | **RPC Postgres làm read-modify-write trong MỘT câu lệnh** ✅ | Diff nhỏ, hết đua, không đụng đường đọc. Đúng tiền lệ repo (mig 132 `fn_upsert_kp_mastery`, mig 139 exact-count RPC) |

`161_fn_upsert_listening_answer.sql` — hàm `fn_upsert_listening_answer(attempt_id, q_num,
user_answer)` dùng `jsonb_set` + lọc phần tử cũ, trả số đáp án. Router gọi `.rpc()` thay
cặp select/update.

**Test:** hai PATCH song song trên 2 q_num khác nhau → cả hai còn; PATCH lại cùng q_num →
ghi đè đúng, không nhân bản.

---

## 5. Wave 1b — thực thi quyết định "chặn" · **MỘT GÓI, KHÔNG TÁCH LẺ**

> Ba PR này ship cùng nhau, VÀ THEO THỨ TỰ **#839 (D3) → #840 (D4) → #841 (C3)**.
> Merge #841 mà thiếu #839/#840 sẽ biến mọi sitting kẹt thành khoá toàn tài khoản, và
> admin không có cách gỡ. Đây là hồi quy nặng hơn chính lỗi đang sửa. Các mục dưới đây
> viết theo thứ tự merge; đánh số PR thật thay vì nhãn PR-N trừu tượng để không còn
> nguy cơ đọc nhầm thứ tự (Codex review, PR #850).

### #839 · D3 — Bắt buộc hạn đóng cho retake · **migration 161b**

**Nguyên nhân gốc:** reaper chỉ thu phần **đã bắt đầu**, hoặc thu tất cả khi
`retake_open_until` đã qua (`:1700-1707`). Nhưng `open_until` nullable và UI cho để trống
(`admin-mock-exams.js:252`) → học viên không bao giờ bấm bắt đầu ⇒ sitting **kẹt
`registered` vĩnh viễn**, giữ luôn slot `uq_mock_sitting_active`. **Sau #841 nó khoá học
viên khỏi mọi kỳ thi.**

**Cách sửa:** bắt buộc "Đóng lúc" ở form gán (gợi ý mặc định +7 ngày), validate trong
`assign()`.

**Backfill là BẮT BUỘC, và phải chạm cả hai bảng.** Điền bù mỗi
`mock_exam_assignments.open_until` là CHƯA ĐỦ: `create_sitting()` chụp giá trị đó sang
`mock_exam_sittings.retake_open_until` (`mock_exam_service.py:498`) và reaper đọc BẢN
CHỤP chứ không đọc assignment (`:1700`). Một lượt thi đang kẹt `registered` vì thế vẫn
giữ hạn NULL sau khi assignment đã được vá — và migration 162 sẽ biến đúng hàng đó
thành cái khoá học viên khỏi mọi kỳ thi mới, vĩnh viễn (Codex review, PR #850).

`migrations/161b_backfill_retake_open_until.sql` làm cả hai bước, và cố ý neo hạn của
một lượt thi ĐANG ĐƯỢC LÀM vào chính hoạt động của nó (created_at / các mốc bắt đầu)
để backfill không bao giờ thu bài đang thi. Đánh số **161b chứ không phải 164** chính là
để `apply_migrations.sh` — vốn chạy theo thứ tự TÊN FILE — bắt buộc chạy nó trước 162; rồi
xác minh bằng
truy vấn join ở cuối file: không còn lượt thi retake sống nào có `retake_open_until`
NULL trước khi tạo unique index.

### #840 · D4 — Gỡ assignment thì huỷ sitting + nút gỡ kẹt cho admin

**Nguyên nhân gốc:** `remove()` (`mock_exam_assignment_service.py:146-150`) gỡ assignment
nhưng không void sitting đã tạo, mà `create_sitting:471-478` resume **trước** các gate
(cố ý, có lý do tốt) → học viên đã bị gỡ vẫn vào được.

**Cách sửa:**
1. `remove()` void luôn sitting non-terminal của (exam, user) kèm lý do.
2. **Nút "Huỷ sitting" trên phòng thi trực tiếp** — dùng `void_sitting()` đã có
   (`:1420-1437`). Đây là van xả để admin gỡ kẹt tại chỗ giữa buổi thi; **bắt buộc phải
   có trước khi #841 lên production.**

### #841 · C3 — Chặn 2 sitting cùng lúc · **migration 162**

**Người dùng thấy gì:** học viên đang thi dở một kỳ thì không mở được kỳ thứ hai; trang
danh sách hiện *"Bạn đang có bài thi dở — tiếp tục bài đó trước"* kèm nút quay lại đúng
sitting đang làm, thay vì một nút bấm vào là lỗi.

**Nguyên nhân gốc:** `_user_in_cohort` (`mock_exam_service.py:292-296`) khớp **bất kỳ**
dòng `students` nào của user → người thuộc 2 lớp thấy cả 2 đề. `uq_mock_sitting_active`
chỉ chặn 2 sitting trên **cùng** một đề, không chặn xuyên đề.

**Cách sửa:**
1. `create_sitting()`: trước khi tạo **mới**, tìm sitting `registered`/`lrw_in_progress`
   của user ở **đề khác** → raise `SittingConflictError` kèm `sitting_id` đang dở.
   *(Đường resume ở `:471-478` vẫn chạy trước gate — học viên luôn quay lại được bài dở
   của chính mình.)*
2. `list_open_exams()`: trả kèm `blocked_by_sitting_id` để trang danh sách hiển thị đúng
   thay vì để học viên bấm rồi ăn lỗi.
3. **mig 162** — chốt chặn database:
   ```sql
   CREATE UNIQUE INDEX uq_mock_sitting_one_live_per_user
       ON mock_exam_sittings (user_id)
       WHERE status IN ('registered', 'lrw_in_progress');
   ```
   `create_sitting` bắt unique-violation và dịch thành thông báo tiếng Việt.

> ⚠ **Trước khi áp mig 162** phải chạy truy vấn rà soát: nếu đang tồn tại user có ≥2
> sitting ở 2 trạng thái đó, index sẽ **fail khi tạo**. Dọn trước (void bớt), rồi mới áp.
> Truy vấn rà soát đưa vào phần đầu file migration dưới dạng comment.

**Test:** tạo sitting đề B khi đang `lrw_in_progress` đề A → 409; `speaking_pending` đề A
→ **cho phép**; resume chính sitting đề A → luôn được; sau khi đề A `released` → mở đề B
bình thường.

---

## 6. Wave 2 — an toàn thao tác admin

### PR-9 · B2 — Chống đua khi "mở phần tiếp theo"

**Người dùng thấy gì:** bấm nhầm 2 lần, hoặc 2 giám thị cùng bấm, **không** làm cả lớp
nhảy cóc mất một phần hay được tặng thêm giờ. Lần thứ hai báo "phần đã được mở bởi thao
tác khác".

**Nguyên nhân gốc:** `mock_exam_service.py:1740-1768` đọc `active_section`, tính next,
rồi ghi **không có guard**. Hai lệnh đồng thời cùng đọc `listening`, cùng ghi `reading` +
`reading_started_at` → mốc đồng hồ bị ghi đè, cả lớp được thêm giờ.

**Cách sửa:** thêm điều kiện lạc quan vào chính câu update —
`.eq("id", exam_id).eq("active_section", current)`. Rỗng ⇒ có người đã advance ⇒ raise
`SittingConflictError` → 409 kèm trạng thái hiện tại. Patch luôn nút ở trang cũ
`admin-mock-exams.js:220-224` để disable trong lúc request (console mới đã có).

**Test:** hai lần `advance_section` liên tiếp từ cùng `active_section` → lần 2 raise,
`active_section` chỉ nhích một bậc, `{next}_started_at` không đổi.

### PR-10 · B4 — Tách "thu bài" khỏi "mở phần sau" *(QĐ 3)*

**Người dùng thấy gì (admin):** hai nút riêng.

```
[Thu bài phần này]              [Mở phần tiếp theo →]
  └─ thu bài phần đang thi        └─ mở phần sau + chạy đồng hồ
  └─ cả lớp vào phòng chờ
  └─ KHÔNG đồng hồ nào chạy
        ↓ giám thị kiểm đủ bài / cho nghỉ giải lao
```

**Cách sửa — không cần schema mới:** `POST /admin/mock-exams/{id}/collect` chỉ chạy
`_force_collect_section(exam_id, active_section)`, **không** đổi `active_section`. Học
viên bị thu bài có `{section}_submitted_at` ⇒ `isOpenSection` false
(`mock-exam-runner.js:103`) ⇒ tự về phòng chờ. Sau đó `advance` mở phần sau như cũ (và
với PR-9, bỏ qua bước thu vì mọi sitting đã có `submitted_at`).

Console trực tiếp thêm nút và hiển thị rõ trạng thái "đã thu bài — chưa mở phần sau".

### PR-11 · B3 — Thu bài chạy nền + hiển thị tiến độ

**Nguyên nhân gốc:** `_force_collect_section` (`:1593-1614`) lặp từng sitting và **chấm
từng bài L/R inline**, đồng bộ trong request. Lớp 25-30 → request rất dài, không phản
hồi; timeout thì đã thu bài nhưng `active_section` chưa nhúc nhích.

**Cách sửa:** đổi `active_section` trước (nhanh, nguyên tử, đã có guard PR-9), đẩy việc
thu bài vào `BackgroundTasks`. An toàn thứ tự: `submit_section` vốn chặn theo
`active_section` nên straggler chỉ nhận 409, và `_collect_section_for_sitting` idempotent.
Console poll 5s nên tiến độ hiện dần trên lưới học viên.

**Rủi ro:** BackgroundTask chết nếu Railway restart giữa chừng.
**Giảm thiểu:** thao tác idempotent + nút "Thu bài phần này" (PR-10) bấm lại được.

---

## 7. Wave 3 — retake còn lại

### PR-12 · D2 — Sửa assignment tới được sitting đã mở

**Nguyên nhân gốc:** `create_sitting:496-498` snapshot `assigned_skills` + window lên
sitting; `assign()` (`mock_exam_assignment_service.py:123-127`) chỉ update bảng
assignments. Sửa nhầm kỹ năng sau khi học viên đã mở đề → **sửa bị bỏ qua im lặng**.

**Cách sửa:** `assign()` cập nhật luôn sitting non-terminal của (exam, user) **nếu chưa
có phần nào bắt đầu**. Đã bắt đầu thì khoá và **báo cáo** trong response (`refreshed` /
`locked`) để admin biết chứ không im lặng.

### PR-13 · D5 — Reaper hết N+1

Reaper quét **toàn bộ** sitting `registered`/`lrw_in_progress` của mọi đề mỗi tick, rồi
`get_published_exam_by_id` từng dòng chỉ để loại các sitting sequential. → lấy trước danh
sách exam retake (nhỏ), `.in_("mock_exam_id", retake_ids)`, cache dict exam cho cả lượt.

---

## 8. Wave 4 — dọn dẹp + đo đạc

### PR-14 · A5 + E

- **A5:** `practice.js:2286-2297` POST `/speaking` nằm trong chuỗi bị `.catch()` nuốt.
  Hỏng ⇒ sitting kẹt `speaking_pending` vĩnh viễn: không review, không bao giờ release.
  → retry + lưu "còn nợ báo cáo" để lần mở sau thử lại; thêm thao tác admin gỡ kẹt (dùng
  lại đúng validation của `record_speaking`, không bỏ qua).
- **E:** `frontend/public/pages/full-test.html:34` vẫn quảng cáo *"làm liền một hơi (một
  đồng hồ tổng)"* — mô tả model all-at-once đã bị **migration 151** thay bằng sequential.

### PR-15 · Phân tích tiến trình bậc 1 — **không cần thu thập gì thêm**

`reading_attempt_answers.answered_at` và `listening_test_attempts.answers[].answered_at`
đã đủ dựng một **phân tích bậc 1 thật thà**, và dữ liệu đang nằm đó **chưa ai đọc**. Chỉ
cần một trang phân tích hậu kỳ — không phải thu thập gì thêm.

**Nhưng phải nói rõ hai kho này lưu gì.** Cả hai chỉ giữ **giá trị CUỐI CÙNG cho mỗi
câu**: Reading UPSERT theo `(attempt_id, q_num)`, Listening thay thế phần tử cùng `q_num`
trong mảng JSON. Vậy nên:

| Suy ra được | KHÔNG suy ra được |
|---|---|
| Thứ tự các lần ghi CUỐI hạ cánh (≈ "thứ tự làm sau cùng") | Thứ tự làm bài **thật** (lần chạm đầu tiên) |
| Khoảng cách giữa hai lần ghi cuối liên tiếp | **Thời gian nghĩ trên từng câu** |
| Điểm bỏ cuộc (đuôi im lặng trước giờ nộp) | **Số lần đổi đáp án** |

Bản đã ship (#848) chỉ hiển thị cột trái, và tự khai `caveats` trong payload để giao diện
không thể lặng lẽ trình bày chúng như think-time chính xác. Muốn cột phải thì phải ghi
**nhật ký sự kiện append-only** cho mỗi lần lưu — một thay đổi lược đồ riêng, KHÔNG nằm
trong PR-15 (Codex review, PR #850).

### PR-16 · Tín hiệu integrity bậc 3

Cột `mock_exam_sittings.integrity` (mig 146) **đã dành sẵn** (`{blur_count, late_ms,
resumes}`) nhưng chưa ai ghi. Ghi kèm mỗi lần autosave: đếm `visibilitychange`, số lần
resume, số lần mất kết nối, độ lệch đồng hồ client-server. Không cần bảng mới.

> **Bậc 2** (đường cong số từ Writing theo thời gian — lúc nào bắt đầu Task 2, dừng bao
> lâu, có viết vội 100 từ cuối trong 3 phút không) **KHÔNG phải sản phẩm phụ miễn phí của
> PR-2.** PR-2 dùng lại `submit_writing()`, mà hàm đó **ghi đè**
> `mock_exam_sittings.writing_submission` bằng MỘT ảnh chụp mới nhất của hai task: số từ
> và mốc thời gian của các lần autosave trước không được giữ lại, nên không dựng lại được
> đường cong nào cả. Bản đã ship (#848) vì thế chỉ hiển thị **số từ cuối + lần lưu cuối
> mỗi task** — đúng những gì kho dữ liệu thật sự có. Muốn đường cong thì phải ghi thêm
> **mẫu (thời điểm, số từ) nối đuôi** ở tầng lưu chính tắc — một thay đổi lược đồ riêng
> (Codex review, PR #850).

---

## 9. Kiểm chứng trước kỳ thi thật

Wave 1 + 1b không thể tin cậy nếu chỉ chạy unit test. Cần một **buổi chạy thử** với 2–3
tài khoản trên đề nháp:

| # | Kịch bản | Kết quả phải thấy |
|---|---|---|
| 1 | Listening: trả lời 5 câu → F5 | 5 câu còn nguyên, audio đúng vị trí lớp |
| 2 | Listening: trả lời → tắt Wi-Fi 30s → bật lại | banner mất kết nối, sau đó tự đồng bộ, không màn hình lỗi |
| 3 | Writing: viết 200 từ → kill tab → mở lại | bài còn |
| 4 | Writing: viết 200 từ → kill tab, **không** mở lại → admin thu bài | bài vẫn đủ chữ |
| 5 | Admin bấm "Mở phần tiếp theo" 2 lần thật nhanh | chỉ nhích 1 bậc, đồng hồ không reset |
| 6 | Admin bấm "Thu bài" → chờ → bấm "Mở phần tiếp theo" | sau thu bài cả lớp ở phòng chờ, không đồng hồ; mở phần sau mới chạy |
| 7 | Hai đề mở song song cho 2 lớp | advance đề A không ảnh hưởng đề B; confirm nêu đúng mã đề |
| 8 | Học viên đang thi dở đề A, mở đề B | bị chặn, có link quay lại đề A |
| 9 | Học viên `speaking_pending` đề A, mở đề B | **cho phép** (không chặn oan) |
| 10 | Admin bấm "Huỷ sitting" cho học viên kẹt → học viên vào lại | vào được |
| 11 | Console trực tiếp trong lúc 2 & 4 diễn ra | người rớt mạng hiện cờ `im`; người chưa vào hiện `chưa vào` |

**Definition of Done mỗi PR** (theo `CLAUDE.md`):
`cd backend && venv/bin/python -m pytest tests/ -q` và
`cd frontend && node --test tests/*.test.mjs tests/*.test.js` — xanh thật, **không**
sửa/skip/xfail test để ép xanh.

---

## 10. Ghi chú vận hành

- `main` **deploy thẳng ra production**, không có workflow chặn. Mọi merge phải hỏi chủ
  dự án trước, **từng PR một**.
- Migration áp **bằng tay trong Supabase SQL editor** theo tiền lệ repo, **trước** khi
  merge PR tương ứng:
  - **161** (PR-5) — RPC ghi đáp án Listening
  - **161b** (#839) — backfill hạn retake (assignment + BẢN CHỤP trên sitting) · tên đặt
    để runner buộc phải chạy TRƯỚC 162
  - **162** (#841) — index chặn cross-exam · ⚠ **phải rà soát + dọn dữ liệu trước**, xem #839
- `frontend/pages` và `frontend/js` là **symlink** sang `frontend/public/*` — sửa file ở
  `public/`.
- PR nào thêm class Tailwind mới thì rebuild `css/tailwind.build.css` (PR-A, PR-B không
  thêm class mới nên không cần).
- **Wave 1b ship nguyên gói, theo thứ tự #839 → #840 → #841.** #841 lên một mình = mọi
  sitting kẹt biến thành khoá toàn tài khoản, không có đường gỡ.
