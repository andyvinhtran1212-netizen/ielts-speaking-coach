# Cluster 15.x — Retrospective

**Cluster theme:** DEBT-PRONUNCIATION-ACTIONABLE
**Date range:** 2026-05-24 → 2026-05-25 (~36 hours real-time)
**Status:** CLOSED (feature-complete; F4 backend half deferred to debt backlog)
**Total PRs:** 7 (#276-#282)
**Empirical motivation source:** Andy dogfood 2026-05-24 — "đo lường thiếu hướng dẫn cải thiện"

---

## I. Sprint inventory

| Sprint | PR | Type | Scope | LOC | Outcome |
|---|---|---|---|---|---|
| 15.0 | #276 | Discovery | Pronunciation actionable lightweight | 180 (target 400) | β′ outcome empirical |
| 15.1 | #277 | Feature | Per-phoneme drilldown modal | ~750 | Sprint 14.8.2 atomic upsert latent bug surfaced |
| 15.1.1 | #278 | Hotfix P0 | `/complete` 422 persistence block | ~80 | Atomic upsert reverted to read-then-write |
| 15.1.2 | #279 | Hotfix P1 | Modal positioning broken UX | ~150 | Native `<dialog>` elevated path (not CSS patch) |
| 15.2 | #280 | Infra | F4 frontend browser smoke (Playwright) | ~250 (target 325) | Zero-dep convention break authorized bounded |
| 15.3 | #281 | Feature | Modal → inline accordion (practice.html) | ~550 | Native `<details>` primitive-first lesson reinforced |
| 15.3.1 | #282 | Feature follow-up | Result.html accordion parity + extractor | ~210 | Per-question + legacy graceful + parity sentinel |

**Total: ~2170 LOC across 7 sprints in 36 hours.**

---

## II. Empirical motivation → outcome

**Source signal (2026-05-24, Andy dogfood):**
> "đo lường thiếu hướng dẫn cải thiện"

**Outcome (2026-05-25 Andy dogfood pass):**
- Practice.html: inline accordion drilldown with IPA + ví dụ + VN tips, click weak word badge → scroll + expand + highlight
- Result.html: per-question accordion parity, same component, same UX
- Legacy sessions: graceful placeholder
- F4 frontend smoke (5 tests) guards UI regression class in CI

**Pattern #19 (dogfood-as-falsifier) validation:** Andy original empirical motivation fully addressed across both user surfaces. Subjective UX validation (smart default ≤1 expanded works) ratified.

---

## III. Pattern #42 ledger (commission spec error tally)

| Sprint | Mind spec errors | Material | Source |
|---|---|---|---|
| 15.0 Discovery commission | 2 | Material | Scope assumption, Azure schema blind |
| 15.1 PF-1 commission | 1 minor | Minor | Phoneme count estimate -9% |
| 15.1 commission | 4 unknowns resolved | N/A | Pre-flight empirical, no spec error |
| 15.1.1 hypothesis ranking | H1 70% wrong, actual H2 variant | Material | Atomic upsert vs Sprint 15.1 fields hypothesis |
| 15.1.2 hypothesis ranking | 100% wrong (CSS hypothesis), actual native elevated | Material | Custom CSS not applied symptom, mind blind |
| 15.2 original commission | 4 material | Material | Scope (Supabase-local), tool-bug-class lump, dep convention oversight, CI cost oversight |
| 15.2 revised commission | 2 minor (Code corrected) | Minor | Stale paths `styles/` vs `css/`, asset format JSON vs JS bundle |
| 15.3 original commission | 1 material | Material | Result.html wire-through assumption (data layer state blind) |
| 15.3 revised commission | 0 | Clean | Practice-only scope clean |
| 15.3.1 commission | 1 material (Code caught) | Material | Extractor shape flat vs per-word grouped, renderer contract blind |

**Total cluster 15.x: ~13 mind spec errors honest-logged across 9 commission rounds.**

**Average rate:** ~1.9/sprint vs cluster 14.x baseline ~1.2/sprint. Slight elevation.

**Trend analysis:**
- Feature sprints (15.0, 15.1, 15.3, 15.3.1): ~1 error each — within cluster 14.x baseline
- Hotfix hypothesis ranking (15.1.1, 15.1.2): 2 hypothesis falsifications — empirical reality > mind speculation
- F4 infra sprint (15.2): 4 errors original commission — complexity correlates with error rate
- Recovery via revised commissions clean: 15.2 revised + 15.3 revised both produced minimal/zero new errors

**Lessons reinforced:**
1. **Cross-file commission discipline** — any sprint touching existing component reuse needs Code PF reading consumer contract BEFORE mind specifies producer interface. 3 instances cluster 15.x (15.0 Azure schema, 15.3 result.html state, 15.3.1 renderer contract).
2. **Hypothesis ranking with confidence assignment risky** — mind side hypothesis confidence ~70-100% wrong in both hotfixes. Code empirical reading > mind speculation. Action: hypothesis stacks future commissions ranked but no confidence percentages.
3. **F4-shaped infra sprints need Discovery-first format** — 15.2 original commission lumped 2 bug classes + assumed feasibility from sandbox. Revised commission post-PF clean. Pattern: infra sprints always Discovery sprint commission (15.0-style) before feature commission.
4. **Browser primitive > custom abstraction** — Sprint 15.1.2 native `<dialog>` + Sprint 15.3 native `<details>` both elevated mind's custom-CSS hypotheses. Lesson: when correctness-equivalent primitive exists, prefer browser primitive.

---

## IV. F4 deferred-item resolution

**Original Codex finding (cluster 14.x):**
> "No persisted/integration test for save→complete path"

**Cluster 15.x cost realized:**
- Sprint 15.1.1 P0 silent persistence failure (atomic upsert + partial unique index incompatibility) — shipped CI 4/4 green through entire cluster-14.x closure because tests were source-scan + mocked-Supabase only
- Sprint 15.1.2 P1 modal positioning failure — shipped CI 4/4 green because no real browser test in CI

**Cluster 15.x F4 partial closure:**
- ✅ **Frontend half:** Sprint 15.2 shipped Playwright + 5 browser tests (M1/M3/M4 practice + M5/M5b result), advisory CI check, 40s runtime
- ⏸ **Backend half deferred:** Sprint 15.4 candidate (Supabase-local CI service for atomic upsert/partial unique index class)

**Deferral rationale (Andy decision 2026-05-25, mind recommend):**
1. Cluster 15.x feature motivation fully addressed empirically — no regression evidence current state
2. Sprint 15.1.1 fix (PR #278 read-then-write) durable pattern, no re-bleed evidence
3. F4 backend complexity high uncertainty — Supabase-local CI service Code cannot verify from sandbox, Andy verify burden
4. Pattern #19 (empirical-driven prioritization) > pre-emptive infra investment when state stable
5. Sprint 15.1 telemetry hook (`pronunciation_assess_duration_ms`, `pronunciation_lookup_miss`) will accumulate empirical signal — re-prioritize if persistence regression recurs OR new persistence bug class surfaces

**Phase B backlog action:** F4 backend half escalated from "deferred" to "pending empirical re-trigger" status. Specific re-trigger criteria documented in Phase B (next item).

---

## V. Convention evolution cluster 15.x

| Convention | State pre-15.x | State post-15.x |
|---|---|---|
| Frontend zero-dep | Strict, no `package.json` | Bounded break: Playwright in `frontend/tests/e2e/` only, `.gitignore` enforced |
| Browser primitives preferred | Implicit | Explicit pattern — `<dialog>`, `<details>` chosen over custom CSS when correctness-equivalent |
| CI checks | 3 (Backend, Frontend, Vercel) | 5 (+ Vercel Preview Comments, + E2E advisory) |
| F4 coverage | None | Frontend half advisory (≥95% pass rate target before promotion) |
| Hypothesis confidence | Mind side % assignments | Discontinued — empirical > mind speculation |

---

## VI. Cluster 15.x deliverables (user-facing)

### Practice.html (post-submit feedback view):
1. **Phân tích phát âm chuyên sâu** section with 5 score pills (Tổng thể / Lưu loát / Chính xác / Đầy đủ / Ngữ điệu)
2. Narrative VN feedback text generated server-side (Sprint 15.1)
3. Weak word badges (e.g., "fish ⓘ") clickable
4. Click badge → scroll to accordion sub-section + auto-expand + highlight pulse
5. Inline accordion (native `<details>`) per weak word: SAPI symbol + IPA + score bar + 2-3 ví dụ + VN tip
6. Smart default: ≤1 weak word expanded, ≥2 collapsed
7. Section headers toggle natively (keyboard + click)

### Result.html (reopened session report):
1. Per-question card accordion parity (same component as practice)
2. Wire-through from persisted `pronunciation_payload` (raw Azure) via client-side extractor
3. Legacy session (pre-15.1 Word-granularity) → "Phân tích phát âm chuyên sâu chưa khả dụng cho phiên này" placeholder
4. Smart default + click behavior identical to practice
5. Read-only context (no re-grading)

### Backend persistence:
- Azure granularity flag: `Word` → `Phoneme` (Sprint 15.1 #277)
- `pronunciation_payload` JSONB stores raw Azure response verbatim (existing migration 004, no new migration)
- `extract_weak_phonemes()` backend function (Sprint 15.1, top-N below threshold extraction)
- Atomic upsert reverted to read-then-write (Sprint 15.1.1 #278, partial unique index handles dedup independently)
- Telemetry hooks: `pronunciation_assess_duration_ms`, `pronunciation_lookup_miss` event_kinds

### CI/Test infrastructure:
- Backend test suite: 1841 (unchanged pre-cluster, no regression)
- Frontend sentinels: 67 + parity assertion (down from 122 mid-cluster due to modal sentinel cleanup Sprint 15.3)
- F4 e2e: 5 browser tests (M1/M3/M4 practice + M5/M5b result), 40s CI runtime, advisory
- Playwright bounded to `frontend/tests/e2e/` (convention break documented)

### Documentation:
- F4 README: local dev workflow + advisory check explanation
- Sprint 15.3.1 PR body: extractor contract documented for future shape reference

---

## VII. Issues open at cluster close

### IS-15.1 — Smart default threshold empirical validation
**Status:** Open, pending Andy 1-week production observation
**Description:** Sprint 15.3 implemented `≤1 expanded / ≥2 collapsed`. Andy dogfood 2026-05-25 passed (small sample). Production usage may reveal threshold mismatch.
**Trigger to re-open:** Andy observation that 2+ weak words feels buried → 1-line flip to "expand-all với cap N"
**Owner:** Andy empirical observation

### IS-15.2 — F4 advisory → required ramp
**Status:** Open, pending empirical stability data
**Description:** F4 frontend CI check live as advisory (does NOT block merge). Promotion criteria: ≥95% pass rate on legitimate green PRs over 1-2 weeks
**Trigger to promote:** Andy observation + GitHub Actions historical pass rate
**Owner:** Andy decision post-empirical

### IS-15.3 — F4 backend half (Sprint 15.4 candidate)
**Status:** Deferred, pending empirical re-trigger
**Description:** Supabase-local CI service for persistence regression coverage (catches Sprint 15.1.1 class)
**Trigger to commission:** (a) Persistence regression recurs OR (b) New persistence bug class surfaces OR (c) Andy decides infra investment justified
**Owner:** Andy decision

### IS-15.4 — Mobile viewport responsive accordion
**Status:** Deferred to mobile sprint candidate
**Description:** Accordion currently desktop-first. Smart default + multiple sub-sections may cause excessive scroll on mobile
**Trigger:** Andy mobile usage feedback OR explicit mobile sprint commission
**Owner:** Future cluster

### IS-15.5 — PDF report accordion rendering
**Status:** Far backlog
**Description:** If PDF generation uses result.html as template, accordion may need rendering adjustments for static PDF context
**Trigger:** PDF report regression report OR explicit Sprint 15.5+ commission
**Owner:** Future cluster

### IS-15.6 — Cluster 16.x candidates
**Status:** Open for next cluster planning
**Candidates (Sprint 15.x roadmap deferrals):**
- Direction 2 — Drill exercises (per-phoneme practice clips)
- Direction 3 — Cross-session phoneme trend tracking
- Direction 4 — VN-learner specific phoneme guide (corpus research)
- Direction 5 — Cambridge band descriptor mapping (legal review needed)
- TTS audio reference playback (cluster 16.x candidate, Azure TTS cost trigger)
- LLM-generated dynamic tips (Sprint 15.1 already has static narrative; LLM upgrade cluster 16.x candidate)
**Owner:** Mind + Andy theme decision next cluster kickoff

---

## VIII. Working style observations cluster 15.x

**Andy patterns observed:**
- 1-word answers honored throughout (defaults, 1/2, A/B/C, p/q/r)
- Dogfood-driven feedback (sessions 90c6a, 495c51, 2082b5, f1cb11) provided empirical signal
- Azure cost concern raised explicit — verified empirically (granularity flag = $0 incremental)
- Design pivot mid-cluster (modal → accordion) handled via revised commission
- No `ask_user_input` tools needed — clarifications in PR body or chat sufficient

**Mind patterns observed:**
- Commission discipline tightened post-Sprint 15.2 lump-error
- Cross-file commission gap recurring (3 instances) — needs systematic PF protocol
- Hypothesis ranking with confidence % discontinued empirical
- Pattern #42 ledger maintained honest throughout, no silent errors
- Cluster 15.x running ledger maintained per response

**Code patterns observed:**
- Pre-flight findings consistently surface commission spec errors (Pattern #42 evidence Code authoritative)
- Honest accountability acknowledgments (Sprint 15.1.1 "my 14.8.2 atomic upsert never actually worked in production")
- Native primitive elevation choices (Sprint 15.1.2 `<dialog>`, Sprint 15.3 `<details>`)
- Memory writes for new patterns/gotchas saved future sessions
- CI verification before claiming done (5/5 local + GitHub Actions green proof)

---

## IX. Empirical metrics

| Metric | Cluster 14.x | Cluster 15.x |
|---|---|---|
| Sprints | 17 | 7 |
| PRs | 16 | 7 |
| Duration | Multiple weeks | ~36 hours |
| LOC delta | Large | ~2170 |
| Spec errors | ~21 | ~13 |
| Spec errors/sprint | ~1.2 | ~1.9 |
| Material spec errors | ~14 | ~9 |
| P0 hotfixes | (Sprint 14.6.1-14.6.5 series) | 1 (15.1.1) |
| P1 hotfixes | Several | 1 (15.1.2) |
| F4 gap status | Deferred fully | Frontend half closed |
| Backend tests | 1834 → 1841 (+7) | 1841 (unchanged) |
| Frontend sentinels | 751 → 764 (+13) | 764 → 67 (cleanup post-modal) |
| CI runtime | 3 checks | 5 checks (E2E +40-53s) |

---

## X. Next steps post-closure

### Immediate (Andy):
1. Merge #282 (Sprint 15.3.1 result.html parity)
2. Cluster 15.x closure event — mind drafts:
   - This retrospective doc ✅
   - Phase B backlog update (separate file)
   - New handoff document for next session (separate file)
3. Production usage observation period (1-2 weeks):
   - Smart default threshold empirical (IS-15.1)
   - F4 advisory stability (IS-15.2)
   - Persistence regression watch (IS-15.3 trigger criteria)

### Cluster 16.x kickoff (when Andy ready):
1. Mind awaits empirical motivation source (similar to 2026-05-24 dogfood signal)
2. Theme decision Andy authoritative
3. Discovery sprint format (15.0-style lightweight) for any infra-heavy theme
4. Continue Pattern #42 honest ledger discipline

---

**CLUSTER 15.x CLOSED 2026-05-25.**
**Empirical motivation addressed. Direction 1 (per-phoneme drilldown actionable) fully shipped both surfaces.**
**F4 backend half intentionally deferred pending empirical re-trigger.**

---

**END CLUSTER 15.x RETROSPECTIVE.**
