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
text_match_by_qid:
  dm_subj_i2: exact
  dm_clause_i2: exact
  dm_toinf_i2: exact
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
---

---
id: "dm_part_b2"
type: "boolean"
input: "boolean"
headword: "dm-participle-opening"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: Nếu người viết muốn nói một người đã hoàn tất việc viết và kiểm tra báo cáo, câu 'Having finished the report, the printer broke down.' nêu rõ người đó là chủ thể của 'Having finished'."
answer: false
grammar_article_slug: "dangling-modifiers"
explain: "SAI với ý nghĩa được yêu cầu: chủ ngữ viết ra là 'the printer', không phải người đã viết và kiểm tra báo cáo. Có thể sửa 'Having finished the report, I noticed the printer had broken down.' Không kết luận máy in không bao giờ có thể 'finish a report': trong ngữ cảnh in ấn, cụm này có thể nói về việc in xong."
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
---

---
id: "dm_part_i2"
type: "gap_text"
input: "text"
headword: "dm-participle-opening"
skill: "production"
subtype: "intermediate"
prompt: "Điền một trong bốn chủ ngữ được cho: the candidate / she / he / the applicant. 'Arriving late for the interview, ____ apologised to the panel.'"
hint: "điền cụm danh từ ngắn làm chủ ngữ — ai mới là người đến muộn?"
accept: ["the candidate", "she", "he", "the applicant"]
case_sensitive: false
grammar_article_slug: "dangling-modifiers"
explain: "Cả bốn chủ ngữ được cho đều có thể chỉ người đến muộn và xin lỗi. Bài chỉ yêu cầu chọn trong bốn cách diễn đạt này; không kết luận rằng các chủ ngữ người khác như 'the interviewee' sai ngữ pháp."
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
explain: "SAI với ý được yêu cầu: 'Being cheap' gắn với 'everyone', không nêu rằng chiếc điện thoại có giá rẻ. 'Cheap' có thể mô tả người ở một nghĩa khác, nhưng không truyền đạt ý điện thoại rẻ nên được mua. Có thể viết 'Being cheap, the phone sold quickly.'"
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
---

---
id: "dm_subj_b2"
type: "boolean"
input: "boolean"
headword: "dm-fix-change-subject"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: Sửa 'Having studied all night, the exam felt easy.' thành 'Having studied all night, I found the exam easy.' đã nêu đúng người học làm chủ ngữ mệnh đề chính và điều chỉnh vị ngữ để diễn đạt trải nghiệm của người đó."
answer: true
grammar_article_slug: "dangling-modifiers"
explain: "ĐÚNG — I là người đã học và thấy bài thi dễ. Phép sửa thay chủ ngữ và điều chỉnh vị ngữ felt easy thành found the exam easy; không phải chỉ thay the exam bằng I rồi giữ nguyên mọi từ còn lại."
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
explain: "Đáp án nêu she là người quyết tâm và đã dành nhiều tháng chuẩn bị. Nó vừa đổi chủ ngữ vừa điều chỉnh vị ngữ thành spent months preparing; không phải thay months of preparation bằng she rồi giữ followed nguyên vẹn."
---

---
id: "dm_subj_i2"
type: "gap_text"
input: "text"
headword: "dm-fix-change-subject"
skill: "production"
subtype: "intermediate"
prompt: "Dùng một trong bốn chủ ngữ the student / she / he / the writer và động từ rush ở Past Simple: 'Worried about the deadline, ____ the essay.'"
accept: ["the student rushed", "she rushed", "he rushed", "the writer rushed"]
case_sensitive: false
grammar_article_slug: "dangling-modifiers"
explain: "Người lo về hạn nộp là chủ ngữ của 'rushed': the student rushed / she rushed / he rushed / the writer rushed. Bài yêu cầu bốn chủ ngữ được cho và Past Simple, không chấm mọi cách viết tự do. 'Worried' ở câu này mô tả người viết, không phải bản thân bài luận."
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
prompt: "Choose the revision that explicitly names the city council as the frustrated agent and keeps 'Frustrated by the traffic congestion' unchanged: 'Frustrated by the traffic congestion, several new policies were proposed.'"
options: ["Frustrated by the traffic congestion, the city council proposed several new policies.", "Frustrated by the traffic congestion, congestion policies were proposed by councils.", "Frustration by the traffic congestion led to policies.", "Frustrated by the traffic congestion, it proposed several new policies."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "Đáp án A nêu rõ 'the city council' là chủ thể bực bội và đề xuất chính sách. 'It' có thể chỉ hội đồng nếu ngữ cảnh đã cung cấp tiền ngữ, nhưng bài này yêu cầu gọi tên hội đồng rõ ràng, nên không chọn phương án dùng 'it'."
---

# ===== item_key 3 · Sửa bằng cách biến thành mệnh đề phụ đầy đủ (thêm chủ ngữ cho cụm) =====

---
id: "dm_clause_b1"
type: "mcq"
input: "choice"
headword: "dm-fix-full-clause"
skill: "form"
subtype: "basic"
prompt: "Người viết muốn nói chính mình đã hoàn tất việc viết và kiểm tra báo cáo. Which revision makes that person the expressed subject of a full opening clause while retaining the printer as the main-clause subject? 'After finishing the report, the printer broke down.'"
options: ["After I finished the report, the printer broke down.", "After finished the report, the printer broke down.", "The printer, after finishing the report, broke down.", "After finishing a report, printers break down."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "Chọn 'After I finished the report, the printer broke down': I là người viết/kiểm tra báo cáo được nêu ở đề, finished là động từ hữu hạn của mệnh đề phụ. Không kết luận máy in không thể finish a report trong ngữ cảnh in ấn; nhiệm vụ ở đây là viết rõ tác nhân người và giữ chủ ngữ chính the printer."
---

---
id: "dm_clause_b2"
type: "boolean"
input: "boolean"
headword: "dm-fix-full-clause"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: Trong 'Before you sign the contract, the terms should be read carefully', mệnh đề phụ 'Before you sign the contract' có chủ ngữ riêng you và động từ hữu hạn sign."
answer: true
grammar_article_slug: "dangling-modifiers"
explain: "ĐÚNG — mệnh đề phụ viết rõ 'you' là người ký; mệnh đề chính bị động có chủ ngữ 'the terms'. Đây là bài nhận diện cấu trúc đã viết rõ tác nhân, không phán rằng mọi câu 'Before signing...' đi với bị động đều sai trong mọi ngữ cảnh."
---

---
id: "dm_clause_i1"
type: "gap_mcq"
input: "choice"
headword: "dm-fix-full-clause"
skill: "usage"
subtype: "intermediate"
prompt: "Original: 'While reviewing the applications, several errors were found.' Which revision explicitly names the committee as the reviewing agent in a full subordinate clause, while retaining several errors as the main-clause subject?"
options: ["While the committee reviewed the applications, several errors were found.", "While reviewed the applications, several errors were found.", "While review the applications, errors found.", "While reviewing applications, error was found by committee."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "Chọn 'While the committee reviewed the applications, several errors were found': mệnh đề phụ có chủ ngữ the committee và động từ hữu hạn reviewed. While dùng với Past Simple được trong cách kể này. Câu gốc có thể gợi tác nhân ngầm trong ngữ cảnh; bài này yêu cầu viết rõ tác nhân trong một mệnh đề phụ đầy đủ."
---

---
id: "dm_clause_i2"
type: "gap_text"
input: "text"
headword: "dm-fix-full-clause"
skill: "production"
subtype: "intermediate"
prompt: "Kể về một giai đoạn quá khứ đã kết thúc: dùng chủ ngữ she và động từ live ở Past Simple hoặc Past Perfect Simple để hoàn thành mệnh đề có chủ ngữ riêng: 'After ____ abroad for years, the language barrier was no longer a problem.'"
accept: ["she lived", "she had lived"]
case_sensitive: false
grammar_article_slug: "dangling-modifiers"
explain: "Nhận 'she lived' và 'she had lived': 'After' đã chỉ thứ tự quá khứ, còn Past Perfect nhấn mạnh thời gian sống trước mốc 'was'. 'She has lived' nhìn từ hiện tại và không đáp ứng khung kể quá khứ đã kết thúc được yêu cầu. Chủ ngữ riêng 'she' xác định người sống ở nước ngoài."
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
prompt: "Người hoàn tất kỳ thực tập là she. Which revision names her as the expressed subject of a full subordinate clause while keeping a permanent contract as the main-clause subject? 'Upon completing the internship, a permanent contract was offered.'"
options: ["Upon completing the internship, several interns were offered a permanent contract.", "After she completed the internship, a permanent contract was offered.", "Upon complete the internship, a contract offered.", "Completing the internship, offered a permanent contract."]
answer: 1
grammar_article_slug: "dangling-modifiers"
explain: "Chọn 'After she completed the internship, a permanent contract was offered': she là chủ ngữ riêng của mệnh đề phụ, a permanent contract vẫn là chủ ngữ chính. Phương án đổi chủ ngữ chính sang interns có thể là một cách viết khác nhưng không đáp ứng nhiệm vụ này; không phán mọi generic passive gốc luôn sai."
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
explain: "Đáp án 'people should exercise regularly' viết rõ người thực hiện hành động trong mệnh đề chính. 'To improve health, exercise is essential' có thể diễn đạt mục đích hợp lý trong ngữ cảnh khác; ở đây bài yêu cầu gọi rõ tác nhân phải hành động, không chỉ nêu sự cần thiết của việc tập thể dục."
---

---
id: "dm_toinf_b2"
type: "boolean"
input: "boolean"
headword: "dm-toinf-reduced-clause"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: Trong 'To pass the exam, students must work hard', chủ ngữ students nêu rõ người cần làm việc chăm chỉ để đạt mục đích pass the exam."
answer: true
grammar_article_slug: "dangling-modifiers"
explain: "ĐÚNG — 'students' nêu rõ tác nhân của việc học và mục đích thi đỗ. Bài nhận diện cách diễn đạt tác nhân rõ ràng này, không tuyên bố mọi câu 'To pass the exam, hard work is needed' đều sai ngữ pháp."
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
prompt: "Ghép một trong ba bộ từ cho sẵn thành mệnh đề chính, giữ đúng modal: governments / must / regulate; consumers / should / recycle; everyone / must / help. 'To reduce plastic waste effectively, ____.'"
hint: "gõ chủ ngữ + động từ khiếm khuyết + động từ chính"
accept: ["governments must regulate", "consumers should recycle", "everyone must help"]
case_sensitive: false
grammar_article_slug: "dangling-modifiers"
explain: "Ba mệnh đề được yêu cầu là 'governments must regulate', 'consumers should recycle' và 'everyone must help'. Chúng nêu rõ chủ thể hành động để giảm rác nhựa. Đây là bài ghép ba bộ từ đã cho; các đề xuất khác có thể đúng về ngữ pháp/ý nghĩa nhưng nằm ngoài yêu cầu này."
---

---
id: "dm_toinf_a1"
type: "boolean"
input: "boolean"
headword: "dm-toinf-reduced-clause"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: Chỉ cần mệnh đề chính ở thể bị động thì mọi câu mở đầu bằng To + V chỉ mục đích đều luôn có tác nhân rõ ràng, không cần xét ý nghĩa hay ngữ cảnh."
answer: false
grammar_article_slug: "dangling-modifiers"
explain: "SAI — thể bị động tự nó không bảo đảm người đọc xác định được tác nhân của mục đích. Cần xét hành động, tác nhân được viết ra hoặc ngầm hiểu và ngữ cảnh; có thể viết chủ động hoặc dùng by + tác nhân để làm rõ khi phù hợp. Không suy ra một câu bị động cụ thể như 'To address youth unemployment, more vocational training programmes should be introduced by the government' luôn sai."
---

---
id: "dm_toinf_a2"
type: "mcq"
input: "choice"
headword: "dm-toinf-reduced-clause"
skill: "contrast"
subtype: "advanced"
prompt: "Which revision explicitly names graduates as the subject who must compete in the global job market? 'To compete in the global job market, strong English skills are required for graduates.'"
options: ["To compete in the global job market, graduates need strong English skills.", "To competing in the global job market, strong English skills required.", "To compete in the global job market, it is required strong English skills.", "Competing in the global job market, strong English skills are required for graduates."]
answer: 0
grammar_article_slug: "dangling-modifiers"
explain: "Đáp án A viết rõ 'graduates' là chủ ngữ của 'need' và người có mục đích cạnh tranh việc làm. Câu gốc có thể cho phép hiểu tác nhân qua 'for graduates' tùy ngữ cảnh; bài này yêu cầu phiên bản nêu tác nhân trực tiếp, không cấm mọi câu bị động chỉ mục đích."
---
