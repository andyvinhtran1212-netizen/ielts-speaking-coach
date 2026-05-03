# Sprint 2 Execution Report — Body Edits + Merges + Metadata

**Date:** 2026-05-03
**Branch:** `audit/grammar-sprint-2-content-2026-05-03`
**Base:** `52d4276` (main HEAD; Sprint 1 PR #38 merge)
**Audited input:** `grammar-audit/grammar-audit-report/patches/{02_merges,03_metadata-updates,04_body-edits,05_anchor-additions}.yaml`

---

## Outcome

| Metric | Value |
|---|---|
| Body edits applied | **20 / 20** ✓ |
| Inline marker (Sprint 2) | **1 / 1** ✓ (word-order, Andy reconciled) |
| Merges executed | **12 / 15** (3 deferred to Sprint 3) |
| Metadata updates | **28 / 28** ✓ |
| Group display rename | ✓ |
| `_groups.yaml` | **109 → 97** ✓ |
| Drift gate | ✅ green throughout (24 active + 6 deferred) |
| Smoke tests | ✅ 6 / 6 pass after every phase |
| Atomic commits | **6** |

---

## Reconciliation trail

| Item | Sprint 2 prompt expectation | Actual | Sprint 2 applied |
|---|---|---|---|
| Body edits | "~50-80" | **20** edits / 17 files | 20 |
| Inline markers | 147 deferred | **1** (word-order only) | 1 |
| Merges | 15 | 15 | 12 (3 deferred) |
| Metadata | 19 | **28** | 28 |
| Commits | 8 | — | 6 |

**Critical correction to Sprint 1 understanding:**

The Sprint 1 execution report claimed "147 markers deferred to Sprint 2 — by design, will be inserted alongside body edits." This was a **misreading** of the patch's `post_anchor_validation` rule (`"Every frontmatter entry has corresponding inline marker (or is in body added by 04_body-edits.yaml)"`). The reality:

- `05_anchor-additions.yaml` has only **18 inline markers** in total (not 165)
- 17 inserted in Sprint 1, **1 deferred** (word-order, applied here in Sprint 2 with Andy reconciliation)
- The other 147 frontmatter anchors are **frontmatter-only declarations by design** — Sprint 4 renderer consumes them directly, no inline marker needed

`04_body-edits.yaml` does carry 21 inline anchor markers embedded inside its content blocks, but those are not the "147 deferred" markers — they're separate Sprint 2 additions to body content alongside the body edits.

This correction was caught in Sprint 2 pre-flight and escalated.

---

## 7 reconciliations applied

| # | Item | Patch said | Reconciled to | Reason |
|---:|---|---|---|---|
| 1 | word-order anchor-wo-question marker | `## Trật tự từ trong câu hỏi` | `## Câu hỏi — đảo trợ động từ lên trước` | Andy Option B (Sprint 1) — actual heading is narrower / Speaking-focused, matches anchor name |
| 2 | adding-contrast-naturally merge | `## Nhóm 4: Tương phản (Contrast)` | `## Nhóm 2: Tương phản (Contrast)` | Andy decision — patch typo on Nhóm number |
| 3 | adding-results-clearly merge | `## Nhóm 5: Kết quả (Result)` (append_to_section) | `## Nhóm 3: Nguyên nhân và Kết quả (Cause and Effect)` (create_subsection `### Linkers cho Kết quả (Result)`) | Andy decision — patch wrong Nhóm number + scope mismatch (Result is subset of Cause-Effect) |
| 4 | combining-two-short-sentences merge | `## Bài tập` | `## Bài tập luyện` | Cat A typo — patch heading was prefix of actual |
| 5 | adding-conditions-naturally merge | `## Loại 3: Third Conditional` | `## Loại 3: Third Conditional — Giả định quá khứ` | Cat A typo — patch heading was prefix of actual |
| 6 | emphasis-inversion merge | `## Inversion với negative adverbials` | `## Loại 1: Đảo ngữ sau trạng ngữ phủ định` | Cat C2 semantic match — VI/EN translation: "negative adverbials" = "trạng ngữ phủ định" |
| 7 | present-continuous-stative-anchor body edit | `## Stative verbs` (L2) | `### Lỗi 3: Dùng stative verbs với Present Continuous` (L3) | Cat D semantic match — anchor name `stative-verbs.do-not-use-ing` fits actual L3 heading |

---

## What shipped

### Commit 1 — `0b1148b` — body edits + reconciled marker
20 body edits across 17 files (pitfall callouts, IELTS Speaking
applications, new sections). Includes the critical
`gerund-vs-infinitive-restructure-prepare-merge` edit appending
`## Verbs that take both with DIFFERENT meaning` + `<!-- merge-target:
change-of-meaning-verbs -->` — required by Phase 4 verb-pattern merges.

Plus the 1 reconciled word-order marker (anchor-wo-question; Andy
Option B from Sprint 1). 21 inline anchor markers embedded inside body-edit
content blocks land here.

### Commit 2 — `ee0eff3` — 12 merges (with 5 reconciliations)
Verb-pattern chain (6 merges → gerund-vs-infinitive) executed in
declared order; each merge appends after the previous merge's section
header. Discourse-markers merges (2) applied with Andy reconciliations
2 & 3. Other 4 merges (combining, from-simple, adding-conditions,
emphasis-inversion) applied with Cat A / C2 reconciliations.

3 deferred sources stay in active content (full deferral list below).

### Commit 3 — `2807382` — 28 metadata updates
Surgical text-level field replacement (no yaml.dump roundtrip — Sprint
1's anchors blocks preserved byte-identical). 50 individual field ops
across 28 files: compare_with / next_articles / related_pages / tags
add/remove + level/difficulty re-tags (notably cleft-sentences advanced
→ intermediate per Andy decision 5).

### Commit 4 — `e617fca` — group display rename
`ielts-grammar-lab` group title changed from "IELTS Grammar Lab" to
"IELTS Speaking Lab". Slug unchanged to preserve URLs.

### Commit 5 — `073aed0` — manifest slug removal
12 merged source slugs removed from `_groups.yaml`. 109 → 97. Only
12 lines deleted (line-based deletion preserves the inline-dict
format).

### Commit 6 — this report

---

## Verification

| Check | Result |
|---|---|
| `pytest tests/test_grammar_smoke.py test_grammar_content_archive_exclusion.py test_anchor_drift.py` | 6 / 6 pass after every phase |
| `python backend/scripts/verify_anchor_drift.py` | exit 0, 24 active resolve, 6 deferred logged, 165 declared |
| Verb-pattern chain headings present in order | ✓ REMEMBER → FORGET → REGRET → STOP → TRY → NEED |
| Discourse-markers Nhóm 2 / Nhóm 3 subsection content present | ✓ |
| `_groups.yaml` parses | ✓, 97 articles |
| Backup at `backups/grammar-pre-sprint-2-20260503-*` | byte-identical to pre-Sprint-2 state |
| All 12 merge sources archived under `_archive/2026-05-03_sprint-2-merged/` | ✓ git detected as 100% renames |

---

## What was NOT touched (per scope discipline)

- ❌ 3 new Tier-A topics (Sprint 3)
- ❌ Backend renderer (Sprint 4)
- ❌ AI feedback service (Sprint 4)
- ❌ Frontend deep-link UX (Sprint 5)
- ❌ Loader exposure of `anchors:` to article dict (Sprint 4)
- ❌ CI workflow YAML for drift script (Sprint 4 prep)
- ❌ SUPPORTING anchors (52 articles, future sprint)
- ❌ Vestigial `deferred_until` cleanup (maintenance)

---

## Deferred items for Sprint 3 prep

### 3 merges blocked — body edits did not unblock as planner expected

The Sprint 2 prompt assumed body edits would create the missing target sections for these 4 merges. Reality: `04_body-edits.yaml` does not create any of them. 1 was reconcilable (emphasis-inversion via VI/EN semantic match); the other 3 stay deferred.

| Slug | Target | Defer reason |
|---|---|---|
| `avoiding-repetitive-sentence-openings` | `grammar-for-band7plus` | Target has no `## High-leverage structures`; body edits don't create it. Sprint 3 prep needs to either (a) reconcile to existing `## Phần X: ...` heading, (b) add a body edit creating the section, or (c) defer permanently |
| `expressing-uncertainty` | `hedging-language` | Target uses `## Nhóm 1-6` grouping; spec's `## Distancing phrases` has no semantic match. Sprint 3 prep needs reconciliation or new body edit |
| `zero-article` | `articles` | Spec wants L2 heading `## Zero Article — Không dùng mạo từ`; reality has L3 `### Zero Article — Không dùng mạo từ`. Patch spec marks merge **OPTIONAL** — defer is consistent with spec recommendation |

Source files remain active in `backend/content/` and their slugs in `_groups.yaml`. Sprint 3 prep picks them up unchanged.

### Pattern for future planner work

- The Sprint 2 prompt's "147 deferred markers" premise was wrong (real: 1)
- The Sprint 2 prompt's "body edits will create C-section targets" premise was wrong (real: they don't)
- Code pre-flight caught both and escalated before any modification
- **Lesson:** validate planner narrative against patches before executing; numbers in the prompt are estimates, not commitments

---

## Reconciliation trail (cumulative across sprints)

```
Sprint 0: 17 drops + 0 merges (15 deferred) → 109 articles
Sprint 1: 165 anchors declared, 17 markers, 30 mappings (24 active + 6 deferred), drift gate live
Sprint 2: 20 body edits (+21 embedded markers) + 1 reconciled marker
          12 merges executed (3 deferred to Sprint 3)
          28 metadata updates
          group rename
          → 97 articles, 165 anchors fully wired (24 mappings + 6 forward-references)
Sprint 3: +3 new topics (97 → 100), 6 deferred mappings auto-resolve, 3 deferred merges reconciled
```

---

## Next steps for Andy

1. Review: `git diff main...HEAD --stat` — expect 5 commits plus this report
2. Spot-check `gerund-vs-infinitive.md`: should have all 6 verb-pattern subsections under `## Verbs that take both with DIFFERENT meaning` in order REMEMBER → FORGET → REGRET → STOP → TRY → NEED
3. Spot-check `discourse-markers.md`: new content under `## Nhóm 2: Tương phản (Contrast)`, new subsection `### Linkers cho Kết quả (Result)` under `## Nhóm 3`
4. Spot-check `cleft-sentences.md` frontmatter: `level: intermediate`, `difficulty: intermediate`
5. Verify drift: `python backend/scripts/verify_anchor_drift.py` (24 active resolve, 6 deferred)
6. Decide:
   - Merge to main → proceed Sprint 3 (3 new topics + reconcile 3 deferred merges)
   - Adjust → fix in branch
   - Rollback → backup at `backups/grammar-pre-sprint-2-20260503-071712/`
