# D0 — Diagram / Flow-Chart Image Mechanism: Listening Reuse Plan

**Sprint:** 20.14f — Discovery (D0) before implementation
**Audience:** Andy + Mind, deciding the implementation approach (upload-only vs AI-gen, layout model, scope splits).
**Authority:** Code, after reading the listening map-image service, admin upload endpoint, admin UI, student renderer, and the reading_questions / reading_passages schemas.
**Standards target:** v1.1 §2A.13 (diagram_label_completion) — "sơ đồ/hình (ASCII art **hoặc ảnh**) với các nhãn đánh số trỏ tới bộ phận; mỗi callout có số câu + ô text."

Andy's directive: reuse the listening image mechanism (manual upload + AI-generation) for reading diagram_label_completion + flow_chart_completion. The current 20.14b mono-block ASCII fallback stays as the back-compat path.

## TL;DR — recommendation

| Question | Recommendation | Rationale |
|---|---|---|
| **Reuse listening upload?** | ✅ Yes, fully. Listening's `admin_upload_map_image` is ~150 LOC of validated PNG/JPG/WebP upload → Supabase Storage. The reading version is a near-clone with a different table + bucket path. | Proven in production for ~3 months (Sprint 13.5.9.3). Same validation chain, same private-bucket pattern, same signed-URL render. |
| **Reuse listening AI-gen?** | ✅ Yes for the service layer; ⚠️ NEW prompt for diagrams. Listening's `listening_map_image.generate_and_upload` is a generic Gemini-image dispatcher with model fallback (`gemini-3.1-flash-image-preview` → Pro → 2.5 legacy). The diagram prompt is different from the floor-plan template. | The Gemini boundary + storage + fallback chain are battle-tested. Authoring a new prompt template (`_DIAGRAM_PROMPT_TEMPLATE`) is ~30 LOC. |
| **Layout: positioned callouts on image vs side list?** | **Side list**, matching listening. The image carries pre-drawn numbered callouts (author or AI bakes them in); the student picks up the per-callout answer from a numbered list beside the image. | Listening uses this for plan-label (Cambridge S2 Q16–20). Cambridge-style reading diagram labelling works the same — the diagram has numbered arrows / leader lines, students write the answer in a separate input column. Positioning inputs on coordinates over the image is technically possible but adds a coordinate-authoring burden Andy hasn't asked for. |
| **Storage backend** | Supabase Storage private bucket `reading-images` (new, mirrors `listening-images`). Signed URLs minted on each student fetch (1-2h). | Matches listening's access-control pattern. Cloudinary is the writing-prompt path and stays scoped to that. |
| **Schema migration?** | ❌ **No migration.** Image refs live on `reading_questions.payload` JSONB (same pattern as listening's `listening_exercises.payload`). | The `payload` column is `JSONB NOT NULL DEFAULT '{}'`; new fields ride through the existing template / options propagation. |
| **ASCII fallback?** | ✅ Keep. Questions without an image still render via the 20.14b `.exam-gap-box--mono` ASCII path. No content needs migration before this sprint ships. | Forward-compatible deploy — admin uploads an image when content is ready; until then the seed renders as today. |

**Code recommends shipping in 2 PRs:**
1. **20.14f-α — Upload path (proven, low risk).** Admin upload endpoint + reading_image service + frontend image render in the diagram/flow path. Lets Andy load real diagrams immediately.
2. **20.14f-β — AI-gen path (deferred until Andy wants it).** Reuse `generate_and_upload` with a diagram-specific prompt template. Optional — Andy may prefer hand-curating diagram images on the dogfood corpus before paying per-image API calls.

Together: ~700–1400 LOC + a Discovery doc this size.

---

## What the listening image mechanism is, exactly

The listening side ships TWO admin paths for plan-label exercises (`variant=mcq_letter_label`), both writing to the same `payload.map_image_*` fields so the student renderer doesn't care which path produced the image. Three components.

### 1. Storage + URL signing — `backend/config.py` + `backend/routers/listening.py:3939`

```python
# config.py
LISTENING_IMAGES_BUCKET: str = "listening-images"     # Supabase Storage bucket
LISTENING_MAP_IMAGE_MODEL: str = "gemini-3.1-flash-image-preview"

# listening.py
def _sign_map_image_url(storage_path, expires_in=3600):
    """Best-effort signed URL. Returns None on any failure."""
    signed = supabase_admin.storage.from_(LISTENING_IMAGES_BUCKET).create_signed_url(storage_path, expires_in)
    return (signed or {}).get("signedURL")
```

- **Bucket:** private. The path layout is `tests/<test_uuid>/maps/<exercise_uuid>.png` (API-generated) or `…/<exercise_uuid>-manual-<timestamp>.<fmt>` (manual upload).
- **URL lifetime:** 1h admin previews, 2h student fetches. Minted per request, never persisted.
- **Magic-byte format sniff:** `_detect_image_format(bytes)` returns `"png"`, `"jpg"`, or `"webp"`. Anything else is a 415.

### 2. AI generation — `backend/services/listening_map_image.py` (465 LOC)

```python
SUPPORTED_MODELS = {
    "gemini-3.1-flash-image-preview": {"price": 0.067, "endpoint": "gemini_v1beta", …},   # default
    "gemini-3-pro-image-preview":     {"price": 0.134, "endpoint": "gemini_v1beta", …},
    "imagen-4.0-ultra-generate-001":  {"price": 0.06,  "endpoint": "imagen", …},
    "imagen-4.0-generate-001":        {"price": 0.04,  "endpoint": "imagen", …},
    "imagen-4.0-fast-generate-001":   {"price": 0.02,  "endpoint": "imagen", …},
    "gemini-2.5-flash-image":         {"price": 0.039, "endpoint": "gemini", "deprecated": True, "shutdown_date": "2026-10-02"},
}
DEFAULT_MODEL    = "gemini-3.1-flash-image-preview"
FALLBACK_CHAIN   = ("gemini-3-pro-image-preview", "gemini-2.5-flash-image")
```

- **HTTP boundary:** `call_image_model(model, prompt, *, api_key) → bytes`. The tests patch this so no network is hit. Endpoints differ per family (`predict` for Imagen, `generateContent` for Gemini).
- **Fallback chain:** any non-auth failure on the primary walks `FALLBACK_CHAIN`. A missing `GEMINI_API_KEY` short-circuits with a `RuntimeError` (no fallback can recover).
- **Prompt template:** the plan-label template is hard-coded for "Top-down architectural floor plan in Cambridge IELTS test paper style. Black line art on white background, simple geometric shapes for rooms…" — listing letter options, layout description, no furniture, square aspect ratio.
- **Custom-prompt override:** Andy can attach a curated prompt to the markdown source via a `<details>` block; the parser lifts it onto `metadata.map_image_custom_prompt` and the service uses it verbatim (bypassing the template + the 50-char description floor).
- **`generate_and_upload(...) → dict`** is the public API. Returns metadata to merge into the exercise's `payload`:
  - `map_image_storage_path`
  - `map_image_model`        (the model that actually fired, post-fallback)
  - `map_image_prompt`       (resolved final prompt)
  - `map_image_prompt_source` (`"template"` / `"custom"`)
  - `map_image_generated_at`
  - `map_image_size_bytes`

### 3. Admin upload escape hatch — `backend/routers/listening.py:4115` (`admin_upload_map_image`)

```
POST /admin/listening/exercises/{exercise_id}/upload-map-image
  Content-Type: multipart/form-data
  image_file: <PNG/JPG/WebP, 100 B–5 MB>
```

- Validation chain: variant guard (plan-label only) → size (≥100 B / ≤5 MB) → format (magic-byte sniff).
- Storage path mirrors API-generated images, with `-manual-<timestamp>` suffix.
- Tags `payload.map_image_source = "manual_upload"`, nulls API-only fields.
- Returns a 1h signed URL so the admin UI previews immediately.

A sibling `DELETE /admin/listening/exercises/{exercise_id}/map-image` clears both the Storage object and the payload metadata so admins can re-generate.

### 4. Frontend admin UI — `frontend/js/admin-listening-tests-detail.js`

Per-exercise card with:
- Model picker (the `SUPPORTED_MODELS` registry)
- Prompt textarea (with "edited" indicator)
- "Generate" button → POST `/admin/listening/exercises/{id}/generate-map-image`
- Manual upload field → POST `/admin/listening/exercises/{id}/upload-map-image` (FormData)
- Source badge (`api_generation` / `manual_upload`)
- Re-generate / delete buttons

### 5. Student render — `frontend/js/listening-test-player.js:554` (`renderPlanLabel`)

```js
const mapImage = (payload && payload.map_image_url) || '';
const visualBlock = mapImage
  ? `<div class="ielts-plan-image"><img src="${esc(mapImage)}" alt="Floor plan map" class="ielts-map-rendered" /></div>`
  : `<div class="ielts-plan-no-image"><p class="ielts-notice">Hình map chưa được tạo cho exercise này.</p></div>`;
return `
  <div class="ielts-plan-container">
    ${visualBlock}
    <div class="ielts-plan-labels">
      ${questions.map((q) => `
        <div class="ielts-plan-row">
          <span class="ielts-question-num">${esc(q.q_num)}</span>
          <span class="ielts-plan-name">${esc(q.prompt || '')}</span>
          <!-- dropdown of A–H letters -->
        </div>`).join('')}
    </div>
  </div>`;
```

Key insight — **the image is a flat `<img>`; the student inputs live in a SIDE LIST below it**, not positioned over the image. The image carries the numbered labels (rooms tagged with capital letters drawn on by the generator); the student matches each question to a label via the dropdown beside the image.

When no image exists, the player renders a "Hình map chưa được tạo cho exercise này" notice — the exercise stays answerable, the student is told something is missing.

## What reading needs

§2A.13 mandate is structurally identical to listening's plan-label:

> sơ đồ/hình (ASCII art hoặc ảnh) với các nhãn đánh số trỏ tới bộ phận; mỗi callout có số câu + ô text

Difference: each callout = a free-typed answer (text input), not a label-pick (dropdown). The diagram (whether ASCII or image) carries numbered arrows / leader lines; the student writes the answer for each numbered part.

Flow-chart completion (§2A.12) is the same pattern with a different visual — boxes connected by `↓` arrows, each box has a gap. Both share one renderer if the image is provided; they share the existing mono-block ASCII renderer when no image is present.

### Reading-side data shape (no migration)

The `reading_questions.payload` JSONB blob already accepts arbitrary fields via the existing `template:` propagation. The first diagram/flow question in a consecutive run carries the image reference; absorbed Qs get their answers via the existing per-q_num path (same pattern Sprint 20.14e introduced for `summary_completion.template.summary_text`).

Authoring shape:

```yaml
- q_num: 38
  question_type: diagram_label_completion
  prompt: "(see diagram above)"
  template:
    image_storage_path: tests/<test_uuid>/diagrams/<question_uuid>.png
    # OR for in-progress AI-gen tracking (read-only on the student fetch):
    image_source:       manual_upload | api_generation
    image_model:        gemini-3.1-flash-image-preview   # null for manual
    image_generated_at: 2026-05-30T…
  answer: "valve"
  skill_tag: detail
- q_num: 39
  question_type: diagram_label_completion
  prompt: "(see diagram above)"
  answer: "piston"
  skill_tag: detail
# … Qs 40, 41 follow the same pattern
```

The student fetch surfaces a signed URL on the first Q's payload (`payload.image_url`); follow-up Qs' payloads are bare. The renderer:

1. Detect a diagram/flow run.
2. If the first Q's payload has `template.image_storage_path` (and the backend has minted `payload.image_url`), render the new image+side-list layout instead of the mono-block.
3. Side list: one row per q_num with a numbered badge + text input. Mirrors listening's `.ielts-plan-row`.

Back-compat: any run without `image_storage_path` falls through to the existing 20.14b mono-block path. Migration is a content edit per question — no DB change.

### Storage backend choice

Two image-hosting backends already in the stack:

| Backend | Path | Privacy | Listening uses for | Writing uses for |
|---|---|---|---|---|
| Supabase Storage | `listening-images` bucket, signed URLs | private | plan-label maps | — |
| Cloudinary | public CDN | public | — | Task 1 chart images |

**Code recommends Supabase Storage** (`reading-images` bucket, new). Same access-control pattern as listening, signed URLs scope leaks. Cloudinary is the right call for Task 1 charts (public, CDN-cached, used in essay flows), but reading exam images benefit from the same per-fetch-signed pattern listening uses.

The bucket is the only piece of out-of-band setup the deploy needs — `LISTENING_IMAGES_BUCKET` is already created in production; `READING_IMAGES_BUCKET` would need a one-time `supabase storage create-bucket reading-images --public=false`. Alternatively, share the listening bucket under a `tests/<reading-test-uuid>/diagrams/…` prefix — saves the bucket-creation step at the cost of weaker name boundary.

### AI-gen prompt for diagrams

The listening floor-plan template is hard-coded for top-down architectural views. Reading diagrams cover a much wider visual surface (cross-sections of machines, biological systems, geological strata, water cycles, etc). A single template won't work — the prompt needs to interpolate the diagram TYPE.

Sketch:

```python
_DIAGRAM_PROMPT_TEMPLATE = """Cambridge IELTS Academic Reading diagram in test-paper style.
Black line art on white background; clean technical illustration.
The diagram shows: {description}
Number {count} parts/regions with numbered leader lines (1, 2, 3…).
Each numbered callout points to a single, clearly delineated feature.
Numbers are large, bold, black, placed at the end of each leader line.
No colour shading, no decorative elements, no answer text on the diagram.
Aspect ratio: 4:3 landscape, suitable for an exam-paper printout.
"""
```

The same generic `call_image_model` + fallback chain handles the HTTP boundary unchanged. A new public function — `services/reading_image.py::generate_and_upload(...)` — wraps `call_image_model` with this template, the `tests/<reading-test-uuid>/diagrams/<question-uuid>.png` storage path, and the reading-specific validation chain.

Mind decision: bundle the AI-gen path into 20.14f, or split it out as 20.14f-β. Code lean: split (Andy may want to hand-curate the first batch of diagrams before paying for AI calls; the upload path covers that, the AI path can land later without rework).

## Proposed implementation plan

### Sprint 20.14f-α — Upload path (Code recommendation: ship first)

| # | Deliverable | Files | LOC |
|---|---|---|---|
| α.1 | `services/reading_image.py` — `upload_diagram_image(bytes, question_id, test_id, supabase) → dict` returning the payload metadata bundle. ~80 LOC mirrors of the listening upload validation chain | new file | 80–120 |
| α.2 | `routers/admin_reading.py` — `POST /admin/reading/questions/{q_id}/upload-diagram-image` + `DELETE …/diagram-image` endpoints. Variant guard restricts to `diagram_label_completion` / `flow_chart_completion`. | router | 80–150 |
| α.3 | `routers/reading_student.py` — extend the `_fetch_test` projection to read `payload.template.image_storage_path` per question and emit `payload.image_url` (signed URL) so the renderer doesn't need a separate fetch | router | 30–60 |
| α.4 | `frontend/js/admin-reading.js` (or new admin page) — image-upload card per diagram/flow question. Reuses the listening admin UI pattern. | new | 100–200 |
| α.5 | `frontend/js/reading-exam.js` — renderer detects `payload.image_url` on a diagram/flow run's first Q; emits image + side-list of numbered inputs in place of the mono-block | render | 80–150 |
| α.6 | CSS — `.exam-diagram-container`, `.exam-diagram-image`, `.exam-diagram-rows`, `.exam-diagram-row` (mirrors listening's `.ielts-plan-*`) | css | 40–80 |
| α.7 | Tests — admin upload (size/format/variant); renderer (image path vs mono fallback); signed-URL minting | tests | 200–350 |
| α.8 | v2 spec docs — document the `template.image_storage_path` shape + the back-compat fallback | docs | 30–60 |
| **Total α** | | | **~640–1170 + docs** |

Deploy: **deployed-only** (backend admin endpoint + signed-URL minting touched). Andy: Railway redeploy + verify `READING_IMAGES_BUCKET` exists. The bucket is created via the Supabase dashboard or `supabase storage create-bucket reading-images --public=false`; this is the one out-of-band step.

### Sprint 20.14f-β — AI-gen path (Code recommendation: defer)

| # | Deliverable | Files | LOC |
|---|---|---|---|
| β.1 | `services/reading_image.py::generate_and_upload(...)` — wraps `listening_map_image.call_image_model` with the diagram template + reading storage path | service | 80–150 |
| β.2 | `routers/admin_reading.py` — `POST /admin/reading/questions/{q_id}/generate-diagram-image` | router | 50–80 |
| β.3 | Admin UI — model picker, prompt textarea, "Generate" / "Regenerate" / "Delete" buttons | js | 80–150 |
| β.4 | Tests — model fallback chain, prompt template, cost estimate | tests | 100–200 |
| **Total β** | | | **~310–580** |

Deploy: **deployed-only**. Needs `GEMINI_API_KEY` already present in the listening config.

## Open product questions for Andy / Mind

1. **Bundle α + β, or split?** Code recommends split (α first for proven upload; β when ready for AI). Mind may prefer one PR if Andy wants the AI button live from day one.
2. **Bucket: new `reading-images` or share `listening-images`?** New bucket is cleaner naming; shared bucket saves one setup step. Code lean: new bucket (boundary clarity).
3. **Layout: side list vs positioned callouts on image?** Side list matches listening + IELTS Cambridge style. Code recommends side list. Positioned callouts (coordinate overlay) are 2× the renderer complexity and require coordinate authoring per question.
4. **AI-gen prompt: one diagram template, or per-content-type sub-templates (cross-section, flow-chart, water-cycle, …)?** Code recommends one generic template with `{description}` interpolation; admin can override via the same `<details>` custom-prompt mechanism listening already supports.
5. **Keep ASCII mono-block fallback?** Code recommends YES — back-compat for legacy diagram seeds + zero-cost fallback when an image hasn't been uploaded/generated yet.

## What this Discovery does NOT decide

- Pricing / budget for AI-gen calls. Listening's tracking pattern (cost-per-image visible in admin UI) ports unchanged; spend cap is an Andy decision.
- Exact per-question authoring UX (drag-drop upload? URL paste? admin-only generate button?) — depends on whether Andy adopts the listening admin pattern wholesale or wants a different surface.
- Whether `READING_IMAGES_BUCKET` should be a new bucket name or reuse `listening-images`. See open question 2.

These are downstream decisions for the 20.14f-α implementation PR; they don't gate the Discovery doc.

---

*Discovery doc — ships as a standalone PR; 20.14f-α (upload path) + optional 20.14f-β (AI-gen) follow once Andy + Mind confirm scope.*
