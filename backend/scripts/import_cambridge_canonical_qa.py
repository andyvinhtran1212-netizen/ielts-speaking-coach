#!/usr/bin/env python3
"""Import Cambridge IELTS 13–21 canonical papers into hidden internal QA.

The neutral ``package.json`` files are the source of truth.  Dry-run is the
default and performs the same structural validation as commit.  Commit is
deliberately restricted to ``--environment internal-qa`` and always writes
draft, exam-only, non-public papers with web explanations disabled.

Rows use deterministic UUIDs and upserts, so an interrupted import can be
resumed safely without creating duplicate tests or questions.  This script
does not publish content and does not alter historical attempts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

EXPECTED_PACKAGES = 36
EXPECTED_SKILL_QUESTIONS = 40
NAMESPACE = uuid.UUID("b9cd8947-b47b-43bb-a031-c742155c69d7")
ASSET_RE = re.compile(r"assets/([^\s)\"]+)")
MARKER_RE = re.compile(r"\{\{(\d+)\}\}")

READING_SKILL = {
    "matching_headings": "main_idea",
    "matching_information": "scanning",
    "matching_features": "scanning",
    "matching_sentence_endings": "reference_cohesion",
    "true_false_not_given": "writer_view_TFNG",
    "yes_no_not_given": "writer_view_TFNG",
    "mcq_single": "inference",
    "short_answer": "detail",
}
LISTENING_TEMPLATE = {
    "flow-chart": "flow_chart_completion",
    "form": "form_completion",
    "map": "plan_label",
    "map_labelling": "plan_label",
    "matching": "matching",
    "mcq": "mcq_3option",
    "multi-select": "mcq_multi",
    "note": "notes_completion",
    "note_completion": "notes_completion",
    "table": "table_completion",
    "table_completion": "table_completion",
}


class ValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class PackagePlan:
    source_id: str
    book: int
    test: int
    reading_test: dict[str, Any]
    reading_passages: list[dict[str, Any]]
    reading_questions: list[dict[str, Any]]
    listening_test: dict[str, Any]
    listening_content: list[dict[str, Any]]
    listening_exercises: list[dict[str, Any]]
    audio_file: Path
    assets: dict[str, Path]


def _uuid(label: str) -> str:
    return str(uuid.uuid5(NAMESPACE, label))


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"Không đọc được {path}: {exc}") from exc


def _hash_json(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _options(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []
    if isinstance(value, dict):
        return [{"label": str(k), "text": str(v)} for k, v in value.items()]
    if isinstance(value, list):
        out = []
        for index, item in enumerate(value):
            if isinstance(item, dict):
                label = item.get("label", chr(65 + index))
                out.append({"label": str(label), "text": str(item.get("text") or label)})
            else:
                out.append({"label": chr(65 + index), "text": str(item)})
        return out
    raise ValidationError(f"Options không hợp lệ: {value!r}")


def _answer(value: Any, *, whole_set: bool = False) -> dict[str, Any]:
    if isinstance(value, list):
        values = [str(v).strip() for v in value if str(v).strip()]
        if not values:
            raise ValidationError("Answer array rỗng")
        if whole_set:
            return {"answer": ", ".join(values), "alternatives": []}
        return {"answer": values[0], "alternatives": values[1:]}
    text = str(value or "").strip()
    if not text:
        raise ValidationError("Answer rỗng")
    return {"answer": text, "alternatives": []}


def _question_numbers(rows: Iterable[dict[str, Any]]) -> list[int]:
    return sorted(int(row.get("number") or 0) for row in rows)


def _validate_1_to_40(label: str, rows: Iterable[dict[str, Any]]) -> None:
    actual = _question_numbers(rows)
    expected = list(range(1, EXPECTED_SKILL_QUESTIONS + 1))
    if actual != expected:
        raise ValidationError(f"{label}: question numbers phải đúng 1..40, nhận {actual}")


def _asset_names(text: str) -> list[str]:
    return list(dict.fromkeys(ASSET_RE.findall(text or "")))


def _strip_asset_markdown(text: str) -> str:
    return re.sub(r"!\[[^\]]*\]\(assets/[^)]+\)", "", text or "").strip()


def _word_count(markdown: str) -> int:
    return len(re.findall(r"\b[\w'’-]+\b", markdown or "", flags=re.UNICODE))


def _reading_rows(source_id: str, package: dict[str, Any]) -> tuple[dict, list, list]:
    reading = package["reading"]
    passages = reading.get("passages") or []
    if len(passages) != 3:
        raise ValidationError(f"{source_id} reading: cần 3 passages, nhận {len(passages)}")
    questions = [q for passage in passages for q in (passage.get("questions") or [])]
    answers = reading.get("answers") or []
    _validate_1_to_40(f"{source_id} reading questions", questions)
    _validate_1_to_40(f"{source_id} reading answers", answers)
    answer_by_q = {int(row["number"]): row["answer"] for row in answers}
    test_uuid = _uuid(f"{source_id}:reading:test")
    source_hash = _hash_json(reading)
    book, test = [int(n) for n in re.findall(r"\d+", source_id)]
    parent = {
        "id": test_uuid,
        "test_id": f"ILR-RDG-CAM-B{book}-T{test}",
        "title": f"[INTERNAL QA] Cambridge IELTS {book} Test {test} Reading",
        "version": "1.0",
        "module": reading.get("module") or "academic",
        "time_limit_minutes": 60,
        "passage_count": 3,
        "total_questions": 40,
        "metadata": {
            "source_format": "canonical-package/1.0",
            "source_package_id": source_id,
            "source_hash": source_hash,
            "internal_qa": True,
        },
        "status": "draft",
        "exam_only": True,
        "is_public": False,
        "public_practice_enabled": False,
        "web_explanation_mode": "disabled",
    }
    passage_rows: list[dict[str, Any]] = []
    question_rows: list[dict[str, Any]] = []
    for passage in passages:
        pnum = int(passage["number"])
        passage_uuid = _uuid(f"{source_id}:reading:passage:{pnum}")
        passage_rows.append({
            "id": passage_uuid,
            "library": "l3_test",
            "slug": f"{source_id}-reading-passage-{pnum}",
            "title": passage.get("title") or f"Passage {pnum}",
            "body_markdown": passage.get("context") or "",
            "test_id": test_uuid,
            "passage_order": pnum,
            "word_count": _word_count(passage.get("context") or ""),
            "estimated_minutes": 20,
            "metadata": {
                "source_package_id": source_id,
                "instructions": passage.get("instructions") or "",
                "internal_qa": True,
            },
            "status": "draft",
        })
        seen_shared: set[tuple[str, tuple[int, ...]]] = set()
        for order, question in enumerate(passage.get("questions") or [], start=1):
            qnum = int(question["number"])
            qtype = str(question.get("question_type") or "")
            raw_text = str(question.get("text") or "").strip()
            payload: dict[str, Any] = {"options": _options(question.get("options"))}
            markers = tuple(sorted({int(n) for n in MARKER_RE.findall(raw_text)}))
            shared_key = (qtype, markers)
            if len(markers) > 1 and shared_key not in seen_shared:
                payload["template"] = {"summary_text": _strip_asset_markdown(raw_text)}
                seen_shared.add(shared_key)
            names = _asset_names(raw_text)
            if names:
                payload.setdefault("template", {})["image_storage_path"] = (
                    f"cambridge-internal-qa/{source_id}/reading/{names[0]}"
                )
            ans = _answer(answer_by_q[qnum])
            # Adjudicated source repair: printed Q7 contains two sub-blanks.
            if source_id == "cambridge-15-test-4" and qnum == 7:
                ans = {
                    "answer": "leaves bark",
                    "alternatives": ["bark leaves", "leaves and bark", "bark and leaves",
                                     "leaves, bark", "bark, leaves"],
                }
                payload["solution"] = {
                    "question_text": "Which two parts of the tree were used for medicine? Enter both words; either order is accepted.",
                    "tips": "Điền đủ hai từ leaves và bark; có thể đảo thứ tự.",
                }
            if source_id == "cambridge-15-test-4" and qnum == 6:
                payload.setdefault("template", {})["summary_text"] = (
                    "Traditional uses of the huarango tree\n"
                    "Part of tree | Traditional use\n"
                    "{{6}} | fuel\n"
                    "{{7}} | medicine — enter both tree parts, either order\n"
                    "{{8}} | construction"
                )
            question_rows.append({
                "id": _uuid(f"{source_id}:reading:q:{qnum}"),
                "passage_id": passage_uuid,
                "q_num": qnum,
                "question_type": qtype,
                "prompt": raw_text or f"Question {qnum}",
                "payload": payload,
                "answer": ans,
                "skill_tag": READING_SKILL.get(qtype, "detail"),
                "sub_skill": qtype,
                "explanation": None,
                "order_num": order,
            })
    return parent, passage_rows, question_rows


def _instruction_and_prompt(text: str) -> tuple[str, str]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    instruction: list[str] = []
    while lines and len(instruction) < 2 and re.match(
        r"^(Choose|Complete|Write|Label|Which|What|Questions?\b|Select)", lines[0], re.I
    ):
        instruction.append(lines.pop(0))
    if len(lines) >= 2 and lines[-1] == lines[-2]:
        lines.pop()
    return "\n".join(instruction), "\n".join(lines).strip()


def _listening_groups(questions: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    for question in questions:
        authored_type = str(question.get("question_type") or "")
        raw_text = str(question.get("text") or "")
        # Some neutral packages call a shared option-bank matching block
        # ``multi-select``.  It is not a Choose TWO/THREE set: each numbered
        # row has its own answer.  Classify from the authored instruction.
        qtype = (
            "matching"
            if authored_type == "multi-select" and re.search(
                r"Choose\s+(?:FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)\s+answers?\s+from\s+the\s+box",
                raw_text, re.I,
            )
            else authored_type
        )
        instruction, prompt = _instruction_and_prompt(str(question.get("text") or ""))
        signature = (qtype, instruction, json.dumps(question.get("options"), sort_keys=True))
        choose_match = re.search(r"Choose\s+(TWO|THREE)\s+letters?", raw_text, re.I)
        choose_count = 2 if choose_match and choose_match.group(1).upper() == "TWO" else (
            3 if choose_match else None
        )
        can_append = groups and groups[-1][0]["_signature"] == signature
        if can_append and choose_count and len(groups[-1]) >= choose_count:
            can_append = False
        enriched = {**question, "_signature": signature, "_effective_type": qtype}
        if can_append:
            groups[-1].append(enriched)
        else:
            groups.append([enriched])
    return groups


def _listening_rows(source_id: str, package: dict[str, Any], timings: dict[str, Any],
                    audio_file: Path) -> tuple[dict, list, list]:
    listening = package["listening"]
    sections = listening.get("sections") or []
    if len(sections) != 4:
        raise ValidationError(f"{source_id} listening: cần 4 sections, nhận {len(sections)}")
    questions = [q for section in sections for q in (section.get("questions") or [])]
    answers = listening.get("answers") or []
    _validate_1_to_40(f"{source_id} listening questions", questions)
    _validate_1_to_40(f"{source_id} listening answers", answers)
    answer_by_q = {int(row["number"]): row["answer"] for row in answers}
    transcript_by_section = {
        int(row["number"]): str(row.get("text") or "")
        for row in (listening.get("transcript") or [])
    }
    if sorted(transcript_by_section) != [1, 2, 3, 4]:
        raise ValidationError(f"{source_id}: transcript phải có đủ 4 sections")
    timing_sections = {str(row.get("id")): row for row in (timings.get("sections") or [])}
    offsets = (timings.get("full_test") or {}).get("section_offsets") or {}
    if sorted(timing_sections) != ["S1", "S2", "S3", "S4"]:
        raise ValidationError(f"{source_id}: timings phải có đủ S1..S4")
    timed_q = sorted(int(q) for section in timing_sections.values()
                     for q in (section.get("questions") or {}))
    if timed_q != list(range(1, 41)):
        raise ValidationError(f"{source_id}: timings questions không đúng 1..40")

    book, test = [int(n) for n in re.findall(r"\d+", source_id)]
    test_uuid = _uuid(f"{source_id}:listening:test")
    storage_path = f"cambridge-internal-qa/{source_id}/{audio_file.name}"
    parent = {
        "id": test_uuid,
        "test_id": f"ILR-LIS-CAM-B{book}-T{test}",
        "title": f"[INTERNAL QA] Cambridge IELTS {book} Test {test} Listening",
        "version": "1.0",
        "accent_profile": [],
        "themes": {f"s{int(s['number'])}": s.get("title") or "" for s in sections},
        "total_transcript_words": sum(_word_count(v) for v in transcript_by_section.values()),
        "metadata": {
            "source_format": "canonical-package/1.0",
            "source_package_id": source_id,
            "source_hash": _hash_json(listening),
            "section_offsets": offsets,
            "internal_qa": True,
        },
        "status": "draft",
        "full_audio_storage_path": storage_path,
        "full_audio_duration_seconds": max(
            1, round(max(float(offsets.get(sid) or 0) + float(row.get("duration") or 0)
                         for sid, row in timing_sections.items()))
        ),
        "full_audio_size_bytes": audio_file.stat().st_size,
        "cue_points": [
            {"type": "section", "section_num": n,
             "timestamp_seconds": round(float(offsets.get(f"S{n}") or 0), 2)}
            for n in range(1, 5)
        ],
        "audio_assembly_mode": "full_premixed",
        "test_type": "full",
        "exam_only": True,
        "is_public": False,
        "public_practice_enabled": False,
        "web_explanation_mode": "disabled",
    }
    content_rows: list[dict[str, Any]] = []
    exercise_rows: list[dict[str, Any]] = []
    for section in sections:
        snum = int(section["number"])
        sid = f"S{snum}"
        content_uuid = _uuid(f"{source_id}:listening:section:{snum}")
        turn_rows = timing_sections[sid].get("turns") or []
        offset = float(offsets.get(sid) or 0)
        segments = [
            {"start": round(offset + float(t["start"]), 2),
             "end": round(offset + float(t["end"]), 2), "text": str(t.get("text") or "")}
            for t in turn_rows if t.get("start") is not None and t.get("end") is not None
        ]
        content_rows.append({
            "id": content_uuid,
            "source_type": "test_section",
            "audio_storage_path": None,
            "audio_duration_seconds": 0,
            "audio_size_bytes": 0,
            "accent_tag": "other",
            "topic_tags": [source_id, f"section-{snum}"],
            "cefr_level": "B2",
            "ielts_section": snum,
            "transcript": transcript_by_section[snum],
            "transcript_segments": segments,
            "status": "draft",
            "is_premium": False,
            "title": f"[INTERNAL QA] {source_id} — Section {snum}: {section.get('title') or ''}",
            "test_id": test_uuid,
            "section_num": snum,
            "metadata": {"source_package_id": source_id, "section_offset": offset,
                         "internal_qa": True},
        })
        for order, group in enumerate(_listening_groups(section.get("questions") or []), start=1):
            first = group[0]
            qtype = str(first.get("_effective_type") or first.get("question_type") or "")
            template_kind = LISTENING_TEMPLATE.get(qtype)
            if not template_kind:
                raise ValidationError(f"{source_id} listening Q{first['number']}: type lạ {qtype}")
            instruction, _ = _instruction_and_prompt(str(first.get("text") or ""))
            q_payload = []
            answer_payload = []
            asset_names: list[str] = []
            audio_windows: dict[str, dict[str, Any]] = {}
            for question in group:
                qnum = int(question["number"])
                _, prompt = _instruction_and_prompt(str(question.get("text") or ""))
                asset_names.extend(_asset_names(prompt))
                q_payload.append({"q_num": qnum, "prompt": _strip_asset_markdown(prompt),
                                  "options": _options(question.get("options"))})
                ans = _answer(answer_by_q[qnum], whole_set=(qtype == "multi-select"))
                answer_payload.append({"q_num": qnum, **ans})
                tr = timing_sections[sid]["questions"][str(qnum)]
                audio_windows[str(qnum)] = {
                    "start": round(offset + float(tr["start"]), 2),
                    "end": round(offset + float(tr["end"]), 2),
                    "confidence": tr.get("confidence"),
                }
            payload: dict[str, Any] = {
                "template_kind": template_kind,
                "instruction": instruction,
                "questions": q_payload,
                "answers": answer_payload,
                "audio_windows": audio_windows,
                "transcript_anchors": {str(q["q_num"]): 0 for q in q_payload},
                "source_question_type": qtype,
            }
            if template_kind in {"matching", "mcq_multi"}:
                payload["metadata"] = {"match_options": _options(first.get("options"))}
            if asset_names:
                payload["map_image_storage_path"] = (
                    f"cambridge-internal-qa/{source_id}/listening/{asset_names[0]}"
                )
            exercise_rows.append({
                "id": _uuid(f"{source_id}:listening:exercise:{snum}:{order}"),
                "content_id": content_uuid,
                "exercise_type": "mcq" if template_kind in {
                    "mcq_3option", "mcq_multi", "matching", "plan_label"
                } else "dictation",
                "payload": payload,
                "order_num": order,
                "cefr_level": "B2",
                "status": "draft",
            })
    return parent, content_rows, exercise_rows


def build_plan(root: Path) -> list[PackagePlan]:
    manifest = _load_json(root / "manifest.json")
    entries = manifest.get("tests") or []
    if len(entries) != EXPECTED_PACKAGES:
        raise ValidationError(f"Manifest cần {EXPECTED_PACKAGES} packages, nhận {len(entries)}")
    plans: list[PackagePlan] = []
    for entry in entries:
        source_id = str(entry.get("id") or "")
        expected_id = f"cambridge-{int(entry['book'])}-test-{int(entry['test'])}"
        if source_id != expected_id:
            raise ValidationError(f"Manifest identity lệch: {source_id} != {expected_id}")
        package_path = root / str(entry["package"])
        folder = package_path.parent
        package_doc = _load_json(package_path)
        tests = package_doc.get("tests") or []
        if len(tests) != 1 or tests[0].get("id") != source_id:
            raise ValidationError(f"{source_id}: package identity/shape không hợp lệ")
        qa = _load_json(folder / "qa-report.json")
        if qa.get("status") != "PASS":
            raise ValidationError(f"{source_id}: qa-report không PASS")
        timing_path = folder / f"cambridge_ielts_{entry['book']}_test_{entry['test']}_timings.json"
        timings = _load_json(timing_path)
        audio_name = str((timings.get("full_test") or {}).get("file") or "")
        audio_file = folder / audio_name
        if not audio_name or not audio_file.is_file():
            raise ValidationError(f"{source_id}: thiếu full-test audio {audio_file}")
        reading_test, reading_passages, reading_questions = _reading_rows(source_id, tests[0])
        listening_test, listening_content, listening_exercises = _listening_rows(
            source_id, tests[0], timings, audio_file
        )
        referenced = {
            name for skill in (tests[0]["reading"], tests[0]["listening"])
            for name in _asset_names(json.dumps(skill, ensure_ascii=False))
        }
        assets = {name: folder / "assets" / name for name in sorted(referenced)}
        missing_assets = [str(path) for path in assets.values() if not path.is_file()]
        if missing_assets:
            raise ValidationError(f"{source_id}: thiếu assets: {missing_assets}")
        plans.append(PackagePlan(
            source_id, int(entry["book"]), int(entry["test"]), reading_test,
            reading_passages, reading_questions, listening_test, listening_content,
            listening_exercises, audio_file, assets,
        ))
    return plans


def _upsert(db, table: str, rows: list[dict[str, Any]], *, batch_size: int = 100) -> None:
    for start in range(0, len(rows), batch_size):
        db.table(table).upsert(rows[start:start + batch_size], on_conflict="id").execute()


def _guard_destination(db, plans: list[PackagePlan], *, supabase_url: str,
                       confirmed_ref: str) -> None:
    hostname = (urlparse(supabase_url).hostname or "").lower()
    actual_ref = hostname.split(".", 1)[0]
    if not confirmed_ref or actual_ref != confirmed_ref.lower():
        raise ValidationError(
            f"Destination confirmation mismatch: URL ref={actual_ref!r}, "
            f"--confirm-supabase-ref={confirmed_ref!r}"
        )
    for table, rows in (
        ("reading_tests", [p.reading_test for p in plans]),
        ("listening_tests", [p.listening_test for p in plans]),
    ):
        ids = [row["test_id"] for row in rows]
        existing = db.table(table).select("id,test_id,metadata").in_("test_id", ids).execute().data or []
        expected = {row["test_id"]: row["id"] for row in rows}
        conflicts = [
            row["test_id"] for row in existing
            if row.get("id") != expected.get(row.get("test_id"))
            or not (row.get("metadata") or {}).get("internal_qa")
        ]
        if conflicts:
            raise ValidationError(
                f"{table}: từ chối ghi đè canonical rows không thuộc importer QA: {conflicts}"
            )


def _assert_hidden_visibility(plans: list[PackagePlan]) -> None:
    expected = {
        "status": "draft",
        "exam_only": True,
        "is_public": False,
        "public_practice_enabled": False,
        "web_explanation_mode": "disabled",
    }
    for plan in plans:
        for skill, row in (
            ("reading", plan.reading_test),
            ("listening", plan.listening_test),
        ):
            mismatches = {
                field: row.get(field)
                for field, value in expected.items()
                if row.get(field) != value
            }
            if mismatches:
                raise ValidationError(
                    f"{plan.source_id} {skill}: visibility không còn hidden: {mismatches}"
                )


def commit_plan(
    plans: list[PackagePlan], *, confirmed_ref: str,
    allow_production_hidden: bool = False,
) -> None:
    from config import settings
    from database import supabase_admin

    # Some one-off staging env files predate ENVIRONMENT and therefore retain
    # Settings' "development" default. The exact project-ref confirmation is
    # always required; an explicit production label additionally requires the
    # hidden-only override and the field assertions below.
    if (str(settings.ENVIRONMENT).lower() == "production"
            and not allow_production_hidden):
        raise ValidationError(
            "Từ chối production nếu thiếu --allow-production-hidden; "
            f"ENVIRONMENT={settings.ENVIRONMENT!r}"
        )
    _assert_hidden_visibility(plans)
    _guard_destination(
        supabase_admin, plans, supabase_url=settings.SUPABASE_URL,
        confirmed_ref=confirmed_ref,
    )
    for index, plan in enumerate(plans, start=1):
        audio_bytes = plan.audio_file.read_bytes()
        storage = supabase_admin.storage
        storage.from_(settings.LISTENING_AUDIO_BUCKET).upload(
            plan.listening_test["full_audio_storage_path"], audio_bytes,
            {"content-type": "audio/mpeg", "x-upsert": "true"},
        )
        for skill, bucket in (("reading", settings.READING_IMAGES_BUCKET),
                              ("listening", settings.LISTENING_IMAGES_BUCKET)):
            referenced = {
                Path(path).name
                for row in ([*plan.reading_questions, *plan.listening_exercises])
                for path in re.findall(rf"cambridge-internal-qa/{re.escape(plan.source_id)}/{skill}/([^\s\"]+)",
                                       json.dumps(row))
            }
            for name in sorted(referenced):
                path = plan.assets[name]
                storage.from_(bucket).upload(
                    f"cambridge-internal-qa/{plan.source_id}/{skill}/{name}", path.read_bytes(),
                    {"content-type": "image/png", "x-upsert": "true"},
                )
        _upsert(supabase_admin, "reading_tests", [plan.reading_test])
        _upsert(supabase_admin, "reading_passages", plan.reading_passages)
        _upsert(supabase_admin, "reading_questions", plan.reading_questions)
        _upsert(supabase_admin, "listening_tests", [plan.listening_test])
        _upsert(supabase_admin, "listening_content", plan.listening_content)
        _upsert(supabase_admin, "listening_exercises", plan.listening_exercises)
        print(f"[{index:02d}/{len(plans)}] {plan.source_id}: committed hidden QA")


def report(plans: list[PackagePlan]) -> dict[str, Any]:
    return {
        "packages": len(plans),
        "reading_tests": len(plans),
        "reading_passages": sum(len(p.reading_passages) for p in plans),
        "reading_questions": sum(len(p.reading_questions) for p in plans),
        "listening_tests": len(plans),
        "listening_sections": sum(len(p.listening_content) for p in plans),
        "listening_exercises": sum(len(p.listening_exercises) for p in plans),
        "listening_questions": sum(
            len(ex["payload"]["questions"]) for p in plans for ex in p.listening_exercises
        ),
        "audio_files": len(plans),
        "referenced_assets": sum(len(p.assets) for p in plans),
        "visibility": {"status": "draft", "exam_only": True, "is_public": False,
                       "public_practice_enabled": False,
                       "web_explanation_mode": "disabled"},
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--environment", choices=["internal-qa"], default="internal-qa")
    parser.add_argument(
        "--only", action="append", default=[], metavar="PACKAGE_ID",
        help="Limit commit/report to selected package ids (repeatable; useful for a canary).",
    )
    parser.add_argument("--commit", action="store_true")
    parser.add_argument(
        "--confirm-supabase-ref",
        default="",
        help="Required on commit; must exactly match the destination Supabase project ref.",
    )
    parser.add_argument(
        "--allow-production-hidden",
        action="store_true",
        help=("Permit a production commit only when every generated paper remains "
              "draft, exam-only, non-public and explanation-disabled."),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        plans = build_plan(args.root)
        if args.only:
            requested = set(args.only)
            known = {plan.source_id for plan in plans}
            unknown = sorted(requested - known)
            if unknown:
                raise ValidationError(f"--only package không tồn tại: {unknown}")
            plans = [plan for plan in plans if plan.source_id in requested]
        summary = report(plans)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if args.commit:
            commit_plan(
                plans,
                confirmed_ref=args.confirm_supabase_ref,
                allow_production_hidden=args.allow_production_hidden,
            )
            print("COMMIT COMPLETE — canonical papers remain hidden internal QA")
        else:
            print("DRY-RUN ONLY — no database or storage writes")
        return 0
    except ValidationError as exc:
        print(f"VALIDATION FAILED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
