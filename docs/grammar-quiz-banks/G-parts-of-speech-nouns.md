---
kind: quiz
code: "G-parts-of-speech-nouns"
title: "Quick Check — Nouns"
skill_area: "grammar"
topic: "Parts of Speech"
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

# ===== item_key 1 · Countable vs Uncountable nouns =====

---
id: "noun_cnt_b1"
type: "mcq"
input: "choice"
headword: "noun-countable-uncountable"
skill: "form"
subtype: "basic"
prompt: "She gave me some useful ____ before my job interview."
options: ["advice", "advices", "an advice", "advices'"]
answer: 0
grammar_article_slug: "nouns"
explain: "'advice' là danh từ không đếm được — không có dạng số nhiều 'advices', và không dùng 'a/an' trước nó."
---

---
id: "noun_cnt_b2"
type: "mcq"
input: "choice"
headword: "noun-countable-uncountable"
skill: "form"
subtype: "basic"
prompt: "I need to buy some new ____ for my apartment."
options: ["furniture", "furnitures", "a furniture", "furniture's"]
answer: 0
grammar_article_slug: "nouns"
explain: "'furniture' không đếm được, không có số nhiều -s. Muốn đếm dùng 'a piece of furniture'."
---

---
id: "noun_cnt_i1"
type: "gap_mcq"
input: "choice"
headword: "noun-countable-uncountable"
skill: "usage"
subtype: "intermediate"
prompt: "The university requires applicants to submit two pieces of ____ before enrolment."
options: ["identification", "identifications", "an identification", "identification's"]
answer: 0
grammar_article_slug: "nouns"
explain: "'identification' (giấy tờ tùy thân) là uncountable — dùng 'a piece of / pieces of' để đếm, bản thân từ không thêm -s."
---

---
id: "noun_cnt_i2"
type: "gap_text"
input: "text"
headword: "noun-countable-uncountable"
skill: "production"
subtype: "intermediate"
prompt: "Researchers say that reliable ____ (information — viết đúng dạng, không thêm 's') about climate change is now widely available online."
accept: ["information"]
case_sensitive: false
grammar_article_slug: "nouns"
explain: "'information' luôn không đếm được, không bao giờ thêm -s dù trong ngữ cảnh học thuật."
---

---
id: "noun_cnt_a1"
type: "boolean"
input: "boolean"
headword: "noun-countable-uncountable"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The research team published several important researches last year.'"
answer: false
grammar_article_slug: "nouns"
explain: "SAI — 'research' là uncountable, không thêm -s. Sửa: 'The research team published several important research papers last year.' hoặc 'published important research'."
---

# ===== item_key 2 · Articles a/an/the/zero article =====

---
id: "noun_art_b1"
type: "mcq"
input: "choice"
headword: "noun-articles"
skill: "form"
subtype: "basic"
prompt: "I bought ____ book yesterday, and ____ book was more expensive than I expected."
options: ["a / the", "the / a", "a / a", "the / the"]
answer: 0
grammar_article_slug: "nouns"
explain: "Đề cập lần đầu (đếm được, số ít) → 'a book'. Đề cập lại lần hai (đã xác định) → 'the book'."
---

---
id: "noun_art_b2"
type: "gap_mcq"
input: "choice"
headword: "noun-articles"
skill: "form"
subtype: "basic"
prompt: "____ water is essential for human survival."
options: ["(không dùng mạo từ)", "A", "An", "The"]
answer: 0
grammar_article_slug: "nouns"
explain: "'water' không đếm được, nói chung chung (không xác định cụ thể) → không dùng mạo từ (zero article)."
---

---
id: "noun_art_i1"
type: "gap_mcq"
input: "choice"
headword: "noun-articles"
skill: "usage"
subtype: "intermediate"
prompt: "Vietnam is ____ developing country located in Southeast Asia."
options: ["a", "an", "the", "(không dùng mạo từ)"]
answer: 0
grammar_article_slug: "nouns"
explain: "'developing' bắt đầu bằng âm phụ âm /d/ → dùng 'a', không phải 'an' (an chỉ dùng trước âm nguyên âm)."
---

---
id: "noun_art_i2"
type: "gap_text"
input: "text"
headword: "noun-articles"
skill: "production"
subtype: "intermediate"
prompt: "____ (viết mạo từ đúng; nếu không cần mạo từ, gõ số 0) unemployment rate in rural areas has risen sharply this year."
accept: ["The"]
case_sensitive: false
grammar_article_slug: "nouns"
explain: "'unemployment rate' được xác định cụ thể bởi cụm 'in rural areas' đi kèm → dùng 'the'."
---

---
id: "noun_art_a1"
type: "boolean"
input: "boolean"
headword: "noun-articles"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'I bought book yesterday, and the book was more expensive than I expected.'"
answer: false
grammar_article_slug: "nouns"
explain: "SAI — 'book' là danh từ đếm được số ít, đề cập lần đầu, không thể đứng trơ trọi. Sửa: 'I bought a book yesterday...'."
---

---
id: "noun_art_a2"
type: "boolean"
input: "boolean"
headword: "noun-articles"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Students should be a students who take responsibility for their own learning.'"
answer: false
grammar_article_slug: "nouns"
explain: "SAI — 'students' ở đây là số nhiều, không xác định cụ thể → không dùng mạo từ. Sửa: 'Students should be students who take responsibility for their own learning.'"
---

# ===== item_key 3 · Danh từ số nhiều bất quy tắc (irregular plurals) =====

---
id: "noun_pl_b1"
type: "mcq"
input: "choice"
headword: "noun-irregular-plurals"
skill: "form"
subtype: "basic"
prompt: "Many ____ in this village still walk several kilometres to school every day."
options: ["children", "childs", "childrens", "child"]
answer: 0
grammar_article_slug: "nouns"
explain: "Số nhiều bất quy tắc của 'child' là 'children', không thêm -s."
---

---
id: "noun_pl_b2"
type: "mcq"
input: "choice"
headword: "noun-irregular-plurals"
skill: "form"
subtype: "basic"
prompt: "Doctors examined the patient's ____ carefully after the accident."
options: ["teeth", "tooths", "teeths", "tooth"]
answer: 0
grammar_article_slug: "nouns"
explain: "Số nhiều bất quy tắc của 'tooth' là 'teeth'."
---

---
id: "noun_pl_i1"
type: "gap_mcq"
input: "choice"
headword: "noun-irregular-plurals"
skill: "usage"
subtype: "intermediate"
prompt: "The survey shows that most young ____ prefer working in the city rather than the countryside."
options: ["people", "persons", "peoples", "person"]
answer: 0
grammar_article_slug: "nouns"
explain: "'people' là dạng số nhiều thông dụng của 'person' khi nói chung chung về con người."
---

---
id: "noun_pl_i2"
type: "gap_text"
input: "text"
headword: "noun-irregular-plurals"
skill: "production"
subtype: "intermediate"
prompt: "Conservationists warn that several endangered ____ (mouse, viết dạng số nhiều bất quy tắc) species may disappear within a decade."
accept: ["mice"]
case_sensitive: false
grammar_article_slug: "nouns"
explain: "Số nhiều bất quy tắc của 'mouse' là 'mice', không phải 'mouses'."
---

---
id: "noun_pl_a1"
type: "boolean"
input: "boolean"
headword: "noun-irregular-plurals"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The report shows that over three million persons were affected by the flood.'"
answer: false
grammar_article_slug: "nouns"
explain: "SAI — với số lượng lớn người nói chung, dùng 'people' (số nhiều bất quy tắc của person), không dùng 'persons'. Sửa: 'over three million people were affected'."
---

# ===== item_key 4 · Sở hữu cách 's / danh từ ghép (missing_article context) =====

---
id: "noun_poss_b1"
type: "mcq"
input: "choice"
headword: "noun-possessive-compound"
skill: "form"
subtype: "basic"
prompt: "____ presentation impressed the whole management team."
options: ["The manager's", "The managers", "The manager", "Managers'"]
answer: 0
grammar_article_slug: "nouns"
explain: "Sở hữu cách số ít thêm 's: 'the manager's presentation' = bài thuyết trình của người quản lý."
---

---
id: "noun_poss_i1"
type: "gap_mcq"
input: "choice"
headword: "noun-possessive-compound"
skill: "usage"
subtype: "intermediate"
prompt: "The school announced changes to ____ results after the appeal process."
options: ["the students'", "the student's", "the students", "students"]
answer: 0
grammar_article_slug: "nouns"
explain: "Danh từ số nhiều đã kết thúc bằng -s ('students') → chỉ thêm dấu nháy đơn ('), không thêm 's nữa: the students'."
---

---
id: "noun_poss_i2"
type: "gap_text"
input: "text"
headword: "noun-possessive-compound"
skill: "production"
subtype: "intermediate"
prompt: "During the crisis, ____ (government, sở hữu cách số ít) response was criticised for being too slow."
accept: ["the government's", "government's"]
case_sensitive: false
grammar_article_slug: "nouns"
explain: "'government' là danh từ số ít → thêm 's: the government's response."
---

---
id: "noun_poss_a1"
type: "boolean"
input: "boolean"
headword: "noun-possessive-compound"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The companys' profits increased significantly this quarter.'"
answer: false
grammar_article_slug: "nouns"
explain: "SAI — dạng số nhiều của 'company' là 'companies', và sở hữu cách số nhiều đúng phải là 'companies''. Nếu chỉ MỘT công ty thì viết 'the company's profits'."
---

---
id: "noun_poss_a2"
type: "boolean"
input: "boolean"
headword: "noun-possessive-compound"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The children's toys were scattered all over the living room floor.'"
answer: true
grammar_article_slug: "nouns"
explain: "ĐÚNG — 'children' đã là số nhiều bất quy tắc (không kết thúc bằng -s), nên sở hữu cách thêm 's bình thường: children's."
---
