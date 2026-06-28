# GRAMMAR — HỒ SƠ BÀN GIAO TỔNG HỢP (1 file duy nhất)
**IELTS Speaking Coach · Grammar Wiki: Check-up nhúng + Hotlink · cập nhật 2026-06-27**
**Người nhận:** (1) **Agent Coding** — dựng loader/render/telemetry · (2) **Agent Nội dung** — soạn check-up/end-test + chuẩn hoá anchor/tag.

> ⚠ **PIVOT 2026-06-27 — ĐỊNH HƯỚNG ĐÃ ĐỔI (đọc trước §I.3):** sản phẩm pivot từ *Speaking-only* sang **học IELTS toàn diện (4 kỹ năng) → tiến tới học tiếng Anh toàn diện**. **Cổng "FREEZE content ngoài speaking" ở §I.3 KHÔNG còn hiệu lực** — content Writing (vd grammar Task 1/Task 2) giờ là **first-class**. Định hướng chuẩn: `CLAUDE.md › What this project is / Product direction`. Mọi phần kỹ thuật còn lại của hồ sơ (kiến trúc check-up, anchor/hotlink, error-tag, loader) vẫn áp dụng nguyên.

> File **self-contained**: gộp nguyên văn toàn bộ deliverable grammar (strategy · audit 98 bài · kiến trúc · work-items PM · web-placement · khuôn · error-tags · prompt sinh bài · samples · dữ liệu khảo sát) **+ hiện trạng engineering mới nhất (đợt A3 vừa hoàn thành)**. Không cần mở file khác.

---

## CÁCH DÙNG FILE NÀY
- **Cả hai agent đọc trước:** PHẦN I (bối cảnh + hiện trạng + audit).
- **Agent Coding:** PHẦN I → **PHẦN A** (kiến trúc, work-items E0–E5, web-placement, bật CI STRICT).
- **Agent Nội dung:** PHẦN I → **PHẦN B** (quy ước anchor/tag, KHUÔN, error_tags, PROMPT, SAMPLES).
- **Tra cứu per-bài:** PHẦN C (khảo sát 98 bài).
- **Quy ước nhúng:** mục con gắn nhãn `▸ NGUỒN: <file>` là **nguyên văn** deliverable gốc. Mục KHÔNG có nhãn là phần tổng hợp/điều phối mình tự soạn (mới nhất).

## MỤC LỤC
**PHẦN I — BỐI CẢNH & HIỆN TRẠNG**
- I.1 Sản phẩm, mục tiêu, phạm vi
- I.2 ⭐ HIỆN TRẠNG ENGINEERING — đợt A3 đã xong (anchor/hotlink STRICT-ready) + bảng DONE/REMAINING
- I.3 ▸ STRATEGY — ưu tiên (Plan A vs Plan B)
- I.4 ▸ AUDIT nội dung 98 bài

**PHẦN A — AGENT CODING**
- A.1 ▸ Kiến trúc check-up nhúng (hybrid co-located + loader)
- A.2 ▸ Work-items PM (E0–E5, C0–C3, gate, risk)
- A.3 ▸ Web-placement (file:line)
- A.4 Bật STRICT trong CI (đã sẵn sàng)

**PHẦN B — AGENT NỘI DUNG**
- B.1 Quy ước anchor + error-tag (tóm tắt + trạng thái A3)
- B.2 ▸ KHUÔN block check-up/end-test
- B.3 ▸ error_tags.yaml (danh sách chuẩn)
- B.4 ▸ PROMPT sinh bài hàng loạt
- B.5 ▸ SAMPLES bài tập mẫu (6 bài)

**PHẦN C — DỮ LIỆU**
- C.1 ▸ grammar_article_survey.csv (per-bài)

---

# PHẦN I — BỐI CẢNH & HIỆN TRẠNG

## I.1 Sản phẩm, mục tiêu, phạm vi
- **Sản phẩm:** IELTS Speaking Coach (FastAPI backend + vanilla-JS frontend + Supabase/Postgres). Grammar Wiki = ~98 bài markdown ở `backend/content/` (8–11 category), frontmatter YAML (title, slug, category, band_relevance, common_error_tags, anchors[]…).
- **Mục tiêu epic:** (1) mỗi bài Wiki có **check-up sau mỗi section** + **test cuối bài** (auto-grade an toàn, 0 false-fail); (2) **hotlink Speaking→grammar** (lỗi ngữ pháp khi chấm nói → link tới đúng section bài) **cuộn đúng chỗ**.
- **Hai track song song:** **Engineering (E)** = render/loader/telemetry; **Content (C)** = soạn bài + chuẩn hoá anchor/tag. PR/flag riêng `GRAMMAR_CHECKUP_ENABLED`.
- ⚠ **Chiến lược (chi tiết I.3):** **Plan A** (sửa hotlink/telemetry/anchor — rẻ, ship ngay) tách khỏi **Plan B** (content epic 93 bài — gate bằng pilot + tín hiệu NÓI).

## I.2 ⭐ HIỆN TRẠNG ENGINEERING — đợt A3 đã hoàn thành (anchor/hotlink STRICT-ready)
> Mục này **MỚI** (sau khi các deliverable 2026-06-20 viết ra). Đọc kỹ để **KHÔNG làm lại** E0 / C1-marker / C2-anchor.

### Cơ chế hotlink (vì sao anchor quan trọng)
Lỗi grammar khi chấm nói → `claude_grader._attach_grammar_recommendations` → match slug + anchor → lưu `grammar_recommendations.recommended_anchor` → `result.html` build link `/grammar/{cat}/{slug}#anchor` → `grammar.js:_scrollToHashAnchor()` cuộn + pulse. **Đích cuộn `<a id>` CHỈ sinh từ marker body `<!-- anchor: id -->`** (`grammar_content.py:190`, regex `_ANCHOR_MARKER_RE`). Frontmatter `anchors:` chỉ là inventory cho matcher — **một mình nó KHÔNG tạo `<a id>`**. ⇒ anchor khai báo mà thiếu marker = link resolve nhưng **không cuộn** (rơi về đầu trang).

### verify_anchor_drift.py — đã nâng cấp (CI gate)
`backend/scripts/verify_anchor_drift.py` hiện có 2 tầng:
- **Tầng 1 — MAPPING DRIFT (hard, exit 1):** mọi `target_anchor` active trong `feedback-anchor-mapping.yaml` phải ∈ frontmatter `anchors:`.
- **Tầng 2 — BODY-MARKER AUDIT (WARN mặc định; HARD khi env `ANCHOR_BODY_MARKERS_STRICT=1`):**
  - `[a]` anchor khai báo nhưng **thiếu marker body**;
  - `[b]` `location` **không khớp heading thật** trong body;
  - `[c]` **reverse-drift** (marker body không khai frontmatter);
  - `[d]` mapping AI-feedback resolve tới anchor nhưng thiếu marker body (= **hotlink vỡ thật**).

### Kết quả đợt A3 (đã verify)
- **A3-1:** backfill **16 marker** cho đúng 16 hotlink Speaking→grammar đang vỡ → **[d] = 0**.
- **A3-2:** backfill **103 marker** còn thiếu (**[a]→0**) + chỉnh **120 `location`** frontmatter cho khớp heading thật (**[b]→0**) + khai **7 id reverse-drift** vào frontmatter (**[c]→0**); 2 file (`complex-sentence`, `inversion`) trước không có khoá `anchors:` → đã tạo mới.
- **Kết quả:** **267 anchor khai báo == 267 marker body** (1:1); `verify_anchor_drift.py` **exit 0 cả thường lẫn STRICT**. **Không đụng prose/heading** (chỉ thêm dòng marker + sửa metadata frontmatter; đã verify YAML parse OK 98/98, 0 marker trùng/hỏng).

### Bảng đối chiếu WI cũ → trạng thái thật (đọc kỹ trước khi nhận việc)
| WI (theo PLAN_PM A.2) | Mô tả | Trạng thái |
|---|---|---|
| **E0** | Nâng `verify_anchor_drift.py` canh đúng invariant | ✅ **DONE** — đã có audit `[a][b][c][d]` + STRICT env |
| **C1 (marker)** | Backfill 16 marker hotlink hỏng | ✅ **DONE** (A3-1) |
| **C2 (anchor)** | Backfill 103 anchor còn thiếu + sửa `location` | ✅ **DONE** (A3-2) |
| **C1 (de-dup)** | De-dup 4 bài merge (gerund-inf, complex-sentence, conditionals, present-simple) | ❌ **CHƯA** — xem cảnh báo dưới |
| **C0** | `error_tags.yaml` (list chuẩn) | ⚠ **File đã soạn** (B.3) — **cần commit vào `backend/content/error_tags.yaml`** |
| **C2 (tag)** | Gắn `common_error_tags` cho 26 bài thiếu | ❌ **CHƯA** |
| **E1** | Loader strip block + parse → field `exercises` | ❌ **CHƯA** |
| **E2** | Migration 110 + attempts API | ❌ **CHƯA** |
| **E3a/E3** | FE render + chấm client-side + a11y | ❌ **CHƯA** |
| **E4** | Flag + pilot + telemetry + denylist | ❌ **CHƯA** |
| **E5** | Fix telemetry `rec_id` (đo click hotlink) | ❌ **CHƯA** |
| **CI STRICT** | Bật `ANCHOR_BODY_MARKERS_STRICT=1` làm hard gate | 🟢 **SẴN SÀNG** — audit đã xanh, bật ngay (xem A.4) |

> ⚠ **Cảnh báo (cả hai agent) — merge artifact CHƯA de-dup:** các file ghép nhiều bài, **trùng heading**, vẫn còn (gerund-vs-infinitive `## Lỗi thường gặp`×7, `## Tóm tắt nhanh`×7; complex-sentence ×3; conditionals ×2; present-simple ×2; word-order/adjectives/passive… có nửa thứ hai nối thêm). Đợt A3 đặt marker ở **lần xuất hiện ĐẦU TIÊN** của heading trùng. Khi de-dup (C1) hoặc soạn check-up (C3): **giữ marker gắn với section canonical**, đừng làm mất/lệch; **chạy lại `verify_anchor_drift.py` sau de-dup**.
> ⚠ **Lưu ý cho SAMPLES/KHUÔN (B.2, B.5):** các ghi chú "Anchor status: cần thêm marker (C1)" trong 2 mục đó là **trạng thái CŨ trước A3** — **giờ tất cả marker đã có**. Khi soạn bài, id `section_ref` của các điểm hiện có **đã sẵn sàng cuộn**; chỉ thêm marker MỚI nếu tạo section/điểm dạy mới.

### Việc tiếp theo gợi ý (theo Plan A trước)
- **Agent Coding (Plan A, ship sớm):** **E5** (fix telemetry `rec_id`) → **bật CI STRICT** (A.4) → **E1** loader → **E2** migration → **E3a/E3** → **E4** (cho pilot). E0 + anchor đã xong nên phần "hotlink cuộn" của Plan A coi như đạt; còn E5 để đo click-through.
- **Agent Nội dung:** **commit `error_tags.yaml`** (C0) → **de-dup 4 bài merge** (C1) → **tag 26 bài** (C2) → **soạn check-up 3–5 bài pilot 6→7** (C3-pilot) theo KHUÔN+SAMPLES. **ĐỪNG** scale 93 bài tới khi qua **PILOT GATE** (A.2 §3).


---

## I.3 ▸ STRATEGY — Ưu tiên (Plan A vs Plan B)
*(nhúng nguyên văn — `STRATEGY_prioritization_2026-06-20.md`)*

# STRATEGY — Ưu tiên & sự thật phải nói thẳng (Grammar + Vocab)
**IELTS Speaking Coach · 2026-06-20 · đọc TRƯỚC mọi PLAN khác**

> Bù đúng phản biện gắt nhất (strategy gauntlet 7.4): bộ công trình **rigor cao nhưng có nguy cơ sai ưu tiên cho một Speaking coach**. Doc này foreground lại: tách phần rẻ-chắc-thắng khỏi phần đầu-cơ, và nói thẳng cái mọi vòng review đã lịch sự né.

---

## 0. SỰ THẬT PHẢI NÓI THẲNG (the uncomfortable truth)
**Chưa ai đo được liệu BẤT KỲ thứ gì trong sản phẩm này — engine cũ hay check-up mới — có thực sự giúp user NÓI tốt hơn.** Bộ docs cũ đặt một cổng đòi **bằng chứng transfer-sang-nói** rồi từ chối build tới khi có. Vòng này có một nước đi trí tuệ: **định nghĩa lại deliverable thành "check-up đọc-hiểu" để TỰ MIỄN khỏi cổng đó** ("nó chỉ là kiểm tra hiểu bài, không phải engine transfer"). Reframe đó **đúng cục bộ** — nhưng hệ quả thực tế là: một Speaking coach sắp bỏ **khoản đầu tư nội dung lớn nhất (6–10+ content-week)** vào **bài tập VIẾT**, gated chỉ bởi "user có *làm xong* bài tập không", còn câu hỏi "có nói tốt hơn không" thì lặng lẽ bị gắn nhãn "ngoài phạm vi". → **Quyết định bet này phải mở mắt, không mặc định.**

## 1. TÁCH 2 KẾ HOẠCH (đừng để cái rẻ làm con tin cho cái đắt)
| | **PLAN A — Sửa cái đã hỏng (ship NGAY)** | **PLAN B — Content epic (đầu cơ, có cổng)** |
|---|---|---|
| Là gì | E0 sửa `verify_anchor_drift` (canh sai invariant) + backfill **16 marker hotlink hỏng** + E5 sửa telemetry `rec_id` | C3-scale grammar (300–500 check-up/98 end-test) + toàn bộ track vocab card+audio |
| Chi phí | **~1 tuần, KHÔNG cần content owner** | **6–10 content-week (grammar) + vài content-week (vocab), STAFFING TBD** |
| Giá trị | **Sửa brokenness THẬT, ĐÃ SHIP, trên đúng bề mặt speaking** (lỗi grammar khi nói → hotlink không cuộn được tới 16/61 đích) | **Chưa có 1 tín hiệu transfer-sang-nói nào** |
| Rủi ro | Thấp, reversible | Cao, phần lớn không đảo được (đã author 93 bài) |
| Khuyến nghị | **GREEN-LIGHT ngay, foreground làm headline** | **FREEZE tới khi pilot cho tín hiệu nói + demand chứng minh** |

> Hiện E0/E5/C1 đang **bị chôn** làm work-item trong megaplan 80%-content. **Tách ra:** PLAN A độc lập, ship trước, không phụ thuộc quyết định staffing của PLAN B.

## 2. SỬA CỔNG PILOT — thêm 1 ngưỡng đo TRANSFER-NÓI (hoặc nói thẳng là không đo)
Cổng pilot hiện đo *completion + đúng/sai bài tập + hotlink cuộn* — **0 đo tác động lên nói**. Sửa 1 trong 2:
- **(ưu tiên)** Thêm ngưỡng: *trong nhóm fail check-up conditionals, error-tag conditionals khi NÓI có giảm ở 2 session kế?* — tái dùng `grammar_recommendations` + query recurrence within-subject (đã có ở WI cũ). Không cần engine mới.
- **(nếu từ chối đo)** Ghi RÕ trong gate doc: **"Dự án này KHÔNG gated trên cải thiện nói"** → để leadership chọn bet có chủ đích, không tự lừa bằng "rigor" đo nhầm thứ.

## 3. RE-IMPORT tín hiệu cầu RẺ trước khi author 93 bài
Trước C3-scale: bật **fake-door "Luyện điểm này"** + đọc **`was_clicked` hotlink** (sau E5) 2–3 tuần. Nếu user **không bấm** rec grammar / không hoàn thành check-up pilot → **đừng author 93 bài**. Fake-door cũ KHÔNG phải category error — nó là bảo hiểm miễn phí đã bị bỏ.

## 4. THU NHỎ VOCAB thành PROBE (đừng dựng TTS pipeline cho feature chưa validate)
- **0 bằng chứng** ai muốn thư viện thẻ từ trên app *nói*. Audio TTS là infra net-new ngược nguyên tắc "reuse".
- **Probe rẻ:** chỉ **bổ sung `definition_en`+`example`+audio (reuse `tts.py`) cho 20 từ `content_vocab` SẴN CÓ** + 1 bộ bài tập → đo dùng. **KHÔNG** xây importer/bảng/pipeline ElevenLabs/scale 350 thẻ tới khi probe cho tín hiệu.
- Track vocab build đầy đủ = **defer**, không song hành grammar.

## 5. NGƯỠNG là PROVISIONAL, không phải rigor giả
`completion ≥ 50%` là **số tròn mượn từ plan engine cũ** (mẫu số khác: drill *nói* completion). → **đổi cơ sở: lấy completion THẬT của bài tập D1 vocab đang chạy trong chính app** làm baseline; nếu không có → gắn nhãn **"provisional, hiệu chỉnh sau pilot"**. Đừng mặc áo "pre-registered" cho một con số đoán.

## 6. ĐỐI XỬ measure-first ĐỐI XỨNG
Docs measure-first mọi thứ RẺ (telemetry, anchor integrity, spike E3a) — tốt. Nhưng khoản chi **LỚN NHẤT** (content epic) lại **pre-commit scope trước khi đo cầu/transfer**. → **Càng chi lớn & không đảo được, cổng đo càng phải gắt.** Hiện đang ngược.

## 7. CÁI vẫn nên LÀM (adjudication trung thực)
- ✅ **PLAN A** (hotlink/telemetry/anchor repair) — sửa brokenness thật trên bề mặt speaking, ship ngay.
- ✅ **Pilot check-up 3–5 bài 6→7** — rẻ, reversible, flag + kill-switch — **kèm 1 read recurrence-nói ở cổng** (§2).
- ⏸ **C3-scale (93 bài)** + **toàn bộ track vocab** — **FREEZE** tới khi pilot cho tín hiệu nói HOẶC fake-door chứng minh cầu.
- Giữ nguyên các bài học chất lượng (auto-grade an toàn, error-tag, schema additive) — chúng đúng, chỉ là **được pointed vào sai đích**.

---

*Bộ công trình craft cao và trung thực về CHI PHÍ; thiếu là **foreground sự thật về ưu tiên**. Doc này đặt lại: ship cái rẻ-chắc-thắng trước, gate cái đắt-đầu-cơ bằng đúng metric (nói), thu vocab về probe. Mọi PLAN khác đọc sau doc này.*

---

## I.4 ▸ AUDIT nội dung 98 bài Grammar Wiki
*(nhúng nguyên văn — `AUDIT_grammar_content_98_2026-06-20.md`)*

# AUDIT NỘI DUNG — 98 bài Grammar Wiki (khảo sát toàn bộ + định tính)
**IELTS Speaking Coach · 2026-06-20 · thuần audit, repo intact (không sửa code)**

> Audit toàn bộ 98 bài grammar active để chuẩn bị gắn check-up + test cuối bài và nâng hotlink. **Dựa trên đo dữ liệu cứng** (script quét frontmatter/body) + **đọc định tính 12 bài** đại diện. Số liệu kèm `grammar_article_survey.csv`. Mọi claim verify file:line.

---

## 0. TL;DR — 5 kết luận

1. **Nội dung CHÍNH XÁC trong mẫu đọc kỹ (suy rộng CÓ ĐIỀU KIỆN).** 12/98 bài đọc kỹ: **0 lỗi ngữ pháp trong PROSE**; register IELTS đúng; **ghi chú đối chiếu tiếng Việt (L1) là điểm mạnh thật**. ⚠ **Nhưng:** (a) **86 bài chưa đọc định tính** — mẫu 12 bài thiên về nhóm single-source được-bảo-trì-tốt; tier **ít bảo trì nhất (foundations/ielts-grammar-lab, nơi tập trung 18/26 bài thiếu tag) CHƯA được sample** → đừng coi "0 lỗi" là thuộc tính toàn corpus; (b) **đáp án bài tập KHÔNG error-free ngay trong mẫu** (gerund-inf:451 rối, relative-clauses #5 / passive #3 nửa vời). Container sâu: TB **~2.159 từ**, 12.8 H2, 19.6 H3, **0 bài mỏng**.
2. **⚠ KHỦNG HOẢNG ANCHOR INTEGRITY (rào cản hotlink lớn nhất, đo thật):** 41/98 bài khai `anchors:` trong frontmatter với **260 anchor**, nhưng body chỉ có **148 marker `<!-- anchor -->`** → **119 anchor (ở 23/41 bài) KHÔNG có đích cuộn**. Trong 60 `target_anchor` mà hotlink thực dùng, **16 (27%) trỏ tới anchor không-có-marker → resolve được nhưng KHÔNG cuộn** — gồm đúng các điểm 6→7 (`relative-clauses.which-vs-that`, `subject-verb-agreement.he-she-it-no-s`, `conditionals.type2.was-instead-of-were`...). **`test_anchor_drift` canh SAI invariant** nên không bắt được (xem §2).
3. **⚠ MERGE ARTIFACT (rào cản migration lớn nhất):** các bài 6→7 giá-trị-cao bị **ghép nhiều bài, trùng section**: `conditionals` (2×), `complex-sentence` (3×), `gerund-vs-infinitive` (6×+), `present-simple` (2×) — nhiều khối "Bài tập luyện"/"Đáp án"/"Tóm tắt nhanh" trong 1 file → script tách theo heading sẽ **ghép sai câu với đáp án khác**. **Phải de-dup trước khi tự động trích.**
4. **Tag SẠCH nhưng THƯA — ĐÍNH CHÍNH claim "polluted" trước đó.** `common_error_tags` = **27 tag hợp lệ** (`wrong_tense`×14, `missing_connector`×10, `gerund_infinitive_confusion`×7...), **0 giá trị rác**. Các slug như `sentence-elements` nằm ở `prerequisites`/`related_pages` — **đúng chỗ**, không phải pollution. Vấn đề thật: **26/98 bài KHÔNG có tag nào** (đặc biệt foundations 10, ielts-grammar-lab 8).
5. **Bài tập in-prose: 94/98 bài đã có — ~65–70% MIGRATE được nhẹ, ~30–35% phải viết lại.** Fill-blank / word-choice / sửa-1-lỗi (đáp án đơn, distractor lỗi-Việt thật) → auto-grade gần như nguyên văn (~8–12 câu sạch/bài 6→7). Transformation / "mở rộng câu trả lời" (đáp án "gợi ý") → free-text, phải chuyển MCQ/ordering hoặc đẩy sang lane không-chấm.

**Thứ tự đúng để triển khai (gate bằng dữ liệu này):** **(A) sửa anchor integrity + test** → **(B) de-dup merge artifact các bài 6→7** → **(C) tag 26 bài thiếu** → **(D) migrate in-prose → block + gắn check-up** theo thứ tự ưu tiên §6. KHÔNG gắn check-up trước khi (A)+(B) xong cho bài đó.

---

## 1. Chất lượng nội dung (định tính, 12 bài) — STRONG
- **Accuracy:** không lỗi ngữ pháp. Ví dụ verify: present-simple bảng `-s/-es` + 3 quy tắc phát âm /s,z,ɪz/ (`tenses/present-simple.md:118-129`) đúng; conditionals subjunctive `were` có nuance "speech chấp nhận was, Writing nên were" (`grammar-for-meaning/conditionals.md:175-180`); SVA 7 bẫy + BrE/AmE collective (`error-clinic/subject-verb-agreement.md:286`); passive "khi nào KHÔNG dùng passive khi nói" + L1 bị/được ≠ passive (`sentence-structures/passive-voice.md:328,344`).
- **Framework dạy-được:** template thật (Tóm tắt → Cấu trúc → Cách dùng → Dấu hiệu → Ví dụ(IELTS) → So sánh → Lỗi thường gặp → **Lưu ý người Việt** → Ứng dụng IELTS → Bài tập → Đáp án). Bài single-source theo sạch (SVA, relative-clauses, passive-voice, modal-verbs, conditionals-in-speaking). 
- **Blemish nhỏ (cosmetic, không sai sự thật):** 1 dòng giải thích đáp án rối ở `verb-patterns/gerund-vs-infinitive.md:451`; 2 đáp án "nửa vời" (relative-clauses #5 `:288`, passive-voice #3 `:303`) — không auto-grade được như đang viết, cần làm dứt khoát khi migrate.

## 2. ⚠ Anchor integrity — hotlink hỏng âm thầm (đo thật, file:line)
**Cơ chế:** renderer **chỉ** sinh `<a id>` từ marker body `<!-- anchor: id -->` (`grammar_content.py:190`); frontmatter `anchors:` + `location` **chỉ là inventory** cho matcher (`:233`), KHÔNG inject id vào heading. ⇒ anchor khai báo mà thiếu marker body = **đích cuộn không tồn tại**.

**Số đo:**
- 41 bài khai `anchors:`, tổng **260 anchor**; body chỉ **148 marker** → **119 anchor (23/41 bài) không có đích cuộn**.
- **16/61 `target_anchor`** trong `feedback-anchor-mapping.yaml` (đường hotlink thực) trỏ anchor không-marker → **hotlink resolve nhưng không cuộn**. Danh sách 16 (đều cao giá trị): `relative-clauses.common-mistake.which-vs-that` · `subject-verb-agreement.common-mistake.he-she-it-no-s` · `conditionals.type2.common-mistake.was-instead-of-were` · `conditionals.type2-vs-type3.tense-distance` · `gerund-vs-infinitive.common-mistake.wrong-form-after-verb` · `passive-voice.usage.unknown-or-irrelevant-agent` · `prepositions.common-mistake.transfer-from-vietnamese` · `reported-speech.tense-backshift.vietnamese-skip` · `word-order.question-inversion` · `cleft-sentences.usage.emphasis` · `countable-vs-uncountable.common-mistake.pluralising-uncountable` · `there-is-there-are.vietnamese-pitfall.have-instead-of-there-is` · `adjectives.participial.ed-vs-ing` · `grammar-for-band7plus.high-leverage.cleft-inversion-conditional` · `grammar-in-speaking.gra.band-7-criteria` · `hedging-language.overview`.
- Bài tệ nhất: `conditionals` (khai 12, body 2), `hedging-language` (9→1), `grammar-for-band7plus` (8→0), `grammar-in-speaking` (7→0), `future-forms` (8→1), `present-perfect` (9→2), `modal-verbs` (8→1). **7 bài khai anchor nhưng body 0 marker.**
- **Drift 2 chiều:** có marker body KHÔNG khai frontmatter (vd `conditionals.natural-speech-patterns`, `conditionals.md:203`). **`location` cũng lệch:** present-simple `location: '## Cấu trúc khẳng định'` trỏ heading không tồn tại (heading thật `### Câu khẳng định`).

**Vì sao lọt lưới:** `test_anchor_drift.py` chỉ shell ra `verify_anchor_drift.py`, mà script này **chỉ kiểm `target_anchor ∈ frontmatter anchors:`** (`collect_declared_anchors` đọc `fm.get("anchors")`, `main` check `if target in declared`) — **không bao giờ đọc body / tìm marker**. ⇒ "khai trong frontmatter" bị coi là "tồn tại", trong khi đích cuộn là **marker body**. Test pass (exit 0) dù 16 đích hỏng.

**Sửa (3 việc):** (a) **backfill marker body** cho 119 anchor khai-mà-thiếu (ưu tiên 16 đích hotlink trước); (b) **nâng `verify_anchor_drift.py`**: thêm pass "mọi anchor khai báo phải có `<!-- anchor: id -->` trong body" + "`location` khớp heading thật" + bắt drift-ngược; (c) chuẩn hoá: 1 anchor = 1 marker body + 1 dòng frontmatter + (nếu là đích hotlink) 1 mapping.

## 3. ⚠ Merge artifact — phải de-dup trước khi migrate
Các bài bị ghép nhiều bài, **trùng section** (script tách theo `## Bài tập`/`## Đáp án` sẽ lấy nhiều khối, ghép sai câu↔đáp):
| Bài | Mức ghép | Bằng chứng (heading lặp) |
|---|---|---|
| `verb-patterns/gerund-vs-infinitive` | **6×+** (1645 dòng) | "Tóm tắt nhanh" ×7 (`:461,670,863,1054,1241,1435,1616`); "Bài tập" ×7 |
| `sentence-structures/complex-sentence` | **3×** (879 dòng) | "Bài tập" `:551,787,839`; "Lỗi thường gặp" `:240,526,763` |
| `grammar-for-meaning/conditionals` | **2×** (581 dòng) | "Bài tập" `:382,529`; "Đáp án" `:392,553`; "Unless" dạy 2 lần |
| `tenses/present-simple` | **2×** (350 dòng) | bài chính hết ở `:317`, bài phụ "Lỗi #1 người Việt" từ `:333` |
**Recipe de-dup (5 bước, áp mỗi bài — tránh orphan link):**
1. **Chọn bài chính (canonical):** bản đầy đủ + cấu trúc chuẩn nhất; đánh dấu các bài-con ghép vào.
2. **Diff section:** liệt kê section trùng (vd "Unless" ×2) vs section **độc nhất** (chỉ có ở bài-con).
3. **Gộp phần độc nhất** vào bài chính (giữ 1 "Bài tập"/"Đáp án"/"Tóm tắt nhanh"); bỏ bản trùng.
4. **Repoint inbound refs:** nếu bài-con có slug riêng được trỏ tới từ `related_pages`/`next_articles`/`prerequisites`/`compare_with`/`feedback-anchor-mapping.yaml` → cập nhật về slug bài chính (CLAUDE.md "stale link must not exist").
5. **Re-run `verify_anchor_drift.py` (đã nâng cấp ở C0)** + kiểm 0 link gãy. *(Content-work, không phải code.)*
> Bài-con có thể **giữ làm deep-dive slug riêng** (vd các `*-doing-vs-to-do`) — khi đó KHÔNG xoá, chỉ bỏ phần trùng với bài chính + giữ cross-link hai chiều.

## 4. Tag — sạch nhưng thưa (ĐÍNH CHÍNH "polluted")
- `common_error_tags`: **27 tag hợp lệ**, 91 lần xuất hiện: `wrong_tense`(14) · `missing_connector`(10) · `gerund_infinitive_confusion`(7) · `collocation_error`(7) · `missing_article`(7) · `word_order_error`(5) · `no_complex_sentences`(5) · `no_compound_sentences`(5) · `wrong_preposition`(5)... **0 giá trị rác.**
- Slug như `sentence-elements`(96×)/`present-simple`(7×) chỉ ở `prerequisites`/`related_pages`/`next_articles`/`tags` — **đúng chỗ**, KHÔNG phải `common_error_tags`. ⇒ claim "polluted với slug" ở các deliverable trước **SAI, đính chính** (xem §8).
- **Vấn đề thật = THƯA:** **26/98 bài có 0 tag**: chủ yếu foundations (10), ielts-grammar-lab (8), verb-patterns (3). Tagged-article TB chỉ ~1.3 tag.
- **Việc:** gắn tag cho 26 bài + chuẩn hoá về **danh sách error-tag chuẩn** — vẫn cần list chuẩn vì 27 tag hiện có **chưa đủ phủ** cho distractor (không phải vì "rác").
- **Danh sách error-tag CHUẨN khởi đầu (inline để content agent dùng ngay, mở rộng dần trong `error_tags.yaml`):** `SVA_THIRD_PERSON_S_DROP` · `AUX_DO_AGREEMENT` · `TENSE_CONTINUOUS_FOR_FACT` · `L1_TENSE_IN_CONDITIONAL` · `ARTICLE_OMISSION` · `ARTICLE_A_VS_AN` · `PREP_WRONG` · `WORD_ORDER_ADV` · `RELATIVE_PRONOUN_WRONG` · `BARE_ING` · `WRONG_PARTICIPLE` · `PLURAL_AGREEMENT`. *(Map 27 tag cũ vào list này khi chuẩn hoá; bổ sung tag mới theo lỗi thật từ `grammar_recommendations`. ⚠ Distractor authoring (C3) BỊ CHẶN tới khi list này + tag 26 bài xong — C2 trước C3.)*

## 5. Bài tập in-prose — migrate vs rewrite
| Dạng | Bài | Auto-grade? | Xử lý |
|---|---|---|---|
| Fill-blank chia động từ | present-simple, conditionals, SVA | ✅ | migrate → `mcq`/`error_id`/`word_bank` |
| Word-choice (a/an/the/∅; if/unless; gerund/inf; modal) | articles, conditionals, gerund-inf, modal | ✅ | migrate → `mcq` |
| Sửa-1-lỗi | gần như mọi bài | ✅ | migrate → `error_id` |
| "Loại nào?" (conditional mấy?) | conditionals | ✅ | migrate → `mcq` |
| Combination/transformation | relative-clauses, complex-sentence | ⚠ free-text | viết lại → `word_bank`/`order` hoặc lane self-check |
| "Mở rộng/upgrade câu trả lời" | grammar-in-speaking | ❌ open | self-check no-score (hoặc Claude grader sau) |
- **~65–70% migrate nhẹ** (~8–12 câu sạch/bài 6→7 đã sẵn, distractor = lỗi-Việt thật như `He don't like`, `a information`, `was borned`). **~30–35% viết lại.**
- **Chặn:** de-dup §3 trước (kẻo ghép sai đáp). Đáp án "gợi ý" = cờ free-text → không auto-grade.

## 6. Ưu tiên 6→7 + ma trận readiness
**Top ưu tiên (score = speaking_high + band 6.x/7.0 + leverage + đã-anchor):**
| # | Bài | spk | band | leverage | anchor |
|---|---|---|---|---|---|
| 1 | sentence-structures/**relative-clauses** | high | 6.0–7.0 | cao | 7 (gap) |
| 2 | verb-patterns/**gerund-vs-infinitive** | high | 6.0–7.0 | cao | 13 (gap, **6× merge**) |
| 3 | error-clinic/**subject-verb-agreement** | med | 6.0–7.0 | cao | 3 (0 body!) |
| 4 | grammar-for-meaning/**conditionals** | high | 6.0–7.0 | cao | 12 (gap, 2× merge) |
| 5 | error-clinic/article-errors · tense-consistency · foundations/articles | high | 6.0–7.0 | — | 5–9 |
| 6 | sentence-structures/**complex-sentence** | high | 6.0–7.0 | cao | 0 (3× merge) |
| 7 | passive-voice · future-forms · present-perfect · modal-verbs · present-simple | high | mix | — | có gap |
| 8 | ielts-grammar-lab/conditionals-in-speaking · complex-sentence(speaking) | high | 7.0+ | cao | 0 |

> ⚠ Cột **anchor** = số anchor **KHAI BÁO trong frontmatter**, KHÔNG phải số đích cuộn **chạy thật** (vd `subject-verb-agreement` khai 3 nhưng body 0 marker; `conditionals` khai 12 body 2). "đã-anchor" trong điểm ưu tiên chỉ là tín hiệu yếu — bài điểm cao vì "đã anchor" có thể đang **nợ remediation nhiều hơn**, không ít hơn. Khi triển khai, ưu tiên theo **marker chạy thật**, và mọi bài 6→7 đều cần qua C1/C2 backfill bất kể "đã anchor".

**Readiness theo category:**
| Category | n | đã-anchor | có anchor-gap | thiếu tag |
|---|---|---|---|---|
| error-clinic | 17 | 8 | 1 | 0 |
| foundations | 18 | 8 | 3 | **10** |
| grammar-for-meaning | 12 | 6 | 4 | 2 |
| ielts-grammar-lab | 18 | 6 | 2 | **8** |
| modifiers | 3 | 1 | 1 | 2 |
| parts-of-speech | 5 | 1 | 1 | 1 |
| sentence-structures | 8 | 4 | 4 | 0 |
| tenses | 8 | 5 | 5 | 0 |
| verb-patterns | 9 | 2 | 2 | 3 |

**57 bài chưa có anchor nào** (cần thêm marker khi gắn check-up, đồng thời phục vụ hotlink) — danh sách đầy đủ trong `grammar_article_survey.csv` (cột `has_anchors_fm=0`); nhóm cao giá trị: `complex-sentence`, `compound-sentence`, `conditionals-in-speaking`, `phrasal-verbs`, `gerund`, `infinitive`, `past-perfect`, `present-perfect-continuous`, `used-to-be-used-to`.

## 7. Lộ trình content-prep (gate bằng audit này — làm trước khi build check-up)
| Phase | Việc | Phạm vi |
|---|---|---|
| **C0** | **Sửa `verify_anchor_drift.py`** (canh đúng invariant: declared⇒body-marker + location-khớp-heading + drift-ngược) → CI bắt được | 1 script + test |
| **C1** | **Backfill 16 marker body cho đích hotlink** đang hỏng (§2) → hotlink cuộn lại đúng ngay | 16 anchor / ~12 bài |
| **C1** | **De-dup merge artifact** 4 bài top (gerund-inf, complex-sentence, conditionals, present-simple) | 4 bài |
| **C2** | Backfill nốt 103 anchor khai-mà-thiếu + thêm anchor cho bài 6→7 trong 57 bài chưa-anchor | ~23 + nhóm ưu tiên |
| **C2** | **Tag 26 bài thiếu** `common_error_tags` theo list chuẩn | 26 bài |
| **C3** | **Migrate in-prose → block** + gắn check-up theo thứ tự §6 (relative-clauses → gerund-inf → SVA → conditionals → ...) | cuốn chiếu |
| **C3** | Viết lại 30–35% item free-text → MCQ/ordering hoặc self-check | rải |

## 8. Đính chính các deliverable TRƯỚC (đo lại bằng dữ liệu thật)
1. **"`common_error_tags` polluted với slug" (AUDIT_vocab_grammar §4#2, PLAN grammar §7a) → SAI.** Thực tế: tag **sạch nhưng thưa** (26/98 bài 0 tag). Danh sách error-tag chuẩn vẫn cần (vì 27 tag chưa đủ phủ distractor), nhưng lý do là **thưa/chưa-đủ-phủ**, KHÔNG phải "de-pollute". *(Đã sửa 2 dòng tương ứng.)*
2. **"Hotlink chỉ thiếu phủ ở 57 bài chưa-anchor" → CHƯA ĐỦ.** Ngay 41 bài "đã anchor" cũng hỏng: **16/61 đích hotlink không cuộn được + 119/260 anchor thiếu marker**, và **test canh sai invariant**. Hotlink "đã có" nhưng **chất lượng thực thấp hơn nhiều** so với mô tả trước — phải sửa integrity (C0/C1) trước khi coi hotlink là "chạy".

---

*Audit thuần — repo intact. Đo bằng script trên repo thật (98 bài) + đọc định tính 12 bài, verify file:line. Đính kèm `grammar_article_survey.csv` (per-article: anchor fm/body/gap, tag, H2/H3, words, in-prose-ex). Kết: nội dung MẠNH, nhưng **anchor integrity + merge artifact + tag thưa** là 3 việc content-prep phải xong TRƯỚC khi gắn check-up; thứ tự ưu tiên 6→7 ở §6.*

---

# PHẦN A — AGENT CODING
> Đọc theo thứ tự A.1 (kiến trúc) → A.2 (work-items, có cột DoD/verify/flag) → A.3 (chèn vào trang nào) → A.4 (bật CI gate). **Nhắc lại:** E0 + backfill anchor (C1-marker, C2-anchor) **đã xong** (I.2) — bắt đầu từ E5/E1.

---

## A.1 ▸ Kiến trúc check-up nhúng (hybrid co-located + loader)
*(nhúng nguyên văn — `PLAN_grammar_wiki_exercises_2026-06-20.md`)*

# PLAN — Bài tập nhúng trong Grammar Wiki (check-up theo section + test cuối bài)
**IELTS Speaking Coach · 2026-06-20 · thuần đề xuất, repo intact**

> Mục tiêu: mỗi bài Wiki có **check-up sau từng section** (kiểm hiểu ngay) + **test cuối bài** (đa dạng dạng, interleaved). Bám hạ tầng đã có; giữ guardrail chất lượng từ audit; **bỏ** gate measure-first/G6-only (xem AUDIT §3). Kèm **khuôn MD** (§7) + **bài mẫu thật** (§8).

---

## 0. Nguyên tắc (rút từ audit)
1. **Auto-grade chỉ answer-space đóng** — MCQ, error-ID MCQ, word-bank/drag exact-match, matching, ordering. **Cấm** free-cloze tiếng Anh tự-chấm (đánh-rớt-câu-đúng = vi phạm vạch chất lượng #1). Free-text chỉ "self-check, hiện đáp án" hoặc route qua Claude grader (sau).
2. **Distractor theo `common_error_tags`** + lỗi thật — mỗi distractor là 1 lỗi L1/IELTS có thật, gắn `error_tag`.
3. **Nội dung AI → người duyệt**, không auto-publish.
4. **Additive + reversible + feature flag.**
5. **Không over-claim** — check-up báo "đúng 4/5", không "đã thành thạo".
6. **Ưu tiên 6→7** (GRA descriptor chính thức): complex sentence / relative clause / conditionals / tense range / articles / SVA.

## 1. Quyết định kiến trúc then chốt — Bài tập sống ở ĐÂU?
**Khuyến nghị: HYBRID = nguồn ở markdown co-located, phục vụ qua loader + bảng attempts.** (Giải trực diện rủi ro AUDIT §6.2/§6.3)

| Phương án | Ưu | Nhược | Chọn? |
|---|---|---|---|
| Bài tập trong **frontmatter/markdown của chính bài** (block ngay dưới mỗi section + block end-test cuối bài) | Versioned cùng bài, **không drift** (sửa section là thấy check-up kề bên), không cần admin-tool mới, reuse content-edit workflow | Không sẵn analytics/curation-DB | ✅ **nguồn sự thật** |
| Bảng `grammar_exercises` riêng (engine cũ) | analytics + curation reuse | **sync/drift** bài↔bài-tập, orphan khi sửa bài | ❌ làm nguồn |
| **Hybrid (chọn)** | co-located (chống drift) **+** loader parse → serve trong API article **+** bảng `grammar_exercise_attempts` nhẹ cho analytics | thêm 1 loader parse | ✅ |

**Cụ thể:**
- **Nguồn:** bài tập viết **ngay trong file `.md` của bài**, dạng fenced block có schema (xem §7). Check-up đặt **ngay sau anchor của section nó kiểm**, `section_ref` = id của `<!-- anchor: id -->` đó (§7a). Bài chưa có anchor (57 bài) → tác giả **thêm 1 anchor lúc gắn check-up** — marker này **đồng thời** là đích cuộn hotlink (1 công đôi việc, giải AUDIT §6.4). End-test ở cuối file.
- **Loader:** mở rộng `grammar_content.py`. **⚠ Thứ tự BẮT BUỘC (sửa từ review):** phải **tách & XOÁ block `checkup`/`endtest` khỏi `body` TRƯỚC khi `md_proc.convert(body)`** (`grammar_content.py:186`). Nếu để nguyên, `markdown` fenced-code sẽ render YAML thô thành `<pre><code class="language-checkup">…</code></pre>` lộ ra cho user. Sau khi strip → parse YAML riêng → trả trong response `GET /api/grammar/article/{cat}/{slug}` dưới field `exercises{ per_section[], end_test[] }`. **0 bảng cho nội dung.**
- **Attempts (additive, analytics, optional):** bảng nhẹ `grammar_exercise_attempts` (fire-and-forget như vocab attempts) — chỉ để biết câu nào hay sai, **không** chặn render. Owner-scoped RLS.
- **Duyệt:** bài tập là markdown trong bài → **duyệt = review PR sửa bài** (workflow nội dung đã có), không cần admin UI mới. AI sinh draft → người sửa file → merge. (Thoả "admin-approve" mà không tạo curation tool — giảm tải AUDIT §6.1.)

## 2. Schema (additive — next migration **110**; PLAN vocab dùng **111** để TRÁNH ĐỤNG — sửa từ review)
```sql
-- 110_grammar_exercise_attempts.sql   (CHỈ analytics; nội dung ở markdown)
-- (Hai feature tách scope/PR riêng; grammar=110, vocab_cards=111. Đừng cùng đặt 110.)
CREATE TABLE IF NOT EXISTS grammar_exercise_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  grammar_slug TEXT NOT NULL,
  exercise_ref TEXT NOT NULL,        -- slug#<section_ref>#<item_id>  (NAMED ids, KHÔNG positional)
                                     -- section_ref = id marker tác giả viết; item_id = id tác giả gán mỗi câu
                                     -- ⇒ chèn/xoá section hay câu KHÔNG làm lệch attempts cũ (sửa từ review)
  scope        TEXT CHECK (scope IN ('checkup','end_test')),
  is_correct   BOOLEAN,
  chosen       TEXT,                 -- đáp án người chọn (index/sequence)
  error_tag    TEXT,                 -- tag của distractor đã chọn (nếu sai) → mỏ phân tích
  attempted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_gea_user ON grammar_exercise_attempts(user_id, grammar_slug);
-- RLS owner-scoped: USING/ WITH CHECK (auth.uid()=user_id). Không cột nào ở bảng cũ bị đụng.
```
*(Không tạo `grammar_exercises`/`grammar_practice_sessions`/`grammar_point_reviews` của engine cũ — đó là feature khác, để dành nếu sau này build remediation nói.)*

## 3. Dạng bài (phase 1 = an toàn auto-grade) + cấu trúc
**Tập an toàn (0 false-fail):** `mcq` (1 đáp đúng) · `error_id` (chọn span sai trong tập đóng) · `word_bank` (kéo token từ bank, exact-match all-or-nothing, **shuffle bank**) · `match` (ghép 2 cột đóng) · `order` (sắp xếp token). **Free-text** (`fill_typed`, `transform`) = chỉ "hiện đáp án mẫu" (no-score) ở phase 1.

**Cấu trúc (theo research):**
- **Check-up/section: 2–4 item**, feedback tức thời từng câu, untimed, low-stakes ("Kiểm tra nhanh"). 1 MCQ khái niệm + 1 error-ID (+1 word-bank nếu section về cấu trúc).
- **End-test/bài: 8–12 item**, **đa dạng dạng + interleave xuyên các section** (không gom theo thứ tự section), khó tăng dần. Hiện điểm + giải thích đầy đủ khi review.
- **Feedback mỗi câu:** (1) đúng/sai → (2) **VÌ SAO** (nêu luật + tên lỗi từ `error_tag`) → (3) **link tới section anchor** của bài → (4) **neo band descriptor** ("sửa lỗi trong câu phức = đòn bẩy 6→7 của GRA").
- **Thang độ khó (định nghĩa "khó tăng dần" cho end-test — sửa từ review):** intro = **recognition** (chọn dạng đúng) → core = **production-in-context** (điền/sắp xếp đúng dạng) → stretch = **discrimination under interference** (phân biệt khi có distractor L1 mạnh / 2 cấu trúc gần nhau). Gán mỗi item `difficulty: intro|core|stretch`; end-test xếp tăng dần.
- **Ôn lại (spacing — đừng over-build):** **không** dựng SRS. Chỉ tận dụng `grammar_exercise_attempts` để mở surface **"Làm lại câu đã sai"** ở lần đọc sau (retrieval cách quãng nhẹ). KHÔNG gắn nhãn "mastered".
- **Accessibility:** `word_bank`/`order` (kéo-thả) phải có **fallback bàn phím (click-to-place)** + ARIA; không để keyboard/screen-reader bị kẹt.
- **⚠ Bar duyệt answer-key = 100%:** mọi item auto-grade phải verify **đúng-đúng-1-đáp-án + mọi distractor thật sự sai** (không spot-check phần đáp án); chỉ `why` prose được duyệt nhẹ theo lô (AUDIT §6.1).

## 4. Hotlink — nâng độ phủ (không build lại; xem AUDIT §5)
- **Backfill `anchors:`** cho 57 bài chưa có (content-work) → check-up addressable + hotlink cuộn đúng section.
- **Sửa telemetry** `grading.py` (~5 dòng, re-write `feedback` blob sau khi gắn `rec_id`) → đo được anchor-hit forward.
- **Nâng `feedback-anchor-mapping.yaml`** thủ công cho top error-tag thay vì hạ threshold 0.20 mù.
- **Mở rộng drift-check:** thêm test exercise↔section (mỗi `exercise_ref` còn trỏ section tồn tại trong bài) — chống orphan khi sửa bài (AUDIT §6.3).

## 5. UI (bám trang đã có)
- `grammar-article.html`: sau mỗi section render khối **"Kiểm tra nhanh"** (2–4 câu, chấm client-side cho tập đóng, hiện feedback + link anchor). Cuối bài: nút **"Làm bài test cuối bài"** → modal/section 8–12 câu.
- Reuse component chấm-client-side đã có **`frontend/js/vocab-modules/exercises.js` / `d1-exercise.js`** (local-grading MCQ/fill) + telemetry beacon. *(Xác minh component này expose widget MCQ tái dùng trước khi giả định "0 component mới".)* Chấm tập-đóng **client-side** (instant, 0 round-trip); chỉ POST `grammar_exercise_attempts` fire-and-forget để analytics.
- Trong `result.html` (đã có rec hotlink): có thể thêm "Ôn lại điểm này" trỏ tới bài + #anchor (đã có) — **không** cần engine.

## 6. Lộ trình (phân tầng — giải tải tác-quyền AUDIT §6.1)
| Phase | Việc | Vì sao trước |
|---|---|---|
| **P1** | **Pilot 3–5 bài 6→7 đã-có-anchor** (relative clauses, conditionals, complex sentence): viết tay khuôn §7 + render check-up + end-test sau flag; **reconcile bài tập in-prose cũ** (chuyển hoá, xoá bản prose trùng — AUDIT §4#1) | Nghiệm thu khuôn + UX + chất lượng distractor + xử lý in-prose trên tập nhỏ trước khi nhân rộng |
| **P1** | Loader parse block + migration 110 attempts + drift-check | Hạ tầng phục vụ, additive |
| **P2** | **Backfill `anchors:` 57 bài** + sửa telemetry | Nâng độ phủ hotlink + đo được |
| **P2** | **Gen theo lô** (Gemini như `d1_content_gen`) cho **top error-tag/6→7 trước**, người spot-check theo lô → merge vào markdown | Nhân nội dung có kiểm soát, không duyệt từng câu |
| **P3** | Mở rộng toàn bộ 98 bài; thêm `fill_typed`/`transform` (self-check no-score, hoặc Claude grader sau value-check) | Sau khi pilot chứng minh hoàn thành + chất lượng |

**Gate nhẹ (đúng tinh thần measure-first KHÔNG lạm dụng):** sau pilot P1, xem **completion check-up + tỉ lệ bỏ giữa chừng** trên vài bài; tốt → nhân rộng; không cần cửa sổ telemetry 3 tuần trước khi viết câu hỏi.

## 7. KHUÔN MD — block bài tập nhúng trong bài (copy cho content agent)
> Đặt block `checkup` **ngay sau section nó kiểm**; block `endtest` ở **cuối file**. Loader parse các block này.

### 7a · Quy ước định danh & error-tag (sửa từ review — bắt buộc đọc)
- **`section_ref` = id trong marker `<!-- anchor: <slug>.<section-id> -->`** của repo (KHÔNG bịa marker `section:` mới — `grammar_content.py` chỉ nhận `anchor:` `<!-- ... -->`). Đặt check-up **ngay dưới** anchor và `section_ref` **trùng** id đó. ⇒ **1 marker phục vụ CẢ HAI:** điểm neo check-up **và** đích cuộn hotlink. Bài chưa có anchor → tác giả **thêm `<!-- anchor: id -->` + cùng id vào frontmatter `anchors:`** lúc gắn check-up (rẻ, co-located, đồng thời nâng độ phủ hotlink §4). `section_ref` là **id có tên, ổn định**, KHÔNG phải số thứ tự.
- **`id` mỗi item** = chuỗi ngắn ổn định tác giả gán (vd `q1`, `tps-drop`). Attempts khoá theo `exercise_ref = <slug>#<section_ref>#<id>` → chèn/xoá câu **không lệch** dữ liệu cũ.
- **`error_tag`/`distractor_tags` lấy từ DANH SÁCH CHUẨN dưới đây, KHÔNG lấy trực tiếp từ `common_error_tags` frontmatter** (đã đo: tag frontmatter **sạch nhưng THƯA** — 27 tag, 26/98 bài 0 tag, chưa đủ phủ distractor — AUDIT nội dung §4). Danh sách chuẩn khởi đầu (mở rộng dần, 1 file `error_tags.yaml`):
  `SVA_THIRD_PERSON_S_DROP` · `AUX_DO_AGREEMENT` · `TENSE_CONTINUOUS_FOR_FACT` · `L1_TENSE_IN_CONDITIONAL` · `ARTICLE_OMISSION` · `ARTICLE_A_VS_AN` · `PREP_WRONG` · `WORD_ORDER_ADV` · `RELATIVE_PRONOUN_WRONG` · `BARE_ING` · `WRONG_PARTICIPLE` · `PLURAL_AGREEMENT`. *(Frontmatter `common_error_tags` SẠCH nhưng **thưa/chưa đủ phủ** distractor — 26/98 bài 0 tag — nên dùng list chuẩn; KHÔNG phải vì "rác".)*

````markdown
<!-- anchor: present-simple.common-mistake.third-person-s-drop -->
## Ngôi thứ ba số ít thêm -s
...nội dung section...

```checkup
section_ref: present-simple.common-mistake.third-person-s-drop   # = id của <!-- anchor: --> ngay trên (cũng là đích hotlink)
items:
  - id: q1
    type: mcq
    q: "Choose the correct form: 'She ___ to work by bus.'"
    options: ["go", "goes", "going", "gone"]
    answer: 1                                  # index đáp đúng trong options
    difficulty: intro
    distractor_tags: {0: SVA_THIRD_PERSON_S_DROP, 2: BARE_ING, 3: WRONG_PARTICIPLE}
    why: "Chủ ngữ ngôi 3 số ít (she) → động từ thêm -s: 'goes'."
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "My brother [work] in a bank and [lives] in Hanoi."
    spans: ["work", "lives"]
    answer: 0                                  # index TRONG spans[] (không phải vị trí trong câu)
    difficulty: core
    error_tag: SVA_THIRD_PERSON_S_DROP
    why: "'My brother' là ngôi 3 số ít → 'works'."
```
````

````markdown
```endtest
title: "Test cuối bài — Present Simple"
shuffle: true
items:                       # 8–12 câu, interleave xuyên section, đa dạng dạng
  - type: mcq            ...
  - type: word_bank
    q: "Sắp xếp thành câu đúng."
    bank: ["She", "doesn't", "like", "coffee", "don't"]   # có distractor token 'don't'
    answer_seq: ["She", "doesn't", "like", "coffee"]
    error_tag: AUX_DO_AGREEMENT
    why: "Ngôi 3 số ít phủ định dùng 'doesn't', không 'don't'."
  - type: match
    q: "Ghép thì với cách dùng."
    left: ["thói quen", "sự thật hiển nhiên"]
    right: ["The sun rises in the east.", "I go to the gym on Mondays."]
    answer: {0: 1, 1: 0}
  - type: order  ...
```
````

**Quy ước:** `answer` = index (mcq/error_id) hoặc map/sequence (match/order/word_bank) → **so khớp tuyệt đối, 0 false-fail**. Mọi `type` ngoài tập an toàn ⇒ render "self-check, hiện đáp án", không tính điểm.

## 8. BÀI MẪU — bộ bài tập thật cho 1 bài có sẵn (`tenses/present-simple`)
> Mẫu để nghiệm thu khuôn. `section_ref` dùng **anchor thật của bài** (`present-simple.structure.affirmative`, `present-simple.common-mistake.third-person-s-drop`...). Distractor từ **danh sách error-tag chuẩn §7a**, là lỗi thật (drop -s ngôi 3, 'don't' cho ngôi 3...).
> **⚠ Reconcile (sửa từ review):** bài `present-simple.md` **đã có mục "Bài tập luyện / Đáp án" in-prose**. Khi gắn bộ mẫu này → **chuyển hoá** phần in-prose đó thành block `checkup`/`endtest` (xoá bản prose cũ), tránh 2 bộ bài tập song song lệch nhau.

**Check-up sau section "Cấu trúc khẳng định" (3 câu):**
1. `mcq` — "He ___ English every day." → [work / **works** / working / worked]; distractor 0 = `SVA_THIRD_PERSON_S_DROP`. *Why:* he → works.
2. `error_id` — "She [don't] [like] tea." spans=[don't,like] answer=0 tag=`AUX_DO_AGREEMENT`. *Why:* she → doesn't.
3. `word_bank` — bank=[Tom, watches, watch, TV, every, evening] → "Tom watches TV every evening" (distractor token 'watch'). tag=`SVA_THIRD_PERSON_S_DROP`.

**Check-up sau section "Dấu hiệu nhận biết / trạng từ tần suất" (2 câu):**
4. `match` — ghép trạng từ tần suất ↔ vị trí ("always" ↔ trước động từ thường; "every day" ↔ cuối câu).
5. `mcq` — "Choose the correct sentence." → ["He **usually** drinks coffee." ✓ / "He drinks usually coffee." / "Usually he drink coffee." / "He drink usually coffee."]; answer=0; distractor 1=`WORD_ORDER_ADV`, 2&3=`SVA_THIRD_PERSON_S_DROP`. *Why:* trạng từ tần suất đứng trước động từ thường + ngôi 3 số ít "drinks". *(Đáp án duy nhất, distractor đều là lỗi thật, đúng phạm vi bài.)*

**End-test (10 câu, interleaved, shuffle):** 4 `mcq` (SVA, do/does, trạng từ tần suất, sự thật hiển nhiên) + 2 `error_id` (drop -s; 'don't' ngôi 3) + 2 `word_bank` (câu khẳng định + phủ định) + 1 `match` (thì↔cách dùng) + 1 `order` (câu hỏi Wh-). Mỗi câu có `why` + link `#present-simple.<section>` + dòng band: *"Chính xác ngôi 3 số ít là 'basic error' band 7 hay bị trừ — sửa được là nâng GRA."*

*(Bộ mẫu đầy đủ ở dạng khuôn §7 sẵn sàng cho agent điền các bài còn lại.)*

## 9. Rủi ro & chốt
1. **Tác quyền quy mô** → phân tầng P1→P3, gen-theo-lô + spot-check, ưu tiên 6→7 + bài đã-anchor. 
2. **Drift bài↔bài-tập** → co-located markdown + drift-check `exercise_ref↔section`.
3. **57 bài thiếu anchor** → check-up gắn theo **vị trí** (chạy ngay); backfill anchor cho hotlink ở P2.
4. **False-fail** → chỉ tập đóng tự-chấm; free-text no-score.
5. **Distractor rởm** → bắt buộc `error_tag` + người spot-check "đúng 1 đáp án".
6. **Tách scope với vocab** (AUDIT §6.6) — đây là PR/flag riêng `GRAMMAR_CHECKUP_ENABLED`.

---

*Bám hạ tầng: `grammar_content.py` loader, frontmatter `common_error_tags`/`anchors`, component MCQ vocab, hotlink đã có. Quyết định kiến trúc rõ (hybrid co-located). Migration next = 110. Khuôn §7 + mẫu §8 sẵn cho content agent.*

---

## A.2 ▸ Work-items PM (E0–E5, C0–C3, gate, risk)
*(nhúng nguyên văn — `PLAN_PM_grammar_checkup_build_2026-06-20.md`)*

> ⚠ **ĐỌC `STRATEGY_prioritization_2026-06-20.md` TRƯỚC.** Bộ work-item dưới đây trộn 2 thứ phải tách: **PLAN A = sửa cái đã hỏng (E0 verify-script + 16 marker hotlink + E5 telemetry, ~1 tuần, ship NGAY, không cần content owner)** vs **PLAN B = content epic đầu cơ (C3-scale 93 bài, FREEZE tới khi pilot cho tín hiệu NÓI + cầu)**. Ship PLAN A độc lập; gate PLAN B.

# Kế hoạch PM-ready — Build Grammar Check-up (bài tập nhúng trong Wiki)
**IELTS Speaking Coach · 2026-06-20 · giao cho PM agent điều phối · repo intact đến khi PM khởi động từng WI**

**Nguồn:** `PLAN_grammar_wiki_exercises_2026-06-20.md` (kiến trúc) + `AUDIT_grammar_content_98_2026-06-20.md` (content-prep, số liệu đo thật). Bản này **hành-động-hoá** thành Work Item (WI) có prompt giao implementer + acceptance + gate.

---

## 0. Cho PM agent — đọc trước

**Mục tiêu:** mỗi bài Grammar Wiki có **check-up sau mỗi section** + **test cuối bài** (đa dạng, auto-grade an toàn), và **hotlink Speaking→grammar cuộn đúng section**. KHÔNG phải engine cá-nhân-hoá lỗi-nói (feature khác — xem AUDIT_vocab_grammar §3).

**Guardrails bắt buộc (mọi WI):**
1. **Đọc `CLAUDE.md`** trước khi sửa file (routing, contract BE/FE, "false-positive grammar flags harm user trust" = vạch chất lượng #1).
2. **1 issue = 1 PR**, scoped, có test. Không trộn refactor.
3. **Additive + reversible:** migration chỉ thêm bảng/cột (`IF NOT EXISTS`); tính năng sau **feature flag**.
4. **Migration mới = số kế tiếp**: cao nhất hiện tại **109** → **grammar dùng 110** (vocab_cards dùng 111, tách PR). KHÔNG sửa migration cũ.
5. **Auto-grade CHỈ answer-space đóng** (mcq/error_id/word_bank/match/order, so khớp index/sequence). Free-text → self-check no-score. **Cấm** đánh-rớt-câu-đúng.
6. **Không hardcode `http://localhost:8000`** — dùng `window.api.base`. Supabase qua `getSupabase()`.
7. **2 TRACK song song:** **Engineering (E)** = hạ tầng render/grade; **Content (C)** = chuẩn bị bài (audit §7). Check-up chỉ hiện ở bài đã xong content cho bài đó.
8. **`section_ref` LUÔN là named anchor id** (= id marker `<!-- anchor: -->`), KHÔNG positional. Điều này **GHI ĐÈ** "fallback theo vị trí" ở PLAN_grammar §risk-3 — vì check-up bị gate sau backfill anchor (C1/C2), nên luôn có id thật để chèn + để hotlink cuộn. Không dùng injection theo vị trí.
9. **Migration hygiene:** trước khi áp, `ls backend/migrations | sort` kiểm KHÔNG trùng số (repo có artifact `086 2.sql`/`087 2.sql` — đừng nhân thêm). Grammar=**110**, vocab_cards=**111**.

**Cách dùng:** mỗi WI có *Mục tiêu · Vì sao · File · Prompt giao implementer (copy-paste) · Acceptance (DoD) · Verify · Effort · Phụ thuộc · Flag/Rollback · Gate*.

**Dependency tổng:**
```
E0 (fix verify_anchor_drift) ── CI gate "anchor done" (để VERIFY C1/C2)
C0 (error_tags.yaml) ──► C2, C3 (distractor)
E1 (loader strip+parse+contract) ──► E3a (spike) ──► E3 (FE render+grade) ──┐
E2 (migration+attempts) ── soft ──────────────────────────────────────────┤
                                                                            ├─► E4 (flag+pilot+telemetry)
C1 (16 marker + de-dup 4) ──► C3-pilot (3–5 bài) ──────────────────────────┘
                                        │
                        [PILOT GATE: completion≥50%(completed/started) + 0 false-fail + hotlink 100%]
                                        ▼
            C2 (anchor còn lại + tag 26) ──► C3-scale (93 bài, ~80% chi phí, owner content)
E5 (fix telemetry rec_id) ── song song, độc lập (instruments click-through hotlink → tín hiệu gate)
```

---

## 1. Bảng Work Items
| WI | Track | Tên | Effort | Phụ thuộc | Rủi ro |
|----|-------|-----|--------|-----------|--------|
| **E0** | Eng/CI | Sửa `verify_anchor_drift.py` canh đúng invariant | ~0.5 ngày | — | thấp |
| **E1** | Eng | Loader: strip block TRƯỚC render + parse → article API (+ hợp đồng chèn) | ~2–2.5 ngày | — | trung bình |
| **E2** | Eng | Migration 110 + `grammar_exercise_attempts` API (fire-and-forget) | ~1 ngày | — | thấp |
| **E3a** | Eng/FE | **Spike (½ ngày): xác minh widget tái dùng** (MCQ từ `d1-exercise.js`?) trước khi ước lượng E3 | ~0.5 ngày | E1 | thấp |
| **E3** | Eng/FE | Render check-up + end-test + chấm client-side + feedback + a11y. **4/5 type (word_bank/order/match/error_id) là NET-NEW** | **~5–6 ngày** | E1, E3a, (soft E2) | cao |
| **E4** | Eng | Feature flag + pilot wiring + telemetry (định nghĩa completion ratio) | ~1 ngày | E1,E2,E3,C3-pilot | thấp |
| **E5** | Eng | Fix telemetry `rec_id` (đo **click-through** hotlink — tín hiệu cho gate) | ~0.5 ngày | — | thấp |
| **C0** | Content | **Tạo `error_tags.yaml`** (list chuẩn — chặn C2/C3 distractor) | ~0.5 ngày | — | thấp |
| **C1** | Content | Backfill 16 marker hotlink hỏng + de-dup 4 bài merge | ~2–3 ngày | (E0 để *verify*) | trung bình |
| **C2** | Content | Backfill anchor còn lại + tag 26 bài | ~3–5 ngày | E0(verify), C0 | thấp |
| **C3-pilot** | Content | Migrate in-prose + soạn item cho **3–5 bài pilot** (TRƯỚC gate) | ~2–3 ngày | E1, C1, C0 | trung bình |
| **C3-scale** | Content | Migrate in-prose → block cho **~93–95 bài còn lại** (98 − pilot) (cuốn chiếu) | **EPIC ~6–10 content-week** (xem §4) | C2, **PILOT GATE** | cao |

> **⚠ C3-scale là ~80% chi phí dự án** (≈300–500 check-up + 98 end-test). KHÔNG phải hạng mục eng — cần **owner content riêng** (STAFFING TBD = blocking). Eng track (E0–E5) chỉ ~9–11 ngày.
> **Timeline PM:** E0–E2 + C0 chạy ngay (independent). E3a→E3 sau E1. **Pilot** = E4 + C1 + C3-pilot trên **3–5 bài 6→7** → **PILOT GATE** → mới **C3-scale**. E5 độc lập.

---

## 2. Chi tiết Work Items

### WI-E0 · Sửa `verify_anchor_drift.py` (canh đúng invariant) — CI gate
**Mục tiêu:** CI bắt được anchor "khai báo mà thiếu marker body" (hiện 119 cái lọt, gồm 16 đích hotlink).
**Vì sao:** `verify_anchor_drift.py` chỉ kiểm `target_anchor ∈ frontmatter anchors:` (`collect_declared_anchors` đọc `fm.get("anchors")`; `main` `if target in declared`) — **không bao giờ đọc body**; mà đích cuộn thật là marker body `<!-- anchor: id -->` (`grammar_content.py:190`). ⇒ test pass dù 16/61 hotlink không cuộn.
**File:** `backend/scripts/verify_anchor_drift.py` + `backend/tests/test_anchor_drift.py`.
**Prompt giao implementer:**
> Đọc `CLAUDE.md`, `backend/scripts/verify_anchor_drift.py`, `backend/services/grammar_content.py` (regex `_ANCHOR_MARKER_RE` ~:35, render `<a id>` ~:190, expose anchors ~:233). Bug: script chỉ verify `target_anchor ∈ frontmatter anchors:`, không kiểm marker body. Thêm 3 kiểm: (1) **mọi anchor khai trong frontmatter `anchors:` phải có `<!-- anchor: id -->` tương ứng trong body cùng file**; (2) **mọi `target_anchor` trong `feedback-anchor-mapping.yaml` phải có marker body** (đây là đích cuộn thật); (3) cảnh báo **drift ngược** (marker body không khai frontmatter) + **`location:` khớp 1 heading thật**. In report rõ từng vi phạm; exit≠0 nếu có vi phạm loại (1)/(2). KHÔNG sửa nội dung bài. Cập nhật `test_anchor_drift.py` assert script mới fail trên fixture có anchor-thiếu-marker và pass khi đủ. 1 PR.
**Acceptance (DoD):** chạy script trên repo hiện tại → **liệt kê đúng 16 đích hotlink hỏng + 119 anchor thiếu marker + ≥1 `location:` lệch heading** (vd present-simple `location` trỏ heading không tồn tại) + drift-ngược; test mới đỏ trước khi C1 sửa, xanh sau; CI wired. *(Cả 3 kiểm phải có trong DoD, không bỏ sót location.)*
**Verify:** `python backend/scripts/verify_anchor_drift.py` in ra ≥16 vi phạm loại (2); `pytest backend/tests/test_anchor_drift.py`.
**Effort:** ~0.5 ngày. **Phụ thuộc:** —. **Flag:** không (tooling). **Rollback:** revert PR.
**Gate:** xong E0 mới tin "anchor done" ở C1/C2.

---

### WI-E1 · Loader: strip block TRƯỚC render + parse → article API
**Mục tiêu:** đọc block ```` ```checkup ```` / ```` ```endtest ```` trong bài, **xoá khỏi body trước khi render**, trả trong response article dưới `exercises{ per_section[], end_test[] }`.
**Vì sao (⚠ then chốt):** `grammar_content.py:186` `md_proc.convert(body)` với `fenced_code` extension → nếu KHÔNG strip, block YAML render thành `<pre><code class="language-checkup">…</code></pre>` **lộ YAML thô cho user**. Phải tách+xoá block **trước** dòng 186.
**File:** `backend/services/grammar_content.py` (`_parse_file` ~:104–190, build dict ~:230), `backend/routers/grammar.py` (article endpoint), test mới.
**Prompt giao implementer:**
> Đọc `CLAUDE.md`, `grammar_content.py` (`_parse_file`: split frontmatter ~:108, `html = md_proc.convert(body)` ~:186, dict build ~:226 — **trường render là `html`, KHÔNG phải `body_html`**; FE đọc `article.html` ở `grammar.js:708`). Thêm: TRƯỚC `md_proc.convert(body)`, **trích và XOÁ** mọi block check-up/end-test. **⚠ DÙNG FENCE 4-BACKTICK cho block (` ````checkup ` / ` ````endtest `), KHÔNG 3-backtick (sửa từ gauntlet):** vì `why`/`q` của item có thể chứa ` ``` ` (ví dụ code/câu mẫu) → fence 3-backtick sẽ bị cắt giữa chừng và rò YAML ra HTML. Fence 4-backtick bọc an toàn mọi nội dung 3-backtick bên trong. Regex khoá theo info-string: `^````(checkup|endtest)\b ... ^````$` (multiline, non-greedy, per-block). Corpus có hàng trăm fence-3-backtick thường (~405 block) — fence 4-backtick KHÔNG đụng chúng. *(Tốt nhất: trích fenced token từ AST markdown thay vì regex thuần; nếu regex thì phải có test ` ``` ` trong `why`.)* Parse YAML từng block (`yaml.safe_load`). Validate nhẹ: type ∈ {mcq,error_id,word_bank,match,order,fill_typed,transform}; mỗi item có `id`+`answer`/`answer_seq`; block hỏng → **bỏ qua + log warning, KHÔNG crash**. Gắn `exercises = {"per_section":[{section_ref, items[]}...], "end_test":{...}}` vào dict article, expose ở `GET /api/grammar/article/{category}/{slug}` (additive, consumer cũ bỏ qua key lạ — an toàn). **HỢP ĐỒNG CHÈN (bắt buộc cho E3):** mỗi `section_ref` PHẢI ứng với 1 marker body `<!-- anchor: id -->` đã render thành `<a id>` (E0 enforce); loader trả thêm `per_section[].anchor_present: bool` để FE biết chèn được. 1 PR + test: (a) **`html` KHÔNG chứa** `checkup`/`section_ref`; (b) code block 3-backtick kề (vd ```bash) KHÔNG bị nuốt; (c) block hỏng → skipped+warning, article vẫn render; (d) `exercises` shape đúng; (e) bài không-block → `exercises` rỗng; (f) **block có `why:` chứa ` ``` ` bên trong → KHÔNG truncate, YAML không rò ra `html`** (đây là test bắt buộc cho fence 4-backtick).
**Acceptance (DoD):** bài có block → API trả `exercises` + `anchor_present`; **`html` sạch YAML**; regex không nuốt fence thường; bài hỏng-block không vỡ; bài không-block `exercises` rỗng.
**Verify:** fixture bài có 1 checkup + 1 endtest + 1 ```bash block → GET article → JSON `exercises.per_section[0].items` đúng, `html` không chứa "section_ref", ```bash còn nguyên.
**Effort:** ~2–2.5 ngày. **Phụ thuộc:** —. **Flag:** không cần (chỉ thêm field; FE chưa dùng tới khi E3). **Rollback:** revert PR.

---

### WI-E2 · Migration 110 + attempts API (analytics, fire-and-forget)
**Mục tiêu:** ghi nhận lượt làm (đúng/sai, lỗi chọn) để phân tích câu hay sai — KHÔNG chặn render.
**File:** `backend/migrations/110_grammar_exercise_attempts.sql`, `backend/routers/grammar.py` (hoặc router mới), test.
**Schema (đúng PLAN grammar §2):**
```sql
-- 110_grammar_exercise_attempts.sql
CREATE TABLE IF NOT EXISTS grammar_exercise_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  grammar_slug TEXT NOT NULL,
  exercise_ref TEXT NOT NULL,          -- slug#<section_ref>#<item_id> (NAMED, không positional)
  scope TEXT CHECK (scope IN ('checkup','end_test')),
  -- ⚠ section_ref có thể chứa dấu '.' (vd present-simple.structure.affirmative); parser exercise_ref phải split theo '#', KHÔNG split '.'
  is_correct BOOLEAN, chosen TEXT, error_tag TEXT,
  attempted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_gea_user ON grammar_exercise_attempts(user_id, grammar_slug);
ALTER TABLE grammar_exercise_attempts ENABLE ROW LEVEL SECURITY;
-- owner-scoped: SELECT/INSERT USING/WITH CHECK (auth.uid() = user_id)
```
**Prompt giao implementer:**
> Tạo migration `110_grammar_exercise_attempts.sql` (DDL trên, RLS owner-scoped `WITH CHECK auth.uid()=user_id`, precedent 019/021). Thêm `POST /api/grammar/practice/attempt` (auth) ghi 1 attempt; **fire-and-forget** (trả 204 kể cả insert fail, log). **⚠ Router grammar ghi qua `supabase_admin` (service-role) BYPASS RLS** (`grammar.py:23` etc.) → endpoint **PHẢI set `user_id` từ token `get_supabase_user`** (RLS chỉ là defense-in-depth, không tự bảo vệ). KHÔNG đọc bảng này ở đường render. 1 PR + test. **⚠ Test RLS (sửa từ gauntlet):** backend hiện CHỈ có `supabase_admin` (service-role, bypass RLS) — không có client user-JWT sẵn. Nếu test chạy qua `supabase_admin` thì assertion "RLS chặn user khác" **vacuously true** (vô nghĩa). ⇒ **đổi assertion load-bearing thành: "endpoint LẤY `user_id` từ token đã verify (`get_supabase_user`), BỎ QUA `user_id` client gửi lên"** (chống spoofing) — đây mới là cái thật sự bảo vệ. RLS giữ làm defense-in-depth. (Nếu muốn test RLS thật thì phải dựng fixture client anon/user-scoped — ghi rõ là infra thêm, không phải "1 PR".)
**Acceptance:** bảng tồn tại; POST attempt ghi `user_id` từ JWT (không tin client gửi lên); fail-soft; RLS verify qua client user-scoped.
**Verify:** seed 1 attempt qua user-JWT → query thấy row đúng owner; client user khác đọc → RLS chặn (test KHÔNG dùng service-role).
**Effort:** ~1 ngày. **Phụ thuộc:** —. **Flag:** `GRAMMAR_CHECKUP_ENABLED` (chung E4). **Rollback:** revert; bảng thừa vô hại.

---

### WI-E3a · Spike (½ ngày) — xác minh widget tái dùng TRƯỚC khi ước lượng E3
**Mục tiêu:** chốt thật phần nào reuse được, phần nào net-new (PLAN_grammar §5 đã hedge — đừng giả định "0 component mới").
**Prompt:** Mở `frontend/js/d1-exercise.js` + `frontend/js/vocab-modules/exercises.js`. Xác nhận: `exercises.js` là **module mount trang** (không phải grader), `d1-exercise.js` **chỉ chấm MCQ bằng so chuỗi** (không theo index, không có word_bank/order/match/error_id). Báo cáo: MCQ có adapt được sang so-index không; 4 type còn lại = net-new. **Output:** ước lượng E3 chốt + danh sách component phải tự viết.
**Effort:** ~0.5 ngày. **Phụ thuộc:** E1.

### WI-E3 · Frontend: render + chấm client-side + feedback + accessibility
**Mục tiêu:** sau mỗi section hiện "Kiểm tra nhanh" (2–4 câu); cuối bài "Làm bài test cuối bài" (8–12 câu); chấm tập-đóng **client-side** (instant); feedback đúng/sai + VÌ SAO + link `#anchor` + dòng band; POST attempt analytics.
**File:** `frontend/pages/grammar-article.html`, module mới `frontend/js/grammar-checkup.js`. **Reuse có giới hạn:** chỉ pattern *local-grade + fire-and-forget + reveal-correct* (từ `d1-exercise.js`); **MCQ adapt từ `d1-exercise.js` (đổi so-chuỗi → so-index)**; **word_bank/order/match/error_id = NET-NEW** (gồm widget kéo-thả keyboard-accessible).
**Prompt giao implementer:**
> *(Sau E3a.)* Đọc `CLAUDE.md`, `grammar-article.html`, `grammar.js` (`_scrollToHashAnchor`, `bodyEl.innerHTML = article.html` ~:708). Dùng `exercises` + `anchor_present` từ API (E1). **HỢP ĐỒNG CHÈN (vì body là 1 khối HTML phẳng, anchor chỉ là `<a id>` rỗng trước heading, KHÔNG có wrapper/đóng-section):** với mỗi `per_section[]`, tìm `document.getElementById(section_ref)`; chèn khối "Kiểm tra nhanh" theo **HỢP ĐỒNG HEADING-BASED (primary, sửa từ gauntlet):** `el = getElementById(section_ref)` (là `<a id class="grammar-anchor">` rỗng ngay trước heading section đó) → lấy **heading liền sau** `el` (`el.nextElementSibling` là `<h2>`/`<h3>` — đúng pattern `_pulseAnchorHeading` grammar.js:611) → **đi tới các sibling kế tiếp tới khi gặp heading CÙNG-HOẶC-CAO-HƠN cấp** (h3-anchor dừng ở h3/h2 kế; h2-anchor dừng ở h2 kế) → chèn check-up TRƯỚC ranh giới đó. **KHÔNG dùng "`.grammar-anchor` kế tiếp" làm ranh giới** — vì 119/260 section thiếu marker (E0/AUDIT §2), anchor kế tiếp có thể cách hàng trăm dòng và nuốt nhiều section. Heading mới là ranh giới đáng tin. Nếu `anchor_present=false` → KHÔNG chèn (skip, log). **Lưu ý sequencing:** E3 chỉ demo được trên bài đã có ĐỦ marker → pilot phải chọn bài đã backfill (C1) hoặc bài sẵn-anchor-đủ (articles/article-errors), KHÔNG phải present-simple (chỉ 2 marker). `end_test` render cuối `#article-body`. **Chấm CLIENT-SIDE** mcq/error_id/word_bank/match/order (so index/sequence tuyệt đối — 0 round-trip, 0 false-fail); `fill_typed`/`transform` → "Xem đáp án mẫu" (no-score). Feedback: đúng/sai → `why` → link `#<section_ref>` → dòng band. POST `/api/grammar/practice/attempt` fire-and-forget (KHÔNG await; **degrade gracefully nếu E2 chưa deploy** → nuốt 404). **A11y bar:** word_bank/order thao tác **bàn phím (Tab + Enter/Space chọn ô, click-to-place)** + ARIA `role`/`aria-grabbed`; test bằng keyboard-only + screen-reader smoke. Reuse `window.api`, không hardcode base. Cờ `GRAMMAR_CHECKUP_ENABLED`. 1 PR (hoặc tách theo type) + test render/grade mỗi type (đặc biệt: distractor token word_bank không làm sai đáp đúng; chèn đúng ranh giới section).
**Acceptance:** mỗi type render+chấm đúng; **0 câu đúng bị chấm sai**; chèn đúng ngay sau section của `section_ref` (không lệch section); `anchor_present=false` → không chèn; feedback có why+anchor-link+band; **keyboard-only dùng được**; free-text không tính điểm.
**Verify:** bài pilot có block → làm đủ 5 type bằng **chuột và bàn phím** → đúng/sai chuẩn, khối nằm đúng section, link cuộn đúng, attempt POST trong Network.
**Effort:** **~5–6 ngày** (4 widget net-new + a11y + test/type; chốt lại sau E3a). **Phụ thuộc:** E1, E3a; **soft** E2. **Flag:** `GRAMMAR_CHECKUP_ENABLED=false`. **Rollback:** tắt cờ.

---

### WI-E4 · Feature flag + pilot wiring + telemetry
**Mục tiêu:** bật check-up **chỉ** ở bài đã có `exercises` + đã xong content (C1/C3 cho bài đó); đo completion/bỏ-giữa-chừng để GATE.
**File:** `backend/config.py`/`settings.py` (cờ), `grammar-article.html` (render có điều kiện), `analytics-beacon.js` (event).
**Prompt giao implementer:**
> Thêm cờ `GRAMMAR_CHECKUP_ENABLED` (env) **+ denylist per-slug** `GRAMMAR_CHECKUP_DENY` (env/bảng nhỏ) để **ẩn check-up 1 bài** mà không tắt toàn site (kill-switch rủi ro #9). FE: chỉ render khi cờ bật **VÀ** slug không trong denylist **VÀ** `exercises` không rỗng (bài chưa migrate → rỗng → không hiện gì). Telemetry (reuse `analytics-beacon.js`), **định nghĩa rõ để tính gate**: `checkup_started` (user thấy + tương tác câu đầu), `checkup_completed` (làm hết câu trong block) — completion = completed/started; tương tự `endtest_*`; kèm `grammar_slug`, `scope`. 1 PR.
**Acceptance:** bài chưa-migrate không hiện dù cờ bật; bài trong denylist bị ẩn dù có `exercises`; bài pilot hiện; event started/completed ghi đủ + phân biệt được.
**Verify:** bật cờ → bài pilot có khối, bài khác không; query analytics thấy completion events.
**Effort:** ~1 ngày. **Phụ thuộc:** E1,E2,E3. **Gate → [PILOT GATE]:** xem §3.

---

### WI-E5 · Fix telemetry `rec_id` (đo hotlink click) — độc lập
**Mục tiêu:** `was_clicked` ghi đúng khi user bấm hotlink trên trang result lúc reload → biết hotlink có được dùng không.
**Vì sao thuộc dự án NÀY (không phải scope creep):** mục tiêu dự án gồm "sửa hotlink Speaking→grammar". E0/C1 sửa **cuộn** (scroll), E5 sửa **đo click-through** — nửa còn lại của câu chuyện hotlink. Không có E5, tín hiệu "hotlink có được dùng" ở PILOT GATE bị mù. Độc lập, 0.5d, forward-only.
**Vì sao:** `grading.py:506` serialize `feedback` TRƯỚC khi `_save_grammar_recommendations` gắn `rec_id` (~:576–582) → blob lưu thiếu `rec_id` → `result.html:481`/`practice.js:1065` bail (`if(!rec||!rec.rec_id)return''`) → click không bắn khi reload.
**File:** `backend/routers/grading.py`.
**Prompt giao implementer:**
> Đọc `grading.py`. **Cách ưu tiên (sửa từ gauntlet): pre-generate `rec_id` (UUID) cho mỗi grammar_recommendation TRƯỚC khi serialize `feedback`** — vì blob `feedback` được ghi *trong* bước persist `_upsert_response` (~:506), enrich rec_id chạy sau (~:580) cần `response_id` mới có. Sinh UUID sớm → lần serialize đầu đã có `rec_id`, KHÔNG cần ghi DB lần 2. *(Lưu ý mechanic: `_save_grammar_recommendations` phải **INSERT `id` pre-mint tường minh** — không dựa `gen_random_uuid()` default rồi đọc lại ở ~:786.)* *(Nếu buộc dùng cách re-write blob sau :582 thì đó là 1 UPDATE THỨ HAI lên `responses` — phải xử lý lỗi: nếu UPDATE-2 fail, row có điểm nhưng feedback cũ; ghi rõ fallback.)* KHÔNG đổi shape response tức thời. KHÔNG backfill dữ liệu cũ (đo forward-only). Test (tách serialize thành chỗ test được): blob ghi xuống chứa `rec_id` mỗi rec. 1 PR.
**Acceptance:** reload result.html → bấm rec → PATCH `/clicked` bắn; blob `feedback` chứa `rec_id`.
**Verify:** grade 1 response → reload → DevTools thấy PATCH `/clicked`.
**Effort:** ~0.5 ngày. **Phụ thuộc:** —. **Flag:** không (bug-fix). **Rollback:** revert.

---

### WI-C0…C3 · Track Content (⚠ ~80% chi phí dự án — cần OWNER CONTENT riêng, STAFFING TBD = blocking)
- **C0:** tạo `backend/content/error_tags.yaml` = **list error-tag chuẩn** (12 tag khởi đầu ở AUDIT §4 / KHUON), map 27 tag cũ vào. **Chặn C2 (tag) + C3 (distractor).** ~0.5 ngày.
- **C1:** backfill **16 marker body** cho đích hotlink hỏng (danh sách AUDIT §2) + **de-dup 4 bài merge** (recipe AUDIT §3). *Có thể BẮT ĐẦU ngay khi có danh sách 16 (AUDIT §2) — E0 chỉ cần để **verify** kết quả, không chặn việc sửa.* ~2–3 ngày.
- **C2:** backfill anchor còn lại (ưu tiên 6→7) + **tag 26 bài** theo `error_tags.yaml`. *Phụ thuộc C0.* ~3–5 ngày.
- **C3-pilot:** migrate in-prose → block + soạn item cho **3–5 bài pilot** (relative-clauses, conditionals, complex-sentence...). *Phụ thuộc E1 + C1 + C0 (cho bài pilot).* **Chạy TRƯỚC gate.** ~2–3 ngày.
- **C3-scale:** migrate **93 bài còn lại** theo khuôn `KHUON_grammar_exercise.md`, ưu tiên §6; ~65–70% migrate nhẹ, 30–35% viết lại. **Phụ thuộc C2 + PILOT GATE.**
  - **Sizing (hiện rõ — AUDIT §5):** 98 bài, mỗi bài ~3–5 check-up + 1 end-test ⇒ **~300–500 check-up + 98 end-test**. Ước: bài migrate-nhẹ ~1–2 giờ/bài, bài rewrite (30–35%) ~3–4 giờ/bài + de-dup các bài merge ⇒ **≈ 6–10 content-week (1 người)**. Đây là hạng mục lớn nhất — PM phải **resource trước**, không coi là "đuôi" của eng track.
  - **⚠ Bar answer-key 100%/item + per-batch sign-off** (không spot-check phần đáp án) — vạch chất lượng #1.

---

## 3. Decision Gate
**[PILOT GATE] — sau E4 + C1 + C3-pilot trên 3–5 bài 6→7:**
- **Input:** completion check-up; QA chất lượng; hotlink cuộn đúng trên bài pilot.
- **Ngưỡng (đo được):**
  1. **Completion ≥ ~50%** = `checkup_completed / checkup_started` (mẫu số = số người **bắt đầu** check-up; E4 ghi 2 event riêng). **⚠ Số này là PROVISIONAL (sửa từ gauntlet):** nó mượn từ plan engine cũ (mẫu số khác). **Hiệu chỉnh bằng completion THẬT của bài tập D1 vocab đang chạy trong app** làm baseline trước khi chốt.
  2. **0 false-fail** trong QA (kiểm 100% answer-key bài pilot).
  3. **Hotlink pilot cuộn đúng 100%**.
  4. **⭐ TRANSFER-NÓI (thêm từ gauntlet — đây là metric DUY NHẤT khớp sản phẩm Speaking):** trong nhóm user fail check-up của 1 điểm (vd conditionals), **error-tag đó khi NÓI có giảm** ở 2 session kế (within-subject, dùng `grammar_recommendations` + query recurrence cũ). **Nếu từ chối đo cái này → ghi RÕ "dự án KHÔNG gated trên cải thiện nói"** (STRATEGY §2) để bet có chủ đích, không tự lừa.
- **Decision owner:** **Andy** chốt GO/NO-GO vào `docs/audits/GATE_grammar_checkup.md`; **fallback** = tech-lead nếu Andy vắng > **3 ngày làm việc**; borderline → mặc định **NO-GO / kéo dài pilot**.
- **Không đạt:** giữ pilot, sửa khuôn/UX, KHÔNG mở **C3-scale**. *(Measure-first ĐÚNG mức — pilot nhỏ, không phải cửa-sổ-telemetry-3-tuần trước khi viết câu hỏi.)*

## 4. Risk register
1. **YAML block lộ ra body** nếu strip sau render → **WI-E1 test (a)** chặn cứng.
2. **False-fail câu đúng** (vạch #1) → chỉ tập đóng client-side; test "distractor token không phá đáp đúng"; bar answer-key 100% (content).
3. **Merge artifact ghép sai câu↔đáp** → **C1 de-dup TRƯỚC C3** (gate cứng per-bài).
4. **`exercise_ref` lệch khi sửa bài** → NAMED `slug#section_ref#item_id` (không positional).
5. **Anchor "done" giả** → **E0** canh đúng invariant + CI.
6. **Distractor rởm** (tag thưa) → list chuẩn (C2) chặn C3 authoring.
7. **a11y** kéo-thả → fallback bàn phím (E3).
8. **Scope creep sang engine nói** → đây KHÔNG phải engine cá-nhân-hoá; cờ riêng `GRAMMAR_CHECKUP_ENABLED`.
9. **⚠ Đáp án SAI ship cho mọi user** (vạch #1, hệ quả nặng nhất) — cờ `GRAMMAR_CHECKUP_ENABLED` là **global**, tắt là mất check-up **toàn bộ**. → **Bắt buộc kill-switch per-bài:** (a) **denylist slug** (env hoặc bảng nhỏ) để **ẩn check-up 1 bài** mà không tắt toàn site; (b) vì nội dung ở markdown co-located → **content-revert nhanh** (revert PR bài đó); (c) **per-batch answer-key sign-off** trong C3-scale (mỗi lô bài có người ký 100% đáp án trước khi bật). Thêm denylist vào E4.

## 5. Checklist bàn giao PM
- [ ] **Xác nhận OWNER content track (C0–C3)** + resource ~6–10 content-week cho C3-scale **TRƯỚC khi cam kết timeline** (đây là ~80% chi phí; STAFFING TBD = blocking).
- [ ] Engineer đọc `CLAUDE.md` + `PLAN_grammar_wiki_exercises` + `KHUON_grammar_exercise` + `AUDIT_grammar_content_98` trước mỗi WI.
- [ ] E0 trước khi tin "anchor done"; E1→E3a→E3; E2/E5 độc lập; **C0 trước C2/C3**.
- [ ] Mỗi WI: 1 PR scoped + test + verify chạy + flag/rollback.
- [ ] **PILOT** = E4 + C1 + **C3-pilot** trên 3–5 bài → **[PILOT GATE]** (Andy chốt, fallback tech-lead) → **C3-scale**.
- [ ] Migration **110** (không đụng vocab 111); `ls migrations|sort` không trùng số; RLS owner-scoped + `user_id` từ JWT.
- [ ] **Kill-switch per-slug `GRAMMAR_CHECKUP_DENY`** sẵn sàng (rủi ro #9) + per-batch answer-key sign-off ở C3-scale.
- [ ] Không bài nào hiện check-up trước khi C1/C2/C3 xong cho bài đó (loader trả `exercises` rỗng → tự ẩn).
- [ ] Distractor authoring (C3) không bắt đầu trước khi `error_tags.yaml` (C0) + tag (C2) xong.

---

*Kế hoạch bám repo thật (migration 110; `grammar_content.py:186/190/233`; `result.html`/`grammar.js` hotlink; RLS owner-scoped; reuse `exercises.js`/`d1-exercise.js`). 2 track Eng+Content, gate bằng pilot. Mọi WI 1-PR-có-test. Chờ reviewer loop >9.*

---

## A.3 ▸ Web-placement (file:line) — chèn vào trang nào
*(nhúng nguyên văn — `WEB_PLACEMENT_grammar_vocab_2026-06-20.md`. **Phần GRAMMAR = §0 (2 dòng grammar), §1, §2, §6, §7**; §3–§5 là VOCAB — agent grammar bỏ qua.)*

# GỢI Ý VỊ TRÍ ĐẶT NỘI DUNG vào cấu trúc Web hiện tại (Grammar + Vocab)
**IELTS Speaking Coach · 2026-06-20 · thuần đề xuất, KHÔNG sửa repo · bám file:line thật**

> Bản đồ "nội dung mới slot vào ĐÂU": từng loại nội dung → trang/route/element host + chỗ chèn + reuse hay greenfield. Line number bám inspection; chỗ ghi `~` là vùng-tương-đối, dev xác nhận khi code.

---

## 0. Bản đồ nhanh
| Nội dung | Host page | Element/route | Reuse / Greenfield | API |
|---|---|---|---|---|
| Grammar check-up theo section | `pages/grammar-article.html` | trong `#article-body` (chèn trước **heading kế tiếp cùng-hoặc-cao-hơn cấp** — heading-based, §1) | Greenfield render (`grammar-checkup.js`) | field `exercises` trong `GET /api/grammar/article/{cat}/{slug}` |
| Grammar end-test | `pages/grammar-article.html` | `<section>` mới trước `#prev-next` | Greenfield | cùng endpoint, `exercises.end_test` |
| Grammar hotlink (đích) | `pages/result.html` → `pages/grammar-article.html#anchor` | `#grammar-resources-cards` (origin) + `_scrollToHashAnchor` (đích) | **ĐÃ CÓ** (chỉ nâng độ phủ anchor) | `PATCH /api/grammar/recommendations/{rec_id}/clicked` |
| Vocab card library | `pages/vocabulary.html` | tab mode-card mới `word-library` | Greenfield module (`vocab-modules/word-library.js`) | **`GET /api/vocabulary/articles...` (mở rộng `vocab_content.py` — 1 đường DUY NHẤT, KHÔNG `/api/vocab-cards` song song; AUDIT reconcile §3)** |
| Vocab card audio | `pages/flashcard-study.html` | cạnh `.back-ipa` | Greenfield nút + endpoint | `audio_headword` (field) / bucket `vocab-audio` |
| Vocab bài tập (V_*) | `pages/vocabulary.html` tab Exercises | `#mount-exercises` (reuse hub) | Reuse `vocabulary_exercises` + render kiểu `d1-exercise.js` | mở `exercise_type` CHECK 021+022 |
| Nav cả hai | `aver-chrome.js` | `VALID_ACTIVE=[...,'grammar','vocabulary']` | ĐÃ CÓ tab | — |

---

## 1. GRAMMAR — trang bài (`pages/grammar-article.html` + `js/grammar.js`)
**Cấu trúc trang (đã verify):**
```
#article-container
 ├─ header (title, level, metadata)
 ├─ #article-body      ← grammar.js: bodyEl.innerHTML = article.html  (~grammar.js:690-708)
 │     (h2/h3 + <a id="..." class="grammar-anchor"> do marker <!-- anchor --> sinh ra, grammar.js:190)
 ├─ #compare-section · #next-articles-section · #related-section
 ├─ #prev-next
 └─ #toc-container (sidebar phải; querySelector '.article-body h2, h3')
```
**Chèn CHECK-UP (sau mỗi section):** sau `bodyEl.innerHTML = article.html`, gọi hook mới (`grammar-checkup.js`): với mỗi `exercises.per_section[]`, `getElementById(section_ref)` → **đi tới heading liền sau, rồi walk sibling tới heading CÙNG-HOẶC-CAO-HƠN cấp; chèn TRƯỚC ranh giới đó** (hợp đồng heading-based, sửa từ gauntlet — KHÔNG dùng "anchor kế tiếp" vì marker thưa; xem PLAN_PM E3). Bọc `<div class="article-checkup">` để thừa style `.article-body`.
**Chèn END-TEST:** thêm `<section id="end-test-section">` **trước `#prev-next`** (hoặc cuối `#article-body`); render từ `exercises.end_test`.
**API:** thêm field `exercises{ per_section[], end_test }` vào response `GET /api/grammar/article/{category}/{slug}` (`routers/grammar.py`), loader strip block khỏi `html` trước render (PLAN_PM WI-E1).
**Discoverability (gap 2 audit nêu):** từ home/nav vào bài Wiki như cũ; thêm badge "Có bài tập" trên card bài ở `grammar.html` để user biết bài nào đã có check-up (1 cờ từ `exercises` không rỗng).

## 2. GRAMMAR — hotlink (đã có, nâng độ phủ)
- **Origin:** `result.html` `#grammar-resources-cards` build `<a href="/grammar/{cat}/{slug}#anchor">` (`~result.html:474-483`) + telemetry `PATCH .../clicked`.
- **Đích:** `grammar.js:_scrollToHashAnchor()` (~:573) cuộn + pulse — **đã chạy** cho anchor có marker body. Việc cần: **backfill marker** cho 16 đích hỏng + 119 anchor thiếu (AUDIT_grammar_content §2) — KHÔNG đụng cấu trúc trang.

## 3. VOCAB — card library (`pages/vocabulary.html` + `vocab-landing.js`)
**Cấu trúc trang (đã verify):** dashboard mode-card grid (`data-mode=`) + tab-panel ẩn (`#panel-*` chứa `.tab-mount#mount-*`); module nạp động qua `TAB_LOADERS` trong `vocab-landing.js` (`my-vocab/flashcards/exercises/needs-review`).
**Thêm tab "Thẻ từ" (library):**
- HTML: `<a class="mode-card" data-mode="word-library">` + `<section class="tab-panel" data-panel="word-library"><div class="tab-mount" id="mount-word-library"></div></section>`.
- JS: thêm `'word-library': () => import('/js/vocab-modules/word-library.js')` vào `TAB_LOADERS`; module export `mount(container,opts)` (theo pattern các module vocab).
- Data: `GET /api/vocabulary/articles?category=` (mở rộng `vocab_content.py` trả field mới) — đây là **thư viện chung read-only**; nút "+ thêm vào deck" → copy sang `user_vocabulary`.
> Thư viện chung (`content_vocab` mở rộng) khác `My Vocabulary` (bank cá nhân) — đặt thành 2 tab riêng, rõ vai trò.

## 4. VOCAB — audio (`pages/flashcard-study.html`)
**Card face back (đã verify):** `.back-headword-row` chứa `.back-headword` + `.back-ipa` (~:79-85); def-vi/def-en; `.example-block`.
**Chèn audio:** cạnh `.back-ipa` thêm nút `▶` → phát `audio_headword` (public URL bucket `vocab-audio`) bằng `<audio>` hoặc `new Audio(url).play()`. Cũng áp cho card trong tab library.
**Greenfield:** `user_vocabulary` chưa có cột audio; thư viện chung lấy `audio_headword` từ field card. (Bank cá nhân muốn audio → thêm cột hoặc map theo headword.)

## 5. VOCAB — bài tập (reuse `vocabulary_exercises`)
**Hub:** tab Exercises (`#mount-exercises`, `vocab-modules/exercises.js`) đang liệt kê D1 + Flashcards card. Thêm card mới cho bộ V_* (def/gap/collocation/synonym/odd-one-out/word-form).
**Render/grade:** kiểu `d1-exercise.html`/`d1-exercise.js` (chấm client-side cho dạng đóng). 
**Data model:** `vocabulary_exercises.content_payload JSONB` (021) + attempts (022). **Mở `exercise_type` CHECK ở CẢ 2 bảng** thêm các type V_*; draft→admin approve như D1. Neo `target_slug` để card↔exercise↔SRS.

## 6. ROUTING / NAV (cả hai)
- `vercel.json` rewrites: grammar đã có `/grammar/:category/:slug` → `grammar-article.html`. Vocab article (nếu cần URL sạch) thêm `/vocabulary/:category/:slug`.
- `aver-chrome.js` `VALID_ACTIVE` đã gồm `grammar` + `vocabulary` → tab nav có sẵn; mỗi page đặt `<aver-chrome active="...">`.
- **Discoverability (gap):** trên `home.html` nên có entry rõ tới "Bài tập Grammar" và "Thẻ từ" (hiện vào sâu trong từng trang). Đề xuất: thêm 1 card/CTA ở home cho mỗi khi feature bật cờ.

## 7. Greenfield vs Reuse (tóm)
| Hạng mục | Reuse | Greenfield |
|---|---|---|
| Grammar check-up render | endpoint article, anchor scroll, `d1-exercise` grading pattern | `grammar-checkup.js`, chèn DOM, 4/5 widget |
| Grammar end-test | cùng endpoint | `<section id="end-test-section">` |
| Vocab card library | `flashcard-study` card face, `vocab-landing` tab pattern, `vocab_content` loader | tab `word-library` + module, field mới |
| Vocab audio | bucket pattern, `<audio>` | bucket `vocab-audio`, nút phát, pipeline TTS |
| Vocab bài tập | `vocabulary_exercises`/attempts/SRS, `d1-exercise` UI | type V_*, CHECK mở 2 bảng, render mỗi dạng |

---

*Bám file:line từ inspection repo (grammar-article.html `#article-body`/`#prev-next`; grammar.js render+anchor; result.html hotlink; vocabulary.html mode-card+tab-mount; vocab-landing TAB_LOADERS; flashcard-study `.back-ipa`; vocabulary_exercises 021/022; aver-chrome VALID_ACTIVE; vercel.json). Chỗ `~` dev xác nhận khi code. KHÔNG sửa repo.*

---

## A.4 Bật STRICT trong CI (đã sẵn sàng)
Audit body-marker hiện **xanh hoàn toàn** (`[a]=[b]=[c]=[d]=0`). Để biến thành **hard gate** chặn mọi PR phá invariant anchor (thêm anchor thiếu marker / đổi heading lệch `location` / drift-ngược / hotlink vỡ):

```bash
cd backend && ANCHOR_BODY_MARKERS_STRICT=1 python3 scripts/verify_anchor_drift.py
# exit 0 ở hiện trạng; exit 1 nếu sau này có vi phạm [a]/[b]/[c]/[d]
```

Hoặc đổi default `STRICT_BODY_MARKERS` → `True` tại `backend/scripts/verify_anchor_drift.py:50`.
**Khuyến nghị:** thêm step này vào CI **ngay** (vì đang xanh). Đặc biệt **chạy lại sau khi de-dup bài merge (C1)** và sau mỗi PR content thêm/sửa anchor.

---

# PHẦN B — AGENT NỘI DUNG
> Đọc B.1 (quy ước) trước, rồi dùng B.2 (KHUÔN cú pháp) + B.3 (tag) + B.4 (prompt giao việc hàng loạt) + B.5 (mẫu để bắt chước).

## B.1 Quy ước anchor + error-tag (đọc trước khi soạn)
1. **Anchor = đích cuộn THẬT.** Mỗi điểm dạy có 1 dòng `<!-- anchor: <slug>.<điểm> -->` **NGAY TRÊN heading** (H2 **hoặc** H3). Loader chỉ nhận cú pháp `anchor:` (KHÔNG `section:`). `section_ref` của check-up = **đúng id đó** (named, KHÔNG positional). **1 marker phục vụ CẢ check-up LẪN hotlink.**
   - **Trạng thái A3:** toàn bộ **267 anchor khai báo đã có marker + `location` khớp heading** (I.2). Khi soạn bài, id `section_ref` cho các điểm hiện có **đã sẵn sàng** — chỉ thêm marker MỚI nếu bạn tạo section/điểm dạy mới (rồi thêm cùng id vào frontmatter `anchors:` kèm `location`=heading thật + `type`, và chạy `verify_anchor_drift.py`).
2. **Error-tag:** mọi distractor gắn tag từ `error_tags.yaml` (B.3) — **KHÔNG** lấy trực tiếp `common_error_tags` frontmatter (sạch nhưng **thưa**). Mỗi tag = 1 lỗi thật của người Việt.
3. **Chỉ 5 dạng auto-grade an toàn:** `mcq` · `error_id` · `word_bank` · `match` · `order` (so khớp index/sequence tuyệt đối). Free-text (`fill_typed`/`transform`) → **self-check no-score**. **Mỗi item đúng-1-đáp-án; mọi distractor phải thật sự SAI** (tự kiểm 100% — vạch chất lượng số 1).
4. **Fence 4-backtick** cho block `checkup`/`endtest` (vì `why`/`q` có thể chứa ` ``` `).
5. **De-dup TRƯỚC** nếu bài là merge composite (heading trùng — xem cảnh báo I.2) — kẻo ghép sai câu↔đáp.

Chi tiết đầy đủ ở B.2 (KHUÔN) + B.4 (PROMPT) + B.5 (SAMPLES). Thứ tự ưu tiên 6→7 + ma trận readiness: xem **I.4 §6** và **PHẦN C** (csv per-bài).

---

## B.2 ▸ KHUÔN block check-up/end-test (cú pháp viết trong file .md)
*(nhúng nguyên văn — `KHUON_grammar_exercise.md`)*

# KHUÔN MD — Bài tập nhúng trong bài Grammar Wiki (giao cho content agent)
**Dùng để thêm check-up sau mỗi section + test cuối bài, viết NGAY trong file `.md` của bài.**

## Hướng dẫn cho agent
- Viết block `checkup` **ngay sau section nó kiểm**; block `endtest` đặt **cuối file**.
- **⚠ DÙNG FENCE 4-BACKTICK** mở/đóng block trong bài thật: ` ````checkup ` ... ` ```` ` (KHÔNG 3-backtick). Lý do: `why`/`q` có thể chứa ` ``` ` → fence 3-backtick bị cắt giữa chừng, rò YAML ra trang. *(Các ví dụ dưới hiển thị bằng 4-backtick chính là cú pháp thật cần viết.)*
- **`section_ref` = id trong marker `<!-- anchor: <slug>.<section-id> -->`** của repo viết ngay trên section (dùng ĐÚNG cú pháp `anchor:` — loader của repo chỉ nhận `anchor:`, không nhận `section:`). Marker này **đồng thời** là đích cuộn của hotlink. Bài chưa có anchor → **thêm `<!-- anchor: id -->` + cùng id vào frontmatter `anchors:`** (id ngắn có nghĩa, vd `present-simple.structure.affirmative`) rồi để `section_ref` trùng. **KHÔNG dùng số thứ tự** — phải là id có tên (ổn định khi sửa bài).
- **Mỗi item có `id`** (vd `q1`, `tps-drop`) — ổn định, để analytics khoá `slug#section_ref#id` không lệch khi chèn/xoá câu.
- **Chỉ dùng dạng auto-grade an toàn (0 false-fail):** `mcq`, `error_id`, `word_bank`, `match`, `order`. Đáp án so khớp **index/sequence tuyệt đối**.
- Dạng free-text (`fill_typed`, `transform`) **chỉ** đặt `mode: self_check` (hiện đáp án mẫu, KHÔNG tính điểm).
- **Distractor phải là lỗi thật**, gắn `error_tag`/`distractor_tags` lấy từ **DANH SÁCH ERROR-TAG CHUẨN dưới đây** (KHÔNG lấy trực tiếp từ `common_error_tags` frontmatter — tag đó sạch nhưng **thưa**, chưa đủ phủ). Cấm distractor vô nghĩa.
- **Mỗi item phải có ĐÚNG 1 đáp án đúng; mọi distractor phải thật sự SAI** (tự kiểm 100% trước khi nộp — đây là vạch chất lượng số 1).
- Mỗi câu có `why` (giải thích ngắn: nêu luật + tên lỗi) + `difficulty: intro|core|stretch`.
- Check-up/section: **2–4 câu**. End-test/bài: **8–12 câu, đa dạng dạng, interleave xuyên các section**, `shuffle: true`, độ khó tăng dần (intro→core→stretch).
- **Accessibility:** với `word_bank`/`order`, đảm bảo có fallback **click-to-place** (không chỉ kéo-thả).
- Ưu tiên điểm 6→7: complex sentence, relative clause, conditionals, tense range, articles, subject-verb agreement.

### DANH SÁCH ERROR-TAG CHUẨN (chọn từ đây; mở rộng trong `error_tags.yaml`)
`SVA_THIRD_PERSON_S_DROP` · `AUX_DO_AGREEMENT` · `TENSE_CONTINUOUS_FOR_FACT` · `L1_TENSE_IN_CONDITIONAL` · `ARTICLE_OMISSION` · `ARTICLE_A_VS_AN` · `PREP_WRONG` · `WORD_ORDER_ADV` · `RELATIVE_PRONOUN_WRONG` · `BARE_ING` · `WRONG_PARTICIPLE` · `PLURAL_AGREEMENT`

## Dạng & schema đáp án
| type | render | fields | answer |
|---|---|---|---|
| `mcq` | 4 lựa chọn, 1 đúng | `options[]` | `answer: <index trong options>` |
| `error_id` | chọn span sai trong câu | `sentence`, `spans[]` | `answer: <index TRONG spans[]>` (không phải vị trí ký tự) |
| `word_bank` | kéo token từ `bank` (có distractor token), exact-match all-or-nothing, shuffle | `bank[]` | `answer_seq: [...]` |
| `match` | ghép 2 cột | `left[]`, `right[]` | `answer: {leftIdx: rightIdx}` |
| `order` | sắp xếp token thành câu | `bank[]` | `answer_seq: [...]` |

## Khuôn check-up (đặt sau section)
````markdown
<!-- anchor: <slug>.<section-id> -->
## <Tiêu đề section>
...nội dung...

```checkup
section_ref: <slug>.<section-id>          # = id của <!-- anchor: ... --> ngay trên
items:
  - id: q1
    type: mcq
    q: ""
    options: ["", "", "", ""]
    answer: 0                              # index trong options
    difficulty: intro                      # intro | core | stretch
    distractor_tags: {1: ERROR_TAG_A, 2: ERROR_TAG_B}   # tag từ DANH SÁCH CHUẨN
    why: ""
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "... [span1] ... [span2] ..."
    spans: ["span1", "span2"]
    answer: 0                              # index trong spans[]
    difficulty: core
    error_tag: ERROR_TAG_A
    why: ""
```
````

## Khuôn end-test (cuối file)
````markdown
```endtest
title: "Test cuối bài — <Tên bài>"
shuffle: true
items:                       # 8–12 câu, interleave xuyên section, độ khó tăng dần
  - id: t1
    type: mcq
    q: ""
    options: ["","","",""]
    answer: 0
    difficulty: intro
    distractor_tags: {1: ERROR_TAG}
    why: ""
  - id: t2
    type: word_bank
    q: "Sắp xếp thành câu đúng."
    bank: ["","","",""]       # gồm distractor token
    answer_seq: ["","",""]
    difficulty: core
    error_tag: ERROR_TAG
    why: ""
  - id: t3
    type: match
    q: ""
    left: ["",""]
    right: ["",""]
    answer: {0: 1, 1: 0}
    difficulty: core
  - id: t4
    type: order
    q: "Sắp xếp thành câu đúng."
    bank: ["","",""]
    answer_seq: ["","",""]
    difficulty: stretch
    why: ""
```
````

## Ví dụ đã điền (bài `tenses/present-simple`)
````markdown
<!-- anchor: present-simple.common-mistake.third-person-s-drop -->
## Ngôi thứ ba số ít thêm -s

```checkup
section_ref: present-simple.common-mistake.third-person-s-drop   # = id của <!-- anchor: --> ngay trên (anchor thật của bài; cũng là đích hotlink)
items:
  - id: q1
    type: mcq
    q: "Choose the correct form: 'She ___ to work by bus.'"
    options: ["go", "goes", "going", "gone"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: SVA_THIRD_PERSON_S_DROP, 2: BARE_ING, 3: WRONG_PARTICIPLE}
    why: "Chủ ngữ ngôi 3 số ít (she) → động từ thêm -s: 'goes'."
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "My brother [work] in a bank and [lives] in Hanoi."
    spans: ["work", "lives"]
    answer: 0                # index trong spans[]
    difficulty: core
    error_tag: SVA_THIRD_PERSON_S_DROP
    why: "'My brother' là ngôi 3 số ít → 'works'."
  - id: q3
    type: word_bank
    q: "Sắp xếp thành câu đúng."
    bank: ["Tom", "watches", "watch", "TV", "every", "evening"]
    answer_seq: ["Tom", "watches", "TV", "every", "evening"]
    difficulty: core
    error_tag: SVA_THIRD_PERSON_S_DROP
    why: "Ngôi 3 số ít → 'watches'; 'watch' là token nhiễu."
```
````

````markdown
```endtest
title: "Test cuối bài — Present Simple"
shuffle: true
items:
  - id: t1
    type: mcq
    q: "'Water ___ at 100°C.'"
    options: ["boil", "boils", "is boiling", "boiled"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: SVA_THIRD_PERSON_S_DROP, 2: TENSE_CONTINUOUS_FOR_FACT}
    why: "Sự thật hiển nhiên → present simple, ngôi 3 số ít 'boils'."
  - id: t2
    type: error_id
    q: "Chọn phần SAI."
    sentence: "She [don't] [like] coffee."
    spans: ["don't", "like"]
    answer: 0                # index trong spans[]
    difficulty: core
    error_tag: AUX_DO_AGREEMENT
    why: "Ngôi 3 số ít phủ định → 'doesn't'."
  - id: t3
    type: word_bank
    q: "Sắp xếp câu phủ định đúng."
    bank: ["She", "doesn't", "don't", "like", "coffee"]
    answer_seq: ["She", "doesn't", "like", "coffee"]
    difficulty: core
    error_tag: AUX_DO_AGREEMENT
    why: "'doesn't' cho ngôi 3 số ít; 'don't' là token nhiễu."
  - id: t4
    type: match
    q: "Ghép cách dùng với câu."
    left: ["thói quen", "sự thật hiển nhiên"]
    right: ["The sun rises in the east.", "I go to the gym on Mondays."]
    answer: {0: 1, 1: 0}
    difficulty: core
  - id: t5
    type: order
    q: "Sắp xếp thành câu hỏi đúng."
    bank: ["How", "often", "does", "she", "exercise"]
    answer_seq: ["How", "often", "does", "she", "exercise"]
    difficulty: stretch
    why: "Câu hỏi Wh- present simple ngôi 3: How often + does + S + V(bare)."
```
````

---

## B.3 ▸ error_tags.yaml (danh sách tag chuẩn → backend/content/error_tags.yaml)
*(nhúng nguyên văn — `error_tags.yaml`)*

`````yaml
# error_tags.yaml — Danh sách ERROR-TAG CHUẨN cho bài tập grammar (check-up/end-test)
# Đặt ở: backend/content/error_tags.yaml  (WI-C0 của PLAN_PM_grammar_checkup_build)
#
# Quy tắc: MỌI distractor trong checkup/endtest PHẢI gắn 1 tag ở đây
#   - mcq:        distractor_tags: {<index>: <TAG>}
#   - error_id:   error_tag: <TAG>        (lỗi của span sai)
#   - word_bank:  error_tag: <TAG>        (lỗi mà distractor token đại diện)
# Mỗi tag = 1 LỖI THẬT của người Việt học IELTS (wrong → right). Cấm distractor không-phải-lỗi-thật.
# Map 27 tag cũ trong common_error_tags vào đây khi chuẩn hoá (xem cột map_from).
version: 1

tags:
  # ── Subject–verb agreement ────────────────────────────────────────────
  SVA_THIRD_PERSON_S_DROP:
    area: subject-verb-agreement
    label_vi: "Quên -s ở ngôi 3 số ít"
    wrong: "She go to school every day."
    right: "She goes to school every day."
    map_from: [missing_s, subject_verb_disagreement]
  AUX_DO_AGREEMENT:
    area: subject-verb-agreement
    label_vi: "Dùng don't/do thay doesn't/does cho ngôi 3 số ít"
    wrong: "He don't like coffee."
    right: "He doesn't like coffee."
  SVA_INTERVENING_PHRASE:
    area: subject-verb-agreement
    label_vi: "Chia động từ theo danh từ gần thay vì chủ ngữ thật"
    wrong: "The box of books are heavy."
    right: "The box of books is heavy."
  SVA_COLLECTIVE_NOUN:
    area: subject-verb-agreement
    label_vi: "Sai số với danh từ tập hợp / 'a number of'"
    wrong: "A number of students was absent."
    right: "A number of students were absent."
  PLURAL_AGREEMENT:
    area: nouns
    label_vi: "Sai số ít/số nhiều của danh từ"
    wrong: "There are many informations."
    right: "There is a lot of information."

  # ── Articles (a/an/the/zero) ─────────────────────────────────────────
  ARTICLE_OMISSION:
    area: articles
    label_vi: "Bỏ mạo từ trước danh từ đếm được số ít"
    wrong: "She is teacher."
    right: "She is a teacher."
    map_from: [missing_article]
  ARTICLE_A_VS_AN:
    area: articles
    label_vi: "Nhầm a/an theo ÂM (không phải chữ cái)"
    wrong: "He waited for a hour."
    right: "He waited for an hour."
    map_from: [wrong_article]
  ARTICLE_THE_WITH_GENERAL:
    area: articles
    label_vi: "Thêm 'the' trước danh từ chung chung (nói khái quát)"
    wrong: "The technology has changed our lives."
    right: "Technology has changed our lives."
  ARTICLE_MISSING_THE_UNIQUE:
    area: articles
    label_vi: "Quên 'the' với thứ duy nhất / nhắc lần 2"
    wrong: "Sun rises in east."
    right: "The sun rises in the east."
  ARTICLE_THE_WITH_COUNTRY:
    area: articles
    label_vi: "Dùng 'the' sai trước tên nước/địa danh"
    wrong: "I come from the Vietnam."
    right: "I come from Vietnam."
  ARTICLE_A_WITH_UNCOUNT_OR_PLURAL:
    area: articles
    label_vi: "Dùng 'a/an' với danh từ không đếm được hoặc số nhiều"
    wrong: "I need an advice."
    right: "I need some advice."

  # ── Tenses ───────────────────────────────────────────────────────────
  WRONG_TENSE:
    area: tenses
    label_vi: "Dùng sai thì cho ngữ cảnh"
    wrong: "I live here since 2010."
    right: "I have lived here since 2010."
    map_from: [wrong_tense, tense_inconsistency]
  TENSE_CONTINUOUS_FOR_FACT:
    area: tenses
    label_vi: "Dùng tiếp diễn cho sự thật/thói quen"
    wrong: "Water is boiling at 100°C."
    right: "Water boils at 100°C."
  PRESENT_FOR_PERFECT_SINCE_FOR:
    area: tenses
    label_vi: "Dùng hiện tại đơn thay vì hoàn thành với since/for"
    wrong: "I know him for five years."
    right: "I have known him for five years."
  PAST_FOR_PRESENT_PERFECT:
    area: tenses
    label_vi: "Dùng quá khứ đơn khi cần hiện tại hoàn thành (kinh nghiệm/chưa xác định thời điểm)"
    wrong: "I already finished my homework."
    right: "I have already finished my homework."
  WRONG_PARTICIPLE:
    area: tenses
    label_vi: "Sai dạng phân từ / quá khứ phân từ"
    wrong: "He was borned in Hanoi."
    right: "He was born in Hanoi."
    map_from: [missing_ed]

  # ── Conditionals ─────────────────────────────────────────────────────
  L1_TENSE_IN_CONDITIONAL:
    area: conditionals
    label_vi: "Dùng hiện tại đơn ở mệnh đề chính của câu điều kiện loại 2 (ảnh hưởng L1)"
    wrong: "If I had money, I buy a car."
    right: "If I had money, I would buy a car."
  COND_WILL_AFTER_IF:
    area: conditionals
    label_vi: "Dùng 'will' ngay sau 'if'"
    wrong: "If it will rain, I will stay home."
    right: "If it rains, I will stay home."
  COND_WAS_INSTEAD_OF_WERE:
    area: conditionals
    label_vi: "Dùng 'was' thay 'were' trong điều kiện loại 2 (giả định)"
    wrong: "If I was you, I would apologize."
    right: "If I were you, I would apologize."
  COND_TYPE2_VS_TYPE3:
    area: conditionals
    label_vi: "Lẫn loại 2 (giả định hiện tại) với loại 3 (giả định quá khứ)"
    wrong: "If I studied harder, I would have passed."
    right: "If I had studied harder, I would have passed."

  # ── Relative clauses ─────────────────────────────────────────────────
  RELATIVE_WHICH_VS_THAT:
    area: relative-clauses
    label_vi: "Dùng 'which/that' sai trong mệnh đề không xác định (có phẩy → không dùng 'that')"
    wrong: "My mother, that is a doctor, works hard."
    right: "My mother, who is a doctor, works hard."
  RELATIVE_PRONOUN_WRONG:
    area: relative-clauses
    label_vi: "Chọn sai đại từ quan hệ (who cho người, which cho vật)"
    wrong: "The book who I read was great."
    right: "The book which/that I read was great."
  RELATIVE_NON_DEFINING_NO_COMMA:
    area: relative-clauses
    label_vi: "Thiếu phẩy ở mệnh đề không xác định (hoặc thừa phẩy ở mệnh đề xác định)"
    wrong: "Paris which is in France is beautiful."
    right: "Paris, which is in France, is beautiful."
  RELATIVE_DOUBLE_SUBJECT:
    area: relative-clauses
    label_vi: "Lặp chủ ngữ trong mệnh đề quan hệ"
    wrong: "The man who he called me is my uncle."
    right: "The man who called me is my uncle."

  # ── Gerund / infinitive ──────────────────────────────────────────────
  GI_WRONG_FORM_AFTER_VERB:
    area: gerund-vs-infinitive
    label_vi: "Sai gerund/infinitive sau động từ cố định"
    wrong: "I enjoy to read books."
    right: "I enjoy reading books."
    map_from: [gerund_infinitive_confusion]
  GI_STOP_MEANING:
    area: gerund-vs-infinitive
    label_vi: "Lẫn nghĩa stop + V-ing (ngừng làm) vs stop + to V (dừng để làm)"
    wrong: "We stopped to smoke years ago (ý: bỏ thuốc)."
    right: "We stopped smoking years ago."
  GI_REMEMBER_FORGET_MEANING:
    area: gerund-vs-infinitive
    label_vi: "Lẫn nghĩa remember/forget + to V (việc cần làm) vs + V-ing (việc đã làm)"
    wrong: "Remember locking the door before you leave. (ý: nhắc làm sắp tới)"
    right: "Remember to lock the door before you leave."
  BARE_ING:
    area: verb-patterns
    label_vi: "Dùng V-ing trần khi cần dạng khác"
    wrong: "She can going now."
    right: "She can go now."

  # ── Prepositions / word order / connectors ──────────────────────────
  PREP_WRONG:
    area: prepositions
    label_vi: "Dùng sai giới từ (thường do dịch từ tiếng Việt)"
    wrong: "I am interested on music."
    right: "I am interested in music."
    map_from: [wrong_preposition, preposition_error, missing_preposition]
  WORD_ORDER_ADV:
    area: word-order
    label_vi: "Sai vị trí trạng từ tần suất (đứng trước động từ thường)"
    wrong: "He drinks usually coffee."
    right: "He usually drinks coffee."
    map_from: [word_order_error]
  WORD_ORDER_ADJ:
    area: word-order
    label_vi: "Sai trật tự tính từ / tính từ đứng sau danh từ"
    wrong: "a car red"
    right: "a red car"
  MISSING_CONNECTOR:
    area: cohesion
    label_vi: "Thiếu liên từ nối hai mệnh đề (câu cụt/chạy)"
    wrong: "It was raining, we stayed home."
    right: "It was raining, so we stayed home."
    map_from: [missing_connector, wrong_connector]
  RUN_ON_SENTENCE:
    area: sentence-structures
    label_vi: "Câu chạy / nối hai mệnh đề độc lập không đúng cách"
    wrong: "I like it I will buy it."
    right: "I like it, so I will buy it."
  NO_COMPLEX_SENTENCE:
    area: sentence-structures
    label_vi: "Chỉ dùng câu đơn, không có mệnh đề phụ (giới hạn band GRA)"
    wrong: "I was tired. I went home."
    right: "Because I was tired, I went home."
    map_from: [no_complex_sentences, no_compound_sentences, simple_sentence_overuse]

  # ── Lexical / misc ───────────────────────────────────────────────────
  COLLOCATION_ERROR:
    area: lexis
    label_vi: "Kết hợp từ sai (collocation)"
    wrong: "I made a big progress."
    right: "I made great progress."
    map_from: [collocation_error]
  PRONOUN_ERROR:
    area: pronouns
    label_vi: "Sai/lẫn đại từ hoặc thiếu chủ ngữ"
    wrong: "Is raining now."
    right: "It is raining now."
    map_from: [pronoun_error, omitted_subject, missing_main_verb]
  MODAL_VERB_ERROR:
    area: verb-patterns
    label_vi: "Sai dạng sau modal (thêm 'to' / chia động từ)"
    wrong: "You must to study harder."
    right: "You must study harder."
    map_from: [modal_verb_error]
  PASSIVE_VOICE_ERROR:
    area: sentence-structures
    label_vi: "Sai dạng bị động (thiếu be / sai phân từ)"
    wrong: "The book was wrote by him."
    right: "The book was written by him."
    map_from: [passive_voice_error]
  COMPARATIVE_ERROR:
    area: comparatives
    label_vi: "Sai so sánh hơn/nhất (double comparative, thiếu 'than', sai dạng)"
    wrong: "She is more taller than me."
    right: "She is taller than me."
    map_from: [comparatives_error]
  SUPERLATIVE_THE_MISSING:
    area: comparatives
    label_vi: "Thiếu 'the' / sai dạng so sánh nhất"
    wrong: "He is most intelligent student."
    right: "He is the most intelligent student."
  SO_SUCH_CONFUSION:
    area: sentence-structures
    label_vi: "Lẫn so/such (so + adj; such + (a) + noun)"
    wrong: "It was so a good film."
    right: "It was such a good film."
  REPORTED_SPEECH_BACKSHIFT:
    area: reported-speech
    label_vi: "Quên lùi thì khi chuyển sang câu tường thuật (lỗi người Việt hay bỏ)"
    wrong: "She said she is tired."
    right: "She said she was tired."

# Quy ước mở rộng: thêm tag mới khi gặp lỗi thật trong grammar_recommendations.
# Mỗi tag mới phải có wrong/right cụ thể + area. KHÔNG thêm tag chung chung ("grammar_error").

`````

---

## B.4 ▸ PROMPT sinh bài check-up hàng loạt (giao agent, C3)
*(nhúng nguyên văn — `PROMPT_gen_grammar_exercises.md`)*

# PROMPT — Sinh bài tập check-up cho 1 bài Grammar (giao cho content agent, chạy C3)
**IELTS Speaking Coach · 2026-06-20 · dùng cho Track Content C3-pilot / C3-scale**

Tài liệu này gồm: **(A) prompt giao agent** (copy-paste), **(B) checklist QA**, **(C) quy trình hàng loạt**. Đính kèm khi giao: `KHUON_grammar_exercise.md` (cú pháp block), `error_tags.yaml` (danh sách tag), `AUDIT_grammar_content_98_2026-06-20.md` (recipe de-dup §3, ưu tiên §6), file `.md` bài cần xử lý.

---

## A. PROMPT (copy-paste cho agent, mỗi lần 1 bài)

> **Vai trò:** Bạn là chuyên gia IELTS soạn bài tập grammar tự-chấm cho người Việt. Nhiệm vụ: thêm **check-up sau mỗi section** + **1 test cuối bài** vào file markdown của bài `<CATEGORY/SLUG>.md`, viết NGAY trong file, theo đúng cú pháp `KHUON_grammar_exercise.md`.
>
> **Đọc trước:** `KHUON_grammar_exercise.md` (cú pháp `checkup`/`endtest`, 5 dạng an toàn), `error_tags.yaml` (danh sách tag distractor), bài `.md` mục tiêu.
>
> **BƯỚC 0 — Kiểm tiền đề (bắt buộc, dừng nếu chưa đạt):**
> 1. **De-dup:** nếu bài có **section trùng** (≥2 lần "## Bài tập luyện" / "## Tóm tắt nhanh" / "## Lỗi thường gặp", hoặc dạy cùng điểm 2 lần) → bài này là MERGE COMPOSITE. **De-dup TRƯỚC** theo recipe AUDIT §3 (chọn canonical → gộp phần độc nhất → bỏ trùng → repoint link). KHÔNG sinh check-up trên bài còn trùng (sẽ ghép sai câu↔đáp).
> 2. **Anchor:** mỗi section bạn gắn check-up phải có marker `<!-- anchor: <id> -->` **ngay trên heading của điểm dạy** — heading đó có thể là **`## H2` HOẶC `### H3`** (vd các pitfall `### Lỗi 1` nằm dưới `## Lỗi thường gặp`). Nếu **thiếu** → THÊM marker (id dạng `<slug>.<điểm>.<chi-tiết>`, vd `relative-clauses.common-mistake.which-vs-that`) **và** thêm cùng id vào frontmatter `anchors:` (kèm `location` = đúng heading + `type`). Marker này phục vụ CẢ check-up lẫn hotlink. *(FE chèn check-up ngay TRƯỚC anchor kế tiếp — xem PLAN_PM E3; nên cứ đặt block `checkup` ngay sau phần nội dung của điểm dạy đó.)*
>
> **BƯỚC 1 — Migrate bài tập in-prose có sẵn:**
> - Bài thường đã có "## Bài tập luyện" + "## Đáp án". **Tái dùng** các câu dạng fill-blank / word-choice / sửa-1-lỗi (đáp án đơn) → chuyển sang `mcq`/`error_id`/`word_bank`. **Xoá** bản prose cũ sau khi chuyển (tránh 2 bộ lệch nhau).
> - Câu dạng **transformation / "mở rộng câu trả lời" / đáp án "gợi ý"** = free-text → chuyển `word_bank`/`order` NẾU ép được về 1 đáp án; nếu không → để dạng `fill_typed`/`transform` với `mode: self_check` (hiện đáp án mẫu, KHÔNG tính điểm).
> - **⚠ KIỂM đáp án in-prose TRƯỚC khi migrate.** Một số đáp án cũ SAI hoặc nửa-vời (AUDIT §1: `gerund-inf:451`, `relative-clauses #5`, `passive #3`). **Đừng bê nguyên đáp án sai** — tự xác minh đúng-1-đáp-án rồi mới chuyển; nếu câu gốc mơ hồ → viết lại câu khác.
>
> **BƯỚC 2 — Soạn check-up + end-test:**
> - **Mỗi section: 2–4 câu** check-up đặt trong 1 block `checkup` ngay sau section (`section_ref` = id anchor section đó). Ưu tiên section dạy *cách dùng* và *lỗi thường gặp*.
> - **Cuối bài: 1 block `endtest` 8–12 câu**, **đa dạng dạng** (đủ mcq + error_id + word_bank + match + order), **interleave xuyên các section** (KHÔNG gom theo thứ tự section), `shuffle: true`, **độ khó tăng dần** (`difficulty: intro → core → stretch`).
> - **Chỉ dùng 5 dạng an toàn** (mcq, error_id, word_bank, match, order). Đáp án so khớp index/sequence tuyệt đối.
> - **Co giãn theo độ rộng bài:** bài rộng (nhiều điểm dạy) → end-test nhắm **10–12 câu**; bài hẹp → **8 câu** (sàn). **Bài NGẮN / < 2 điểm dạy rõ ràng / chưa có section đánh-anchor được** → **bỏ check-up-theo-section**, chỉ làm **1 end-test ≥ 6 câu** ở cuối bài. Đừng nhồi check-up vào bài không có ranh giới section rõ.
>
> **LUẬT CỨNG (vi phạm = loại):**
> 1. **Mỗi câu ĐÚNG-ĐÚNG-1 đáp án; MỌI distractor phải thật sự SAI.** Tự kiểm 100% (xem checklist B). Đây là vạch chất lượng số 1 — đánh-rớt-câu-đúng làm mất niềm tin.
> 2. **Mỗi distractor gắn 1 `error_tag` từ `error_tags.yaml`** (mcq: `distractor_tags`; error_id/word_bank: `error_tag`). Distractor PHẢI là **lỗi L1 thật của người Việt** (xem cột wrong/right trong error_tags). Cấm distractor vô nghĩa/đánh-lừa-thuần-hình-thức. Nếu cần tag chưa có → đề xuất thêm vào `error_tags.yaml` (có wrong/right), KHÔNG bịa tag rỗng.
> 3. **Mỗi item có `id`** (vd `q1`, `t3`) + **`why`** (1 dòng: nêu luật + tên lỗi) + (nếu là điểm 6→7) **1 dòng band** ("…→ GRA band 7").
> 4. **`word_bank`/`order`:** bank PHẢI gồm **distractor token** (vd thêm 'don't' khi đáp đúng dùng 'doesn't'); `answer_seq` là 1 thứ tự đúng duy nhất.
> 5. **`error_id`:** `answer` = index TRONG `spans[]` (không phải vị trí ký tự).
> 6. **Tiếng Anh ví dụ phải tự nhiên, đúng IELTS**; ngữ cảnh nên gần chủ đề Speaking (city, study, work, technology...).
> 7. Đặt câu ĐÚNG PHẠM VI bài — chỉ kiểm điểm bài dạy, không hỏi ngoài bài.
>
> **BƯỚC 3 — Tự kiểm + xuất:**
> - Chạy checklist B cho TỪNG câu.
> - Bảo đảm mọi block YAML **parse được** (thử `yaml.safe_load`); `answer`/`answer_seq` trỏ đúng phần tử tồn tại.
> - **Xuất:** file `.md` đã chỉnh (block nhúng đúng chỗ; bản in-prose trùng đã xoá; anchor đã thêm nếu thiếu) + **báo cáo ngắn**: số check-up/section, số câu end-test, anchor đã thêm, tag mới đề xuất (nếu có), phần free-text để self_check.

---

## B. CHECKLIST QA mỗi câu (agent + người duyệt — đều phải qua)
- [ ] **Đúng 1 đáp án.** Đọc lại 4 lựa chọn/tất cả token: chỉ 1 phương án đúng ngữ pháp trong ngữ cảnh câu.
- [ ] **Mọi distractor thật sự SAI** và là **lỗi có trong `error_tags.yaml`** (không phải biến thể cũng-đúng). *Đặc biệt cẩn thận: 's gone vs has gone, was/were trong điều kiện, which/that defining vs non-defining, accent Anh-Mỹ.*
- [ ] `error_tag`/`distractor_tags` khớp đúng loại lỗi của distractor đó.
- [ ] `word_bank`/`order`: `answer_seq` là **thứ tự đúng DUY NHẤT**; distractor token không tạo ra câu-đúng-thứ-hai.
- [ ] `error_id`: span sai đúng là lỗi; `answer` = index trong `spans[]`.
- [ ] `why` nêu đúng luật; ví dụ tiếng Anh tự nhiên, đúng phạm vi bài.
- [ ] `id` duy nhất trong bài; `section_ref` = id anchor có marker body (đã thêm nếu cần).
- [ ] Block parse YAML OK.
> **Bar duyệt = 100% answer-key** (mọi câu, không spot-check phần đáp án). Chỉ `why` (prose) được duyệt nhẹ theo lô.

---

## C. QUY TRÌNH HÀNG LOẠT (PM/owner content)
1. **Thứ tự ưu tiên (AUDIT §6):** relative-clauses → gerund-vs-infinitive → subject-verb-agreement → conditionals → article-errors/articles/tense-consistency → complex-sentence → passive-voice/future-forms/present-perfect/modal-verbs/present-simple → còn lại.
2. **Per-bài tiền đề:** (a) C0 `error_tags.yaml` xong; (b) bài đã de-dup nếu là merge composite (conditionals, complex-sentence, gerund-vs-infinitive, present-simple — AUDIT §3); (c) anchor section đã có/đã thêm.
3. **Lô:** giao agent 1 bài/lần (hoặc 1 nhóm nhỏ), nghiệm thu qua checklist B, **per-batch sign-off answer-key 100%** trước khi bật cờ cho bài đó.
4. **Bật dần:** chỉ thêm slug vào pool đã-duyệt; bài chưa duyệt → loader trả `exercises` rỗng → tự ẩn. Lỗi phát hiện sau khi bật → dùng denylist `GRAMMAR_CHECKUP_DENY` (kill-switch per-bài) + revert PR bài đó.
5. **Pilot trước:** 3–5 bài đầu = C3-pilot → PILOT GATE (completion ≥50%, 0 false-fail, hotlink 100%) → mới C3-scale.

> **Mẫu tham chiếu:** xem `SAMPLES_grammar_exercises.md` — bộ check-up+end-test ĐẦY ĐỦ cho 6 bài ưu tiên (relative-clauses, conditionals, articles, article-errors, subject-verb-agreement, gerund-vs-infinitive) với **anchor id thật** + distractor lỗi-Việt thật. Agent nên bắt chước đúng độ chi tiết + chất lượng distractor đó.

---

## B.5 ▸ SAMPLES — bài tập mẫu 6 bài ưu tiên
*(nhúng nguyên văn — `SAMPLES_grammar_exercises.md`)*

# SAMPLES — Bài tập check-up mẫu cho 6 bài Grammar ưu tiên (chạy C3)
**IELTS Speaking Coach · 2026-06-20 · anchor id THẬT từ repo · distractor lỗi-Việt thật · đủ 5 dạng an toàn**

> Mẫu để agent bắt chước đúng độ chi tiết + chất lượng. Mỗi câu **đúng-1-đáp-án**, distractor gắn tag trong `error_tags.yaml`. Cú pháp theo `KHUON_grammar_exercise.md`.
> **Cột "Anchor status"** = dữ liệu thật: id nào đã có marker body (cuộn được ngay) vs id nào **cần thêm `<!-- anchor: id -->` (C1)** trước khi check-up cuộn được.

---

## 1. `sentence-structures/relative-clauses` — band 6.0–7.0
**Anchor status:** frontmatter khai 7, body chỉ 2 marker (`overview`, `defining-vs-non-defining`). ⇒ các id dưới **cần thêm marker (C1)**: `relative-clauses.who-which-that`, `relative-clauses.common-mistake.which-vs-that`.

````markdown
<!-- anchor: relative-clauses.who-which-that -->
## Relative Pronouns và Relative Adverbs
...nội dung...

```checkup
section_ref: relative-clauses.who-which-that
items:
  - id: q1
    type: mcq
    q: "Choose the correct word: 'The woman ___ lives next door is a doctor.'"
    options: ["who", "which", "where", "whose"]
    answer: 0
    difficulty: intro
    distractor_tags: {1: RELATIVE_PRONOUN_WRONG, 2: RELATIVE_PRONOUN_WRONG, 3: RELATIVE_PRONOUN_WRONG}
    why: "Chủ ngữ chỉ NGƯỜI → 'who'. 'which' cho vật, 'where' cho nơi chốn, 'whose' chỉ sở hữu."
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "The book [who] I borrowed from the library [was] fascinating."
    spans: ["who", "was"]
    answer: 0
    difficulty: core
    error_tag: RELATIVE_PRONOUN_WRONG
    why: "'book' là vật → dùng 'which' hoặc 'that', không 'who'."
  - id: q3
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "The students [who] [they] study hard will pass the exam."
    spans: ["who", "they"]
    answer: 1
    difficulty: core
    error_tag: RELATIVE_DOUBLE_SUBJECT
    why: "'who' đã làm chủ ngữ của mệnh đề quan hệ → bỏ 'they' (lặp chủ ngữ)."
```
````

````markdown
<!-- anchor: relative-clauses.common-mistake.which-vs-that -->
## Which vs That confusion
...nội dung...

```checkup
section_ref: relative-clauses.common-mistake.which-vs-that
items:
  - id: q1
    type: mcq
    q: "Choose the correct word: 'My hometown, ___ is in the north, has changed a lot.'"
    options: ["that", "which", "who", "where"]
    answer: 1
    difficulty: core
    distractor_tags: {0: RELATIVE_WHICH_VS_THAT, 2: RELATIVE_PRONOUN_WRONG, 3: RELATIVE_PRONOUN_WRONG}
    why: "Mệnh đề KHÔNG xác định (có dấu phẩy) → 'which', KHÔNG dùng 'that'."
    band: "Mệnh đề quan hệ chính xác → câu phức đúng → đòn bẩy GRA band 7."
```
````

````markdown
```endtest
title: "Test cuối bài — Relative Clauses"
shuffle: true
items:
  - id: t1
    type: mcq
    q: "'The man ___ car was stolen called the police.'"
    options: ["who", "whose", "which", "whom"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: RELATIVE_PRONOUN_WRONG, 2: RELATIVE_PRONOUN_WRONG, 3: RELATIVE_PRONOUN_WRONG}
    why: "Sở hữu (car of the man) → 'whose'."
  - id: t2
    type: error_id
    q: "Chọn phần SAI."
    sentence: "She is the teacher [which] [taught] me English."
    spans: ["which", "taught"]
    answer: 0
    difficulty: core
    error_tag: RELATIVE_PRONOUN_WRONG
    why: "'teacher' là người → 'who'/'that', không 'which'."
  - id: t3
    type: word_bank
    q: "Sắp xếp thành câu đúng."
    bank: ["The", "woman", "who", "which", "helped", "me", "was", "kind"]
    answer_seq: ["The", "woman", "who", "helped", "me", "was", "kind"]
    difficulty: core
    error_tag: RELATIVE_PRONOUN_WRONG
    why: "Người + chủ ngữ → 'who' (token 'which' là nhiễu). 'who' làm chủ ngữ nên KHÔNG bỏ được."
  - id: t4
    type: mcq
    q: "'This is the house ___ I was born.'"
    options: ["which", "that", "where", "who"]
    answer: 2
    difficulty: stretch
    distractor_tags: {0: RELATIVE_PRONOUN_WRONG, 1: RELATIVE_PRONOUN_WRONG, 3: RELATIVE_PRONOUN_WRONG}
    why: "Với câu KHÔNG có giới từ cuối → 'where'. (Lưu ý: 'the house that/which I was born IN' cũng đúng nếu CÓ giới từ — ở đây không có nên chỉ 'where' khớp.)"
  - id: t5
    type: error_id
    q: "Chọn phần SAI."
    sentence: "Paris, [which] is the capital of France, [are] famous for art."
    spans: ["which", "are"]
    answer: 1
    difficulty: core
    error_tag: SVA_INTERVENING_PHRASE
    why: "Chủ ngữ 'Paris' số ít → 'is', không 'are' (mệnh đề chèn không đổi số)."
  - id: t6
    type: match
    q: "Ghép đại từ quan hệ với chức năng."
    left: ["who", "which", "whose"]
    right: ["chỉ vật", "chỉ sở hữu", "chỉ người"]
    answer: {0: 2, 1: 0, 2: 1}
    difficulty: intro
  - id: t7
    type: order
    q: "Sắp xếp thành câu đúng (rút gọn mệnh đề quan hệ)."
    bank: ["The", "man", "standing", "there", "is", "my", "boss"]
    answer_seq: ["The", "man", "standing", "there", "is", "my", "boss"]
    difficulty: stretch
    why: "Rút gọn: 'who is standing' → 'standing'. Câu phức rút gọn = dấu hiệu band cao."
  - id: t8
    type: mcq
    q: "'The phone ___ I bought last week stopped working.'"
    options: ["who", "what", "that", "whose"]
    answer: 2
    difficulty: core
    distractor_tags: {0: RELATIVE_PRONOUN_WRONG, 1: RELATIVE_PRONOUN_WRONG, 3: RELATIVE_PRONOUN_WRONG}
    why: "Vật + tân ngữ trong mệnh đề xác định → 'that' (hoặc 'which'). 'what' không làm đại từ quan hệ."
```
````

---

## 2. `grammar-for-meaning/conditionals` — band 6.0–7.0
**⚠ Tiền đề:** bài này là **MERGE COMPOSITE 2×** (PHẦN 1–6 + Loại 0–3 + "Unless" dạy 2 lần; "Bài tập" ×2). **De-dup TRƯỚC** (AUDIT §3). Anchor: khai 12, body chỉ 2 → các id dưới **cần thêm marker (C1)**.

````markdown
<!-- anchor: conditionals.type1.first-conditional -->
## Loại 1: First Conditional — Thực tế / Khả năng cao
...nội dung...

```checkup
section_ref: conditionals.type1.first-conditional
items:
  - id: q1
    type: mcq
    q: "Choose the correct form: 'If it ___ tomorrow, we will cancel the trip.'"
    options: ["will rain", "rains", "rained", "would rain"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: COND_WILL_AFTER_IF, 2: WRONG_TENSE, 3: L1_TENSE_IN_CONDITIONAL}
    why: "Điều kiện loại 1: if + hiện tại đơn, mệnh đề chính + will. KHÔNG 'will' ngay sau 'if'."
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "If you [will study] hard, you [will pass] the test."
    spans: ["will study", "will pass"]
    answer: 0
    difficulty: core
    error_tag: COND_WILL_AFTER_IF
    why: "Sau 'if' dùng hiện tại đơn ('study'), không 'will study'."
```
````

````markdown
<!-- anchor: conditionals.type2.common-mistake.was-instead-of-were -->
## Loại 2: Second Conditional — Giả định hiện tại
...nội dung...

```checkup
section_ref: conditionals.type2.common-mistake.was-instead-of-were
items:
  - id: q1
    type: mcq
    q: "Choose the correct form: 'If I ___ you, I would take the job.'"
    options: ["was", "were", "am", "will be"]
    answer: 1
    difficulty: core
    distractor_tags: {0: COND_WAS_INSTEAD_OF_WERE, 2: L1_TENSE_IN_CONDITIONAL, 3: L1_TENSE_IN_CONDITIONAL}
    why: "'If I were you' là CỤM CỐ ĐỊNH cho lời khuyên — 'was you' bị coi là sai cả trong văn nói. (Lưu ý: với chủ ngữ khác, 'was' trong loại 2 được chấp nhận ở văn nói thân mật, nhưng IELTS Writing nên dùng 'were'.)"
    band: "Dùng đúng câu điều kiện giả định = câu phức chính xác → GRA band 7."
  - id: q2
    type: mcq
    q: "Choose the correct form: 'If I had more time, I ___ a new language.'"
    options: ["will learn", "learn", "would learn", "learned"]
    answer: 2
    difficulty: core
    distractor_tags: {0: COND_TYPE2_VS_TYPE3, 1: L1_TENSE_IN_CONDITIONAL, 3: L1_TENSE_IN_CONDITIONAL}
    why: "Loại 2: if + quá khứ đơn (had), mệnh đề chính + would + V(bare). KHÔNG dùng hiện tại đơn ở mệnh đề chính (lỗi ảnh hưởng tiếng Việt)."
```
````

````markdown
```endtest
title: "Test cuối bài — Conditionals"
shuffle: true
items:
  - id: t1
    type: mcq
    q: "'Water freezes if the temperature ___ below zero.'"
    options: ["will drop", "drops", "dropped", "would drop"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: COND_WILL_AFTER_IF, 2: WRONG_TENSE, 3: L1_TENSE_IN_CONDITIONAL}
    why: "Loại 0 (sự thật): if + hiện tại đơn, mệnh đề chính + hiện tại đơn."
  - id: t2
    type: error_id
    q: "Chọn phần SAI."
    sentence: "If I [had] known earlier, I [would buy] the tickets."
    spans: ["had", "would buy"]
    answer: 1
    difficulty: stretch
    error_tag: COND_TYPE2_VS_TYPE3
    why: "Giả định QUÁ KHỨ (had known) → loại 3: mệnh đề chính 'would have bought', không 'would buy'."
  - id: t3
    type: mcq
    q: "'If I ___ more free time, I would learn the piano.'"
    options: ["have", "had", "will have", "would have"]
    answer: 1
    difficulty: core
    distractor_tags: {0: L1_TENSE_IN_CONDITIONAL, 2: COND_WILL_AFTER_IF, 3: COND_TYPE2_VS_TYPE3}
    why: "Loại 2: if + quá khứ đơn ('had'); mệnh đề chính + would. (Tránh trap was/were vì 'was' được chấp nhận trong văn nói.)"
  - id: t4
    type: word_bank
    q: "Sắp xếp thành câu điều kiện loại 1 đúng."
    bank: ["If", "she", "studies", "study", "she", "will", "pass"]
    answer_seq: ["If", "she", "studies", "she", "will", "pass"]
    difficulty: core
    error_tag: SVA_THIRD_PERSON_S_DROP
    why: "if + hiện tại đơn ngôi 3 số ít → 'studies' (token 'study' là nhiễu)."
  - id: t5
    type: match
    q: "Ghép loại điều kiện với ý nghĩa."
    left: ["Type 1", "Type 2", "Type 3"]
    right: ["giả định quá khứ (không có thật)", "thực tế / khả năng cao", "giả định hiện tại (không có thật)"]
    answer: {0: 1, 1: 2, 2: 0}
    difficulty: core
  - id: t6
    type: mcq
    q: "'If you heat ice, it ___.'"
    options: ["melts", "will melt", "would melt", "melted"]
    answer: 0
    difficulty: intro
    distractor_tags: {1: WRONG_TENSE, 2: L1_TENSE_IN_CONDITIONAL, 3: WRONG_TENSE}
    why: "Sự thật hiển nhiên (loại 0): cả hai mệnh đề hiện tại đơn."
  - id: t7
    type: error_id
    q: "Chọn phần SAI."
    sentence: "Unless you [will hurry], you [will miss] the bus."
    spans: ["will hurry", "will miss"]
    answer: 0
    difficulty: core
    error_tag: COND_WILL_AFTER_IF
    why: "Sau 'unless' (= if not) dùng hiện tại đơn: 'hurry'."
  - id: t8
    type: order
    q: "Sắp xếp thành câu loại 2 đúng."
    bank: ["If", "I", "knew", "the", "answer", "I", "would", "tell", "you"]
    answer_seq: ["If", "I", "knew", "the", "answer", "I", "would", "tell", "you"]
    difficulty: stretch
    why: "Loại 2: if + quá khứ đơn, mệnh đề chính + would + V(bare)."
```
````

---

## 3. `foundations/articles` — band 6.0–7.0
**Anchor status: TỐT** — 9 anchor đều có marker body (dùng được ngay, không cần backfill).

````markdown
<!-- anchor: articles.indefinite.missing-with-singular-count-noun -->
### Lỗi 1: Bỏ mạo từ trước danh từ đếm được số ít
...nội dung...

```checkup
section_ref: articles.indefinite.missing-with-singular-count-noun
items:
  - id: q1
    type: mcq
    q: "Choose the correct sentence."
    options: ["She works as teacher.", "She works as a teacher.", "She works as an teacher.", "She works as the teacher."]
    answer: 1
    difficulty: intro
    distractor_tags: {0: ARTICLE_OMISSION, 2: ARTICLE_A_VS_AN, 3: ARTICLE_MISSING_THE_UNIQUE}
    why: "Nghề nghiệp số ít, lần đầu nhắc → 'a teacher'."
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "I have [interesting] [idea] about this topic."
    spans: ["interesting", "idea"]
    answer: 1
    difficulty: core
    error_tag: ARTICLE_OMISSION
    why: "'idea' là danh từ đếm được số ít → cần 'an interesting idea'."
```
````

````markdown
<!-- anchor: articles.a-vs-an.sound-rule -->
### A hay An? — Quy tắc âm thanh
...nội dung...

```checkup
section_ref: articles.a-vs-an.sound-rule
items:
  - id: q1
    type: mcq
    q: "Choose the correct article: 'I waited for ___ hour.'"
    options: ["a", "an", "the", "—"]
    answer: 1
    difficulty: core
    distractor_tags: {0: ARTICLE_A_VS_AN, 2: ARTICLE_MISSING_THE_UNIQUE, 3: ARTICLE_OMISSION}
    why: "'hour' bắt đầu bằng ÂM nguyên âm /aʊ/ (h câm) → 'an', dù viết bằng 'h'."
  - id: q2
    type: mcq
    q: "Choose the correct article: 'He is ___ university student.'"
    options: ["an", "a", "the", "—"]
    answer: 1
    difficulty: core
    distractor_tags: {0: ARTICLE_A_VS_AN, 2: ARTICLE_THE_WITH_GENERAL, 3: ARTICLE_OMISSION}
    why: "'university' bắt đầu bằng ÂM phụ âm /j/ ('you-') → 'a', dù viết bằng 'u'."
```
````

````markdown
```endtest
title: "Test cuối bài — Articles (a/an/the/zero)"
shuffle: true
items:
  - id: t1
    type: mcq
    q: "'___ sun rises in the east.'"
    options: ["A", "An", "The", "—"]
    answer: 2
    difficulty: intro
    distractor_tags: {0: ARTICLE_MISSING_THE_UNIQUE, 1: ARTICLE_MISSING_THE_UNIQUE, 3: ARTICLE_MISSING_THE_UNIQUE}
    why: "Vật thể duy nhất → 'the sun'."
  - id: t2
    type: mcq
    q: "'I think ___ is important for everyone.' (nói chung)"
    options: ["the education", "an education", "education", "a education"]
    answer: 2
    difficulty: core
    distractor_tags: {0: ARTICLE_THE_WITH_GENERAL, 1: ARTICLE_A_WITH_UNCOUNT_OR_PLURAL, 3: ARTICLE_A_WITH_UNCOUNT_OR_PLURAL}
    why: "Danh từ không đếm được nói chung → zero article: 'education'."
  - id: t3
    type: error_id
    q: "Chọn phần SAI."
    sentence: "I come from [the] [Vietnam]."
    spans: ["the", "Vietnam"]
    answer: 0
    difficulty: core
    error_tag: ARTICLE_THE_WITH_COUNTRY
    why: "Tên nước số ít không dùng 'the': 'from Vietnam'."
  - id: t4
    type: mcq
    q: "Choose the correct phrase: 'She gave me ___.'"
    options: ["an advice", "two advices", "some advice", "many advice"]
    answer: 2
    difficulty: core
    distractor_tags: {0: ARTICLE_A_WITH_UNCOUNT_OR_PLURAL, 1: PLURAL_AGREEMENT, 3: PLURAL_AGREEMENT}
    why: "'advice' không đếm được → 'some advice'. Không 'an advice'/'advices'/'many advice'."
  - id: t5
    type: word_bank
    q: "Sắp xếp thành câu đúng."
    bank: ["He", "bought", "a", "an", "umbrella", "yesterday"]
    answer_seq: ["He", "bought", "an", "umbrella", "yesterday"]
    difficulty: intro
    error_tag: ARTICLE_A_VS_AN
    why: "'umbrella' bắt đầu bằng âm nguyên âm → 'an' (token 'a' là nhiễu)."
  - id: t6
    type: match
    q: "Ghép loại danh từ với mạo từ phù hợp (lần đầu nhắc, nói chung)."
    left: ["danh từ đếm được số ít", "vật thể duy nhất", "danh từ không đếm được nói chung"]
    right: ["the", "zero (—)", "a/an"]
    answer: {0: 2, 1: 0, 2: 1}
    difficulty: core
  - id: t7
    type: mcq
    q: "'There is a book on the table. ___ book is mine.'"
    options: ["A", "An", "The", "—"]
    answer: 2
    difficulty: core
    distractor_tags: {0: ARTICLE_MISSING_THE_UNIQUE, 1: ARTICLE_MISSING_THE_UNIQUE, 3: ARTICLE_MISSING_THE_UNIQUE}
    why: "Nhắc lại lần 2 (đã xác định) → 'The book'."
  - id: t8
    type: mcq
    q: "'Mount Everest is ___ highest mountain in the world.'"
    options: ["a", "an", "the", "—"]
    answer: 2
    difficulty: stretch
    distractor_tags: {0: ARTICLE_OMISSION, 1: ARTICLE_A_VS_AN, 3: ARTICLE_MISSING_THE_UNIQUE}
    why: "So sánh nhất + vật duy nhất → 'the highest mountain' (bắt buộc 'the', không có biến thể khác)."
  - id: t9
    type: mcq
    q: "'I'd like to become ___ engineer.'"
    options: ["a", "an", "the", "—"]
    answer: 1
    difficulty: core
    distractor_tags: {0: ARTICLE_A_VS_AN, 2: ARTICLE_THE_WITH_GENERAL, 3: ARTICLE_OMISSION}
    why: "'engineer' bắt đầu bằng âm nguyên âm /e/ → 'an'."
  - id: t10
    type: error_id
    q: "Chọn phần SAI."
    sentence: "[The] [happiness] is more important than money."
    spans: ["The", "happiness"]
    answer: 0
    difficulty: core
    error_tag: ARTICLE_THE_WITH_GENERAL
    why: "'happiness' nói chung (trừu tượng, không xác định) → bỏ 'the'."
```
````
> *(End-test này 10 câu — minh hoạ đầu cao của range 8–12; bài rộng nên nhắm 10–12, bài hẹp 8.)*

---

## 4. `error-clinic/article-errors` — band 6.0–7.0
**Anchor status: TỐT** — 7 anchor đều có marker body. *(Bổ trợ cho bài #3; tập trung error-correction.)*

````markdown
<!-- anchor: article-errors.common-mistake.a-vs-an-confusion -->
### Lỗi 3: Nhầm "a" với "an"
...nội dung...

```checkup
section_ref: article-errors.common-mistake.a-vs-an-confusion
items:
  - id: q1
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "It took [a] hour to finish [the] report."
    spans: ["a", "the"]
    answer: 0
    difficulty: intro
    error_tag: ARTICLE_A_VS_AN
    why: "'hour' âm nguyên âm (h câm) → 'an hour'."
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "He is [an] [European] student."
    spans: ["an", "European"]
    answer: 0
    difficulty: core
    error_tag: ARTICLE_A_VS_AN
    why: "'European' bắt đầu bằng âm /j/ ('you-') → 'a European'."
```
````

````markdown
```endtest
title: "Test cuối bài — Article Errors"
shuffle: true
items:
  - id: t1
    type: error_id
    q: "Chọn phần SAI."
    sentence: "[Money] is important, but [the] health is more important."
    spans: ["Money", "the"]
    answer: 1
    difficulty: core
    error_tag: ARTICLE_THE_WITH_GENERAL
    why: "'health' nói chung → bỏ 'the'."
  - id: t2
    type: mcq
    q: "Choose the correct sentence."
    options: ["I need informations.", "I need an information.", "I need some information.", "I need the informations."]
    answer: 2
    difficulty: core
    distractor_tags: {0: PLURAL_AGREEMENT, 1: ARTICLE_A_WITH_UNCOUNT_OR_PLURAL, 3: PLURAL_AGREEMENT}
    why: "'information' không đếm được, không số nhiều → 'some information'."
  - id: t3
    type: error_id
    q: "Chọn phần SAI."
    sentence: "She wants to be [doctor] in [the] future."
    spans: ["doctor", "the"]
    answer: 0
    difficulty: intro
    error_tag: ARTICLE_OMISSION
    why: "Nghề nghiệp số ít → 'a doctor'. ('in the future' đúng)."
  - id: t4
    type: word_bank
    q: "Sắp xếp thành câu đúng."
    bank: ["The", "Earth", "the", "goes", "around", "Sun"]
    answer_seq: ["The", "Earth", "goes", "around", "the", "Sun"]
    difficulty: core
    error_tag: ARTICLE_MISSING_THE_UNIQUE
    why: "Vật thể duy nhất: 'the Earth', 'the Sun'."
  - id: t5
    type: mcq
    q: "'My grandfather is ___ honest man.'"
    options: ["a", "an", "the", "—"]
    answer: 1
    difficulty: core
    distractor_tags: {0: ARTICLE_A_VS_AN, 2: ARTICLE_THE_WITH_GENERAL, 3: ARTICLE_OMISSION}
    why: "'honest' có 'h' CÂM → bắt đầu bằng âm nguyên âm /ɒ/ → 'an', dù viết bằng 'h'."
  - id: t6
    type: error_id
    q: "Chọn phần SAI."
    sentence: "Can you give me [a] [advice]?"
    spans: ["a", "advice"]
    answer: 0
    difficulty: core
    error_tag: ARTICLE_A_WITH_UNCOUNT_OR_PLURAL
    why: "'advice' không đếm được → 'some advice' / 'a piece of advice'."
  - id: t7
    type: match
    q: "Ghép câu với lỗi mạo từ."
    left: ["She is teacher.", "I love the nature.", "from the Japan"]
    right: ["thừa 'the' với danh từ chung", "thừa 'the' với tên nước", "thiếu 'a'"]
    answer: {0: 2, 1: 0, 2: 1}
    difficulty: core
  - id: t8
    type: mcq
    q: "'He is one of ___ best students in the class.'"
    options: ["a", "an", "the", "—"]
    answer: 2
    difficulty: stretch
    distractor_tags: {0: ARTICLE_OMISSION, 1: ARTICLE_A_VS_AN, 3: ARTICLE_MISSING_THE_UNIQUE}
    why: "So sánh nhất → 'the best'."
```
````

---

## 5. `error-clinic/subject-verb-agreement` — band 6.0–7.0
**⚠ Anchor status:** khai 3, body **0 marker** → **tất cả cần thêm marker (C1)** trước khi cuộn được. Tag hiện: `subject_verb_disagreement` (map → `SVA_*`).

````markdown
<!-- anchor: subject-verb-agreement.common-mistake.he-she-it-no-s -->
## Quy tắc cơ bản  (mục ngôi 3 số ít thêm -s)
...nội dung...

```checkup
section_ref: subject-verb-agreement.common-mistake.he-she-it-no-s
items:
  - id: q1
    type: mcq
    q: "Choose the correct form: 'My sister ___ in a bank.'"
    options: ["work", "works", "working", "are working"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: SVA_THIRD_PERSON_S_DROP, 2: BARE_ING, 3: WRONG_TENSE}
    why: "Chủ ngữ ngôi 3 số ít → động từ + -s: 'works'."
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "He [don't] [enjoy] crowded places."
    spans: ["don't", "enjoy"]
    answer: 0
    difficulty: core
    error_tag: AUX_DO_AGREEMENT
    why: "Ngôi 3 số ít phủ định → 'doesn't'."
```
````

````markdown
<!-- anchor: subject-verb-agreement.collective-nouns -->
## Bẫy thường gặp và cách xử lý  (danh từ tập hợp / cụm chen giữa)
...nội dung...

```checkup
section_ref: subject-verb-agreement.collective-nouns
items:
  - id: q1
    type: mcq
    q: "Choose the correct form: 'The list of items ___ on the desk.'"
    options: ["are", "is", "were", "have been"]
    answer: 1
    difficulty: core
    distractor_tags: {0: SVA_INTERVENING_PHRASE, 2: SVA_INTERVENING_PHRASE, 3: SVA_INTERVENING_PHRASE}
    why: "Chủ ngữ thật là 'The list' (số ít) → 'is'; 'of items' chỉ chen giữa."
    band: "Chia động từ đúng theo chủ ngữ thật = giảm 'basic error' band 7."
  - id: q2
    type: mcq
    q: "Choose the correct form: 'A number of students ___ absent today.'"
    options: ["is", "was", "are", "has been"]
    answer: 2
    difficulty: stretch
    distractor_tags: {0: SVA_COLLECTIVE_NOUN, 1: SVA_COLLECTIVE_NOUN, 3: SVA_COLLECTIVE_NOUN}
    why: "'A number of + danh từ số nhiều' → động từ số nhiều: 'are'. (≠ 'the number of' → số ít)."
```
````

````markdown
```endtest
title: "Test cuối bài — Subject–Verb Agreement"
shuffle: true
items:
  - id: t1
    type: error_id
    q: "Chọn phần SAI."
    sentence: "Each of the students [have] [submitted] the assignment."
    spans: ["have", "submitted"]
    answer: 0
    difficulty: stretch
    error_tag: SVA_INTERVENING_PHRASE
    why: "'Each' luôn số ít → 'has submitted'."
  - id: t2
    type: mcq
    q: "'My friend ___ to play badminton on weekends.'"
    options: ["like", "likes", "are liking", "liking"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: SVA_THIRD_PERSON_S_DROP, 2: WRONG_TENSE, 3: BARE_ING}
    why: "Ngôi 3 số ít → 'likes'."
  - id: t3
    type: word_bank
    q: "Sắp xếp thành câu đúng."
    bank: ["She", "doesn't", "don't", "watch", "TV", "much"]
    answer_seq: ["She", "doesn't", "watch", "TV", "much"]
    difficulty: core
    error_tag: AUX_DO_AGREEMENT
    why: "Ngôi 3 số ít phủ định → 'doesn't' (token 'don't' là nhiễu)."
  - id: t4
    type: mcq
    q: "'There ___ a lot of people at the festival.'"
    options: ["was", "were", "is", "has been"]
    answer: 1
    difficulty: core
    distractor_tags: {0: SVA_INTERVENING_PHRASE, 2: PLURAL_AGREEMENT, 3: SVA_INTERVENING_PHRASE}
    why: "'people' số nhiều → 'There were'."
  - id: t5
    type: error_id
    q: "Chọn phần SAI."
    sentence: "The news about the floods [were] [shocking]."
    spans: ["were", "shocking"]
    answer: 0
    difficulty: stretch
    error_tag: SVA_COLLECTIVE_NOUN
    why: "'news' tuy có 's' nhưng KHÔNG đếm được, số ít → 'was'."
  - id: t6
    type: mcq
    q: "'My sister ___ going on holiday next week.'"
    options: ["is", "are", "am", "be"]
    answer: 0
    difficulty: intro
    distractor_tags: {1: SVA_THIRD_PERSON_S_DROP, 2: SVA_THIRD_PERSON_S_DROP, 3: BARE_ING}
    why: "'My sister' số ít → 'is going'. (Tránh danh từ tập hợp như 'family/team' vì BrE chấp nhận cả số nhiều.)"
  - id: t7
    type: match
    q: "Ghép chủ ngữ với động từ đúng."
    left: ["She", "They", "The news"]
    right: ["are ready", "works hard", "is shocking"]
    answer: {0: 1, 1: 0, 2: 2}
    difficulty: core
  - id: t8
    type: order
    q: "Sắp xếp thành câu đúng."
    bank: ["The", "number", "of", "tourists", "has", "increased"]
    answer_seq: ["The", "number", "of", "tourists", "has", "increased"]
    difficulty: stretch
    why: "'The number of + N số nhiều' → động từ SỐ ÍT: 'has increased'."
```
````

---

## 6. `verb-patterns/gerund-vs-infinitive` — band 6.0–7.0
**⚠ Tiền đề:** MERGE COMPOSITE nặng (75 H2, deep-dive remember/forget/stop/try/need... ghép vào). **De-dup TRƯỚC** (giữ bài chính + các deep-dive slug riêng nếu cần). Anchor: 13 khai / 7 marker — `gerund-only`, `infinitive-only`, `common-mistake.wrong-form-after-verb` **cần thêm marker (C1)**.

````markdown
<!-- anchor: gerund-vs-infinitive.common-mistake.wrong-form-after-verb -->
## Lỗi thường gặp
...nội dung...

```checkup
section_ref: gerund-vs-infinitive.common-mistake.wrong-form-after-verb
items:
  - id: q1
    type: mcq
    q: "Choose the correct form: 'I enjoy ___ to music in my free time.'"
    options: ["to listen", "listening", "listen", "listened"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: GI_WRONG_FORM_AFTER_VERB, 2: BARE_ING, 3: WRONG_PARTICIPLE}
    why: "'enjoy' luôn + V-ing → 'listening'."
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "She decided [studying] abroad to [improve] her English."
    spans: ["studying", "improve"]
    answer: 0
    difficulty: core
    error_tag: GI_WRONG_FORM_AFTER_VERB
    why: "'decide' + to V → 'to study'."
```
````

````markdown
<!-- anchor: gerund-vs-infinitive.both-different-meaning.stop -->
### STOP + V-ing vs to V
...nội dung...

```checkup
section_ref: gerund-vs-infinitive.both-different-meaning.stop
items:
  - id: q1
    type: mcq
    q: "Chọn câu nghĩa 'Anh ấy đã BỎ hút thuốc 10 năm trước.'"
    options: ["He stopped to smoke 10 years ago.", "He stopped smoking 10 years ago.", "He stopped smoke 10 years ago.", "He stops smoking 10 years ago."]
    answer: 1
    difficulty: stretch
    distractor_tags: {0: GI_STOP_MEANING, 2: BARE_ING, 3: WRONG_TENSE}
    why: "stop + V-ing = ngừng làm việc đó. (stop + to V = dừng lại ĐỂ làm việc khác)."
    band: "Phân biệt đúng cặp gerund/infinitive đổi nghĩa = dùng cấu trúc linh hoạt → band 7+."
```
````

````markdown
```endtest
title: "Test cuối bài — Gerund vs Infinitive"
shuffle: true
items:
  - id: t1
    type: mcq
    q: "'I want ___ a doctor in the future.'"
    options: ["becoming", "to become", "become", "became"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: GI_WRONG_FORM_AFTER_VERB, 2: BARE_ING, 3: WRONG_TENSE}
    why: "'want' + to V → 'to become'."
  - id: t2
    type: error_id
    q: "Chọn phần SAI."
    sentence: "He avoids [to eat] fast food to [stay] healthy."
    spans: ["to eat", "stay"]
    answer: 0
    difficulty: core
    error_tag: GI_WRONG_FORM_AFTER_VERB
    why: "'avoid' + V-ing → 'eating'."
  - id: t3
    type: mcq
    q: "'Remember ___ the door before you leave.' (lời nhắc làm việc sắp tới)"
    options: ["locking", "to lock", "lock", "locked"]
    answer: 1
    difficulty: stretch
    distractor_tags: {0: GI_REMEMBER_FORGET_MEANING, 2: BARE_ING, 3: WRONG_TENSE}
    why: "remember + to V = nhớ ĐỂ làm (việc tương lai). (remember + V-ing = nhớ ĐÃ làm)."
  - id: t4
    type: word_bank
    q: "Sắp xếp thành câu đúng."
    bank: ["She", "suggested", "to go", "going", "to", "the", "beach"]
    answer_seq: ["She", "suggested", "going", "to", "the", "beach"]
    difficulty: core
    error_tag: GI_WRONG_FORM_AFTER_VERB
    why: "'suggest' + V-ing → 'going' (token 'to go' là nhiễu)."
  - id: t5
    type: mcq
    q: "'I look forward to ___ you soon.'"
    options: ["see", "seeing", "to see", "saw"]
    answer: 1
    difficulty: stretch
    distractor_tags: {0: BARE_ING, 2: GI_WRONG_FORM_AFTER_VERB, 3: WRONG_TENSE}
    why: "'look forward to' + V-ing (to là giới từ) → 'seeing'."
  - id: t6
    type: match
    q: "Ghép động từ với dạng theo sau."
    left: ["want", "finish", "look forward to"]
    right: ["+ to V", "+ V-ing", "+ V-ing (vì 'to' là giới từ)"]
    answer: {0: 0, 1: 1, 2: 2}
    difficulty: core
  - id: t7
    type: mcq
    q: "'My doctor advised me ___ more water.'"
    options: ["drinking", "to drink", "drink", "drank"]
    answer: 1
    difficulty: core
    distractor_tags: {0: GI_WRONG_FORM_AFTER_VERB, 2: BARE_ING, 3: WRONG_TENSE}
    why: "'advise + somebody + to V' → 'to drink'."
  - id: t8
    type: order
    q: "Sắp xếp thành câu đúng."
    bank: ["They", "kept", "talking", "during", "the", "film"]
    answer_seq: ["They", "kept", "talking", "during", "the", "film"]
    difficulty: core
    why: "'keep' + V-ing (tiếp tục) → 'talking'."
```
````

---

## 7. `tenses/present-perfect` — band 6.0–7.0  *(thêm sample tense)*
**⚠ Anchor status:** khai 9, body chỉ 2 marker (`overview`, `common-mistake.past-simple-where-pp-needed`). ⇒ `with-time-markers.since-vs-for` **cần thêm marker (C1)**. Tag hiện: `wrong_tense`.

````markdown
<!-- anchor: present-perfect.with-time-markers.since-vs-for -->
## Since vs For
...nội dung...

```checkup
section_ref: present-perfect.with-time-markers.since-vs-for
items:
  - id: q1
    type: mcq
    q: "Choose the correct word: 'I have lived in this city ___ 2015.'"
    options: ["since", "for", "from", "in"]
    answer: 0
    difficulty: intro
    distractor_tags: {1: PREP_WRONG, 2: PREP_WRONG, 3: PREP_WRONG}
    why: "'since' + MỐC thời gian (2015). 'for' đi với KHOẢNG thời gian; 'from/in' sai với hiện tại hoàn thành."
  - id: q2
    type: mcq
    q: "Choose the correct form: 'We ___ each other since university.'"
    options: ["know", "have known", "knew", "are knowing"]
    answer: 1
    difficulty: core
    distractor_tags: {0: PRESENT_FOR_PERFECT_SINCE_FOR, 2: PAST_FOR_PRESENT_PERFECT, 3: TENSE_CONTINUOUS_FOR_FACT}
    why: "'since' → hiện tại hoàn thành 'have known'. 'know' (hiện tại đơn) là lỗi người Việt hay mắc."
    band: "Dùng đúng hiện tại hoàn thành với since/for = dải thì linh hoạt → GRA band 7."
```
````

````markdown
<!-- anchor: present-perfect.common-mistake.past-simple-where-pp-needed -->
## Lỗi phổ biến của người Việt — Dùng past simple thay vì present perfect
...nội dung...

```checkup
section_ref: present-perfect.common-mistake.past-simple-where-pp-needed
items:
  - id: q1
    type: mcq
    q: "Choose the correct form: 'I ___ this film three times, so I know it well.'"
    options: ["saw", "have seen", "see", "had seen"]
    answer: 1
    difficulty: core
    distractor_tags: {0: PAST_FOR_PRESENT_PERFECT, 2: WRONG_TENSE, 3: WRONG_TENSE}
    why: "Kinh nghiệm tính tới hiện tại → hiện tại hoàn thành 'have seen'."
  - id: q2
    type: error_id
    q: "Chọn phần gạch chân SAI."
    sentence: "She [has worked] here [for five years ago]."
    spans: ["has worked", "for five years ago"]
    answer: 1
    difficulty: stretch
    error_tag: WRONG_TENSE
    why: "'ago' đi với quá khứ đơn; với hiện tại hoàn thành dùng 'for five years' (bỏ 'ago')."
```
````

````markdown
```endtest
title: "Test cuối bài — Present Perfect"
shuffle: true
items:
  - id: t1
    type: mcq
    q: "'I ___ my homework already.'"
    options: ["finished", "have finished", "finish", "had finished"]
    answer: 1
    difficulty: intro
    distractor_tags: {0: PAST_FOR_PRESENT_PERFECT, 2: WRONG_TENSE, 3: WRONG_TENSE}
    why: "'already' → hiện tại hoàn thành 'have finished'."
  - id: t2
    type: error_id
    q: "Chọn phần SAI."
    sentence: "He [has went] to the gym [twice] this week."
    spans: ["has went", "twice"]
    answer: 0
    difficulty: core
    error_tag: WRONG_PARTICIPLE
    why: "Phân từ của 'go' là 'gone' → 'has gone'."
  - id: t3
    type: mcq
    q: "'They ___ in this city for ten years.'"
    options: ["live", "have lived", "lived", "are living"]
    answer: 1
    difficulty: core
    distractor_tags: {0: PRESENT_FOR_PERFECT_SINCE_FOR, 2: PAST_FOR_PRESENT_PERFECT, 3: TENSE_CONTINUOUS_FOR_FACT}
    why: "'for ten years' (tới hiện tại) → hiện tại hoàn thành 'have lived'."
  - id: t4
    type: word_bank
    q: "Sắp xếp thành câu đúng."
    bank: ["She", "has", "just", "arrived", "arrive"]
    answer_seq: ["She", "has", "just", "arrived"]
    difficulty: core
    error_tag: WRONG_PARTICIPLE
    why: "'has just' + phân từ → 'arrived' (token 'arrive' là nhiễu)."
  - id: t5
    type: mcq
    q: "'___ you finished the report ___?'"
    options: ["Did / yet", "Have / yet", "Have / ago", "Do / yet"]
    answer: 1
    difficulty: core
    distractor_tags: {0: PAST_FOR_PRESENT_PERFECT, 2: WRONG_TENSE, 3: WRONG_TENSE}
    why: "'yet' trong câu hỏi → hiện tại hoàn thành 'Have you finished ... yet?'."
  - id: t6
    type: match
    q: "Ghép dấu hiệu thời gian với thì."
    left: ["already", "since", "ago"]
    right: ["past simple", "present perfect (mốc bắt đầu)", "present perfect (đã hoàn thành)"]
    answer: {0: 2, 1: 1, 2: 0}
    difficulty: core
  - id: t7
    type: mcq
    q: "'This is the first time I ___ sushi.'"
    options: ["try", "have tried", "tried", "am trying"]
    answer: 1
    difficulty: stretch
    distractor_tags: {0: WRONG_TENSE, 2: PAST_FOR_PRESENT_PERFECT, 3: TENSE_CONTINUOUS_FOR_FACT}
    why: "'It's the first time' + hiện tại hoàn thành → 'have tried'."
  - id: t8
    type: order
    q: "Sắp xếp thành câu hỏi đúng."
    bank: ["Have", "you", "ever", "visited", "London"]
    answer_seq: ["Have", "you", "ever", "visited", "London"]
    difficulty: core
    why: "Câu hỏi kinh nghiệm: Have + S + ever + V3?"
```
````

---

## Ghi chú tổng (cho người duyệt)
- **2 bài sẵn-anchor (articles, article-errors)** → migrate được NGAY (C3-pilot tốt). **5 bài còn lại cần C1 trước** (backfill marker; conditionals/gerund-inf cần **de-dup**; present-perfect cần marker `since-vs-for`).
- Mọi câu có **1 đáp án theo dụng ý**; các biên **dialect/register** (vd was/were, danh từ tập hợp BrE, mạo từ phụ thuộc ngữ cảnh) đã được **né hoặc gắn cờ** để tránh false-fail — KHÔNG tự nhận "0 false-fail tuyệt đối", mà là "đã loại các trap đã biết". Distractor là **lỗi L1 thật** gắn tag `error_tags.yaml`.
- Khi sinh hàng loạt: bắt chước đúng độ chi tiết `why` + chất lượng distractor này; chạy checklist QA (PROMPT §B) 100% answer-key.

---

# PHẦN C — DỮ LIỆU

## C.1 ▸ grammar_article_survey.csv (khảo sát 98 bài, per-bài)
*(nhúng nguyên văn — `grammar_article_survey.csv`. Cột chính: anchor khai-frontmatter vs marker-body vs gap, tag, H2/H3, words, in-prose-ex. **Lưu ý:** cột anchor/gap phản ánh **trước A3** — hiện gap đã = 0; dùng csv cho ưu tiên 6→7, words, in-prose, tag thiếu.)*

`````csv
category,slug,title,level,status,band_relevance,speaking_rel,writing_rel,has_anchors_fm,n_anchor_fm,n_anchor_body,anchor_integrity_gap,n_cet,n_polluted,n_real_tag,polluted,h2,h3,words,in_prose_ex,has_prereq,has_next
error-clinic,affect-vs-effect,Affect vs. Effect — Động từ hay Danh từ?,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,10,13,1401,1,1,1
error-clinic,article-errors,Lỗi dùng mạo từ a / an / the — Article E,intermediate,complete,"6.0,6.5,7.0",high,high,1,7,7,0,2,0,2,,7,15,1652,1,1,1
error-clinic,do-vs-make,"Do vs. Make — Phân biệt ""làm"" trong tiến",beginner,complete,"5.0,6.0",high,high,0,0,0,0,1,0,1,,9,19,1591,1,1,1
error-clinic,double-subject-errors,Double Subject Errors — Lỗi lặp chủ ngữ,beginner,complete,"5.0,6.0",high,high,0,0,0,0,1,0,1,,9,10,1141,1,1,1
error-clinic,economic-vs-economical,"Economic vs. Economical — Hai tính từ, h",intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,10,11,1441,1,1,1
error-clinic,historic-vs-historical,Historic vs. Historical — Sự kiện lịch s,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,10,10,1599,1,1,1
error-clinic,missing-main-verbs,Missing Main Verbs — Lỗi thiếu động từ c,beginner,complete,"5.0,6.0",high,high,1,5,5,0,1,0,1,,10,10,1358,1,1,1
error-clinic,missing-subjects,Missing Subjects — Lỗi thiếu chủ ngữ,beginner,complete,"5.0,6.0",high,high,1,5,5,0,1,0,1,,10,10,1455,1,1,1
error-clinic,overusing-i-think,"Overusing ""I think"" — Đừng lặp ""I think""",beginner,complete,"5.0,6.0",high,high,0,0,0,0,1,0,1,,13,29,2747,1,1,1
error-clinic,preposition-errors,Lỗi dùng giới từ — Preposition Errors,intermediate,complete,"6.0,6.5,7.0",high,high,1,4,4,0,2,0,2,,11,15,2320,1,1,1
error-clinic,run-on-sentences,Run-On Sentences — Câu chạy liên tục khô,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,2,0,2,,11,11,1693,1,1,1
error-clinic,say-tell-speak-talk,Say / Tell / Speak / Talk — Phân biệt bố,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,11,25,1782,1,1,1
error-clinic,sentence-fragments,Sentence Fragments — Câu không hoàn chỉn,intermediate,complete,"6.0,6.5,7.0",high,high,1,4,4,0,1,0,1,,11,12,1573,1,1,1
error-clinic,subject-verb-agreement,Subject-Verb Agreement — Sự hoà hợp giữa,intermediate,complete,"6.0,6.5,7.0",medium,high,1,3,0,3,1,0,1,,8,18,1808,1,1,1
error-clinic,tense-consistency,Tense Consistency — Nhất quán thì trong ,intermediate,complete,"6.0,6.5,7.0",high,high,1,5,5,0,2,0,2,,11,17,2200,1,1,1
error-clinic,word-form-errors,Word Form Errors — Sai dạng từ,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,10,21,2066,1,1,1
error-clinic,wrong-pronoun-reference,Wrong Pronoun Reference — Lỗi đại từ tha,intermediate,complete,"6.0,6.5,7.0",high,high,1,4,4,0,1,0,1,,10,9,1521,1,1,1
foundations,articles-a-an-sound-rules,"A vs. An — Quy tắc dựa trên âm, không dự",beginner,complete,"5.0,6.0",medium,medium,1,4,4,0,1,0,1,,12,11,1483,1,1,1
foundations,articles-with-places-and-names,Articles with Places and Names — Mạo từ ,intermediate,complete,"6.0,6.5,7.0",medium,medium,0,0,0,0,1,0,1,,15,19,1650,1,1,1
foundations,articles,"Articles — A, An, The (Mạo từ)",intermediate,complete,"6.0,6.5,7.0",high,high,1,9,9,0,1,0,1,,12,17,2546,1,1,1
foundations,countable-vs-uncountable,Countable vs. Uncountable Nouns (Danh từ,beginner,complete,"5.0,6.0",medium,medium,1,7,2,5,1,0,1,,14,23,2842,1,1,1
foundations,few-a-few-little-a-little,Few / A few / Little / A little — Phân b,beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,0,0,0,,13,13,1787,1,1,1
foundations,many-much-a-lot-of,Many / Much / A lot of — Phân biệt từ ch,beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,0,0,0,,13,10,1585,1,1,1
foundations,noun-phrase-basics,Noun Phrase Basics — Cấu trúc cụm danh t,beginner,complete,"5.0,6.0",high,high,0,0,0,0,0,0,0,,11,25,1920,1,1,1
foundations,other-another-the-other-others,Other / Another / The Other / Others — P,beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,1,0,1,,12,9,1783,1,1,1
foundations,parts-of-speech,Parts of Speech (Từ loại),beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,0,0,0,,13,21,1895,1,0,1
foundations,phrase-vs-clause,Phrase vs. Clause (Cụm từ và Mệnh đề),beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,0,0,0,,13,19,2132,1,1,1
foundations,sentence-elements,Sentence Elements (Thành phần câu),beginner,complete,"5.0,6.0",high,high,0,0,0,0,0,0,0,,13,20,2105,1,1,1
foundations,singular-vs-plural,Singular vs. Plural (Số ít và Số nhiều),beginner,complete,"5.0,6.0",medium,medium,1,4,4,0,1,0,1,,13,24,2472,1,1,1
foundations,some-any-no,Some / Any / No — Phân biệt và cách dùng,intermediate,complete,"6.0,6.5,7.0",medium,medium,1,4,4,0,0,0,0,,11,19,1671,1,1,1
foundations,there-is-there-are,There is / There are — Cấu trúc giới thi,beginner,complete,"5.0,6.0",medium,medium,1,2,0,2,0,0,0,,11,26,2077,1,1,1
foundations,there-is-vs-it-is,There is / There are vs. It is — Giới th,beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,0,0,0,,10,16,1671,1,1,1
foundations,this-that-these-those-in-use,This / That / These / Those in Use — Dùn,beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,0,0,0,,12,21,1538,1,1,1
foundations,word-order,Word Order — Trật tự từ trong câu tiếng ,beginner,complete,"5.0,6.0",high,high,1,6,5,1,1,0,1,,14,11,1695,1,1,1
foundations,zero-article,Zero Article — Khi nào không dùng mạo từ,intermediate,complete,"6.0,6.5,7.0",medium,medium,1,4,4,0,1,0,1,,13,8,1780,1,1,1
grammar-for-meaning,academic-hedging,Academic Hedging — Diễn đạt thận trọng t,advanced,complete,"7.0,7.5,8.0",medium,high,0,0,0,0,0,0,0,,12,23,2139,1,1,1
grammar-for-meaning,although-though-even-though,Although / Though / Even Though — Diễn đ,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,10,20,1728,1,1,1
grammar-for-meaning,because-vs-because-of,Because vs. Because of — Nối nguyên nhân,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,3,0,3,,11,12,1469,1,1,1
grammar-for-meaning,comparison,Comparatives & Superlatives — So sánh,intermediate,complete,"6.0,6.5,7.0",high,high,1,8,2,6,1,0,1,,11,24,1925,1,1,1
grammar-for-meaning,conditionals,Conditionals — Câu điều kiện,intermediate,complete,"6.0,6.5,7.0",high,high,1,12,2,10,1,0,1,,23,31,3443,1,1,1
grammar-for-meaning,despite-vs-in-spite-of,Despite vs. In spite of — Diễn đạt sự tư,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,4,0,4,,11,15,1717,1,1,1
grammar-for-meaning,discourse-markers-spoken,Discourse Markers in Speech — Liên kết ý,advanced,complete,"7.0,7.5,8.0",high,low,1,12,12,0,2,0,2,,8,13,1927,1,1,1
grammar-for-meaning,discourse-markers,Discourse Markers — Liên kết ý trong bài,intermediate,complete,"6.0,6.5,7.0",high,high,1,8,4,4,1,0,1,,31,46,5415,1,1,1
grammar-for-meaning,grammatical-collocations,Grammatical Collocations — Cụm ngữ pháp ,advanced,complete,"7.0,7.5,8.0",high,high,1,13,13,0,2,0,2,,10,13,2270,0,1,1
grammar-for-meaning,hedging-language,Hedging Language — Diễn đạt thận trọng v,advanced,complete,"7.0,7.5,8.0",high,high,1,9,1,8,1,0,1,,22,30,3536,1,1,1
grammar-for-meaning,quantifiers,Quantifiers — Từ chỉ số lượng,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,0,0,0,,12,24,1900,1,1,1
grammar-for-meaning,so-vs-such,So vs. Such — Nhấn mạnh mức độ đúng cách,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,10,11,1383,1,1,1
ielts-grammar-lab,adding-reasons-clearly,Adding Reasons Clearly — Đưa ra lý do rõ,intermediate,complete,"6.0,6.5,7.0",high,medium,0,0,0,0,2,0,2,,12,17,1994,1,1,1
ielts-grammar-lab,agreeing-and-disagreeing-naturally,Agreeing and Disagreeing Naturally — Đồn,advanced,complete,"7.0,7.5,8.0",high,medium,0,0,0,0,1,0,1,,12,15,1700,1,1,1
ielts-grammar-lab,common-ielts-grammar-mistakes,10 lỗi ngữ pháp hay gặp nhất trong IELTS,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,0,0,0,,14,32,2509,1,1,1
ielts-grammar-lab,comparing-ideas-in-speaking,Comparing Ideas in Speaking — So sánh ý ,intermediate,complete,"6.0,6.5,7.0",high,medium,0,0,0,0,2,0,2,,10,17,1748,1,1,1
ielts-grammar-lab,conditionals-in-speaking,Conditionals in Speaking — Dùng câu điều,advanced,complete,"7.0,7.5,8.0",high,medium,0,0,0,0,1,0,1,,11,20,1744,1,1,1
ielts-grammar-lab,expressing-preferences-naturally,Expressing Preferences Naturally — Thể h,intermediate,complete,"6.0,6.5,7.0",high,medium,1,4,4,0,0,0,0,,10,15,1476,0,1,1
ielts-grammar-lab,giving-examples-naturally,Giving Examples Naturally — Đưa ví dụ tự,intermediate,complete,"6.0,6.5,7.0",high,medium,0,0,0,0,0,0,0,,15,15,2127,1,1,1
ielts-grammar-lab,grammar-for-band7plus,Grammar cho Band 7+,advanced,complete,"7.0,7.5,8.0",high,high,1,8,0,8,1,0,1,,23,51,4536,1,1,1
ielts-grammar-lab,grammar-in-speaking,Grammar cho IELTS Speaking,intermediate,complete,"6.0,6.5,7.0",high,medium,1,7,0,7,0,0,0,,11,21,2367,1,1,1
ielts-grammar-lab,making-answers-longer-naturally,Making Answers Longer Naturally — Kéo dà,advanced,complete,"7.0,7.5,8.0",high,medium,0,0,0,0,0,0,0,,12,6,1978,1,1,1
ielts-grammar-lab,pronunciation-grammar-link,Pronunciation–Grammar Link — Liên hệ phá,advanced,complete,"6.5,7.0,7.5",high,low,1,10,10,0,3,0,3,,6,10,1479,1,1,1
ielts-grammar-lab,softening-disagreement-politely,Softening Disagreement Politely — Phản đ,intermediate,complete,"6.0,6.5,7.0",high,medium,0,0,0,0,0,0,0,,10,17,1610,0,1,1
ielts-grammar-lab,speculating-about-the-future,Speculating About the Future — Suy đoán ,intermediate,complete,"6.0,6.5,7.0",high,medium,0,0,0,0,0,0,0,,12,6,1607,1,1,1
ielts-grammar-lab,strong-vs-cautious-opinions,Strong vs. Cautious Opinions — Thể hiện ,advanced,complete,"7.0,7.5,8.0",high,medium,0,0,0,0,0,0,0,,10,18,1876,1,1,1
ielts-grammar-lab,talking-about-changes-over-time,Talking About Changes Over Time — Diễn đ,intermediate,complete,"6.0,6.5,7.0",high,medium,0,0,0,0,2,0,2,,12,8,1770,1,1,1
ielts-grammar-lab,talking-about-future-plans,Talking About Future Plans — Diễn đạt kế,intermediate,complete,"6.0,6.5,7.0",high,medium,1,4,4,0,1,0,1,,11,19,1898,1,1,1
ielts-grammar-lab,talking-about-habits-and-routines,Talking About Habits and Routines — Kể v,beginner,complete,"5.0,6.0",high,medium,0,0,0,0,2,0,2,,10,16,1583,0,1,1
ielts-grammar-lab,talking-about-past-experiences,Talking About Past Experiences — Kể về t,intermediate,complete,"6.0,6.5,7.0",high,medium,1,4,4,0,1,0,1,,11,12,1784,1,1,1
modifiers,adjective-vs-adverb,Adjective vs. Adverb (Tính từ hay Trạng ,beginner-intermediate,complete,"6.0,6.5,7.0",medium,medium,0,0,0,0,0,0,0,,13,18,2619,1,1,1
modifiers,adjectives,Adjectives (Tính từ),beginner,complete,"5.0,6.0",medium,medium,1,2,0,2,0,0,0,,13,22,2476,1,1,1
modifiers,adverbs,Adverbs (Trạng từ),beginner-intermediate,complete,"6.0,6.5,7.0",medium,medium,0,0,0,0,1,0,1,,12,20,2533,1,1,1
parts-of-speech,conjunctions,Conjunctions — Liên từ,beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,1,0,1,,9,17,1671,1,1,1
parts-of-speech,nouns,Nouns — Danh từ,beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,1,0,1,,11,17,1379,1,1,1
parts-of-speech,prepositions,Prepositions — Giới từ,beginner,complete,"5.0,6.0",medium,medium,1,2,0,2,1,0,1,,8,17,2270,1,1,1
parts-of-speech,pronouns,Pronouns — Đại từ,beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,1,0,1,,9,18,1612,1,1,1
parts-of-speech,verbs,Verbs — Động từ,beginner,complete,"5.0,6.0",medium,medium,0,0,0,0,0,0,0,,10,17,1518,1,1,1
sentence-structures,cleft-sentences,Cleft Sentences — Câu chẻ,intermediate,complete,"7.0,7.5,8.0",high,high,1,6,1,5,1,0,1,,11,20,1613,1,1,1
sentence-structures,complex-sentence,Complex Sentence (Câu phức),intermediate,complete,"6.0,6.5,7.0",high,high,0,0,2,0,1,0,1,,36,60,6404,1,1,1
sentence-structures,compound-sentence,Compound Sentence (Câu ghép),beginner-intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,13,21,2444,1,1,1
sentence-structures,inversion,Inversion — Đảo ngữ,advanced,complete,"7.0,7.5,8.0",high,high,0,0,1,0,1,0,1,,22,34,3168,1,1,1
sentence-structures,passive-voice,Passive Voice — Câu bị động,intermediate,complete,"6.0,6.5,7.0",high,high,1,6,3,3,1,0,1,,12,22,1864,1,1,1
sentence-structures,relative-clauses,Relative Clauses — Mệnh đề quan hệ,intermediate,complete,"6.0,6.5,7.0",high,high,1,7,2,5,1,0,1,,12,13,1910,1,1,1
sentence-structures,reported-speech,Reported Speech — Câu tường thuật,intermediate,complete,"6.0,6.5,7.0",high,high,1,2,0,2,1,0,1,,10,19,1904,1,1,1
sentence-structures,simple-sentence,Simple Sentence (Câu đơn),beginner,complete,"5.0,6.0",high,high,0,0,0,0,1,0,1,,13,23,2290,1,1,1
tenses,future-forms,Future Forms (will / be going to / Prese,intermediate,complete,"6.0,6.5,7.0",high,high,1,8,1,7,1,0,1,,14,29,3096,1,1,1
tenses,past-continuous,Past Continuous — Thì Quá khứ tiếp diễn,beginner,complete,"5.0,6.0",high,high,0,0,0,0,1,0,1,,8,16,1370,1,1,1
tenses,past-perfect,Past Perfect — Thì Quá khứ hoàn thành,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,9,14,1570,1,1,1
tenses,past-simple,Past Simple,beginner,complete,"5.0,6.0",high,high,1,7,2,5,1,0,1,,14,27,2801,1,1,1
tenses,present-continuous,Present Continuous,beginner,complete,"5.0,6.0",high,high,1,7,2,5,1,0,1,,13,25,2113,1,1,1
tenses,present-perfect-continuous,Present Perfect Continuous — Thì Hiện tạ,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,9,15,1439,1,1,1
tenses,present-perfect,Present Perfect,intermediate,complete,"6.0,6.5,7.0",high,high,1,9,2,7,1,0,1,,14,24,2949,1,1,1
tenses,present-simple,Present Simple,beginner,complete,"5.0,6.0",high,high,1,7,2,5,1,0,1,,14,22,1910,1,1,1
verb-patterns,bare-infinitive,Bare Infinitive (Động từ nguyên thể khôn,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,2,0,2,,13,18,2139,1,1,1
verb-patterns,causative-verbs,Causative Verbs — have / get / make / le,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,0,0,0,,12,18,1622,1,1,1
verb-patterns,gerund-vs-infinitive,Gerund vs. Infinitive (Khi nào dùng V-in,intermediate,complete,"6.0,6.5,7.0",high,high,1,13,7,6,1,0,1,,75,101,11628,1,1,1
verb-patterns,gerund,Gerund (V-ing dùng như danh từ),intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,2,0,2,,13,18,2466,1,1,1
verb-patterns,infinitive,"To-Infinitive (Động từ nguyên thể có ""to",intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,13,18,2500,1,1,1
verb-patterns,modal-verbs,Modal Verbs — Động từ khuyết thiếu,intermediate,complete,"6.0,6.5,7.0",high,high,1,8,1,7,1,0,1,,14,18,2036,1,1,1
verb-patterns,phrasal-verbs,Phrasal Verbs — Cụm động từ,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,0,0,0,,9,16,1894,1,1,1
verb-patterns,used-to-be-used-to-get-used-to,Used to / Be used to / Get used to — Ba ,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,1,0,1,,10,21,2112,1,1,1
verb-patterns,wish-hope,Wish & Hope — Ước muốn và Hy vọng,intermediate,complete,"6.0,6.5,7.0",high,high,0,0,0,0,0,0,0,,10,14,1640,1,1,1

`````

---

*Hết hồ sơ bàn giao. Nguồn: bộ deliverable grammar 2026-06-20 (đã qua nhiều vòng phản biện >9) + cập nhật engineering đợt A3 (2026-06-27). Repo: `ielts-speaking-coach`.*
