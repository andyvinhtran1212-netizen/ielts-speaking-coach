from pathlib import Path

from services import mock_correction_service as svc


PAPER_APPROVAL_SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations/260_approve_web_explanation_paper.sql"
).read_text()


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


def test_class_release_requires_paper_approval_to_complete(monkeypatch):
    class Call:
        def execute(self):
            raise RuntimeError("web_explanation_serving_blocked:q40")

    monkeypatch.setattr(svc, "supabase_admin", type("DB", (), {
        "rpc": staticmethod(lambda *_args, **_kwargs: Call()),
    })())
    try:
        svc.update_class_assignment_policy(
            "assignment-1", {"release_now": True}, "admin-1",
        )
    except svc.PolicyError as exc:
        assert "q40" in str(exc)
    else:
        raise AssertionError("class release bypassed paper approval")


def test_admin_enable_approves_exactly_one_complete_paper(monkeypatch):
    calls = []

    class Call:
        def execute(self):
            return type("Resp", (), {"data": {
                "content_version": "v1", "object_count": 40, "approved_now": True,
            }})()

    monkeypatch.setattr(svc, "supabase_admin", type("DB", (), {
        "rpc": staticmethod(lambda name, args: calls.append((name, args)) or Call()),
    })())

    version = svc.approve_paper_explanations(
        "reading", "paper-1", "admin-1", reason="enabled_for_class:c1",
    )

    assert version == "v1"
    assert calls == [("fn_approve_web_explanation_paper", {
        "p_skill": "reading",
        "p_test_id": "paper-1",
        "p_actor_id": "admin-1",
        "p_content_version": None,
        "p_reason": "enabled_for_class:c1",
    })]


def test_admin_enable_refuses_incomplete_or_unservable_paper(monkeypatch):
    class Call:
        error = "web_explanation_paper_requires_q01_q40"
        def execute(self): raise RuntimeError(self.error)

    call = Call()
    monkeypatch.setattr(svc, "supabase_admin", type("DB", (), {
        "rpc": staticmethod(lambda *_args, **_kwargs: call),
    })())
    try:
        svc.approve_paper_explanations("reading", "paper-1", "admin-1")
    except svc.PolicyError as exc:
        assert "Q1 đến Q40" in str(exc)
    else:
        raise AssertionError("incomplete paper was approved")

    call.error = "web_explanation_serving_blocked:q40"
    try:
        svc.approve_paper_explanations("reading", "paper-1", "admin-1")
    except svc.PolicyError as exc:
        assert "q40" in str(exc)
    else:
        raise AssertionError("unservable paper was approved")


def test_paper_approval_rpc_keeps_technical_gate_and_service_role_boundary():
    sql = PAPER_APPROVAL_SQL
    assert "v_object_count <> 40" in sql
    assert "v_question_count <> 40" in sql
    assert "serving_status <> 'ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES'" in sql
    assert "FOR UPDATE" in sql
    assert "SET rights_status = 'APPROVED'" in sql
    assert "editorial_status = 'APPROVED'" in sql
    assert "SET serving_status" not in sql
    assert "SECURITY DEFINER" in sql
    assert "SET search_path = public, pg_temp" in sql
    assert ") FROM PUBLIC, anon, authenticated;" in sql
    assert ") TO service_role;" in sql


def test_scope_writes_and_paper_approvals_share_database_transactions():
    class_body = PAPER_APPROVAL_SQL.split(
        "CREATE OR REPLACE FUNCTION public.fn_create_scoped_exam_class_assignment", 1,
    )[1].split("COMMENT ON FUNCTION public.fn_create_scoped_exam_class_assignment", 1)[0]
    assert "fn_approve_web_explanation_paper" in class_body
    assert "INSERT INTO public.exam_content_cohorts" in class_body
    assert "public.fn_create_class_assignment" in class_body
    assert class_body.index("fn_approve_web_explanation_paper") < class_body.index(
        "public.fn_create_class_assignment"
    )

    mock_body = PAPER_APPROVAL_SQL.split(
        "CREATE OR REPLACE FUNCTION public.fn_update_mock_exam_with_explanation_approval", 1,
    )[1].split(
        "REVOKE ALL ON FUNCTION public.fn_update_mock_exam_with_explanation_approval", 1,
    )[0]
    assert mock_body.count("fn_approve_web_explanation_paper") == 2
    assert "UPDATE public.mock_exams AS m" in mock_body
    assert mock_body.rindex("fn_approve_web_explanation_paper") < mock_body.index(
        "UPDATE public.mock_exams AS m"
    )


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


def test_correction_completion_counts_only_wrong_items(monkeypatch):
    item_rows = [
        {"id": "wrong-1", "learner_id": "u1", "skill": "reading",
         "reading_attempt_id": "a1", "listening_attempt_id": None,
         "object_id": "q1", "question_number": 1, "revision_count": 0,
         "post_test_confidence": 3, "pre_reveal_self_attribution": [],
         "is_correct": False, "score_awarded": 0, "submitted_at": "2026-09-11"},
        {"id": "correct-1", "learner_id": "u1", "skill": "reading",
         "reading_attempt_id": "a1", "listening_attempt_id": None,
         "object_id": "q2", "question_number": 2, "revision_count": 0,
         "post_test_confidence": 3, "pre_reveal_self_attribution": [],
         "is_correct": True, "score_awarded": 1, "submitted_at": "2026-09-11"},
    ]

    class Result:
        data = item_rows

    class Query:
        def select(self, *_args): return self
        def eq(self, *_args): return self
        def order(self, *_args, **_kwargs): return self
        def limit(self, *_args): return self
        def execute(self): return Result()

    class Db:
        def table(self, name):
            assert name == "mock_item_attempts"
            return Query()

    monkeypatch.setattr(svc, "supabase_admin", Db())
    monkeypatch.setattr(svc, "_rows_by_ids", lambda *_args: [
        {"id": "s1", "item_attempt_id": "wrong-1",
         "state": "CORRECTION_OUTPUT_SUBMITTED", "last_sequence_no": 6,
         "updated_at": "2026-09-11"},
        {"id": "s2", "item_attempt_id": "correct-1",
         "state": "CORRECTION_OUTPUT_SUBMITTED", "last_sequence_no": 6,
         "updated_at": "2026-09-11"},
    ])

    summary = svc.admin_performance_summary(skill="reading")["summary"]

    assert summary["wrong_items"] == 1
    assert summary["correction_output_items"] == 1
    assert summary["correction_completion_rate"] == 1.0


def test_correction_event_fails_closed_when_explanation_is_hidden(monkeypatch):
    monkeypatch.setattr(svc, "fetch_owned_submitted_attempt", lambda *_: {
        "id": "attempt-1", "test_id": "test-1", "status": "submitted",
    })
    monkeypatch.setattr(svc, "explanation_access", lambda *_: {
        "allowed": False, "reason": "content_release_gates_blocked", "items": {},
    })

    try:
        svc.record_correction_event(
            "reading", "attempt-1", "learner-1", 7,
            event_id="00000000-0000-0000-0000-000000000001",
            event_name="correction_result_seen", payload={},
        )
    except svc.PolicyError as exc:
        assert "admin" in str(exc)
    else:
        raise AssertionError("hidden explanation accepted a learner event")


def test_correction_event_uses_rpc_canonical_state(monkeypatch):
    class Result:
        data = {"state": "EVIDENCE_ATTEMPTED", "sequence_no": 1, "replayed": False}

    class Rpc:
        def execute(self):
            return Result()

    captured = {}

    class Db:
        def rpc(self, name, params):
            captured.update({"name": name, "params": params})
            return Rpc()

    monkeypatch.setattr(svc, "supabase_admin", Db())
    monkeypatch.setattr(svc, "fetch_owned_submitted_attempt", lambda *_: {
        "id": "attempt-1", "test_id": "test-1", "status": "submitted",
    })
    monkeypatch.setattr(svc, "explanation_access", lambda *_: {
        "allowed": True, "items": {7: {"object_id": "cambridge-15-test-4-reading-q07"}},
    })

    result = svc.record_correction_event(
        "reading", "attempt-1", "learner-1", 7,
        event_id="00000000-0000-0000-0000-000000000001",
        event_name="evidence_attempt_submitted",
        payload={"evidence_response": "  Passage 1, paragraph 2  "},
    )

    assert result["state"] == "EVIDENCE_ATTEMPTED"
    assert captured["name"] == "fn_record_mock_correction_event"
    assert captured["params"]["p_payload"]["evidence_response"] == "Passage 1, paragraph 2"


def test_canonical_reading_and_listening_error_codes_reach_correction_rpc(monkeypatch):
    class Result:
        data = {"state": "CORRECTION_OUTPUT_SUBMITTED", "sequence_no": 5, "replayed": False}

    class Rpc:
        def execute(self):
            return Result()

    captured = []

    class Db:
        def rpc(self, name, params):
            captured.append({"name": name, "params": params})
            return Rpc()

    monkeypatch.setattr(svc, "supabase_admin", Db())
    monkeypatch.setattr(svc, "fetch_owned_submitted_attempt", lambda *_: {
        "id": "attempt-1", "test_id": "test-1", "status": "submitted",
    })
    monkeypatch.setattr(svc, "explanation_access", lambda *_: {
        "allowed": True, "items": {7: {"object_id": "cambridge-item"}},
    })

    for index, (skill, code) in enumerate((
        ("reading", "R11-COPY_ERROR"),
        ("listening", "L07-MISSED_CORRECTION"),
    ), start=1):
        result = svc.record_correction_event(
            skill, "attempt-1", "learner-1", 7,
            event_id=f"00000000-0000-0000-0000-{index:012d}",
            event_name="correction_output_submitted",
            payload={
                "corrected_answer": "A",
                "evidence_response": "Nguồn đã chọn",
                "error_mechanism": "Nguyên nhân",
                "error_mechanism_code": code,
                "next_action": "Hành động tiếp theo",
                "next_action_code": "check_form",
            },
        )
        assert result["state"] == "CORRECTION_OUTPUT_SUBMITTED"

    assert [row["params"]["p_payload"]["error_mechanism_code"] for row in captured] == [
        "R11-COPY_ERROR", "L07-MISSED_CORRECTION",
    ]


def test_correction_codes_still_reject_mixed_or_unsafe_formats():
    base = {
        "corrected_answer": "A",
        "evidence_response": "Nguồn đã chọn",
        "error_mechanism": "Nguyên nhân",
        "next_action": "Hành động tiếp theo",
        "next_action_code": "check_form",
    }
    for code in ("r11-COPY_ERROR", "R11 COPY ERROR", "<script>"):
        try:
            svc._validate_correction_payload(
                "correction_output_submitted",
                {**base, "error_mechanism_code": code},
            )
        except svc.PolicyError:
            pass
        else:
            raise AssertionError(f"unsafe correction code was accepted: {code}")


def test_correction_hint_requires_known_reveal_level():
    try:
        svc._validate_correction_payload("hint_revealed", {"hint_type": "answer"})
    except svc.PolicyError as exc:
        assert "hint_type" in str(exc)
    else:
        raise AssertionError("unknown hint reveal level was accepted")


def test_structured_reading_evidence_is_normalized_for_runtime_analytics():
    payload = svc._validate_correction_payload("evidence_attempt_submitted", {
        "evidence_response": "Passage 2, đoạn 4: selected evidence",
        "evidence_selection": {
            "kind": "reading_text",
            "passage_order": 2,
            "paragraph_index": 4,
            "selected_text": "  selected evidence  ",
        },
    })
    assert payload["evidence_selection"] == {
        "kind": "reading_text",
        "passage_order": 2,
        "paragraph_index": 4,
        "selected_text": "selected evidence",
    }


def test_structured_evidence_rejects_invalid_audio_positions():
    try:
        svc._validate_correction_payload("evidence_attempt_submitted", {
            "evidence_response": "Mốc audio lỗi",
            "evidence_selection": {"kind": "audio_timestamp", "seconds": -1},
        })
    except svc.PolicyError as exc:
        assert "audio" in str(exc)
    else:
        raise AssertionError("invalid audio evidence was accepted")


def test_structured_evidence_rejects_boolean_reading_positions():
    for field in ("passage_order", "paragraph_index"):
        evidence = {
            "kind": "reading_text", "passage_order": 1,
            "paragraph_index": 2, "selected_text": "selected evidence",
        }
        evidence[field] = True
        try:
            svc._validate_correction_payload("evidence_attempt_submitted", {
                "evidence_response": "Passage 1, đoạn 2: selected evidence",
                "evidence_selection": evidence,
            })
        except svc.PolicyError:
            pass
        else:
            raise AssertionError(f"boolean {field} was accepted")


def test_reading_event_rejects_evidence_from_another_passage(monkeypatch):
    monkeypatch.setattr(svc, "fetch_owned_submitted_attempt", lambda *_: {
        "id": "attempt-1", "test_id": "test-1", "status": "submitted",
        "grading_details": [{"q_num": 7, "passage_order": 1}],
    })
    monkeypatch.setattr(svc, "explanation_access", lambda *_: {
        "allowed": True, "items": {7: {"object_id": "cambridge-item"}},
    })

    try:
        svc.record_correction_event(
            "reading", "attempt-1", "learner-1", 7,
            event_id="00000000-0000-0000-0000-000000000007",
            event_name="evidence_attempt_submitted",
            payload={
                "evidence_response": "Passage 2, đoạn 1: selected evidence",
                "evidence_selection": {
                    "kind": "reading_text", "passage_order": 2,
                    "paragraph_index": 1, "selected_text": "selected evidence",
                },
            },
        )
    except svc.PolicyError as exc:
        assert "không thuộc passage" in str(exc)
    else:
        raise AssertionError("cross-passage Reading evidence was accepted")
