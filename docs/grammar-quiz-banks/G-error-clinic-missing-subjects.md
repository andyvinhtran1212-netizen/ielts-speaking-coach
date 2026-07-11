---
kind: quiz
code: "G-error-clinic-missing-subjects"
title: "Quick Check — Missing Subjects"
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

# ===== item_key 1 · Bỏ chủ ngữ do ảnh hưởng tiếng Việt (KIỂU 1) =====

---
id: "ms_vi_b1"
type: "mcq"
input: "choice"
headword: "ms-vietnamese-influence"
skill: "form"
subtype: "basic"
prompt: "Chọn câu ĐÚNG (có đủ chủ ngữ):"
options: ["Is very important to study hard.", "It is very important to study hard.", "Very important to study hard.", "Important to study hard."]
answer: 1
grammar_article_slug: "missing-subjects"
explain: "Tiếng Anh luôn cần chủ ngữ. Câu này thiếu chủ ngữ thật nên phải thêm dummy subject 'It': 'It is very important to study hard.'"
why_wrong:
  '0': Thiếu chủ ngữ cho động từ "is" để tạo thành một câu hoàn chỉnh.
  '2': Thiếu chủ ngữ để tạo thành một câu hoàn chỉnh.
  '3': Thiếu chủ ngữ để tạo thành một câu hoàn chỉnh.
---

---
id: "ms_vi_b2"
type: "gap_mcq"
input: "choice"
headword: "ms-vietnamese-influence"
skill: "usage"
subtype: "basic"
prompt: "____ learned English for five years, but I still make small mistakes."
options: ["Learned", "I have", "Have", "Has"]
answer: 1
grammar_article_slug: "missing-subjects"
explain: "Câu dịch thẳng từ tiếng Việt ('Học tiếng Anh 5 năm rồi') dễ quên chủ ngữ. Tiếng Anh cần chủ ngữ rõ ràng: 'I have learned English for five years.'"
why_wrong:
  '0': Phương án này thiếu chủ ngữ, khiến câu không hoàn chỉnh.
  '2': Phương án này thiếu chủ ngữ. "Have" là trợ động từ, cần có chủ ngữ đi kèm để tạo thành một câu hoàn chỉnh.
  '3': Phương án này thiếu chủ ngữ. Hơn nữa, "has" chỉ dùng cho chủ ngữ ngôi thứ ba số ít (he/she/it), không phù hợp với chủ ngữ "I" được ngụ ý ở vế sau.
---

---
id: "ms_vi_i1"
type: "gap_text"
input: "text"
headword: "ms-vietnamese-influence"
skill: "production"
subtype: "intermediate"
prompt: "____ needs to invest more in education to improve literacy rates. (điền chủ ngữ hợp lý — cơ quan/nhóm chịu trách nhiệm)"
accept: ["The government", "The state"]
case_sensitive: false
grammar_article_slug: "missing-subjects"
explain: "Câu bắt đầu bằng động từ 'needs' không có chủ ngữ → phải thêm danh từ/chủ ngữ thật, ví dụ 'The government needs to invest more in education.'"
---

---
id: "ms_vi_a1"
type: "boolean"
input: "boolean"
headword: "ms-vietnamese-influence"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Have many advantages and disadvantages, so students should think carefully before choosing.' là một câu hoàn chỉnh, đúng ngữ pháp."
answer: false
grammar_article_slug: "missing-subjects"
explain: "SAI — 'Have' đứng đầu câu không có chủ ngữ. Đây là lỗi omitted_subject điển hình do dịch thẳng từ tiếng Việt. Sửa: 'This approach has many advantages and disadvantages, so students should think carefully before choosing.'"
---

# ===== item_key 2 · Mệnh đề phụ thiếu chủ ngữ riêng (KIỂU 2) =====

---
id: "ms_sub_b1"
type: "mcq"
input: "choice"
headword: "ms-subordinate-clause"
skill: "form"
subtype: "basic"
prompt: "Chọn câu ĐÚNG về việc thi cử:"
options: ["Although studied hard, didn't pass the exam.", "Although she studied hard, she didn't pass the exam.", "Although studied hard, she didn't pass the exam.", "Although she studied hard, didn't pass the exam."]
answer: 1
grammar_article_slug: "missing-subjects"
explain: "Mỗi mệnh đề trong câu phức cần chủ ngữ riêng — kể cả mệnh đề 'Although'. Đúng: 'Although she studied hard, she didn't pass the exam.'"
why_wrong:
  '0': Cả hai mệnh đề "Although studied hard" và "didn't pass the exam" đều thiếu chủ ngữ.
  '2': Mệnh đề phụ "Although studied hard" thiếu chủ ngữ.
  '3': Mệnh đề chính "didn't pass the exam" thiếu chủ ngữ.
---

---
id: "ms_sub_b2"
type: "gap_mcq"
input: "choice"
headword: "ms-subordinate-clause"
skill: "usage"
subtype: "basic"
prompt: "When ____ arrived at the airport, everyone clapped for the winning team."
options: ["arrived", "they", "was", "have"]
answer: 1
grammar_article_slug: "missing-subjects"
explain: "Mệnh đề 'When...' cần chủ ngữ riêng của nó, không thể mượn chủ ngữ của mệnh đề chính. Đúng: 'When they arrived at the airport, everyone clapped.'"
why_wrong:
  '0': Arrived là động từ, không thể đóng vai trò chủ ngữ cho mệnh đề phụ.
  '2': Was là động từ to-be dạng quá khứ, không thể làm chủ ngữ của mệnh đề.
  '3': Have là trợ động từ, không thể đóng vai trò chủ ngữ cho mệnh đề.
---

---
id: "ms_sub_i1"
type: "gap_text"
input: "text"
headword: "ms-subordinate-clause"
skill: "production"
subtype: "intermediate"
prompt: "If ____ (invest) in renewable energy, governments will see long-term environmental benefits. (điền chủ ngữ + động từ đúng cho mệnh đề 'If')"
accept: ["they invest", "countries invest", "we invest", "governments invest"]
case_sensitive: false
grammar_article_slug: "missing-subjects"
explain: "Mệnh đề điều kiện 'If' cần chủ ngữ riêng, không được bỏ trống dù mệnh đề chính đã có chủ ngữ 'governments'. Ví dụ: 'If they invest in renewable energy, governments will see long-term benefits.'"
---

---
id: "ms_sub_a1"
type: "boolean"
input: "boolean"
headword: "ms-subordinate-clause"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Because worked very hard all semester, got promoted to team leader last month.' là một câu hoàn chỉnh, đúng ngữ pháp."
answer: false
grammar_article_slug: "missing-subjects"
explain: "SAI — lỗi omitted_subject ở cả hai mệnh đề: 'Because' và mệnh đề chính đều thiếu chủ ngữ. Sửa: 'Because he worked very hard all semester, he got promoted to team leader last month.'"
---

# ===== item_key 3 · Câu dài mất chủ ngữ ở vế sau (KIỂU 3) =====

---
id: "ms_lost_b1"
type: "mcq"
input: "choice"
headword: "ms-lost-subject-second-clause"
skill: "form"
subtype: "basic"
prompt: "Chọn câu ĐÚNG về việc đi chợ mua rau:"
options: ["I went to the market and bought vegetables, were fresh.", "I went to the market and bought vegetables that were fresh.", "I went to the market and bought vegetables, was fresh.", "I went to the market and bought vegetables which was fresh."]
answer: 1
grammar_article_slug: "missing-subjects"
explain: "Vế sau dấu phẩy 'were fresh' thiếu chủ ngữ. Cần nối bằng đại từ quan hệ 'that' để làm chủ ngữ cho mệnh đề sau: '...bought vegetables that were fresh.'"
why_wrong:
  '0': Mệnh đề "were fresh" thiếu đại từ quan hệ làm chủ ngữ để nối đúng cách với danh từ "vegetables".
  '2': Động từ "was" không hòa hợp với chủ ngữ số nhiều "vegetables".
  '3': Động từ "was" không hòa hợp với chủ ngữ số nhiều "vegetables".
---

---
id: "ms_lost_b2"
type: "gap_mcq"
input: "choice"
headword: "ms-lost-subject-second-clause"
skill: "usage"
subtype: "basic"
prompt: "The company launched a new product and ____ was a great success."
options: ["(để trống)", "it", "was", "which"]
answer: 1
grammar_article_slug: "missing-subjects"
explain: "Sau liên từ 'and', vế thứ hai vẫn cần chủ ngữ riêng. Vì nhắc lại 'the new product' nên dùng đại từ 'it': '...launched a new product and it was a great success.'"
---

---
id: "ms_lost_i1"
type: "gap_text"
input: "text"
headword: "ms-lost-subject-second-clause"
skill: "production"
subtype: "intermediate"
prompt: "He studied economics at university, ____ (điền liên từ quan hệ) helped him get a good job. (điền 1 từ)"
accept: ["which"]
case_sensitive: false
grammar_article_slug: "missing-subjects"
explain: "Vế sau dấu phẩy thiếu chủ ngữ cho động từ 'helped'. Dùng 'which' để làm chủ ngữ, thay cho cả mệnh đề trước: '...at university, which helped him get a good job.'"
---

---
id: "ms_lost_a1"
type: "boolean"
input: "boolean"
headword: "ms-lost-subject-second-clause"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The teacher explained the lesson and then gave a quiz, was very difficult for most students.' là một câu hoàn chỉnh, đúng ngữ pháp."
answer: false
grammar_article_slug: "missing-subjects"
explain: "SAI — vế sau dấu phẩy 'was very difficult' không có chủ ngữ, đây là lỗi omitted_subject ở vế sau câu dài. Sửa: '...gave a quiz that was very difficult for most students.'"
---

# ===== item_key 4 · Dummy subject "it" bị bỏ sót (KIỂU 4) =====

---
id: "ms_dummy_b1"
type: "mcq"
input: "choice"
headword: "ms-dummy-it"
skill: "form"
subtype: "basic"
prompt: "Chọn câu ĐÚNG về thời tiết:"
options: ["Is raining outside.", "It is raining outside.", "Raining outside.", "There raining outside."]
answer: 1
grammar_article_slug: "missing-subjects"
explain: "Câu nói về thời tiết luôn cần dummy subject 'It' làm chủ ngữ hình thức, vì tiếng Việt không có từ tương đương nên người học hay bỏ sót. Đúng: 'It is raining outside.'"
why_wrong:
  '0': Câu thiếu chủ ngữ 'It' cần thiết cho các câu nói về thời tiết.
  '2': Câu thiếu cả chủ ngữ 'It' và động từ 'is' để tạo thành một câu hoàn chỉnh.
  '3': Chủ ngữ giả 'There' được dùng sai; 'There' chỉ sự tồn tại, trong khi 'It' dùng cho thời tiết.
---

---
id: "ms_dummy_b2"
type: "gap_mcq"
input: "choice"
headword: "ms-dummy-it"
skill: "usage"
subtype: "basic"
prompt: "____ takes a long time to become fluent in a foreign language."
options: ["(để trống)", "It", "There", "This one"]
answer: 1
grammar_article_slug: "missing-subjects"
explain: "Cấu trúc 'takes + khoảng thời gian + to V' luôn cần dummy subject 'It' đứng đầu câu: 'It takes a long time to become fluent.'"
why_wrong:
  '0': Câu tiếng Anh luôn cần có chủ ngữ, không thể để trống.
  '2': '"There" được dùng để giới thiệu sự tồn tại của cái gì đó (There is/are), không dùng trong cấu trúc "It takes + thời gian + to V".'
  '3': '"This one" dùng để chỉ một đối tượng cụ thể đã được nhắc đến hoặc chỉ rõ, không phù hợp làm chủ ngữ giả cho một hành động hay quá trình chung chung.'
---

---
id: "ms_dummy_i1"
type: "gap_text"
input: "text"
headword: "ms-dummy-it"
skill: "production"
subtype: "intermediate"
prompt: "____ (điền dummy subject) is clear that more action is needed to fight climate change. (điền 1 từ)"
accept: ["It"]
case_sensitive: false
grammar_article_slug: "missing-subjects"
explain: "Cấu trúc 'It is clear that...' cần dummy subject 'It' làm chủ ngữ hình thức, không được bỏ dù không có nghĩa cụ thể."
---

---
id: "ms_dummy_i2"
type: "boolean"
input: "boolean"
headword: "ms-dummy-it"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'I really enjoy travelling. Makes me feel relaxed.' là hai câu hoàn chỉnh, đúng ngữ pháp."
answer: false
grammar_article_slug: "missing-subjects"
explain: "SAI — câu thứ hai 'Makes me feel relaxed' thiếu dummy subject 'It', đây là lỗi omitted_subject phổ biến khi chuyển ý trong speaking. Sửa: 'I really enjoy travelling. It makes me feel relaxed.'"
---
