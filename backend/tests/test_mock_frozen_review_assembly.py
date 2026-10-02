"""Actual review assemblers retain original context after live edits/deletes."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from routers import listening, reading_student


class Signer:
    def from_(self,*_): return self
    def create_signed_url(self,path,ttl): return {"signedURL":"https://signed.local/"+path}


class DB:
    def __init__(self,tables): self.tables=deepcopy(tables); self.calls=[]; self.storage=Signer()
    def table(self,name): self.calls.append(name); return Query(self.tables.get(name,[]))


class Query:
    def __init__(self,rows): self.rows=rows
    def select(self,*_): return self
    def eq(self,*_): return self
    def in_(self,*_): return self
    def order(self,*_): return self
    def limit(self,*_): return self
    def execute(self): return SimpleNamespace(data=deepcopy(self.rows))


def snapshot(skill,marks,sources,paper):
    return {"skill":skill,"attempt_id":"a1","paper_id":"t1","paper_revision":2,
        "policy_revision":1,"paper_row":paper,"source_rows":sources,"marking_rows":marks,
        "scoring_override_rows":[],"passage_order_by_id":{"p1":1}}


def attempt():
    return {"id":"a1","test_id":"t1","paper_revision":2,"status":"submitted",
        "score":1,"band_estimate":5.0,"grading_details":[{"q_num":20,"user_answer":"A",
            "expected":"A","correct":True,"passage_order":1,"explanation":"Original explanation"}]}


def test_reading_actual_review_uses_original_body_stem_options_summary_and_null_translation():
    marks=[{"id":"q20-original","q_num":20,"passage_id":"p1","prompt":"Original stem",
        "question_type":"sentence_completion","explanation":"Source explanation",
        "payload":{"options":[{"id":"A","text":"Original option"}],
            "instructions":"Write ONE WORD ONLY.","template":{"summary":"Original [20] context"},
            "solution":{"steps":"Original reasoning"},
            "response_policy":{"accepted_answers":["protected-form"]}}}]
    sources=[{"id":"p1","slug":"original-p1","title":"Original passage", "passage_order":1,
        "body_markdown":"Original text","metadata":{"translation_vi":None}}]
    private=snapshot("reading",marks,sources,{"test_id":"ORIGINAL","title":"Original paper"})
    db=DB({"mock_paper_attempt_snapshots":[private],"reading_tests":[{"title":"Changed"}],
        "reading_passages":[],"reading_questions":[]})
    saved=attempt(); before=deepcopy(saved)
    with patch.object(reading_student,"supabase_admin",db), \
         patch("services.mock_correction_service.attach_web_explanations",return_value={"available":False}):
        result=reading_student._assemble_reading_review(saved,"a1")
    assert result["title"]=="Original paper" and result["passages"][0]["body_markdown"]=="Original text"
    assert result["passages"][0]["translation_vi"] is None
    item=result["review"][0]
    assert item["prompt"]=="Original stem" and item["explanation"]=="Original explanation"
    assert item["solution"]["steps"]=="Original reasoning"
    assert item["question_context"]["options"]==[{"id":"A","text":"Original option"}]
    assert item["question_context"]["template"]["summary"]=="Original [20] context"
    assert item["context_provenance"]["prompt"]=="submission_snapshot"
    assert result["context_source"]["possibly_changed"] is False and saved==before
    assert db.calls==["mock_paper_attempt_snapshots"]
    assert "protected-form" not in str(result)


def test_reading_legacy_current_fallback_is_per_field_and_keeps_empty_saved_rationale():
    saved=attempt(); saved.pop("paper_revision"); saved["grading_details"][0]["explanation"]=""
    db=DB({"reading_tests":[{"title":"Current paper"}],"reading_passages":[
        {"id":"p1","passage_order":1,"body_markdown":"Current text","metadata":{}}],
        "reading_questions":[{"id":"current-q20","q_num":20,"prompt":"Changed stem",
            "question_type":"mcq_single","passage_id":"p1","explanation":"Changed rationale",
            "payload":{"options":["A changed"],"solution":{"steps":"Current reasoning"}}}]})
    with patch.object(reading_student,"supabase_admin",db), \
         patch("services.mock_correction_service.attach_web_explanations",return_value={"available":False}):
        result=reading_student._assemble_reading_review(saved,"a1")
    item=result["review"][0]
    assert item["prompt"]=="Changed stem" and item["explanation"]==""
    assert item["context_provenance"]["prompt"]=="current_content_fallback"
    assert item["context_provenance"]["explanation"]=="submission_snapshot"
    assert result["passages"][0]["context_provenance"]["translation_vi"]=="unavailable"
    assert result["context_source"]["possibly_changed"] is True
    assert result["score"]==1 and item["expected"]=="A"
    assert "mock_paper_attempt_snapshots" not in db.calls


def test_listening_actual_review_pins_transcript_audio_identity_and_consumed_rationale():
    marks=[{"id":"ex1","payload":{"variant":"matching","metadata":{"match_options":["A original","B original"]},
        "questions":[{"id":"q20","q_num":20,"prompt":"Original 20"},{"id":"q21","q_num":21,"prompt":"Original 21"}],
        "solutions":{"20":{"rationale":"Original A"},"21":{"rationale":"Original B"}},
        "audio_windows":{"20":{"start":2,"end":4,"section":"S1"},"21":{"start":5,"end":7,"section":"S1"}},
        "transcript_anchors":{"20":1,"21":2}}}]
    sources=[{"id":"c1","section_num":1,"title":"Original section","transcript":"Original transcript","metadata":{}}]
    paper={"id":"t1","test_id":"ORIGINAL","title":"Original paper",
        "full_audio_storage_path":"original.mp3","full_audio_duration_seconds":100,"metadata":{}}
    private=snapshot("listening",marks,sources,paper)
    saved=attempt(); saved["grading_details"][0].update(
        rationale_q_num=21,user_answer="B",expected="A, B",group="grouped_mcq_single")
    db=DB({"mock_paper_attempt_snapshots":[private],"listening_tests":[{"full_audio_storage_path":"changed.mp3"}],
        "listening_content":[],"listening_exercises":[]})
    with patch.object(listening,"supabase_admin",db), \
         patch("services.mock_correction_service.attach_web_explanations",return_value={"available":False}):
        result=listening._assemble_listening_review(saved,"a1")
    item=result["review"][0]
    assert result["sections"][0]["transcript"]=="Original transcript"
    assert "original.mp3" in result["audio_url"] and "changed.mp3" not in result["audio_url"]
    assert item["prompt"]=="Original 20" and item["solution"]["rationale"]=="Original B"
    assert item["audio_window"]=={"start":5,"end":7,"section":"S1"} and item["transcript_anchor"]==2
    assert item["question_context"]["options"]==["A original","B original"]
    assert item["context_provenance"]["solution"]=="submission_snapshot"
    assert db.calls==["mock_paper_attempt_snapshots"] and saved["score"]==1


def test_reading_review_renews_pinned_diagram_urls_without_changing_frozen_digest():
    class ChangingSigner(Signer):
        sequence=0
        def create_signed_url(self,path,ttl):
            self.sequence+=1
            return {"signedURL":f"https://signed.local/{path}?nonce={self.sequence}"}
    marks=[{"id":"q20","q_num":20,"question_type":"diagram_label_completion",
        "prompt":"Label the diagram","payload":{"template":{"image_storage_path":"original.svg",
            "image_alt":"Diagram with numbered blanks"}}}]
    private=snapshot("reading",marks,[],{"title":"Original"})
    db=DB({"mock_paper_attempt_snapshots":[private]}); db.storage=ChangingSigner()
    with patch.object(reading_student,"supabase_admin",db), \
         patch("services.mock_correction_service.attach_web_explanations",return_value={"available":False}):
        first=reading_student._assemble_reading_review(attempt(),"a1")
        second=reading_student._assemble_reading_review(attempt(),"a1")
    assert first["review"][0]["question_context"]["image_url"] != second["review"][0]["question_context"]["image_url"]
    assert first["review"][0]["question_context"]["image_alt"]=="Diagram with numbered blanks"
    assert first["context_source"]["context_sha256"]==second["context_source"]["context_sha256"]
