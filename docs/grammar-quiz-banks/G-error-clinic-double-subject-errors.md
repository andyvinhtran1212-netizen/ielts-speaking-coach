---
kind: quiz
code: "G-error-clinic-double-subject-errors"
title: "Quick Check — Double Subject Errors"
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

# ===== item_key 1 · Danh từ + he/she/it/they (lỗi cơ bản nhất) =====

---
id: "ds_noun_b1"
type: "mcq"
input: "choice"
headword: "ds-noun-pronoun"
skill: "form"
subtype: "basic"
prompt: "Chọn câu ĐÚNG (không lặp chủ ngữ):"
options: ["My mother is a teacher.", "My mother she is a teacher.", "My mother, she is a teacher.", "My mother is she a teacher."]
answer: 0
grammar_article_slug: "double-subject-errors"
explain: "Tiếng Anh chỉ dùng MỘT chủ ngữ cho mỗi mệnh đề: hoặc danh từ (My mother), hoặc đại từ (She) — không dùng cả hai."
---

---
id: "ds_noun_b2"
type: "mcq"
input: "choice"
headword: "ds-noun-pronoun"
skill: "form"
subtype: "basic"
prompt: "Chọn câu ĐÚNG về người giáo viên:"
options: ["The teacher he explained everything clearly.", "The teacher explained everything clearly.", "He the teacher explained everything clearly.", "The teacher, he, explained everything clearly."]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "'The teacher' đã là chủ ngữ đầy đủ → không thêm 'he' lặp lại trước động từ."
why_wrong:
  '0': '''The teacher'' đã là chủ ngữ, không cần thêm đại từ ''he'' lặp lại ngay sau đó.'
  '2': Cấu trúc 'He the teacher' không đúng ngữ pháp để tạo thành một chủ ngữ hợp lệ.
  '3': '''The teacher'' đã là chủ ngữ hoàn chỉnh, việc thêm đại từ ''he'' giữa hai dấu phẩy như vậy là dư thừa và không chuẩn ngữ pháp.'
---

---
id: "ds_noun_b3"
type: "gap_mcq"
input: "choice"
headword: "ds-noun-pronoun"
skill: "usage"
subtype: "basic"
prompt: "Technology ____ changed our lives a lot."
options: ["it has", "has", "it is has", "they have"]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "Chủ ngữ 'Technology' đã đủ, chỉ cần thêm động từ 'has changed' — không chèn 'it' vào giữa."
why_wrong:
  '0': Chủ ngữ 'Technology' đã đủ, không cần thêm đại từ 'it' làm chủ ngữ nữa.
  '2': Cấu trúc 'it is has' sai ngữ pháp vì thừa chủ ngữ 'it' và kết hợp sai trợ động từ 'is' với 'has'.
  '3': Đại từ 'they' và trợ động từ 'have' dùng cho số nhiều, trong khi 'Technology' là chủ ngữ số ít.
---

---
id: "ds_noun_i1"
type: "gap_mcq"
input: "choice"
headword: "ds-noun-pronoun"
skill: "usage"
subtype: "intermediate"
prompt: "The students ____ very excited about the field trip to the museum."
options: ["they were", "were", "they are", "was"]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "'The students' là chủ ngữ số nhiều đã rõ ràng → dùng thẳng 'were', không lặp thêm 'they'."
why_wrong:
  '0': Lặp chủ ngữ "they" không cần thiết vì "The students" đã là chủ ngữ của câu.
  '2': Lặp chủ ngữ "they" không cần thiết và thì "are" (hiện tại) không phù hợp với thì quá khứ của câu.
  '3': Động từ "was" chia ở dạng số ít, không khớp với chủ ngữ số nhiều "The students".
---

---
id: "ds_noun_i2"
type: "gap_text"
input: "text"
headword: "ds-noun-pronoun"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại câu sau cho ĐÚNG bằng cách bỏ đại từ lặp: 'My city it is quite crowded.' → My city ____ quite crowded."
accept: ["is"]
case_sensitive: false
grammar_article_slug: "double-subject-errors"
explain: "Bỏ đại từ 'it' lặp lại, giữ danh từ 'My city' làm chủ ngữ: 'My city is quite crowded.'"
---

---
id: "ds_noun_a1"
type: "boolean"
input: "boolean"
headword: "ds-noun-pronoun"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The rapid increase in urbanisation, it has led to serious environmental problems.'"
answer: false
grammar_article_slug: "double-subject-errors"
explain: "SAI (double subject) — chủ ngữ dài 'The rapid increase in urbanisation' không cần thêm 'it'. Sửa: 'The rapid increase in urbanisation has led to serious environmental problems.'"
---

# ===== item_key 2 · Danh từ tập thể + they (government/family/team) =====

---
id: "ds_coll_b1"
type: "mcq"
input: "choice"
headword: "ds-collective-they"
skill: "form"
subtype: "basic"
prompt: "Chọn câu ĐÚNG về gia đình bạn:"
options: ["My family they are very supportive.", "My family is very supportive.", "They my family are very supportive.", "My family, they, are very supportive."]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "'My family' (danh từ tập thể) đã là chủ ngữ — không thêm 'they' lặp lại phía sau."
why_wrong:
  '0': My family đã là chủ ngữ, không được thêm đại từ 'they' lặp lại phía sau.
  '2': Cấu trúc 'They my family' là sai ngữ pháp, không thể dùng 'They' và 'my family' cùng làm chủ ngữ như vậy.
  '3': Dù có dấu phẩy, 'they' vẫn là đại từ lặp lại chủ ngữ 'My family', làm cho câu bị thừa và không chuẩn.
---

---
id: "ds_coll_b2"
type: "mcq"
input: "choice"
headword: "ds-collective-they"
skill: "form"
subtype: "basic"
prompt: "Chọn câu ĐÚNG về đội bóng:"
options: ["The team they won the match.", "The team won the match.", "Won the team the match.", "The team, they won, the match."]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "'The team' là chủ ngữ tập thể — bỏ 'they' để tránh lặp chủ ngữ."
why_wrong:
  '0': Lặp chủ ngữ vì 'The team' đã là chủ ngữ, không cần thêm 'they'.
  '2': 'Sai cấu trúc câu: động từ (''Won'') không đứng trước chủ ngữ trong câu khẳng định.'
  '3': Lặp chủ ngữ và cấu trúc câu bị ngắt quãng, không đúng ngữ pháp.
---

---
id: "ds_coll_i1"
type: "gap_mcq"
input: "choice"
headword: "ds-collective-they"
skill: "usage"
subtype: "intermediate"
prompt: "The government ____ invest more in public healthcare next year."
options: ["they should", "should", "it should they", "they will should"]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "'The government' (danh từ tập thể, số ít về ngữ pháp) không cần thêm đại từ 'they' phía sau."
why_wrong:
  '0': Thừa chủ ngữ 'they' vì 'The government' đã đảm nhiệm vai trò chủ ngữ của câu.
  '2': Cụm từ 'it should they' không có cấu trúc ngữ pháp hợp lệ, với 'it' là chủ ngữ thừa và 'they' đặt sai vị trí.
  '3': Thừa chủ ngữ 'they' và không thể dùng hai trợ động từ khiếm khuyết (modal verbs) 'will' và 'should' liền kề nhau.
---

---
id: "ds_coll_i2"
type: "gap_text"
input: "text"
headword: "ds-collective-they"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại cho ĐÚNG: 'The government they are responsible for this policy.' → The government ____ responsible for this policy."
accept: ["are", "is"]
case_sensitive: false
grammar_article_slug: "double-subject-errors"
explain: "Bỏ 'they' lặp lại; danh từ tập thể 'the government' có thể đi với 'are' (nhấn mạnh các thành viên) hoặc 'is' (nhấn mạnh tổ chức) tuỳ văn phong, miễn không lặp chủ ngữ."
---

---
id: "ds_coll_a1"
type: "boolean"
input: "boolean"
headword: "ds-collective-they"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Many companies today, they invest heavily in employee training programmes.'"
answer: false
grammar_article_slug: "double-subject-errors"
explain: "SAI (double subject) — 'Many companies today' đã đủ làm chủ ngữ. Sửa: 'Many companies today invest heavily in employee training programmes.'"
---

---
id: "ds_coll_i3"
type: "boolean"
input: "boolean"
headword: "ds-collective-they"
skill: "contrast"
subtype: "intermediate"
prompt: "Đúng hay Sai: câu 'My family, who live in the countryside, are very supportive.' mắc lỗi double subject giống 'My family they are very supportive.'"
answer: false
grammar_article_slug: "double-subject-errors"
explain: "SAI (nhận định) — 'who live in the countryside' là mệnh đề quan hệ bổ nghĩa cho 'My family', không phải chủ ngữ thứ hai, nên đây KHÔNG phải lỗi double subject."
---

# ===== item_key 3 · Appositive (danh từ bổ nghĩa) vs Double Subject (đại từ lặp) =====

---
id: "ds_appo_b1"
type: "mcq"
input: "choice"
headword: "ds-appositive-vs-double"
skill: "contrast"
subtype: "basic"
prompt: "Chọn câu ĐÚNG (appositive, không phải double subject):"
options: ["My father, he works very hard.", "My father, a retired engineer, works very hard.", "My father he, works very hard.", "He my father works very hard."]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "'a retired engineer' là cụm danh từ bổ nghĩa (appositive) cho 'my father' — hợp lệ. Còn 'he' sau dấu phẩy mới là double subject (sai)."
why_wrong:
  '0': 'Lỗi chủ ngữ kép: "he" là đại từ lặp lại chủ ngữ "My father" một cách không cần thiết sau dấu phẩy.'
  '2': Cấu trúc không chuẩn ngữ pháp, cố gắng kết hợp chủ ngữ và đại từ lặp lại một cách sai lầm trước dấu phẩy.
  '3': Sai thứ tự và cấu trúc ngữ pháp; không thể đặt chủ ngữ "my father" ngay sau đại từ "he" mà không có dấu phẩy hoặc khi "he" đã là chủ ngữ chính.
---

---
id: "ds_appo_b2"
type: "boolean"
input: "boolean"
headword: "ds-appositive-vs-double"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'My father, he works very hard.' là câu đúng ngữ pháp."
answer: false
grammar_article_slug: "double-subject-errors"
explain: "SAI — 'he' là đại từ lặp lại chủ ngữ 'My father' → lỗi double subject. Sửa: 'My father works very hard.' hoặc 'He works very hard.'"
---

---
id: "ds_appo_i1"
type: "gap_mcq"
input: "choice"
headword: "ds-appositive-vs-double"
skill: "usage"
subtype: "intermediate"
prompt: "Phân biệt: '____' là cấu trúc appositive HỢP LỆ để thêm thông tin mà không tạo lỗi double subject."
options: ["My sister, she studies medicine, ...", "My sister, a medical student, ...", "My sister she, studies medicine, ...", "She, my sister, studies medicine, she ..."]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "Appositive dùng CỤM DANH TỪ (a medical student) để bổ nghĩa, không dùng đại từ (she) lặp lại chủ ngữ."
why_wrong:
  '0': Phương án này dùng đại từ "she" lặp lại chủ ngữ "My sister" ngay sau dấu phẩy, tạo lỗi double subject thay vì cấu trúc appositive (cụm danh từ).
  '2': Cụm "My sister she" là lỗi lặp chủ ngữ (double subject) trực tiếp mà không phải cấu trúc appositive dùng cụm danh từ.
  '3': Phương án này lặp lại chủ ngữ "She" bằng đại từ "she" ở cuối câu, tạo lỗi double subject.
---

---
id: "ds_appo_i2"
type: "gap_text"
input: "text"
headword: "ds-appositive-vs-double"
skill: "production"
subtype: "intermediate"
prompt: "Sửa lỗi double subject bằng cách đổi sang mệnh đề quan hệ: 'My best friend, he lives in Hanoi, loves photography.' → My best friend, ____ lives in Hanoi, loves photography."
accept: ["who"]
case_sensitive: false
grammar_article_slug: "double-subject-errors"
explain: "Thay đại từ lặp 'he' bằng đại từ quan hệ 'who' để tạo mệnh đề quan hệ hợp lệ: 'My best friend, who lives in Hanoi, loves photography.'"
---

---
id: "ds_appo_a1"
type: "boolean"
input: "boolean"
headword: "ds-appositive-vs-double"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The main problem, it is the lack of funding, affects everything.' là câu đúng ngữ pháp."
answer: false
grammar_article_slug: "double-subject-errors"
explain: "SAI (double subject) — 'it' lặp lại 'The main problem'. Sửa bằng mệnh đề quan hệ: 'The main problem, which is a lack of funding, affects everything.'"
---

# ===== item_key 4 · Câu phức có thông tin bổ sung (relative clause thay vì lặp đại từ) =====

---
id: "ds_complex_b1"
type: "mcq"
input: "choice"
headword: "ds-complex-info"
skill: "form"
subtype: "basic"
prompt: "Chọn câu ĐÚNG về vấn đề cần giải quyết:"
options: ["This issue it requires immediate attention.", "This issue requires immediate attention.", "It this issue requires immediate attention.", "This issue, it, requires, immediate attention."]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "'This issue' đã là chủ ngữ rõ ràng — không thêm 'it' lặp lại trước động từ 'requires'."
why_wrong:
  '0': Chủ ngữ "This issue" đã đầy đủ, không cần thêm đại từ "it" lặp lại.
  '2': Cấu trúc "It this issue" không đúng ngữ pháp để tạo thành một chủ ngữ duy nhất.
  '3': Dấu phẩy được sử dụng sai vị trí, tách chủ ngữ, đại từ lặp "it", và động từ khỏi các thành phần câu chính.
---

---
id: "ds_complex_i1"
type: "gap_mcq"
input: "choice"
headword: "ds-complex-info"
skill: "usage"
subtype: "intermediate"
prompt: "As for my sister, ____ studying medicine in Ho Chi Minh City."
options: ["my sister is", "she is", "she she is", "is she"]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "'As for my sister' giới thiệu chủ đề trước, sau đó mệnh đề chính dùng đại từ 'she' — đây KHÔNG phải double subject vì 'as for X' và 'X' không nằm trong cùng một mệnh đề chủ ngữ-động từ."
why_wrong:
  '0': Phương án này lặp lại chủ ngữ "my sister" một cách không cần thiết sau khi đã giới thiệu chủ đề bằng "As for my sister," gây thừa thãi.
  '2': Phương án này lặp lại đại từ nhân xưng "she" hai lần làm cho câu bị sai ngữ pháp.
  '3': Phương án này đảo ngữ "is she" là cấu trúc của câu hỏi, không phù hợp với một câu trần thuật.
---

---
id: "ds_complex_i2"
type: "gap_text"
input: "text"
headword: "ds-complex-info"
skill: "production"
subtype: "intermediate"
prompt: "Gộp 2 mệnh đề double-subject thành 1 câu đúng bằng mệnh đề quan hệ: 'The teacher, she explained the grammar rules clearly, she also gave us exercises.' → The teacher, ____ explained the grammar rules clearly, also gave us exercises."
accept: ["who"]
case_sensitive: false
grammar_article_slug: "double-subject-errors"
explain: "Dùng 'who' làm đại từ quan hệ thay cho 'she' lặp lại, gộp thành một câu mạch lạc: 'The teacher, who explained the grammar rules clearly, also gave us exercises.'"
---

---
id: "ds_complex_a1"
type: "boolean"
input: "boolean"
headword: "ds-complex-info"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'People in big cities, they often face high costs, they also deal with pollution.' là câu đúng ngữ pháp và nên giữ nguyên khi viết Writing Task 2."
answer: false
grammar_article_slug: "double-subject-errors"
explain: "SAI — câu này mắc lỗi double subject 2 lần ('they' lặp 'People in big cities' và lặp lại lần nữa). Sửa gọn: 'People in big cities often face high costs and pollution.'"
---

---
id: "ds_complex_b2"
type: "mcq"
input: "choice"
headword: "ds-complex-info"
skill: "contrast"
subtype: "basic"
prompt: "Cách sửa TỐT NHẤT cho lỗi double subject trong câu Speaking: 'My hometown, it is a small city near the coast.' khi giám khảo chưa biết bạn đang nói về đâu là:"
options: ["Giữ nguyên câu, chỉ nói chậm hơn.", "My hometown is a small city near the coast.", "It, my hometown, is a small city near the coast.", "My hometown it's a small city near the coast."]
answer: 1
grammar_article_slug: "double-subject-errors"
explain: "Vì giám khảo chưa biết ngữ cảnh, nên GIỮ danh từ 'My hometown' làm chủ ngữ và bỏ đại từ lặp 'it': 'My hometown is a small city near the coast.'"
why_wrong:
  '0': Giữ nguyên câu không sửa được lỗi ngữ pháp double subject.
  '2': Cách này làm thay đổi chủ ngữ chính thành 'It', không phải 'My hometown', và nghe không tự nhiên khi giới thiệu chủ đề mới.
  '3': Câu này vẫn mắc lỗi double subject tương tự như câu gốc, chỉ khác ở việc viết tắt.
---
