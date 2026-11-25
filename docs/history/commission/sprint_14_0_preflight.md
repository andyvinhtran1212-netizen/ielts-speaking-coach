# Sprint 14.0 — Pre-flight findings

**Sprint:** 14.0 Speaking Grading Enhancement Discovery
**Branch:** `feature/sprint-14-0-speaking-grading-discovery`
**Mode:** Read-only inventory. Zero production code touched.
**Date:** 2026-05-22

This document captures the empirical state of every surface the
Sprint 14.0 commission proposed to fix, read directly from the
codebase rather than assumed. Each section names the file + line
range inspected and contrasts the commission's premise with what
the code actually does. **Surprises are flagged** because they shift
Sprint 14.x sequencing.

---

## PF1 — Current rubric prompt (P0 — anchors entire cluster)

### Surface inspected

- `backend/services/claude_grader.py` (1159 LOC)
- `backend/routers/grading.py` (852 LOC)

### Verbatim state

**Surprise #1 — grader is Claude, not Gemini.** The commission's
PF1 brief says "Current system prompt sent to Gemini". The actual
service is `services/claude_grader.py`, model
`claude-haiku-4-5-20251001` (Anthropic). Gemini lives separately
in `services/gemini.py` + `services/gemini_writing_grader.py` for
writing grading and image generation. The commission's mention of
"Gemini" likely came from the original Sprint 14.x roadmap which
predated the Sprint 11/12-era Claude migration.

**Implication:** every commission item that says "Gemini judge"
should read "Claude judge". Cost/latency assumptions need
re-checking against Anthropic's Haiku 4.5 pricing (already in
production, no operational change). Off-topic LLM judge (item 5)
becomes a Claude call, not a Gemini call.

**Two distinct system prompts exist** in `claude_grader.py`:

- `SYSTEM_PROMPT` (lines 43–182) — formal-exam mode. Returns 4
  whole-integer bands (FC, LR, GRA, P), overall band as half-step
  mean, 4 feedback strings, `strengths[]`, `improvements[]`,
  `improved_response`. References "official Cambridge/British
  Council IELTS Speaking Band Descriptors" by name.
- `SYSTEM_PROMPT_PRACTICE` (lines 189–278) — coaching mode. Returns
  `grammar_issues[]`, `vocabulary_issues[]`,
  `pronunciation_issues[]`, `corrections[]`, `strengths[]`,
  `sample_answer`, single `overall_band` (no per-criterion bands).

The router (`grading.py:301`) picks one based on `session_mode`
(`practice` vs anything else).

**Surprise #2 — current prompt already encodes Cambridge framework
+ duration signals + word-count caps.** Andy's report (rubric vague
+ generous + length-blind) is partially false. The current prompt
ships:

- Per-criterion band 4–9 descriptors paraphrased from Cambridge
  (lines 55–102), spanning all 4 criteria
- A SPEECH RATE SIGNAL table mapping `duration_seconds + word_count
  → words/sec → likely-band-range` (lines 62–69)
- Hard per-part word-count caps (lines 118–125):
  - Part 1 <15w: FC cap Band 3 | 15–39w: cap Band 5
  - Part 2 <40w: FC cap Band 3 | 40–99w: cap Band 5
  - Part 3 <20w: FC cap Band 4 | 20–49w: cap Band 5
  - Very short responses also cap LR + GRA at Band 5
- Repeated-error penalty (line 128): same pattern 2+ times → GRA −1
- Bilingual output (feedback strings in VN, `improved_response`
  in EN — already meets Andy's locale requirement)

`grading.py:313` also calls `_apply_heuristic_caps(grading,
word_count, part)` as a **post-grading safety net** in case the
LLM ignores the prompt-level caps. Hard penalties land in code,
not just prose.

**True gaps** (not addressed by current prompt):

- No explicit **off-topic check** — prompt grades the answer as
  given, doesn't ask "does this address the question". A
  high-fluency confidently off-topic answer would clear the FC
  caps and score reasonably.
- No **hard reject** for too-short audio — every response is
  graded, even a 3-second "I don't know". Word-count caps protect
  the score but the user still sees a "Band 3 result" rather than
  "please re-record".
- No **grammar-checker enrichment** — `claude_grader.py` does not
  import or call `assets/grammar-mindmap/grammar_checker.py`. The
  prompt mentions grammar in prose; mechanical rule firings (e.g.
  LanguageTool catches) are not folded in.
- **Speech-rate signal depends on Whisper duration.** `grading.py
  :251` reads `stt.get("duration_seconds", 0.0)` — if Whisper
  doesn't populate it, `duration_sec` is 0.0 and the prompt's
  speech-rate table degrades silently. (Pre-flight confirmed via
  prompt line 69: "If duration_seconds is unavailable, assess FC
  from transcript patterns only.")

### Gap vs Cambridge descriptors

The current prompt covers Bands 4–9 for each criterion, with one
sentence per band. The official Cambridge descriptors (4 pages,
public PDF) ship Bands 1–9 with multi-clause per-cell text and
explicit "non-task-related" / "no rateable language" qualifiers
at Bands 0–2. Gap analysis:

- **Bands 1–3 missing from prompt.** A non-attempting candidate
  is bucketed at Band 4 minimum. Reality: Cambridge defines a
  Band 0 ("did not attend") and Band 1 ("no communication
  possible") explicitly.
- **No "task fulfilment" axis.** Cambridge FC includes "topic
  development" but does NOT include "answers the question". The
  Sprint 14.x off-topic detection (item 5) is therefore an
  Aver-specific addition outside the Cambridge framework — Andy
  should be aware this is a product opinion, not a Cambridge
  conformance gap.
- **Pronunciation is the weakest cell.** Current Bands 7–9 for
  pronunciation are paraphrased; Bands 1–4 are not represented at
  all. Sprint 14.x deliberately defers acoustic-model overhaul to
  Phase B (per commission), so this gap stays.

Canonical PDF source: `https://ielts.org/cdn/ielts-guides/ielts-
speaking-band-descriptors.pdf` (89 KB, 4 pages, © British Council
/ IDP / Cambridge). Verbatim reproduction is copyright-restricted;
the Sprint 14.0 JSON scaffold uses paraphrased descriptors from
the production prompt and flags canonical-text sourcing as a
Sprint 14.4 licensed-channel TBD.

---

## PF2 — Results page light theme (P0)

### Surface inspected

- `frontend/pages/result.html` (1111 LOC)
- `frontend/css/result.css` (483 LOC)
- `frontend/css/aver-design/tokens.css` (theme tokens)
- `frontend/css/ds.css` (Sprint 6.5.1 compatibility bridge)

### Empirical state

**Surprise #3 — `result.css` is already on aver-design tokens.**
Spot-checked lines 54, 65, 72, 73, 125, 126, 139, 152, 161, 167:
every color rule uses `var(--av-text-*)`. The CSS header explicitly
documents the four-tier text token discipline (primary / secondary
/ muted / faint) and asserts "tokens.css resolves them per theme".

`html[data-theme="light"]` and `html[data-theme="dark"]` are
resolved at the document level; `result.css` itself is
theme-agnostic.

**So why does light theme look broken?** Pre-flight hypothesis
(not yet verified visually by Code — Andy screenshot would
confirm):

- The `ds.css` Sprint 6.5.1 compatibility bridge still emits
  `.ds-band-*` / `.ds-crit*` / `.ds-cue-*` classes for renderer
  output on `practice.html` + `result.html` (per `CLAUDE.md`
  cumulative metrics line: "ds.css preserved — renderer-emitted
  .ds-band-* / .ds-crit* / .ds-cue-* on practice.html +
  result.html"). If any `.ds-band-*` class hardcodes a light-mode
  color expecting a white background, it'll go invisible against
  the aver-design `--av-surface-card` in light theme.
- **OR** a renderer JS path injects inline `style="color:..."`
  with literal hex values that bypass the token system entirely.

**Sprint 14.1 verification step:** Code reads `ds.css` + the
renderer JS that emits `.ds-*` classes; locates the offending
selector(s); migrates to tokens. Estimate: ~200 LOC, mostly
deletions + token swaps.

---

## PF3 — Custom-Q parser Part 2 (P0 — cue card detection)

### Surface inspected

- `frontend/pages/speaking.html` (custom-Q UI + parser, inline)
- `frontend/js/practice.js` (cue-card rendering)

### Verbatim bug location

Two parser sites, **byte-identical logic**, both in
`frontend/pages/speaking.html`:

1. Topic modal "Custom Questions" tab (lines 1505–1508):
   ```js
   var questions = raw.split('\n')
     .map(function (l) { return l.trim(); })
     .filter(function (l) { return l.length > 0; })
     .slice(0, 10);
   ```

2. Practice tab "Custom Q" path (lines 1707–1708, condensed):
   ```js
   var questions = raw.split('\n').map(...).filter(...).slice(0, 10);
   ```

Each non-empty line becomes a separate question. A Cambridge cue
card pasted whole:

```
Describe a person who has influenced you.
You should say:
• who this person is
• how you know them
• what they have done
and explain why they have influenced you.
```

→ split → 6 lines → 6 separate questions → frontend treats as
six independent Part 1 / Part 3 questions. The Part 2 cue-card
flow in `practice.js:238` only activates when the question object
has a `cue_card_bullets` array; the custom-Q path never creates
that array.

**No cue-card detection anywhere in the path.** No regex sniff
for "describe…you should say:" or bullet markers (• * -).

### Backend reception

Backend endpoint: `POST /sessions/{id}/questions/custom` (called
at `speaking.html:1715`). Need to inspect this in Sprint 14.3
to confirm body schema accepts only `questions: string[]` (no
type-tag field) — if so, adding cue-card detection requires
schema extension on both sides.

### Recommended Sprint 14.3 approach (per Andy lock D3)

Heuristic regex + user override toggle:

```js
// Sniff cue-card shape:
//   contains "describe", "tell me about", or "talk about" near top
//   AND contains bullets (•/-/*) OR "you should say"
const looksLikeCueCard =
  /(?:describe|tell\s+me\s+about|talk\s+about)/i.test(firstLine) &&
  (/(?:you\s+should\s+say)/i.test(raw) ||
   /^\s*[•\-\*]/m.test(raw));
```

UI: radio toggle "Single questions ⟷ Cue card" auto-set by
heuristic, user can override. Default to Single when heuristic
is uncertain (commission Q2).

---

## PF4 — Recording flow (P0 — audio playback + length gate)

### Surface inspected

- `frontend/js/practice.js` (1900+ LOC, MediaRecorder logic)
- `backend/routers/grading.py:276` (duration guard)
- `backend/config.py` (MAX_AUDIO_DURATION_SECONDS)

### Empirical state

**Recording timer** — `practice.js:48` `var _elapsedSecs = 0`,
incremented every 1s while recording (line 370). Hard-stop at
`maxSec` per part (`practice.js:373` → `stopRecording()`). This
is the elapsed-time counter that drives the on-screen timer.

**Playback after record** — `practice.js:911` shows an existing
`audio.play()` path but inspection of context-around-911 is
needed (Sprint 14.2). Listening review of recording before submit
is likely partial: the file's `_recorder.onstop` flow (line 349)
goes straight into the "recorded" sub-state, and submit-or-redo
decision happens there. No empirical confirmation of "post-record
playback affordance always present".

**Backend length enforcement**:

- `grading.py:278-283` — **upper bound only**:
  ```python
  max_dur = settings.MAX_AUDIO_DURATION_SECONDS
  if duration_sec > max_dur:
      raise HTTPException(422, f"Audio quá dài ({duration_sec:.0f}s). Giới hạn là {max_dur}s.")
  ```
- `grading.py:285-289` — empty-transcript guard:
  ```python
  if not transcript:
      raise HTTPException(422, "Không nhận dạng được giọng nói...")
  ```
- **No minimum-duration guard.** A 3-second "uh, I don't know"
  passes through to Claude grading.

**MediaRecorder duration risk (commission falsification #2):**
MediaRecorder's recorded blob does not carry a reliable `duration`
metadata header in all browsers (Chrome <115, Safari). The frontend
`_elapsedSecs` counter is reliable (wall-clock); Whisper's
`duration_seconds` (used by the backend gate at `grading.py:251`)
is reliable. Backend can trust Whisper duration, frontend can
trust `_elapsedSecs` — no `audio.duration` read on the raw blob
required.

### Sprint 14.2 hard-reject gate (per Andy lock D1)

Per Andy's D1 lock:

- Part 1: <15s/Q → reject
- Part 2: <80s → reject (1m 20s = 80s)
- Part 3: <25s/Q → reject

Two enforcement layers needed:

1. **Frontend pre-submit** (`practice.js` recording-recorded
   sub-state): if `_elapsedSecs < threshold[part]`, disable
   Submit button + show "Quá ngắn cho Part N — yêu cầu ≥Xs.
   Ghi lại?" with a "Record again" CTA.
2. **Backend authoritative** (`grading.py`, before Claude call):
   if `duration_sec < threshold[part]`, return 422 with body
   `{error_code: "audio_too_short", part, min_seconds,
   actual_seconds}` so frontend can render the same UX as the
   pre-submit gate.

Length thresholds belong in `backend/config.py` (declarative) +
mirrored in a frontend constants module for the UX gate.

### Open question on per-Q vs per-Part recording

Pre-flight confirms `practice.js` records **per question** for
Parts 1 and 3 (the standard flow: question → record → submit →
next question). Part 2 records **once** for the entire cue-card
monologue. The Andy D1 thresholds apply cleanly: per-Q for
Parts 1/3, single-shot for Part 2.

---

## PF5 — Grammar checker asset readiness (P1 — integration prep)

### Surface inspected

- `assets/grammar-mindmap/grammar_checker.py` (872 LOC)
- `assets/grammar-mindmap/grammar_data.py` (850 LOC)
- `assets/grammar-mindmap/requirements.txt`
- `assets/grammar-mindmap/README.md`

### API surface

`grammar_checker.py` exposes:

- **CLI** entrypoint: `python grammar_checker.py "sentence"` →
  prints bilingual ANSI-coloured report
- **GUI** entrypoint: `--gui` Tkinter window
- **`LTBackend` class** (line 68) — `__init__(prefer_offline=True,
  language='en-US')`, `.check(text) -> List[Dict[str, Any]]`
- **Two-layer architecture** (per README §3): ~25 local regex
  rules for Vietnamese-learner-common errors → LanguageTool
  (offline `language_tool_python` or Public-API online fallback)
- **`find_tip_for_rule(rule_id)`** from `grammar_data.py` —
  maps LanguageTool rule ID to mindmap grammar topic + bilingual
  explanation
- **Chained correction** — re-runs until no errors remain

### Dependencies

- **Python 3.8+** ✓ (already prod)
- **`language_tool_python`** — Python wrapper, ~250 MB JAR
  download on first run
- **Java 8+** for the offline LanguageTool JAR. Railway: needs
  verification. Without Java, the script auto-falls-back to the
  LanguageTool Public API (Internet-dependent, rate-limited at
  20 req/min for unauthenticated, 80 req/min for authenticated)

### Latency expectations

- **Offline mode**: 100–500 ms per check on Mac (M-series).
  Railway containers vary; cold-start of JVM ≈ 2–4 s. Need
  pre-warm or async strategy.
- **Online mode (Public API)**: 300–800 ms + rate-limit risk.

### Error taxonomy returned (`grammar_checker.py:90` → dict shape)

Each `.check()` result entry: `{rule_id, category, message,
offset, length, suggestions, context}`. The `find_tip_for_rule`
adapter wraps this with `{grammar_topic, vi_tip, en_tip}` for
mindmap mapping. This taxonomy maps cleanly into the Claude
`grammar_issues[]` output schema (commission item 8).

### Sprint 14.6 integration sketch

```
POST /sessions/{id}/responses (grading.py)
  → Whisper STT
  → [NEW] grammar_checker.check(transcript)   ← parallel to Claude
  → Claude grader (claude_grader.py)
  → [NEW] enrich grading["grammar_issues"] with checker hits
  → return enriched response
```

**Decision points for Sprint 14.6 commission:**

- Java on Railway: dedicated Dockerfile step OR a sidecar worker?
- Pre-warm strategy: keep one `LTBackend` instance per FastAPI
  worker, or lazy-init per request?
- Latency budget: 500–800 ms added to grading roundtrip is
  probably acceptable (Claude grading already runs 4–8 s).
- Phase A (per Andy lock D4): enrich nhận xét, no score touch.

---

## PF6 — Off-topic baseline (P1)

### Empirical state

No off-topic detection in the current pipeline. The prompt
(`claude_grader.py:43+`) does not include any "address the
question" instruction. The closest signal is the strengths /
improvements text where a candidate might mention "off-topic"
in natural-language feedback — not machine-readable.

**Sample false-positive risk:** a confident, fluent, vocabulary-
rich answer that completely misses the question would clear the
word-count caps and likely score Band 6+. No production examples
captured by Code in pre-flight; Andy should supply 2-3 dogfood
transcripts during Sprint 14.5 to calibrate the judge.

### Sprint 14.5 sketch (per Andy lock D5 — Claude judge binary + reasoning)

Independent Claude call (Haiku for cost, ~1 s):

- System: "You are an IELTS examiner. Given a question and a
  candidate transcript, return JSON `{on_topic: bool,
  confidence: 'high'|'medium'|'low', reasoning: 'string in VN'}`"
- Coupled to scoring how? Per commission: **independent of
  scoring** (auditability). If `on_topic=false high-confidence`,
  display a banner on the result page; do NOT auto-cap bands.
  Tunable Phase B.

---

## PF7 — Audio length thresholds calibration (P1)

### Empirical state

- Pipeline knows `part` (passed as `part: int` to
  `grading.grade_response()`; sessions persist `part` per record)
- Pipeline knows `duration_sec` (from Whisper STT response)
- Pipeline knows `word_count` (computed at `grading.py:298`)

All inputs required for Andy's D1 thresholds are already present.
Implementation is purely additive — add `MIN_DURATION_PER_PART`
config dict + 422 guard before Claude call.

**Open question for Sprint 14.2 commission:** When a user submits
audio that fails the duration gate, do we keep the audio file in
storage (cost) or delete it (cleaner)? Recommend keep + flag the
session row `audio_rejected_reason = "too_short"` for analytics.

---

## Summary table

| Item | Commission premise | Pre-flight verdict | Effort impact |
|---|---|---|---|
| 1 — Rubric overhaul | "Rubric vague, generous" | Partially false — prompt is detailed + Cambridge-grounded + word-count capped. True gap: Bands 1–3, off-topic axis, mechanical grammar enrichment | -30% LOC vs commission estimate |
| 2 — Feedback specificity | "Qualitative thin" | Output already has 4 per-criterion strings + strengths/improvements + improved_response | Mostly prompt tweaks + Cambridge alignment |
| 3 — Light theme broken | "Hardcoded colors" | False — `result.css` is fully tokenised. Debt is likely in `ds.css` legacy bridge OR renderer-emitted inline styles | Investigation Sprint 14.1, scope likely smaller |
| 4 — Length warning | "Missing" | Upper bound exists; lower bound + per-part config missing | As commissioned (~500 LOC) |
| 5 — Off-topic | "Missing" | Confirmed absent. Pattern: independent Claude judge | As commissioned |
| 6 — Cue card detection | "Parser wrong" | Confirmed: 2 sites in `speaking.html` use naive `\n` split, no heuristic | As commissioned |
| 7 — Playback + reject | "Missing" | Playback path exists at `practice.js:911` (needs deeper inspection); reject gate confirmed absent on both sides | As commissioned |
| 8 — Grammar checker integration | "Standby unused" | Confirmed: 1722 LOC asset, no import path from `backend/services/`. LTBackend ready. Java on Railway = decision point | As commissioned, Java risk |

**Net effect on Sprint 14.x roadmap:** items 1+2 may compress
into one sprint (14.4) because the existing prompt skeleton +
output schema absorb most of the lift. Item 3 may compress
because the CSS layer is already token-correct. Items 4–8 land
as commissioned.

---

## Surprises that need Andy review before Sprint 14.1 commission

1. **Grader is Claude, not Gemini.** All cluster docs and prompts
   for Sprint 14.5 (off-topic judge) + Sprint 14.4 (rubric
   overhaul) should reference Claude. Cost/latency assumptions
   are based on Anthropic Haiku 4.5 (already in production).
2. **Cambridge descriptor verbatim text is copyright-restricted.**
   The JSON scaffold ships paraphrased text from the production
   prompt (same source the live grader uses). Canonical text for
   Sprint 14.4's prompt rewrite needs a licensed-channel source
   decision before the rewrite ships. Options: (a) keep using
   paraphrased text indefinitely — defensible because the
   framework is public knowledge even if the exact text is not;
   (b) license via Cambridge Assessment English; (c) hire a
   certified examiner to write Aver-original descriptors.
3. **Result-page bug is probably in `ds.css` or renderer JS, not
   `result.css`.** Sprint 14.1 commission should scope to a
   diagnose-first 30-min spike, then a surgical fix.

---

End of pre-flight inventory.
