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
---

---
id: "apn_single_i2"
type: "gap_text"
input: "text"
headword: "apn-single-mountains-lakes"
skill: "production"
subtype: "intermediate"
prompt: "____ (viết mạo từ hoặc 'ø' nếu không cần) Lake Superior is the largest freshwater lake in the world by surface area."
accept: ["ø", "no article", ""]
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
---

---
id: "apn_city_i2"
type: "gap_text"
input: "text"
headword: "apn-cities-streets-landmarks"
skill: "production"
subtype: "intermediate"
prompt: "____ (viết mạo từ hoặc 'ø' nếu không cần) Bangkok is known for its street food and vibrant markets."
accept: ["ø", "no article", ""]
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
