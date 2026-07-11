---
kind: quiz
code: "G-foundations-articles-with-places-and-names"
title: "Quick Check — Articles with Places and Names"
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

# ===== item_key 1 · Quốc gia — đơn (không THE) vs United/Republic/số nhiều (có THE) =====

---
id: "apn_country_b1"
type: "mcq"
input: "choice"
headword: "apn-countries"
skill: "form"
subtype: "basic"
prompt: "She grew up in ____ Thailand before moving to Canada for university."
options: ["a", "an", "the", "ø (no article)"]
answer: 3
grammar_article_slug: "articles-with-places-and-names"
explain: "Tên quốc gia đơn (Thailand) không dùng mạo từ → zero article."
why_wrong:
  '0': '"a" là mạo từ không xác định, không dùng trước tên quốc gia đơn.'
  '1': '"an" là mạo từ không xác định, không dùng trước tên quốc gia đơn.'
  '2': '"the" là mạo từ xác định, nhưng tên quốc gia đơn như "Thailand" không dùng "the".'
---

---
id: "apn_country_b2"
type: "boolean"
input: "boolean"
headword: "apn-countries"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'My cousin has lived in the Malaysia for over a decade.'"
answer: false
grammar_article_slug: "articles-with-places-and-names"
explain: "SAI — Malaysia là quốc gia tên đơn, không dùng 'the': 'My cousin has lived in Malaysia for over a decade.'"
---

---
id: "apn_country_i1"
type: "gap_mcq"
input: "choice"
headword: "apn-countries"
skill: "usage"
subtype: "intermediate"
prompt: "Many international students choose to study in ____ United Kingdom because of its prestigious universities."
options: ["a", "an", "the", "ø (no article)"]
answer: 2
grammar_article_slug: "articles-with-places-and-names"
explain: "Tên quốc gia chứa từ 'United' bắt buộc dùng 'the': 'the United Kingdom'."
why_wrong:
  '0': A dùng cho danh từ số ít đếm được bắt đầu bằng phụ âm, không áp dụng cho tên quốc gia đặc biệt như "United Kingdom".
  '1': An dùng cho danh từ số ít đếm được bắt đầu bằng nguyên âm, nhưng từ "United" bắt đầu bằng phụ âm /j/ và tên quốc gia này cần "the".
  '3': Bỏ trống mạo từ là sai vì tên quốc gia có từ "United" (như "United Kingdom") luôn yêu cầu mạo từ "the".
---

---
id: "apn_country_i2"
type: "gap_text"
input: "text"
headword: "apn-countries"
skill: "production"
subtype: "intermediate"
prompt: "____ (mạo từ, 1 từ) Netherlands is famous for its cycling infrastructure and flood management systems."
accept: ["The"]
case_sensitive: false
grammar_article_slug: "articles-with-places-and-names"
explain: "'Netherlands' là tên quốc gia dạng số nhiều → bắt buộc dùng 'the': 'The Netherlands'."
---

---
id: "apn_country_a1"
type: "mcq"
input: "choice"
headword: "apn-countries"
skill: "contrast"
subtype: "advanced"
prompt: "Which sentence correctly contrasts a single-name country with a 'Republic of' country?"
options: ["He was born in the Vietnam but studied in the Republic of Korea.", "He was born in Vietnam but studied in the Republic of Korea.", "He was born in the Vietnam but studied in Republic of Korea.", "He was born in Vietnam but studied in Republic of Korea."]
answer: 1
grammar_article_slug: "articles-with-places-and-names"
explain: "'Vietnam' là quốc gia tên đơn → zero article. 'the Republic of Korea' chứa từ 'Republic' → bắt buộc 'the'."
why_wrong:
  '0': Phương án này dùng mạo từ "the" trước "Vietnam", trong khi "Vietnam" là quốc gia tên đơn và không dùng "the".
  '2': Phương án này dùng mạo từ "the" trước "Vietnam" (sai) và bỏ sót "the" trước "Republic of Korea" (sai).
  '3': Phương án này bỏ sót mạo từ "the" trước "Republic of Korea", trong khi các quốc gia có "Republic of" bắt buộc phải dùng "the".
---

# ===== item_key 2 · Sông, đại dương, dãy núi — luôn dùng THE =====

---
id: "apn_water_b1"
type: "mcq"
input: "choice"
headword: "apn-rivers-oceans-ranges"
skill: "form"
subtype: "basic"
prompt: "____ Nile flows northward through eleven African countries."
options: ["A", "An", "The", "ø (no article)"]
answer: 2
grammar_article_slug: "articles-with-places-and-names"
explain: "Tên sông luôn dùng 'the': 'The Nile'."
why_wrong:
  '0': '''A'' dùng cho danh từ số ít đếm được không xác định, trong khi ''Nile'' là tên riêng của một con sông cụ thể và duy nhất.'
  '1': '''An'' dùng cho danh từ số ít đếm được không xác định bắt đầu bằng nguyên âm, trong khi ''Nile'' là tên riêng và bắt đầu bằng phụ âm.'
  '3': Tên các con sông luôn yêu cầu mạo từ xác định 'the', không được bỏ qua.
---

---
id: "apn_water_b2"
type: "boolean"
input: "boolean"
headword: "apn-rivers-oceans-ranges"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Cargo ships cross Indian Ocean on their way from Africa to Southeast Asia.'"
answer: false
grammar_article_slug: "articles-with-places-and-names"
explain: "SAI — tên đại dương luôn có 'the': 'Cargo ships cross the Indian Ocean...' (lỗi missing_article)"
---

---
id: "apn_water_i1"
type: "gap_mcq"
input: "choice"
headword: "apn-rivers-oceans-ranges"
skill: "usage"
subtype: "intermediate"
prompt: "Trekkers who want to reach base camp usually spend weeks acclimatising in ____ Andes before attempting higher altitudes."
options: ["a", "an", "the", "ø (no article)"]
answer: 2
grammar_article_slug: "articles-with-places-and-names"
explain: "Dãy núi (mountain range, số nhiều) luôn dùng 'the': 'the Andes'."
why_wrong:
  '0': '"a" là mạo từ không xác định dùng cho danh từ số ít, không phù hợp với "Andes" là danh từ số nhiều chỉ một dãy núi cụ thể.'
  '1': '"an" cũng là mạo từ không xác định dùng cho danh từ số ít, không thể dùng với "Andes" là danh từ số nhiều và đã xác định.'
  '3': Không dùng mạo từ là sai vì "Andes" là tên riêng của một dãy núi cụ thể, cần mạo từ xác định "the".
---

---
id: "apn_water_i2"
type: "gap_text"
input: "text"
headword: "apn-rivers-oceans-ranges"
skill: "production"
subtype: "intermediate"
prompt: "____ (mạo từ, 1 từ) Panama Canal connects the Atlantic and Pacific Oceans."
accept: ["The"]
case_sensitive: false
grammar_article_slug: "articles-with-places-and-names"
explain: "Tên kênh đào luôn dùng 'the': 'The Panama Canal'."
---

---
id: "apn_water_a1"
type: "boolean"
input: "boolean"
headword: "apn-rivers-oceans-ranges"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: quy tắc dùng 'the' với sông, đại dương và dãy núi giống hệt quy tắc dùng 'the' với quốc gia — cả hai đều phụ thuộc vào việc tên đó có phải số nhiều hay không."
answer: false
grammar_article_slug: "articles-with-places-and-names"
explain: "SAI — sông/đại dương/dãy núi LUÔN dùng 'the' bất kể số ít hay số nhiều (the Nile, the Andes), trong khi quốc gia chỉ dùng 'the' khi tên chứa United/Republic hoặc ở dạng số nhiều (Vietnam thì không, nhưng the Philippines thì có)."
---

# ===== item_key 3 · Núi đơn và hồ đơn — KHÔNG dùng THE =====

---
id: "apn_single_b1"
type: "mcq"
input: "choice"
headword: "apn-single-mountains-lakes"
skill: "form"
subtype: "basic"
prompt: "____ Kilimanjaro is the tallest mountain in Africa."
options: ["A", "An", "The", "ø (no article)"]
answer: 3
grammar_article_slug: "articles-with-places-and-names"
explain: "Tên núi đơn lẻ (có 'Mount' hoặc không) không dùng mạo từ → zero article: 'Kilimanjaro'."
---

---
id: "apn_single_b2"
type: "boolean"
input: "boolean"
headword: "apn-single-mountains-lakes"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Scientists have been monitoring the Lake Baikal for signs of pollution.'"
answer: false
grammar_article_slug: "articles-with-places-and-names"
explain: "SAI — hồ đơn lẻ (Lake + tên riêng) không dùng 'the': 'Scientists have been monitoring Lake Baikal for signs of pollution.'"
---

---
id: "apn_single_i1"
type: "gap_mcq"
input: "choice"
headword: "apn-single-mountains-lakes"
skill: "usage"
subtype: "intermediate"
prompt: "Every winter, thousands of climbers attempt to reach the summit of ____ Mount Fuji."
options: ["a", "an", "the", "ø (no article)"]
answer: 3
grammar_article_slug: "articles-with-places-and-names"
explain: "Núi đơn (Mount Fuji) không dùng mạo từ → zero article, dù có 'Mount' đứng trước."
why_wrong:
  '0': Mạo từ "a" dùng cho danh từ đếm được số ít không xác định, trong khi "Mount Fuji" là tên riêng của một ngọn núi cụ thể.
  '1': Tương tự "a", mạo từ "an" dùng cho danh từ đếm được số ít không xác định bắt đầu bằng nguyên âm, không phù hợp với tên riêng ngọn núi cụ thể "Mount Fuji".
  '2': Mặc dù "the" là mạo từ xác định, nhưng quy tắc ngữ pháp tiếng Anh quy định không dùng mạo từ với tên riêng của một ngọn núi đơn lẻ khi có từ "Mount" đứng trước.
---

---
id: "apn_single_i2"
type: "gap_text"
input: "text"
headword: "apn-single-mountains-lakes"
skill: "production"
subtype: "intermediate"
prompt: "____ (viết mạo từ hoặc 'ø' nếu không cần) Lake Superior is the largest freshwater lake in the world by surface area."
accept: ["ø", "no article"]
case_sensitive: false
grammar_article_slug: "articles-with-places-and-names"
explain: "Hồ đơn lẻ với 'Lake + tên' không dùng mạo từ → zero article."
---

---
id: "apn_single_a1"
type: "mcq"
input: "choice"
headword: "apn-single-mountains-lakes"
skill: "contrast"
subtype: "advanced"
prompt: "Which sentence correctly contrasts a single lake with a group of lakes?"
options: ["Lake Geneva is smaller than the Great Lakes in North America.", "The Lake Geneva is smaller than Great Lakes in North America.", "Lake Geneva is smaller than Great Lakes in North America.", "The Lake Geneva is smaller than the Great Lakes in North America."]
answer: 0
grammar_article_slug: "articles-with-places-and-names"
explain: "Hồ đơn (Lake Geneva) không dùng 'the', nhưng nhóm hồ (the Great Lakes, số nhiều) bắt buộc dùng 'the'."
why_wrong:
  '1': Sử dụng 'The' trước tên hồ đơn 'Lake Geneva' và bỏ sót 'the' trước tên nhóm hồ 'Great Lakes' là sai ngữ pháp.
  '2': Thiếu mạo từ 'the' trước tên nhóm hồ 'Great Lakes' là không chính xác.
  '3': Sử dụng mạo từ 'the' một cách không cần thiết trước tên hồ đơn 'Lake Geneva' là sai quy tắc.
---

# ===== item_key 4 · Thành phố, đường phố, công trình có descriptor =====

---
id: "apn_city_b1"
type: "mcq"
input: "choice"
headword: "apn-cities-streets-landmarks"
skill: "form"
subtype: "basic"
prompt: "Her company relocated its headquarters to ____ Seoul last year."
options: ["a", "an", "the", "ø (no article)"]
answer: 3
grammar_article_slug: "articles-with-places-and-names"
explain: "Tên thành phố không dùng mạo từ → zero article: 'Seoul'."
why_wrong:
  '0': Mạo từ 'a' không được dùng trước tên riêng của thành phố.
  '1': Mạo từ 'an' không được dùng trước tên riêng của thành phố.
  '2': Mạo từ 'the' không được dùng trước tên riêng của thành phố.
---

---
id: "apn_city_b2"
type: "boolean"
input: "boolean"
headword: "apn-cities-streets-landmarks"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Tourists often take photos in front of the Buckingham Palace during their visit to London.'"
answer: false
grammar_article_slug: "articles-with-places-and-names"
explain: "SAI — Buckingham Palace là tên riêng không có descriptor chung, thường không dùng 'the': 'Tourists often take photos in front of Buckingham Palace...'"
---

---
id: "apn_city_i1"
type: "gap_mcq"
input: "choice"
headword: "apn-cities-streets-landmarks"
skill: "usage"
subtype: "intermediate"
prompt: "Every year, millions of tourists visit ____ Great Wall to see one of the most remarkable feats of engineering in history."
options: ["a", "an", "the", "ø (no article)"]
answer: 2
grammar_article_slug: "articles-with-places-and-names"
explain: "Công trình có cấu trúc tên dạng 'the + descriptive + noun' dùng 'the': 'the Great Wall'."
why_wrong:
  '0': “a” dùng cho danh từ số ít đếm được không xác định, trong khi “Great Wall” là một địa danh cụ thể, duy nhất.
  '1': “an” dùng cho danh từ số ít đếm được không xác định bắt đầu bằng nguyên âm, nhưng “Great Wall” bắt đầu bằng phụ âm và là một địa danh cụ thể, duy nhất.
  '3': “Great Wall” là một địa danh nổi tiếng, duy nhất và thuộc loại danh từ cần mạo từ xác định “the” đi kèm theo quy tắc tên công trình.
---

---
id: "apn_city_i2"
type: "gap_text"
input: "text"
headword: "apn-cities-streets-landmarks"
skill: "production"
subtype: "intermediate"
prompt: "____ (viết mạo từ hoặc 'ø' nếu không cần) Bangkok is known for its street food and vibrant markets."
accept: ["ø", "no article"]
case_sensitive: false
grammar_article_slug: "articles-with-places-and-names"
explain: "Tên thành phố không dùng mạo từ → zero article: 'Bangkok'."
---

---
id: "apn_city_a1"
type: "boolean"
input: "boolean"
headword: "apn-cities-streets-landmarks"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: hầu hết đường phố như Oxford Street hay Fifth Avenue không dùng 'the', nhưng vẫn có một số trường hợp đặc biệt như 'the High Street' hoặc 'the Strand' có dùng 'the'."
answer: true
grammar_article_slug: "articles-with-places-and-names"
explain: "ĐÚNG — phần lớn tên đường phố cụ thể không dùng 'the' (Oxford Street), nhưng một số tên mang tính mô tả chung như 'the High Street' (phố chính ở UK) hoặc 'the Strand' là ngoại lệ có 'the'."
---
