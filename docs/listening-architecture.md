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
| **Gist** (nghe ý chính) | ✅ Production | `/admin/listening/gist` (native; `pages/admin/listening/gist.html` rollback) → versioned `POST /admin/listening/exercises` + canonical GET readback | `payload {prompt_text, model_answer, rubric_keywords[]}` | Haiku AI, `listening_gist_grader.grade_gist_response` |
| **True/False/Not-Given** | ✅ Production | `/admin/listening/tf` (native; `pages/admin/listening/tf.html` rollback) → versioned `POST /admin/listening/exercises` + canonical GET readback | `payload {statements:[{idx,text,answer:T/F/NG}]}` | exact per-statement match; complete only at 100%, `listening_grader.grade_true_false` |
| **MCQ** (trắc nghiệm) | ✅ Production | native `/admin/listening/mcq` (`pages/admin/listening/mcq.html` rollback) → versioned `POST /admin/listening/exercises` | `payload {questions:[{idx,stem,options[4],answer_idx}]}` | index match, `listening_grader.grade_mcq` |
| **Mini-test** | ✅ Production (graded **1-section test**) | served at `pages/listening-mini-test.html` → played via `pages/listening-test.html` | `listening_tests` `test_type=mini` (reuses the full-test pipeline) | per-question, `listening_test_grader` |
| **Full-test** (Cambridge-style) | ✅ Production | **4-file pack upload** `/admin/listening/import-fulltest` (HTML rollback retained) → `POST /admin/listening/import-fulltest[/commit]` | `listening_tests` bundle → 4 `listening_content` → block-shaped `listening_exercises` | per-question, `listening_test_grader` |

**Two important nuances [MEASURED]:**
- `mini_test` is a value in the `exercise_type` CHECK, but no admin path creates an individual `mini_test` exercise. **The original Mini-Test session-mixer (admin `/sessions` composer + user session runner) was removed** — the "Mini Test" slot is now a graded 1-section `listening_tests` row (`test_type=mini`) served through the full-test player. The `listening_sessions` table + `listening_attempts.listening_session_id` column are retained for data (no longer written by any live path).
- The four single-exercise types (dictation/gist/tf/mcq) are **authored through interactive admin forms** — one exercise at a time. **Only the full-test path uses a file-pack upload.** (This is the gap the convergence proposal in §7 addresses.)

---

## 2. Schema — [MEASURED]

```
listening_content   — one "section"/audio item: transcript, audio_storage_path,
                      accent_tag, cefr_level, ielts_section, status, metadata.
                      (For a full test: 4 rows, each FK'd to a listening_tests row via test_id.)
listening_exercises — the question granule: content_id FK, exercise_type, payload JSONB,
                      segments (dictation only), status, order_num.
listening_sessions  — RETIRED (session-mixer removed): session_type, exercise_ids[], ordered_position[]. Data kept, no live writer.
listening_attempts  — a student answer: exercise_id (+ vestigial listening_session_id, now always null), score,
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
- `true_false` — `_validate_true_false_payload` → `{statements:[3–12 × {idx:int contiguous,text:string≤1000,answer∈T/F/NG}]}`; wrong field types fail instead of being coerced.
- Standalone `gist`, `true_false` and `mcq` surfaces allow multiple ordered authoring blocks but exactly one published block per content/type. A second publish is rejected with `409`; migration 209 adds the atomic partial-unique backstop for concurrent publishers. Legacy/imported primary blocks may remain at any order, and learner fallback resolution is explicitly ordered by `order_num` for every mode.
- `mcq` — `_validate_mcq_payload` → `{questions:[1–20 × {idx:int contiguous,stem:string≤1000,options[exactly 4 × string≤500],answer_idx:int 0–3}]}`; malformed field types fail instead of being coerced.
- **full-test exercises** — block-shaped payload enriched by the importer: `{answers, audio_windows{q→{start,end,section}}, solutions{q→{...}}, transcript_anchors{q→para_idx}, questions[]}` (`backend/services/listening_fulltest_import.py` `build_section_persistence`). Answer key is stripped from the live test and revealed only in the review.

Audio: stored in the Supabase `LISTENING_AUDIO_BUCKET`. Full tests use one premixed mp3 (`audio_assembly_mode='full_premixed'`, path on the `listening_tests` row); per-type exercises reference their `listening_content` audio.

---

## 3. Creation paths today — [MEASURED]

| Path | Admin UI | Endpoint | Produces |
|------|----------|----------|----------|
| Per-type exercise form | `segments` / `gist` / `tf` / `mcq` `.html` | `POST /admin/listening/exercises` | one `listening_exercises` row |
| **Full-test pack** | `/admin/listening/import-fulltest` (native; `import-fulltest.html` rollback, #408) | `POST /admin/listening/import-fulltest` (dry-run) → `/commit` | 1 `listening_tests` + 4 `listening_content` + block exercises + mp3 |
| **Skill-drill bundle** | `/admin/listening/import-drills` (native; `import-drills.html` rollback) | `POST /admin/listening/drills/import` (dry-run) → `/commit` | 1 drill test + 1 content row + block exercises; optional premixed mp3 |
| Status transitions | `tests.html` list (#408) | `PATCH /admin/listening/tests/{id}/status` | draft ⇄ published ⇄ archived (publish has an audio gate) |

> Note: the legacy **convert** (DOCX/2-file) path was RETIRED 2026-07-17 (usage
> audit — superseded by the 4-file full-test pack; convert stamped no
> `test_type` and left audio as a placeholder). `services/listening_convert.py`
> STAYS: its parser + marker maps are reused by the fulltest/drill importers
> and the audit engine. Tests created via convert continue to serve unchanged.

---

## 4. Serve · do · grade — [MEASURED]

- **Serve:** `GET /api/listening/content` (`:2563`) + `GET /api/listening/exercises?content_id=&exercise_type=` (`:1821`); full tests via the test/section endpoints + a signed audio URL.
- **Do + grade (per-type):** `POST /api/listening/attempts` (`:1383`) dispatches on `mode`:
  - `dictation` → `grade_dictation` (word-level normalized diff)
  - `gist` → `grade_gist_response` (Anthropic Haiku vs rubric + keywords)
  - `true_false` → `grade_true_false` (exact match)
  - `mcq` → `grade_mcq` (index match; answer key hidden from the client)
- **Full-test:** `POST /api/listening/tests/{test_id}/attempts` (`:5184`); answer key from `listening_test_grader.collect_answer_key` (reads `payload.answers`). Post-submit review: `GET /api/listening/tests/attempts/{id}/review` (owner-only, joins grading_details + per-Q audio window + solution + `transcript_anchor` + signed audio; renders the full bản đọc transcript with anchored highlight — pack v1.2).
- **Mini-test:** a graded 1-section test — `GET /api/listening/tests?test_type=mini` lists them (`listening-mini-test.js`), played + graded through the same full-test endpoints above. *(The old session-mixer endpoints `GET /api/listening/sessions/{id}` + `POST …/complete` were removed.)*
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
- **Import UI (#408):** `/admin/listening/import-fulltest` — drag/drop the 4 files, bind them to one SHA-256 fingerprint, dry-run with question/answer/IMG-PROMPT evidence, commit with a real upload progress bar, durable per-admin receipt, exact canonical GET readback and a separate publish confirmation. A duplicate ACTIVE Test ID blocks commit and hands off to the canonical Kho test status flow; the importer never archives a live row inside an ambiguous upload. Token is automatic (admin session Bearer) — no hand-pasted JWT. `import-fulltest.html` remains the explicit watchdog/manual rollback.

### 5.1 Skill-drill batch pipeline — [MEASURED]

`/admin/listening/import-drills` accepts a directory whose authoritative shape is
`Source_JSON/<TEST_ID>.json` plus optional
`audio_output/<TEST_ID>/{timings.json,full_test.mp3}`. Loose accessories attach
only when exactly one Source JSON is selected; multi-source ambiguity, duplicate
slots and audio without timings fail closed. Each bundle is SHA-256 bound before
dry-run. Valid non-duplicate rows commit sequentially with one account-scoped
receipt per POST, upload progress and exact test-detail GET verification. A 4xx
rejects one row definitively; a 5xx/transport/malformed ACK/readback failure keeps
the receipt and stops the queue. Reconciliation uses list/detail GET only and
never replays the upload. Metadata-only drills remain explicit Drafts; audio-ready
truth comes from `listening_tests.full_audio_*`, not the section audio flag.

### 5.2 Quality-audit inventory — [MEASURED]

`/admin/listening/audit` is a native read-only operations surface over every
`listening_tests` row. It first closes a stable, exact paginated inventory and
then runs bounded `GET /admin/listening/tests/{id}/audit` batches. A changed
canonical total, early page termination, duplicate UUID or malformed row blocks
the new snapshot instead of presenting partial coverage. Per-test lookup errors
remain an explicit unknown state and are never counted as clean.

The dashboard deliberately separates two evidence clocks: **live structural**
is the current no-LLM structural/audio-bounds GET, while **saved full audit** is
the persisted structural+LLM result from the most recent explicit full run.
Retry is GET-only. The HTML dashboard remains rollback; the edit/triage/full-run
workspace remains at `audit-detail.html` until its own native migration.

---

## 6. Known gaps — [MEASURED] (documented, NOT fixed here)

1. **Two parallel full-test ingestion paths** (convert DOCX 2-file vs full-test 4-file pack) coexist. The 4-file native route is the operational import surface; the legacy converter remains mounted pending a dependency audit. They produce the same `listening_tests` shape.
2. **`mini_test` enum value is unused as an exercise** (it was a `session_type`) — a latent inconsistency in the CHECK, harmless today. The `listening_sessions` table + `listening_attempts.listening_session_id` column are likewise retired-but-retained (session-mixer removed).

---

## 7. Hướng tới — convergence on the pack-upload model — [INTENDED, CHƯA BUILD]

> Everything in this section is a **proposal**. None of it exists yet. Andy's idea: author *all* listening types via a file-pack upload like the full-test, instead of per-type interactive forms.

**Today [MEASURED]:** full tests use a four-file pack and skill drills use a Source JSON plus optional timing/audio bundle; dictation/gist/tf/mcq standalone blocks remain form-authored one at a time. Mini-test is a graded 1-section `listening_tests` row (`test_type=mini`) built through the full-test pipeline.

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
