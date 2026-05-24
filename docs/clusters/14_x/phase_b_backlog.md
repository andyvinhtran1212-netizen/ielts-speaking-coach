# Cluster 14.x — Phase B Backlog

**Status:** Active — items deferred during cluster 14.x, consolidated at closure (Sprint 14.9, 2026-05-24)
**Source:** discovery.md §7, per-sprint "Not in scope" sections, and the Codex audit deferrals.

> Triggers are written so each item has a concrete reopen condition rather than
> rotting silently (the failure mode Sprint 14.6.5 hit with deferred light-theme
> panels). Cross-cluster Phase B audit happens at each cluster-closure ritual.

---

## P1 — important, has a clear trigger

### Cambridge descriptor legal review
- **Origin:** discovery §3, Sprint 14.5.
- **Trigger:** MVP launch + first paying user, OR pre-Series-A diligence.
- **Notes:** rubric ships paraphrased descriptors in good faith (production prompt has shipped this way for months). Estimated legal opinion ~$200–500.

### Codex F4 — persisted-result browser/integration test
- **Origin:** Sprint 14.8.1 (Andy chose source-scan + mocked over jsdom).
- **Trigger:** repo invests in jsdom/Playwright + a Postgres CI service, OR a new persistence regression slips past source-scan sentinels.
- **Notes:** F1 is currently covered by persisted-render source-scan sentinels + dogfood. Sufficient for solo-dev velocity; a real reload integration test would close the residual gap.

---

## P2 — worth doing, no urgent trigger

- **Off-topic judge → score coupling** (discovery §7; Andy lock). Trigger: 2 weeks dogfood after 14.7, false-positive rate ≤ 5%.
- **Grammar-checker → band-weight coupling** (discovery §7 / D4 Phase B). Trigger: 2 weeks dogfood after 14.8; if checker hits correlate with Claude GRA drops.
- **Sprint 14.5 v2 structured feedback schema.** Deferred indefinitely — 14.5.1 coaching aggregation closed the empirical gap; reopen only if feedback-specificity is observed lacking.
- **F7 systematic first-try-CI measurement** — reworded at closure; an artifact-generation script is optional Phase B.
- **`updated_at` column on `responses`** — Sprint 14.8.2 finding; the atomic upsert deliberately omits it. Low priority.
- **Atomic-upsert audit of other write paths** — 14.8.2 made one endpoint atomic; sweep the rest.

---

## P3 — cluster 15.x candidates (Andy decides scope)

- Grammar Mindmap UI revival (original 14.x framing, pivoted away).
- SRS / spaced-repetition review queue for logged grammar errors.
- Per-user progress tracking dashboard (band trend, weakness tracking).
- Cost-based / config-driven provider routing (vs current Haiku-first).
- Off-topic verdict caching (currently recomputed per submission).
- Per-question criterion bands on multi-question sessions.
- Mobile light-theme spot-check (deferred Sprint 14.6.5).
- Audio reanalysis for old sessions.
- Admin re-grade UI polish (functional today).
- Infra: jsdom/Playwright + Postgres CI; scripted pre-deploy migration verification; cache-invalidation tooling.
- Tailwind CDN → PostCSS build (Sprint 14.6.3 console-warning finding).

---

## Resolved within cluster 14.x (items first raised as Phase B, then closed)

| Item | Raised | Closed |
|---|---|---|
| Pronunciation panel light theme (practice page) | 14.6.1 | 14.6.5 |
| Grammar Resources panel light theme | 14.6.1 | 14.6.5 |
| Q-mode toggle light theme | 14.6.1 | 14.6.5 (no-op — toggle already permanently hidden) |
| Cue-card inline single-line detection | 14.4 | 14.6.4 |
| Cue-card endpoint base-URL | 14.4 | 14.6.3 |
| Signal persistence | (Codex F1) | 14.8.1 |
| Response idempotency | (Codex F3) | 14.8.1 + 14.8.2 |
| Grammar runtime smoke probe | (Codex F5) | 14.9 |
| Closure artifacts + CI-claim accuracy | (Codex F6/F7) | 14.9 |

This pattern (defer → empirical hit → close) is itself a lesson: deferred items
need explicit reopen triggers, audited at closure.
