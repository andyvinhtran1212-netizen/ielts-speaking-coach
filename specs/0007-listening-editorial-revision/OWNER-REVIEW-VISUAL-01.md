# Owner review — two Vietnamese museum maps (draft V01)

Historical owner-review packet. The owner subsequently delegated editorial
validation; the current status is recorded in
[DELEGATED-RELEASE-DECISION.md](DELEGATED-RELEASE-DECISION.md). This packet does
not claim the owner personally inspected the images.

Status: **draft pending separate owner approval**. This packet concerns only the
two map images used by the Westbury museum forms in editorial wave 04. Approval
of the nine question texts does not approve these images, and approval of the
images does not publish a package or authorize production promotion.

Compare each Vietnamese draft with the immutable v1.0 English source at its
natural size. The image links below open the local files for close inspection.
The same-size preview is intentional: a 360px-wide learner view still needs
zoom/pan or a separately readable instruction before either map form is
learner-ready.

## Research wing — choices A–F

- [English source SVG](/Users/trantrongvinh/Downloads/Listening-Content/02_PUBLISH_READY/01_General-Listening-Practice/packages/general-listening-practice-v1.0.0/learner/visuals/westbury-research-wing.v1.svg)
- [Vietnamese draft SVG](visuals-draft/westbury-research-wing.vi.draft.svg)
- Orientation: north up; enter from the south facing north. A/B/C are west,
  near-to-far; D/E/F are east, near-to-far. The bronze statue is in the
  corridor between the middle and far rooms. Letters denote location choices,
  never room names.
- Owner check: “khu nghiên cứu”, “Tượng đồng”, “Lối vào · nhìn về phía bắc”,
  the instruction to match heard rooms to A–F, and the Vietnamese accessible
  description preserve the source meaning without hinting at room answers.

## Interview annex — choices P–U

- [English source SVG](/Users/trantrongvinh/Downloads/Listening-Content/02_PUBLISH_READY/01_General-Listening-Practice/packages/general-listening-practice-v1.0.0/learner/visuals/westbury-annex-transfer.v1.svg)
- [Vietnamese draft SVG](visuals-draft/westbury-annex-transfer.vi.draft.svg)
- Orientation: north up; enter from the west facing east. P/Q/R are the top
  row west-to-east; S/T/U are the bottom row west-to-east. The display table
  lies in the corridor between the middle and easternmost room pairs. Letters
  denote location choices, never room names.
- Owner check: “khu phỏng vấn”, “Bàn trưng bày”, “Lối vào · nhìn về phía đông”,
  the instruction to match locations to P–U, and “trái/phải theo hướng di
  chuyển của khách tham quan” preserve the source meaning without revealing
  which rooms belong at those positions.

## Technical check already completed

Both source and draft files match the SHA-256 values locked in
[`visual-batch-01-draft.json`](visual-batch-01-draft.json). XML element order,
attributes, coordinates, paths, room-letter anchors, and north-arrow geometry
are identical; only title, description, and visible text changed. No room
names or answer locations were added. Nominal-size Quick Look renders were
previously inspected; that is not learner-side visual QA.

A static headless-Chrome check used the actual Listening stylesheet cascade and
the two draft SVGs at a 360px viewport in both light and dark themes. All four
combinations decoded successfully. The image remained 720px wide in
an internally scrollable 280px viewport; the outer document stayed 360px
wide, and a focused viewport moved 40px with ArrowRight. This checks mobile
layout and keyboard scrolling in isolation, **not** the authenticated learner
route, touch hardware, screen-reader output or owner wording approval.

## Decision and release boundary

For each image, record **accept / request edit / reject** and the exact
wording or visual issue. Acceptance is an editorial decision only. Before
these maps can be published in a v1.1 package, the runtime and importer must
pass authenticated learner-side light/dark, touch and screen-reader checks,
plus answer-anchor checks. The unpushed local runtime branch now contains a
fail-closed projection for approved SVG variants and a scrollable 360px
viewport; it has not been verified on staging. No change to the v1.0 source
files is permitted.
