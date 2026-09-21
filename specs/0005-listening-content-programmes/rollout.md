# Rollout and rollback

## Preconditions

- LISTENING-0005 is approved on staging before implementation begins.
- The publish-package validator passes the exact two manifests intended for
  import. Their manifest hashes are recorded in the staging change record.
- The 34 broken working-hub symlinks are either restored or formally archived;
  the Content Hub validator truthfully distinguishes reachable working evidence
  from immutable publish-package validation.
- Human verification and perceptual listening remain an explicit accepted
  limitation; no UI or marketing copy claims they occurred.
- The additive migration is backward-compatible with the deployed backend and
  frontend and does not change existing row behavior.
- The private `listening-audio` bucket, storage limits, MIME restrictions, and
  service-role handling are verified without exposing service credentials.

## Staging

1. Apply the additive migration through the advisory-locked runner and verify
   tables, columns, checks, partial unique indexes, RPC ownership, and grants.
2. Deploy the exact backend/frontend candidate SHA before importing content.
3. Run dry-run for both packages and compare the report with manifest counts and
   the expected conservative response-type mapping.
4. Commit both packages as draft/non-public. Re-run commit to prove idempotency and
   run reconciliation for staged objects and database rows.
5. Walk all 159 forms statically. Exercise representative one, three, four, ten,
   and fifteen-stimulus forms; each response type; replay `allowed` and `once`;
   support `separate_mode` and `available`; transcript gating; mixed objective and
   self-review results; reload resume; and package rollback.
6. Verify existing Full Test, Mini Test, Skills, Quick Practice, Browse, Analytics,
   dictation, and mock flows against the exact SHA.
7. Publish the IELTS package atomically, observe errors/result truth, then publish
   the General package atomically. Reconcile public counts after each operation.
8. Run light/dark and 375/768/1440px screenshot plus keyboard/focus checks for hub,
   both programme pages, form player, result, analytics, and failure states.

## Production

- Require explicit owner authorization after all staging evidence is linked to
  the unchanged candidate SHA and package manifest hashes.
- Apply and verify the production migration before promoting application code.
- Import both packages as non-public and compare dry-run/commit reconciliation
  with staging.
- Publish IELTS, complete bounded smoke and analytics checks, then publish General.
- Confirm the exact production SHA, package IDs, public counts, signed media access,
  transcript withholding, null imported band estimates, and deep-link compatibility
  before declaring release complete.

## Rollback and repair

- Archive public rows by package ID; do not hard-delete attempts, existing
  diagnostic rows, or package provenance.
- If content bytes are wrong, do not overwrite the object or edit v1. Create a new
  package revision, validate it completely, import it as non-public, then switch
  visibility through the package operation.
- If code regresses while data is valid, deploy the previous compatible application
  SHA and retain additive schema plus non-public imported rows.
- If private access must be revoked immediately, archive package rows and delete the
  exact derived object prefix after target verification; note that signed URL expiry
  alone is not an immediate cache revocation mechanism.
- Repair incomplete imports through the reconciliation command and immutable source
  identities. Never guess missing rows from display state.

## Observability

- Import: package/manifest identity, validation status, planned/created/reused rows,
  bytes, derived hashes, duration, retries, conflicts, and reconciliation findings.
- Runtime: package/form start and completion rate, media/signing failures, autosave
  failures, expired resumes, result contract errors, protected-field sentinels, and
  report-only rows with non-null band estimates.
- UI: overview/lesson endpoint failure rate, empty-state rate, broken destination
  links, and client normalization failures.
- Rollback trigger: protected answer/transcript exposure, incorrect band/CEFR/mastery
  claim, source-window mismatch, material media failure, non-idempotent import, or
  package-scoped visibility mismatch after reload.
- Product owner owns content/claim go-no-go; platform operator owns migration,
  Storage, import, reconciliation, package publish/archive, and exact-SHA evidence.
