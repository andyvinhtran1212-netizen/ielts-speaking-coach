---
kind: quiz
code: "G-grammar-for-reading-long-sentence-untangling"
title: "Quick Check — Long Sentence Untangling"
skill_area: "grammar"
topic: "Grammar for Reading"
mode: "adaptive_mastery"
grading: "instant"
correct_to_master: 2
require_distinct_skill: true
require_production_to_master: true
cooldown: 2
shuffle_options: true
words_count: 3
source: "authored-2026-07"
---

# ===== item_key 1 · Tìm mệnh đề chính (chủ ngữ + động từ chính) =====

---
id: "lsu_main_b1"
type: "mcq"
input: "choice"
headword: "lsu-find-main-clause"
skill: "form"
subtype: "basic"
prompt: "Identify the core subject–main-verb pair of the main clause: 'Although the initial results seemed promising, the drug ultimately failed the final trial.'"
options: ["the drug failed", "results seemed", "drug seemed", "results failed"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "Cặp S + main V là 'the drug failed'. Mệnh đề chính đầy đủ là 'the drug ultimately failed the final trial'; failed the final trial có tân ngữ và ultimately là trạng từ. Mệnh đề Although là phần nhượng bộ; nhận diện khung không cho phép bỏ thông tin khi hiểu toàn câu."
---

---
id: "lsu_main_b2"
type: "gap_mcq"
input: "choice"
headword: "lsu-find-main-clause"
skill: "usage"
subtype: "basic"
prompt: "Which option identifies the core subject–main-verb pair of the main clause? 'When researchers conducted experiments with genetically modified seeds, productivity increased dramatically.'"
options: ["productivity increased", "researchers conducted", "experiments with seeds", "when productivity increased"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "Cặp S + main V là 'productivity increased'. Mệnh đề chính đầy đủ là 'productivity increased dramatically'; dramatically thêm cách thức/mức độ. When researchers conducted... là mệnh đề thời gian phụ trong cấu trúc câu này."
---

---
id: "lsu_main_i1"
type: "boolean"
input: "boolean"
headword: "lsu-find-main-clause"
skill: "error_id"
subtype: "intermediate"
prompt: "Đúng hay Sai: Trong câu 'Economists, who had analyzed data for five years, predicted a market collapse,' mệnh đề chính là 'who had analyzed data for five years'."
answer: false
grammar_article_slug: "long-sentence-untangling"
explain: "SAI — 'who had analyzed data for five years' là mệnh đề quan hệ bổ nghĩa cho Economists. Mệnh đề chính là 'Economists predicted a market collapse'; khung S + main V là 'Economists predicted'. Không nhầm phần bổ nghĩa với tân ngữ a market collapse."
---

---
id: "lsu_main_i2"
type: "gap_text"
input: "text"
headword: "lsu-find-main-clause"
skill: "production"
subtype: "intermediate"
prompt: "Viết khung chủ ngữ + động từ chính (S + main V); có thể viết thêm tân ngữ/bổ ngữ: 'Because climate change is accelerating, governments, which are increasingly under pressure, must implement radical strategies.' → ____"
accept: ["governments must implement", "governments must implement radical strategies", "Governments must implement"]
case_sensitive: false
grammar_article_slug: "long-sentence-untangling"
explain: "Tạm nhóm mệnh đề nguyên nhân 'Because climate change is accelerating' và mệnh đề quan hệ 'which are increasingly under pressure'. Khung S + main V được nhận là 'governments must implement'; mệnh đề chính đầy đủ là 'governments must implement radical strategies'. Khi hiểu toàn câu, ghép lại quan hệ nguyên nhân và phần bổ nghĩa."
---

---
id: "lsu_main_a1"
type: "boolean"
input: "boolean"
headword: "lsu-find-main-clause"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'Scientists from across Europe, collaborating on an ambitious project that required unprecedented funding, concluded that solar energy could revolutionize the continent's power infrastructure.' Ở đây, mệnh đề chính là 'collaborating on an ambitious project that required unprecedented funding'."
answer: false
grammar_article_slug: "long-sentence-untangling"
explain: "SAI — collaborating on... là phần phân từ bổ nghĩa cho Scientists, không phải mệnh đề chính. Khung S + main V là 'Scientists concluded'; mệnh đề chính đầy đủ giữ 'that solar energy could revolutionize the continent's power infrastructure' làm bổ ngữ nội dung của concluded. Tạm nhóm modifiers để nhìn khung không phải xóa nội dung kết luận."
---

---
id: "lsu_main_a2"
type: "mcq"
input: "choice"
headword: "lsu-find-main-clause"
skill: "form"
subtype: "advanced"
prompt: "Identify the core subject–main-verb pair of the main clause: 'Despite mounting evidence that pollution damages ecosystems, which has prompted international agreements, industrial nations, some of which had initially resisted, finally accepted carbon-reduction targets.'"
options: ["industrial nations accepted", "evidence damages", "pollution damages", "agreements prompted"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "Khung S + main V là 'industrial nations accepted'. Mệnh đề chính đầy đủ giữ 'finally accepted carbon-reduction targets'. Phần đầu Despite mounting evidence... là cụm giới từ, bên trong có mệnh đề nội dung that pollution damages ecosystems; các mệnh đề which... và some of which... bổ nghĩa. Không gọi toàn bộ cụm Despite là một mệnh đề riêng."
---

# ===== item_key 2 · Tạm nhóm các phần bổ nghĩa (giới từ, quan hệ, participle) =====

---
id: "lsu_strip_b1"
type: "mcq"
input: "choice"
headword: "lsu-strip-modifiers"
skill: "form"
subtype: "basic"
prompt: "Temporarily group the modifier phrases and identify the core sentence: 'The director of the film, with extensive experience in animation, chose a different approach.' What is the core sentence?"
options: ["The director chose a different approach", "the film chose", "director with experience chose", "animation chose"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "Tạm nhóm 'of the film' và 'with extensive experience in animation' để thấy khung 'The director chose a different approach'. Hai cụm bổ nghĩa vẫn cần được ghép lại khi hiểu ai là director và kinh nghiệm của người đó."
---

---
id: "lsu_strip_b2"
type: "gap_mcq"
input: "choice"
headword: "lsu-strip-modifiers"
skill: "usage"
subtype: "basic"
prompt: "Which participle clause can be temporarily grouped to find the core sentence? 'The study, conducted over a decade, revealed surprising patterns about climate cycles.'"
options: ["conducted over a decade", "revealed surprising patterns", "about climate cycles", "over a decade"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "'Conducted over a decade' là mệnh đề phân từ rút gọn bổ nghĩa cho 'study'. Tạm nhóm nó để thấy 'The study revealed surprising patterns about climate cycles', rồi ghép lại thông tin về thời gian nghiên cứu khi đọc nghĩa."
---

---
id: "lsu_strip_i1"
type: "boolean"
input: "boolean"
headword: "lsu-strip-modifiers"
skill: "error_id"
subtype: "intermediate"
prompt: "Đúng hay Sai: Trong câu 'Experts, recognizing the urgency of climate action, which is supported by overwhelming data, argue that solutions must be implemented immediately,' có thể tạm nhóm hai phần bổ nghĩa 'recognizing the urgency of climate action' và 'which is supported by overwhelming data' để nhìn khung chính, rồi ghép lại khi đọc nghĩa."
answer: true
grammar_article_slug: "long-sentence-untangling"
explain: "ĐÚNG — hai phần này là mệnh đề phân từ và mệnh đề quan hệ bổ nghĩa. Tạm nhóm chúng giúp thấy 'Experts argue that solutions must be implemented immediately'. Giữ mệnh đề nội dung 'that solutions...' và ghép lại thông tin bổ nghĩa để hiểu đủ câu."
---

---
id: "lsu_strip_i2"
type: "gap_text"
input: "text"
headword: "lsu-strip-modifiers"
skill: "production"
subtype: "intermediate"
prompt: "Tạm nhóm các phần bổ nghĩa rồi viết khung chủ ngữ + động từ chính (S + main V); có thể viết thêm tân ngữ/bổ ngữ: 'The results of the experiment, which lasted for eighteen months and involved hundreds of participants, demonstrated a clear correlation.' → ____"
accept: ["the results demonstrated", "The results demonstrated", "results demonstrated a clear correlation", "the results demonstrated a clear correlation"]
case_sensitive: false
grammar_article_slug: "long-sentence-untangling"
explain: "Tạm nhóm 'of the experiment' (cụm giới từ) và 'which lasted for eighteen months and involved hundreds of participants' (mệnh đề quan hệ). Khung S + main V được nhận là 'the results demonstrated'; mệnh đề chính đầy đủ là 'The results demonstrated a clear correlation'. Ghép lại phần bổ nghĩa khi đọc nghĩa, không bỏ thông tin khỏi cách hiểu câu."
---

---
id: "lsu_strip_a1"
type: "boolean"
input: "boolean"
headword: "lsu-strip-modifiers"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The observation that environmental factors, which had been largely ignored, play a crucial role in determining social outcomes, a finding that challenges traditional theories, marks a significant shift in academic thinking.' Hai bộ phận chêm 'which had been largely ignored' và 'a finding that challenges traditional theories' có thể tạm tách ra để nhìn khung chính."
answer: true
grammar_article_slug: "long-sentence-untangling"
explain: "ĐÚNG — phần đầu là mệnh đề quan hệ; phần sau là cụm danh từ đồng vị, bên trong có mệnh đề quan hệ 'that challenges traditional theories'. Tạm tách hai phần chêm này vẫn giữ 'The observation that environmental factors play a crucial role marks a significant shift in academic thinking'. Không bỏ nội dung 'that environmental factors play...' xác định điều được quan sát."
---

---
id: "lsu_strip_a2"
type: "mcq"
input: "choice"
headword: "lsu-strip-modifiers"
skill: "form"
subtype: "advanced"
prompt: "Identify which element is NOT a modifier and therefore should remain: 'The legislation, passed after intense negotiations between stakeholders representing diverse interests and approved by parliament despite considerable opposition, requires immediate implementation.' Which element must stay?"
options: ["requires immediate implementation", "passed after intense negotiations", "representing diverse interests", "despite considerable opposition"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "'Requires immediate implementation' là phần vị ngữ cần giữ, với động từ chính 'requires' và tân ngữ 'immediate implementation'. Các cụm trong phần chêm sau 'legislation' có thể tạm nhóm để nhìn khung 'The legislation requires immediate implementation'. Đây không phải quy tắc cho phép bỏ mọi mệnh đề phụ hoặc tân ngữ/bổ ngữ."
---

# ===== item_key 3 · Tránh nhầm động từ mệnh đề phụ làm động từ chính =====

---
id: "lsu_pitfall_i1"
type: "mcq"
input: "choice"
headword: "lsu-avoid-nested-verb-confusion"
skill: "error_id"
subtype: "intermediate"
prompt: "Which is the MAIN verb in this sentence? 'Although renewable energy sources have grown significantly in recent years, they remain a minor fraction of global energy supply.' "
options: ["remain", "grown", "have grown", "supply"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "'Have grown' là động từ trong mệnh đề phụ nhượng bộ bắt đầu bằng 'Although'. Động từ chính (của mệnh đề chính) là 'remain'."
---

---
id: "lsu_pitfall_i2"
type: "boolean"
input: "boolean"
headword: "lsu-avoid-nested-verb-confusion"
skill: "usage"
subtype: "intermediate"
prompt: "Đúng hay Sai: 'When multiple studies showed conflicting results, the committee decided to conduct further research.' Ở đây, 'showed' là động từ chính của câu."
answer: false
grammar_article_slug: "long-sentence-untangling"
explain: "SAI — 'showed' là động từ trong mệnh đề phụ mở đầu bằng 'When'. Động từ chính của câu là 'decided'."
---

---
id: "lsu_pitfall_i3"
type: "gap_text"
input: "text"
headword: "lsu-avoid-nested-verb-confusion"
skill: "production"
subtype: "intermediate"
prompt: "Viết khung chủ ngữ + động từ chính (S + main V); có thể giữ trạng từ và viết thêm tân ngữ/bổ ngữ: 'Because scientists discovered unprecedented ice loss in polar regions, which surprised even experts who had studied climate trends for decades, governments finally prioritized environmental policy.' → ____"
accept: ["governments prioritized", "governments finally prioritized", "Governments prioritized", "governments finally prioritized environmental policy", "governments prioritized environmental policy"]
case_sensitive: false
grammar_article_slug: "long-sentence-untangling"
explain: "'Discovered' và 'had studied' nằm trong các mệnh đề phụ. Khung S + main V là 'governments prioritized', có thể giữ 'finally'; mệnh đề chính đầy đủ là 'governments finally prioritized environmental policy'. Bài nhận khung ngắn hoặc mệnh đề đầy đủ, không gọi riêng cặp S + V là toàn bộ mệnh đề."
---

---
id: "lsu_pitfall_a1"
type: "boolean"
input: "boolean"
headword: "lsu-avoid-nested-verb-confusion"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'While agricultural productivity, which had increased dramatically following the introduction of new fertilizers, was being analyzed by economists and agronomists who debated its long-term impact, market prices unexpectedly collapsed.' Trong câu này, 'had increased' là động từ chính."
answer: false
grammar_article_slug: "long-sentence-untangling"
explain: "SAI — 'had increased' nằm trong mệnh đề quan hệ phụ 'which had increased...'. Động từ chính của câu (mệnh đề chính) là 'collapsed'."
---

---
id: "lsu_pitfall_a2"
type: "mcq"
input: "choice"
headword: "lsu-avoid-nested-verb-confusion"
skill: "form"
subtype: "advanced"
prompt: "What is the main action in this sentence? 'Researchers, whose preliminary findings had suggested a breakthrough but who subsequently encountered methodological challenges that delayed publication, ultimately demonstrated that the treatment was effective in clinical trials.' "
options: ["demonstrated", "suggested", "encountered", "delayed"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "Động từ của mệnh đề chính là demonstrated. Suggested nằm trong mệnh đề whose preliminary findings had suggested..., encountered trong who subsequently encountered..., và delayed trong that delayed publication bổ nghĩa cho methodological challenges. Giữ mệnh đề nội dung that the treatment was effective... khi hiểu điều được chứng minh."
---
