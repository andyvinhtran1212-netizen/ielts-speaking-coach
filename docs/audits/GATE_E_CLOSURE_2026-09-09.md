# Gate E closure — 2026-09-09

**Gate E: PASS.** The canonical twentieth run
[34337714920](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34337714920)
completed successfully at **10:07:03 UTC**. This closes the requested staging
sync, recording-storage remediation and 20-consecutive-clean-run evidence.
The temporary batch heartbeat has also been deleted following explicit owner
authorization, completing the administrative cleanup detailed below.

## Frozen release and independent reconciliation

- Source, staging frontend and staging backend:
  `17159ba0eaa8a2e889f981ba49abfe43101d0601`.
- Main and staging branch heads independently read back at that exact SHA.
- Suite `gate-e-critical-suite-v20`, matrix `gate-e-device-matrix-v1`.
- Manifest digest:
  `0f2079dc6d440119af53b03faee1b2d54884f1510ac9b2c713fc957fa8738e0a`.
- All **47 frozen-file hashes** checked against the manifest. No threshold,
  frozen test, whitelist or manifest was changed to finish this batch.
- All **20 raw reports**, **20 provenance reports** and each ledger increment
  were re-read locally and reconciled against paginated GitHub workflow history.
  The global history contains exactly runs **212–231**, all completed successfully
  on attempt **1**, with no missing/interleaving failed run or later pending run
  at the closure check. The scheduled fifth run is included, not omitted.
- **680 live-suite test records:** 660 passed and 20 exact allowed skips.
  Each run has 34 records, project counts **28/2/2/2**, zero unexpected failures,
  zero flakes and zero retries. The sole per-run skip is the frozen grammar
  modal case whose trigger is intentionally absent for the seeded learner.
- The final canonical ledger confirms all four fields are true:
  `threshold_met`, `gate_e_evidence_eligible`, `failure_matrix_complete`,
  `real_devices_complete`.

Canonical artifacts on the final run: `gate-e-streak-ledger-34337714920-1`,
`gate-e-staging-provenance-34337714920-1`, `gate-e-device-matrix-34337714920-1`,
the four domain failure-matrix artifacts, and
`gate-e-live-staging-failure-34337714920-1`. GitHub retains these artifacts for
30 days; this document preserves the run index and verified findings, not a
substitute for the original reports.

## Requirement-by-requirement Gate E audit

Source: [migration master plan, section 16](../FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md).

| Requirement | Verified evidence | Result |
| --- | --- | --- |
| Versioned Safari/iOS/Chromium matrix | Current frozen automated matrix and reports; historical real-device Safari run `32225845849`, iOS run `32226876978`, pair `32227093444`. Pair JSON re-read: `ok=true`, `github_runs_verified=true`, no errors. All three GitHub runs independently confirmed successful. | PASS |
| Reload/resume, ambiguous commit, partial persistence, bidirectional cross-version | Final Speaking **49**, Reading **12**, Listening/Dictation **36**, Writing **12** failure cases validated against their frozen manifests, including required titles/project counts where specified. Each JSON result passed once with retry zero; all four HTML report archives are complete. The final live-staging fault case committed once, reconciled once, and backend/client/canonical response IDs match. No production egress or browser errors in that evidence. | PASS |
| Sticky active-session or drain strategy drilled | Historical three-phase live drills for Speaking, Reading, Listening, Dictation and Writing are recorded in the preflight evidence. All **15 phase runs** independently rechecked successful. See index below. | PASS |
| At least 20 consecutive clean critical-suite executions, frozen thresholds and full failure matrix | All 20 reports and ledger increments reconciled with global GitHub history and exact releases; final eligibility flags true; zero retry/flake/unexpected failure. | PASS |

The real-device and three-phase drills are historical prerequisites, not new
run credit. WebKit emulation is not presented as a substitute for real devices.
Historical drill retries are explicitly separate from the attempt-1-only
20-run batch. Detailed scope, source-versus-dispatch SHA and provenance are in
[real-device evidence](../GATE_E_REAL_DEVICE_EVIDENCE_2026-08-19.md) and
[preflight drill evidence](../GATE_E_PREFLIGHT_2026-08-09.md).

| Historical surface | Phase 1 | Phase 2 | Phase 3 |
| --- | --- | --- | --- |
| Speaking | 32043317793 | 32045284608 | 32047774312 |
| Reading | 32060549833 | 32072244886 | 32076013600 |
| Listening | 32084645112 | 32093601359 | 32095451591 |
| Dictation | 32103908150 | 32106478117 | 32108579377 |
| Writing | 32121670793 | 32126575888 | 32128868942 |

## Exact qualifying run index

All rows are attempt 1, success, identical pinned source/frontend/backend and
manifest digest. Only row 5 is a scheduled execution; others are manual dispatch.

| Count | Workflow number | Run |
| --- | --- | --- |
| 1 | 212 | [34321114153](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34321114153) |
| 2 | 213 | [34322033064](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34322033064) |
| 3 | 214 | [34322852572](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34322852572) |
| 4 | 215 | [34323671178](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34323671178) |
| 5 | 216 | [34323933527](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34323933527) |
| 6 | 217 | [34325323586](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34325323586) |
| 7 | 218 | [34326169542](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34326169542) |
| 8 | 219 | [34327037273](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34327037273) |
| 9 | 220 | [34327937395](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34327937395) |
| 10 | 221 | [34328774128](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34328774128) |
| 11 | 222 | [34329685727](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34329685727) |
| 12 | 223 | [34330565568](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34330565568) |
| 13 | 224 | [34331486555](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34331486555) |
| 14 | 225 | [34332269051](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34332269051) |
| 15 | 226 | [34333197167](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34333197167) |
| 16 | 227 | [34334099077](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34334099077) |
| 17 | 228 | [34335011348](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34335011348) |
| 18 | 229 | [34335922415](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34335922415) |
| 19 | 230 | [34336818728](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34336818728) |
| 20 | 231 | [34337714920](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34337714920) |

The previous eight-run batch then failed and reset to zero; none of it is
counted above. The Speaking auth-bootstrap race was causally reproduced,
patched in [PR #1351](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1351),
independently reviewed by Claude, deployed, and verified with the identical
8-journey baseline/delayed-client diagnostic before this batch started.
See [restart/remediation evidence](GATE_E_RESTART_AFTER_AUTH_FIX_2026-09-09.md).

## Staging and recording-storage closure

- Staging synchronized to the exact main release; final authenticated
  provenance proves source/frontend/backend/ref/environment agreement.
- At approximately **10:05 UTC**, staging and production readiness returned
  OK for the database and all **14 critical table projections**. This is the
  readiness endpoint's declared scope, not a claim to audit every database row.
- Production frontend runtime marker independently matched the pinned SHA.
- Both `audio-responses` buckets remain **private**. Read-only metadata shows
  **79** staging objects and **7,597** production objects, with **zero** remaining
  synthetic probe objects. No original learner recording or row was deleted,
  moved or backfilled by this task.
- Owner/admin playback, nonowner/anonymous denial, signed-link TTL and legacy
  path resolution were verified during the rollout. Production tests used a
  newly created silent synthetic WAV and the audited signing helper, not real
  learner audio; owner/admin HTTP authorization was exercised on staging.
  Detailed boundaries: [private-audio rollout](PRIVATE_AUDIO_ROLLOUT_2026-09-09.md).

## Completed administrative cleanup and scope boundary

The temporary five-minute heartbeat
`ho-n-t-t-gate-e-sau-s-a-x-c-th-c` has been **deleted** through the app's
automation tool after the owner explicitly authorized “xóa lịch tạm”.
Read-back confirmed its local automation metadata is absent. Earlier deletion
attempts were denied pending that authorization; no indirect pause, file edit
or alternate deletion route was used. No further manual run was dispatched.

The GitHub four-daily schedule and all other schedules are untouched.
Gate F elapsed-time/retirement requirements are separate: this audit does not
claim a new Gate F soak has elapsed or authorize additional retirement work.
