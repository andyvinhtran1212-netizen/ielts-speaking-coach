# VOCAB_UPLOAD_FORMAT — vocab_cards upload format (authoritative)

One Markdown file = one OR many words (a "lesson"). Each word is a `---` YAML
frontmatter block + a Markdown body. Multi-word files concatenate blocks (the
importer splits on frontmatter fences). Admin upload: `/pages/admin/vocab/content.html`.

This file reflects what the importer ACTUALLY parses + what the card ACTUALLY
renders (kept in sync with `services/vocab_import.py` + `js/vocabulary.js`). If you
add a field here, wire all three layers (parse → column → render) or it is a GHOST.

> **Generating cards with an AI agent?** Jump to **§ Brief for a content-generation
> agent** at the bottom — it has the hard rules, the valid value lists, and a
> pre-upload checklist so the output imports cleanly and is accurate.

---

## Frontmatter fields

### Required
| Field | Type | Renders as |
|---|---|---|
| `headword` | text | card title |
| `category` | text (auto-slugified) | eyebrow + grouping (any topic; no whitelist) |
| `part_of_speech` | text | next to the IPA |
| `pronunciation` | text (IPA, e.g. `/məˈtrɒp.əl.ɪs/`) | IPA line + stress specimen |
| `definition_en` | text | English definition line |
| `definition_vi` | text | **curated** Vietnamese line (falls back to the body gloss when empty) |
| `example` | text | "Dùng khi nói" sentence (headword highlighted) |
| `collocations` | list | chips |

> **Validator note:** the importer only *hard-requires* `headword` + `category`
> (+ a valid slug). The other "required" fields above are required for a good card;
> a card missing them imports but renders thin. Always include them.

### Recommended
| Field | Type | Renders as |
|---|---|---|
| `syllables` | text, hyphen-separated, UPPERCASE = primary stress (e.g. `me-TROP-o-lis`) | orthographic stress specimen (single words; falls back to the IPA parser when absent) |
| `level` | text (e.g. `B2`, `C1`) | level pill |

### Optional
| Field | Type | Renders as |
|---|---|---|
| `synonyms` | list | "Đồng nghĩa" |
| `antonyms` | list | "Trái nghĩa" |
| `related_words` | list | **"Từ liên quan"** (associated words) |
| `word_family` | list — **object** `[{form, pos, note_vi}]` (preferred) or legacy string `["metropolitan (adj)"]` | **"Họ từ"** (morphological family — distinct from related_words) |
| `register` | text (e.g. `neutral-formal`) | footer |
| `common_error` | text | "Hay nhầm" callout (amber) |
| `memory_hook` | text | "Mẹo nhớ" callout (jade) |
| `source` | text (e.g. `L09 · Group A`) | footer "nguồn" |
| `group` | text | **internal metadata only — NOT shown on the card** (admin-editable) |

### KP-enrichment fields (Phase B2 — column added in migration 135)
These make a card **Knowledge-Point-ready** (cross-links to grammar, exam-list membership).

| Field | Type | Meaning |
|---|---|---|
| `word_family` | object list `[{form, pos, note_vi}]` | the morphological family — the join point with the word-formation grammar articles. Prefer the object form. |
| `confusable_with` | object list `[{slug, note_vi}]` | words learners confuse this with (`slug` = the other vocab card's slug) |
| `related_grammar` | object list `[{slug, anchor}]` | grammar article + anchor this word illustrates (see valid anchors below) |
| `tested_in` | string list | exam sources that test this word: `ielts_reading`, `ielts_listening`, `toeic_rc`, `toeic_lc`, `thpt_qg` |
| `lists` | string list | exam-list membership (slugs from `content_vocab/_lists.yaml`): `awl-sublist-1…10`, `toeic-core`, `thpt-core` |

Empty optional fields are hidden (no empty labels).

### Auto / pipeline (do NOT put in frontmatter)
- `slug` — auto from `headword` (override with `slug:` only if you must; must be unique **within its category**).
- `audio_headword` / `audio_example` / `audio_status` — set by the admin "Generate
  voice" job (OpenAI or ElevenLabs). The ▶ buttons prefer these mp3s, else
  speechSynthesis. `audio_status` shows in the admin console, not on the public card.

### Removed / not supported
- `stress` (legacy integer) — **removed**; use `syllables` instead.

---

## Body

The Markdown body after the frontmatter:
- **First paragraph** → extracted as `gloss_vi` (the VN gloss fallback when
  `definition_vi` is empty). Keep it a clean one-line VN gloss.
- `## Ví dụ …`, `## Ghi nhớ …` etc. → rendered below the card **only** when the
  word has no structured `example`/`memory_hook` (so curated words don't duplicate).

---

## Example (fully enriched — the B2 shape)

```markdown
---
headword: "Innovation"
slug: "innovation"
category: "technology"
level: "B2"
part_of_speech: "noun"
pronunciation: "/ˌɪn.əˈveɪ.ʃən/"
definition_en: "a new idea, method, or device; the introduction of something new"
definition_vi: "sự đổi mới, cải tiến"
example: "The company owes its success to constant innovation."
register: "academic/neutral"
synonyms: ["breakthrough", "novelty"]
collocations: ["technological innovation", "foster innovation", "a major innovation"]
word_family:
  - {form: "innovate", pos: "verb", note_vi: "đổi mới"}
  - {form: "innovative", pos: "adjective", note_vi: "có tính đổi mới"}
  - {form: "innovator", pos: "noun", note_vi: "người đổi mới"}
confusable_with:
  - {slug: "invention", note_vi: "invention = phát minh cái chưa từng có; innovation = cải tiến cái đã có"}
related_grammar:
  - {slug: "word-formation-noun-suffixes", anchor: "word-formation-noun-suffixes.suffix.tion-sion"}
tested_in: ["ielts_reading", "toeic_rc", "thpt_qg"]
lists: ["awl-sublist-7", "toeic-core"]
common_error: "Đếm được khi chỉ một cải tiến cụ thể (an innovation); không đếm được khi là khái niệm chung."
memory_hook: "in- (vào) + nova (mới) → đưa cái mới vào."
---

Sự đổi mới, cải tiến — một ý tưởng, phương pháp hoặc thiết bị mới.

## Ví dụ IELTS Speaking Part 3

> Constant **innovation** is what keeps a company ahead of its competitors.
```

---

## Brief for a content-generation agent

Give an AI agent THIS section verbatim to produce cards that import cleanly and
meet the project's #1 bar: **content must be accurate and non-misleading**.

**Output shape:** one `.md` file per topic batch (or one per word). Each word = a
`---` YAML frontmatter block (fields above) + a short Markdown body whose first
paragraph is a clean one-line VN gloss. Multiple words concatenate in one file.

**Hard rules**
1. **Accuracy over volume.** Every `definition_en`, `definition_vi`, `example`,
   `pronunciation`, and `word_family` form must be correct. If unsure of the IPA,
   use a standard British dictionary form; never invent one.
2. **Required fields present:** `headword`, `category`, `part_of_speech`,
   `pronunciation`, `definition_en`, `definition_vi`, `example`, `collocations`.
3. **`category`** = one topic slug. Reuse existing ones when they fit:
   `environment, technology, education, work-career, health, people-society, economy`.
   A new topic is allowed but must ALSO be added to `content_vocab/_categories.yaml`
   (else the loader won't pick it up).
4. **`example`** must be a natural sentence with the **headword in `**bold**`**.
5. **`word_family`** = object list `[{form, pos, note_vi}]`. Only real family
   members; empty list `[]` if the word has none.
6. **`related_grammar`** anchors must be REAL. Valid word-formation anchors:
   - `word-formation-noun-suffixes.suffix.tion-sion` · `.suffix.ment` · `.suffix.state`
   - `word-formation-adjective-suffixes.suffix.able-ible` · `.suffix.ive-ous-al`
   - `word-formation-verbs-and-adverbs.suffix.verb` · `.suffix.adverb` · `.prefix`
   Point a card here when its word family shows that suffix/prefix pattern. Omit
   `related_grammar` if none applies — do NOT guess an anchor.
7. **`lists`** values ∈ `content_vocab/_lists.yaml` slugs (`awl-sublist-1…10`,
   `toeic-core`, `thpt-core`). **`tested_in`** ∈ `ielts_reading, ielts_listening,
   toeic_rc, toeic_lc, thpt_qg`.
8. **`confusable_with`** `slug` should be another card's slug (ideally in the same
   batch/list) — used for the "dễ nhầm" cross-link.
9. **YAML safety:** if a `title`/`summary`/text value contains a colon `:` or an
   apostrophe `'`, quote the whole value and escape a lone apostrophe as `''`
   inside single quotes (e.g. `'You''re here'`). A bad quote silently breaks the
   card's frontmatter.

**Pre-upload checklist (agent must self-verify)**
- [ ] Every word has the 8 required fields.
- [ ] `pronunciation` is valid IPA in `/…/`.
- [ ] `example` bolds the headword and reads naturally.
- [ ] `word_family` items are objects (or `[]`); forms are real.
- [ ] `related_grammar` anchors are from the list above (or field omitted).
- [ ] `lists` / `tested_in` values are from the allowed sets.
- [ ] Any new `category` is added to `_categories.yaml`.
- [ ] File parses as YAML (no unquoted `:` / lone `'` in values).

**Upload + validate**
1. Save cards as `.md` under `content_vocab/<category>/<slug>.md` (or upload the
   file directly).
2. Admin → `/pages/admin/vocab/content.html` → import with **dry-run first**
   (`POST /admin/vocabulary/import?dry_run=true`) to see validation errors; then
   commit. The importer upserts by `(category, slug)` — re-import is idempotent.
3. After a new `_categories.yaml` topic or bulk add, the vocab count tripwires in
   `tests/test_vocab_content*.py` need bumping (they pin the seed card / category
   counts on purpose).

---

## Per-batch generation assignment (WHAT to create)

The **format** above tells the agent the SHAPE of a card. This section is the
**assignment**: which words, for which exam/level/list. Give the agent BOTH — the
format brief + one filled assignment per batch.

### The agent does NOT choose which words
It produces a card **for each headword you give it**. The headword list is the
input:
- **AWL** (Academic Word List, 570 words in 10 sublists) — public; the sublist
  headwords are the list. Sublist 2 is provided below as a ready example.
- **TOEIC-core / THPT-core** — you supply the headword list (compiled from the
  TOEIC service list / public THPT exams). The agent turns each word into a card.

### How targeting metadata is decided
| Metadata | How to set it |
|---|---|
| `lists` | the batch's target list slug: `awl-sublist-N`, `toeic-core`, or `thpt-core` (a word may carry several). |
| `tested_in` | by list: **AWL** → `ielts_reading` (+ `toeic_rc`/`thpt_qg` if it's also common there); **TOEIC-core** → `toeic_rc`; **THPT-core** → `thpt_qg`. |
| `level` | the word's CEFR band (A2–C2). Most academic words are B1–C1; the agent estimates per word. Set a batch DEFAULT and let it adjust. |
| `category` | best-fit topic from `environment, technology, education, work-career, health, people-society, economy`. A new topic is allowed **but must be added to `_categories.yaml`**. |
| `related_grammar` | attach only when the word's family shows a suffix/prefix pattern, using the real anchors listed in the agent brief. |

### Assignment template (fill in, then paste with the format brief)
```
TARGET LIST:   awl-sublist-2          # → lists: ["awl-sublist-2"]
EXAM SOURCES:  ielts_reading, toeic_rc # → tested_in
DEFAULT LEVEL: B2                       # agent adjusts per word (A2–C2)
CATEGORIES:    reuse existing topics; add a new one only if none fits (and note it for _categories.yaml)
COUNT:         ~60 (one card per headword below)
OUTPUT:        one .md file, one frontmatter block per word, per the FORMAT brief
HEADWORDS:
  <paste the list — e.g. the AWL Sublist 2 words below>
```

### Ready example — AWL Sublist 2 headwords (60)
```
achieve, acquire, administration, affect, appropriate, aspect, assist, category,
chapter, commission, community, complex, compute, conclude, conduct, consequent,
construct, consume, credit, culture, design, distinct, element, equate, evaluate,
feature, final, focus, impact, injure, institute, invest, item, journal, maintain,
normal, obtain, participate, perceive, positive, potential, previous, primary,
purchase, range, region, regulate, relevant, reside, resource, restrict, secure,
seek, select, site, strategy, survey, text, tradition, transfer
```

> Tip: keep batches ≤ ~60 words so one dry-run import surfaces all validation
> errors at once, and so a reviewer can spot-check accuracy before committing.
