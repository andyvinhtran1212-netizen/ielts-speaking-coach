"""Four evidence-backed, item-scoped answer variants from the November audit.

Pure and fail-closed: callers persist guarded row diffs, not learner history.
No global punctuation normalisation or cross-item spelling guesses are added.
"""
from copy import deepcopy
import json
import uuid


REPAIRS = {
    ("MOCK0016-PROD-20261006-ILR-LIS-CAM-B20-T4-REV02", 8):
        ("2.30", ["two thirty"], "2:30"),
    ("MOCK0016-PROD-20261006-ILR-RDG-CAM-B18-T1-REV01", 2):
        ("1,000 kg", [], "1000 kg"),
    ("MOCK0016-PROD-20261006-ILR-LIS-CAM-B17-T2-REV01", 31):
        ("321,000", [], "321000"),
    ("MOCK0016-PROD-20261006-ILR-RDG-CAM-B16-T4-REV01", 13):
        ("(the) harbour / harbor", [], "the harbor"),
}

# Reviewed row identities, not arbitrary rows with an accidentally matching key.
ROW_IDS = {
    "MOCK0016-PROD-20261006-ILR-RDG-CAM-B16-T4-REV01": ("e3fcb94a-931d-42c1-8cae-b491ecd35548", "63ab586a-cbc9-4f3f-9d51-1e85c8bf40d4"),
    "MOCK0016-PROD-20261006-ILR-RDG-CAM-B18-T1-REV01": ("fc67f913-a4f9-47c7-be77-ad9899cf98b8", "ee26860d-79cb-4b2c-9847-e9b34f5ce636"),
    "MOCK0016-PROD-20261006-ILR-LIS-CAM-B20-T2-REV02": ("c5a0325c-e6a2-5d0c-bfad-b6086ffdb7fd", "a79e6a42-ae6d-550a-85ed-2c9b08a78353"),
    "MOCK0016-PROD-20261006-ILR-LIS-CAM-B20-T4-REV02": ("64a259ec-eb66-5b69-ad4f-08d755d50405", "aa667c6d-1b95-5079-a38e-5dcd88a39f0d"),
    "MOCK0016-PROD-20261006-ILR-LIS-CAM-B17-T2-REV01": ("81eac2e4-2363-525b-b1a6-20a273e5db08", "995b0273-8854-57a6-9065-450c3c13465e"),
    "ILR-RDG-CAM-B18-T1": ("b7b335e5-fd96-5e00-8b0e-6d5ffd09e6a7", "3d0edafd-8cb1-5f98-998b-ef23d4e10713"),
    "ILR-RDG-CAM-B16-T4": ("ff83eec5-3ed0-575f-8dfd-5fd3b851e348", "7b6c9c8b-8bff-5240-bcd1-876341aaf92a"),
    "ILR-LIS-CAM-B17-T2": ("0a846d47-c5d6-58ec-932e-e041e36622fe", "82ecda1d-ea89-5d66-8ae2-3c155836f527"),
    "ILR-LIS-CAM-B20-T4": ("8ba4705b-ccc9-5247-a0da-201411448088", "d79802ec-3582-5821-a631-f4c1b1431efc"),
    "ILR-LIS-CAM-B20-T2": ("03f1f259-d4c2-57de-875b-753db2244cf9", "fb158a82-81c8-520b-954a-4eebf033a6e7"),
}


def validate_row(row):
    code = row["test_id"]
    expected = ROW_IDS.get(code)
    if expected != (row.get("id"), row.get("test_uuid")):
        raise ValueError("Row identity differs from reviewed target")
    pair = ("reading_questions", "answer") if "-RDG-" in code else ("listening_exercises", "payload")
    if (row.get("table_name"), row.get("field")) != pair or not row.get("updated_at"):
        raise ValueError("Repair table, field or timestamp differs from reviewed target")
    if row.get("is_public") is not False or row.get("status") != ("draft" if code.startswith("ILR-") else "published"):
        raise ValueError("Repair paper status or visibility differs from reviewed target")


def repair_answer(test_id, q_num, answer):
    """Add only the independently verified form, preserving all other fields."""
    target = REPAIRS.get((test_id, q_num))
    if target is None:
        raise ValueError("Item is outside the reviewed repair batch")
    canonical, before, added = target
    if answer.get("answer") != canonical or answer.get("alternatives") not in (
        before, before + [added]
    ):
        raise ValueError("Answer differs from the reviewed source")
    if "response_policy" in answer:
        raise ValueError("Existing response policy requires separate review")
    result = deepcopy(answer)
    result["alternatives"] = before + [added]
    return result


MATCHING_LABELS = {
    11: "walking around the town centre",
    12: "helping at concerts",
    13: "getting involved with community groups",
    14: "helping with a magazine",
    15: "participating at lunches for retired people",
    16: "helping with the website",
}
MATCHING_STEM = "What is the role of the volunteers in each of the following activities?"
MATCHING_OPTIONS = [
    "providing entertainment", "providing publicity about a council service",
    "contacting local businesses", "giving advice to visitors",
    "collecting feedback on events", "selling tickets",
    "introducing guest speakers at an event",
    "encouraging cooperation between local organisations", "helping people find their seats",
]
MATCHING_INSTRUCTION = (
    MATCHING_STEM + "\n\nChoose SIX answers from the box and write the correct "
    "letter, A-I, next to Questions 11-16."
)


def repair_matching(payload):
    """Restore Cambridge 20 p41 (local source PDF p43), keeping all keys."""
    if [q.get("q_num") for q in payload.get("questions", [])] != list(MATCHING_LABELS):
        raise ValueError("Matching question identities differ from reviewed source")
    if payload.get("answers") != [{"q_num": n, "answer": a, "alternatives": []}
                                  for n, a in zip(MATCHING_LABELS, "DIHEAB")]:
        raise ValueError("Matching answer keys differ from reviewed source")
    if (payload.get("metadata", {}).get("match_options") !=
            [{"letter": letter, "text": text} for letter, text in zip("ABCDEFGHI", MATCHING_OPTIONS)]
            or payload.get("metadata", {}).get("letter_options") != list("ABCDEFGHI")):
        raise ValueError("Matching option bank differs from reviewed source")
    desired = deepcopy(payload)
    desired["template_kind"] = desired["variant"] = "matching"
    desired["instruction"] = MATCHING_INSTRUCTION
    desired["metadata"].pop("choose", None)
    for q in desired["questions"]:
        q["prompt"] = MATCHING_LABELS[q["q_num"]]
    if payload == desired:
        return desired
    if (payload.get("template_kind") != "mcq_multi"
            or payload.get("variant") != "mcq_multi"
            or payload.get("metadata", {}).get("choose") != 2
            or payload.get("instruction") != "Choose **TWO** letters, A-I. " + MATCHING_STEM
            or any(q.get("prompt") != MATCHING_STEM for q in payload["questions"])):
        raise ValueError("Matching payload differs from reviewed source")
    return desired


def build_changes(rows, *, rehearsal=False):
    """Build five guarded production changes or four staging variant rehearsals.

    Staging has original papers, not the production REV copies. Its matching
    original is already correct and is deliberately left alone.
    """
    changes = []
    seen = set()
    staging_reference_count = 0
    for row in rows:
        validate_row(row)
        code = row["test_id"]
        value = deepcopy(row["before_value"])
        if rehearsal:
            candidates = [key for key in REPAIRS if key[0].split("-ILR-", 1)[1].rsplit("-REV", 1)[0] == code.removeprefix("ILR-")]
        else:
            candidates = [key for key in REPAIRS if key[0] == code]
        if code.endswith("B20-T2" if rehearsal else "B20-T2-REV02"):
            if rehearsal:
                staging_reference_count += 1
                bank = [{"label": letter, "text": text} for letter, text in zip("ABCDEFGHI", MATCHING_OPTIONS)]
                if (value.get("template_kind") != "matching"
                        or value.get("metadata") != {"match_options": bank}
                        or [q.get("q_num") for q in value.get("questions", [])] != list(MATCHING_LABELS)
                        or any(q.get("prompt") != MATCHING_STEM + "\n" + MATCHING_LABELS[q["q_num"]]
                               or q.get("options") != bank for q in value["questions"])):
                    raise ValueError("Staging matching reference differs from source")
                continue
            if code != "MOCK0016-PROD-20261006-ILR-LIS-CAM-B20-T2-REV02":
                raise ValueError("Unknown matching paper")
            after = repair_matching(value)
            identity = (code, 11)
        elif len(candidates) == 1:
            identity = candidates[0]
            q_num = identity[1]
            if row["field"] == "answer":
                answer = value
            else:
                matches = [a for a in value["answers"] if a.get("q_num") == q_num]
                if len(matches) != 1:
                    raise ValueError("Expected exactly one reviewed answer slot")
                answer = matches[0]
            # Explicit staging mappings preserve its own printed shorthand and
            # do not manufacture parity with the production revision.
            if rehearsal and code == "ILR-RDG-CAM-B16-T4":
                if answer != {"answer": "(the) harbour", "alternatives": ["harbor"]}:
                    raise ValueError("Staging harbour source drift")
                fixed = {**answer, "alternatives": ["harbor", "the harbor"]}
            elif rehearsal and code == "ILR-LIS-CAM-B20-T4":
                if answer != {"q_num": 8, "answer": "2.30", "alternatives": []}:
                    raise ValueError("Staging time source drift")
                fixed = {**answer, "alternatives": ["2:30"]}
            else:
                fixed = repair_answer(*identity, answer)
            if row["field"] == "answer":
                after = fixed
            else:
                value["answers"] = [fixed if a["q_num"] == q_num else a for a in value["answers"]]
                after = value
        else:
            raise ValueError("Unexpected paper in repair snapshot")
        if identity in seen:
            raise ValueError("Duplicate repair target")
        seen.add(identity)
        changes.append({**deepcopy(row), "after_value": after})
    if len(changes) != (4 if rehearsal else 5) or (rehearsal and staging_reference_count != 1):
        raise ValueError("Incomplete repair snapshot")
    return changes


def transaction_sql(changes, *, rollback=True):
    """One atomic, compare-and-set transaction; default is rollback rehearsal.

    The captured before JSON is the rollback artifact. No attempt or snapshot
    table is writable here. Locks serialize with canonical paper admission.
    """
    def literal(value):
        if "$cambridge_repair$" in str(value):
            raise ValueError("Snapshot contains reserved SQL delimiter")
        return "'" + str(value).replace("'", "''") + "'"

    statements = ["BEGIN;", "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '30s';",
                  "SET LOCAL standard_conforming_strings = on;"]
    for c in sorted(changes, key=lambda x: (x["table_name"], x["test_uuid"])):
        validate_row(c)
        table, field = c["table_name"], c["field"]
        if (table, field) not in {("reading_questions", "answer"), ("listening_exercises", "payload")}:
            raise ValueError("Unsupported repair table or field")
        row_id, test_uuid = str(uuid.UUID(c["id"])), str(uuid.UUID(c["test_uuid"]))
        skill = "reading" if table == "reading_questions" else "listening"
        child, foreign = ("reading_passages", "passage_id") if skill == "reading" else ("listening_content", "content_id")
        before = literal(json.dumps(c["before_value"], ensure_ascii=False)) + "::jsonb"
        after = literal(json.dumps(c["after_value"], ensure_ascii=False)) + "::jsonb"
        statements += [
            f"SELECT public.fn_lock_mock_paper('{skill}', '{test_uuid}'::uuid);",
            "DO $cambridge_repair$ DECLARE changed integer; BEGIN",
            f"IF NOT EXISTS (SELECT 1 FROM public.{skill}_tests WHERE id='{test_uuid}'::uuid "
            f"AND test_id={literal(c['test_id'])} AND status={literal(c['status'])} "
            f"AND is_public IS NOT DISTINCT FROM {str(c['is_public']).lower()}) THEN "
            "RAISE EXCEPTION 'paper identity or visibility drift'; END IF;",
            f"UPDATE public.{table} SET {field}={after} WHERE id='{row_id}'::uuid "
            f"AND {field}={before} AND updated_at={literal(c['updated_at'])}::timestamptz "
            f"AND {foreign} IN (SELECT id FROM public.{child} WHERE test_id='{test_uuid}'::uuid);",
            "GET DIAGNOSTICS changed = ROW_COUNT; IF changed <> 1 THEN RAISE EXCEPTION 'content compare-and-set drift'; END IF;",
            f"IF NOT EXISTS (SELECT 1 FROM public.{table} WHERE id='{row_id}'::uuid AND {field}={after}) THEN RAISE EXCEPTION 'content readback mismatch'; END IF;",
            "END $cambridge_repair$;",
        ]
    statements.append("ROLLBACK;" if rollback else "COMMIT;")
    return "\n".join(statements) + "\n"
