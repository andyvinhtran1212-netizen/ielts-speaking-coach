---
kind: quiz
code: "G-foundations-noun-phrase-basics"
title: "Quick Check — Noun Phrase Basics"
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

# ===== item_key 1 · Determiner bắt buộc trước singular countable noun =====

---
id: "np_det_b1"
type: "mcq"
input: "choice"
headword: "np-determiner"
skill: "form"
subtype: "basic"
prompt: "____ solution to traffic congestion must involve public transport investment."
options: ["Solution", "A solution", "Solutions", "Solution of"]
answer: 1
grammar_article_slug: "noun-phrase-basics"
explain: "'solution' là danh từ đếm được số ít → bắt buộc phải có determiner: 'A solution'."
---

---
id: "np_det_b2"
type: "mcq"
input: "choice"
headword: "np-determiner"
skill: "form"
subtype: "basic"
prompt: "The committee reviewed the survey last week. ____ report highlighted several flaws in the method."
options: ["Report", "The report", "Reports", "Of report"]
answer: 1
grammar_article_slug: "noun-phrase-basics"
explain: "'report' là danh từ đếm được số ít, đã được nhắc tới gián tiếp qua 'the survey' (báo cáo về cuộc khảo sát đó) → cụ thể, xác định → dùng 'The report'."
---

---
id: "np_det_i1"
type: "gap_mcq"
input: "choice"
headword: "np-determiner"
skill: "usage"
subtype: "intermediate"
prompt: "____ growing number of employees now prefer hybrid working arrangements."
options: ["A", "An", "∅ (no article)", "Some"]
answer: 0
grammar_article_slug: "noun-phrase-basics"
explain: "'number' là danh từ đếm được số ít bắt đầu bằng phụ âm khi đọc /n/ → dùng 'A growing number of'."
---

---
id: "np_det_i2"
type: "gap_text"
input: "text"
headword: "np-determiner"
skill: "production"
subtype: "intermediate"
prompt: "____ (determiner) factor that most influences consumer choice is price — write the single word that fits the blank (a definite, specific factor already implied)."
accept: ["The"]
case_sensitive: false
grammar_article_slug: "noun-phrase-basics"
explain: "'factor' là danh từ đếm được số ít mang tính xác định (yếu tố cụ thể đang bàn tới) → cần determiner 'The'."
---

---
id: "np_det_a1"
type: "boolean"
input: "boolean"
headword: "np-determiner"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Problem with the current healthcare system is access in rural areas.'"
answer: false
grammar_article_slug: "noun-phrase-basics"
explain: "SAI — 'problem' là danh từ đếm được số ít, thiếu determiner: 'The problem with the current healthcare system is access in rural areas.'"
---

# ===== item_key 2 · Thứ tự tính từ (OSASCOMP) =====

---
id: "np_adj_b1"
type: "mcq"
input: "choice"
headword: "np-adjective-order"
skill: "form"
subtype: "basic"
prompt: "We stayed in ____ by the lake for our holiday. Choose the correctly ordered noun phrase."
options: ["a wooden beautiful cabin", "a beautiful wooden cabin", "a cabin beautiful wooden", "a wooden a beautiful cabin"]
answer: 1
grammar_article_slug: "noun-phrase-basics"
explain: "Thứ tự OSASCOMP: opinion (beautiful) đứng trước material (wooden) → 'a beautiful wooden cabin'."
---

---
id: "np_adj_b2"
type: "mcq"
input: "choice"
headword: "np-adjective-order"
skill: "form"
subtype: "basic"
prompt: "During our trip to Kyoto, we visited ____. Choose the correctly ordered noun phrase."
options: ["an old Japanese temple", "a Japanese old temple", "an old temple Japanese", "a temple old Japanese"]
answer: 0
grammar_article_slug: "noun-phrase-basics"
explain: "Thứ tự OSASCOMP: age (old) đứng trước origin (Japanese) → 'an old Japanese temple'."
---

---
id: "np_adj_i1"
type: "gap_mcq"
input: "choice"
headword: "np-adjective-order"
skill: "usage"
subtype: "intermediate"
prompt: "The article discusses ____ issue affecting coastal communities."
options: ["a serious environmental", "an environmental serious", "a serious an environmental", "environmental a serious"]
answer: 0
grammar_article_slug: "noun-phrase-basics"
explain: "opinion (serious) đứng trước classifier (environmental) → 'a serious environmental issue'."
---

---
id: "np_adj_i2"
type: "gap_text"
input: "text"
headword: "np-adjective-order"
skill: "production"
subtype: "intermediate"
prompt: "Complete the noun phrase with adjectives in correct order: 'a ____ population' — write the two adjectives (size before type)."
accept: ["large urban"]
case_sensitive: false
grammar_article_slug: "noun-phrase-basics"
explain: "Theo OSASCOMP, size (large) đứng trước classifier (urban) → 'large urban population' (ví dụ này xuất hiện trực tiếp trong bài Wiki, mục 1.2)."
---

---
id: "np_adj_a1"
type: "boolean"
input: "boolean"
headword: "np-adjective-order"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The company built a modern French elegant office building.'"
answer: false
grammar_article_slug: "noun-phrase-basics"
explain: "SAI — thứ tự sai: opinion (elegant) phải đứng trước age (modern), rồi mới đến origin (French): 'The company built an elegant modern French office building.'"
---

# ===== item_key 3 · Post-modifier (giới từ, mệnh đề quan hệ, V-ing/V3) =====

---
id: "np_post_b1"
type: "mcq"
input: "choice"
headword: "np-post-modifiers"
skill: "form"
subtype: "basic"
prompt: "Choose the correct post-modifier: \"the factors ____ economic growth\"."
options: ["affecting", "affect", "affected by", "to affecting"]
answer: 0
grammar_article_slug: "noun-phrase-basics"
explain: "Participial phrase (V-ing) bổ nghĩa cho danh từ khi danh từ là chủ thể thực hiện hành động: 'the factors affecting economic growth'."
---

---
id: "np_post_i1"
type: "gap_mcq"
input: "choice"
headword: "np-post-modifiers"
skill: "usage"
subtype: "intermediate"
prompt: "The government announced a new policy ____ carbon emissions by 2030."
options: ["to reduce", "reducing", "reduce", "reduced"]
answer: 0
grammar_article_slug: "noun-phrase-basics"
explain: "To-infinitive phrase diễn tả mục đích của danh từ: 'a policy to reduce carbon emissions'."
---

---
id: "np_post_i2"
type: "gap_text"
input: "text"
headword: "np-post-modifiers"
skill: "production"
subtype: "intermediate"
prompt: "Complete the noun phrase with a relative clause: 'the researchers ____ the study last year.' — write the relative pronoun and verb."
accept: ["who published", "that published"]
case_sensitive: false
grammar_article_slug: "noun-phrase-basics"
explain: "Mệnh đề quan hệ bổ nghĩa danh từ với relative pronoun (who/that) + verb: 'the researchers who/that published the study last year'."
---

---
id: "np_post_a1"
type: "boolean"
input: "boolean"
headword: "np-post-modifiers"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The report identified several problems facing by small businesses during the recession.'"
answer: false
grammar_article_slug: "noun-phrase-basics"
explain: "SAI — 'businesses' là đối tượng bị ảnh hưởng (bị động) nên phải dùng V3: 'The report identified several problems faced by small businesses during the recession.'"
---

# ===== item_key 4 · Noun modifier (danh từ bổ nghĩa danh từ) không thêm -s =====

---
id: "np_nm_b1"
type: "mcq"
input: "choice"
headword: "np-noun-modifiers"
skill: "form"
subtype: "basic"
prompt: "The city built a new ____ centre to help unemployed graduates."
options: ["job", "jobs", "job's", "of job"]
answer: 0
grammar_article_slug: "noun-phrase-basics"
explain: "Noun modifier không thêm -s dù ý nghĩa số nhiều: 'a job centre', không phải 'jobs centre'."
---

---
id: "np_nm_i1"
type: "gap_mcq"
input: "choice"
headword: "np-noun-modifiers"
skill: "usage"
subtype: "intermediate"
prompt: "The university opened a new ____ programme to attract international applicants."
options: ["scholarship", "scholarships", "scholarship's", "of scholarship"]
answer: 0
grammar_article_slug: "noun-phrase-basics"
explain: "Noun modifier giữ nguyên dạng số ít: 'a scholarship programme'."
---

---
id: "np_nm_i2"
type: "gap_text"
input: "text"
headword: "np-noun-modifiers"
skill: "production"
subtype: "intermediate"
prompt: "Rewrite 'a system for managing data' as a compact noun-modifier phrase: 'a ____' — write the two-word noun modifier + noun."
accept: ["data management"]
case_sensitive: false
grammar_article_slug: "noun-phrase-basics"
explain: "Danh từ có thể ghép trực tiếp làm noun modifier: 'data management' (hoặc 'a data management system' đầy đủ hơn); không thêm -s vào phần modifier. Lưu ý: 'management system' KHÔNG đúng nghĩa — đó là hệ thống quản lý nói chung, mất đi đối tượng cụ thể là 'data'."
---

---
id: "np_nm_a1"
type: "boolean"
input: "boolean"
headword: "np-noun-modifiers"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The airport introduced a new passengers screening process to speed up security checks.'"
answer: false
grammar_article_slug: "noun-phrase-basics"
explain: "SAI — noun modifier không thêm -s: 'The airport introduced a new passenger screening process to speed up security checks.'"
---

---
id: "np_nm_a2"
type: "boolean"
input: "boolean"
headword: "np-noun-modifiers"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The company's tax policy sparked criticism from small business owners' is the same as 'The tax policy of the company sparked criticism...' in meaning, but the first uses a possessive ('s) form instead of an 'of' prepositional post-modifier."
answer: true
grammar_article_slug: "noun-phrase-basics"
explain: "ĐÚNG — 'the company's tax policy' dùng sở hữu cách ('s) đặt trước danh từ, trong khi 'the tax policy of the company' dùng post-modifier giới từ 'of' đặt sau danh từ; cả hai đều hợp lệ và mang nghĩa tương đương. (Lưu ý: đây KHÔNG phải là noun modifier — noun modifier là danh từ ghép trực tiếp không có 's, ví dụ 'government policy'.)"
---
