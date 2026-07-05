"""Verify Grammar Wiki anchor integrity.

Two layers of checks:

1. MAPPING DRIFT (HARD gate — exit 1 on failure):
   Every active target_anchor in feedback-anchor-mapping.yaml must exist in
   some Grammar Wiki content file's frontmatter `anchors:` list. A mapping
   with `deferred_until: <sprint-id>` is treated as an expected deferral.

2. BODY-MARKER AUDIT (A2 — WARN by default, HARD when strict):
   Deep-link scroll only works if a declared anchor also has a matching
   `<!-- anchor: id -->` marker in the body (grammar_content.py converts that
   marker into the `<a id>` the browser scrolls to). Frontmatter `anchors:`
   declarations alone do NOT render an anchor. This audit reports:
     a. declared-but-no-body-marker  (the hotlink silently lands at page top)
     b. location-heading-mismatch    (declared `location` heading not in body)
     c. reverse drift                 (a body marker no frontmatter declares)

   The legacy backlog (~119 missing markers) was backfilled in A3, so this
   audit is now a HARD gate by DEFAULT — any new declared-but-unmarked anchor
   (or location mismatch / reverse drift / broken hotlink) fails the build,
   preventing drift from re-accumulating. Temporarily downgrade to WARN (for
   a future bulk-backfill pass that wants the full list without failing) by
   setting env ANCHOR_BODY_MARKERS_STRICT=0.

Exit codes:
  0 — all active mappings resolve AND (strict mode) no body-marker violations
  1 — mapping drift detected, OR (strict mode) body-marker violations exist
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONTENT_DIR = ROOT / "backend" / "content"
MAPPING_FILE = CONTENT_DIR / "feedback-anchor-mapping.yaml"
EXCLUDED_TOP_LEVEL_DIRS = {"reading", "exams"}

# A2: a body marker `<!-- anchor: ID -->` — ID is kebab-dot (contains '.').
# Mirrors services/grammar_content.py:_ANCHOR_MARKER_RE so the audit checks
# the SAME markers the loader converts into `<a id>`.
_ANCHOR_MARKER_RE = re.compile(r"<!--\s*anchor:\s*([A-Za-z0-9_.\-]+)\s*-->")

# HARD by default (A3 backfill complete). Set ANCHOR_BODY_MARKERS_STRICT=0
# to temporarily downgrade to WARN for a future bulk-backfill pass.
STRICT_BODY_MARKERS = os.environ.get("ANCHOR_BODY_MARKERS_STRICT", "1") == "1"


def is_grammar_article(md_path: Path) -> bool:
    """Return True for Grammar Wiki markdown files only.

    Sprint 21.3: exclude reading seed passages from grammar anchor audits.
    """
    if "_archive" in md_path.parts:
        return False
    rel = md_path.relative_to(CONTENT_DIR)
    if rel.parts and rel.parts[0] in EXCLUDED_TOP_LEVEL_DIRS:
        return False
    return True


def _grammar_files() -> list[Path]:
    return [p for p in CONTENT_DIR.rglob("*.md") if is_grammar_article(p)]


def _split_frontmatter(raw: str) -> tuple[dict | None, str]:
    """Return (frontmatter_dict, body). (None, '') if not parseable."""
    if not raw.startswith("---"):
        return None, ""
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return None, ""
    try:
        fm = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError:
        return None, ""
    return fm, parts[2]


def _norm_heading(text: str) -> str:
    """Normalize a heading / location string for comparison: drop leading
    '#' markers and surrounding whitespace."""
    return text.lstrip("#").strip()


def collect_declared_anchors() -> dict[str, str]:
    """Scan grammar wiki .md files only, collect anchor IDs from
    frontmatter `anchors:` lists. Returns id -> first-file-found.

    Public contract unchanged (used by the mapping-drift gate)."""
    declared: dict[str, str] = {}
    for rec in collect_declared_records():
        declared.setdefault(rec["id"], rec["file"])
    return declared


def collect_declared_records() -> list[dict]:
    """Every declared anchor as {id, file, location} (file = repo-relative)."""
    records: list[dict] = []
    for md_file in _grammar_files():
        fm, _body = _split_frontmatter(md_file.read_text(encoding="utf-8"))
        if fm is None:
            continue
        rel = str(md_file.relative_to(ROOT))
        for a in fm.get("anchors") or []:
            aid = a.get("id")
            if aid:
                records.append({"id": aid, "file": rel,
                                "location": a.get("location", "")})
    return records


def collect_body_markers() -> dict[str, set[str]]:
    """id -> set of repo-relative files containing `<!-- anchor: id -->`."""
    markers: dict[str, set[str]] = {}
    for md_file in _grammar_files():
        rel = str(md_file.relative_to(ROOT))
        for m in _ANCHOR_MARKER_RE.finditer(md_file.read_text(encoding="utf-8")):
            markers.setdefault(m.group(1), set()).add(rel)
    return markers


def audit_body_markers(markers: dict[str, set[str]] | None = None) -> dict[str, list]:
    """Cross-check frontmatter declarations against body markers + headings.

    Returns {missing_marker, location_mismatch, reverse_drift} — each a list
    of dicts describing one violation. Pass `markers` to reuse a single body
    scan (avoids re-reading every file)."""
    declared = collect_declared_records()
    if markers is None:
        markers = collect_body_markers()

    # Per-file heading sets (normalized) for the location check.
    headings_by_file: dict[str, set[str]] = {}
    for md_file in _grammar_files():
        _fm, body = _split_frontmatter(md_file.read_text(encoding="utf-8"))
        rel = str(md_file.relative_to(ROOT))
        headings_by_file[rel] = {
            _norm_heading(ln) for ln in body.splitlines() if ln.lstrip().startswith("#")
        }

    declared_ids = {r["id"] for r in declared}
    missing_marker: list[dict] = []
    location_mismatch: list[dict] = []

    for r in declared:
        files_with_marker = markers.get(r["id"], set())
        # (a) the declaring file must carry the body marker for this id
        if r["file"] not in files_with_marker:
            missing_marker.append({"id": r["id"], "file": r["file"]})
        # (b) the declared location heading must exist in the declaring file
        loc = _norm_heading(r["location"]) if r["location"] else ""
        if loc and loc not in headings_by_file.get(r["file"], set()):
            location_mismatch.append(
                {"id": r["id"], "file": r["file"], "location": r["location"]})

    # (c) reverse drift: a body marker no frontmatter declares
    reverse_drift: list[dict] = []
    for mid, files in sorted(markers.items()):
        if mid not in declared_ids:
            reverse_drift.append({"id": mid, "files": sorted(files)})

    return {
        "missing_marker": sorted(missing_marker, key=lambda d: (d["file"], d["id"])),
        "location_mismatch": sorted(location_mismatch, key=lambda d: (d["file"], d["id"])),
        "reverse_drift": reverse_drift,
    }


def find_broken_hotlinks(mappings: list, declared: dict[str, str],
                         marker_ids: set[str]) -> list[dict]:
    """A2 [d]: active (non-deferred) feedback-anchor-mapping target_anchors
    that resolve to a frontmatter declaration but have NO body marker — the
    mapping-drift gate counts these as "resolved", yet the AI-feedback
    deep-link silently lands at page top. The real broken-hotlink list."""
    broken: list[dict] = []
    for m in mappings:
        target = m.get("target_anchor", "")
        if m.get("deferred_until"):
            continue
        if target in declared and target not in marker_ids:
            broken.append({"mapping_id": m.get("mapping_id", "?"), "target": target})
    return broken


def _print_body_audit(audit: dict, broken_hotlinks: list[dict]) -> int:
    """Print the body-marker audit. Returns the number of violations."""
    miss = audit["missing_marker"]
    loc = audit["location_mismatch"]
    rev = audit["reverse_drift"]
    total = len(miss) + len(loc) + len(rev) + len(broken_hotlinks)
    tag = "FAIL" if STRICT_BODY_MARKERS else "WARN"

    if total == 0:
        print("\nOK Body-marker audit: every declared anchor has a matching "
              "`<!-- anchor: -->` marker + heading; no reverse drift; "
              "all mapping hotlinks resolve to a real marker.")
        return 0

    print(f"\n{tag} Body-marker audit — {total} issue(s) "
          f"({'HARD gate' if STRICT_BODY_MARKERS else 'warning only, not failing the build'}):")

    if miss:
        print(f"\n  [a] {len(miss)} declared anchor(s) with NO `<!-- anchor: id -->` "
              f"body marker (deep-link lands at page top):")
        for d in miss:
            print(f"      - {d['id']}  ({d['file']})")
    if loc:
        print(f"\n  [b] {len(loc)} declared anchor(s) whose `location` heading "
              f"is not found in the body:")
        for d in loc:
            print(f"      - {d['id']}  location={d['location']!r}  ({d['file']})")
    if rev:
        print(f"\n  [c] {len(rev)} body marker(s) NOT declared in any frontmatter "
              f"(reverse drift):")
        for d in rev:
            print(f"      - {d['id']}  ({', '.join(d['files'])})")
    if broken_hotlinks:
        print(f"\n  [d] {len(broken_hotlinks)} AI-feedback mapping(s) resolve to a "
              f"frontmatter anchor but have NO body marker (broken deep-link):")
        for d in broken_hotlinks:
            print(f"      - {d['mapping_id']} -> {d['target']}")

    return total


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
        print(f"ℹ  {len(deferred_log)} mapping(s) deferred to future sprints (expected):")
        for d in deferred_log:
            print(f"   - {d['mapping_id']} -> {d['target_anchor']} "
                  f"(deferred_until: {d['deferred_until']})")

    mapping_failed = bool(drift)
    if mapping_failed:
        print(f"\nFAIL Anchor drift detected: {len(drift)} mapping(s) reference unresolved anchors")
        for d in drift:
            print(f"   - {d['mapping_id']}: {d['missing_anchor']} (expected in {d['expected_file']})")
    else:
        print(f"\nOK All {resolved} active mappings resolve to declared anchors")
        print(f"   Total declared anchors across content: {len(declared)}")
        print(f"   Deferred (not yet expected to resolve): {len(deferred_log)}")

    # A2 body-marker audit — WARN unless strict. One body scan, reused for
    # both the declaration audit and the broken-hotlink check.
    markers = collect_body_markers()
    broken_hotlinks = find_broken_hotlinks(mappings, declared, set(markers.keys()))
    body_violations = _print_body_audit(audit_body_markers(markers), broken_hotlinks)

    if mapping_failed:
        return 1
    if STRICT_BODY_MARKERS and body_violations:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
