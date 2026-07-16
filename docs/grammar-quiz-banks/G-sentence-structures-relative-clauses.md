---
kind: quiz
code: "G-sentence-structures-relative-clauses"
title: "Quick Check — Relative Clauses"
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

# ===== item_key 1 · Chọn đúng đại từ/trạng từ quan hệ =====

---
id: "rc_pron_b1"
type: "mcq"
input: "choice"
headword: "rc-pronoun-choice"
skill: "form"
subtype: "basic"
prompt: "The man ____ called you is my boss."
options: ["who", "which", "whose", "where"]
answer: 0
grammar_article_slug: "relative-clauses"
explain: "Tiền ngữ là người ('the man') và đóng vai trò chủ ngữ của mệnh đề quan hệ → dùng 'who'."
---

---
id: "rc_pron_b2"
type: "mcq"
input: "choice"
headword: "rc-pronoun-choice"
skill: "form"
subtype: "basic"
prompt: "This is the city ____ I was born."
options: ["where", "which", "who", "that"]
answer: 0
grammar_article_slug: "relative-clauses"
explain: "Tiền ngữ chỉ nơi chốn ('the city') → dùng relative adverb 'where' (= in which)."
---

---
id: "rc_pron_i1"
type: "gap_mcq"
input: "choice"
headword: "rc-pronoun-choice"
skill: "usage"
subtype: "intermediate"
prompt: "The company ____ products are famous worldwide has just launched a new app."
options: ["whose", "which", "who", "that"]
answer: 0
grammar_article_slug: "relative-clauses"
explain: "Cần đại từ chỉ sở hữu (products CỦA company) → 'whose' thay thế cho 's/its, không dùng 'which' vì 'which' không thể hiện sở hữu trực tiếp."
---

---
id: "rc_pron_i2"
type: "gap_text"
input: "text"
headword: "rc-pronoun-choice"
skill: "production"
subtype: "intermediate"
prompt: "Điền relative adverb đúng: 'I remember the day ____ we first met.' (chỉ thời gian)"
accept: ["when"]
case_sensitive: false
grammar_article_slug: "relative-clauses"
explain: "Tiền ngữ chỉ thời gian ('the day') → dùng relative adverb 'when' (= at which/during which)."
---

---
id: "rc_pron_a1"
type: "boolean"
input: "boolean"
headword: "rc-pronoun-choice"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The company which products are famous worldwide...' dùng đúng đại từ quan hệ."
answer: false
grammar_article_slug: "relative-clauses"
explain: "SAI — cần thể hiện sở hữu (products của company) nên phải dùng 'whose', không phải 'which'. Sửa: 'The company whose products are famous worldwide...'"
---

# ===== item_key 2 · Defining vs. Non-defining (dấu phẩy) =====

---
id: "rc_def_b1"
type: "mcq"
input: "choice"
headword: "rc-defining-vs-nondefining"
skill: "form"
subtype: "basic"
prompt: "Chọn câu đúng dấu câu cho mệnh đề KHÔNG XÁC ĐỊNH (non-defining):"
options: ["My sister, who lives in London, is visiting next week.", "My sister who lives in London is visiting next week.", "My sister, that lives in London, is visiting next week.", "My sister who, lives in London, is visiting next week."]
answer: 0
grammar_article_slug: "relative-clauses"
explain: "Non-defining clause (thông tin bổ sung, không cần thiết để xác định 'my sister' — chỉ có một chị) cần dấu phẩy hai đầu và dùng 'who', không dùng 'that'."
---

---
id: "rc_def_b2"
type: "mcq"
input: "choice"
headword: "rc-defining-vs-nondefining"
skill: "usage"
subtype: "basic"
prompt: "The book ____ is interesting. (nhiều cuốn sách, cần xác định cuốn nào)"
options: ["that I borrowed", "which I borrowed, ", ", which I borrowed,", "who I borrowed"]
answer: 0
grammar_article_slug: "relative-clauses"
explain: "Vì có nhiều sách và cần THÔNG TIN THIẾT YẾU để biết sách nào → defining relative clause, không dấu phẩy, dùng 'that/which': 'that I borrowed'."
---

---
id: "rc_def_i1"
type: "gap_mcq"
input: "choice"
headword: "rc-defining-vs-nondefining"
skill: "contrast"
subtype: "intermediate"
prompt: "Complete the non-defining relative clause: 'The Eiffel Tower, ____ was built in 1889, is one of the most visited monuments in the world.' — write the relative pronoun (commas already in place)."
options: ["which", "that", "who", "where"]
answer: 0
grammar_article_slug: "relative-clauses"
explain: "Chỉ có một Eiffel Tower nên mệnh đề chỉ THÊM thông tin, không cần thiết để xác định → non-defining: dùng 'which' (không dùng 'that'). Dấu phẩy hai đầu đã có sẵn trong prompt."
---

---
id: "rc_def_i2"
type: "gap_text"
input: "text"
headword: "rc-defining-vs-nondefining"
skill: "production"
subtype: "intermediate"
prompt: "Điền đúng MỘT từ (đại từ quan hệ) cho mệnh đề không xác định: 'My mother, ____ is 60 years old, still works full time.'"
accept: ["who"]
case_sensitive: false
grammar_article_slug: "relative-clauses"
explain: "Non-defining clause (đã biết rõ 'my mother' là ai, thông tin tuổi chỉ bổ sung) → phải có dấu phẩy và dùng 'who', không được dùng 'that' trong non-defining."
---

---
id: "rc_def_a1"
type: "boolean"
input: "boolean"
headword: "rc-defining-vs-nondefining"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'My brother, that is a doctor, lives in Hanoi.'"
answer: false
grammar_article_slug: "relative-clauses"
explain: "SAI — 'that' không được dùng trong non-defining clause (nhận biết qua dấu phẩy). Sửa: 'My brother, who is a doctor, lives in Hanoi.'"
---

# ===== item_key 3 · Double pronoun / dùng "that" sai trong non-defining (lỗi mục tiêu) =====

---
id: "rc_dbl_b1"
type: "boolean"
input: "boolean"
headword: "rc-double-pronoun-error"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'The student who he won the prize is from my class.'"
answer: false
grammar_article_slug: "relative-clauses"
explain: "SAI — lỗi lặp đại từ (double pronoun): thừa 'he' vì 'who' đã làm chủ ngữ của mệnh đề quan hệ. Sửa: 'The student who won the prize is from my class.'"
---

---
id: "rc_dbl_b2"
type: "boolean"
input: "boolean"
headword: "rc-double-pronoun-error"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'The book which I read it was amazing.'"
answer: false
grammar_article_slug: "relative-clauses"
explain: "SAI — thừa đại từ 'it' vì 'which' đã làm tân ngữ của 'read'. Sửa: 'The book which I read was amazing.'"
---

---
id: "rc_dbl_i1"
type: "mcq"
input: "choice"
headword: "rc-double-pronoun-error"
skill: "usage"
subtype: "intermediate"
prompt: "Câu nào KHÔNG mắc lỗi double pronoun?"
options: ["This is the city which I grew up in it.", "This is the city where I grew up.", "He's someone which I really admire him.", "The man who he called me is my boss."]
answer: 1
grammar_article_slug: "relative-clauses"
explain: "'where I grew up' không lặp lại đại từ chỉ nơi chốn. Các câu còn lại thừa 'it'/'him'/'he' — lặp đại từ đã được relative pronoun thay thế."
---

---
id: "rc_dbl_i2"
type: "gap_text"
input: "text"
headword: "rc-double-pronoun-error"
skill: "production"
subtype: "intermediate"
prompt: "Sửa câu sau, chỉ viết lại phần mệnh đề quan hệ đúng (bỏ đại từ thừa): 'This is the city which I grew up in it.' → This is the city ____ I grew up in."
accept: ["which", "that"]
case_sensitive: false
grammar_article_slug: "relative-clauses"
explain: "Bỏ đại từ thừa 'it' vì 'which' đã làm tân ngữ của giới từ 'in'. Câu đúng: 'This is the city which/that I grew up in.'"
---

---
id: "rc_dbl_a1"
type: "boolean"
input: "boolean"
headword: "rc-double-pronoun-error"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'This is the city which I grew up in it.' là câu đúng ngữ pháp."
answer: false
grammar_article_slug: "relative-clauses"
explain: "SAI — thừa đại từ 'it' sau giới từ 'in', vì 'which' đã đóng vai trò tân ngữ của giới từ đó. Sửa: 'This is the city which I grew up in.' hoặc 'This is the city where I grew up.'"
---

# ===== item_key 4 · Rút gọn mệnh đề quan hệ (reduced relative clauses) =====

---
id: "rc_red_b1"
type: "mcq"
input: "choice"
headword: "rc-reduced-clauses"
skill: "form"
subtype: "basic"
prompt: "The man ____ at the door is my father. (rút gọn từ 'who is standing')"
options: ["standing", "stands", "stood", "who standing"]
answer: 0
grammar_article_slug: "relative-clauses"
explain: "Khi relative pronoun là chủ ngữ và mệnh đề ở thể chủ động, rút gọn bằng V-ing: 'who is standing' → 'standing'."
---

---
id: "rc_red_i1"
type: "gap_mcq"
input: "choice"
headword: "rc-reduced-clauses"
skill: "usage"
subtype: "intermediate"
prompt: "The report ____ last year has been updated. (rút gọn từ 'which was published')"
options: ["published", "publishing", "was published", "publishes"]
answer: 0
grammar_article_slug: "relative-clauses"
explain: "Mệnh đề gốc ở thể bị động ('which was published') → rút gọn bằng V3 (past participle): 'published'."
---

---
id: "rc_red_i2"
type: "gap_text"
input: "text"
headword: "rc-reduced-clauses"
skill: "production"
subtype: "intermediate"
prompt: "Rút gọn mệnh đề quan hệ, chỉ viết MỘT từ: 'Students who want to improve should practise daily.' → Students ____ to improve should practise daily."
accept: ["wanting"]
case_sensitive: false
grammar_article_slug: "relative-clauses"
explain: "Mệnh đề chủ động, relative pronoun ('who') là chủ ngữ → rút gọn bằng V-ing: 'wanting'."
---

---
id: "rc_red_a1"
type: "boolean"
input: "boolean"
headword: "rc-reduced-clauses"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Câu 'The letter written in French was hard to read.' là dạng rút gọn đúng của 'The letter that was written in French was hard to read.'"
answer: true
grammar_article_slug: "relative-clauses"
explain: "ĐÚNG — mệnh đề gốc ở bị động ('that was written') nên rút gọn bằng V3 'written', bỏ 'that was' — hoàn toàn hợp lệ."
---

---
id: "rc_red_a2"
type: "boolean"
input: "boolean"
headword: "rc-reduced-clauses"
skill: "usage"
subtype: "advanced"
prompt: "Đúng hay Sai: Mệnh đề quan hệ chỉ có thể rút gọn khi relative pronoun đóng vai trò TÂN NGỮ (object) trong mệnh đề đó."
answer: false
grammar_article_slug: "relative-clauses"
explain: "SAI — rút gọn (V-ing/V3) áp dụng khi relative pronoun là CHỦ NGỮ (subject) của mệnh đề quan hệ, không phải tân ngữ. Khi là tân ngữ, ta chỉ có thể LƯỢC BỎ đại từ (nếu là defining clause), không rút gọn thành V-ing/V3."
---
