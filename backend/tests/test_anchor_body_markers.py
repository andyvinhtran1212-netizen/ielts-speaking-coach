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


# ── WARN vs STRICT exit-code contract (ISOLATED fixture, not real repo) ───
#
# These were originally written against the real repo's legacy backlog
# (expecting issues). A3 backfilled the repo to ZERO issues, so a
# "repo-is-dirty" assertion inverts. The mode contract is now proven on a
# synthetic tmp tree with exactly one planted defect — deterministic
# regardless of the real repo's state.

@pytest.fixture
def main_tree(tmp_path, monkeypatch):
    """Like content_tree but also points MAPPING_FILE at the tmp tree (with
    an empty mapping) so vad.main() can run end-to-end. Returns a writer."""
    content = tmp_path / "backend" / "content"
    (content / "foundations").mkdir(parents=True)
    monkeypatch.setattr(vad, "ROOT", tmp_path)
    monkeypatch.setattr(vad, "CONTENT_DIR", content)
    monkeypatch.setattr(vad, "MAPPING_FILE", content / "feedback-anchor-mapping.yaml")
    (content / "feedback-anchor-mapping.yaml").write_text("mappings: []\n", encoding="utf-8")

    def write(rel: str, text: str):
        p = content / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return write


def _plant_missing_marker(write):
    """One declared anchor whose body marker is absent → exactly 1 violation."""
    write("foundations/bad.md", _article(
        "anchors:\n"
        "  - id: bad.section\n"
        "    location: '## Phần'\n",
        "## Phần\nKhông có marker.\n",
    ))


def test_warn_mode_exits_zero_with_planted_defect(main_tree, monkeypatch, capsys):
    """WARN mode (STRICT off): a defect is reported but does NOT fail."""
    _plant_missing_marker(main_tree)
    monkeypatch.setattr(vad, "STRICT_BODY_MARKERS", False)
    rc = vad.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "WARN Body-marker audit" in out
    assert "warning only" in out


def test_strict_mode_exits_nonzero_with_planted_defect(main_tree, monkeypatch, capsys):
    """STRICT mode (the flipped default): the same defect fails the gate."""
    _plant_missing_marker(main_tree)
    monkeypatch.setattr(vad, "STRICT_BODY_MARKERS", True)
    rc = vad.main()
    out = capsys.readouterr().out
    assert rc == 1
    assert "FAIL Body-marker audit" in out


def test_clean_tree_exits_zero_in_strict_mode(main_tree, monkeypatch, capsys):
    """A clean tree passes even under STRICT — so the flip is safe once the
    repo has zero issues."""
    main_tree("foundations/good.md", _article(
        "anchors:\n"
        "  - id: good.overview\n"
        "    location: '## Tóm tắt'\n",
        "<!-- anchor: good.overview -->\n## Tóm tắt\nNội dung.\n",
    ))
    monkeypatch.setattr(vad, "STRICT_BODY_MARKERS", True)
    rc = vad.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "OK Body-marker audit" in out


# ── real-repo guard: the repo must STAY clean (drift-prevention) ──────────

def test_real_repo_has_zero_body_marker_issues():
    """After A3 backfill the real repo has ZERO body-marker issues. This
    guard runs the script exactly as CI does (subprocess, default env) and
    asserts a clean pass. Robust to the STRICT flip: clean → exit 0 in
    either mode. A future PR that adds a declared anchor without its body
    marker fails HERE (and in CI under STRICT)."""
    r = subprocess.run(
        [sys.executable, "backend/scripts/verify_anchor_drift.py"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "OK Body-marker audit" in r.stdout
