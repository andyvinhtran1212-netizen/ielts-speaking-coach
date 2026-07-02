---
kind: quiz
code: "G-foundations-word-order"
title: "Quick Check — Word Order"
skill_area: "grammar"
topic: "Foundations"
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

# ===== item_key 1 · S-V-O cơ bản (chủ ngữ - động từ - tân ngữ) =====

---
id: "wo_svo_b1"
type: "mcq"
input: "choice"
headword: "wo-svo-basic"
skill: "form"
subtype: "basic"
prompt: "Choose the correct word order."
options: ["She every morning drinks coffee.", "She drinks coffee every morning.", "She drinks every morning coffee.", "Drinks she coffee every morning."]
answer: 1
grammar_article_slug: "word-order"
explain: "Trật tự cơ bản: Subject → Verb → Object → (Adverbial). 'She drinks coffee every morning' đúng thứ tự S-V-O-time."
---

---
id: "wo_svo_b2"
type: "boolean"
input: "boolean"
headword: "wo-svo-basic"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'I rice eat every day.'"
answer: false
grammar_article_slug: "word-order"
explain: "SAI — tiếng Việt cho phép S-O-V nhưng tiếng Anh bắt buộc S-V-O: 'I eat rice every day.' (lỗi word_order_error)"
---

---
id: "wo_svo_i1"
type: "gap_mcq"
input: "choice"
headword: "wo-svo-basic"
skill: "usage"
subtype: "intermediate"
prompt: "Choose the most natural order: 'The examiner ____.'"
options: ["carefully explained the task to the candidates", "explained carefully the task to the candidates", "the task explained carefully to the candidates", "explained the task carefully to the candidates"]
answer: 3
grammar_article_slug: "word-order"
explain: "Manner adverb 'carefully' tự nhiên nhất khi đứng SAU động từ và tân ngữ: 'explained the task carefully' (S-V-O giữ nguyên, adverb ở cuối). Đặt trước động từ ('carefully explained') đúng ngữ pháp nhưng không tự nhiên; chen giữa verb và object ('explained carefully the task') thì sai vì tách rời V-O."
---

---
id: "wo_svo_i2"
type: "gap_text"
input: "text"
headword: "wo-svo-basic"
skill: "production"
subtype: "intermediate"
prompt: "Sắp xếp lại thành câu đúng trật tự S-V-O, viết lại cả câu: 'homework / finishes / she / quickly' → She ____"
accept: ["finishes homework quickly", "quickly finishes homework"]
case_sensitive: false
grammar_article_slug: "word-order"
explain: "Trật tự chuẩn: Subject (She) → Verb (finishes) → Object (homework) → Adverb (quickly)."
---

---
id: "wo_svo_a1"
type: "mcq"
input: "choice"
headword: "wo-svo-basic"
skill: "contrast"
subtype: "advanced"
prompt: "In an IELTS Speaking Part 3 answer, which sentence keeps the Subject-Verb-Object order intact while still fronting a time adverbial for emphasis?"
options: ["Nowadays young people spend most of their free time online.", "Nowadays young people online spend most of their free time.", "Young people most of their free time spend online nowadays.", "Spend young people nowadays most of their free time online."]
answer: 0
grammar_article_slug: "word-order"
explain: "Trạng ngữ thời gian có thể đứng đầu câu ('Nowadays'), nhưng phần còn lại vẫn phải theo đúng Subject → Verb → Object: 'young people spend most of their free time online'."
---

# ===== item_key 2 · Trật tự tính từ trước danh từ (attributive vs predicative + adjective ordering) =====

---
id: "wo_adj_b1"
type: "mcq"
input: "choice"
headword: "wo-adjective-order"
skill: "form"
subtype: "basic"
prompt: "She bought ____ for the interview."
options: ["a suit black new", "a new black suit", "a black new suit", "a suit new black"]
answer: 1
grammar_article_slug: "word-order"
explain: "Tính từ luôn đứng TRƯỚC danh từ trong tiếng Anh, theo thứ tự Age → Colour: 'a new black suit'."
---

---
id: "wo_adj_b2"
type: "boolean"
input: "boolean"
headword: "wo-adjective-order"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'I want a car red for my birthday.'"
answer: false
grammar_article_slug: "word-order"
explain: "SAI — tiếng Việt để tính từ sau danh từ ('xe đỏ') nhưng tiếng Anh đặt trước: 'I want a red car for my birthday.' (lỗi word_order_error)"
---

---
id: "wo_adj_i1"
type: "gap_mcq"
input: "choice"
headword: "wo-adjective-order"
skill: "usage"
subtype: "intermediate"
prompt: "The museum displayed ____ vase from the Ming dynasty."
options: ["a Chinese beautiful ancient", "an ancient beautiful Chinese", "a beautiful ancient Chinese", "a beautiful Chinese ancient"]
answer: 2
grammar_article_slug: "word-order"
explain: "Thứ tự Opinion (beautiful) → Age (ancient) → Origin (Chinese) → Noun: 'a beautiful ancient Chinese vase'."
---

---
id: "wo_adj_i2"
type: "gap_text"
input: "text"
headword: "wo-adjective-order"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại đúng thứ tự tính từ (opinion trước size): 'lovely / small' + apartment → She lives in a ____ apartment."
accept: ["lovely small"]
case_sensitive: false
grammar_article_slug: "word-order"
explain: "Opinion (lovely) đứng trước Size (small): 'a lovely small apartment'."
---

---
id: "wo_adj_a1"
type: "mcq"
input: "choice"
headword: "wo-adjective-order"
skill: "contrast"
subtype: "advanced"
prompt: "Which sentence correctly uses an adjective in predicative position (after a linking verb)?"
options: ["She wore a dress beautiful to the ceremony.", "The dress looks beautiful on her.", "She wore a beautiful looks dress.", "The beautiful looks dress on her."]
answer: 1
grammar_article_slug: "word-order"
explain: "'The dress looks beautiful' — tính từ đứng SAU động từ liên kết 'looks' (predicative use) là đúng ngữ pháp; đứng trước danh từ mới cần vị trí attributive."
---

---
id: "wo_adj_a2"
type: "boolean"
input: "boolean"
headword: "wo-adjective-order"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She wore a dress beautiful to the graduation ceremony' là đúng ngữ pháp vì tính từ đang mô tả trực tiếp danh từ 'dress'."
answer: false
grammar_article_slug: "word-order"
explain: "SAI — khi mô tả trực tiếp (attributive), tính từ phải đứng TRƯỚC danh từ: 'She wore a beautiful dress to the graduation ceremony.' (lỗi word_order_error)"
---

# ===== item_key 3 · Vị trí trạng từ tần suất (frequency adverbs: always/usually/never...) =====

---
id: "wo_adv_b1"
type: "mcq"
input: "choice"
headword: "wo-adverb-frequency"
skill: "form"
subtype: "basic"
prompt: "Choose the correct sentence."
options: ["I drink always coffee in the morning.", "I always drink coffee in the morning.", "Always I drink coffee in the morning.", "I drink coffee always in the morning."]
answer: 1
grammar_article_slug: "word-order"
explain: "Frequency adverb (always) đứng TRƯỚC động từ chính: 'I always drink coffee'."
---

---
id: "wo_adv_b2"
type: "boolean"
input: "boolean"
headword: "wo-adverb-frequency"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'He goes never to the gym after work.'"
answer: false
grammar_article_slug: "word-order"
explain: "SAI — 'never' phải đứng TRƯỚC động từ chính, không phải sau: 'He never goes to the gym after work.' (lỗi word_order_error)"
---

---
id: "wo_adv_i1"
type: "gap_mcq"
input: "choice"
headword: "wo-adverb-frequency"
skill: "usage"
subtype: "intermediate"
prompt: "In job interviews, candidates ____ nervous, even when well prepared."
options: ["are usually", "usually are", "are always usually", "usually to be"]
answer: 0
grammar_article_slug: "word-order"
explain: "Frequency adverb đứng SAU động từ 'be': 'candidates are usually nervous' (không phải trước be)."
---

---
id: "wo_adv_i2"
type: "gap_text"
input: "text"
headword: "wo-adverb-frequency"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại đúng vị trí trạng từ tần suất: 'I / have / never / been / to Japan' → I ____ to Japan."
accept: ["have never been"]
case_sensitive: false
grammar_article_slug: "word-order"
explain: "Với cấu trúc have + V3, trạng từ tần suất đứng GIỮA auxiliary (have) và động từ chính (been): 'I have never been to Japan.'"
---

---
id: "wo_adv_a1"
type: "boolean"
input: "boolean"
headword: "wo-adverb-frequency"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'I always am tired after a full day of exam practice.'"
answer: false
grammar_article_slug: "word-order"
explain: "SAI — trạng từ tần suất đứng SAU động từ 'be', không phải trước: 'I am always tired after a full day of exam practice.' (lỗi word_order_error)"
---

# ===== item_key 4 · Đảo trợ động từ trong câu hỏi (question inversion: yes/no và wh-) =====

---
id: "wo_qinv_b1"
type: "mcq"
input: "choice"
headword: "wo-question-inversion"
skill: "form"
subtype: "basic"
prompt: "Choose the correct question."
options: ["You are a student?", "Are you a student?", "You a student are?", "Student are you a?"]
answer: 1
grammar_article_slug: "word-order"
explain: "Câu hỏi Yes/No phải đảo trợ động từ (be/do/can...) lên trước chủ ngữ: 'Are you a student?'"
---

---
id: "wo_qinv_b2"
type: "boolean"
input: "boolean"
headword: "wo-question-inversion"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'She does live here?' là câu hỏi đúng ngữ pháp."
answer: false
grammar_article_slug: "word-order"
explain: "SAI — trợ động từ 'does' phải đứng TRƯỚC chủ ngữ trong câu hỏi: 'Does she live here?' (lỗi word_order_error)"
---

---
id: "wo_qinv_i1"
type: "gap_mcq"
input: "choice"
headword: "wo-question-inversion"
skill: "usage"
subtype: "intermediate"
prompt: "____ you prepare for the speaking test — did you practise with a partner?"
options: ["How did", "How you did", "Did how", "You did how"]
answer: 0
grammar_article_slug: "word-order"
explain: "Câu hỏi Wh-: Wh-word + trợ động từ + Subject + Main Verb: 'How did you prepare...?'"
---

---
id: "wo_qinv_i2"
type: "gap_text"
input: "text"
headword: "wo-question-inversion"
skill: "production"
subtype: "intermediate"
prompt: "Viết câu hỏi đúng trật tự (đảo trợ động từ): 'you / where / do / live' → ____?"
accept: ["Where do you live", "where do you live"]
case_sensitive: false
grammar_article_slug: "word-order"
explain: "Wh-word (Where) + trợ động từ (do) + Subject (you) + Main Verb (live): 'Where do you live?'"
---

---
id: "wo_qinv_a1"
type: "boolean"
input: "boolean"
headword: "wo-question-inversion"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: nói 'You can help me?' với ngữ điệu lên giọng ở cuối câu là hoàn toàn không tự nhiên và không bao giờ được người bản ngữ sử dụng, kể cả trong văn nói thân mật."
answer: false
grammar_article_slug: "word-order"
explain: "SAI một phần — dạng không đảo trợ động từ (statement question) đôi khi được dùng trong văn nói rất thân mật để hỏi lại/xác nhận với ngữ điệu ngạc nhiên, nhưng trong IELTS Speaking nên dùng dạng chuẩn có đảo: 'Can you help me?'"
---

---
id: "wo_qinv_a2"
type: "mcq"
input: "choice"
headword: "wo-question-inversion"
skill: "error_id"
subtype: "advanced"
prompt: "Which of these IELTS Speaking Part 3 questions has correct word order?"
options: ["What you think about remote working?", "What do you think about remote working?", "What think you about remote working?", "You think what about remote working?"]
answer: 1
grammar_article_slug: "word-order"
explain: "Câu hỏi Wh- với động từ thường (think) bắt buộc có trợ động từ 'do': 'What do you think about remote working?' Thiếu 'do' hoặc không đảo trợ động từ là lỗi word_order_error."
---
