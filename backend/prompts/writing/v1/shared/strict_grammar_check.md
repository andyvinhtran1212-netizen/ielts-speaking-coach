# Strict Grammar Check (MANDATORY for All Levels)

This module is **mandatory and non-negotiable** for every analysis level (1-5). 
You MUST scan the entire essay for the following error categories and include 
all findings in `mistakeAnalysis`:

## 1. Grammar & Spelling Errors

Including but not limited to:
- **Articles:** Missing/wrong/redundant a/an/the (e.g., "I went to school" vs "I went to the school")
- **Prepositions:** Wrong choice (e.g., "depend of" → "depend on")
- **Subject-verb agreement:** Mismatched number (e.g., "people is" → "people are")
- **Verb tenses:** Inconsistent or incorrect tense (especially past/present mixing)
- **Singular/plural:** Wrong form (e.g., "many informations" → "much information")
- **Word forms:** Wrong part of speech (e.g., "education system" vs "educational system")
- **Pronoun reference:** Ambiguous "it/this/they"
- **Spelling:** Any misspelled words

## 2. Vietlish (Vietnamese-influenced English)

Patterns where Vietnamese L1 interferes:
- **Word-by-word translation:** "I very like" (từ "tôi rất thích")
- **Incorrect collocations:** "do a research" (correct: "do research")
- **Topic-comment structure:** "This problem, we need to solve" (English uses subject-verb)
- **Missing articles:** "I am student" (từ "tôi là sinh viên")
- **Wrong verb-noun pairings:** "make a question" (correct: "ask a question")

## 3. Word Choice & Context

- **Inappropriate register:** Casual words in formal essays
- **Misused vocabulary:** Words used outside their typical context
- **Overused intensifiers:** "very", "really", "so" overuse
- **Incorrect synonyms:** Words sound similar but mean differently

## 4. Awkward Phrasing & Repetition

- **Wordy/circuitous expressions:** Long sentences saying simple things
- **Repetitive vocabulary:** Same word appearing multiple times when synonyms could help
- **Unclear pronouns:** Reader can't tell what "it/this/they" refers to
- **Run-on sentences:** Multiple ideas without proper conjunctions

## Rules

1. **Do NOT skip** even small errors. Every detected issue must appear in `mistakeAnalysis`.
2. **Categorize** each error with `mistakeType`: "Grammar", "Spelling", "Word Choice", "Vietlish", "Awkward Phrasing", or specific subtypes.
3. **Explain in Vietnamese** so the student understands the rule, not just the fix.
4. **Suggest a corrected version** — be specific, not "rewrite this."
5. **Link to criterion**: Tag each error with the IELTS criterion it primarily affects.

## Output Format Per Mistake

```json
{
  "original": "I has been study for 3 years",
  "mistakeType": "Grammar - Verb form",
  "explanation": "Sai trợ động từ 'has' (cần 'have' với chủ ngữ 'I'), và sau 'have been' phải là dạng V-ing.",
  "suggestion": "I have been studying for 3 years",
  "criterion": "Grammatical Range"
}
```
