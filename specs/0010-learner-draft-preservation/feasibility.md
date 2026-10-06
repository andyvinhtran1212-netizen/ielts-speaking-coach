# Tab ownership feasibility

Status: approved owner-envelope intent, measured on desktop Chrome152/macOS
and Chrome154/macOS. The earlier free-lock proposal and its counterexample remain historical
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

Use only the measured Chrome152/macOS and Chrome154/macOS native contracts. API availability
never qualifies another engine/version. Other environments remain editable and
explicitly unsaved under FR-006. Do not claim cross-engine or browser-session
recovery support.

The product must still demonstrate reload and immediate Back/Forward, cloned
namespace isolation, failed-clear/account/logout safety, latest/empty edits,
content/topic compatibility, scoped discard, zero automatic check/session/AI
writes and visible failures. Physical mobile/VoiceOver and human acceptance
remain pending. These are product acceptance gates, not permission to build
another ownership prototype or to weaken FR-004/005.

## Chrome154/macOS qualification — 2026-10-06

The running browser reported Chrome154.0.0.0. The existing four-file synthetic
fixture was reused without logic changes. Native trusted input saved a draft;
native menu Duplicate followed by Back before the first guard copied a nonempty
namespace while leaving the native name empty. The new A document purged the
copy and confirmed empty input. The original tab retained exact raw text through
BFCache Back and reload. Native Close followed by Undo Close created a new
document with an empty name and expired the copied draft.

A separate original-tab Back after the no-store page had been left for more
than three minutes created a new A document: navigation `back_forward`,
`pageshow.persisted=false`, the same owner and exact latest trusted input after
identity confirmation. Input stayed concealed before identity confirmation;
a later trusted empty edit also survived reload without reviving older text.
No browser settings, app data, backend, provider or ownership logic changed.

Root evidence: `evidence/draft-chrome154-native-qualification-partial-20261006.json`
and `evidence/draft-chrome154-newdoc-back-20261006.json`. These qualify the
browser lifecycle only; product FR-001–007 and live/human acceptance remain
separate. Unmeasured versions, other engines and other operating systems remain
explicitly unsaved and editable.
