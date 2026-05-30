# Frontend Performance — Phase 2 Post-Implementation Addendum

**Status:** Companion to `discovery_frontend_performance_phase2.md`. Documents empirical confirmation of Phase 2 predictions via Sprint Perf-1 + Perf-2 post-merge production measurements.

**Source:** Production curl with authenticated JWT against `ielts-speaking-coach-production.up.railway.app`, 5x per endpoint.

**Date:** Post Perf-2 merge (commit `3915208f` on main).

---

## Confirmed delta — Reading exam boot (Sprint Perf-1 D2)

### Phase 2 prediction

```
Sequential baseline:
  /api/reading/test/AVR-READ-001      median 2.068s
  /api/reading/test/.../in-progress   median 1.786s
  Combined sequential                 ~3.854s

Combined endpoint predicted           ~2.07s (max of two)
Improvement predicted                 ~46%
```

### Post-implementation measured

```
GET /api/reading/test/AVR-READ-001/boot
  5x: 2.22s, 2.76s, 6.59s (outlier), 2.52s, 2.33s
  Median (excluding outlier): ~2.42s
  Range: 2.22s - 2.76s (typical)

Server-Timing breakdown (1 sample):
  total: 1650ms
  auth:   293ms (18%)
  db:    1352ms (82%) ← dominant
  app:     4ms  (0.2%)
```

### Verdict

- **Improvement confirmed: ~37%** (3.85s → 2.42s, saves ~1.43s per Reading exam boot)
- Slightly under prediction (~46% target) — backend executes DB queries sequentially within boot endpoint (no `asyncio.gather` parallelization). Latitude allowed in commission.
- **Tail latency observed:** 1/5 sample at 6.59s. Possible causes: Railway cold start, connection pool warm-up, transient backend load. Needs more samples to characterize.
- **Stage-attribution unlocked:** Reading boot is **DB-bound** (82% db). Future optimization target.

---

## Confirmed delta — Listening dictation boot (Sprint Perf-2 D1)

### Phase 2 prediction

```
Sequential baseline:
  /api/listening/content/{id}           median 1.425s
  /api/listening/exercises?dictation    median 1.571s
  Combined sequential                   ~2.996s

Combined endpoint predicted             ~1.6-1.8s
Improvement predicted                   ~40-47%
```

### Post-implementation measured

```
GET /api/listening/dictation/{content_id}/boot
  5x: 1.89s, 1.61s, 2.03s, 1.46s, 1.73s
  Median: 1.73s
  Range: 1.46s - 2.03s (tight, no outlier)

Server-Timing breakdown (1 sample):
  total: 1806ms
  auth:   292ms (16%)
  db:     612ms (34%)
  app:    901ms (50%) ← dominant (likely Cloudinary signed URL generation)
```

### Verdict

- **Improvement confirmed: ~42%** (3.0s → 1.73s, saves ~1.27s per Listening dictation boot)
- Sits in middle of prediction range (1.6-1.8s expected)
- **Tighter range than Reading** — no outlier; suggests Listening boot more stable under typical load
- **Stage-attribution different from Reading:** Listening boot is **app-bound** (50% app), likely Cloudinary signed URL HMAC. Optimization vector different from Reading.

---

## Cumulative impact

| Endpoint | Phase 2 baseline | Post-implementation | Delta | LOC | Risk |
|---|---|---|---|---|---|
| Reading exam boot | ~3.85s | ~2.42s | **-37%** | (PR #341 D2) | Medium |
| Listening dictation boot | ~3.00s | ~1.73s | **-42%** | (PR #343) | Low-medium |
| **Per student session** | — | — | **~2.7s saved** | combined | — |

Student opening 1 Reading exam + 1 Listening dictation per study session sees ~2.7s less wait.

---

## Phase 1 / Phase 2 hypothesis re-evaluation (post-implementation)

| Inference | Phase 1 verdict | Phase 2 verdict | Post-implementation verdict |
|---|---|---|---|
| API waterfall = real bottleneck | inferred | **CONFIRMED** (3.854s + 2.996s sequential) | **PROVEN** — eliminating waterfall via boot endpoint = 37-42% improvement |
| Auth gate per-request is THE bottleneck | inferred | PARTIAL (server-side cost, not client) | **REFINED FURTHER** — auth is ~16-18% of server work; db/app is 82-84% |
| Grammar fast = no-auth + in-memory | partial inference | mostly confirmed | Still confirmed (Grammar 1.03s baseline vs protected 1.65-1.80s server-side) |
| Server-side bottleneck attribution unknown | unknown | unknown (no instrumentation) | **REVEALED:** Reading = DB-bound (82%); Listening = app-bound (50%) |

---

## Insights for future Perf sprints

### Reading exam — DB-bound (82% db)

**Future Perf-N targets:**
- Parallelize DB queries within boot endpoint via `asyncio.gather` if Supabase async client supports
- Audit boot endpoint for N+1 query patterns (per-passage, per-question lookups)
- Index review on `reading_tests`, `reading_passages`, `reading_questions`, `reading_test_attempts`
- RLS overhead measurement (postgres role-check cost per query)

Expected impact if DB halves: 1.65s → ~1.0s total (additional ~30% improvement on top of Perf-1).

### Listening dictation — app-bound (50% app)

**Future Perf-N targets:**
- Profile `app` stage breakdown (Cloudinary HMAC signing? metadata processing? exercise transformation?)
- Cache signed audio URLs short-TTL (URLs may have fixed expiration policy → can reuse if not expired)
- Lazy-generate signed URLs only when audio actually requested (boot returns metadata, signed URL on-demand)

Expected impact if app halves: 1.80s → ~1.35s (additional ~25% improvement on top of Perf-2).

### Outlier investigation (Reading 6.59s)

- 1/5 samples (~20%) showed 6.59s on Reading boot
- Investigation needed: Railway logs (cold start frequency?), connection pool config, transient load
- If frequent: tail latency may be larger UX issue than median improvement
- Recommend: 30-100 sample size before drawing tail conclusions

---

## Lessons absorbed

1. **Server-Timing instrumentation was essential.** Phase 2 hypothesized "server-side cost" but couldn't attribute. Post-Perf-1 D1 unlocked stage-level data → future sprints data-driven instead of inferred.
2. **Pattern reuse worked.** Perf-2 leveraged Perf-1's combined-endpoint design + middleware → smaller sprint, faster turnaround, no architectural duplication.
3. **Per-endpoint bottleneck varies.** Reading DB-bound, Listening app-bound. **No single fix** applies — future sprints must measure per-endpoint before optimizing.
4. **Honest under-delivery on parallelization.** Codex chose serial DB queries within Reading boot (latitude). ~9% improvement gap from prediction. Future iteration may target this.

---

## Recommendation — Sprint Perf-3 and beyond

| Priority | Sprint | Scope | Expected impact | Risk |
|---|---|---|---|---|
| 1 | **Perf-3** | Public cache headers (Grammar + Vocab) + preconnect/dns-prefetch shared chrome | Broad, all-module preconnect; Grammar 2nd-load near-instant via ETag 304 | Low-medium |
| 2 | Perf-4 | Reading boot `asyncio.gather` DB queries | Additional ~30% on Reading | Medium |
| 3 | Perf-5 | Listening boot app-stage profiling + signed URL caching | Additional ~25% on Listening | Medium |
| 4 | Investigation | Reading tail latency (6.59s outlier) | TBD (may need Railway tier upgrade or connection pool tuning) | Investigation only |
| 5 | Defer | Writing assignments backend breakdown (Phase 2 flagged 2.656s, up to 4.1s) | Need Server-Timing data sample first | — |
| 6 | Defer | Speaking dashboard `/api/dashboard/init` breakdown (Phase 2 flagged 2.800s) | Same | — |

**Architectural changes (M1 module shell, A1 SPA, A2 service worker, A3 bundling) still DEFERRED** — Phase 2 data supports per-endpoint optimization rather than wholesale architectural rewrite. Revisit only if cumulative per-endpoint savings plateau.

---

**Authored:** Mind (chat orchestrator) synthesizing Andy's production curl measurements post Perf-1 + Perf-2 merges. Empirical, not inferred.
