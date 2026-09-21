#!/usr/bin/env python3
"""Repair the adjudicated Cambridge 16/18 screening findings.

Dry-run is the default. The operator must source the intended environment,
confirm its Supabase project ref, then pass --apply. Every write is guarded by
the exact row identity plus the updated_at value read immediately beforehand;
known high-risk payloads also carry fixed SHA-256 preconditions.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
if str(BACKEND / "scripts") not in sys.path:
    sys.path.insert(0, str(BACKEND / "scripts"))

from _script_env import load_env  # noqa: E402
from import_cambridge_canonical_qa import (  # noqa: E402
    CAM16_T2_PART1_PROMPTS,
    CAM16_T2_PART1_TEMPLATE,
    CAM18_T1_READING_TABLE,
)

load_env()

from config import settings  # noqa: E402
from database import supabase_admin as sb  # noqa: E402


TARGETS = {
    "staging": {
        "project_ref": "zjphffoujxkpltixsbzj",
        "c18_l_q12": "de9db7e1-febe-562d-9138-285862091804",
        "c18_r_test": "3d0edafd-8cb1-5f98-998b-ef23d4e10713",
        "c16_l_q23": "26abc3a5-9a6e-54b2-9b27-3d9c212e6218",
        "c16_r_q7": "f0441cd6-b8f3-5b38-b118-ad7aa65ea4cc",
        "c16_l_part1": "eb05f4ab-0194-5a42-9f83-9f951ad46258",
        "c16_l_flow": "3af4a2b2-381f-5324-88bb-e3f7d1bc8f5c",
        "flow_storage_path": (
            "cambridge-internal-qa/cambridge-16-test-2/listening/"
            "cambridge_ielts_16_test_2_listening_q25-30_flowchart.png"
        ),
        "c18_l_before_hash": "0e47913c5df1aea5d5b1ab7555860015103a690d3a709a09464d2869560506d6",
        "c18_l_after_hash": "0e47913c5df1aea5d5b1ab7555860015103a690d3a709a09464d2869560506d6",
        "c18_r_before_hash": "32c28f0ce01a3e574af5d3750f07b88ce92f0d732f2228339aef1339aa6d422d",
        "c18_r_after_hash": "32c28f0ce01a3e574af5d3750f07b88ce92f0d732f2228339aef1339aa6d422d",
        "c16_r_q7_before_hashes": {
            "93b85eae6e551cdcfaaa0e2986901ea2420bee70c125e03ea798f565fe21edf7",
        },
        "hashes": {
            "c16_l_q23": "0c499951a5e37a0a489362742117f560f1b93181bcd8ea211885c832a66077e1",
            "c16_l_q23_after": "3c8a2ccf62d3608f80d55f84fbf5238b5d95b05c1b4205570f245446f4b3a6a0",
            "c16_l_part1": "b9cdccd36fb74a9f18cdfaac8d727994ee4845dc8df626c247ef615fcd40a7d2",
            "c16_l_part1_after": "3f857ce8642094338cfde60413437e73b6ac94256a8ae70c38615b2d5a17f33c",
            "c16_l_flow_after": "0292704a00f60e4fccf5e8feaf14cc56870941f2000c037e49aaf1533d9f6a6e",
        },
    },
    "production": {
        "project_ref": "huwsmtubwulikhlmcirx",
        "c18_l_q12": "7c8b897f-dd21-4424-9eb6-74bfc6b37da8",
        "c18_r_test": "728c93f8-e9be-4d48-821e-b7aafc4eb093",
        "c16_l_q23": "8bebcde9-b0c7-4f67-8aab-c569492523cb",
        "c16_r_q7": "1290f42b-80ef-487b-bf69-137f12f4ace1",
        "c16_l_part1": "d745ae5a-942a-4d51-89cf-9f80e17f5d54",
        "c16_l_flow": "054c9b53-bb5c-4429-b056-a3deda075ae3",
        "flow_storage_path": (
            "tests/a8157a95-4765-4b1e-a858-62f2cdfd08b2/maps/"
            "cambridge_ielts_16_test_2_listening_q25-30_flowchart.png"
        ),
        "c18_l_before_hash": "a6bacab7fe5048ce9e60e9d42cc3d479eb2ffbaed61f5827e9e81aabadfdbbe9",
        "c18_l_after_hash": "84a0cdda50c7d2bf71d12d1e1097ae36474298fa50976103fd272f5c81bcf44f",
        "c18_r_before_hash": "caad4427bae92dbbf38865ce04d21ad6f3869c50861fc026137f6c2d8e1feb56",
        "c18_r_after_hash": "bd25d35c1600ad8b7933a57be4749e2308b3bff4894bda13262e144153d1e2dd",
        "c16_r_q7_before_hashes": {
            "92b6aa011689f94a4af55c1576ffce7487abd99e30dd0b79cb1ab797695b673e",
        },
        "hashes": {
            "c16_l_q23": "9e957a8e6c4c41f3a177da85f407e537f46d1ecf0cf66f208f499a93f25d8ee6",
            "c16_l_q23_after": "c590018ec53ec8283afe68681deb5173dc310f7a2eb29fa5577c83a23bcb04ef",
            "c16_l_part1": "28bef458f29b8349aa0c70d14aca47621e6ea1399dfeb093d302cc312014d7c3",
            "c16_l_part1_after": "b62e8a450fec213ffa5e1a24a126b5ebd23992adc4f3eaf0fc9a118ed5fb2b0f",
            "c16_l_flow": "ac19e1c308975d240a229b546e24e2c1cee387ec7995195bd2c461945c6036a4",
            "c16_l_flow_after": "516d0249127d436c5a798f9d96325491af56f31cfe389ef022e9bde20a3d58ca",
        },
    },
}

ANSWERS_HASH = "b58c3c45ccb5875ad25c5e7d3555ed2c049fa8093067c974dfd73c0b36c8dee2"
FLOW_SHA = "928f06d86901f36daf84326eae44b6102b15e4d9ebd14e9a0541fec552a96ae0"
C16_Q7_AFTER_HASH = "7c0fc6a415456c06afe0204823c89a471946f6adb2bcece30a9be15186b2cbb5"

Q1_SUMMARY = (
    "Urban farming in Paris\n"
    "Vertical tubes are used to grow strawberries, {{1}} and herbs.\n"
    "There will eventually be a daily harvest of as much as {{2}} in\n"
    "weight of fruit and vegetables.\n"
    "It may be possible that the farm's produce will account for as much as 10% of\n"
    "the city's {{3}} overall."
)
Q4_SUMMARY = (
    "Intensive farming versus aeroponic urban farming\n\n"
    "Intensive farming\n"
    "Growth\n• wide range of {{4}} used\n• techniques pollute air\n"
    "Selection\n• quality not good\n"
    "• varieties of fruit and vegetables chosen that can survive long {{5}}\n"
    "Sale\n• {{6}} receive very little of overall income\n\n"
    "Aeroponic urban farming\n"
    "Growth\n• no soil used\n• nutrients added to water, which is recycled\n"
    "Selection\n• produce chosen because of its {{7}}"
)
Q22_SUMMARY = (
    "Some dead wood is removed to avoid the possibility of {{22}}.\n"
    "The {{23}} from the tops of cut trees can help improve soil quality.\n"
    "Some damaged trees should be left, as their {{24}} provide habitats for a range\n"
    "of creatures.\n"
    "Some trees that are small, such as {{25}}, are a source of food for animals\n"
    "and insects.\n"
    "Any trees that are {{26}} should be left to grow, as they add to the variety of\n"
    "species in the forest."
)


def _hash(value) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _one(table: str, row_id: str) -> dict:
    rows = sb.table(table).select("*").eq("id", row_id).limit(2).execute().data or []
    if len(rows) != 1:
        raise RuntimeError(f"{table}:{row_id}: expected one row, got {len(rows)}")
    return rows[0]


def _guard_project(config: dict, confirmed_ref: str) -> None:
    actual = (urlparse(settings.SUPABASE_URL).hostname or "").split(".", 1)[0]
    if actual != config["project_ref"] or confirmed_ref != actual:
        raise RuntimeError(
            f"project ref mismatch: actual={actual!r}, target={config['project_ref']!r}, "
            f"confirmed={confirmed_ref!r}"
        )


def _validated_database_dsn(config: dict) -> str:
    raw = (settings.DATABASE_URL or "").strip()
    if not raw:
        raise RuntimeError("DATABASE_URL is required for atomic Reading repair")
    dsn = raw.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urlparse(dsn)
    host = (parsed.hostname or "").lower()
    username = unquote(parsed.username or "")
    refs: set[str] = set()
    if host.startswith("db.") and host.endswith(".supabase.co"):
        refs.add(host.removeprefix("db.").removesuffix(".supabase.co"))
    if host.endswith(".pooler.supabase.com") and username.startswith("postgres."):
        refs.add(username.split(".", 1)[1])
    expected = config["project_ref"]
    if refs != {expected}:
        raise RuntimeError(
            "DATABASE_URL project ref mismatch: "
            f"detected={sorted(refs)!r}, expected={expected!r}"
        )
    return dsn


def _update(table: str, old: dict, patch: dict, *, apply: bool) -> dict:
    merged = {**old, **patch}
    if not apply or all(old.get(key) == value for key, value in patch.items()):
        return merged
    rows = (
        sb.table(table).update(patch)
        .eq("id", old["id"]).eq("updated_at", old["updated_at"])
        .execute().data or []
    )
    if len(rows) != 1:
        raise RuntimeError(f"{table}:{old['id']}: optimistic update affected {len(rows)} rows")
    return rows[0]


def _exercise(row_id: str, expected_hashes: str | set[str] | None = None) -> dict:
    row = _one("listening_exercises", row_id)
    accepted = {expected_hashes} if isinstance(expected_hashes, str) else (expected_hashes or set())
    if accepted and _hash(row.get("payload") or {}) not in accepted:
        raise RuntimeError(f"listening_exercises:{row_id}: payload precondition drift")
    return row


def _repair_c18_listening(config: dict, *, apply: bool) -> None:
    row = _exercise(config["c18_l_q12"], {
        config["c18_l_before_hash"], config["c18_l_after_hash"],
    })
    payload = copy.deepcopy(row.get("payload") or {})
    questions = payload.get("questions") or []
    q12 = next((q for q in questions if int(q.get("q_num") or 0) == 12), None)
    if not q12:
        raise RuntimeError("Cam18 T1 Listening Q12 missing")
    if q12.get("prompt") not in (
        "What does the speaker say about",
        "What does the speaker say about the age of volunteers?",
    ):
        raise RuntimeError(f"Cam18 T1 Listening Q12 unexpected prompt: {q12.get('prompt')!r}")
    payload["instruction"] = "Choose the correct letter, A, B or C."
    q12["prompt"] = "What does the speaker say about the age of volunteers?"
    _update("listening_exercises", row, {"payload": payload}, apply=apply)


def _reading_rows(test_id: str) -> dict[int, dict]:
    passages = sb.table("reading_passages").select("id").eq("test_id", test_id).execute().data or []
    passage_ids = [row["id"] for row in passages]
    rows = sb.table("reading_questions").select("*").in_("passage_id", passage_ids).execute().data or []
    by_q = {int(row["q_num"]): row for row in rows}
    if sorted(by_q) != list(range(1, 41)):
        raise RuntimeError(f"Reading test {test_id}: expected q1..40")
    return by_q


def _reading_projection(row: dict) -> dict:
    return {
        "prompt": row.get("prompt"),
        "payload": row.get("payload") or {},
        "answer": row.get("answer") or {},
    }


def _reading_set_projection(rows: dict[int, dict], q_nums: list[int]) -> list[dict]:
    return [
        {"id": rows[q]["id"], "q_num": q, **_reading_projection(rows[q])}
        for q in q_nums
    ]


def _build_c18_reading_plan(config: dict, *, target: str) -> list[tuple[dict, dict]]:
    rows = _reading_rows(config["c18_r_test"])
    limits = {**{q: "NO MORE THAN TWO WORDS AND/OR A NUMBER" for q in range(1, 4)},
              **{q: "ONE WORD ONLY" for q in [4, 5, 6, 7, 22, 23, 24, 25, 26]}}
    q_nums = list(limits)
    state_hash = _hash(_reading_set_projection(rows, q_nums))
    if state_hash not in {config["c18_r_before_hash"], config["c18_r_after_hash"]}:
        raise RuntimeError("Cam18 T1 Reading baseline projection drift")
    templates = {
        1: {"summary_text": Q1_SUMMARY},
        4: {"summary_text": Q4_SUMMARY, **CAM18_T1_READING_TABLE},
        22: {"summary_text": Q22_SUMMARY},
    }
    plan: list[tuple[dict, dict]] = []
    for q_num in q_nums:
        old = rows[q_num]
        payload = copy.deepcopy(old.get("payload") or {})
        payload["word_limit"] = limits[q_num]
        if q_num in templates:
            payload["template"] = templates[q_num]
        elif target == "staging":
            payload.pop("template", None)
        patch = {"payload": payload}
        if target == "staging":
            patch["prompt"] = "(see summary above)"
        if q_num == 3:
            patch["answer"] = {
                "answer": "consumption",
                "alternatives": ["food consumption"],
            }
        if q_num == 7:
            patch["answer"] = {"answer": "flavour", "alternatives": ["flavor"]}
        if any(old.get(key) != value for key, value in patch.items()):
            plan.append((old, patch))
    return plan


def _build_c16_reading_q7_plan(config: dict) -> list[tuple[dict, dict]]:
    row = _one("reading_questions", config["c16_r_q7"])
    state_hash = _hash({"prompt": row.get("prompt"), "answer": row.get("answer") or {}})
    accepted = {*config["c16_r_q7_before_hashes"], C16_Q7_AFTER_HASH}
    if state_hash not in accepted:
        raise RuntimeError("Cam16 T1 Reading Q7 projection drift")
    if row.get("answer") != {"answer": "TRUE", "alternatives": []}:
        raise RuntimeError("Cam16 T1 Reading Q7 answer drift")
    prompt = (
        "The polar bear's mechanism for increasing bone density could also "
        "be used by people one day."
    )
    return [] if row.get("prompt") == prompt else [(row, {"prompt": prompt})]


async def _atomic_reading_updates_async(
    plan: list[tuple[dict, dict]], database_dsn: str,
) -> None:
    import asyncpg

    connection = await asyncpg.connect(database_dsn)
    try:
        async with connection.transaction():
            for old, patch in plan:
                desired = {**_reading_projection(old), **patch}
                result = await connection.fetchrow(
                    """
                    UPDATE reading_questions
                    SET prompt = $2,
                        payload = $3::jsonb,
                        answer = $4::jsonb,
                        updated_at = NOW()
                    WHERE id = $1::uuid
                      AND prompt = $5
                      AND payload = $6::jsonb
                      AND answer = $7::jsonb
                    RETURNING id
                    """,
                    old["id"], desired["prompt"], json.dumps(desired["payload"]),
                    json.dumps(desired["answer"]), old["prompt"],
                    json.dumps(old.get("payload") or {}),
                    json.dumps(old.get("answer") or {}),
                )
                if result is None:
                    raise RuntimeError(
                        f"reading_questions:{old['id']}: atomic precondition drift"
                    )
    finally:
        await connection.close()


def _atomic_reading_updates(
    plan: list[tuple[dict, dict]], *, database_dsn: str, apply: bool,
) -> None:
    if apply and plan:
        asyncio.run(_atomic_reading_updates_async(plan, database_dsn))


def _repair_c16_q23(config: dict, *, apply: bool) -> None:
    row = _exercise(config["c16_l_q23"], {
        config["hashes"]["c16_l_q23"], config["hashes"]["c16_l_q23_after"],
    })
    payload = copy.deepcopy(row.get("payload") or {})
    stem = "In which TWO ways do both Jess and Tom decide to change their proposals?"
    payload["instruction"] = f"Choose **TWO** letters, A-E. {stem}"
    for question in payload.get("questions") or []:
        question["prompt"] = stem
    _update("listening_exercises", row, {"payload": payload}, apply=apply)


def _repair_c16_part1(config: dict, *, apply: bool) -> None:
    row = _exercise(config["c16_l_part1"], {
        config["hashes"]["c16_l_part1"], config["hashes"]["c16_l_part1_after"],
    })
    payload = copy.deepcopy(row.get("payload") or {})
    if _hash(payload.get("answers") or []) != ANSWERS_HASH:
        raise RuntimeError("Cam16 T2 Listening Part1 answer hash drift")
    payload["template_kind"] = "notes_completion"
    payload["template"] = CAM16_T2_PART1_TEMPLATE
    for question in payload.get("questions") or []:
        q_num = int(question.get("q_num") or 0)
        question["prompt"] = CAM16_T2_PART1_PROMPTS[q_num]
        question["variant"] = "sentence_inline"
    if _hash(payload.get("answers") or []) != ANSWERS_HASH:
        raise RuntimeError("Cam16 T2 Listening Part1 answers changed during repair")
    _update("listening_exercises", row, {"payload": payload}, apply=apply)


def _ensure_flow_asset(config: dict, asset: Path | None, *, apply: bool) -> None:
    if asset is not None and (
        not asset.is_file() or hashlib.sha256(asset.read_bytes()).hexdigest() != FLOW_SHA
    ):
        raise RuntimeError(f"flowchart asset missing or hash mismatch: {asset}")
    accepted = {
        value for key, value in config["hashes"].items()
        if key in {"c16_l_flow", "c16_l_flow_after"}
    }
    row = _exercise(config["c16_l_flow"], accepted)
    path = config["flow_storage_path"]
    bucket = sb.storage.from_(settings.LISTENING_IMAGES_BUCKET)
    stored: bytes | None
    try:
        stored = bucket.download(path)
    except Exception as exc:
        stored = None
        if asset is None:
            raise RuntimeError(
                "Cam16 T2 flowchart object is missing and no canonical local asset was supplied"
            ) from exc
    if stored is not None and hashlib.sha256(stored).hexdigest() != FLOW_SHA:
        raise RuntimeError("existing flowchart object hash mismatch")
    if apply and stored is None:
        if asset is None:  # guarded above; keeps the mutation branch explicit
            raise RuntimeError("canonical flowchart asset is required for upload")
        try:
            bucket.upload(path, asset.read_bytes(), {
                "content-type": "image/png", "x-upsert": "false",
            })
            stored = bucket.download(path)
        except Exception as exc:
            raise RuntimeError("flowchart upload failed") from exc
        if hashlib.sha256(stored).hexdigest() != FLOW_SHA:
            raise RuntimeError("uploaded flowchart hash mismatch")
    payload = copy.deepcopy(row.get("payload") or {})
    payload["map_image_storage_path"] = path
    _update("listening_exercises", row, {"payload": payload}, apply=apply)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def _verify_flow_asset(config: dict) -> None:
    flow = _exercise(config["c16_l_flow"])["payload"]
    _require(_hash(flow) == config["hashes"]["c16_l_flow_after"],
             "Cam16 T2 flowchart desired payload hash mismatch")
    _require(
        flow.get("map_image_storage_path") == config["flow_storage_path"],
        "Cam16 T2 flowchart storage path mismatch",
    )
    try:
        stored = sb.storage.from_(settings.LISTENING_IMAGES_BUCKET).download(
            config["flow_storage_path"]
        )
    except Exception as exc:
        raise RuntimeError("Cam16 T2 flowchart object is missing") from exc
    _require(hashlib.sha256(stored).hexdigest() == FLOW_SHA,
             "Cam16 T2 flowchart object hash mismatch")


def verify(config: dict, *, target: str) -> None:
    q12 = _exercise(config["c18_l_q12"])["payload"]
    q12_rows = [q for q in q12.get("questions") or [] if int(q.get("q_num") or 0) == 12]
    _require(len(q12_rows) == 1, "Cam18 T1 Listening Q12 must occur exactly once")
    _require(q12.get("instruction") == "Choose the correct letter, A, B or C.",
             "Cam18 T1 Listening Q12 instruction mismatch")
    _require(
        q12_rows[0].get("prompt") == "What does the speaker say about the age of volunteers?",
        "Cam18 T1 Listening Q12 prompt mismatch",
    )
    _require(_hash(q12) == config["c18_l_after_hash"],
             "Cam18 T1 Listening desired payload hash mismatch")

    c18 = _reading_rows(config["c18_r_test"])
    q_nums = [1, 2, 3, 4, 5, 6, 7, 22, 23, 24, 25, 26]
    _require(_hash(_reading_set_projection(c18, q_nums)) == config["c18_r_after_hash"],
             "Cam18 T1 Reading desired projection hash mismatch")
    expected_limits = {
        **{q: "NO MORE THAN TWO WORDS AND/OR A NUMBER" for q in range(1, 4)},
        **{q: "ONE WORD ONLY" for q in [4, 5, 6, 7, 22, 23, 24, 25, 26]},
    }
    for q_num, word_limit in expected_limits.items():
        _require(c18[q_num]["payload"].get("word_limit") == word_limit,
                 f"Cam18 T1 Reading Q{q_num} word_limit mismatch")
        _require(c18[q_num].get("prompt") == "(see summary above)",
                 f"Cam18 T1 Reading Q{q_num} prompt mismatch")
        has_template = isinstance(c18[q_num]["payload"].get("template"), dict)
        _require(has_template == (q_num in {1, 4, 22}),
                 f"Cam18 T1 Reading Q{q_num} template ownership mismatch")
    _require(c18[1]["payload"]["template"]["summary_text"] == Q1_SUMMARY,
             "Cam18 T1 Reading Q1 template mismatch")
    _require(c18[4]["payload"]["template"] == {
        "summary_text": Q4_SUMMARY, **CAM18_T1_READING_TABLE,
    }, "Cam18 T1 Reading Q4 structured table mismatch")
    _require(c18[22]["payload"]["template"]["summary_text"] == Q22_SUMMARY,
             "Cam18 T1 Reading Q22 template mismatch")
    marker_expectations = {1: list(range(1, 4)), 4: list(range(4, 8)),
                           22: list(range(22, 27))}
    for owner, expected in marker_expectations.items():
        template = c18[owner]["payload"]["template"]
        # Q4 keeps summary_text only as a renderer-compatibility discriminator;
        # the structured table is the authoritative and displayed gap branch.
        marker_source = template["rows"] if owner == 4 else template["summary_text"]
        rendered = json.dumps(marker_source, ensure_ascii=False)
        markers = sorted(int(value) for value in re.findall(
            r"\{\{(\d+)\}\}", rendered
        ))
        _require(markers == expected,
                 f"Cam18 T1 Reading Q{owner} marker ownership mismatch")
        _require(not re.search(r"_{2,}|…+|\.{4,}", rendered),
                 f"Cam18 T1 Reading Q{owner} has residual printed blank")
    _require(c18[3]["answer"] == {
        "answer": "consumption", "alternatives": ["food consumption"],
    }, "Cam18 T1 Reading Q3 answer mismatch")
    _require(c18[7]["answer"] == {
        "answer": "flavour", "alternatives": ["flavor"],
    }, "Cam18 T1 Reading Q7 answer mismatch")

    q23 = _exercise(config["c16_l_q23"])["payload"]
    stem = "In which TWO ways do both Jess and Tom decide to change their proposals?"
    _require(q23.get("instruction") == f"Choose **TWO** letters, A-E. {stem}",
             "Cam16 T1 Listening Q23-24 instruction mismatch")
    _require(all(q.get("prompt") == stem for q in q23.get("questions") or []),
             "Cam16 T1 Listening Q23-24 prompt mismatch")
    _require(_hash(q23) == config["hashes"]["c16_l_q23_after"],
             "Cam16 T1 Listening Q23-24 payload hash mismatch")
    q7 = _one("reading_questions", config["c16_r_q7"])
    _require(_hash({"prompt": q7.get("prompt"), "answer": q7.get("answer") or {}})
             == C16_Q7_AFTER_HASH, "Cam16 T1 Reading Q7 desired projection mismatch")
    part1 = _exercise(config["c16_l_part1"])["payload"]
    _require(_hash(part1.get("answers") or []) == ANSWERS_HASH,
             "Cam16 T2 Listening Part1 answers changed")
    _require(part1.get("template_kind") == "notes_completion",
             "Cam16 T2 Listening Part1 template kind mismatch")
    seen = [item["q_num"] for group in part1["template"]["groups"]
            for item in group["items"] if "q_num" in item]
    _require(seen == list(range(1, 11)),
             "Cam16 T2 Listening Part1 template gap ownership mismatch")
    by_q = {int(q["q_num"]): q for q in part1.get("questions") or []}
    _require(sorted(by_q) == list(range(1, 11)),
             "Cam16 T2 Listening Part1 question set mismatch")
    for q_num, prompt in CAM16_T2_PART1_PROMPTS.items():
        _require(by_q[q_num].get("prompt") == prompt,
                 f"Cam16 T2 Listening Part1 Q{q_num} prompt mismatch")
        _require(by_q[q_num].get("variant") == "sentence_inline",
                 f"Cam16 T2 Listening Part1 Q{q_num} variant mismatch")
    _require(_hash(part1) == config["hashes"]["c16_l_part1_after"],
             "Cam16 T2 Listening Part1 payload hash mismatch")
    _verify_flow_asset(config)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--confirm-supabase-ref", required=True)
    parser.add_argument("--flowchart", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    config = TARGETS[args.target]
    _guard_project(config, args.confirm_supabase_ref)
    if args.verify_only:
        verify(config, target=args.target)
        print(f"{args.target}: verified")
        return
    if args.target == "production" and not args.flowchart:
        raise RuntimeError("--flowchart is required for production")

    # Read and validate every fixed baseline before the first write. Reading
    # changes are later committed together in one database transaction.
    _repair_c18_listening(config, apply=False)
    reading_plan = [
        *_build_c18_reading_plan(config, target=args.target),
        *_build_c16_reading_q7_plan(config),
    ]
    database_dsn = _validated_database_dsn(config)
    _repair_c16_q23(config, apply=False)
    _repair_c16_part1(config, apply=False)
    _ensure_flow_asset(config, args.flowchart, apply=False)

    if args.apply:
        # Exercise the transactional DB connection before any REST/storage
        # mutation. If it cannot commit, production remains untouched.
        _atomic_reading_updates(reading_plan, database_dsn=database_dsn, apply=True)
        _repair_c18_listening(config, apply=True)
        _repair_c16_q23(config, apply=True)
        _repair_c16_part1(config, apply=True)
        _ensure_flow_asset(config, args.flowchart, apply=True)
    print(f"{args.target}: {'applied' if args.apply else 'dry-run passed'}")
    if args.apply:
        verify(config, target=args.target)
        print(f"{args.target}: verified")


if __name__ == "__main__":
    main()
