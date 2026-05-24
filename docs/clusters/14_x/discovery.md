# Cluster 14.x — Speaking Grading Enhancement Discovery

**Cluster:** DEBT-SPEAKING-GRADING-QUALITY
**Sprint:** 14.0 (Discovery, doc-only)
**Status:** Discovery doc in review — no code changes
**Author:** Code, on commission from Andy 2026-05-22
**Predecessors:** Cluster 13.x closed via Sprint 13.6.3 (Codex audit hotfix)
**Related artefacts:**
- Pre-flight inventory: `commission/sprint_14_0_preflight.md`
- Rubric scaffold: `data/rubric/cambridge_speaking_descriptors.json`

---

## 1. Executive summary

Andy reported 8 deficiencies in the Speaking grading pipeline. Empirical pre-flight (see `commission/sprint_14_0_preflight.md`) confirmed 5 are accurate as described, 3 are partially false / less severe than commissioned. Net cluster scope: **7 implementation sprints + 1 closure ~= 8 PRs ~= 3 000–3 500 LOC** (revised down from initial 3 500–4 000 LOC estimate after pre-flight compressed items 1+2 and item 3).

Cluster 14.x was originally planned as **Grammar Mindmap + Checker** (Andy lock 2026-05-20). Andy reprioritised on 2026-05-22 to **Speaking Grading Quality**. Grammar Mindmap UI deferred to Phase B; the grammar checker code asset (`assets/grammar-mindmap/grammar_checker.py`, 872 LOC) is reused as the enrichment source in cluster item 8.

### Decisions locked by Andy (2026-05-22)

| ID | Decision | Lock |
|---|---|---|
| D1 | Reject threshold per-question | Part 1 <15s/Q · Part 2 <80s (1m20s) · Part 3 <25s/Q |
| D2 | Length-violation behaviour | Hard reject — backend 422, force re-record |
| D3 | Cue-card detection (custom-Q Part 2) | Auto-detect heuristic + radio toggle (Single ⟷ Cue card) |
| D4 | Grammar-checker integration scope | Phase A: enrich `grammar_issues[]` (no band coupling). Phase B: tune band weight |
| D5 | Off-topic detection method | Independent Claude LLM judge (binary + reasoning), not semantic similarity |
| D6 | Rubric reference source | Cambridge/British Council public band descriptors (not HuggingFace) |

### Surprises from pre-flight (need Andy review before Sprint 14.1)

1. **Grader is Claude, not Gemini.** Commission text references Gemini throughout — actual grader is `services/claude_grader.py` (Anthropic Haiku 4.5). All cluster sub-sprints reference Claude.
2. **Current prompt is already Cambridge-grounded + word-count-capped.** Items 1 + 2 compress: the prompt skeleton is correct; the work is filling Bands 1–3 + adding the off-topic axis + grammar-checker enrichment, not a ground-up rewrite.
3. **Result-page CSS is already tokenised.** `result.css` uses `var(--av-text-*)` throughout. Light-theme bug is almost certainly in `ds.css` (Sprint 6.5.1 compatibility bridge) or renderer-emitted inline styles. Item 3 spike-first, then surgical fix.

---

## 2. Pre-flight findings summary

Full detail in `commission/sprint_14_0_preflight.md`. Headline table:

| Item | Commission premise | Pre-flight verdict | Net effort |
|---|---|---|---|
| 1 Rubric overhaul | Vague + generous | Partially false — prompt detailed; gaps at Bands 1–3 + off-topic axis | −30 % vs estimate |
| 2 Feedback specificity | Thin qualitative | Output already has 4 per-criterion strings + arrays. Mostly tuning | Folds into 14.4 |
| 3 Light theme broken | Hardcoded colors | False — `result.css` tokenised. Bug elsewhere (`ds.css` likely) | Smaller scope, diagnose-first |
| 4 Length warning | Missing | Upper bound exists; lower bound + per-part missing | As commissioned |
| 5 Off-topic | Missing | Confirmed absent | As commissioned |
| 6 Cue-card detection | Parser wrong | Confirmed — naive `\n` split, no heuristic | As commissioned |
| 7 Playback + reject | Missing | Playback path exists (verify Sprint 14.2); reject confirmed absent both sides | As commissioned |
| 8 Grammar-checker integration | Standby unused | Confirmed; LTBackend ready, Java-on-Railway is the risk | As commissioned + Java risk |

---

## 3. Cambridge rubric reference

Scaffold committed at `data/rubric/cambridge_speaking_descriptors.json`. Structure:

- `_meta` — schema version, copyright note, canonical-source URL, gaps identified
- `descriptors.{fc|lr|gra|p}.{0..9}` — band cell strings (Bands 4–9 paraphrased from production prompt; Bands 0–3 + Pronunciation 1–4 marked `TBD — Sprint 14.4`)
- `aver_extensions` — non-Cambridge axes the product needs (task fulfilment, audio thresholds, short-response caps, grammar-checker enrichment)

**Copyright honesty:** the canonical Cambridge PDF (© British Council / IDP / Cambridge) was fetched during pre-flight but not reproduced verbatim. The scaffold ships paraphrased text from the production prompt — the same source the live grader already uses. Sprint 14.4 commission must pick a long-term sourcing strategy: (a) keep paraphrased (defensible — framework is public, exact text is not); (b) license via Cambridge Assessment English; (c) commission examiner-original descriptors. **Recommendation:** (a) with a one-time legal review, since the production prompt has already shipped this way for months without issue.

---

## 4. Architecture per item

### Item 1 — Rubric overhaul (Sprint 14.4)

**Goal:** sharpen the prompt's Cambridge alignment + fill the gaps pre-flight identified, without disturbing the production output schema (frontend depends on the current `band_fc/lr/gra/p` + `overall_band` + `*_feedback` shape).

**Changes:**

- Read `data/rubric/cambridge_speaking_descriptors.json` at prompt-build time → assemble band descriptor table from JSON instead of hardcoded prose. Single source of truth; tuning band wording is a JSON edit not a prompt rewrite.
- Fill Bands 0–3 cells for all 4 criteria (currently capped at Band 4 minimum) — addresses the false-floor problem where no-attempt answers still get Band 4.
- Add explicit task-fulfilment instruction (still part of FC per Cambridge framework, not the off-topic axis which is item 5).
- Preserve existing speech-rate signal, word-count caps, repeated-error penalty — all in production and working.
- Output schema unchanged. Sentinel test pins the JSON shape so the prompt rewrite can't accidentally break the frontend reader.

**Sentinel pins required:**
- Prompt loads from `data/rubric/cambridge_speaking_descriptors.json` (no inline band strings)
- Output JSON shape unchanged from current contract
- Bands 0–3 cells reachable (i.e. heuristic caps in `_apply_heuristic_caps` permit them)

**LOC estimate:** ~600 (prompt assembly module + tests, output schema unchanged).

### Item 2 — Feedback specificity (folded into Sprint 14.4)

**Pre-flight finding:** output schema is already detailed. `fc_feedback`, `lr_feedback`, `gra_feedback`, `p_feedback` each take 2–4 VN sentences. `strengths[]`, `improvements[]`, `improved_response` are present. Practice mode adds `grammar_issues[]`, `vocabulary_issues[]`, `pronunciation_issues[]`, `corrections[]`, `sample_answer`.

**Sprint 14.4 absorbs item 2:** tighten the prompt's "be specific, name the exact phrase" instructions; require corrections to quote the candidate verbatim (`"original": exact phrase ≤ 15 words`); add evidence-anchored examples per criterion so the model imitates concrete language.

No separate sprint.

### Item 3 — Light theme broken (Sprint 14.1)

**Goal:** diagnose the actual offender + surgical fix. Pre-flight strongly suggests `ds.css` or renderer-emitted inline styles, not `result.css` (which is fully tokenised).

**Sprint 14.1 sketch:**

- **Spike (30 min):** Andy supplies a screenshot of the broken state. Code identifies the offending selector(s) via DevTools or `grep "color:.*#[0-9a-f]"` across `ds.css` + any renderer JS that writes inline `style="..."`.
- **Migration:** swap hardcoded colors to `var(--av-text-*)` / `var(--av-surface-*)` tokens. If the source is renderer JS, refactor to apply CSS classes instead of inline styles.
- **Sentinel pin:** `ds.css` has zero hardcoded hex colors in light-theme-sensitive selectors (use the cluster-13.x format-as-contract pattern — regex-pin on the source file).

**LOC estimate:** ~200 (mostly deletions + token swaps).

### Item 4 — Length warning (Sprint 14.2, shared with item 7)

**Goal:** per-part minimum-duration gate at both layers, with declarative thresholds.

**Backend (`backend/config.py` + `routers/grading.py`):**

```python
MIN_AUDIO_DURATION_PER_PART_SECONDS = {1: 15, 2: 80, 3: 25}
```

In `grading.py` between Whisper STT (line 251) and Claude call (line 301):

```python
min_dur = settings.MIN_AUDIO_DURATION_PER_PART_SECONDS[part]
if duration_sec < min_dur:
    raise HTTPException(
        422,
        detail={
            "error_code": "audio_too_short",
            "part": part,
            "min_seconds": min_dur,
            "actual_seconds": round(duration_sec, 1),
        },
    )
```

Frontend pre-submit gate in `practice.js` recording-recorded sub-state:

```js
if (_elapsedSecs < MIN_DURATION[currentPart]) {
  showRejectBanner(currentPart, _elapsedSecs);
  return;  // do not auto-submit
}
```

Wall-clock `_elapsedSecs` is reliable; Whisper duration is authoritative on the backend. No `audio.duration` read on the raw MediaRecorder blob (browser bug).

**LOC estimate:** ~500 (config + backend guard + frontend gate + reject UI + tests).

### Item 5 — Off-topic detection (Sprint 14.5)

**Goal:** independent Claude judge, binary verdict + reasoning, decoupled from band scoring.

**Service** `backend/services/claude_topic_judge.py` (new, ~150 LOC):

```python
async def judge_on_topic(question: str, transcript: str) -> dict:
    """Returns {on_topic: bool, confidence: 'high'|'medium'|'low',
                reasoning: 'string in Vietnamese'}."""
```

Prompt: short, examiner-framed, JSON-only output, Haiku 4.5 model.

**Wire-in** at `grading.py` AFTER Claude grading (parallel optional — judge is fast enough sequential):

```python
topic_judgement = await claude_topic_judge.judge_on_topic(
    question=question_text, transcript=transcript,
)
response_row["topic_judgement"] = topic_judgement
```

**UI** on `result.html`: when `on_topic == False AND confidence != 'low'`, render a yellow banner with the reasoning. **Do not** modify band scores — Phase A keeps scoring independent (per Andy lock D5 + commission falsification #5 "judge conflict with rubric").

**Schema migration** if `responses.topic_judgement` JSONB column doesn't exist: migration 073 adds it. (Pre-flight didn't verify schema — Sprint 14.5 commission should re-check.)

**LOC estimate:** ~500 (service + integration + UI + migration + tests).

### Item 6 — Cue-card detection + toggle (Sprint 14.3)

**Goal:** auto-detect Cambridge cue-card shape in pasted text; user can override via radio toggle. Single source of truth — both parser sites (`speaking.html:1505` + `:1707`) refactored to use the same helper.

**Heuristic** (`frontend/js/custom-question-parser.js`, new ~80 LOC):

```js
export function detectQuestionShape(raw) {
  const firstLine = raw.split('\n', 1)[0].trim();
  const looksLikeCueCardHeader =
    /(?:^|\s)(?:describe|tell\s+me\s+about|talk\s+about)\b/i.test(firstLine);
  const hasYouShouldSay = /you\s+should\s+say/i.test(raw);
  const hasBullets = /^\s*[•\-\*]/m.test(raw);
  if (looksLikeCueCardHeader && (hasYouShouldSay || hasBullets)) {
    return 'cue_card';
  }
  return 'single_questions';
}

export function parseAsCueCard(raw) {
  // Returns { topic: firstLine, bullets: [...] }
}
```

**UI** (both `speaking.html` modal + practice tab):

- Radio: "Single questions" (default when uncertain) vs "Cue card (Part 2)"
- Heuristic pre-selects based on `detectQuestionShape()`
- When "Cue card" is selected, posts to `/sessions/{id}/questions/custom` with body `{type: 'cue_card', topic: '...', bullets: [...]}` instead of `{questions: [...]}`

**Backend** accepts the new shape, stores as a single question row with `cue_card_bullets` populated (matches existing pre-defined cue-card flow at `practice.js:238`).

**LOC estimate:** ~400 (parser + UI + backend body schema + tests).

### Item 7 — Playback + hard reject (Sprint 14.2, shared with item 4)

**Goal:** post-record audio playback always present; hard reject when length below D1 threshold.

**Playback:** Sprint 14.2 starts by verifying the current `practice.js:911` playback path runs on every recorded path (Part 1 / 2 / 3 / Full Test). If gaps, add a uniform "Play recording" affordance in the `recorded` sub-state.

**Reject UX:** shared component with item 4. When backend returns `422 {error_code: "audio_too_short", ...}` OR frontend pre-submit gate fires:

- Replace Submit button with two CTAs: "Ghi lại" (re-record) + "Bỏ qua câu này" (skip — Part 1/3 only; not allowed for Part 2)
- Render banner: "Phần {part} yêu cầu tối thiểu {min}s. Bạn vừa ghi {actual}s."
- Keep audio file in Supabase storage (for analytics); flag the response row `audio_rejected_reason: "too_short"` if user opts to skip.

**LOC estimate:** included in item 4's 500 LOC.

### Item 8 — Grammar-checker integration (Sprint 14.6)

**Goal:** enrich `grammar_issues[]` with mechanical LanguageTool + local-rule hits. No band-score coupling (Andy lock D4 Phase A).

**Risk:** Java on Railway. Pre-flight identifies three options:

1. **Same-container Java install** — modify Dockerfile to add `default-jdk`. ~250 MB image growth, ~2–4 s cold-start JVM. Simplest.
2. **Sidecar grammar-check worker** — separate Railway service exposes `/check` HTTP endpoint. Isolates JVM. ~1 extra deploy unit.
3. **LanguageTool Public API** — no Java needed, but rate-limited (20/min unauthenticated, 80/min authenticated). Risk for production traffic.

**Recommendation for Sprint 14.6 commission:** start with option 1 (simplest), measure cold-start + per-request latency in production logs for 1 week, escalate to option 2 if memory or cold-start hurts. Option 3 is a defensible fallback if Java install fails on Railway image.

**Integration point** in `grading.py` between STT (line 251) and Claude grading (line 301):

```python
checker_hits = await grammar_check_service.check(transcript)
# checker_hits is list of {rule_id, category, vi_tip, en_tip, suggestion}
```

After Claude returns, merge into the response:

```python
grading["grammar_issues"] = enrich(grading["grammar_issues"], checker_hits)
```

**Merge strategy:** keep Claude's narrative items (mostly about patterns), append checker hits as concrete rule-anchored items with `vi_tip` mapped to the grammar mindmap topic. Deduplicate if a Claude item already covers the same rule.

**LOC estimate:** ~700 (Dockerfile + service wrapper + integration + merge logic + tests).

---

## 5. Sprint roadmap 14.0 → 14.7

| Sprint | Scope | LOC est | Dependencies | Notes |
|---|---|---|---|---|
| **14.0** | Discovery (this sprint) | ~600 (docs) | None | Lock architecture; doc-only |
| **14.1** | Item 3 light theme diagnose + fix | ~200 | None | Quick win; unblocks dogfood |
| **14.2** | Items 4 + 7 length gate + playback | ~600 | None | Foundation for items 4/5/6 caring about length |
| **14.3** | Item 6 cue-card detection + toggle | ~400 | None | Independent; ship parallel-safe |
| **14.4** | Items 1 + 2 rubric + feedback overhaul | ~600 | None (output schema unchanged) | Biggest quality lever |
| **14.5** | Item 5 off-topic Claude judge | ~500 | 14.4 (slot judge after rubric reads stable) | New JSONB column; migration 073 |
| **14.6** | Item 8 grammar-checker enrichment | ~700 | 14.4 (knows the `grammar_issues[]` schema) | Java-on-Railway decision in commission |
| **14.7** | Cluster closure retrospective + Codex audit prep | ~200 | All above | Pattern dividends, falsifications log, PHASE_CLOSURE_LEDGER cross-ref |

**Total cluster:** 8 sprints, ~3 800 LOC + tests + sentinels. Down from the commission's 3 500–4 000 LOC estimate after pre-flight compressed items 1+2 and item 3.

**Cluster duration:** ~6–8 working days at the cluster-13.x cadence (1 implementation sprint per day, 1 day for closure + audit).

---

## 6. Risks + falsifications anticipated

Carried forward from commission + sharpened by pre-flight:

1. **Cambridge descriptor copyright.** Long-term sourcing strategy unresolved. Sprint 14.4 commission must pick paraphrased / licensed / examiner-original. **Mitigation:** scaffold ships paraphrased text already in production use; no immediate licensing emergency.

2. **MediaRecorder duration unreliable.** Confirmed in pre-flight reading practice.js. Frontend uses wall-clock `_elapsedSecs`; backend uses Whisper `duration_seconds`. Neither path touches `audio.duration` on the raw blob. **Mitigation already in architecture.**

3. **Java on Railway unknown.** Sprint 14.6 risk. **Mitigation:** three-option ladder (single container → sidecar → Public API).

4. **Cue-card heuristic overfit Cambridge format.** Non-Cambridge cue cards (e.g. 2024+ rewordings) may not match `describe…you should say`. **Mitigation:** radio toggle is always available; heuristic is preselection, not gate.

5. **Off-topic LLM judge may conflict with rubric judge.** Same Claude could grade "low FC fluent off-topic answer" as Band 6 while the topic judge flags off-topic. **Resolution rule:** judge is informational only in Phase A; banner on result page, no score change. Phase B may couple after dogfood signal.

6. **Light-theme fix may be partial.** Sprint 14.1 might find the bug in renderer-emitted inline styles, not `ds.css`. **Mitigation:** spike-first 30 min before scoping the fix.

7. **Per-Q vs per-Part recording mismatch.** Pre-flight confirms Parts 1 / 3 record per question, Part 2 records once for the whole cue card. Andy's D1 thresholds map cleanly. **No mitigation needed — pre-flight closed this falsification.**

8. **Backward-compat for pre-cluster graded responses.** Old responses won't have the new fields (topic_judgement, etc.). Frontend reader must tolerate `undefined` on every new field. **Mitigation:** sentinel test pins defensive reads, mirroring the cluster-13.x pattern (Sprint 13.6.1 `res.full.signed_url` lesson).

---

## 7. Phase B deferrals (explicit)

| Item | Trigger to un-defer |
|---|---|
| Grammar Mindmap UI (original cluster 14.x plan) | Andy approval after Speaking grading cluster ships; OR student request signal |
| Pronunciation acoustic-model overhaul | Azure Pronunciation Assessment proves insufficient via dogfood evidence; OR student complaint signal |
| Off-topic judge → score coupling | After Sprint 14.5 ships + 2 weeks dogfood; if false-positive rate ≤ 5 %, propose coupling |
| Grammar-checker → band weight coupling (Andy lock D4 Phase B) | After Sprint 14.6 ships + 2 weeks dogfood; if checker hits correlate with Claude GRA drops, propose weight tuning |
| Cambridge descriptor canonical sourcing | If legal review flags paraphrased text as risk; OR Sprint 14.4 commission decides to upgrade |
| Multi-language nhận xét (VN/EN toggle) | Andy request — currently VN only is correct |
| Backfill old graded responses with new fields | If analytics requires uniform schema across history; default forward-only |

---

## 8. Pattern dividends

### Re-applied from cluster 13.x (P0 patterns)

1. **Discovery-first** — this sprint embodies. Cluster 13.x's Sprint 13.0 set the template.
2. **Empirical pre-flight** — PF1–PF7 verified-before-scope. Sprint 13.5.9.1 lesson re-applied (commission premise was partially false; pre-flight saved 30 % of est. LOC).
3. **Format-as-contract** — rubric JSON, length-threshold config, custom-Q body schema all named in this discovery.
4. **Schema-as-contract** — Claude output schema preserved through item 1+2 rewrite; sentinel pins planned.
5. **Truthful provenance contracts (Sprint 13.6.3 pattern #17)** — cue-card flag explicit (`type: 'cue_card'`), not inferred from FK shape; rubric `_source_note` documents paraphrased-vs-canonical truth.
6. **Defensive read at frontend** (Sprint 13.6.1 lesson) — every new field on the response must have a frontend fallback for old data.

### Anticipated new patterns (formalise at Sprint 14.7 closure)

- **Rubric-as-data** — descriptors live in JSON; prompt assembles at build time. Tuning is a JSON edit, not a code change.
- **Declarative length gate per part** — config dict in `backend/config.py`, mirrored in a frontend constants module; both layers enforce.
- **Auto-detect + override toggle** — heuristic guesses, user confirms. Generalises the cue-card pattern to any "could be A or B" parser.
- **LLM judge separation** — independent Claude call for binary judgement, decoupled from scoring. Auditable (judge response stored separately), tunable (Phase B coupling).
- **Asset-as-service** — `assets/grammar-mindmap/grammar_checker.py` was a CLI tool; cluster 14.6 wraps it as a backend service without touching the asset code (preserves the standalone tool).

---

## 9. Sprint 14.0 acceptance criteria check

- [x] `commission/sprint_14_0_preflight.md` produced with PF1–PF7 empirical findings
- [x] Cambridge descriptors JSON committed at `data/rubric/cambridge_speaking_descriptors.json` (scaffold; canonical-source sourcing strategy flagged for Sprint 14.4)
- [x] `docs/clusters/14_x/discovery.md` (this file) with all 8 architecture sections
- [x] Sprint roadmap 14.0 → 14.7 with LOC estimates + dependencies
- [x] ≥ 5 falsifications anticipated (8 documented)
- [x] Phase B deferrals listed explicit
- [x] Pattern dividends section (6 re-applied + 5 new)
- [x] Zero code changes outside `commission/`, `docs/clusters/14_x/`, `data/rubric/`
- [ ] Andy review checkpoint — pending

---

## 10. Open questions for Andy (resolve before Sprint 14.1 commission)

1. **Item 7 per-Q vs per-Part recording** — pre-flight confirms Parts 1/3 are per-question, Part 2 is per-part single shot. D1 thresholds map cleanly. **No Andy decision needed; pre-flight closed.** _Status: ANSWERED by pre-flight._

2. **Item 6 toggle default when heuristic uncertain** — recommend default `single_questions` (safer; more questions ≠ blocker). Andy confirm?

3. **Item 1 backward-compat for old graded responses** — recommend grandfather as-is, new rubric applies forward only. No DB migration of historical bands. Andy confirm?

4. **Item 8 Java-on-Railway cost** — three-option ladder above (in-container / sidecar / Public API). Start at option 1 + monitor. Andy confirm or override?

5. **Item 1 Cambridge canonical sourcing** — three options (paraphrased / licensed / examiner-original). Recommend (a) paraphrased + one-time legal review. Andy confirm or pick differently?

6. **Surprise #1 (Gemini → Claude correction)** — confirms cluster cost assumptions don't change (Claude Haiku 4.5 already in prod). Andy aware?

---

## 11. References

- Cambridge IELTS Speaking Band Descriptors (canonical, copyright): https://ielts.org/cdn/ielts-guides/ielts-speaking-band-descriptors.pdf
- Cluster 13.x closure: `docs/sprint-13-6-cluster-closure-retrospective.md`
- Pre-flight: `commission/sprint_14_0_preflight.md`
- Rubric scaffold: `data/rubric/cambridge_speaking_descriptors.json`
- Production grader: `backend/services/claude_grader.py`
- Grading endpoint: `backend/routers/grading.py`
- Custom-Q parser bug sites: `frontend/pages/speaking.html:1505-1508` + `:1707-1708`
- Grammar checker asset: `assets/grammar-mindmap/grammar_checker.py`

---

**End Sprint 14.0 Discovery.**

---

## Cluster Closure Reconciliation (Sprint 14.9, 2026-05-24)

Appended at cluster closure to resolve Codex audit finding F6 (the discovery
roadmap contradicts what actually shipped). The §5 roadmap (14.0 → 14.7, "7
implementation sprints + 1 closure ≈ 8 PRs") was an *estimate*; the cluster
actually shipped **16 merged PRs across 17 sprints** (incl. this closure).

**Planned vs actual — what moved:**

- §4 mapped items to *planned* sprint numbers that differ from the *shipped*
  numbers: off-topic was planned 14.5 but shipped **14.7** (#267); cue-card was
  planned 14.3 but shipped **14.4** (#263) + the 14.6.x hotfix series;
  grammar-checker was planned 14.6 but shipped **14.8** (#268).
- The original roadmap had no 14.6.1–14.6.5 hotfix series (5 follow-ups: light-
  theme JS render, part-driven routing, cue-card endpoint, Part 2 input UX,
  light-theme Phase B panels + band consistency).
- 14.7 and 14.8 were feature sprints, **not** the closure (14.7 was mis-framed as
  closure in the early roadmap).
- 14.5.1 (deferred result-page completeness) shipped after a Sprint 14.5
  strategic deferral.
- A mid-cluster Codex audit added 14.8.1 + 14.8.2 (P0/P1) and this 14.9 closure
  (P2/P3 + artifacts).

**Lesson:** define the closure sprint up front in discovery, don't bolt it on
post-feature-ship. Full sprint-by-sprint accounting, the verified PR table, the
Codex F1–F7 resolution, and Pattern #42 live in `retrospective.md`; deferred
items in `phase_b_backlog.md`; the canonical closure row in
`PHASE_CLOSURE_LEDGER.md` (backend-cluster cross-reference table).

