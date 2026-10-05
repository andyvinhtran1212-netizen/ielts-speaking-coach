# Tab ownership feasibility

Status: approved owner-envelope intent for the qualified desktop Chrome152/macOS
case. The earlier free-lock proposal and its counterexample remain historical
evidence; the implementation does not use that proposal.

## Native evidence that changed the decision

- Native menu Duplicate of B followed by toolbar Back while initial B input
  was concealed and before any owner guard ran. B pagehide logged guardRuns0.
  The first actual guard ran in a new A document with an empty native name and
  copied A/B namespace, cleared that namespace and confirmed empty input. The
  first timing attempt was unobserved; only the second attempt qualifies.
- Native toolbar Back in the original tab created a different A document,
  navigation back_forward and pageshow.persisted=false. The same owner and
  latest trusted synthetic A edit survived after identity confirmation.
- Earlier native close/reopen observed empty name while storage was copied;
  browser reload, empty-edit reload and BFCache A/B traversal preserved the
  original owner. None of these external synthetic receipts proves product
  auth/topic/check/Start behavior or privacy between all browser paint frames.

Root's remediation evidence paths:
`evidence/draft-native-critical-root-20261002-v1/observations.json` and
`evidence/draft-window-name-native-close-reopen-20261001-v1/root-second-native-name-observation-v1.json`.

## Admission and remaining product gates

Use only the measured Chrome152/macOS native contract initially. API availability
never qualifies another engine/version. Other environments remain editable and
explicitly unsaved under FR-006. Do not claim cross-engine or browser-session
recovery support.

The product must still demonstrate reload and immediate Back/Forward, cloned
namespace isolation, failed-clear/account/logout safety, latest/empty edits,
content/topic compatibility, scoped discard, zero automatic check/session/AI
writes and visible failures. Physical mobile/VoiceOver and human acceptance
remain pending. These are product acceptance gates, not permission to build
another ownership prototype or to weaken FR-004/005.
