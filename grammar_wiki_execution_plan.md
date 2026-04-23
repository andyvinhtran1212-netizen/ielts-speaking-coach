# Grammar Wiki Remediation - Execution Plan

## Overview
This document provides an operational plan for the Grammar Wiki remediation backlog. The tasks are divided into 5 distinct batches (A through E). The plan organizes work by batch, summarizing the files, problem types, risk level, and expected effort, and provides an execution sequence for each batch.

> [!WARNING]
> **Overlapping Files:** `parts-of-speech/verbs.md`, `parts-of-speech/pronouns.md`, and `parts-of-speech/nouns.md` are touched in multiple batches. Ensure Batch A and B structural/link changes are completed before executing the pedagogical rewrites in Batch D.

---

## Batch A: Critical Metadata & Stale Links
**Files Included:**
- `advanced/articles.md`
- `error-clinic/missing-subjects.md`
- `error-clinic/missing-main-verbs.md`
- `modifiers/adverbs.md`
- `modifiers/adjective-vs-adverb.md`
- `verb-patterns/gerund-vs-infinitive.md`
- `parts-of-speech/verbs.md`
- `parts-of-speech/pronouns.md`
- `grammar-for-meaning/academic-hedging.md`

**Main Problem Types:** Category/metadata mismatches, broken/stale body links, progression weaknesses.  
**Overall Risk:** Critical (affects core navigation, schema compatibility, and categorization).  
**Expected Effort:** Medium (primarily light fixes, with some medium effort for progression/pedagogy on overlapping files).  

### Execution Strategy
1. **Fix First (Critical Metadata):** Start with the Critical, light-effort items (`missing-subjects.md`, `missing-main-verbs.md`). Replace misleading tags with `omitted-subject` / `missing-main-verb`.
2. **Category Reassignment:** Tackle `articles.md` to fix category mismatches and move it out of the `advanced` category, aligning its metadata.
3. **Link Refactoring (High Risk):** Go through broken/stale body links (`adverbs.md`, `adjective-vs-adverb.md`, `gerund-vs-infinitive.md`) and replace legacy queries with clean routes.
4. **Progression/Pedagogy Setup:** Address `verbs.md` and `pronouns.md` (Batch A scope only). Fix body links first, then strengthen next-step routing and cohesion.
5. **Final Item:** Tighten metadata truthfulness in `academic-hedging.md`.

### Verification Steps
- Query metadata tags to ensure the new `omitted-subject` / `missing-main-verb` tags are applied correctly and no trace of the old misleading tags remain.
- Ensure `articles.md` is no longer in the `advanced` folder and graph role is accurate.
- Perform a manual route check on updated links to guarantee they map to valid, clean routes without 404s.

---

## Batch B: Progression Linkages & Graph Flow
**Files Included:**
- `ielts-grammar-lab/rankings-and-extremes.md`
- `parts-of-speech/nouns.md`
- `sentence-structures/complex-sentence.md`
- `ielts-grammar-lab/conditionals-in-speaking.md`
- `error-clinic/double-subject-errors.md`

**Main Problem Types:** Progression weaknesses, backward `next_articles`, and self-referencing links.  
**Overall Risk:** Medium-High (Risks weakening learner pathways and recommendation systems).  
**Expected Effort:** Medium-Light.  

### Execution Strategy
1. **Fix First (Self-References):** Process `rankings-and-extremes.md` to remove self-references in `related_pages` and improve Task 1 progression quality.
2. **Structural Progression:** Rework `next_articles` in `nouns.md` (replace backward links) and `complex-sentence.md` (push toward true next-step complexity).
3. **Cohesion & Refinement:** Address `conditionals-in-speaking.md` to make compare links coherent with the speaking family, and refine `double-subject-errors.md` within the sentence-completeness cluster.

### Verification Steps
- Run a frontmatter verification script or search to ensure no file self-references in `related_pages`.
- Verify `next_articles` across these files strictly point to forward-moving, logically harder or conceptually adjacent concepts.

---

## Batch C: Pedagogical Upgrades (Explanations & Models)
**Files Included:**
- `ielts-grammar-lab/overview-sentence-grammar.md`
- `ielts-grammar-lab/percentages-and-proportions.md`
- `ielts-grammar-lab/task2-introduction-grammar.md`
- `foundations/word-order.md`

**Main Problem Types:** Pedagogical weakness (lack of decision-based teaching, phrase-bank feel, over-absolute rules).  
**Overall Risk:** Medium.  
**Expected Effort:** Medium.  

### Execution Strategy
1. **Fix First (Foundations):** Update `word-order.md` to distinguish wrong vs. marked vs. natural order, reducing over-absolute rules.
2. **Lab Transformations:** Process `percentages-and-proportions.md` (add data-to-sentence transformation logic) and `overview-sentence-grammar.md` (add decision-based teaching on inclusions/exclusions).
3. **Anti-Template Overhaul:** Rework `task2-introduction-grammar.md` to include anti-template guidance and natural vs. memorized intro distinctions.

### Verification Steps
- Review content additions to ensure adherence to Grammar Wiki guidance (explanations should be clear, practical, and learner-friendly).
- Ensure the tone shift successfully moves away from a "phrase bank" feel to "decision logic."

---

## Batch D: Parts of Speech Deepening (Overlapping Files)
**Files Included:**
- `parts-of-speech/nouns.md` (Overlap with Batch B)
- `parts-of-speech/verbs.md` (Overlap with Batch A)
- `parts-of-speech/pronouns.md` (Overlap with Batch A)

**Main Problem Types:** Pedagogical weakness (differentiation, decision logic, cohesion).  
**Overall Risk:** Medium.  
**Expected Effort:** Medium.  

### Execution Strategy
> [!IMPORTANT]  
> Execute Batch D **only after** Batch A and B structural/link changes for these files are merged or finalized to prevent overwriting metadata.

1. **Fix First (Verbs):** Improve differentiation of verb types and learner decision scaffolding in `verbs.md`.
2. **Noun System Logic:** Expand noun-system decision logic and onward guidance in `nouns.md`.
3. **Pronoun Use Cases:** Add stronger pronoun reference / cohesion / IELTS writing use cases in `pronouns.md`.

### Verification Steps
- Check `next_articles` and body links against the Batch A & B specifications to ensure they were not accidentally reverted during the rewrite.
- Verify Markdown formatting and ensure pedagogical additions align with existing frontmatter conventions.

---

## Batch E: Enhancements & Minor Cleanups
**Files Included:**
- `ielts-grammar-lab/grammar-in-speaking.md`
- `ielts-grammar-lab/common-ielts-grammar-mistakes.md`
- `error-clinic/subject-verb-agreement.md`
- `grammar-for-meaning/discourse-markers.md`
- `verb-patterns/remember-doing-vs-remember-to-do.md`
- `verb-patterns/stop-doing-vs-stop-to-do.md`
- `verb-patterns/try-doing-vs-try-to-do.md`

**Main Problem Types:** Pedagogical enhancement, minor metadata tune-ups, graph cleanup.  
**Overall Risk:** Low.  
**Expected Effort:** Light.  

### Execution Strategy
1. **Fix First (Graph Cleanup):** Modify `discourse-markers.md` to reduce its overuse as a generic `next_articles` destination. Enhance `common-ielts-grammar-mistakes.md` with better branching to deeper follow-up lessons.
2. **Metadata Tune-up:** Review and adjust `subject-verb-agreement.md` to ensure `speaking_relevance` signal accuracy.
3. **Targeted Drill Insertions:** Append specific pedagogical enhancements to the verb pattern files: diagnostic decision blocks (`remember`), ambiguity notes (`stop`), and plausible IELTS competition examples (`try`).
4. **Final Item:** Insert the Band 6 -> 7 upgrade drill section into `grammar-in-speaking.md`.

### Verification Steps
- Search the `next_articles` field globally to ensure `discourse-markers.md` is removed as a default fallback link.
- Review new drill blocks for Markdown syntax errors and semantic honesty.

---

## Agent Handoff Instructions
When assigning this plan to an AI agent (e.g., Claude, Codex), provide the following prompt guidelines:
1. **Scope Limit:** "Only execute the tasks for [Batch Name]. Do not touch files outside this batch."
2. **Preservation:** "Preserve all existing frontmatter/schema structures unless specifically directed to change them in the plan."
3. **Rule Enforcement:** "Follow the guidelines in AGENTS.md for metadata integrity (e.g., semantic honesty, no keyword stuffing, precise `common_error_tags`)."
