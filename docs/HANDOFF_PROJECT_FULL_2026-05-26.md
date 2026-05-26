# HANDOFF — PROJECT FULL (Post Cluster 17.x Closure 2026-05-26)

**Last update:** 2026-05-26 post cluster 17.x feature-complete + cluster 18.x kickoff
**Previous handoff:** HANDOFF_PROJECT_FULL_2026_05_25.md (post cluster 15.x closure)
**Cluster 17.x retrospective:** See `CLUSTER_17_X_RETROSPECTIVE.md`
**Cluster 16.x retrospective:** Pending observation period completion
**Phase B backlog:** See `PHASE_B_BACKLOG_2026_05_26.md`

---

## I. Project state snapshot

**Application:** IELTS Speaking Coach (averlearning.com)
**Tech stack:** FastAPI backend (Railway Pro $20/mo) + vanilla JS frontend (**GitHub Pages**, NOT Vercel) + Supabase Pro $25/mo
**External services:** OpenAI Whisper (STT), Anthropic Claude (grading), Azure Speech (pronunciation)
**Total monthly baseline:** ~$45 (Supabase Pro + Railway Pro)

**Current production state (post-#296 merge):**
- Practice + result pages có phoneme drill-down accordion (cluster 15.x)
- Retention lifecycle live: audio 15d strict + content 60d activity-extended (cluster 16.x went live 2026-05-26)
- Admin panel feature-complete: codes UI + usage log + cohort mgmt + foot traffic + reassignment (cluster 17.x)
- Cluster 18.x kickoff active

**Backend tests:** 1927 passing (1 pre-existing spaCy lemmatizer flake)
**Frontend sentinels:** Maintained throughout, 6 e2e tests
**Migrations:** Latest = 081 (Sprint 17.5 audit columns)

---

## II. Cluster summary table

| Cluster | Theme | PRs | LOC prod | Status |
|---|---|---|---|---|
| 14.x | (Various features) | 16 PRs | Large | ✅ Closed |
| 15.x | DEBT-PRONUNCIATION-ACTIONABLE | 7 (#276-#282) | ~2,170 | ✅ Closed |
| 16.x | STORAGE-LIFECYCLE-AND-EXPORT | 8 (#283-#290) | ~1,100 | ✅ Feature-complete, live, observation |
| 17.x | ADMIN-PANEL-CONSOLIDATION | 6 (#291-#296) | ~1,962 | ✅ Feature-complete, observation |
| 18.x | ADMIN-PANEL-REFINEMENT | TBD | ~1,250-2,050 est | 🚀 Kickoff active |

---

## III. Cluster 18.x kickoff status

**Andy decisions baked (2026-05-26):**
- Theme: ADMIN-PANEL-REFINEMENT
- Sequence: A → B → C
- UI design ownership: Code authoritative

**3 directions:**

| Direction | Scope |
|---|---|
| A — Information Architecture | Gộp Học viên→Lớp + convert user-to-student + dropdown vs UUID |
| B — Dashboard Consolidation | Hệ thống + Usage log + Lưu lượng → 1 dashboard với 6 metrics |
| C — UI Audit + Refactor | 6 admin pages |

**Sprint 18.0 Discovery commission:** Drafted parallel, ready to ship

---

## IV. Open standing items

### Cluster 16.x observation (2026-05-26 → ~2026-06-09)
- Sprint 16.4 retention sweep live
- Verify storage usage decreasing
- Verify aggregate scores preserved
- Verify no P0/P1 regressions

### Cluster 17.x observation (2026-05-26 → ~2026-06-02)
- Admin uses new panel
- Verify no P0/P1 regressions across A/B/C/D/E directions

### IS-17.1 — Anonymous landing-page beacon
- Decision: include in cluster 18.x OR defer
- Estimate: ~30-50 LOC

### IS-15.x carryover items
- Smart default UX (IS-15.1)
- F4 advisory ramp (IS-15.2)
- Backend integration test (IS-15.3)
- Mobile responsive (IS-15.4) — may fold into cluster 18.x C UI refactor

---

## V. Active patterns post-cluster-17.x

**Patterns active:**
- Pattern #15 (frontend zero-dep, bounded break F4)
- Pattern #16 (backend mock Supabase)
- Pattern #19 (dogfood-as-falsifier)
- Pattern #20 (schema-aware fake fixtures)
- Pattern #25 (contrast sentinel both themes)
- Pattern #26 (no JS inline styles, class-based)
- Pattern #29 (graceful degradation)
- Pattern #34 (integration sentinel)
- Pattern #38 (`/goal` directive)
- Pattern #39 (persist truth = single source)
- Pattern #41 (DB-layer integrity)
- Pattern #42 (commission as hypothesis, Code authoritative)
- **Pattern #43 (Discovery-first multi-direction)** — Promoted to active post cluster 17.x validation

**Pattern #42 cumulative tally:**
- Cluster 14.x: ~21 errors / 17 sprints
- Cluster 15.x: ~13 errors / 7 sprints
- Cluster 16.x: ~12 errors / 8 sprints
- Cluster 17.x: ~20 errors / 6 sprints
- **Total: ~66 errors / 38 sprints ≈ 1.7/sprint baseline**

Cluster 17.x higher rate (~3.3/sprint) attributed to admin domain complexity + multi-direction + architectural mismatch. None silent.

---

## VI. Mind side recurring blind spots

**Honest enumeration cluster 17.x added:**

1. **Auth pseudocode habit** — Mind kept writing FastAPI `Depends(...)` despite repo header-based pattern. Sprint 17.1/17.2/17.3 recurring. Sprint 17.5 commission applied lesson: prose-only.

2. **Architectural premise check** — Sprint 17.3 students-table = Writing-Coach roster, not general user. Discovery scope gap. Lesson: ask "what domain concept does each table model" not just "what columns exist."

3. **Migration counter drift** — Sprint 17.4 specified 081 while reality was 080 (deferral). Lesson: track cumulative migration counter including deferrals.

4. **Frontend/backend concern boundary** — Sprint 17.4 mind specified frontend auth extraction; Code elevated backend-side cleaner. Lesson: separation of concerns wins over coupling.

5. **Atomic transaction assumption** — Sprint 17.5 commission spec'd transaction; Supabase SDK reality no transactions. Code elevated safe sequential. Lesson: verify SDK capability empirically before specifying atomicity.

**Pre-existing blind spots (cluster 16.x carryover):**

6. **Cross-file integration spec** — Mind specifies producer without reading consumer empirically
7. **Repo file paths** — Stale assumptions about directory structure
8. **Toolchain feasibility** — Mind assumes from sandbox-blind perspective
9. **Internal-logic-contradiction class** — Multiple spec elements logically incompatible

**Mitigation pattern:** Pattern #43 Discovery-first format catches majority of these upfront. Sprint 17.0 Discovery prevented 4 material + 1 latent errors.

---

## VII. Working style (Andy)

**Communication:**
- VN locale primary, EN technical OK
- 1-word answers honored ("defaults" most common cluster 17.x = 6 times)
- Concise responses preferred (Andy explicit "viết ngắn gọn dễ hiểu hơn" 2026-05-25)
- Empirical screenshots provided when relevant
- Architectural pivots accepted mid-cluster via revised commissions

**Decision making:**
- Mind recommends defaults explicit, Andy "defaults" common
- Andy himself adopting Discovery format (cluster 18.x kickoff)
- Cost concerns raised explicit
- Empirical > pre-emptive

**Sprint flow:**
- Andy fires Code via `claude --dangerously-skip-permissions`
- Code autonomous iteration
- Andy dogfood post-merge, empirical signal authoritative
- Mind drafts commission, Code PF authoritative

---

## VIII. Code side patterns (observed cluster 17.x)

**Strengths:**
- Architectural escalation discipline (Sprint 17.3 students-table)
- Code-side empirical elevation (auth backend-side, sequential ordering, single-path)
- Memory writes for context preservation
- CI verification consistent pre-merge

**Patterns Code introduced cluster 17.x:**
- Backend-side beacon attribution (cleaner separation)
- Code-derived membership model (Sprint 17.3 pivot)
- Safe sequential ordering > atomic transactions (Sprint 17.5)
- Load-all-by-design preserved (Sprint 17.1, avoided server-side pagination scope creep)

---

## IX. Critical files reference (post cluster 17.x)

**Admin panel architecture:**
- `frontend/pages/admin/{access-codes,usage,cohorts,foot-traffic,students}/index.html` — multi-page
- `frontend/js/admin-{access-codes,usage,cohorts,foot-traffic}.js` — per-feature modules
- `frontend/js/admin-codes-util.js`, `admin-usage-util.js` — pure utility modules
- `frontend/js/aver-admin-chrome.js` — admin nav registration
- `frontend/js/analytics-beacon.js` — page-view tracking (cluster 17.4)

**Backend admin endpoints:**
- `backend/routers/admin.py` — access codes endpoints
- `backend/routers/cohorts.py` — cohort management
- `backend/routers/admin_users.py`, `admin_students.py` — user management
- `backend/services/admin_overview.py` — aggregation helpers, `_safe_select` pattern

**Recent migrations:**
- 078 (Sprint 16.2): retention columns v1
- 079 (Sprint 16.2.1): retention v2 decouple
- 080 (Sprint 17.4): `analytics_events.user_id`
- 081 (Sprint 17.5): `user_code_assignments` audit cols

**Backend tests:**
- 1927 passing total
- 1 pre-existing spaCy lemmatizer flake (unrelated)

---

## X. Risk register (current)

1. **Cluster 16.x observation** — Sprint 16.4 went live, monitor sweep correctness 1-2 tuần
2. **Cluster 17.x observation** — Admin uses new panel, monitor regressions 1 tuần
3. **Cluster 18.x scope** — UI refactor design-heavy, Code authoritative (u1 default), mind side weak on visual design
4. **Mind side architectural premise** — Sprint 17.3 lesson, Discovery should validate domain models
5. **Multi-cluster parallel observation** — 16.x + 17.x both observing, attention split
6. **`analytics_events` volume growth** — Sprint 17.4 may trigger retention policy decision
7. **Writing-Coach cohort** — Deferred, may surface as empirical concern

---

## XI. Closure attestation

**Cluster 17.x feature-complete 2026-05-26.** Empirical motivation addressed. 5 directions A/B/C/D/E shipped functionally. 20 mind side spec errors honest-logged, none silent.

**Cluster 16.x went live 2026-05-26** per Andy explicit confirmation. RETENTION_SWEEP_DRY_RUN=false flipped. Observation period 1-2 tuần active.

**Cluster 18.x kickoff active 2026-05-26.** Andy defaults approved. Sprint 18.0 Discovery commission ready.

**Standby state:** Mind + Code + Andy ready for Sprint 18.0 Discovery execution + parallel observation periods 16.x + 17.x.

---

**END HANDOFF — PROJECT FULL — 2026-05-26.**
