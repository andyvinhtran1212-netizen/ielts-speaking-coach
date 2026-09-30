# User states

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin revision preview/commit | pending canonical lookup | valid zero footprint distinguished from missing data | confirmed receipt and canonical readback | source/CAS conflict refresh; lost ACK reconcile same UUID | existing401/403, no private data |44px, keyboard focus return, reduced motion, both themes,360/390/768/1440 |
| Learner new/legacy work | pending frozen bank read | no unfinished legacy work starts corrected version separately | original continuation or explicit corrected new work | unavailable proof/stale start reload, no silent switch | owner/answer gates preserved |44px, keyboard/focus, reduced motion, both themes,360/390/768/1440 |
| Historical review | pending owned evidence | no past work shown accurately | original stem/key/result | retry incomplete lookup, never substitute current source | owner scoped | keyboard/focus, both themes and all widths |

| Surface/state | Behavior |
| --- | --- |
| Admin loading/lookup failure | show pending/unavailable; no empty footprint or guessed source |
| Admin preview valid | show exact scope/source/key diff and preserved-history counts; ready only for current preview fingerprint |
| Unknown/over-limit cohort | counts-only unavailable/authoritative-review state; commit disabled before publication, no truncated proof or exposed learner IDs |
| Preview invalid/conflict | show field/source problem or changed revision; refresh and preview again |
| Commit pending/lost ACK | mutation locked; reconcile same operation identity, never blind new import |
| Commit confirmed | show canonical old/new IDs and receipt/readback; no optimistic publication success |
| Storage/receipt error | retained preview plus retry/reconcile, no guessed successful cutover |
| Permission denial | existing401/403 state, no source/learner data exposed |
| New compatible learner | corrected bank/current content label, separate fresh mastery |
| Unfinished legacy learner | continue original work or explicitly start corrected work separately; preserve old engine/source/progress |
| Paused legacy reload | recognized owned unfinished carryover, no fresh-looking reset or silent upgrade |
| Completed session with carryover | original unfinished work can continue; session label alone does not mean mastery completed |
| Eligible older native reload | server derives owned continuation from proven cohort, without requiring a new client purpose/version field |
| All-mastery saved/end ACK lost | old continuation is consumed; history remains, new practice starts corrected work |
| Parallel stale progress after mastery | show accepted attempt history and retained mastery truth; allow admitted history finalization, never reopen old new-start permission |
| Completed legacy history | original stem/key/result remains reviewable; new practice points to corrected content |
| Old/stale incompatible start | clear content-updated/reload state before session creation; don't substitute bank IDs |
| Missing/corrupt continuation proof | unavailable/retry, no invented ownership or empty-success |
| Rollback/new starts disabled | explain temporary start unavailability; allow existing old/corrected work to finish |

Revision fingerprints, physical-code suffixes and private eligibility IDs remain
implementation/admin evidence, not learner decision text. Keyboard focus returns
after preview/commit dialogs; targets44px, reduced motion, light/dark and
360/390/768/1440 acceptance apply to affected controls.
