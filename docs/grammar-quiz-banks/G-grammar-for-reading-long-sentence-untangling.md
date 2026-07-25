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
prompt: "Identify the main clause in this sentence: 'Although the initial results seemed promising, the drug ultimately failed the final trial.' Which subject-verb pair is the main clause?"
options: ["the drug failed", "results seemed", "drug seemed", "results failed"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "Mệnh đề chính là cặp chủ ngữ + động từ **không** bắt đầu bằng liên từ phụ thuộc (although, because, when, if...). Ở đây, 'Although...' mở một mệnh đề phụ nhượng bộ, nên mệnh đề chính là 'the drug failed'."
---

---
id: "lsu_main_b2"
type: "gap_mcq"
input: "choice"
headword: "lsu-find-main-clause"
skill: "usage"
subtype: "basic"
prompt: "Which is the main clause? 'When researchers conducted experiments with genetically modified seeds, productivity increased dramatically.' "
options: ["productivity increased", "researchers conducted", "experiments with seeds", "when productivity increased"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "Mệnh đề 'When researchers conducted...' bắt đầu bằng 'When' (liên từ), nên đó là mệnh đề phụ. Mệnh đề chính là 'productivity increased dramatically' — đó là ý chính của câu."
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
explain: "SAI — mệnh đề quan hệ 'who had analyzed data for five years' là mệnh đề phụ bổ ngữ. Mệnh đề chính là 'Economists predicted a market collapse' (chủ ngữ = Economists, động từ = predicted)."
---

---
id: "lsu_main_i2"
type: "gap_text"
input: "text"
headword: "lsu-find-main-clause"
skill: "production"
subtype: "intermediate"
prompt: "Identify the main clause: 'Because climate change is accelerating, governments, which are increasingly under pressure, must implement radical strategies.' → ____"
accept: ["governments must implement", "governments must implement radical strategies", "Governments must implement"]
case_sensitive: false
grammar_article_slug: "long-sentence-untangling"
explain: "Gạch bỏ mệnh đề phụ nhượng bộ 'Because climate change is accelerating' và mệnh đề quan hệ 'which are increasingly under pressure', lộ ra mệnh đề chính: 'governments must implement radical strategies'."
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
explain: "SAI — 'collaborating on...' là cụm participle rút gọn bổ ngữ cho 'Scientists', không phải mệnh đề chính. Mệnh đề chính là 'Scientists concluded that solar energy could revolutionize...' (không lược bỏ, đây là câu động từ)."
---

---
id: "lsu_main_a2"
type: "mcq"
input: "choice"
headword: "lsu-find-main-clause"
skill: "form"
subtype: "advanced"
prompt: "In this sentence, what is the main subject-verb relationship? 'Despite mounting evidence that pollution damages ecosystems, which has prompted international agreements, industrial nations, some of which had initially resisted, finally accepted carbon-reduction targets.' Identify the true main clause:"
options: ["industrial nations accepted", "evidence damages", "pollution damages", "agreements prompted"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "Mệnh đề 'Despite...' mở bằng giới từ (không phải liên từ). Mệnh đề quan hệ 'which has prompted...' và 'some of which had initially resisted' đều là bổ ngữ. Mệnh đề chính duy nhất là 'industrial nations accepted carbon-reduction targets'."
---

# ===== item_key 2 · Gạch các cụm bổ ngữ (giới từ, quan hệ, participle) =====

---
id: "lsu_strip_b1"
type: "mcq"
input: "choice"
headword: "lsu-strip-modifiers"
skill: "form"
subtype: "basic"
prompt: "Remove the modifier phrase and identify what remains: 'The director of the film, with extensive experience in animation, chose a different approach.' After removing the modifier, what is the core sentence?"
options: ["The director chose a different approach", "the film chose", "director with experience chose", "animation chose"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "Cụm giới từ 'of the film' và 'with extensive experience in animation' đều bổ ngữ cho 'director'. Gạch chúng đi, câu lõi còn: 'The director chose a different approach'."
---

---
id: "lsu_strip_b2"
type: "gap_mcq"
input: "choice"
headword: "lsu-strip-modifiers"
skill: "usage"
subtype: "basic"
prompt: "Which clause is a modifier that should be removed? 'The study, conducted over a decade, revealed surprising patterns about climate cycles.' "
options: ["conducted over a decade", "revealed surprising patterns", "about climate cycles", "over a decade"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "'Conducted over a decade' là mệnh đề quan hệ rút gọn (participle clause), bổ ngữ cho 'study'. Gạch nó, câu lõi là 'The study revealed surprising patterns about climate cycles'."
---

---
id: "lsu_strip_i1"
type: "boolean"
input: "boolean"
headword: "lsu-strip-modifiers"
skill: "error_id"
subtype: "intermediate"
prompt: "Đúng hay Sai: Trong câu 'Experts, recognizing the urgency of climate action, which is supported by overwhelming data, argue that solutions must be implemented immediately,' nên gạch bỏ cả hai bộ phận: 'recognizing the urgency of climate action' và 'which is supported by overwhelming data'."
answer: true
grammar_article_slug: "long-sentence-untangling"
explain: "ĐÚNG — cả hai đều là bổ ngữ (participle clause + relative clause). Gạch cả hai, câu chính là: 'Experts argue that solutions must be implemented immediately'."
---

---
id: "lsu_strip_i2"
type: "gap_text"
input: "text"
headword: "lsu-strip-modifiers"
skill: "production"
subtype: "intermediate"
prompt: "Strip all modifiers: 'The results of the experiment, which lasted for eighteen months and involved hundreds of participants, demonstrated a clear correlation.' → ____"
accept: ["the results demonstrated", "The results demonstrated", "results demonstrated a clear correlation"]
case_sensitive: false
grammar_article_slug: "long-sentence-untangling"
explain: "'Of the experiment' (cụm giới từ) và 'which lasted for eighteen months and involved hundreds of participants' (mệnh đề quan hệ) đều là bổ ngữ. Gạch đi, câu lõi = 'The results demonstrated a clear correlation'."
---

---
id: "lsu_strip_a1"
type: "boolean"
input: "boolean"
headword: "lsu-strip-modifiers"
skill: "contrast"
subtype: "advanced"
prompt: "Đúng hay Sai: 'The observation that environmental factors, which had been largely ignored, play a crucial role in determining social outcomes, a finding that challenges traditional theories, marks a significant shift in academic thinking.' Các mệnh đề 'which had been largely ignored' và 'a finding that challenges traditional theories' đều nên được bỏ để lộ mệnh đề chính."
answer: true
grammar_article_slug: "long-sentence-untangling"
explain: "ĐÚNG — 'which had been largely ignored' (relative clause) và 'a finding that challenges traditional theories' (appositive clause) đều là bổ ngữ. Gạch chúng, mệnh đề chính là: 'The observation that environmental factors play a crucial role marks a shift in academic thinking'."
---

---
id: "lsu_strip_a2"
type: "mcq"
input: "choice"
headword: "lsu-strip-modifiers"
skill: "form"
subtype: "advanced"
prompt: "Identify which element is NOT a modifier and therefore should remain: 'The legislation, passed after intense negotiations between stakeholders representing diverse interests and approved by parliament despite considerable opposition, requires immediate implementation.' Which clause must stay?"
options: ["requires immediate implementation", "passed after intense negotiations", "representing diverse interests", "despite considerable opposition"]
answer: 0
grammar_article_slug: "long-sentence-untangling"
explain: "'Requires immediate implementation' là mệnh đề chính (động từ chính = requires). Các phần còn lại ('passed after...', 'representing...', 'despite opposition') đều là bổ ngữ cho 'legislation'. Chỉ mệnh đề chính mới bắt buộc."
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
prompt: "What is the main clause? 'Because scientists discovered unprecedented ice loss in polar regions, which surprised even experts who had studied climate trends for decades, governments finally prioritized environmental policy.' → ____"
accept: ["governments prioritized", "governments finally prioritized", "Governments prioritized"]
case_sensitive: false
grammar_article_slug: "long-sentence-untangling"
explain: "'Discovered' và 'had studied' là các động từ trong mệnh đề phụ. Động từ chính của mệnh đề chính là 'prioritized' (chủ ngữ = governments)."
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
explain: "'Suggested', 'encountered', 'delayed' đều là động từ trong các mệnh đề quan hệ phụ (bắt đầu bằng 'whose', 'who'). Động từ chính (của mệnh đề chính) là 'demonstrated'."
---
