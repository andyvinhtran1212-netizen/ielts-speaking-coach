# Private recording rollout evidence — 2026-09-09

## Code and deployed state

PR #1350 merged after nine green PR checks and no unresolved inline threads.
Runtime source is `f82e25a9a00d46300b566f8075e3799375e9956c` on both main and
staging. All six post-merge main workflows passed. Deployment statuses:

| Environment | Vercel | Railway | Result |
| --- | --- | --- | --- |
| Staging | 6342303087 | 6342297743 | success |
| Production | 6342294228 | 6342289654 | success |

Production root `data-release` matches this SHA. The authenticated staging
runtime endpoint independently confirms the same backend SHA.

## Staging access checks

Read-only metadata associated the chosen recording with the exact seeded
`e2e-student-smoke` identity, not a real learner. No recording path, signed URL,
token or audio content is retained in this report.

- [Pre-flip run 34310281207](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34310281207):
  owner audio endpoint and admin review work; nonowner 404, anonymous API
  request denied. Owner receives a signed URL and a one-hour TTL. The public
  object URL is still accessible at this pre-flip checkpoint.
- The bucket was changed through the Storage API with only `public: false`.
  File-size and MIME restrictions were compared before/after and preserved.
  Anonymous public HEAD is denied; a two-second signed URL works and is denied
  after expiry. Authenticated Storage download of the synthetic object works.
- [Post-flip run 34310508421](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34310508421):
  all ten checks pass on deployed backend SHA f82e25a9, including owner ranged
  playback/download, admin playback visibility, nonowner/anonymous denial,
  signed URL/TTL contract and anonymous public URL denial.

## Production access checks

After the staging checks passed, production received the same scoped bucket
change. A fresh 0.1-second silent WAV was generated in memory for the probe;
no real learner recording was downloaded or played.

- Normal service-role upload/download verified before changing the bucket.
- Anonymous public HEAD succeeded before the flip and was denied afterward.
- The audited `attach_playback_urls` helper, with production configuration,
  resolved both canonical-path and legacy-URL synthetic rows and generated
  playable signed links. Returned synthetic bytes matched the generated WAV.
- A two-second signed URL worked, then was denied after expiry.
- Authenticated Storage download still worked with the bucket private.
- The exact newly created synthetic object was removed and its absence checked.
  No original object, learner response, score or association was altered.
- Final READ ONLY query at approximately 04:29 UTC: `audio-responses.public`
  is false, 7,597 original objects remain, zero objects remain under the probe
  namespace. Limits/MIME configuration was preserved.

Scope distinction: production checks exercised Storage and the audited signing
helper with synthetic data; owner/admin HTTP authorization was exercised on
staging with the same deployed code. No production learner impersonation or
mass real-recording download was used. These checks do not claim an audit of
all historical third-party access or erase the earlier public-bucket exposure.

## Gate E continuation

The final-release batch begins with
[run 34311013766](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34311013766).
Its completed result is canonical **1/20**, not Gate E completion: attempt 1,
33 passed + one exact whitelisted skip, zero unexpected/flaky tests, project
counts 28/2/2/2, and matching frontend/backend provenance. The ledger confirms
`failure_matrix_complete: true` and `real_devices_complete: true`, while
`threshold_met` and `gate_e_evidence_eligible` are still false. Both buckets
were already private before dispatch. Keep source f82e25a9 and v20 manifest digest
`0f2079dc6d440119af53b03faee1b2d54884f1510ac9b2c713fc957fa8738e0a` unchanged.

The app initially created an ACTIVE temporary batch heartbeat
`ho-n-t-t-20-l-t-gate-e`, every five minutes, on the existing task. It is the
same-task dispatcher after the initial run: the active goal turn continues
the batch while working, and the heartbeat takes over when the task is woken.
Do not create a parallel dispatcher. It must wait for the current run,
validate canonical ledger/provenance/raw report, and dispatch only one next
run when eligible. Stop on any failed/retried/cancelled/drifted run. Do not
count previous releases, diagnostic jobs or a mere green conclusion toward
the streak. The existing GitHub four-daily schedule is unchanged; any scheduled
run that interleaves belongs to the canonical history and must not be skipped.

After rechecking main/staging pins and the absence of pending runs, the task
dispatched [run 34312184940](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34312184940).
Its completed canonical ledger confirms **2/20**, with no continuity reset,
matching pinned provenance, attempt 1, 33 passed + the exact one whitelisted
skip, zero unexpected/flaky tests, project counts 28/2/2/2 and no test retries.
Paginated workflow history from the first final-batch run contained exactly
these two successful runs (run numbers 203 and 204), with no omitted run.

The task then dispatched [run 34312883508](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34312883508).
Its completed ledger and raw report confirm **3/20**, with no retry, flake,
unexpected test, continuity reset or release drift. Paginated GitHub history
matches exactly the three runs numbered 203–205. The same read-only verifier
was checked against all three downloaded raw reports and ledgers.

The task then dispatched [run 34313695828](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34313695828).
Its completed ledger and raw report confirm **4/20**, with no retry, flake,
unexpected test, continuity reset or release drift. Paginated GitHub history
matches exactly runs 203–206, all successful on attempt 1 and pinned SHA f82e25a9.

Latest verified checkpoint: **8/20**, ending at
[34316560650](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34316560650).
All eight raw reports, provenance artifacts and ledger increments were checked;
GitHub history contains exactly runs 203–210, success on attempt 1, pinned source,
zero flaky/unexpected tests and no continuity reset after the initial seed.

### Batch stopped on run nine — canonical streak 0/20

[34317212151](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34317212151)
failed: 32 passed, one expected skip and one unexpected failure, no retries or
flakes. Provenance still matches f82e25a9 on both layers. The canonical reset
ledger records **0/20**, not 8/20 or partial credit toward a later batch.

The failed test is `speaking-start-flow.spec.js:186`: missing-topic validation
appeared and no session POST occurred, but the page then navigated from
`/speaking` to `/login`. This is different from the earlier profile-load timeout.
No tenth run or rerun was dispatched. The exact temporary batch heartbeat was
deleted through the app after failure; the GitHub four-daily schedule and all
other schedules remain unchanged.

Root-cause hypothesis under verification: Speaking waits for `window.api.get`
to exist, but the shell initializes the Supabase client in a later effect.
`api.js::_getAuthToken` returns null when that client does not yet exist; the
resulting unauthenticated protected read can return 401 and redirect to login.
The diagnostic branch now compares four baseline journeys with four journeys
delaying client initialization by 750 ms. It blocks all app API writes, records
only authorization-presence booleans and sanitized timings/statuses, and is
not Gate E evidence. No product patch is claimed complete at this checkpoint.

### Completion-criteria cross-check

The real-device pair artifact from run `32227093444` was downloaded again:
`ok: true`, `github_runs_verified: true`, `errors: []`, source
`3dce244f51ee2ae221d8a55a1facb23f99119070`, matching device runs `32225845849`
and `32226876978`. GitHub still reports all three runs successful. These are
historical real-device evidence, not emulation or additional final-batch runs.

The terminal live-drill runs for Speaking (`32047774312`), Reading
(`32076013600`), Listening (`32095451591`), Dictation (`32108579377`) and Writing
(`32128868942`) were independently checked against GitHub and remain successful.
Their three-phase scope/provenance is recorded in
`docs/GATE_E_PREFLIGHT_2026-08-09.md`; they do not contribute to the 20-run count.

The historical profile-load timeout remains recorded, with 16 subsequent
diagnostic loads successful but no proven causal fix. The requested 20 clean
runs are not complete yet, and no Gate F elapsed-time completion is implied.
