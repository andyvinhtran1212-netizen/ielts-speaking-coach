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
Its result is pending at this checkpoint. Both buckets were already private
before dispatch. Keep source f82e25a9 and v20 manifest digest
`0f2079dc6d440119af53b03faee1b2d54884f1510ac9b2c713fc957fa8738e0a` unchanged.

The app created an ACTIVE temporary batch heartbeat
`ho-n-t-t-20-l-t-gate-e`, every five minutes, on the existing task. It is the
sole dispatcher after the initial run: it must wait for the current run,
validate canonical ledger/provenance/raw report, and dispatch only one next
run when eligible. Stop on any failed/retried/cancelled/drifted run. Do not
count previous releases, diagnostic jobs or a mere green conclusion toward
the streak. The existing GitHub four-daily schedule is unchanged; any scheduled
run that interleaves belongs to the canonical history and must not be skipped.

The historical profile-load timeout remains recorded, with 16 subsequent
diagnostic loads successful but no proven causal fix. The requested 20 clean
runs are not complete yet, and no Gate F elapsed-time completion is implied.
