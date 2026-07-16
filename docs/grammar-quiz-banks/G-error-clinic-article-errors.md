---
kind: quiz
code: "G-error-clinic-article-errors"
title: "Quick Check — Article Errors"
skill_area: "grammar"
topic: "Error Clinic"
mode: "adaptive_mastery"
grading: "instant"
correct_to_master: 2
require_distinct_skill: true
require_production_to_master: true
cooldown: 2
shuffle_options: true
words_count: 7
source: "authored-2026-07"
---

# ===== item_key 1 · Bỏ sót "the" trước danh từ duy nhất (missing_article) =====

---
id: "aerr_missthe_b1"
type: "mcq"
input: "choice"
headword: "aerr-missing-the-unique"
skill: "error_id"
subtype: "basic"
prompt: "Trong bài Speaking Part 3, một thí sinh nói: 'I think ∅ government should invest more in public transport.' Câu này thiếu gì?"
options: ["Thiếu 'the' trước 'government'", "Thiếu 's' ở 'government'", "Không thiếu gì", "Thừa mạo từ"]
answer: 0
grammar_article_slug: "article-errors"
explain: "'government' ở đây chỉ chính phủ cụ thể (của nước mình) — ai nghe cũng hiểu → cần 'the government', không để trống mạo từ."
---

---
id: "aerr_missthe_i1"
type: "gap_mcq"
input: "choice"
headword: "aerr-missing-the-unique"
skill: "usage"
subtype: "intermediate"
prompt: "Bài luận Task 2 của một học sinh viết: '____ internet has completely changed the way young people socialise.' Chọn cách sửa đúng."
options: ["Internet (không mạo từ)", "The internet", "An internet", "Internets"]
answer: 1
grammar_article_slug: "article-errors"
explain: "'internet' được xem là thứ duy nhất mà ai cũng biết → luôn đi với 'the': 'The internet has...'."
---

---
id: "aerr_missthe_i2"
type: "boolean"
input: "boolean"
headword: "aerr-missing-the-unique"
skill: "contrast"
subtype: "intermediate"
prompt: "Đúng hay Sai: 'The environment is being damaged faster than scientists predicted.'"
answer: true
grammar_article_slug: "article-errors"
explain: "ĐÚNG — 'environment' (môi trường Trái Đất) là khái niệm duy nhất, phải dùng 'The environment is being damaged...'."
---

---
id: "aerr_missthe_a1"
type: "gap_text"
input: "text"
headword: "aerr-missing-the-unique"
skill: "production"
subtype: "advanced"
prompt: "Sửa lại câu bài viết của học sinh cho đúng, chỉ gõ 2 từ cần điền vào chỗ trống: '____ has a duty to regulate large corporations that harm public health.' (gốc học sinh viết 'Government has a duty...')"
accept: ["the government"]
case_sensitive: false
grammar_article_slug: "article-errors"
explain: "'government' chỉ chính phủ cụ thể, người đọc hiểu ngay là cái nào → phải thêm 'the': 'The government has a duty...'."
---

# ===== item_key 2 · Thêm "the" thừa trước danh từ chung chung (wrong_article) =====

---
id: "aerr_extrathe_b1"
type: "mcq"
input: "choice"
headword: "aerr-extra-the-general"
skill: "error_id"
subtype: "basic"
prompt: "Câu chấm điểm phát hiện lỗi: 'The technology has made our lives easier in many ways.' Lỗi ở đây là gì?"
options: ["Thừa 'the' vì 'technology' đang nói chung chung", "Thiếu 's' ở 'technology'", "Sai thì động từ", "Không có lỗi"]
answer: 0
grammar_article_slug: "article-errors"
explain: "Khi nói về công nghệ nói chung (không chỉ một công nghệ cụ thể) → không dùng 'the': 'Technology has made our lives easier...'."
---

---
id: "aerr_extrathe_i1"
type: "gap_mcq"
input: "choice"
headword: "aerr-extra-the-general"
skill: "usage"
subtype: "intermediate"
prompt: "Học sinh viết Task 2: 'The education plays a vital role in reducing poverty.' Sửa lại phần đầu câu cho đúng."
options: ["The education", "Education", "An education", "Educations"]
answer: 1
grammar_article_slug: "article-errors"
explain: "'education' mang nghĩa chung chung (giáo dục nói chung, không đếm được) → bỏ 'the': 'Education plays a vital role...'."
---

---
id: "aerr_extrathe_i2"
type: "boolean"
input: "boolean"
headword: "aerr-extra-the-general"
skill: "contrast"
subtype: "intermediate"
prompt: "Đúng hay Sai: 'The nature should be protected for future generations.'"
answer: false
grammar_article_slug: "article-errors"
explain: "SAI — 'nature' (thiên nhiên nói chung) là danh từ không đếm được mang nghĩa chung → không dùng 'the'. Đúng là: 'Nature should be protected...'."
---

---
id: "aerr_extrathe_a1"
type: "gap_text"
input: "text"
headword: "aerr-extra-the-general"
skill: "production"
subtype: "advanced"
prompt: "Viết lại cụm bị lỗi 'the pollution' trong câu sau cho đúng (chỉ gõ 1 từ, không mạo từ): 'The pollution has become one of the most urgent issues worldwide.' → '____ has become one of the most urgent issues worldwide.'"
accept: ["pollution", "Pollution"]
case_sensitive: false
grammar_article_slug: "article-errors"
explain: "'pollution' không đếm được, mang nghĩa chung chung → bỏ 'the': 'Pollution has become one of the most urgent issues...'."
---

# ===== item_key 3 · Nhầm a/an theo âm (wrong_article) =====

---
id: "aerr_aan_b1"
type: "mcq"
input: "choice"
headword: "aerr-a-an-sound"
skill: "form"
subtype: "basic"
prompt: "Một học sinh nói khi luyện Speaking Part 1: 'I'm studying at a university near my hometown.' Việc dùng 'a' trước 'university' là:"
options: ["Đúng, vì 'university' bắt đầu bằng âm /j/", "Sai, phải là 'an university'", "Sai, phải bỏ mạo từ", "Đúng, nhưng chỉ vì 'university' viết hoa"]
answer: 0
grammar_article_slug: "article-errors"
explain: "'university' phát âm bắt đầu bằng /j/ (phụ âm) dù chữ viết là nguyên âm 'u' → dùng 'a', không phải 'an'."
---

---
id: "aerr_aan_i1"
type: "gap_mcq"
input: "choice"
headword: "aerr-a-an-sound"
skill: "error_id"
subtype: "intermediate"
prompt: "Bài chấm phát hiện lỗi trong câu luận: 'It only takes an hour to commute, so it's not a honest complaint to make.' Từ nào bị dùng sai mạo từ?"
options: ["'an hour' sai, 'a honest' đúng", "'an hour' đúng, 'a honest' sai — phải là 'an honest'", "Cả hai đều sai", "Cả hai đều đúng"]
answer: 1
grammar_article_slug: "article-errors"
explain: "'hour' bắt đầu bằng âm /aʊ/ (nguyên âm, h câm) → 'an hour' đúng. 'honest' cũng bắt đầu bằng âm /ɒ/ (h câm) → phải là 'an honest', không phải 'a honest'."
---

---
id: "aerr_aan_i2"
type: "boolean"
input: "boolean"
headword: "aerr-a-an-sound"
skill: "usage"
subtype: "intermediate"
prompt: "Đúng hay Sai: 'She completed an MBA before joining the company.'"
answer: true
grammar_article_slug: "article-errors"
explain: "ĐÚNG — mạo từ theo ÂM đọc, không theo chữ cái. 'MBA' đọc là /em-bi:-eɪ/, bắt đầu bằng âm /e/ → dùng 'an': 'an MBA'."
---

---
id: "aerr_aan_a1"
type: "gap_text"
input: "text"
headword: "aerr-a-an-sound"
skill: "production"
subtype: "advanced"
prompt: "Điền mạo từ đúng (1 từ) để sửa lỗi học sinh mắc trong câu nói Part 2: 'My cousin works as ____ European sales manager and travels every month.'"
accept: ["a"]
case_sensitive: false
grammar_article_slug: "article-errors"
explain: "'European' bắt đầu bằng âm /j/ (phụ âm), giống 'university' → dùng 'a', không phải 'an': 'a European sales manager'."
---

# ===== item_key 4 · Dùng "a" với danh từ không đếm được (wrong_article) =====

---
id: "aerr_auncount_b1"
type: "mcq"
input: "choice"
headword: "aerr-a-with-uncountable"
skill: "error_id"
subtype: "basic"
prompt: "Một học sinh viết trong bài luận: 'Before travelling abroad, you should get a information about local customs.' Lỗi ở đây là gì?"
options: ["'information' không đếm được, không dùng được với 'a'", "Thiếu 's' ở 'information'", "Sai thì động từ 'get'", "Không có lỗi"]
answer: 0
grammar_article_slug: "article-errors"
explain: "'information' là danh từ không đếm được, không bao giờ đi với 'a/an' → sửa thành 'get information' hoặc 'get some information'."
---

---
id: "aerr_auncount_i1"
type: "gap_mcq"
input: "choice"
headword: "aerr-a-with-uncountable"
skill: "usage"
subtype: "intermediate"
prompt: "Câu học sinh nói khi luyện Speaking Part 3: 'My grandmother always gives me a good advice about life.' Sửa cụm 'a good advice' thành gì?"
options: ["good advice", "a good advices", "an advice", "the advice always"]
answer: 0
grammar_article_slug: "article-errors"
explain: "'advice' không đếm được → bỏ 'a': 'gives me good advice' (hoặc 'a piece of good advice' nếu muốn đếm)."
---

---
id: "aerr_auncount_i2"
type: "boolean"
input: "boolean"
headword: "aerr-a-with-uncountable"
skill: "contrast"
subtype: "intermediate"
prompt: "Đúng hay Sai: 'He has a deep knowledge of financial markets.'"
answer: true
grammar_article_slug: "article-errors"
explain: "ĐÚNG — 'knowledge' không đếm được nhưng khi có tính từ miêu tả rõ mức độ như 'a deep knowledge of...' thì 'a' vẫn dùng được như một cách diễn đạt quen thuộc, khác với 'a information' hay 'a advice' (luôn sai)."
---

---
id: "aerr_auncount_a1"
type: "gap_text"
input: "text"
headword: "aerr-a-with-uncountable"
skill: "production"
subtype: "advanced"
prompt: "Sửa lỗi mạo từ trong câu bài luận (gõ đúng cụm 2 từ để điền vào chỗ trống, KHÔNG dùng 'a'): 'Employers often value ____ more than formal qualifications.' (học sinh viết gốc: 'a work experience')"
accept: ["work experience"]
case_sensitive: false
grammar_article_slug: "article-errors"
explain: "'experience' (kinh nghiệm nói chung) không đếm được → bỏ 'a': 'Employers often value work experience more than...'."
---

# ===== item_key 5 · Quên "the" khi nhắc lại lần hai (missing_article) =====

---
id: "aerr_2ndmention_b1"
type: "mcq"
input: "choice"
headword: "aerr-second-mention"
skill: "form"
subtype: "basic"
prompt: "Đoạn văn kể chuyện Part 2: 'Last year I bought a bicycle. ____ bicycle was stolen just two weeks later.' Chọn mạo từ đúng ở chỗ trống."
options: ["A", "The", "An", "∅ (không mạo từ)"]
answer: 1
grammar_article_slug: "article-errors"
explain: "'bicycle' đã được nhắc ở câu trước ('a bicycle') → lần nhắc thứ hai dùng 'the': 'The bicycle was stolen...'."
---

---
id: "aerr_2ndmention_i1"
type: "gap_mcq"
input: "choice"
headword: "aerr-second-mention"
skill: "error_id"
subtype: "intermediate"
prompt: "Bài chấm phát hiện lỗi: 'I interviewed a local shop owner for my project. A shop owner told me business had improved.' Câu thứ hai sai ở đâu?"
options: ["'A shop owner' phải là 'The shop owner' vì đã nhắc ở câu trước", "'A shop owner' đúng, không cần sửa", "Phải bỏ mạo từ hoàn toàn", "Phải dùng 'An shop owner'"]
answer: 0
grammar_article_slug: "article-errors"
explain: "Người này đã được nhắc ở câu 1 ('a local shop owner') → lần 2 người đọc đã biết là ai → phải dùng 'the': 'The shop owner told me...'."
---

---
id: "aerr_2ndmention_i2"
type: "boolean"
input: "boolean"
headword: "aerr-second-mention"
skill: "usage"
subtype: "intermediate"
prompt: "Đúng hay Sai: trong đoạn 'She recommended a documentary about ocean plastic. The documentary really opened my eyes', việc chuyển từ 'a documentary' sang 'the documentary' ở câu 2 là đúng ngữ pháp?"
answer: true
grammar_article_slug: "article-errors"
explain: "ĐÚNG — lần đầu nhắc dùng 'a' (chưa xác định), lần hai người nghe đã biết đang nói về phim tài liệu nào → chuyển sang 'the'."
---

---
id: "aerr_2ndmention_a1"
type: "gap_text"
input: "text"
headword: "aerr-second-mention"
skill: "production"
subtype: "advanced"
prompt: "Điền mạo từ đúng (1 từ) để sửa lỗi: 'My tutor suggested a website for practicing listening skills. ____ website has hundreds of free exercises.'"
accept: ["The", "the"]
case_sensitive: false
grammar_article_slug: "article-errors"
explain: "'website' đã được giới thiệu ở câu trước bằng 'a website' → lần nhắc lại thứ hai phải dùng 'the website'."
---

# ===== item_key 6 · Thêm "the" sai trước tên quốc gia/địa danh (wrong_article) =====

---
id: "aerr_placename_b1"
type: "mcq"
input: "choice"
headword: "aerr-the-with-place-names"
skill: "error_id"
subtype: "basic"
prompt: "Một thí sinh nói: 'Last summer my family visited the Vietnam to see relatives.' Lỗi nằm ở đâu?"
options: ["Thừa 'the' trước 'Vietnam'", "Thiếu 's' ở 'Vietnam'", "Sai thì quá khứ", "Không có lỗi"]
answer: 0
grammar_article_slug: "article-errors"
explain: "Tên quốc gia số ít như 'Vietnam' không đi với 'the' → 'visited Vietnam to see relatives'."
---

---
id: "aerr_placename_i1"
type: "gap_mcq"
input: "choice"
headword: "aerr-the-with-place-names"
skill: "usage"
subtype: "intermediate"
prompt: "Câu học sinh viết trong bài luận du lịch: 'Tourists who visit ____ United States often travel to several states in one trip.' Chọn phương án đúng."
options: ["∅ (không mạo từ)", "the", "a", "an"]
answer: 1
grammar_article_slug: "article-errors"
explain: "Tên quốc gia có chứa từ 'States/Republic/Kingdom' (dạng số nhiều hoặc cụm) → cần 'the': 'the United States'."
---

---
id: "aerr_placename_i2"
type: "boolean"
input: "boolean"
headword: "aerr-the-with-place-names"
skill: "contrast"
subtype: "intermediate"
prompt: "Đúng hay Sai: câu 'The London is one of the most multicultural cities in the world' dùng 'the' đúng trước 'London' vì đây là thành phố nổi tiếng?"
answer: false
grammar_article_slug: "article-errors"
explain: "SAI — tên thành phố như 'London' không đi với 'the' dù nổi tiếng đến đâu → 'London is one of the most multicultural cities...'."
---

---
id: "aerr_placename_a1"
type: "gap_text"
input: "text"
headword: "aerr-the-with-place-names"
skill: "production"
subtype: "advanced"
prompt: "Sửa câu học sinh viết sai 'the Japan' — gõ lại đúng 1 từ để điền: 'Many companies in ____ have adopted a four-day work week on a trial basis.'"
accept: ["Japan", "japan"]
case_sensitive: false
grammar_article_slug: "article-errors"
explain: "'Japan' là tên quốc gia số ít, không có 'Republic/Kingdom/States' → không dùng 'the': 'companies in Japan have adopted...'."
---

# ===== item_key 7 · Bỏ sót "a" khi phân loại nghề nghiệp/vai trò (missing_article) =====

---
id: "aerr_categorize_b1"
type: "mcq"
input: "choice"
headword: "aerr-missing-a-categorizing"
skill: "form"
subtype: "basic"
prompt: "Học sinh nói trong Speaking Part 1: 'My sister is ∅ nurse at the city hospital.' Câu này thiếu gì?"
options: ["Thiếu 'a' trước 'nurse'", "Thiếu 's' ở 'nurse'", "Thừa 'the' trước 'hospital'", "Không thiếu gì"]
answer: 0
grammar_article_slug: "article-errors"
explain: "Khi mô tả nghề nghiệp (danh từ số ít đếm được đứng sau 'is/be') phải có 'a/an': 'My sister is a nurse...'."
---

---
id: "aerr_categorize_i1"
type: "gap_mcq"
input: "choice"
headword: "aerr-missing-a-categorizing"
skill: "error_id"
subtype: "intermediate"
prompt: "Bài chấm phát hiện lỗi trong câu: 'After graduation, he hopes to become ∅ software engineer at a large tech firm.' Cần sửa gì?"
options: ["Thêm 'a' trước 'software engineer'", "Thêm 'an' trước 'software engineer'", "Thêm 'the' trước 'software engineer'", "Không cần sửa"]
answer: 0
grammar_article_slug: "article-errors"
explain: "'software engineer' bắt đầu bằng phụ âm /s/ và là danh từ chỉ nghề nghiệp số ít → cần 'a': 'hopes to become a software engineer'."
---

---
id: "aerr_categorize_i2"
type: "boolean"
input: "boolean"
headword: "aerr-missing-a-categorizing"
skill: "usage"
subtype: "intermediate"
prompt: "Đúng hay Sai: câu 'She wants to become an architect who designs eco-friendly buildings' dùng 'an' đúng trước 'architect'?"
answer: true
grammar_article_slug: "article-errors"
explain: "ĐÚNG — 'architect' bắt đầu bằng nguyên âm /ɑː/ và là danh từ nghề nghiệp số ít → 'an architect' là đúng."
---

---
id: "aerr_categorize_a1"
type: "gap_text"
input: "text"
headword: "aerr-missing-a-categorizing"
skill: "production"
subtype: "advanced"
prompt: "Điền mạo từ đúng (1 từ) để sửa câu học sinh viết thiếu mạo từ: 'Before starting her own company, she worked as ____ marketing consultant for several multinational brands.'"
accept: ["a"]
case_sensitive: false
grammar_article_slug: "article-errors"
explain: "'marketing consultant' là vai trò nghề nghiệp số ít, bắt đầu bằng phụ âm /m/ → cần 'a': 'worked as a marketing consultant'."
---
