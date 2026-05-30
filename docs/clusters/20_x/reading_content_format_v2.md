# Reading Content Format Spec v2 — Cluster 20.x

**Sprint:** 20.6.5 (unified authoring spec — supersedes v1)
**Status:** All three reading content types (L1, L2, L3) are **LIVE** and importable.
**Authority:** Reverse-documented from the live importer (`backend/services/content_import_service.py` + `backend/routers/admin_reading.py`). Every claim in this document is checked against the parser/validator/builder code paths that the import endpoint actually runs. The three worked examples in `content_examples/` dry-run-validate clean against the live importer (see `backend/tests/test_reading_content_format_v2_examples.py`).
**What changed since v1:**
- L1 questions, L2 skill exercises, and L3 full tests are all importable now (v1 had only L1 live).
- **Question YAML is FLAT, not nested.** v1's JSON example showed the *stored* DB shape (`payload: {options}` + `answer: {answer, alternatives}`); authors write the **flat** shape (`options:` and `answer:` at the question's top level). The builder transforms flat-author → nested-storage. See §4 for the worked diff.
- Question-type catalogue and the `skill_tag` D2 enum are now reverse-confirmed against the live `READING_QUESTION_TYPES_PHASE1` and `SKILL_TAGS` tuples.
- L3 carries the whole test in YAML frontmatter (no fenced JSON, no markdown-body parsing) — Sprint 20.5's call, documented here.

---

## 0. Overview — three content types, one endpoint

| Type | `content_type` | Library | What it produces in the DB |
|---|---|---|---|
| **L1 Vocab Reading** | `reading_passage_l1` | `l1_vocab` | One `reading_passages` row (+ glossary in JSONB) + 0–N `reading_questions` |
| **L2 Skill Practice** | `reading_skill_exercise` | `l2_skill` | One `reading_passages` row + N skill-tagged `reading_questions` |
| **L3 Full Test** | `reading_full_test` | `l3_test` | One `reading_tests` row + 3 `reading_passages` rows (`passage_order` 1–3) + 40 `reading_questions` |

All three are uploaded through one endpoint:

```http
POST /admin/reading/content/import?dry_run=true
Content-Type: multipart/form-data
file: <one .md file>
Authorization: Bearer <admin JWT>
```

The endpoint **dispatches by `content_type`** in the frontmatter (`reading_full_test` takes the L3 path; everything else takes the L1/L2 passage path). The response is always:

```json
{
  "parsed_data": { ... },        // flat preview of what was parsed
  "validation_errors": [ ... ],  // empty list when valid
  "dry_run": true,
  "committed_id": null,          // UUID when committed
  "action": null                 // "created" | "updated" when committed
}
```

### Authoring workflow — dry-run first, always

1. Author writes the `.md` file.
2. Upload with `?dry_run=true` → inspect `validation_errors`.
3. Fix anything in the errors list → re-upload with `?dry_run=true` until `validation_errors: []`.
4. Re-upload with `?dry_run=false` to commit.
5. Re-uploading the **same slug (L1/L2) or `test_id` (L3)** is **idempotent**: it updates the existing row(s) in place and *replaces the whole question set for that passage*. Drafts can be iterated freely without orphaning rows.

> The same file can be safely re-imported any number of times — the importer deletes-and-reinserts the per-passage `reading_questions` on every commit, so a corrected file fully overwrites the previous state.

---

## 1. Shared conventions (apply to all three types)

### File format
- YAML frontmatter between two `---` fences at the **very top** of the file (a single optional BOM is tolerated).
- The opening fence must be **line 1** — no blank line before it.
- The closing `---` is followed by the Markdown body (L1/L2) or by an unused tail (L3).

### Slugs (L1/L2/L3 passages)
- Lowercase `a–z`, digits `0–9`, hyphens only (regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`).
- L1/L2: if `slug:` is omitted, the importer auto-slugifies from `title` (Vietnamese diacritics handled: `đ→d`, NFKD + combining-mark strip, non-alphanumeric → hyphen).
- L3: every passage **must** declare its own `slug`. There is no auto-slugify inside `passages:`.

### Test IDs (L3 only)
- `^[A-Za-z0-9][A-Za-z0-9_\-]{1,63}$` — 2–64 chars, starts alphanumeric, then alphanumeric / hyphen / underscore. Recommended pattern: `AVR-READ-001`, `AVR-READ-002`, …

### Markdown body
- GFM, rendered by `marked` + sanitised by DOMPurify on the frontend.
- **Supported:** headings, **bold**, *italic*, lists, `code`, fenced code blocks, `> blockquotes`, `[links](https://…)`, tables, horizontal rules, external-URL images.
- **Stripped (do not use):** raw HTML, `<sub>` / `<sup>`, `<script>`, inline `style=`, `javascript:` URLs. *L1 glossary terms are looked up by string-match — do not try to wrap them in `[term](glossary:slug)` style links; DOMPurify will strip the scheme.* See §3.
- **Body cap:** 50,000 characters (`MAX_BODY_CHARS`). Validation rejects anything larger with `"Nội dung vượt quá 50000 ký tự."`

### Enums (closed sets — anything else is rejected)

```python
DIFFICULTY_LEVELS = ("foundation", "intermediate", "advanced")

SKILL_TAGS = (
    "skimming", "scanning", "detail", "main_idea", "inference",
    "vocabulary_in_context", "reference_cohesion", "writer_view_TFNG",
)

READING_QUESTION_TYPES_PHASE1 = (
    "mcq_single", "true_false_not_given", "yes_no_not_given",
    "sentence_completion", "summary_completion", "notes_completion",
    "table_completion", "form_completion", "short_answer",
    "matching_headings",
)

READING_TEST_MODULES = ("academic", "general_training")  # GT band table = Phase B
```

> `skill_tag` is the **D2 closed enum**. The Sprint 20.7 diagnostic engine aggregates accuracy by `skill_tag`, so free-form tags break the per-skill rollup. Use `sub_skill` (free-form string) when you want a finer label — it is captured but not aggregated.

### Common YAML pitfalls

- **Numeric-looking strings need quoting.** YAML coerces `TRUE`, `FALSE`, `YES`, `NO`, `ON`, `OFF`, `null`, and bare numbers into booleans / numbers / null. Always quote T/F/NG and Y/N/NG answers: `answer: "FALSE"`, `answer: "YES"`. Likewise wrap option labels that look like Roman numerals (`i`, `ii`) in their own scalar when ambiguous.
- **List vs string for `alternatives`.** The importer accepts `alternatives:` as a list of strings only. A bare string is silently treated as no alternatives.
- **Boolean `published`.** YAML `true` (no quotes) maps to row `status='published'`; anything else (including missing field) → `'draft'`.
- **Tabs in YAML.** YAML rejects tabs as indentation. Use spaces.

---

## 2. L1 — Vocab Reading Passage

`content_type: reading_passage_l1` → `reading_passages` row, `library='l1_vocab'`.

### Frontmatter fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `content_type` | ✅ | string | Must be `reading_passage_l1` |
| `title` | ✅ | string | 2–200 chars |
| `slug` | optional | string | Auto-slugified from `title` if omitted |
| `difficulty_level` | optional | enum | `foundation` \| `intermediate` \| `advanced` |
| `topic_tags` | optional | string[] | Free-form tags for filtering, e.g. `[environment, animals]` |
| `image_url` | optional | string | Must start with `http://` / `https://` (Cloudinary URL — see §6) |
| `word_count` | optional | int | Informational; not rejected if mismatched |
| `estimated_minutes` | optional | int | Informational |
| `published` | optional | bool | Default `false` → row `status='draft'`. `true` → `published` |
| `glossary` | optional | object[] | See §3 |
| `questions` | optional | object[] | See §4 (L1 may ship 0–N light comprehension Qs) |

### Body

Standard GFM Markdown — the passage prose. Author it as readable prose; do not embed `<sub>` / `<sup>` or raw HTML. The body is rendered as-is on the student detail page; glossary highlighting is added at render time by `frontend/js/reading-vocab.js`, not by special author syntax.

### L1 validation rules (live)

- `content_type` exactly `reading_passage_l1`.
- `title` present, 2–200 chars.
- `body_markdown` non-empty, ≤ 50,000 chars.
- `slug` (if given) matches the slug regex.
- `difficulty_level` (if given) in the enum.
- `image_url` (if given) starts with `http://` / `https://`.
- `skill_focus` (if given for L1) must be in `SKILL_TAGS` — but it is **not required** for L1 and is ignored by the runtime renderer (L1 doesn't have a skill focus).
- `glossary` and `questions` shape — see §3 and §4.

---

## 3. Glossary (L1)

A list of vocabulary entries shown beside the passage. Each entry must carry `term` and `definition`; the rest are optional.

```yaml
glossary:
  - term: apex predator
    definition: một loài đứng đầu chuỗi thức ăn, không có kẻ thù tự nhiên nào săn nó
    example: Wolves are apex predators in many northern ecosystems.   # optional
    audio_url: https://…                                              # optional
  - term: ecosystem
    definition: a community of living things interacting with their environment
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `term` | ✅ | string | The headword. Match-case for the popover highlighter is best-effort case-insensitive at render time. |
| `definition` | ✅ | string | Vietnamese explanation. Plain text (no markdown). |
| `example` | optional | string | English example sentence using the term. |
| `audio_url` | optional | string | TTS pronunciation URL (Cloudinary or signed). |

### Validation rules
- `glossary:` if present must be a YAML list. A scalar / dict / `null` → error: *"glossary phải là danh sách các mục {term, definition}."*
- Each entry must be a dict with non-empty `term` and `definition`. Missing either → *"Mục glossary #N cần 'term' và 'definition'."*
- No size cap on the list; aim for ≤ 12 entries per passage so the UI fits.

### Inline highlighting — author convention

Do **not** wrap glossary terms with custom Markdown syntax. The renderer scans the body for case-insensitive matches against `glossary[].term` and adds the popover. Use the glossary term in the body as normal prose (the seeds use plain `**bold**` to draw the eye where helpful) — the renderer handles linking.

---

## 4. Question shape — the single source of truth (L1 + L2 + L3)

> **This is the most important section of the spec — authors and content-production agents must get it right.**

All three libraries use the **same flat YAML** for a question (L1 ships them in the passage's `questions:` block; L2 ships them in the passage's `questions:` block too; L3 ships them inside each `passages[i].questions:`).

### Author-side (what you write — FLAT)

```yaml
questions:
  - q_num: 1
    question_type: mcq_single                      # see §4.2 enum
    prompt: "According to the passage, what surprised scientists most?"
    options:                                       # ← top-level, not nested under payload:
      - label: A
        text: How quickly the wolves bred
      - label: B
        text: How far the effects spread through the ecosystem
      - label: C
        text: How little the wolves ate
    answer: "B"                                    # ← top-level string (or list — see §4.3)
    alternatives: []                               # ← top-level list (optional, default [])
    skill_tag: main_idea                           # ← D2 enum, REQUIRED
    sub_skill: locate-claim                        # optional free-form label
    explanation: "Para 3 builds to the 'far beyond the wolves themselves' conclusion."
```

### Storage-side (what the importer writes to `reading_questions` — NESTED)

The builder `build_reading_question_payloads()` takes the flat author input and produces the row that lands in the DB:

```jsonc
{
  "passage_id": "<uuid>",          // filled by the router post-insert
  "q_num": 1,
  "question_type": "mcq_single",
  "prompt": "According to the passage, what surprised scientists most?",
  "payload": {                     // render-time data (NEVER includes the answer)
    "options": [
      {"label": "A", "text": "How quickly the wolves bred"},
      {"label": "B", "text": "How far the effects spread through the ecosystem"},
      {"label": "C", "text": "How little the wolves ate"}
    ]
  },
  "answer": {                      // answer-key JSONB column — stripped from student fetches
    "answer": "B",
    "alternatives": []
  },
  "skill_tag": "main_idea",
  "sub_skill": "locate-claim",
  "explanation": "Para 3 builds to the 'far beyond the wolves themselves' conclusion.",
  "order_num": 1
}
```

> **Why two shapes?** The DB stores `payload` (render data; sent to the student in the detail call) and `answer` (the key; never sent to students) as separate JSONB columns so the detail endpoint can omit the answer column via column-projection. Authors should not write the nested storage shape directly — the builder does that transform.

### 4.1 Question fields (flat author view)

| Field | Required | Type | Notes |
|---|---|---|---|
| `q_num` | ✅ | int | Positive int, unique within the passage (L1/L2). For L3 it must be **unique across the whole test and continuous 1..total_questions**. |
| `question_type` | ✅ | enum | One of `READING_QUESTION_TYPES_PHASE1` (§4.2). |
| `prompt` | ✅ | string | The student-facing question / statement. |
| `options` | ✅ for `mcq_single`, `matching_headings` | object[] | `[{label, text}, …]`. Lives at the **question top level**, not under `payload`. |
| `template` | optional | dict | Renderer-specific structure (e.g. a summary paragraph with `{{1}}` gap tokens for `summary_completion`, or a table/notes layout). Lives at the **question top level**, not under `payload`. |
| `answer` | ✅ | string \| string[] | The correct answer. String for single answers, list of strings only for the future `mcq_multi` (Phase B). |
| `alternatives` | optional | string[] | Accepted alternative spellings / variants. Default `[]`. Must be a list — a bare string is silently dropped. |
| `skill_tag` | ✅ | enum | One of `SKILL_TAGS` (§1). The diagnostic engine aggregates by this column. |
| `sub_skill` | optional | string | Free-form finer label (e.g. `find-purpose`, `locate-claim`). Captured, not aggregated. |
| `explanation` | optional | string | Shown after grading on result pages. Plain text. |
| `order_num` | derived | int | The importer assigns `order_num = i + 1` based on list order; authors should not set it. |

### 4.2 `question_type` — Phase 1 catalogue

| Type | Author this in Phase 1? | `options` needed? | `template` needed? | `answer` typical shape |
|---|:---:|:---:|:---:|---|
| `mcq_single` | ✅ | ✅ | – | `"A"` (the chosen label) |
| `true_false_not_given` | ✅ | – | – | `"TRUE"` / `"FALSE"` / `"NOT GIVEN"` (quoted!) |
| `yes_no_not_given` | ✅ | – | – | `"YES"` / `"NO"` / `"NOT GIVEN"` (quoted!) |
| `matching_headings` | ✅ | ✅ (list of headings) | – | The chosen label, e.g. `"iii"` |
| `sentence_completion` | ✅ | – | optional | The filled-in word(s) as a string |
| `summary_completion` | ✅ | – | optional | Same as sentence_completion |
| `notes_completion` | ✅ | – | optional | Same |
| `table_completion` | ✅ | – | optional | Same |
| `form_completion` | ✅ | – | optional | Same |
| `short_answer` | ✅ | – | – | Free-typed answer string |
| `mcq_multi` | ✅ (Sprint 20.14b) | ✅ (list of {label, text}) | – | `["A", "C"]` — a **string list** of N chosen labels (all-or-nothing scoring) |
| `matching_information` | ✅ (Sprint 20.14b) | – | – | The chosen paragraph label, e.g. `"B"`. Paragraphs are labelled inline in the passage; no separate bank |
| `matching_features` | ✅ (Sprint 20.14b) | ✅ (list of {label, text} — the feature bank) | – | The chosen label, e.g. `"D"` |
| `matching_sentence_endings` | ✅ (Sprint 20.14b) | ✅ (list of {label, text} — the endings bank) | – | The chosen label, e.g. `"E"` |
| `flow_chart_completion` | ✅ (Sprint 20.14b) | – | optional | Same as `sentence_completion` (filled-in word(s) as a string) |
| `diagram_label_completion` | ✅ (Sprint 20.14b) | – | optional | Same — a string |

> The DB `CHECK` constraint (migration `086_reading_module_foundation.sql`) accepts the *full* IELTS question-type set, and the **importer's whitelist** (Sprint 20.14b) now accepts all 16 IELTS reading types.

#### `summary_completion` — word-bank vs no-word-bank variant (Sprint 20.14b)

Per Standards §2A.10 / §2A.11 the two variants of summary completion render differently:
- **2A.10 — no word bank** — student types a word from the passage into each gap. Author shape: `summary_completion` with **no `options:`**, `answer:` is a string.
- **2A.11 — with word bank A–J** — student picks a label from the bank. Author shape: `summary_completion` with **`options: [{label: "A", text: "factor"}, …]`** (the bank, ≥ gaps + 2), `answer:` is a label string `"C"`.

The DB type tag stays `summary_completion` for both. The renderer + grader branch on the presence of authored `options:`.

#### `summary_completion` — flowing block via `template.summary_text` (Sprint 20.14e)

Standards §2A.10 mandates that summary completion render as **one flowing paragraph in a single box**, with a numbered gap (and the answer input) AT each `____` position — not as a column of separate sentence cards.

Authoring shape: the **first** `summary_completion` question in a consecutive run carries `template: { summary_text: "..." }`. The text is the full summary prose with `{{N}}` gap markers, where `N` is the q_num of the question whose answer fills that gap. Example for a run covering Qs 36–40:

```yaml
- q_num: 36
  question_type: summary_completion
  prompt: "(see summary above)"
  template:
    summary_text: |
      During slow-wave sleep, the hippocampus appears to {{36}} fragments
      learned earlier. Long-term storage of memories happens in the {{37}}.
      A nap that consolidates memory should usually last about {{38}}
      minutes. REM sleep may be where {{39}} originates, by linking
      unrelated knowledge. What the writer says is no longer debated is
      that sleep is an essential {{40}} of mental activity.
  answer: "replay"
  skill_tag: detail
- q_num: 37
  question_type: summary_completion
  prompt: "(see summary above)"
  answer: "cortex"
  skill_tag: detail
# … Qs 38–40 same pattern: prompt is a placeholder, answer is per-Q,
# no `template:` on the follow-up questions
```

For the **word-bank variant** (§2A.11), add `options: [...]` on the first Q alongside `summary_text`. The renderer emits a separate `.exam-word-bank-box` above the summary box, and each `{{N}}` gap becomes a `<select>` of labels (not a text input).

**Behaviour:**
- The renderer treats the first-Q with `summary_text` as the OWNER of the run; the cards for Qs 37–40 are absorbed into the flowing block. Only the first Q's prompt is visible (as a fallback to the standards' summary-instruction placement).
- `{{N}}` markers must reference q_nums that exist in the run; an unrecognised `{{N}}` renders as literal text.
- Each gap maps to its q_num for grading — `submitAttempt` posts one answer per q_num, same as the legacy per-Q shape.
- **Backward compat:** runs without `template.summary_text` on the first Q still render as the per-Q card path (legacy behaviour). The DB type tag stays `summary_completion`; the validator + grader are unchanged.

The `prompt:` field on absorbed questions must still satisfy the importer's "non-empty prompt" rule. A short placeholder like `"(see summary above)"` is the convention.

#### `mcq_multi` scoring (Sprint 20.14b)

Set-equality, all-or-nothing. The grader normalises each chosen label (case / whitespace / diacritic / UK-US per §4.3) and compares the user's set to the authored set. Extras OR omissions both fail the question. There is no partial credit (matches IELTS marking-guide convention for the format). The frontend serialises the chosen labels as a comma-separated string (e.g. `"A,C"` or `"A, C"`) — the grader splits on both `,` and `;` before normalising.

### 4.3 Answer-matching rules (Sprint 20.5 grader)

Cloned from listening's `answer_matches`:

- Case-insensitive.
- Whitespace collapsed and trimmed.
- **Diacritic-insensitive** (Sprint 20.13c, Interactive HTML Standards §5.3). NFD-decompose the answer and strip combining marks (U+0300–U+036F), so `El Niño` ≡ `El Nino` and `café` ≡ `cafe`. The change is forward-compatible — the AVR-READ-001 seed carries zero non-ASCII characters in answer keys, so existing graded attempts produce identical scores.
- UK/US spelling pairs normalised (e.g. `colour` ↔ `color`).
- No contractions normalisation — `it's` ≠ `it is`. Spell out if both forms are acceptable answers.
- `T` / `F` / `NG` are accepted as shortcut alternatives for `TRUE` / `FALSE` / `NOT GIVEN` (and likewise `Y` / `N` / `NG`) **when you list them in `alternatives:`**. They are not auto-normalised.
- `answer:` may be a **string list** for `mcq_multi` (Phase B): the grader treats list answers as a candidate set; any match wins. Phase 1 authors should use a single string.

> **Naming**: `alternatives:` is this format's name for the Interactive HTML Standards' `answer_accept` field (Standards §5.3). Same semantics — accepted variants matched alongside the canonical `answer`. The format keeps `alternatives:` to avoid churning the existing seeds and importer.

### 4.4 Per-question validation errors

| Error message (Vietnamese, returned by importer) | Meaning |
|---|---|
| `Câu hỏi #N: cần 'q_num' là số nguyên dương.` | `q_num` missing, non-int, ≤ 0, or `true`/`false`. |
| `Câu hỏi #N: q_num <n> bị trùng.` | Two questions share the same `q_num`. |
| `Câu hỏi #N: 'question_type' phải là một trong …` | Not in `READING_QUESTION_TYPES_PHASE1`. |
| `Câu hỏi #N: thiếu 'prompt'.` | Empty / missing `prompt`. |
| `Câu hỏi #N: thiếu 'answer'.` | `answer` is `null`, empty string, or empty list. *(Dicts pass this guard — see §10.)* |
| `Câu hỏi #N: 'skill_tag' phải là một trong …` | Not in `SKILL_TAGS`. |

---

## 5. L2 — Skill Practice Exercise

`content_type: reading_skill_exercise` → `reading_passages` row, `library='l2_skill'`.

L2 is **almost identical to L1 in structure**. The only structural differences:
- `skill_focus` is **required** (the primary skill the exercise drills).
- All `questions` must use the question shape from §4 (typically 4–8 questions, all sharing the exercise's `skill_focus` in their per-question `skill_tag`).

### Frontmatter fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `content_type` | ✅ | string | Must be `reading_skill_exercise` |
| `title` | ✅ | string | 2–200 chars |
| `slug` | optional | string | Auto-slugified from `title` if omitted |
| `skill_focus` | ✅ | enum | One of `SKILL_TAGS` — the exercise's primary skill |
| `difficulty_level` | optional | enum | `foundation` \| `intermediate` \| `advanced` |
| `topic_tags` | optional | string[] | |
| `estimated_minutes` | optional | int | |
| `word_count` | optional | int | |
| `image_url` | optional | string | `http(s)://…` |
| `published` | optional | bool | Default `false` |
| `glossary` | optional | object[] | Allowed but rarely used in L2 (skill drills, not vocab) |
| `questions` | ✅ | object[] | At least one question — see §4 |

### Body

The passage Markdown. As for L1, GFM with the same restrictions.

### L2-specific validation

- `skill_focus` missing → *"Bài luyện kỹ năng (L2) bắt buộc 'skill_focus' (một trong: …)"*.
- `skill_focus` value not in `SKILL_TAGS` → *"Phải là một trong: …"*.

> **Author tip — internal consistency.** Each question's `skill_tag` may legitimately differ from the exercise's `skill_focus` (the exercise drills a primary skill but can include 1–2 questions that probe a secondary skill). Don't force every `skill_tag` to match `skill_focus` — keep the per-question tag honest about what the question really measures.

---

## 6. L3 — Full Test (3 passages, 40 questions)

`content_type: reading_full_test` → one `reading_tests` row + 3 `reading_passages` rows (`library='l3_test'`, `passage_order` 1–3) + their 40 `reading_questions`.

### 6.1 L3 is **YAML-only**

The entire test — test metadata, all three passage bodies, and all 40 questions — lives in **YAML frontmatter**. The Markdown body of the `.md` file is **intentionally unused** and discarded by the L3 parser. This was Sprint 20.5's deliberate call: it keeps parsing trivial (no markdown-header scanning, no fenced-JSON extraction, no two-format ambiguity) and reuses the L1 questions-in-YAML idiom.

Recommendation for the content-production agent: keep the closing `---` followed by a one-line comment explaining the file is YAML-only, so a human reader doesn't paste body text expecting it to render. The seed file does exactly this.

### 6.2 Test-level frontmatter

| Field | Required | Type | Notes |
|---|---|---|---|
| `content_type` | ✅ | string | Must be `reading_full_test` |
| `test_id` | ✅ | string | External id, e.g. `AVR-READ-001`. Pattern: `^[A-Za-z0-9][A-Za-z0-9_\-]{1,63}$`. UNIQUE (idempotent upsert key). |
| `title` | ✅ | string | 2–200 chars, e.g. `"Academic Reading — Test 1"` |
| `module` | optional | enum | `academic` (default) \| `general_training`. GT band table is Phase B — `band_estimate` returns `None` for GT. |
| `time_limit_minutes` | optional | int | Default `60`. > 0. |
| `passage_count` | optional | int | Default `3`. 1–3. Must equal `len(passages)`. |
| `total_questions` | optional | int | Default `40`. 1–40. Must equal the sum of `len(passages[i].questions)`. |
| `band_target` | optional | number | 1.0–9.0. Informational only. |
| `published` | optional | bool | Default `false`. |
| `passages` | ✅ | object[] | 1–3 entries — see §6.3. |

### 6.3 Per-passage block (inside `passages:`)

```yaml
passages:
  - passage_order: 1
    slug: l3-t1-p1-hand-made-goods
    title: "The Return of Hand-Made Goods"
    word_count: 520                        # optional
    estimated_minutes: 18                  # optional
    topic_tags: [economy, culture]         # optional
    body_markdown: |
      A The high street of any large city used to look the same...
      B Several factors lie behind the shift...
    questions:
      - q_num: 1
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph A."
        options:                           # ← FLAT, not under payload:
          - label: i
            text: "A measurable, growing industry"
          - label: ii
            text: "Why uniformity once seemed like progress"
        answer: "ii"                       # ← FLAT string, not nested dict
        alternatives: []
        skill_tag: skimming
        explanation: "Paragraph A sets up uniformity as the older default."
      # ... more Qs for passage 1
  - passage_order: 2
    # ...
  - passage_order: 3
    # ...
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `passage_order` | ✅ | int | 1, 2, or 3. Unique across `passages`. |
| `slug` | ✅ | string | Matches slug regex. Unique across **all** `reading_passages` (idempotent upsert key — re-import updates by slug). |
| `title` | ✅ | string | Non-empty. |
| `body_markdown` | ✅ | string | The passage prose (use `|` block scalar in YAML — see §6.4). Non-empty, ≤ 50,000 chars. |
| `word_count` | optional | int | Informational. |
| `estimated_minutes` | optional | int | Informational. |
| `topic_tags` | optional | string[] | |
| `questions` | ✅ | object[] | Non-empty list. Each question follows §4. |

### 6.4 YAML block scalar for `body_markdown`

Use a literal block scalar `|` so newlines, indentation, and special characters survive YAML parsing intact:

```yaml
    body_markdown: |
      A The high street of any large city used to look the same. A row of
      familiar shop signs, the same goods in every window, the same prices
      to within a few pence...
```

The `|` keeps newlines. Indent every body line by **the same amount of spaces** (the parser strips the common prefix). Do **not** use `>` (folded — it joins lines into paragraphs) unless you want that.

### 6.5 L3 cross-passage rules (validation)

- `len(passages) == passage_count`.
- `passage_order` values across `passages` are unique and within 1–3.
- `slug` values across `passages` are unique.
- `q_num` values are **unique across the whole test** and **count equals `total_questions`** (the parser doesn't require them to be 1..N contiguous, but the Cambridge convention and the Sprint 20.6 exam UI expect 1..40).
- Each per-question check in §4.4 still applies.

### 6.6 L3 import side-effects (idempotent re-import)

When committed with `?dry_run=false`:
1. `reading_tests` row is upserted by `test_id`.
2. **Passage reconciliation (Sprint 20.9 D1):** the importer enumerates every `reading_passages` row currently attached to the test (`test_id` FK, `library='l3_test'`) and **deletes any whose `slug` is missing from the new payload**. Their `reading_questions` go with them via `ON DELETE CASCADE`. The slugs that were deleted are returned in `response.removed_passage_slugs` for operator visibility.
3. Each `reading_passages` row in the incoming payload is upserted by `slug` (with `test_id` FK + `library='l3_test'` stamped).
4. For each passage, `reading_questions` are **deleted then re-inserted** (delete-by-`passage_id`, then insert). The question set for each incoming passage is fully replaced.

Together, steps 2–4 make "fully overwrites" accurate: an L3 file with a removed or renamed passage leaves no orphan rows after re-upload. (Before Sprint 20.9 / Codex audit P1-1, only steps 1, 3, and 4 ran; an operator removing a passage would silently leave stale passage + question rows attached to the test.)

**Residual non-transactional risk.** The sequence is still best-effort sequential — Supabase REST doesn't expose multi-statement transactions. If commit fails between the `reading_tests` update and the per-passage step (e.g. a network drop, a 5xx from Postgres), the database is in a real partial state until the next re-import. Re-importing the same file converges: every step's key is the `test_id` / `slug`, and the reconciliation step in (2) makes orphan cleanup automatic. The remaining risk is documented in §11/P1-4 — escalating to a server-side transactional import is deferred until operational failures justify the redesign.

---

## 7. Complete worked examples

The three import-ready examples live in `content_examples/` next to this file:

- `content_examples/l1-the-paper-trail-of-money.md` — L1 vocab passage, 6 glossary entries, 4 questions covering 4 question types.
- `content_examples/l2-scanning-public-transport.md` — L2 skill drill, `skill_focus: scanning`, 6 questions.
- `content_examples/l3-academic-reading-test-2.md` — L3 full test, 3 passages × 13/13/14 Qs = 40, mixed question types, Academic module.

Each example has been dry-run-validated against the live importer (`backend/tests/test_reading_content_format_v2_examples.py` — runs `validate_*` on each file and asserts `validation_errors: []`). Drift in the importer breaks that test, so the examples stay accurate.

---

## 8. Agent-authoring guidance — quick reference

### Self-checklist before submitting (any type)

- [ ] File starts with `---` on **line 1** (no BOM tricks, no leading blank line).
- [ ] `content_type` is exactly one of `reading_passage_l1` / `reading_skill_exercise` / `reading_full_test`.
- [ ] `title` is 2–200 chars.
- [ ] `slug` (L1/L2 — optional) and every L3 `passages[i].slug` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- [ ] Body markdown is non-empty (or for L3, every `body_markdown:` block scalar is non-empty), ≤ 50,000 chars.
- [ ] T/F/NG and Y/N/NG answers are **quoted strings** (`answer: "TRUE"`, not `answer: TRUE`).
- [ ] Every question has `q_num`, `question_type` (Phase 1 set), `prompt`, `answer`, `skill_tag`.
- [ ] `options:` (when present) is at the **question top level**, not nested under `payload`.
- [ ] `answer:` is a **string** (or list for Phase B `mcq_multi`), not a nested `{answer, alternatives}` dict.
- [ ] `alternatives:` (when present) is a **list of strings**, not a single string.
- [ ] `skill_tag` values are from `SKILL_TAGS` (no free-form tags).
- [ ] L2 only: `skill_focus` is present and in `SKILL_TAGS`.
- [ ] L3 only: `test_id` matches `^[A-Za-z0-9][A-Za-z0-9_\-]{1,63}$`; `len(passages) == passage_count`; total Q count equals `total_questions`; no duplicate `q_num` across the test; no duplicate `slug` across passages.

### Dry-run-then-commit workflow

```bash
# Step 1 — dry-run (no DB write)
curl -X POST \
  "$BASE/admin/reading/content/import?dry_run=true" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -F "file=@my-passage.md"

# Inspect response.validation_errors — fix and re-dry-run until it's [].

# Step 2 — commit
curl -X POST \
  "$BASE/admin/reading/content/import?dry_run=false" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -F "file=@my-passage.md"
# response.action = "created" | "updated", response.committed_id = <uuid>
```

Re-uploading the same file is safe (slug- / test_id-keyed upsert). If you change the `slug` between commits, you create a *new* row — the old row stays in the DB. To rename, use the admin list endpoint to delete the old row, or rename via SQL.

### Common rejection reasons (from the live validator)

| Symptom | Likely cause |
|---|---|
| `Không tìm thấy frontmatter YAML.` | Missing or mis-indented `---` fences. The opening fence must be the very first line. |
| `Frontmatter YAML không hợp lệ: …` | YAML syntax error (often a stray tab, an unbalanced `[`, or an unquoted boolean-looking string). |
| `Phải là một trong: reading_passage_l1, reading_skill_exercise, reading_full_test.` | Typo in `content_type`. |
| `Bài luyện kỹ năng (L2) bắt buộc 'skill_focus'` | L2 file missing `skill_focus`. |
| `Câu hỏi #N: thiếu 'answer'.` | `answer:` is empty, missing, or an empty list. Most often: unquoted `answer: FALSE` got parsed as boolean `False`, which counts as "not a non-empty string". |
| `Câu hỏi #N: 'question_type' phải là một trong …` | Authored a Phase B type (e.g. `mcq_multi`, `matching_information`). |
| `Câu hỏi #N: 'skill_tag' phải là một trong …` | Used a free-form skill label instead of the D2 enum. |
| L3: `Số passages (N) khác passage_count (M).` | `passage_count` doesn't match the number of entries in `passages:`. |
| L3: `Tổng số câu hỏi (N) khác total_questions (M).` | Sum of per-passage `questions` length ≠ `total_questions`. |
| L3: `q_num bị trùng giữa các passages: …` | Two passages share a `q_num`. |

---

## 9. Idempotency, deletion, and recovery

### Idempotent re-import
- **L1/L2**: keyed by `slug` (`reading_passages.slug` is UNIQUE). Re-upload with the same slug → row is `update`d; `reading_questions` for that passage are deleted-then-reinserted (full set replaced).
- **L3**: keyed by `test_id` for the `reading_tests` row, and by `slug` for each `reading_passages` row. Re-upload → all rows update in place; every passage's questions are replaced; **and any passage row missing from the new upload is deleted** (Sprint 20.9 D1 — see §6.6). `response.removed_passage_slugs` lists the cleanups so the operator can spot accidental deletions.

### Deleting content
There is no admin "delete" endpoint yet (Sprint 20.3 shipped a list endpoint; delete is Phase B). To remove a row, use the Supabase admin UI / SQL. Cascading: `reading_passages → reading_questions` via FK `ON DELETE CASCADE`, so deleting a passage cleans up its questions.

### Recovery after a partial L3 import
If an L3 commit fails mid-way (e.g. between passage 2 and passage 3 insert), the partial state is consistent enough for a re-import to converge: re-upload the same file with `dry_run=false`. Every step's upsert is keyed by `test_id` / `slug` so it picks up where it left off, and the Sprint 20.9 reconciliation step cleans up any orphan passages from the failed run. The recovery is not transactional — see §11/P1-4 for the residual debt.

---

## 10. Known importer quirks (document, don't depend on)

These are quirks of the current importer that authors may run into. They are accurate as of Sprint 20.6 — none are guaranteed forever; treat them as today's reality and fix in your file rather than relying on the quirk.

1. **~~`answer:` as a YAML dict passes the "missing answer" guard~~** — **CLOSED in Sprint 20.6.6.** The validator now rejects dict-valued `answer:` loudly at dry-run, with an error pointing to v2 §4. Write `answer:` as a string (or list for `mcq_multi`).
2. **~~`options:` nested under `payload:` is silently ignored~~** — **CLOSED in Sprint 20.6.6.** The validator now rejects an author-level `payload:` key loudly. Put `options:` at the question top level.
3. **~~`alternatives:` as a string is silently dropped~~** — **CLOSED in Sprint 20.6.6.** The validator now requires `alternatives:` to be a list when present.
4. **`order_num` from the author is ignored.** The builder always assigns `order_num = i + 1` based on list order. This is by design — authors should not set it.
5. **`word_count` is informational.** The validator does not cross-check it against the actual body word count. Author it from your own count.
6. **L1 `skill_focus`** is allowed (and validated against `SKILL_TAGS` if given) but the L1 renderer ignores it. Use only when authoring L2; leave it out of L1.
7. **L3 `module: general_training`** parses and validates, but `band_estimate()` returns `None` for GT — by design, until the GT raw→band table ships (Phase B). The submit endpoint will surface `band_estimate: null` rather than a wrong estimate.
8. **L3 import is best-effort sequential, not transactional** (Codex audit P1-4 residual). The importer runs through `reading_tests` → passage reconciliation → passage upsert → per-passage question replacement as a sequence of independent Supabase REST calls. A mid-way failure leaves a partial state; re-importing the same file converges (Sprint 20.9 reconciliation cleans orphans), but there is a window where the DB does not reflect a single consistent test. The redesign to a transactional path is deferred — see §11/P1-4.

---

## 11. Importer findings — history

### F1 / F2 — CLOSED in Sprint 20.6.6 (silent → loud)

**Surfaced in:** Sprint 20.6.5 (PR #329, spec audit) — the v1-spec **nested** question shape (`payload: {options: …}` + `answer: {answer, alternatives}`) parsed + validated clean but built into broken DB rows (`payload: {}`, double-nested `answer`). The 20.5 seed `l3-academic-reading-test-1.md` shipped in this shape; importing it via `dry_run=false` would have produced an L3 exam where 40/40 questions render with no options and 40/40 grade wrong for any student answer.

**Closed in:** Sprint 20.6.6 (this PR). Three changes:

1. **Validator hardening (F1):** `validate_reading_questions` now rejects (a) author-level `payload:` and (b) dict-valued `answer:` with clear errors pointing to v2 §4. Authors who submit the v1 nested shape see the failure at dry-run instead of in production.
2. **Validator hardening (F2):** `validate_reading_questions` now requires non-empty `options: [{label, text}, …]` for `mcq_single` and `matching_headings` (the only Phase 1 types that render a labelled-choice list).
3. **Seed correction:** `l3-academic-reading-test-1.md` (test_id `AVR-READ-001`) is rewritten to the v2 FLAT shape. Content (passages, questions, answers, alternatives, skill_tags, explanations) is unchanged; only the question YAML reshapes. Round-trips cleanly through parse → validate → build → grader: a perfect student now scores 40/40 (band 9.0).

**Test coverage gap closed:** the existing seed regression (`test_seed_l3_test_parses_and_validates_clean`) stopped at parse + validate and missed the build-step regression. Sprint 20.6.6 adds `test_corrected_l3_seed_builds_and_grades_correctly` which rounds the seed through the full parse → validate → build → `collect_answer_key` → grade chain.

### Production impact (was anything actually broken?)

The broken seed lives at `backend/content/reading/l3-academic-reading-test-1.md` — content files are **not** auto-imported. They land in the DB only when an admin uploads them through `POST /admin/reading/content/import?dry_run=false`. **If `AVR-READ-001` was ever committed via that endpoint** between Sprint 20.5 and 20.6.6, the resulting `reading_questions` rows have `payload: {}` (options dropped) + double-nested `answer` (un-gradeable), and any `reading_test_attempts` against them are mis-scored. **Recovery is straightforward:** re-upload the corrected seed (this PR's `l3-academic-reading-test-1.md`) with `dry_run=false`. The L3 importer is idempotent (`test_id` + `slug` keyed upsert) and deletes-then-reinserts the question set per passage, so re-import fully overwrites the broken rows. Existing `reading_test_attempts` retain their stored `grading_details`; if any pre-fix attempts need recomputation, re-grade them off the corrected `reading_questions` (separate ops task).

The L1/L2 seeds (`l1-*.md`, `l2-*.md`) and the 20.6.5 worked examples were always in the FLAT shape and were never affected.

### P1-1, P1-2, P1-3, P2-1, P2-2 — CLOSED in Sprint 20.9 (audit-driven hardening)

The Codex audit (`docs/clusters/20_x/audits/codex_audit_cluster_20_x.md`) surfaced five integrity / quality gaps where the cluster's docs claimed stronger guarantees than the code enforced. Sprint 20.9 closes them and updates the language above to match the new reality:

- **P1-1 (L3 reconciliation)** — was "Re-import fully overwrites; no orphans" in §6.6, even though the importer only updated **incoming** passages. Now §6.6 documents the actual reconciliation step (Sprint 20.9 D1, migration 088-adjacent change in `admin_reading.py`), and the importer enumerates + deletes orphan passages on every re-import. `response.removed_passage_slugs` surfaces what was cleaned.

- **P1-2 (one-active-attempt invariant)** — was "the Q7 invariant ensures ≤1 active attempt per user+test" in governance §1, even though only application code enforced it. Migration 088 adds the partial unique index `uniq_reading_test_attempts_active`; the router (`start_reading_test_attempt`) handles the unique-violation race by retrying its abandon-then-insert sequence (newest start wins).

- **P1-3 (atomic autosave)** — was "PATCH /answers is idempotent per q_num" implied across multiple docs, even though the implementation was a read-modify-write against the `answers` JSONB array that could lose concurrent edits. Migration 088 introduces `reading_attempt_answers (attempt_id, q_num PK)`; PATCH is now an upsert by composite PK (intrinsically atomic). The submit handler gathers the authoritative answer set from this table; the body's `answers:` field still overrides per-q_num for the final batch as a last-write-wins fallback.

- **P2-1 (fail-closed `started_at`)** — the submit handler used to default `elapsed_seconds = 0` on a parse failure, silently disabling the Q5 time-limit guard. Now it returns 422 with a clear "Attempt có started_at không hợp lệ" message, so an operator notices instead of grading a corrupted attempt as if it just started.

- **P2-2 (diagnostic boundary tests)** — 20.7's diagnostic engine had representative-value tests but no exact-boundary pins. Sprint 20.9 adds `test_d5_diagnostic_level_at_exact_boundary_{59,60,74,75}` covering both sides of the `weak`/`watch`/`strong` thresholds.

### P1-4 — residual debt acknowledged (still open)

The L3 import sequence remains best-effort sequential — Supabase REST does not expose multi-statement transactions, so a mid-way failure between step 2 (passages) and step 4 (questions) leaves a real partial state until the operator re-imports. Sprint 20.9 D1 reduces the blast radius (orphan passages are reconciled on next import), but does not make the import transactional. The redesign (server-side SQL function, or a worker-queue model) is out of scope; reopen if operational failures justify it. The doc in §6.6 is honest about the residual risk.

### P2-3 — diagnostic recommendation ranking (deferred)

L2 recommendations are returned in `created_at desc` order (recency-ranked, not pedagogically-ranked) and silently return `recommendations: []` when no L2 exercise matches a weak skill. Governance §1 now documents this as **intentional Phase 1 behavior**; the change to a pedagogical ranking or a learner-facing fallback message is deferred until product signal justifies the work.

### P2-5 — diagnostic thresholds are heuristics (documented)

`WEAK_THRESHOLD_PCT = 60`, `WATCH_THRESHOLD_PCT = 75`, and `TREND_DELTA_PCT = 10` are observation-phase product heuristics, not externally validated IELTS thresholds. Retrospective §2.8 (new) records this honestly.

---

## 12. Iteration notes

- **v2 supersedes v1.** v1 (`reading_content_format_v1.md`) is kept for history but its question YAML examples are wrong (they show the storage shape, not the author shape). The L1 section of v1 is still accurate; the L2/L3 sections were spec-only at the time of writing and are superseded here.
- Additive optional fields (e.g. a new optional `audio_url` on glossary entries) do not bump the version. A breaking change ships as v3.
- The Phase B unlock — `mcq_multi`, the rest of the matching family, `module: general_training` band table — is tracked in cluster 20.x next-steps, not gated by this spec.
