---
kind: quiz
code: "G-tenses-past-perfect"
title: "Quick Check — Past Perfect"
skill_area: "grammar"
topic: "Tenses"
mode: "adaptive_mastery"
grading: "instant"
correct_to_master: 2
require_distinct_skill: true
require_production_to_master: true
cooldown: 2
shuffle_options: true
words_count: 5
source: "authored-2026-07"
text_match_by_qid:
  pqp_form_i2: exact
  pqp_seq_i2: exact
  pqp_bytime_i2: exact
  pqp_cond3_i2: exact
  pqp_reported_i2: exact
---

# ===== item_key 1 · Cấu trúc had + V3 (form cơ bản) =====

---
id: "pqp_form_b1"
type: "mcq"
input: "choice"
headword: "pqp-form"
skill: "form"
subtype: "basic"
prompt: "By the time she arrived, I ____ already eaten."
options: ["had", "have", "was", "has"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Past Perfect = had + V3, dùng cho MỌI chủ ngữ (không đổi theo ngôi): had already eaten."
---

---
id: "pqp_form_b2"
type: "mcq"
input: "choice"
headword: "pqp-form"
skill: "form"
subtype: "basic"
prompt: "Dùng Past Perfect phủ định: They ____ the project when the deadline passed."
options: ["hadn't finished", "haven't finished", "didn't finish", "wasn't finished"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Theo yêu cầu Past Perfect phủ định, chọn 'hadn't finished': had not + V3. 'Didn't finish' cũng có thể tạo câu đúng ở Past Simple, nhưng không đáp ứng thì được yêu cầu."
---

---
id: "pqp_form_i1"
type: "gap_mcq"
input: "choice"
headword: "pqp-form"
skill: "usage"
subtype: "intermediate"
prompt: "Dùng câu hỏi Past Perfect: ____ you ____ him before the interview started?"
options: ["Did / meet", "Have / met", "Had / met", "Were / meeting"]
answer: 2
grammar_article_slug: "past-perfect"
explain: "Theo yêu cầu câu hỏi Past Perfect, chọn Had + S + V3: 'Had you met'. 'Did you meet ... before ...?' cũng hợp ngữ pháp ở Past Simple, nhưng không đáp ứng thì được yêu cầu."
---

---
id: "pqp_form_i2"
type: "gap_text"
input: "text"
headword: "pqp-form"
skill: "production"
subtype: "intermediate"
prompt: "Dùng Past Perfect: The manager ____ (already / leave) the office when the client called."
accept: ["had already left"]
case_sensitive: false
grammar_article_slug: "past-perfect"
explain: "Hành động xảy ra trước một mốc quá khứ khác (client called) → had already left."
---

---
id: "pqp_form_a1"
type: "boolean"
input: "boolean"
headword: "pqp-form"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'They had leaved before the storm hit the coast.'"
answer: false
grammar_article_slug: "past-perfect"
explain: "SAI — leave có V3 bất quy tắc là 'left', không phải 'leaved': 'They had left before the storm hit the coast.'"
---

# ===== item_key 2 · Trình tự thời gian: Past Perfect (trước) → Past Simple (sau) =====

---
id: "pqp_seq_b1"
type: "mcq"
input: "choice"
headword: "pqp-sequence"
skill: "contrast"
subtype: "basic"
prompt: "When I arrived at the cinema, the film ____ already started."
options: ["had", "has", "was", "did"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Phim bắt đầu TRƯỚC khi tôi đến (arrived) → hành động trước dùng Past Perfect: had started."
---

---
id: "pqp_seq_i1"
type: "gap_mcq"
input: "choice"
headword: "pqp-sequence"
skill: "contrast"
subtype: "intermediate"
prompt: "When the police ____, the thief ____ already escaped through the back door."
options: ["arrived / had", "had arrived / has", "arrived / has", "arrive / had"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Cảnh sát đến (arrived — Past Simple, hành động sau) trong khi kẻ trộm đã trốn thoát TRƯỚC đó (had escaped — Past Perfect, hành động trước)."
---

---
id: "pqp_seq_i2"
type: "gap_text"
input: "text"
headword: "pqp-sequence"
skill: "production"
subtype: "intermediate"
prompt: "Dùng Past Perfect Simple: She ____ (live) in Paris for 10 years before she moved to London."
accept: ["had lived"]
case_sensitive: false
grammar_article_slug: "past-perfect"
explain: "Theo yêu cầu Past Perfect Simple, điền 'had lived' để nhìn lại thời gian sống ở Paris từ mốc chuyển tới London. 'Before' đã chỉ thứ tự nên 'lived' cũng có thể đúng nếu bài không yêu cầu riêng Past Perfect; 'had been living' là một dạng perfect continuous khác."
---

---
id: "pqp_seq_a1"
type: "boolean"
input: "boolean"
headword: "pqp-sequence"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'When I arrived, she left.' và 'When I arrived, she had left.' luôn có nghĩa giống nhau."
answer: false
grammar_article_slug: "past-perfect"
explain: "SAI — 'she left' nghĩa là cô ấy rời đi cùng lúc hoặc ngay sau khi tôi đến; 'she had left' nghĩa là cô ấy đã rời đi TRƯỚC khi tôi đến. Hai câu khác nghĩa rõ rệt."
---

---
id: "pqp_seq_a2"
type: "mcq"
input: "choice"
headword: "pqp-sequence"
skill: "contrast"
subtype: "advanced"
prompt: "In an IELTS Part 2 story about a job interview, which sentence uses Past Perfect to show the interviewer had read your portfolio BEFORE the interview began?"
options: ["The interviewer read my portfolio beforehand.", "It turned out that the interviewer had read my portfolio beforehand.", "The interviewer was reading my portfolio beforehand.", "The interviewer has read my portfolio beforehand."]
answer: 1
grammar_article_slug: "past-perfect"
explain: "Chọn câu có 'had read' vì bài yêu cầu Past Perfect, nhìn lại việc đọc từ mốc buổi phỏng vấn. 'The interviewer read my portfolio beforehand' cũng diễn đạt việc đọc trước đó bằng Past Simple + beforehand, nhưng không dùng thì được yêu cầu."
---

# ===== item_key 3 · by the time / before / after =====

---
id: "pqp_bytime_b1"
type: "mcq"
input: "choice"
headword: "pqp-by-the-time"
skill: "form"
subtype: "basic"
prompt: "Dùng Past Perfect: By the time the guests arrived, we ____ everything."
options: ["had prepared", "have prepared", "prepared", "were preparing"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Theo yêu cầu Past Perfect, chọn 'had prepared' để nhìn lại việc chuẩn bị từ mốc khách đến. Không chọn thì chỉ bằng từ khoá 'by the time'; các dạng khác cần được xét theo nghĩa và ngữ cảnh riêng."
---

---
id: "pqp_bytime_i1"
type: "gap_mcq"
input: "choice"
headword: "pqp-by-the-time"
skill: "usage"
subtype: "intermediate"
prompt: "Dùng Past Perfect: By 2010, the company ____ to 20 countries."
options: ["had expanded", "expanded", "has expanded", "was expanding"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Theo yêu cầu Past Perfect, chọn 'had expanded', nhìn lại sự mở rộng tính tới mốc năm 2010. 'By 2010' cung cấp mốc tham chiếu quá khứ; không phải một từ khoá buộc mọi câu dùng cùng một thì bất kể nghĩa."
---

---
id: "pqp_bytime_i2"
type: "gap_text"
input: "text"
headword: "pqp-by-the-time"
skill: "production"
subtype: "intermediate"
prompt: "Dùng Past Perfect Simple: By the time the film started, they ____ (finish) dinner."
accept: ["had finished"]
case_sensitive: false
grammar_article_slug: "past-perfect"
explain: "Theo yêu cầu Past Perfect Simple, điền 'had finished': việc ăn xong được nhìn lại từ thời điểm phim bắt đầu."
---

---
id: "pqp_bytime_a1"
type: "boolean"
input: "boolean"
headword: "pqp-by-the-time"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Trong câu 'By the time she was 30, she published three novels', 'published' dùng cấu trúc Past Perfect (had + V3)."
answer: false
grammar_article_slug: "past-perfect"
explain: "SAI về nhận diện cấu trúc: 'published' ở đây là Past Simple, không có trợ động từ 'had'. Dạng Past Perfect là 'had published'. Bài kiểm tra tên/cấu trúc thì, không kết luận một câu sai ngữ pháp chỉ vì có 'by the time' mà thiếu Past Perfect."
---

---
id: "pqp_bytime_a2"
type: "boolean"
input: "boolean"
headword: "pqp-by-the-time"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'By the time governments began to address climate change, significant damage had already been done.'"
answer: true
grammar_article_slug: "past-perfect"
explain: "ĐÚNG — thiệt hại đã xảy ra TRƯỚC khi chính phủ hành động (began) → had already been done là Past Perfect chính xác."
---

# ===== item_key 4 · Điều kiện loại 3 (If + had V3, would have V3) =====

---
id: "pqp_cond3_b1"
type: "mcq"
input: "choice"
headword: "pqp-conditional-3"
skill: "form"
subtype: "basic"
prompt: "Dùng câu điều kiện loại 3 (Type 3): If I ____ harder, I would have passed the exam."
options: ["had studied", "studied", "have studied", "study"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Điều kiện loại 3 (giả định trái với quá khứ): If + Past Perfect, would have + V3 → had studied."
---

---
id: "pqp_cond3_i1"
type: "gap_mcq"
input: "choice"
headword: "pqp-conditional-3"
skill: "usage"
subtype: "intermediate"
prompt: "Dùng câu điều kiện loại 3 (Type 3): If she ____ the bus, she would have been on time for the meeting."
options: ["hadn't missed", "didn't miss", "hasn't missed", "wouldn't miss"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Vế 'if' của điều kiện loại 3 dùng Past Perfect phủ định: hadn't missed."
---

---
id: "pqp_cond3_i2"
type: "gap_text"
input: "text"
headword: "pqp-conditional-3"
skill: "production"
subtype: "intermediate"
prompt: "Dùng câu điều kiện loại 3 (Type 3): If stricter regulations ____ (introduce) earlier, the environmental damage would have been far less severe."
accept: ["had been introduced"]
case_sensitive: false
grammar_article_slug: "past-perfect"
explain: "Vế 'if' điều kiện loại 3 ở thể bị động: had been + V3 → had been introduced."
---

---
id: "pqp_cond3_a1"
type: "boolean"
input: "boolean"
headword: "pqp-conditional-3"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'If safety protocols had been followed, the accident might have been avoided.'"
answer: true
grammar_article_slug: "past-perfect"
explain: "ĐÚNG — điều kiện loại 3 chuẩn: If + Past Perfect (had been followed), main clause + might have + V3 (might have been avoided)."
---

# ===== item_key 5 · Reported speech: Present Perfect → Past Perfect =====

---
id: "pqp_reported_b1"
type: "mcq"
input: "choice"
headword: "pqp-reported-speech"
skill: "form"
subtype: "basic"
prompt: "Áp dụng lùi thì (backshift): Direct: \"I have finished the report.\" Reported: She said she ____ the report."
options: ["had finished", "has finished", "finished", "was finishing"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Bài yêu cầu backshift, nên Present Perfect chuyển thành Past Perfect: 'had finished'. 'Has finished' vẫn có thể phù hợp nếu việc hoàn tất còn liên quan hiện tại, nhưng không thực hiện lùi thì theo yêu cầu này."
---

---
id: "pqp_reported_i1"
type: "gap_mcq"
input: "choice"
headword: "pqp-reported-speech"
skill: "usage"
subtype: "intermediate"
prompt: "Áp dụng lùi thì (backshift): Direct: \"They have arrived.\" Reported: He told me they ____."
options: ["had arrived", "have arrived", "arrived", "were arriving"]
answer: 0
grammar_article_slug: "past-perfect"
explain: "Theo yêu cầu backshift, 'have arrived' chuyển thành 'had arrived'. Giữ 'have arrived' có thể đúng khi thông tin vẫn liên quan hiện tại, nhưng không đáp ứng thao tác lùi thì được yêu cầu."
---

---
id: "pqp_reported_i2"
type: "gap_text"
input: "text"
headword: "pqp-reported-speech"
skill: "production"
subtype: "intermediate"
prompt: "Áp dụng lùi thì (backshift): Direct: \"I have submitted my application.\" Reported: She said she ____ (submit) her application."
accept: ["had submitted"]
case_sensitive: false
grammar_article_slug: "past-perfect"
explain: "Theo yêu cầu backshift, điền 'had submitted'. Không suy ra mọi câu tường thuật đều bắt buộc đổi thì nếu thông tin vẫn đúng hoặc còn liên quan hiện tại."
---

---
id: "pqp_reported_a1"
type: "boolean"
input: "boolean"
headword: "pqp-reported-speech"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Khi áp dụng lùi thì từ Present Perfect sang Past Perfect cho 'We have moved to a new office', câu 'She said they have moved to a new office' đã thực hiện đúng thao tác lùi thì."
answer: false
grammar_article_slug: "past-perfect"
explain: "SAI về thao tác backshift: 'have moved' vẫn là Present Perfect, còn dạng lùi thì là 'had moved'. Câu với 'have moved' không tự nó sai ngữ pháp: người nói có thể giữ thì khi việc chuyển văn phòng vẫn còn liên quan hiện tại."
---
