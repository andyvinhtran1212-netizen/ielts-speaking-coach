# Rollout and rollback

## Preconditions

- The owner-approved or explicitly delegated editorial decision is recorded
  with scope, date, delegate, source hashes and QA evidence. Direct owner
  approval of batch 01 is not misreported as approval of later batches.
- No v1.0 package or release-index bytes are overwritten. New package IDs are
  unique and backward-compatible with existing attempt history.
- Decide and verify what happens to in-progress v1.0 attempts before the
  one-published-revision-per-programme status transition. Submitted review
  paths and active resume paths require separate checks.
- Any required migration reaches staging before dependent code; the deployed
  frontend/backend compatibility window is tested.
- Migration 303 is applied and verified on staging before code deployment;
  its two v1.0 gate rows start with `draining=false`.

## Staging

- Build and validate the new package revision, compare all protected keys,
  option IDs, audio/timing hashes and counts to v1.0, then dry-run import.
- Import as non-public. Verify translated and untranslated form states, guided
  first/revised answer persistence, library metadata and both themes.
- Record the exact staging SHA and integrated/live E2E results before publish.
- Exercise the ordered cutover and deliberately failed-publish rollback below
  in staging with a representative in-progress v1.0 attempt. Record the
  operator, UTC time, package IDs and manifest hashes for each status change.

## Ordered cutover per programme

1. A named release operator confirms the delegated decision, exact v1.1
   manifest, unpublished import, Storage attestation and live release SHA.
   Do not use the synthetic DO-NOT-PUBLISH candidate.
2. With service-role access, set the exact v1.0 package gate
   `listening_programme_start_drain_gates.draining=true`. Read back the row;
   verify new starts are rejected while an owned existing attempt can still
   save and resume. The gate row lock orders in-flight inserts before the
   activation commit.
3. Wait until a canonical query joining `listening_test_attempts` →
   `listening_tests` → `listening_content_packages` shows **zero** v1.0 rows
   with `status='in_progress' AND resume_expires_at > now()` for that package.
   Recheck immediately before archiving. No active attempt is force-deleted.
4. Archive the v1.0 package using its locked manifest ID/SHA. This temporarily
   leaves the programme without a published package because the unique index
   forbids simultaneous v1.0/v1.1 publication. Publish the already imported
   v1.1 package immediately with its exact manifest SHA; the publish command
   must re-download and hash every audio and visual object first.
5. Verify exactly one canonical published package for that programme, the new
   learner start and saved/revealed-answer journey, and historical submitted
   v1.0 review. Keep the v1.0 drain gate true. Repeat for the other programme
   only after the first one passes.

If step 4 publish fails, the same operator immediately re-publishes v1.0 with
its original manifest SHA, checks the canonical row and learner path, then
sets `draining=false` to restore new starts. Keep v1.1 unpublished and
investigate the failure before retrying. Do not describe archive+publish as
atomic; record the unavailability window and compensating action.

## Production

- Apply migration 303 to production through the advisory-locked runner before
  promoting dependent code. Promote only `staging` → `main` after exact-SHA
  staging checks and the required promotion gate pass.
- Import v1.1 as non-public and perform the same ordered cutover, one programme
  at a time, on the production SHA. Verify canonical rows and learner paths.

## Rollback and repair

- Before a successful cutover, use the compensating v1.0 re-publish above.
  After a successful v1.1 cutover, pause new v1.1 starts and wait for active
  v1.1 attempts before archiving it and re-publishing v1.0; preserve all
  attempts and immutable content. Restore the previous release-index binding
  only if one was explicitly moved.
- Do not delete old assets or reuse a package ID with different bytes.

## Observability

- Record package ID, manifest SHA, import status, published form counts,
  source-mismatch rejections and failed learner fetches; omit answer keys and
  transcripts from logs. An operator investigates any mismatch before publish.
