"""Route-level source contract for replay-safe flashcard reviews."""

from pathlib import Path


SOURCE = (
    Path(__file__).resolve().parents[1] / "routers" / "flashcards.py"
).read_text(encoding="utf-8")


def _submit_source() -> str:
    return SOURCE.split("async def submit_review(", 1)[1].split(
        '@user_router.get("/stats")', 1,
    )[0]


def test_existing_receipt_bypasses_limit_and_input_drift_conflicts():
    block = _submit_source()
    lookup = block.index("existing_receipt = _load_review_receipt")
    conflict = block.index('raise HTTPException(409, "client_review_id is already bound')
    limiter = block.index("enforce_flashcard_rate_limit(")
    assert lookup < conflict < limiter
    assert "if existing_receipt:" in block
    assert "else:\n        try:\n            enforce_flashcard_rate_limit(" in block


def test_quota_boundary_rechecks_a_concurrently_committed_receipt():
    block = _submit_source()
    assert "except HTTPException as limit_error:" in block
    assert "if limit_error.status_code != 429 or not body.client_review_id:" in block
    assert block.count("_load_review_receipt(sb, user_id, client_review_id)") == 2
    assert "if not existing_receipt:\n                raise" in block


def test_atomic_rpc_receipt_is_authoritative_and_kp_evidence_runs_once():
    block = _submit_source()
    assert 'sb.rpc("fn_apply_srs_review_idempotent"' in block
    assert '"p_client_review_id": client_review_id' in block
    assert '"p_rating":           body.rating' in block
    assert 'replayed = persisted.get("replayed")' in block
    assert "if not replayed:\n        kp_evidence.record_srs_review(" in block
    assert '"replayed":       replayed' in block
    assert 'table("flashcard_review_log").insert' not in block
    assert "if _is_review_idempotency_conflict(e):" in block
    assert '"already bound to different input" in str(e).lower()' not in block


def test_idempotency_lookup_fails_closed():
    helper = SOURCE.split("def _load_review_receipt(", 1)[1].split(
        '@user_router.post("/{vocab_id}/review")', 1,
    )[0]
    assert "raise HTTPException(500, \"Could not verify review idempotency.\")" in helper
