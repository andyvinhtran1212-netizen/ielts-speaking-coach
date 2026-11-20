# Implementation plan

## Architecture impact

Phần G của GOI-11. Các file và module ở mục Data and contracts. Ràng buộc riêng của gói (mục 8):

- Không sửa migration cũ; mọi thay đổi CSDL là migration mới trong dải 470–479 (472 không dùng). Gói này không sửa 381–388 của G04 và 440–451 của G09.
- Không viết mã gửi thư đơn, không dựng bảng công bố phía giáo viên, không dựng lối vào chấm thử trên trang công khai: ba việc đó thuộc G04, G09-T30, G05-T21.
- Không đổi cách chấm, điểm lưu, hay đường admin của bài kiểm tra; phần E chỉ đổi ai đọc được gì.
- Ở chế độ công bố, che ở giao diện không bao giờ là đủ: mọi trường ở 5.5.4 phải vắng khỏi phản hồi máy chủ; test 5.5.5 là cổng merge của T22.
- Mọi cờ mới mặc định tắt (`notifications_enabled`, `notification_emails`); production không bật cờ nào trong gói; `free_trial_enabled` theo rollout 0047.
- Không ghi email, tên, số tiền, mã đơn, nội dung bài vào log hay vào `params` của thông báo (trừ `order_code` trong `params` thông báo đơn của chính chủ đơn — cần để mở đúng đơn; không ghi vào log).
- Câu chữ: "giáo viên", "Đơn đăng ký", "Học phí", "Thanh toán", "Đăng ký khoá", "Đăng ký lại"; không "mua", "bán", "giá", "đơn hàng"; xưng "bạn"; full test tiếng Anh, bài kiểm tra của khoá tiếng Việt; không emoji; không "0/0", không band ở bài kiểm tra.
- Không gọi AI trả phí trong test; không gửi thư thật; không thao tác dữ liệu production.
- Không viết test kiểu đọc mã nguồn so chuỗi; riêng `brand-favicon.test.mjs` đã tồn tại được sửa có chủ ý, và `build-brand-assets.mjs --check` là kiểm tài sản sinh, không phải test mã nguồn.

## Data and contracts

Gói mục 5.7.4, chép nguyên:

#### 5.7.4 Sơ đồ câu trong Grammar Wiki
- Minh hoạ của web là sơ đồ câu chữ dựng bằng HTML/CSS; không tranh khắc, không ảnh minh hoạ (00 mục 2 điểm 22). Trang danh sách và trang bài Grammar Wiki theo tờ GrammarWiki, GrammarWikiBai do G06 dựng; tờ GrammarWikiMinhHoa là chuẩn cho mười kiểu sơ đồ dưới đây.
- Thêm kiểu khối `figure` vào `backend/services/grammar_learning_blocks.py` (không đụng năm kiểu cũ): `ALLOWED_FIGURES = {"sentence-anatomy","noun-phrase","timeline","voice-shift","clause-levels","morphemes","agreement","error-pair","role-translation","word-slot"}` (tờ GrammarWikiMinhHoa). Khai trong frontmatter `learning_blocks` như các khối khác, đặt bằng `<!-- learning-block: <id> -->`.
- Lược đồ chung: `{id, type: "figure", figure: <kiểu>, title (chú thích), caption_vi?, alt_vi (bắt buộc, câu đọc cho trình đọc màn hình), lang: "en", parts: [...]}`; `parts` theo kiểu, ví dụ `sentence-anatomy`: `[{text: "The report", role: "subject", label_vi: "Chủ ngữ", n: 1}, {text: "written by the team", role: "reduced-clause", label_vi: "Mệnh đề rút gọn", n: 2, mark: true}, …]`; `error-pair`: `{wrong, right, reason_vi}`; `timeline`: `{points: [{label, at: "past|now|future", span?}], sentence}`. Người thực thi viết đủ mười lược đồ theo đúng các hình trong tờ GrammarWikiMinhHoa, mỗi kiểu một hàm `_validate_<kiểu>` và một hàm `_render_<kiểu>`; mọi chuỗi qua `escape`; chỉ sinh các lớp CSS trong danh sách cho phép (`gw-fig`, `gw-fig--<kiểu>`, `gw-fig__part`, `gw-fig__part--<role>`, `gw-fig__mark`…).
- Lược đồ `figure` được mở rộng (trường tuỳ chọn và ba kiểu `quick-choice`, `intensity-scale`, `annotated-paragraph`) bởi spec GRAMMAREDIT-0096 trong GOI-13; renderer phần mở rộng là G13-B06, làm sau G11-T33. (sửa 18/11 theo GOI-13)
- HTML: `<figure class="gw-fig gw-fig--<kiểu>" id="fig-<n>" role="img" aria-label="<alt_vi>">…<figcaption>Hình <n>. <title></figcaption></figure>`; chữ ví dụ bọc `<span lang="en">`. Đánh số "Hình N" theo thứ tự xuất hiện trong bài khi `inject_learning_blocks` chạy; tham chiếu "(Hình 2)" trong văn bài viết bằng `[Hình 2](#fig-2)`. Tối đa 4 khối `figure` mỗi bài (khối thứ 5 bị bỏ, cảnh báo).
- Khối sai cấu trúc: bỏ khối, ghi `logger.warning` (như hiện tại dòng 315–320 của `grammar_content.py`), bài vẫn hiện; thêm lỗi vào danh sách để `backend/scripts/` kiểm nội dung (nếu đã có script kiểm frontmatter thì nối vào; CHƯA KIỂM: `ls backend/scripts | grep -i grammar`).
- CSS: `frontend/app/(public-content)/grammar/grammar-figures.css` (hoặc trong stylesheet bài đọc của G06-T07 nếu đã có), chỉ dùng biến `--ink, --muted, --accent, --ok, --danger, --rule, --surface` của tờ (ánh xạ sang token G03); rộng tối đa bằng cột chữ (640px); dưới 600px theo quy tắc điện thoại của từng kiểu trong tờ; `@media print` đen trắng. Không ảnh, không chuyển động.
- Nội dung thí điểm: thêm khối `figure` cho 5 bài (đề xuất mục 10 câu 22), mỗi bài 1–3 hình, sửa trong `backend/content/<category>/<slug>.md`; không đổi frontmatter khác, không đổi anchor (`tests/test_anchor_drift.py`).

### Lược đồ `parts` của mười kiểu hình (đề xuất, soạn 18/11 từ tờ GrammarWikiMinhHoa)

Gói 5.7.4 giao người thực thi viết đủ mười lược đồ. Phần này chép sẵn từ các hình trong tờ để G11-T33 có điểm xuất phát; tên trường có thể đổi khi viết `_validate_<kiểu>`, nhưng mỗi kiểu phải nhận được ví dụ bên dưới (ví dụ lấy nguyên câu của tờ). Trường chung (`id`, `type`, `figure`, `title`, `caption_vi`, `alt_vi`, `lang`) như lược đồ chung ở trên và không nhắc lại. Vai trò dùng chung: `S`, `V`, `O`, `C`, `A`; khối bỏ được đánh `optional: true`. Giới hạn ghi sau mỗi kiểu là giới hạn của tờ; vượt giới hạn thì khối bị bỏ và cảnh báo như khối sai cấu trúc.

1. `sentence-anatomy` — `variant: block|tree`, `rows: [{parts: [{text, role}], formula?}]`. Tối đa 6 phần một dòng; `tree` chỉ khi có phần bổ nghĩa cần treo.

```yaml
figure: sentence-anatomy
variant: block
rows:
  - parts: [{text: "The news", role: S}, {text: "made", role: V}, {text: "everyone", role: O}, {text: "happy", role: C}]
    formula: "S + V + O + C"
  - parts: [{text: "He", role: S}, {text: "became", role: V}, {text: "famous", role: C}, {text: "after the competition", role: A}]
    formula: "S + V + C + A"
```

2. `noun-phrase` — `head`, `before: [{text, label_vi}]`, `after: [{text, n}]`, `verb?: {text, note_vi}`, `object?`, `inner?: {text, head}`.

```yaml
figure: noun-phrase
before: [{text: "The", label_vi: "hạn định"}, {text: "rapid", label_vi: "tính từ"}]
head: "expansion"
after: [{text: "of privately funded urban transport projects", n: 1}, {text: "in developing regions", n: 2}]
verb: {text: "has raised", note_vi: "chia theo expansion"}
object: "concerns"
inner: {text: "privately funded urban transport projects", head: "projects"}
```

3. `timeline` — `bars: [{tense, sentence, kind: span|point, from?, to: now|past|ongoing, note_vi?}]`. Tối đa 2 thì một hình.

```yaml
figure: timeline
bars:
  - {tense: "Present Perfect", sentence: "She has lived in Da Nang since 2020.", kind: span, from: "2020", to: ongoing, note_vi: "còn tiếp"}
  - {tense: "Past Simple", sentence: "I lived in Hanoi for five years.", kind: span, to: past, note_vi: "năm năm, đã khép lại"}
```

4. `voice-shift` — `source: [{key, text, role}]`, `target: [{key, text, role, note_vi?, optional?}]`, `moves: [{n, from, to, required: true|false}]`. Tối đa 3 mũi tên; phần không có trong `moves` là "giữ chỗ".

```yaml
figure: voice-shift
source: [{key: a, text: "Scientists", role: S}, {key: b, text: "discovered", role: V}, {key: c, text: "a new planet", role: O}, {key: d, text: "in 2023", role: A}]
target: [{key: c, text: "A new planet", role: S, note_vi: "S mới"}, {key: b, text: "was discovered", role: V, note_vi: "be + V3"}, {key: a, text: "by scientists", role: A, optional: true}, {key: d, text: "in 2023", role: A}]
moves: [{n: 1, from: c, to: c, required: true}, {n: 2, from: a, to: a, required: false}, {n: 3, from: b, to: b, required: true}]
```

5. `clause-levels` — `sentence` (câu gốc), `levels: [{level: 1|2|3, parts: [{text, role?}], note_vi?}]`. Tối đa 3 bậc.

```yaml
figure: clause-levels
sentence: "Although the initial results, which were gathered over three years, seemed promising, the drug ultimately failed the final trial."
levels:
  - {level: 1, parts: [{text: "the drug", role: S}, {text: "ultimately", role: A}, {text: "failed", role: V}, {text: "the final trial", role: O}]}
  - {level: 2, parts: [{text: "Although"}, {text: "the initial results", role: S}, {text: "seemed", role: V}, {text: "promising", role: C}], note_vi: "nhượng bộ, bổ nghĩa cho cả bậc 1"}
  - {level: 3, parts: [{text: "which"}, {text: "were gathered", role: V}, {text: "over three years", role: A}], note_vi: "bổ nghĩa cho results ở bậc 2"}
```

6. `morphemes` — `words: [{pieces: [{text, kind: prefix|root|derivational|inflectional, label_vi}], meaning_vi}]`. Tối đa 3 từ.

```yaml
figure: morphemes
words:
  - pieces: [{text: "un", kind: prefix, label_vi: "tiền tố"}, {text: "employ", kind: root, label_vi: "gốc"}, {text: "ment", kind: derivational, label_vi: "hậu tố từ loại"}]
    meaning_vi: "không + thuê làm + → danh từ = tình trạng thất nghiệp"
  - pieces: [{text: "work", kind: root, label_vi: "gốc"}, {text: "ed", kind: inflectional, label_vi: "quá khứ"}]
    meaning_vi: "cũng vậy: work·s, work·ing"
```

7. `agreement` — `tokens: [string]`, `pairs: [{n, subject: <chỉ số>, verb: <chỉ số>, main: true|false, note_vi}]`, `interrupter?: {from, to}`. Tối đa 2 cung; cung `main: true` vẽ trên, nét liền.

```yaml
figure: agreement
tokens: ["The", "proportion", "of", "people", "who", "use", "public", "transport", "has", "risen", "significantly."]
pairs:
  - {n: 1, subject: 1, verb: 8, main: true, note_vi: "số ít: proportion → has"}
  - {n: 2, subject: 3, verb: 5, main: false, note_vi: "số nhiều: people → use"}
interrupter: {from: 2, to: 7}
```

8. `error-pair` — `pairs: [{wrong: {before, error, after}, right: {before, fix, after}, reason_vi}]`. Tối đa 3 cặp; mở rộng `{wrong, right, reason_vi}` của gói 5.7.4 để chỉ khoanh đúng phần sai.

```yaml
figure: error-pair
pairs:
  - wrong: {before: "The accident", error: "was happened", after: "yesterday."}
    right: {before: "The accident", fix: "happened", after: "yesterday."}
    reason_vi: "happen không có tân ngữ, nên không có dạng bị động."
```

9. `role-translation` — `rows: [{role, en, vi}]`, `inner?: {en: [string], vi: [string], swaps: [[i, j]], note_vi}`.

```yaml
figure: role-translation
rows: [{role: S, en: "A new bridge", vi: "Một cây cầu mới"}, {role: V, en: "was built", vi: "đã được xây"}, {role: A, en: "last year", vi: "năm ngoái"}]
inner: {en: ["a", "new", "bridge"], vi: ["một", "cây cầu", "mới"], swaps: [[1, 2]], note_vi: "tính từ đổi chỗ: trước danh từ → sau"}
```

10. `word-slot` — `parts: [{text, label_vi, clue?: true}]` với đúng một phần `blank: true, need_vi`, `options: [{key, text, pos_vi, correct?: true}]`. Đúng một lựa chọn `correct`.

```yaml
figure: word-slot
parts: [{text: "The company’s", label_vi: "sở hữu cách"}, {text: "rapid", label_vi: "tính từ", clue: true}, {blank: true, need_vi: "cần danh từ"}, {text: "surprised", label_vi: "V", clue: true}, {text: "investors", label_vi: "O"}]
options: [{key: A, text: "grow", pos_vi: "v"}, {key: B, text: "growing", pos_vi: "v-ing"}, {key: C, text: "growth", pos_vi: "n", correct: true}, {key: D, text: "grew", pos_vi: "v quá khứ"}]
```

Ghi chú: chỉ số trong `agreement` đếm từ 0; `key` trong `voice-shift` nối khối câu gốc với khối câu đã đổi (bản điện thoại dùng chính `key` làm chữ mũ a, b, c). Câu ví dụ của tờ lấy từ bài thật trong `backend/content`; người thực thi kiểm lại đúng nguyên văn khi chép vào bài thí điểm.

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Không cờ máy chủ riêng; đổi tới người dùng qua PR mã của từng nhiệm vụ. Quay lui = revert PR của nhiệm vụ đó.

## Verification strategy

Lệnh mỗi PR (00 mục 5): backend `cd backend && python -m pytest tests/ -q`; PG17 `REQUIRE_PG=1 TEST_PG_URL=… python -m pytest tests/test_migration_47*.py tests/test_client_write_invariant_postgres.py -q`; frontend hợp đồng, React, `tsc`, `build`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Không kiểm trên production: không nộp bài thử, không công bố điểm, không gửi thông báo hay thư, không bật cờ, không đổi trần chấm thử. Production chỉ xem sau khi anh Andy cho promote.
