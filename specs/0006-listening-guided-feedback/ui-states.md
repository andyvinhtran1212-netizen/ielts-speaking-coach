# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Programme form player | Stable audio/question skeleton without answer leakage | Missing form or invalid question explains return path | Save, reveal, replay where allowed, revise, and resume with first/current answers distinct | Save/reveal/audio failures retain typed work, label unsynced state, and offer idempotent retry without leaking a key | Expired, non-owner, or ineligible attempts stop reveal and show a safe exit | Audio above question on mobile, adjacent on desktop; Aver tokens in both themes; keyboard focus, 44px targets, labels, reduced motion |
| Submitted review and history | Pending finalization does not imply completion | No completed attempt shows neutral empty state | Assisted provenance and first/current answers agree after reload | Failed read offers retry without inventing independent completion | Only attempt owner sees review | Readable mixed feedback in both themes, narrow widths, and assistive technology |

## Detailed interaction states

| State | Learner-visible behavior | Canonical rule |
| --- | --- | --- |
| Loading | Stable audio/question skeleton; no answer placeholder masquerades as truth | No protected fields in initial payload |
| Empty/invalid | Explain missing form/question and offer return/retry | No reveal call for invalid item |
| Unsaved | Answer editable; compare action disabled or prompts save | No key until acknowledged save |
| Saving | Inline pending label and guarded compare action | Failed save cannot trigger reveal |
| Revealing | Keep answer and focus; show progress, not a fabricated verdict | Retry is idempotent |
| Revealed objective | Show first answer and reference directly under question, then replay/revise | Only revealed question's feedback present |
| Revealed self-review | Show first answer and reference with `Tự đối chiếu` label | No automatic correctness claim |
| Revised | Show first and current answer distinctly; do not reset assisted state | First answer immutable; current answer mutable |
| Audio failure | Explain retry/availability without hiding saved answer | Replay policy still enforced |
| Network failure | Keep typed answer, mark unsynced, offer retry | Server truth wins on reload; no key on ambiguous save |
| Expired/forbidden | Stop reveal, explain loss of access, offer safe exit | No protected material returned |
| Submitted | Show completion and assisted provenance, no test score claim | History agrees after reload |

Desktop keeps audio/progress adjacent to the active question; mobile stacks
audio before the question and feedback immediately afterward. English/Vietnamese
question text is a user preference, not a translated answer key. Both themes
use Aver tokens, visible focus and labels, 44px targets, and reduced motion.
