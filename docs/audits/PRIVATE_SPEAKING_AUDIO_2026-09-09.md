# Private Speaking audio — preparation, not production closure

## Status

Patch on `codex/private-speaking-audio-2026-09-09`, based on merged
PR #1349 (`4eb2a9ab6ea58d77992a8a183b375cddc3facb8a`). This is code preparation,
not evidence of deployment or a private bucket. No bucket setting, storage
policy, learner row or object was changed; no learner audio was downloaded.
**F05 remains open until the private-bucket rollout is verified.**

## Validated scope

Read-only production metadata, 2026-09-09:

- `audio-responses` is still public, with 7,597 objects.
- 7,452 response rows: 7,385 have canonical object paths, 58 only have legacy
  URLs, 9 have neither. All 7,385 canonical references resolve to objects.
- All 58 URL-only references belong to the configured production Supabase
  origin and correct bucket, contain no encoded paths, and resolve to objects.
- No `storage.objects` policy was found granting reads on this bucket.
- Counts are a point-in-time inventory, not a retention/deletion authorization.

## Root cause and minimal changes

**Severity: Medium, privacy priority (F05); compatibility risk during rollout.**
The public bucket bypasses owner/admin authorization. Signing a URL while the
bucket remains public does not restrict access to its public URL. Older reads
also fell back to persisted public URLs on signing failure; legacy URL-only
rows were not playable in admin or usable for retranscription via object path.
This confirms an access-control configuration gap, not evidence of third-party
access or a demonstrated leak of learner audio content.

- `backend/services/recording_audio.py::recording_path`: canonical path first;
  legacy recovery only on configured HTTPS origin and the exact bucket. Reject
  traversal, ambiguous encoding, control characters and foreign URLs. The
  helper accepts server-loaded rows only, after endpoint authorization.
- `attach_playback_urls`: batch-sign in worker threads, one-hour TTL, mask
  persisted URLs before signing, expose lookup failure separately from absent
  recording. Never restore a public URL after a signing error.
- `routers/grading.py::grade_response_endpoint`: persist successful upload's
  object path, not public/expiring URL. Preserve the path in core-row fallback.
  Uses existing migration 001; no schema migration or URL backfill required.
- `routers/sessions.py::get_session/get_session_audio_urls`: existing ownership
  checks remain first. Sealed detail does not sign hidden rows. Dedicated audio
  endpoint retains successfully signed items if another object fails, and
  reports 503 if referenced recordings exist but none can be signed. Per-item
  lookup failure remains visible in session detail.
- `routers/admin.py::admin_get_session/_run_regrade_response`: preserve admin
  authorization and support both stored shapes for playback/retranscription.
- `routers/pronunciation.py::_download_audio_bytes`: authenticated Storage
  download via worker thread; never fetch an arbitrary persisted URL.
- Native result model/component: distinguish temporary playback lookup failure
  from absent recording, retain grading, and explain page reload for recovery.
  Legacy frozen files and public teaching-audio buckets are unchanged.

## Verification performed

- 135 targeted backend tests passed (private path/signing, owner/auth guards,
  student/admin detail, sealed detail, persistence fallback, retention,
  pronunciation and regrade regressions). These are mocks, not live bucket tests.
- 33 result-model/native-route tests passed; strict TypeScript passed.
- Fresh in-process OpenAPI generation exactly matches `frontend/types/api.d.ts`.
- Review skill checks: auth before storage, canonical existing schema, no new
  AI call, no secret/raw audio logging in the new helper, no speculative rewrite.
- Independent Claude diff-only review found collateral playback failure when
  one object cannot sign and insufficient safe diagnostic context. Both fixed
  with regression tests. storage3's null-URL batch decoding failure also has a
  bounded per-object fallback (four workers); transport/auth errors do not fan
  out into retries. Diagnostics include exception type/count, never token/path.
- Claude's conditional missing-column concern does not apply to the verified
  targets: migration 001 exists, readiness explicitly checks
  `responses.audio_storage_path`, and staging/production inventories confirmed
  it. Dropping the canonical path from fallback would lose recordings.
  Removed names have no remaining references; regrade uses the same bucket
  and both actual callers select legacy URL metadata.
- Next.js instructions kept the warning inside the existing client boundary;
  no new data fetching layer, routing change or server-side token exposure.

## Required before closing F05

1. Review/commit the focused patch and obtain green CI.
2. Deploy compatible code to staging; create/use only an explicitly authorized
   synthetic recording, then make **staging's** `audio-responses` bucket private.
3. Verify synthetic owner playback/download and admin review/retranscription;
   nonowner API denied; anonymous public URL denied; signed URL works and expires;
   signing outage yields a visible unavailable state. Check a synthetic URL-only
   row too. Do not download real learner recordings to prove this.
4. Deploy compatible code to production before changing the production bucket.
   Confirm exact release and repeat scoped synthetic access checks. No mass row
   rewrite, object copy or deletion is needed for the verified legacy references.
5. Keep the bucket private if playback fails; repair signing/authorization rather
   than silently returning to public access. Define any rollback explicitly.
6. Pin the final deployed release before a fresh Gate E 20-run batch. Do not
   count evidence from an earlier release as verification of this audio patch.
