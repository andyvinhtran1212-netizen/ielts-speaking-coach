"""Idempotent import of a reviewed Speaking bank through existing admin APIs.

Call ``import_bank(session, api_base, bank, parts={2}, commit=False)`` with an
authenticated requests.Session. New topics stay off until all questions have
been read back; Part 1/3 stay off until their required audio is rendered.
Existing topics/questions are never deleted or overwritten by this importer.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

WINDOW_LABELS = {
    "Always in use": "Chủ đề nền tảng · dùng quanh năm",
    "September 2026 to April 2027": "Mốc tham khảo 09/2026–04/2027",
    "May to December 2026": "Mốc tham khảo 05–12/2026",
    "January to August 2026": "Mốc cũ 01–08/2026 · luyện bổ trợ",
    "January to August 2025": "Mốc cũ 01–08/2025 · luyện bổ trợ",
}


def _request(session, method: str, url: str, **kwargs):
    response = session.request(method, url, timeout=(15, 60), **kwargs)
    response.raise_for_status()
    return response.json() if response.content else None


def import_bank(session, api_base: str, bank: dict, *, parts: set[int],
                commit: bool = False, today: date | None = None,
                render_audio: bool = False,
                approved_source_ids: set[str] | None = None,
                progress=print) -> dict:
    """Import selected Parts. Current Part 1/3 needs explicit editorial approval.

    ``today`` controls only priority, not a claim about official IELTS topics.
    Source dates are never described as verified exam questions.
    """
    if bank.get("schema_version") != 1 or not bank.get("source_sha256"):
        raise ValueError("Unsupported Speaking bank manifest")
    today = today or datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
    approved_source_ids = approved_source_ids or set()
    root = api_base.rstrip("/") + "/admin/topics"
    live = _request(session, "GET", root)
    if not isinstance(live, list):
        raise ValueError("Admin topic inventory has unexpected shape")
    by_key = {(row["part"], row["title"], row.get("category") or ""): row
              for row in live}
    stats = {"planned": 0, "created": 0, "questions_added": 0,
             "activated": 0, "unchanged": 0}
    for item in bank["topics"]:
        part = item["part"]
        if part not in parts:
            continue
        category = WINDOW_LABELS[item["source_window"]]
        key = (part, item["title"], category)
        # Historical cards remain in the manifest for future practice review.
        # Part 1/3 need both editorial approval and audio. Neither is inferred
        # from a date in the source file.
        current = (item["window_end"] is None or
                   item["window_start"] <= today.isoformat() <= item["window_end"])
        activate = current and (part == 2 or
                                (render_audio and item["source_id"] in approved_source_ids))
        stats["planned"] += 1
        topic = by_key.get(key)
        if not commit:
            progress(f"PLAN {item['source_id']} Part {part}: "
                     f"{'existing' if topic else 'new'}; {'active' if activate else 'held'}")
            continue
        if topic is None:
            topic = _request(session, "POST", root, json={
                "title": item["title"], "part": part, "category": category,
                "is_active": False,
            })
            if not isinstance(topic, dict) or not topic.get("id"):
                raise ValueError(f"Topic creation not acknowledged: {item['source_id']}")
            by_key[key] = topic
            stats["created"] += 1
            if topic.get("is_active") is not False:
                raise ValueError(f"Topic was not created inactive: {item['source_id']}")
        question_url = f"{root}/{topic['id']}/questions"
        stored = _request(session, "GET", question_url)
        if not isinstance(stored, list):
            raise ValueError(f"Question inventory unavailable: {item['source_id']}")
        expected = {(q["part"], q["order_num"]): q for q in item["questions"]}
        existing = {(q["part"], q["order_num"]): q for q in stored}
        for place, question in expected.items():
            previous = existing.get(place)
            if previous:
                fields = ("question_text", "cue_card_bullets", "cue_card_reflection")
                if any((previous.get(field) or None) != (question.get(field) or None)
                       for field in fields):
                    raise ValueError(f"Editorial conflict at {item['source_id']} {place}; review manually")
                continue
            created = _request(session, "POST", question_url, json=question)
            if not isinstance(created, dict) or not created.get("id"):
                raise ValueError(f"Question creation not acknowledged: {item['source_id']} {place}")
            stats["questions_added"] += 1
        verified = _request(session, "GET", question_url)
        actual = {(q["part"], q["order_num"]): q for q in verified}
        if not all(place in actual and actual[place]["question_text"] == q["question_text"]
                   for place, q in expected.items()):
            raise ValueError(f"Readback differs from source: {item['source_id']}")
        if activate and part in (1, 3):
            for place in expected:
                stored = actual[place]
                result = _request(session, "POST",
                                  f"{question_url}/{stored['id']}/render-audio", json={})
                if result.get("id") != stored["id"] or result.get("audio_ready") is not True:
                    raise ValueError(f"Audio not acknowledged: {item['source_id']} {place}")
            voiced = _request(session, "GET", question_url)
            voiced_by_place = {(q["part"], q["order_num"]): q for q in voiced}
            if not all(voiced_by_place.get(place, {}).get("audio_url") and
                       voiced_by_place.get(place, {}).get("audio_path")
                       for place in expected):
                raise ValueError(f"Audio readback incomplete: {item['source_id']}")
        if activate and topic.get("is_active") is not True:
            acknowledged = _request(session, "PATCH", f"{root}/{topic['id']}",
                                    json={"is_active": True})
            if acknowledged.get("is_active") is not True:
                raise ValueError(f"Activation not acknowledged: {item['source_id']}")
            stats["activated"] += 1
        else:
            stats["unchanged"] += 1
        progress(f"OK {item['source_id']} Part {part}: {len(expected)} questions; "
                 f"{'active' if activate else 'held'}")
    return stats
