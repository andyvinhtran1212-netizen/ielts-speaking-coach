"""Verify knowledge_points ↔ live-asset integrity (KP → asset drift).

The seed (scripts/seed_knowledge_points.py) writes one KP per live asset, so at
seed time every row resolves. This gate catches DRIFT that accumulates AFTER:
a grammar article or anchor is renamed/deleted, a vocab card is removed, or the
skill taxonomy changes — any of which leaves a knowledge_points row pointing at
a dead asset, which would then mis-route a recommendation / roadmap node.

Needs the DB (vocab's source of truth is the DB, not markdown), so it runs where
supabase_admin is configured — the same posture as running the seed (pre-deploy /
manual), NOT the offline pytest gate. The offline contract for content kp_refs is
locked separately by tests/test_kp_ref_drift.py.

Two checks:

1. FORWARD — KP → asset (HARD gate, exit 1 on failure):
   Every knowledge_points row must resolve via services.kp_registry: grammar slug
   (+ anchor declared), vocab slug present, skill_tag in the closed taxonomy.
   Grammar anchor body-markers are NOT re-checked here — every declared anchor is
   already HARD-gated to have a `<!-- anchor: -->` marker by
   scripts/verify_anchor_drift.py, so a resolved grammar anchor transitively has
   a working deep-link.

2. REVERSE — asset → KP (WARN only):
   Every live asset SHOULD have a KP (else the seed is stale). Reported as a
   warning, not a failure, because a missing KP degrades gracefully (no
   recommendation) rather than mis-routing. Re-run the seed to fix.

Exit codes:
  0 — every KP row resolves to a live asset
  1 — forward drift (≥1 KP points at a dead asset), or the table is empty/unreadable
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import supabase_admin
from scripts.seed_knowledge_points import (
    _collect_grammar, _collect_skill, _collect_vocab, _dedup,
)
from services import kp_registry

_PAGE = 1000


def _load_all_kp() -> list[dict]:
    """Paginate the full knowledge_points table (rows > PostgREST default cap)."""
    rows: list[dict] = []
    start = 0
    while True:
        resp = (supabase_admin.table("knowledge_points")
                .select("kp_type,ref_slug,anchor")
                .range(start, start + _PAGE - 1)
                .execute())
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < _PAGE:
            return rows
        start += _PAGE


def _key(r: dict) -> tuple:
    return (r["kp_type"], r["ref_slug"], r.get("anchor") or "")


def main() -> int:
    kp_rows = _load_all_kp()
    if not kp_rows:
        print("FAIL knowledge_points is empty or unreadable — apply migration 127 "
              "and run scripts.seed_knowledge_points first.")
        return 1

    print(f"Loaded {len(kp_rows)} knowledge_points rows.")

    # 1. FORWARD — every KP resolves to a live asset.
    vocab_known = kp_registry.vocab_slugs()  # one scan, reused across vocab rows
    drift: list[str] = []
    for r in kp_rows:
        reason = kp_registry.resolve_ref(
            r["kp_type"], r["ref_slug"], r.get("anchor") or "",
            vocab_known=vocab_known,
        )
        if reason:
            anchor = r.get("anchor") or ""
            loc = f"{r['kp_type']}:{r['ref_slug']}" + (f"#{anchor}" if anchor else "")
            drift.append(f"  {loc} — {reason}")

    if drift:
        print(f"\nFAIL KP→asset drift: {len(drift)} row(s) point at a dead asset "
              f"(rename/delete the KP, or restore the asset):")
        print("\n".join(sorted(drift)))
    else:
        print(f"OK Forward: all {len(kp_rows)} KP rows resolve to live assets.")

    # 2. REVERSE — every live asset has a KP (seed freshness, WARN only).
    expected = _dedup(_collect_grammar() + _collect_vocab() + _collect_skill())
    present = {_key(r) for r in kp_rows}
    missing = [e for e in expected if (e["kp_type"], e["ref_slug"], e["anchor"]) not in present]
    if missing:
        print(f"\nWARN {len(missing)} live asset(s) have NO KP row (seed is stale — "
              f"re-run scripts.seed_knowledge_points):")
        for e in missing[:20]:
            anchor = e["anchor"]
            loc = f"{e['kp_type']}:{e['ref_slug']}" + (f"#{anchor}" if anchor else "")
            print(f"      - {loc}")
        if len(missing) > 20:
            print(f"      … and {len(missing) - 20} more")
    else:
        print(f"OK Reverse: every live asset ({len(expected)}) has a KP row.")

    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
