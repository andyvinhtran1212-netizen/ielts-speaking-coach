# Final action plan — Listening content programmes

Validated on 2026-09-21 against the immutable publish-ready packages and the
current authenticated production Listening page. V1 uses self-review for
short-answer, written, and open-rubric responses; AI or human grading is not
part of this import.

## Locked product structure

1. `/listening` is the programme-first hub: one resume/next action, General and
   IELTS programme cards, at most three recent programme activities, then Browse
   and Analytics. Its title is `Luyện nghe`.
2. `/listening/general` contains 56 lesson cards and 143 forms, with all/new/in
   progress/completed filters. Lesson detail exposes purpose, item count,
   estimated duration, replay/support policy, and checked/self-review mix.
3. `/listening/ielts` starts with the 10-group, 16-form report-only IELTS Practice
   library, then orders existing modes by commitment: Quick Practice, Skills,
   Mini Test, Full Test. Only eligible existing exam modes mention score/band.
4. A form is one resumable attempt with one deterministic derived audio timeline.
   Objective choice/map items are exact-checked; textual/open items are preserved
   for self-review. Results never infer band, CEFR, mastery, pass/fail, or weakness.

## Content and persistence gates

1. Accept only the two release-index-bound manifests. Revalidate every declared
   hash, inventory entry, payload boundary, path, size, WAV signature, timing
   bound, SVG, protected answer/rubric, and controlled transcript.
2. Apply migration `295_listening_content_programmes.sql` before candidate code
   depends on it. Verify constraints, partial unique indexes, RLS/grants, RPC
   ownership, schema-cache reload, and legacy defaults.
3. Import both packages as draft/non-public. Upload immutable derived WAV/SVG
   objects under package + manifest prefixes; run the same commit twice and
   require the second run to reconcile as reused with no duplicate rows.
4. Immediately before publication, re-download every derived WAV/SVG and
   require its persisted size/hash attestation to match; a missing or changed
   object blocks the package status transaction.
5. Reconcile exact persisted counts: 2 packages, 66 lessons/groups, 159 forms,
   1,045 items, 390 stimuli/media/timing sources, 1,474 timing segments, 2
   visuals, 408 form-stimulus references, and zero orphan/undeclared entities.

## Staging acceptance gates

1. Deploy one unchanged candidate SHA and bind all evidence to it.
2. Check every form statically and run representative 1/3/4/10/15-stimulus,
   every-response-type, replay allowed/once, support available/separate-mode,
   mixed result, fully self-reviewed result, reload/resume, and expired-resume
   journeys.
3. Verify pre-submit payloads contain no answers, rubric, transcript, evidence,
   or teacher data; verify owner-only post-submit review and private signed media.
4. Verify existing Full, Mini, Skills, Quick, Browse, Analytics, dictation, and
   mock flows on the same SHA.
5. Capture light/dark screenshots at 375/768/1440px; check keyboard order,
   visible focus, 44px targets, screen-reader names, overflow, reduced motion,
   loading/empty/error/partial states, and immediate state versus full reload.
6. Publish IELTS first, reconcile and observe, then publish General. Exercise
   package archive and republish without deleting attempts.

## Production sequence

1. Require owner authorization only after all staging gates are linked to the
   unchanged candidate SHA and both manifest hashes.
2. Apply and verify the production migration, promote staging to main, and
   confirm the exact deployed SHA.
3. Import both packages non-public, prove idempotency/reconciliation again, then
   publish IELTS followed by General.
4. Confirm public counts, deep links, signed media, answer/transcript gating,
   report-only null score/band rows, analytics separation, and rollback command.

## Stop/rollback rules

- Stop on any protected-data leak, non-null report-only band/score, claim-policy
  breach, hash/count/window mismatch, non-idempotent import, or canonical-state
  mismatch after reload.
- Archive by package; do not hard-delete attempts or overwrite immutable v1
  assets. Wrong bytes require a new package revision and a full validation cycle.
