---
kind: quiz
code: "G-error-clinic-run-on-sentences"
title: "Quick Check — Run-On Sentences"
skill_area: "grammar"
topic: "Error Clinic"
mode: "adaptive_mastery"
grading: "instant"
correct_to_master: 2
require_distinct_skill: true
require_production_to_master: true
cooldown: 2
shuffle_options: true
words_count: 3
source: "authored-2026-07"
---

# ===== item_key 1 · Comma splice (dấu phẩy nối sai 2 câu độc lập) =====

---
id: "ro_cs_b1"
type: "mcq"
input: "choice"
headword: "ro-comma-splice"
skill: "form"
subtype: "basic"
prompt: "Which sentence fixes the comma splice correctly?"
options: ["I love cooking, I do it every day.", "I love cooking. I do it every day.", "I love cooking, do it every day.", "I love cooking it every day."]
answer: 1
grammar_article_slug: "run-on-sentences"
explain: "Dấu phẩy KHÔNG đủ để nối 2 mệnh đề độc lập (comma splice). Cách đơn giản nhất: tách thành 2 câu bằng dấu chấm."
---

---
id: "ro_cs_b2"
type: "boolean"
input: "boolean"
headword: "ro-comma-splice"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'She was tired, she went to bed early.' là một câu đúng ngữ pháp."
answer: false
grammar_article_slug: "run-on-sentences"
explain: "SAI — đây là comma splice: 2 mệnh đề độc lập ('She was tired' và 'she went to bed early') chỉ nối bằng dấu phẩy. Sửa: 'She was tired, so she went to bed early.' hoặc 'She was tired. She went to bed early.'"
---

---
id: "ro_cs_i1"
type: "gap_mcq"
input: "choice"
headword: "ro-comma-splice"
skill: "usage"
subtype: "intermediate"
prompt: "The exam was difficult, ____ I failed it. (chọn cách nối đúng thay vì chỉ dùng dấu phẩy)"
options: ["so", "", "however", "therefore,"]
answer: 0
grammar_article_slug: "run-on-sentences"
explain: "Sau dấu phẩy cần một liên từ FANBOYS (for/and/but/or/nor/yet/so) để nối 2 mệnh đề độc lập. 'so' thể hiện quan hệ kết quả: khó → trượt."
---

---
id: "ro_cs_i2"
type: "gap_text"
input: "text"
headword: "ro-comma-splice"
skill: "production"
subtype: "intermediate"
prompt: "Sửa comma splice sau bằng liên từ 'so': 'He didn't study, he failed the test.' → 'He didn't study, ____ he failed the test.'"
accept: ["so"]
case_sensitive: false
grammar_article_slug: "run-on-sentences"
explain: "Comma splice cần thêm liên từ FANBOYS sau dấu phẩy. 'so' diễn tả kết quả: không học → trượt bài kiểm tra."
---

---
id: "ro_cs_i3"
type: "mcq"
input: "choice"
headword: "ro-comma-splice"
skill: "contrast"
subtype: "intermediate"
prompt: "'The job pays well, the hours are terrible.' — cách sửa nào thể hiện đúng quan hệ TƯƠNG PHẢN giữa 2 ý?"
options: ["The job pays well, so the hours are terrible.", "The job pays well, but the hours are terrible.", "The job pays well the hours are terrible.", "The job pays well; the hours are terrible however."]
answer: 1
grammar_article_slug: "run-on-sentences"
explain: "'but' là liên từ FANBOYS thể hiện tương phản (lương tốt >< giờ làm tệ). Đáp án dùng 'so' sai vì đó là quan hệ kết quả, không phải tương phản."
---

---
id: "ro_cs_a1"
type: "boolean"
input: "boolean"
headword: "ro-comma-splice"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Air pollution is worsening, cities need stricter regulations urgently.' là câu viết đúng, phù hợp Writing Task 2."
answer: false
grammar_article_slug: "run-on-sentences"
explain: "SAI — comma splice giữa 2 mệnh đề độc lập. Sửa formal: 'Air pollution is worsening; therefore, cities need stricter regulations urgently.' hoặc dùng từ phụ: 'Because air pollution is worsening, cities need stricter regulations urgently.'"
---

# ===== item_key 2 · Fused sentence (thiếu liên từ / dấu câu hoàn toàn) =====

---
id: "ro_mc_b1"
type: "mcq"
input: "choice"
headword: "ro-missing-connector"
skill: "error_id"
subtype: "basic"
prompt: "Câu nào bị lỗi 'fused sentence' (hai câu dính liền, không có dấu câu hay liên từ nào)?"
options: ["She studies every night.", "I love cooking I do it every day.", "I love cooking, and I do it every day.", "Because I love cooking, I do it every day."]
answer: 1
grammar_article_slug: "run-on-sentences"
explain: "'I love cooking I do it every day.' là fused sentence: hai mệnh đề độc lập đặt cạnh nhau mà không có bất kỳ dấu câu hay liên từ nào ngăn cách."
---

---
id: "ro_mc_b2"
type: "boolean"
input: "boolean"
headword: "ro-missing-connector"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'She worked hard she got promoted.' là một câu hoàn chỉnh, viết đúng."
answer: false
grammar_article_slug: "run-on-sentences"
explain: "SAI — thiếu hoàn toàn dấu câu/liên từ giữa 'She worked hard' và 'she got promoted' (fused sentence). Sửa: 'She worked hard, so she got promoted.' hoặc 'She worked hard and got promoted.'"
---

---
id: "ro_mc_i1"
type: "gap_mcq"
input: "choice"
headword: "ro-missing-connector"
skill: "usage"
subtype: "intermediate"
prompt: "He moved to Australia ____ is a beautiful country. (nối thông tin thêm về 'Australia')"
options: ["it", "which", "so", "however"]
answer: 1
grammar_article_slug: "run-on-sentences"
explain: "Câu thứ hai bổ sung thông tin về danh từ 'Australia' → dùng mệnh đề quan hệ với 'which': 'He moved to Australia, which is a beautiful country.'"
---

---
id: "ro_mc_i2"
type: "gap_text"
input: "text"
headword: "ro-missing-connector"
skill: "production"
subtype: "intermediate"
prompt: "Sửa fused sentence bằng từ phụ 'because': 'I like living in the city there are many things to do.' → 'I like living in the city ____ there are many things to do.'"
accept: ["because"]
case_sensitive: false
grammar_article_slug: "run-on-sentences"
explain: "Câu gốc thiếu hoàn toàn liên từ/dấu câu (fused sentence). Thêm từ phụ 'because' biến mệnh đề sau thành mệnh đề phụ, thể hiện quan hệ lý do."
---

---
id: "ro_mc_i3"
type: "mcq"
input: "choice"
headword: "ro-missing-connector"
skill: "form"
subtype: "intermediate"
prompt: "'I enjoy cooking I find it relaxing it also helps me de-stress.' bị lỗi gì?"
options: ["Thiếu chủ ngữ", "Fused sentence — ba mệnh đề độc lập dính liền không có dấu câu/liên từ", "Sai thì động từ", "Thiếu mạo từ"]
answer: 1
grammar_article_slug: "run-on-sentences"
explain: "Ba mệnh đề độc lập ('I enjoy cooking', 'I find it relaxing', 'it also helps me de-stress') bị nối liền nhau không có dấu câu hay liên từ nào → fused sentence, cần chia lại bằng dấu chấm, liên từ, hoặc mệnh đề quan hệ."
---

---
id: "ro_mc_a1"
type: "boolean"
input: "boolean"
headword: "ro-missing-connector"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: Thêm dấu phẩy vào giữa 'I woke up I ate breakfast' (thành 'I woke up, I ate breakfast') là đủ để sửa lỗi hoàn toàn."
answer: false
grammar_article_slug: "run-on-sentences"
explain: "SAI — thêm dấu phẩy chỉ biến fused sentence thành comma splice, vẫn là câu chạy. Cần liên từ FANBOYS ('I woke up, and I ate breakfast'), từ phụ, hoặc tách câu bằng dấu chấm."
---

# ===== item_key 3 · however/therefore (cần dấu chấm/chấm phẩy, không phải dấu phẩy) =====

---
id: "ro_ht_b1"
type: "mcq"
input: "choice"
headword: "ro-however-therefore"
skill: "form"
subtype: "basic"
prompt: "Câu nào dùng 'however' ĐÚNG dấu câu?"
options: ["Technology is useful, however it can be addictive.", "Technology is useful. However, it can be addictive.", "Technology is useful however, it can be addictive.", "Technology is useful however it can be addictive."]
answer: 1
grammar_article_slug: "run-on-sentences"
explain: "'however' không phải liên từ (FANBOYS) nên KHÔNG thể nối 2 câu bằng dấu phẩy. Cần dấu chấm (hoặc chấm phẩy) trước 'however', và dấu phẩy ngay sau nó."
---

---
id: "ro_ht_b2"
type: "boolean"
input: "boolean"
headword: "ro-however-therefore"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'The results were disappointing, however the team remained optimistic.' viết đúng dấu câu."
answer: false
grammar_article_slug: "run-on-sentences"
explain: "SAI — comma splice vì dùng dấu phẩy trước 'however' để nối 2 mệnh đề độc lập. Sửa: 'The results were disappointing; however, the team remained optimistic.' hoặc tách thành 2 câu bằng dấu chấm."
---

---
id: "ro_ht_i1"
type: "gap_mcq"
input: "choice"
headword: "ro-however-therefore"
skill: "usage"
subtype: "intermediate"
prompt: "Air pollution is worsening____ therefore, stricter regulations are urgently needed."
options: [",", ";", " and", " but"]
answer: 1
grammar_article_slug: "run-on-sentences"
explain: "'therefore' là từ nối (transition word), không phải liên từ FANBOYS → không thể dùng dấu phẩy để nối 2 mệnh đề độc lập trước nó. Dùng dấu chấm phẩy (;) khi 2 ý liên quan chặt chẽ."
---

---
id: "ro_ht_i2"
type: "gap_text"
input: "text"
headword: "ro-however-therefore"
skill: "production"
subtype: "intermediate"
prompt: "Sửa lỗi dấu câu: 'The job pays well, however the hours are terrible.' → chỉ điền dấu câu thay cho '____' (giữ nguyên 'however' viết thường vì nó không đứng đầu câu mới): 'The job pays well____ however, the hours are terrible.'"
accept: [";"]
case_sensitive: false
grammar_article_slug: "run-on-sentences"
explain: "'however' cần dấu chấm phẩy đứng trước khi nối 2 mệnh đề độc lập có liên quan chặt chẽ — không dùng dấu phẩy vì 'however' không phải liên từ FANBOYS. (Nếu dùng dấu chấm thay vì chấm phẩy, 'however' phải viết hoa thành 'However' vì nó bắt đầu câu mới.)"
---

---
id: "ro_ht_i3"
type: "mcq"
input: "choice"
headword: "ro-however-therefore"
skill: "contrast"
subtype: "intermediate"
prompt: "So với 'but' (liên từ FANBOYS), 'however' khác biệt thế nào về dấu câu khi nối 2 mệnh đề độc lập?"
options: ["Giống hệt nhau, đều dùng dấu phẩy trước", "'but' dùng dấu phẩy trước; 'however' cần dấu chấm hoặc chấm phẩy trước, dấu phẩy sau", "'however' luôn đứng đầu câu, không bao giờ ở giữa", "Không có khác biệt, chỉ khác nghĩa"]
answer: 1
grammar_article_slug: "run-on-sentences"
explain: "'but' là liên từ phối hợp (FANBOYS) nên dùng dấu phẩy trước nó là đủ: 'X, but Y.' Còn 'however' là từ nối (transition word), cần dấu chấm/chấm phẩy trước và dấu phẩy sau: 'X; however, Y.' hoặc 'X. However, Y.'"
---

---
id: "ro_ht_a1"
type: "boolean"
input: "boolean"
headword: "ro-however-therefore"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Many students believe grammar is boring, therefore they avoid studying it seriously.' là câu viết đúng chuẩn học thuật."
answer: false
grammar_article_slug: "run-on-sentences"
explain: "SAI — comma splice: 'therefore' không phải liên từ FANBOYS nên dấu phẩy trước nó không đủ để nối 2 mệnh đề độc lập. Sửa: 'Many students believe grammar is boring; therefore, they avoid studying it seriously.'"
---
