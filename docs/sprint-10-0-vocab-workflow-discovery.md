# Sprint 10.0 — Vocabulary Workflow Discovery Audit

**Date:** 2026-05-15
**Status:** Discovery doc — NO production code changes
**Sprint type:** Audit (proven pattern: Sprint 7.1 / 7.9 / 9.0)
**Effort:** ~2h research, ~1h synthesis

---

## Executive summary

Andy reported three concerns about the current vocabulary workflow:

1. **"Capture thẳng từ user content, chưa filter."** Words/phrases are extracted straight from speaking transcripts and writing submissions without filtering.
2. **"Form lưu trong vocab bank là form thô."** Words are stored raw (no lemmatization or normalization), so a user can end up with `running`, `ran`, `runs` as three separate items.
3. **"Cách sắp xếp cơ chế (đặc biệt flashcards) cần đánh giá lại."** The way the flashcard mechanics are organized needs reassessment.

This audit validates each concern against the actual implementation. The headline finding: **the system is significantly more sophisticated than Andy's complaints suggest**, but there are real gaps — especially around (a) the absence of a user-confirmation step, (b) the absence of a true lemmatization layer for irregular forms, and (c) the disconnect between D1 exercise outcomes and the SRS / mastery state.

Cumulative issue catalog: **14 issues** across 5 layers (capture / storage / mechanics / UI / integrations), severity ranked High / Med / Low. Five improvement areas proposed with pros/cons + effort estimates. Three roadmap options (A: foundation first, B: quick wins first, C: selective).

---

## Phase A — Frontend audit findings

### A1. My Vocab Bank UI (`/js/vocab-modules/my-vocab.js`)

**Filter pills** (7 total — `data-action="set-filter"`):
- `all` — list every alive item (default)
- `used_well` — `source_type === 'used_well'` (AI verdict: word used correctly in context)
- `needs_review` — `source_type === 'needs_review'` (AI verdict: grammar/usage issue) **— Sprint 6.0 archived this category for new captures, but the pill still surfaces legacy/triage items**
- `upgrade_suggested` — `source_type === 'upgrade_suggested'` (AI verdict: simpler word; suggests a higher-band alternative)
- `manual` — `source_type === 'manual'` (user-added)
- `learning` — `mastery_status === 'learning'` (default state for all new items)
- `mastered` — `mastery_status === 'mastered'` (user toggled the per-card Mastered button)

`_applyFilter()` at `my-vocab.js:438` — simple equality filter on either `source_type` or `mastery_status`. Filter pills overlap (e.g. an item can be `manual` AND `learning`); no compound filter UI.

**Card rendering** (`cardHtml()` at `my-vocab.js:329`):
- Headword + colored source_type badge ("Dùng tốt ✓" / "Cần xem lại ⚠" / "Nâng cấp ↑" / "Thủ công")
- Mastery toggle button (top-right of card) — single click flips between Learning / Mastered, hits `PATCH /api/vocabulary/bank/{id}`
- Definition block (EN · VI)
- Context sentence (italic, verbatim from session)
- Conditional metadata:
  - `upgrade_suggested` items show "Nâng cấp từ: {original_word}"
  - `needs_review` items show "Gợi ý: {suggestion}"
- Action buttons (right column, conditional by source_type and feature flags):
  - `↗ nguồn` — link to original session result page (`/pages/result.html?id={session_id}`)
  - `▶ practice` — link to exercises hub (NOT scoped to this word)
  - `📚 +Stack` — open modal to add to a manual flashcard stack (calls `POST /api/flashcards/stacks/{id}/cards`)
  - `👁️ Xem trước` — modal preview of the flashcard back side (IPA + example)
  - `➕ Đưa vào danh sách` — `upgrade_suggested` only: promote to manual via `POST /api/vocabulary/bank/{id}/accept`
  - `✏️ Đã sửa, đưa lên flashcard` — `needs_review` only: triage as "fixed" via `POST .../mark-fixed`
  - `🗑️ Bỏ qua` — `needs_review` only: persistent skip via `POST .../skip`

**Manual add flow** (`#data-add-form`, `submitAddWord()`):
- Two fields: `headword` (required), `context_sentence` (optional)
- Definition, IPA, example are NOT collected from the user — they are filled by the Gemini enrichment pipeline server-side
- `POST /api/vocabulary/bank/` with `{ headword, context_sentence }` — backend assigns `source_type='manual'`, runs enrichment, returns the enriched item

**Status semantics gotcha:** `mastery_status` (`learning` / `mastered`) is a **manual** user toggle that is COMPLETELY DECOUPLED from the SRS state (`flashcard_reviews.ease_factor`, `lapse_count`, `next_review_at`). A user can have a word with `mastery_status='mastered'` AND `lapse_count=5` simultaneously — two parallel models of "knows this word" with no sync. See Issue #11 in the catalog.

### A2. Flashcards stack list (`/js/vocab-modules/flashcards.js` — POST Sprint 9.3)

3 auto-stacks (virtual — no DB row) + N manual stacks. Sources synthesised in the backend `GET /api/flashcards/stacks` endpoint:
- `auto:all_vocab` — all alive items, sorted by `created_at DESC`
- `auto:recent` — last N items (cutoff: undocumented in backend audit — appears to be a fixed top-N slice by `created_at DESC`)
- `auto:needs_review` — **Wave 2 redefined**: `lapse_count > 0` items, sorted by `lapse_count DESC, ease_factor ASC`. Pre-Wave 2 this used `source_type='needs_review'` AI verdicts; the redefinition was an intentional shift from "AI flagged usage issues" to "SRS struggle history".

Manual stacks created via modal: name + filter dropdown (topics + categories + search + date filter). Backend snapshots the filter result at creation time into `flashcard_cards` join-table rows.

### A3. Flashcard review session (`/pages/flashcard-study.html` + `/js/flashcard-study.js`)

- Card UI: front shows `headword` only; back shows IPA + `definition_vi` + `definition_en` + `example_sentence`
- Flip mechanic: click or Space; bidirectional flip allowed (post-Day-1 dogfood change)
- Four rating buttons: Quên (Again) / Khó (Hard) / Tốt (Good) / Dễ (Easy) — hotkeys 1–4
- Each button shows the projected next-review interval inline (`formatNextInterval()`)
- Session length: **fixed to the stack's card queue length** (ends when `index >= cards.length`)
- Endpoint: `POST /api/flashcards/{vocab_id}/review` with `{rating}`. **Fire-and-forget — no await**, so a network blip on the last card silently drops the SRS update.
- Summary screen on completion: total cards + per-rating breakdown

### A4. D1 fill-blank exercise (`/pages/d1-exercise.html` + `/js/d1-exercise.js`)

- Question source: **static published exercises** from `vocabulary_exercises` table (admin-authored). NOT generated on demand from the user's vocab bank.
- Difficulty: none. No calibration system.
- Feedback: local grading (case-insensitive trim compare); shows ✓ Chính xác / ✗ Đáp án đúng inline
- **Critical gap:** **no callback to vocab state**. Backend's `POST /api/exercises/d1/{exercise_id}/attempt` writes a row to `vocabulary_exercise_attempts` but does NOT touch `user_vocabulary.mastery_status` or `flashcard_reviews.ease_factor`. Answering D1 correctly does NOT advance SRS scheduling.
- Session length: fixed 10 questions

### A5. Auto-capture surfaces on result pages

`/pages/result.html` (speaking) and `/pages/writing-result.html` (writing): **no client-side vocab capture UI**. No highlighted words, no "Add to bank" buttons, no inline triage. The auto-capture runs entirely server-side in the grading pipeline (see Phase B). Users learn about extracted items only when they next open My Vocab Bank — there is no in-session preview or confirmation step. **This is Andy's #1 complaint surface.**

---

## Phase B — Backend audit findings

(Full inventory in the parallel sub-agent report; condensed here.)

### B1. Endpoints

**Vocab bank** (`backend/routers/vocabulary_bank.py`):
- 13 routes covering list / detail / stats / recent / export / add / patch / archive / accept-upgrade / mark-fixed / skip / report

**Flashcards** (`backend/routers/flashcards.py`):
- 13 routes covering stack CRUD / preview / cards / due / due-count / review / stats / vocab-topics

**Exercises** (`backend/routers/exercises.py`):
- D1 / D3 attempt logging + session start (`POST /api/exercises/d1/sessions` with size=10)

### B2. Schema

Six vocab-related tables:

| Table | Purpose | Key columns | SRS / normalization? |
|---|---|---|---|
| `user_vocabulary` | One row per captured item | `headword`, `context_sentence`, `evidence_substring`, `definition_vi/en`, `ipa`, `example_sentence`, `category`, `topic`, `source_type`, `original_word`, `suggestion`, `mastery_status`, `is_archived`, `is_skipped` | No lemma column; UNIQUE on `(user_id, lower(headword))` for dedup |
| `flashcard_stacks` | Manual stacks (auto-stacks virtual) | `name`, `filter_config JSONB`, `type='manual'` only persisted | — |
| `flashcard_cards` | Stack ↔ vocab join | `(stack_id, vocabulary_id)` UNIQUE | — |
| `flashcard_reviews` | **SRS state per (user, vocab)** | `ease_factor`, `interval_days`, `review_count`, `lapse_count`, `next_review_at`, `last_reviewed_at` | SM-2 simplified; ease bounded [1.3, 3.0] |
| `flashcard_review_log` | Append-only audit | `rating`, `reviewed_at` | Powers daily rate-limit |
| `vocabulary_exercises` | Admin-authored D1/D3 content pool | `exercise_type`, `content_payload JSONB`, `status` | — |
| `vocabulary_exercise_attempts` | Append-only attempt log | `user_answer`, `is_correct`, `score`, `feedback` | NOT linked back to SRS state |

### B3. Capture pipeline (`backend/routers/grading.py:_persist_vocab_from_response`)

Triggered as `BackgroundTasks` after a speaking response is graded. Gated by `users.feature_flags['vocab_enabled']`.

Sequence:
1. **Claude Haiku 4.5** extraction (`services/vocab_extractor.py`) → 3 categories × up to 3 items each: `used_well` / `needs_review` / `upgrade_suggested`
2. **Session topic lookup** to denormalize `topic` into rows
3. **8 guards** (`services/vocab_guards.py`), sequential, first-failure-drops-item:
   - **Guard 0** non-empty fields + no " and " phrases
   - **Guard 7** injection artifact check (keywords / JSON-shaped / punctuation-only)
   - **Guard 8** `evidence_substring` required, must contain headword, must appear in transcript
   - **Guard 1** headword appears in `context_sentence`
   - **Guard 2** `context_sentence` tokens contiguous in transcript (punctuation-tolerant)
   - **Guard 3** proper-noun check (capital outside sentence start → skip)
   - **Guard 4** contradiction (upgrade_suggested only: original_word already in used_well)
   - **Guard 5** whitelist (upgrade_suggested only: pair in `band_upgrade_pairs.json`)
   - **Guard 6** dedup (prefix root ≥ 6 chars OR Levenshtein ≤ 2 OR semantic-cluster match)
4. **Gemini 2.5 Flash enrichment** (`services/vocab_enrichment.py`) — adds `ipa`, `example_sentence`, `definition_vi/en`. Fail-soft (NULL if unavailable; backfill job exists).
5. **Batch insert** with per-category cap (`VOCAB_MAX_PER_CATEGORY` env var). Sprint 6.0 archived `source_type='needs_review'` from new captures (`_PERSISTED_SOURCE_TYPES = {'used_well', 'upgrade_suggested'}`).

Same flow runs for writing submissions (parallel grading path).

### B4. Normalization layer — current state

| Feature | Present? | Detail |
|---|---|---|
| Case-insensitive dedup | ✅ | `UNIQUE (user_id, lower(headword))` on `user_vocabulary` |
| Fuzzy dedup (Levenshtein) | ✅ | Guard 6 threshold ≤ 2 |
| Prefix-root dedup | ✅ | Guard 6, ≥ 6 char prefix → same root (catches `sustain` vs `sustainability`) |
| Semantic-cluster dedup | ✅ | Guard 6, hardcoded list of ~9 synonym clusters in `vocab_guards.py:20` |
| Punctuation strip in compare | ✅ | Guard 2 token comparison only — surface form keeps punctuation |
| **Lemmatization** | ❌ | No spaCy / nltk / lemma column. `ran` and `run` are stored as separate items (Levenshtein 3 ≥ threshold 2) |
| **POS tagging** | ❌ | `category` exists (`topic`/`idiom`/`phrasal_verb`/`collocation`) — set by AI, not derived from grammar tagger |
| **Unicode / diacritics** | ❌ | No `unidecode`; Vietnamese đ / ô / ư kept as-is |
| **`surface_form` vs `lemma` split** | ❌ | Schema has `headword` only |

**This is the real shape of Andy's complaint #2.** The system has more dedup than naïve string equality, but irregular forms slip through (`ran` / `run`, `went` / `go`, `was` / `is`).

### B5. SRS — current state

`backend/services/srs.py` implements **simplified SM-2**:

| Rating | Interval | Ease delta | Lapse delta |
|---|---|---|---|
| `again` | reset to 0 (today) | −0.20 (floor 1.3) | +1 |
| `hard` | `ceil(interval × 1.2)` | −0.15 (floor 1.3) | 0 |
| `good` | `ceil(interval × ease)` | 0 | 0 |
| `easy` | `ceil(interval × ease × 1.3)` (cap 36500) | +0.15 (cap 3.0) | 0 |

- Card state machine: implicit (no enum) — `review_count=0` = new; rest derived from `lapse_count` and intervals
- "Mastered" is NOT an SRS state; it's the separate user-facing `mastery_status` field on `user_vocabulary`
- Rate-limited via `flashcard_review_log` + `@rate_limit_flashcard` decorator (daily UTC reset; `FLASHCARD_DAILY_REVIEW_LIMIT` env var)
- `next_review_at` powers the `auto:needs_review` stack and the `/api/flashcards/due` badge endpoint

**SM-2 is a proven 1980s algorithm. It works. The pedagogical gap is not the algorithm — it's the disconnect between SRS and the user-facing "Mastered" toggle, and the disconnect between D1 outcomes and SRS state.**

---

## Phase C — Issue catalog

| # | Layer | Issue | Andy concern | Severity | Notes |
|---|---|---|---|---|---|
| 1 | Capture | **No user-confirmation step.** Items auto-save after passing 8 guards. User has no chance to drop a Claude false positive in-session. | ✅ #1 | **High** | Real-world false positives DO leak past guards (especially Claude misreading transcript ASR errors). Currently the user finds the bad item later via the My Vocab triage flow — out-of-flow friction. |
| 2 | Capture | **No in-session preview surface.** `result.html` shows scores but never tells the user which words were captured to their bank. | ✅ #1 | Med-High | Causes the "where did this come from?" disorientation Andy hinted at. |
| 3 | Storage | **No lemmatization for irregular forms.** `ran` / `run` / `running` end up as separate items (Levenshtein gap). | ✅ #2 | **High** | The most concrete instance of "form thô". Regular suffixes are caught by Guard 6 prefix root; irregulars are not. |
| 4 | Storage | **No `surface_form` vs `lemma` split in schema.** Users see the verbatim transcript form, even when "the form" the user wants to learn is the dictionary form. | ✅ #2 | Med | Adds a real choice: do we preserve the user's evidence (surface form) AND show the dictionary form, or pick one? |
| 5 | Storage | **No diacritics / unicode normalization.** Mostly affects Vietnamese — minor in current usage. | partly #2 | Low | English-side impact: smart-quote variants. |
| 6 | Mechanics | **`mastery_status` (user toggle) is DECOUPLED from SRS state.** A card can be `mastered` AND have `lapse_count=5`. Two parallel models of "knows this word" with no sync. | ✅ #3 | **High** | Confusing for power users; misleading metrics. |
| 7 | Mechanics | **D1 fill-blank does NOT update SRS state on correct answer.** The pedagogically strongest signal (productive recall in context) is discarded. | ✅ #3 | **High** | Largest missed-feedback-loop in the system. |
| 8 | Mechanics | **D1 questions are admin-authored, NOT pulled from the user's vocab bank.** A user studying "sustain" won't see drills targeting "sustain" unless an admin authored one. | ✅ #3 | Med-High | This is the single biggest reason the user feels D1 and the vocab bank are "two separate apps". |
| 9 | Mechanics | **"Mới thêm gần đây" stack cutoff is undocumented.** Fixed top-N slice — unclear which N. | ✅ #3 | Low | Pure transparency / documentation. |
| 10 | Mechanics | **Review session fire-and-forget POST has no retry / await.** Network blip on the last card silently drops the SRS update. | ✅ #3 | Med | Easy fix; loss is small in practice but real. |
| 11 | Mechanics | **No "Lapsed" surface in the UI.** Users can't see which cards are currently in struggle except indirectly via the "Cần ôn tập" stack. | partly #3 | Low | Power-user feature; minor. |
| 12 | UI | **Filter pill semantics overlap awkwardly.** `manual` + `learning` + `used_well` are orthogonal but rendered as one row of equal-weight buttons. | partly #3 | Med | Two filter axes (source_type, mastery_status) collapsed into one — leads to "I clicked Used well and lost my Manuals" confusion. |
| 13 | UI | **No bulk operations.** Each item action is one-by-one (Mark mastered, Add to stack, Archive). | new | Low | Power-user, low priority. |
| 14 | Integration | **`practice` link on each card navigates to the generic Exercises hub, NOT to a drill targeting the clicked word.** | new | Med | Wire-up gap; the schema (`vocabulary_exercises.target_vocab_id`) supports per-word drills, but the link doesn't filter. |

---

## Phase C — Five improvement proposal areas

Each proposal includes a brief pros / cons / effort estimate. Andy chooses which to fund.

### Area 1 — Capture filter with optional user confirmation

**What:** After grading, surface extracted vocab on `result.html` as a confirmable list before items commit to the bank. Two implementation tiers:

- **1A (low-cost):** AI prompt refinement — tighten the `vocab_extractor` system prompt to drop common B1-and-below words by frequency rank, prefer multi-word idioms, suppress proper nouns more aggressively. Guards 0–8 unchanged.
- **1B (high-value):** New in-session review step. Backend writes extractions to a `vocab_pending` staging table (or marks rows `pending=true` on `user_vocabulary`). `result.html` shows a card list with "Keep" / "Drop" buttons; user confirms before items become visible in My Vocab Bank.

**Pros:** Eliminates Andy complaint #1. Improves trust in the bank ("everything in here is something I chose to learn"). Cleans up downstream SRS by removing low-value items at the source.
**Cons:** 1B adds a step to a flow that's currently zero-friction. Lazy users may never confirm, leaving items in limbo.
**Effort:** 1A = 2–3h (prompt-only). 1B = 1–2 sprints (schema + endpoint + UI).

### Area 2 — Lemmatization + dual-form storage

**What:** Add `lemma` and `pos` columns to `user_vocabulary`. Populate via a lemmatization step in the capture pipeline. Either:

- **2A (server-side library):** Add `spacy` (`en_core_web_sm`) to backend; lemmatize `headword` post-extraction, pre-insert. Dedup at insert time on `(user_id, lemma)` instead of `(user_id, lower(headword))`. Show `headword` as evidence in card UI, dictionary `lemma` as the "title".
- **2B (LLM-driven):** Ask Claude/Gemini to return both `surface_form` and `lemma + pos` in the extraction. No new library.

**Pros:** Resolves Andy complaint #2. Catches irregular verbs (`ran`/`run`, `went`/`go`). Enables better grouping ("you've seen `run` in 5 contexts" instead of 5 separate `run`/`ran`/`runs`/`running`/`run(noun)` cards).
**Cons:** Schema migration for the existing alive items needs a backfill plan (run lemmatization on all current rows). spaCy adds ~30MB to backend image; Railway cold-start impact unclear.
**Effort:** 2A = 1 sprint (migration + lemmatize + dedup logic + UI update). 2B = 0.5 sprint (prompt-only) but less reliable.

### Area 3 — Mastery–SRS sync + D1→SRS feedback loop

**What:** Unify the two "knows this word" models.

- **3A:** Derive `mastery_status` from SRS state instead of the manual button. E.g., `mastered = (interval_days >= 21 AND lapse_count == 0)`. Removes the toggle entirely or rebrands it as "Snooze" / "Hide".
- **3B:** When a user answers a D1 correctly, POST to `/api/flashcards/{vocab_id}/review` with `rating='good'` (or `'easy'` if first-try). Productive recall feeds the SRS schedule.
- **3C:** Same as 3B but for any future drill type (D2 review session already does this; D3 was retired).

**Pros:** Closes Andy complaint #3 (mechanics evaluation). Productive-recall signal is pedagogically the strongest — currently discarded. Mastery state becomes meaningful (not user-self-reported optimism).
**Cons:** Removing the Mastered toggle is a UX regression for users who liked it. D1 → SRS coupling means a wrong answer demotes a card — users may resist that.
**Effort:** 3A = 0.5 sprint. 3B = 0.5 sprint. Combined 3A + 3B + 3C = ~1 sprint.

### Area 4 — Vocab-bank-targeted exercise generation

**What:** Wire D1 question source to the user's vocab bank instead of (or alongside) the admin-authored content pool. Two paths:

- **4A:** Backend route `POST /api/exercises/d1/sessions` accepts `target=vocab_bank` and generates 10 questions on-the-fly via Gemini using the user's `auto:needs_review` cards as seeds (sentence with target word blanked).
- **4B:** Pre-author D1 questions per vocab item at enrichment time — extend `vocab_enrichment.py` to emit a `fill_blank` payload alongside `example_sentence`. Stored on the `user_vocabulary` row itself. Drill session pulls from there.

**Pros:** Largest pedagogical lift — drills become personally relevant. Closes the "two separate apps" feel of vocab bank + exercises.
**Cons:** 4A: on-demand generation latency. 4B: storage bloat + retroactive backfill required.
**Effort:** 4A = 1 sprint. 4B = 1–1.5 sprints.

### Area 5 — UI clarity sweep

**What:** Smaller polish work on My Vocab Bank.

- **5A:** Split the filter pill row into two axes: a left "Source" group (`All` / `Used well` / `Upgrade` / `Manual`) and a right "Progress" group (`Learning` / `Mastered`) — like a checkbox-pair filter.
- **5B:** Bulk operations — checkbox column + bulk Archive / Move to stack / Toggle mastered.
- **5C:** Per-card `▶ practice` link routes to a D1 session scoped to that specific vocab item (depends on Area 4).
- **5D:** In-card preview hover instead of click-to-modal.

**Pros:** Quick UX wins; addresses filter-overlap confusion (Issue #12).
**Cons:** Low pedagogical value compared to Areas 1–4.
**Effort:** 5A = 0.5 sprint. 5B = 0.5 sprint. 5C blocked on Area 4. 5D = 0.25 sprint.

---

## Phase C — Recommended roadmap

Three sequencing options. **Code's recommendation: Option A** (foundation first), specifically the bolded path.

### Option A — Foundation first (8 sprints, ~6–8 weeks)

The right thing to do if Andy is willing to invest in long-term quality. Tackles the schema + algorithmic issues before paper-cuts.

1. **Sprint 10.1: Backend lemmatization + schema migration** (Area 2A) — single biggest data-quality win.
2. **Sprint 10.2: Mastery–SRS unification** (Area 3A) — removes the parallel-models confusion.
3. **Sprint 10.3: D1 → SRS feedback loop** (Area 3B) — closes the largest missed-signal gap.
4. **Sprint 10.4: In-session capture confirmation** (Area 1B) — Andy complaint #1 closed.
5. **Sprint 10.5: Vocab-bank-targeted D1** (Area 4A) — closes the "two separate apps" feel.
6. **Sprint 10.6: UI clarity** (Area 5A + 5B).
7. **Sprint 10.7: Retry/await on review POST + lapsed surface** (Issues #10, #11) — small.
8. **Sprint 10.8: Per-card practice link** (Area 5C, depends on 10.5) — small.

**Why this order:** Schema first (10.1) so all downstream work uses normalized data. Algorithmic fixes next (10.2, 10.3) so when we add the confirmation step (10.4) and personalized drills (10.5), they're working on a clean foundation. UI last.

### Option B — Quick wins first (5 sprints)

Lower commitment. Ships visible improvements faster but risks needing rework when foundation issues surface later.

1. Sprint 10.1: Capture filter via prompt refinement (Area 1A) — visible day 1
2. Sprint 10.2: UI clarity (Area 5A + 5B)
3. Sprint 10.3: D1 → SRS feedback loop (Area 3B) — high-leverage one-sprint
4. Sprint 10.4: Mastery–SRS unification (Area 3A)
5. Sprint 10.5: Lemmatization (Area 2) — deferred but unlocked

### Option C — Selective (2–3 sprints, Andy picks)

If the budget is limited, the highest-leverage three items in isolation:

1. **Lemmatization** (Area 2A) — fixes the most concrete "form thô" complaint
2. **D1 → SRS feedback loop** (Area 3B) — fixes the largest pedagogical gap
3. **In-session capture confirmation** (Area 1B) — fixes Andy complaint #1

These three are mostly orthogonal and could be parallel-tracked if multiple agents are working.

---

## Pedagogical research notes

Brief reference notes on vocabulary-learning best practices, for grounding the proposals above.

- **Surface form vs lemma — preserve both.** Anki, Memrise, and Duolingo all distinguish the dictionary form ("see") from the form-as-encountered ("seeing", "saw"). Keeping `evidence_substring` AS-IS while showing `lemma` as the card title gives the user both: the encounter context they need to remember + the dictionary form they need to study.
- **Context preservation is critical.** Schmitt (2008) and Webb (2007) both find that vocabulary learned with an example sentence is retained ~30% better than vocabulary learned in isolation. The current system already does this (`context_sentence` + `example_sentence`). Don't regress.
- **Spaced repetition: SM-2, FSRS, Leitner.**
  - **SM-2** (SuperMemo 2, 1987): the algorithm currently implemented. Simple, proven, no training data needed. Cards with low ease-factor surface more often. Ease bounded [1.3, 3.0] in the current impl is canonical.
  - **FSRS** (Free Spaced Repetition Scheduler, 2022): newer, ML-derived. Better retention with fewer reviews, but requires per-user training data and a more complex state model (DSR — Difficulty, Stability, Retrievability). Not warranted at current user count.
  - **Leitner** (boxes, 1972): simplest; 5–7 boxes of progressively-longer intervals. Less precise than SM-2.
  - **Recommendation:** stay on SM-2. The pedagogical win is in fixing the feedback loop (Area 3) not switching algorithms.
- **Active recall > passive recognition.** A flashcard you flip and rate yourself on (recognition) is a weaker memory signal than a fill-in-the-blank where you have to produce the word (productive recall). **D1 fill-blank, if wired into SRS, would be the highest-leverage learning signal in the system.** This is the strongest single argument for Area 3B / Area 4.
- **Quality threshold matters.** Schmitt & McCarthy (1997) — language-learner vocab notebooks typically have <50% retention rate, partly because learners over-capture (transcribing every unknown word). A confirmation step (Area 1B) addresses this directly.
- **Frequency rank.** B2–C1 vocabulary is the IELTS sweet spot. Common words (top 2000) are usually already known and waste study time. Rare words (beyond top 8000) are unlikely to appear in test prompts. The AI extractor can be prompt-tuned to this band.

---

## Phase D — Andy decisions list

After this discovery doc lands, Andy decides:

1. **Roadmap direction.** Option A / B / C above? Or a hybrid?
2. **Capture filter scope.** Area 1A (prompt-only, cheap) vs Area 1B (full UI confirmation step)?
3. **Lemmatization approach.** Area 2A (spaCy server-side, reliable) vs Area 2B (LLM-output, lighter but less reliable)?
4. **Mastery model.** Keep the manual `mastered` toggle (status quo) or derive `mastery_status` from SRS state (Area 3A)?
5. **D1 → SRS coupling.** Yes (Area 3B — pedagogically optimal) or no (avoids the "wrong answer demotes my mastered card" regression risk)?
6. **Existing data migration plan.** Real users have 46 alive items in production. For schema changes (lemma column, mastery derivation): big-bang migration with backfill, or shadow column + dual-write window?
7. **Backend changes scope.** Andy comfortable with `requirements.txt` additions (spaCy ~30MB)? Railway cold-start impact tolerable?
8. **Sprint parallelisation.** Run independent sprints (e.g. 10.4 capture confirmation + 10.6 UI clarity) in parallel agents, or strict sequential?
9. **Backwards-compat surface area.** `vocabulary_exercise_attempts` is append-only; should retroactive SRS updates (Area 3B) re-walk the attempts log, or only apply going forward?

---

## Strategic context

- This discovery pattern (Sprint 7.1 / 7.9 / 9.0) consistently saves 10–30h of misallocated implementation. 1.5–2h of audit is the highest-ROI work in the cluster.
- The vocabulary system is the **core retention feature** of the app. A user who returns to the app daily is mostly returning to study cards. Investing in this surface compounds.
- The existing system is more sophisticated than first appearances suggest — 8-guard pipeline, real SM-2, Gemini enrichment, evidence-substring proof. The improvements are about **closing feedback loops** (D1 → SRS, capture → confirmation) and **deepening normalization** (lemma layer), not rebuilding from scratch.
- Sprint 9.x cluster (9.0 → 9.1 → 9.1.1-hotfix → 9.2 → 9.3) made the vocabulary cluster **visually coherent**. Sprint 10.x cluster makes it **pedagogically coherent**.
- After Sprint 10.x lands: the vocab system is on par with Anki/Quizlet for SRS, ahead of them for IELTS-specific context (evidence preservation, band-upgrade suggestions, fill-blank in user's own sentences).

---

## Appendix — Key file:line citations

For drilling down during Sprint 10.1+ implementation:

- `backend/routers/grading.py:623` — `_persist_vocab_from_response()` entry point
- `backend/services/vocab_extractor.py:21,76` — Claude Haiku prompt + extraction
- `backend/services/vocab_guards.py:20,146,189,239` — semantic clusters, Guard pipeline, Guard 6 dedup
- `backend/services/vocab_enrichment.py:40,255` — Gemini enrichment + IPA/example synthesis
- `backend/services/srs.py:38,68` — SM-2 implementation
- `backend/routers/vocabulary_bank.py:89–814` — 13 routes
- `backend/routers/flashcards.py:402–1206` — 13 routes (review at 1098, due at 1008, needs_review redefinition at 813)
- `backend/routers/exercises.py:184–348` — D1 fetch + attempt log (note: no SRS callback)
- `backend/migrations/019_create_user_vocabulary.sql` (+ extensions 020/028/029/030/048)
- `backend/migrations/025_create_flashcard_stacks.sql`
- `backend/migrations/027_create_flashcard_reviews.sql`
- `backend/migrations/021_create_vocabulary_exercises.sql`
- `frontend/js/vocab-modules/my-vocab.js:329,438,447` — cardHtml, _applyFilter, setFilter
- `frontend/pages/flashcard-study.html` + `frontend/js/flashcard-study.js:21,328,358,397` — RATINGS, flip, formatNextInterval, fire-and-forget review POST
- `frontend/pages/d1-exercise.html` + `frontend/js/d1-exercise.js:104,200` — 10-question session, local grading (no SRS callback)
