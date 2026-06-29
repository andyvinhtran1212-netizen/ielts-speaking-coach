# Research — Multi-Model Writing Grading (cost ↓, quality ↑)

**Status:** Research + design proposal. **No code in this doc.**
**Author:** Claude (Opus 4.8) · **Date:** 2026-06-29
**Scope:** IELTS **Writing** AI grading only. Speaking is out of scope (it
already runs a multi-provider abstraction — see "Prior art" below).

---

## 1. TL;DR / recommendation

Today every Writing essay is graded by **one** Gemini 2.5 Pro call that
produces **all** sections at once (band scores, mistake list, idea/sentence
analysis, vocabulary upgrades, a full Band-8 rewrite). Pro is the most
expensive model we use ($1.25 in / $10.00 out per 1M tokens) and most of its
output tokens go to sections that **do not need a frontier model**.

**Proposal:** split the monolith into a small **router** that sends each
grading sub-task to the *cheapest model that meets its quality bar*, then
merges the parts back into the existing `WritingFeedback` schema. Keep the
**band score + criteria judgment on the strongest model** (that is the
trust-critical, hardest part); move **mechanical extraction and bulk
generation** to cheaper/faster models.

Expected outcome (illustrative, see §5): **~45–60% cost reduction per essay**
at equal-or-better quality, because the band-scoring brain stays frontier-grade
while the token-heavy rewrite/lists move to a model 4–30× cheaper per token.

This is a **design**; numbers must be validated with a calibration harness
(§7) before any rollout. **Do not ship on estimates alone** — grading
truthfulness is a core product promise (CLAUDE.md).

---

## 2. Current architecture (single-model)

- Entry: `services/gemini_writing_grader.py::grade_essay(config)`.
- One model: **Gemini 2.5 Pro** by default (`config.selected_model`), Flash
  available as a per-essay override but with no automatic call-site today.
- One prompt: the composed system prompt (`writing_prompt_loader`, L1–L5
  cumulative sections) + the essay → one JSON response validated against
  `WritingFeedback`.
- Tiers (depth of the *pipeline*, orthogonal to model):
  - **Standard** — 1 call.
  - **Deep** — 3 calls on the same model (grade → refine → sentence rewrite).
  - **Instructor** — Standard/Deep pass + human review queue.
- Pricing in code (`MODEL_PRICING`):
  | Model | $ / 1M in | $ / 1M out |
  |---|---|---|
  | gemini-2.5-pro | 1.25 | 10.00 |
  | gemini-2.5-flash | 0.30 | 2.50 |

**Observation:** output tokens dominate cost (10× input). The biggest output
consumers are `improvedEssay` (a full rewrite), `mistakeAnalysis`,
`sentenceStructureAnalysis`, and `lexicalAnalysis` — exactly the sections that
are *least* dependent on frontier reasoning.

### Prior art already in the repo
`services/grading_providers/` (Sprint 14.3) is a **provider abstraction** used
by **Speaking** grading: one `AbstractGradingProvider` contract with concrete
`gemini.py` and `claude.py` adapters (Claude **Haiku 4.5** + Gemini). So:
- multi-provider plumbing, **Anthropic credentials, and a Claude adapter
  already exist and run in production** — for Speaking.
- The Writing grader pre-dates it and stayed Gemini-only.
This materially de-risks the proposal: we are extending a proven pattern, not
inventing one.

---

## 3. Grading sections by cognitive demand

The `WritingFeedback` schema splits cleanly into three bands of difficulty:

| Tier | Sections | Why | Model class |
|---|---|---|---|
| **A — Judgment (trust-critical)** | `overallBandScore`, `criteriaFeedback` (TR/CC/LR/GRA bands + feedback), `overallBandScoreSummary`, `keyTakeaways` | Holistic IELTS calibration; a wrong band erodes trust instantly. Hardest to get right; smallest token footprint. | **Frontier** (Pro / Sonnet-class) |
| **B — Reasoning** | `ideaDevelopmentAnalysis`, `counterargumentAnalysis`, `coherenceAnalysis` | Argument-quality critique; needs real reasoning but is checkable against the essay. | **Mid** (Sonnet / Pro) |
| **C — Mechanical / generative** | `mistakeAnalysis` (grammar), `lexicalAnalysis` (word upgrades), `sentenceStructureAnalysis` (rewrites), `improvedEssay` (full rewrite), `aiContentAnalysis` | Pattern extraction + fluent generation. High token volume, low judgment. Cheaper models do these well. | **Cheap/fast** (Flash / Haiku) |

Two sections are already (or should be) **deterministic, not LLM**:
- **Word count** — already computed in Python (`_word_count`) and fed to the
  grader. Good precedent: move work out of the LLM when code can do it.
- **`aiContentAnalysis`** — a candidate for a dedicated detector rather than a
  self-reported LLM guess (lower priority).

---

## 4. Proposed routing

A **band-anchor-first** pipeline. The Judgment tier runs first and becomes the
*spec* every other model must stay consistent with (prevents the classic
multi-model failure where the rewrite implies Band 8 but the score says 6).

```
            ┌─────────────────────────────────────────────┐
 essay ───▶ │ PASS A  (frontier)  — Tier A: bands + criteria│ ──┐
            │            + a 1-line per-criterion rationale  │   │ band anchor
            └─────────────────────────────────────────────┘   │ (scores+rationale)
                                                                ▼
        ┌──────────────── fan-out, given the band anchor ───────────────┐
        │ PASS B (mid)   — idea / counterargument / coherence reasoning  │
        │ PASS C (cheap) — mistakes + lexical + sentence + improvedEssay │
        └───────────────────────────────────────────────────────────────┘
                                   │  merge into WritingFeedback
                                   ▼
                       validate → persist (unchanged downstream)
```

- **Pass A** is small output (scores + short rationale) on the dearest model →
  cheap in dollars, high in value. It owns the number students see.
- **Pass B/C** receive the Pass-A band + rationale as *context* and are
  instructed: "grade to THIS band; do not contradict it." Cheap models are
  good at *constrained* generation.
- Passes B and C are **independent** → run concurrently (latency ≈ max, not
  sum).

**Level/tier interplay (already in the codebase):**
- **Pass A always runs, at every level.** The band score, `criteriaFeedback`,
  `keyTakeaways` and `overallBandScoreSummary` are *always-on* required fields
  in `WritingFeedback` — `LEVEL_REQUIRED_FIELDS[1]` is empty only because L1
  adds no *optional* sections, not because L1 skips the score. Skipping Pass A
  for any level would produce a `WritingFeedback` that fails validation /
  omits the band students need. The **level gates only which optional B/C
  subsections are requested**, never the judgment pass.
- So the level dial works like this: **L1** = Pass A + the *mistakes* slice of
  Pass C only; **L3** adds idea-development + sentence-structure; **L5** = all
  optional B/C sections. Low levels are *cheaper* because Pass C/B carry fewer
  optional sections (and some skip Pass B entirely) — **not** because the
  frontier judgment pass is skipped.
- The **Deep tier** maps naturally: Deep = "use the mid/frontier model for
  Pass C too, and add the refine+rewrite passes." Standard = "cheap Pass C."
  So tier becomes a **model-strength dial**, which is more meaningful than
  today's "same model, more passes."

### Model candidates (validate before committing)
| Role | Primary | Cheaper alt | Notes |
|---|---|---|---|
| Pass A (judgment) | **Gemini 3.5 Flash** *or* Gemini 2.5 Pro / Claude Sonnet 4.6 | — | A/B for IELTS band calibration; see "newer Gemini options" below |
| Pass B (reasoning) | Gemini 2.5 Pro / Claude Sonnet 4.6 | Gemini 2.5 Flash | needs argument reasoning |
| Pass C (mechanical) | Gemini 2.5 Flash | Claude Haiku 4.5 / Gemini 2.5 Flash-Lite | Haiku adapter already wired for Speaking |

**Newer Gemini options (live prices, ≤200k context, June 2026).** The grader
defaults to `gemini-2.5-pro` today, but the repo already runs Gemini 3.x
(`gemini-3.1-flash-image-preview` for listening map images), so the SDK +
credentials support 3.x — switching `GEMINI_PRO_MODEL` is enough.

| Model | Status | $ in /1M | $ out /1M | vs 2.5 Pro (output) |
|---|---|---|---|---|
| **Gemini 3.5 Flash** | GA | 1.50 | **9.00** | newer gen, **−10%** — best "better *and* cheaper" bet for Pass A; must pass band-calibration A/B |
| Gemini 3.1 Pro | preview | 2.00 | 12.00 | strongest, **+20%**; preview ⇒ stability/deprecation risk for production grading |
| Gemini 2.5 Pro *(current)* | GA | 1.25 | 10.00 | baseline |
| Gemini 3 Flash | preview | 0.50 | 3.00 | Pass C candidate (preview) |
| Gemini 2.5 Flash | GA | 0.30 | 2.50 | Pass C default |
| Gemini 2.5 Flash-Lite | GA | 0.10 | 0.40 | cheapest; only for the most mechanical slices |

Output dominates cost here, so judge candidates on the **output** column.
`gemini-3.5-flash` is the headline: a later-generation model, **GA**, with
output *cheaper* than 2.5 Pro — if it holds band-agreement ±0.5 vs 2.5 Pro on
the calibration set, it is a strict win for Pass A. `gemini-3.1-pro` is the
max-quality option but preview-only. Quality for *our* IELTS-grading task must
be measured (§6/§7), not assumed from generation number.

**Batch / Flex (≈ −50% cost).** Grading is asynchronous (background job, ETA
shown to the student) — it does **not** need realtime latency. Google's Batch
(and Flex) deployment tiers cut per-token cost by ~50% on these models in
exchange for higher/looser latency. That fits the grading queue well and
**stacks on top of** the multi-model routing savings — a ~50% cut on whichever
models we pick, largely for free. Caveat: Batch latency (minutes) must stay
within the student-facing ETA budget; the instructor-review tier (human in the
loop anyway) is the safest place to adopt it first.

Exact model IDs + live prices must be re-confirmed against the Anthropic/Google
pricing pages and the `claude-api` reference at implementation time — **do not
hardcode from this doc.** Prices above: Gemini API pricing page, June 2026.

---

## 5. Cost model (illustrative — must be measured)

Rough per-essay output-token split today (single Pro call, L4 essay):

| Section group | ~output tokens | Pro cost ($10/1M) |
|---|---|---|
| A — bands/criteria/summary | ~600 | $0.0060 |
| B — idea/counter/coherence | ~1,200 | $0.0120 |
| C — mistakes/lexical/sentence/rewrite | ~3,500 | $0.0350 |
| **Total** | **~5,300** | **~$0.053** |

Same essay, routed (Flash for C @ $2.50/1M, Sonnet-class ~Pro for A/B):

| Group | Model | output cost |
|---|---|---|
| A | Pro | $0.0060 |
| B | Pro/Sonnet | $0.0120 |
| C | Flash | $0.0088 |
| **Total** | | **~$0.027** |

→ **~49% cheaper** on output, driven almost entirely by moving Group C off
Pro. Input tokens add a little duplication (each pass re-sends the essay), but
input is 8–10× cheaper than output and the essay is small (<10k chars), so the
re-send overhead is minor versus the output savings. **These are estimates** —
the calibration harness (§7) produces the real numbers.

The token mix also explains why naively switching the *whole* essay to Flash
is the wrong move: it would cut cost more, but Group A (the band) is exactly
where Flash is weakest and where a miss is most damaging.

---

## 6. Quality safeguards (non-negotiable)

Multi-model introduces a new failure mode: **inter-section inconsistency**.
Mitigations:

1. **Band-anchor-first** (Pass A owns the score; B/C are told to conform).
2. **Cross-consistency check** (cheap, deterministic, post-merge): if the
   `improvedEssay` or sentence rewrites imply a band far from `overallBandScore`,
   or `mistakeAnalysis` count contradicts the GRA band floor (the existing
   `strict_grammar_check` rules), flag + fall back to a single-model re-grade.
3. **Single-model fallback**: any pass failure, schema-validation failure, or
   consistency flag → re-grade that essay with the legacy single-Pro path.
   Cost control must never cost a *failed* grade (CLAUDE.md: no silent
   failures). Mirrors the existing Deep-tier graceful per-pass degradation.
4. **Calibration gate before rollout**: re-grade the pinned calibration set
   (`prompts/writing/v2/calibration/l*_examples.md`) + a sample of real essays
   with both the single-model and multi-model pipelines; require **band
   agreement within ±0.5 on ≥95%** before enabling for real traffic.
5. **Stamp provenance**: extend `prompt_version` / `grading_tier_metadata` to
   record which model produced which section, so a bad section is traceable to
   a model and regressions are debuggable (we already stamp per-version).

---

## 7. Implementation sketch (when greenlit — not now)

- **Reuse** `services/grading_providers/` rather than build new plumbing:
  generalise the Speaking abstraction so Writing can request `(provider,
  model)` per pass.
- Add a thin `WritingGradeRouter` that orchestrates Pass A → parallel(B, C) →
  merge, behind the existing `grade_essay()` signature so callers
  (`essay_service`, instructor flow, regrade) are unchanged.
- Gate the whole thing behind an env flag (`WRITING_GRADER_MODE =
  single|multi`), read **per call** like `WRITING_PROMPT_VERSION` already is,
  so it hot-flips on Railway without redeploy and A/B is trivial.
- **Calibration harness** (build this FIRST): batch-grade N essays both ways,
  diff bands + section presence + cost + latency, emit a report. This is the
  evidence that decides go/no-go — not this document.

---

## 8. Risks & open questions

- **Consistency tax**: if the cross-checks fire too often and force fallbacks,
  the savings evaporate. Needs measurement; tune the band-anchor prompt.
- **Latency**: 3 passes (even with B/C parallel) may exceed a single Pro call's
  wall-clock. Pass A is small/fast; B/C parallel ≈ one Flash call. Likely a
  wash or slightly slower — measure against the current `estimate_eta_seconds`.
- **Provider lock-in / outages**: mixing Google + Anthropic doubles the
  third-party-outage surface. The single-model fallback covers this.
- **Prompt duplication**: each pass needs a trimmed prompt (only its sections).
  More prompt files to keep consistent with `output_schema_instructions.md`.
- **Open**: is Pass A better on Gemini Pro or Claude Sonnet for IELTS band
  calibration? → A/B with the calibration harness; let data decide.
- **Open**: should `aiContentAnalysis` move to a dedicated detector entirely?
  (Separate, lower-priority track.)

---

## 9. Phased rollout

1. **P0 — Harness only.** Build the dual-grade calibration/cost harness. No
   production change. Output: real per-section token + cost + band-agreement
   numbers that confirm or kill the estimates here.
2. **P1 — Pass C off Pro, shadow.** Route only Group C to Flash/Haiku behind
   the env flag, **shadow mode** (compute both, serve single-model, log diff).
   Verify consistency checks + measured savings.
3. **P2 — Multi-model live for Standard tier**, single-model fallback on any
   flag. Watch band-agreement + fallback rate dashboards.
4. **P3 — Map Deep/Instructor tiers** onto the model-strength dial; retire the
   per-essay Flash override in favour of router-managed selection.

**Recommendation:** approve **P0 (harness)** now; treat P1+ as gated on the
harness numbers. The single biggest, safest win is **Group C → cheaper model**;
everything else is incremental.

---

## 10. Findings — measured (P0 → P1-B)

> **Where the code lives:** this file is a findings *record*. The harness and
> the P1-A implementation it describes are **introduced in PR #617**
> (`backend/scripts/calibration_harness.py`, `backend/scripts/multimodel_router.py`,
> and the level-aware default in `config.py` / `services/essay_service.py`) — they
> are NOT part of this docs-only commit. To reproduce the numbers below, check
> out PR #617 (or main once it has merged) and run the harness as shown.

Built and ran the harness (`backend/scripts/calibration_harness.py`, PR #617) on
real essays (`--from-db`, balanced Task 1/Task 2, chart images preserved). Gate =
band agreement within ±0.5 on ≥95%. Reproduce:
`cd backend && GEMINI_API_KEY=… python -m scripts.calibration_harness --from-db 10 --balance-task-type --levels 3,4`.

### P0 — straight model swap (single call, candidate replaces Pro)
gemini-3.5-flash vs gemini-2.5-pro, n=10 balanced, per level:

| | Level 3 | Level 4 |
|---|---|---|
| Band agreement ±0.5 | **100% (10/10)** ✅ | **90% (9/10)** ❌ |
| Cost savings | ~14% | ~21% |
| Latency | 60s→41s | 64s→39s |
| Coverage gaps | 0 | 1 |

- **≤L3 passes the gate** — 3.5 Flash matches Pro's band, cheaper + ~2× faster.
- **L4 sits at ~90%** — one **reproducible** Δ=1.0 essay (`5bda0d71`, failed in
  two independent runs) + an occasional dropped counterargument. Not gate-safe.
- (An earlier L4 run showed 2 coverage gaps; that was a harness bug — it dropped
  the Task 1 chart image, grading those essays text-only. Fixed; numbers above
  are post-fix.)

### P1-A — decided; implemented in PR #617 (not in this commit)
**Decision:** student-submitted essays default to **gemini-3.5-flash at L1–L3**
and **gemini-2.5-pro at L4–L5**. Implemented in **PR #617** via
`WRITING_LEVEL_AWARE_MODEL` (default on; env kill-switch → all Pro) +
`essay_service.default_grading_model(level)`; admin-picked models untouched.
Captures the proven ≤L3 win; keeps Pro where the swap isn't safe. **Status:
merges with PR #617 — not present on `main` (or in this docs-only commit) until
that PR lands.**

### P1-B — NEGATIVE: naive 2-pass routing does not rescue L4
Tested route = **Pro on judgment** (band/criteria/reasoning) + **2.5-flash on
mechanical** (mistakes/lexical/sentence/rewrite), band-anchored, vs single-Pro.
n=6 balanced, L4 (offline only — no production wiring):

| Metric | Single Pro | Routed | |
|---|---|---|---|
| Band agreement ±0.5 | (baseline) | **83% (5/6)** ❌ | **worse than the 90% straight swap** |
| Cost savings | — | 28% | best savings |
| Latency | 64s | **83s** | **slower** (passes are sequential — mechanical needs the anchor) |
| Coverage gaps | — | 1 | judgment pass dropped coherence + idea |

**Why it failed:** trimming the judgment pass's prompt (telling Pro to skip the
mechanical sections to save tokens) **shifts Pro's own band calibration** and
makes it drop reasoning sections — exactly where L4 needs precision. The token
saving on the strong model is bought with a quality regression at the band.

**Conclusion:** stop pursuing naive prompt-split routing for L4. The practical
multi-model win is **P1-A (cheaper model ≤L3); L4–L5 stays on Pro.** A future
L4 routing attempt would have to keep the judgment pass on the *full, unchanged*
prompt (preserving calibration) and only fan out a separate mechanical pass —
but then the strong model saves no tokens, so the cost case is weak. Park it
unless a cheaper *frontier-grade* judgment model (e.g. a future GA Gemini 3.x
Pro/Flash) clears the L4 gate on a straight swap.
