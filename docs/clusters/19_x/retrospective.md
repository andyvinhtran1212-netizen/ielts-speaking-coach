# Cluster 19.x Retrospective — Writing-Coach Refinement

**Duration:** 2026-05-26 → 2026-05-27 (10 sprints + 1 cleanup)
**Theme:** Direction A user-facing + Direction B admin + Direction C flow refinement
**Outcome:** Feature work complete, cluster closed with administrative sprint 19.5

## Cluster overview

Cluster 19.x scoped 3 directions từ Andy 2026-05-26 raise:
- **A:** User-facing refinement (dashboard refactor, deadlines, history polish, status simplification, tips library, content import)
- **B:** Admin cohort views + independent grading file upload + Task 1 image support
- **C:** Flow refinement (end-to-end loop closure với regrade + tips reco; email deferred Sprint 20.0)

Discovery-first Pattern #43 applied at cluster start (19.0) và mid-cluster (19.3.5) khi multi-direction sub-theme emerged (Task 1 image support).

## Sprint sequence

| Sprint | PR | LOC (feature+test+doc) | Theme |
|---|---|---|---|
| 19.0 Discovery | #307 | 380 doc only | Inventory + reframe scope |
| 19.1A | #308 | 358 + 142 doc | Dashboard refactor + status simplification + design baseline |
| 19.1B | #309 | **1,679** (corrected per Codex audit; original cluster narrative claimed ~1,277 under-counting) | Tips library CMS — LOC overage flagged |
| 19.1C | #310 | 759 + 236 + 286 | Content import pipeline (4 content types) |
| 19.2 | #311 | 1,015 + 319 | Cohort admin views + assignment fan-out |
| 19.3 | #312 | 175 + 185 + 15 | Independent grading file upload |
| 19.3.5 Discovery | #313 | 196 doc only | Task 1 image inventory + reframe |
| 19.3.5 Implementation | #314 | ~615 | Task 1 Academic image support |
| 19.4 | #315 | ~1,212 | Regrade loop + tips reco (email deferred) |
| 19.5 cleanup | #316 | ~450-700 | Administrative closure + Codex fixes |

**Cluster LOC total feature work:** ~5,800-6,400 LOC across 10 sprints + ~2,400 docs (19.1B corrected per Codex audit).

## Lessons learned

### 1. Per-artifact LOC accounting (lesson 19.1B → mature)

Sprint 19.1B overrun (1,679 actual vs 800 cap) revealed commission accounting error: cap aggregate (backend/frontend) missed migration SQL + shared modules + CSS. Subsequent commissions (19.1C onward) broke caps per artifact type → 5/5 sprints (19.1C, 19.2, 19.3, 19.3.5, 19.4) landed within caps efficiently.

**Lesson:** commission cap structure = per-artifact bucket explicit (SQL / Python / shared JS / per-page HTML / per-page CSS / tests / docs).

### 2. Mind side bidirectional confidence calibration error

Mind side under-confident on existing infrastructure in Discoveries:
- 19.0 Discovery: 9/10 premises wrong về "X doesn't exist" — Writing-Coach was mature subsystem
- 19.3.5 Discovery: 8/10 premises wrong về "X doesn't exist" — image infra already in place (Cloudinary + schema + admin upload UI)

Mind side over-confident on existing infrastructure in 19.4:
- "Reuse existing email service" — NO email infra in project (Supabase Auth handles signup/reset transactional)

**Lesson:** stop predicting existence/non-existence. Future commissions ghi "Code PF empirical, no presumption" thay vì assume either direction.

### 3. Discovery-first Pattern #43 validated 2x

Cluster 19.0 Discovery saved cluster from commissioning narrow patch sprints when subsystem was already 70-90% built. Cluster 19.3.5 Discovery saved cluster from missing biggest-impact gap (AI grader text-only across ALL Task 1 Academic essays, not just admin upload symptom).

Both Discoveries: zero-LOC investment that prevented major wasted work.

**Lesson:** multi-direction themes warrant Discovery-first; data path tracing (không chỉ schema inventory) per 19.3.5 lesson — verify data flow execution, không chỉ structure presence.

### 4. Pattern #42 latitude (lesson 19.3.5)

Sprint 19.3.5 demonstrated Code identifying commission constraint conflicting với actual sprint goal (student submit path didn't populate prompt_image_url; commission ghi "don't modify submission pipeline"). Code modified với rationale + transparency in PR description.

Sprint 19.4 same pattern: Code surfaced email infra absence BEFORE building, asked Andy decision rather than fabricating.

**Lesson forward:** commission "DO NOT" constraints are intent-level; Code judges architectural reality + flags rationale. Mind side specifications cần allow latitude for prerequisite gaps.

### 5. Skill directive noise pattern (cluster artifact)

Persistent noise across cluster sprints, escalated mid-cluster then stable:
- 19.0/19.1A/19.1B: occasional
- 19.1C: ~12 firings
- 19.2: ~14 firings
- 19.3: ~12 firings
- 19.3.5 Discovery: ~0 (reads-only confirmed hook = edit-triggered)
- 19.3.5 Implementation: ~13 + NEW false-positive type "params is async in Next.js 16" on vanilla URLSearchParams
- 19.4: ~16 (highest, most HTML edits)
- 19.5: low (mostly doc + small edits)

Anthropic thumbs-down feedback submitted post-19.2 + post-19.3.5 (new type). Trend stable in count per file-edit ratio, qualitative expansion observed (new fabricated rules emerging). No project impact — Code disregarded consistently. Tracked for Anthropic feedback loop.

### 6. Commission writing improvements (cluster-wide patterns)

- Per-artifact LOC bucket (lesson 19.1B)
- KHÔNG placeholder SQL in commission — "Code authoritative on schema" (lesson 19.1B+19.1C)
- Binary INCLUDE/DEFER, không ambiguous "optional" (lesson 19.1C)
- Skill paste inline (Pattern #44 cluster template, established 19.1A)
- Reference design baseline doc strict (established 19.1A)
- Skill directive noise process note in each commission
- Inverted bias "things likely exist already" (lesson Discoveries)
- Code latitude on commission constraints khi prerequisite gap blocks goal (lesson 19.3.5)
- External-dependency decisions (provider choices, credentials) need explicit Andy decision BEFORE commission (lesson 19.4)

### 7. Design baseline workflow (Pattern #44 evolution)

Sprint 19.1A shipped `docs/clusters/19_x/design_baseline.md` capturing aesthetic choices Code committed. Subsequent sprints (19.1B → 19.4) referenced baseline strictly + paste frontend-design skill content inline → consistent design across 10 sprints, no end-of-cluster refactor.

**Lesson:** cluster-wide design baseline doc shipped sprint 1 = cheap insurance against design drift. Applied forward.

### 8. Codex independent audit findings (Sprint 19.5 pre-closure)

Pattern #45 invocation: Codex audited 10 cluster PRs trước Sprint 19.5 closure. Verdict: mostly solid; 5/12 dimensions clean.

**Critical finding (fixed Sprint 19.5):**
- **C1 regrade accept hole** — admin accept route updated essay status WHERE delivered but didn't verify update affected any row; still marked request accepted. Silent no-op possible. Fixed Sprint 19.5 với row-count check (`if not res.data → 409`) + request stays `pending` + negative-path test.

**Discipline gaps (fixed Sprint 19.5):**
- Sprint 19.1B LOC under-accounting: actual 1,679 vs claimed ~1,277 (Codex confirms via `git show --shortstat de25e5b6` — verified this sprint). Codex confirms under-counting, NOT gold-plating. Retrospective corrected.
- `essay_regrade_requests.reason` length API-only enforced, no DB CHECK. Migration 085 added CHECK constraint (`char_length(reason) BETWEEN 50 AND 500`).
- Email TODO docs actor/recipient wording reversed. Tightened (baseline §8).

**Validated clean (5/12 dimensions):**
- Multimodal grader wiring real and complete (cluster's biggest Pattern #42 catch validated)
- Two-chrome boundary intact
- XSS defense layered (DOMPurify everywhere)
- Mind/Code claims accuracy (Discovery findings + email infra absence both confirmed empirical)
- Skill noise contamination zero (no Next.js artifacts despite 16+ injection firings)

**Non-blocking deferred Phase B / future cluster:**
- Content import slug-based not DB-atomic (race window concurrent imports — non-issue single-admin reality)
- Cohort fan-out app-layer pre-check, no DB UNIQUE (student_id, prompt_id) guard
- Multimodal coverage mock-derived, no live Gemini provider integration test (QA hardening)

**Lesson:** Codex independent audit before cluster closure validated Mình + Code work mostly accurate, BUT caught real contract hole (C1) Mình + Code self-review missed. Pattern #45 cluster-wide audit invocation = effective quality gate. Recommend repeat invocation cho future cluster closures.

## Backlog forward

### Sprint 20.0 (separate cluster — email)
- Provider selection (Resend / SendGrid / SES / Mailgun) — Andy product decision
- 2 templates VN (essay delivered to student, regrade requested to admin)
- Trigger hooks drop into existing `# TODO(19.4 email deferred)` markers (3 sites: student regrade POST → admin; admin accept → student; mark_delivered → student)
- Estimated 200-400 LOC focused

### Future data-model cluster (cluster 20.x or later)
- `writing_tips` rename → `writing_content` (table semantically holds 4 content types since 19.1C)
- `task_type` vocab reconciliation (writing_prompts/essays `task1_academic|task1_general|task2` vs writing_tips `task_1|task_2|both`)
- 19.4 tips reco currently uses client-side band-aid mapping — would simplify post-reconciliation
- Possibly: cohort assignment template-based editing (deferred Sprint 19.2)

### Phase B candidates (when prioritized)
- Batch re-grade Task 1 Academic essays với image retroactively (post-19.3.5 band drift consideration)
- Multiple regrade requests per essay
- Notification preferences UI (after email infra)
- Error-driven tips recommendation matching (currently task_type filter only)
- PDF/SVG image format support for prompts
- Browser push notifications / in-app notification center
- Deadline-approaching email notifications
- Multi-grader schema support (currently single-grader per essay)
- Cohort-level analytics / cross-cohort aggregation
- Content import DB-native upsert (close concurrent-import race window)
- Cohort fan-out DB UNIQUE (student_id, prompt_id) guard
- Multimodal live Gemini provider integration test

## Recommendations cho future clusters

1. **Lead với Discovery for multi-direction themes** — Discovery cost is small, miss-cost is high
2. **PF empirical premise verification before commission**, especially infrastructure existence claims
3. **Trace data flow end-to-end, không chỉ schema inventory** during Discoveries
4. **Per-artifact LOC accounting from sprint 1** of new cluster
5. **External-dependency decisions surface early** — provider choices, credential needs, vendor lock-in
6. **Commission constraints intent-level** — Code latitude với PR rationale documentation
7. **Skill directive noise tracking** — continue logging until Anthropic addresses upstream
8. **Cluster design baseline doc** shipped sprint 1 of new cluster = consistency insurance
9. **Independent audit (Pattern #45) before cluster closure** — caught C1 that self-review missed

---

**END Cluster 19.x Retrospective**
