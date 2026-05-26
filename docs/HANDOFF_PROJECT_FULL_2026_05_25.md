# HANDOFF — PROJECT FULL (Post Cluster 15.x Closure 2026-05-25)

**Last update:** 2026-05-25 post-cluster-15.x closure event
**Previous handoff:** HANDOFF_PROJECT_FULL_2026-05-24.md (pre-cluster-15.x)
**Cluster 15.x retrospective:** See `CLUSTER_15_X_RETROSPECTIVE.md`
**Phase B backlog:** See `PHASE_B_BACKLOG_2026_05_25.md`

---

## I. Project state snapshot

**Application:** IELTS Speaking Coach (averlearning.com)
**Tech stack:** FastAPI backend (Railway) + vanilla JS frontend (Vercel) + Supabase (Postgres + Auth + Storage)
**External services:** OpenAI Whisper (STT), Anthropic Claude (grading), Azure Speech (pronunciation)

**Current production state (post-#282 merge):**
- Practice + result pages have phoneme drill-down accordion functional
- F4 frontend smoke tests advisory in CI
- Backend persistence atomic upsert reverted to read-then-write (durable pattern)
- All P0/P1 bugs from cluster 15.x dogfood resolved

**Backend tests:** 1841 (unchanged)
**Frontend sentinels:** 67 + parity assertion
**E2E tests:** 5 (M1/M3/M4 practice + M5/M5b result), advisory, 40s CI

---

## II. Cluster 15.x summary

**Theme:** DEBT-PRONUNCIATION-ACTIONABLE — Direction 1 (per-phoneme drill-down actionable)
**Duration:** 2026-05-24 → 2026-05-25 (~36 hours real-time)
**PRs:** #276-#282 (7 sprints)
**Status:** ✅ CLOSED

| Sprint | PR | Outcome |
|---|---|---|
| 15.0 Discovery | #276 | Pronunciation actionable scope β′ |
| 15.1 Drilldown | #277 | Modal + extractor + telemetry |
| 15.1.1 hotfix | #278 | Atomic upsert read-then-write |
| 15.1.2 hotfix | #279 | Native `<dialog>` modal |
| 15.2 F4 | #280 | Playwright frontend smoke |
| 15.3 Accordion | #281 | Native `<details>` practice page |
| 15.3.1 parity | #282 | Result.html accordion + extractor |

**Empirical motivation source addressed:**
> Andy 2026-05-24: "đo lường thiếu hướng dẫn cải thiện"

**Outcome:** Both practice + result pages have per-phoneme drill-down with IPA + ví dụ + VN tips.

---

## III. Open issues at handoff

### IS-15.1 — Smart default threshold (P3)
Andy production observation period. Current: `≤1 expanded / ≥2 collapsed`. Trigger pivot if "2+ feels buried".

### IS-15.2 — F4 advisory → required (P3)
Empirical stability data ramp. Target: ≥95% pass rate over 1-2 weeks.

### IS-15.3 — F4 backend half (P2)
Sprint 15.4 candidate deferred. Trigger: persistence regression recurs OR new persistence bug class OR Andy decides infra investment justified.

### IS-15.4-5 — Mobile + PDF accordion (P3)
Future cluster.

See `PHASE_B_BACKLOG_2026_05_25.md` for full criteria.

---

## IV. Conventions established cluster 15.x

| Convention | Detail |
|---|---|
| **Frontend zero-dep** (revised) | Bounded break: Playwright in `frontend/tests/e2e/` only, `.gitignore` enforced |
| **Browser primitives** | Prefer `<dialog>`, `<details>` over custom CSS when correctness-equivalent (Sprint 15.1.2 + 15.3 evidence) |
| **F4 advisory** | Frontend half live, ≥95% pass rate criteria for required promotion |
| **Hypothesis confidence %** | Discontinued — empirical Code reading > mind speculation |
| **Cross-file commission discipline** | Code PF reads consumer contract BEFORE mind specifies producer interface (3 instances cluster 15.x lesson) |

---

## V. Patterns active

**From cluster 14.x (preserved):**
- Pattern #15 (frontend zero-dep, except F4 bounded)
- Pattern #16 (backend mock Supabase, F4 backend deferred)
- Pattern #19 (dogfood-as-falsifier)
- Pattern #20 (schema-aware fake fixtures)
- Pattern #25 (contrast sentinel both themes)
- Pattern #26 (no JS inline styles)
- Pattern #29 (silent degradation graceful)
- Pattern #34 (integration sentinel asserts data flow)
- Pattern #38 (`/goal` directive autonomous iteration)
- Pattern #39 (persist truth = single source)
- Pattern #41 (DB-layer idempotency via index, not application upsert)
- Pattern #42 (commission as hypothesis, Code authoritative)

**Pattern #42 cumulative count cluster 14.x + 15.x:** ~34 spec errors honest-logged across ~24 sprints. ~1.4/sprint baseline.

---

## VI. Working style (Andy)

**Communication:**
- VN locale primary, EN technical OK
- 1-word answers honored (defaults, A/B/C, 1/2, p/q/r)
- Concise responses preferred
- Dogfood-driven empirical feedback (screenshots + Network tab analysis)

**Decision making:**
- Mind recommends defaults explicit, Andy "defaults" 1-word common
- Pivots accepted mid-cluster via revised commissions
- Cost concerns raised explicit (Azure, OpenAI, infra investments)
- Empirical > pre-emptive — defer infra investment until evidence

**Sprint flow:**
- Andy fires Code via `claude --dangerously-skip-permissions` with commission file path
- Code autonomous iteration, Andy babysitting minimal
- Andy dogfood post-merge, empirical signal authoritative
- Mind drafts commission, Code PF authoritative, Pattern #42 honest

---

## VII. Mind side blind spots / recurring gaps

Honest enumeration to inform future commission discipline:

1. **Cross-file integration spec** — Mind specifies producer without reading consumer empirically (3 instances cluster 15.x: Azure schema, result.html state, renderer contract)
2. **Repo file paths** — Stale assumptions about directory structure (Sprint 15.2 `styles/` vs `css/`)
3. **Asset format choices** — JSON file vs JS bundle assumptions (Sprint 15.2 PHONEME_REF)
4. **Toolchain feasibility** — Mind assumes toolchain from sandbox-blind perspective (Sprint 15.2 original commission Supabase-local complexity)
5. **Hypothesis ranking confidence** — Mind side % assignments empirically wrong both Sprint 15.1.1 + 15.1.2

**Mitigation pattern:** For any cross-file or infra-heavy sprint, mind should request Code do quick PF read BEFORE finalizing commission. Discovery-first format (15.0-style) for infra sprints.

---

## VIII. Code side patterns (observed cluster 15.x)

**Strengths:**
- Pre-flight findings consistently surface commission spec errors (Pattern #42 evidence Code authoritative)
- Honest accountability (Sprint 15.1.1 atomic upsert root cause owned)
- Native primitive elevation choices (Sprint 15.1.2 + 15.3)
- Memory writes for new gotchas (3+ memories across cluster)
- CI verification before claiming done (local + GitHub Actions both green)
- Tool selection empirical (Playwright vs Puppeteer evaluated Sprint 15.2)

**Patterns Code introduced (mind learn):**
- Browser primitive > custom CSS when correctness-equivalent
- Schema-aware fixture (real Azure response captured) > synthetic invented data
- Bounded convention breaks documented in `.gitignore` enforcing scope

---

## IX. Cluster 16.x kickoff readiness

**Mind awaits Andy theme decision.** Empirical motivation source needed (similar to 2026-05-24 dogfood signal).

**Candidate themes (Sprint 15.x Direction backlog):**
- Direction 2 — Drill exercises
- Direction 3 — Cross-session phoneme trend
- Direction 4 — VN-learner specific guide
- Direction 5 — Cambridge band descriptor
- TTS audio reference (Azure TTS cost trigger)
- LLM-generated dynamic tips (Azure OpenAI cost trigger)

See `PHASE_B_BACKLOG_2026_05_25.md` Section IV for trigger criteria.

**Recommended cluster 16.x kickoff format:**
- Wait for Andy 1-2 weeks production observation
- Empirical signal trigger → Discovery sprint commission (15.0-style lightweight)
- Phase B re-prioritization based on observation data
- Direction selection per Andy authoritative

---

## X. Active recommendations / standing items

**Andy actions standing:**
1. Production observation 1-2 weeks (smart default UX, F4 stability, persistence health)
2. Merge any in-flight PRs (only #282 pending at handoff time)
3. Cluster 16.x theme decision when empirical signal surfaces
4. F4 advisory → required promotion when stability data justifies

**Mind actions standing:**
1. Standby for cluster 16.x kickoff signal
2. Maintain Pattern #42 ledger discipline
3. Cross-file commission discipline (PF consumer before producer spec)
4. Continue Discovery-first format for infra sprints

**Code actions standing:**
1. Autonomous iteration when commissioned
2. Honest PF + Pattern #42 ledger
3. Memory writes for new patterns
4. CI verification before claiming done

---

## XI. Critical files reference

**Cluster 15.x artifacts:**
- `docs/clusters/15_x/discovery.md` (Sprint 15.0 #276)
- `docs/clusters/15_x/retrospective.md` (this closure)
- `backend/tests/fixtures/azure_phoneme_sample.json` (Sprint 15.0 PF-1 captured)
- `frontend/css/ds-accordion.css` OR `frontend/css/ds.css` accordion rules (Sprint 15.3)
- `frontend/js/pronunciation-accordion.js` (Sprint 15.3 renderer + 15.3.1 extractor per cohesion)
- `frontend/tests/e2e/` (Sprint 15.2 Playwright suite, 5 tests)
- `.github/workflows/e2e.yml` (Sprint 15.2 advisory CI)

**Project-wide:**
- `backend/main.py` (FastAPI app entry)
- `backend/services/azure_pronunciation.py` (Granularity=Phoneme post Sprint 15.1)
- `backend/services/pronunciation.py` (persistence line 231, raw payload JSONB)
- `frontend/pages/practice.html` (post-submit feedback, Sprint 15.3 accordion)
- `frontend/pages/result.html` (reopened session, Sprint 15.3.1 accordion)
- `frontend/js/api.js:39` (auth + base URL config)
- `frontend/js/practice.js` (practice page renderer)
- `frontend/js/result.js` (result page renderer, Sprint 15.3.1 wire-through)

**Migration:**
- Latest migration: 077 (partial unique index per Sprint 14.x)
- `pronunciation_payload` JSONB stores raw Azure verbatim (migration 004)
- No new migrations cluster 15.x

---

## XII. Risk register (current)

1. **Smart default UX validation (IS-15.1)** — Andy 1-attempt dogfood pass small sample. Production usage may surface mismatch.
2. **F4 advisory stability (IS-15.2)** — Currently advisory. Pass rate empirical TBD.
3. **Persistence regression watch (IS-15.3)** — Sprint 15.1.1 fix durable but covered only by source-scan + Andy dogfood, not real-DB integration test.
4. **Telemetry blind spots** — Sprint 15.1 added `pronunciation_assess_duration_ms` + `pronunciation_lookup_miss` event_kinds. Production accumulation 1-2 weeks for empirical baseline.
5. **Cross-file commission discipline** — Mind recurring gap, mitigation pattern documented but not systematized in commission template.

---

## XIII. Closure attestation

Cluster 15.x feature-complete. Empirical motivation addressed. Mind side spec errors honest-logged ~13 across 9 commission rounds. F4 frontend half ship + backend half deferred per Andy empirical-driven prioritization.

**Pattern #38 closure event:** No silent debt, no hidden errors, no scope creep beyond Andy approvals. Cluster 15.x closes clean.

**Standby state:** Mind + Code + Andy all ready for cluster 16.x kickoff when empirical signal surfaces.

---

**END HANDOFF — PROJECT FULL — 2026-05-25.**
