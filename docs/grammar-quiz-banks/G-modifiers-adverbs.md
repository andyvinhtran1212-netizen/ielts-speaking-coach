---
kind: quiz
code: "G-modifiers-adverbs"
title: "Quick Check — Adverbs"
skill_area: "grammar"
topic: "Modifiers"
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

# ===== item_key 1 · Vị trí frequency adverbs (always/usually/never...) =====

---
id: "freqpos_b1"
type: "mcq"
input: "choice"
headword: "frequency-adverb-position"
skill: "form"
subtype: "basic"
prompt: "I ____ drink coffee in the morning before work."
options: ["always", "am always", "drink always", "always drink always"]
answer: 0
grammar_article_slug: "adverbs"
explain: "Frequency adverb đứng TRƯỚC động từ thường: I always drink coffee."
---

---
id: "freqpos_b2"
type: "mcq"
input: "choice"
headword: "frequency-adverb-position"
skill: "form"
subtype: "basic"
prompt: "She ____ late for meetings — she's very punctual."
options: ["is never", "never is", "is being never", "never being"]
answer: 0
grammar_article_slug: "adverbs"
explain: "Frequency adverb đứng SAU động từ 'be': She is never late."
---

---
id: "freqpos_i1"
type: "gap_mcq"
input: "choice"
headword: "frequency-adverb-position"
skill: "usage"
subtype: "intermediate"
prompt: "We ____ discussed this issue in previous meetings, but never reached a conclusion."
options: ["have often", "often have", "have discussed often", "often"]
answer: 0
grammar_article_slug: "adverbs"
explain: "Với auxiliary verb 'have', frequency adverb đứng SAU auxiliary và TRƯỚC main verb: have often discussed."
---

---
id: "freqpos_i2"
type: "gap_text"
input: "text"
headword: "frequency-adverb-position"
skill: "production"
subtype: "intermediate"
prompt: "Correct the adverb position: 'I skip breakfast sometimes when I'm running late.' → I ____ breakfast... (write the adverb + verb in correct order, 2 words)."
accept: ["sometimes skip"]
case_sensitive: false
grammar_article_slug: "adverbs"
explain: "Frequency adverb 'sometimes' nên đứng trước động từ thường 'skip': 'I sometimes skip breakfast...'"
---

---
id: "freqpos_a1"
type: "boolean"
input: "boolean"
headword: "frequency-adverb-position"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'I drink always coffee in the morning before checking my emails.'"
answer: false
grammar_article_slug: "adverbs"
explain: "SAI (word_order_error) — frequency adverb không đứng giữa động từ và tân ngữ: 'I always drink coffee in the morning before checking my emails.'"
---

---
id: "freqpos_a2"
type: "boolean"
input: "boolean"
headword: "frequency-adverb-position"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She is on time for meetings never, which impresses her manager.'"
answer: false
grammar_article_slug: "adverbs"
explain: "SAI (word_order_error) — frequency adverb 'never' phải đứng ngay SAU 'be', không đứng cuối câu: 'She is never on time for meetings, which impresses her manager.'"
---

# ===== item_key 2 · Vị trí manner adverbs (không chen giữa verb và object) =====

---
id: "mannerpos_b1"
type: "mcq"
input: "choice"
headword: "manner-adverb-position"
skill: "form"
subtype: "basic"
prompt: "She speaks English ____."
options: ["fluently", "fluent", "fluency", "more fluent"]
answer: 0
grammar_article_slug: "adverbs"
explain: "Manner adverb thường đứng SAU động từ và tân ngữ: speaks English fluently."
---

---
id: "mannerpos_b2"
type: "mcq"
input: "choice"
headword: "manner-adverb-position"
skill: "form"
subtype: "basic"
prompt: "He answered every question ____ during the interview."
options: ["confidently", "confident", "confidence", "more confident"]
answer: 0
grammar_article_slug: "adverbs"
explain: "Manner adverb đứng sau verb + object: answered every question confidently."
---

---
id: "mannerpos_i1"
type: "gap_mcq"
input: "choice"
headword: "manner-adverb-position"
skill: "usage"
subtype: "intermediate"
prompt: "I like this documentary ____ — it completely changed how I see the issue."
options: ["very much", "much very", "very", "much"]
answer: 0
grammar_article_slug: "adverbs"
explain: "'very much' đứng SAU tân ngữ trong cấu trúc like + object + very much, không chen vào giữa verb và object."
---

---
id: "mannerpos_i2"
type: "gap_text"
input: "text"
headword: "manner-adverb-position"
skill: "production"
subtype: "intermediate"
prompt: "Sửa lại câu cho đúng vị trí: 'She speaks fluently three languages.' — chỉ viết lại đúng: 'She speaks three languages ____.'"
accept: ["fluently"]
case_sensitive: false
grammar_article_slug: "adverbs"
explain: "Manner adverb 'fluently' phải đứng SAU tân ngữ 'three languages', không chen giữa verb và object."
---

---
id: "mannerpos_a1"
type: "boolean"
input: "boolean"
headword: "manner-adverb-position"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She speaks fluently English after living in London for five years.'"
answer: false
grammar_article_slug: "adverbs"
explain: "SAI (word_order_error) — manner adverb không đứng giữa verb và object: 'She speaks English fluently after living in London for five years.'"
---

---
id: "mannerpos_a2"
type: "boolean"
input: "boolean"
headword: "manner-adverb-position"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'I like very much this new policy on remote working.'"
answer: false
grammar_article_slug: "adverbs"
explain: "SAI (word_order_error) — 'very much' phải đứng sau tân ngữ: 'I like this new policy on remote working very much.'"
---

# ===== item_key 3 · Degree adverbs (very/much) với comparative =====

---
id: "degreecomp_b1"
type: "mcq"
input: "choice"
headword: "degree-adverb-very-comparative"
skill: "form"
subtype: "basic"
prompt: "It's ____ cold today, so bring a jacket."
options: ["very", "much", "far", "a lot"]
answer: 0
grammar_article_slug: "adverbs"
explain: "'very' bổ nghĩa cho adjective ở dạng gốc (positive) 'cold' — đây không phải comparative."
---

---
id: "degreecomp_b2"
type: "mcq"
input: "choice"
headword: "degree-adverb-very-comparative"
skill: "contrast"
subtype: "basic"
prompt: "The situation is ____ worse than we expected."
options: ["much", "very", "so", "too"]
answer: 0
grammar_article_slug: "adverbs"
explain: "'very' KHÔNG đi với comparative (-er). Với dạng so sánh hơn, dùng 'much/far/considerably': much worse."
---

---
id: "degreecomp_i1"
type: "gap_mcq"
input: "choice"
headword: "degree-adverb-very-comparative"
skill: "usage"
subtype: "intermediate"
prompt: "She runs ____ faster than her older brother now."
options: ["much", "very", "so", "too much"]
answer: 0
grammar_article_slug: "adverbs"
explain: "Với comparative adjective/adverb (faster), dùng 'much', không dùng 'very'."
---

---
id: "degreecomp_i2"
type: "gap_text"
input: "text"
headword: "degree-adverb-very-comparative"
skill: "production"
subtype: "intermediate"
prompt: "Correct the sentence: 'This year's exam was very ____ than last year's.' — write the degree adverb that replaces 'very' (before the comparative)."
accept: ["much", "far", "considerably"]
case_sensitive: false
grammar_article_slug: "adverbs"
explain: "'very' không dùng với comparative -er. Thay bằng 'much/far/considerably': 'This year's exam was much/far/considerably harder than last year's.'"
---

---
id: "degreecomp_a1"
type: "boolean"
input: "boolean"
headword: "degree-adverb-very-comparative"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Public transport in this city is very better than it was ten years ago.'"
answer: false
grammar_article_slug: "adverbs"
explain: "SAI — 'very' không đi với comparative 'better': 'Public transport in this city is much better than it was ten years ago.'"
---

---
id: "degreecomp_a2"
type: "boolean"
input: "boolean"
headword: "degree-adverb-very-comparative"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The new policy is far more effective than the previous one.'"
answer: true
grammar_article_slug: "adverbs"
explain: "ĐÚNG — 'far' hợp lệ để bổ nghĩa cho comparative 'more effective', giống như 'much'."
---

# ===== item_key 4 · Sentence adverbs (However, Therefore...) & dấu câu =====

---
id: "sentadv_b1"
type: "mcq"
input: "choice"
headword: "sentence-adverb-punctuation"
skill: "form"
subtype: "basic"
prompt: "____, this approach has some serious limitations."
options: ["However", "But however", "How ever", "Howevery"]
answer: 0
grammar_article_slug: "adverbs"
explain: "'However' đứng đầu câu, theo sau bởi dấu phẩy, để bình luận/tương phản với ý trước."
---

---
id: "sentadv_i1"
type: "gap_mcq"
input: "choice"
headword: "sentence-adverb-punctuation"
skill: "usage"
subtype: "intermediate"
prompt: "The plan was well-designed. ____, it turned out to be too expensive to implement."
options: ["However", "Despite", "Although", "Because"]
answer: 0
grammar_article_slug: "adverbs"
explain: "'However' là sentence adverb đứng đầu câu mới để nêu ý tương phản với câu trước, có dấu phẩy theo sau."
---

---
id: "sentadv_i2"
type: "gap_mcq"
input: "choice"
headword: "sentence-adverb-punctuation"
skill: "usage"
subtype: "intermediate"
prompt: "Many people overlook this simple fact. ____, it's one of the most important factors in the debate."
options: ["Surprisingly", "Surprising", "Surprise", "To surprise"]
answer: 0
grammar_article_slug: "adverbs"
explain: "'Surprisingly' là sentence adverb chỉ thái độ, đứng đầu câu và có dấu phẩy theo sau."
---

---
id: "sentadv_i3"
type: "gap_text"
input: "text"
headword: "sentence-adverb-punctuation"
skill: "production"
subtype: "intermediate"
prompt: "Nối hai câu bằng linking adverb đúng dấu câu: 'The plan was good' + 'it was too expensive.' — viết đúng phần nối: 'The plan was good. ____, it was too expensive.'"
accept: ["However", "however"]
case_sensitive: false
grammar_article_slug: "adverbs"
explain: "'However' đứng đầu câu mới (sau dấu chấm), theo sau là dấu phẩy — không nối hai mệnh đề chỉ bằng dấu phẩy."
---

---
id: "sentadv_a1"
type: "boolean"
input: "boolean"
headword: "sentence-adverb-punctuation"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The plan was good, however it was too expensive to carry out.'"
answer: false
grammar_article_slug: "adverbs"
explain: "SAI — đây là comma splice: 'However' không thể nối 2 mệnh đề chỉ bằng dấu phẩy đơn: 'The plan was good. However, it was too expensive to carry out.'"
---

---
id: "sentadv_a2"
type: "boolean"
input: "boolean"
headword: "sentence-adverb-punctuation"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Governments have consistently failed to address the root causes; consequently, public trust has declined.'"
answer: true
grammar_article_slug: "adverbs"
explain: "ĐÚNG — dùng dấu chấm phẩy trước 'consequently' và dấu phẩy sau nó, đúng cấu trúc sentence adverb nối hai mệnh đề độc lập."
---
