# Deep Tier — Pass 3: Sentence Rewrite (Sprint 2.7b)

You receive an essay and a final list of mistakes (the merged Pass 1 +
Pass 2 list). Your task: for **each unique sentence** that contains one
or more mistakes, produce a single rewrite of that sentence which
addresses every mistake found inside it.

This is a focused-rewrite pass. You do **not** rewrite mistake-free
sentences for cosmetic reasons. You do **not** rewrite the same sentence
twice.

## Input format

You receive a single JSON object (no surrounding prose):

```json
{
  "essay": "the student's full essay text",
  "mistakes": [
    {
      "original":    "<exact substring from essay>",
      "mistakeType": "<category>",
      "explanation": "<...>",
      "suggestion":  "<...>",
      "criterion":   "<...>"
    }
  ]
}
```

The `mistakes` array is the merged Pass 1 + Pass 2 list. Indexes in your
output refer to this array.

## Output format

Output exactly one JSON object matching this shape. **No surrounding
text**, no markdown code fences, no preamble.

```json
{
  "sentence_rewrites": [
    {
      "original_sentence":  "<full sentence as it appeared in the essay, verbatim>",
      "rewritten_sentence": "<sentence with all mistakes addressed + minor flow fixes>",
      "mistakes_addressed": [<integer indexes into input.mistakes>],
      "rationale":          "<Vietnamese, 1–2 sentences explaining WHY the change>"
    }
  ]
}
```

## Critical rules

### One rewrite per unique sentence

If three mistakes all live in sentence S, produce **one** rewrite for S
with `mistakes_addressed` listing all three indexes. Do not emit S three
times.

### Faithful, not fancy

The rewritten sentence must:

1. Fix every mistake whose index appears in `mistakes_addressed`.
2. Stay close to the student's **original meaning + register** — don't
   change the band level. Reuse the student's vocabulary where possible
   instead of swapping in fancier alternatives.
3. Read naturally to a Vietnamese learner (Sprint 2.6.2 lesson:
   examiners care more about precision than rare vocabulary).
4. Not exceed **+1.5 bands** above the student's current band (Rule 5
   from `strict_grammar_check.md` — improved-essay realism cap).

### Skip mistake-free sentences

If a sentence contains no mistakes from the input list, do **not**
rewrite it. Cosmetic rewrites for already-correct sentences burn tokens
and dilute the value of the section the student actually has to study.

### Skip non-text sentence fragments

If a "sentence" is just a heading, a number, or a bare conjunction with
no real grammatical content, skip it.

### Authenticity check (Sprint 2.6.2 carryover)

If `original_sentence == rewritten_sentence` after Unicode normalisation
(apostrophes `'` ≡ `'`, quotes `"` `"` ≡ `"`, dashes `–` ≡ `—` ≡ `-`,
whitespace differences), the rewrite is fake. Drop that entry.

### Rationale: WHY not WHAT

The student sees the diff visually (original vs rewritten side-by-side).
The `rationale` field must explain **why** the change matters — what
rule it teaches, what pattern it generalises — not just describe what
changed.

✅ "Sửa từ 'have 25 years old' sang 'am 25 years old' để khớp pattern
   age + tobe trong tiếng Anh."

❌ "Đã thay 'have' thành 'am'."  (just describes the diff — no lesson)

## Vietnamese rules

- All `rationale` text in Vietnamese.
- `original_sentence` and `rewritten_sentence` in English (verbatim
  copies of essay sentences).

## Output discipline

- Output starts with `{` and ends with `}`. No surrounding text.
- Use empty `sentence_rewrites: []` if the input had no mistakes (rare
  but possible if Pass 1 + Pass 2 produced an empty mistake list).
- `mistakes_addressed` MUST be a non-empty array for every entry — a
  rewrite with no addressed mistakes shouldn't exist.
