---
id: FLASHCARD-0048
title: Flashcard kiểu Quizlet bản MVP — admin dán hàng loạt thẻ vào bộ từ, gán lớp hoặc thư viện chung, học viên lật thẻ và tự đánh dấu Đã nhớ/Chưa nhớ
status: draft
risk: high
owner: product
---

# Flashcard kiểu Quizlet bản MVP — admin dán hàng loạt thẻ vào bộ từ, gán lớp hoặc thư viện chung, học viên lật thẻ và tự đánh dấu Đã nhớ/Chưa nhớ

Status: **draft, chưa duyệt**. FD viết theo yêu cầu của anh Vinh (t1392u,
04/11 14:38 UTC+7, Leader chuyển). Số spec **0048** đã giữ trong
`/workspace/cc-jobs/spec-number-register.md`. Chưa xếp phiếu code nào cho tới
khi anh Vinh trả lời mục "Câu hỏi cho anh Vinh" và duyệt spec trên `staging`.
Base đọc: `origin/staging` @ `6b8e18894` (04/11 14:19 UTC+7).

## Tóm tắt (tiếng Việt)

Phát hiện quan trọng nhất khi rà repo: **phần lớn "Quizlet bản đơn giản" đã
có sẵn** qua spec **VOCABSETS-0020** (migration 317, đã lên production
14/10): admin tạo **bộ từ** (`vocabulary_sets`), chọn thẻ từ kho
`vocab_cards`, gán cho **thư viện chung** (`library`), **khoá học**
(`course_ids`) hoặc **lớp** (`cohort_ids`), xuất bản theo revision đóng băng;
học viên học 4 chế độ (Thẻ ghi nhớ, Luyện nhớ, Điền từ, Kiểm tra) với tiến độ
riêng từng người. Vì vậy 0048 **không làm lại**, chỉ lấp 4 chỗ thiếu so với
yêu cầu của anh:

1. **Nhập hàng loạt vào một bộ** kiểu Quizlet: dán từ Excel/Google Sheets
   (mỗi dòng 1 thẻ, cột cách nhau bằng Tab; chấp nhận CSV có dấu phẩy), xem
   trước từng dòng (thêm mới / dùng thẻ có sẵn / lỗi), rồi mới ghi. Hôm nay
   admin phải thêm từng từ, hoặc nhập Markdown ở "Nội dung từ vựng" rồi chọn
   từng thẻ vào bộ.
2. **Học viên lật thẻ đơn giản hơn**: thay 4 nút (Chưa nhớ / Khó nhớ / Nhớ /
   Rất dễ) bằng 2 nút **Chưa nhớ / Đã nhớ** như chế độ "sorting" của Quizlet
   (Still learning / Know), phím tắt (Space lật, ← Chưa nhớ, → Đã nhớ), và
   cuối vòng có nút **"Học lại N thẻ chưa nhớ"**.
3. **Admin tìm được trang**: "Bộ từ theo lớp" (`/admin/vocab/sets`) hiện
   không có trong menu (UIA D6/G2) → thêm vào đầu mục Vocab.
4. **Thẻ nhập cho lớp không lọt ra wiki công khai** `/vocabulary`: hôm nay mọi
   dòng `vocab_cards` đều hiện trên wiki công khai, nên thẻ nhập hàng loạt cho
   một lớp mặc định phải **ẩn khỏi wiki** (cần 1 migration cộng thêm cột).

Tất cả nằm sau cờ `FLASHCARD_MVP_ENABLED` (mặc định **tắt**). Learn / Test /
Match của Quizlet: chế độ tương đương Learn/Test đã có từ 0020 (giữ nguyên,
có thể ẩn bớt — xem Q-3); Match, khách chưa đăng nhập xem bộ công khai, giao bộ
từ có hạn nộp là **giai đoạn sau**.

## Khảo sát Quizlet (04/11/2026, nguồn công khai)

| Chế độ Quizlet | Làm gì | Miễn phí? | Aver hôm nay | Đề xuất 0048 |
| --- | --- | --- | --- | --- |
| **Flashcards** | Bấm lật thẻ, mũi tên qua lại, Shuffle, Play tự chạy, bật "sorting" để chia thẻ vào **Still learning / Know**; chọn mặt hiện trước; nghe TTS. Hết vòng phải xem hết thẻ. [1][2] | Có | Mode `flashcards` của 0020: lật, 4 mức tự đánh giá, nghe audio | **MVP**: 2 nút Đã nhớ/Chưa nhớ + phím tắt + "Học lại thẻ chưa nhớ" |
| **Learn** | Câu hỏi khó dần theo mức quen; Write và Spell đã gộp vào Learn. [1] | Giới hạn số vòng | Mode `learn` (gõ từ theo nghĩa) | Giữ như 0020, không đổi |
| **Test** | Bài kiểm tra tự sinh: trắc nghiệm, đúng/sai…, chấm tự động, có thể hẹn giờ. [1][3] | 1 bài/bộ | Mode `test` (đáp án giữ kín tới khi nộp) | Giữ như 0020, không đổi |
| **Match** | Ghép thuật ngữ–định nghĩa tính giờ, 6 cặp/lượt, sai cộng 1 giây. [4] | Có | Chưa có | Giai đoạn sau (P2) |
| Blast / Blocks / Live | Trò chơi lớp học | Có | Chưa có | Ngoài phạm vi |
| **Import** | Dán văn bản; giữa thuật ngữ–định nghĩa: Tab, phẩy hoặc gạch; giữa thẻ: xuống dòng hoặc chấm phẩy; xem trước rồi tạo. [5][6] | Có | Chỉ nhập Markdown vào kho | **MVP**: dán Tab/CSV vào bộ, có xem trước |
| **Hiển thị** | Everyone / Certain classes / Password / Just me. [7] | Có | `library` (mọi tài khoản đăng nhập), `course_ids`, `cohort_ids` | Giữ; "public cho khách" là P2 (Q-1) |

Nguồn:
[1] https://help.quizlet.com/hc/en-us/articles/360030841732-Studying-on-Quizlet ·
[2] https://help.quizlet.com/hc/en-us/articles/360030988091-Studying-with-Flashcards ·
[3] https://quizlet.com/features/test ·
[4] https://help.quizlet.com/hc/en-us/articles/360031183611-Playing-Match ·
[5] https://help.quizlet.com/hc/en-us/articles/360029977151-Creating-sets-by-importing-content ·
[6] https://nibomo.com/blog/how-to-import-flashcards-into-quizlet/ (ví dụ định dạng Tab) ·
[7] báo cáo đối thủ `/workspace/cc-jobs/reports/competitor-dictation-quizlet-20261030.md` §2.2 (trích help center về visibility/classes).

## Problem

- Admin không nhập được nhiều thẻ vào một bộ trong một lần: `POST
  /admin/vocabulary-sets/cards` thêm từng thẻ; `POST /admin/vocabulary/import`
  chỉ nhận Markdown frontmatter và không gắn vào bộ. Một bộ 50 từ = 50 lần
  nhập form.
- Thẻ thêm qua bộ từ đi thẳng vào `vocab_cards`, nguồn của wiki công khai
  `/vocabulary` (SEO). Nhập hàng loạt cho một lớp sẽ đẩy nội dung lớp ra
  công khai ngoài ý muốn.
- Chế độ Thẻ ghi nhớ có 4 mức tự đánh giá; anh Vinh muốn bản đơn giản kiểu
  Quizlet "lật thẻ / tự đánh dấu biết hay chưa".
- `/admin/vocab/sets` không có trong menu admin (`aver-admin-chrome.js`
  NAV_GROUPS, mục `vocab`), admin chỉ tới được qua thẻ trên hub Vocab.

## Scope

- Nhập hàng loạt bằng **dán văn bản** vào trình biên tập bộ từ
  (`/admin/vocab/sets/[setId]`): xem trước (dry-run) rồi xác nhận (commit).
- Cột hỗ trợ (theo thứ tự): `từ` (bắt buộc), `nghĩa tiếng Việt` (bắt buộc),
  `ví dụ` (tuỳ chọn), `CEFR` (tuỳ chọn, A1–C2). Phân tách cột: Tab (mặc định,
  tự nhận) hoặc dấu phẩy theo CSV RFC 4180 (có ngoặc kép). Phân tách thẻ:
  xuống dòng. Bỏ dòng trống; dòng tiêu đề được nhận và bỏ qua nếu khớp
  `term|từ|word` ở cột 1.
- Thẻ trùng: khớp `slug(headword)` với `vocab_cards` có sẵn → **dùng lại thẻ
  có sẵn** (không sửa nội dung thẻ cũ), báo "dùng thẻ có sẵn"; trùng trong
  chính đoạn dán → giữ dòng đầu, báo trùng.
- Thẻ mới tạo bằng import mặc định **ẩn khỏi wiki công khai** (cột mới
  `vocab_cards.public_wiki`), vẫn học được trong bộ.
- Học viên: chế độ Thẻ ghi nhớ khi cờ bật có 2 nút Chưa nhớ/Đã nhớ, phím tắt,
  vòng "Học lại thẻ chưa nhớ" (phiên mới chỉ gồm các thẻ đó, cùng revision).
- Menu admin: thêm "Bộ từ theo lớp" lên đầu mục Vocab.
- Cờ `FLASHCARD_MVP_ENABLED` (backend env, mặc định `false`) bật/tắt cả
  import, 2 nút và vòng học lại; frontend đọc cờ qua trường `features` của
  API danh mục, không cần build lại.

## Non-goals

- Học viên tự tạo bộ, sửa bộ, chia sẻ bộ (đúng yêu cầu anh Vinh và non-goal
  của 0020).
- Khách chưa đăng nhập xem/học bộ công khai, trang SEO `/vocabulary/sets/{slug}`
  (P2, xem Q-1).
- Match, Blast, trò chơi lớp, Spell/nghe-viết, ảnh trên thẻ, ghi âm.
- Upload file CSV/XLSX, ZIP audio (P2; dán từ Excel đã đủ cho MVP như Quizlet).
- Giao bộ từ như bài tập có hạn nộp trong hệ thống giao bài lớp (`skill =
  'vocabulary_set'`) — thuộc luồng giao bài, để 0049/spec sau.
- Sửa nội dung thẻ có sẵn qua import (update/upsert), xoá thẻ hàng loạt.
- Đổi SRS, đổi cách chấm Learn/Test của 0020.

## Users and journeys

- **Admin (tạo bộ cho lớp):** Menu Vocab → Bộ từ theo lớp → Bộ mới → đặt tên
  → "Dán danh sách từ" → dán 2–4 cột từ Google Sheets → "Xem trước" → bảng:
  42 thêm mới, 6 dùng thẻ có sẵn, 2 lỗi (dòng 7: thiếu nghĩa; dòng 19: từ dài
  quá 120 ký tự) → sửa trong ô dán hoặc bỏ dòng lỗi → "Thêm 48 thẻ vào bộ" →
  thẻ vào danh sách bản nháp → chọn lớp (hoặc Thư viện chung) → Lưu và xuất
  bản.
- **Học viên trong lớp:** Từ vựng → Bộ từ → mở bộ → Thẻ ghi nhớ → thấy từ,
  Space để lật → nghĩa + ví dụ + nghe → bấm Đã nhớ (→) hoặc Chưa nhớ (←) →
  hết vòng: "Đã nhớ 30 · Chưa nhớ 18" + nút "Học lại 18 thẻ chưa nhớ".
- **Học viên lớp khác:** không thấy bộ, mở URL trực tiếp bị từ chối như hôm
  nay (`fn_vocabulary_set_visible`).
- **Khách trên wiki `/vocabulary`:** không thấy thẻ mới nhập (ẩn wiki).

## Requirements

- **FR-001:** (cờ) Khi `FLASHCARD_MVP_ENABLED=false` (mặc định), endpoint
  import trả 404 `feature_disabled`, trình biên tập bộ không hiện nút "Dán
  danh sách từ", trình học Thẻ ghi nhớ hiện 4 nút như hôm nay; không có hành
  vi nào khác đổi. Khi bật, `GET /admin/vocabulary-sets` và
  `GET /api/vocabulary-sets` trả `features.flashcard_mvp=true`.
- **FR-002:** (import chỉ admin) `POST
  /admin/vocabulary-sets/{set_id}/import?dry_run=true|false` gọi
  `require_admin` (AAL2 như mọi route admin) trước khi đọc body; học viên,
  giảng viên, khách nhận 401/403 và không ghi gì. Body JSON `{text: string,
  expected_version: int}` với `extra='forbid'`.
- **FR-003:** (định dạng) Bộ phân tích nhận Tab hoặc CSV (RFC 4180, ngoặc
  kép, dấu phẩy trong ngoặc giữ nguyên), tự nhận theo dòng không trống đầu
  tiên (có Tab → Tab). Cột: từ, nghĩa tiếng Việt, ví dụ, CEFR. Bỏ dòng trống,
  bỏ dòng tiêu đề, cắt khoảng trắng hai đầu, chuẩn hoá Unicode NFC, bỏ BOM.
  Nhiều hơn 4 cột → lỗi dòng "thừa cột" (không đoán).
- **FR-004:** (giới hạn) `text` ≤ 100 KB (UTF-8) → vượt trả 413; ≤ 200 dòng
  thẻ và (số thẻ trong bản nháp + thẻ mới) ≤ 200 (giới hạn bộ của 0020) → vượt
  trả 422 `too_many_cards` với số còn lại; từ ≤ 120 ký tự, nghĩa ≤ 300, ví dụ
  ≤ 500, CEFR ∈ {A1..C2} hoặc trống. Ký tự điều khiển (trừ Tab trong phân
  tách) → lỗi dòng.
- **FR-005:** (dry-run) `dry_run=true` không ghi DB; trả từng dòng `{line,
  status: new|existing|duplicate_in_paste|error, headword, gloss_vi, example,
  level, card_id?, error?}` và tổng `{new, existing, duplicate, error}`.
- **FR-006:** (commit nguyên khối) `dry_run=false` chạy lại đúng phân tích;
  nếu còn dòng `error` → 422, không ghi gì. Nếu không: tạo thẻ mới
  (`public_wiki=false`, `category` = slug của Q-4, `topic_id` như
  `create_card`), lấy thẻ có sẵn, rồi nối các id (bỏ id đã có trong bộ) vào
  `card_ids` của **bản nháp** qua `fn_save_vocabulary_set` với
  `expected_version`; sai version → 409 `set_conflict`, thẻ mới tạo trong
  lần đó không để lại dòng mồ côi (một giao dịch, hoặc RPC mới). Không tự xuất
  bản; học viên chỉ thấy sau khi admin xuất bản như 0020.
- **FR-007:** (không sửa thẻ cũ) Dòng khớp thẻ có sẵn theo `slug(headword)`
  không đổi bất kỳ cột nào của thẻ cũ (kể cả `public_wiki`); nghĩa khác chỉ
  hiện cảnh báo "nghĩa khác thẻ có sẵn" trong xem trước.
- **FR-008:** (ẩn wiki) Wiki công khai (`/vocabulary`, category, article,
  sitemap, mọi route đọc chỉ mục từ vựng công khai) bỏ qua thẻ
  `public_wiki=false`; thẻ cũ (migration đặt mặc định `true`) giữ nguyên hiển
  thị. Bộ từ, phiên học, tìm thẻ trong admin vẫn thấy thẻ ẩn wiki.
- **FR-009:** (nội dung là văn bản) Mọi trường nhập được lưu dạng văn bản
  thuần và hiển thị bằng text node React (không `dangerouslySetInnerHTML`,
  không Markdown); chuỗi `<script>`, `<img onerror>`, `javascript:` hiện
  nguyên văn. Ô bắt đầu bằng `= + - @` được lưu nguyên văn nhưng mọi xuất CSV
  sau này phải thêm `'` phía trước (ghi trong plan để spec xuất dữ liệu kế
  thừa).
- **FR-010:** (phạm vi hiển thị không đổi) Học viên chỉ thấy bộ đã xuất bản
  trong phạm vi `library`/khoá/lớp của mình qua `fn_vocabulary_set_visible`;
  import không đổi `library`, `course_ids`, `cohort_ids`. Bảng mới/cột mới
  không cấp quyền cho `anon`/`authenticated` (giữ REVOKE của 317).
- **FR-011:** (2 nút) Khi cờ bật, trình học mode `flashcards` hiện "Chưa nhớ"
  và "Đã nhớ" (gửi `rating` `again` và `good` vào API sẵn có), chỉ bấm được
  sau khi lật; phím Space/Enter lật, ← Chưa nhớ, → Đã nhớ; tiến độ
  `familiar` tính như 0020 (`good` → nhớ). Không đổi API ghi.
- **FR-012:** (học lại thẻ chưa nhớ) Hết phiên Thẻ ghi nhớ hiện "Đã nhớ X ·
  Chưa nhớ Y" và, nếu Y > 0, nút "Học lại Y thẻ chưa nhớ" tạo phiên mới
  `POST /api/vocabulary-sets/{set_id}/sessions` với `card_ids` con (tuỳ chọn,
  mới): server chỉ nhận id thuộc **revision đã xuất bản** của bộ và học viên
  vẫn được xem bộ; id lạ → 422; trống → toàn bộ như hôm nay.
- **FR-013:** (menu) `aver-admin-chrome.js` có mục con "Bộ từ theo lớp" →
  `/admin/vocab/sets` ở đầu mục Vocab, tô sáng khi ở `/admin/vocab/sets/*`
  (không phụ thuộc cờ).
- **FR-014:** (trạng thái UI) Màn import và trình học có đủ trạng thái
  loading / trống / thành công / lỗi-thử lại / không quyền theo
  `ui-states.md`, 375 px và 1280 px, sáng/tối, bàn phím và trình đọc màn hình.

## Acceptance scenarios

### Scenario 1 — dán 50 dòng từ Google Sheets
Given cờ bật, admin AAL2 mở bản nháp bộ 0 thẻ; when dán 50 dòng Tab (2 dòng
thiếu nghĩa) và Xem trước, then thấy 48 hợp lệ, 2 lỗi kèm số dòng, DB không
đổi; when xoá 2 dòng lỗi và xác nhận, then bản nháp có 48 thẻ theo đúng thứ
tự dán, version tăng 1, học viên chưa thấy gì cho tới khi xuất bản.

### Scenario 2 — trùng thẻ có sẵn
Given kho có "resilient"; when dán dòng "resilient<TAB>kiên cường khác", then
xem trước báo "dùng thẻ có sẵn — nghĩa khác thẻ có sẵn", commit không sửa
thẻ cũ và không tạo thẻ mới.

### Scenario 3 — không lọt ra wiki
Given commit tạo thẻ mới "zzflash"; when khách mở `/vocabulary` và tìm,
then không thấy "zzflash"; học viên trong lớp được giao vẫn học được thẻ.

### Scenario 4 — không phải admin
Given JWT học viên hoặc giảng viên; when gọi import, then 403, không ghi.

### Scenario 5 — xung đột phiên bản
Given hai tab admin cùng bộ; when tab A commit rồi tab B commit với version
cũ, then B nhận 409 và giữ nguyên ô dán, không có thẻ mồ côi.

### Scenario 6 — học lại thẻ chưa nhớ
Given học viên lớp C học 10 thẻ, bấm Chưa nhớ 3 thẻ; when bấm "Học lại 3 thẻ
chưa nhớ", then phiên mới có đúng 3 thẻ đó; gửi id thẻ không thuộc bộ → 422.

### Scenario 7 — nội dung độc
Given dòng `<img src=x onerror=alert(1)><TAB>=HYPERLINK("x")`; then xem
trước, bản nháp, trình học hiện nguyên văn, không chạy script.

### Scenario 8 — cờ tắt
Given cờ tắt; then import 404, không có nút dán, trình học 4 nút như hôm nay.

## Edge cases

- Dán từ Excel có ô chứa xuống dòng trong ngoặc kép: CSV hợp lệ thì giữ, Tab
  thì thành 2 dòng → dòng thứ hai thường thiếu nghĩa → lỗi dòng rõ ràng.
- Dấu phẩy trong nghĩa khi dùng Tab: giữ nguyên (lý do mặc định Tab).
- Từ có dấu gạch nối, cụm từ nhiều chữ: hợp lệ.
- Bộ đang `archived`: import 409 (không sửa bộ đã lưu trữ).
- Bộ đã xuất bản: import chỉ đổi bản nháp; thông báo "Cần xuất bản lại".
- Thẻ có sẵn đang `public_wiki=false` được dùng lại: giữ ẩn.
- Mất phản hồi commit, admin bấm lại: version đã tăng → 409 → "Tải lại bản
  đã lưu" thấy thẻ đã vào (không nhân đôi nhờ bỏ id đã có).

## Security risks

| Rủi ro | Biện pháp | FR |
| --- | --- | --- |
| Người không phải admin ghi thẻ/bộ | `require_admin` trước khi đọc body; service-role chỉ trên backend | FR-002 |
| Lộ nội dung lớp ra wiki công khai/SEO | `public_wiki=false` cho thẻ mới import; mọi đường đọc công khai lọc | FR-008 |
| Rò rỉ giữa lớp | Không đổi phạm vi; `fn_vocabulary_set_visible` vẫn là cổng; `card_ids` con kiểm theo revision | FR-010, FR-012 |
| XSS qua nội dung thẻ | Văn bản thuần, render text node; test payload | FR-009 |
| CSV/formula injection khi xuất sau này | Ghi rõ quy tắc thoát `'`; MVP không có xuất | FR-009 |
| DoS bằng đoạn dán lớn | 100 KB, 200 dòng, giới hạn độ dài trường; phân tích O(n) | FR-004 |
| RLS hồi quy với cột mới | Không GRANT mới; test quyền `anon`/`authenticated` sau migration | FR-010 |

## Success criteria

- Admin tạo bộ 50 từ trong ≤ 3 phút bằng dán (đo thủ công trên staging).
- 0 thẻ import xuất hiện trên wiki công khai (kiểm bằng tìm kiếm + sitemap).
- Không tăng lỗi 5xx ở `/admin/vocabulary-sets*` và `/api/vocabulary-sets*`
  24 giờ sau bật cờ trên staging.

## Câu hỏi cho anh Vinh

- **Q-1 (public nghĩa là gì):** "public" = mọi học viên đã đăng nhập (đã có:
  "Thư viện chung") hay cả khách chưa đăng nhập (trang công khai, SEO)?
  **Em đề xuất:** MVP dùng "Thư viện chung" (đăng nhập), khách/SEO để P2 vì
  cần endpoint công khai, cache, rate limit, kiểm duyệt.
- **Q-2 (ẩn thẻ import khỏi wiki):** cần 1 migration cộng cột
  `vocab_cards.public_wiki boolean default true` (số do Leader cấp). Phương án
  B: không migration, chấp nhận thẻ import hiện trên wiki như "Thêm từ mới"
  hôm nay. **Em đề xuất:** làm migration (thêm cột, không đổi dữ liệu cũ) để
  nội dung lớp không ra công khai.
- **Q-3 (giữ 4 chế độ hay chỉ Thẻ ghi nhớ):** 0020 đã có Luyện nhớ / Điền từ /
  Kiểm tra. **Em đề xuất:** giữ nguyên (đã làm xong, không tốn thêm), chỉ đổi
  Thẻ ghi nhớ sang 2 nút; nếu anh muốn giao diện thật tối giản thì thêm phiếu
  nhỏ F8 ẩn 3 chế độ kia khi cờ bật.
- **Q-4 (chủ đề của thẻ mới):** kho `vocab_cards` bắt buộc `category`.
  **Em đề xuất:** ô "Chủ đề" chọn một lần cho cả lần dán (mặc định
  "flashcard"), không thêm cột chủ đề vào định dạng dán.
- **Q-5 (thẻ trùng):** dùng lại thẻ có sẵn (không sửa) hay tạo thẻ riêng cho
  bộ? **Em đề xuất:** dùng lại, để tiến độ học viên gộp theo một thẻ; nghĩa
  khác chỉ cảnh báo.
- **Q-6 (2 nút hay 4 nút):** 2 nút áp dụng mọi bộ khi cờ bật, hay để học viên
  chọn? **Em đề xuất:** 2 nút cho mọi bộ (đơn giản như Quizlet); SRS vẫn chạy
  vì Đã nhớ = `good`, Chưa nhớ = `again`.
- **Q-7 (migration):** đồng ý 1 migration cộng cột (Q-2) và giao Leader cấp
  số? Không có migration nào khác.
