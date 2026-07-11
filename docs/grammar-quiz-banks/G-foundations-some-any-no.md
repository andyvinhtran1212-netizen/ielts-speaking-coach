---
kind: quiz
code: "G-foundations-some-any-no"
title: "Quick Check — Some / Any / No"
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

# ===== item_key 1 · Some — khẳng định + ngoại lệ mời mọc/đề nghị =====

---
id: "san_some_b1"
type: "mcq"
input: "choice"
headword: "san-some-affirmative"
skill: "form"
subtype: "basic"
prompt: "There are ____ empty seats near the back of the exam hall."
options: ["some", "any", "no", "a"]
answer: 0
grammar_article_slug: "some-any-no"
explain: "Câu khẳng định với danh từ số nhiều đếm được → dùng 'some'."
why_wrong:
  '1': Từ 'any' thường được dùng trong câu phủ định hoặc câu hỏi, không dùng trong câu khẳng định thông thường.
  '2': Từ 'no' mang nghĩa phủ định ('không có cái nào'), trong khi câu đang ở dạng khẳng định và cần một từ chỉ số lượng tồn tại.
  '3': Mạo từ 'a' chỉ dùng với danh từ số ít đếm được, nhưng 'seats' là danh từ số nhiều.
---

---
id: "san_some_b2"
type: "boolean"
input: "boolean"
headword: "san-some-affirmative"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'I have any spare time this weekend to help you move house.'"
answer: false
grammar_article_slug: "some-any-no"
explain: "SAI — câu khẳng định thông thường (không mang nghĩa 'bất kỳ') phải dùng 'some': 'I have some spare time this weekend...'"
---

---
id: "san_some_i1"
type: "gap_mcq"
input: "choice"
headword: "san-some-affirmative"
skill: "usage"
subtype: "intermediate"
prompt: "Waiter: 'Would you like ____ dessert before the bill?' — this is an offer, not a real question about availability."
options: ["some", "any", "no", "a few of"]
answer: 0
grammar_article_slug: "some-any-no"
explain: "Khi mời mọc/đề nghị, dùng 'some' dù câu ở dạng câu hỏi, vì người nói kỳ vọng câu trả lời 'yes'."
why_wrong:
  '1': any thường dùng trong câu hỏi chung chung hoặc câu phủ định, không phù hợp cho lời mời/đề nghị kỳ vọng câu trả lời "yes".
  '2': no là từ phủ định chỉ sự vắng mặt hoặc không có, không được dùng để đề nghị một thứ gì đó trong lời mời.
  '3': a few of chỉ dùng với danh từ đếm được số nhiều, trong khi dessert trong ngữ cảnh này thường là danh từ không đếm được hoặc số ít.
---

---
id: "san_some_i2"
type: "gap_text"
input: "text"
headword: "san-some-affirmative"
skill: "production"
subtype: "intermediate"
prompt: "Could you lend me ____ (word for a polite request, expecting agreement) money until payday?"
accept: ["some"]
case_sensitive: false
grammar_article_slug: "some-any-no"
explain: "Yêu cầu lịch sự, kỳ vọng đồng ý → dùng 'some' dù là câu hỏi."
---

---
id: "san_some_a1"
type: "boolean"
input: "boolean"
headword: "san-some-affirmative"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Do you have any milk?' và 'Would you like some milk?' đều là câu hỏi thật, hỏi xem người nghe có sữa hay không."
answer: false
grammar_article_slug: "some-any-no"
explain: "SAI — 'Do you have any milk?' là câu hỏi thật (không biết câu trả lời), còn 'Would you like some milk?' là lời MỜI, giả định là có và kỳ vọng người nghe đồng ý."
---

# ===== item_key 2 · Any — phủ định/câu hỏi thật + ngoại lệ 'bất kỳ' =====

---
id: "san_any_b1"
type: "mcq"
input: "choice"
headword: "san-any-negative-question"
skill: "form"
subtype: "basic"
prompt: "She didn't bring ____ documents to the visa interview, which caused a delay."
options: ["some", "any", "no", "a"]
answer: 1
grammar_article_slug: "some-any-no"
explain: "Câu phủ định (didn't) → dùng 'any', không dùng 'some'."
why_wrong:
  '0': '''Some'' không được dùng trong câu phủ định.'
  '2': '''No'' không thể đi cùng với ''didn''t'' vì sẽ tạo thành phủ định kép.'
  '3': '''A'' chỉ dùng với danh từ đếm được số ít, trong khi ''documents'' là danh từ số nhiều.'
---

---
id: "san_any_b2"
type: "boolean"
input: "boolean"
headword: "san-any-negative-question"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Do you have some experience working in customer service?' là câu hỏi tự nhiên, đúng ngữ pháp khi hỏi thật (không biết câu trả lời)."
answer: false
grammar_article_slug: "some-any-no"
explain: "SAI — câu hỏi thật (không biết trước câu trả lời) phải dùng 'any': 'Do you have any experience working in customer service?'"
---

---
id: "san_any_i1"
type: "gap_mcq"
input: "choice"
headword: "san-any-negative-question"
skill: "usage"
subtype: "intermediate"
prompt: "Is there ____ flexibility in the project deadline, or is it fixed?"
options: ["some", "any", "no", "a little of"]
answer: 1
grammar_article_slug: "some-any-no"
explain: "Câu hỏi thật (is there...?) → dùng 'any'."
why_wrong:
  '0': '''Some'' thường dùng trong câu khẳng định hoặc câu hỏi mang tính đề nghị/mong đợi câu trả lời khẳng định, không phải câu hỏi chung chung.'
  '2': '''No'' thường dùng trong câu phủ định hoặc câu hỏi tu từ, không phù hợp để hỏi về sự tồn tại một cách trung lập.'
  '3': 'Cụm ''a little of'' cần một từ hạn định hoặc đại từ theo sau ''of'' (ví dụ: a little of *it*), hoặc chỉ dùng ''a little'' trực tiếp với danh từ không đếm được.'
---

---
id: "san_any_i2"
type: "gap_text"
input: "text"
headword: "san-any-negative-question"
skill: "production"
subtype: "intermediate"
prompt: "You can choose ____ (word meaning 'whichever, it doesn't matter which') topic you like for your presentation — the choice is entirely yours."
accept: ["any"]
case_sensitive: false
grammar_article_slug: "some-any-no"
explain: "'any' trong câu KHẲNG ĐỊNH mang nghĩa 'bất kỳ ... nào' (whichever) — ngoại lệ quan trọng của quy tắc any-chỉ-dùng-phủ-định/câu-hỏi."
---

---
id: "san_any_a1"
type: "mcq"
input: "choice"
headword: "san-any-negative-question"
skill: "contrast"
subtype: "advanced"
prompt: "Which sentence uses 'any' correctly with the meaning 'no matter which one'?"
options: ["I don't have any strong opinion on this topic.", "Any candidate who scores band 7 or above qualifies for the scholarship.", "Do you have any questions about the syllabus?", "There isn't any parking space left near the office."]
answer: 1
grammar_article_slug: "some-any-no"
explain: "'Any candidate who scores band 7...' là câu KHẲNG ĐỊNH với 'any' mang nghĩa 'bất kỳ ứng viên nào' — khác với 3 câu còn lại vốn dùng any thông thường trong phủ định/câu hỏi."
why_wrong:
  '0': '''Any'' trong câu này được dùng trong câu phủ định để chỉ số lượng bằng không, không phải nghĩa ''bất kỳ cái nào'' với ý ''không phân biệt cái nào''.'
  '2': '''Any'' trong câu này được dùng trong câu hỏi để hỏi về sự tồn tại của một lượng nào đó, không phải nghĩa ''bất kỳ cái nào'' với ý ''không phân biệt cái nào''.'
  '3': '''Any'' trong câu này được dùng trong câu phủ định để chỉ số lượng bằng không, không phải nghĩa ''bất kỳ cái nào'' với ý ''không phân biệt cái nào''.'
---

# ===== item_key 3 · No — phủ định dứt khoát (thay 'not any', tránh double negative) =====

---
id: "san_no_b1"
type: "mcq"
input: "choice"
headword: "san-no-definite-negative"
skill: "form"
subtype: "basic"
prompt: "There is ____ direct flight from our city to that destination, so we need to transit."
options: ["some", "any", "no", "not"]
answer: 2
grammar_article_slug: "some-any-no"
explain: "'no' đứng trước danh từ, đi với động từ ở dạng KHẲNG ĐỊNH (is), thay cho 'not any': 'There is no direct flight...'"
why_wrong:
  '0': Some thường được dùng trong câu khẳng định và diễn tả sự tồn tại, mâu thuẫn với vế sau "so we need to transit" gợi ý sự không tồn tại.
  '1': Any thường dùng trong câu phủ định hoặc câu hỏi, không đứng một mình trong câu khẳng định để mang nghĩa phủ định.
  '3': Not cần một mạo từ (như "a" hoặc "an") đi kèm với danh từ số ít đếm được để tạo thành câu phủ định đúng ngữ pháp.
---

---
id: "san_no_b2"
type: "boolean"
input: "boolean"
headword: "san-no-definite-negative"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'I don't have no time to finish the report today.'"
answer: false
grammar_article_slug: "some-any-no"
explain: "SAI — đây là lỗi double negative (phủ định kép); 'don't' đã là phủ định nên không được thêm 'no': 'I don't have any time...' hoặc 'I have no time...'"
---

---
id: "san_no_i1"
type: "gap_mcq"
input: "choice"
headword: "san-no-definite-negative"
skill: "usage"
subtype: "intermediate"
prompt: "The committee found ____ evidence to support the applicant's claim, so the appeal was rejected."
options: ["some", "any", "no", "not any"]
answer: 2
grammar_article_slug: "some-any-no"
explain: "'no' + danh từ + động từ khẳng định (found) diễn đạt phủ định mạnh và dứt khoát hơn 'didn't find any'."
why_wrong:
  '0': '''Some'' thường dùng trong câu khẳng định, nhưng nếu dùng ở đây sẽ tạo ra mâu thuẫn logic với vế sau ''the appeal was rejected'' (đơn bị từ chối).'
  '1': '''Any'' thường dùng trong câu phủ định hoặc câu hỏi, không đứng trực tiếp sau động từ khẳng định ''found'' để diễn đạt ý phủ định.'
  '3': Cụm 'not any' không thể đứng trực tiếp trước danh từ 'evidence' trong cấu trúc câu khẳng định 'found', mà cần động từ phủ định như 'did not find any'.
---

---
id: "san_no_i2"
type: "gap_text"
input: "text"
headword: "san-no-definite-negative"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại câu dùng 'no' thay vì 'not any': 'We don't have any choice but to reschedule.' → We have ____ choice but to reschedule."
accept: ["no"]
case_sensitive: false
grammar_article_slug: "some-any-no"
explain: "'no' đứng trước danh từ với động từ khẳng định thay thế 'not any' với động từ phủ định: 'We have no choice...'"
---

---
id: "san_no_a1"
type: "boolean"
input: "boolean"
headword: "san-no-definite-negative"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She is no happy about the change in schedule' là cách dùng đúng của 'no' để phủ định tính từ."
answer: false
grammar_article_slug: "some-any-no"
explain: "SAI — 'no' chỉ dùng trước DANH TỪ, không dùng trước tính từ đứng một mình: 'She is not happy about the change in schedule.'"
---

# ===== item_key 4 · Hợp chất some-/any-/no- (someone, anything, nowhere...) =====

---
id: "san_comp_b1"
type: "mcq"
input: "choice"
headword: "san-compounds"
skill: "form"
subtype: "basic"
prompt: "____ left a message for you while you were out at the meeting."
options: ["Someone", "Anyone", "No one", "Something"]
answer: 0
grammar_article_slug: "some-any-no"
explain: "Câu khẳng định, nói về người → 'someone'."
why_wrong:
  '1': Phương án này sai vì 'anyone' thường dùng trong câu phủ định, câu hỏi hoặc câu điều kiện, không dùng trong câu khẳng định thông thường để chỉ người.
  '2': Phương án này sai vì 'no one' mang nghĩa phủ định ('không một ai') và sẽ làm thay đổi hoàn toàn ý nghĩa của câu thành không có ai để lại lời nhắn.
  '3': Phương án này sai vì 'something' dùng để chỉ vật hoặc sự việc, không dùng để chỉ người thực hiện hành động để lại lời nhắn.
---

---
id: "san_comp_b2"
type: "boolean"
input: "boolean"
headword: "san-compounds"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Noone told me the meeting had been moved to a different room.'"
answer: false
grammar_article_slug: "some-any-no"
explain: "SAI — 'no one' phải viết THÀNH HAI TỪ, không phải 'noone': 'No one told me the meeting had been moved...'"
---

---
id: "san_comp_i1"
type: "gap_mcq"
input: "choice"
headword: "san-compounds"
skill: "usage"
subtype: "intermediate"
prompt: "I've been searching all morning but I can't find my passport ____ in the apartment."
options: ["somewhere", "anywhere", "nowhere", "something"]
answer: 1
grammar_article_slug: "some-any-no"
explain: "Câu phủ định (can't find) → dùng 'anywhere', không dùng 'somewhere'."
why_wrong:
  '0': Somewhere không dùng trong câu phủ định "can't find" theo quy tắc ngữ pháp.
  '2': Dùng "nowhere" sẽ tạo thành cấu trúc phủ định kép với "can't", gây sai ngữ pháp.
  '3': Something chỉ sự vật/vật thể, không phải địa điểm như ngữ cảnh câu yêu cầu ("in the apartment").
---

---
id: "san_comp_i2"
type: "gap_text"
input: "text"
headword: "san-compounds"
skill: "production"
subtype: "intermediate"
prompt: "____ (hợp chất phủ định dứt khoát, chủ ngữ số ít, nói về VẬT) went wrong during the presentation — everything ran smoothly."
accept: ["Nothing"]
case_sensitive: false
grammar_article_slug: "some-any-no"
explain: "Hợp chất 'nothing' + động từ SỐ ÍT (went), không cần thêm 'not': 'Nothing went wrong during the presentation.'"
---

---
id: "san_comp_a1"
type: "boolean"
input: "boolean"
headword: "san-compounds"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Nobody have seen the final results of the survey yet.'"
answer: false
grammar_article_slug: "some-any-no"
explain: "SAI — 'nobody' là chủ ngữ số ít nên động từ phải chia số ít 'has', không phải 'have': 'Nobody has seen the final results of the survey yet.'"
---

---
id: "san_comp_a2"
type: "mcq"
input: "choice"
headword: "san-compounds"
skill: "contrast"
subtype: "advanced"
prompt: "Which sentence correctly uses a some- compound as a polite offer, similar to how 'some' works in invitations?"
options: ["Did you find anything useful in the archive?", "Would you like something to drink before we start?", "There isn't anywhere to sit in this waiting room.", "Nobody was available to answer the phone."]
answer: 1
grammar_article_slug: "some-any-no"
explain: "'Would you like something to drink?' là lời mời, tương tự cách 'some' được dùng trong câu hỏi mang tính mời mọc — kỳ vọng câu trả lời 'yes'."
why_wrong:
  '0': Phương án này dùng "anything" (một *any*-compound), không phải "some"-compound, và đây là một câu hỏi thông thường chứ không phải lời mời lịch sự.
  '2': Phương án này dùng "anywhere" (một *any*-compound), không phải "some"-compound, và đây là một câu phủ định mô tả tình trạng, không phải lời đề nghị.
  '3': Phương án này dùng "Nobody" (một *no*-compound), không phải "some"-compound, và đây là một câu trần thuật mang ý nghĩa phủ định, không phải lời mời.
---
