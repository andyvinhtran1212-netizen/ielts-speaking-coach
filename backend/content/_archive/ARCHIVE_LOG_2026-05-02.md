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

