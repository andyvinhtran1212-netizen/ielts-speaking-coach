# Grammar exact form policy — review package

The lifecycle documents and source-scope.md/json define the approved active intent.
The synchronized 0014 amendment lives in ../0014-grammar-bank-revision-cutover/;
0014-amendment-proposal.md records their bounded relationship. Both specs have
independent technical approval bound in approval.md; all22 feature requirement
rows remain PENDING. Spec approval landed separately through PR1562 on staging
`47fbb311ccb82b000097dc417b45a166e82f454e` before feature implementation. Final18 source/map hashes have Root and independent Content academic approval,
bound in source-scope.md/json. The current implementation base is `0d9b886c`.
Backend/parser/306, engine, Native, Admin and History source reviews are accepted.
Final local gates passed10089backend/38documentedSKIP,10591Node/0SKIP,286React,
both types/build,311Native,134History,25Admin and9shared quiz checks. Computed
Admin measurement covers24 snapshots with no known contrast/44px/motion failures;
32 native-control contrast UNKNOWN and8 disabled exemptions remain separate.
Local synthetic traffic and PostgreSQL fixtures do not establish live acceptance.
Staging306 is unapplied; its read-only preflight retains five historical ledger
filename mismatches, including unknown160/263 SQL provenance, and twelve missing
canonical codes. Fresh predecessor/extras/backup, exact-head CI, manual and release
gates remain open. No canonical cutover or historical regrade has run.

Read spec.md for the contract, plan.md for the implementation sequence, tasks.md
for deliverables, verification.md for requirement gates, ui-states.md for visible
lifecycle states, and rollout.md for staging and release sequencing. source-scope.md/json
bind the reviewed academic corrections and matching maps. Final source approval,
spec approval on the base branch, implementation acceptance, canonical cutover and
release are separate gates.

Integration update 2026-10-03: the original Grammar306 candidate is still
unapplied in the recorded canonical preflight. After staging allocated306–308
to the independent Mock release, this candidate is named
`309_grammar_quiz_revision_cutover.sql`, with identical SQL bytes. Internal
routine/lock identifiers remain unchanged. Fresh exact-filename ledger and
catalog verification must precede any execution; an applied old Grammar filename
requires an additive follow-up. Full restore, publication, deployed acceptance
and all22FR remain pending.
