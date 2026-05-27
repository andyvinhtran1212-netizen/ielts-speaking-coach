# Sprint 19.3.5 Discovery — Task 1 Academic Image Support

**Cluster:** 19.x WRITING-COACH REFINEMENT
**Type:** Discovery-first, multi-touchpoint (Pattern #43) — **zero feature LOC**
**Date:** 2026-05-27
**HEAD audited:** `bb360cdd` (origin/main, 19.3 #312 merged). This PR is docs-only.
**Trigger:** Andy dogfood of 19.3 (#312) — "phần task 1 ở phần chấm bài… không có mục để upload đề là hình ảnh" (Pattern #19 dogfood-as-falsifier working as intended).
**Author:** Code (autonomous). Commission treated as hypothesis; Code PF empirical authoritative (Pattern #42).

> **Read Section 8 first if you wrote the commission.** The headline reframes the problem: prompt-level
> image support is **already mature** (Cloudinary storage + schema + admin upload UI + student
> write-time display + an essay-level snapshot column + an essay-create field that accepts it). The
> real gaps are **3, and narrower/deeper than "no upload button"**:
> 1. **The AI grader never sees the image** — it's stored but not forwarded to Gemini (highest impact: affects *all* Task 1 Academic grading, library prompts included, not just independent grading).
> 2. **Independent grading (`new.html`) has no image-upload UI** — Andy's surface symptom — but the **backend already accepts it** (`CreateEssayRequest.prompt_image_url`), so this is a frontend-wiring gap, not a backend build.
> 3. **The human grader (`grade.html`) and the student result page (`writing-result.html`) don't display the image** either.

---

## Section 0 — Mind-side blind-spot corrections (Pattern #42)

The 19.0 discovery hit a 9/10 wrong-premise rate; this one is similar (~8/10 corrected).

| # | Premise | Verdict | Evidence |
|---|---|---|---|
| 1 | prompts table has NO image field | **WRONG** — `prompt_image_url` + `prompt_image_public_id` exist | mig `038_writing_prompts_image.sql:20-21` |
| 2 | Task 1 essays graded text-only / maybe a hidden multimodal path | **CONFIRMED text-only** — grader builds a text string, no image | `gemini_writing_grader.py:543-548,558-574` |
| 3 | Gemini 2.5 Pro multimodal supported by the SDK | **YES, feasible no-upgrade** — legacy `google.generativeai` `generate_content` takes `[text, image]` | `gemini_writing_grader.py:28` |
| 4 | Supabase Storage not used / no image storage | **WRONG** — storage is **Cloudinary** | `services/cloudinary_service.py` |
| 5 | task-type discriminator exists | **CONFIRMED** — `task_type` enum `(task1_academic\|task1_general\|task2)` | mig `035:20`, `033:92` |
| 6 | Speaking module has no images | **PARTIAL** — Listening *generates* floor-plan images via a Gemini image model (REST) | `services/listening_map_image.py:1-34` |
| 7 | student writing page renders the prompt | **CONFIRMED renders the image** at write-time | `writing-dashboard.html:1035-1037,1610` |
| 8 | `grade.html` shows the prompt | shows prompt **text**, **NOT the image** | `grade.html` (no `prompt_image` markup) |
| 9 | independent grading has no prompt link | **CONFIRMED standalone** (free-text prompt, no FK) — **but** create accepts `prompt_image_url` | `admin_writing.py` `CreateEssayRequest` |
| 10 | no image-rendering conventions exist | **WRONG** — `<img class="wd-modal-prompt__image">` + Cloudinary URLs + prompts.html preview | `writing-dashboard.html:1610` |

---

## Section 1 — `writing_prompts` table: current image support

**Schema (mig 035 + 038):**

| Field | Source | Note |
|---|---|---|
| `task_type` | `035:20` | CHECK `(task1_academic, task1_general, task2)` — the discriminator |
| `prompt_image_url` | `038:20` | Cloudinary `secure_url` (the chart/graph/diagram) |
| `prompt_image_public_id` | `038:21` | Cloudinary `public_id` — for delete-on-replace/soft-delete |

- The "only `task1_academic` may have an image" rule is **app-layer only** (no DB CHECK) — mig `038` comment is explicit.
- Admin CRUD: `admin_writing_prompts.py` `POST /upload-image` → Cloudinary; `prompts.html` shows the upload field **only when `task_type === 'task1_academic'`** and stashes `url`+`public_id` into hidden fields passed to create/PATCH. Soft-delete cleans up the Cloudinary asset.
- **So library Task 1 Academic prompts can already carry a chart image end-to-end.** (Whether any production rows do is a data question, not a code one.)

---

## Section 2 — `writing_essays` table + student write-time rendering

- **`writing_essays.prompt_image_url`** exists (`033:94`) — an essay carries a **snapshot** of the prompt image URL at submit time (denormalised, like `prompt_text`).
- **Student write flow** (`writing-dashboard.html`, the submit modal): renders the image —
  `modal-prompt-image` `<img class="wd-modal-prompt__image">` (`:1610`), `src` set from
  `prompt.prompt_image_url` when present (`:1035-1037`). So a student writing a library Task 1
  Academic assignment **sees the chart**. ✓
- **Student result view** (`writing-result.html`): **no** `prompt_image` rendering (grep clean). After
  grading, the student does **not** see the original chart alongside the feedback. *(Minor display gap.)*

---

## Section 3 — Admin `grade.html`: prompt context display

- `grade.html` renders the prompt **text** (`prompt-box`) but contains **no image element** for the
  prompt (grep for `prompt_image`/`image` finds only the favicon). So the **human grader cannot see the
  chart** while reviewing/editing a Task 1 Academic essay. *(Display gap — affects review quality.)*

---

## Section 4 — AI Gemini grader: the core gap

- **SDK:** `import google.generativeai as genai` (`gemini_writing_grader.py:28`) — the legacy SDK;
  `genai.GenerativeModel(...).generate_content(user_prompt, ...)` (`:558-574`).
- **Payload is text-only.** `_build_user_prompt` assembles a single string:
  `## Loại bài … ## Đề bài (Prompt) {prompt_text} ## Bài viết {essay_text} …` (`:543-548`). The call is
  `model.generate_content(user_prompt)` — **no image Part**.
- **`GraderConfig` has no image field** (`models/writing_feedback.py`: `task_type, prompt_text,
  essay_text, analysis_level, …` — no image). And `essay_service` *persists* `prompt_image_url` onto the
  essay row (`essay_service.py:142,152`) but does **not** include it when constructing `GraderConfig`
  (`:310`). **So the image is stored but never reaches the model.**
- **Impact:** every Task 1 Academic essay — library-prompt *and* independent — is graded without the AI
  seeing the chart. The AI can only judge generic grammar/structure/length, **not** Task-1 content
  accuracy (did the description match the data?). This is the **highest-leverage** fix in 19.3.5.
- **Feasibility:** the legacy SDK accepts multimodal input as a list, e.g.
  `generate_content([user_prompt, {"mime_type": "image/png", "data": <bytes>}])` or a `PIL.Image`. So the
  injection requires: (a) fetch image bytes from the Cloudinary URL, (b) pass `GraderConfig` an optional
  image, (c) have `_call_with_retry`/`_build_user_prompt` emit a parts list when an image is present.
  No SDK upgrade needed.

---

## Section 5 — Independent grading flow (19.3) — gap confirmed + options

- `new.html` (Sprint 19.3): admin picks student/task/level/model/tier, free-text **prompt textarea**
  (`#f-prompt`) + **essay textarea** (`#f-essay`, paste or `.docx` extract from 19.3). **No image upload
  field, no prompt FK.** Submits to `POST /admin/writing/essays`.
- **But the backend already supports the image:** `CreateEssayRequest.prompt_image_url: Optional[str] = None`
  (`admin_writing.py`). And the Cloudinary upload endpoint already exists
  (`POST /admin/writing/prompts/upload-image`, returns `{url, public_id}`).
- **So the implementation is frontend-only:** add an image-upload affordance to `new.html` (shown when
  `task_type === task1_academic`, mirroring `prompts.html`) → upload via the existing `/upload-image` →
  put the returned `url` into the `prompt_image_url` field of the essay-create payload. Independent
  grading has no prompt FK, so the only source is **manual upload** (no auto-pull) — unless the
  architecture adds an optional "pick existing prompt" link (decision D-source below).

---

## Section 6 — Storage infrastructure

- **Cloudinary** (`services/cloudinary_service.py`) — the project's image store (NOT Supabase Storage).
  - `ALLOWED_FORMATS = jpg, jpeg, png, webp, gif` — **no PDF, no SVG.**
  - `MAX_FILE_SIZE_BYTES = 5 MB`.
  - Upload transform: `fetch_format:auto` (→ webp) + `width:1200, crop:limit`. Single folder
    (`PROMPT_IMAGES_FOLDER`). Returns `{url (secure_url), public_id, width, height}`.
  - Requires Cloudinary env credentials (a `CloudinaryConfigError` → 503 if unset).
- **Serving/auth:** images are public Cloudinary `secure_url`s (no signed URL / auth gate). Fine for
  IELTS chart prompts (not sensitive); note for the record.
- **Supabase Storage:** not used for writing images. (Audio uses the `audio-responses` bucket per the
  project guide; that's a separate concern.)

---

## Section 7 — Speaking / Listening image reference

- **Speaking:** no image surfaces found.
- **Listening:** `services/listening_map_image.py` **generates** Cambridge-style floor-plan images via a
  Gemini **image model** (`gemini-3.1-flash-image-preview`, "Nano Banana 2") through a **raw REST call**
  to `generativelanguage.googleapis.com/v1beta/` — image **output**, not input.
- **Reusability:** the listening pattern is image *generation* (different direction), so not directly
  reusable for grader image *input*. The reusable assets for 19.3.5 are: **`cloudinary_service`**
  (storage), the **`prompts.html` Task-1-image upload idiom** (frontend), and the **`google.generativeai`
  SDK already imported** by the grader (multimodal input).

---

## Section 8 — Architectural decisions to settle BEFORE 19.3.5 implementation

Code surfaces; **Mình + Andy decide** (Pattern #42 — Code does not decide in Discovery).

| # | Decision | Empirical context | Code's lean (non-authoritative) |
|---|---|---|---|
| D1 | **AI grader multimodal** — pass the image to Gemini, or leave text-only? | Grader is text-only; SDK supports `[text, image]`; this is the accuracy gap | **Pass the image.** Highest leverage; the whole point of Task 1 Academic. |
| D2 | **Image source for grading** — prompt-level (`writing_prompts.prompt_image_url`) and/or essay-level (`writing_essays.prompt_image_url`)? | Both columns exist; essay carries a snapshot | Feed the **essay's** `prompt_image_url` to the grader (works for library + independent uniformly). |
| D3 | **Independent-grading image source** — manual upload only, or also "pick existing prompt → auto-pull"? | `new.html` has no prompt FK; backend accepts `prompt_image_url`; `/upload-image` exists | **Manual upload** (reuse `/upload-image`), Phase 1. Auto-pull = later if a prompt-picker lands. |
| D4 | **Display the image to humans** — add to `grade.html` (grader) and/or `writing-result.html` (student)? | Neither shows it; student write-modal does | Add to **`grade.html`** (grader needs it). `writing-result.html` = nice-to-have. |
| D5 | **Formats** — keep Cloudinary's jpg/png/webp/gif, or add PDF/SVG? | Cloudinary config excludes PDF/SVG; academic charts are often PDF excerpts | Keep raster (jpg/png/webp); tell admins to screenshot PDFs. PDF support = real work (Cloudinary config + render). |
| D6 | **Backfill** — existing Task 1 Academic prompts/essays without images: leave as-is or prompt re-upload? | Unknown how many exist; app-layer rule only | Phase-in (new only); no backfill migration. |
| D7 | **Grader behaviour when image missing** — Task 1 Academic essay with no image: warn / block / grade text-only? | Today silently grades text-only | Grade text-only **+ surface a caveat** in feedback ("chấm không có hình — độ chính xác nội dung hạn chế"). Don't block. |

---

## Section 9 — Recommended sprint sequencing (Code's view — NOT authoritative)

The work splits cleanly along backend-accuracy vs frontend-affordance:

**Option α — single sprint 19.3.5** (if D1+D3+D4 all in):
- Backend: `GraderConfig` + `essay_service` forward `prompt_image_url`; grader fetches bytes + multimodal call + missing-image caveat (D7). ~150–250 LOC.
- Frontend: `new.html` image upload (reuse `/upload-image` + `prompts.html` idiom) + `grade.html` image display. ~180–280 LOC.
- Tests + caps. Total ~**500–800 LOC**. Feasible as one PR.

**Option β — split** (if the grader change wants its own validation runway):
- **19.3.5A (backend/accuracy):** grader multimodal + `GraderConfig`/`essay_service` wiring + missing-image caveat + tests. The high-value, higher-risk half.
- **19.3.5B (frontend/affordance):** `new.html` upload + `grade.html`/`writing-result.html` display + sentinels. Low-risk.

**Impact on 19.4** (notifications + regrade + tips reco — cluster closure): 19.3.5 is an **insert** before 19.4. Recommend **α** (one sprint) unless the multimodal grader change proves finicky in dogfood, then fall back to β. 19.4 slips by one sprint either way.

---

## Section 10 — Pre-emptive guidance for the 19.3.5 implementation commission

- **LOC accounting per artifact** (lesson 19.1B+): give explicit buckets — grader/service backend
  (~120–200), `new.html` upload UI (~120–200), `grade.html` display (~40–80), tests (~120–180),
  doc (0–30). Total band ~**400–700**.
- **Reuse mandates (don't rebuild):** `cloudinary_service` (storage), `POST /admin/writing/prompts/upload-image`
  (upload), the `prompts.html` task1-academic image idiom (frontend), the `google.generativeai` SDK
  already imported by the grader (multimodal — **no new dep, no SDK upgrade**).
- **Pattern #42 watch-items for the implementer:** the image is *already persisted* on the essay — the
  backend gap is purely **forwarding it into `GraderConfig` + the Gemini call**, not new storage. Confirm
  the chosen Gemini model id (`gemini-2.5-pro` / `-flash`) accepts image input in the installed SDK
  version before wiring (spike a single multimodal call).
- **Cross-table note (not a 19.3.5 blocker, flag for backlog):** `writing_prompts`/`writing_essays` use
  `task_type ∈ (task1_academic, task1_general, task2)` while `writing_tips` (19.1B/C) uses
  `task_type ∈ (task_1, task_2, both)`. Two different task-type vocabularies coexist in the writing
  domain — fine for now, but worth a deliberate decision before any cross-surface "show tips for this
  task type" feature.
- **Test target:** add a grader test that asserts an image Part is included when `prompt_image_url` is
  set (mock the Gemini call, assert the contents payload shape) — the regression guard for the core fix.

---

**END — Sprint 19.3.5 Discovery.** Docs-only PR. No code, schema, or migration changes.
