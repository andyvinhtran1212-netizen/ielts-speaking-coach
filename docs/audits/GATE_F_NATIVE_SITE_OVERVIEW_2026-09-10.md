# Gate F wave 6 — native site map and documentation sentinel

Base: `8bac64bb5e12982a99e0f62a9ec407155c294041` (PR #1356).
Branch: `codex/gate-f-native-site-overview`.
Scope: documentation and source/doc test tooling. No physical retirement.

## Findings

**Medium — false-green documentation coverage and retirement coupling.**
`frontend/tests/site-overview-coverage.test.mjs:walk` explicitly skipped app/public
and only recursed into Dirent directories, not the legacy pages symlink.
Replaying that exact pre-change function counted only seven root files:
admin, grammar, index, login, onboarding, pricing and vocabulary HTML. Thus its
85% coverage result could remain green while native pages were undocumented.
Its dead-reference check also required physical HTML to remain indefinitely.

**Medium — stale product/source ownership.** `docs/SITE_OVERVIEW.md` called the
frontend a no-build HTML app, called Pricing a marketing page, still described
several now-native surfaces as pending migration and listed the old combined
admin route as if it were separate from the current admin overview. Its mapped
§4 rows covered only 100/130 native patterns before this wave's additions.

## Invariant mapping (ADR-005)

| Original obligation | Minimal replacement | Verification |
| --- | --- | --- |
| A: cited pages exist | Canonical §4 page-column citations must have a native owner; historical HTML prose references must be registered with a present replacement owner | Unknown native route and unknown/orphaned historical alias negative tests; real sentinel rejects a mutated login URL |
| B: ≥85% product coverage | Same floor, unique native page patterns from app instead of seven root HTML files | 130/130 current coverage; synthetic 17/20 passes threshold and 16/20 falls below; new native page enters denominator |
| C: six required surfaces | Same product identities via `/practice/session`, `/reading/exam/session`, `/reading/review`, `/admin/dashboard/reading-attempts`, `/admin/reading/content`, `/login` | Six individual assertions retained; no skip/removal |
| D: README points to product map | Unchanged README link assertion | Runs in regular CI and isolated checkout |
| Independence from old physical tree | Source collector only walks app; historical identity comes from durable manifest | Actual nine-case sentinel passes with no public, pages, CSS/JS aliases, root HTML or node_modules in the temporary checkout |

All nine original product/documentation obligations remain; their source of
truth changes deliberately, not by preserving the old defective denominator.
No metric/UI assertions were removed: the old ledger description was inaccurate
and has been corrected. The new nine-case helper suite adds negative controls.

## Document changes and coverage limits

The existing per-domain map now uses clean native URL patterns in the first
column. It adds the 30 previously missing patterns in their owning sections,
including classes/course work, live mock operations, instructor grading, quiz
and curated vocabulary. Purpose summaries were checked against the route
metadata and composed workspace imports; this is not a new full behavioral
audit of every inherited endpoint/provider/domain paragraph. That boundary is
explicit in the updated document. Pricing is documented as a server redirect;
public and authenticated vocabulary entries remain distinct. Duplicate obsolete
admin entries are consolidated rather than claiming three different `/admin` UIs.

The parser only counts page-column references in §4, not API paths in operation
prose, duplicate citations, examples inside fenced blocks or other sections.
Rows must include audience and purpose. Query examples resolve to their page
pattern; this does not validate query keys or parameter values. Historical HTML
prose mentions do not count toward native coverage and are no longer checked
for physical file existence. A manifest identity is not an HTTP probe; existing
compiled redirect and live boundary checks remain responsible for routing.

The collector reuses the existing migration mapper and two engineering-route
exclusions. Groups, private folders, dynamic patterns and parallel-slot names
are handled at source level. Unsupported JS/JSX page files, intercept/encoded
segments and App Router symlinks fail closed for explicit mapper review. It is
not a new Next compiler emulator or a replacement for compiled manifest checks.

## Verification / closure

- Focused sentinel/helper batch: 18/18 passed, no fail/cancel/skip/TODO.
- Current document: 130/130 native patterns, zero unknown page citations or
  dead historical references. Old walker replay: seven root HTML files only.
- Final full frontend regression: 9,089/9,089 passed, zero fail/cancel/skip/TODO.
- Application and legacy TypeScript: passed. Both local runtime and the existing
  frontend CI workflow use Node 24; TAP expectations were verified on that major.
- Independent Claude diff-only review: **Approve with required follow-ups**.
  Required F1 is addressed with an explicit error for any unmappable page and
  an assertion of the parallel-slot source mapping, not just its deduplicated
  route. No currently omitted native page was reproduced; this closes a future
  fail-open path. Required F5 is addressed by this completed verification record.
  Additional fixes cover missing app roots, a real symlink negative control,
  independently pinned and mapping-checked spine identities, and normalisation
  of historical URL/alias/public-source references. The real doc now includes
  Pricing as a registered historical example, so that guard is exercised too.
  Fixes were locally reverified; this is not a claim of a second Claude verdict.
- Source claims checked after review: Pricing's actual page calls redirect to
  root; admin users selects the codes tab from the query; public vocabulary is
  the wiki while the hub is authenticated; runtime generation selects staging
  for non-production Vercel environments and rejects production-origin leakage.
  The removed vocab-article HTML identity maps to the public vocabulary owner.
- Gate E v21 frozen preflight and static cutover: unchanged and passed;
  129/129 legacy owners/redirects, 5/5 Next admission, zero collisions.

This closes the SITE_OVERVIEW consumer identified in the previous Pricing
waves. CSS budgets, other broad HTML/public scanners, per-asset ownership and
authorized retirement scope remain open. No public artifact, production code,
admission setting, database or frozen Gate E input changes; no new soak and no
migration-complete claim.
