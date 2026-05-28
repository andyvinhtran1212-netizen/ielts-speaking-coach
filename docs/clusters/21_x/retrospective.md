# Cluster 21.x Retrospective — Grammar Wiki Learning Loop Enhancement

**Date:** 2026-05-28  
**Cluster:** 21.x Grammar Wiki Learning Loop Enhancement  
**Close mode:** light close / observation handoff

## Summary

Cluster 21.x achieved its two core product outcomes:

1. Grammar recommendations from speaking results now land reliably on the intended article section.
2. Grammar Wiki coverage for high-value recommendation targets expanded enough to convert the learning loop from fragile to operationally useful.

Long-tail anchor work remains, but it is now ongoing content maintenance rather than a dedicated engineering cluster.

## Cluster arc

### Broad Discovery

The initial Codex discovery corrected the early premise that Grammar Wiki might be thin or greenfield. Empirically, it was already a mature subsystem with public routing, anchor infrastructure, mappings, and recommendation hooks.

### Sprint 21.0 Sub-Discovery

The Sub-Discovery narrowed the problem:

- the matcher itself was not the main failure source
- the real reliability problem sat in last-mile routing and content coverage
- anchor UX existed, but inline recommendation links often never reached the article page that knew how to scroll and pulse-highlight

This step mattered because it prevented a wasted matcher rewrite.

### Sprint 21.1 Reliability

Sprint 21.1 fixed the critical operational truth bugs:

- inline result/practice recommendation links now use article routes
- draft articles stopped being normalized into live-looking recommendation targets
- missing-anchor UX gained an inline fallback
- same-page hash changes now re-trigger anchor landing
- click telemetry became more consistent across recommendation entry points

### Sprint 21.2 Coverage

Sprint 21.2 increased recommendation-ready content depth:

- active mappings grew from `47` to `61`
- covered slugs grew from `28` to `41`
- declared anchors grew from `217` to `260`
- broken anchor references stayed at `0`

The sprint focused on:

- 3 already-anchored ready slugs
- a targeted subset of high-value zero-anchor articles
- extra anchor granularity for `tense-consistency`

### Sprint 21.3 Light Close

Sprint 21.3 cleaned up remaining cluster-close concerns:

- grammar audit scripts now exclude reading content from grammar denominators
- the 3 structurally rich draft articles were reassessed and promoted to `complete`
- governance rules for `draft` vs `complete` were documented

## Metrics summary

### Reliability

- P0 root cause fixed: inline recommendation links no longer route to `grammar.html?...`
- anchor landing now correctly reaches `/grammar/<category>/<slug>#<anchor>`
- hashchange re-trigger added
- missing-anchor fallback added
- draft articles no longer leaked into recommendation results during the draft phase

### Coverage

- mappings: `47 → 61`
- covered grammar slugs: `28 → 41`
- declared anchors: `217 → 260`
- scanner denominator corrected back to grammar-only scope: `41/98` instead of `41/101`
- broken anchor refs: stayed `0`

## Root-cause lesson

The most important cluster lesson is that Andy’s “không reliable” complaint was real, but the true cause was not where it first looked.

The matcher had solid tests from the start. The actual break was the route handoff:

- recommendation metadata could resolve a slug and anchor correctly
- but inline links sent users to `grammar.html?...`
- the article-page anchor handler lived elsewhere
- so deep-link reliability failed at the last mile

This is exactly the kind of bug that broad intuition alone can miss and Sub-Discovery can surface quickly.

## Process lessons

### 1. Sub-Discovery-first sharpened implementation work

Cluster 21.x benefited from splitting discovery into:

- broad subsystem inventory
- focused Sub-Discovery on the real failure loop

That made Sprint 21.1 smaller and more accurate.

### 2. Commit discipline needs explicit verification

Sprint 21.1 work was initially verified but not committed. The fix was procedural, not technical:

- always check `git status`
- always report the commit hash
- always confirm push/PR before calling a sprint closed

Sprint 21.2 and 21.3 followed that checklist correctly.

### 3. Codex coverage prioritization worked

Instead of trying to anchor all remaining articles, Sprint 21.2 targeted the subset with the best recommendation leverage. That delivered meaningful coverage gains without bloating the cluster.

## Goals achieved

### Achieved

- speaking-grader to Grammar Wiki recommendation links are reliable
- anchor landing is operationally dependable
- key coverage gap narrowed materially
- status-truth governance is now explicit

### Partially achieved

- article-content uplift happened mainly through anchor structure and recommendation usefulness, not full editorial QA

## Deferred to observation / ongoing content work

The remaining long-tail zero-anchor articles are not a new engineering cluster by default.

They are now:

- ongoing content work
- opportunistic anchor additions as Andy edits or reviews articles
- something to monitor via recommendation telemetry and real usage rather than sprint-plan as a monolith

## Observation phase

Cluster 21.x now moves into observation mode.

Recommended observation points:

1. Recommendation click-through on newly live anchors
2. Frequency of missing-anchor fallback events after 21.1/21.2
3. Whether the newly promoted articles actually receive useful recommendation traffic
4. Whether long-tail unmapped issue shapes cluster around a few more high-value articles

## Close verdict

Cluster 21.x should be considered functionally closed.

The core learning-loop problem was solved in two real steps:

- reliability first
- focused coverage second

What remains is content maturation and incremental editorial expansion, not another core-system rescue.
