# Reading Content Format Spec v1 — Cluster 20.x

**Sprint:** 20.1 (skeleton; iterate post-merge)
**Status of authority:** the authoring contract for Andy's external AI agent.
Sibling of the writing spec `docs/clusters/19_x/content_format_v1.md` (shared
YAML-frontmatter + Markdown-body conventions; read that for the base rules).
**Backed by:** migrations `086_reading_module_foundation.sql` +
`087_reading_test_attempts.sql` (tables `reading_passages`, `reading_questions`,
`reading_tests`, `reading_test_attempts`).

> **What ships in Sprint 20.1 vs what is spec-only**
> - **L1 passage import is LIVE** — `POST /admin/reading/content/import`
>   parses + validates + upserts an L1 passage (+ glossary) into
>   `reading_passages`. *Comprehension questions inside an L1 passage are
>   spec-only for now* (the L1 importer stores passage + glossary; questions
>   are authored via the structured pipeline below once it lands).
> - **L2 / L3 structured import is SPEC-ONLY** — the `reading_questions` /
>   `reading_tests` import pipeline is deferred to Sprints 20.3 / 20.5. The
>   shapes are defined here so Andy can start producing content now.

---

## 0. Shared conventions (from writing spec)

- File = YAML frontmatter between `---` fences at the very top, then a
  Markdown body. Body is **GFM** rendered with marked + DOMPurify
  (headings, **bold**, *italic*, lists, `code`, fenced code, > blockquote,
  [links], tables, horizontal rules, external-URL images).
- **Not supported:** raw HTML, subscript/superscript (DOMPurify strips them).
- `slug`: lowercase `a–z`, `0–9`, hyphens only; unique per table; identity for
  idempotent re-import (re-upload same slug = update in place).
- Body cap: 50,000 chars.

---

## 1. L1 — Vocab Reading Passage  *(import LIVE)*

**`content_type: reading_passage_l1`** → table `reading_passages`, `library='l1_vocab'`.

### Frontmatter

| Field | Required | Type | Notes |
|---|---|---|---|
| `content_type` | ✅ | string | Must be `reading_passage_l1` |
| `title` | ✅ | string | 2–200 chars |
| `slug` | optional | string | Auto-slugified from title if omitted |
| `difficulty_level` | optional | string | `foundation` \| `intermediate` \| `advanced` |
| `topic_tags` | optional | string[] | Vocab/topic focus, e.g. `[environment, academic-verbs]` |
| `image_url` | optional | string | Cloudinary `https://…` URL (charts/diagrams). See §5 |
| `word_count` | optional | int | ≥ 0 |
| `estimated_minutes` | optional | int | > 0 |
| `published` | optional | bool | Default `false` → row `status='draft'`; `true` → `published` |
| `glossary` | optional | object[] | `[{term, definition, example?, audio_url?}]` |

### Body
Standard GFM Markdown — the passage prose. (Inline term highlighting for the
glossary popover — e.g. a `[term](glossary:slug)` convention — is a Sprint 20.2
rendering concern, not required at authoring time in v1.)

### Validation (enforced by the live importer)
- `content_type` must be `reading_passage_l1`; `title` 2–200; body non-empty ≤ 50k.
- `slug` (if given) must match the slug format.
- `difficulty_level` (if given) must be one of the three values.
- `image_url` (if given) must start with `http://`/`https://`.
- `glossary` (if given) must be a list; each item needs `term` + `definition`.

---

## 2. L2 — Skill Practice Exercise  *(spec-only; pipeline Sprint 20.3)*

**`content_type: reading_skill_exercise`** → a `reading_passages` row
(`library='l2_skill'`) + its `reading_questions`.

### Frontmatter

| Field | Required | Type | Notes |
|---|---|---|---|
| `content_type` | ✅ | string | `reading_skill_exercise` |
| `title` | ✅ | string | |
| `slug` | optional | string | |
| `skill_focus` | ✅ | string | One of the D2 skill tags (§4) — the exercise's primary skill |
| `difficulty_level` | optional | string | `foundation`/`intermediate`/`advanced` |
| `topic_tags` | optional | string[] | |
| `estimated_minutes` | optional | int | |

### Body
The passage (Markdown), followed by a `questions:` block in the frontmatter
**or** a fenced ```json questions array (the 20.3 importer will fix the exact
carrier; the shape is §3). All questions in an L2 exercise should share
`skill_focus` but each still carries its own `skill_tag`.

---

## 3. L3 — Full Test  *(spec-only; pipeline Sprint 20.5)*

**`content_type: reading_full_test`** → one `reading_tests` row + 3
`reading_passages` rows (`library='l3_test'`, `passage_order` 1–3) + their
`reading_questions` (40 total).

### Test frontmatter

| Field | Required | Type | Notes |
|---|---|---|---|
| `content_type` | ✅ | string | `reading_full_test` |
| `test_id` | ✅ | string | External id, e.g. `AVR-READ-001` (UNIQUE) |
| `title` | ✅ | string | e.g. `Test 1 — Climate Change` |
| `module` | optional | string | `academic` (default) \| `general_training` (Phase B) |
| `time_limit_minutes` | optional | int | Default `60` |
| `passage_count` | optional | int | Default `3` (1–3) |
| `total_questions` | optional | int | Default `40` (1–40) |
| `band_target` | optional | number | 1.0–9.0 |

### Body
Three passages (~700–900 words each), each with its own questions assigned by
`q_num` (1–40 across the whole test). Each passage carries `title` +
`passage_order`.

---

## 4. `reading_questions` JSON shape

One object per question (used by L1 comprehension, L2 exercises, L3 tests):

```json
{
  "q_num": 1,
  "question_type": "true_false_not_given",
  "prompt": "The author believes coral reefs will fully recover by 2050.",
  "payload": { "options": [] },
  "answer": { "answer": "FALSE", "alternatives": ["F", "false"] },
  "skill_tag": "writer_view_TFNG",
  "sub_skill": "identify-claim",
  "explanation": "Para 4 says recovery is 'unlikely within decades'.",
  "order_num": 1
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `q_num` | ✅ | int | 1–40 (unique per passage) |
| `question_type` | ✅ | string | **Phase 1 subset** below (DB CHECK allows the full IELTS set) |
| `prompt` | ✅ | string | The question / statement |
| `payload` | optional | object | Render data: `{options:[{label,text}], template:{…}}` — shape per type |
| `answer` | ✅ | object | `{answer: <string\|string[]>, alternatives: <string[]>}` (the key) |
| `skill_tag` | ✅ | string | One of the D2 tags below |
| `sub_skill` | optional | string | Free-form specificity (no enum) |
| `explanation` | optional | string | Shown on the diagnostic result (Sprint 20.7) |
| `order_num` | optional | int | Display order within the passage (defaults to q_num order) |

### `skill_tag` enum (D2 — standardized, required)
`skimming` · `scanning` · `detail` · `main_idea` · `inference` ·
`vocabulary_in_context` · `reference_cohesion` · `writer_view_TFNG`

> The diagnostic engine (Sprint 20.7) aggregates **accuracy by `skill_tag`**, so
> the tag must come from this closed set — free-form tags break the rollup.
> `sub_skill` is the free-form escape hatch for finer labels.

### `question_type` — Phase 1 authoring subset
Author only these in Phase 1 (all reuse existing listening renderers per the
20.0 Discovery): `mcq_single`, `true_false_not_given`, `yes_no_not_given`,
`sentence_completion`, `summary_completion`, `notes_completion`,
`table_completion`, `form_completion`, `short_answer`, `matching_headings`
(rendered as a dropdown-select, D7).

Phase B (do **not** author yet): `mcq_multi`, `matching_information`,
`matching_features`, `matching_sentence_endings`, `flow_chart_completion`,
`diagram_label_completion`.

### `payload` by type (quick reference)
- **mcq_single / matching_headings**: `{ "options": [{"label":"A","text":"…"}, …] }`
- **true_false_not_given**: options implied (`TRUE`/`FALSE`/`NOT GIVEN`); `payload` may be `{}`.
- **yes_no_not_given**: implied `YES`/`NO`/`NOT GIVEN`.
- **\*_completion / short_answer**: `payload` may carry a `template` (e.g. a
  summary paragraph with `{{1}}` gap tokens, or table/notes structure) — see
  the listening completion renderers for the exact template shapes to reuse.

### `answer` matching (Sprint 20.5 scorer, cloned from listening)
Case-insensitive, whitespace-collapsed string match; `alternatives` accepts
spelling/synonym variants; T/F/NG and Y/N/NG normalized (`T`→`TRUE`, etc.).

---

## 5. Images (D5 — reuse Cloudinary)

Passage images (charts/diagrams) use the existing Cloudinary pipeline:
**jpg / png / webp / gif, ≤ 5 MB**. Author flow: upload the image (the admin
image-upload path; existing Cloudinary service), then paste the returned
`https://…` URL into `image_url`. SVG / PDF / multi-page figures are **Phase B**.

---

## 6. Examples

### L1 (minimal, import-ready)
```markdown
---
content_type: reading_passage_l1
title: The Return of the Wolves
slug: return-of-the-wolves
difficulty_level: intermediate
topic_tags: [environment, animals]
estimated_minutes: 6
published: true
glossary:
  - term: apex predator
    definition: an animal at the top of a food chain with no natural predators
    example: Wolves are apex predators in many northern ecosystems.
  - term: ecosystem
    definition: a community of living things interacting with their environment
---
When wolves were reintroduced to Yellowstone in 1995, scientists expected
changes — but not how far they would ripple through the **ecosystem**…
```

### L2 (spec-only)
```markdown
---
content_type: reading_skill_exercise
title: Skimming for Gist — Renewable Energy
slug: skim-renewable-energy
skill_focus: skimming
difficulty_level: intermediate
---
Solar power has fallen in price faster than any energy source in history…

```json
[
  { "q_num": 1, "question_type": "matching_headings",
    "prompt": "Choose the best heading for paragraph 2.",
    "payload": { "options": [
      {"label":"i","text":"A surprising price collapse"},
      {"label":"ii","text":"Government subsidies explained"}] },
    "answer": { "answer": "i", "alternatives": [] },
    "skill_tag": "skimming", "order_num": 1 }
]
```
```

### L3 (spec-only — single question shown)
```markdown
---
content_type: reading_full_test
test_id: AVR-READ-001
title: "Test 1 — The Science of Sleep"
module: academic
time_limit_minutes: 60
passage_count: 3
total_questions: 40
---
## Passage 1 — The Architecture of Sleep   <!-- passage_order: 1 -->
Sleep is not a single state but a cycle of distinct stages…

```json
[
  { "q_num": 1, "question_type": "true_false_not_given",
    "prompt": "REM sleep occurs only once per night.",
    "answer": { "answer": "FALSE", "alternatives": ["F"] },
    "skill_tag": "detail", "explanation": "Para 2: 'several REM periods'." }
]
```
```

---

## 7. Iteration notes for Andy's AI agent

- This is **v1 (skeleton)** — expand after the 20.1 merge. Additive optional
  fields don't bump the version; a breaking change ships as `v2`.
- Start producing **L1 passages now** (the importer is live). Produce a few
  **L2/L3** samples against §2/§3 so Sprint 20.3/20.5 can validate the
  importer against real content before building the student/exam UI.
- Grow `sub_skill` conventions over time (e.g. `skimming`→`find-purpose`).
  Keep `skill_tag` strictly within the D2 enum.
- Phase B unlocks the deferred `question_type`s + General Training `module`.
