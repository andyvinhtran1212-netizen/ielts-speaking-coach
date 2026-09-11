from services import mock_correction_service as svc


def test_capture_happens_before_correctness_is_revealed(monkeypatch):
    monkeypatch.setattr(svc, "_current_explanation_rows", lambda *_: [{"object_id": "x"}])
    monkeypatch.setattr(svc, "_effective_policy", lambda *_: {
        "mode": "immediate_after_capture", "capture_required": True,
    })
    monkeypatch.setattr(svc, "_capture_row", lambda *_: None)
    envelope = svc.capture_required_envelope("reading", {
        "id": "a1", "user_id": "u1", "test_id": "t1",
    }, [
        {"q_num": 1, "correct": True, "user_answer": "answer"},
        {"q_num": 2, "correct": False, "user_answer": ""},
    ])
    assert envelope["result_withheld"] is True
    assert envelope["question_states"] == [
        {"question_number": 1, "blank": False},
        {"question_number": 2, "blank": True},
    ]
    assert all("correct" not in row for row in envelope["question_states"])


def test_sealed_mock_capture_endpoint_cannot_return_score(monkeypatch):
    monkeypatch.setattr(svc, "_effective_policy", lambda *_: {
        "scope": "mock_exam", "result_released": False,
    })
    assert svc.learner_result_payload("listening", {
        "id": "a1", "score": 40, "grading_details": [],
    }) is None


def test_web_object_is_attached_only_after_release_gate(monkeypatch):
    review = [{"q_num": 1}]
    monkeypatch.setattr(svc, "explanation_access", lambda *_a, **_k: {
        "has_content": True, "allowed": False, "reason": "disabled_by_admin",
        "content_version": "v1", "items": {},
    })
    meta = svc.attach_web_explanations("reading", {"id": "a1"}, review)
    assert "web_explanation_object" not in review[0]
    assert meta["allowed"] is False

    monkeypatch.setattr(svc, "explanation_access", lambda *_a, **_k: {
        "has_content": True, "allowed": True, "reason": "released_by_admin",
        "content_version": "v1", "items": {1: {"payload": {"object_id": "q1"}}},
    })
    svc.attach_web_explanations("reading", {"id": "a1"}, review)
    assert review[0]["web_explanation_object"]["object_id"] == "q1"


def test_explanation_release_is_atomic_at_paper_level(monkeypatch):
    rows = [{
        "object_id": f"q{i:02d}",
        "question_number": i,
        "content_version": "v1",
        "rights_status": "APPROVED",
        "editorial_status": "APPROVED",
        "serving_status": "ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES",
        "payload": {},
    } for i in range(1, 41)]
    rows[-1]["editorial_status"] = "GENERATED_REQUIRES_EDITORIAL_REVIEW"
    monkeypatch.setattr(svc, "_current_explanation_rows", lambda *_a, **_k: rows)
    monkeypatch.setattr(svc, "_effective_policy", lambda *_a, **_k: {
        "mode": "immediate_after_capture", "capture_required": False,
        "content_version": "v1",
    })

    access = svc.explanation_access("reading", {"id": "a1", "test_id": "t1"})

    assert access["allowed"] is False
    assert access["reason"] == "content_release_gates_blocked"
    assert access["items"] == {}


def test_known_item_blocker_prevents_auto_scored_delivery(monkeypatch):
    rows = [
        {"object_id": f"q{i:02d}", "serving_status": svc.AUTO_SERVABLE.copy().pop()}
        for i in range(1, 41)
    ]
    rows[6]["serving_status"] = "EXCLUDE_FROM_AUTO_SCORING_PENDING_MATCHER_REVIEW"
    monkeypatch.setattr(svc, "_current_explanation_rows", lambda *_a, **_k: rows)
    assert svc.scored_paper_blockers("reading", "t1") == ["q07"]
    try:
        svc.assert_scored_paper_ready("reading", "t1")
    except svc.PolicyError as exc:
        assert "q07" in str(exc)
    else:
        raise AssertionError("blocked item was admitted to an auto-scored paper")


def test_human_adjudicated_variants_overlay_the_runtime_matcher(monkeypatch):
    monkeypatch.setattr(svc, "_current_explanation_rows", lambda *_a, **_k: [{
        "question_number": 3,
        "payload": {
            "audit": {"release_adjudication": {
                "override_version": "cambridge-release-overrides/1.0",
            }},
            "item": {"answer": {
                "canonical": "20%", "accepted_forms": ["20%", "20 percent", "20"],
            }},
        },
    }])
    key = svc.apply_scoring_overrides("listening", "t1", [
        {"q_num": 3, "answer": "twenty percent", "alternatives": []},
        {"q_num": 4, "answer": "unchanged", "alternatives": []},
    ])
    assert key[0]["answer"] == "20%"
    assert key[0]["alternatives"] == ["20%", "20 percent", "20"]
    assert key[1]["answer"] == "unchanged"


def test_cambridge_15_q07_requires_both_words_but_accepts_either_order(monkeypatch):
    from services import reading_test_grader as grader

    monkeypatch.setattr(svc, "_current_explanation_rows", lambda *_a, **_k: [{
        "question_number": 7,
        "payload": {
            "audit": {"release_adjudication": {
                "override_version": "cambridge-release-overrides/1.0",
            }},
            "item": {"answer": {
                "canonical": "leaves bark",
                "accepted_forms": [
                    "leaves bark", "bark leaves", "leaves and bark",
                    "bark and leaves", "leaves, bark", "bark, leaves",
                ],
            }},
        },
    }])
    key = svc.apply_scoring_overrides("reading", "t1", [{
        "q_num": 7,
        "question_type": "table_completion",
        "answer": "leaves (and) bark",
        "alternatives": [],
        "skill_tag": "detail",
        "passage_order": 1,
    }])

    for response in ("leaves bark", "bark leaves", "leaves and bark", "bark, leaves"):
        result = grader.grade_attempt([{"q_num": 7, "user_answer": response}], key)
        assert result["per_question"][0]["correct"] is True

    for response in ("leaves", "bark", "branches"):
        result = grader.grade_attempt([{"q_num": 7, "user_answer": response}], key)
        assert result["per_question"][0]["correct"] is False


def test_cambridge_19_q11_audio_adjudication_does_not_block_paper(monkeypatch):
    rows = [{
        "object_id": f"q{i:02d}",
        "serving_status": "ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES",
    } for i in range(1, 41)]
    monkeypatch.setattr(svc, "_current_explanation_rows", lambda *_a, **_k: rows)

    assert svc.scored_paper_blockers("listening", "cambridge-19-test-2") == []


def test_performance_summary_rejects_ambiguous_scope():
    try:
        svc.admin_performance_summary(class_assignment_id="class-1", mock_exam_id="mock-1")
    except svc.PolicyError as exc:
        assert "một scope" in str(exc)
    else:
        raise AssertionError("ambiguous admin performance scope was accepted")
