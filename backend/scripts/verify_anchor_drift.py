"""Verify that every active target_anchor in feedback-anchor-mapping.yaml
exists in some content file's frontmatter `anchors:` list.

A mapping with `deferred_until: <sprint-id>` is treated as an expected
deferral, not drift — the target anchor is allowed to be missing until
that sprint ships. When the anchor materializes, the field becomes a
no-op (still passes); when the sprint completes, the field can be
cleaned up in a maintenance pass.

Exit codes:
  0 — all active mappings resolve (deferred mappings logged for visibility)
  1 — drift detected: at least one active mapping references an
      undeclared anchor
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONTENT_DIR = ROOT / "backend" / "content"
MAPPING_FILE = CONTENT_DIR / "feedback-anchor-mapping.yaml"


def collect_declared_anchors() -> dict[str, str]:
    """Scan all .md files (skipping _archive/), collect anchor IDs from
    frontmatter `anchors:` lists. Returns id -> first-file-found."""
    declared: dict[str, str] = {}
    for md_file in CONTENT_DIR.rglob("*.md"):
        if "_archive" in md_file.parts:
            continue
        raw = md_file.read_text(encoding="utf-8")
        if not raw.startswith("---"):
            continue
        parts = raw.split("---", 2)
        if len(parts) < 3:
            continue
        try:
            fm = yaml.safe_load(parts[1]) or {}
        except yaml.YAMLError:
            continue
        for a in fm.get("anchors") or []:
            aid = a.get("id")
            if aid and aid not in declared:
                declared[aid] = str(md_file.relative_to(ROOT))
    return declared


def main() -> int:
    declared = collect_declared_anchors()

    if not MAPPING_FILE.exists():
        print(f"ERROR: mapping file not found: {MAPPING_FILE.relative_to(ROOT)}")
        return 1

    mapping_data = yaml.safe_load(MAPPING_FILE.read_text(encoding="utf-8"))
    mappings = mapping_data.get("mappings") or []

    drift: list[dict] = []
    deferred_log: list[dict] = []
    resolved = 0

    for m in mappings:
        mid = m.get("mapping_id", "?")
        target = m.get("target_anchor", "")
        deferred_until = m.get("deferred_until")

        if target in declared:
            resolved += 1
            continue

        if deferred_until:
            deferred_log.append({
                "mapping_id": mid,
                "target_anchor": target,
                "deferred_until": deferred_until,
                "reason": m.get("deferred_reason", ""),
            })
            continue

        drift.append({
            "mapping_id": mid,
            "missing_anchor": target,
            "expected_file": m.get("target_file", "unknown"),
        })

    if deferred_log:
        print(f"\u2139  {len(deferred_log)} mapping(s) deferred to future sprints (expected):")
        for d in deferred_log:
            print(f"   - {d['mapping_id']} -> {d['target_anchor']} "
                  f"(deferred_until: {d['deferred_until']})")

    if drift:
        print(f"\nFAIL Anchor drift detected: {len(drift)} mapping(s) reference unresolved anchors")
        for d in drift:
            print(f"   - {d['mapping_id']}: {d['missing_anchor']} (expected in {d['expected_file']})")
        return 1

    print(f"\nOK All {resolved} active mappings resolve to declared anchors")
    print(f"   Total declared anchors across content: {len(declared)}")
    print(f"   Deferred (not yet expected to resolve): {len(deferred_log)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
