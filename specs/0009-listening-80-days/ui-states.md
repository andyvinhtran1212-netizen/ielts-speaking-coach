# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| IELTS collection entry and 80-day library | Bounded loading state while published package and progress load | No unpublished collection advertised; published zero-form days remain visible | Four groups and all 80 days with asset/source readiness and truthful playable counts | Failed canonical lookup shows retry; partial progress does not masquerade as no content | Existing signed-in Listening boundary; denied collection access exposes no private media | Mobile/desktop, both themes, visible focus, 44px targets and reduced motion |
| Day/resource view | Day header and asset states load together | Missing audio/key/transcript is named; unavailable sections have no practice start | Eligible day opens the practice workspace directly with part tabs; vocabulary/no-form days have concise learning/unavailable states; source preview and source-document sections are absent | Asset/signing failure remains visible and retriable with source context preserved | Authorized signed image/audio only; solutions/transcripts follow chosen study/reveal mode | Zoom/pan/fullscreen images, meaningful curated alternative, keyboard dismissal and stable focus |
| Eligible programme player | Existing acquire/resume/save states while canonical attempt loads | No empty audio attempt; authored excluded positions are explained by the day wrapper | Part tabs, default original recording when available, engine-neutral audio labels, generated figures, saved answers and controlled reveal agree with backend | Failed save never reveals; missing assets and protected-content technical failures show retry | Existing owner/unexpired/standalone/report-only reveal guards | Existing mobile/desktop and themes plus source-image zoom and accurate response controls |
| Programme result and history | Existing result/history loading state | No band or unsupported correctness for unscored/source-limited work | First and revised answers, assisted marker, reviewed evidence and source labels remain distinguishable | Failed review never shows blank as successful result; controlled transcript failure is explicit | Owner-only protected review and signed media | Readable evidence/cards, keyboard details and both themes |

Canonical package/lesson/test/attempt/reveal rows own publication, progress and
learner answers. Local UI state does not approve content or invent completion.
Mutations disable repeat actions while pending; settled state and full reload
read the same canonical first/revised answer and assistance record. Zoom returns
focus to its trigger; changing the display does not change saved option keys.

## Original-audio self-practice revision

- Every Part includes its complete source inventory. Supplemental unanswered or
  unresolved source items show clear unscored practice and missing-audio limits.
- Full audio stays above the questions. Each covered item offers Play/Pause and
  Loop controls before answer/reveal; shared-context clips are labelled.
- Loading clips, missing original coverage, failed signing/playback, retry and
  permission denial are explicit. Moving to another question/Part/day/owner
  stops the old clip and loop; hidden panels never continue playback.
- Local supplemental drafts are owner/manifest/item scoped and restore on
  reload. Saved canonical answers keep their original backend identity.
- Controls meet keyboard/focus, 44px targets, mobile/desktop, light/dark and
  reduced-motion requirements; none starts a countdown or consumes a listen.
