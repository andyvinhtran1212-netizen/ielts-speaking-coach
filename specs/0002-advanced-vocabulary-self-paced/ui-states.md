# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Assigned lesson shell | Skeleton preserves stage navigation | Clear unavailable-assignment message | Restores canonical current stage and completion | Retry reloads without marking progress | Authenticated assignee only | Mobile stage drawer, visible focus, dark/light tokens |
| Vocabulary cards | Audio controls disabled while source resolves | Missing card fails content validation | Headword, meaning, example, common error, and two audio actions render | Individual audio retry does not block reading | Same assignment boundary as shell | Keyboard buttons, labels, reduced motion |
| Practice 1 and Practice 2 | Question skeleton preserves stage and answered count | Missing/invalid selection fails content validation instead of shortening the gate | One accepted answer locks that question, reveals only its feedback, and advances focus; reload restores canonical answered questions | Validation keeps the current answer; network retry may replay the same answer; a conflicting immutable answer shows a named conflict and reload action | Answers/accepted variants/explanations remain private until that question's accepted attempt | Controls and option groups are keyboard operable, focus reaches the result/next question, and mobile/dark layouts preserve labels and progress |
| Reading Lab | Passage and question panes retain independent positions | Invalid package is not published | Public passage/questions render and post-submit review appears | Submission errors preserve answers for retry | Solutions hidden until canonical submission | Independent scrolling on desktop, stacked flow on mobile |
| Controlled rewrite | Prompt skeleton preserves the 20-item attempt checklist | Missing/invalid prompt set fails content validation | All 20 locally attempted IDs unlock the canonical reference solutions; reload restores completed evidence | One-less-than-required moves focus to the validation summary and missing prompt; retry is idempotent and conflict-safe | No response body is submitted or graded; solutions remain hidden until all prompt IDs are confirmed | Checklist, controls, and revealed references are keyboard readable; responsive/dark states retain attempted/completed distinction |
| Listening Lab | Audio and question readiness shown separately | Missing/checksum-invalid media blocks release | Audio, figure, questions, and guided retry use pinned version | Network retry preserves first-attempt truth | Answer evidence hidden before submission | Native controls, transcript not exposed, touch targets |
| Writing reference | Reference skeleton only | Explicit source-unavailable state | Analysis and models are scannable and ungraded | Retry reloads reference only | No implicit submission or grading permission | Semantic headings, responsive cards, clear status text |
| Speaking prompt practice | Prompt skeleton only | Explicit prompts-unavailable state | Optional prompts and sample language render without response capture | Retry reloads prompts; no local audio exists to lose | Never requests microphone permission and exposes no submit or grading action | Keyboard-readable prompt groups, responsive cards, clear ungraded status |
| Admin assignment/results | Canonical server loading state | Distinguishes no assignment from lookup failure | Assignment and persisted per-stage evidence match reload | Mutation failure remains visible and reload-safe | Admin authorization required | Tables reflow with accessible labels and focus |

Canonical backend records own completion and results. Pending mutations never
optimistically mark a stage complete; after settle, a reload must render the same
state. Browser verification interrupts and resumes Vocabulary, both Practice stages,
Reading, controlled rewrite, and Listening; it covers authorization, one-less-than-
required validation, identical retry, conflicting retry, responsive layout, keyboard
operation, and focus recovery wherever applicable. It must also assert the Speaking
surface contains no recorder, microphone permission request, response textarea, or
submission control.
