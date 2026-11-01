# Rollout and rollback

## Preconditions

Land independently reviewed approved intent first. Freeze exact source/field hashes;
read complete canonical extras/footprint and preserve existing twelve receipts.
Do not infer zero from a missing bank or unread history. Verify migration compatibility
with the current deployed consumer and review the bounded LSU follow-up.

## Staging

Use the advisory-locked runner for additive schema changes. Seed missing content only
from approved production snapshots without learner data. Merge implementation into
staging, verify exact backend/frontend SHA and apply each approved revision through
preview/CAS with backups/readback. Require integrated CI and Live Staging E2E.

## Production

The user requested production remediation, preserving all learner history and points.
Fresh per-bank previews/extras/provenance still require review; scope approval does
not waive storage gates. Apply schema before dependent code, promote staging to main,
verify exact deployed SHAs, publish the final sources and accept affected journeys.
No regrade, score transfer, reset or assignment action is part of acceptance.

## Rollback and repair

Disable new starts for a faulty revision; preserve all bank/question/history IDs,
receipts and old work. Resolve a lost publication ACK with the same operation UUID,
never a fresh retry publication. Any mapping reversal is separately reviewed CAS;
never restore by deleting history or importing over an owned bank.

## Observability

Use existing admin audit/receipt and request-correlation owners. Record exact GA ID,
code, qid, source hash, operation UUID, readback and environment SHA. A mismatch blocks
that bank and is reported to user and dot; continue independent authorized corrections.

## Revision 2 follow-ups

Apply migration 339 on staging before the implementation deploy that depends on
it, and on production before promotion. Publish each follow-up only after its
environment runs the exact implementation SHA, through admin preview/commit with
backups and readback. Rollback before publication restores the 314 function
bodies; after publication, disable new starts on the v3 bank and keep v1/v2.

## Revision 3 follow-ups

Same order as Revision 2, after it: the Revision 3 migration lands on each
environment after 339 and before the implementation deploy that depends on it.
Publish each follow-up only after its environment runs the exact implementation
SHA, through admin preview/commit with backups and readback. Rollback before
publication restores the 339 function bodies; after publication, disable new
starts on the v3 bank and keep v1/v2.
