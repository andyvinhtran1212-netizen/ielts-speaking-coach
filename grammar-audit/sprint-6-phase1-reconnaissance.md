# Sprint 6 — Phase 1 Reconnaissance Findings

**Date:** 2026-05-03
**Branch:** `main` (clean tree, drift gate green: 30 active, 0 deferred, 200 declared anchors)
**Scope:** READ-ONLY investigation — no files modified
**Highest existing mapping ID:** **M030** → Phase 2 starts at M031

---

## Headline finding (planner must read first)

The within-slug anchor-match gap from Phase 0 has a **deeper structural cause** than just keyword-language mismatch. Of the 8 distinct slugs production routes to (top 15 by occurrence):

| Slug | File present? | Anchors declared? |
|---|---|---|
| `articles` | ✓ foundations/articles.md | ✓ 9 anchors |
| `tense-consistency` | ✓ error-clinic/ | ✓ 2 anchors |
| `article-errors` | ✓ error-clinic/ | **✗ NONE** |
| `this-that-these-those-in-use` | ✓ foundations/ | **✗ NONE** |
| `missing-subjects` | ✓ error-clinic/ | **✗ NONE** |
| `missing-main-verbs` | ✓ error-clinic/ | **✗ NONE** |
| `articles-with-places-and-names` | ✓ foundations/ | **✗ NONE** |
| `agreeing-and-disagreeing-naturally` | ✓ ielts-grammar-lab/ | **✗ NONE** |
| `overusing-i-think` | ✓ error-clinic/ | **✗ NONE** |

7 of 8 uncovered slugs **have no anchors declared in frontmatter**. Adding mappings that target these files would fail the drift gate immediately.

**Implication for Phase 2 scope:** Sprint 6 is not just "add ~20 new mappings". It's a 2-stage shape:
1. **Phase 2a — Anchor declaration:** add `anchors:` blocks + inline `<!-- anchor: ID -->` markers to the 7 files (Sprint-1-style content work)
2. **Phase 2b — Mapping addition:** then add the new mapping entries that target those new anchors

Planner should decide the chunking — possibly defer some smaller slugs to Sprint 7, or batch all anchor work together in Phase 2a since the pattern is uniform.

---

## Task 1 — M001-M003 target anchors verified

All three remain valid in `backend/content/foundations/articles.md`:

| Mapping | Target anchor | Frontmatter line | Inline marker line |
|---|---|---|---|
| M001 | `articles.indefinite.missing-with-singular-count-noun` | 51 | 285 |
| M002 | `articles.definite.overuse-with-general-uncount` | 57 | 292 |
| M003 | `articles.vietnamese-pitfall.country-the-misuse` | 66 | 305 |

All ✓. No Sprint 0-3 breakage. Drift gate confirms (30 active mappings resolve).

---

## Task 2 — `articles.md` anchor inventory + "missing 'the'" gap

**All 9 anchors declared in `articles.md` frontmatter:**

| # | Anchor ID | Type | Section |
|---|---|---|---|
| 1 | `articles.overview` | overview | `## Tóm tắt` |
| 2 | `articles.indefinite.when-to-use` | section | `### A / An — Mạo từ không xác định` |
| 3 | `articles.indefinite.missing-with-singular-count-noun` | pitfall | `### Lỗi 1: Bỏ mạo từ trước danh từ đếm được số ít` ← **M001** |
| 4 | `articles.definite.when-to-use` | section | `### The — Mạo từ xác định` |
| 5 | `articles.definite.overuse-with-general-uncount` | pitfall | `### Lỗi 2: Dùng "the" với danh từ số nhiều/không đếm được nói chung` ← **M002** |
| 6 | `articles.zero.when-to-use` | section | `### Zero Article — Không dùng mạo từ` |
| 7 | `articles.a-vs-an.sound-rule` | concept | `### A hay An? — Quy tắc âm thanh, không phải chữ cái` |
| 8 | `articles.vietnamese-pitfall.country-the-misuse` | pitfall | `### Lỗi 4: Dùng "the" trước tên nước` ← **M003** |
| 9 | `articles.ielts.speaking-application` | ielts-application | `### IELTS Speaking` |

### "Missing 'the' before specific noun" — the dominant production pattern

72 of 160 production rows route to `articles` slug. The vast majority (sample: 5/5) match the pattern **`Thiếu mạo từ 'the' trước X`** — definite article omission before a specific reference, e.g.:

- `"Thiếu mạo từ 'the' trước 'water' — 'fell into water' → 'fell into the water'"`
- `"Thiếu mạo từ 'the' trước 'first time' — nên dùng 'the first time when'"`
- `"Thiếu mạo từ 'the' trước 'combination'"`
- `"Thiếu mạo từ 'the' trước 'way home'"`
- `"Thiếu mạo từ 'the' trước 'bustle city'"`

**No existing anchor in `articles.md` covers this pattern.** Closest fits and why each falls short:

| Candidate | Fit | Problem |
|---|---|---|
| `articles.definite.when-to-use` | partial | Positive instructional anchor — covers when to USE "the", not the omission pitfall pattern. Acceptable for now but imprecise. |
| `articles.definite.overuse-with-general-uncount` | poor | Opposite direction (overuse, not omission). Already M002. |
| `articles.overview` | very poor | Far too broad. |

**Recommendation for planner (Q1):** Either (a) **route new mapping to `articles.definite.when-to-use`** as best-available existing anchor, or (b) **add a new anchor `articles.definite.missing-before-specific-reference`** to `articles.md` (the article does discuss this — see line 87 "Bỏ mạo từ: ❌ "She is student.""). Option (b) gives a precise destination for the dominant production pattern; option (a) ships faster but lands users on a less-targeted section.

Planner's call.

---

## Task 3 — `tense-consistency` (31 production occurrences)

**Path:** `backend/content/error-clinic/tense-consistency.md`
**Status:** ✓ exists, ✓ has anchors block

**Anchors declared (2):**

| Anchor ID | Section |
|---|---|
| `tense-consistency.overview` | `## Tóm tắt` |
| `tense-consistency.common-mistake.tense-shift-mid-narrative` | (within main section) |

**Top sections (## headings):**

```
## Tóm tắt
## Tại sao quan trọng
## Nguyên tắc cơ bản
## Phần 1: Nhất quán trong mô tả quá khứ (Past narrative)
## Phần 2: Nhất quán trong IELTS Writing Task 2
## Phần 3: Nhất quán trong IELTS Writing Task 1
## Phần 4: Các trường hợp chuyển thì hợp lệ
## Lỗi thường gặp
   ### Lỗi 1: Random tense shift — chuyển thì vô lý
   ### Lỗi 2: Kể chuyện ở Present Simple (historical present) trong academic writing
   ### Lỗi 3: Nhầm Present Perfect và Past Simple
   ### Lỗi 4: Dùng Present Simple cho xu hướng trong Task 1 (khi dữ liệu là quá khứ)
   ### Lỗi 5: Quên nhất quán khi viết nhiều đoạn
## Ứng dụng trong IELTS Speaking
## Bài tập luyện
## Tóm tắt nhanh
```

**Notes:** Existing 2 anchors are sufficient for high-level mapping but this file has 5 distinct "Lỗi N" pitfall subsections that could become richer pitfall-anchors if planner wants finer-grained routing. For Phase 2 minimal scope, the existing `tense-consistency.common-mistake.tense-shift-mid-narrative` is good enough — production strings like `"Sai thì hiện tại đơn trong ngữ cảnh quá khứ"` map cleanly to "tense shift mid-narrative".

---

## Task 4 — `article-errors` (22 production occurrences)

**Path:** `backend/content/error-clinic/article-errors.md`
**Status:** ✓ exists, **✗ NO anchors block in frontmatter**

**Top sections (## / ### headings):**

```
## Tóm tắt
## Tại sao quan trọng
## Quy tắc cơ bản
   ### Khi dùng "a / an"
   ### Khi dùng "the"
   ### Khi không dùng mạo từ (Zero Article ∅)
## Lỗi thường gặp
   ### Lỗi 1: Bỏ "the" khi nói về thứ duy nhất
   ### Lỗi 2: Thêm "the" trước danh từ chung chung
   ### Lỗi 3: Nhầm "a" với "an"
   ### Lỗi 4: Dùng "a" với danh từ số nhiều hoặc không đếm được
   ### Lỗi 5: Quên "the" lần thứ hai nhắc đến
   ### Lỗi 6: Dùng "the" trước tên quốc gia không cần "the"
   ### Lỗi 7: Bỏ "a" khi phân loại
## Ứng dụng trong IELTS
## Bài tập luyện
## Tóm tắt nhanh
```

**Notes:** This file is a goldmine for anchor-richness — 7 distinct numbered pitfalls. Sprint 6 could add 7 anchors here (one per Lỗi N), giving the matcher 7 distinct routing destinations for the 22 production rows. That's the most impactful single-file investment.

**Suggested anchor IDs for planner consideration:**

```
article-errors.overview
article-errors.pitfall.missing-the-with-unique-reference  # Lỗi 1
article-errors.pitfall.the-with-general-noun              # Lỗi 2 (overlaps M002 partially)
article-errors.pitfall.a-vs-an-confusion                  # Lỗi 3
article-errors.pitfall.a-with-plural-or-uncount           # Lỗi 4
article-errors.pitfall.missing-the-on-second-mention      # Lỗi 5
article-errors.pitfall.the-with-country-name              # Lỗi 6 (overlaps M003 partially)
article-errors.pitfall.missing-a-when-categorizing        # Lỗi 7
```

Cross-article anchor overlap with `articles.md` (Lỗi 2 / 6 overlap M002 / M003): planner decides whether to route shared production patterns to whichever article surface is more user-friendly, or accept duplicate routing.

---

## Task 5 — 6 smaller slugs

| Slug | File path | Anchors? | Top sections summary |
|---|---|---|---|
| `this-that-these-those-in-use` | `foundations/this-that-these-those-in-use.md` | **✗** | 6 PHẦN sections + `## Lỗi thường gặp` with 4 "Lỗi N" sub-sections |
| `missing-subjects` | `error-clinic/missing-subjects.md` | **✗** | 4 KIỂU (kind) sections + `## Lỗi thường gặp trong IELTS` with 4 "Lỗi N" sub-sections |
| `missing-main-verbs` | `error-clinic/missing-main-verbs.md` | **✗** | 4 KIỂU sections + `## Lỗi thường gặp trong IELTS` with 4 "Lỗi N" sub-sections |
| `articles-with-places-and-names` | `foundations/articles-with-places-and-names.md` | **✗** | 9 NHÓM (group) sections + `## Lỗi thường gặp` with 5 "Lỗi N" sub-sections |
| `agreeing-and-disagreeing-naturally` | `ielts-grammar-lab/agreeing-and-disagreeing-naturally.md` | **✗** | 7 PHẦN sections + `## Lỗi thường gặp` with 4 "Lỗi N" sub-sections |
| `overusing-i-think` | `error-clinic/overusing-i-think.md` | **✗** | 4 NHÓM (group) sections + `## Lỗi thường gặp` with 5 "Lỗi N" sub-sections |

**Pattern:** Every file follows the same structure: thematic sections + a `## Lỗi thường gặp` block with numbered "Lỗi N: ..." pitfalls. This makes batch anchor-addition tractable — the same template applies (overview anchor + N pitfall anchors per file).

**Files all confirmed present.** No structural escalation needed. Pure content work to add anchors.

**Production occurrence weights** (Phase 0 data):

| Slug | Production rows | Sprint 6 priority |
|---|---|---|
| `this-that-these-those-in-use` | 4 | Medium |
| `missing-subjects` | 3 | Low-Medium |
| `missing-main-verbs` | 3 | Low-Medium |
| `articles-with-places-and-names` | 3 | Low-Medium |
| `agreeing-and-disagreeing-naturally` | 2 | Low |
| `overusing-i-think` | 2 | Low |

Total: 17 rows across 6 small slugs (10.6% of sample). Planner may decide to defer some/all to Sprint 7 if Phase 2a anchor-declaration cost dominates Phase 2b mapping ROI for the smaller ones.

---

## Task 6 — Mapping schema reference

Confirmed structure from M001 template:

```yaml
- mapping_id: M001                                    # required, monotonic, next is M031
  target_anchor: articles.indefinite.missing-...     # required, must exist in some article's frontmatter
  target_file: backend/content/foundations/articles.md  # required, must match Path(target_file).stem == slug
  feedback_pattern_summary: "Quên 'a/an' trước..."   # required, Vietnamese 1-line description
  feedback_keywords:                                 # required, list — both English and Vietnamese supported
    - "missing article"
    - "missing indefinite article"
    - "no determiner before singular count noun"
    - "singular count noun without article"
    - "article omission"
  user_phrase_examples:                              # required, list — concrete sentences
    - "I have car"
    - "She is teacher"
  confidence: high                                   # required: high | medium | low
  severity: common                                   # required: common | important | nuance
  related_anchors:                                   # optional, list of related anchor IDs
    - articles.indefinite.when-to-use
    - articles.overview
```

**Optional fields seen in older mappings:**
- `deferred_until: <sprint-id>` — defensive skip flag (Sprint 6 should NOT use; we're resolving deferrals, not creating them)
- `deferred_reason: "<text>"` — companion to deferred_until

**Vocabulary constants** (from yaml header comments):

```
Severity:    common (high-frequency, prioritized)
             important (meaningful, shown if no common match)
             nuance (subtle, only when explicit)

Confidence:  high (specific keywords, surface always)
             medium (overlap, surface if no high match)
             low (fallback only)
```

**Sprint 6 mapping ID range:** Phase 2 starts at **M031**. With ~7 anchors per `article-errors.md` + 2-3 per `tense-consistency.md` + ~1 per other file (or per major pitfall section), expansion is on the order of **+15-25 mappings** (M031 through ~M050-M055).

---

## Critical finding for Phase 2 design — Vietnamese keywords

The Phase 0 finding stands and Task 2 confirms it: 72 production rows route to `articles` slug, M001-M003 cover this slug, yet 0 anchors resolved. Why? **Existing mapping `feedback_keywords` are English-only.**

M001 keywords:
```
- "missing article"
- "missing indefinite article"
- "no determiner before singular count noun"
- "singular count noun without article"
- "article omission"
```

But Claude's actual production output is Vietnamese: `"Thiếu mạo từ 'the' trước 'water'"`. The matcher's keyword-overlap scoring tokenizes the Vietnamese string and finds zero matches in the English keyword list → score below 0.35 threshold → returns None.

**Planner Phase 2 must:**
1. Add Vietnamese keywords to existing M001-M003 (and similar older mappings if planner wants to fill the gap retroactively): `"thiếu mạo từ"`, `"thiếu the"`, `"thiếu a"`, `"thiếu an"`, `"bỏ mạo từ"`, etc.
2. Use Vietnamese-rich keywords for ALL new Sprint 6 mappings.
3. Include `user_phrase_examples` that mirror Claude's actual output style: `"Thiếu mạo từ 'the' trước 'water'"` (with Vietnamese explanatory clause), not just `"I have car"` (raw learner-error English).

**Caveat for planner:** Touching older mappings (M001-M003) widens Sprint 6 scope. Could split: M031+ for new mappings (clean Sprint 6), and a separate Sprint 6.5 or maintenance pass for retroactively bilingualizing M001-M030. Either way is fine — flagging the choice.

---

## Open questions for planner

**Q1 — Missing 'the' anchor in articles.md.**
The dominant production pattern (`Thiếu mạo từ 'the' trước X`, ~45 of 72 articles-slug rows) has no precise existing anchor. Three options:

- **A. Route to `articles.definite.when-to-use`** (existing, broader) — ships fastest, anchor exists
- **B. Add new anchor `articles.definite.missing-before-specific-reference`** to `articles.md` — precise but expands Phase 2a scope
- **C. Route to a new `article-errors` anchor** (e.g., `article-errors.pitfall.missing-the-with-unique-reference` from Task 4 proposal) — sends users to the error-clinic article instead of foundations/articles, which may be more pedagogically appropriate

Planner picks. Option C feels most natural given `article-errors.md` is explicitly a pitfall-treatment article, but ranking depends on Andy's UX preferences.

**Q2 — Phase 2 chunking shape.**
Two natural splits:

- **Tight Sprint 6:** anchor work + mapping work for top 3 slugs only (`articles`, `tense-consistency`, `article-errors`) = ~75% of production traffic. Defer 6 smaller slugs to Sprint 7. Smaller PR, faster ship.
- **Broad Sprint 6:** anchor work + mapping work for all 8 slugs = ~95% of production traffic in top-15. Bigger PR, longer review.

Recommendation if planner wants my opinion: **tight scope** for the first round (top 3 only). The 5 smaller slugs collectively account for 17/160 = 10.6% — diminishing returns and they invite scope creep risk on a content-heavy sprint.

**Q3 — Bilingualize older mappings (M001-M030)?**
Adding Vietnamese keywords to M001-M030 retroactively would lift the existing-mapping anchor-resolution rate on `articles` slug from ~0% to (likely) ~60-80% — a big win on its own. But it's editing 30 existing mappings, which has its own review burden.

Options:
- **Yes, bundle into Sprint 6** — biggest immediate impact, single PR
- **No, defer to maintenance pass** — keeps Sprint 6 strictly additive (M031+)
- **Yes, but only for M001-M003** — 3 highest-traffic mappings, surgical

Planner picks. My instinct: bundle into Sprint 6 as a single commit (`feat(grammar): bilingualize M001-M030 feedback_keywords`) before the M031+ additions. The change is mechanical (add 4-5 Vietnamese keywords per mapping), low-risk, and turns Sprint 6 from "infrastructure improvement" into "demonstrably moves the needle on production anchor population".

**Q4 — Anchor naming convention for new anchors.**
Existing pattern in `articles.md`: `<article>.<section>.<descriptor>` (e.g., `articles.definite.overuse-with-general-uncount`). Existing in `tense-consistency.md`: `<article>.common-mistake.<descriptor>` and `<article>.overview`.

Should new anchors in `article-errors.md` follow:
- `article-errors.pitfall.<descriptor>` (mirrors `articles.md` pitfall pattern)
- `article-errors.common-mistake.<descriptor>` (mirrors `tense-consistency.md`)
- `article-errors.lỗi-N.<descriptor>` (mirrors content's "Lỗi N" Vietnamese numbering — language-mixed, less idiomatic)

I'd recommend `article-errors.pitfall.<descriptor>` for consistency with the `articles.md` pitfall anchors, but planner's call.

**Q5 — Drift gate during Phase 2a.**
If Phase 2 splits into 2a (add anchors) and 2b (add mappings), the drift gate stays green throughout (no new mapping references unresolved anchor; no new anchor is unreferenced — declared anchors aren't required to be referenced). Two atomic commits is therefore safe. Confirming planner doesn't expect a tighter "all-or-nothing" gate.

---

## Mapping coverage gaps — quantified

From Phase 0 sample (160 rows):

- **Top 3 slugs** (`articles` 72 + `tense-consistency` 31 + `article-errors` 22) = 125 rows = **78.1% of sample**.
  Sprint 6 tight scope addresses ~78% of production traffic.

- **Top 8 slugs** (above + 5 smaller) = 142 rows = **88.7% of sample**.
  Sprint 6 broad scope addresses ~89%.

- **Tail (slugs with 1-2 occurrences each)** = 18 rows = ~11% of sample.
  Diminishing returns; Sprint 7+ territory.

Within the top 3:
- 72 `articles` rows already route to a slug with mappings — the bilingualize-keywords lever (Q3) alone could lift these without adding any new mappings.
- 31 `tense-consistency` rows route to a slug with declared anchors but NO mappings — pure additive Phase 2b work, no anchor declaration needed (unless planner wants finer-grained pitfall anchors).
- 22 `article-errors` rows route to a slug with NO anchors — Phase 2a anchor declaration first, then Phase 2b mappings.

---

## Acceptance criteria

- [x] Working tree clean throughout (read-only, only this report written to gitignored `grammar-audit/`)
- [x] M001-M003 anchor existence verified (all 3 ✓)
- [x] `articles.md` anchor list complete (all 9 documented per Task 2)
- [x] `tense-consistency` target file located, has anchors (Task 3)
- [x] `article-errors` target file located, NO anchors (Task 4)
- [x] 6 smaller slugs investigated — all files exist, none have anchors except common pattern observed
- [x] Mapping schema reference captured (M001 template, vocabulary constants, next-ID = M031)
- [x] Open questions flagged for planner (5 Qs with recommendations)
- [x] No code changes
- [x] Drift gate still green at end of phase

---

## STOP — awaiting planner review

Per Sprint 6 Phase 1 prompt directive: do not proceed past this report until planner Claude resolves the 5 open questions and finalizes Phase 2 design.

The single most consequential question is Q3 (bilingualize older mappings) — answering yes converts Sprint 6 from "fix new slug coverage" into "fix the actual production rate" with a relatively small, mechanical change. Awaiting that call before drafting Phase 2 prompt.
