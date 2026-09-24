# Rollout and rollback

## Preconditions

- Owner approves this spec, each content batch, and the exact release manifests.
- No v1.0 package or release-index bytes are overwritten. New package IDs are
  unique and backward-compatible with existing attempt history.
- Any required migration reaches staging before dependent code; the deployed
  frontend/backend compatibility window is tested.

## Staging

- Build and validate the new package revision, compare all protected keys,
  option IDs, audio/timing hashes and counts to v1.0, then dry-run import.
- Import as non-public. Verify translated and untranslated form states, guided
  first/revised answer persistence, library metadata and both themes.
- Record the exact staging SHA and integrated/live E2E results before publish.

## Production

- Ask the owner to approve the exact new package IDs and manifest hashes.
- Apply production migrations only through the advisory-locked runner if any
  are required; promote staging to main through the standard gate.
- Publish one reviewed programme revision at a time and confirm canonical
  published rows and learner paths on the production SHA.

## Rollback and repair

- Archive only the newly published revision, preserving all attempts and v1.0
  content. Restore the previous release-index binding if an index was moved.
- Do not delete old assets or reuse a package ID with different bytes.

## Observability

- Record package ID, manifest SHA, import status, published form counts,
  source-mismatch rejections and failed learner fetches; omit answer keys and
  transcripts from logs. An operator investigates any mismatch before publish.
