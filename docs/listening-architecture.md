# Listening — Module Architecture

**Last measured:** 2026-06-08 (after the full-test import work #397–#408 + pack v1.2).
**Scope:** how the Listening module is built today, and a proposed convergence direction.

> **How to read this doc.** Every claim is tagged:
> - **[MEASURED]** — verified against the current code (file paths cited). This is what exists.
> - **[INTENDED]** — a proposal / future direction. **Not built.** Never treat an INTENDED line as a feature that exists.
>
> Single-source note (#47): the high-level site map stays in [`SITE_OVERVIEW.md`](SITE_OVERVIEW.md) (§4.4 student, §4.9 admin). This doc is the *deep* listening reference it links to — it does not duplicate the index.

---

## 1. Exercise types at a glance — [MEASURED]

`listening_exercises.exercise_type` CHECK enum = `dictation | gist | true_false | mcq | mini_test`
(`backend/migrations/056_listening_module_foundation.sql:129`).

| Type | Built? | Created today (admin) | Schema home | Grading |
|------|--------|------------------------|-------------|---------|
| **Dictation** (chép chính tả) | ✅ Production | `pages/admin/listening/segments.html` → `POST /admin/listening/exercises` | `listening_exercises` `exercise_type=dictation` + `segments` column | word-diff, `listening_grader.grade_dictation` |
| **Gist** (nghe ý chính) | ✅ Production | `pages/admin/listening/gist.html` → `POST /admin/listening/exercises` | `payload {prompt_text, model_answer, rubric_keywords[]}` | Haiku AI, `listening_gist_grader.grade_gist_response` |
| **True/False/Not-Given** | ✅ Production | `pages/admin/listening/tf.html` → `POST /admin/listening/exercises` | `payload {statements:[{idx,text,answer:T/F/NG}]}` | exact match, `listening_grader.grade_true_false` |
| **MCQ** (trắc nghiệm) | ✅ Production | `pages/admin/listening/mcq.html` → `POST /admin/listening/exercises` | `payload {questions:[{idx,stem,options[4],answer_idx}]}` | index match, `listening_grader.grade_mcq` |
| **Mini-test** | ✅ Production (as a **session**) | `pages/admin/listening/mini-test.html` → `POST /admin/listening/sessions` | `listening_sessions` (composes published exercises) | aggregate score + heuristic band |
| **Full-test** (Cambridge-style) | ✅ Production | **4-file pack upload** `pages/admin/listening/import-fulltest.html` → `POST /admin/listening/import-fulltest[/commit]` | `listening_tests` bundle → 4 `listening_content` → block-shaped `listening_exercises` | per-question, `listening_test_grader` |

**Two important nuances [MEASURED]:**
- `mini_test` is a value in the `exercise_type` CHECK, **but no admin path creates an individual `mini_test` exercise** — mini-tests are `listening_sessions` rows (`session_type='mini_test'`) that *compose* already-published dictation/gist/tf/mcq exercises.
- The four single-exercise types (dictation/gist/tf/mcq) are **authored through interactive admin forms** — one exercise at a time. **Only the full-test path uses a file-pack upload.** (This is the gap the convergence proposal in §7 addresses.)

---

## 2. Schema — [MEASURED]

```
listening_content   — one "section"/audio item: transcript, audio_storage_path,
                      accent_tag, cefr_level, ielts_section, status, metadata.
                      (For a full test: 4 rows, each FK'd to a listening_tests row via test_id.)
listening_exercises — the question granule: content_id FK, exercise_type, payload JSONB,
                      segments (dictation only), status, order_num.
listening_sessions  — mini-test composition: session_type, exercise_ids[], ordered_position[].
listening_attempts  — a student answer: exercise_id (+ optional listening_session_id), score,
                      is_correct, first-attempt-canonical (Sprint 10.3).
listening_tests     — full-test bundle: test_id (external), title, version, band_target,
                      accent_profile[], themes{}, full_audio_storage_path,
                      full_audio_duration_seconds, cue_points, audio_assembly_mode,
                      metadata{section_offsets, band_conversion, source_format,
                      transcript_source}, status (draft/published/archived).
```

**Payload polymorphism by `exercise_type` [MEASURED]** (validators in `backend/routers/listening.py`):
- `dictation` — `payload {}`; the data lives in the `segments` column: `[{idx,start_sec,end_sec,transcript}]`.
- `gist` — `_validate_gist_payload` (`:88`) → `{prompt_text, model_answer, rubric_keywords[≤10]}`.
- `true_false` — `_validate_true_false_payload` (`:113`) → `{statements:[3–12 × {idx,text,answer∈T/F/NG}]}`.
- `mcq` — `_validate_mcq_payload` (`:162`) → `{questions:[1–20 × {idx,stem,options[exactly 4],answer_idx 0–3}]}`.
- **full-test exercises** — block-shaped payload enriched by the importer: `{answers, audio_windows{q→{start,end,section}}, solutions{q→{...}}, transcript_anchors{q→para_idx}, questions[]}` (`backend/services/listening_fulltest_import.py` `build_section_persistence`). Answer key is stripped from the live test and revealed only in the review.

Audio: stored in the Supabase `LISTENING_AUDIO_BUCKET`. Full tests use one premixed mp3 (`audio_assembly_mode='full_premixed'`, path on the `listening_tests` row); per-type exercises reference their `listening_content` audio.

---

## 3. Creation paths today — [MEASURED]

| Path | Admin UI | Endpoint | Produces |
|------|----------|----------|----------|
| Per-type exercise form | `segments` / `gist` / `tf` / `mcq` `.html` | `POST /admin/listening/exercises` | one `listening_exercises` row |
| Mini-test builder | `mini-test.html` | `POST /admin/listening/sessions` | one `listening_sessions` row (composes existing exercises) |
| **Full-test pack** | `import-fulltest.html` (#408) | `POST /admin/listening/import-fulltest` (dry-run) → `/commit` | 1 `listening_tests` + 4 `listening_content` + block exercises + mp3 |
| **Convert DOCX → test** | `convert.html` (still live, linked from `index.html` + `tests.html`) | `POST /admin/listening/convert[/commit]` (`services/listening_convert.py`) | a test bundle from a 2-file DOCX/text source |
| Status transitions | `tests.html` list (#408) | `PATCH /admin/listening/tests/{id}/status` | draft ⇄ published ⇄ archived (publish has an audio gate) |

> Note: the **convert** (DOCX/2-file) path and the **full-test pack** (4-file) path are **both live** and parallel — convert was NOT removed. They produce the same `listening_tests` shape by different ingestion routes.

---

## 4. Serve · do · grade — [MEASURED]

- **Serve:** `GET /api/listening/content` (`:2563`) + `GET /api/listening/exercises?content_id=&exercise_type=` (`:1821`); full tests via the test/section endpoints + a signed audio URL.
- **Do + grade (per-type):** `POST /api/listening/attempts` (`:1383`) dispatches on `mode`:
  - `dictation` → `grade_dictation` (word-level normalized diff)
  - `gist` → `grade_gist_response` (Anthropic Haiku vs rubric + keywords)
  - `true_false` → `grade_true_false` (exact match)
  - `mcq` → `grade_mcq` (index match; answer key hidden from the client)
- **Full-test:** `POST /api/listening/tests/{test_id}/attempts` (`:5184`); answer key from `listening_test_grader.collect_answer_key` (reads `payload.answers`). Post-submit review: `GET /api/listening/tests/attempts/{id}/review` (owner-only, joins grading_details + per-Q audio window + solution + `transcript_anchor` + signed audio; renders the full bản đọc transcript with anchored highlight — pack v1.2).
- **Mini-test:** `GET /api/listening/sessions/{id}` serves the composed lineup; `POST …/complete` aggregates the member attempts into a session score + heuristic band.
- **First-attempt rule (Sprint 10.3) [MEASURED]:** all attempts are stored, but the *canonical* score per (user, exercise[, segment]) is the first attempt.

Student pages: `listening.html` (hub) · `listening-browse.html` · `listening-{dictation,gist,tf,mcq}.html` · `listening-mini-test.html` · `listening-test.html` (full) · `listening-review.html` (chữa-bài) · `listening-analytics.html`.

---

## 5. Full-test pack pipeline (#397–#408, pack v1.2) — [MEASURED]

```
4-file pack ─upload─▶ dry-run (parse + fail-loud validate) ─▶ preview/commit ─▶ status manage
  Question_Paper.md   POST /import-fulltest           POST …/commit       PATCH /tests/{id}/status
  Solution.md         → {ok, errors[], warnings[],    → 1 test + 4         draft→published→archived
  timings.json           section_count, question_count,  content + block      (publish = audio gate)
  full_test.mp3          questions[], metadata{...}}     exercises + mp3
```

- **Parser:** `backend/services/listening_fulltest_import.py` (`parse_fulltest`); fail-loud (`ok=False` + `errors[]`) on missing answer / missing audio window / audio↔timings divergence (±0.1s).
- **Pack v1.2 transcript [MEASURED]:** the Solution carries two blocks — `# Transcript (bản đọc)` (display copy, verbatim `**Name (role):**` labels) → `listening_content.transcript`; and `# Audio Transcript / Script đầy đủ` (production copy with `(Qn)` markers) → used to compute per-question `transcript_anchors` (text-matched), stored in the exercise payload (no migration, Pattern #15). v1.1 packs fall back to joined-extracts + a warning.
- **Import UI (#408):** `import-fulltest.html` — drag-drop the 4 files, dry-run, commit with a real upload progress bar, dup-ACTIVE handled in one click ("Archive bản cũ & Import"), "Publish ngay". Token is automatic (admin session Bearer) — no hand-pasted JWT.

---

## 6. Known gaps — [MEASURED] (documented, NOT fixed here)

1. **Import UI has no content preview / IMG-PROMPT surfacing.** The dry-run response already returns `questions[]` (with `prompt`, `options`, `answer`, **`img_prompt`** [`listening_fulltest_import.py:410`], `solution`, `audio_window`) + `warnings`, but `admin-listening-fulltest-import.js` `renderResult` shows only the validation banner + counts. Rendering a question/transcript preview and extracting/displaying the per-question IMG-PROMPT is a **render-layer** addition (no backend change). Natural feeder for the β AI-generated-diagrams stream (IMG-PROMPT → image).
2. **Two parallel full-test ingestion paths** (convert DOCX 2-file vs full-test 4-file pack) coexist; no doc previously stated which is canonical. They produce the same `listening_tests` shape.
3. **`mini_test` enum value is unused as an exercise** (it's a `session_type`) — a latent inconsistency in the CHECK, harmless today.

---

## 7. Hướng tới — convergence on the pack-upload model — [INTENDED, CHƯA BUILD]

> Everything in this section is a **proposal**. None of it exists yet. Andy's idea: author *all* listening types via a file-pack upload like the full-test, instead of per-type interactive forms.

**Today [MEASURED]:** only full-test uses pack-upload; dictation/gist/tf/mcq are form-authored one at a time; mini-test is composed from existing exercises.

**Proposed model [INTENDED]:** a generalized "listening pack" reusing the full-test pipeline shape (dry-run → preview → commit → status + the #408 UI), where a pack = audio + transcript + a per-type exercise spec the parser maps onto the existing `exercise_type` payloads:

| Type | Pack would carry [INTENDED] | Maps onto (existing schema) |
|------|------------------------------|------------------------------|
| MCQ | content/transcript + `questions[stem,options,answer_idx]` (MD or JSON) | `payload {questions[]}` |
| True/False | content/transcript + `statements[text,answer]` | `payload {statements[]}` |
| Gist | content/transcript + `{prompt_text, model_answer, rubric_keywords}` | `payload {…}` |
| Dictation | audio + segment list `{start,end,transcript}` | `segments` column |
| Mini-test | a manifest referencing the above specs | `listening_sessions` |

**Gaps to close [INTENDED]:** the importer/endpoint is full-test-specific (hardcoded 4-section/40-question validation in `_validate`); convergence needs (a) a generalized single-content pack schema per type, (b) a parser that emits the right `payload`/`segments`, (c) a generalized import endpoint (or a `kind` param), (d) a UI mode on the import page, (e) preview rendering (which also closes gap §6.1).

**Suggested build order [INTENDED]:**
1. **Req-1 first** — add preview + IMG-PROMPT to the existing import UI (smallest, render-layer, immediate value; §6.1).
2. **Pure-JSONB types** — generalize the importer for single-content **mcq / true_false** packs (no audio-window complexity).
3. **Audio types** — dictation (segments) + gist.
4. **Mini-test manifest** — compose imported exercises via a pack manifest.

---

## See also
- [`SITE_OVERVIEW.md`](SITE_OVERVIEW.md) §4.4 / §4.9 — the site-map index that links here.
- Point-in-time discovery (historical, may be stale): `sprint-11-0-listening-discovery.md`, `sprint-13-0-listening-authoring-discovery.md`.
