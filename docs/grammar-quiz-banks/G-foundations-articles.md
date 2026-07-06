---
kind: quiz
code: "G-foundations-articles"
title: "Quick Check — Articles (A, An, The)"
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

# ===== item_key 1 · A/An — giới thiệu lần đầu, phân loại, một trong số nhiều =====

---
id: "art_indef_b1"
type: "mcq"
input: "choice"
headword: "art-indefinite-first-mention"
skill: "form"
subtype: "basic"
prompt: "She works as ____ software engineer at a tech startup."
options: ["a", "an", "the", "ø (no article)"]
answer: 0
grammar_article_slug: "articles"
explain: "Nghề nghiệp sau 'be/work as' + danh từ đếm được số ít, không xác định cụ thể → dùng 'a'."
---

---
id: "art_indef_b2"
type: "boolean"
input: "boolean"
headword: "art-indefinite-first-mention"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'She is manager at a logistics company.'"
answer: false
grammar_article_slug: "articles"
explain: "SAI — danh từ đếm được số ít 'manager' bắt buộc phải có mạo từ: 'She is a manager at a logistics company.' (lỗi missing_article)"
---

---
id: "art_indef_i1"
type: "gap_mcq"
input: "choice"
headword: "art-indefinite-first-mention"
skill: "usage"
subtype: "intermediate"
prompt: "I saw ____ documentary about renewable energy last night. ____ documentary really changed how I think about solar power."
options: ["a / The", "the / A", "a / A", "the / The"]
answer: 0
grammar_article_slug: "articles"
explain: "Lần đầu nhắc đến (first mention), 'documentary' bắt đầu bằng phụ âm /d/ → 'a documentary'; lần thứ hai nhắc lại cùng vật đó → 'The documentary'."
---

---
id: "art_indef_i2"
type: "gap_text"
input: "text"
headword: "art-indefinite-first-mention"
skill: "production"
subtype: "intermediate"
prompt: "A dolphin is ____ (mạo từ + danh từ) mammal, not a fish."
accept: ["a"]
case_sensitive: false
grammar_article_slug: "articles"
explain: "Câu định nghĩa/phân loại (classification): 'A dolphin is a mammal' — 'mammal' bắt đầu bằng phụ âm /m/ → dùng 'a'."
---

---
id: "art_indef_a1"
type: "mcq"
input: "choice"
headword: "art-indefinite-first-mention"
skill: "contrast"
subtype: "advanced"
prompt: "Which sentence correctly uses the fixed expression pattern 'such a + adjective + noun'?"
options: ["It was such interesting a proposal!", "It was such a interesting proposal!", "It was such an interesting proposal!", "It was such the interesting proposal!"]
answer: 2
grammar_article_slug: "articles"
explain: "Cấu trúc cố định 'such a/an + adj + noun'; vì 'interesting' bắt đầu bằng nguyên âm /ɪ/ nên dùng 'an': 'such an interesting proposal'."
---

# ===== item_key 2 · The — lần thứ hai, cùng biết, duy nhất, so sánh nhất =====

---
id: "art_def_b1"
type: "mcq"
input: "choice"
headword: "art-definite-usage"
skill: "form"
subtype: "basic"
prompt: "Could you close ____ window? It's getting cold in here."
options: ["a", "an", "the", "ø (no article)"]
answer: 2
grammar_article_slug: "articles"
explain: "Cả người nói và người nghe đều biết cửa sổ nào (shared knowledge — chỉ có một cửa sổ trong phòng) → dùng 'the'."
---

---
id: "art_def_b2"
type: "boolean"
input: "boolean"
headword: "art-definite-usage"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Moon orbits Earth roughly every 27 days.'"
answer: false
grammar_article_slug: "articles"
explain: "SAI — 'moon' là vật thể duy nhất trong ngữ cảnh vũ trụ của chúng ta, bắt buộc có 'the': 'The Moon orbits Earth roughly every 27 days.' (lỗi missing_article)"
---

---
id: "art_def_i1"
type: "gap_mcq"
input: "choice"
headword: "art-definite-usage"
skill: "usage"
subtype: "intermediate"
prompt: "Of all the candidates interviewed this year, she was ____ most confident speaker."
options: ["a", "an", "the", "ø (no article)"]
answer: 2
grammar_article_slug: "articles"
explain: "Superlative (most confident) luôn đi kèm 'the': 'the most confident speaker'."
---

---
id: "art_def_i2"
type: "gap_text"
input: "text"
headword: "art-definite-usage"
skill: "production"
subtype: "intermediate"
prompt: "A new policy was announced yesterday. ____ (mạo từ) policy has already sparked heated debate among economists."
accept: ["The"]
case_sensitive: false
grammar_article_slug: "articles"
explain: "Lần thứ hai nhắc lại cùng một chính sách đã giới thiệu ở câu trước → 'The policy'."
---

---
id: "art_def_a1"
type: "boolean"
input: "boolean"
headword: "art-definite-usage"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Government has announced a plan to cut carbon emissions by 2040' là đúng ngữ pháp vì 'government' luôn là danh từ chung."
answer: false
grammar_article_slug: "articles"
explain: "SAI — khi nói tới chính phủ CỤ THỂ của một nước (shared knowledge trong ngữ cảnh), bắt buộc phải có 'the': 'The government has announced a plan...' (lỗi missing_article)"
---

# ===== item_key 3 · Zero article — số nhiều & không đếm được nói chung =====

---
id: "art_zero_b1"
type: "mcq"
input: "choice"
headword: "art-zero-general"
skill: "form"
subtype: "basic"
prompt: "____ Employees at this company receive excellent healthcare benefits."
options: ["A", "An", "The", "ø (no article)"]
answer: 3
grammar_article_slug: "articles"
explain: "'Employees' số nhiều nói chung về nhân viên nói chung (không phải một nhóm nhân viên cụ thể đã nhắc) → zero article."
---

---
id: "art_zero_b2"
type: "boolean"
input: "boolean"
headword: "art-zero-general"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'I enjoy the music while I'm working — any kind of music, really.'"
answer: false
grammar_article_slug: "articles"
explain: "SAI — 'music' ở đây mang nghĩa chung (bất kỳ loại nhạc nào), không xác định cụ thể → phải bỏ 'the': 'I enjoy music while I'm working.'"
---

---
id: "art_zero_i1"
type: "gap_mcq"
input: "choice"
headword: "art-zero-general"
skill: "usage"
subtype: "intermediate"
prompt: "____ artificial intelligence is transforming almost every industry, from healthcare to finance."
options: ["A", "An", "The", "ø (no article)"]
answer: 3
grammar_article_slug: "articles"
explain: "Nói về công nghệ AI nói chung như một khái niệm (danh từ không đếm được, general) → zero article, không dùng 'the'."
---

---
id: "art_zero_i2"
type: "gap_text"
input: "text"
headword: "art-zero-general"
skill: "production"
subtype: "intermediate"
prompt: "____ (viết mạo từ hoặc để trống, ghi 'ø' nếu không cần) Poverty remains one of the greatest obstacles to economic development worldwide."
accept: ["ø", "no article"]
case_sensitive: false
grammar_article_slug: "articles"
explain: "'Poverty' là danh từ trừu tượng không đếm được, nói chung → zero article, không dùng 'the poverty'."
---

---
id: "art_zero_a1"
type: "mcq"
input: "choice"
headword: "art-zero-general"
skill: "contrast"
subtype: "advanced"
prompt: "Which pair correctly contrasts general vs specific meaning? 1) '____ Small businesses often struggle to compete with large corporations.' 2) '____ small businesses in this district have closed since the new mall opened.'"
options: ["ø / The", "The / ø", "A / The", "ø / A"]
answer: 0
grammar_article_slug: "articles"
explain: "Câu 1 nói về doanh nghiệp nhỏ NÓI CHUNG → zero article. Câu 2 nói về nhóm doanh nghiệp nhỏ CỤ THỂ 'in this district' (cả người nói/nghe đều biết) → 'The'."
---

# ===== item_key 4 · A hay An — quy tắc âm thanh của từ tiếp theo =====

---
id: "art_aan_b1"
type: "mcq"
input: "choice"
headword: "art-a-vs-an-sound"
skill: "form"
subtype: "basic"
prompt: "They launched ____ new mobile app for tracking daily expenses."
options: ["a", "an", "the", "ø (no article)"]
answer: 0
grammar_article_slug: "articles"
explain: "'new' bắt đầu bằng âm phụ âm /nj/ → dùng 'a': 'a new mobile app'."
---

---
id: "art_aan_i1"
type: "gap_mcq"
input: "choice"
headword: "art-a-vs-an-sound"
skill: "usage"
subtype: "intermediate"
prompt: "It took her almost ____ hour to finish grading all the essays."
options: ["a", "an", "the", "no article needed"]
answer: 1
grammar_article_slug: "articles"
explain: "'hour' có 'h' câm, âm đầu thực tế là nguyên âm /aʊ/ → dùng 'an hour', theo quy tắc âm thanh chứ không phải chữ cái."
---

---
id: "art_aan_i2"
type: "gap_text"
input: "text"
headword: "art-a-vs-an-sound"
skill: "production"
subtype: "intermediate"
prompt: "She has ____ (mạo từ, 1 từ) unique approach to teaching that students really respond well to."
accept: ["a"]
case_sensitive: false
grammar_article_slug: "articles"
explain: "'unique' bắt đầu bằng âm /j/ (như 'you') là âm phụ âm dù chữ cái đầu là nguyên âm 'u' → dùng 'a unique approach'."
---

---
id: "art_aan_a1"
type: "boolean"
input: "boolean"
headword: "art-a-vs-an-sound"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She has a MBA from a well-known business school' dùng 'a' đúng vì chữ cái đầu 'M' là phụ âm."
answer: false
grammar_article_slug: "articles"
explain: "SAI — khi đọc tên viết tắt theo chữ cái, 'M' được đọc là /ɛm/, bắt đầu bằng âm nguyên âm → phải dùng 'an MBA', không phải 'a MBA'. (lỗi missing_article dạng chọn sai a/an)"
---
