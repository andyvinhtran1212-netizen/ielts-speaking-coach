# Sprint 1 Execution Report — Anchor Injection Foundation

**Date:** 2026-05-03
**Branch:** `audit/grammar-sprint-1-anchors-2026-05-03`
**Base commit:** `387d44e` (main HEAD; Sprint 0 PR #37 merge)
**Audited input:** `grammar-audit/grammar-audit-report/patches/05_anchor-additions.yaml` + `feedback-anchor-mapping.yaml`

---

## Outcome

| Metric | Value |
|---|---|
| Files patched (frontmatter) | **25 / 25** ✓ |
| Frontmatter anchors declared | **165 / 165** ✓ |
| Inline markers inserted | **17 / 18** (1 deferred — heading typo) |
| Mappings installed | **30 / 30** (24 active + 6 deferred to Sprint 3) |
| Drift verification | ✅ green (24 active resolve, 6 expected-deferral) |
| Smoke tests | ✅ 6 / 6 pass |
| Atomic commits | **5** |

---

## Reconciliation

| Item | Audit summary said | Patch reality | Sprint 1 applied |
|---|---|---|---|
| CORE files | 22 | 25 | 25 |
| Anchor declarations | ~140 | 165 | 165 |
| Inline markers | implicit "all" | 18 | 17 (+1 deferred) |
| Mappings | 30+ | 30 | 30 (24 + 6 deferred) |

Audit summary's "22 CORE topics" undercounted; the patch list is authoritative at 25 files. The 165 frontmatter anchors include the 147 whose inline markers are intentionally gated to `04_body-edits.yaml` (Sprint 2) — only 18 markers ship in Sprint 1, and one of those is deferred for a heading-typo reconciliation.

---

## What shipped

### Commit 1 — `131cd8a` — frontmatter anchors

`anchors:` block appended to the frontmatter of all 25 CORE files. Surgical text-level insert before the closing `---` keeps the existing frontmatter byte-identical; 165 anchor entries added across 25 files (+520 lines, pure additions).

All 165 IDs:
- Match the convention `^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){1,3}$`
- Are ASCII-only (no Vietnamese diacritics)
- Are unique within and across files

### Commit 2 — `4b79b44` — inline anchor markers

17 of 18 markers inserted before their target headings, using line-exact match (the patch's `target_text` values are full heading lines, so substring matches like `## Tóm tắt` inside `## Tóm tắt nhanh` are correctly excluded).

**1 marker deferred** to Sprint 2 — patch-spec heading typo:
- File: `backend/content/foundations/word-order.md`
- `edit_id`: `anchor-wo-question`
- Patch target: `## Trật tự từ trong câu hỏi`
- Actual heading: `## Câu hỏi — đảo trợ động từ lên trước`

Same reconciliation pattern as Sprint 0's deferred merges. Sprint 2 prep should reconcile the spec heading or restructure the section.

Failure log: `grammar-audit/sprint-1-marker-failures.yaml`.

### Commit 3 — `b429f24` — mapping install with deferral schema

`feedback-anchor-mapping.yaml` installed at `backend/content/feedback-anchor-mapping.yaml`. 30 mappings shipped; 6 carry the new optional `deferred_until: sprint-3` field plus a `deferred_reason` describing why.

**Schema addition (Sprint 1):**
- `deferred_until: <sprint-id>` — drift gate treats missing target as expected, not drift
- `deferred_reason: <string>` — human-readable explanation
- Becomes vestigial when the sprint ships and the anchor materializes (cleanup deferred to maintenance, not blocking)
- Documented in a comment block at the top of the installed file

The 6 forward-references all target Sprint 3 new-topic files:

| Mapping | Anchor | Sprint 3 file |
|---|---|---|
| M016 | `grammatical-collocations.verb-preposition` | `grammatical-collocations.md` |
| M017 | `grammatical-collocations.adjective-preposition` | `grammatical-collocations.md` |
| M025 | `discourse-markers-spoken.common-mistake.actually-misuse` | `discourse-markers-spoken.md` |
| M027 | `pronunciation-grammar-link.common-mistake.cluster-simplification` | `pronunciation-grammar-link.md` |
| M028 | `pronunciation-grammar-link.common-mistake.full-form-overuse` | `pronunciation-grammar-link.md` |
| M030 | `discourse-markers-spoken.common-mistake.overuse-and-but-so` | `discourse-markers-spoken.md` |

### Commit 4 — `398861d` — drift verification gate

`backend/scripts/verify_anchor_drift.py` walks all `*.md` under `backend/content/` (skipping `_archive/`), collects every declared anchor ID from frontmatter, and asserts every active mapping resolves. Mappings with `deferred_until` set are logged but do not fail the gate.

`backend/tests/test_anchor_drift.py` runs the script as a subprocess and asserts exit 0. Negative-tested by removing `deferred_until` from M016 — the gate correctly fails (exit 1) with `"FAIL Anchor drift detected: 1 mapping(s) reference unresolved anchors"`. Original file restored.

### Commit 5 — this report

---

## Verification

| Check | Result |
|---|---|
| `pytest backend/tests/test_grammar_smoke.py test_grammar_content_archive_exclusion.py test_anchor_drift.py` | 6 / 6 pass |
| `python backend/scripts/verify_anchor_drift.py` | exit 0; 24 active resolve, 6 deferred logged, 165 declared |
| `_groups.yaml` parses | ✓, 109 articles unchanged |
| Frontmatter spot-check (3 files) | conditionals=12, articles=9, gerund-vs-infinitive=13 anchors |
| Inline marker spot-check | articles.md=9, conditionals.md=0 (Sprint 2-gated), word-order.md=1 |
| Backup at `backups/grammar-pre-sprint-1-20260503-071543/` | byte-identical to pre-Sprint-1 state |

---

## What was NOT touched (per scope discipline)

- ❌ Body content beyond `<!-- anchor: ID -->` insertions (Sprint 2)
- ❌ The 15 deferred merges (Sprint 2)
- ❌ The 19 metadata cross-reference updates (Sprint 2)
- ❌ `04_body-edits.yaml` body edits — including the 147 markers it carries (Sprint 2)
- ❌ New topics in `new-topics/` (Sprint 3)
- ❌ `bulk_supporting_overview_pattern` for SUPPORTING articles (future sprint)
- ❌ `rename_group_display` for ielts-grammar-lab (Sprint 2)
- ❌ Backend renderer (markdown → HTML with `<a id>`) — Sprint 4
- ❌ AI feedback service integration — Sprint 4
- ❌ Frontend deep-link UX (scroll, highlight) — Sprint 5
- ❌ Loader exposure of `anchors:` to article dict — Sprint 4 renderer scope
- ❌ CI workflow YAML for the drift script — Sprint 4 prep

---

## Deferred items for downstream sprints

### Sprint 2 prep — heading reconciliation (1 marker)
Restore + insert `<!-- anchor: word-order.questions.inversion-rule -->` once the heading discrepancy is reconciled (rename `## Câu hỏi — đảo trợ động từ lên trước` to match patch, or update the patch target).

### Sprint 3 prep — 6 deferred mappings
The 6 deferred mappings auto-resolve when Sprint 3 ships the 3 new-topic files (`grammatical-collocations.md`, `discourse-markers-spoken.md`, `pronunciation-grammar-link.md`) with their declared anchors. No manual mapping-file edit needed — the drift script will simply report `0 deferred` afterwards.

Optional cleanup pass: remove the now-vestigial `deferred_until` / `deferred_reason` fields. Not blocking.

### Sprint 4 prep — loader integration
`backend/services/grammar_content.py::_parse_file` does not yet extract `anchors:` from frontmatter into the article dict. Sprint 4's renderer work needs to add this so the AI feedback engine can match mapping IDs to declared anchors at runtime.

---

## Reconciliation trail summary

```
Audit summary:                22 CORE topics
Patch list (authoritative):   25 files
Frontmatter anchors applied:  165 (100% of patch declarations)
Inline markers in patch:      18
Inline markers applied:       17 (1 deferred to Sprint 2 — heading typo)
Mappings in patch:            30
Mappings active (resolve):    24
Mappings deferred to Sprint 3: 6 (forward-references to new-topic files)
Drift gate:                   green
```

---

## Next steps for Andy

1. Review the diff: `git diff main...HEAD`
2. Spot-check one of the 25 CORE files for the new `anchors:` block in frontmatter
3. Spot-check inline markers: `grep -n "<!-- anchor:" backend/content/foundations/articles.md`
4. Run drift gate: `python backend/scripts/verify_anchor_drift.py`
5. Decide:
   - Merge to main → proceed to Sprint 2 planning
   - Adjust → fix in branch, re-run affected phase
   - Rollback → backup at `backups/grammar-pre-sprint-1-20260503-071543/`
