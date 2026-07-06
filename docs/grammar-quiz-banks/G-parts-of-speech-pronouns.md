---
kind: quiz
code: "G-parts-of-speech-pronouns"
title: "Quick Check — Pronouns"
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

# ===== item_key 1 · Subject vs Object pronouns =====

---
id: "pron_subobj_b1"
type: "mcq"
input: "choice"
headword: "pron-subject-object"
skill: "form"
subtype: "basic"
prompt: "Can you please help ____ with this heavy suitcase?"
options: ["me", "I", "my", "mine"]
answer: 0
grammar_article_slug: "pronouns"
explain: "Sau động từ (help) là vị trí tân ngữ → dùng object pronoun 'me', không dùng 'I'."
---

---
id: "pron_subobj_b2"
type: "mcq"
input: "choice"
headword: "pron-subject-object"
skill: "form"
subtype: "basic"
prompt: "____ is my colleague; we work in the same department."
options: ["She", "Her", "Hers", "She's"]
answer: 0
grammar_article_slug: "pronouns"
explain: "Đứng trước động từ 'is' (làm chủ ngữ) → dùng subject pronoun 'She'."
---

---
id: "pron_subobj_i1"
type: "gap_mcq"
input: "choice"
headword: "pron-subject-object"
skill: "usage"
subtype: "intermediate"
prompt: "The manager sent the report to my colleague and ____ before the deadline."
options: ["me", "I", "my", "myself"]
answer: 0
grammar_article_slug: "pronouns"
explain: "Sau giới từ 'to' là vị trí tân ngữ → object pronoun 'me', dù có nhiều người ('my colleague and me')."
---

---
id: "pron_subobj_i2"
type: "gap_text"
input: "text"
headword: "pron-subject-object"
skill: "production"
subtype: "intermediate"
prompt: "The professor and ____ (viết đại từ chủ ngữ đúng cho 'I') reviewed the thesis together before submission."
accept: ["I"]
case_sensitive: false
grammar_article_slug: "pronouns"
explain: "Đứng trước động từ 'reviewed' làm chủ ngữ → dùng subject pronoun 'I', không dùng 'me'."
---

---
id: "pron_subobj_a1"
type: "boolean"
input: "boolean"
headword: "pron-subject-object"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Between you and I, I don't think the proposal will be approved.'"
answer: false
grammar_article_slug: "pronouns"
explain: "SAI — sau giới từ 'between' là vị trí tân ngữ, phải dùng object pronoun 'me'. Sửa: 'Between you and me, I don't think the proposal will be approved.'"
---

# ===== item_key 2 · Possessive: its vs it's, their vs there vs they're =====

---
id: "pron_poss_b1"
type: "mcq"
input: "choice"
headword: "pron-possessive-contraction"
skill: "form"
subtype: "basic"
prompt: "The company announced a new plan to expand ____ operations overseas."
options: ["its", "it's", "their", "it is"]
answer: 0
grammar_article_slug: "pronouns"
explain: "'its' = sở hữu của 'it' (không có dấu nháy). 'it's' = it is/it has, hoàn toàn khác nghĩa."
---

---
id: "pron_poss_b2"
type: "mcq"
input: "choice"
headword: "pron-possessive-contraction"
skill: "form"
subtype: "basic"
prompt: "____ likely to rain later this afternoon, so bring an umbrella."
options: ["It's", "Its", "Their", "There"]
answer: 0
grammar_article_slug: "pronouns"
explain: "'It's' ở đây = 'It is' (viết tắt), không phải sở hữu."
---

---
id: "pron_poss_i1"
type: "gap_mcq"
input: "choice"
headword: "pron-possessive-contraction"
skill: "usage"
subtype: "intermediate"
prompt: "Employees must submit ____ timesheets by Friday afternoon each week."
options: ["their", "there", "they're", "them"]
answer: 0
grammar_article_slug: "pronouns"
explain: "'their' = tính từ sở hữu của 'they', đứng trước danh từ (timesheets). 'there' chỉ nơi chốn, 'they're' = they are."
---

---
id: "pron_poss_i2"
type: "gap_text"
input: "text"
headword: "pron-possessive-contraction"
skill: "production"
subtype: "intermediate"
prompt: "The committee announced that ____ (viết đúng: it is, dạng viết tắt) planning to review the policy next month."
accept: ["it's"]
case_sensitive: false
grammar_article_slug: "pronouns"
explain: "'it is' viết tắt thành 'it's' (có dấu nháy đơn), khác với 'its' (sở hữu, không dấu nháy)."
---

---
id: "pron_poss_a1"
type: "boolean"
input: "boolean"
headword: "pron-possessive-contraction"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The team put they're bags over there before the match started.'"
answer: false
grammar_article_slug: "pronouns"
explain: "SAI — 'they're' (= they are) không thể đứng trước danh từ 'bags'. Cần tính từ sở hữu 'their'. Sửa: 'The team put their bags over there...'."
---

---
id: "pron_poss_a2"
type: "boolean"
input: "boolean"
headword: "pron-possessive-contraction"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The dog wagged its tail happily when its owner came home.'"
answer: true
grammar_article_slug: "pronouns"
explain: "ĐÚNG — cả hai chữ 'its' đều là sở hữu (đuôi của nó, chủ của nó), viết đúng không có dấu nháy."
---

# ===== item_key 3 · Indefinite pronoun agreement (everyone/someone + số ít) =====

---
id: "pron_indef_b1"
type: "mcq"
input: "choice"
headword: "pron-indefinite-agreement"
skill: "form"
subtype: "basic"
prompt: "Everyone in the office ____ excited about the new project."
options: ["is", "are", "were", "have been"]
answer: 0
grammar_article_slug: "pronouns"
explain: "'Everyone' luôn được coi là số ít về mặt ngữ pháp → chia động từ số ít 'is'."
---

---
id: "pron_indef_b2"
type: "mcq"
input: "choice"
headword: "pron-indefinite-agreement"
skill: "form"
subtype: "basic"
prompt: "Nobody ____ willing to volunteer for the extra shift last weekend."
options: ["was", "were", "are", "have been"]
answer: 0
grammar_article_slug: "pronouns"
explain: "'Nobody' là đại từ bất định số ít → chia động từ số ít 'was'."
---

---
id: "pron_indef_i1"
type: "gap_mcq"
input: "choice"
headword: "pron-indefinite-agreement"
skill: "usage"
subtype: "intermediate"
prompt: "If a candidate wants to pass the interview, ____ should prepare specific examples in advance."
options: ["they", "he", "it", "them"]
answer: 0
grammar_article_slug: "pronouns"
explain: "'they' (số ít, trung tính giới) ngày càng phổ biến để chỉ một người khi không rõ/không cần nêu giới tính, và được chấp nhận trong IELTS hiện đại."
---

---
id: "pron_indef_i2"
type: "gap_text"
input: "text"
headword: "pron-indefinite-agreement"
skill: "production"
subtype: "intermediate"
prompt: "Everybody on the team ____ (be, thì hiện tại) responsible for meeting the project deadline."
accept: ["is"]
case_sensitive: false
grammar_article_slug: "pronouns"
explain: "'Everybody' là đại từ bất định số ít → is, không phải are."
---

---
id: "pron_indef_a1"
type: "boolean"
input: "boolean"
headword: "pron-indefinite-agreement"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Everyone are responsible for their own actions in this workplace.'"
answer: false
grammar_article_slug: "pronouns"
explain: "SAI — 'everyone' luôn chia động từ số ít. Sửa: 'Everyone is responsible for their own actions...'."
---

# ===== item_key 4 · Cohesion & antecedent rõ ràng (tránh tham chiếu mơ hồ) =====

---
id: "pron_cohesion_b1"
type: "mcq"
input: "choice"
headword: "pron-cohesion-antecedent"
skill: "usage"
subtype: "basic"
prompt: "Education is vital for national development. ____ equips people with the skills they need to succeed."
options: ["It", "They", "This", "Its"]
answer: 0
grammar_article_slug: "pronouns"
explain: "'Education' là danh từ số ít vừa nhắc → thay bằng 'It' để tránh lặp từ."
---

---
id: "pron_cohesion_i1"
type: "gap_mcq"
input: "choice"
headword: "pron-cohesion-antecedent"
skill: "usage"
subtype: "intermediate"
prompt: "Social media use among teenagers has risen sharply. ____ growing trend concerns many parents and educators."
options: ["This", "It", "They", "Their"]
answer: 0
grammar_article_slug: "pronouns"
explain: "'This' + noun phrase (summary reference) tóm tắt lại cả ý câu trước một cách rõ ràng, tránh dùng 'this' đơn độc mơ hồ."
---

---
id: "pron_cohesion_i2"
type: "gap_text"
input: "text"
headword: "pron-cohesion-antecedent"
skill: "production"
subtype: "intermediate"
prompt: "Renewable energy has become more affordable in recent years. ____ (viết đại từ đúng, số ít, thay cho 'renewable energy') has attracted growing investment worldwide."
accept: ["It"]
case_sensitive: false
grammar_article_slug: "pronouns"
explain: "'Renewable energy' số ít không đếm được → thay bằng 'It' ở câu sau để tạo mạch văn liền mạch (cohesion)."
---

---
id: "pron_cohesion_a1"
type: "boolean"
input: "boolean"
headword: "pron-cohesion-antecedent"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The government and the public disagree on the new tax law. They think it is unfair.'"
answer: false
grammar_article_slug: "pronouns"
explain: "SAI về mặt cohesion — 'They' không rõ chỉ 'the government' hay 'the public' (antecedent mơ hồ). Sửa: 'The government and the public disagree on the new tax law. The public think it is unfair.'"
---

---
id: "pron_cohesion_a2"
type: "boolean"
input: "boolean"
headword: "pron-cohesion-antecedent"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Air pollution has worsened in major cities. This growing problem now poses serious health risks.'"
answer: true
grammar_article_slug: "pronouns"
explain: "ĐÚNG — 'This growing problem' là summary reference rõ ràng, tóm tắt lại ý câu trước thay vì dùng 'this' mơ hồ một mình."
---
