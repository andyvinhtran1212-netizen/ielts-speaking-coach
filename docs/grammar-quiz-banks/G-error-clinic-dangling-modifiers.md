---
kind: quiz
code: "G-error-clinic-dangling-modifiers"
title: "Quick Check — Dangling Modifiers"
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

# ===== item_key 1 · Dangling participle mở đầu câu (V-ing/V3 đầu câu, chủ ngữ sai) =====

---
id: "dm_part_b1"
type: "mcq"
input: "choice"
headword: "dm-participle-opening"
skill: "form"
subtype: "basic"
prompt: "Which sentence is correct (the subject after the comma can actually do the action)?"
options: ["Walking home, the rain started.", "Walking home, I was caught in the rain.", "Walking home, an umbrella was needed.", "Walking home, my phone got wet."]
answer: 1
grammar_article_slug: "dangling-modifiers"
explain: "Cụm phân từ đầu câu ('Walking home') mặc định thuộc về chủ ngữ ngay sau dấu phẩy. Chỉ 'I' mới có thể 'walking' — mưa, ô, điện thoại thì không."
why_wrong:
  '0': Mưa không thể tự đi bộ về nhà.
  '2': Một chiếc ô không thể tự đi bộ về nhà.
  '3': Điện thoại không thể tự đi bộ về nhà.
---

---
id: "dm_part_b2"
type: "boolean"
input: "boolean"
headword: "dm-participle-opening"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Having finished the report, the printer broke down.' là một câu đúng ngữ pháp và hợp lý."
answer: false
grammar_article_slug: "dangling-modifiers"
explain: "SAI — máy in ('the printer') không thể 'finish the report'. Câu bị treo. Sửa: 'Having finished the report, I noticed the printer had broken down.'"
---

---
id: "dm_part_i1"
type: "gap_mcq"
input: "choice"
headword: "dm-participle-opening"
skill: "usage"
subtype: "intermediate"
prompt: "'Feeling exhausted after the exam, ____ home early.' Choose the ending that avoids a dangling modifier."
options: ["the bus took her", "she went", "her bag was carried", "the taxi arrived"]
answer: 1
grammar_article_slug: "dangling-modifiers"
explain: "Chủ ngữ ngay sau dấu phẩy phải là người/vật cảm thấy 'exhausted'. Chỉ 'she' hợp lý — xe buýt, cái túi, taxi không thể 'feel exhausted'."
why_wrong:
  '0': Xe buýt không thể cảm thấy kiệt sức.
  '2': Chiếc túi không thể cảm thấy kiệt sức.
  '3': Xe taxi không thể cảm thấy kiệt sức.
---

---
id: "dm_part_i2"
type: "gap_text"
input: "text"
headword: "dm-participle-opening"
skill: "production"
subtype: "intermediate"
prompt: "Điền chủ ngữ đúng ngay sau dấu phẩy để cụm phân từ không bị treo: 'Arriving late for the interview, ____ (write a short subject/noun phrase only, e.g. the candidate) apologised to the panel.'"
accept: ["the candidate", "she", "he", "the applicant"]
case_sensitive: false
grammar_article_slug: "dangling-modifiers"
explain: "'Arriving late' phải gắn với người thực sự đến muộn — ứng viên (the candidate/she/he/the applicant), không phải 'the panel' hay vật vô tri."
---

---
id: "dm_part_a1"
type: "boolean"
input: "boolean"
headword: "dm-participle-opening"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Trong Writing Task 2, câu 'Being cheap, everyone bought the phone.' diễn đạt đúng ý 'vì điện thoại rẻ nên mọi người mua nó'."
answer: false
grammar_article_slug: "dangling-modifiers"
explain: "SAI — 'Being cheap' bị hiểu là bổ nghĩa cho 'everyone' (mọi người rẻ tiền?!), vô lý. Sửa: 'Being cheap, the phone sold quickly.'"
---

---
id: "dm_part_a2"
type: "mcq"
input: "choice"
headword: "dm-participle-opening"
skill: "contrast"
subtype: "advanced"
prompt: "Which revision best fixes the dangling modifier in: 'Concerned about rising tuition fees, a scholarship scheme was launched by the university.'?"
options: ["Concerned about rising tuition fees, the university launched a scholarship scheme.", "Concerned about rising tuition fees, a scholarship scheme, the university launched.", "Concerning rising tuition fees, a scholarship scheme was launched.", "Concerned about rising tuition fees, it was launched by the university."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "'Concerned about rising tuition fees' phải mô tả một thực thể biết 'lo lắng' — 'the university' (chủ thể có ý chí), không phải 'a scholarship scheme' (vật vô tri không thể lo lắng)."
why_wrong:
  '1': Cụm từ "Concerned about rising tuition fees" vẫn bổ nghĩa cho "a scholarship scheme" (chương trình học bổng), một vật vô tri không thể lo lắng.
  '2': Cụm từ "Concerning rising tuition fees" thay đổi ý nghĩa gốc ("lo lắng") thành "liên quan đến" và không chỉ ra đối tượng nào "lo lắng" như yêu cầu của câu gốc.
  '3': Đại từ "it" (ám chỉ chương trình học bổng) không thể "lo lắng" về học phí, do đó lỗi bổ ngữ treo vẫn chưa được sửa.
---

# ===== item_key 2 · Sửa bằng cách đổi chủ ngữ cho khớp phân từ =====

---
id: "dm_subj_b1"
type: "mcq"
input: "choice"
headword: "dm-fix-change-subject"
skill: "form"
subtype: "basic"
prompt: "Fragment gốc: 'Reading the instructions carefully, [SUBJECT] assembled the shelf correctly.' Which subject fixes the dangling modifier?"
options: ["the shelf", "the manual", "she", "the screws"]
answer: 2
grammar_article_slug: "dangling-modifiers"
explain: "Cách sửa 1: đổi chủ ngữ cho khớp phân từ. Chỉ 'she' (người) mới có thể 'reading the instructions' — cái kệ, sách hướng dẫn, con vít thì không đọc được."
why_wrong:
  '0': Cái kệ không thể đọc hướng dẫn sử dụng.
  '1': Sách hướng dẫn không thể tự đọc hướng dẫn.
  '3': Những con vít không thể đọc hướng dẫn sử dụng.
---

---
id: "dm_subj_b2"
type: "boolean"
input: "boolean"
headword: "dm-fix-change-subject"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: Để sửa 'Having studied all night, the exam felt easy.', ta chỉ cần đổi chủ ngữ thành người học, ví dụ 'Having studied all night, I found the exam easy.'"
answer: true
grammar_article_slug: "dangling-modifiers"
explain: "ĐÚNG — 'the exam' không thể 'study all night'. Đổi chủ ngữ ngay sau phẩy thành 'I' (người thực sự học) là một cách sửa hợp lệ theo bài Wiki."
---

---
id: "dm_subj_i1"
type: "gap_mcq"
input: "choice"
headword: "dm-fix-change-subject"
skill: "usage"
subtype: "intermediate"
prompt: "Original (dangling): 'Determined to pass the IELTS test, months of preparation followed.' Which revision fixes it by changing the subject?"
options: ["Determined to pass the IELTS test, she spent months preparing.", "Determined to pass the IELTS test, months of preparation was needed.", "Determined to pass the IELTS test, preparation happened for months.", "Determined to pass the IELTS test, it took months."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "'Determined to pass the IELTS test' chỉ mô tả một người có quyết tâm. Đổi chủ ngữ thành 'she' (người quyết tâm) khớp đúng với cụm phân từ."
why_wrong:
  '1': Chủ ngữ 'months of preparation' không thể là đối tượng 'determined' (quyết tâm), khiến cụm phân từ 'Determined to pass...' vẫn bị treo.
  '2': Chủ ngữ 'preparation' không thể là người 'determined' (quyết tâm), khiến cụm phân từ 'Determined to pass...' vẫn bị treo.
  '3': Chủ ngữ 'it' là một đại từ trống, không thể là người 'determined' (quyết tâm), khiến cụm phân từ 'Determined to pass...' vẫn bị treo.
---

---
id: "dm_subj_i2"
type: "gap_text"
input: "text"
headword: "dm-fix-change-subject"
skill: "production"
subtype: "intermediate"
prompt: "Sửa câu treo bằng cách đổi chủ ngữ (không đổi cụm phân từ). Câu gốc: 'Worried about the deadline, the essay was rushed.' → 'Worried about the deadline, ____ (write a short subject + verb about the student rushing the essay).'"
accept: ["the student rushed the essay", "she rushed the essay", "he rushed the essay", "the writer rushed the essay"]
case_sensitive: false
grammar_article_slug: "dangling-modifiers"
explain: "'Worried about the deadline' chỉ người mới lo lắng được, không phải 'the essay'. Đổi chủ ngữ ngay sau phẩy thành người viết (the student/she/he/the writer) là đúng cách sửa 1 trong bài."
---

---
id: "dm_subj_a1"
type: "boolean"
input: "boolean"
headword: "dm-fix-change-subject"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Câu 'Exhausted from the long flight, a hot shower was the first thing she wanted.' đã được sửa đúng bằng cách đổi chủ ngữ."
answer: false
grammar_article_slug: "dangling-modifiers"
explain: "SAI — chủ ngữ ngay sau phẩy vẫn là 'a hot shower', không phải người mệt mỏi. Sửa đúng: 'Exhausted from the long flight, she wanted a hot shower first.'"
---

---
id: "dm_subj_a2"
type: "mcq"
input: "choice"
headword: "dm-fix-change-subject"
skill: "contrast"
subtype: "advanced"
prompt: "Which revision fixes this dangling modifier strictly by changing the subject, keeping the participle phrase unchanged: 'Frustrated by the traffic congestion, several new policies were proposed.'?"
options: ["Frustrated by the traffic congestion, the city council proposed several new policies.", "Frustrated by the traffic congestion, congestion policies were proposed by councils.", "Frustration by the traffic congestion led to policies.", "Frustrated by the traffic congestion, it proposed several new policies."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "'Frustrated by the traffic congestion' chỉ mô tả một thực thể biết bực bội — 'the city council' (con người/tổ chức có cảm xúc), không phải 'several new policies' (vật vô tri)."
---

# ===== item_key 3 · Sửa bằng cách biến thành mệnh đề phụ đầy đủ (thêm chủ ngữ cho cụm) =====

---
id: "dm_clause_b1"
type: "mcq"
input: "choice"
headword: "dm-fix-full-clause"
skill: "form"
subtype: "basic"
prompt: "Which revision fixes 'After finishing the report, the printer broke down.' by turning the opening phrase into a full clause (adding its own subject)?"
options: ["After I finished the report, the printer broke down.", "After finished the report, the printer broke down.", "The printer, after finishing the report, broke down.", "After finishing a report, printers break down."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "Cách sửa 2: biến cụm phân từ thành mệnh đề đầy đủ bằng cách thêm chủ ngữ riêng ('I') và động từ chia ('finished') cho mệnh đề phụ — máy in ('the printer') vẫn giữ nguyên vai trò chủ ngữ mệnh đề chính."
---

---
id: "dm_clause_b2"
type: "boolean"
input: "boolean"
headword: "dm-fix-full-clause"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Before signing the contract, the terms should be read carefully.' cần được sửa vì chủ ngữ 'the terms' không thể 'sign the contract'."
answer: true
grammar_article_slug: "dangling-modifiers"
explain: "ĐÚNG — 'the terms' (các điều khoản) không thể tự ký hợp đồng. Một cách sửa: 'Before you sign the contract, the terms should be read carefully.' (thêm chủ ngữ 'you' biến cụm thành mệnh đề đầy đủ)."
---

---
id: "dm_clause_i1"
type: "gap_mcq"
input: "choice"
headword: "dm-fix-full-clause"
skill: "usage"
subtype: "intermediate"
prompt: "Original (dangling): 'While reviewing the applications, several errors were found.' Which revision fixes it by adding a subject to make a full subordinate clause?"
options: ["While the committee reviewed the applications, several errors were found.", "While reviewed the applications, several errors were found.", "While review the applications, errors found.", "While reviewing applications, error was found by committee."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "Thêm chủ ngữ 'the committee' và chia động từ 'reviewed' biến cụm phân từ rút gọn thành mệnh đề phụ đầy đủ ('While the committee reviewed the applications'), tách biệt rõ với chủ ngữ mệnh đề chính 'several errors'."
why_wrong:
  '1': Mệnh đề phụ 'While reviewed the applications' thiếu chủ ngữ cho động từ 'reviewed' và cấu trúc ngữ pháp sai.
  '2': Cả mệnh đề phụ 'While review the applications' và mệnh đề chính 'errors found' đều thiếu chủ ngữ và/hoặc động từ chưa được chia đúng thì.
  '3': Cụm từ 'While reviewing applications' vẫn là mệnh đề rút gọn bị treo (dangling modifier) vì không có chủ ngữ riêng biệt rõ ràng.
---

---
id: "dm_clause_i2"
type: "gap_text"
input: "text"
headword: "dm-fix-full-clause"
skill: "production"
subtype: "intermediate"
prompt: "Biến cụm phân từ treo thành mệnh đề phụ đầy đủ bằng cách thêm chủ ngữ. Câu gốc: 'Having lived abroad for years, the language barrier was no longer a problem.' → '____ (write 'After/Since + subject + verb', e.g. about her living abroad) , the language barrier was no longer a problem.'"
accept: ["after she had lived abroad for years", "since she had lived abroad for years", "after she lived abroad for years"]
case_sensitive: false
grammar_article_slug: "dangling-modifiers"
explain: "'Having lived abroad for years' phải gắn với người thực sự đã sống ở nước ngoài. Thêm chủ ngữ ('she') và liên từ ('after/since') biến cụm thành mệnh đề phụ đầy đủ, tách khỏi chủ ngữ mệnh đề chính 'the language barrier'."
---

---
id: "dm_clause_a1"
type: "boolean"
input: "boolean"
headword: "dm-fix-full-clause"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Câu 'After analysing the survey data, several trends emerged.' đã được sửa đúng thành mệnh đề đầy đủ bằng cách thêm chủ ngữ cho cụm phân từ."
answer: false
grammar_article_slug: "dangling-modifiers"
explain: "SAI — câu này vẫn chưa có chủ ngữ riêng cho 'analysing'; 'several trends' không thể tự phân tích dữ liệu khảo sát. Sửa đúng: 'After the researchers analysed the survey data, several trends emerged.'"
---

---
id: "dm_clause_a2"
type: "mcq"
input: "choice"
headword: "dm-fix-full-clause"
skill: "contrast"
subtype: "advanced"
prompt: "Which revision fixes this dangling modifier by turning it into a full subordinate clause (adding a subject), rather than changing the main clause's subject: 'Upon completing the internship, a permanent contract was offered.'?"
options: ["Upon completing the internship, several interns were offered a permanent contract.", "After she completed the internship, a permanent contract was offered.", "Upon complete the internship, a contract offered.", "Completing the internship, offered a permanent contract."]
answer: 1
grammar_article_slug: "dangling-modifiers"
explain: "Cách 2 giữ nguyên chủ ngữ mệnh đề chính ('a permanent contract') nhưng thêm chủ ngữ riêng ('she') và liên từ ('After') để biến cụm phân từ thành mệnh đề phụ đầy đủ — khác với phương án A vốn đổi chủ ngữ mệnh đề chính (đó là cách sửa 1)."
why_wrong:
  '0': Phương án này thay đổi chủ ngữ của mệnh đề chính (từ 'a permanent contract' sang 'several interns'), điều mà đề bài yêu cầu tránh khi áp dụng cách sửa này.
  '2': Cụm từ 'Upon complete' sai ngữ pháp (phải là 'Upon completing') và mệnh đề chính 'a contract offered' cũng không đúng ngữ pháp và thiếu nghĩa.
  '3': Cụm từ 'Completing the internship' vẫn là cụm phân từ treo (dangling participle) và mệnh đề chính thiếu chủ ngữ, khiến câu vẫn sai ngữ pháp.
---

# ===== item_key 4 · Dangling to-infinitive / reduced clause đầu câu =====

---
id: "dm_toinf_b1"
type: "mcq"
input: "choice"
headword: "dm-toinf-reduced-clause"
skill: "form"
subtype: "basic"
prompt: "Which sentence correctly names the agent who must act, avoiding a dangling to-infinitive?"
options: ["To improve health, exercise is essential.", "To improve health, people should exercise regularly.", "To improve health, essential exercise.", "To improving health, exercise regularly."]
answer: 1
grammar_article_slug: "dangling-modifiers"
explain: "'To improve health' cần một chủ ngữ biết chủ động hành động — 'people' (con người tập thể dục), không phải 'exercise' (bản thân việc tập thể dục không 'improve health' một cách chủ động)."
why_wrong:
  '0': Chủ ngữ "exercise" không phải là tác nhân hợp lý để chủ động "cải thiện sức khỏe" trong cấu trúc này, dẫn đến lỗi bổ ngữ lơ lửng.
  '2': Đây không phải là một câu hoàn chỉnh vì thiếu động từ chính và cấu trúc chủ ngữ-vị ngữ để tạo thành một mệnh đề độc lập.
  '3': Cụm từ "To improving health" sai ngữ pháp; cần dùng dạng nguyên thể "To improve".
---

---
id: "dm_toinf_b2"
type: "boolean"
input: "boolean"
headword: "dm-toinf-reduced-clause"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'To pass the exam, hard work is needed.' mắc lỗi dangling modifier vì chủ ngữ 'hard work' không phải người 'pass the exam'."
answer: true
grammar_article_slug: "dangling-modifiers"
explain: "ĐÚNG — cụm to-infinitive 'To pass the exam' cần tác nhân là người thi, không phải 'hard work'. Sửa: 'To pass the exam, students must work hard.'"
---

---
id: "dm_toinf_i1"
type: "gap_mcq"
input: "choice"
headword: "dm-toinf-reduced-clause"
skill: "usage"
subtype: "intermediate"
prompt: "'To qualify for the scholarship, ____ a minimum IELTS score of 6.5.' Choose the ending that names the correct agent."
options: ["applicants must achieve", "a minimum score is required", "achieving is required", "the requirement includes"]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "'To qualify for the scholarship' phải gắn với người thực sự nộp hồ sơ — 'applicants' (người có thể qualify), không phải 'a minimum score' hay 'the requirement' (vật vô tri không tự qualify)."
---

---
id: "dm_toinf_i2"
type: "gap_text"
input: "text"
headword: "dm-toinf-reduced-clause"
skill: "production"
subtype: "intermediate"
prompt: "Nêu rõ tác nhân sau cụm to-infinitive để câu không bị treo: 'To reduce plastic waste effectively, ____ (write a short subject + modal + verb, e.g. about governments/consumers acting).'"
accept: ["governments must introduce stricter regulations", "consumers should reduce single-use plastic", "people need to change their habits"]
case_sensitive: false
grammar_article_slug: "dangling-modifiers"
explain: "'To reduce plastic waste effectively' cần một tác nhân cụ thể có thể hành động (governments/consumers/people), không thể để trống hoặc gắn với vật vô tri — đây là cách sửa 3 trong bài: nêu rõ tác nhân."
---

---
id: "dm_toinf_a1"
type: "boolean"
input: "boolean"
headword: "dm-toinf-reduced-clause"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Trong Writing Task 2, câu 'To address youth unemployment, more vocational training programmes should be introduced by the government.' là một câu đúng, không bị dangling, vì cụm to-infinitive rút gọn không cần nêu tác nhân khi mệnh đề chính đã bị động."
answer: false
grammar_article_slug: "dangling-modifiers"
explain: "SAI — mệnh đề chính ở dạng bị động khiến chủ ngữ ngay sau phẩy là 'more vocational training programmes', vật này không thể 'address youth unemployment' một cách chủ động dù có 'by the government' phía sau. Sửa: 'To address youth unemployment, the government should introduce more vocational training programmes.'"
---

---
id: "dm_toinf_a2"
type: "mcq"
input: "choice"
headword: "dm-toinf-reduced-clause"
skill: "contrast"
subtype: "advanced"
prompt: "Which revision best fixes the dangling to-infinitive in: 'To compete in the global job market, strong English skills are required for graduates.'?"
options: ["To compete in the global job market, graduates need strong English skills.", "To competing in the global job market, strong English skills required.", "To compete in the global job market, it is required strong English skills.", "Competing in the global job market, strong English skills are required for graduates."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "'To compete in the global job market' cần tác nhân là người cạnh tranh — 'graduates' (người thực sự đi cạnh tranh việc làm), không phải 'strong English skills' (vật vô tri, dù có 'for graduates' bổ nghĩa phía sau vẫn không sửa được lỗi vị trí chủ ngữ)."
why_wrong:
  '1': Cụm "To competing" sai ngữ pháp; sau "to" (chỉ mục đích) là động từ nguyên mẫu không "ing".
  '2': Cấu trúc "it is required strong English skills" không chuẩn ngữ pháp, và không sửa được lỗi bổ ngữ lửng (dangling modifier) vì "it" không phải là tác nhân cạnh tranh.
  '3': Cụm "Competing in the global job market" vẫn là một bổ ngữ lửng, vì "strong English skills" không phải là chủ thể thực hiện hành động "competing".
---
