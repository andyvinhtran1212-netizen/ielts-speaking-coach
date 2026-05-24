"""
Sprint 14.9 — cluster 14.x closure sentinels (Codex F5 + F6).

Source-scan / file-presence checks (no live DB, no JRE — the F5 probe itself is
exercised at deploy-time via /health/grammar-check, not in this unit suite,
which is exactly the gap F5 flagged). These pin the closure artifacts and the
F5 code so the closure can't silently rot or contradict itself.
"""

from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]


def _read(rel: str) -> str:
    return (_REPO / rel).read_text(encoding="utf-8")


# ── F6: closure artifacts exist ─────────────────────────────────────────────────

def test_retrospective_exists():
    assert (_REPO / "docs/clusters/14_x/retrospective.md").is_file()


def test_phase_b_backlog_exists():
    assert (_REPO / "docs/clusters/14_x/phase_b_backlog.md").is_file()


def test_ledger_has_cluster_14_x_cross_reference_row():
    ledger = _read("PHASE_CLOSURE_LEDGER.md")
    assert "DEBT-SPEAKING-GRADING-QUALITY (cluster 14.x)" in ledger
    assert "docs/clusters/14_x/retrospective.md" in ledger
    assert "Sprint 14.9" in ledger


def test_discovery_has_closure_reconciliation():
    disc = _read("docs/clusters/14_x/discovery.md")
    assert "Cluster Closure Reconciliation" in disc
    assert "16 merged PRs" in disc  # honest count


# ── F6/honest-accounting: retrospective content ────────────────────────────────

def test_retrospective_codifies_pattern_42():
    retro = _read("docs/clusters/14_x/retrospective.md")
    assert "Pattern #42" in retro
    assert "Commission as hypothesis" in retro


def test_retrospective_references_all_codex_findings():
    retro = _read("docs/clusters/14_x/retrospective.md")
    for finding in ("F1", "F2", "F3", "F4", "F5", "F6", "F7"):
        assert finding in retro, f"Codex {finding} must be documented"


def test_retrospective_uses_verified_counts_not_commission_figures():
    # Honest accounting: 16 merged PRs / 17 sprints, not the commission's 15/19.
    retro = _read("docs/clusters/14_x/retrospective.md")
    assert "16 merged PRs" in retro
    assert "17 sprints" in retro


def test_retrospective_has_closure_declaration():
    retro = _read("docs/clusters/14_x/retrospective.md")
    assert "CLOSED" in retro


# ── F5: grammar-check runtime probe code present ────────────────────────────────

def test_f5_grammar_check_health_function_exists():
    src = _read("backend/services/grammar_check.py")
    assert "async def grammar_check_health" in src
    # Reports the runtime signals an operator needs.
    for key in ('"status"', '"languagetool_available"', '"backend_mode"', '"sample_error_count"'):
        assert key in src, f"health probe must report {key}"


def test_f5_health_endpoint_registered():
    src = _read("backend/routers/health.py")
    assert '@router.get("/health/grammar-check")' in src
    assert "grammar_check_health" in src
