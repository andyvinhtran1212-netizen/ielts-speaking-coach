"""Original admitted player context, with key/solution/policy fields removed."""
from copy import deepcopy

from services.mock_player_context import reading_snapshot_bundle, listening_snapshot_sources
from services.listening_test_grader import strip_answer_keys


def test_original_reading_player_preserves_authored_ids_but_never_serves_marking_keys():
    snapshot={"paper_revision":4,"policy_revision":2,
        "paper_row":{"id":"t1","title":"Original title","metadata":{"access":{"password":"private-password","locked":True}}},
        "source_rows":[{"id":"p1","body_markdown":"Original body","passage_order":1,"metadata":{"translation_vi":"protected review translation"}}],
        "marking_rows":[{"id":"q20","q_num":20,"passage_id":"p1","answer":"private-key","explanation":"private-rationale",
            "payload":{"instructions":"Write ONE WORD ONLY.","options":["A original"],
                "template":{"summary":"Original [20] blank"},"solution":{"steps":"private-solution"},
                "response_policy":{"accepted_answers":["private-form"]},
                "metadata":{"response_policy":{"accepted_answers":["nested-private-form"]}}}}]}
    before=deepcopy(snapshot)
    seen=[]
    payload=reading_snapshot_bundle(snapshot,sign_images=lambda rows:seen.extend(rows))
    item=payload["questions"][0]
    assert payload["title"]=="Original title" and payload["passages"][0]["body_markdown"]=="Original body"
    assert (item["id"],item["passage_order"])==("q20",1)
    assert item["payload"]["template"]["summary"]=="Original [20] blank"
    assert seen==payload["questions"] and snapshot==before
    assert "private-" not in str(payload) and "protected review translation" not in str(payload)


def test_original_listening_projection_uses_existing_key_and_transcript_sanitizer():
    snapshot={"source_rows":[{"id":"c1","transcript":"Original transcript","metadata":{}}],
        "marking_rows":[{"id":"e1","content_id":"c1","exercise_type":"mcq","order_num":1,
            "segments":[{"text":"private-segment"}],"payload":{"variant":"mcq_single",
                "questions":[{"q_num":1,"prompt":"Original prompt","answer_idx":1,
                    "response_policy":{"accepted_answers":["private-policy"]}}],
                "answers":{"1":"private-answer"},"solutions":{"1":{"rationale":"private-rationale"}},
                "audio_windows":{"1":{"start":1,"end":2}},"transcript_anchors":{"1":1}}}]}
    before=deepcopy(snapshot)
    sections,raw=listening_snapshot_sources(snapshot)
    safe=strip_answer_keys(raw)
    assert sections[0]["transcript"]=="Original transcript"  # server-side source, not final player section
    assert safe[0]["payload"]["questions"]==[{"q_num":1,"prompt":"Original prompt"}]
    assert "private-" not in str(safe) and snapshot==before
