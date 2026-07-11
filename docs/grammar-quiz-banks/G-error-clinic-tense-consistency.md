---
kind: quiz
code: "G-error-clinic-tense-consistency"
title: "Quick Check — Tense Consistency"
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

# ===== item_key 1 · Nhất quán trong kể chuyện quá khứ (past narrative) =====

---
id: "tc_pastnar_b1"
type: "mcq"
input: "choice"
headword: "tc-past-narrative"
skill: "form"
subtype: "basic"
prompt: "She woke up at 7am, made coffee, and ____ down to read the newspaper."
options: ["sat", "sits", "sitting", "has sat"]
answer: 0
grammar_article_slug: "tense-consistency"
explain: "Khi kể chuỗi hành động quá khứ, mọi động từ giữ nguyên Past Simple: woke, made, sat — không nhảy sang thì khác giữa chừng."
why_wrong:
  '1': Chuỗi hành động đang kể diễn ra trong quá khứ (woke, made), nên không thể dùng thì hiện tại đơn "sits".
  '2': '"Sitting" là dạng V-ing, không phải động từ chính có thể đứng độc lập trong chuỗi hành động được liệt kê sau liên từ "and".'
  '3': Thì hiện tại hoàn thành "has sat" không phù hợp vì chuỗi hành động này là các sự kiện nối tiếp nhau đã hoàn thành trong quá khứ, không có liên hệ trực tiếp đến hiện tại.
---

---
id: "tc_pastnar_b2"
type: "boolean"
input: "boolean"
headword: "tc-past-narrative"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'He drove to the station, parked the car, and buys a ticket.'"
answer: false
grammar_article_slug: "tense-consistency"
explain: "SAI — đây là lỗi tense_inconsistency: drove/parked là Past Simple nhưng 'buys' lại nhảy sang Present Simple vô lý. Sửa: 'bought a ticket'."
---

---
id: "tc_pastnar_i1"
type: "gap_mcq"
input: "choice"
headword: "tc-past-narrative"
skill: "usage"
subtype: "intermediate"
prompt: "We drove there from Da Nang and arrived in the afternoon. The town was beautiful — I ____ anything like it before."
options: ["never see", "had never seen", "never saw", "am never seeing"]
answer: 1
grammar_article_slug: "tense-consistency"
explain: "Trong narrative quá khứ, hành động xảy ra TRƯỚC mốc quá khứ chính (arrived) dùng Past Perfect: had never seen — đây là chuyển thì HỢP LỆ, không phải lỗi."
why_wrong:
  '0': Thì hiện tại đơn "never see" không phù hợp với chuỗi sự kiện và ngữ cảnh quá khứ của câu chuyện.
  '2': Thì quá khứ đơn "never saw" không diễn tả một hành động đã hoàn tất trước một mốc thời gian cụ thể khác trong quá khứ như từ "before" gợi ý.
  '3': Thì hiện tại tiếp diễn "am never seeing" không đúng về mặt thời gian khi cả câu chuyện đang diễn ra trong quá khứ.
---

---
id: "tc_pastnar_i2"
type: "gap_text"
input: "text"
headword: "tc-past-narrative"
skill: "production"
subtype: "intermediate"
prompt: "The government introduced a new policy last year. The policy ____ (help) thousands of people by providing financial support."
accept: ["helped"]
case_sensitive: false
grammar_article_slug: "tense-consistency"
explain: "Câu trước dùng Past Simple (introduced, mốc 'last year') → câu sau phải giữ nguyên chủ đạo quá khứ: helped (không phải 'helps')."
---

---
id: "tc_pastnar_a1"
type: "mcq"
input: "choice"
headword: "tc-past-narrative"
skill: "contrast"
subtype: "advanced"
prompt: "Scientists in the 17th century believed the earth was the centre of the universe. However, Galileo later proved that the earth ____ the sun."
options: ["orbited", "orbits", "had orbited", "was orbiting"]
answer: 1
grammar_article_slug: "tense-consistency"
explain: "Đây là sự thật khoa học vĩnh cửu xen vào narrative quá khứ → Present Simple 'orbits' vẫn HỢP LỆ dù câu chuyện đang ở quá khứ (không backshift sự thật bất biến)."
why_wrong:
  '0': Sai vì dùng thì quá khứ đơn ngụ ý sự thật khoa học này đã kết thúc hoặc chỉ đúng trong quá khứ, trong khi Trái Đất vẫn đang quay quanh Mặt Trời.
  '2': Sai vì thì quá khứ hoàn thành dùng để diễn tả một hành động xảy ra trước một thời điểm khác trong quá khứ, không phù hợp với một sự thật khoa học bất biến.
  '3': Sai vì thì quá khứ tiếp diễn diễn tả một hành động đang diễn ra tại một thời điểm cụ thể trong quá khứ, không thể hiện tính chất vĩnh cửu của sự thật khoa học.
---

# ===== item_key 2 · Nhảy thì vô lý (random tense shift) sang Present giữa đoạn Past =====

---
id: "tc_shift_b1"
type: "boolean"
input: "boolean"
headword: "tc-random-shift"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'The Industrial Revolution was a turning point in history. Factory workers moved to cities, and living standards change dramatically.'"
answer: false
grammar_article_slug: "tense-consistency"
explain: "SAI — lỗi wrong_tense: câu chuyện đang ở Past Simple (was, moved) nhưng 'change' đột ngột nhảy sang Present. Sửa: 'living standards changed dramatically'."
---

---
id: "tc_shift_b2"
type: "mcq"
input: "choice"
headword: "tc-random-shift"
skill: "form"
subtype: "basic"
prompt: "In 2010, the company announced record profits. It expanded into three new markets and ____ 500 staff."
options: ["hires", "hired", "is hiring", "has hired"]
answer: 1
grammar_article_slug: "tense-consistency"
explain: "Cả đoạn kể về sự kiện quá khứ có mốc rõ (2010) → giữ nguyên Past Simple: hired, không nhảy sang 'hires'."
why_wrong:
  '0': Thì hiện tại đơn ('hires') dùng để diễn tả thói quen, sự thật hiển nhiên hoặc lịch trình, không phù hợp với chuỗi sự kiện đã xảy ra và kết thúc trong quá khứ (năm 2010).
  '2': Thì hiện tại tiếp diễn ('is hiring') diễn tả hành động đang diễn ra tại thời điểm nói hoặc một sự kiện tạm thời, không phù hợp với hành động đã hoàn tất trong quá khứ.
  '3': Thì hiện tại hoàn thành ('has hired') dùng để diễn tả hành động xảy ra trong quá khứ và có liên quan đến hiện tại hoặc không có mốc thời gian cụ thể, trong khi ở đây sự kiện đã có mốc rõ ràng (năm 2010) và đã kết thúc.
---

---
id: "tc_shift_i1"
type: "gap_mcq"
input: "choice"
headword: "tc-random-shift"
skill: "usage"
subtype: "intermediate"
prompt: "She studied for months, passed the exam, and ____ a qualified doctor."
options: ["becomes", "became", "become", "is becoming"]
answer: 1
grammar_article_slug: "tense-consistency"
explain: "Chuỗi hành động nối tiếp trong quá khứ (studied, passed) phải giữ nhất quán Past Simple: became — tránh lỗi tense_inconsistency khi nhảy sang 'becomes'."
why_wrong:
  '0': Phương án này dùng thì hiện tại đơn ("becomes") không phù hợp với chuỗi hành động đã xảy ra trong quá khứ ("studied", "passed"), phá vỡ tính nhất quán về thì của câu.
  '2': Đây là dạng nguyên thể ("become"), không phải thì quá khứ đơn, nên không thể hoàn thành chuỗi hành động trong quá khứ theo đúng ngữ pháp.
  '3': Thì hiện tại tiếp diễn ("is becoming") không chính xác trong ngữ cảnh này vì câu đang mô tả một kết quả đã hoàn thành trong quá khứ, không phải một hành động đang diễn ra hay một xu hướng.
---

---
id: "tc_shift_i2"
type: "gap_text"
input: "text"
headword: "tc-random-shift"
skill: "production"
subtype: "intermediate"
prompt: "Technology has changed society dramatically over the past century. It has created new industries and ____ (transform) the way we communicate."
accept: ["has transformed"]
case_sensitive: false
grammar_article_slug: "tense-consistency"
explain: "'over the past century' = kết quả kéo dài đến hiện tại → cả câu phải nhất quán ở Present Perfect: has changed, has created, has transformed (không phải Present Simple 'changes/creates')."
---

---
id: "tc_shift_a1"
type: "boolean"
input: "boolean"
headword: "tc-random-shift"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'In 2015, the government announces new environmental targets and pledges to cut emissions.'"
answer: false
grammar_article_slug: "tense-consistency"
explain: "SAI — đây là historical present (kể chuyện ở Present Simple), hợp lệ trong văn học/báo chí nhưng KHÔNG phù hợp IELTS Writing. Sửa: 'announced... and pledged...' (Past Simple, có mốc 2015)."
---

# ===== item_key 3 · Thì chủ đạo trong IELTS Writing Task 2 (hiện tại/xu hướng/ví dụ) =====

---
id: "tc_task2_b1"
type: "mcq"
input: "choice"
headword: "tc-task2-default"
skill: "form"
subtype: "basic"
prompt: "Online learning ____ increasingly popular in recent decades, and this trend continues today."
options: ["has become", "became", "become", "is becoming only"]
answer: 0
grammar_article_slug: "tense-consistency"
explain: "Task 2 mặc định thì chủ đạo là Present (Simple/Perfect) cho xu hướng liên quan đến hiện tại: 'has become' — kết quả kéo dài tới nay."
---

---
id: "tc_task2_b2"
type: "boolean"
input: "boolean"
headword: "tc-task2-default"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Technology changed our lives significantly.' là câu tốt để mở đầu bàn luận về ảnh hưởng của công nghệ đang tiếp diễn hiện nay."
answer: false
grammar_article_slug: "tense-consistency"
explain: "SAI — 'changed' (Past Simple) ngụ ý việc đã kết thúc hẳn. Vì ảnh hưởng công nghệ vẫn đang tiếp diễn, nên dùng Present Perfect: 'Technology has changed our lives significantly.'"
---

---
id: "tc_task2_i1"
type: "gap_mcq"
input: "choice"
headword: "tc-task2-default"
skill: "usage"
subtype: "intermediate"
prompt: "Research suggests that students who study online perform just as well as traditional students. For example, a study conducted in 2019 ____ that retention rates were higher in online courses."
options: ["finds", "found", "has found", "is finding"]
answer: 1
grammar_article_slug: "tense-consistency"
explain: "Câu chủ đạo Task 2 ở Present Simple (suggests, perform) nhưng ví dụ cụ thể có mốc thời gian (2019) chuyển hợp lệ sang Past Simple: found — đây là lý do logic được phép."
why_wrong:
  '0': Thì Hiện tại đơn (finds) không phù hợp vì hành động của nghiên cứu diễn ra và hoàn tất vào một thời điểm cụ thể trong quá khứ (2019).
  '2': Thì Hiện tại hoàn thành (has found) không được dùng khi có mốc thời gian cụ thể trong quá khứ (2019) được chỉ định rõ ràng.
  '3': Thì Hiện tại tiếp diễn (is finding) miêu tả hành động đang diễn ra hoặc tạm thời, không phù hợp với một nghiên cứu đã hoàn thành vào năm 2019.
---

---
id: "tc_task2_i2"
type: "gap_text"
input: "text"
headword: "tc-task2-default"
skill: "production"
subtype: "intermediate"
prompt: "Online learning has grown rapidly in recent years. Universities offer more remote courses and students ____ (benefit) from the flexibility."
accept: ["have benefited", "have benefitted"]
case_sensitive: false
grammar_article_slug: "tense-consistency"
explain: "Đoạn văn nói về xu hướng đến hiện tại (has grown) → câu sau nên nhất quán ở Present Perfect: have benefited, tránh nhảy về Past Simple đơn lẻ."
---

---
id: "tc_task2_a1"
type: "mcq"
input: "choice"
headword: "tc-task2-default"
skill: "contrast"
subtype: "advanced"
prompt: "If we don't act now, sea levels ____ and low-lying cities ____ within decades."
options: ["rise / flood", "will rise / will flood", "rose / flooded", "have risen / have flooded"]
answer: 1
grammar_article_slug: "tense-consistency"
explain: "Dự đoán tương lai có điều kiện Type 1 (If + Present, ...will + V) — dùng Present Simple ở mệnh đề If nhưng BẮT BUỘC modal 'will' ở mệnh đề chính, không dùng Present Simple trần cho kết quả tương lai."
why_wrong:
  '0': Mệnh đề chính dùng thì Hiện tại đơn để diễn tả kết quả tương lai là sai, vì theo quy tắc cần dùng modal 'will'.
  '2': Dùng thì Quá khứ đơn ở mệnh đề chính là sai vì không phù hợp với cấu trúc câu điều kiện loại 1 và ngữ cảnh dự đoán tương lai.
  '3': Dùng thì Hiện tại hoàn thành ở mệnh đề chính là sai vì không được sử dụng để dự đoán kết quả tương lai trong câu điều kiện loại 1.
---

# ===== item_key 4 · Chuyển thì hợp lệ vs không hợp lệ (contrast) =====

---
id: "tc_valid_b1"
type: "mcq"
input: "choice"
headword: "tc-valid-vs-invalid-shift"
skill: "contrast"
subtype: "basic"
prompt: "She said she ____ tired. (direct speech: \"I am tired\")"
options: ["is", "was", "has been", "be"]
answer: 1
grammar_article_slug: "tense-consistency"
explain: "Reported speech backshift (said → was) là chuyển thì HỢP LỆ theo quy tắc tường thuật, không phải lỗi tense_inconsistency."
why_wrong:
  '0': Is giữ thì hiện tại, không phù hợp với động từ tường thuật "said" (quá khứ) trong câu tường thuật.
  '2': Has been là thì hiện tại hoàn thành, không phải dạng lùi thì chính xác cho "am" (hiện tại đơn) trong câu tường thuật này.
  '3': Be là dạng nguyên thể của động từ, không được chia thì và không hòa hợp với chủ ngữ "she" trong một câu tường thuật khẳng định.
---

---
id: "tc_valid_b2"
type: "boolean"
input: "boolean"
headword: "tc-valid-vs-invalid-shift"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: dùng Type 1 conditional (if + present, will + V) và Type 2 conditional (if + past, would + V) trong cùng một đoạn văn luôn là lỗi tense inconsistency."
answer: false
grammar_article_slug: "tense-consistency"
explain: "SAI — nếu hai câu điều kiện nói về hai điều kiện KHÁC NHAU, việc dùng Type 1 và Type 2 khác nhau trong cùng đoạn là hợp lệ, không phải lỗi."
---

---
id: "tc_valid_i1"
type: "gap_mcq"
input: "choice"
headword: "tc-valid-vs-invalid-shift"
skill: "usage"
subtype: "intermediate"
prompt: "When she arrived at the office, she realised she ____ her laptop at home."
options: ["forgot", "had forgotten", "forgets", "has forgotten"]
answer: 1
grammar_article_slug: "tense-consistency"
explain: "'forgotten' xảy ra TRƯỚC 'arrived' (mốc quá khứ chính) → Past Perfect 'had forgotten' là chuyển thì hợp lệ để thể hiện trình tự trước/sau."
why_wrong:
  '0': '''forgot'' (quá khứ đơn) không thể hiện rõ hành động quên xảy ra TRƯỚC hành động đến (quá khứ đơn), gây sai lệch về trình tự thời gian của các sự kiện trong quá khứ.'
  '2': '''forgets'' (hiện tại đơn) không phù hợp vì hành động này xảy ra trong quá khứ và dẫn đến một nhận ra trong quá khứ, không phải là một thói quen hay sự thật ở hiện tại.'
  '3': '''has forgotten'' (hiện tại hoàn thành) liên kết hành động quên với hiện tại, trong khi toàn bộ ngữ cảnh câu chuyện (đến, nhận ra) đều diễn ra trong quá khứ.'
---

---
id: "tc_valid_i2"
type: "gap_text"
input: "text"
headword: "tc-valid-vs-invalid-shift"
skill: "production"
subtype: "intermediate"
prompt: "He explained that the economy ____ (grow) by 2% before the crisis hit — use the reported-speech backshift form."
accept: ["had grown"]
case_sensitive: false
grammar_article_slug: "tense-consistency"
explain: "Direct speech 'grew' (Past Simple, trước một mốc quá khứ khác) → backshift trong reported speech thành Past Perfect: had grown. Đây là chuyển thì chuẩn, không phải lỗi."
---

---
id: "tc_valid_a1"
type: "boolean"
input: "boolean"
headword: "tc-valid-vs-invalid-shift"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Urbanisation has brought significant economic benefits. Cities create millions of jobs and have driven innovation. As people moved to urban areas, they gain access to better education.' là một đoạn nhất quán thì tốt."
answer: false
grammar_article_slug: "tense-consistency"
explain: "SAI — lỗi tense_inconsistency: đoạn mở đầu bằng Present Perfect (has brought) nhưng 'create' và 'gain' lại nhảy sang Present Simple, còn 'moved' lại nhảy sang Past Simple không lý do. Sửa nhất quán: 'Cities have created millions of jobs... As people have moved to urban areas, they have gained access...'"
---
