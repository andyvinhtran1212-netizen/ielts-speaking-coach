# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Learner sentence-lab form | Existing course exercise loader while the writing state loads | Empty answers allowed; an empty item is graded `no_attempt` without a call | Submit shows coaching results; S01/S45 guide appears after the state re-read | 503 keeps the draft and shows a retry message; 409 re-reads state | Only the assigned learner's own attempt (`get_supabase_user` + assignment item check) | Existing textarea labels, design tokens and light/dark styles; no new colors |
| Learner rewrite and final view | Button disabled while the rewrite is pending | Zero rewrites shows "Chốt và xem đáp án" | Minimal correction diff, alternative and reference answer render from the POST response | Over 6 items disables submit; failed follow-up read keeps the committed rewrite | Same ownership checks as submit | Keyboard reachable textareas and buttons; status announced in text, not color only |

Canonical data is the submission row; after each mutation the page re-reads `GET /api/quiz/course/writing`. A reload shows the same stored state.
