# Archive Log — 2026-05-02 (Sprint 0)

Generated: 2026-05-02T14:56:15+00:00
Audited commit: `1ca9792`
Branch: `audit/grammar-sprint-0-cleanup-2026-05-02`

This log records files moved from active circulation into
`backend/content/_archive/` during Sprint 0 of the grammar content audit.

---

## Section 1 — Drops (out-of-scope articles)

**Reason for batch:** The audit identified Writing-only Task 1 / Task 2
articles as out of scope for the IELTS Speaking-focused product.  These
are preserved here for potential future recovery if the product expands
to a Writing module.

**Recoverable:** Yes — files preserved verbatim under
`2026-05-02_sprint-0-dropped/`.

**Restoration command (per file):**

```bash
cp backend/content/_archive/2026-05-02_sprint-0-dropped/<category>/<slug>.md \
   backend/content/<category>/<slug>.md
# Then re-add slug to backend/content/_groups.yaml manually.
```

### Archived files (17)

| # | Slug | Original path | Archive path | Reason |
|---:|---|---|---|---|

| 1 | `grammar-in-task1` | `backend/content/ielts-grammar-lab/grammar-in-task1.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/grammar-in-task1.md` | Writing Task 1 meta article; product focus is Speaking. Out of scope. |
| 2 | `grammar-in-task2` | `backend/content/ielts-grammar-lab/grammar-in-task2.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/grammar-in-task2.md` | Writing Task 2 meta article; out of scope for Speaking product. |
| 3 | `task1-trend-grammar` | `backend/content/ielts-grammar-lab/task1-trend-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/task1-trend-grammar.md` | Task 1 chart description grammar; no Speaking transfer. |
| 4 | `task1-comparison-grammar` | `backend/content/ielts-grammar-lab/task1-comparison-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/task1-comparison-grammar.md` | Task 1 only; only 379 body words; subsumed by `comparison` CORE. |
| 5 | `task1-process-grammar` | `backend/content/ielts-grammar-lab/task1-process-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/task1-process-grammar.md` | Task 1 only (process diagrams). |
| 6 | `task1-map-grammar` | `backend/content/ielts-grammar-lab/task1-map-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/task1-map-grammar.md` | Task 1 only (map description). |
| 7 | `task2-opinion-essay-grammar` | `backend/content/ielts-grammar-lab/task2-opinion-essay-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/task2-opinion-essay-grammar.md` | Task 2 essay structure; out of scope. |
| 8 | `task2-cause-effect-grammar` | `backend/content/ielts-grammar-lab/task2-cause-effect-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/task2-cause-effect-grammar.md` | Task 2 only. |
| 9 | `task2-problem-solution-grammar` | `backend/content/ielts-grammar-lab/task2-problem-solution-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/task2-problem-solution-grammar.md` | Task 2 only. |
| 10 | `task2-introduction-grammar` | `backend/content/ielts-grammar-lab/task2-introduction-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/task2-introduction-grammar.md` | Task 2 only. |
| 11 | `task2-conclusion-grammar` | `backend/content/ielts-grammar-lab/task2-conclusion-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/task2-conclusion-grammar.md` | Task 2 only. |
| 12 | `balanced-arguments-grammar` | `backend/content/ielts-grammar-lab/balanced-arguments-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/balanced-arguments-grammar.md` | Task 2 only. |
| 13 | `overview-sentence-grammar` | `backend/content/ielts-grammar-lab/overview-sentence-grammar.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/overview-sentence-grammar.md` | Task 1 only. |
| 14 | `percentages-and-proportions` | `backend/content/ielts-grammar-lab/percentages-and-proportions.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/percentages-and-proportions.md` | Task 1 only. |
| 15 | `rankings-and-extremes` | `backend/content/ielts-grammar-lab/rankings-and-extremes.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/rankings-and-extremes.md` | Task 1 only; only 907 body words. |
| 16 | `avoiding-repetition-in-task2` | `backend/content/ielts-grammar-lab/avoiding-repetition-in-task2.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/ielts-grammar-lab/avoiding-repetition-in-task2.md` | Task 2 only. |
| 17 | `informal-grammar-in-academic-writing` | `backend/content/error-clinic/informal-grammar-in-academic-writing.md` | `backend/content/_archive/2026-05-02_sprint-0-dropped/error-clinic/informal-grammar-in-academic-writing.md` | Writing-only "no contractions / no idioms" rules.
Opposite of what Speaking learners need (Speaking uses contractions and informal language).
Out of scope.
 |

### References cleaned

When a dropped slug appeared in another article's `compare_with` / `next_articles` / `related_pages` / `prerequisites` list, the reference was removed from that article's frontmatter so the wiki doesn't render dead links.

**References successfully cleaned:** 3

| Dropped slug | Cleaned in file | Field |
|---|---|---|
| `grammar-in-task2` | `backend/content/ielts-grammar-lab/grammar-in-speaking.md` | `compare_with` |
| `task2-opinion-essay-grammar` | `backend/content/grammar-for-meaning/discourse-markers.md` | `next_articles` |
| `task2-conclusion-grammar` | `backend/content/grammar-for-meaning/discourse-markers.md` | `next_articles` |

**References skipped:** 7

Reasons: ref target also dropped (cleanup moot), action explicitly marked `removed_anyway_in_drop`, slug already absent from field, or unknown action — see audit notes.

---

## Section 2 — Merges (deferred to Sprint 2)

**Reason for batch:** The audit identified 15 articles whose content was a
natural fit as a section inside another, more central article.  However,
zero merges were mechanically executable inside Sprint 0 scope because
every candidate hit at least one of: missing parent section in target
(Sprint 2 body-edit prerequisite), patch-spec heading typo (editorial
reconciliation needed), dependence on Sprint 2's `gerund-vs-infinitive`
restructure, or explicit "optional" recommendation in the patch spec.

**Mechanically-clean merges executed:** 0 of 15 candidates.
**Deferred to Sprint 2:** 15 merges.

**Why zero?**  Strict Sprint 0 scope forbids body edits, metadata
changes, and editorial judgment on patch typos.  Each remaining merge
needs at least one of those, so all merges defer.  This was reconciled
during Phase 1 validation; see `grammar-audit/sprint-0-execution-report.md`
for the full reconciliation trail (35 → 16 → 15 → 7 → 3 → 0).

### Deferred merges by reason

**6 verb-pattern merges** depending on Sprint 2's `gerund-vs-infinitive-restructure` body edit:
- `remember-doing-vs-remember-to-do` → `gerund-vs-infinitive`
- `forget-doing-vs-forget-to-do` → `gerund-vs-infinitive`
- `regret-doing-vs-regret-to-do` → `gerund-vs-infinitive`
- `stop-doing-vs-stop-to-do` → `gerund-vs-infinitive`
- `try-doing-vs-try-to-do` → `gerund-vs-infinitive`
- `need-doing-vs-need-to-be-done` → `gerund-vs-infinitive`

**3 merges blocked by missing parent section in target** (sections to be created by Sprint 2 body edits):
- `avoiding-repetitive-sentence-openings` → `grammar-for-band7plus` (missing `## High-leverage structures`)
- `emphasis-inversion` → `inversion` (missing `## Inversion với negative adverbials`)
- `expressing-uncertainty` → `hedging-language` (missing `## Distancing phrases`)

**5 merges blocked by patch-spec heading typos / near-misses** (Sprint 2 prep should reconcile in patches):
- `combining-two-short-sentences` → `complex-sentence` (spec says `## Bài tập`; actual heading is `## Bài tập luyện`)
- `from-simple-to-complex-sentences` → `complex-sentence` (depends on merge #1's section header existing)
- `adding-conditions-naturally` → `conditionals` (spec says `## Loại 3: Third Conditional`; actual is `## Loại 3: Third Conditional — Giả định quá khứ`)
- `adding-contrast-naturally` → `discourse-markers` (spec says `## Nhóm 4: Tương phản (Contrast)`; actual is `## Nhóm 2: Tương phản (Contrast)`)
- `adding-results-clearly` → `discourse-markers` (spec says `## Nhóm 5: Kết quả (Result)`; actual is `## Nhóm 3: Nguyên nhân và Kết quả (Cause and Effect)`)

**1 merge marked optional and skipped per spec recommendation:**
- `zero-article` → `articles` (spec note: *"This merge is OPTIONAL — keeping zero-article.md as SUPPORTING is also fine."* Default behaviour respected.)

**Recoverable when revisited:** Sources still present at original paths
under `backend/content/`. Sprint 2 picks these up from the deferred list.

