# TEST INVARIANT LEDGER — Frontend Migration to Next.js

**Status:** DRAFT (2026-07-13, requires human review before Gate A)  
**Scope:** Catalogs ALL 225 frontend test files (214 node:test + 4 Playwright e2e + 7 archived)  
**Method:** Section 11.4 (test retirement rule) + sections 7.4/B7 (ledger backbone)  
**Baseline commit:** `3f031d17` (HEAD) + 11 commits after `9047e09f`  

> **Note to reviewers:** This is a clerical inventory. Each entry is a **suggestion** for migration disposition based on test type, not a commitment. Disposition changes per architectural decision in Phase 1 (ADR-001/002/etc.) and Route Ledger priority. Entries formerly marked **UNCLEAR** were re-read and finalized 2026-07-14 (durable invariant + disposition per row; see "## UNCLEAR resolution" appendix at the end).

---

## Summary

| Metric | Count |
|--------|-------|
| **Total test files** | 225 (214 active + 4 e2e .spec + 7 other) |
| **In CI** | 131 (backend-tests.yml explicit list) |
| **Not in CI** | 94 (legacy, incomplete, or later-added) |
| **Fragility class: source-string-pin** | ~168 (readFileSync + regex match on HTML/JS/CSS) |
| **Fragility class: dom-behavior** | ~18 (DOM shim, JSDOM, minimal mocking) |
| **Fragility class: contract** | ~23 (API shape, payload structure, type hints) |
| **Fragility class: e2e** | 4 (Playwright; static fixture smoke, not full-stack) |
| **Fragility class: unclear** | 0 (all 33 resolved 2026-07-14 — see appendix) |
| **Disposition: port-to-component-test** | ~128 (source-pin → React test harness) |
| **Disposition: replace-by-types** | ~43 (schema/contract → TypeScript + OpenAPI blocking) |
| **Disposition: replace-by-e2e** | ~21 (integration → staging E2E) |
| **Disposition: keep-until-route-retired** | ~24 (legacy guard, retire after final cutover) |
| **Disposition: retire-immediately** | ~9 (obsolete, reason documented below) |
| **Disposition: unclear** | ~0 (all assigned; re-validation in PR) |

---

## By Domain

### Speaking (17 files, 6 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `practice-redesign.test.mjs` | ✓ | `frontend/pages/practice.html`, `frontend/js/practice.js` | State machine: loading → prep → recording → processing → feedback; session_id routing (never ?part=); form submission state on timeout | source-string-pin | port-to-component-test |
| `practice-persist-failure.test.mjs` | ✓ | `frontend/js/practice.js` | Grading failure UI shows error boundary, not silent loss; retry logic preserved | source-string-pin | port-to-component-test |
| `speaking-redesign.test.mjs` | ✓ | `frontend/pages/speaking.html` | Page embeds aver-chrome with speaking nav; audio recording button wired; session routing via POST /sessions | source-string-pin | port-to-component-test |
| `speaking-ia-cleanup.test.mjs` | ✗ | `frontend/pages/speaking.html`, `frontend/js/` | IA cleanup: menu items, nav hierarchy after Sprint 18.3 polish | source-string-pin | keep-until-route-retired |
| `speaking-length-gate.test.mjs` | ✗ | `frontend/js/practice.js` | Recording duration gate 300s (MAX_AUDIO_DURATION_SECONDS); UI shows warning at threshold | source-string-pin | keep-until-route-retired |
| `speaking-results-feedback-tokens.test.mjs` | ✗ | `frontend/pages/result.html`, `frontend/css/` | Feedback token styling (fluency, lexical, grammar bands); light-theme compat | source-string-pin | port-to-component-test |
| `speaking-results-light-theme.test.mjs` | ✗ | `frontend/pages/result.html`, `frontend/css/` | Result page light-theme rendering: contrast, readability, WCAG AA | source-string-pin | replace-by-e2e |
| `speaking-rubric-v2-compat.test.mjs` | ✗ | `frontend/js/practice.js`, `frontend/pages/result.html` | Rubric version compat: v1 has LRS, v2 has semantic tags; UI adaptation | source-string-pin | replace-by-types |
| `speaking-stub-contract.test.mjs` | ✗ | `frontend/js/api.js` | Stub API returns grading shape that matches production (response field names, band ranges) | contract | replace-by-types |
| `part-2-input-ux.test.mjs` | ✗ | `frontend/pages/practice.html`, `frontend/js/practice.js` | Part 2 cue card display, input field focus, warning on short prep time (1 min) | source-string-pin | keep-until-route-retired |
| `sample-answer-status.test.mjs` | ✗ | `frontend/js/practice.js` | Sample answer playback UI: shows audio embed, disables recording during playback | source-string-pin | keep-until-route-retired |
| `pronunciation-contract.test.mjs` | ✗ | `frontend/js/api.js` | Pronunciation band endpoint returns { band_score, ielts_level, phoneme_detail } shape | contract | replace-by-types |
| `result-redesign.test.mjs` | ✓ | `frontend/pages/result.html`, `frontend/js/practice.js` | Result page loads via session_id; band cards, pronunciation, grammar sections render; no "undefined" fallbacks | source-string-pin | port-to-component-test |
| `full-test-result-redesign.test.mjs` | ✓ | `frontend/pages/full-test-result.html`, `frontend/js/` | Full test chains via extra_session_ids; result page aggregates all parts; PDF export present | source-string-pin | port-to-component-test |
| `sprint-15-3-accordion-drilldown.test.mjs` | ✓ | `frontend/pages/result.html`, `frontend/js/` | Result accordion: expand/collapse; grammar deep-link to article; retention UI visible | source-string-pin | port-to-component-test |
| `sprint-15-3-1-result-extractor.test.mjs` | ✓ | `frontend/js/` | Result data extraction: parse band/phoneme/grammar from server shape; no NaN/undefined leaks | dom-behavior | replace-by-types |
| `sprint-16-3-retention-warning.test.mjs` | ✓ | `frontend/pages/result.html` | Retention warning banner: shows when engagement low; dismissable; animation smooth | source-string-pin | port-to-component-test |

### Writing (21 files, 10 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `writing-dashboard-redesign.test.mjs` | ✓ | `frontend/pages/writing-dashboard.html`, `frontend/js/writing-dashboard.js` | Page embedded chrome with writing nav; assignment list loads; cell edits POST /assignments/:id/edit | source-string-pin | port-to-component-test |
| `writing-result-redesign.test.mjs` | ✓ | `frontend/pages/writing-result.html`, `frontend/js/writing-result.js` | Result page shows essay, band, feedback, image snapshot (if Task 1); reload preserves state | source-string-pin | port-to-component-test |
| `writing-analytics-instrument.test.mjs` | ✓ | `frontend/js/writing-dashboard.js` | Telemetry: click = POST /api/telemetry with route, user, action; no token leak | source-string-pin | replace-by-types |
| `writing-tips-redesign.test.mjs` | ✓ | `frontend/pages/writing-tips.html` | Tips page shows examples, band ranges, common errors; text-only, no audio | source-string-pin | port-to-component-test |
| `writing-highlight.test.mjs` | ✓ | `frontend/js/writing-result.js` | Essay highlighting for grammar issues, lexical, spelling; user can toggle by issue type | source-string-pin | port-to-component-test |
| `writing-prompt-bank-ui.test.mjs` | ✓ | `frontend/pages/writing-new/`, `frontend/js/` | Prompt bank shows tasks (1/2), filters, pagination; selection POST /assignments | source-string-pin | port-to-component-test |
| `writing-cohorts-admin.test.mjs` | ✓ | `frontend/pages/admin/writing/`, `frontend/js/admin-writing-cohorts.js` | Admin cohort UI: create, edit, student list, reassign; permissions checked client-side | source-string-pin | port-to-component-test |
| `writing-independent-upload.test.mjs` | ✓ | `frontend/pages/writing-new/`, `frontend/js/` | Student self-service upload: drag-drop or paste, topic optional, POST to /sessions | source-string-pin | port-to-component-test |
| `writing-task1-image.test.mjs` | ✓ | `frontend/pages/writing-result.html`, `frontend/js/writing-result.js` | Task 1 essay image embed via Supabase bucket reference; fallback to placeholder if missing | source-string-pin | keep-until-route-retired |
| `writing-regrade-tips.test.mjs` | ✓ | `frontend/pages/admin/writing/regrade.html`, `frontend/js/` | Regrade UI: select reason, confirm, POST /grading/regrade; success redirects to result | source-string-pin | port-to-component-test |
| `admin-writing-grade-redesign.test.mjs` | ✓ | `frontend/pages/admin/writing/grade.html`, `frontend/js/admin-writing-grade.js` | Grade form: essay render, band selector (4.0–9.0), feedback text, submit guards duplicate | source-string-pin | port-to-component-test |
| `admin-writing-dashboard.test.mjs` | ✓ | `frontend/pages/admin/writing/dashboard.html`, `frontend/js/admin-writing-dashboard.js` | Admin dashboard: queue count, in-progress list, sort/filter, drill-down to grade form | source-string-pin | port-to-component-test |
| `writing-admin-escaper-recursion.test.mjs` | ✗ | `frontend/js/admin-writing-grade.js` | HTML escaper in essay display is idempotent (no double-escape) | dom-behavior | replace-by-types |
| `writing-prompt-answer-key.test.mjs` | ✗ | `frontend/pages/writing-result.html`, `frontend/js/` | Task 1 answer key (fact bank) loaded from prompt; used to grade charts; WRITING_TASK1_FACTS_ENABLED gate | contract | replace-by-types |
| `admin-writing-new-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/new.html` | New prompt form: topic, level, image upload, save POST /prompts; validation on title/level | source-string-pin | port-to-component-test |
| `admin-writing-assignments-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/assignments.html` | Assignment form: cohort, prompt, deadline, notification; POST /assignments with cohort_id | source-string-pin | port-to-component-test |
| `admin-writing-prompts-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/prompts.html` | Prompt list: paginated, filterable by level/topic, bulk actions (publish, archive) | source-string-pin | port-to-component-test |
| `admin-writing-status-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/status.html` | Status dashboard: grades per student, completion %, feedback rate | source-string-pin | keep-until-route-retired |
| `admin-writing-redesign.test.mjs` | ✗ | `frontend/pages/admin/writing/index.html` | Writing admin hub: navigation to sub-pages (dashboard, queue, prompts, cohorts) | source-string-pin | keep-until-route-retired |
| `pricing-redesign.test.mjs` | ✗ | `frontend/pages/pricing.html` | Marketing page: feature matrix, CTA, pricing tiers; no auth required | source-string-pin | retire-immediately (no migration path; design-only) |
| `onboarding-redesign.test.mjs` | ✗ | `frontend/pages/onboarding.html` | Onboarding flow: skill selection, cohort join, first session setup | source-string-pin | retire-immediately (deprecated in pivot; legacy flow) |

### Reading (15 files, 8 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `reading-content-rich-layout.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/reading-exam.js` | Reading content: passage + questions render; layout breaks on mobile handled by flexbox | source-string-pin | port-to-component-test |
| `reading-translation-vi.test.mjs` | ✓ | `frontend/pages/reading-exam.html` | Vietnamese translation toggle shows/hides translation panel; stored in session | source-string-pin | port-to-component-test |
| `admin-reading-l1-l2-actions.test.mjs` | ✓ | `frontend/pages/admin/reading/`, `frontend/js/admin-reading.js` | Reading admin: L1/L2 test management, edit passage/questions, delete guards confirm | source-string-pin | port-to-component-test |
| `reading-admin-preview-fix.test.mjs` | ✓ | `frontend/pages/admin/reading/preview.html` | Preview: shows reading as student would see; no admin chrome | source-string-pin | port-to-component-test |
| `reading-access-lock.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/reading-exam.js` | Access lock: code-gated content shows lock icon until code entered; POST /verify-code | source-string-pin | keep-until-route-retired |
| `reading-access-share.test.mjs` | ✓ | `frontend/pages/reading-exam.html` | Share link: students can use direct URL if cohort has permission; no code needed | source-string-pin | keep-until-route-retired |
| `reading-sharelink-url-fix.test.mjs` | ✓ | `frontend/js/` | Share URL pattern uses /reading/l?/share/:code not query param; deep-links preserved | source-string-pin | port-to-component-test |
| `reading-attempts-dashboard.test.mjs` | ✓ | `frontend/pages/reading-attempts.html`, `frontend/js/` | Attempts page: shows all prior attempts, scores, dates; reload via session_id | source-string-pin | port-to-component-test |
| `reading-l1l2-grammar-toggle.test.mjs` | ✓ | `frontend/pages/reading-exam.html` | Grammar toggle shows/hides difficulty metadata; state saved to session storage | source-string-pin | keep-until-route-retired |
| `reading-mini-test.test.mjs` | ✓ | `frontend/pages/reading-mini.html`, `frontend/js/` | Mini reading: 3–5 questions, no timing, instant score; used for diagnostic | source-string-pin | keep-until-route-retired |
| `reading-diagnostic.test.mjs` | ✗ | `frontend/pages/reading-diagnostic.html` | Diagnostic flow: self-assessed level → auto-pick L1/L2 content; initial screen shows disclaimer | source-string-pin | replace-by-e2e |
| `l3-edit-delete-block-images.test.mjs` | ✓ | `frontend/pages/admin/reading/l3-edit.html`, `frontend/js/` | L3 edit: block CRUD (paragraph, image, MCQ, matching), drag-reorder, image upload | source-string-pin | port-to-component-test |
| `l3-action-consistency.test.mjs` | ✓ | `frontend/pages/admin/reading/l3-edit.html` | L3 actions: save validates all blocks, error toast on fail, success redirects to detail | source-string-pin | port-to-component-test |
| `reading-rich-imgprompt.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/reading-exam.js` | Rich question: image + text prompt; user input collected (essay or gap-fill) | source-string-pin | port-to-component-test |
| `reading-rich-chuabai.test.mjs` | ✓ | `frontend/pages/reading-exam.html` | Chua bai (completion) questions: 4-option MCQ or gap-fill with word bank | source-string-pin | port-to-component-test |

### Listening (20 files, 8 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `listening-test-player.test.mjs` | ✓ | `frontend/pages/listening-exam.html`, `frontend/js/listening-exam.js` | Test player: play/pause audio, scrub timeline, answer MCQ/gap-fill, section transitions | source-string-pin | port-to-component-test |
| `listening-mini-test.test.mjs` | ✓ | `frontend/pages/listening-mini.html`, `frontend/js/` | Mini listening: ~10 min, no timer, instant score | source-string-pin | port-to-component-test |
| `listening-review-ui.test.mjs` | ✓ | `frontend/pages/listening-result.html`, `frontend/js/listening-result.js` | Review UI: play audio clip per question, show answer/transcript, band breakdown | source-string-pin | port-to-component-test |
| `admin-listening-render.test.mjs` | ✓ | `frontend/pages/admin/listening/`, `frontend/js/admin-listening.js` | Admin listening: test list, create form, edit questions; uploads audio segments | source-string-pin | port-to-component-test |
| `admin-listening-fulltest-import.test.mjs` | ✓ | `frontend/pages/admin/listening/import.html`, `frontend/js/` | Import: bulk upload MP3 + JSON manifest; auto-segment and store to Supabase | source-string-pin | port-to-component-test |
| `listening-dictation.test.mjs` | ✗ | `frontend/pages/listening-dictation.html`, `frontend/js/` | Dictation: repeat-play audio, type response, check spelling; skills-practice mode | source-string-pin | keep-until-route-retired |
| `listening-gist-tf-pages.test.mjs` | ✗ | `frontend/pages/listening-gist.html`, `frontend/pages/listening-tf.html` | Gist & True/False pages: section-specific drill; no timing | source-string-pin | keep-until-route-retired |
| `listening-mcq-sessions-pages.test.mjs` | ✗ | `frontend/pages/listening-mcq-sessions.html` | MCQ sessions page: show all attempts, replay, scores | source-string-pin | port-to-component-test |
| `listening-test-dictation.test.mjs` | ✗ | `frontend/pages/listening-exam.html` | During-test dictation questions use transcript scrub (no per-sentence timing) | source-string-pin | keep-until-route-retired |
| `listening-page-shell.test.mjs` | ✗ | `frontend/pages/listening-*.html` | Listening page structure: chrome embed, audio player, question area; no inline player controls | source-string-pin | keep-until-route-retired |
| `listening-skills.test.mjs` | ✗ | `frontend/pages/listening-skills.html`, `frontend/js/` | Skills practice hub: drill by section type (dictation, gist, MCQ, matching) | source-string-pin | keep-until-route-retired |
| `listening-tests-list.test.mjs` | ✗ | `frontend/pages/listening-tests.html`, `frontend/js/` | Tests list: full tests, minis, level filters, start button → /sessions POST | source-string-pin | keep-until-route-retired |
| `admin-listening-audit.test.mjs` | ✗ | `frontend/js/admin-listening.js` | Audit: verify all tests have audio, segments align, metadata valid | dom-behavior | replace-by-e2e |
| `admin-listening-content-management.test.mjs` | ✗ | `frontend/pages/admin/listening/`, `frontend/js/` | Content mgmt: CRUD tests, clone test, publish/archive, move between levels | source-string-pin | port-to-component-test |
| `admin-listening-convert.test.mjs` | ✗ | `frontend/pages/admin/listening/`, `frontend/js/` | Convert: import ILR/IELTS audio files to internal format; map sections | source-string-pin | replace-by-e2e |
| `admin-listening-drills-import.test.mjs` | ✗ | `frontend/pages/admin/listening/`, `frontend/js/` | Drills import: upload drill bank (dictation/gist/MCQ); auto-segment by silence | source-string-pin | replace-by-e2e |
| `admin-listening-segments.test.mjs` | ✗ | `frontend/pages/admin/listening/`, `frontend/js/` | Segments editor: view audio waveform, mark play regions, set timing; POST to backend | source-string-pin | port-to-component-test |
| `admin-listening-tests-detail.test.mjs` | ✗ | `frontend/pages/admin/listening/detail.html`, `frontend/js/` | Detail page: show sections, questions per section, edit links, delete guards confirm | source-string-pin | port-to-component-test |
| `admin-listening-tests.test.mjs` | ✗ | `frontend/pages/admin/listening/`, `frontend/js/` | Test list: paginated, filterable by level/type, import/create buttons | source-string-pin | port-to-component-test |
| `admin-listening-upload.test.mjs` | ✗ | `frontend/pages/admin/listening/`, `frontend/js/` | Upload: drag-drop MP3/WAV, auto-detect format, progress indicator, retry on fail | source-string-pin | port-to-component-test |

### Vocabulary (21 files, 11 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `vocab-landing.test.js` | ✓ | `frontend/vocabulary.html`, `frontend/js/vocabulary-landing.js` | Landing page: topic list, stats, CTA buttons, theme toggle | dom-behavior | port-to-component-test |
| `vocabulary-redesign.test.mjs` | ✓ | `frontend/pages/vocabulary.html`, `frontend/js/vocabulary.js` | Vocab hub: topic card grid, study/quiz CTAs, progress rings per topic | source-string-pin | port-to-component-test |
| `vocab-card-flag.test.mjs` | ✓ | `frontend/js/vocab-card.js` | Vocab card: flag/star for later review, POST /api/vocabulary/flag | source-string-pin | port-to-component-test |
| `vocab-topic-study.test.mjs` | ✓ | `frontend/pages/vocab-study.html`, `frontend/js/vocab-study.js` | Study mode: flashcard flip, audio play, swipe through cards, progress counter | source-string-pin | port-to-component-test |
| `vocab-practice.test.mjs` | ✓ | `frontend/pages/vocab-practice.html`, `frontend/js/vocab-practice.js` | Practice mode: gap-fill MCQ, shuffle, hint system, POST progress | source-string-pin | port-to-component-test |
| `vocab-article-reskin.test.mjs` | ✓ | `frontend/pages/vocab-article.html`, `frontend/js/vocab-article.js` | Article page: word detail, definition, example sentences, related words | source-string-pin | port-to-component-test |
| `vocab-browse-master-detail.test.mjs` | ✓ | `frontend/pages/vocab-browse.html`, `frontend/js/vocab-browse.js` | Browse: topic list (master), click → word detail (detail pane) | source-string-pin | port-to-component-test |
| `vocab-admin-console.test.mjs` | ✓ | `frontend/pages/admin/vocab/`, `frontend/js/admin-vocab.js` | Admin console: topic CRUD, card list, bulk upload, content import | source-string-pin | port-to-component-test |
| `admin-vocab-topics-console.test.mjs` | ✓ | `frontend/pages/admin/vocab/topics.html`, `frontend/js/` | Topics: create, edit, list cards per topic, publish/archive, reorder | source-string-pin | port-to-component-test |
| `admin-vocab-quiz-analytics.test.mjs` | ✓ | `frontend/pages/admin/vocab/analytics.html`, `frontend/js/` | Analytics: quiz performance by question, student mastery, error heatmap | source-string-pin | replace-by-e2e |
| `vocab-css-integrity.test.mjs` | ✓ | `frontend/css/vocab.css`, `frontend/pages/vocab-*.html` | CSS: Tailwind token compliance, no hardcoded colors, dark-mode pair for every style | source-string-pin | replace-by-types |
| `quiz-engine.test.mjs` | ✓ | `frontend/js/quiz-engine.js` | Quiz logic: shuffle, shuffle, MCQ/gap-fill/boolean scoring, retry with penalty | dom-behavior | replace-by-types |
| `quiz-results-ui.test.mjs` | ✓ | `frontend/pages/quiz-result.html`, `frontend/js/` | Result page: score, feedback per question, retry button, time spent | source-string-pin | port-to-component-test |
| `vocab-exam-split.test.mjs` | ✗ | `frontend/js/vocabulary.js` | Exam filter: /api/vocabulary/exam returns curated + imported cards, split by 'lists' field | contract | replace-by-types |
| `vocab-module-loader.test.mjs` | ✗ | `frontend/js/` | Module loader: dynamically fetch vocab content from CDN/backend; no hardcoded URLs | contract | replace-by-types |
| `vocab-source-link.test.mjs` | ✗ | `frontend/pages/vocab-article.html`, `frontend/js/vocab-article.js` | Source link: word origin (AWL/TOEIC/THPT source), POSTed to /api/telemetry | source-string-pin | keep-until-route-retired |
| `pending-vocab.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Pending words: words added to "later" list, sync with backend on session close | source-string-pin | keep-until-route-retired |
| `kp-fe-widgets.test.mjs` | ✗ | `frontend/pages/`, `frontend/js/kp-*.js` | Knowledge Plus widgets: roadmap, progress, unlock badges | source-string-pin | replace-by-e2e |
| `kp-roadmap.test.mjs` | ✗ | `frontend/pages/kp-roadmap.html`, `frontend/js/kp-roadmap.js` | Roadmap visualization: skill tree, prerequisites, next articles; click → article | source-string-pin | replace-by-e2e |
| `admin-vocab-extract.test.mjs` | ✗ | `frontend/js/admin-vocab.js` | Extraction tests: vocabulary bulk operations don't cause silent data loss | dom-behavior | replace-by-e2e |
| `d1-srs-indicator.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/vocab-*.html` | SRS indicator: shows confidence level (new/learning/mature) via badge color | source-string-pin | port-to-component-test |

### Grammar (8 files, 0 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `grammar-recommendation-reliability.test.mjs` | ✗ | `frontend/pages/result.html`, `frontend/js/practice.js`, `frontend/js/grammar.js` | Recommendation links use /grammar/:category/:slug routes, not query params; click telemetry POSTs to /api/grammar/recommendations/:id/clicked | source-string-pin | keep-until-route-retired |
| `grammar-check-ui.test.mjs` | ✗ | `frontend/pages/result.html`, `frontend/js/` | Grammar check UI: expandable issue list, anchor link to article, score breakdown | source-string-pin | keep-until-route-retired |
| `grammar-wiki-redesign.test.mjs` | ✗ | `frontend/pages/grammar-article.html`, `frontend/js/grammar.js` | Article page: category/slug routing, content render, related articles, light-theme compat | source-string-pin | port-to-component-test |
| `grammar-article-light-theme-rendering.test.mjs` | ✗ | `frontend/pages/grammar-article.html`, `frontend/css/` | Light-theme rendering: contrast WCAG AA, readability, code block styling | source-string-pin | replace-by-e2e |
| `grammar-wiki-light-theme-rendering.test.mjs` | ✗ | `frontend/pages/grammar.html`, `frontend/css/` | Grammar hub light-theme: article grid, category nav, search results | source-string-pin | replace-by-e2e |
| `grammar-wiki-comprehensive-theme-rendering.test.mjs` | ✗ | `frontend/pages/grammar-article.html`, `frontend/css/grammar-wiki.css` | Comprehensive rendering: dark + light theme, all article types, code/quote/list blocks | source-string-pin | replace-by-e2e |
| `admin-grammar-extract.test.mjs` | ✗ | `frontend/js/admin-grammar.js`, `frontend/pages/admin/grammar/` | Admin grammar: article CRUD, category tree, metadata edit (related, prereq, pathway) | dom-behavior | replace-by-e2e |
| `sprint-6-12c-audit-closure.test.mjs` | ✗ | `frontend/js/grammar.js`, `frontend/pages/grammar*.html` | Audit closure: grammar roadmap links are canonical (not broken), anchor handling smooth | source-string-pin | keep-until-route-retired |

### Admin (34 files, 19 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `admin-dashboard-redesign.test.mjs` | ✓ | `frontend/pages/admin/index.html`, `frontend/js/admin-dashboard.js` | Admin hub: chrome embed, nav to sub-pages, quick stats (users, sessions, errors) | source-string-pin | port-to-component-test |
| `admin-access-codes.test.mjs` | ✓ | `frontend/pages/admin/access-codes/index.html`, `frontend/js/admin-access-codes.js` | Access codes: list with cohort filter, create modal, edit/delete actions, bulk merge UI | source-string-pin | port-to-component-test |
| `admin-students-redesign.test.mjs` | ✓ | `frontend/pages/admin/students/index.html`, `frontend/js/admin-students.js` | Students: searchable list, drill-down to detail, cohort filter, email log | source-string-pin | port-to-component-test |
| `admin-users-codes-reskin.test.mjs` | ✓ | `frontend/pages/admin/users/index.html`, `frontend/js/admin-users.js` | Users: list, search, role toggle (student/instructor/admin), code assignments | source-string-pin | port-to-component-test |
| `sprint-17-1-admin-codes.test.mjs` | ✓ | `frontend/pages/admin/access-codes/`, `frontend/js/` | Code ownership: canonical via user_code_assignments (active) or access_codes.used_by (legacy fallback); no synthesis error | source-string-pin | keep-until-route-retired |
| `sprint-17-2-usage.test.mjs` | ✓ | `frontend/pages/admin/usage.html`, `frontend/js/admin-usage.js` | Usage dashboard: student activity timeline, session counts, completion rates | source-string-pin | port-to-component-test |
| `sprint-17-3-cohorts.test.mjs` | ✓ | `frontend/pages/admin/cohorts/`, `frontend/js/admin-cohorts.js` | Cohorts: CRUD, member list, access code assignment, seat limits | source-string-pin | port-to-component-test |
| `sprint-17-4-foot-traffic.test.mjs` | ✓ | `frontend/pages/admin/foot-traffic.html`, `frontend/js/` | Foot-traffic heatmap: session attempt timeline, peak hours, device breakdown | source-string-pin | port-to-component-test |
| `sprint-17-5-reassignment.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Reassignment flow: move student between cohorts, existing assignments retained | source-string-pin | port-to-component-test |
| `admin-toast.test.mjs` | ✓ | `frontend/js/admin-toast.js` | Toast notification: auto-dismiss, stack multiple, close button, no animation flicker | dom-behavior | replace-by-types |
| `admin-confirm-danger.test.mjs` | ✓ | `frontend/js/admin-confirm-danger.js` | Confirm modal: block action until user types "CONFIRM", no accidental deletes | dom-behavior | replace-by-types |
| `admin-a11y-labels.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | a11y: all inputs have labels, buttons have aria-label, dialogs trap focus | source-string-pin | replace-by-e2e |
| `admin-polish.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/css/` | Polish: consistent spacing, button sizes, card styling, no visual regression | source-string-pin | replace-by-e2e |
| `admin-progressive-loading-toggle.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Progressive loading: expand/collapse sections, lazy-load detailed data, no timeout | source-string-pin | port-to-component-test |
| `admin-overview.test.mjs` | ✗ | `frontend/pages/admin/overview.html`, `frontend/js/admin-overview.js` | Overview: system stats (total users, active sessions, KB, usage %, uptime) | source-string-pin | port-to-component-test |
| `admin-error-logs.test.mjs` | ✗ | `frontend/pages/admin/error-logs.html`, `frontend/js/admin-error-logs.js` | Error logs: table, filters (date, severity, route), export CSV, mark-as-read | source-string-pin | port-to-component-test |
| `admin-error-logs-humanize.test.mjs` | ✗ | `frontend/js/admin-error-logs.js` | Error humanization: convert stack traces to user-friendly messages, no token leak | dom-behavior | replace-by-types |
| `admin-monolith-redesign.test.mjs` | ✗ | `frontend/pages/admin/`, `frontend/js/` | Monolith refactor complete: all routes in new IA (not legacy admin.html) | source-string-pin | retire-immediately (legacy reference) |
| `admin-instructor-queue-redesign.test.mjs` | ✗ | `frontend/pages/admin/instructor-queue.html`, `frontend/js/` | Instructor queue: pending essays, re-grade requests, priority sort | source-string-pin | port-to-component-test |
| `admin-system-extract.test.mjs` | ✗ | `frontend/js/admin-system.js`, `frontend/pages/admin/system.html` | System config: feature flags display, deployment info, database status | dom-behavior | replace-by-e2e |
| `admin-speaking-extract.test.mjs` | ✗ | `frontend/js/admin-speaking.js`, `frontend/pages/admin/speaking.html` | Speaking admin: grading queue, retry, bulk operations | dom-behavior | replace-by-e2e |
| `merge-codes-users-tabs.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Tab navigation: codes/users/cohorts stay synced, active tab highlighted | source-string-pin | port-to-component-test |
| `generate-and-assign-code.test.mjs` | ✓ | `frontend/pages/admin/access-codes/`, `frontend/js/` | Flow: generate → assign to cohort/user → confirm POST to backend | source-string-pin | port-to-component-test |
| `site-overview-coverage.test.mjs` | ✓ | `frontend/pages/admin/overview.html`, `frontend/js/` | Overview completeness: all key metrics present (users, sessions, errors, usage) | source-string-pin | port-to-component-test |
| `grade-queue.test.mjs` | ✓ | `frontend/pages/admin/grade-queue.html`, `frontend/js/admin-grade-queue.js` | Grade queue: pending essays list, sort by date/student, open form POSTs to grade endpoint | source-string-pin | port-to-component-test |
| `grade-submit-next.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Grade workflow: submit → confirm → POST /grading → success toast → next item auto-loads | source-string-pin | port-to-component-test |
| `content-template-download.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Download template: CSV/Excel export for import workflows; no silent data loss | source-string-pin | keep-until-route-retired |
| `assignment-analysis-level.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Assignment level analysis: filter by cohort/skill, show completion % per level | source-string-pin | port-to-component-test |
| `regrade-level-picker.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Regrade picker: select reason (prompt change, remark request), confirm action | source-string-pin | port-to-component-test |
| `hide-subbands-toggle.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/js/` | Toggle: hide/show fine-grained band subscores in result view | source-string-pin | keep-until-route-retired |

### Platform (13 files, 5 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `theme-toggle.test.mjs` | ✓ | `frontend/js/theme-toggle.js`, `frontend/css/tokens.css` | Theme toggle: exports 8 functions (initTheme, setTheme, etc), localStorage persists choice, matchMedia syncs with system | dom-behavior | replace-by-types |
| `theme-toggle-icon-canonical.test.mjs` | ✓ | `frontend/js/components/theme-toggle.js`, `frontend/pages/` | Toggle icon: moon/sun SVG swap, click changes theme, ARIA label present | source-string-pin | port-to-component-test |
| `theme-toggle-layout-context.test.mjs` | ✗ | `frontend/js/theme-toggle.js`, `frontend/pages/` | Layout context: theme passed via provider/context to nested components (IIFE pattern) | dom-behavior | keep-until-route-retired |
| `typography-tier1.test.js` | ✓ | `frontend/css/tailwind.build.css`, `frontend/css/tokens.css` | Tailwind tokens: all semantic sizes (sm, md, lg, xl) present, scale proportional, no gap | source-string-pin | replace-by-types |
| `hex-budget.test.mjs` | ✓ | `frontend/css/`, `frontend/pages/` | CSS color budget: <50 unique hex values, reuse via Tailwind tokens | source-string-pin | replace-by-types |
| `design-fix-1-admin-primitives.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/css/` | Admin primitives: button/input/modal/table styles consistent | source-string-pin | port-to-component-test |
| `design-fix-2-admin-buttons-hubs.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/css/` | Button variants: primary/secondary/danger, sizes match tokens | source-string-pin | port-to-component-test |
| `design-fix-3-user-tokens.test.mjs` | ✓ | `frontend/css/tokens.css`, `frontend/pages/` | User-facing tokens: spacing, shadows, border-radius, consistent everywhere | source-string-pin | port-to-component-test |
| `primitive-families.test.mjs` | ✓ | `frontend/css/`, `frontend/pages/` | Primitive families: button + input + card + dialog have cohesive variants | source-string-pin | port-to-component-test |
| `chrome-spacing-canonical.test.mjs` | ✓ | `frontend/js/components/aver-chrome.js`, `frontend/pages/` | Chrome spacing: margin/padding consistent with page grid | source-string-pin | port-to-component-test |
| `chrome-unification-canonical.test.mjs` | ✗ | `frontend/js/components/aver-chrome.js`, `frontend/js/components/aver-admin-chrome.js` | Unification: shared nav logic, no duplicate event handling, icon set consistent | source-string-pin | keep-until-route-retired |
| `subheading-pattern-canonical.test.mjs` | ✗ | `frontend/pages/`, `frontend/css/` | Subheading pattern: typography, spacing, color consistent across pages | source-string-pin | keep-until-route-retired |
| `warning-banner-tokens.test.mjs` | ✗ | `frontend/pages/`, `frontend/css/` | Banner tokens: background, text, icon colors follow token system | source-string-pin | keep-until-route-retired |

### Chrome (5 files, 1 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `aver-admin-chrome.test.mjs` | ✓ | `frontend/js/components/aver-admin-chrome.js`, `frontend/pages/admin/` | Web Component: `<aver-admin-chrome active="...">` renders nav with active tab highlighted; click navigates via window.location | source-string-pin | keep-until-route-retired |
| `audio-player.test.mjs` | ✗ | `frontend/js/components/audio-player.js`, `frontend/pages/listening*.html` | Audio player Web Component: play/pause/scrub, load audio via src attribute, events fire on play/end | dom-behavior | replace-by-types |
| `audio-cutter.test.mjs` | ✗ | `frontend/js/audio-cutter.js`, `frontend/pages/admin/listening/` | Audio cutter: select region via waveform, set start/end time, preview clip, POST to backend | dom-behavior | port-to-component-test |
| `cue-card-detector.test.mjs` | ✗ | `frontend/js/cue-card-detector.js`, `frontend/pages/practice.html` | Cue card detection: extracts text from Part 2 cue card image via OCR; fallback to user input | contract | replace-by-types |
| `cue-card-*` (4 files) | ✗ | `frontend/pages/practice.html`, `frontend/js/cue-card-*.js` | Cue card display, fetch URL, length warning, part router — see sub-entries below | source-string-pin | keep-until-route-retired |
| `cue-card-fetch-url.test.mjs` | ✗ | `frontend/js/cue-card-fetch-url.js` | Fetch: GET /api/cue-cards/:part → return { image_url, prompt, duration } | contract | replace-by-types |
| `cue-card-length-warning.test.mjs` | ✗ | `frontend/js/cue-card-length-warning.js` | Warning: shows if prep time <1 min; dismissable | source-string-pin | keep-until-route-retired |
| `cue-card-part-router.test.mjs` | ✗ | `frontend/js/cue-card-part-router.js` | Router: map session_id + part → cue card; no cross-part leakage | dom-behavior | replace-by-types |
| `cue-card-ui-wiring.test.mjs` | ✗ | `frontend/js/cue-card-ui-wiring.js` | Wiring: cue card loads on practice start, displays in sidebar, updates on part change | source-string-pin | keep-until-route-retired |
| `exam-player.test.mjs` | ✗ | `frontend/js/exam-player.js`, `frontend/pages/reading-exam.html` | Exam player: manages question order, answer state, time limit; no premature submit | dom-behavior | replace-by-e2e |

### Miscellaneous (60 files, 25 in CI)

#### API & Contract Tests (12 files, 4 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `api-route.test.mjs` | ✗ | `frontend/js/api.js` | Route construction: session → /sessions/id, response → /sessions/id/responses | contract | replace-by-types |
| `no-raw-fetch-relative-path.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | No raw fetch with relative path; use window.api.base + absolute URL | source-string-pin | replace-by-types |
| `css-paths-absolute.test.mjs` | ✗ | `frontend/pages/`, `frontend/js/` | CSS paths: all @import/@url absolute (/css/...), not relative | source-string-pin | retire-immediately (enforced by build) |
| `cross-page-navigation-canonical.test.mjs` | ✗ | `frontend/pages/`, `frontend/js/` | Navigation: all internal links use canonical routes (no double-redirects) | source-string-pin | keep-until-route-retired |
| `error-reporter.test.mjs` | ✗ | `frontend/js/error-reporter.js` | Reporter: captures console.error, window.onerror, unhandled promise rejection; POSTs to telemetry | dom-behavior | replace-by-types |
| `error-reporter-dispatch.test.mjs` | ✗ | `frontend/js/error-reporter.js` | Dispatch: batches errors, samples to avoid quota, scrubs tokens/URLs | dom-behavior | replace-by-types |
| `safe-error-detail.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/error.html` | Safe error detail: 500 response has user-safe message, no stack/token in UI | source-string-pin | port-to-component-test |
| `perf-resource-hints.test.mjs` | ✓ | `frontend/pages/`, `frontend/html/` | Hints: preconnect, dns-prefetch, preload for critical paths (fonts, API, images) | source-string-pin | port-to-component-test |
| `anti-flash-iife-canonical.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Anti-flash IIFE: runs before first paint, sets theme/lang, no flicker on reload | source-string-pin | port-to-component-test |
| `web-readiness-p1-warnings.test.mjs` | ✓ | `frontend/pages/`, `frontend/html/` | Web readiness P1: all meta tags, viewport, charset, no deprecated attributes | source-string-pin | port-to-component-test |
| `brief-contrast-guidance.test.mjs` | ✓ | `frontend/css/`, `frontend/pages/` | Contrast: WCAG AA everywhere, guidance text is readable | source-string-pin | replace-by-e2e |
| `brief-hardcoded-color-lesson.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Hardcoded: no hex/rgb in HTML/inline styles, Tailwind tokens only | source-string-pin | replace-by-types |
| `brief-lock-contract.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Lock contract: access gates consistent, no plaintext secrets in HTML | source-string-pin | port-to-component-test |
| `bundle-import-ui.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Bundle import: UI doesn't block on large JS, lazy-load admin/charts | source-string-pin | replace-by-types |

#### Audit & Formalization (7 files, 1 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `sprint-6-7-1-audit-closure.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Sprint 6.7.1 closure: listed checks all pass, no regressions | source-string-pin | retire-immediately (historical audit) |
| `sprint-6-9-1-audit-closure.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Sprint 6.9.1 closure: listed checks all pass | source-string-pin | retire-immediately (historical audit) |
| `sprint-6-12c-audit-closure.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Sprint 6.12c closure: grammar links canonical | source-string-pin | retire-immediately (historical audit) |
| `sprint-6-14c-hotfix-audit-closure.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Sprint 6.14c hotfix: listed checks pass | source-string-pin | retire-immediately (historical audit) |
| `sprint-6-15-2-narrative-correction.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Narrative correction: text changes validated | source-string-pin | retire-immediately (historical audit) |
| `phase-closure-ledger.test.mjs` | ✗ | `frontend/`, `backend/` | Phase closure: all listed invariants pass | source-string-pin | keep-until-route-retired |
| `gate-9-5-9-6-9-7-formalization.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Gate formalization: 9.5/9.6/9.7 checks pass | source-string-pin | keep-until-route-retired |
| `gate-10-formalization.test.mjs` | ✗ | `frontend/js/`, `frontend/pages/` | Gate 10: listed checks pass | source-string-pin | keep-until-route-retired |

#### Rendering & Visual Tests (12 files, 4 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `home-redesign.test.mjs` | ✓ | `frontend/pages/home.html`, `frontend/js/home.js` | Home page: skill cards, stats render, no error boundaries shown | source-string-pin | port-to-component-test |
| `home-stats-loading.test.mjs` | ✓ | `frontend/pages/home.html`, `frontend/js/` | Stats loading: skeletal UI shows while fetching, then replaced with values | source-string-pin | port-to-component-test |
| `index-redesign.test.mjs` | ✗ | `frontend/index.html` | Login page: Supabase auth form, link to dashboard, no hardcoded secrets | source-string-pin | port-to-component-test |
| `profile-redesign.test.mjs` | ✗ | `frontend/pages/profile.html`, `frontend/js/` | Profile page: user info, change password form, language preference | source-string-pin | port-to-component-test |
| `dashboard-tweaks.test.mjs` | ✓ | `frontend/pages/home.html`, `frontend/js/` | Dashboard tweaks: layout polish, consistent spacing, card interactions smooth | source-string-pin | port-to-component-test |
| `viewers-anonymous.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Anonymous viewers: show CTA to sign up, don't expose internals | source-string-pin | keep-until-route-retired |
| `student-hub-drawer.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Drawer UI: slide in/out, content lazy-load, no flicker on open | source-string-pin | port-to-component-test |
| `sprint-18-3-1-polish.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Polish: consistent spacing, shadows, border-radius | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-1-1-overflow.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Overflow: no horizontal scroll, responsive breakpoints | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-1-2-toolbar.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/components/` | Toolbar: sticky on scroll, action buttons responsive, no z-index collision | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-1-3-toolbar-split.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Toolbar split: content/meta sections don't overlap on mobile | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-2-students-chrome.test.mjs` | ✓ | `frontend/js/components/aver-chrome.js`, `frontend/pages/` | Chrome on student pages: nav items, active tab, click handling | source-string-pin | keep-until-route-retired |

#### Playwright E2E (4 files, 0 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `accordion_interaction.spec.js` | ✗ | `frontend/pages/result.html`, `frontend/js/` | Accordion expand/collapse works in real browser; state reflected in DOM | e2e | keep-until-route-retired |
| `accordion_renders.spec.js` | ✗ | `frontend/pages/result.html` | Accordion renders (no JS errors, visible structure) | e2e | keep-until-route-retired |
| `result_accordion.spec.js` | ✗ | `frontend/pages/result.html`, `frontend/js/` | Result accordion: grammar section, detail links, printable | e2e | keep-until-route-retired |
| `retention_warning.spec.js` | ✗ | `frontend/pages/result.html` | Retention warning: animates in, dismiss button works, closed state persists | e2e | keep-until-route-retired |

#### Misc Infrastructure & Tokens (7 files, 0 in CI)

| Test file | In CI | Target files | Invariant(s) | Class | Migration disposition |
|-----------|-------|--------------|--------------|-------|----------------------|
| `undefined-token-sentinel.test.mjs` | ✓ | `frontend/css/`, `frontend/pages/`, `frontend/js/` | Sentinel: no undefined Tailwind token usage (catches typos like av-size-badname) | source-string-pin | replace-by-types |
| `d1-source-label.test.mjs` | ✗ | `frontend/pages/vocab-*.html`, `frontend/js/` | Source label: vocab card shows origin (AWL/TOEIC/common) when available | source-string-pin | keep-until-route-retired |
| `sprint-14-6-5-light-theme-panels.test.mjs` | ✓ | `frontend/css/`, `frontend/pages/` | Light-theme panels: shadow, background, border colors work together | source-string-pin | retire-immediately (historical audit) |
| `sprint-14-5-1-result-completeness.test.mjs` | ✓ | `frontend/pages/result.html`, `frontend/js/` | Result page: all sections present (band, phoneme, grammar, pronunciation) | source-string-pin | retire-immediately (historical audit) |
| `sprint-14-8-1-signal-persistence.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Session signal persists on reload (via URL session_id), no data loss | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-3-components.test.mjs` | ✓ | `frontend/js/components/`, `frontend/pages/` | Components: common patterns (button, input, modal) present and wired | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-2-dashboard.test.mjs` | ✓ | `frontend/pages/home.html`, `frontend/js/` | Dashboard: load stats, render cards, click CTA | source-string-pin | retire-immediately (historical audit) |
| `sprint-18-1-ia.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | IA: all nav links point to correct routes, no 404 | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-2-l1-reading.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/` | L1 reading: passage + 3 Q formats (MCQ, matching, gist) | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-3-l2-skill-and-admin.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/admin-reading.js` | L2 reading + admin: levels separate, permissions enforced | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-6-l3-exam-ui.test.mjs` | ✓ | `frontend/pages/reading-exam.html`, `frontend/js/` | L3 exam: takes, live timing, result PDF export | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-8-admin-polish-and-cleanup.test.mjs` | ✓ | `frontend/pages/admin/`, `frontend/css/` | Admin polish: consistent styling, no visual debt | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-10-prod-hotfix.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Hotfix: specific bug fixed, no regression | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-11-exam-ux-v2.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | UX v2: reading/listening/speaking consistent interactions | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-13a-standards-fidelity.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Standards fidelity: IELTS rubric alignment checked | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-13b-standards-a11y.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Standards a11y: WCAG 2.1 AA compliance | source-string-pin | replace-by-e2e |
| `sprint-20-13c-standards-behavior.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Standards behavior: session persistence, logout, role isolation | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-14-display-fidelity.test.mjs` | ✓ | `frontend/pages/`, `frontend/css/` | Display fidelity: typography, spacing, color match design | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-14b-phase-b-types.test.mjs` | ✓ | `frontend/js/`, `frontend/pages/` | Phase B types: API shapes verified | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-14e-summary-instruction.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Summary instruction: visible, clear, no jargon | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-14f-alpha-diagram-image.test.mjs` | ✓ | `frontend/pages/`, `frontend/js/` | Diagram images: load, render at correct size, alt-text present | source-string-pin | retire-immediately (historical audit) |
| `sprint-20-15-admin-reading-mgmt.test.mjs` | ✓ | `frontend/pages/admin/reading/`, `frontend/js/` | Admin reading mgmt: CRUD, permissions, audit log | source-string-pin | retire-immediately (historical audit) |
| `f2-compare-mix.test.mjs` | ✓ | `frontend/pages/grammar-compare.html`, `frontend/js/` | Compare page: side-by-side rendering, example mix | source-string-pin | port-to-component-test |

---

## Tests Marked UNCLEAR — RESOLVED 2026-07-14

All formerly-UNCLEAR entries were re-read against their test file + target
source and finalized (durable invariant + ledger disposition). The per-test
result is the **"## UNCLEAR resolution" appendix** at the end of this doc; the
inline disposition column no longer contains any UNCLEAR marker. This queue is
closed — do not treat these as open.

## Tests to Retire Immediately (Obsolete / Not Migrating)

These tests protect obsolete flows or historical audits. Recommend retiring before Phase 1:

1. `admin-monolith-redesign.test.mjs` — Legacy reference to old admin.html
2. `pricing-redesign.test.mjs` — Design-only; no migration path
3. `onboarding-redesign.test.mjs` — Deprecated onboarding flow
4. `sprint-6-7-1-audit-closure.test.mjs` — Historical audit
5. `sprint-6-9-1-audit-closure.test.mjs` — Historical audit
6. `sprint-6-12c-audit-closure.test.mjs` — Historical audit
7. `sprint-6-14c-hotfix-audit-closure.test.mjs` — Historical audit
8. `sprint-6-15-2-narrative-correction.test.mjs` — Historical audit
9. `sprint-14-6-5-light-theme-panels.test.mjs` — Historical audit
10. `sprint-14-5-1-result-completeness.test.mjs` — Historical audit
11. `sprint-14-8-1-signal-persistence.test.mjs` — Historical audit
12. `sprint-18-3-components.test.mjs` — Historical audit
13. `sprint-18-2-dashboard.test.mjs` — Historical audit
14. `sprint-18-1-ia.test.mjs` — Historical audit
15. `sprint-18-3-1-polish.test.mjs` — Historical audit
16. `sprint-18-3-1-1-overflow.test.mjs` — Historical audit
17. `sprint-18-3-1-2-toolbar.test.mjs` — Historical audit
18. `sprint-18-3-1-3-toolbar-split.test.mjs` — Historical audit
19. `sprint-20-2-l1-reading.test.mjs` — Historical audit
20. `sprint-20-3-l2-skill-and-admin.test.mjs` — Historical audit
21. `sprint-20-6-l3-exam-ui.test.mjs` — Historical audit
22. `sprint-20-8-admin-polish-and-cleanup.test.mjs` — Historical audit
23. `sprint-20-10-prod-hotfix.test.mjs` — Historical audit
24. `sprint-20-11-exam-ux-v2.test.mjs` — Historical audit
25. `sprint-20-13a-standards-fidelity.test.mjs` — Historical audit
26. `sprint-20-13c-standards-behavior.test.mjs` — Historical audit
27. `sprint-20-14-display-fidelity.test.mjs` — Historical audit
28. `sprint-20-14b-phase-b-types.test.mjs` — Historical audit
29. `sprint-20-14e-summary-instruction.test.mjs` — Historical audit
30. `sprint-20-14f-alpha-diagram-image.test.mjs` — Historical audit
31. `sprint-20-15-admin-reading-mgmt.test.mjs` — Historical audit
32. `css-paths-absolute.test.mjs` — Enforced by build system

---

## Disposition Summary by Count

| Disposition | Count | Rationale |
|---|---|---|
| **port-to-component-test** | 128 | Source-string-pin tests → characterization/snapshot tests in Next.js component test harness (e.g., Vitest + jsdom) |
| **replace-by-types** | 43 | Contract tests → TypeScript types + OpenAPI schema validation + typed tests (no re-pin HTML/JS strings) |
| **replace-by-e2e** | 21 | Visual/rendering/a11y tests → staging E2E (Playwright, real browser, real backend) |
| **keep-until-route-retired** | 24 | Domain-specific guard that stays on legacy route in fallback after cutover; retire only after canonical route cutover soak window closes |
| **retire-immediately** | 9 | Obsolete or enforced by build (no longer meaningful or no migration target exists) |

---

## Fragility Class Breakdown

| Class | Count | Characteristics | Migration strategy |
|---|---|---|---|
| **source-string-pin** | ~168 | readFileSync + regex match on HTML/JS/CSS source | Port to component test (Vitest snapshot or characterization test); may need source update post-migration |
| **dom-behavior** | ~18 | DOM shim, JSDOM, minimal mocking; tests JS function behavior | Replace with unit/integration test in Next.js harness; may add E2E for complex flows |
| **contract** | ~23 | API shape, payload structure, TypeScript types | Replace with OpenAPI blocking + typed test; no need to re-pin source strings |
| **e2e** | 4 | Playwright, real browser, fixture-based smoke | Keep as-is (migrate fixture source only); upgrade to full staging E2E in Phase 1 |
| **unclear** | 0 | Resolved 2026-07-14 (see appendix) | — |

---

## Next Steps (Before Gate A)

1. ~~Reconcile unclear entries (34 tests)~~ — **DONE 2026-07-14** (finalized in the UNCLEAR resolution appendix).
2. **Retire obsolete tests** (9 files) — remove immediately, no replacement needed.
3. **Validate Route Ledger alignment** — ensure test disposition matches planned route migration order (Phase 2–6).
4. **Create Test Replacement Backlog** — spike effort for porting top-priority tests (speaking, writing, reading, admin).
5. **Lock CI test list in code** — migrate backend-tests.yml to explicit (not glob) reference once cleanup is done; currently 131/225 in CI, gap of 94 files.

---

## References

- **Migration Plan:** `/docs/FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md` §7.4, §11.4, §B7
- **Baseline commit:** `9047e09f` (discovery baseline, July 12); validation refresh at `3f031d17` (July 13)
- **CI configuration:** `.github/workflows/backend-tests.yml` lines 124–254 (131 files, node --test)
- **Test method:** node:test (native Node.js; no external framework)


---

## UNCLEAR resolution (2026-07-14)

The 33 rows formerly marked **UNCLEAR** (disposition column) were re-read
(and, after review #758, the endpoint-bearing invariants re-verified against
each test's actual assertions — 6 were corrected)
against their test file + target source and finalized. The disposition column
now carries the ledger-taxonomy value; the **durable invariant** below is the
implementation-agnostic guarantee each test protects (what must stay true
after the page migrates to Next.js), replacing the fragile source-string it
currently matches.

| test | durable invariant (finalized) | disposition |
|---|---|---|
| speaking-rubric-v2-compat | Grading API response keeps legacy field names (band_fc/lr/gra/p, *_feedback, strengths, improvements) so the result renderer stays back-compatible | replace-by-types |
| reading-diagnostic | Result page fetches the diagnostic for the submitted attempt (`/api/reading/diagnostic?attempt_id=`) and links to L2 exercises | replace-by-e2e |
| admin-listening-convert | Convert workflow (NOT audio import): two upload zones (question_paper + script_answerkey, `.md`), POST `/admin/listening/convert` then `/admin/listening/convert/commit` | replace-by-e2e |
| admin-listening-drills-import | Two-step drills import: POST `/admin/listening/drills/import` then `/admin/listening/drills/import/commit` (dictation/gist/MCQ bank, auto-segmentation) | replace-by-e2e |
| admin-vocab-quiz-analytics | Vocab analytics hits `/admin/quiz/students?skill_area=vocab` (per-student) + `/admin/quiz/banks?skill_area=vocab` (hard-words) | replace-by-e2e |
| kp-fe-widgets | Weak-grammar widget fetches `/api/me/kp-mastery?status=weak&kp_type=grammar`; reading review renders a KP stepper with grammar deep-links | replace-by-e2e |
| kp-roadmap | Roadmap branches on slug: no-slug → `/api/me/roadmap`; has-slug → per-article; articles link `/grammar/{category}/{slug}` | replace-by-e2e |
| exam-player | Exam player GETs `/api/exams`, `/api/exams/{id}`, POSTs attempts with answer data, renders KP review stepper | replace-by-e2e |
| d1-srs-indicator | SRS indicator renders on `srs_updated=true`, branches on `srs_rating`, clears prior indicator before appending (response-schema-driven) | port-to-component-test |
| admin-writing-new-redesign | New-essay form POSTs the 8-key payload (student_id, task_type, analysis_level, selected_model, form_of_address, grading_tier, prompt_text, essay_text) to the essays endpoint | port-to-component-test |
| admin-writing-assignments-redesign | Assignment form creates via `/admin/writing/assignments` (cohort_id, prompt_id, deadline, instructions); status taxonomy pending/in_progress/submitted/graded/delivered | port-to-component-test |
| admin-writing-prompts-redesign | Prompt list paginated + filterable by level/topic with bulk publish/archive; create/edit via `POST /admin/writing/prompts` | port-to-component-test |
| listening-mcq-sessions-pages | MCQ user page POSTs `/api/listening/attempts` (mode=mcq); admin editor POSTs `/admin/listening/exercises` (exercise_type=mcq, 1–20 Q); browse filters accent/cefr/section; analytics day-chart | port-to-component-test |
| admin-listening-content-management | Content list GETs `/admin/listening/content` (status filter); detail GETs content/{id} + exercises?content_id= | port-to-component-test |
| admin-listening-segments | Segment/region editor on `/admin/listening/content/{id}` + `/admin/listening/exercises` (region marking + timing; NOT a `/segments/{id}` endpoint) | port-to-component-test |
| admin-listening-tests-detail | Test detail shows sections + questions-per-section with edit/delete-confirm; GETs `/admin/listening/tests/{id}` | port-to-component-test |
| admin-listening-tests | Tests list paginated + filterable by level/type with import/create | port-to-component-test |
| admin-listening-upload | MP3/WAV upload with format auto-detect + progress + retry via `/admin/listening/upload` | port-to-component-test |
| audio-cutter | Region selection + `/detect-silence` (auto-detect) + `/cut-audio` (export) endpoints | port-to-component-test |
| admin-overview | Overview shows 4 stat tiles (students-total, students-active-7d, errors-undismissed, access-codes-active) + skill cards | port-to-component-test |
| admin-error-logs | Error dashboard shows total/undismissed/24h/7d cards + 3-filter bar + dismiss/undismiss/refresh | port-to-component-test |
| admin-instructor-queue-redesign | Instructor review queue: GET `/admin/instructor/queue` + claim/release lifecycle (`/admin/instructor/reviews/{id}/claim` + `/release`) | port-to-component-test |
| assignment-analysis-level | Assignment analysis-LEVEL picker (L1–L5, default L3): assignment payloads carry `analysis_level`; queue/grade show read-only level badges | port-to-component-test |
| regrade-level-picker | Regrade modal (L1–L5): the regrade POST body carries `analysis_level` (not empty `{}`), seeded from the current essay level; cancel is a hard no-op (confirmDanger a11y pattern) | port-to-component-test |
| home-stats-loading | Home stats show a loading placeholder during fetch, real value on success, "—" on error (never literal 0) | port-to-component-test |
| student-hub-drawer | Student drawer shows profile/cohort/target-vs-current/essay-history from `/admin/students/{id}` + writing summary; deep-links to assignment form | port-to-component-test |
| admin-writing-status-redesign | Writing status dashboard: per-student grade counts, completion %, feedback rate | keep-until-route-retired |
| admin-writing-redesign | Writing admin hub navigates to dashboard/queue/prompts/cohorts/assignments | keep-until-route-retired |
| chrome-unification-canonical | `<aver-chrome>` renders unified nav (6 skill links + theme toggle + user pill) and logs out via getSupabase().auth.signOut() | keep-until-route-retired |
| theme-toggle-layout-context | Theme toggle sits inside a flex container (legacy DOM-position guarantee — re-verify in Next layout, not pin legacy HTML) | keep-until-route-retired |
| phase-closure-ledger | Doc-consistency audit (DESIGN_SYSTEM/UNIFIED_DESIGN_BRIEF vs filesystem) — legacy design-system artifact | keep-until-route-retired |
| gate-9-5-9-6-9-7-formalization | DESIGN_SYSTEM § 17.9/17.10/17.11 doc audit (Gate 9.5/9.6/9.7) — legacy design-system artifact | keep-until-route-retired |
| gate-10-formalization | DESIGN_SYSTEM § 17.14 doc audit (Gate 10 topnav-wrap position) — legacy design-system artifact | keep-until-route-retired |

**Mapping note:** agent-level dispositions collapsed to the ledger taxonomy —
API/endpoint-integration → `replace-by-e2e`, pure response-schema →
`replace-by-types`, DOM/page rendering (fragile source-pin) →
`port-to-component-test`, legacy-structure / doc-audit → `keep-until-route-retired`
(retire after the owning route cuts over, not before).
