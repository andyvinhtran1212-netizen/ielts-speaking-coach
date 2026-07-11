---
kind: quiz
code: "G-error-clinic-missing-main-verbs"
title: "Quick Check — Missing Main Verbs"
skill_area: "grammar"
topic: "Error Clinic"
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

# ===== item_key 1 · Thiếu động từ "be" (be + adj/noun/prep) =====

---
id: "mm_be_b1"
type: "mcq"
input: "choice"
headword: "mm-be-adj-noun"
skill: "form"
subtype: "basic"
prompt: "She ____ very tired after the exam."
options: ["is", "very", "tired", "she"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Câu mô tả trạng thái (tired) cần động từ 'be' làm main verb. 'She' + tính từ không thể đứng một mình → phải có 'is'."
why_wrong:
  '1': '"Very" là một trạng từ dùng để bổ nghĩa, không phải động từ chính mà câu cần để liên kết chủ ngữ và tính từ.'
  '2': '"Tired" ở đây là một tính từ mô tả trạng thái, không phải động từ chính để kết nối chủ ngữ "She" với trạng thái "very tired".'
  '3': '"She" là một đại từ nhân xưng, đóng vai trò chủ ngữ; việc đặt thêm một chủ ngữ nữa vào vị trí này là thừa và câu vẫn thiếu động từ chính.'
---

---
id: "mm_be_b2"
type: "gap_mcq"
input: "choice"
headword: "mm-be-adj-noun"
skill: "usage"
subtype: "basic"
prompt: "The book ____ on the table."
options: ["is", "very", "table", "(để trống, không cần verb)"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Câu chỉ vị trí (on the table) vẫn cần main verb 'be': 'The book is on the table.'"
why_wrong:
  '1': '"Very" là một trạng từ, không thể đóng vai trò là động từ chính của câu.'
  '2': '"Table" là một danh từ, không thể là động từ chính của câu để hoàn thiện cấu trúc ngữ pháp.'
  '3': Một câu hoàn chỉnh luôn cần có động từ chính để diễn tả hành động hoặc trạng thái, và câu này thiếu động từ.
---

---
id: "mm_be_b3"
type: "boolean"
input: "boolean"
headword: "mm-be-adj-noun"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'This a major problem in society.'"
answer: false
grammar_article_slug: "missing-main-verbs"
explain: "SAI — thiếu main verb 'be' giữa 'This' và danh từ 'a major problem': 'This is a major problem in society.'"
---

---
id: "mm_be_i1"
type: "gap_text"
input: "text"
headword: "mm-be-adj-noun"
skill: "production"
subtype: "intermediate"
prompt: "The students ____ (be) in the classroom right now."
accept: ["are"]
case_sensitive: false
grammar_article_slug: "missing-main-verbs"
explain: "Chủ ngữ số nhiều 'The students' + vị trí (in the classroom) → main verb 'be' chia là 'are'."
---

---
id: "mm_be_i2"
type: "mcq"
input: "choice"
headword: "mm-be-adj-noun"
skill: "error_id"
subtype: "intermediate"
prompt: "Câu nào THIẾU main verb?"
options: ["His answer completely wrong.", "His answer was completely wrong.", "His answer seemed completely wrong.", "His answer is completely wrong."]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "'His answer completely wrong' thiếu 'be' (was/is) làm main verb giữa chủ ngữ và tính từ 'wrong'."
why_wrong:
  '1': Đây là một câu hoàn chỉnh ngữ pháp vì động từ "was" đóng vai trò là động từ chính của câu.
  '2': Đây là một câu hoàn chỉnh ngữ pháp vì động từ "seemed" đóng vai trò là động từ chính của câu.
  '3': Đây là một câu hoàn chỉnh ngữ pháp vì động từ "is" đóng vai trò là động từ chính của câu.
---

---
id: "mm_be_a1"
type: "gap_mcq"
input: "choice"
headword: "mm-be-adj-noun"
skill: "contrast"
subtype: "advanced"
prompt: "Yesterday I ____ at home all day preparing for the interview."
options: ["was", "am", "be", "(không cần verb)"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Mốc thời gian quá khứ 'Yesterday' → 'be' chia ở quá khứ: 'was', không phải 'am' hay bỏ trống."
why_wrong:
  '1': '"Am" là thì hiện tại, không phù hợp với mốc thời gian "Yesterday" (hôm qua) trong câu.'
  '2': '"Be" là dạng nguyên thể của động từ, không được chia theo chủ ngữ "I" và thì quá khứ của câu.'
  '3': Câu thiếu động từ chính để liên kết chủ ngữ "I" với vị ngữ "at home", khiến câu không hoàn chỉnh về ngữ pháp.
---

# ===== item_key 2 · V-ing thiếu "be" (continuous cần "be") =====

---
id: "mm_ving_b1"
type: "mcq"
input: "choice"
headword: "mm-ving-without-be"
skill: "form"
subtype: "basic"
prompt: "The children ____ playing in the park."
options: ["are", "very", "park", "playing"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "V-ing trong continuous tense luôn cần 'be' đứng trước làm main verb: 'The children are playing.'"
why_wrong:
  '1': Đây là trạng từ, không thể đóng vai trò là động từ 'to be' cần thiết để tạo thành thì tiếp diễn.
  '2': Đây là danh từ, không thể đứng trước V-ing để tạo thành thì tiếp diễn.
  '3': Đặt 'playing' vào chỗ trống sẽ tạo thành cấu trúc lặp thừa và vẫn thiếu động từ 'to be' cần thiết cho thì tiếp diễn.
---

---
id: "mm_ving_b2"
type: "boolean"
input: "boolean"
headword: "mm-ving-without-be"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'She working very hard these days.'"
answer: false
grammar_article_slug: "missing-main-verbs"
explain: "SAI — 'working' không thể tự làm main verb, cần 'be': 'She is working very hard these days.'"
---

---
id: "mm_ving_i1"
type: "gap_mcq"
input: "choice"
headword: "mm-ving-without-be"
skill: "usage"
subtype: "intermediate"
prompt: "Many people ____ moving to cities in search of better opportunities."
options: ["are", "have", "do", "will"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Xu hướng đang diễn ra (present continuous) → cần 'are' trước V-ing 'moving'."
why_wrong:
  '1': Động từ 'have' không kết hợp trực tiếp với dạng V-ing 'moving' để tạo thành thì hiện tại tiếp diễn hoặc bất kỳ cấu trúc ngữ pháp phổ biến nào.
  '2': Trợ động từ 'do' không được dùng với dạng V-ing 'moving'; nó thường đi với động từ nguyên mẫu hoặc được dùng làm động từ chính.
  '3': Trợ động từ 'will' phải được theo sau bởi động từ nguyên mẫu (V-base), không phải dạng V-ing 'moving', trừ khi trong cấu trúc thì tương lai tiếp diễn ('will be moving').
---

---
id: "mm_ving_i2"
type: "gap_text"
input: "text"
headword: "mm-ving-without-be"
skill: "production"
subtype: "intermediate"
prompt: "They ____ (be / study) for the exam all night when the fire alarm went off."
accept: ["were studying"]
case_sensitive: false
grammar_article_slug: "missing-main-verbs"
explain: "Hành động đang diễn ra ở một thời điểm trong quá khứ (past continuous) → 'were studying', không thể chỉ dùng 'studying'."
---

---
id: "mm_ving_a1"
type: "mcq"
input: "choice"
headword: "mm-ving-without-be"
skill: "contrast"
subtype: "advanced"
prompt: "So sánh: 'Swimming is good for health' và 'She swimming every morning.' Câu nào ĐÚNG ngữ pháp?"
options: ["Chỉ câu 1 đúng (Swimming là gerund làm chủ ngữ)", "Chỉ câu 2 đúng", "Cả hai đều đúng", "Cả hai đều sai"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Câu 1: 'Swimming' là gerund làm chủ ngữ, có main verb 'is' → đúng. Câu 2 thiếu 'be' trước V-ing 'swimming' làm main verb → sai, phải là 'She is swimming every morning' hoặc 'She swims every morning.'"
why_wrong:
  '1': Câu 2 sai ngữ pháp do thiếu động từ "to be" trước "swimming".
  '2': Câu 2 sai ngữ pháp do thiếu động từ "to be" trước "swimming".
  '3': Câu 1 đúng ngữ pháp vì "Swimming" là danh động từ (gerund) làm chủ ngữ.
---

# ===== item_key 3 · V-ed (past participle) thiếu "be" (passive) =====

---
id: "mm_ved_b1"
type: "mcq"
input: "choice"
headword: "mm-ved-without-be"
skill: "form"
subtype: "basic"
prompt: "The meeting ____ cancelled due to bad weather."
options: ["was", "very", "meeting", "cancelled"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Câu bị động (passive) cần 'be + past participle' làm main verb: 'was cancelled', không thể chỉ có 'cancelled'."
---

---
id: "mm_ved_b2"
type: "boolean"
input: "boolean"
headword: "mm-ved-without-be"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'The report written by the manager.'"
answer: false
grammar_article_slug: "missing-main-verbs"
explain: "SAI — thiếu 'was/is' trước past participle 'written': 'The report was written by the manager.'"
---

---
id: "mm_ved_i1"
type: "gap_mcq"
input: "choice"
headword: "mm-ved-without-be"
skill: "usage"
subtype: "intermediate"
prompt: "Many problems ____ caused by pollution."
options: ["are", "have", "do", "very"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Chủ ngữ số nhiều 'Many problems' + passive (caused) → cần 'be' chia là 'are' trước past participle."
why_wrong:
  '1': Cần động từ 'to be' cho thể bị động, 'have' là trợ động từ của thì hoàn thành hoặc dùng trong câu chủ động.
  '2': '''Do'' là trợ động từ của thì hiện tại đơn (chủ động) hoặc dùng để nhấn mạnh/tạo câu hỏi, không dùng trong cấu trúc bị động.'
  '3': '''Very'' là một trạng từ chỉ mức độ, không phải là động từ và không thể đứng trước một phân từ quá khứ để tạo thành cấu trúc bị động.'
---

---
id: "mm_ved_i2"
type: "gap_text"
input: "text"
headword: "mm-ved-without-be"
skill: "production"
subtype: "intermediate"
prompt: "The building ____ (be / construct) in 1990."
accept: ["was constructed"]
case_sensitive: false
grammar_article_slug: "missing-main-verbs"
explain: "Mốc thời gian quá khứ '1990' + passive → 'was constructed' (be ở quá khứ + past participle của construct)."
---

---
id: "mm_ved_a1"
type: "boolean"
input: "boolean"
headword: "mm-ved-without-be"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The new policy introduced by the government last year very controversial among voters.'"
answer: false
grammar_article_slug: "missing-main-verbs"
explain: "SAI — 'introduced by the government last year' là reduced relative clause bổ nghĩa cho 'policy' (không phải main verb), nên mệnh đề chính vẫn thiếu 'be' trước tính từ 'controversial': 'The new policy introduced by the government last year was very controversial among voters.'"
---

# ===== item_key 4 · Chỉ có noun phrase — không có predicate =====

---
id: "mm_np_b1"
type: "mcq"
input: "choice"
headword: "mm-noun-phrase-only"
skill: "error_id"
subtype: "basic"
prompt: "Câu nào là câu HOÀN CHỈNH (có main verb)?"
options: ["Pollution is a very important issue in modern society.", "A very important issue in modern society.", "An important issue in modern society, especially in big cities.", "The important issue of modern society."]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Chỉ câu đầu có main verb 'is'. Ba câu còn lại chỉ là noun phrase — dài nhưng không có predicate."
why_wrong:
  '1': Đây là một cụm danh từ, không chứa động từ chính để tạo thành một câu hoàn chỉnh.
  '2': Cụm từ này không có động từ chính, chỉ là một cụm danh từ được mở rộng thêm thông tin.
  '3': Đây chỉ là một cụm danh từ, thiếu động từ chính để biểu thị một hành động hay trạng thái.
---

---
id: "mm_np_b2"
type: "boolean"
input: "boolean"
headword: "mm-noun-phrase-only"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'A very important issue in modern society.' là một câu hoàn chỉnh."
answer: false
grammar_article_slug: "missing-main-verbs"
explain: "SAI — đây chỉ là noun phrase, không có main verb. Cần thêm: 'This is a very important issue in modern society.'"
---

---
id: "mm_np_i1"
type: "gap_text"
input: "text"
headword: "mm-noun-phrase-only"
skill: "production"
subtype: "intermediate"
prompt: "Sửa lại thành câu hoàn chỉnh bằng cách điền một main verb phù hợp: 'The main reason for the increase in pollution ____ the overuse of fossil fuels.'"
accept: ["is"]
case_sensitive: false
grammar_article_slug: "missing-main-verbs"
explain: "Cụm 'The main reason for the increase in pollution' chỉ là noun phrase (chủ ngữ dài), cần thêm main verb 'is' để hoàn chỉnh câu."
---

---
id: "mm_np_i2"
type: "gap_mcq"
input: "choice"
headword: "mm-noun-phrase-only"
skill: "usage"
subtype: "intermediate"
prompt: "____ is one of the biggest challenges facing young people today."
options: ["Unemployment", "Facing", "Challenges of", "The biggest of"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Cần một danh từ làm chủ ngữ thật ('Unemployment') để đi với main verb 'is'; các lựa chọn khác không tạo thành câu có predicate rõ ràng."
---

---
id: "mm_np_a1"
type: "gap_mcq"
input: "choice"
headword: "mm-noun-phrase-only"
skill: "contrast"
subtype: "advanced"
prompt: "'The rapid development of technology in the 21st century ____ the way we communicate.' — chọn main verb phù hợp để câu KHÔNG còn là noun phrase trần trụi."
options: ["has changed", "changing", "to change", "changed by"]
answer: 0
grammar_article_slug: "missing-main-verbs"
explain: "Chủ ngữ dài 'The rapid development... century' vẫn chỉ là noun phrase nếu không có main verb chia đúng thì (has changed = present perfect, hợp lý cho xu hướng kéo dài đến nay). 'changing' hay 'to change' không phải finite verb nên không cứu được câu."
why_wrong:
  '1': '''changing'' là một hiện tại phân từ (present participle), không thể tự mình đóng vai trò là động từ chính của câu.'
  '2': '''to change'' là một động từ nguyên mẫu (infinitive), không thể đứng một mình làm động từ chính để tạo thành một câu hoàn chỉnh.'
  '3': '''changed by'' là một cụm phân từ bị động (passive participle phrase) không có trợ động từ, do đó không thể hoạt động như một động từ chính được chia thì cho chủ ngữ.'
---
