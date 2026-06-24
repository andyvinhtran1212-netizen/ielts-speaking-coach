"""A2 (Plan-A) — verify_anchor_drift.py audits BODY markers, not just
frontmatter `anchors:` declarations.

The old script only checked that a mapping's target_anchor appeared in some
file's frontmatter `anchors:` list. But deep-link scroll is driven by the
`<!-- anchor: id -->` body marker (grammar_content.py converts it into the
`<a id>` the browser scrolls to). A declared-but-unmarked anchor passed the
old gate yet silently landed the user at page top.

These tests pin the detection logic on synthetic fixtures, plus the
WARN-now / STRICT-later exit-code contract on the real repo.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import scripts.verify_anchor_drift as vad

REPO_ROOT = Path(__file__).resolve().parents[2]


# ── fixtures: a throw-away content tree the audit scans ──────────────────

@pytest.fixture
def content_tree(tmp_path, monkeypatch):
    """Point the script's ROOT/CONTENT_DIR at a tmp tree. Returns a writer
    fn (relpath-under-content, text) -> None."""
    content = tmp_path / "backend" / "content"
    (content / "foundations").mkdir(parents=True)
    monkeypatch.setattr(vad, "ROOT", tmp_path)
    monkeypatch.setattr(vad, "CONTENT_DIR", content)

    def write(rel: str, text: str):
        p = content / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return write


def _article(anchors_yaml: str, body: str) -> str:
    return f"---\ntitle: T\nslug: s\n{anchors_yaml}---\n{body}"


def test_full_marker_file_has_no_violations(content_tree):
    content_tree("foundations/good.md", _article(
        "anchors:\n"
        "  - id: good.overview\n"
        "    location: '## Tóm tắt'\n",
        "<!-- anchor: good.overview -->\n## Tóm tắt\nNội dung.\n",
    ))
    audit = vad.audit_body_markers()
    assert audit["missing_marker"] == []
    assert audit["location_mismatch"] == []
    assert audit["reverse_drift"] == []


def test_missing_body_marker_detected(content_tree):
    """Declared in frontmatter, NO `<!-- anchor: -->` in body → the bug the
    old gate missed."""
    content_tree("foundations/bad.md", _article(
        "anchors:\n"
        "  - id: bad.section\n"
        "    location: '## Phần'\n",
        "## Phần\nKhông có marker.\n",
    ))
    audit = vad.audit_body_markers()
    ids = [d["id"] for d in audit["missing_marker"]]
    assert "bad.section" in ids


def test_location_heading_mismatch_detected(content_tree):
    """Declared location heading not present in the body."""
    content_tree("foundations/loc.md", _article(
        "anchors:\n"
        "  - id: loc.x\n"
        "    location: '## Heading That Does Not Exist'\n",
        "<!-- anchor: loc.x -->\n## A Different Heading\nText.\n",
    ))
    audit = vad.audit_body_markers()
    ids = [d["id"] for d in audit["location_mismatch"]]
    assert "loc.x" in ids


def test_reverse_drift_detected(content_tree):
    """A body marker that no frontmatter declares."""
    content_tree("foundations/rev.md", _article(
        "anchors:\n"
        "  - id: rev.declared\n"
        "    location: '## H'\n",
        "<!-- anchor: rev.declared -->\n## H\n"
        "<!-- anchor: rev.orphan -->\n## H2\n",
    ))
    audit = vad.audit_body_markers()
    ids = [d["id"] for d in audit["reverse_drift"]]
    assert "rev.orphan" in ids
    assert "rev.declared" not in ids


def test_dotted_anchor_ids_are_parsed(content_tree):
    """Anchor IDs are kebab-dot (contain '.') — the marker regex must match
    them or every marker reads as 'missing'."""
    content_tree("foundations/dot.md", _article(
        "anchors:\n"
        "  - id: a.b.c\n"
        "    location: '## H'\n",
        "<!-- anchor: a.b.c -->\n## H\n",
    ))
    audit = vad.audit_body_markers()
    assert audit["missing_marker"] == []
    assert "a.b.c" in vad.collect_body_markers()


# ── broken-hotlink check (mapping resolves but no body marker) ────────────

def test_broken_hotlink_detection():
    declared = {"x.resolved": "f.md", "x.marked": "f.md"}
    marker_ids = {"x.marked"}
    mappings = [
        {"mapping_id": "m1", "target_anchor": "x.resolved"},                       # broken
        {"mapping_id": "m2", "target_anchor": "x.marked"},                         # ok
        {"mapping_id": "m3", "target_anchor": "x.resolved", "deferred_until": "S9"},  # skip
        {"mapping_id": "m4", "target_anchor": "x.undeclared"},                     # not resolved → not here
    ]
    broken = vad.find_broken_hotlinks(mappings, declared, marker_ids)
    ids = [d["mapping_id"] for d in broken]
    assert ids == ["m1"]


# ── WARN-now / STRICT-later exit-code contract (real repo) ────────────────

def test_warn_mode_exits_zero_on_real_repo():
    """Default (no env) — body-marker backlog is WARN, must not fail CI."""
    r = subprocess.run(
        [sys.executable, "backend/scripts/verify_anchor_drift.py"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "Body-marker audit" in r.stdout
    assert "warning only" in r.stdout


def test_strict_mode_exits_nonzero_on_real_repo():
    """ANCHOR_BODY_MARKERS_STRICT=1 flips the body audit to a HARD gate —
    the A3-backfill flip. With the legacy backlog present it must fail."""
    import os
    env = {**os.environ, "ANCHOR_BODY_MARKERS_STRICT": "1"}
    r = subprocess.run(
        [sys.executable, "backend/scripts/verify_anchor_drift.py"],
        capture_output=True, text=True, cwd=REPO_ROOT, env=env,
    )
    assert r.returncode == 1, r.stdout + r.stderr
    assert "FAIL Body-marker audit" in r.stdout
