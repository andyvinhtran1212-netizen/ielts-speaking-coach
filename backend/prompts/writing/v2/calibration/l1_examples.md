# Level 1 Calibration Examples

These examples anchor your expected output for Band 4.0–5.5 essays. Match the
**rigour level** shown — particularly the mistake count floor.

## Example 1: Band 4.5 essay (Task 2, ~240 words)

### Prompt
"Some people think that money is the most important thing in life. Discuss."

### Student Essay (240 words, Vietnamese L1)

> In the modern era, money have become a important issue. Many people thinking
> that money is most important thing in their life. However, I disagree this
> opinion because I think family, friendship and health are more importanter.
>
> Firstly, money can not buy happiness. For example, if you have a lot of money
> but you don't have friends or family, you will be lonely. So happiness depend
> of relationships not money.
>
> Secondly, health is more important than money. When we have illness, money
> cannot help us recovery completely. We need health to enjoy life.
>
> In addition, education is also very important. Education help us develop our
> skill and knowledge.
>
> In conclusion, even though money is important, but it is not the most
> important thing. There are many things more important like family, health,
> and education.

### Expected Grading (key fields only)

```json
{
  "overallBandScore": 4.5,
  "criteriaFeedback": {
    "mainCriterion":     {"title": "Task Response",       "bandScore": 4, "...": "..."},
    "coherenceCohesion": {"title": "Coherence and Cohesion", "bandScore": 5, "...": "..."},
    "lexicalResource":   {"title": "Lexical Resource",     "bandScore": 4, "...": "..."},
    "grammaticalRange":  {"title": "Grammatical Range",    "bandScore": 4, "...": "..."}
  },
  "mistakeAnalysis": [
    {"original": "money have become",          "mistakeType": "Grammar - Subject-verb agreement"},
    {"original": "a important issue",          "mistakeType": "Grammar - Article"},
    {"original": "Many people thinking",       "mistakeType": "Grammar - Verb form"},
    {"original": "is most important thing",    "mistakeType": "Grammar - Article"},
    {"original": "I disagree this opinion",    "mistakeType": "Grammar - Preposition"},
    {"original": "more importanter",           "mistakeType": "Grammar - Comparative"},
    {"original": "money can not buy",          "mistakeType": "Spelling"},
    {"original": "happiness depend of",        "mistakeType": "Grammar - Subject-verb + preposition"},
    {"original": "we have illness",            "mistakeType": "Word Choice - Article"},
    {"original": "help us recovery",           "mistakeType": "Word Choice - Word form"},
    {"original": "Education help us",          "mistakeType": "Grammar - Subject-verb agreement"},
    {"original": "even though money is important, but", "mistakeType": "Vietlish - 'tuy ... nhưng' redundancy"}
  ]
}
```

**Why 12 mistakes?** Rule 1 mandates 12+ for band ≤ 4.5. This essay has Vietlish
patterns ("disagree this opinion" from "không đồng ý ý kiến này"), comparative
errors ("more importanter"), and S-V agreement repeating across paragraphs —
all detectable on a careful scan.

**Why band 4.5 not 5.0?** Position is somewhat clear but ideas inadequately
developed; "many things more important" never specifies which. Frequent grammar
errors that occasionally impede meaning.

## Example 2: Band 5.5 essay (Task 2, ~270 words)

### Brief

A Band 5.5 essay typically: addresses task partially with a clearer position;
some organisation but mechanical linkers; limited vocabulary range with
noticeable errors; mix of simple and complex sentences with frequent errors
that *rarely* impede meaning.

### Expected mistake count

**8–12 mistakes** per Rule 1. Mistakes typically include: 2-4 article errors,
1-2 tense errors, 1-2 collocation errors, 1-2 Vietlish patterns, and 1-2
spelling/word-form errors.

### Criteria scores

Typical: Task Response 5–6, Coherence 5–6, Lexical 5, Grammar 5. Average → 5.5.

If you grade an essay at 5.5 with **0–4 mistakes**, you have failed Rule 1
and must re-scan for errors before returning.
