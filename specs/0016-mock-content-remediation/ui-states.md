# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Content status/visibility/restore | Canonical row and dependency revision loading; pending action disables duplicates | No dependencies differs from unknown lookup; unavailable restore baseline explained | Exact persisted revision readback and durable operation result | 409 blocker list and 503 retry remain after list refresh; lost ack reconciled | Admin gate; no UI consent overrides backend decision | 390/768/1180/1440, both themes, 44px actions, focus preserved, live error notice, reduced motion |
| Explicit public assessment decision | Complete overlap/revision read before decision | No protected overlap uses ordinary public practice | Named overlap and audit receipt rendered | Stale dependencies conflict; failed decision changes no policy | Admin only with explicit actor/reason; rejected writes remain private | Keyboard-readable dependency list and consequence text; no color-only consent |
| Reading/Listening player | Purpose binding precedes usable content; answers/flags load canonically | No valid current attempt/section yields truthful start/denied state | Owner answers/countdown/flags survive reload and second client | Flag/save pending or failed is visible; retry/readback does not reset time or answer | Wrong owner/skill/window denied; valid ongoing resume preserved | Full navigation/Submit in viewport; semantic labels, focus and flags announced, both themes |
| Submitted review | Snapshot/provenance and release state loading | Missing context/support or legacy unknown explicitly stated | Blank/incorrect/correct and original options/summary/group context rendered | Retry preserves persisted result; fallback provenance remains visible | Owner or admin; sealed keys/transcripts withheld before release/capture | Full context readable at all widths; keyboard filters and replay; state not conveyed only by color |
| Revision/finding status | Exact paper/version/finding receipt loading | Unvalidated or unreviewed is not marked revised | Revision hash/scope/independent acceptance and remaining findings shown | Source/audio/verification gaps remain actionable pending evidence | Administrative QA evidence has scoped access; no learner PII exposed | Concise accessible status and source links; table scroll confined to its container |

Canonical ownership: flags and marking/context belong to the domain attempt;
policy belongs to its paper plus named overlapping dependencies. Mutation outcome
is separate from canonical reload. Returning from an error retains operator
focus/context; a successful new operation clears only superseded notices.
