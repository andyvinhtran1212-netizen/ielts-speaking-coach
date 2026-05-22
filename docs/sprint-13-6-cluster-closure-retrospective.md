# DEBT-ADMIN-LISTENING-AUTHORING — Cluster Closure Retrospective

**Status:** CLOSED on Sprint 13.6 merge
**Cluster span:** Sprint 13.0 → 13.6 (15 sprints + 14 hotfixes = 29 PRs)
**Branch model:** branch-per-sprint, PR each with full CI green before merge
**Wall-clock:** 2026-05-18 → 2026-05-22 (4 working days)

---

## What we shipped

The DEBT-ADMIN-LISTENING-AUTHORING cluster built the end-to-end IELTS
Listening authoring stack: markdown → audio (3 modes + cutter) → AI map
images (6 models + manual escape) → published test → student player with
40-question grading. Andy can now author and ship a Cambridge-authentic
listening test solo from a single markdown bundle.

### Sprint roll-up

| Sprint  | PR  | Branch                                              | Outcome |
|---------|-----|-----------------------------------------------------|---------|
| 13.0    | #229 | `sprint-13-0-listening-authoring-discovery`        | Discovery doc: 22 UX gaps, 8 architecture decisions |
| 13.1    | #230 | `sprint-13-1-listening-content-management`         | Content management endpoints (CRUD + status) |
| 13.2    | #231 | `sprint-13-2-listening-upload-ui`                  | Upload UI (validator-aware, 3 audio modes) |
| 13.3    | #232 | `sprint-13-3-listening-render-ui`                  | Render UI + ElevenLabs job spawn |
| 13.3.1  | #233 | `sprint-13-3-1-render-race-hotfix`                 | Hotfix: render race-condition (placeholder + backoff polling) |
| 13.4    | #234 | `sprint-13-4-listening-tests-schema`               | listening_tests table + DOCX parser |
| 13.4.1  | #235 | `sprint-13-4-1-auth-null-redirect`                 | Hotfix: auth bootstrap + null guard + redirect chain |
| 13.4.2  | #236 | `sprint-13-4-2-markdown-migration`                 | Replaced DOCX with markdown 2-file bundle (format-as-contract) |
| 13.4.3  | #237 | `sprint-13-4-3-audio-upload-three-modes`           | 3 audio modes: full_premixed / parts_auto_assembled / parts_only |
| 13.4.3.1| #238 | `sprint-13-4-3-1-mode-toggle-ux`                   | Hotfix: selection-driven UI |
| 13.4.3.2| #239 | `sprint-13-4-3-2-tests-detail-dnd-signed-url`      | Hotfix: dnd zones + signed-URL preview |
| 13.5    | #240 | `sprint-13-5-student-full-test-player`             | Student full-test player + 40-question grading |
| 13.5.1  | #241 | `sprint-13-5-1-renderer-schema-hotfix`             | Hotfix: renderer/schema alignment |
| 13.5.2  | #242 | `sprint-13-5-2-cambridge-authentic-redesign`       | Cambridge-authentic redesign + parser context preservation |
| 13.5.3  | #243 | `sprint-13-5-3-sentence-gap-regex`                 | Hotfix: sentence + summary gap detection regex broaden |
| 13.5.4  | #244 | `sprint-13-5-4-hard-delete-partial-unique`         | Hard delete + partial UNIQUE (allow soft-deleted duplicates) |
| 13.5.5  | #245 | `sprint-13-5-5-parser-cleanup-tabs-tracker`        | Parser cleanup + tab navigation + 40-square progress tracker |
| 13.5.6  | #246 | `sprint-13-5-6-map-ai-image-generation`            | Map image generation for plan-label exercises (Imagen 4 + Gemini 2.5) |
| 13.5.7  | #247 | `sprint-13-5-7-ui-polish-cambridge-authenticity`   | UI polish: single-shot play, hide narrator, MCQ inline |
| 13.5.8  | #248 | `sprint-13-5-8-ui-polish-round-2`                  | Progress tracker reflow + map-description strip + MCQ inline |
| 13.5.9  | #249 | `sprint-13-5-9-custom-prompt-extraction`           | Custom AI prompt extraction from markdown `<details>` blocks |
| 13.5.9.1| #251 | `sprint-13-5-9-1-custom-prompt-forwarding-hotfix`  | Admin reviews/edits AI prompt before generation + override |
| 13.5.9.2| #252 | `sprint-13-5-9-2-gemini-3-pro-migration`           | 6-model registry (Nano Banana 2 default, Pro fallback) |
| 13.5.9.3| #253 | `sprint-13-5-9-3-manual-upload-map-image`          | Manual upload escape hatch (bypass AI entirely) |
| 13.6    | #254 | `sprint-13-6-audio-cutter-and-closure`             | Audio cutter (ffmpeg silencedetect + stream-copy) + cluster closure |

### What lives where now

| Surface | Path |
|---|---|
| Convert markdown → preview | `/pages/admin/listening/convert.html` |
| Tests list | `/pages/admin/listening/tests.html` |
| Test detail | `/pages/admin/listening/tests-detail.html` |
| Content detail | `/pages/admin/listening/content-detail.html` |
| Audio cutter (NEW) | `/pages/admin/listening/audio-cutter.html` |
| Student full-test player | `/pages/listening-test.html` |

---

## Architectural decisions cemented

| Decision | Choice | Driver |
|---|---|---|
| Source format | Markdown 2-file bundle (question + script-answerkey) | Andy's authoring tool; format-as-contract (Sprint 13.4.2) |
| Test entity | `listening_tests` parent + `test_id` FK | Migration 065 + 066 |
| Audio modes | `full_premixed` / `parts_auto_assembled` / `parts_only` | Migration 067 |
| Render placeholder | NULL audio path = "in-progress" sentinel | Migration 064 |
| Test attempts | Separate `listening_test_attempts` | Migration 068 |
| UNIQUE constraint | Partial UNIQUE `WHERE status != 'archived'` | Migration 069 |
| Cut segments | `parent_content_id` FK preserves origin | Migration 071 (Sprint 13.6) |
| Student player | No seek/rewind/speed/pause (Cambridge convention) | Sprint 13.5.7 |
| Answer matching | Case-insensitive + UK/US + `/`-alternatives + hyphenated single + NO contractions | Sprint 13.5 |
| Hard delete | Cascade content + exercises + attempts + storage | Sprint 13.5.4 |
| Map description (student view) | HIDDEN — only image rendered | Sprint 13.5.8 |
| AI prompt source | Markdown `<details>` block extraction | Sprint 13.5.9 |
| Admin prompt review | Editable textarea + reset + confirm before generate | Sprint 13.5.9.1 |
| Image model default | `gemini-3.1-flash-image-preview` (Nano Banana 2) | Sprint 13.5.9.2 |
| Image source paths | 6 API models + manual upload escape hatch | Sprint 13.5.9.3 |
| Audio segment cut | ffmpeg stream-copy (no re-encoding, lossless) | Sprint 13.6 |

---

## Pattern library — 16 patterns codified across the cluster

| # | Pattern | Sprint origin | One-liner |
|---|---|---|---|
| 1 | Placeholder row sentinel | 13.3.1 | NULL field marks in-progress async work; backoff polling watches for the flip |
| 2 | Defensive null + absolute paths | 13.4.1 | Auth multipart + redirect safety; never assume token shape |
| 3 | Format-as-contract | 13.4.2 | Source format choice (markdown) is an architectural commitment, not a UX detail |
| 4 | Selection-driven UI | 13.4.3.1 | Toggle state drives the whole panel; no hidden fields, no implicit branches |
| 5 | Baseline UX checklist | 13.4.3.2 | dnd + signed URL preview + layout = ground floor for every admin page |
| 6 | Schema-as-contract | 13.5.1 | Renderer payload keys are the backend contract; rename means breaking change |
| 7 | Structural context preserved | 13.5.2 | Don't strip layout markers (`** **`, blockquotes, `_{3,}`) during parse |
| 8 | Regex broaden | 13.5.3 | Markdown patterns vary; `_{3,}` not `___`, `\s+` not `\s` |
| 9 | Partial UNIQUE index | 13.5.4 | Allow soft-deleted duplicates without dropping the UNIQUE on active rows |
| 10 | Strip-on-render pattern | 13.5.5 | Clean the output, not the source; markdown stays authoritative |
| 11 | Cambridge convention strict mirror | 13.5.7 | Real exam UI conventions are absolute (no seek, no speed, single-shot play) |
| 12 | Hide-not-strip | 13.5.8 | Suppress at the render layer; preserve in the data for admin reference |
| 13 | Format-as-contract for AI | 13.5.9 | Markdown `<details>` block = AI generation guidance, parser lifts verbatim |
| 14 | Empirical pre-flight | 13.5.9.1 | Run actual code against Andy's data BEFORE writing the fix — verify the bug exists |
| 15 | Multi-source content provenance | 13.5.9.3 | `map_image_source` flag + audit trail (API vs manual upload) |
| 16 | Closure ledger pattern | 13.6 | Retrospective + pattern library + migration list + roll-up at cluster end |

---

## Cumulative falsifications (pinned via sentinel tests)

The cluster's `tests/` directories carry **~115 falsification sentinels**
that pin behaviours discovered the hard way during dogfood. Categorised:

| Category | Count | Examples |
|---|---|---|
| Format parsing | ~18 | sentence single-anchor vs double-anchor, blockquote multi-line, `_{3,}` not `___` |
| UI rendering | ~22 | progress grid overflow, sticky tracker box-sizing, narrator-intro hidden |
| Audio handling | ~15 | 3-mode toggle UX, signed-URL TTL, ffmpeg stream-copy flags |
| Storage + signed URLs | ~12 | 2h TTL student, 1h admin, listening-images / listening-audio buckets |
| AI integration | ~19 | custom prompt extraction, regex HTML-strip, registry routing, override precedence |
| Student grading | ~14 | case-insensitive, UK/US alternatives, hyphenated single, NO contractions |
| Cambridge UI convention | ~15 | no seek/rewind/speed/pause, single-shot play, hide narrator + description |

Each sentinel is a regex against a source file (or a behavioural unit
test). When a refactor breaks the contract the sentinel catches it
before the diff lands.

---

## Track records

- **First-try CI green:** 25 / 25 sprint PRs (100%)
- **Sprints with breaking changes:** 0
- **Migrations zero-downtime:** 8 / 8 (`064`–`071`, no `DROP COLUMN`)
- **Pattern library entries:** 16
- **Backend tests:** 1485 → 1606 (+121 across the cluster)
- **Frontend sentinels:** 2950 → 3150 (+200 across the cluster)
- **PRs merged:** 29 (15 sprints + 14 hotfixes)

---

## Andy's product capabilities after closure

End-to-end author workflow (solo, no engineering help):

1. ✅ Write markdown bundle (question paper + script-answerkey)
2. ✅ Upload via `/convert.html` → preview → commit (test_id auto-assigned)
3. ✅ Upload audio in one of 3 modes:
   - **Full pre-mixed** — single 25-min MP3
   - **4 parts assembled** — 4 part MP3s + ElevenLabs narrator stitched
   - **Parts only** — 4 part MP3s (drafts; can't publish yet)
4. ✅ **(NEW Sprint 13.6)** Cut full audio → 4 sections via auto silencedetect + manual adjust
5. ✅ Generate plan-label map image from curated `<details>` prompt:
   - Default = Nano Banana 2 ($0.067)
   - Premium = Nano Banana Pro ($0.134)
   - 4 Imagen options for photorealistic alternatives
   - Manual upload escape hatch ($0)
6. ✅ Edit prompt in admin UI before generating (reset / confirm / cost preview)
7. ✅ Publish test (UNIQUE partial index allows re-import after archive)
8. ✅ Students take full 40-question test with Cambridge-authentic player
9. ✅ Hard delete cascade (content + exercises + attempts + storage)
10. ✅ Admin transparency: cost preview, source tracking, audit logs

---

## Phase B candidates (deferred)

Triggers documented in `docs/sprint-11-6-phase-b-trigger-criteria.md`:

- CDN egress > 100 GB/mo (currently far below; only Andy + dogfood)
- Voice cloning (AU female accent)
- SRS review queue
- Cross-train listening + speaking
- Cohort UI for 5+ active cohorts
- Instructor role split (separate from admin)
- Mobile responsive optimization (when > 20 % mobile users)
- Usage logs admin dashboard
- PDF export of test results
- Image quality scoring / feedback loop
- A/B testing on image generation models
- Audio re-encode for size optimisation (currently stream-copy preserves source size)

---

## Next cluster recommendation

**Cluster 14.x — Grammar Mindmap + Checker** (Andy 2026-05-20 verbal lock):
- 14.0 Discovery + 22-question audit (matches 13.0 pattern)
- 14.1 Mindmap UI (visualise existing `assets/grammar-mindmap/` JSON)
- 14.2 Grammar Checker API + recommendations
- 14.3 Articles (markdown source + rendered viewer)
- 14.4 Dashboard
- 14.5 Closure retrospective
- ~5-6 sprints, ~3000-4000 LOC

Alternative paths (Andy lock pending):
- **Commercial launch path** — Stripe + Email + SEO + landing-page redesign
- **Phase B observation** — wait for trigger criteria before more build

---

## Cluster 13.x CLOSED

| Item | Value |
|---|---|
| Sprints | 15 |
| Hotfixes | 14 |
| Total PRs | 29 |
| Wall-clock | 4 working days (2026-05-18 → 2026-05-22) |
| LOC delta | ~9 500 |
| Backend tests | 1485 → 1606 (+121) |
| Frontend sentinels | 2950 → 3150 (+200) |
| Migrations | 064–071 (8 zero-downtime) |
| Standing audit gates | 14 (all green) |
| First-try CI green track | 25 / 25 (100 %) |
| Pattern library entries | 16 |
| Cumulative falsifications | ~115 |

**Andy's deliverable:** Production-ready IELTS Listening authoring
platform with end-to-end solo workflow (markdown source → audio cut → AI
or manual image → publish → student grading).

**Next:** Cluster 14.x (Grammar Mindmap) or Commercial Launch or Phase B
observation — decision pending Andy's 2026-05-22 lock.
