"""Narrow projections of the admitted revision for the existing players.

Ownership and active delivery purpose must be proved before calling. This is
not a second player renderer: the existing signers/sanitizers remain in use.
"""
from copy import deepcopy


def without_response_policies(value):
    """Protected accepted forms can be authored at item or metadata scope."""
    if isinstance(value, dict):
        return {key: without_response_policies(child) for key, child in value.items()
                if key not in {"response_policy", "response_policies"}}
    if isinstance(value, list):
        return [without_response_policies(child) for child in value]
    return deepcopy(value)


def without_private_marking(value):
    """Remove marking/evidence fields even inside nested authored templates."""
    private = {"answer", "answers", "correct_answer", "accepted_answers", "solution", "solutions",
               "explanation", "explanations", "response_policy", "response_policies", "transcript",
               "controlled_transcripts", "transcript_anchors", "audio_windows", "self_review"}
    if isinstance(value, dict):
        return {key: without_private_marking(child) for key, child in value.items() if key not in private}
    if isinstance(value, list):
        return [without_private_marking(child) for child in value]
    return deepcopy(value)


def reading_snapshot_bundle(snapshot, *, sign_images):
    paper = snapshot["paper_row"]
    test = {key: deepcopy(paper[key]) for key in (
        "id", "test_id", "title", "module", "time_limit_minutes", "passage_count",
        "total_questions", "band_target", "status", "updated_at", "test_type") if key in paper}
    test["locked"] = bool(((paper.get("metadata") or {}).get("access") or {}).get("locked"))
    passages = [{key: deepcopy(row[key]) for key in ("id", "slug", "title", "body_markdown",
        "passage_order", "word_count", "estimated_minutes", "topic_tags") if key in row}
        for row in snapshot["source_rows"]]
    orders = {row["id"]: row.get("passage_order") for row in passages}
    questions = []
    for row in snapshot["marking_rows"]:
        question = {key: deepcopy(row[key]) for key in ("id", "q_num", "question_type", "prompt",
            "payload", "skill_tag", "sub_skill", "order_num", "passage_id") if key in row}
        payload = without_private_marking(question.get("payload") or {})
        question["payload"] = payload
        question["passage_order"] = orders.get(row.get("passage_id"))
        questions.append(question)
    sign_images(questions)
    return {**test, "passages": passages, "questions": questions,
            "paper_revision": snapshot["paper_revision"], "policy_revision": snapshot.get("policy_revision")}


def listening_snapshot_sources(snapshot):
    sections = [{key: deepcopy(row[key]) for key in ("id", "section_num", "title", "transcript", "metadata")
                 if key in row} for row in snapshot["source_rows"]]
    exercises = [{key: deepcopy(row[key]) for key in ("id", "content_id", "exercise_type", "payload", "order_num")
                  if key in row} for row in snapshot["marking_rows"]]
    # The caller's existing Listening strip_answer_keys then removes solutions,
    # keys, transcript/answer windows and source-book protected metadata.
    for row in exercises:
        row["payload"] = without_response_policies(row.get("payload") or {})
    return sections, exercises
