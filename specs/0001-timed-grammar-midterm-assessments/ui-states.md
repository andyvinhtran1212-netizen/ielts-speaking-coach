# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin assignment timer | Existing assignment form skeleton remains | Blank duration means untimed | Whole minutes 1–720 persist and reload canonically | Inline validation or backend error; entered value remains editable | Existing admin/cohort authorization remains authoritative | Label and help text bind to numeric input; keyboard and narrow layouts remain usable |
| Learner timed runner | Questions wait for canonical session/start response | Missing questions use existing unavailable state | A–E choices and countdown render from server time; submit shows canonical result | Network retry cannot extend cutoff or overwrite terminal state | Existing learner assignment authorization remains authoritative | Countdown has text semantics, focus remains stable, controls work by keyboard and in both themes |
| Expired learner attempt | Finalization shows existing pending state | No local answers is valid and scores as unanswered | Controls disable at cutoff and timed-out result survives reload | Retried finalization returns the same terminal outcome | Only the assigned learner can mutate the attempt | Timeout message does not rely on color and remains readable on mobile |
| Admin submissions | Existing submissions loading state remains | No attempts uses existing empty state | Timed-out attempts display canonical persisted status | Refresh/reload recovers from fetch failure without optimistic divergence | Existing admin visibility rules remain unchanged | Status text remains readable and screen-reader discoverable |

Canonical ownership remains with the backend assignment and quiz records. UI
pending state never changes the saved duration, cutoff, or terminal verdict until
the server confirms it; a full reload must display the same result.
