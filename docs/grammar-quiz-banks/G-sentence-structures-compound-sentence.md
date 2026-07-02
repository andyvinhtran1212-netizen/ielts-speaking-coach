---
kind: quiz
code: "G-sentence-structures-compound-sentence"
title: "Quick Check — Compound Sentence"
skill_area: "grammar"
topic: "Sentence Structures"
mode: "adaptive_mastery"
grading: "instant"
correct_to_master: 2
require_distinct_skill: true
require_production_to_master: true
cooldown: 2
shuffle_options: true
words_count: 4
source: "authored-2026-07"
---

# ===== item_key 1 · FANBOYS — coordinating conjunctions =====

---
id: "cs_fan_b1"
type: "mcq"
input: "choice"
headword: "cs-fanboys"
skill: "form"
subtype: "basic"
prompt: "She studied hard, ____ she passed the exam."
options: ["so", "but", "or", "nor"]
answer: 0
grammar_article_slug: "compound-sentence"
explain: "'so' diễn tả kết quả — học chăm nên đậu. Đây là mối quan hệ nguyên nhân-kết quả, không phải tương phản (but) hay lựa chọn (or)."
---

---
id: "cs_fan_b2"
type: "mcq"
input: "choice"
headword: "cs-fanboys"
skill: "form"
subtype: "basic"
prompt: "He didn't call, ____ did he text."
options: ["nor", "and", "so", "but"]
answer: 0
grammar_article_slug: "compound-sentence"
explain: "'nor' phủ định vế thứ hai và bắt buộc đảo ngữ: 'nor did he text' (không phải 'nor he texted')."
---

---
id: "cs_fan_i1"
type: "gap_mcq"
input: "choice"
headword: "cs-fanboys"
skill: "usage"
subtype: "intermediate"
prompt: "Urbanisation creates jobs, ____ it also puts pressure on housing prices."
options: ["yet", "so", "for", "nor"]
answer: 0
grammar_article_slug: "compound-sentence"
explain: "Hai ý tương phản (lợi ích vs. áp lực) → dùng 'yet' (tuy nhiên, formal hơn 'but')."
---

---
id: "cs_fan_i2"
type: "gap_text"
input: "text"
headword: "cs-fanboys"
skill: "production"
subtype: "intermediate"
prompt: "Viết liên từ FANBOYS còn thiếu: 'Public transport is cheaper, ____ many people still prefer driving their own cars.' (mối quan hệ: tương phản, không trang trọng)"
accept: ["but"]
case_sensitive: false
grammar_article_slug: "compound-sentence"
explain: "Tương phản ở mức thông thường (không quá formal) → 'but'. ('yet' cũng đúng nghĩa nhưng formal hơn — ở đây yêu cầu từ thông dụng nhất.)"
---

---
id: "cs_fan_a1"
type: "boolean"
input: "boolean"
headword: "cs-fanboys"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She left early, for she had an appointment.'"
answer: true
grammar_article_slug: "compound-sentence"
explain: "ĐÚNG — 'for' làm liên từ nghĩa 'vì, bởi vì', đứng trước một independent clause đầy đủ ('she had an appointment') giải thích lý do."
---

---
id: "cs_fan_a2"
type: "boolean"
input: "boolean"
headword: "cs-fanboys"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Pollution is increasing, and the government should take action.'"
answer: false
grammar_article_slug: "compound-sentence"
explain: "SAI về logic — hai vế thể hiện quan hệ nguyên nhân-kết quả, không phải bổ sung ngang hàng. Sửa: 'Pollution is increasing, so the government should take action.'"
---

# ===== item_key 2 · Semicolon và conjunctive adverb =====

---
id: "cs_semi_b1"
type: "mcq"
input: "choice"
headword: "cs-semicolon-adverb"
skill: "form"
subtype: "basic"
prompt: "The plan seemed good; ____, it failed in practice."
options: ["however", "but", "so", "and"]
answer: 0
grammar_article_slug: "compound-sentence"
explain: "Sau dấu chấm phẩy (;), dùng conjunctive adverb ('however') để nối ý tương phản, không dùng coordinating conjunction (but/and/so)."
---

---
id: "cs_semi_b2"
type: "mcq"
input: "choice"
headword: "cs-semicolon-adverb"
skill: "form"
subtype: "basic"
prompt: "Chọn câu đúng dấu câu:"
options: ["The report is complex; simple solutions rarely work.", "The report is complex, simple solutions rarely work.", "The report is complex; and simple solutions rarely work.", "The report is complex however simple solutions rarely work."]
answer: 0
grammar_article_slug: "compound-sentence"
explain: "Semicolon nối hai independent clauses liên quan chặt chẽ, không kèm conjunction ('; and' sai) và không thay bằng dấu phẩy đơn thuần."
---

---
id: "cs_semi_i1"
type: "gap_mcq"
input: "choice"
headword: "cs-semicolon-adverb"
skill: "usage"
subtype: "intermediate"
prompt: "Demand for housing increased sharply; ____, prices in major cities rose by 20 percent."
options: ["consequently", "although", "but", "and"]
answer: 0
grammar_article_slug: "compound-sentence"
explain: "Mối quan hệ nguyên nhân-kết quả sau dấu chấm phẩy → conjunctive adverb 'consequently' (do đó). 'although' là subordinating conjunction, không dùng ở đây; 'but'/'and' cần dấu phẩy, không phải chấm phẩy."
---

---
id: "cs_semi_i2"
type: "gap_text"
input: "text"
headword: "cs-semicolon-adverb"
skill: "production"
subtype: "intermediate"
prompt: "Điền conjunctive adverb phù hợp: 'The policy is costly; ____, it has proven ineffective at reducing emissions.' (nghĩa: hơn nữa)"
accept: ["moreover", "furthermore"]
case_sensitive: false
grammar_article_slug: "compound-sentence"
explain: "'moreover'/'furthermore' (hơn nữa) thêm một ý bổ sung tiêu cực sau ý đầu, đứng sau dấu chấm phẩy và có dấu phẩy theo sau."
---

---
id: "cs_semi_a1"
type: "boolean"
input: "boolean"
headword: "cs-semicolon-adverb"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She worked hard, however she failed.'"
answer: false
grammar_article_slug: "compound-sentence"
explain: "SAI — 'however' là trạng từ liên kết (conjunctive adverb), không phải liên từ, không thể nối hai independent clauses chỉ bằng dấu phẩy. Sửa: 'She worked hard; however, she failed.'"
---

---
id: "cs_semi_a2"
type: "boolean"
input: "boolean"
headword: "cs-semicolon-adverb"
skill: "usage"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The economy shrank; meanwhile, unemployment soared.'"
answer: true
grammar_article_slug: "compound-sentence"
explain: "ĐÚNG — 'meanwhile' (trong khi đó) đứng sau chấm phẩy, có dấu phẩy theo sau, thể hiện đúng quan hệ hai sự việc diễn ra song song."
---

# ===== item_key 3 · Comma splice và run-on sentence (lỗi mục tiêu) =====

---
id: "cs_err_b1"
type: "boolean"
input: "boolean"
headword: "cs-comma-splice"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'She worked hard, she passed the exam.'"
answer: false
grammar_article_slug: "compound-sentence"
explain: "SAI — đây là comma splice: dấu phẩy đơn thuần không đủ mạnh để nối hai independent clauses. Sửa: 'She worked hard, so she passed the exam.' hoặc dùng dấu chấm phẩy."
---

---
id: "cs_err_b2"
type: "boolean"
input: "boolean"
headword: "cs-comma-splice"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'The problem is serious the government must act now.'"
answer: false
grammar_article_slug: "compound-sentence"
explain: "SAI — đây là run-on sentence: hai independent clauses đứng liền nhau không có dấu câu hay liên từ. Sửa: 'The problem is serious, so the government must act now.'"
---

---
id: "cs_err_i1"
type: "mcq"
input: "choice"
headword: "cs-comma-splice"
skill: "usage"
subtype: "intermediate"
prompt: "Câu nào KHÔNG mắc lỗi comma splice hay run-on?"
options: ["Technology is developing fast, it changes how we work.", "Technology is developing fast; it changes how we work.", "Technology is developing fast it changes how we work.", "Technology is developing fast, however it changes how we work."]
answer: 1
grammar_article_slug: "compound-sentence"
explain: "Dấu chấm phẩy nối đúng hai independent clauses liên quan. Các phương án còn lại là comma splice, run-on, hoặc dùng conjunctive adverb sai (thiếu dấu chấm phẩy trước 'however')."
---

---
id: "cs_err_i2"
type: "gap_text"
input: "text"
headword: "cs-comma-splice"
skill: "production"
subtype: "intermediate"
prompt: "Sửa lỗi comma splice, chỉ điền MỘT liên từ FANBOYS phù hợp: 'She loves travelling, ____ she has visited 20 countries.'"
accept: ["and"]
case_sensitive: false
grammar_article_slug: "compound-sentence"
explain: "Câu gốc là comma splice (thiếu liên từ). Hai ý bổ sung cho nhau (thích du lịch → đã đi 20 nước) → thêm 'and' sau dấu phẩy."
---

---
id: "cs_err_a1"
type: "mcq"
input: "choice"
headword: "cs-comma-splice"
skill: "error_id"
subtype: "advanced"
prompt: "Câu nào mắc lỗi run-on sentence?"
options: ["The report is long readers often skip the appendix.", "The report is long, so readers often skip the appendix.", "The report is long; readers often skip the appendix.", "Because the report is long, readers often skip the appendix."]
answer: 0
grammar_article_slug: "compound-sentence"
explain: "Câu đầu ghép hai independent clauses liền nhau, không dấu câu, không liên từ → run-on sentence. Các câu còn lại dùng đúng liên từ, chấm phẩy, hoặc subordinating conjunction."
---

# ===== item_key 4 · Compound vs. Complex sentence (phân biệt) =====

---
id: "cs_vs_b1"
type: "mcq"
input: "choice"
headword: "cs-vs-complex"
skill: "contrast"
subtype: "basic"
prompt: "Câu nào là compound sentence (không phải complex)?"
options: ["Because she studied hard, she passed.", "She studied hard, and she passed.", "She passed although she was nervous.", "The exam that she took was difficult."]
answer: 1
grammar_article_slug: "compound-sentence"
explain: "Compound sentence gồm hai independent clauses ngang hàng nối bằng FANBOYS ('and'). Ba câu còn lại có mệnh đề phụ thuộc (because/although/that) → complex sentence."
---

---
id: "cs_vs_i1"
type: "gap_mcq"
input: "choice"
headword: "cs-vs-complex"
skill: "contrast"
subtype: "intermediate"
prompt: "'____ she studied hard, she passed the exam.' — câu này là complex sentence vì mở đầu bằng liên từ phụ thuộc."
options: ["Because", "So", "And", "Yet"]
answer: 0
grammar_article_slug: "compound-sentence"
explain: "'Because' là subordinating conjunction, tạo dependent clause phụ thuộc vào mệnh đề chính → complex sentence, khác với compound sentence (hai ý bình đẳng nối bằng FANBOYS)."
---

---
id: "cs_vs_i2"
type: "gap_text"
input: "text"
headword: "cs-vs-complex"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại thành compound sentence bằng FANBOYS (không dùng 'because'): 'The economy grew. Inequality increased.' (quan hệ: tương phản, dùng đúng 1 từ)"
accept: ["but", "yet"]
case_sensitive: false
grammar_article_slug: "compound-sentence"
explain: "Nối hai independent clauses ngang hàng bằng liên từ tương phản: 'The economy grew, but/yet inequality increased.' — đây là compound, không phải complex vì không có dependent clause."
---

---
id: "cs_vs_a1"
type: "boolean"
input: "boolean"
headword: "cs-vs-complex"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She and her friend studied hard.' là một compound sentence."
answer: false
grammar_article_slug: "compound-sentence"
explain: "SAI — đây chỉ là simple sentence với chủ ngữ ghép ('She and her friend') và MỘT vị ngữ duy nhất ('studied'), không phải hai independent clauses riêng biệt."
---

---
id: "cs_vs_a2"
type: "boolean"
input: "boolean"
headword: "cs-vs-complex"
skill: "usage"
subtype: "advanced"
prompt: "Đúng hay Sai: Compound sentence có thể chứa một dependent clause (mệnh đề phụ thuộc)."
answer: false
grammar_article_slug: "compound-sentence"
explain: "SAI — theo định nghĩa, compound sentence chỉ gồm các independent clauses, KHÔNG có dependent clause. Câu có cả independent + dependent clause là complex sentence (hoặc compound-complex nếu có ≥2 independent + ≥1 dependent)."
---
