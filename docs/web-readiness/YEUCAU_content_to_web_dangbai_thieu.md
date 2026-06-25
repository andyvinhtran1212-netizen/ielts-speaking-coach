# BƯỚC 2 — Yêu cầu (Content → Web): các dạng đề Web cần UPDATE
**Bối cảnh:** content đã chuẩn hoá tên/ID xong (Bước 1 ✓). Format câu hỏi của content là CHUẨN IELTS (đề `ILR-LIS-001` dry-run = 0 lỗi). Các đề còn lại render lỗi vì **web thiếu năng lực 3 dạng** + **classifier đoán-mò mong manh**. Đây là yêu cầu chính xác để web update; content **không đổi phrasing chuẩn IELTS**.

---

## PHẦN A — 3 DẠNG WEB THIẾU NĂNG LỰC (phải build: classify + render + grade + review)

### A1. MATCHING — ~46 đề Listening (gồm 6 v2-mock) · dạng phổ biến nhất
**Format content cung cấp (thật, ILR-LIS-056 Q16-20):**
```
### Questions 16-20
> Which role is each volunteer given?
> Match each volunteer (Questions 16-20) with the correct role (A-G).
> Write the correct letter, A-G, next to questions 16-20.

**List of roles:**
   - **A** running the fundraising stall
   ... (A-G)
**Questions:**
**16.** Marcus ___________
**17.** Bryony ___________
```
**Web phải:**
- **Classify → `matching`** khi gặp BẤT KỲ: `Match each … with …` · `Write the correct letter, [A-Z], next to (the )?questions` · `NB You may use any letter more than once` · câu WH có "… each …" ("Who is responsible for each…", "Which … for each…").
- **Render:** mỗi câu 1 **dropdown/letter** chọn từ bank A–G; hiện **bank "List of roles/options"**.
- **Grade:** so **letter**, case-insensitive; **option được dùng lại** (nếu có NB) ; 1 letter/câu.
- **Review-mode:** hiện đáp đúng vs chọn.
**Answer key content cung cấp:** Quick Answer Key `16. C / 17. A …` (letter).

### A2. MULTI-SELECT MCQ "Choose TWO" — ~32 đề Listening
**Format content (thật, ILR-LIS-076):**
```
> Choose **TWO** letters, **A-E**.
> Which **TWO** jobs will the students do BEFORE the survey is sent out?
- **A** … / - **B** … / … (A-E)
```
**Web phải:**
- **Classify → `mcq_multi`** khi `Choose (TWO|THREE) letters` / `Which TWO …`.
- **Render:** **checkbox** group, **giới hạn N** lựa chọn (soft-lock).
- **Grade:** **mỗi letter đúng = 1 điểm, any-order**; cụm "choose TWO" chiếm **2 số câu** → set 2 đáp án map vào 2 slot, đúng cả hai mới đủ 2 điểm (thứ tự không tính).
**Answer key:** 2 letter cho cặp câu (vd `21. B / 22. D`, chấp nhận hoán đổi).

### A3. FLOW-CHART COMPLETION — có trong content (Listening ILR-LIS-055; Reading 37 nhãn)
**Format content (thật):** `> Complete the flow-chart below.` + sơ đồ ASCII `Step N: ## ___`.
**Web phải:** thêm **1 pattern classify** `complete the flow-chart` → `flow_chart_completion`; **tái dùng renderer completion** (ô text theo gap); grade text (`answer_matches`). *(Nhỏ — web đã có 5 completion khác, chỉ thiếu cái này.)*

---

## PHẦN B — BRITTLENESS: 1 cơ chế xoá HẾT (rẻ nhất, bền nhất)

Ba lỗi đoán-mò (web render được nhưng nhận diện sai):
- **B1 — Labelling có mô tả:** "Label the **campus** map", "**venue** plan" → regex web chỉ khớp `label the (plan|map|diagram)` → rớt `unknown`. (7+ đề)
- **B2 — MCQ/Matching phrased dạng WH** không có cụm "choose the correct letter" → rớt `unknown`.
- **B3 — Reading prose nuốt câu thầm lặng:** importer map nhãn type rồi `if not enum: continue`. Nhãn content KHÔNG khớp: `Summary Completion (with box)` 66×, `(without box)` 62×, `Short-Answer Questions` 130×, `Flow-chart Completion` 37× → **~290 hàng đáp án bị DROP, không báo lỗi.**

**→ Giải pháp 1 phát = `question_type` TƯỜNG MINH (web đọc trước, regex chỉ là fallback):**
| Nguồn | Cơ chế đề xuất |
|---|---|
| **Listening** (QP markdown) | Content thêm ngay dưới `### Questions N-M` một marker `<!-- qtype: matching -->` (hoặc `> [type: mcq_multi]`). **Web parser đọc marker này TRƯỚC**; chỉ regex khi không có marker. → xoá B1+B2. |
| **Reading prose** | Web: (a) **mở rộng `_TYPE_LABEL_TO_ENUM`** cho nhãn thật (`summary completion (with box)`→`summary_completion`, `(without box)`→`summary_completion`, `short-answer questions`→`short_answer`, `flow-chart completion`→`flow_chart_completion`); (b) **đổi `continue` → emit WARNING** (không nuốt câu). → xoá B3. |
| **Reading L1/L2** | đã có `question_type` enum trong frontmatter → không cần làm gì. ✓ |

**→ AN TOÀN BẮT BUỘC (cả 2 skill):** mọi nhánh "không nhận diện được" (`unknown` Listening, nhãn-miss Reading) phải **xuất `warnings[]` trong import_result + banner đỏ trên admin preview** — **không bao giờ render/chấm thầm lặng câu hỏng**. (Đây cũng là W-0 trong PLAN_web_readiness.)

---

## PHẦN C — PHÂN CÔNG (ai sửa cái gì)
| Hạng mục | Bên sửa | Khối lượng |
|---|---|---|
| Matching (classify+render+grade+review) | **WEB** | lớn |
| Multi-select MCQ | **WEB** | vừa |
| Flow-chart completion (classify + reuse renderer) | **WEB** | nhỏ |
| Nới regex labelling; mở rộng Reading label-map; `continue`→warning; đọc marker `qtype` | **WEB** | nhỏ–vừa |
| Thêm marker `<!-- qtype: … -->` cho dạng web-đoán-trật (chỉ Listening) | **CONTENT** (JSON có sẵn type) | nhỏ |

---

## PHẦN D — ACCEPTANCE (web xong = đo được)
1. Chạy `listening_fulltest_import.parse_fulltest` trên **1 đề mỗi dạng** (vd 056 matching, 076 multi, 055 flow-chart) → **0 `unknown`, 0 ERROR, warnings rỗng**, mỗi câu render đúng widget.
2. Chạy reading prose import trên 1 đề có `(with box)/Short-Answer Questions/Flow-chart` → **0 hàng bị drop** (đếm câu = 40).
3. Toàn bộ **~46 Matching + ~32 multi + flow-chart** import sạch; harness all-types (PLAN W-6) pass với fixture phủ-đủ-dạng.

## PHẦN E — Danh mục đề ưu tiên (để web test sau khi build)
- **Matching:** ILR-LIS-004, 007, 010, 026–030, 051, 053, 056, 058–099 (lẻ), + 6 v2-mock. (~46)
- **Multi-select:** ILR-LIS-003, 004, 012–014, 021–025, 031–035, 052, 054, 057, 062, 067, 076, 083, 086, 090–100 (lẻ). (~32)
- **Flow-chart:** ILR-LIS-055 (+ rà thêm bằng grep `Complete the flow-chart`).

---

*Yêu cầu dựa trên dry-run/scan bằng chính code web trên content thật. Content format CHUẨN — web cần thêm năng lực + bỏ đoán-mò + bỏ nuốt-thầm-lặng. Khớp các mục W-2/W-3/W-0 + flow-chart trong `PLAN_web_readiness_all_question_types`.*
