# HANDOFF — PROJECT FULL (Post Cluster 18.x Closure 2026-05-26)

**Last update:** 2026-05-26 post cluster 18.x feature-complete + closure artifacts drafted
**Previous handoff:** HANDOFF_PROJECT_FULL_2026_05_26.md (post cluster 17.x closure)
**Cluster 18.x retrospective:** See `CLUSTER_18_X_RETROSPECTIVE.md`
**Cluster 17.x retrospective:** `CLUSTER_17_X_RETROSPECTIVE.md`
**Cluster 16.x retrospective:** Pending observation period completion
**Phase B backlog:** See `PHASE_B_BACKLOG_2026_05_26_POST_18.md`

---

## I. Project state snapshot

**Application:** IELTS Speaking Coach (averlearning.com)
**Tech stack:** FastAPI backend (Railway Pro $20/mo) + vanilla JS frontend (**Vercel**, production confirmed empirical) + Supabase Pro $25/mo
**External services:** OpenAI Whisper (STT), Anthropic Claude (grading), Azure Speech (pronunciation)
**Total monthly baseline:** ~$45 (Supabase Pro + Railway Pro)

**Deploy infrastructure correction (Pattern #42 cluster-level error):**
- Discovery 17.0 claimed "GitHub Pages, NOT Vercel" — empirically WRONG
- Codex audit cluster 18.x confirmed: production averlearning.com served by Vercel
- `Server: Vercel`, `X-Vercel-Cache` headers verified
- Code memory updated 2026-05-26 to correct claim
- vercel.json IS active, deploys auto from main branch

**Current production state (post-#306 merge):**
- Practice + result pages có phoneme drill-down accordion (cluster 15.x)
- Retention lifecycle live: audio 15d strict + content 60d activity-extended (cluster 16.x live 2026-05-26)
- Admin panel cluster 17.x: codes UI + usage log + cohort mgmt + foot traffic + reassignment
- Admin panel cluster 18.x: IA tabbed + Dashboard 6-metric + UI components + structural toolbar + students chrome migration

**Backend tests:** 1949 passing (1 pre-existing spaCy lemmatizer flake)
**Frontend tests:** 929 passing
**Migrations:** Latest = 081 (Sprint 17.5 audit columns)

---

## II. Cluster summary table

| Cluster | Theme | PRs | LOC prod | Status |
|---|---|---|---|---|
| 14.x | (Various features) | 16 PRs | Large | ✅ Closed |
| 15.x | DEBT-PRONUNCIATION-ACTIONABLE | 7 (#276-#282) | ~2,170 | ✅ Closed |
| 16.x | STORAGE-LIFECYCLE-AND-EXPORT | 8 (#283-#290) | ~1,100 | ✅ Feature-complete, live, observation |
| 17.x | ADMIN-PANEL-CONSOLIDATION | 6 (#291-#296) | ~1,962 | ✅ Feature-complete, observation |
| 18.x | ADMIN-PANEL-REFINEMENT | 10 (#297-#306) | ~1,500 | ✅ Closed, observation |

---

## III. Open standing items

### Cluster 16.x observation (2026-05-26 → ~2026-06-09)
- Sprint 16.4 retention sweep live
- Verify storage usage decreasing
- Verify aggregate scores preserved
- Verify no P0/P1 regressions

### Cluster 17.x observation (2026-05-26 → ~2026-06-02)
- Admin uses new panel
- Verify no P0/P1 regressions across A/B/C/D/E directions

### Cluster 18.x observation (2026-05-26 → ~2026-06-02)
- Admin uses new refined panel (tabbed IA + dashboard + components + 2-row toolbar)
- Final closure attestation post-observation

### IS-18.2 — Admin browser-runtime test coverage (NEW Phase B)
- Codex P2 finding
- ~200-400 LOC Playwright harness
- Trigger: regression frequency

### IS-17.1 — Anonymous landing-page beacon
- Defer Andy decision OR fold into future cluster

### IS-15.x carryover items
- Smart default UX (IS-15.1)
- F4 advisory ramp (IS-15.2)
- Backend integration test (IS-15.3)
- Mobile responsive main app (IS-15.4)

---

## IV. Active patterns post-cluster-18.x

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
- Pattern #43 (Discovery-first multi-direction) — Validated 3rd cluster
- **Pattern #45 (Independent AI audit when N≥3 fixes fail)** — NEW, promoted active post cluster 18.x

**Pattern #42 cumulative tally:**
- Cluster 14.x: ~21 errors / 17 sprints
- Cluster 15.x: ~13 errors / 7 sprints
- Cluster 16.x: ~12 errors / 8 sprints
- Cluster 17.x: ~20 errors / 6 sprints
- Cluster 18.x: ~12 errors / 10 sprints
- **Total: ~78 errors / 48 sprints ≈ 1.6/sprint baseline maintained**

Cluster 18.x had 1 UNIQUE error class: **anchored pattern-matching across 3 sprints**. Not counted in per-sprint metric but high-impact lesson driving Pattern #45 promotion.

---

## V. Mind side recurring blind spots

**Cluster 18.x added/reinforced:**

1. **Anchored pattern-matching across sprints** (NEW BIG LESSON) — Mind + Code stayed in "selector micro-fix" diagnostic frame 3 sprints. Pattern #45 = structural mitigation via independent AI audit.

2. **Deploy infra claims unchecked** — Discovery 17.0 said "GitHub Pages" — wrong. Production = Vercel. Codex caught. Lesson: empirical verification of infra before commission reference.

3. **External file path references unreachable** — `/mnt/skills/`, `/mnt/user-data/outputs/` paths Code can't reach. Pattern: paste content inline OR repo paths only.

4. **Misread Andy tool naming** — "codex" misread as "code" 1 time. Acknowledged honest.

**Pre-existing blind spots (active):**

5. Cross-file integration spec
6. Repo file paths drift
7. Architectural premise check (Sprint 17.3 lesson)
8. Migration counter drift
9. Frontend/backend concern separation

**Mitigation strategies validated:**
- Pattern #43 Discovery-first catches majority upfront
- Pattern #45 independent AI audit breaks anchored frames
- Code PF-empirical authoritative corrects false commission premises
- Skill content paste inline pattern (cluster 18.x lesson)

---

## VI. Working style (Andy)

**Communication:**
- VN locale primary, EN technical OK
- 1-word answers honored ("defaults" most common)
- Concise responses preferred (Andy explicit "viết ngắn gọn dễ hiểu hơn" 2026-05-25)
- Empirical screenshots provided when relevant
- Architectural pivots accepted mid-cluster

### 🔒 HARD REQUIREMENT — Naming convention (Andy 2026-05-26)

- **"Mình"** = Claude chat (this assistant, draft commissions, communicate với Andy)
- **"Code"** = Claude Code CLI (autonomous executor trên máy Andy)
- **"Codex"** = OpenAI Codex CLI (independent AI reviewer, used cluster 18.x for audit)
- KHÔNG dùng "Mind" trong chat responses
- Closure artifacts + handoff documents có thể dùng "mind side" như technical term (reference docs)

### 🔒 HARD REQUIREMENT — Post-Sprint Report Format (Andy 2026-05-26)

**Mỗi lần Code/Codex ship sprint xong, mình PHẢI trả lời theo đúng 3 sections sau:**

**1. Code đã làm gì (ngắn gọn)**
- 2-4 câu mô tả thực tế những gì shipped
- Không pseudocode, không kỹ thuật thừa
- LOC + PR number cho reference

**2. Điểm mạnh / Điểm yếu / Rủi ro**
- Điểm mạnh: 2-3 bullets cụ thể
- Điểm yếu: mind side errors honest-log (Pattern #42), không gói gọn
- Rủi ro: production impact, UX disruption, kỹ thuật debt

**3. Andy cần làm gì tiếp theo**
- Dogfood steps cụ thể nếu cần (5-10 phút checklist)
- Decision points: trình bày options dạng table, mind recommend explicit
- Câu trả lời format ngắn (s1/s2/defaults...)

**Cấm:**
- Lan man về Pattern #42 ledger cumulative tally trừ khi Andy hỏi
- Lặp lại context Andy đã biết
- Pseudocode trong response (chỉ trong commission files)
- Technical jargon không cần thiết cho Andy decide

**Lý do:** Andy là product owner, không phải engineer. Cần biết what/why/next-step, không cần biết how. Technical details thuộc về commission files + Code's PR body.

Closure ceremonies + cluster retrospectives vẫn detailed (reference docs).

**Decision making:**
- Mind recommends defaults explicit, Andy "defaults" common
- Andy himself adopting Discovery format (cluster 18.x kickoff)
- Andy commissioned Codex audit (Pattern #45 validation from product owner)
- Cost concerns raised explicit
- Empirical > pre-emptive

**Sprint flow:**
- Andy fires Code via `claude --dangerously-skip-permissions`
- Code autonomous iteration
- Andy fires Codex via `codex --dangerously-skip-permissions` (independent audit when needed)
- Andy dogfood post-merge, empirical signal authoritative
- Mind drafts commission, Code/Codex PF authoritative

---

## VII. Code side patterns (observed cluster 17.x + 18.x)

**Strengths:**
- PF-empirical authoritative consistent
- Scope decision discipline (Sprint 18.1 cross-chrome deferred per risk)
- Hybrid strategy elevation (Sprint 18.3.2 preserve proven JS)
- Memory writes for context preservation
- CI verification consistent pre-merge
- Honest about anchored pattern-matching when surfaced

**Patterns Code introduced cluster 18.x:**
- Hybrid migration strategy (Sprint 18.3.2 — preserve proven inline JS, swap chrome shell only)
- Safe sequential ordering > atomic transactions (cluster 17.5 lesson preserved)
- Code-derived membership model (Sprint 17.3 m1 lesson preserved)

---

## VIII. Codex side patterns (observed cluster 18.x)

**Strengths:**
- Independent diagnostic frame
- Empirical-first approach (curl deployed, diff vs repo, full cascade)
- Critique of prior approach honest + constructive
- Alternative hypotheses ranked by likelihood
- Bonus discovery (P3 test rot Code missed)

**Use case:**
- Cluster-level audits when N≥3 fixes fail (Pattern #45)
- Pre-closure audit before final dogfood (Sprint 18.3.2 audit case)

---

## IX. Critical files reference (post cluster 18.x)

**Admin panel architecture:**
- `frontend/pages/admin/{access-codes,usage,cohorts,foot-traffic,students,dashboard,system}/index.html` — 7 admin pages
- `frontend/js/admin-{access-codes,usage,cohorts,foot-traffic,dashboard,users,students}.js` (or inline) — per-feature modules
- `frontend/js/admin-codes-util.js`, `admin-usage-util.js` — pure utility modules
- `frontend/js/components/aver-admin-chrome.js` — shadow DOM chrome (custom element)
- `frontend/js/analytics-beacon.js` — page-view tracking
- `frontend/css/aver-design/tokens.css` — av-* design tokens
- `frontend/css/aver-design/admin-components.css` — shared admin components (Sprint 18.3+)

**Backend admin endpoints:**
- `backend/routers/admin.py` — access codes endpoints
- `backend/routers/cohorts.py` — cohort management
- `backend/routers/admin_users.py`, `admin_students.py` — user/student management
- `backend/routers/admin_overview.py` — content aggregation
- `backend/services/admin_dashboard.py` (Sprint 18.2) — 6-metric overview
- `backend/services/admin_overview.py` — `_safe_select` pattern, batched aggregation

**Migrations (latest 081):**
- 078 (Sprint 16.2): retention columns v1
- 079 (Sprint 16.2.1): retention v2 decouple
- 080 (Sprint 17.4): `analytics_events.user_id`
- 081 (Sprint 17.5): `user_code_assignments` audit cols

**Tests:**
- Backend: 1949 passing (1 pre-existing spaCy flake)
- Frontend: 929 passing
- Cluster 18.x added ~50 frontend sentinels

---

## X. Risk register (current)

1. **Cluster 16.x observation** — Sprint 16.4 went live, monitor 1-2 tuần
2. **Cluster 17.x observation** — Admin uses new panel, monitor 1 tuần
3. **Cluster 18.x observation** — Newly closed, monitor 1 tuần
4. **Anchored pattern-matching risk** — Pattern #45 mitigation active (independent AI audit available)
5. **Multi-cluster parallel observation** — 16.x + 17.x + 18.x all observing, attention split
6. **`analytics_events` volume growth** — Sprint 17.4 may trigger retention policy decision
7. **Writing-Coach cohort** — Deferred, may surface as empirical concern
8. **Admin browser-runtime test gap** — Source-scan only, IS-18.2 Phase B

---

## XI. Closure attestation

**Cluster 18.x feature-complete + closure artifacts drafted 2026-05-26.**

10 sprints (3 feature directions A/B/C + 4 hotfixes + 1 chrome migration + 1 Codex audit + 1 structural fix), ~1,500 LOC production. Pattern #45 (independent AI audit) NEW promoted active. Anchored pattern-matching lesson explicit. 12 mind side spec errors honest-logged, including cluster 17.x deploy infra claim correction (GitHub Pages → Vercel).

**Cluster 16.x went live 2026-05-26** per Andy explicit confirmation.

**Cluster 17.x feature-complete 2026-05-26.** Observation ongoing.

**Cluster 18.x closure artifacts drafted 2026-05-26.** Final closure attestation pending observation 1-2 tuần.

**Standby state:** Mind + Code + Codex + Andy ready for next cluster theme decision OR parallel observation completion.

---

**END HANDOFF — PROJECT FULL — 2026-05-26 (post cluster 18.x closure).**
