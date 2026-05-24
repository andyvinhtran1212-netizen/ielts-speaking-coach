# Cluster 15.x — DEBT-PRONUNCIATION-ACTIONABLE — Sprint 15.0 Discovery

**Sprint type:** Discovery (analysis only — no feature code)
**Scope:** Direction 1 only — per-phoneme drill-down on weakest words
**Process:** Commission is a hypothesis (Pattern #42); the findings below are code-verified with file:line evidence.

---

## 1. Empirical motivation

Single source signal (Andy, 2026-05-24): the result-page pronunciation panel
shows 5 aggregate numbers (accuracy / fluency / completeness / prosody / overall)
+ a 3-weak-word list. Andy's diagnosis, verbatim:

> "đo lường thiếu hướng dẫn cải thiện"

Gap: measurement is reported, but there's no actionable guidance — the user
can't answer "which phoneme is wrong, and how do I fix it." Azure's
Pronunciation Assessment can return phoneme-level scores, so the hypothesis is
that the pipeline under-utilises them.

---

## 2. Azure pipeline — empirical state (Objective 1, BLOCKING)

**Outcome: (β) — phoneme data is NOT fetched, and NOT persisted, because the SDK
is configured at Word granularity.** The commission's optimistic outcome (α,
"frontend-only ~400 LOC") does not hold.

Evidence:

| What | File:line | Finding |
|---|---|---|
| SDK granularity | `backend/services/azure_pronunciation.py:102` | `"Granularity": "Word"` — Azure returns word-level scores only; **no `Phonemes` array is requested or returned.** |
| Grading scale | `azure_pronunciation.py:101` | `"GradingSystem": "HundredMark"` → all scores are **0–100** (so the "<70%" threshold maps directly). |
| Normalizer | `azure_pronunciation.py:159–174` | Parses `NBest[0].Words[]` → `{word, accuracy_score, error_type, feedback}`. **No phoneme handling** (there's nothing to parse at Word granularity). |
| Persistence | `backend/routers/pronunciation.py:222–237` | Writes scalar scores + `pronunciation_payload = json.dumps({**raw_payload, **extra})` to `responses` via `.update(...)`. The **raw Azure response is stored verbatim.** |
| Storage column | `backend/migrations/004_add_pronunciation_fields.sql` | `pronunciation_payload` (+ scalar pronunciation columns) already exist. |
| Frontend read | `frontend/js/practice.js:2420 _renderPronBlock`, `:2460 _renderFullPronBlock`; `frontend/pages/result.html` `_pronResultHtml`/`_buildPronBlock` | Renders aggregate scores + word badges (`error_type !== 'None'`). No phoneme surface. |

**Key refinement vs the commission's (β):** the commission assumed (β) "needs a
migration FIRST." It does **not** — `pronunciation_payload` already stores the
raw Azure response verbatim, so once granularity is raised to `Phoneme`, the
phoneme arrays land in the existing column automatically. The real blockers are
(1) a one-line granularity change and (2) extending the normalizer to parse the
phoneme arrays for the frontend. **No schema migration required.**

So the effective outcome is **β′ — backend granularity + normalizer change +
frontend drill-down, no migration.** Cheaper than the commission's 800–1200 LOC /
2-sprint (β) framing.

---

## 3. UI surface integration plan (Objective 2)

**Approved default:** modal/drawer triggered from a weak-word badge.

- **Trigger location:** the weak-word badges already rendered in
  `practice.js _renderPronBlock` (`:2427–2438`, "Từ cần chú ý:" badges, filtered
  `error_type !== 'None'`) and `_renderFullPronBlock` (`:2503`). The result page
  (`result.html _pronResultHtml`) shows aggregate pills + summary — weak words
  are surfaced more richly on the practice feedback view than on result.html.
- **DOM injection point:** wrap each weak-word badge as a button
  (`role="button"`, `tabindex="0"`, `data-word`/`data-phonemes`) that opens a
  modal populated from that word's phoneme array.
- **Modal component:** **none exists** — `grep` for `.ds-modal`/`.ds-drawer`/
  `[role="dialog"]` in `ds.css` + `components.css` returns nothing. Sprint 15.1
  must add a small `.ds-modal` (or `.ds-drawer`) component.
- **Pattern #26 (mandatory):** the modal must reach colour through `--ds-*`/
  `--av-*` tokens only — no inline `rgba()`/hex (cluster 14.x lesson). New CSS
  belongs in `ds.css` (or `components.css`), not inline in the JS render helpers.

---

## 4. Actionable content spec (Objective 3)

**Approved defaults:** top-5 weakest phonemes/session, score < 70%; drill-down =
phoneme IPA + 2–3 example words + tip; no audio in 15.1 (deferred 15.2).

- **Score scale:** verified 0–100 (HundredMark). Threshold = phoneme
  `AccuracyScore < 70`. ✓ (commission flagged this unverified; now verified.)
- **Example words:** Azure returns phoneme symbol + accuracy score, but **not
  example words and not tips.** A static **lookup table is required**: phoneme →
  {example words, VN learner tip}. Precedent for static linguistic assets:
  `backend/content/` + `assets/grammar-mindmap/`. Proposed format: a JSON file
  (~44 English phonemes) under `assets/` or `backend/content/`, loaded once.
- **Phoneme symbol set — OPEN:** Azure may return SAPI-style symbols (e.g.
  `ax`, `ih`) rather than IPA (`ə`, `ɪ`). Sprint 15.1 pre-flight MUST capture one
  real `Granularity=Phoneme` response and key the lookup table on whatever Azure
  actually emits (do not assume IPA).
- **Tip text source:** static (lookup table) for 15.1; LLM-generated tips are a
  15.2 candidate.

---

## 5. Sentinel + test plan (Objective 4)

Following cluster 14.x discipline (zero-dep frontend node:test; backend mocks
Supabase; no jsdom/Postgres/live-Azure in CI):

- **Backend (β′ → backend changes):**
  - Granularity config sentinel — assert `_assessment_header` uses `"Phoneme"`.
  - Normalizer phoneme-parse test — feed a mocked Azure response containing a
    `Words[].Phonemes[]` array; assert the normalized `words` carry phonemes.
  - Lookup-table integrity test — every phoneme key has ≥2 example words + a
    non-empty tip (pure file read).
- **Frontend:**
  - Threshold filter — pure function: input phoneme array → output top-N with
    `AccuracyScore < 70` (functional test, extract-and-eval per 14.5.1/14.8.1).
  - Modal trigger + Pattern #26 — source-scan: badge renders a button wired to
    the modal; modal helper uses `var(--ds-*)`, no inline white literals.
  - Lookup-table integrity (frontend copy, if mirrored client-side).
- **Integration (Pattern #34, source-scan):** weak-word badge `data-*` payload
  is derived from the filtered phoneme array (no hardcoded fixture).

---

## 6. Sprint 15.1 commission preview

**Scope (β′, no migration):**

| Work | Est. LOC |
|---|---|
| `azure_pronunciation.py` — `Granularity` Word→Phoneme + normalizer parses `Words[].Phonemes[]` into `words[].phonemes` | ~80 |
| Phoneme → example-words + tip lookup table (JSON asset, ~44 phonemes) | ~150 |
| Frontend — `.ds-modal` component (ds.css) + weak-word badge → modal render + top-5 `<70%` phoneme filter | ~250 |
| Sentinels (backend + frontend + integration per §5) | ~200 |
| **Total** | **~680 LOC** |

Feasible as a **single Sprint 15.1**, or split 15.1 (backend + lookup table) /
15.2 (frontend modal) if the modal component grows. **No migration.** Backward
compatibility: sessions assessed before 15.1 have only word-level payloads → the
drill-down simply doesn't render for them (graceful, cluster 14.x L10 pattern).

**Sprint 15.1 pre-flight MUST (Pattern #42):** capture one real
`Granularity=Phoneme` Azure response to (a) confirm the `Words[].Phonemes[]`
shape and (b) key the lookup table on Azure's actual phoneme symbols (SAPI vs
IPA). Also confirm the Phoneme-granularity response-size / latency / cost delta.

---

## 7. Risks + open items

1. **Phoneme symbol set unknown** (SAPI vs IPA) — blocks lookup-table keys until
   a real Phoneme response is captured (15.1 pre-flight).
2. **Granularity=Phoneme cost/latency** — larger Azure responses; measure before
   shipping broadly.
3. **No modal precedent** — new `.ds-modal` component + tokens needed.
4. **Old sessions** — no phoneme data; drill-down hidden for them (acceptable).
5. **Single source signal** — one dogfood observation; validate the feature
   actually closes the "actionable guidance" gap after 15.1 ships.
6. **Direction 4/5 stay deferred** — VN-learner corpus absent; Cambridge legal
   review (cluster 14.x Phase B) unresolved.

---

## 8. Pattern #42 ledger — spec corrections in this commission

| # | Commission claimed | Reality (code-verified) |
|---|---|---|
| 1 | Outcome could be (α): phoneme data persisted → frontend-only ~400 LOC | **(β):** `Granularity="Word"` (`azure_pronunciation.py:102`) — phonemes never fetched |
| 2 | (β) "needs backend pipeline change + migration FIRST" | **No migration** — `pronunciation_payload` (migration 004) already stores raw payload verbatim; granularity + normalizer change suffices (β′) |
| 3 | Azure caller path "unknown, verify via grep" | Confirmed: `backend/services/azure_pronunciation.py` (SDK config + normalizer) + `backend/routers/pronunciation.py` (persistence) |
| 4 | "70% threshold unverified" | Verified: HundredMark 0–100 (`azure_pronunciation.py:101`) → `<70` valid |
| 5 | Azure may return phoneme example words | Azure returns phoneme + score only → a static lookup table is required |
| 6 | Modal component existence unknown | Confirmed absent — new `.ds-modal` needed |

**Spec error count (material): 2** (#1 outcome α→β; #2 migration-needed→not-needed).
Items #3–#6 are resolved unknowns, not errors.

---

## Note on CI for this PR

This is a docs-only change under `docs/`, which is outside the Tests workflow's
path filter (`backend/**`, `frontend/**`, `.github/**`). The Backend/Frontend
gates won't trigger (nothing to test); only the Vercel checks run. Expected for a
discovery sprint — no feature code shipped.

**END Sprint 15.0 Discovery.**
