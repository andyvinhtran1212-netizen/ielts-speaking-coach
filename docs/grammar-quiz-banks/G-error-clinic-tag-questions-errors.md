---
kind: quiz
code: "G-error-clinic-tag-questions-errors"
title: "Quick Check — Tag Questions Errors"
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

# ===== item_key 1 · Đảo cực + lặp đúng trợ động từ (be/have/modal) =====

---
id: "tq_polarity_b1"
type: "mcq"
input: "choice"
headword: "tq-basic-polarity-aux"
skill: "form"
subtype: "basic"
prompt: "You are a student, ____?"
options: ["aren't you", "are you", "don't you", "isn't it"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "Mệnh đề chính khẳng định (are) → đuôi phải PHỦ ĐỊNH và lặp lại đúng trợ động từ be: aren't you."
why_wrong:
  '1': Đuôi câu hỏi phải ở thể phủ định khi mệnh đề chính ở thể khẳng định.
  '2': Trợ động từ trong đuôi câu hỏi phải trùng với động từ 'to be' trong mệnh đề chính, không phải 'do'.
  '3': Đại từ chủ ngữ trong đuôi câu hỏi phải trùng với chủ ngữ của mệnh đề chính ('you'), không phải 'it'.
---

---
id: "tq_polarity_b2"
type: "mcq"
input: "choice"
headword: "tq-basic-polarity-aux"
skill: "form"
subtype: "basic"
prompt: "She doesn't smoke, ____?"
options: ["does she", "doesn't she", "is she", "isn't she"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "Mệnh đề chính PHỦ ĐỊNH (doesn't) → đuôi phải đảo sang KHẲNG ĐỊNH: does she."
why_wrong:
  '1': Mệnh đề chính đã phủ định (doesn't), nên đuôi câu hỏi phải khẳng định.
  '2': Động từ chính trong mệnh đề là 'smoke' (thì hiện tại đơn, dùng trợ động từ 'does'), không phải động từ 'to be', nên đuôi câu hỏi phải dùng 'does' thay vì 'is'.
  '3': Mệnh đề chính đã phủ định và dùng trợ động từ 'does', nên đuôi câu hỏi phải khẳng định và dùng 'does', không phải 'isn't'.
---

---
id: "tq_polarity_i1"
type: "gap_mcq"
input: "choice"
headword: "tq-basic-polarity-aux"
skill: "usage"
subtype: "intermediate"
prompt: "He can swim very well, ____?"
options: ["can't he", "can he", "doesn't he", "isn't he"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "Mệnh đề chính có modal verb 'can' → LẶP LẠI đúng modal đó ở đuôi, chỉ đảo cực: can't he (không dùng doesn't vì đã có trợ động từ can rồi)."
why_wrong:
  '1': Đuôi câu hỏi phải ở thể phủ định vì mệnh đề chính là khẳng định.
  '2': Đuôi câu hỏi phải dùng trợ động từ 'can' từ mệnh đề chính, không dùng 'does' vì 'can' đã có sẵn.
  '3': Đuôi câu hỏi phải dùng trợ động từ 'can' từ mệnh đề chính, không dùng 'is' vì mệnh đề chính không dùng động từ 'to be'.
---

---
id: "tq_polarity_i2"
type: "gap_mcq"
input: "choice"
headword: "tq-basic-polarity-aux"
skill: "usage"
subtype: "intermediate"
prompt: "They have finished the report, ____?"
options: ["haven't they", "hasn't they", "don't they", "didn't they"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "Trợ động từ của mệnh đề chính là 'have' (đi với 'they') → lặp lại đúng have: haven't they. Không đổi sang 'do' vì câu chính đã có have."
why_wrong:
  '1': Trợ động từ 'hasn't' không đi với chủ ngữ số nhiều 'they'.
  '2': Mệnh đề chính đã có trợ động từ 'have', không dùng 'do' hoặc 'don't' để tạo câu hỏi đuôi.
  '3': Trợ động từ 'didn't' dùng cho thì quá khứ đơn, không phù hợp với thì hiện tại hoàn thành 'have finished'.
---

---
id: "tq_polarity_i3"
type: "gap_text"
input: "text"
headword: "tq-basic-polarity-aux"
skill: "production"
subtype: "intermediate"
prompt: "Your sister has finished her exams, ____ ____? (viết đuôi câu hỏi, 2 từ)"
accept: ["hasn't she"]
case_sensitive: false
grammar_article_slug: "tag-questions-errors"
explain: "Mệnh đề chính khẳng định với trợ động từ 'has' → đảo cực + lặp has: hasn't she."
---

---
id: "tq_polarity_a1"
type: "boolean"
input: "boolean"
headword: "tq-basic-polarity-aux"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'You are ready, are you?' là câu hỏi đuôi đúng ngữ pháp."
answer: false
grammar_article_slug: "tag-questions-errors"
explain: "SAI — mệnh đề chính khẳng định (are) nhưng đuôi cũng khẳng định (are you), tức KHÔNG đảo cực. Phải sửa thành: 'You are ready, aren't you?'"
---

---
id: "tq_polarity_a2"
type: "boolean"
input: "boolean"
headword: "tq-basic-polarity-aux"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'He could speak French fluently, couldn't he?' là câu hỏi đuôi đúng ngữ pháp."
answer: true
grammar_article_slug: "tag-questions-errors"
explain: "ĐÚNG — mệnh đề chính có modal 'could' (khẳng định) → đuôi đảo cực thành phủ định và lặp đúng modal: couldn't he. Khác với các câu không có trợ động từ/modal, vốn phải mượn do/does/did (xem item_key 2)."
---

# ===== item_key 2 · Không có trợ động từ → mượn do/does/did =====

---
id: "tq_doaux_b1"
type: "mcq"
input: "choice"
headword: "tq-no-aux-add-do"
skill: "form"
subtype: "basic"
prompt: "She likes tea, ____?"
options: ["doesn't she", "isn't she", "hasn't she", "wasn't she"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "Mệnh đề chính 'likes' là động từ thường ở hiện tại đơn, KHÔNG có trợ động từ → phải mượn does/doesn't: doesn't she."
why_wrong:
  '1': Isn't she dùng khi động từ chính là 'to be' hoặc ở thì hiện tại tiếp diễn, không phù hợp với động từ 'likes' ở thì hiện tại đơn.
  '2': Hasn't she dùng cho thì hiện tại hoàn thành, không phải thì hiện tại đơn như 'likes'.
  '3': Wasn't she dùng cho thì quá khứ đơn hoặc quá khứ tiếp diễn, trong khi câu gốc đang ở thì hiện tại đơn.
---

---
id: "tq_doaux_b2"
type: "mcq"
input: "choice"
headword: "tq-no-aux-add-do"
skill: "form"
subtype: "basic"
prompt: "They went home early yesterday, ____?"
options: ["didn't they", "weren't they", "haven't they", "don't they"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "'went' là động từ thường ở quá khứ đơn, không có trợ động từ đi kèm → mượn did: didn't they."
why_wrong:
  '1': Sai vì 'weren't' dùng cho động từ 'to be' ở quá khứ, trong khi câu gốc dùng động từ thường 'went'.
  '2': Sai vì 'haven't' dùng cho thì hiện tại hoàn thành, trong khi câu gốc ở thì quá khứ đơn.
  '3': Sai vì 'don't' dùng cho thì hiện tại đơn, trong khi câu gốc ở thì quá khứ đơn.
---

---
id: "tq_doaux_i1"
type: "gap_mcq"
input: "choice"
headword: "tq-no-aux-add-do"
skill: "usage"
subtype: "intermediate"
prompt: "Your parents work in the city centre, ____?"
options: ["don't they", "aren't they", "haven't they", "won't they"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "'work' là động từ thường (hiện tại đơn, chủ ngữ số nhiều) → mượn do/don't: don't they."
why_wrong:
  '1': Đây là câu hỏi đuôi cho động từ 'work' (động từ thường), không phải động từ 'to be', nên không dùng 'aren't'.
  '2': Động từ chính 'work' ở thì hiện tại đơn, không phải thì hiện tại hoàn thành, nên không dùng trợ động từ 'haven't'.
  '3': Động từ chính 'work' ở thì hiện tại đơn, không phải thì tương lai, nên không dùng trợ động từ 'won't'.
---

---
id: "tq_doaux_i2"
type: "gap_mcq"
input: "choice"
headword: "tq-no-aux-add-do"
skill: "usage"
subtype: "intermediate"
prompt: "The company launched a new product last month, ____?"
options: ["didn't it", "wasn't it", "hasn't it", "isn't it"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "'launched' là động từ thường ở quá khứ đơn → mượn did: didn't it. Không dùng 'wasn't/hasn't' vì câu chính không có be/have."
why_wrong:
  '1': Phương án "wasn't it" sai vì động từ chính trong câu là "launched" (động từ thường ở thì quá khứ đơn), không phải động từ "to be".
  '2': Phương án "hasn't it" sai vì câu gốc sử dụng thì quá khứ đơn (launched), không phải thì hiện tại hoàn thành hay có trợ động từ "have/has".
  '3': Phương án "isn't it" sai vì động từ chính "launched" đang ở thì quá khứ đơn, không phải thì hiện tại đơn hay động từ "to be".
---

---
id: "tq_doaux_i3"
type: "gap_text"
input: "text"
headword: "tq-no-aux-add-do"
skill: "production"
subtype: "intermediate"
prompt: "Your brother plays football every weekend, ____ ____? (viết đuôi câu hỏi, 2 từ)"
accept: ["doesn't he"]
case_sensitive: false
grammar_article_slug: "tag-questions-errors"
explain: "'plays' là động từ thường, không có trợ động từ → mượn does: doesn't he."
---

---
id: "tq_doaux_a1"
type: "boolean"
input: "boolean"
headword: "tq-no-aux-add-do"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She likes tea, isn't she?' là câu hỏi đuôi đúng ngữ pháp."
answer: false
grammar_article_slug: "tag-questions-errors"
explain: "SAI — 'likes' là động từ thường, không phải 'be', nên không thể dùng 'isn't'. Câu chính không có trợ động từ nào để lặp lại → phải mượn does: 'She likes tea, doesn't she?'"
---

---
id: "tq_doaux_a2"
type: "boolean"
input: "boolean"
headword: "tq-no-aux-add-do"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: nếu mệnh đề chính đã có trợ động từ hoặc modal (be/have/can/will…), ta vẫn phải thêm do/does/did vào đuôi câu hỏi cho chắc chắn."
answer: false
grammar_article_slug: "tag-questions-errors"
explain: "SAI — chỉ mượn do/does/did khi mệnh đề chính KHÔNG có trợ động từ/modal nào. Nếu đã có be/have/modal thì LẶP LẠI chính trợ động từ đó ở đuôi, không thêm do/does/did (xem item_key 1)."
---

# ===== item_key 3 · Trường hợp đặc biệt (I am, Let's, câu mệnh lệnh) =====

---
id: "tq_special_b1"
type: "mcq"
input: "choice"
headword: "tq-special-forms"
skill: "form"
subtype: "basic"
prompt: "I'm the last one to arrive, ____?"
options: ["aren't I", "amn't I", "am I not", "isn't I"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "'I am' là trường hợp đặc biệt: đuôi câu hỏi là 'aren't I', không tồn tại 'amn't I' trong tiếng Anh chuẩn."
---

---
id: "tq_special_b2"
type: "mcq"
input: "choice"
headword: "tq-special-forms"
skill: "form"
subtype: "basic"
prompt: "Let's take a break now, ____?"
options: ["shall we", "will we", "don't we", "aren't we"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "Câu đề nghị bắt đầu bằng 'Let's' luôn có đuôi cố định: shall we."
why_wrong:
  '1': '''will we'' không phải dạng đuôi câu hỏi cố định cho câu đề nghị bắt đầu bằng ''Let''s''.'
  '2': '''don''t we'' được dùng làm đuôi câu hỏi cho thì hiện tại đơn, không phù hợp với câu đề nghị ''Let''s''.'
  '3': '''aren''t we'' dùng làm đuôi câu hỏi cho câu có động từ ''to be'', không phù hợp với cấu trúc ''Let''s''.'
---

---
id: "tq_special_i1"
type: "gap_mcq"
input: "choice"
headword: "tq-special-forms"
skill: "usage"
subtype: "intermediate"
prompt: "Open the door for me, ____?"
options: ["will you", "do you", "aren't you", "shall you"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "Câu mệnh lệnh (không có chủ ngữ, động từ nguyên mẫu 'Open') dùng đuôi 'will you?' (hoặc 'won't you?' nếu muốn lịch sự/mời mọc hơn)."
why_wrong:
  '1': Phương án này dùng cho câu hỏi đuôi của câu trần thuật ở thì hiện tại đơn, không phải câu mệnh lệnh.
  '2': Phương án này dùng cho câu hỏi đuôi của câu trần thuật có động từ "to be", không phù hợp với câu mệnh lệnh bắt đầu bằng động từ thường.
  '3': Đây không phải là dạng câu hỏi đuôi chuẩn cho câu mệnh lệnh; "shall" thường được dùng với "I" và "we" để đề xuất hoặc hỏi ý kiến.
---

---
id: "tq_special_i2"
type: "gap_mcq"
input: "choice"
headword: "tq-special-forms"
skill: "usage"
subtype: "intermediate"
prompt: "Don't forget your passport, ____?"
options: ["will you", "don't you", "aren't you", "shall you"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "Câu mệnh lệnh phủ định ('Don't forget…') vẫn dùng đuôi 'will you?', không đảo cực theo động từ 'do' vì đây không phải câu trần thuật thông thường."
why_wrong:
  '1': Đuôi câu hỏi cho mệnh lệnh phủ định là 'will you', không phải 'don't you' dù câu gốc có 'don't'.
  '2': Câu gốc không chứa động từ 'to be' ('are') nên không thể dùng 'aren't you' làm đuôi câu hỏi.
  '3': '''Shall you'' không phải dạng đuôi câu hỏi tiêu chuẩn và tự nhiên cho câu mệnh lệnh trong tiếng Anh hiện đại.'
---

---
id: "tq_special_i3"
type: "gap_text"
input: "text"
headword: "tq-special-forms"
skill: "production"
subtype: "intermediate"
prompt: "I'm always late for meetings, ____ ____? (viết đuôi câu hỏi, 2 từ)"
accept: ["aren't I"]
case_sensitive: false
grammar_article_slug: "tag-questions-errors"
explain: "'I am' là trường hợp đặc biệt duy nhất không lặp nguyên trợ động từ: đuôi là aren't I, không phải amn't I hay isn't I."
---

---
id: "tq_special_a1"
type: "boolean"
input: "boolean"
headword: "tq-special-forms"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'I'm invited to the party, amn't I?' là câu hỏi đuôi đúng ngữ pháp."
answer: false
grammar_article_slug: "tag-questions-errors"
explain: "SAI — 'amn't I' không tồn tại trong tiếng Anh chuẩn. Dạng đúng duy nhất là: 'I'm invited to the party, aren't I?'"
---

---
id: "tq_special_a2"
type: "boolean"
input: "boolean"
headword: "tq-special-forms"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: câu mệnh lệnh 'Close the window' và câu đề nghị 'Let's close the window' dùng CHUNG một dạng đuôi câu hỏi."
answer: false
grammar_article_slug: "tag-questions-errors"
explain: "SAI — câu mệnh lệnh thường ('Close the window, will you?') dùng đuôi 'will you', còn câu đề nghị bắt đầu bằng 'Let's' ('Let's close the window, shall we?') luôn dùng đuôi cố định 'shall we' — hai dạng khác nhau."
---

# ===== item_key 4 · There is/are + phủ định ẩn (never/nobody/hardly) =====

---
id: "tq_there_neg_b1"
type: "mcq"
input: "choice"
headword: "tq-there-and-negative"
skill: "form"
subtype: "basic"
prompt: "There is a problem with the printer, ____?"
options: ["isn't there", "isn't it", "is there", "doesn't it"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "Chủ ngữ giả 'there' → đuôi câu hỏi cũng lặp lại 'there', không dùng 'it': isn't there."
why_wrong:
  '1': Sai vì chủ ngữ giả 'there' trong câu gốc phải được lặp lại trong câu hỏi đuôi, không dùng 'it'.
  '2': Sai vì câu gốc là khẳng định ('There is'), nên đuôi câu hỏi phải là phủ định.
  '3': Sai vì câu gốc dùng động từ 'to be' ('is') và chủ ngữ giả 'there', nên đuôi câu hỏi phải dùng 'isn't there', không phải 'doesn't it'.
---

---
id: "tq_there_neg_b2"
type: "mcq"
input: "choice"
headword: "tq-there-and-negative"
skill: "form"
subtype: "basic"
prompt: "He never calls his parents, ____?"
options: ["does he", "doesn't he", "is he", "isn't he"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "'never' mang nghĩa PHỦ ĐỊNH ẩn (dù câu không có 'not'/'don't') → đuôi câu hỏi phải KHẲNG ĐỊNH: does he."
---

---
id: "tq_there_neg_i1"
type: "gap_mcq"
input: "choice"
headword: "tq-there-and-negative"
skill: "usage"
subtype: "intermediate"
prompt: "There are still some seats left in the exam hall, ____?"
options: ["aren't there", "isn't there", "are there", "aren't they"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "'There are' (số nhiều) → đuôi khẳng định đảo thành phủ định và vẫn giữ 'there' chứ không đổi thành 'they': aren't there."
why_wrong:
  '1': Mệnh đề chính dùng động từ số nhiều 'are', nên đuôi câu hỏi phải dùng 'aren't', không phải 'isn't' (số ít).
  '2': Mệnh đề chính ('There are...') đang ở thể khẳng định, vì vậy đuôi câu hỏi phải ở thể phủ định.
  '3': Khi mệnh đề chính bắt đầu bằng 'There is/are', chủ ngữ giả 'there' được lặp lại trong đuôi câu hỏi, không đổi thành 'they'.
---

---
id: "tq_there_neg_i2"
type: "gap_mcq"
input: "choice"
headword: "tq-there-and-negative"
skill: "usage"
subtype: "intermediate"
prompt: "Nobody answered the phone this morning, ____?"
options: ["did they", "didn't they", "was he", "wasn't he"]
answer: 0
grammar_article_slug: "tag-questions-errors"
explain: "'Nobody' vừa mang nghĩa phủ định ẩn (→ đuôi khẳng định: did they) vừa là chủ ngữ bất định số ít nhưng lấy đại từ đuôi là 'they'."
why_wrong:
  '1': Mệnh đề chính có "Nobody" đã mang nghĩa phủ định, nên câu hỏi đuôi cần ở thể khẳng định.
  '2': Trợ động từ "was" không phù hợp với động từ quá khứ đơn "answered", và chủ ngữ "Nobody" phải dùng đại từ "they" trong câu hỏi đuôi.
  '3': Trợ động từ "wasn't" không phù hợp với thì của "answered", đại từ "he" không dùng cho "Nobody", và câu hỏi đuôi phải ở thể khẳng định.
---

---
id: "tq_there_neg_i3"
type: "gap_text"
input: "text"
headword: "tq-there-and-negative"
skill: "production"
subtype: "intermediate"
prompt: "There is nothing we can do about the delay, ____ ____? (viết đuôi câu hỏi, 2 từ)"
accept: ["is there"]
case_sensitive: false
grammar_article_slug: "tag-questions-errors"
explain: "'nothing' mang nghĩa phủ định ẩn nên toàn câu được coi là phủ định → đuôi phải KHẲNG ĐỊNH, đồng thời vẫn lặp lại chủ ngữ giả 'there': is there."
---

---
id: "tq_there_neg_a1"
type: "boolean"
input: "boolean"
headword: "tq-there-and-negative"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'There isn't any milk left, is there?' là câu hỏi đuôi đúng ngữ pháp."
answer: true
grammar_article_slug: "tag-questions-errors"
explain: "ĐÚNG — mệnh đề chính đã phủ định rõ ràng bằng 'isn't' → đuôi đảo sang khẳng định và giữ 'there': is there."
---

---
id: "tq_there_neg_a2"
type: "boolean"
input: "boolean"
headword: "tq-there-and-negative"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She hardly ever visits her hometown, doesn't she?' là câu hỏi đuôi đúng ngữ pháp."
answer: false
grammar_article_slug: "tag-questions-errors"
explain: "SAI — 'hardly ever' mang nghĩa phủ định ẩn (gần giống 'never') dù câu không có 'not', nên đuôi phải KHẲNG ĐỊNH: 'She hardly ever visits her hometown, does she?' — giống nguyên tắc với 'never/nobody' ở trên, không phải 'there is/are' (đó là quy tắc riêng của item_key này về chủ ngữ giả 'there')."
---
