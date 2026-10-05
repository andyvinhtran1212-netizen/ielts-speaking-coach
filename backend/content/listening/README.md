# 80-day explanation editorial revision

`80-days-explanations-v2.json` is reviewed Vietnamese editorial content for
the source collection. It removes repeated paraphrases, generic instructions
already shown in question blocks and editor-only tasks, and contains 55
substantive item overrides. All 43 unresolved positions retain concise,
source-specific learner next steps; only editor-only tasks are removed.
An independent council reviewed those overrides, next steps and removal
invariants. This is an editorial review, not fresh answer-key
certification; ambiguous and unresolved source warnings remain.

Each changed item binds the complete original `SourceExplanation` JSON
(including defaults and printed key) by SHA-256. The digest uses UTF-8 JSON,
sorted keys, compact separators and unescaped Unicode. All 1,649 bindings were
matched against the published staging package's 1,676 source positions before
deployment. The source manifest is recorded in the document header.

The API applies these edits only during owner-authorized reveal, submitted
review or explicitly opened source study. Marking continues to read the
original explanation; answers, evidence, source warnings, immutable package
rows and learner attempts are retained. A different item or source explanation
does not receive this revision. Reverting the content integration restores
the original text without a database migration or data rollback.
