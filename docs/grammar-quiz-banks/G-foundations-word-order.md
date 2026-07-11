---
kind: quiz
code: "G-foundations-word-order"
title: "Quick Check — Word Order"
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

# ===== item_key 1 · S-V-O cơ bản (chủ ngữ - động từ - tân ngữ) =====

---
id: "wo_svo_b1"
type: "mcq"
input: "choice"
headword: "wo-svo-basic"
skill: "form"
subtype: "basic"
prompt: "Choose the correct word order."
options: ["She every morning drinks coffee.", "She drinks coffee every morning.", "She drinks every morning coffee.", "Drinks she coffee every morning."]
answer: 1
grammar_article_slug: "word-order"
explain: "Trật tự cơ bản: Subject → Verb → Object → (Adverbial). 'She drinks coffee every morning' đúng thứ tự S-V-O-time."
why_wrong:
  '0': Trạng từ chỉ thời gian "every morning" không được đặt giữa chủ ngữ và động từ.
  '2': Trạng từ chỉ thời gian "every morning" không được đặt giữa động từ và tân ngữ.
  '3': Câu trần thuật phải bắt đầu bằng chủ ngữ, không phải bằng động từ.
---

---
id: "wo_svo_b2"
type: "boolean"
input: "boolean"
headword: "wo-svo-basic"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'I rice eat every day.'"
answer: false
grammar_article_slug: "word-order"
explain: "SAI — tiếng Việt cho phép S-O-V nhưng tiếng Anh bắt buộc S-V-O: 'I eat rice every day.' (lỗi word_order_error)"
---

---
id: "wo_svo_i1"
type: "gap_mcq"
input: "choice"
headword: "wo-svo-basic"
skill: "usage"
subtype: "intermediate"
prompt: "Chọn câu đặt trạng từ chỉ cách thức ở vị trí CUỐI (sau động từ + tân ngữ): 'The examiner ____.'"
options: ["carefully explained the task to the candidates", "explained carefully the task to the candidates", "the task explained carefully to the candidates", "explained the task carefully to the candidates"]
answer: 3
grammar_article_slug: "word-order"
explain: "Đề hỏi vị trí CUỐI: trạng từ chỉ cách thức đứng sau động từ + tân ngữ → 'explained the task carefully'. ('carefully explained' đầu câu cũng đúng ngữ pháp nhưng không phải vị trí cuối; 'explained carefully the task' sai vì tách rời V–O; đảo tân ngữ lên đầu cũng sai.)"
---

---
id: "wo_svo_i2"
type: "gap_text"
input: "text"
headword: "wo-svo-basic"
skill: "production"
subtype: "intermediate"
prompt: "Sắp xếp lại thành câu đúng trật tự S-V-O, viết lại cả câu: 'homework / finishes / she / quickly' → She ____"
accept: ["finishes homework quickly"]
case_sensitive: false
grammar_article_slug: "word-order"
explain: "Cả hai đều đúng: 'She finishes homework quickly' (adverb cuối câu) và 'She quickly finishes homework' (adverb giữa câu, đứng TRƯỚC động từ chính). Điểm mấu chốt: cụm S-V-O 'finishes homework' luôn liền nhau — chỉ SAI khi chen adverb vào giữa V và O: 'finishes quickly homework' ✗."
explain: "Trật tự chuẩn: Subject (She) → Verb (finishes) → Object (homework) → Adverb (quickly). 'Quickly' là manner adverb nên đứng sau V-O, không đứng trước động từ."
---

---
id: "wo_svo_a1"
type: "mcq"
input: "choice"
headword: "wo-svo-basic"
skill: "contrast"
subtype: "advanced"
prompt: "In an IELTS Speaking Part 3 answer, which sentence keeps the Subject-Verb-Object order intact while still fronting a time adverbial for emphasis?"
options: ["Nowadays young people spend most of their free time online.", "Nowadays young people online spend most of their free time.", "Young people most of their free time spend online nowadays.", "Spend young people nowadays most of their free time online."]
answer: 0
grammar_article_slug: "word-order"
explain: "Trạng ngữ thời gian có thể đứng đầu câu ('Nowadays'), nhưng phần còn lại vẫn phải theo đúng Subject → Verb → Object: 'young people spend most of their free time online'."
why_wrong:
  '1': Trạng ngữ "online" được đặt giữa chủ ngữ ("young people") và động từ ("spend"), phá vỡ trật tự S-V.
  '2': Tân ngữ ("most of their free time") bị đặt trước động từ ("spend"), làm sai trật tự S-V-O chuẩn.
  '3': Câu bắt đầu bằng động từ ("Spend") và chủ ngữ ("young people") đứng sau, vi phạm nghiêm trọng trật tự S-V-O của câu trần thuật.
---

# ===== item_key 2 · Trật tự tính từ trước danh từ (attributive vs predicative + adjective ordering) =====

---
id: "wo_adj_b1"
type: "mcq"
input: "choice"
headword: "wo-adjective-order"
skill: "form"
subtype: "basic"
prompt: "She bought ____ for the interview."
options: ["a suit black new", "a new black suit", "a black new suit", "a suit new black"]
answer: 1
grammar_article_slug: "word-order"
explain: "Tính từ luôn đứng TRƯỚC danh từ trong tiếng Anh, theo thứ tự Age → Colour: 'a new black suit'."
why_wrong:
  '0': Tính từ "black" và "new" đã bị đặt sai vị trí sau danh từ "suit".
  '2': Thứ tự của các tính từ "black" và "new" bị đảo ngược so với quy tắc Age → Colour.
  '3': Tính từ "new" và "black" đã bị đặt sai vị trí sau danh từ "suit".
---

---
id: "wo_adj_b2"
type: "boolean"
input: "boolean"
headword: "wo-adjective-order"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'I want a car red for my birthday.'"
answer: false
grammar_article_slug: "word-order"
explain: "SAI — tiếng Việt để tính từ sau danh từ ('xe đỏ') nhưng tiếng Anh đặt trước: 'I want a red car for my birthday.' (lỗi word_order_error)"
---

---
id: "wo_adj_i1"
type: "gap_mcq"
input: "choice"
headword: "wo-adjective-order"
skill: "usage"
subtype: "intermediate"
prompt: "The museum displayed ____ vase from the Ming dynasty."
options: ["a Chinese beautiful ancient", "an ancient beautiful Chinese", "a beautiful ancient Chinese", "a beautiful Chinese ancient"]
answer: 2
grammar_article_slug: "word-order"
explain: "Thứ tự Opinion (beautiful) → Age (ancient) → Origin (Chinese) → Noun: 'a beautiful ancient Chinese vase'."
why_wrong:
  '0': Tính từ "Chinese" (nguồn gốc) bị đặt sai vị trí trước "beautiful" (quan điểm) và "ancient" (tuổi tác).
  '1': Tính từ "ancient" (tuổi tác) bị đặt sai vị trí trước "beautiful" (quan điểm).
  '3': Tính từ "Chinese" (nguồn gốc) bị đặt sai vị trí trước "ancient" (tuổi tác).
---

---
id: "wo_adj_i2"
type: "gap_text"
input: "text"
headword: "wo-adjective-order"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại đúng thứ tự tính từ (opinion trước size): 'lovely / small' + apartment → She lives in a ____ apartment."
accept: ["lovely small"]
case_sensitive: false
grammar_article_slug: "word-order"
explain: "Opinion (lovely) đứng trước Size (small): 'a lovely small apartment'."
---

---
id: "wo_adj_a1"
type: "mcq"
input: "choice"
headword: "wo-adjective-order"
skill: "contrast"
subtype: "advanced"
prompt: "Which sentence correctly uses an adjective in predicative position (after a linking verb)?"
options: ["She wore a dress beautiful to the ceremony.", "The dress looks beautiful on her.", "She wore a beautiful looks dress.", "The beautiful looks dress on her."]
answer: 1
grammar_article_slug: "word-order"
explain: "'The dress looks beautiful' — tính từ đứng SAU động từ liên kết 'looks' (predicative use) là đúng ngữ pháp; đứng trước danh từ mới cần vị trí attributive."
why_wrong:
  '0': Tính từ "beautiful" phải đứng trước danh từ "dress" (attributive position), không phải đứng sau.
  '2': Cụm "beautiful looks dress" sai cấu trúc ngữ pháp; từ "looks" được dùng không đúng cách trong cụm danh từ này.
  '3': Câu thiếu động từ chính, chỉ là một cụm danh từ nên không phải một câu hoàn chỉnh.
---

---
id: "wo_adj_a2"
type: "boolean"
input: "boolean"
headword: "wo-adjective-order"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She wore a dress beautiful to the graduation ceremony' là đúng ngữ pháp vì tính từ đang mô tả trực tiếp danh từ 'dress'."
answer: false
grammar_article_slug: "word-order"
explain: "SAI — khi mô tả trực tiếp (attributive), tính từ phải đứng TRƯỚC danh từ: 'She wore a beautiful dress to the graduation ceremony.' (lỗi word_order_error)"
---

# ===== item_key 3 · Vị trí trạng từ tần suất (frequency adverbs: always/usually/never...) =====

---
id: "wo_adv_b1"
type: "mcq"
input: "choice"
headword: "wo-adverb-frequency"
skill: "form"
subtype: "basic"
prompt: "Choose the correct sentence."
options: ["I drink always coffee in the morning.", "I always drink coffee in the morning.", "Always I drink coffee in the morning.", "I drink coffee always in the morning."]
answer: 1
grammar_article_slug: "word-order"
explain: "Frequency adverb (always) đứng TRƯỚC động từ chính: 'I always drink coffee'."
why_wrong:
  '0': Trạng từ tần suất "always" đứng sau động từ chính "drink" là sai vị trí.
  '2': Trạng từ tần suất "always" không đứng trước chủ ngữ "I" trong câu khẳng định thông thường.
  '3': Trạng từ tần suất "always" đứng sau tân ngữ "coffee" là sai vị trí.
---

---
id: "wo_adv_b2"
type: "boolean"
input: "boolean"
headword: "wo-adverb-frequency"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'He goes never to the gym after work.'"
answer: false
grammar_article_slug: "word-order"
explain: "SAI — 'never' phải đứng TRƯỚC động từ chính, không phải sau: 'He never goes to the gym after work.' (lỗi word_order_error)"
---

---
id: "wo_adv_i1"
type: "gap_mcq"
input: "choice"
headword: "wo-adverb-frequency"
skill: "usage"
subtype: "intermediate"
prompt: "In job interviews, candidates ____ nervous, even when well prepared."
options: ["are usually", "usually are", "are always usually", "usually to be"]
answer: 0
grammar_article_slug: "word-order"
explain: "Frequency adverb đứng SAU động từ 'be': 'candidates are usually nervous' (không phải trước be)."
why_wrong:
  '1': Trạng từ tần suất "usually" đứng trước động từ "are", trái với quy tắc trạng từ tần suất phải đứng sau động từ "to be".
  '2': Sử dụng hai trạng từ tần suất ("always" và "usually") liên tiếp cùng lúc là thừa thãi và không đúng ngữ pháp.
  '3': '"To be" là dạng nguyên thể, không phải dạng động từ đã chia phù hợp với chủ ngữ số nhiều "candidates" và thì hiện tại đơn.'
---

---
id: "wo_adv_i2"
type: "gap_text"
input: "text"
headword: "wo-adverb-frequency"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại đúng vị trí trạng từ tần suất: 'I / have / never / been / to Japan' → I ____ to Japan."
accept: ["have never been"]
case_sensitive: false
grammar_article_slug: "word-order"
explain: "Với cấu trúc have + V3, trạng từ tần suất đứng GIỮA auxiliary (have) và động từ chính (been): 'I have never been to Japan.'"
---

---
id: "wo_adv_a1"
type: "boolean"
input: "boolean"
headword: "wo-adverb-frequency"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'I always am tired after a full day of exam practice.'"
answer: false
grammar_article_slug: "word-order"
explain: "SAI — trạng từ tần suất đứng SAU động từ 'be', không phải trước: 'I am always tired after a full day of exam practice.' (lỗi word_order_error)"
---

# ===== item_key 4 · Đảo trợ động từ trong câu hỏi (question inversion: yes/no và wh-) =====

---
id: "wo_qinv_b1"
type: "mcq"
input: "choice"
headword: "wo-question-inversion"
skill: "form"
subtype: "basic"
prompt: "Choose the correct question."
options: ["You are a student?", "Are you a student?", "You a student are?", "Student are you a?"]
answer: 1
grammar_article_slug: "word-order"
explain: "Câu hỏi Yes/No phải đảo trợ động từ (be/do/can...) lên trước chủ ngữ: 'Are you a student?'"
why_wrong:
  '0': Câu này có cấu trúc của một câu khẳng định (statement), không phải câu hỏi Yes/No.
  '2': Trật tự từ của câu này sai ngữ pháp tiếng Anh, động từ 'are' không đứng cuối câu hỏi.
  '3': Trật tự từ trong câu này hoàn toàn sai, không tuân theo bất kỳ cấu trúc câu hỏi nào trong tiếng Anh.
---

---
id: "wo_qinv_b2"
type: "boolean"
input: "boolean"
headword: "wo-question-inversion"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'She does live here?' là câu hỏi đúng ngữ pháp."
answer: false
grammar_article_slug: "word-order"
explain: "SAI — trợ động từ 'does' phải đứng TRƯỚC chủ ngữ trong câu hỏi: 'Does she live here?' (lỗi word_order_error)"
---

---
id: "wo_qinv_i1"
type: "gap_mcq"
input: "choice"
headword: "wo-question-inversion"
skill: "usage"
subtype: "intermediate"
prompt: "____ you prepare for the speaking test — did you practise with a partner?"
options: ["How did", "How you did", "Did how", "You did how"]
answer: 0
grammar_article_slug: "word-order"
explain: "Câu hỏi Wh-: Wh-word + trợ động từ + Subject + Main Verb: 'How did you prepare...?'"
why_wrong:
  '1': Cấu trúc câu hỏi Wh-word đòi hỏi trợ động từ phải đứng trước chủ ngữ, không phải sau chủ ngữ.
  '2': Trong câu hỏi Wh-word, từ Wh- (how) phải đứng đầu câu, không phải sau trợ động từ.
  '3': Cấu trúc này không phải là một câu hỏi Wh-word trực tiếp; nó sai trật tự từ và Wh-word không được đặt ở cuối câu khi hỏi trực tiếp.
---

---
id: "wo_qinv_i2"
type: "gap_text"
input: "text"
headword: "wo-question-inversion"
skill: "production"
subtype: "intermediate"
prompt: "Viết câu hỏi đúng trật tự (đảo trợ động từ): 'you / where / do / live' → ____?"
accept: ["Where do you live", "where do you live"]
case_sensitive: false
grammar_article_slug: "word-order"
explain: "Wh-word (Where) + trợ động từ (do) + Subject (you) + Main Verb (live): 'Where do you live?'"
---

---
id: "wo_qinv_a1"
type: "boolean"
input: "boolean"
headword: "wo-question-inversion"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: nói 'You can help me?' với ngữ điệu lên giọng ở cuối câu là hoàn toàn không tự nhiên và không bao giờ được người bản ngữ sử dụng, kể cả trong văn nói thân mật."
answer: false
grammar_article_slug: "word-order"
explain: "SAI một phần — dạng không đảo trợ động từ (statement question) đôi khi được dùng trong văn nói rất thân mật để hỏi lại/xác nhận với ngữ điệu ngạc nhiên, nhưng trong IELTS Speaking nên dùng dạng chuẩn có đảo: 'Can you help me?'"
---

---
id: "wo_qinv_a2"
type: "mcq"
input: "choice"
headword: "wo-question-inversion"
skill: "error_id"
subtype: "advanced"
prompt: "Which of these IELTS Speaking Part 3 questions has correct word order?"
options: ["What you think about remote working?", "What do you think about remote working?", "What think you about remote working?", "You think what about remote working?"]
answer: 1
grammar_article_slug: "word-order"
explain: "Câu hỏi Wh- với động từ thường (think) bắt buộc có trợ động từ 'do': 'What do you think about remote working?' Thiếu 'do' hoặc không đảo trợ động từ là lỗi word_order_error."
---
