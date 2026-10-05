# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Native bank/start | validated bank/state pending; start disabled | missing bank/eligible questions shown truthfully | immutable bank/policy admitted, normal question ready | invalid policy503/stale revision or missing ACK409; reload canonical state, no ready engine | existing401/403/owned404 | keyboard/focus,44px, reducedmotion, light/dark,360/390/768/1440 |
| Exact question feedback | one explicit answer pending local verdict/save | blank cannot submit | accepted normalized form earns ordinary credit | wrong morphology is Chưa đúng; save ACK failure retains truthful pending/retry state | existing access gate | Enter/check/next focus; feedback status announced without duplicate submit |
| Admin source preview/cutover | canonical/source/footprint pending | zero verified activity distinct from missing data | reviewed map/qid diff then canonical receipt/readback | source/map/CAS conflict refresh; lost cutover ACK reconcile same UUID | admin-only401/403 | focus return,44px targets, both themes/all widths |
| Historical receipt/history GET | owned immutable evidence pending | genuinely no history accurately shown | old/current original stem/key/result,0 writes | missing source/ownership/proof unavailable, no current substitute | existing owner/private-answer gate | keyboard/back-forward/reload/focus, both themes/all widths |
| Explicit readonly review admission | existing owner action pending | no eligible owned review clearly shown | admitted readonly session; no attempts/mastery writes | missing mapped ACK/stale proof blocked before row | existing owned scope | existing readonly controls/focus, both themes/all widths |

Canonical bank_id/revision/META are identity; matching capability is derived from
nonempty validated map. Learner flow uses ordinary content-update/error language,
not qid-exact-v1/physical code/map-edit controls. Technical diff/fingerprints belong
to bounded admin review/evidence only.

A validated pure preflight engine may derive existing remaining/all-mastered before
admission, with no submit, active learner engine/outbox or writes. Live engine/outbox
activation waits for actual typed start ACK frozen bank_id/revision/policy and async
request/account scope. Failed map/start ACK cannot activate or claim mastered/saved.
Start is non-idempotent; lost ACK is explicit unavailable, one POST for that action,
no automatic POST retry/progress/end/optimistic ready. Explicit reopen canonical reads
then native create+carryover may produce another session; no same-session UUID/receipt
recovery platform, and admin cutover receipt is separate. Historical GET and explicit review admission are distinct:
zero business writes versus one permitted readonly row and zero attempts/mastery.

Pause/reload/Back/Forward continues frozen old/new work with its own map, never
current policy grafted onto old question set. If new starts are disabled, keep
admitted work usable with compatible engine/runtime. Errors return focus to useful
retry/back control; normal answer feedback advances existing keyboard workflow.

## Current reset, terminal and source states

| State | Truthful outcome |
| --- | --- |
| Pure preflight all-mastered | Existing gate, no live graded engine/start writes from preflight |
| Start committed, ACK lost | Unavailable; no auto POST retry/live outbox/end; explicit reopen may new-session carryover |
| Paused current unmarked group | Continue only from owned same-bank/revision run/continuation predecessor with remaining>0/no group completion |
| Current marked or readonly review row | History retained; cannot prove unfinished continuation |
| Explicit current reset | Existing owner transaction marks prior current admissions once, deletes current stats only, confirms before fresh work |
| Terminal owned repeated end | Optional grammar may omit; stored bank_id/revision exact incl original NULL; no current graft |
| Canonical META/why_wrong/prior-cutover conflict | Admin source/identity unavailable; refresh/review, no autoedit/fallback/second revision |

Reset marker/private proof fields are not learner choices or new UI controls.
Current explicit reset is separate from historical read zero-write and readonly
review row/no-attempt/mastery contracts. Both themes, width matrix, focus/keyboard
and reduced motion acceptance remain PENDING.

## Reset-stale states — acceptance PENDING

| State | Required behavior |
| --- | --- |
| Explicit current reset with orphan open start | Mark every prior owned-current admission once; no indefinite open-row refusal or auto-close/history rewrite |
| Delayed progress from marked admission | Typed409 reset_stale; explicit stale/reopen, no automatic progress retry or optimistic saved/mastered |
| Explicit reopen after reset-stale | Canonical reads then existing create/carryover if allowed; no auto-resubmit/recovered-session claim |
| Marked owned-open end | Same frozen history row may terminalize; no mastery/KP/new eligibility, no rewritten answers/markers |
| Marked prior/review versus current proof | Excluded from paused predecessor and completion-group proof; legacy fences remain unchanged |

No reset marker or internal error token is a learner control. Normal keyboard/error
focus, themes, reduced motion and existing width acceptance apply.
