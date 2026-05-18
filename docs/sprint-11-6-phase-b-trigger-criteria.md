# Sprint 11.6 Phase B — Trigger Criteria

**Status:** DEFERRED until trigger conditions met
**Cluster:** DEBT-LISTENING-MODULE (Phase B follow-on)
**Phase A closure:** Sprint 11.5 (2026-05-18) — module foundation complete

## Phase A recap (Sprints 11.0 → 11.5)

The Listening module shipped end-to-end across 5 sprints:

| Sprint | Scope | Closure |
|---|---|---|
| 11.0 | Discovery doc + data-model V2 (no code) | docs/sprint-11-0-listening-discovery.md |
| 11.1 | Migration 056 + 4 tables + RLS + chrome slot | PR #210 |
| 11.2 | Audio player web component + dictation MVP | PR #212 |
| 11.3 | Segmented dictation v2 (per falsification #62) | PR #213 |
| 11.3.1-hotfix | Sentence-boundary parser + char-proportional timestamps | PR #214 |
| 11.4 | Gist + True/False + ElevenLabs `/with-timestamps` alignment | PR #215 |
| 11.5 | MCQ + Mini Test + Content Browser + Analytics | PR #216 (this PR — **cluster CLOSED on merge**) |

At Phase A closure, the module covers all 5 IELTS Listening exercise types
(dictation, gist, true_false, mcq, mini_test) with admin authoring + user
surface + grading + per-user analytics. No piece is incomplete.

## Phase B deferred items + un-defer triggers

### B1 — ElevenLabs voice cloning (custom IELTS-trained voices)

**Deferred because:** Sprint 11.2 locked Sarah (US) + Alice (UK) as the
default ElevenLabs library voices. They are IELTS-passable but not
optimized for Cambridge-style elocution.

**Un-defer trigger:** ≥25 published listening_content rows AND user
feedback specifically flagging accent / clarity issues on ≥10% of
attempts. Voice cloning has a setup cost (sample recording + ElevenLabs
voice-creation flow) that's only justified at scale.

**Effort estimate:** ~6-8h (one voice clone setup + config wiring +
admin UI dropdown).

### B2 — Premium-tier paywall (`is_premium=true` gating)

**Deferred because:** Migration 056 ships the `is_premium BOOLEAN`
column and the NC-license incompatibility hard-block, but no user-side
gating fires today. Every published row reads as free-tier content.

**Un-defer trigger:** Stripe integration shipped (a separate cluster
DEBT-PAYMENTS not yet opened) AND at least 10 paying users on the
roster. Paywalling content before there's a payment system is wasted
work.

**Effort estimate:** ~4h (router gate on `is_premium=true` + tier
check on user record + frontend "Premium content" badge + upsell modal).

### B3 — Multi-instructor visibility (org/team scoping)

**Deferred because:** Andy Q4 lock (Sprint 11.0 §1Q4) — solo learner +
AI-as-teacher model. RLS is user-scoped only. Sharing a session_id
between instructor + student requires a sharing model that doesn't exist
elsewhere in the codebase.

**Un-defer trigger:** Discovery + design doc landed (Sprint 12.x or
later) for the broader multi-instructor model. Listening would inherit
the canonical sharing pattern, not invent its own.

**Effort estimate:** ~12-18h depending on sharing-model complexity.

### B4 — Mini-test AI insights (per-section breakdown)

**Deferred because:** `listening_sessions.ai_insights JSONB` exists
(migration 056) and the schema documents it as Sprint 11.5+. Sprint 11.5
ships the aggregate band + correct_count via `complete_listening_session`
but no per-section AI commentary. Andy Q3 lock (1-2 AI insights per
session) is achievable but adds an additional Anthropic call per mini-test
completion + grading-cost projection.

**Un-defer trigger:** ≥30 mini_test completions across the user base
AND user feedback specifically asking for actionable per-section
guidance. The current `weakest_mode` heuristic in `/analytics` covers
the cross-session weakness signal; per-session AI insights are
incremental.

**Effort estimate:** ~5-7h (background-task hook on
session-complete + Haiku prompt + persistence + frontend banner on
Mini Test summary screen).

### B5 — Real-time MCQ option shuffle (anti-cheat)

**Deferred because:** Sprint 11.5 MCQ payload stores options in
fixed order. Two students sharing answer indices (e.g. via Discord)
could exchange "answer is 2" without knowing the option text.

**Un-defer trigger:** Cheating-pattern detection in analytics (e.g.
correlated answer streaks across users) OR ≥100 published MCQ
exercises AND a paying-tier launch (cheating tax higher when revenue
is on the line).

**Effort estimate:** ~3-4h (option-shuffle helper on GET → user
sees options in their own order → answer mapped back to canonical
idx server-side before grading).

### B6 — Session pause/resume (long-running mini tests)

**Deferred because:** Sprint 11.5 Mini Test runner is linear — close
the tab and the session restart from question 1 on next visit. For
a 30-minute composite test this is friction.

**Un-defer trigger:** ≥3 user reports of lost mini-test progress OR
average mini-test length crosses 20 questions / >15 minutes.

**Effort estimate:** ~4-5h (localStorage checkpoint per step + resume
banner on session-page reload).

## Trigger review cadence

- **Weekly:** when new mini-test attempts roll in, glance at the
  weakest_mode distribution + content count to see if any B1-B5
  threshold trips.
- **Per-cluster:** when DEBT-PAYMENTS opens, B2 is auto-considered.
- **Per-incident:** if an Andy-noted user pain hits a B-item, escalate
  out of Phase B regardless of threshold.

## Phase B opening template

When a trigger fires:

1. Open a new PR `sprint-11-6-XXX` against `main`.
2. Reference this doc in the PR description by section number (e.g.
   "Un-defers B4 per trigger 30 mini_test completions").
3. Update PHASE_CLOSURE_LEDGER with a new `**Last updated:** Sprint
   11.6 ...` row and mark the relevant B-item closed in this doc.
4. Phase B follows the standard sprint discipline — falsifications
   captured in `docs/falsifications.md`, tests pinned, ledger row
   appended on ship.
