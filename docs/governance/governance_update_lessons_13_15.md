# Governance Update — Lessons 13-15 + Patterns 47-49 (post-Cluster 20.x)

**Status:** Governance amendment codifying the lessons + patterns surfaced in Cluster 20.x Phase III (standards/display 20.13-20.15) and the cross-cluster performance initiative.
**Authority:** Mind (chat orchestrator), ratified by the cluster 20.x arc + Andy's production dogfood.
**Integrates with:** existing governance §5b (enforceable-anchor table), §6 (reopen triggers), §8 (Deploy & Apply Procedure), §9 (Workaround Review). This doc adds §10 (CI-gate definition), §11 (version-agnostic assertions), §12 (layered root-cause), and an empirical-confidence convention; plus three patterns.

---

## A. Lessons register — additions (13-15)

The lessons register now runs 1-15. Lessons 1-12 unchanged. New:

### Lesson 13 — Local test slice ≠ CI gate
**Statement:** "Shipped" requires the FULL test suite green, not the slice of files an agent touched. Run the full suite locally before declaring shipped; confirm via the CI Actions run, not a local module slice.
**Origin:** 20.13c — Code ran the reading-exam slice (115 pass), declared shipped; CI full suite (1264) caught a `renderPalette` sentinel regression in an untouched file.
**Enforcement (§10 below):** every commission's process note states "run FULL suite locally (Lesson 13)"; "shipped" is defined as CI-green-full + merged + deployed-verified + dogfood-passed.

### Lesson 14 — Versioned-doc bump → version-agnostic assertion tests
**Statement:** Tests asserting a version string must match a version *family* (`/v1\.\d+/`), never an exact version (`/v1\.0/`). Bumping a versioned doc must not cascade into test failures for tests that only care the doc is present + versioned.
**Origin:** standards v1.0→v1.1 broke a `/v1\.0/` sentinel; fix `/v1\.\d+/`.
**Enforcement (§11 below):** when authoring or reviewing a test that asserts a version, use the family pattern. Couples to Lesson 4 (claim→enforced): the test enforces "present + versioned," not an exact value the doc author may legitimately bump.

### Lesson 15 — Visual symptom → descend rendering layers, not just CSS
**Statement:** When a visual fix fails repeatedly at one layer, the root cause is at a *different* layer. Escalate the layer search rather than retrying the same layer with variations.
**Origin:** passage-width "stuck column" survived 3 CSS fixes (max-width, specificity, cache); root cause was layer 4 — `marked.js breaks:true` hardcoding `<br>` from source newlines.
**Enforcement (§12 below):** maintain a layer ladder per problem domain; after a failed fix, move down the ladder. The display ladder: CSS-width → CSS-whitespace → markup/DOM → render-config (e.g. markdown options) → content/source.

---

## B. Section additions

### §10 — CI-gate definition (codifies Lesson 13)

**The test gate is the FULL CI suite, not a local slice.**

- Commissions MUST state: "run FULL frontend + backend suites locally before shipped (Lesson 13)."
- Agent "shipped" reports MUST cite the total test count matching CI (e.g. "Frontend 1428/0") — not a slice count.
- "Shipped" is a four-part definition: **CI-green-full + merged + deployed-verified (§8) + dogfood-passed (Lesson 10).** PR-open is NOT shipped.
- Frontend-heavy refactors carry high cross-file regression surface (sentinels in untouched files) — full suite is non-negotiable for them.
- Rationale: agents naturally test the files they edited; the slice passes while a sibling sentinel breaks. Only the full suite gates correctly.

### §11 — Version-agnostic assertion tests (codifies Lesson 14)

**Any test asserting a version string uses a family pattern.**

- ✅ `/v1\.\d+/` (matches v1.0, v1.1, v1.10, …)
- ❌ `/v1\.0/` (breaks on any bump)
- The assertion's intent is usually "the versioned doc/artifact is present," not "it is exactly version X." Encode the intent, not the snapshot.
- Applies to: standards-doc sentinels, schema-version checks, API-version assertions, any test reading a version field it doesn't own.
- Review hook: when a test hardcodes a version, flag it for the family pattern before merge.

### §12 — Layered root-cause descent (codifies Lesson 15 + Pattern #49)

**A fix that fails at layer N means the cause is at layer N+1; descend, don't retry.**

- Maintain a per-domain layer ladder. Known ladders:
  - **Display/text rendering:** CSS-width → CSS-whitespace (`white-space`, line-height) → markup/DOM structure → render-config (markdown options like `breaks`, sanitizer) → content/source (hardcoded breaks, encoding).
  - **API latency (Server-Timing):** network/edge → auth → db → app-stage → external-service (Cloudinary/Gemini signing).
- After a failed fix, document which layer was tried + ruled out, then move down. Do not re-attempt the same layer with cosmetic variations (3× CSS attempts is the anti-pattern).
- The symptom often names the layer: "wraps at fixed cadence = source line width" pointed at content/render-config, not CSS-width.

### Empirical-confidence convention (codifies Pattern #48)

**Mind labels claims by confidence; architectural decisions wait for measured evidence.**

- Label hierarchy: **MEASURED** (Server-Timing, test output, prod dogfood) > **CODE-READ** (agent read the source) > **INFERRED** (Mind reasoning from priors) > **UNKNOWN**.
- Mind's hypotheses are starting points for Discovery, not conclusions. A Discovery agent's empirical findings supersede Mind inference.
- Architectural changes (SPA, service worker, schema redesign) require MEASURED evidence, not inference. Per-endpoint/per-fix optimization can proceed on CODE-READ + dogfood.
- Example arc: "Grammar fast = SPA" (INFERRED) → refuted by Phase 1 (CODE-READ) → quantified by Phase 2 (MEASURED) → SPA stayed deferred because evidence didn't support it.

---

## C. Patterns register — additions (47-49)

### Pattern #47 — Pattern reuse across sprints
Extract a proven mechanism into a reusable pattern; follow-up sprints become smaller + lower-risk. Discovery-first (#43) feeds it — D0 maps the reusable mechanism before implementing.
- **Examples:** Perf-2 reused Perf-1's combined-boot design (3.0s→1.73s with a near-clone); 20.14f-α reused listening's entire image mechanism (upload + storage + signed URLs + admin UI) — a ~150-LOC clone instead of net-new.
- **Trigger:** before building a feature that resembles an existing one, run a D0 to map the existing mechanism's reusable surface.

### Pattern #48 — Empirical refutation of Mind hypothesis
Mind's surface hypothesis is a starting point; a Discovery agent's empirical findings refute/refine it. See the empirical-confidence convention (§B above).
- **Mechanism:** Mind states a labeled hypothesis (INFERRED) → Discovery agent investigates (CODE-READ/MEASURED) → hypothesis confirmed, refined, or refuted → scope set on the empirical result.
- **Guard:** never commit to an architectural sprint on an INFERRED hypothesis alone.

### Pattern #49 — Layered root-cause descent
See §12. When a fix fails at one layer, descend the layer ladder rather than retrying. Codified as a governance section because it's a process rule, not just a single-domain tactic.

---

## D. Cross-references to existing governance

| New | Couples to existing |
|---|---|
| §10 CI-gate | §8 Deploy & Apply (shipped = CI-green-full + deployed-verified); Lesson 10 dogfood |
| §11 version-agnostic | §5b enforceable-anchor table (Lesson 4 claim→enforced); Lesson 5 |
| §12 layered root-cause | Lesson 1 verify-first (don't presume the layer); Pattern #43 Discovery-first |
| Empirical-confidence | Lesson 1; Pattern #43; Pattern #42 commission-as-hypothesis |
| #47 reuse | #43 Discovery-first (D0 maps reusable surface) |
| #48 refutation | #42 commission-as-hypothesis + latitude |

---

## E. Reopen triggers (§6) — note from this arc

Cluster 20.x reopened deliberately twice post-"closure" (standards v1.1; display-fidelity dogfood). Both were legitimate per §6: an external standard maturing (v1.1) and production dogfood surfacing fidelity gaps are valid reopen triggers, NOT scope creep. Record: a "closed" cluster reopening on a documented trigger is healthy; the failure mode is declaring closed *before* the gates (test-full + audit + dogfood + deploy-verify) are honored, which is what §10's "shipped" definition now prevents.

---

*Governance amendment — effective for all clusters going forward. Lessons register now 1-15; patterns include 47-49; sections add §10-§12 + the empirical-confidence convention.*
