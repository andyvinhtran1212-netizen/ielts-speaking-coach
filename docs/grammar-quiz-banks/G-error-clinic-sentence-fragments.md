---
kind: quiz
code: "G-error-clinic-sentence-fragments"
title: "Quick Check — Sentence Fragments"
skill_area: "grammar"
topic: "Error Clinic"
mode: "adaptive_mastery"
grading: "instant"
correct_to_master: 2
require_distinct_skill: true
require_production_to_master: true
cooldown: 2
shuffle_options: true
words_count: 3
source: "authored-2026-07"
---

# ===== item_key 1 · Mệnh đề phụ đứng một mình (because/although/when/if...) =====

---
id: "sf_sub_b1"
type: "mcq"
input: "choice"
headword: "sf-subordinate-alone"
skill: "form"
subtype: "basic"
prompt: "Which one is a complete sentence (not a fragment)?"
options: ["Although the exam was difficult.", "Although the exam was difficult, most students passed.", "When the results came out.", "Because the teacher was strict."]
answer: 1
grammar_article_slug: "sentence-fragments"
explain: "Mệnh đề phụ bắt đầu bằng although/when/because... không thể đứng một mình, luôn cần mệnh đề chính đi kèm. Chỉ câu B có đủ mệnh đề chính ('most students passed')."
why_wrong:
  '0': Mệnh đề này bắt đầu bằng "Although" nhưng thiếu mệnh đề chính đi kèm, khiến nó trở thành một câu cụt.
  '2': Mệnh đề này bắt đầu bằng "When" nhưng thiếu mệnh đề chính đi kèm, khiến nó trở thành một câu cụt.
  '3': Mệnh đề này bắt đầu bằng "Because" nhưng thiếu mệnh đề chính đi kèm, khiến nó trở thành một câu cụt.
---

---
id: "sf_sub_b2"
type: "boolean"
input: "boolean"
headword: "sf-subordinate-alone"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Since the library closed early.' là một câu hoàn chỉnh."
answer: false
grammar_article_slug: "sentence-fragments"
explain: "SAI — đây là fragment vì 'since' mở đầu mệnh đề phụ nhưng không có mệnh đề chính. Sửa: 'Since the library closed early, students studied at a café instead.'"
---

---
id: "sf_sub_i1"
type: "gap_mcq"
input: "choice"
headword: "sf-subordinate-alone"
skill: "usage"
subtype: "intermediate"
prompt: "Fix the fragment: 'Unless the government invests in public transport.' → 'Unless the government invests in public transport, ____.'"
options: ["traffic congestion will keep getting worse", "improving traffic congestion", "traffic congestion getting worse", "to improve traffic congestion"]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "Mệnh đề phụ với 'unless' cần một mệnh đề chính có chủ ngữ + động từ chia ('traffic congestion will keep getting worse') để câu trọn nghĩa."
why_wrong:
  '1': Cụm từ này là một cụm phân từ hiện tại (present participle phrase), không có chủ ngữ và động từ chính được chia thì để tạo thành một mệnh đề độc lập.
  '2': Mặc dù có chủ ngữ ("traffic congestion"), động từ "getting" là phân từ hiện tại chứ không phải động từ chính được chia thì, nên không tạo thành một mệnh đề độc lập.
  '3': Đây là một cụm động từ nguyên mẫu (infinitive phrase), chỉ mục đích nhưng không có chủ ngữ và động từ chính được chia thì để tạo thành một mệnh đề độc lập.
---

---
id: "sf_sub_i2"
type: "gap_mcq"
input: "choice"
headword: "sf-subordinate-alone"
skill: "contrast"
subtype: "intermediate"
prompt: "Which sentence correctly joins the fragment 'While many workers embrace remote jobs.' into a complete idea?"
options: ["While many workers embrace remote jobs, others still prefer a traditional office.", "While many workers embracing remote jobs.", "Many workers, while embrace remote jobs.", "While many workers embrace remote jobs and prefer offices."]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "'While' mở đầu mệnh đề phụ đối lập, phải gắn với một mệnh đề chính hoàn chỉnh phía sau dấu phẩy: 'others still prefer a traditional office.'"
---

---
id: "sf_sub_i3"
type: "gap_text"
input: "text"
headword: "sf-subordinate-alone"
skill: "production"
subtype: "intermediate"
prompt: "Rewrite so it is a complete sentence (add a main clause after the comma). Fragment: 'Although online courses are convenient.' → 'Although online courses are convenient, ____ (write a short main clause, e.g. about motivation).'"
accept: ["many students lack the motivation to finish them", "many learners lack the motivation to complete them", "students often lack the discipline to finish them"]
case_sensitive: false
grammar_article_slug: "sentence-fragments"
explain: "Mệnh đề phụ 'Although online courses are convenient' cần một mệnh đề chính có chủ ngữ + động từ để hoàn chỉnh, ví dụ: 'many students lack the motivation to finish them.'"
---

---
id: "sf_sub_a1"
type: "boolean"
input: "boolean"
headword: "sf-subordinate-alone"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Trong đoạn văn Writing Task 2, câu 'As more people move to urban areas in search of better job opportunities.' đứng một mình là một câu hoàn chỉnh và không cần sửa."
answer: false
grammar_article_slug: "sentence-fragments"
explain: "SAI — 'As' mở đầu mệnh đề phụ chỉ lý do/thời gian, không có mệnh đề chính nên đây là fragment. Sửa: 'As more people move to urban areas in search of better job opportunities, housing prices continue to rise.'"
---

---
id: "sf_sub_a2"
type: "mcq"
input: "choice"
headword: "sf-subordinate-alone"
skill: "contrast"
subtype: "advanced"
prompt: "In IELTS Writing Task 2, which revision best fixes this fragment pair: 'Cities are becoming overcrowded. Because rural residents keep migrating for work.'?"
options: ["Cities are becoming overcrowded because rural residents keep migrating for work.", "Cities are becoming overcrowded. Because of rural residents keep migrating for work.", "Cities are becoming overcrowded, because rural residents migrating for work.", "Cities are becoming overcrowded. Rural residents keep migrating for work, because."]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "Cách sửa chuẩn nhất là gắn mệnh đề 'because...' trực tiếp vào câu trước (không chấm câu giữa chừng), tạo thành một câu phức hoàn chỉnh."
why_wrong:
  '1': '"Because of" là giới từ, cần theo sau bởi danh từ hoặc cụm danh từ, không phải một mệnh đề đầy đủ như "rural residents keep migrating for work".'
  '2': Sau liên từ "because" phải là một mệnh đề hoàn chỉnh (có chủ ngữ và động từ chia thì), nhưng "rural residents migrating for work" thiếu động từ chia thì.
  '3': Liên từ "because" không thể đứng trơ trọi ở cuối câu mà không có mệnh đề phụ đi kèm để giải thích lý do.
---

# ===== item_key 2 · Cụm V-ing / V-ed đứng một mình =====

---
id: "sf_ving_b1"
type: "mcq"
input: "choice"
headword: "sf-ving-ved-alone"
skill: "form"
subtype: "basic"
prompt: "Which option turns the fragment 'Spending hours on social media every day.' into a complete sentence?"
options: ["Spending hours on social media every day can harm concentration.", "Spending hours on social media, every day.", "Spent hours on social media every day.", "To spend hours on social media every day."]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "Cụm V-ing ('Spending hours...') thiếu động từ chính. Thêm động từ chia ('can harm concentration') biến nó thành chủ ngữ danh động từ của một câu hoàn chỉnh."
why_wrong:
  '1': Cụm từ này vẫn thiếu động từ chính để tạo thành một câu hoàn chỉnh, chỉ thêm dấu phẩy và cụm trạng ngữ không thay đổi cấu trúc câu.
  '2': “Spent” là động từ quá khứ đơn hoặc quá khứ phân từ, nhưng không có chủ ngữ đi kèm nên câu vẫn chưa hoàn chỉnh.
  '3': Cụm động từ nguyên mẫu (infinitive phrase) không thể tự tạo thành một câu hoàn chỉnh vì nó thiếu động từ chính được chia thì.
---

---
id: "sf_ving_b2"
type: "boolean"
input: "boolean"
headword: "sf-ving-ved-alone"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Trained by experienced coaches for months.' là một câu hoàn chỉnh."
answer: false
grammar_article_slug: "sentence-fragments"
explain: "SAI — 'Trained by experienced coaches for months' là cụm V-ed (phân từ bị động) không có chủ ngữ và động từ chính. Sửa: 'The athletes were trained by experienced coaches for months.'"
---

---
id: "sf_ving_i1"
type: "gap_mcq"
input: "choice"
headword: "sf-ving-ved-alone"
skill: "usage"
subtype: "intermediate"
prompt: "Fix the fragment: 'Struggling to balance work and study.' → '____, many part-time students eventually drop out.'"
options: ["Struggling to balance work and study", "Struggle to balance work and study", "Struggled to balance work and study", "To struggling balance work and study"]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "Cụm V-ing 'Struggling to balance work and study' có thể đứng đầu câu làm trạng ngữ, nhưng bắt buộc phải có mệnh đề chính theo sau ('many part-time students eventually drop out')."
why_wrong:
  '1': Struggle là dạng động từ nguyên thể, không thể làm bổ ngữ cho danh từ hoặc bắt đầu một mệnh đề trạng ngữ miêu tả nguyên nhân/cách thức cho hành động chính của chủ ngữ.
  '2': Struggled là dạng động từ quá khứ đơn hoặc phân từ quá khứ, không phù hợp để diễn tả hành động đang diễn ra và chủ động của chủ ngữ "students" ở đầu câu.
  '3': To struggling là một cấu trúc ngữ pháp sai trong tiếng Anh, không thể kết hợp "to" với dạng V-ing theo cách này.
---

---
id: "sf_ving_i2"
type: "gap_mcq"
input: "choice"
headword: "sf-ving-ved-alone"
skill: "contrast"
subtype: "intermediate"
prompt: "Which sentence correctly completes the idea started by the fragment 'Faced with rising costs of living.'?"
options: ["Faced with rising costs of living, young families are moving to smaller towns.", "Faced with rising costs of living and struggle.", "Face with rising costs of living, families moving.", "Faced with rising costs of living moved families."]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "'Faced with rising costs of living' là cụm V-ed (phân từ) cần một mệnh đề chính rõ chủ ngữ + động từ theo sau: 'young families are moving to smaller towns.'"
---

---
id: "sf_ving_i3"
type: "gap_text"
input: "text"
headword: "sf-ving-ved-alone"
skill: "production"
subtype: "intermediate"
prompt: "Complete the sentence so the V-ing fragment is no longer standing alone: 'Working night shifts on a regular basis, ____ (write a short main clause about health).'"
accept: ["many employees experience serious health problems", "many workers suffer from serious health problems", "employees often suffer from health problems"]
case_sensitive: false
grammar_article_slug: "sentence-fragments"
explain: "Cụm V-ing 'Working night shifts on a regular basis' cần một mệnh đề chính có chủ ngữ + động từ chia để thành câu hoàn chỉnh, ví dụ: 'many employees experience serious health problems.'"
---

---
id: "sf_ving_a1"
type: "boolean"
input: "boolean"
headword: "sf-ving-ved-alone"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Trong bài Writing, câu 'Motivated mainly by financial pressure and job insecurity.' có thể đứng riêng làm một câu hoàn chỉnh nếu đặt sau dấu chấm."
answer: false
grammar_article_slug: "sentence-fragments"
explain: "SAI — đây vẫn là cụm V-ed thiếu chủ ngữ và động từ chính dù đứng sau dấu chấm. Sửa: 'Motivated mainly by financial pressure and job insecurity, many employees accept overtime work.'"
---

---
id: "sf_ving_a2"
type: "mcq"
input: "choice"
headword: "sf-ving-ved-alone"
skill: "contrast"
subtype: "advanced"
prompt: "Which revision best fixes this pair: 'Reduced by nearly half over the past decade. Deforestation continues to threaten biodiversity.'?"
options: ["Reduced by nearly half over the past decade, forest coverage continues to shrink, threatening biodiversity.", "Reduced by nearly half over the past decade continues to threaten biodiversity.", "Reduce by nearly half over the past decade. Deforestation continues.", "Reduced by nearly half, over the past decade deforestation."]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "Cụm V-ed 'Reduced by nearly half over the past decade' cần được gắn với một chủ ngữ + động từ chính rõ ràng ('forest coverage continues to shrink') để không còn là fragment."
why_wrong:
  '1': Cụm phân từ 'Reduced...' đứng đầu câu nhưng không có chủ ngữ rõ ràng để nó bổ nghĩa, khiến cấu trúc câu mơ hồ và không đúng ngữ pháp.
  '2': Sử dụng dạng động từ nguyên mẫu 'Reduce' thay vì phân từ quá khứ 'Reduced' ở đầu câu là sai ngữ pháp, và câu vẫn giữ nguyên lỗi câu cụt (fragment).
  '3': Cấu trúc câu bị xáo trộn và thiếu động từ chính cho chủ ngữ 'deforestation', tạo thành một cụm từ không hoàn chỉnh thay vì một câu có nghĩa.
---

# ===== item_key 3 · Cụm danh từ đứng một mình (không có động từ chính) =====

---
id: "sf_np_b1"
type: "mcq"
input: "choice"
headword: "sf-noun-phrase-alone"
skill: "form"
subtype: "basic"
prompt: "Which one is a complete sentence?"
options: ["A serious shortage of affordable housing in most capital cities.", "A serious shortage of affordable housing affects most capital cities.", "A serious shortage of affordable housing, in most capital cities.", "Affordable housing shortage, most capital cities."]
answer: 1
grammar_article_slug: "sentence-fragments"
explain: "Cụm danh từ dài ('A serious shortage of affordable housing in most capital cities') không có động từ chính là fragment. Cần thêm động từ như 'affects' để hoàn chỉnh."
why_wrong:
  '0': Đây là một cụm danh từ dài, thiếu động từ chính để tạo thành một câu hoàn chỉnh.
  '2': Tương tự như phương án 0, đây vẫn là một cụm danh từ thiếu động từ chính, và dấu phẩy không bổ sung động từ cho câu.
  '3': Đây là hai cụm danh từ riêng lẻ được ngăn cách bởi dấu phẩy và không có động từ chính để liên kết chúng thành một câu.
---

---
id: "sf_np_b2"
type: "boolean"
input: "boolean"
headword: "sf-noun-phrase-alone"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'The rising number of international students in Australian universities.' là một câu hoàn chỉnh."
answer: false
grammar_article_slug: "sentence-fragments"
explain: "SAI — đây chỉ là một cụm danh từ dài, không có động từ chính. Sửa: 'The rising number of international students in Australian universities has boosted the local economy.'"
---

---
id: "sf_np_i1"
type: "gap_mcq"
input: "choice"
headword: "sf-noun-phrase-alone"
skill: "usage"
subtype: "intermediate"
prompt: "Fix the fragment: 'The growing gap between rich and poor households.' → 'The growing gap between rich and poor households ____ a major challenge for policymakers.'"
options: ["poses", "posing", "to pose", "posed by"]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "Cụm danh từ dài cần một động từ chính chia đúng thì ('poses') để trở thành chủ ngữ của câu hoàn chỉnh, không phải dạng V-ing hay to-infinitive."
why_wrong:
  '1': Posing là một động từ dạng V-ing (hiện tại phân từ), không thể đóng vai trò là động từ chính của câu để tạo thành một câu hoàn chỉnh.
  '2': To pose là một động từ nguyên mẫu (infinitive), không thể dùng làm động từ chính của chủ ngữ để tạo thành một câu hoàn chỉnh.
  '3': Posed by là một cụm phân từ hoặc thì bị động không hoàn chỉnh, không thể làm động từ chính cho chủ ngữ 'The growing gap'.
---

---
id: "sf_np_i2"
type: "gap_mcq"
input: "choice"
headword: "sf-noun-phrase-alone"
skill: "contrast"
subtype: "intermediate"
prompt: "Which sentence correctly completes the fragment 'The main cause of traffic jams in the city centre.'?"
options: ["The main cause of traffic jams in the city centre is the lack of public parking.", "The main cause of traffic jams, in the city centre.", "The main cause of traffic jams in the city centre, being the lack of parking.", "The main causing of traffic jams in the city centre."]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "Cụm danh từ 'The main cause of traffic jams in the city centre' cần động từ 'is' + phần bổ nghĩa để trở thành câu hoàn chỉnh, không chỉ thêm dấu phẩy hay 'being'."
---

---
id: "sf_np_i3"
type: "gap_text"
input: "text"
headword: "sf-noun-phrase-alone"
skill: "production"
subtype: "intermediate"
prompt: "Complete the sentence by adding a main verb. Fragment: 'A significant rise in youth unemployment across the region.' → 'A significant rise in youth unemployment across the region ____ (write a verb phrase, e.g. worry economists).'"
accept: ["worries economists", "concerns economists", "has worried economists"]
case_sensitive: false
grammar_article_slug: "sentence-fragments"
explain: "Cụm danh từ dài thiếu động từ chính; thêm động từ chia đúng thì ('worries economists') để câu có đầy đủ chủ ngữ + vị ngữ."
---

---
id: "sf_np_a1"
type: "boolean"
input: "boolean"
headword: "sf-noun-phrase-alone"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Trong Writing Task 2, câu 'A long-term strategy to reduce carbon emissions across all major industries.' đứng một mình là hợp lệ vì nó chứa một cụm to-infinitive."
answer: false
grammar_article_slug: "sentence-fragments"
explain: "SAI — cụm to-infinitive 'to reduce carbon emissions...' chỉ bổ nghĩa cho danh từ 'strategy', cả câu vẫn thiếu động từ chính. Sửa: 'A long-term strategy to reduce carbon emissions across all major industries is essential.'"
---

---
id: "sf_np_a2"
type: "mcq"
input: "choice"
headword: "sf-noun-phrase-alone"
skill: "contrast"
subtype: "advanced"
prompt: "Which revision best fixes this pair: 'Governments face a difficult choice. A trade-off between economic growth and environmental protection.'?"
options: ["Governments face a difficult choice: a trade-off between economic growth and environmental protection.", "Governments face a difficult choice. Trade-off between economic growth and environmental protection.", "Governments face a difficult choice, a trade-off between economic growth, environmental protection.", "Governments face a difficult choice being a trade-off between growth and protection."]
answer: 0
grammar_article_slug: "sentence-fragments"
explain: "Cụm danh từ fragment sau dấu chấm nên được nối vào câu trước bằng dấu hai chấm (không thêm động từ) vì nó đang giải thích/định nghĩa lại 'a difficult choice'."
why_wrong:
  '1': Cụm danh từ "Trade-off between economic growth and environmental protection" vẫn là một câu cụt (fragment) vì thiếu động từ chính.
  '2': Câu này thiếu từ nối "and" trước "environmental protection" trong danh sách liệt kê, phá vỡ cấu trúc song song.
  '3': Việc thêm từ "being" khiến câu trở nên rườm rà và làm mất đi sự trực tiếp, súc tích khi giới thiệu cụm danh từ giải thích.
---
