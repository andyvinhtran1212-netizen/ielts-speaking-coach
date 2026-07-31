# Audit Grammar Quiz — chất lượng câu hỏi, hiển thị, instruction, chấm & giải thích (2026-07-16)

**Phạm vi:** toàn bộ 137 bank grammar (3.015 câu, `docs/grammar-quiz-banks/`), engine hiển thị/chấm (`frontend/js/quiz-engine.js`, `frontend/pages/quiz.html`), serve path (`backend/services/quiz_service.py`, `quiz_import.py`), điểm vào từ Grammar Wiki.

**Phương pháp:** (1) validator tĩnh hiện có — PASS toàn bộ bank thật; (2) sweep heuristic tự viết trên 3.015 câu (script + report tại scratchpad phiên audit); (3) 8 agent review độc lập đọc từng câu theo rubric confusion, findings được **xác thực lại qid/quote với JSON gốc** (40 finding hợp lệ, 2 bị loại vì qid không khớp); (4) đọc code toàn bộ luồng render/chấm/feedback.

**Khác với audit 2026-07-10** (đáp án đúng/sai, schema): audit này tập trung vào *trải nghiệm người học* — đề bài có hiểu được không, biết phải trả lời thế nào không, giải thích có giúp không.

---

## I. KẾT LUẬN CHÍNH

Nội dung bank nhìn chung sạch về đáp án (validator + QA2 đã làm việc tốt). Nguồn confusion của người dùng **không nằm chủ yếu ở đáp án sai**, mà ở **4 khoảng trống hệ thống**:

1. **UI không có lớp instruction** — người học chỉ thấy prompt trần + widget. Mọi hướng dẫn ("gõ lại cả câu", "viết 3 từ", "ghi ø") đều do tác giả tự nhét vào prompt, mỗi bank một kiểu → không nhất quán, có chỗ mâu thuẫn với chấm điểm.
2. **gap_text (production) là điểm đau lớn nhất** — bắt buộc để master (require_production_to_master) nhưng: không báo số từ cần gõ, accept hẹp so với lời mời mở của đề, có câu bắt gõ ký tự không gõ được (ø), có câu bắt gõ nguyên câu dài (grading exact-match + edit-distance-1 không đủ dung sai).
3. **Copy toàn trang là ngôn ngữ vocab** ("Đã thuộc x/y", "bộ từ này", "Từ khó nhất", "thẻ từ") chạy trên bank grammar; chip "Cần ôn lại" hiện **slug thô** (`art-definite-usage`). Cơ chế mastery (provisional credit — trả lời đúng MCQ đầu tiên KHÔNG tăng progress) không được giải thích ở đâu → "đúng mà sao không lên điểm?".
4. **Một lớp câu "gượng ép"** đúng như người dùng mô tả: boolean meta 2 tầng ("câu X dùng Y đúng **vì** <lý do>?"), TFNG 3 đáp án nhét vào widget 2 nút, jargon ngữ pháp tiếng Anh trong đề (dangling modifier, inversion, nominalization…) ở câu cho band 5.

---

## II. LỖI HỆ THỐNG (code/convention — sửa 1 chỗ, hết cả lớp)

### S1. Không thể submit ô trống + convention "ø" không gõ được — HIGH
- 8 câu dạng `____ (viết mạo từ hoặc 'ø' nếu không cần)`: `apn_single_i2`, `apn_city_i2` (articles-with-places), `za_general_i2`, `za_meals_sports_i2`, `za_lang_subj_i2`, `za_idiom_i2` (zero-article), `art_zero_i2` (articles), `noun_art_i2` (nouns — đề nói "để trống nếu không cần" nhưng accept chỉ có `The`).
- UI: nút **Kiểm tra bị disable khi input rỗng** (`quiz.html` — `btn.disabled = !inp.value.trim()`), Enter cũng bị chặn → "để trống" là **bất khả thi**.
- "ø" không có trên bàn phím VN/EN; accept thứ hai `no article` không hề được nêu trong đề.
- **Fix đề xuất:** đổi convention sang gõ `0` hoặc chữ `x`/`khong` (và nêu rõ trong đề), thêm các biến thể vào accept; hoặc chuyển các câu này sang `gap_mcq` với option "ø (không cần mạo từ)".

### S2. Accept chứa "/" literal — chấm sai chắc chắn — HIGH
- `cmp_dir_i1` (comparison-structures-in-reading): accept[0] = `"...more rapid/extensive/widespread than..."` — tác giả định ghi 3 biến thể nhưng engine so khớp nguyên văn → người gõ đúng "more rapid than..." bị chấm **sai**.
- `nom_agent_i2` (nominalization): accept `["of / by", "of carbon emissions by"]` — "of / by" là chuỗi literal không ai gõ ra.
- **Fix:** tách biến thể thành phần tử accept riêng. Thêm lint CI: cấm `/` trong accept của gap_text (trừ khi prompt yêu cầu gõ dấu /).

### S3. gap_text bắt gõ nguyên câu / cụm dài — dung sai chấm không đủ — HIGH
- 50 câu accept[0] ≥ 4 từ (23 câu dạng "gõ lại CẢ CÂU", vd `aan_u_i2`, `cu_art_i2`, `punc_dash_i1` — 9 từ kèm dấu ngoặc đơn bắt buộc). Edit-distance-1 không cứu được khác biệt dấu câu giữa câu, mạo từ, biến thể từ vựng.
- **Fix:** quy ước trần ≤3 từ cho gap_text; câu "sửa cả câu" chuyển thành mcq chọn bản sửa đúng, hoặc chỉ yêu cầu gõ *phần được sửa*.

### S4. 2 chỗ trống — 1 ô nhập — MED
- 18 câu (nặng nhất: tag-questions `tq_polarity_i3`, `tq_doaux_i3`, `tq_special_i3`, `tq_there_neg_i3`; `aerr_missthe_a1`; `rc_def_i1` dấu phẩy 2 vị trí; `epn_pref_i3` options chỉ cover blank 2).
- **Fix:** viết lại đề còn 1 blank, hoặc nêu rõ "gõ cụm điền vào cả 2 chỗ trống theo thứ tự".

### S5. UI copy vocab-hoá trên bank grammar + slug thô — MED
- `quiz.html`: "Bạn đã thuộc trọn vẹn **bộ từ** này", "Đã thuộc x/y", "**Từ** khó nhất", chip "Cần ôn lại" hiện `item_key` thô (`art-definite-usage`), "Xem nhanh **thẻ từ**" (grammar không có card → may mắn bị ẩn).
- **Fix:** nhánh copy theo `skill_area` ("Đã nắm x/y điểm ngữ pháp", "Điểm khó nhất"); map item_key → tên tiếng Việt (thêm cột label khi import, hoặc tra `explain`/section title của bank).

### S6. Không có lớp instruction per-type + không onboarding mastery — MED
- CTA vào quiz chỉ ghi "Làm bài tập để kiểm tra kiến thức bài này" → vào thẳng câu 1. Không nơi nào nói: cần đúng ≥2 skill khác nhau/điểm, bắt buộc có câu tự gõ, trả lời đúng MCQ lần đầu chỉ là "tạm tính" (provisional — progress không tăng), sai là reset provisional.
- **Fix:** (a) 1 dòng instruction cố định theo type ngay trên widget: "Chọn đáp án đúng" / "Điền vào chỗ trống — gõ N từ" (N từ `accept[0]`) / "Câu sau Đúng hay Sai?"; (b) tooltip/1 màn giới thiệu cơ chế mastery lần đầu; (c) hiện word-count hint tự động cho gap_text từ accept.

### S7. Blank `___` (<4 gạch) không được render thành ô trống — LOW
- `fmt()` chỉ style `_{4,}`: 2 câu (`ate_ev_i1`, `dsp_of_i2`) hiện gạch dưới thô.
- **Fix:** đổi regex thành `_{2,}` hoặc sửa 2 prompt.

---

## III. LỚP CÂU "GƯỢNG ÉP" / KHÓ HIỂU MỤC ĐÍCH (content pattern)

### P1. Boolean meta 2 tầng "đúng vì <lý do>" — 10 câu, tập trung ở `G-error-clinic-article-errors` (`aerr_*_i2` series)
Người học phải phán xét đồng thời (a) cách dùng và (b) lý do được nêu — vd `aerr_aan_i2`: "dùng 'an' trước 'MBA' là đúng **vì** chữ 'M' đọc là /em/?" → TRUE chỉ khi cả hai vế đúng. Đây là dạng "đánh đố logic", không phải kiểm tra ngữ pháp. **Fix:** tách thành boolean thường (câu đúng/sai) + explain nêu lý do; hoặc mcq "vì sao đúng?".

### P2. TFNG 3 đáp án trong widget 2 nút — `G-grammar-for-reading-hedging-and-certainty-in-reading` (`hc_tfng_b1` và các câu cùng dạng "Bài:… Câu hỏi:… Đáp án là?")
Người học luyện Reading được dạy True/False/**Not Given**; widget chỉ có Đúng/Sai. **Fix:** chuyển thành mcq 3 option T/F/NG.

### P3. Jargon tiếng Anh trong đề — 74 câu (dangling modifier, inversion, nominalization, appositive, coordinate/cumulative…)
Chấp nhận được ở bank advanced (đúng chủ đề bài), nhưng cần nhất quán: jargon đã dạy trong bài Wiki thì giữ, jargon ngoài bài thì bỏ khỏi stem (vd `pgl_s_i2` nhét "ngôi thứ 3 số ít" vào giữa blank; `oa_cc_b2` "DIFFERENT categories (size + colour)").

### P4. Đề mời mở — accept đóng (production mismatch)
- `ms_vi_i1`: "điền chủ ngữ hợp lý — cơ quan/nhóm chịu trách nhiệm" nhưng accept chỉ `The government|The state`.
- `sf_sub_i3`: "write a short main clause" nhưng chỉ 3 câu exact được nhận.
- `cmp_dir_i1`, `rc_pitfall_a2`, `punc_dash_i1` cùng lớp.
- **Fix:** hoặc đóng đề ("dùng từ government"), hoặc mở accept. Đây là đúng ca §3.4 của authoring guide nhưng cho gap_text.

### P5. Hint trong ngoặc mâu thuẫn/lộ đáp án
- Mâu thuẫn: `art_indef_i2` hint "(mạo từ + danh từ)" nhưng accept `a`; `sdp_partial_i2` "Điền cụm" nhưng accept 1 từ; `eu_adv_i2` "viết lại nguyên trạng từ" nhưng accept chính từ đó; `spec_chance_i2` "(could / possibly / lead)" không nói cách dùng.
- Lộ đáp án: `pvc_run_i2` "(a semicolon)", `cigm_althdesp_i2` "(write the phrase 'despite the bad weather')".
- **Fix:** chuẩn hoá cú pháp hint thành đúng 2 dạng: `(gõ N từ)` và `(dạng đúng của <verb>)`; cấm hint chứa đáp án.

### P6. Self-doubting explain còn sót (lint chưa bắt hết)
- `cmp_mult_b2`: explain thừa nhận "hoặc gấp 4 nếu tính…" — đề "three times higher" vốn mơ hồ 3×/4×.
- `cmp_dir_i2`: **BAD_KEY** — câu ngữ pháp đúng bị key FALSE vì "nội dung mâu thuẫn thực tế" (explain tự ghi "Cấu trúc không sai"); còn dùng "phát triển" để chỉ "developing" (sai nghĩa tiếng Việt).
- **Fix nội dung:** sửa 2 câu này ngay. **Fix lint:** thêm pattern "hoặc gấp/nếu tính/thực ra/nhưng thực tế" vào content_lint.

### P7. Explain sai/tự mâu thuẫn lẻ tẻ (đã xác thực)
- `cis_comp_i3`: "accessible là 3 âm tiết" (thực tế 4).
- `tq_there_neg_i2`: "số ít nhưng lấy they" không giải thích singular-they.
- `comp_short_i2`: quy tắc âm tiết của "quiet" giải thích rối.
- 6 câu explain tiếng Anh trần (`oa_seq_i3`, `oa_seq_a1`, `inf_verb_i2`, `inf_verb_i3`, `inf_adj_b1`…), 9 câu explain <40 ký tự (chuẩn guide là 1–3 câu nêu quy tắc).

### P8. Khác (med, danh sách đầy đủ trong findings-merged.json)
- `gb7_inv_b2` (option 2 không hề là inversion nhưng stem không nhấn structural check), `t2_cpx_i2` (stem cụt), `ell_coord_i1` ("(bỏ chỗ trống nếu hiểu)" vô nghĩa), `thr_gerinf_a1` ("compare" nhưng thực ra điền cặp), `ah_scope_a2`, `ate_cmp_b1`, `im_grad_i1`, `freqpos_i2`, `pas_time_a1`, `arso_front_i2`, `stst_speak_i3`, `gen_fe_i3`, `app_rec_i1` (accept chứa biến thể thiếu nghĩa), `noun_art_i2`, `deto_count_i1`, `ttt_discourse_a1`, `pfw_col_a1`, `cigm_althdesp_a2`, `sdp_ack_i2`, `pp_nominalize_a2`, `rc_def_i1`, `epn_pref_i3`, `za_general_i2`, `pas_time_i2a/b`.

Số liệu nền: 850 boolean (848 có prefix "Đúng hay Sai" — nhất quán tốt), 590 gap_text (121 không hint; 29 vừa không hint vừa đáp án ≥2 từ), 86 mcq có ≥3 option dài gần giống nhau (khó soi khác biệt trên mobile — cân nhắc **bôi đậm phần khác nhau**).

---

## IV. LỖI HIỂN THỊ/CHẤM PHÍA CLIENT (đã kiểm code, không phải giả thuyết)

| # | Vấn đề | Vị trí | Mức |
|---|--------|--------|-----|
| D1 | Submit rỗng bất khả thi (S1) | `quiz.html` gap_text widget | HIGH (với 8 câu ø/để-trống) |
| D2 | Không hiện instruction per-type, không word-count cho gap_text | `renderQuestion()` | HIGH (UX) |
| D3 | Copy vocab + slug thô trên grammar (S5) | `quiz.html` gate/summary/chips | MED |
| D4 | Provisional credit vô hình — đúng MCQ đầu không tăng "Đã thuộc" và không có giải thích | engine + UI | MED |
| D5 | Blank render `_{4,}` bỏ sót `___` | `fmt()` | LOW |
| D6 | Explain bắt đầu "SAI —" hiện ngay cả khi user trả lời đúng ("✓ Chính xác" + "SAI — …" dễ khựng 1 nhịp) | feedback panel | LOW (cân nhắc prefix "Câu gốc SAI:") |

Chấm điểm core (index-based, shuffle giữ data-oi, boolean 1/0, normalize + fuzzy) — **đúng**, không thấy bug chấm nhầm ở engine. Serve path gắn `article_url` đúng route rewrite (`next.config.ts /grammar/:category/:slug`).

---

## V. ƯU TIÊN HÀNH ĐỘNG

**Đợt 1 — data hotfix (không cần code):** S2 (2 câu accept "/"), P6 (2 câu comparison), S1 nhóm ø (8 câu — đổi convention), P5 hint lộ đáp án (2 câu), P7 explain sai facts (2 câu). ≈ 16 câu, sửa file bank + re-import.

**Đợt 2 — UI (1 PR nhỏ):** D2 instruction line theo type + word-count hint từ accept[0]; D3 copy grammar; D5 regex; D4 thêm 1 dòng "Đúng lần đầu — cần xác nhận thêm 1 câu" khi provisional.

**Đợt 3 — content sweep theo pattern:** P1 (10 boolean 2 tầng), P2 (TFNG bank reading), S3 (23 câu gõ-cả-câu), S4 (18 câu 2 blank), P4/P5 còn lại, P8; đồng thời thêm 3 lint mới vào `validate_grammar_quiz_bank.py`: `/` trong accept; `để trống|ø` trong prompt gap_text; accept[0] ≥ 4 từ.

**Artifacts:** findings đã xác thực: `findings-merged.json`; sweep heuristic: `report.json` (scratchpad phiên audit — copy vào repo nếu cần lưu).
