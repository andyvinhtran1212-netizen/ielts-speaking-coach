"""kp_roadmap — the personal learning roadmap (Phase 2.3).

Builds, for one learner, the ordered set of grammar KPs to work on next:

    { weak KPs } ∪ { their prerequisites that aren't yet 'strong' }

topo-sorted so prerequisites come first (you fix the foundation before the thing
built on it). Status is rolled up to the ARTICLE from all its evidence (a weak
anchor-level signal makes the whole article weak), because the prerequisite graph
(kp_prerequisites) is article-level.

When the learner has no evidence yet (no weak KPs), returns {mode: 'static'} so
the frontend falls back to the existing static `pathways` view — the roadmap only
personalizes once there is something to personalize on.

Pure graph work on top of best-effort DB reads; any DB failure degrades to the
static fallback rather than erroring.
"""
from __future__ import annotations

import logging
from typing import Optional

from database import supabase_admin
from services import kp_evidence
from services.grammar_content import grammar_service

logger = logging.getLogger(__name__)

# Roll-up precedence: any weak → weak; else any learning/unseen → learning;
# else all strong → strong. ("unseen" = no row; treated as not-yet-strong.)
_STATUS_RANK = {"weak": 0, "learning": 1, "unseen": 1, "strong": 2}


def _article_kp_maps() -> tuple[dict[str, str], dict[str, str]]:
    """(slug → article-level grammar KP id, kp_id → slug) for anchor='' grammar KPs."""
    slug_to_id: dict[str, str] = {}
    id_to_slug: dict[str, str] = {}
    start = 0
    while True:
        rows = (supabase_admin.table("knowledge_points")
                .select("id,ref_slug,anchor")
                .eq("kp_type", "grammar").eq("anchor", "")
                .range(start, start + 999).execute().data or [])
        for r in rows:
            slug_to_id[r["ref_slug"]] = r["id"]
            id_to_slug[r["id"]] = r["ref_slug"]
        if len(rows) < 1000:
            break
        start += 1000
    return slug_to_id, id_to_slug


def _prereq_edges_by_slug(id_to_slug: dict[str, str]) -> dict[str, set[str]]:
    """dependent_slug → {prerequisite_slug} from kp_prerequisites."""
    deps: dict[str, set[str]] = {}
    start = 0
    while True:
        rows = (supabase_admin.table("kp_prerequisites")
                .select("kp_id,prereq_kp_id")
                .range(start, start + 999).execute().data or [])
        for r in rows:
            dep = id_to_slug.get(r["kp_id"])
            pre = id_to_slug.get(r["prereq_kp_id"])
            if dep and pre:
                deps.setdefault(dep, set()).add(pre)
        if len(rows) < 1000:
            break
        start += 1000
    return deps


def _rollup_status_by_slug(user_id: str) -> dict[str, str]:
    """Roll every grammar mastery row up to its article slug (worst status wins)."""
    by_slug: dict[str, str] = {}
    for m in kp_evidence.get_user_mastery(user_id, kp_type="grammar"):
        slug, status = m.get("ref_slug"), m.get("status")
        if not slug or status not in _STATUS_RANK:
            continue
        cur = by_slug.get(slug)
        if cur is None or _STATUS_RANK[status] < _STATUS_RANK[cur]:
            by_slug[slug] = status
    return by_slug


def _topo_order(nodes: set[str], deps: dict[str, set[str]]) -> list[str]:
    """Kahn topo-sort so a prerequisite precedes anything that requires it. Only
    edges within `nodes` count. Any leftover (a cycle) is appended deterministically."""
    indeg = {n: 0 for n in nodes}
    adj: dict[str, list[str]] = {n: [] for n in nodes}
    for dep in nodes:
        for pre in deps.get(dep, ()):  # dep requires pre → edge pre → dep
            if pre in nodes:
                adj[pre].append(dep)
                indeg[dep] += 1
    queue = sorted([n for n in nodes if indeg[n] == 0])
    order: list[str] = []
    while queue:
        n = queue.pop(0)
        order.append(n)
        for m in sorted(adj[n]):
            indeg[m] -= 1
            if indeg[m] == 0:
                queue.append(m)
        queue.sort()
    if len(order) < len(nodes):  # cycle guard — append the rest deterministically
        order += sorted(nodes - set(order))
    return order


def _node(slug: str, status: str, is_weak: bool, slug_to_id: dict[str, str]) -> dict:
    art = grammar_service.articles_by_slug.get(slug) or {}
    return {
        "kp_id":    slug_to_id.get(slug),
        "slug":     slug,
        "title":    art.get("title") or slug,
        "category": art.get("category"),
        "status":   status,
        "is_weak":  is_weak,
    }


def build_roadmap(user_id: str) -> dict:
    """See module docstring. Returns {mode: 'personal', nodes: [...]} or
    {mode: 'static'} when there is no evidence to personalize on."""
    try:
        status_by_slug = _rollup_status_by_slug(user_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("[kp] roadmap mastery read failed user=%s: %s", user_id, e)
        return {"mode": "static", "nodes": []}

    weak = {s for s, st in status_by_slug.items() if st == "weak"}
    if not weak:
        return {"mode": "static", "nodes": []}

    try:
        slug_to_id, id_to_slug = _article_kp_maps()
        deps = _prereq_edges_by_slug(id_to_slug)
    except Exception as e:  # noqa: BLE001
        logger.warning("[kp] roadmap graph read failed user=%s: %s", user_id, e)
        return {"mode": "static", "nodes": []}

    # Closure: weak KPs + their prerequisites that are not yet 'strong'.
    selected: set[str] = set(weak)
    frontier = list(weak)
    while frontier:
        cur = frontier.pop()
        for pre in deps.get(cur, ()):
            if pre in selected:
                continue
            if status_by_slug.get(pre, "unseen") != "strong":
                selected.add(pre)
                frontier.append(pre)

    order = _topo_order(selected, deps)
    nodes = [_node(s, status_by_slug.get(s, "unseen"), s in weak, slug_to_id)
             for s in order]
    return {"mode": "personal", "weak_count": len(weak), "nodes": nodes}
