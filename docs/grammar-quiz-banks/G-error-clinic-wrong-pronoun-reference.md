---
kind: quiz
code: "G-error-clinic-wrong-pronoun-reference"
title: "Quick Check — Wrong Pronoun Reference"
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

# ===== item_key 1 · "It" mơ hồ giữa 2 danh từ =====

---
id: "pr_it_b1"
type: "mcq"
input: "choice"
headword: "pr-it-ambiguous"
skill: "form"
subtype: "basic"
prompt: "Chọn câu RÕ NGHĨA nhất (không mơ hồ 'it' chỉ cái gì):"
options: ["The city built a new bridge. It collapsed within a year.", "The city built a new bridge. The bridge collapsed within a year.", "The city built a new bridge, it collapsed within a year.", "The city built, a new bridge it collapsed within a year."]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Lặp lại danh từ cụ thể (the bridge) thay vì 'it' giúp câu rõ nghĩa ngay lập tức, tránh người đọc phải dừng lại suy đoán 'it' chỉ 'the city' hay 'the bridge' — đây là chiến lược an toàn theo bài Wiki (mục 'Lặp danh từ khi cần thiết')."
why_wrong:
  '0': '''It'' không rõ ràng, có thể chỉ ''the city'' hoặc ''a new bridge'', gây mơ hồ cho người đọc.'
  '2': Đây là lỗi nối câu bằng dấu phẩy (comma splice) vì hai mệnh đề độc lập không được nối đúng cách.
  '3': Dấu phẩy được đặt sai vị trí sau 'built', và cấu trúc câu sau đó cũng không đúng ngữ pháp.
---

---
id: "pr_it_b2"
type: "mcq"
input: "choice"
headword: "pr-it-ambiguous"
skill: "form"
subtype: "basic"
prompt: "'It' mơ hồ (ambiguous) xảy ra khi nào?"
options: ["Khi câu trước có nhiều hơn một danh từ số ít có thể là đối tượng 'it' thay thế", "Khi câu quá ngắn", "Khi dùng thì hiện tại đơn", "Khi câu không có động từ"]
answer: 0
grammar_article_slug: "wrong-pronoun-reference"
explain: "'It' chỉ rõ nghĩa khi chỉ có MỘT danh từ số ít khả dĩ ở câu trước. Nếu có ≥2 danh từ số ít cùng khả năng, người đọc không biết 'it' = cái nào."
why_wrong:
  '1': Độ dài của câu không liên quan đến việc đại từ "it" bị mơ hồ, vì một câu ngắn vẫn có thể có "it" rõ ràng hoặc mơ hồ.
  '2': Việc sử dụng thì hiện tại đơn không ảnh hưởng đến sự mơ hồ của đại từ "it"; sự mơ hồ phụ thuộc vào danh từ được thay thế, không phải thì của động từ.
  '3': Một câu đúng ngữ pháp luôn cần có động từ và sự mơ hồ của "it" không phải do thiếu động từ mà là do không rõ đại từ này thay thế cho danh từ nào.
---

---
id: "pr_it_i1"
type: "gap_mcq"
input: "choice"
headword: "pr-it-ambiguous"
skill: "usage"
subtype: "intermediate"
prompt: "The factory changed its production schedule and its supplier contract. ____ caused delays across the whole plant."
options: ["It", "The new schedule", "They", "This one"]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Câu trước có 2 danh từ số ít ('schedule', 'contract') nên 'it' không rõ chỉ cái nào — phải nêu cụ thể 'the new schedule'."
---

---
id: "pr_it_i2"
type: "gap_text"
input: "text"
headword: "pr-it-ambiguous"
skill: "production"
subtype: "intermediate"
prompt: "The committee reviewed the budget and the proposal. ____ (viết lại 'It was rejected' cho rõ nghĩa, dùng danh từ 'the proposal') was rejected."
accept: ["the proposal"]
case_sensitive: false
grammar_article_slug: "wrong-pronoun-reference"
explain: "Vì câu trước có 2 danh từ số ít (budget, proposal), phải nêu rõ danh từ cụ thể thay vì dùng 'it' mơ hồ: 'The proposal was rejected.'"
---

---
id: "pr_it_a1"
type: "boolean"
input: "boolean"
headword: "pr-it-ambiguous"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The researchers compared the survey and the interview data, and it revealed inconsistencies.' — câu này RÕ NGHĨA (không mơ hồ)."
answer: false
grammar_article_slug: "wrong-pronoun-reference"
explain: "SAI — 'it' không rõ chỉ 'the survey', 'the interview data', hay 'the comparison'. Sửa: '...and the interview data, and the comparison revealed inconsistencies.'"
---

---
id: "pr_it_a2"
type: "mcq"
input: "choice"
headword: "pr-it-ambiguous"
skill: "contrast"
subtype: "advanced"
prompt: "'Renewable energy has lowered emissions. It is now a national priority.' — Vì sao ví dụ này KHÁC với lỗi 'it' mơ hồ điển hình?"
options: ["Vì câu trước chỉ có một chủ đề số ít rõ ràng (renewable energy) nên 'it' vẫn dễ hiểu", "Vì 'it' không bao giờ được dùng trong văn viết học thuật", "Vì câu này dùng thì tương lai", "Vì 'it' ở đây thay cho một câu, không phải danh từ"]
answer: 0
grammar_article_slug: "wrong-pronoun-reference"
explain: "Theo bài Wiki, 'it' chỉ mơ hồ khi có ≥2 danh từ số ít khả dĩ ở câu trước. Ở đây chỉ có 'renewable energy' là chủ đề số ít rõ ràng nhất nên 'it' vẫn ổn — không phải mọi 'it' đều là lỗi."
why_wrong:
  '1': Việc dùng 'it' trong văn viết học thuật là hoàn toàn bình thường và cần thiết khi chủ ngữ rõ ràng, không phải lúc nào cũng là lỗi.
  '2': Câu ví dụ dùng thì hiện tại hoàn thành và hiện tại đơn, chứ không phải thì tương lai, nên lý do này không liên quan.
  '3': Trong ngữ cảnh này, 'it' thay thế cho danh từ "renewable energy" (năng lượng tái tạo) là chủ đề chính, chứ không phải toàn bộ câu trước đó.
---

# ===== item_key 2 · "They" mơ hồ giữa 2 nhóm số nhiều =====

---
id: "pr_they_b1"
type: "mcq"
input: "choice"
headword: "pr-they-ambiguous"
skill: "form"
subtype: "basic"
prompt: "'They' mơ hồ xảy ra khi nào?"
options: ["Khi câu trước có nhiều hơn một nhóm/danh từ số nhiều có thể là đối tượng 'they' thay thế", "Khi câu dùng thì quá khứ", "Khi 'they' đứng đầu câu", "Khi câu không có tính từ"]
answer: 0
grammar_article_slug: "wrong-pronoun-reference"
explain: "Giống 'it', 'they' chỉ rõ nghĩa khi câu trước có đúng MỘT nhóm số nhiều khả dĩ. Nếu có ≥2 nhóm số nhiều, 'they' trở nên mơ hồ."
why_wrong:
  '1': Thì của câu (quá khứ, hiện tại...) không ảnh hưởng đến sự mơ hồ của đại từ 'they', sự mơ hồ chỉ phụ thuộc vào số lượng danh từ số nhiều tiềm năng.
  '2': Vị trí của 'they' trong câu (đứng đầu, giữa hay cuối) không quyết định sự mơ hồ, mà phụ thuộc vào ngữ cảnh và các danh từ có thể được thay thế.
  '3': Sự hiện diện hay vắng mặt của tính từ trong câu không liên quan đến việc đại từ 'they' có bị mơ hồ hay không.
---

---
id: "pr_they_b2"
type: "mcq"
input: "choice"
headword: "pr-they-ambiguous"
skill: "form"
subtype: "basic"
prompt: "Chọn câu RÕ NGHĨA nhất về bác sĩ và y tá:"
options: ["Doctors and nurses work long shifts. They are underpaid.", "Doctors and nurses work long shifts. Nurses are often underpaid.", "Doctors, and nurses they work long shifts underpaid.", "Doctors and nurses they underpaid work."]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Câu trước có 2 nhóm số nhiều (doctors, nurses) nên 'they' không rõ nhóm nào — nêu cụ thể 'nurses' để tránh mơ hồ."
why_wrong:
  '0': Đại từ 'they' ở vế sau không rõ ràng đang ám chỉ 'doctors', 'nurses', hay cả hai nhóm, gây mơ hồ về nghĩa.
  '2': Đại từ 'they' bị thừa vì 'Doctors and nurses' đã là chủ ngữ của câu; ngoài ra, cách dùng 'underpaid' cũng không đúng ngữ pháp ở vị trí này.
  '3': Cấu trúc câu sai ngữ pháp nghiêm trọng ('they underpaid work') và đại từ 'they' bị thừa.
---

---
id: "pr_they_i1"
type: "gap_mcq"
input: "choice"
headword: "pr-they-ambiguous"
skill: "usage"
subtype: "intermediate"
prompt: "Employers and job seekers both use online platforms. ____ tend to rely more heavily on algorithms for screening."
options: ["They", "Employers", "It", "These ones"]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Có 2 nhóm số nhiều ('employers', 'job seekers') ở câu trước → 'they' mơ hồ, phải chỉ rõ nhóm nào ('employers')."
why_wrong:
  '0': Đại từ "They" gây mơ hồ vì có hai danh từ số nhiều ("employers" và "job seekers") trong câu trước đó, không rõ "They" đang ám chỉ nhóm nào.
  '2': '"It" là đại từ số ít, không phù hợp với động từ "tend" (số nhiều) và các chủ thể số nhiều được nhắc đến trước đó.'
  '3': Cụm từ "These ones" thường không tự nhiên hoặc không trang trọng trong ngữ cảnh này khi muốn chỉ rõ một trong hai nhóm người đã được giới thiệu.
---

---
id: "pr_they_i2"
type: "gap_text"
input: "text"
headword: "pr-they-ambiguous"
skill: "production"
subtype: "intermediate"
prompt: "Landlords and tenants often disagree about repairs. ____ (viết lại 'They' cho rõ nghĩa, dùng cụm 'both parties') should communicate more clearly."
accept: ["both parties"]
case_sensitive: false
grammar_article_slug: "wrong-pronoun-reference"
explain: "Khi 'they' có thể chỉ cả hai nhóm cùng lúc, dùng cụm gộp rõ nghĩa như 'both parties' thay vì để 'they' mơ hồ."
---

---
id: "pr_they_a1"
type: "boolean"
input: "boolean"
headword: "pr-they-ambiguous"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Manufacturers and retailers negotiated new terms, and they finally agreed after months of talks.' — câu này RÕ NGHĨA (không mơ hồ)."
answer: false
grammar_article_slug: "wrong-pronoun-reference"
explain: "SAI — 'they' không rõ chỉ 'manufacturers', 'retailers', hay cả hai. Sửa: '...and the two sides finally agreed after months of talks.'"
---

---
id: "pr_they_a2"
type: "mcq"
input: "choice"
headword: "pr-they-ambiguous"
skill: "contrast"
subtype: "advanced"
prompt: "'International students who move abroad often feel isolated at first. They eventually adjust to the new culture.' — Vì sao 'they' ở đây KHÔNG phải lỗi mơ hồ?"
options: ["Vì câu trước chỉ có một nhóm số nhiều rõ ràng (international students) nên 'they' dễ hiểu", "Vì 'they' luôn đúng khi đứng đầu câu", "Vì câu dùng thì hiện tại đơn", "Vì không có danh từ số ít nào trong câu"]
answer: 0
grammar_article_slug: "wrong-pronoun-reference"
explain: "Theo bài Wiki, không phải mọi 'they' đều mơ hồ — chỉ khi có nhiều nhóm số nhiều. Ở đây chỉ có một nhóm ('international students') nên 'they' vẫn rõ ràng."
why_wrong:
  '1': Vị trí của 'they' trong câu không ảnh hưởng đến việc nó có bị mơ hồ hay không, mà sự mơ hồ phụ thuộc vào tiền ngữ của nó.
  '2': Thì của động từ hoàn toàn không liên quan đến sự mơ hồ hay rõ ràng của đại từ.
  '3': Sự mơ hồ của đại từ 'they' chỉ liên quan đến sự tồn tại của nhiều danh từ số nhiều có thể là tiền ngữ, không phải danh từ số ít.
---

# ===== item_key 3 · "This/That" mơ hồ — cần "this + noun" =====

---
id: "pr_thisthat_b1"
type: "mcq"
input: "choice"
headword: "pr-this-that-ambiguous"
skill: "form"
subtype: "basic"
prompt: "Cách nâng band an toàn khi dùng 'this' để tóm tắt một ý là gì?"
options: ["Dùng 'this' một mình, không thêm gì", "Dùng 'this + noun cụ thể' (this trend, this issue...)", "Đổi 'this' thành 'it' cho ngắn gọn", "Bỏ 'this', viết lại thành câu hỏi"]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "'this + noun' (this trend, this problem, this approach) luôn rõ nghĩa hơn 'this' đứng một mình vì nêu rõ đang tóm tắt ý gì."
why_wrong:
  '0': Dùng 'this' một mình dễ gây mơ hồ, không rõ 'this' đang đề cập đến ý tưởng cụ thể nào.
  '2': '''It'' là đại từ nhân xưng chung chung, không có chức năng chỉ định rõ ràng để tóm tắt một ý tưởng phức tạp như ''this''.'
  '3': Việc viết lại thành câu hỏi làm thay đổi hoàn toàn mục đích và cấu trúc của câu, không còn chức năng tóm tắt ý.
---

---
id: "pr_thisthat_b2"
type: "mcq"
input: "choice"
headword: "pr-this-that-ambiguous"
skill: "form"
subtype: "basic"
prompt: "Chọn câu RÕ NGHĨA nhất về vấn đề đô thị:"
options: ["Traffic congestion is worsening. Air quality is declining. This is a concern.", "Traffic congestion is worsening. Air quality is declining. These urban problems are a concern.", "Traffic congestion worsening, this air quality declining concern.", "This traffic congestion air quality this is concern."]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Có 2 ý riêng biệt ở câu trước (traffic, air quality) nên 'this' một mình mơ hồ — dùng 'these + noun' (these urban problems) để gộp rõ ràng."
why_wrong:
  '0': Từ "This" (đại từ chỉ định) mơ hồ, không rõ ràng là đang ám chỉ vấn đề tắc nghẽn giao thông, chất lượng không khí, hay cả hai.
  '2': Câu thiếu động từ chính và cấu trúc ngữ pháp không hoàn chỉnh, khiến ý nghĩa không rõ ràng và khó hiểu.
  '3': 'Cấu trúc câu lủng củng và thiếu các từ cần thiết (ví dụ: mạo từ, động từ) làm cho câu hoàn toàn vô nghĩa và không đúng ngữ pháp.'
---

---
id: "pr_thisthat_i1"
type: "gap_mcq"
input: "choice"
headword: "pr-this-that-ambiguous"
skill: "usage"
subtype: "intermediate"
prompt: "Youth unemployment is rising, and wage growth has stagnated. ____ requires urgent government action."
options: ["This", "This economic situation", "It", "That thing"]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Vì có 2 ý ở câu trước (unemployment, wage growth), 'this' một mình không rõ đang gộp ý nào — cần 'this + noun' (this economic situation)."
why_wrong:
  '0': '''This'' một mình không đủ rõ ràng để bao quát cả hai vấn đề (thất nghiệp và đình trệ lương) đã nêu ở câu trước.'
  '2': '''It'' thường dùng để thay thế một danh từ hoặc ý tưởng cụ thể đã được nhắc đến, không phù hợp để tóm tắt một tình hình phức tạp gồm nhiều yếu tố.'
  '3': '''That thing'' là cách diễn đạt quá không trang trọng và mơ hồ, không phù hợp để chỉ một vấn đề kinh tế nghiêm trọng.'
---

---
id: "pr_thisthat_i2"
type: "gap_text"
input: "text"
headword: "pr-this-that-ambiguous"
skill: "production"
subtype: "intermediate"
prompt: "Plastic waste is increasing, and recycling rates remain low. ____ (viết lại 'This is worrying' cho rõ nghĩa, dùng cụm 'this trend') is worrying."
accept: ["this trend"]
case_sensitive: false
grammar_article_slug: "wrong-pronoun-reference"
explain: "'this + noun' như 'this trend' làm rõ 'this' đang tóm tắt ý gì, thay vì để người đọc tự đoán."
---

---
id: "pr_thisthat_a1"
type: "boolean"
input: "boolean"
headword: "pr-this-that-ambiguous"
skill: "error_id"
subtype: "intermediate"
prompt: "Đúng hay Sai: 'Housing prices are surging. Rental costs are also climbing. That is unsustainable for young families.' — câu này RÕ NGHĨA (không mơ hồ)."
answer: false
grammar_article_slug: "wrong-pronoun-reference"
explain: "SAI — 'that' không rõ gộp 'housing prices', 'rental costs', hay cả hai. Sửa: '...climbing. This combination of rising costs is unsustainable...'"
---

---
id: "pr_thisthat_a2"
type: "mcq"
input: "choice"
headword: "pr-this-that-ambiguous"
skill: "contrast"
subtype: "advanced"
prompt: "'Many young people now prefer working from home. This makes some employers uncomfortable.' — Theo bài Wiki, câu này ổn nhưng có thể nâng band bằng cách nào?"
options: ["Xoá hẳn 'this' khỏi câu", "Thay 'this' bằng 'this preference for remote work' để cụ thể hơn", "Đổi 'this' thành 'they'", "Thêm dấu phẩy trước 'this'"]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Câu này vốn không sai vì 'this' rõ chỉ ý duy nhất ở câu trước, nhưng thay 'this' bằng 'this + noun' (this preference for remote work) vẫn giúp văn phong rõ ràng và học thuật hơn."
why_wrong:
  '0': Việc xóa 'this' sẽ làm vế câu thứ hai thiếu chủ ngữ, khiến câu không có người thực hiện hành động và mất đi ý nghĩa ban đầu.
  '2': '''They'' là đại từ nhân xưng số nhiều dùng để chỉ người hoặc vật, không phải để chỉ một sự việc hay ý tưởng, và cấu trúc ngữ pháp ''They makes'' cũng không chính xác.'
  '3': Thêm dấu phẩy trước 'this' khi 'this' bắt đầu một câu mới sẽ tạo thành lỗi nối câu bằng dấu phẩy (comma splice), vốn là lỗi ngữ pháp khi hai mệnh đề độc lập chỉ được ngăn cách bởi một dấu phẩy.
---

# ===== item_key 4 · "He/She" sai đối tượng (cùng giới, số ít) =====

---
id: "pr_hesh_b1"
type: "mcq"
input: "choice"
headword: "pr-he-she-wrong-referent"
skill: "form"
subtype: "basic"
prompt: "Lỗi 'he/she sai đối tượng' xảy ra khi nào?"
options: ["Khi câu có hai người cùng giới tính và không rõ 'he'/'she' chỉ ai", "Khi câu dùng thì tương lai", "Khi câu không có tính từ sở hữu", "Khi câu quá dài"]
answer: 0
grammar_article_slug: "wrong-pronoun-reference"
explain: "Khi 2 người cùng giới xuất hiện trong câu, 'he' hoặc 'she' không rõ chỉ người nào — gây hiểu sai đối tượng."
why_wrong:
  '1': Thì của câu không ảnh hưởng đến việc đại từ 'he/she' có thể gây nhầm lẫn đối tượng.
  '2': Việc thiếu tính từ sở hữu không phải là nguyên nhân gây ra lỗi 'he/she sai đối tượng' vì chúng là các loại từ khác nhau.
  '3': Độ dài của câu không trực tiếp gây ra lỗi 'he/she sai đối tượng'; lỗi này liên quan đến sự mơ hồ trong việc chỉ rõ chủ thể của đại từ.
---

---
id: "pr_hesh_b2"
type: "mcq"
input: "choice"
headword: "pr-he-she-wrong-referent"
skill: "form"
subtype: "basic"
prompt: "Chọn câu RÕ NGHĨA nhất về quản lý và nhân viên:"
options: ["The manager told the employee that he made a mistake.", "The manager told the employee that the employee made a mistake.", "The manager the employee he mistake told.", "The manager told he employee mistake."]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Cả 'the manager' và 'the employee' đều có thể là 'he' → lặp lại danh từ cụ thể (the employee) để tránh mơ hồ."
why_wrong:
  '0': Đại từ "he" gây mơ hồ vì có thể chỉ người quản lý hoặc nhân viên, làm câu không rõ nghĩa.
  '2': Cấu trúc câu và trật tự từ hoàn toàn sai, không tạo thành một câu tiếng Anh hợp lệ.
  '3': Cấu trúc "told he employee mistake" sai ngữ pháp nghiêm trọng và thiếu từ, không tạo thành câu có nghĩa.
---

---
id: "pr_hesh_i1"
type: "gap_mcq"
input: "choice"
headword: "pr-he-she-wrong-referent"
skill: "usage"
subtype: "intermediate"
prompt: "The professor emailed the assistant because ____ needed the report by Friday."
options: ["she", "the professor", "they", "it"]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Nếu cả professor và assistant đều có thể là 'she', dùng danh từ cụ thể (the professor) để người đọc biết ai cần báo cáo."
why_wrong:
  '0': '''she'' gây mơ hồ vì cả giáo sư và trợ lý đều có thể là nữ, khiến người đọc không rõ ai là người cần báo cáo.'
  '2': '''they'' là đại từ số nhiều, trong khi người cần báo cáo (giáo sư) là số ít.'
  '3': '''it'' dùng để chỉ vật, sự vật hoặc ý tưởng, không dùng để chỉ người (giáo sư).'
---

---
id: "pr_hesh_i2"
type: "gap_text"
input: "text"
headword: "pr-he-she-wrong-referent"
skill: "production"
subtype: "intermediate"
prompt: "Tránh 'she' mơ hồ (Sarah hay her sister?): 'Sarah called her sister because ____ was worried about the trip.' Điền tên riêng rõ nghĩa vào chỗ trống:"
accept: ["Sarah", "sarah"]
case_sensitive: false
grammar_article_slug: "wrong-pronoun-reference"
explain: "Khi 2 người cùng giới (Sarah, her sister) xuất hiện, lặp lại tên riêng (Sarah) rõ nghĩa hơn để lại 'she' mơ hồ."
---

---
id: "pr_hesh_a1"
type: "boolean"
input: "boolean"
headword: "pr-he-she-wrong-referent"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'After the coach spoke with the player, he felt more confident before the match.' — câu này RÕ NGHĨA (không mơ hồ)."
answer: false
grammar_article_slug: "wrong-pronoun-reference"
explain: "SAI — 'he' có thể là coach hoặc player. Sửa: 'After the coach spoke with the player, the player felt more confident before the match.'"
---

---
id: "pr_hesh_a2"
type: "mcq"
input: "choice"
headword: "pr-he-she-wrong-referent"
skill: "contrast"
subtype: "advanced"
prompt: "'After the interview, the candidate thanked the recruiter for her time.' — Nếu cả candidate và recruiter đều là nữ, cách sửa nào rõ nghĩa nhất theo bài Wiki?"
options: ["Giữ nguyên vì 'her' luôn chỉ người gần nhất", "Thay bằng cấu trúc trực tiếp: 'the candidate said, \"Thank you for your time,\" to the recruiter'", "Xoá hẳn tân ngữ khỏi câu", "Đổi 'her' thành 'their'"]
answer: 1
grammar_article_slug: "wrong-pronoun-reference"
explain: "Theo bài Wiki, một cách sửa lỗi he/she sai đối tượng là dùng cấu trúc trực tiếp (direct speech/relative clause) để gắn rõ đại từ vào đúng người, tránh phải đoán 'her' chỉ ai."
why_wrong:
  '0': Quy tắc 'her' luôn chỉ người gần nhất không chính xác và không giải quyết được sự mơ hồ về người sở hữu thời gian trong câu.
  '2': Việc xóa hẳn tân ngữ sẽ làm mất đi thông tin quan trọng về lý do cảm ơn, thay đổi ý nghĩa gốc của câu và khiến câu bị thiếu ý.
  '3': 'Singular "their" vẫn đúng ngữ pháp cho một người; nhưng đổi "her" → "their" KHÔNG xoá được sự mơ hồ — vẫn không rõ thời gian của candidate hay recruiter. Chỉ cấu trúc trực tiếp (đáp án) mới gắn rõ đại từ vào đúng người.'
---
