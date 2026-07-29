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

### 2.2 Nguyên nhân gốc: MỘT DÒNG trong `kokoro_audio.py`

> **Cập nhật sau khi truy nguyên.** `README_v2.md` ghi nguyên nhân là "844 block
> mới chưa có audio → chạy lại `kokoro_audio.py`". **Sai.** File audio đã tồn tại
> đủ 978/978. Lỗi thật nằm ở `block_plan()`:
>
> ```python
> rep = items[0]      # rồi bỏ hết item còn lại của block
> ```
>
> Hàm này giả định mọi câu trong một block dùng chung một đoạn nói. Đúng với
> form-completion (8 chỗ trống trên 1 hội thoại), **sai** với block ghép nhiều
> câu độc lập. Hệ quả: **4.532 câu mất tiếng** — mà script trả lời chúng **nằm
> sẵn trong `corpus_v2.json`**, chỉ chưa bao giờ được đọc.
>
> `build_md_companions.py` có **cùng lỗi** ở dòng `transcript(rep)`, nên
> transcript trong `.md` bị cắt y hệt audio — đó là lý do phép đo ở §2.2 thấy
> "câu không có trong transcript".
>
> Nghĩa là **không cần soạn thêm nội dung nào** cho Mock 4–7.

### 2.2b Số liệu đo trước khi sửa

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

---

## Phần 4 — Sửa pipeline sinh audio (2026-07-29, sau khi chốt hướng)

Bản gốc giữ tại `kokoro_audio.py.orig` và `build_md_companions.py.orig`.

### 4.1 `kokoro_audio.py`

| Sửa | Nội dung |
|---|---|
| `block_units()` thay `block_plan()` | Duyệt **mọi** item theo thứ tự câu hỏi, khử trùng lặp theo đoạn nói. Trả kèm `item_ids`. |
| `plan_block()` | Một block → một **hoặc nhiều** file. |
| CLI | `--blocks --outdir --gap-sent --gap-turn --split-threshold --drill-batch --max-parts` |

**Quy tắc tách.** Block >25 đoạn nói **và** `partScope != 'mock-explicit'` thì
chia thành bài 10 câu. `partScope` là khoá phân biệt — Mock 1–3 được ghép từ 10
mẩu hội thoại rời nhau, nhìn "giống drill" nhưng học viên nghe một lượt trả lời
10 câu, nên **không bao giờ** chia. Nếu chỉ lấy số lượng làm tiêu chí thì 12
section của Mock 1–3 bị tách nhầm.

Ngưỡng 25 tách đúng 11 mega-block `Gen_*`, không đụng Level (≤21 câu),
Expansion, Remediation.

`timing.json` nay có **`item_ids`** — bắt buộc: không có nó thì không biết
`Gen_Contra_p07.wav` phục vụ 10 câu nào trong 536.

### 4.2 `build_md_companions.py`

- **Transcript lấy từ `timing.json`**, tức từ đúng thứ đã thành tiếng — `.md` và
  `.wav` không thể lệch nhau nữa.
- **`main()` duyệt theo file audio có thật**, không theo corpus. Duyệt theo
  corpus sẽ sinh `Gen_Contra.md` gộp 536 câu cho một `.wav` không tồn tại, và
  không sinh `.md` nào cho 5 bài thật.
- **Nhãn `Câu chứa đáp án` chỉ giữ khi câu đó THẬT SỰ có nguyên văn trong
  transcript**; còn lại đổi thành `Ý mấu chốt (diễn giải)`. Thông tin không sai,
  nhưng nhãn cũ thì sai — chuẩn dự án là phản hồi không được gây hiểu nhầm.

### 4.3 Cổng audit đi theo file audio

`audit_kokoro_bundle.py` cũng lặp theo corpus nên sẽ hiểu sai bản mới. Nay duyệt
theo file, dùng `item_ids`, thêm `--audio-dir`, và 2 verdict mới:

- **`NOT_RENDERED`** — câu trong corpus không file nào nhận (phần đuôi bị
  `--max-parts` cắt). Một corpus ngắn đi mà vẫn báo "100% sạch" đúng là cách một
  lần cắt xén tự giấu mình.
- **`ORPHAN_AUDIO`** — file audio không map được câu nào.

### 4.4 Kiểm chứng thí điểm (4 block)

| Block | Câu | Cũ | Mới |
|---|---:|---|---|
| `Level1_1a` | 15 | **1** nghe được · 3,3 s | **15** · 60,5 s |
| `MockTest4_Section2` | 10 | **6** · 41,6 s | **10** · 69,8 s |
| `Gen_FormAccom_01a05f` | 8 | 8 · 47,6 s | 8 · 47,6 s (không đổi) |
| `Lec2_Antarctica` | 8 | 8 · 46,4 s | 8 · 46,4 s (không đổi) |
| | **41** | **23** | **41** |

`Gen_Contra` 536 câu → 54 bài; render 3 bài đầu: 30/30 câu nghe được, 0 ID trùng,
đúng thứ tự block.

### 4.5 Quyết định vận hành

- **Nhịp: dùng A** (mặc định `speed 1.0 · gap-sent 0.10 · gap-turn 0.35`).
  Biến thể chậm 0.92x + khoảng lặng gấp 3 chỉ dài thêm **10%** — nhịp do **độ dài
  transcript** chứ không do khoảng lặng (Mock4-S2 có 174 từ/10 câu, Cambridge
  cùng dạng ~700–800 từ). Định vị: **bài tập bắt thông tin**, không phải mô
  phỏng phòng thi.
- **`--max-parts 5`** — 390 bài trap-drill sinh từ 11 khuôn câu, lặp quá nặng.
  Giới hạn còn **55 bài / 550 câu**. Tổng: 978 block → **1.022 file**,
  586.878 ký tự.
- **Render song song 5 tiến trình, mỗi tiến trình 2 thread.** Một tiến trình mất
  ~6,7 giờ. Chạy 5 tiến trình mà **không** giới hạn thread thì gần như vô ích
  (torch lấy hết core, load average 38 trên 10 core, chỉ nhanh 1,28x). Đặt
  `OMP_NUM_THREADS=2` v.v. → thông lượng gấp đôi, còn ~2,5 giờ.
- Render vào **`audio_output_kokoro_v2/`**, giữ nguyên bản cũ. Bắt buộc: logic
  resume bỏ qua file đã tồn tại, nên render đè lên thư mục cũ sẽ **không bao giờ
  sửa** được các block hỏng (`Level1_1a.wav` đã có → skip).

---

## Phần 5 — Kết quả render lại (2026-07-29)

`audio_output_kokoro_v2/` · **1.022 file · 2,3 GB · 14,2 giờ · 0 lỗi render**.

### 5.1 Cổng audit — trước và sau

| | Trước | Sau |
|---|---:|---:|
| UPLOADABLE | 797 block · 6.725 câu | **1.022 block · 8.690 câu** |
| PARTIAL | 87 block · **4.444 câu không nghe được** | **0** |
| NO_AUDIO_CONTENT | 94 block · 665 câu | **0** |
| NOT_RENDERED | — | 10 block · 3.310 câu *(do `--max-parts 5` cắt có chủ ý)* |

8.690 + 3.310 = **12.000** — mọi câu đều được tính, không câu nào rơi im lặng.

Nhãn `Câu chứa đáp án`: **27/27 đúng nguyên văn** (trước: 0/978). Cảnh báo
"map-labelling thiếu sơ đồ" đã hết.

### 5.2 Cùng một lỗi `items[0]`, ba nơi

| Nơi | Hậu quả |
|---|---|
| `kokoro_audio.py` → `block_plan()` | 4.532 câu mất tiếng |
| `build_md_companions.py` → `transcript(rep)` | transcript trong `.md` bị cắt y hệt |
| `build_md_companions.py` → `items[0].get("assetRef")` | **Mock 1/2/3 Section 2 mất sơ đồ** — assetRef nằm ở item thứ 2/6, không phải item đầu |

Cả ba đều được sửa bằng cách duyệt mọi item thay vì tin item đầu.

### 5.3 Hai phép đo sai của chính cổng audit

Phát hiện khi chạy cổng lên bản mới — **cổng sai, không phải nội dung sai**:

1. **Nhãn người nói phá probe.** Transcript hội thoại xen `**Nữ:** … **Nam:** …`;
   probe 8 từ bắc qua hai lượt bị nhãn chen giữa. Toàn bộ **90 block
   `Gen_FormVenue`** bị chấm `NO_AUDIO_CONTENT` trong khi audio hoàn toàn đúng
   (44 giây, 11 lượt thoại). → gỡ nhãn trước khi chuẩn hoá.
2. **So từng byte quá chặt.** `Rem_TR12` ghi *"…the training apart from…"* còn
   audio nói *"…the training, apart from…"* — lệch một dấu phẩy, từ ngữ y hệt,
   mà bị chấm là gắn nhãn sai. → so theo **câu** sau chuẩn hoá; đổi từ ngữ vẫn trượt.

### 5.4 Còn tồn đọng (đã biết, chưa xử lý)

- **Nhịp vẫn 5,7 giây/câu** (21/1.022 block đạt ≥15 s/câu). Đã chốt: chấp nhận,
  định vị là bài tập bắt thông tin. Muốn đạt nhịp thi phải **viết dài transcript**,
  không phải render lại.
- **3.310 câu chưa render** — phần đuôi 11 mega trap-drill. Bỏ `--max-parts`
  và render thêm ~2 giờ nếu muốn, nhưng lặp khuôn sẽ nặng.
- **Chưa chuyển WAV → MP3** (2,3 GB → ~200 MB) và **chưa có bộ chuyển đổi** sang
  định dạng `import_listening_lessons.py` nhận. Đây là hai việc còn lại trước khi
  import được lên web.
