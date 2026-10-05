---
kind: quiz
code: "G-sentence-structures-passive-voice"
title: "Quick Check — Passive Voice"
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
text_match_by_qid:
  pv_form_i2: exact
  pv_use_a1: exact
  pv_intr_i2: exact
  pv_err_i2: exact
---

# ===== item_key 1 · Cấu trúc be + V3 đúng thì =====

---
id: "pv_form_b1"
type: "mcq"
input: "choice"
headword: "pv-be-pp-form"
skill: "form"
subtype: "basic"
prompt: "The report ____ last year."
options: ["was published", "published", "is published", "publishes"]
answer: 0
grammar_article_slug: "passive-voice"
explain: "Bị động thì quá khứ đơn: was/were + V3. 'last year' là mốc quá khứ → 'was published'."
---

---
id: "pv_form_b2"
type: "mcq"
input: "choice"
headword: "pv-be-pp-form"
skill: "form"
subtype: "basic"
prompt: "The data ____ daily by the research team."
options: ["is collected", "collects", "collecting", "collected"]
answer: 0
grammar_article_slug: "passive-voice"
explain: "Chọn 'is collected' theo cách dùng data như danh từ không đếm được số ít trong câu này: Present Simple passive với is + collected. Data cũng có cách dùng số nhiều, khi đó có thể viết are collected; không kết luận data luôn là số ít."
---

---
id: "pv_form_i1"
type: "gap_mcq"
input: "choice"
headword: "pv-be-pp-form"
skill: "form"
subtype: "intermediate"
prompt: "The problem ____ by the technical team by the end of this week."
options: ["will have been solved", "will be solve", "will solved", "has solved"]
answer: 0
grammar_article_slug: "passive-voice"
explain: "Future perfect passive: will have been + V3, dùng khi hành động hoàn thành trước một mốc trong tương lai ('by the end of this week')."
---

---
id: "pv_form_i2"
type: "gap_text"
input: "text"
headword: "pv-be-pp-form"
skill: "production"
subtype: "intermediate"
prompt: "Chia đúng dạng bị động (present perfect passive): 'The issue ____ (solve) already.'"
accept: ["has been solved"]
case_sensitive: false
grammar_article_slug: "passive-voice"
explain: "Present perfect passive: has/have been + V3. 'already' + kết quả tới hiện tại → 'has been solved'."
---

---
id: "pv_form_a1"
type: "boolean"
input: "boolean"
headword: "pv-be-pp-form"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The policy has implemented since last year.'"
answer: false
grammar_article_slug: "passive-voice"
explain: "SAI — thiếu 'been' trong perfect passive. Sửa: 'The policy has been implemented since last year.'"
---

# ===== item_key 2 · Khi nào dùng bị động (agent unknown/irrelevant, học thuật) =====

---
id: "pv_use_b1"
type: "mcq"
input: "choice"
headword: "pv-when-to-use"
skill: "usage"
subtype: "basic"
prompt: "'My car ____ last night.' (không biết ai làm việc này)"
options: ["was stolen", "stole", "steals", "is stealing"]
answer: 0
grammar_article_slug: "passive-voice"
explain: "Khi không biết ai thực hiện hành động (thủ phạm không rõ), dùng bị động và có thể bỏ agent: 'was stolen'."
---

---
id: "pv_use_i1"
type: "gap_mcq"
input: "choice"
headword: "pv-when-to-use"
skill: "usage"
subtype: "intermediate"
prompt: "Which sentence best fits formal academic writing style (IELTS Task 1 process)?"
options: ["The raw materials are transported to the factory first.", "First, someone transports the raw materials to the factory.", "First, they transport the raw materials to the factory.", "The factory transport raw materials first."]
answer: 0
grammar_article_slug: "passive-voice"
explain: "Mô tả quy trình (process) trong văn phong học thuật ưu tiên bị động vì người thực hiện không quan trọng, nhấn vào bước và đối tượng: 'are transported'."
---

---
id: "pv_use_i2"
type: "gap_mcq"
input: "choice"
headword: "pv-when-to-use"
skill: "contrast"
subtype: "intermediate"
prompt: "Trong IELTS Speaking Part 1, câu nào TỰ NHIÊN hơn khi trả lời 'What do you usually do at weekends?'"
options: ["I usually cook dinner for my family.", "Dinner is usually cooked by me for my family.", "Dinner is usually cooked for my family.", "Dinner usually gets cooked by me."]
answer: 0
grammar_article_slug: "passive-voice"
explain: "Chọn 'I usually cook dinner for my family' vì câu hỏi tập trung vào việc người nói thường làm; dạng chủ động gọi trực tiếp người đó. Các câu bị động có thể hợp ngữ pháp nhưng kém trực tiếp với trọng tâm câu hỏi này. Không suy ra dùng một câu bị động tự động bị trừ điểm Fluency."
---

---
id: "pv_use_a1"
type: "gap_text"
input: "text"
headword: "pv-when-to-use"
skill: "production"
subtype: "advanced"
prompt: "Chuyển sang bị động, bỏ agent vì hiển nhiên không cần nói: 'Scientists have discovered a new species.' → A new species ____ (discover)."
accept: ["has been discovered"]
case_sensitive: false
grammar_article_slug: "passive-voice"
explain: "Agent ('scientists') hiển nhiên/không quan trọng bằng kết quả → bỏ 'by scientists', chỉ giữ: 'has been discovered'."
---

---
id: "pv_use_a2"
type: "boolean"
input: "boolean"
headword: "pv-when-to-use"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Tôi bị mất ví' nên dịch là 'My wallet was lost by me' để đúng ngữ pháp tiếng Anh tự nhiên."
answer: false
grammar_article_slug: "passive-voice"
explain: "SAI — khi bản thân người nói là agent thực của hành động 'mất', tiếng Anh tự nhiên dùng active: 'I lost my wallet', không cần bị động dù tiếng Việt có 'bị'."
---

# ===== item_key 3 · Không bị động hóa nội động từ (intransitive verbs) — lỗi mục tiêu =====

---
id: "pv_intr_b1"
type: "boolean"
input: "boolean"
headword: "pv-intransitive-error"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'The accident was happened yesterday.'"
answer: false
grammar_article_slug: "passive-voice"
explain: "SAI — 'happen' là nội động từ (intransitive), không có tân ngữ nên không thể bị động hóa. Sửa: 'The accident happened yesterday.'"
---

---
id: "pv_intr_b2"
type: "boolean"
input: "boolean"
headword: "pv-intransitive-error"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'The problem was occurred due to human error.'"
answer: false
grammar_article_slug: "passive-voice"
explain: "SAI — 'occur' là nội động từ, không có dạng bị động. Sửa: 'The problem occurred due to human error.'"
---

---
id: "pv_intr_i1"
type: "mcq"
input: "choice"
headword: "pv-intransitive-error"
skill: "usage"
subtype: "intermediate"
prompt: "Động từ nào KHÔNG thể chia ở dạng bị động vì là nội động từ?"
options: ["arrive", "write", "build", "publish"]
answer: 0
grammar_article_slug: "passive-voice"
explain: "'arrive' là nội động từ (không có tân ngữ trực tiếp) → không có dạng bị động. 'write/build/publish' đều là ngoại động từ, có thể bị động hóa."
---

---
id: "pv_intr_i2"
type: "gap_text"
input: "text"
headword: "pv-intransitive-error"
skill: "production"
subtype: "intermediate"
prompt: "Chia Past Simple ở thể chủ động (arrive là nội động từ, không dùng bị động): 'The flight ____ (arrive) two hours late.'"
accept: ["arrived"]
case_sensitive: false
grammar_article_slug: "passive-voice"
explain: "'arrive' là nội động từ, không có bị động. Chỉ dùng active past simple: 'arrived'."
---

---
id: "pv_intr_a1"
type: "mcq"
input: "choice"
headword: "pv-intransitive-error"
skill: "error_id"
subtype: "advanced"
prompt: "Câu nào mắc lỗi bị động hóa nội động từ?"
options: ["The meeting was held on Monday.", "The storm was occurred last night.", "The bridge was built in 1990.", "The letter was written in French."]
answer: 1
grammar_article_slug: "passive-voice"
explain: "'occur' là nội động từ nên không có dạng bị động — 'was occurred' sai. Sửa: 'The storm occurred last night.' Các câu còn lại dùng ngoại động từ (hold/build/write) đúng."
---

# ===== item_key 4 · Lỗi thường gặp khác: stative verb, born, quên be =====

---
id: "pv_err_b1"
type: "boolean"
input: "boolean"
headword: "pv-other-errors"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'I was borned in 1999.'"
answer: false
grammar_article_slug: "passive-voice"
explain: "SAI — 'born' là past participle đặc biệt, KHÔNG thêm '-ed'. Sửa: 'I was born in 1999.'"
---

---
id: "pv_err_b2"
type: "mcq"
input: "choice"
headword: "pv-other-errors"
skill: "form"
subtype: "basic"
prompt: "The bridge ____ in 1990."
options: ["was built", "build", "builds", "was build"]
answer: 0
grammar_article_slug: "passive-voice"
explain: "Bị động quá khứ đơn cần be (was) + V3 (built), không được thiếu 'be' hay để nguyên động từ gốc."
---

---
id: "pv_err_i1"
type: "gap_mcq"
input: "choice"
headword: "pv-other-errors"
skill: "contrast"
subtype: "intermediate"
prompt: "Chọn câu đúng: 'know' là động từ trạng thái (stative verb), câu nào chia đúng?"
options: ["The truth is known by everyone.", "The truth is being known by everyone.", "The truth was being known.", "The truth is know by everyone."]
answer: 0
grammar_article_slug: "passive-voice"
explain: "Với nghĩa 'sự thật được mọi người biết' ở câu này, cách diễn đạt thông thường là 'is known', không phải 'is being known'. Không suy rộng ví dụ này thành lệnh cấm mọi continuous của mọi động từ thường được xếp là stative."
---

---
id: "pv_err_i2"
type: "gap_text"
input: "text"
headword: "pv-other-errors"
skill: "production"
subtype: "intermediate"
prompt: "Chia Future Simple Passive (will be + V3); announce là động từ có quy tắc: 'The results ____ (announce) next week.'"
accept: ["will be announced"]
case_sensitive: false
grammar_article_slug: "passive-voice"
explain: "Bị động tương lai đơn: will be + V3. 'announce' là động từ có quy tắc → 'announced'. Kết quả: 'will be announced'."
---

---
id: "pv_err_a1"
type: "boolean"
input: "boolean"
headword: "pv-other-errors"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Trong một bản tóm tắt học thuật chỉ cần nêu báo cáo đã được viết, tác giả không rõ và không liên quan đến ý cần truyền đạt, 'The report was written by someone' là cách diễn đạt súc tích phù hợp nhất với mục tiêu này."
answer: false
grammar_article_slug: "passive-voice"
explain: "SAI về độ phù hợp với mục tiêu súc tích đã nêu: by someone không thêm thông tin cần thiết, nên 'The report was written' trực tiếp hơn. Câu có by someone vẫn hợp ngữ pháp và có thể hữu ích khi việc do một người thực hiện là thông tin liên quan; không phán nó sai trong mọi văn phong học thuật."
---
