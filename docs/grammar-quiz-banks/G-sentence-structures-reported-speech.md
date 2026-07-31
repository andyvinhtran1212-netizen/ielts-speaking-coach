---
kind: quiz
code: "G-sentence-structures-reported-speech"
title: "Quick Check — Reported Speech"
skill_area: "grammar"
topic: "Sentence Structures"
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

# ===== item_key 1 · Backshift — lùi thì động từ (lỗi mục tiêu: wrong_tense) =====

---
id: "rs_back_b1"
type: "mcq"
input: "choice"
headword: "rs-backshift"
skill: "form"
subtype: "basic"
prompt: "\"I am tired,\" she said. → She said she ____ tired."
options: ["was", "is", "has been", "were"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "Present Simple ('am') lùi thành Past Simple ('was') khi tường thuật."
---

---
id: "rs_back_b2"
type: "mcq"
input: "choice"
headword: "rs-backshift"
skill: "form"
subtype: "basic"
prompt: "\"I will help you,\" he promised. → He promised he ____ help me."
options: ["would", "will", "can", "should"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "'will' lùi thành 'would' trong reported speech."
---

---
id: "rs_back_i1"
type: "gap_mcq"
input: "choice"
headword: "rs-backshift"
skill: "usage"
subtype: "intermediate"
prompt: "\"I have finished the report,\" she said. → She said she ____ the report."
options: ["had finished", "has finished", "finished", "was finishing"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "Present Perfect ('have finished') lùi thành Past Perfect ('had finished') khi tường thuật."
---

---
id: "rs_back_i2"
type: "gap_text"
input: "text"
headword: "rs-backshift"
skill: "production"
subtype: "intermediate"
prompt: "Chia đúng động từ (backshift): \"You must leave,\" she told me. → She told me I ____ (must) leave."
accept: ["had to"]
case_sensitive: false
grammar_article_slug: "reported-speech"
explain: "'must' (bắt buộc) lùi thành 'had to' trong reported speech."
---

---
id: "rs_back_a1"
type: "boolean"
input: "boolean"
headword: "rs-backshift"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'He said he is tired.' là câu tường thuật đúng thì."
answer: false
grammar_article_slug: "reported-speech"
explain: "SAI — thiếu backshift, 'is' phải lùi thành 'was'. Sửa: 'He said he was tired.'"
---

---
id: "rs_back_a2"
type: "boolean"
input: "boolean"
headword: "rs-backshift"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She told me she will come.' là câu tường thuật đúng thì."
answer: false
grammar_article_slug: "reported-speech"
explain: "SAI — 'will' phải lùi thành 'would' vì động từ tường thuật ('told') ở quá khứ. Sửa: 'She told me she would come.'"
---

# ===== item_key 2 · Đổi đại từ và trạng từ thời gian/nơi chốn =====

---
id: "rs_pron_b1"
type: "mcq"
input: "choice"
headword: "rs-pronoun-adverb-shift"
skill: "form"
subtype: "basic"
prompt: "\"I will call you tomorrow,\" he said. → He said he would call me ____."
options: ["the next day", "tomorrow", "today", "yesterday"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "'tomorrow' trong lời nói trực tiếp đổi thành 'the next day' (hoặc 'the following day') khi tường thuật, vì mốc thời gian tham chiếu đã dịch chuyển."
---

---
id: "rs_pron_b2"
type: "mcq"
input: "choice"
headword: "rs-pronoun-adverb-shift"
skill: "form"
subtype: "basic"
prompt: "\"I finished yesterday,\" he said. → He said he had finished ____."
options: ["the day before", "yesterday", "tomorrow", "now"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "'yesterday' đổi thành 'the day before' (hoặc 'the previous day') trong reported speech."
---

---
id: "rs_pron_i1"
type: "gap_mcq"
input: "choice"
headword: "rs-pronoun-adverb-shift"
skill: "usage"
subtype: "intermediate"
prompt: "\"I'm working here now,\" she said. → She said she was working ____ ____."
options: ["there / then", "here / now", "there / now", "here / then"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "'here' → 'there' và 'now' → 'then' khi tường thuật, vì cả nơi chốn lẫn thời điểm tham chiếu đều thay đổi."
---

---
id: "rs_pron_i2"
type: "gap_text"
input: "text"
headword: "rs-pronoun-adverb-shift"
skill: "production"
subtype: "intermediate"
prompt: "Đổi trạng từ đúng: \"We will announce the results tomorrow,\" the company said. → The company said they would announce the results ____."
accept: ["the next day", "the following day"]
case_sensitive: false
grammar_article_slug: "reported-speech"
explain: "'tomorrow' phải đổi thành 'the next day'/'the following day' vì mốc 'ngày mai' được tính từ lúc nói, không còn đúng khi tường thuật sau đó."
---

---
id: "rs_pron_a1"
type: "boolean"
input: "boolean"
headword: "rs-pronoun-adverb-shift"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: He said \"I will come tomorrow.\" tường thuật đúng là 'He said he would come tomorrow.'"
answer: false
grammar_article_slug: "reported-speech"
explain: "SAI — quên đổi trạng từ thời gian. Sửa: 'He said he would come the next day.' ('tomorrow' phải đổi vì không còn đúng ngữ cảnh thời gian tường thuật)."
---

# ===== item_key 3 · Tường thuật câu hỏi (không đảo ngữ) =====

---
id: "rs_ques_b1"
type: "mcq"
input: "choice"
headword: "rs-questions"
skill: "form"
subtype: "basic"
prompt: "\"Do you like music?\" he asked. → He asked ____ I liked music."
options: ["if", "that", "what", "so"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "Câu hỏi Yes/No tường thuật bằng 'if' hoặc 'whether' + S + V (không đảo ngữ)."
---

---
id: "rs_ques_i1"
type: "gap_mcq"
input: "choice"
headword: "rs-questions"
skill: "usage"
subtype: "intermediate"
prompt: "\"Where do you live?\" she asked. → She asked ____."
options: ["where I lived", "where did I live", "where I live", "where do I live"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "Wh-question tường thuật: wh-word + S + V, KHÔNG đảo ngữ, và có backshift (do you live → I lived)."
---

---
id: "rs_ques_i2"
type: "gap_text"
input: "text"
headword: "rs-questions"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại câu hỏi tường thuật, không đảo ngữ: \"Why did you leave early?\" he asked her. → He asked her why ____ (leave) early."
accept: ["she had left"]
case_sensitive: false
grammar_article_slug: "reported-speech"
explain: "Wh-question + không đảo ngữ + backshift: Past Simple ('did leave') → Past Perfect ('had left') vì hành động xảy ra trước thời điểm tường thuật."
---

---
id: "rs_ques_a1"
type: "boolean"
input: "boolean"
headword: "rs-questions"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She asked where did I live.' là câu tường thuật đúng."
answer: false
grammar_article_slug: "reported-speech"
explain: "SAI — tường thuật câu hỏi không đảo ngữ. Sửa: 'She asked where I lived.'"
---

---
id: "rs_ques_a2"
type: "boolean"
input: "boolean"
headword: "rs-questions"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'He asked what was I doing.' là câu tường thuật đúng."
answer: false
grammar_article_slug: "reported-speech"
explain: "SAI — vẫn còn đảo ngữ ('was I'). Sửa: 'He asked what I was doing.'"
---

# ===== item_key 4 · say/tell, mệnh lệnh, reporting verbs =====

---
id: "rs_verb_b1"
type: "mcq"
input: "choice"
headword: "rs-say-tell-commands"
skill: "form"
subtype: "basic"
prompt: "Chọn câu đúng (say vs tell):"
options: ["She told me she was tired.", "She said me that she was tired.", "She told that she was tired.", "She said to me she was tired without that."]
answer: 0
grammar_article_slug: "reported-speech"
explain: "'tell' luôn cần tân ngữ chỉ người ngay sau nó: 'told me'. 'say' thì không cần tân ngữ người ('said (that)...'), nên 'said me' và 'told that' đều sai cấu trúc."
---

---
id: "rs_verb_b2"
type: "mcq"
input: "choice"
headword: "rs-say-tell-commands"
skill: "form"
subtype: "basic"
prompt: "\"Close the door!\" he said. → He told me ____ the door."
options: ["to close", "close", "closing", "closed"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "Tường thuật mệnh lệnh: told/asked + O + to-infinitive. 'Close the door!' → 'told me to close the door.'"
---

---
id: "rs_verb_i1"
type: "gap_mcq"
input: "choice"
headword: "rs-say-tell-commands"
skill: "usage"
subtype: "intermediate"
prompt: "\"Don't be late!\" he warned. → He warned me ____ late."
options: ["not to be", "to not be", "don't be", "not be"]
answer: 0
grammar_article_slug: "reported-speech"
explain: "Mệnh lệnh phủ định: told/warned + O + NOT to + infinitive. Đúng thứ tự: 'not to be'."
---

---
id: "rs_verb_i2"
type: "gap_text"
input: "text"
headword: "rs-say-tell-commands"
skill: "production"
subtype: "intermediate"
prompt: "Viết lại bằng 'suggested', đúng cấu trúc: \"You should exercise more,\" the doctor said. → The doctor suggested ____ (I / exercise) more. (chia động từ dạng V-ing)"
accept: ["exercising"]
case_sensitive: false
grammar_article_slug: "reported-speech"
explain: "'suggest' đi với V-ing (suggest + V-ing) hoặc 'suggest that + S + (should) + V'. Không dùng 'suggest sb to V' (lỗi phổ biến)."
---

---
id: "rs_verb_a1"
type: "boolean"
input: "boolean"
headword: "rs-say-tell-commands"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'She suggested me to try again.' là câu đúng ngữ pháp."
answer: false
grammar_article_slug: "reported-speech"
explain: "SAI — 'suggest' không đi với cấu trúc 'suggest sb to V'. Sửa: 'She suggested (that) I try again.' hoặc 'She suggested trying again.'"
---

---
id: "rs_verb_a2"
type: "boolean"
input: "boolean"
headword: "rs-say-tell-commands"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: 'He denied stealing anything.' tường thuật đúng cho lời nói gốc \"I didn't steal anything.\""
answer: true
grammar_article_slug: "reported-speech"
explain: "ĐÚNG — 'deny' đi với V-ing ('deny + V-ing') để diễn tả phủ nhận một hành động, đây là cách tường thuật tự nhiên và chính xác."
---
