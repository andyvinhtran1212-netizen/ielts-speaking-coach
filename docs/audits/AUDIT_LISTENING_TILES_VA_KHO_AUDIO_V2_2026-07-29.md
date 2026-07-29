# Audit — Tile mồ côi trang Listening + đánh giá kho `audio_pipeline/v2`

**Ngày:** 2026-07-29 · **Nhánh:** `feat/listening-reorg`
**Phạm vi:** `/pages/listening.html`, `/pages/listening-browse.html`,
`GET /api/listening/*`, và bộ nội dung
`09_Curriculum_Reference/audio_pipeline/v2/{audio_output_kokoro,assets}`.

---

## Phần 1 — Vì sao có tile mồ côi

### 1.1 Số liệu thật trên prod (đo trực tiếp Supabase, 2026-07-29)

| Bảng | Tổng | Đã publish |
|---|---:|---|
| `listening_tests` | 152 | **full 40 · mini 32 · drill 66** (còn lại archived) |
| `listening_content` | 286 | **4** (276 draft, 6 archived) |
| `listening_exercises` | 628 | **2** (dictation) — 465 dictation + 161 mcq đều còn `draft` |

Đối chiếu qua chính bộ lọc của endpoint danh sách (published **và** đã có
audio **và** không bị giữ cho đề thi thử):

```
full = 37   mini = 32   drill = 66   content = 4
exercise_modes = {dictation: 2, gist: 0, true_false: 0, mcq: 0, mini_test: 0}
```

> `full` là **37** chứ không phải 40: 3 đề đã publish nhưng chưa đủ audio hoặc
> đang bị giữ cho đề thi thử, nên trang danh sách vốn đã không hiển thị chúng.

### 1.2 Nguyên nhân gốc

Trang landing **hard-code 6 tile**, không hỏi cơ sở dữ liệu.
4 trong 6 tile trỏ tới trang **bắt buộc phải có `?content_id=`**:

| Tile | Trang đích | Vào từ landing (không có `content_id`) |
|---|---|---|
| Chép chính tả | `listening-dictation.html` | `showState('empty')` — trang trắng |
| Nghe ý chính | `listening-gist.html` | `showState('empty')` — trang trắng |
| Đúng / Sai | `listening-tf.html` | `showState('empty')` — trang trắng |
| Trắc nghiệm | `listening-mcq.html` | `showState('empty')` — trang trắng |

Nguồn: `frontend/js/listening-{dictation,gist,tf,mcq}.js` — cả 4 file đều có
`if (!contentId) { showState('empty'); return; }`.

Đây **không phải lỗi render**: bấm tile là chắc chắn vào ngõ cụt, 100% số lần,
với mọi người dùng. Và kể cả khi đi vòng qua "Kho bài nghe", thẻ bài nghe cũng
in cứng đủ 4 link cho mọi bài — trong khi thực tế chỉ **2 link dictation** là
sống. Tức 4 bài × 4 link = 16 link, **14 link chết**.

### 1.3 Chốt lại

- Ngõ cụt tầng 1: 4 tile trên landing.
- Ngõ cụt tầng 2: 14/16 link trên `listening-browse.html`.
- Tile chạy tốt: Full Test, Mini Test, Luyện kĩ năng (đều là trang danh sách,
  tự có empty-state).
- Ngoài ra "Kho bài nghe" đang publish **3/4 bài là rác kiểm thử**
  (`Smoke US Female` 15 giây, `Sample UK Female — …`, `… scale_test`).
  → **Đề xuất người dùng quyết định**: archive 3 dòng này trên prod. Đây là
  thao tác ghi dữ liệu prod nên chưa thực hiện.

---

## Phần 2 — Đánh giá kho `audio_pipeline/v2`

### 2.1 Quy mô

| Chỉ số | Giá trị |
|---|---|
| Block audio (`.wav` + `.md` + `.timing.json`) | **978 bộ 3** |
| Câu hỏi trong `corpus_v2.json` | **12.000** |
| Tổng thời lượng audio | **11,3 giờ** |
| Dung lượng | **1,8 GB** (WAV 24 kHz) |
| Sơ đồ trong `assets/` | 12 hình (9 map + 3 quy trình), mỗi hình có `.svg` + `.png` |

Chất lượng **cấu trúc** của file `.md` rất tốt và gần như import được ngay:
YAML frontmatter máy đọc được, đề bài, bảng đáp án, giải thích từng câu, bảng
mốc thời gian cho chép chính tả, transcript, và một khối `json` answer-key ở
cuối. `timing.json` có mốc **tới từng từ**. Không có trùng ID (0/12.000).

### 2.2 Nhưng: 44% số câu KHÔNG có audio

Kiểm chứng bằng cách đối chiếu `script` của từng item trong `corpus_v2.json`
với transcript của chính block chứa nó:

| Phân loại | Block | Câu hỏi |
|---|---:|---:|
| **UPLOADABLE** — mọi câu đều nghe được từ audio của nó | 797 | **6.725** |
| **PARTIAL** — có audio nhưng phần lớn câu không nằm trong đó | 87 | 4.610 (**4.444 câu không nghe được**) |
| **NO_AUDIO_CONTENT** — audio không chứa câu nào | 94 | 665 |

Ví dụ không thể chối cãi:

- `Generated/Gen_Contra.md` — **536 câu hỏi**, audio **5,8 giây**, transcript
  **10 từ**. 535/536 câu không có tiếng.
- `Generated/Gen_TimeDa.md` — 456 câu / 4,9 giây. `Gen_Negati` 424 câu / 4,2 s.
  `Gen_Selfco` 410 câu / 6,5 s. `Gen_Quanti` 389 câu / 5,2 s.
- `Level1/Level1_1a.md` — 15 câu, audio 3,3 giây, transcript đúng **một câu**
  (`John bought a new laptop yesterday.`) trả lời được câu 1.
- `MockTest1/MockTest1_Section1.md` — 10 câu, audio 9 giây.

Đây chính là việc `README_v2.md` đã tự ghi là **còn dang dở**:

> ⚠ Audio cần sinh lại phần mới — 695 file audio cũ thành mồ côi, 844 block mới
> chưa có audio. → chạy `cleanup_orphan_audio.py` + `kokoro_audio.py`.

Ba lệnh đó **chưa từng chạy xong**. Con số 12.000 câu là con số của *corpus
văn bản*, không phải của *bài nghe dùng được*.

### 2.3 Ngay cả phần "sạch" cũng chưa đạt nhịp đề thật

| Nhịp | Kho v2 | IELTS thật |
|---|---|---|
| Giây / câu hỏi | trung vị **5,7 s** (p25 4,7 · max 12,6) | ~30 s |
| Độ dài 1 section | 42–120 giây | 4–6 phút |

Số block đạt cả hai tiêu chí "audio khớp transcript" **và** "≥15 giây/câu":
**0/978**. Người học quen nhịp này sẽ bị sốc khi vào đề thật.

### 2.4 Mock Test 4–7: 4 câu cuối mỗi đề không nghe được

`MockTest4/MockTest4_Section2.md` khai 10 câu. Transcript (41,6 giây) chỉ dẫn
6 vị trí trên sơ đồ. Câu 7–10 hỏi phí thành viên, giờ đóng cửa thứ Bảy, chỗ đỗ
xe, lớp đông nhất — **không từ nào trong số đó có trong transcript**, dù phần
"Giải thích" vẫn trích *"£30 a year for adults."* như thể đã nói. Mock 5, 6, 7
lặp lại đúng lỗi này (mỗi đề 36/40 câu dùng được).

### 2.5 Nhãn "Câu chứa đáp án" đang sai sự thật

978/978 block có dòng `🗣️ Câu chứa đáp án: "..."` **không trùng khớp
nguyên văn** với transcript của chính nó. Phần lớn là *diễn giải rút gọn*:

| Ghi trong file | Transcript thật nói |
|---|---|
| `Opened in 1975.` | `The centre first opened in 1975, and today it has…` |
| `The surname is Chamberlain.` | `My name's Nina Chamberlain.` … `it's C-H-A-M-B-E-R-L…` |
| `Coffee originates from Ethiopia.` | `Coffee originates from the highlands of Ethiopia, in Africa…` |

Thông tin **không sai**, nhưng nhãn thì sai: đó không phải "câu chứa đáp án".
Chiếu theo chuẩn của dự án (*"Feedback must be truthful and non-misleading"*),
phải đổi nhãn thành "Ý mấu chốt" **hoặc** trích đúng câu từ transcript trước
khi cho người học thấy. Ở nhóm Mock 4–7 câu 7–10 thì nặng hơn: câu trích đó
**không tồn tại** trong audio.

### 2.6 Thiếu hình cho bài dạng sơ đồ

`MockTest1/2/3_Section2.md` là dạng map-labelling nhưng frontmatter **không có
`image:`**, trong khi `README_v2.md` khẳng định đã chuyển 3 đề này sang
map-labelling khớp sơ đồ. Chỉ **4/797** block dùng được có gắn hình, dù
`assets/` có sẵn 12 sơ đồ.

### 2.7 Độ đa dạng

764/797 block dùng được sinh từ **4 khuôn**: `Gen_P2` (291), `Gen_P3` (233),
`Gen_FormAccom` (120), `Gen_FormCourse` (120). Nội dung soạn tay thật sự —
lecture Part 4, map, flow-chart — chỉ có **33 block**.

### 2.8 Kết luận Phần 2

| | |
|---|---|
| **Dùng được ngay** | 0 block. Định dạng WAV chưa hợp web, chưa khớp bộ import hiện có |
| **Dùng được sau khi chuyển đổi** | 797 block / 6.725 câu — nhưng nhịp nhanh gấp ~5 lần đề thật |
| **Phải sinh lại audio** | 181 block / 5.275 câu |
| **Phải sửa nội dung trước khi lên web** | nhãn "Câu chứa đáp án" (978 block), Mock 4–7 câu 7–10, hình sơ đồ Mock 1–3 |

**Khuyến nghị:** *chưa* upload đại trà. Ưu tiên đúng thứ tự:

1. Chạy nốt `cleanup_orphan_audio.py` + `kokoro_audio.py` + `build_md_companions.py`
   để đóng 181 block thiếu audio.
2. Nâng nhịp lên ≥20 giây/câu (chèn khoảng lặng + câu dẫn giữa các câu hỏi).
3. Sửa nhãn "Câu chứa đáp án" thành trích dẫn thật, hoặc đổi tên nhãn.
4. Vá Mock 4–7 (câu 7–10) và gắn `image:` cho Mock 1–3 Section 2.
5. Chuyển WAV → MP3 (1,8 GB WAV ≈ 150–200 MB MP3 128 kbps).
6. Viết bộ chuyển đổi sang định dạng `Question_Paper.md` + `Solution.md` +
   `timings.json` + `.mp3` mà `scripts/import_listening_lessons.py` đang nhận,
   rồi import **thí điểm ~10 block** trước khi mở rộng.

Lô nên đi đầu: **Mock 4–7 (16 section)** + **Batch_Lectures/Lectures2/G1/
Bespoke/Process (33 block)** — nhóm 100% khớp audio và có nội dung soạn tay.

---

## Phần 3 — Cấu trúc trang Listening mới

### 3.1 Nguyên tắc

> Trang landing **không được tự khẳng định là có bài**. Mỗi thẻ chỉ hiện khi
> backend đếm được số bài thật, và con số đó phải bằng đúng số bài trang danh
> sách sẽ hiển thị.

Vì vậy tile không còn được hard-code; chúng do `GET /api/listening/overview`
bật lên. Thẻ có số đếm bằng 0 thì **không tồn tại trên trang**. Đây mới là
cách chặn tile mồ côi tái diễn — xoá 4 tile bằng tay thì lần thêm nội dung sau
lỗi cũ sẽ quay lại.

### 3.2 Bố cục

```
Luyện nghe IELTS

┌─ 1. Luyện theo đề ────────────────────────────────────────────┐
│  Full Test        [37 bài]   đề Cambridge 40 câu / 4 section  │
│  Mini Test        [32 bài]   1 section, chấm điểm + band      │
│  Luyện kĩ năng    [66 bài]   theo từng dạng câu hỏi           │
└───────────────────────────────────────────────────────────────┘

┌─ 2. Luyện tự do theo bài nghe ─── (ẩn khi kho rỗng) ──────────┐
│  Kho bài nghe     [4 bài]    Dạng luyện đang có: Chép chính tả│
└───────────────────────────────────────────────────────────────┘

┌─ 3. Tiến độ ──────────────────────────────────────────────────┐
│  Thống kê                                                     │
└───────────────────────────────────────────────────────────────┘
```

4 dạng phụ thuộc `content_id` (Chép chính tả / Ý chính / Đúng-Sai / Trắc
nghiệm) **rời khỏi landing** và nằm bên trong thẻ của từng bài nghe trong Kho —
nơi đã có `content_id`, và chỉ hiện dạng nào bài đó thật sự có.

### 3.3 Nội dung mới sẽ vào chỗ nào

Cấu trúc này đã chừa sẵn chỗ, không cần sửa lại giao diện khi upload:

| Nội dung v2 | Vào đâu | Cơ chế |
|---|---|---|
| Mock 4–7 (16 section) | **Mini Test** (`test_type=mini`) | `scripts/import_listening_lessons.py` |
| Lecture / map / flow-chart soạn tay | **Luyện kĩ năng** (`test_type=drill`) | `scripts/import_skill_drills.py` |
| Gộp 4 section thành đề đủ | **Full Test** (`test_type=full`) | import-fulltest |
| Block lẻ + transcript | **Kho bài nghe** (`listening_content`) | mở dạng luyện bằng `listening_exercises` |

Số đếm trên tile tự tăng theo — không phải sửa HTML.

### 3.4 Thay đổi kỹ thuật

**Backend** — `backend/routers/listening.py`

- `GET /api/listening/overview` *(mới)* → `{tests:{full,mini,drill}, content, exercise_modes:{…}}`.
  Dùng **đúng** bộ lọc của endpoint danh sách: `status='published'`,
  `exam_only=false`, loại đề bị giữ cho thi thử, và audio đã sẵn
  (`full_audio_storage_path` **hoặc** `assembled_audio_storage_path`).
- `GET /api/listening/tests` — đẩy điều kiện audio **xuống SQL, trước
  `.range()`**. Trước đây nó lọc bằng Python *sau khi* đã phân trang, nên một
  dòng đã publish mà thiếu audio nằm trong trang 1 sẽ bị bỏ đi và trang trả về
  ít hơn `limit` — vừa làm phân trang sai (không phân biệt được "trang ngắn"
  với "trang cuối"), vừa làm số trên thẻ lệch với số trang hiển thị. Đây là
  phát hiện của Codex review, đã vá.
- `_published_content_ids()` *(mới)* — phân trang tường minh, tránh trần
  1000 dòng của PostgREST.
- `GET /api/listening/content` — mỗi dòng thêm `available_modes: string[]`.
  Một truy vấn cho cả trang, không N+1. Nếu truy vấn lỗi → để rỗng, hiển thị
  "chưa có dạng luyện", không đoán bừa.
- `_exercise_is_ready()` *(mới)* — `status='published'` **chưa đủ**.
  `_ensure_dictation_exercise` chèn một dòng dictation đã publish với
  `segments` rỗng ngay lần đầu người dùng nộp bài, mà trang dictation đòi
  `segments.length > 0`. Điều kiện "sẵn sàng" nay phản chiếu đúng cái mỗi
  trang cần: dictation → `segments[]`; true_false → `payload.statements[]`;
  mcq → `payload.questions[]`; gist → chỉ cần có dòng.
- Hai vòng quét phân trang đều thêm `.order("id")` — `LIMIT/OFFSET` không kèm
  `ORDER BY` thì Postgres không đảm bảo thứ tự, quá 1000 dòng là có thể trùng
  hoặc sót.

**Frontend**

- `pages/listening.html` — chia 3 khối, thẻ mặc định `hidden`, có
  `data-count-key` + `data-count-slot`; nạp `api.js`.
- `js/listening-landing.js` *(mới)* — gọi `/overview`, bật thẻ, ghi badge số.
  Lỗi mạng → vẫn mở 3 thẻ đề (đó là trang danh sách, tự có empty-state) nhưng
  **không** mở Kho, kèm banner báo lỗi (không im lặng).
- `js/listening-browse.js` — link dạng luyện sinh từ `available_modes`;
  không có dạng nào thì in "Chưa có dạng luyện nào cho bài này".
- `css/listening.css` — thêm `.ll-empty`, `.error-banner`.

**Test**

| File | Nội dung |
|---|---|
| `backend/tests/test_listening_overview.py` *(mới, 20 test)* | bộ lọc, đếm mode, phân trang 2.500 dòng, bất biến **overview == list**, hồi quy "trang đầy không bị hụt dòng", và bảng điều kiện `_exercise_is_ready` |
| `backend/tests/test_audit_kokoro_bundle.py` *(mới, 9 test)* | cổng audit không được duyệt block thiếu `.wav`, `.wav` không giải mã được, bị cắt sau header, toàn khoảng lặng, sai độ dài, hoặc mang tên khác |
| `frontend/tests/listening-landing-counts.test.mjs` *(mới, 13 test)* | ẩn/hiện theo số đếm, nhãn mode, `modeLinksHtml`, và **`MODE_LABELS` (landing) phải trùng tập với `MODE_LINKS` (browse)** |
| `frontend/tests/listening-page-shell.test.mjs` *(viết lại)* | cấm link trần tới 4 trang phụ thuộc `content_id` |
| `frontend/tests/listening-mcq-sessions-pages.test.mjs` | đổi sang chốt cơ chế gating |

### 3.5 Kiểm chứng trên dữ liệu thật

Chạy chính handler với DB prod (chỉ đọc):

```
OVERVIEW: {'tests': {'full': 37, 'mini': 32, 'drill': 66}, 'content': 4,
           'exercise_modes': {'dictation': 2, 'gist': 0, 'mcq': 0,
                              'mini_test': 0, 'true_false': 0}}
  full   limit=  5 items=  5 | limit= 20 items= 20 | limit=100 items= 37  OK
  mini   limit=  5 items=  5 | limit= 20 items= 20 | limit=100 items= 32  OK
  drill  limit=  5 items=  5 | limit= 20 items= 20 | limit=100 items= 66  OK

CONTENT (4 dòng) available_modes:
  the history of public lighting systems in cities  -> []
  IELTS Section 4 — Coastal Erosion Management      -> ['dictation']
  Sample UK Female — Urban Green Spaces             -> []
  Smoke US Female                                   -> ['dictation']
```

→ landing hiện đúng 4 thẻ (không còn 4 thẻ chết); Kho còn 2 link sống thay vì
16 link trong đó 14 chết.
