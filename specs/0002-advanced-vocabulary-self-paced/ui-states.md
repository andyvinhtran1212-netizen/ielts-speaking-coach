# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Assigned lesson shell | Skeleton preserves stage navigation | Clear unavailable-assignment message | Restores canonical current stage and completion | Retry reloads without marking progress | Authenticated assignee only | Mobile stage drawer, visible focus, dark/light tokens |
| Vocabulary cards | Audio controls disabled while source resolves | Missing card fails content validation | Headword, meaning, example, common error, and two audio actions render | Individual audio retry does not block reading | Same assignment boundary as shell | Keyboard buttons, labels, reduced motion |
| Reading Lab | Passage and question panes retain independent positions | Invalid package is not published | Public passage/questions render and post-submit review appears | Submission errors preserve answers for retry | Solutions hidden until canonical submission | Independent scrolling on desktop, stacked flow on mobile |
| Listening Lab | Audio and question readiness shown separately | Missing/checksum-invalid media blocks release | Audio, figure, questions, and guided retry use pinned version | Network retry preserves first-attempt truth | Answer evidence hidden before submission | Native controls, transcript not exposed, touch targets |
| Writing reference | Reference skeleton only | Explicit source-unavailable state | Analysis and models are scannable and ungraded | Retry reloads reference only | No implicit submission or grading permission | Semantic headings, responsive cards, clear status text |
| Speaking prompt practice | Prompt skeleton only | Explicit prompts-unavailable state | Optional prompts and sample language render without response capture | Retry reloads prompts; no local audio exists to lose | Never requests microphone permission and exposes no submit or grading action | Keyboard-readable prompt groups, responsive cards, clear ungraded status |
| Admin assignment/results | Canonical server loading state | Distinguishes no assignment from lookup failure | Assignment and persisted per-stage evidence match reload | Mutation failure remains visible and reload-safe | Admin authorization required | Tables reflow with accessible labels and focus |

Canonical backend records own completion and results. Pending mutations never
optimistically mark a stage complete; after settle, a reload must render the same
state. Keyboard focus moves to validation summaries or the next available stage.
Browser verification must assert the Speaking surface contains no recorder,
microphone permission request, response textarea, or submission control.
