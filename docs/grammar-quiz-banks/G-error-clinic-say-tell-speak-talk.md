---
kind: quiz
code: "G-error-clinic-say-tell-speak-talk"
title: "Quick Check — Say, Tell, Speak, Talk"
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

# ===== item_key 1 · SAY — nói gì, không tân ngữ người trực tiếp =====

---
id: "stst_say_b1"
type: "mcq"
input: "choice"
headword: "stst-say"
skill: "form"
subtype: "basic"
prompt: "She ____ it was a great idea."
options: ["said", "told", "spoke", "talked"]
answer: 0
grammar_article_slug: "say-tell-speak-talk"
explain: "'say' + mệnh đề nội dung (không cần tân ngữ người nghe) → said. 'told' bắt buộc phải có người nghe ngay sau nó."
---

---
id: "stst_say_i1"
type: "gap_mcq"
input: "choice"
headword: "stst-say"
skill: "usage"
subtype: "intermediate"
prompt: "Many people ____ that technology is making us less social."
options: ["say", "tell", "speak", "talk"]
answer: 0
grammar_article_slug: "say-tell-speak-talk"
explain: "Nêu quan điểm chung chung (nội dung, không nhắm vào người nghe cụ thể) → say that. Đây là mẫu câu rất phổ biến ở Speaking Part 3."
why_wrong:
  '1': 'Tell thường cần một tân ngữ chỉ người đi kèm (ví dụ: tell someone that...) chứ không đứng một mình với mệnh đề "that" để nêu quan điểm chung chung.'
  '2': Speak thường dùng để chỉ hành động nói, khả năng nói, hoặc nói chuyện trang trọng, không phù hợp để trực tiếp theo sau bởi mệnh đề "that" nhằm diễn đạt một ý kiến hay quan điểm phổ biến.
  '3': Talk thường ngụ ý một cuộc trò chuyện thân mật hoặc cần giới từ đi kèm (talk about/to/with) chứ không theo sau trực tiếp bởi mệnh đề "that" để đưa ra một phát biểu chung.
---

---
id: "stst_say_i2"
type: "gap_text"
input: "text"
headword: "stst-say"
skill: "production"
subtype: "intermediate"
prompt: "Don't forget to ____ (say) thank you when someone helps you."
accept: ["say"]
case_sensitive: false
grammar_article_slug: "say-tell-speak-talk"
explain: "Collocation cố định: say thank you / say sorry / say hello — không dùng tell/speak/talk trong các cụm này."
---

---
id: "stst_say_a1"
type: "boolean"
input: "boolean"
headword: "stst-say"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She said me to stop talking.'"
answer: false
grammar_article_slug: "say-tell-speak-talk"
explain: "SAI (collocation_error) — 'say' không đi kèm tân ngữ người nghe trực tiếp. Phải dùng tell: 'She told me to stop talking.'"
---

---
id: "stst_say_a2"
type: "mcq"
input: "choice"
headword: "stst-say"
skill: "error_id"
subtype: "advanced"
prompt: "Câu nào SAI về collocation?"
options: ["She said a prayer before the meal.", "He said me the answer.", "He didn't say a word during the meeting.", "She said goodbye and left."]
answer: 1
grammar_article_slug: "say-tell-speak-talk"
explain: "SAI (collocation_error) — 'said me' thiếu giới từ và sai động từ: cần 'told me the answer' (tell + người nghe) hoặc 'said the answer to me'."
---

# ===== item_key 2 · TELL — bắt buộc tân ngữ người nghe =====

---
id: "stst_tell_b1"
type: "mcq"
input: "choice"
headword: "stst-tell"
skill: "form"
subtype: "basic"
prompt: "Can you ____ me the way to the station?"
options: ["say", "tell", "speak", "talk"]
answer: 1
grammar_article_slug: "say-tell-speak-talk"
explain: "Sau 'tell' luôn phải có tân ngữ chỉ người nghe ('me'): tell someone something."
why_wrong:
  '0': Trong ngữ cảnh này, 'say' không đi trực tiếp với tân ngữ chỉ người ('me') mà thường cần giới từ 'to' (say to me) hoặc dùng với cấu trúc tường thuật khác.
  '2': '''Speak'' thường dùng để chỉ hành động nói chuyện, giao tiếp hoặc nói một ngôn ngữ, và không đi với cấu trúc tân ngữ kép ''speak someone something'' như trong câu hỏi.'
  '3': '''Talk'' chỉ hành động trò chuyện, thường là hai chiều hoặc về một chủ đề, và không thể đi trực tiếp với tân ngữ chỉ người (''me'') để truyền đạt thông tin theo cách này.'
---

---
id: "stst_tell_b2"
type: "boolean"
input: "boolean"
headword: "stst-tell"
skill: "error_id"
subtype: "basic"
prompt: "Đúng hay Sai: 'Always tell the truth.'"
answer: true
grammar_article_slug: "say-tell-speak-talk"
explain: "ĐÚNG — 'tell the truth' là collocation cố định, không cần thêm tân ngữ người nghe vì 'the truth' đã là tân ngữ nội dung."
---

---
id: "stst_tell_i1"
type: "gap_mcq"
input: "choice"
headword: "stst-tell"
skill: "usage"
subtype: "intermediate"
prompt: "He ____ a funny story about his childhood at the party."
options: ["said", "told", "spoke", "talked"]
answer: 1
grammar_article_slug: "say-tell-speak-talk"
explain: "Collocation cố định: tell a story / tell a joke / tell a lie — dùng tell, không dùng say/speak/talk."
why_wrong:
  '0': Sai vì "say" thường được dùng với lời nói trực tiếp hoặc để tuyên bố một điều gì đó, không dùng để kể một câu chuyện.
  '2': Sai vì "speak" thường chỉ hành động nói chuyện, diễn thuyết, hoặc khả năng sử dụng ngôn ngữ, không phải để kể một câu chuyện.
  '3': Sai vì "talk" thường dùng để chỉ việc trò chuyện hoặc thảo luận, không có cấu trúc "talk a story" để kể một câu chuyện.
---

---
id: "stst_tell_i2"
type: "gap_text"
input: "text"
headword: "stst-tell"
skill: "production"
subtype: "intermediate"
prompt: "It's hard to ____ (tell) the difference between the two designs."
accept: ["tell"]
case_sensitive: false
grammar_article_slug: "say-tell-speak-talk"
explain: "Collocation cố định: tell the difference (giữa hai thứ) — không dùng say/speak/talk the difference."
---

---
id: "stst_tell_a1"
type: "boolean"
input: "boolean"
headword: "stst-tell"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The twins are so similar I can't tell apart them.'"
answer: false
grammar_article_slug: "say-tell-speak-talk"
explain: "SAI (collocation_error) — thứ tự đúng của cụm là 'tell them apart' (tân ngữ chen giữa tell và apart), không phải 'tell apart them'."
---

# ===== item_key 3 · SPEAK — trang trọng, ngôn ngữ, cần giới từ =====

---
id: "stst_speak_b1"
type: "mcq"
input: "choice"
headword: "stst-speak"
skill: "form"
subtype: "basic"
prompt: "She ____ three languages fluently."
options: ["says", "tells", "speaks", "talks"]
answer: 2
grammar_article_slug: "say-tell-speak-talk"
explain: "Collocation cố định 'speak + language' (speak English/Japanese/three languages) — chỉ dùng speak, không dùng say/tell/talk."
why_wrong:
  '0': Say không dùng để diễn tả khả năng sử dụng hoặc biết một ngôn ngữ.
  '1': Tell cần một tân ngữ chỉ người hoặc một câu chuyện/thông tin được kể, không dùng với ngôn ngữ.
  '3': 'Talk thường cần giới từ (ví dụ: talk in a language, talk to someone) hoặc dùng để chỉ hành động giao tiếp, không diễn tả khả năng sử dụng một ngôn ngữ.'
---

---
id: "stst_speak_i1"
type: "gap_mcq"
input: "choice"
headword: "stst-speak"
skill: "usage"
subtype: "intermediate"
prompt: "I'd like to ____ with the manager, please — it's a formal request."
options: ["say", "tell", "speak", "talk"]
answer: 2
grammar_article_slug: "say-tell-speak-talk"
explain: "'speak to/with someone' trang trọng hơn 'talk to/with someone', phù hợp trong ngữ cảnh formal như xin gặp quản lý."
why_wrong:
  '0': '''Say'' thường dùng để thuật lại lời nói hoặc thể hiện một ý kiến, không dùng với giới từ ''with someone'' để diễn tả ý muốn trò chuyện.'
  '1': '''Tell'' thường được dùng để kể, truyền đạt thông tin hoặc ra lệnh cho ai đó, không dùng với ''with someone'' để chỉ việc trò chuyện.'
  '3': '''Talk'' tuy có nghĩa là trò chuyện nhưng ít trang trọng hơn ''speak'' và không phù hợp bằng trong một yêu cầu chính thức (''formal request'') như ngữ cảnh này.'
---

---
id: "stst_speak_i2"
type: "gap_mcq"
input: "choice"
headword: "stst-speak"
skill: "contrast"
subtype: "intermediate"
prompt: "Everyone ____ highly of her work — it's a fixed collocation, not 'talk highly of'."
options: ["says", "tells", "speaks", "talks"]
answer: 2
grammar_article_slug: "say-tell-speak-talk"
explain: "Collocation cố định: speak highly of (khen ngợi ai/cái gì). 'talk' không kết hợp với 'highly of' trong cụm này."
why_wrong:
  '0': Từ "says" thường được dùng để nói ra một điều gì đó trực tiếp (say something) hoặc dùng với mệnh đề (say that...), không kết hợp với "highly of" trong cụm từ cố định này.
  '1': Động từ "tells" cần có tân ngữ gián tiếp (tell someone something) hoặc dùng để kể chuyện, không phù hợp với cấu trúc "highly of" để diễn đạt sự khen ngợi trong thành ngữ này.
  '3': Cụm từ "talk highly of" không phải là một collocation chính xác; "talk" không kết hợp với "highly of" trong thành ngữ mang nghĩa khen ngợi này.
---

---
id: "stst_speak_i3"
type: "gap_text"
input: "text"
headword: "stst-speak"
skill: "production"
subtype: "intermediate"
prompt: "Can I ____ (speak) Dr. Johnson, please? — write the base verb + preposition."
accept: ["speak to"]
case_sensitive: false
grammar_article_slug: "say-tell-speak-talk"
explain: "'speak' cần giới từ 'to' (hoặc 'with') khi đi kèm người nghe: speak to someone. Thiếu giới từ là lỗi collocation rất phổ biến."
---

---
id: "stst_speak_a1"
type: "boolean"
input: "boolean"
headword: "stst-speak"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Can I speak you for a moment?'"
answer: false
grammar_article_slug: "say-tell-speak-talk"
explain: "SAI (collocation_error) — 'speak' cần giới từ trước tân ngữ người nghe: 'Can I speak to/with you for a moment?'"
---

# ===== item_key 4 · TALK — thân mật, hội thoại hai chiều =====

---
id: "stst_talk_b1"
type: "mcq"
input: "choice"
headword: "stst-talk"
skill: "form"
subtype: "basic"
prompt: "Let's ____ about your future plans."
options: ["say", "tell", "speak", "talk"]
answer: 3
grammar_article_slug: "say-tell-speak-talk"
explain: "Collocation cố định 'talk about + topic' — thân mật, dùng cho hội thoại hai chiều về một chủ đề."
why_wrong:
  '0': Say không đi với giới từ 'about' để nói về một chủ đề trong ngữ cảnh trò chuyện hai chiều.
  '1': Tell cần có tân ngữ gián tiếp (người được kể) trước khi nói về một điều gì đó ('tell someone about something').
  '2': Speak about thường dùng trong ngữ cảnh trang trọng hơn hoặc khi nói một chiều, ít phù hợp với lời mời trò chuyện thân mật, hai chiều ('Let's...').
---

---
id: "stst_talk_i1"
type: "gap_mcq"
input: "choice"
headword: "stst-talk"
skill: "usage"
subtype: "intermediate"
prompt: "My friends and I often ____ about music and films — it's a casual, everyday chat."
options: ["say", "tell", "speak", "talk"]
answer: 3
grammar_article_slug: "say-tell-speak-talk"
explain: "'talk about' phù hợp ngữ cảnh thân mật, đời thường (khác với 'speak about' trang trọng hơn, dùng cho thuyết trình/hội nghị)."
why_wrong:
  '0': Say không dùng với giới từ "about" để diễn tả việc trò chuyện hay thảo luận về một chủ đề.
  '1': Tell thường cần một tân ngữ là người nghe (tell someone something) và không dùng để mô tả một cuộc trò chuyện chung về một chủ đề.
  '2': Speak about mang sắc thái trang trọng hơn và không phù hợp với ngữ cảnh "casual, everyday chat" (trò chuyện thân mật, đời thường).
---

---
id: "stst_talk_i2"
type: "gap_text"
input: "text"
headword: "stst-talk"
skill: "production"
subtype: "intermediate"
prompt: "She's ____ (talk) her friend on the phone right now — write the -ing form with the correct preposition."
accept: ["talking to", "talking with"]
case_sensitive: false
grammar_article_slug: "say-tell-speak-talk"
explain: "'talk' cần giới từ 'to' hoặc 'with' trước tân ngữ người nghe: talk to/with someone (giống 'speak to/with' nhưng thân mật hơn)."
---

---
id: "stst_talk_a1"
type: "boolean"
input: "boolean"
headword: "stst-talk"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She talked me about her trip.'"
answer: false
grammar_article_slug: "say-tell-speak-talk"
explain: "SAI (collocation_error) — 'talk' không lấy tân ngữ trực tiếp chỉ người nghe; cần giới từ: 'She talked to me about her trip.' (hoặc 'told me about her trip')."
---

---
id: "stst_talk_a2"
type: "mcq"
input: "choice"
headword: "stst-talk"
skill: "contrast"
subtype: "advanced"
prompt: "Chọn câu ĐÚNG collocation, phân biệt speak vs talk trong ngữ cảnh trang trọng:"
options: ["He talked at the annual conference.", "He spoke at the annual conference.", "He talked highly of the report.", "He said at the annual conference."]
answer: 1
grammar_article_slug: "say-tell-speak-talk"
explain: "Ngữ cảnh trang trọng (hội nghị, bài phát biểu) ưu tiên 'speak at a conference'; 'talk' thiên về hội thoại thân mật hai chiều."
why_wrong:
  '0': Động từ "talked" thường dùng cho các cuộc trò chuyện thân mật hoặc đối thoại hai chiều, không phù hợp với ngữ cảnh trang trọng của một bài phát biểu tại hội nghị.
  '2': Mặc dù "talk highly of" là một thành ngữ đúng, câu hỏi này yêu cầu phân biệt "speak" và "talk" trong ngữ cảnh trình bày một bài phát biểu trang trọng, chứ không phải diễn đạt ý kiến.
  '3': Động từ "said" thường cần một tân ngữ trực tiếp (nói cái gì) hoặc dùng trong câu tường thuật, không diễn tả hành động phát biểu chính thức tại một hội nghị.
---
