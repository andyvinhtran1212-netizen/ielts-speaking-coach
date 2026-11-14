# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin assignment and submissions | Wait for the active catalog or class tally request | Prompt to choose an eligible drill or show no evidence yet | Save assignment and render persisted results on refresh | Surface the catalog or submit error and retain the form | Existing class-admin and dictation report access | Use labeled selects and checkbox, with report labels next to each count |
| Learner Listening and dictation | Load the exact assignment attempt or section | Show the available sections and which ones are submitted | Resume from My Class and confirm completed work after refresh | Show the retry state and retain saved answers | Verify learner ownership and active assignment scope | Keep existing keyboard controls and announce submission state |
