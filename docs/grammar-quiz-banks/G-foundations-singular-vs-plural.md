---
kind: quiz
code: "G-foundations-singular-vs-plural"
title: "Quick Check — Singular vs. Plural"
skill_area: "grammar"
topic: "Foundations"
mode: "adaptive_mastery"
grading: "instant"
correct_to_master: 2
require_distinct_skill: true
require_production_to_master: true
cooldown: 2
shuffle_options: true
words_count: 5
source: "authored-2026-07"
---

# ===== item_key 1 · Irregular Plurals (số nhiều bất quy tắc) =====

---
id: "svp_irr_b1"
type: "mcq"
input: "choice"
headword: "svp-irregular-plurals"
skill: "form"
subtype: "basic"
prompt: "The plural of 'child' is ____."
options: ["childs", "childes", "children", "child"]
answer: 2
grammar_article_slug: "singular-vs-plural"
explain: "'child' có dạng số nhiều bất quy tắc là 'children', không thêm -s hay -es."
why_wrong:
  '0': Danh từ "child" có dạng số nhiều bất quy tắc, không phải bằng cách thêm -s.
  '1': Danh từ "child" có dạng số nhiều bất quy tắc, không phải bằng cách thêm -es.
  '3': Đây là dạng số ít của danh từ "child", không phải dạng số nhiều.
---

---
id: "svp_irr_b2"
type: "mcq"
input: "choice"
headword: "svp-irregular-plurals"
skill: "form"
subtype: "basic"
prompt: "The plural of 'woman' is ____."
options: ["womans", "women", "womens", "woman"]
answer: 1
grammar_article_slug: "singular-vs-plural"
explain: "'woman' đổi thành 'women' — đổi nguyên âm giữa từ, không thêm -s."
---

---
id: "svp_irr_i1"
type: "gap_mcq"
input: "choice"
headword: "svp-irregular-plurals"
skill: "usage"
subtype: "intermediate"
prompt: "The ____ for evaluating students' performance have changed significantly. (plural of 'criterion')"
options: ["criterias", "criterions", "criteria", "criterion"]
answer: 2
grammar_article_slug: "singular-vs-plural"
explain: "'criterion' (gốc Greek) có số nhiều bất quy tắc là 'criteria', không thêm -s."
why_wrong:
  '0': '''Criterias'' là dạng sai vì danh từ ''criterion'' có số nhiều bất quy tắc là ''criteria'', không thêm ''s'' để tạo thành số nhiều.'
  '1': '''Criterions'' là dạng số nhiều sai vì ''criterion'' là danh từ gốc Hy Lạp có số nhiều bất quy tắc là ''criteria'', không thêm -s.'
  '3': '''Criterion'' là danh từ số ít, nhưng động từ trong câu ("have changed") yêu cầu một danh từ số nhiều tương ứng.'
---

---
id: "svp_irr_i2"
type: "gap_text"
input: "text"
headword: "svp-irregular-plurals"
skill: "production"
subtype: "intermediate"
prompt: "Many ____ (phenomenon) of modern life need to be studied carefully — write the plural form of 'phenomenon'."
accept: ["phenomena"]
case_sensitive: false
grammar_article_slug: "singular-vs-plural"
explain: "'phenomenon' (gốc Greek, đuôi -on) đổi thành 'phenomena' ở dạng số nhiều."
---

---
id: "svp_irr_a1"
type: "boolean"
input: "boolean"
headword: "svp-irregular-plurals"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The childrens are playing outside.' là câu đúng ngữ pháp."
answer: false
grammar_article_slug: "singular-vs-plural"
explain: "SAI — 'children' đã là dạng số nhiều, không được thêm -s nữa. Sửa lại: 'The children are playing outside.'"
---

# ===== item_key 2 · Subject-Verb Agreement (hòa hợp chủ-vị) — mã lỗi: subject_verb_disagreement =====

---
id: "svp_sva_b1"
type: "mcq"
input: "choice"
headword: "svp-subject-verb-agreement"
skill: "form"
subtype: "basic"
prompt: "The students ____ working hard for the exam."
options: ["is", "are", "was", "has"]
answer: 1
grammar_article_slug: "singular-vs-plural"
explain: "Chủ ngữ 'The students' là số nhiều → dùng động từ số nhiều 'are'."
why_wrong:
  '0': is là động từ số ít, không phù hợp với chủ ngữ số nhiều 'The students'.
  '2': was là động từ số ít (thì quá khứ), không tương thích với chủ ngữ số nhiều 'The students' và ngữ cảnh hiện tại.
  '3': has là dạng của động từ 'to have', không phải động từ 'to be' cần thiết để tạo thành thì tiếp diễn với 'working'.
---

---
id: "svp_sva_b2"
type: "mcq"
input: "choice"
headword: "svp-subject-verb-agreement"
skill: "form"
subtype: "basic"
prompt: "Each student ____ a textbook."
options: ["have", "has", "having", "are having"]
answer: 1
grammar_article_slug: "singular-vs-plural"
explain: "'Each' luôn đi với danh từ số ít và động từ số ít: 'Each student has'."
why_wrong:
  '0': Động từ "have" là dạng số nhiều, không phù hợp với chủ ngữ số ít "Each student".
  '2': '"Having" là dạng V-ing, không thể làm động từ chính của câu nếu không có trợ động từ.'
  '3': Trợ động từ "are" là dạng số nhiều, không phù hợp với chủ ngữ số ít "Each student".
---

---
id: "svp_sva_i1"
type: "gap_mcq"
input: "choice"
headword: "svp-subject-verb-agreement"
skill: "error_id"
subtype: "intermediate"
prompt: "The results of the study ____ surprising, even though 'study' is right next to the verb."
options: ["was", "were", "is", "has been"]
answer: 1
grammar_article_slug: "singular-vs-plural"
explain: "Chủ ngữ thật là 'results' (số nhiều), không phải 'study' (từ gần động từ nhất) → dùng 'were'. Đây là lỗi phổ biến khi bị 'of the study' đánh lạc hướng."
why_wrong:
  '0': was là động từ số ít, không phù hợp với chủ ngữ số nhiều "results".
  '2': is là động từ số ít, không phù hợp với chủ ngữ số nhiều "results".
  '3': has been là động từ số ít, không phù hợp với chủ ngữ số nhiều "results".
---

---
id: "svp_sva_i2"
type: "gap_text"
input: "text"
headword: "svp-subject-verb-agreement"
skill: "production"
subtype: "intermediate"
prompt: "The information on the website ____ (be) accurate — write the correct form of 'be' for the subject 'information' (uncountable)."
accept: ["is"]
case_sensitive: false
grammar_article_slug: "singular-vs-plural"
explain: "'information' là danh từ không đếm được (uncountable), luôn đi với động từ số ít: 'is'."
---

---
id: "svp_sva_a1"
type: "boolean"
input: "boolean"
headword: "svp-subject-verb-agreement"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Each of the phenomena observed in the study was carefully documented.' là câu đúng ngữ pháp."
answer: true
grammar_article_slug: "singular-vs-plural"
explain: "ĐÚNG — chủ ngữ thật là 'Each' (số ít), không phải 'phenomena', nên động từ 'was' số ít là chính xác."
---

---
id: "svp_sva_a2"
type: "boolean"
input: "boolean"
headword: "svp-subject-verb-agreement"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The scissors is on the table.' là câu đúng ngữ pháp."
answer: false
grammar_article_slug: "singular-vs-plural"
explain: "SAI — 'scissors' là plural-only noun (danh từ luôn ở dạng số nhiều), phải dùng động từ số nhiều 'are'. Sửa lại: 'The scissors are on the table.'"
---

# ===== item_key 3 · "The number of" vs. "A number of" =====

---
id: "svp_num_b1"
type: "mcq"
input: "choice"
headword: "svp-number-of-vs-a-number-of"
skill: "form"
subtype: "basic"
prompt: "The number of students ____ increasing every year."
options: ["is", "are", "were", "have been"]
answer: 0
grammar_article_slug: "singular-vs-plural"
explain: "'The number of' là chủ ngữ số ít (bản thân 'number' là danh từ số ít) → dùng động từ số ít 'is'."
why_wrong:
  '1': are là động từ số nhiều, trong khi chủ ngữ 'The number of' là số ít.
  '2': were là thì quá khứ, không phù hợp với ngữ cảnh 'every year' chỉ sự việc đang tiếp diễn ở hiện tại.
  '3': have been là động từ số nhiều, không tương thích với chủ ngữ 'The number of' là số ít.
---

---
id: "svp_num_b2"
type: "mcq"
input: "choice"
headword: "svp-number-of-vs-a-number-of"
skill: "form"
subtype: "basic"
prompt: "A number of solutions ____ been proposed."
options: ["has", "have", "is", "was"]
answer: 1
grammar_article_slug: "singular-vs-plural"
explain: "'A number of' mang nghĩa 'nhiều' → coi như chủ ngữ số nhiều, dùng động từ số nhiều 'have'."
why_wrong:
  '0': '''has'' là động từ số ít, không tương thích với chủ ngữ ''A number of solutions'' (số nhiều).'
  '2': '''is'' là động từ số ít và không đúng cấu trúc ngữ pháp với ''been proposed''.'
  '3': '''was'' là động từ số ít và không đúng cấu trúc ngữ pháp với ''been proposed''.'
---

---
id: "svp_num_i1"
type: "gap_mcq"
input: "choice"
headword: "svp-number-of-vs-a-number-of"
skill: "contrast"
subtype: "intermediate"
prompt: "Compare: 'The number of applicants ____ rising' vs. 'A number of applicants ____ absent today.'"
options: ["is / are", "are / is", "is / is", "are / are"]
answer: 0
grammar_article_slug: "singular-vs-plural"
explain: "'The number of' = chủ ngữ số ít → 'is'. 'A number of' = nghĩa 'nhiều' → chủ ngữ số nhiều → 'are'."
---

---
id: "svp_num_i2"
type: "gap_text"
input: "text"
headword: "svp-number-of-vs-a-number-of"
skill: "production"
subtype: "intermediate"
prompt: "A number of employees ____ (request) additional training this year — write the correct plural verb form of 'request'."
accept: ["have requested", "requested", "request"]
case_sensitive: false
grammar_article_slug: "singular-vs-plural"
explain: "'A number of' + plural noun → coi là chủ ngữ số nhiều, dùng động từ số nhiều (ví dụ: have requested)."
---

---
id: "svp_num_a1"
type: "boolean"
input: "boolean"
headword: "svp-number-of-vs-a-number-of"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The number of fake news stories are growing rapidly.' là câu đúng ngữ pháp."
answer: false
grammar_article_slug: "singular-vs-plural"
explain: "SAI — 'the number of' là chủ ngữ số ít, phải dùng 'is', không phải 'are'. Sửa lại: 'The number of fake news stories is growing rapidly.'"
---

# ===== item_key 4 · Plural-only Nouns & Uncountable Nouns (luôn số nhiều / không đếm được) =====

---
id: "svp_puo_b1"
type: "mcq"
input: "choice"
headword: "svp-plural-only-uncountable"
skill: "form"
subtype: "basic"
prompt: "My glasses ____ on the table."
options: ["is", "are", "was", "has been"]
answer: 1
grammar_article_slug: "singular-vs-plural"
explain: "'glasses' (kính đeo mắt) là plural-only noun — luôn dùng động từ số nhiều 'are'."
why_wrong:
  '0': Phương án này dùng động từ "is" là số ít, không phù hợp với chủ ngữ "glasses" luôn được coi là số nhiều.
  '2': Phương án này dùng động từ "was" là số ít (ở thì quá khứ), không đúng với chủ ngữ "glasses" là số nhiều.
  '3': Phương án này dùng trợ động từ "has" ở dạng số ít, không tương thích với chủ ngữ "glasses" là số nhiều.
---

---
id: "svp_puo_i1"
type: "gap_mcq"
input: "choice"
headword: "svp-plural-only-uncountable"
skill: "usage"
subtype: "intermediate"
prompt: "The information on this topic ____ still limited, despite years of research."
options: ["is", "are", "were", "have been"]
answer: 0
grammar_article_slug: "singular-vs-plural"
explain: "'information' là uncountable noun, luôn dùng động từ số ít 'is', dù nghe có vẻ là 'nhiều thông tin'."
why_wrong:
  '1': Động từ "are" là số nhiều, không phù hợp với danh từ không đếm được "information" vốn luôn đi với động từ số ít.
  '2': Động từ "were" là số nhiều và thì quá khứ, không phù hợp với danh từ không đếm được "information" và ngữ cảnh hiện tại ("still limited").
  '3': Cụm động từ "have been" sử dụng trợ động từ "have" là số nhiều, không phù hợp với danh từ không đếm được "information" vốn cần trợ động từ số ít "has".
---

---
id: "svp_puo_i2"
type: "gap_text"
input: "text"
headword: "svp-plural-only-uncountable"
skill: "production"
subtype: "intermediate"
prompt: "Where ____ (be) my jeans? I can't find them anywhere — write the correct form of 'be' since 'jeans' is a plural-only noun."
accept: ["are"]
case_sensitive: false
grammar_article_slug: "singular-vs-plural"
explain: "'jeans' là plural-only noun (đồ dùng gồm 2 phần), luôn đi với động từ số nhiều 'are'."
---

---
id: "svp_puo_a1"
type: "boolean"
input: "boolean"
headword: "svp-plural-only-uncountable"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The information are available on the website.' là câu đúng ngữ pháp."
answer: false
grammar_article_slug: "singular-vs-plural"
explain: "SAI — 'information' là danh từ không đếm được, luôn dùng động từ số ít. Sửa lại: 'The information is available on the website.'"
---
