# Hợp đồng dữ liệu câu trả lời mẫu Speaking (repo VIDEO MAKING → web)

Phiên bản hợp đồng: `1` · Nhiệm vụ: G06-T12 (gói `GOI-06-thu-vien-cong-khai.md`) · Ngày: 18/11/2026.

Tệp này nằm ở `docs/` thay vì `backend/content/library/` như gói ghi, vì các script rà Grammar Wiki quét mọi tệp `.md` dưới `backend/content/` và sẽ đếm nhầm nó là bài ngữ pháp.

Câu trả lời mẫu Speaking của kệ "Đề Speaking" (`/library/speaking`) do repo
VIDEO MAKING sản xuất: kịch bản, giọng đọc tổng hợp Kokoro, dựng video
(00-QUY-UOC-CHUNG mục 2 điểm 22). Web **chỉ hiển thị**: không viết câu trả lời
mẫu, không sinh giọng đọc, không dựng video, không tự thêm mốc thời gian. File
này quy định repo VIDEO MAKING giao gì và web kiểm gì trước khi nhập.

## 1. Danh sách đề dự kiến

`backend/content/library/speaking-samples-manifest.json` liệt kê 210 đề có thể lên kệ,
lấy từ ngân hàng `backend/content/speaking_bank/`:

| Part | Số đề | Nguồn câu chữ |
|---|---|---|
| 1 | 57 | `2026-09-reviewed.json` (bản đã biên tập) |
| 2 | 84 | `2026-09-source.json` (thẻ đề Part 2) |
| 3 | 69 | `2026-09-reviewed.json` (bản đã biên tập) |

Mỗi dòng: `source_id` (khoá ổn định trong ngân hàng, ví dụ `p2-001`), `slug`
(đường dẫn web, đóng băng sau khi xuất bản), `part`, `title_en`, `title_vi`,
`topic_slug`, `topic_id`, `window_kind`, các trường media và `has_sample_text`.
Hiện mọi đề đều `has_sample_text: false`: **chưa đề nào có tệp theo hợp đồng
này (0/210)**. Danh sách chỉ là khung; đề nào thực sự lên kệ do anh Andy chọn
(mục 6, câu 1). Chưa có đề nào thì kệ hiện "Chưa có đề nào".

Còn trống, điền ở nhiệm vụ sau:

- `topic_slug`: chờ bảng chủ đề của G06-T04 (`topics.json`, dòng `shelf: speaking`).
- `topic_id`: id dòng `topics` trên staging để mở trình luyện. Chưa đối chiếu được
  vì chưa có truy vấn chỉ đọc trên staging (`select part, is_active, count(*) from topics group by 1,2;`);
  G06-T13 ghép theo `title` + `part` khi nhập.
- `title_vi`: dòng phụ dịch nghĩa, soạn cùng lô đề đầu tiên.

## 2. Cách giao

Mỗi lần giao là một thư mục:

```
speaking-delivery-<YYYYMMDD>/
  index.json            # {"contract_version": 1, "producer_ref": "<commit SHA của repo VIDEO MAKING>", "items": ["<slug>", ...]}
  <slug>.json           # một tệp cho mỗi đề, theo mục 3
  <slug>.mp3 | .m4a     # chỉ khi đề có audio mà không có video, ≤ 10 MB
```

Thư mục được đưa cho người chạy script nhập (G06-T13, `import_speaking_samples.py`)
bằng tham số `--source`; web không đọc repo VIDEO MAKING và không chạy gì trong đó.

## 3. Một tệp `<slug>.json`

| Trường | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| `contract_version` | int | có | `1` |
| `slug` | text | có | có trong `speaking-samples-manifest.json` |
| `source_id` | text | có | khớp dòng của `slug` trong manifest |
| `part` | int | có | khớp manifest |
| `voice` | text | có | luôn `"synthetic"`; web ghi nhãn "Giọng đọc tổng hợp" |
| `voice_model` | text | có | ví dụ `"kokoro-<phiên bản>"`; chỉ để truy vết, không hiện |
| `sample_text` | text | có | toàn bộ câu trả lời mẫu dạng chữ; rỗng thì đề không lên kệ |
| `transcript` | mảng | có | xem 3.1 |
| `media` | object | không | xem 3.2; thiếu thì trang chỉ có chữ |
| `outline` | mảng chữ | không | dàn ý ngắn của câu trả lời |
| `vocabulary` | mảng | không | `[{term, meaning_vi, note?}]` |
| `related_part3` | mảng chữ | không | câu Part 3 liên quan (chỉ đề Part 2) |
| `produced_at` | text | có | ISO 8601 |

Không giao: điểm hay band ước tính (trang đề không gắn band — GOI-06 mục 10 câu 10),
ghi chú nội bộ, dữ liệu học viên.

### 3.1 `transcript`

Mảng câu theo đúng thứ tự đọc: `{start_ms, text, marks}`.

- `text`: một câu hoặc một cụm. Nối các `text` bằng một dấu cách phải ra đúng
  `sample_text` (so sau khi gộp khoảng trắng).
- `start_ms`: số nguyên ≥ 0, **tăng ngặt**, nhỏ hơn `media.duration_ms`, đo trên
  đúng tệp video/audio được giao. Không có media, hoặc chưa đo được mốc, thì
  để `null` cho **mọi** câu (web hiện lời thoại thành chữ thường, không bấm tua
  được). Không trộn câu có mốc với câu `null`; không ước lượng mốc.
- `marks`: `[{kind, start, end, note}]`, `kind` ∈ `vocab` | `structure`;
  `start`/`end` là vị trí ký tự trong `text` của chính câu đó
  (`0 ≤ start < end ≤ len(text)`); `note` là chú thích tiếng Việt ngắn.

### 3.2 `media`

| Trường | Quy tắc |
|---|---|
| `video_source` | `youtube` hoặc `self_hosted`; thiếu khi chỉ có audio |
| `youtube_id` | 11 ký tự `[A-Za-z0-9_-]` khi `youtube` |
| `video_url` | `https://…` khi `self_hosted` (máy chủ video riêng: chưa chốt — 01 mục 7 câu 18; đợt đầu chỉ YouTube) |
| `audio_file` | tên tệp `.mp3`/`.m4a` cạnh `<slug>.json` khi không có video, ≤ 10 MB |
| `duration_ms` | số nguyên > 0 khi có video hoặc audio; web lưu theo giây làm tròn |

Video YouTube nên để chế độ "Không công khai" hoặc "Công khai" (không "Riêng tư"),
vì trang nhúng qua `youtube-nocookie.com`.

## 4. Web kiểm gì khi nhập (G06-T13)

Lỗi chặn (đề đó không được xuất bản):

1. Thiếu trường bắt buộc, `contract_version` khác `1`, `slug`/`source_id`/`part` không khớp manifest.
2. `sample_text` rỗng.
3. `voice` khác `synthetic`.
4. `start_ms` không tăng ngặt, âm, ≥ `duration_ms`, hoặc trộn số với `null`.
5. Nối `transcript[].text` không ra `sample_text`.
6. `marks` ra ngoài câu hoặc `kind` lạ.
7. `youtube_id` sai mẫu; `video_url` không phải https; `audio_file` không có, sai đuôi hoặc > 10 MB.

Script nhập chạy trên staging trước, dry-run mặc định, đọc lại sau `--execute`,
ghi bản ghi lô như script nhập Writing (GOI-06 mục 5.8).

## 5. Ví dụ một đề Part 2 (dữ liệu bịa, ngắn)

```json
{
  "contract_version": 1,
  "slug": "a-city-you-have-been-to-and-would-like-to-visit-again-part-2",
  "source_id": "p2-001",
  "part": 2,
  "voice": "synthetic",
  "voice_model": "kokoro-example",
  "sample_text": "I'd like to talk about Hue. The old citadel is calm in the early morning.",
  "transcript": [
    {"start_ms": 0, "text": "I'd like to talk about Hue.", "marks": []},
    {"start_ms": 2400, "text": "The old citadel is calm in the early morning.",
     "marks": [{"kind": "vocab", "start": 4, "end": 15, "note": "kinh thành cổ"}]}
  ],
  "media": {"video_source": "youtube", "youtube_id": "AbCdEfGhIjK", "duration_ms": 6100},
  "outline": ["Nơi chốn", "Lần đầu đến", "Vì sao muốn quay lại"],
  "vocabulary": [{"term": "old citadel", "meaning_vi": "kinh thành cổ"}],
  "related_part3": ["Why do people like visiting historic cities?"],
  "produced_at": "2026-11-18T09:00:00+07:00"
}
```

## 6. Đã nhận từ repo VIDEO MAKING và câu còn mở

Đã nhận: **chưa có tệp nào** (0 đề). Người thực thi không truy cập, không sửa,
không chạy gì trong repo VIDEO MAKING.

Câu hỏi cho anh Andy (GOI-06 mục 10 câu 11; 04-VIEC-DE-LAI mục D):

1. Đợt đầu bao nhiêu đề, Part nào? Đề nghị: 20 đề Part 2 đầu, một câu trả lời mẫu mỗi đề. Mặc định tạm: web nhận bất kỳ số lượng nào theo hợp đồng này.
2. Một câu trả lời mẫu mỗi đề, hay hai mức band? Mặc định tạm: một, không ghi band.
3. Bộ dựng của repo VIDEO MAKING có xuất được mốc thời gian từng câu không? Nếu chưa, lô đầu giao `start_ms: null` và trang chỉ hiện chữ.
4. Video đưa lên YouTube kênh nào, chế độ nào? Mặc định tạm: chỉ YouTube (01 mục 7 câu 18).
5. Ai soạn `title_vi`? Mặc định tạm: người thực thi soạn cùng lô đề đầu, có người duyệt.
