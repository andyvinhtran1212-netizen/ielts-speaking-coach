"""Copy a paper's corrected question text into its web-explanation objects.

Why (PC-J156): a content fix such as PC-J128 corrects `reading_questions` /
`listening_exercises` rows, but the paper's `web_explanation_objects` still
carry the OLD wording in `payload.item` (prompt, options, instruction text).
Those rows are immutable evidence (`source.immutable`), so the fix lands as a
NEW content version of the paper's objects:

* every current object of the paper is copied into one new version, because
  migration 319 refuses a paper with more than one current version;
* only the paper text in `payload.item` changes, and only where the paper now
  says something else; the explanation, answer, audit evidence, source hash
  and statuses are copied unchanged (a changed object whose editorial status
  was already approved goes back to GENERATED_REQUIRES_EDITORIAL_REVIEW, so a
  give/mock approval records a new approval for the new wording);
* the old rows keep every byte except `is_current`, which moves to the new
  rows exactly as `fn_activate_web_explanation_version` moves it.

Fields compared per question (paper → item):
  prompt            reading: `prompt`; listening: exercise `instruction` and the
                    question `prompt`, joined by a newline (empty parts skipped)
  options           the question's options as {label: text}, null when none
  instruction_text  reading only, when the row has `payload.instruction`
                    (`item.response_constraint.instruction_text`)
Reading `question_type` is reported in `review_notes` but never rewritten.

The whole paper is refused, with every reason, when:
  * the content fix package (`--expected-rows`, e.g. PC-J128 after.json) does
    not match the paper's current rows: a fix not applied or half applied;
  * the paper's answer key no longer agrees with an explanation's answer;
  * the paper does not have exactly one current version with Q1–Q40 bound;
  * a give, mock or public-practice policy pins the paper's version, or a mock
    pairs the paper with another paper (one shared version per mock);
  * an object has a column this tool does not know how to copy.

Default is a read-only dry run that prints the plan and its SHA-256. A commit
re-plans from the live rows, requires `--expected-plan-sha` equal to the
reviewed dry run, writes the exact SQL to `--request-out`, then sends it as
ONE transaction whose preconditions re-check every column of the current
objects (payload and statuses), the paper rows and the pins. Staging only: there is no production target.

    python backend/scripts/sync_web_explanation_item_text.py --skill reading \\
        --paper ILR-RDG-CAM-B13-T2 \\
        --expected-rows /workspace/qa/pcj128/ILR-RDG-CAM-B13-T2/after.json
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.bind_revision_web_explanations import _flat, marker_forms  # noqa: E402
from services.listening_test_grader import _expected_letters  # noqa: E402

STAGING_PROJECT_REF = "zjphffoujxkpltixsbzj"
TICKET = "PC-J156"
TOOL = "sync_web_explanation_item_text/1"
JSON_TAG = "$pcj156_json$"
DO_TAG = "$pcj156_do$"
APPROVED_EDITORIAL = {"APPROVED", "EDITORIAL_APPROVED"}
PENDING_EDITORIAL = "GENERATED_REQUIRES_EDITORIAL_REVIEW"
SERVABLE = "ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES"
# Columns copied into the new version; `id`, `created_at` take their defaults.
COPIED = ("object_id", "source_test_key", "skill", "book_number", "test_number", "question_number",
          "reading_test_id", "listening_test_id", "payload", "source_hash", "audit_verdict",
          "rights_status", "editorial_status", "serving_status", "binding_status")
KNOWN_COLUMNS = set(COPIED) | {"id", "content_version", "is_current", "import_batch_id", "imported_by",
                               "created_at", "row_md5"}
# The importer's item taxonomy names for the reading row types that differ.
READING_TYPE_ALIASES = {"notes_completion": "note_completion", "mcq_single": "multiple_choice_single",
                        "mcq_multi": "multiple_choice_multiple"}
TABLES = {"reading": "reading_questions", "listening": "listening_exercises"}


class SyncRefused(Exception):
    """The paper is not synced; every reason is listed."""

    def __init__(self, reasons: list[str]):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _options(value: Any) -> dict | None:
    """Options as {label: text} in authored order; None when there are none."""
    if isinstance(value, dict):
        return dict(value) or None
    if isinstance(value, list):
        out = {str(o.get("label")): o.get("text") for o in value if isinstance(o, dict)}
        return out or None
    return None


# ── paper text ──────────────────────────────────────────────────────────────

def paper_questions(skill: str, rows: list[dict], bad: list[str]) -> dict[int, dict]:
    """q -> {"text": {field: value}, "key": answer entry, "type": row type, "group": slots}."""
    out: dict[int, dict] = {}
    if skill == "reading":
        for row in rows:
            q = row.get("q_num")
            if not isinstance(q, int):
                bad.append(f"reading_questions {row.get('id')}: q_num không hợp lệ")
                continue
            if q in out:
                bad.append(f"Q{q:02d}: trùng câu trong đề")
            payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
            text = {"prompt": row.get("prompt"), "options": _options(payload.get("options"))}
            if isinstance(payload.get("instruction"), str):
                text["instruction_text"] = payload["instruction"]
            out[q] = {"text": text, "key": row.get("answer"), "type": row.get("question_type"), "group": ()}
        return out
    for row in rows:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        questions = {item.get("q_num"): item for item in payload.get("questions") or [] if isinstance(item, dict)}
        answers = [a for a in payload.get("answers") or [] if isinstance(a, dict)]
        if len(answers) != len(payload.get("answers") or []) or not all(isinstance(a.get("q_num"), int)
                                                                       for a in answers):
            bad.append(f"listening_exercises {row.get('id')}: đáp án không hợp lệ")
            continue
        group = tuple(sorted(a["q_num"] for a in answers)) if payload.get("template_kind") == "mcq_multi" else ()
        for answer in answers:
            q = answer["q_num"]
            if q in out:
                bad.append(f"Q{q:02d}: trùng câu trong đề")
            question = questions.get(q) or {}
            prompt = "\n".join(part for part in (payload.get("instruction"), question.get("prompt"))
                               if isinstance(part, str) and part)
            out[q] = {"text": {"prompt": prompt, "options": _options(question.get("options"))},
                      "key": answer, "type": None, "group": group if len(group) > 1 else ()}
    return out


def _item_text(item: dict, field: str) -> Any:
    if field == "instruction_text":
        return (item.get("response_constraint") or {}).get("instruction_text")
    if field == "options":
        return _options(item.get("options"))
    return item.get(field)


def _set_item_text(item: dict, field: str, value: Any) -> None:
    if field == "instruction_text":
        constraint = item.get("response_constraint")
        item["response_constraint"] = {**(constraint if isinstance(constraint, dict) else {}),
                                       "instruction_text": value}
    else:
        item[field] = value


# ── answer agreement ────────────────────────────────────────────────────────

def _letters(value: Any) -> list[str]:
    return sorted(str(v).strip().lower() for v in _flat(value))


def key_disagreements(skill: str, questions: dict[int, dict], objects: dict[int, dict]) -> list[str]:
    """Questions whose paper key no longer agrees with the explanation's answer.

    The explanation was audited against the key; syncing only the wording over
    a changed key would hide that. Agreement is compared the way learners are
    marked: marker-expanded forms, and a Choose-TWO group as one letter set.
    """
    reasons: list[str] = []
    for q in sorted(set(questions) & set(objects)):
        key = questions[q]["key"]
        answer = (((objects[q].get("payload") or {}).get("item") or {}).get("answer") or {})
        adjudication = ((objects[q].get("payload") or {}).get("audit") or {}).get("release_adjudication") or {}
        if not isinstance(key, dict):
            reasons.append(f"Q{q:02d}: đáp án đề không đọc được")
            continue
        if "response_policy" in key:
            reasons.append(f"Q{q:02d}: đáp án đề có response_policy — công cụ này không so được, cần duyệt riêng")
            continue
        group = questions[q]["group"]
        if group:
            expected = sorted(_expected_letters([questions[n]["key"] for n in group if n in questions]))
            documented = sorted({x for n in group if n in objects
                                 for x in _letters(((objects[n]["payload"].get("item") or {}).get("answer")
                                                    or {}).get("canonical"))})
            if expected != documented:
                reasons.append(f"Q{q:02d}: nhóm chọn nhiều {list(group)} — đề chấm {expected}, "
                               f"lời giải ghi {documented}")
            continue
        paper_forms = marker_forms(_flat(key.get("answer")) + _flat(key.get("alternatives") or []))
        canonical = marker_forms(answer.get("canonical"))
        documented = canonical | marker_forms(answer.get("accepted_forms"))
        if adjudication:
            documented = canonical  # an adjudicated override widens accepted forms on purpose
        if not paper_forms or not canonical or not documented <= paper_forms:
            reasons.append(f"Q{q:02d}: đáp án đề {sorted(paper_forms)} không khớp đáp án lời giải "
                           f"{sorted(documented)}")
    return reasons


# ── content fix package (e.g. PC-J128 after.json) ───────────────────────────

def expected_rows_differences(skill: str, paper: dict, rows: list[dict], expected: dict) -> list[str]:
    """Every way the paper's live rows differ from the fix package's after-state.

    `updated_at` is ignored: the migration 338 trigger moves it on every write.
    """
    reasons: list[str] = []
    table = TABLES[skill]
    if expected.get("table") != table:
        reasons.append(f"gói sửa đề dành cho bảng {expected.get('table')!r}, không phải {table}")
    if (expected.get("test") or {}).get("id") != paper.get("id"):
        reasons.append(f"gói sửa đề dành cho đề {(expected.get('test') or {}).get('id')!r}, "
                       f"không phải {paper.get('id')} ({paper.get('test_id')})")
    wanted = expected.get("rows")
    if not isinstance(wanted, list) or not wanted:
        reasons.append("gói sửa đề không có dòng nào để đối chiếu")
        return reasons
    live = {row.get("id"): row for row in rows}
    for row in wanted:
        current = live.get(row.get("id"))
        if current is None:
            reasons.append(f"gói sửa đề: dòng {table} {row.get('id')} không còn trong đề")
            continue
        columns = sorted(k for k in row if k != "updated_at" and current.get(k) != row.get(k))
        if columns:
            reasons.append(f"gói sửa đề chưa áp đủ: {table} {row.get('id')} khác after ở cột {columns}")
    return reasons


# ── plan ────────────────────────────────────────────────────────────────────

def build_plan(data: dict, *, expected_rows: dict, expected_rows_sha256: str) -> dict:
    """Pure: decide the new version's 40 rows (or none), or refuse with every reason."""
    skill = data.get("skill")
    if skill not in TABLES:
        raise SyncRefused([f"skill không hỗ trợ: {skill}"])
    tests = data.get("tests") or []
    if len(tests) != 1:
        raise SyncRefused([f"không tìm thấy đúng 1 đề ({len(tests)} dòng)"])
    paper = tests[0]
    fk = f"{skill}_test_id"
    reasons: list[str] = []

    reasons += expected_rows_differences(skill, paper, data.get("rows") or [], expected_rows)
    questions = paper_questions(skill, data.get("rows") or [], reasons)

    current = sorted((o for o in data.get("objects") or [] if o.get("is_current")),
                     key=lambda o: (o.get("question_number") or 0, str(o.get("id"))))
    versions = sorted({o.get("content_version") for o in current})
    if len(versions) != 1:
        reasons.append(f"đề có {len(versions)} content version hiện hành: {versions}")
    numbers = sorted(o.get("question_number") for o in current)
    if numbers != list(range(1, 41)):
        reasons.append(f"đề không có đúng Q1–Q40 hiện hành ({len(numbers)} object)")
    if sorted(questions) != list(range(1, 41)):
        reasons.append(f"dòng đề không có đủ Q1–Q40 ({len(questions)} câu)")
    for o in current:
        unknown = sorted(set(o) - KNOWN_COLUMNS)
        if unknown:
            reasons.append(f"{o.get('object_id')}: cột lạ {unknown} — không chép được nguyên vẹn")
        if o.get("binding_status") != "BOUND" or o.get(fk) != paper.get("id"):
            reasons.append(f"{o.get('object_id')}: không bound vào đề")
        if o.get("serving_status") != SERVABLE:
            reasons.append(f"{o.get('object_id')}: serving_status={o.get('serving_status')}")
        if any(tag in _canonical(o.get("payload")) for tag in (JSON_TAG, DO_TAG)):
            reasons.append(f"{o.get('object_id')}: payload chứa tag trích dẫn SQL {JSON_TAG}/{DO_TAG}")
    by_q = {o["question_number"]: o for o in current}
    reasons += key_disagreements(skill, questions, by_q)

    # A new version must not strand anything that names the current one.
    source_version = versions[0] if len(versions) == 1 else None
    if paper.get("web_explanation_content_version"):
        reasons.append(f"public practice của đề ghim version {paper['web_explanation_content_version']}")
    for pin in data.get("class_pins") or []:
        version = (pin.get("policy") or {}).get("content_version")
        if version:
            reasons.append(f"bài giao {pin.get('id')} ghim version {version}")
    for mock in data.get("mocks") or []:
        if mock.get("web_explanation_content_version"):
            reasons.append(f"mock {mock.get('code')} ({mock.get('id')}) ghim version "
                           f"{mock['web_explanation_content_version']}")
        if mock.get("reading_test_id") and mock.get("listening_test_id"):
            reasons.append(f"mock {mock.get('code')} ({mock.get('id')}) ghép đề này với đề kia — "
                           "một mock dùng chung một version, đổi version một đề làm hỏng ghép cặp")
    if reasons:
        raise SyncRefused(reasons)

    changes: dict[str, dict] = {}
    notes: dict[str, dict] = {}
    for q in range(1, 41):
        item = (by_q[q].get("payload") or {}).get("item") or {}
        diff = {field: {"object": _item_text(item, field), "paper": value}
                for field, value in questions[q]["text"].items() if _item_text(item, field) != value}
        if diff:
            changes[str(q)] = diff
        if skill == "reading":
            paper_type = READING_TYPE_ALIASES.get(questions[q]["type"], questions[q]["type"])
            if paper_type != item.get("question_type"):
                notes[str(q)] = {"question_type": {"object": item.get("question_type"),
                                                   "paper": questions[q]["type"]}}

    paper_text = {str(q): questions[q]["text"] for q in range(1, 41)}
    target_version = None
    rows: list[dict] = []
    if changes:
        target_version = f"{source_version}+item-text-sync-{_sha([paper['id'], source_version, paper_text])[:12]}"
        for q in range(1, 41):
            obj = by_q[q]
            row = {field: copy.deepcopy(obj.get(field)) for field in COPIED}
            if str(q) in changes:
                payload = row["payload"]
                for field, diff in changes[str(q)].items():
                    _set_item_text(payload.setdefault("item", {}), field, diff["paper"])
                payload.setdefault("audit", {})["item_text_sync"] = {
                    "ticket": TICKET, "previous_content_version": source_version,
                    "fields": sorted(changes[str(q)])}
                if row["editorial_status"] in APPROVED_EDITORIAL:
                    row["editorial_status"] = PENDING_EDITORIAL
            rows.append({**row, "content_version": target_version, "is_current": True})

    plan = {
        "tool": TOOL, "env": "staging", "skill": skill,
        "paper": {"id": paper["id"], "test_id": paper.get("test_id")},
        "expected_rows": {"sha256": expected_rows_sha256, "table": expected_rows.get("table"),
                          "rows": len(expected_rows.get("rows") or [])},
        "paper_md5": data.get("paper_md5"),
        "source_version": source_version, "target_version": target_version,
        "changed_questions": sorted(int(q) for q in changes),
        "changes": changes, "review_notes": notes,
        "preconditions": [{"id": o["id"], "object_id": o["object_id"], "row_md5": o.get("row_md5")}
                          for o in current],
        "rows": rows,
    }
    plan["sha256"] = _sha(plan)
    return plan


# ── SQL ─────────────────────────────────────────────────────────────────────

def _lit(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _paper_rows_sql(skill: str, schema: str, paper: str) -> tuple[str, str]:
    """(FROM clause selecting the paper's question rows as `x`, ORDER BY)."""
    if skill == "reading":
        return (f"{schema}.reading_questions x JOIN {schema}.reading_passages p ON p.id = x.passage_id "
                f"WHERE p.test_id = {paper} AND p.library = 'l3_test'", "x.q_num, x.id")
    return (f"{schema}.listening_exercises x JOIN {schema}.listening_content c ON c.id = x.content_id "
            f"WHERE c.test_id = {paper}", "x.order_num, x.id")


def _paper_md5_sql(skill: str, schema: str, paper: str) -> str:
    rows, _ = _paper_rows_sql(skill, schema, paper)
    return (f"(SELECT md5(COALESCE(string_agg(md5((to_jsonb(x) - 'updated_at')::text), ',' ORDER BY x.id), '')) "
            f"FROM {rows})")


def _blockers_sql(skill: str, schema: str, paper: str) -> dict[str, str]:
    return {
        "class_pins": (f"SELECT a.id, a.content_config -> 'correction_policy' AS policy "
                       f"FROM {schema}.class_assignments a WHERE a.skill = '{skill}' AND a.content_id = {paper} "
                       f"AND NULLIF(a.content_config #>> '{{correction_policy,content_version}}', '') IS NOT NULL"),
        "mocks": (f"SELECT m.id, m.code, m.reading_test_id, m.listening_test_id, m.web_explanation_mode, "
                  f"m.web_explanation_content_version FROM {schema}.mock_exams m "
                  f"WHERE m.{skill}_test_id = {paper} AND (m.web_explanation_content_version IS NOT NULL "
                  f"OR (m.reading_test_id IS NOT NULL AND m.listening_test_id IS NOT NULL))"),
    }


def load_sql(skill: str, test_id: str, *, schema: str = "public") -> str:
    """One read-only statement returning the paper, its rows, objects and pins as `r`."""
    if skill not in TABLES:
        raise ValueError(skill)
    paper = "(SELECT id FROM t)"
    rows, order = _paper_rows_sql(skill, schema, paper)
    blockers = _blockers_sql(skill, schema, paper)
    return f"""WITH t AS (
    SELECT id, test_id, status, web_explanation_mode, web_explanation_content_version
      FROM {schema}.{skill}_tests WHERE test_id = {_lit(test_id)})
SELECT jsonb_build_object(
    'skill', '{skill}',
    'tests', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM t),
    'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY {order}), '[]'::jsonb) FROM {rows}),
    'paper_md5', {_paper_md5_sql(skill, schema, paper)},
    'objects', (SELECT COALESCE(jsonb_agg((to_jsonb(o) - 'imported_by')
                    || jsonb_build_object('row_md5', md5(to_jsonb(o)::text))
                    ORDER BY o.question_number, o.content_version, o.id), '[]'::jsonb)
                  FROM {schema}.web_explanation_objects o WHERE o.{skill}_test_id = {paper}),
    'class_pins', (SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb) FROM ({blockers['class_pins']}) b),
    'mocks', (SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb) FROM ({blockers['mocks']}) b)
) AS r"""


def render_commit_sql(plan: dict, *, schema: str = "public") -> str | None:
    """One transaction: re-check, retire the old current rows, insert the new version."""
    if not plan["rows"]:
        return None
    skill, fk = plan["skill"], f"{plan['skill']}_test_id"
    paper = _lit(plan["paper"]["id"]) + "::uuid"
    table = f"{schema}.web_explanation_objects"
    ids = ", ".join(_lit(p["id"]) + "::uuid" for p in plan["preconditions"])
    checks = ", ".join(f"({_lit(p['id'])}::uuid, {_lit(p['row_md5'])})" for p in plan["preconditions"])
    object_ids = ", ".join(_lit(p["object_id"]) for p in plan["preconditions"])
    blockers = _blockers_sql(skill, schema, paper)
    paper_rows, _ = _paper_rows_sql(skill, schema, paper)
    batch = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{TOOL}:{plan['sha256']}"))
    body = json.dumps(plan["rows"], ensure_ascii=False)
    if JSON_TAG in body or DO_TAG in body:
        raise SyncRefused([f"payload chứa tag trích dẫn SQL {JSON_TAG}/{DO_TAG}"])
    columns = ", ".join(COPIED + ("content_version", "is_current"))
    return f"""-- {TICKET} {TOOL} — STAGING ONLY ({STAGING_PROJECT_REF}). Plan SHA-256 {plan['sha256']}.
-- {plan['paper']['test_id']} ({skill}): {plan['source_version']} -> {plan['target_version']};
-- changed questions {plan['changed_questions']}. Any failed check raises and nothing is written.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO {DO_TAG}
DECLARE n integer;
BEGIN
    PERFORM 1 FROM {table} WHERE {fk} = {paper} AND is_current ORDER BY question_number FOR UPDATE;
    PERFORM 1 FROM {paper_rows} FOR SHARE OF x;
    SELECT count(*) INTO n FROM {table} o
      JOIN (VALUES {checks}) AS e(id, row_md5) ON e.id = o.id
     WHERE o.{fk} = {paper} AND o.is_current AND o.content_version = {_lit(plan['source_version'])}
       AND md5(to_jsonb(o)::text) = e.row_md5;
    IF n <> 40 OR (SELECT count(*) FROM {table} WHERE {fk} = {paper} AND is_current) <> 40 THEN
        RAISE EXCEPTION 'pcj156_precondition: current objects changed since the dry run (% of 40 match)', n;
    END IF;
    IF {_paper_md5_sql(skill, schema, paper)} IS DISTINCT FROM {_lit(plan['paper_md5'])} THEN
        RAISE EXCEPTION 'pcj156_precondition: paper rows changed since the dry run';
    END IF;
    IF EXISTS (SELECT 1 FROM {schema}.{skill}_tests WHERE id = {paper}
                AND web_explanation_content_version IS NOT NULL)
       OR EXISTS ({blockers['class_pins']}) OR EXISTS ({blockers['mocks']}) THEN
        RAISE EXCEPTION 'pcj156_precondition: a give, mock or public policy now pins or pairs this paper';
    END IF;
    IF EXISTS (SELECT 1 FROM {table} WHERE content_version = {_lit(plan['target_version'])}
                AND object_id IN ({object_ids})) THEN
        RAISE EXCEPTION 'pcj156_precondition: target version already exists';
    END IF;
    UPDATE {table} SET is_current = FALSE WHERE id IN ({ids}) AND is_current;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 40 THEN RAISE EXCEPTION 'pcj156_write: retired % of 40 rows', n; END IF;
    INSERT INTO {table} ({columns}, import_batch_id)
    SELECT {', '.join('r.' + c for c in COPIED + ('content_version', 'is_current'))}, {_lit(batch)}::uuid
      FROM jsonb_populate_recordset(NULL::{table}, {JSON_TAG}{body}{JSON_TAG}::jsonb) r;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 40 THEN RAISE EXCEPTION 'pcj156_write: inserted % of 40 rows', n; END IF;
    IF (SELECT count(*) FROM {table} WHERE {fk} = {paper} AND is_current
          AND content_version = {_lit(plan['target_version'])}) <> 40
       OR (SELECT count(DISTINCT question_number) FROM {table} WHERE {fk} = {paper} AND is_current) <> 40
       OR (SELECT count(*) FROM {table} WHERE {fk} = {paper} AND is_current) <> 40 THEN
        RAISE EXCEPTION 'pcj156_postcondition: paper does not have exactly the 40 new current rows';
    END IF;
END {DO_TAG};
COMMIT;
"""


def readback(runner, plan: dict, *, schema: str = "public") -> dict:
    """Re-load the paper after a commit: the new version is current and nothing is left to sync."""
    data = runner.load(load_sql(plan["skill"], plan["paper"]["test_id"], schema=schema))
    current = [o for o in data.get("objects") or [] if o.get("is_current")]
    by_q = {o["question_number"]: o for o in current}
    wanted = {row["question_number"]: row for row in plan["rows"]}
    result = {
        "current_rows": len(current),
        "current_versions": sorted({o["content_version"] for o in current}),
        "rows_equal_plan": all(by_q.get(q) and all(by_q[q].get(c) == wanted[q].get(c) for c in COPIED)
                               for q in wanted),
        "retired_rows": sum(1 for o in data.get("objects") or []
                            if o["id"] in {p["id"] for p in plan["preconditions"]} and not o.get("is_current")),
    }
    result["ok"] = (result["current_rows"] == 40 and result["current_versions"] == [plan["target_version"]]
                    and result["rows_equal_plan"] and result["retired_rows"] == 40)
    return result


# ── runners ─────────────────────────────────────────────────────────────────

class ManagementApiRunner:
    """Supabase Management API `database/query` for the STAGING project only."""

    def __init__(self, token: str):
        self.token = token
        self.url = f"https://api.supabase.com/v1/projects/{STAGING_PROJECT_REF}/database/query"

    def _post(self, query: str, read_only: bool) -> Any:
        body = json.dumps({"query": query, "read_only": read_only}).encode()
        request = urllib.request.Request(self.url, data=body, method="POST", headers={
            "Authorization": "Bearer " + self.token, "Content-Type": "application/json",
            "User-Agent": "pcj156-sync"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"HTTP {exc.code}: {exc.read()[:800].decode(errors='replace')}") from exc

    def load(self, sql: str) -> dict:
        result = self._post("BEGIN;\nSET TRANSACTION READ ONLY;\n" + sql + ";\nROLLBACK;", True)
        if not isinstance(result, list) or len(result) != 1 or "r" not in result[0]:
            raise RuntimeError(f"unexpected load response shape: {type(result).__name__}")
        value = result[0]["r"]
        return json.loads(value) if isinstance(value, str) else value

    def execute(self, sql: str) -> Any:
        return self._post(sql, False)


class LocalPgRunner:
    """asyncpg against a LOCAL disposable database (tests and rehearsal only)."""

    def __init__(self, url: str):
        parsed = urlparse(url)
        if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1",
                                                                                         "::1"}:
            raise SystemExit("LocalPgRunner chỉ nhận PostgreSQL local (localhost/127.0.0.1)")
        self.url = url

    async def _run(self, fn: Callable):
        import asyncpg
        connection = await asyncpg.connect(self.url, statement_cache_size=0)
        try:
            return await fn(connection)
        finally:
            await connection.close()

    def load(self, sql: str) -> dict:
        value = asyncio.run(self._run(lambda c: c.fetchval(sql)))
        return json.loads(value) if isinstance(value, str) else value

    def execute(self, sql: str) -> Any:
        return asyncio.run(self._run(lambda c: c.execute(sql)))


def make_runner(args) -> Any:
    if args.local_database_url_env:
        return LocalPgRunner(os.environ[args.local_database_url_env])
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN chưa có trong môi trường")
    return ManagementApiRunner(token)


# ── CLI ─────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env", choices=("staging",), default="staging",
                        help=f"chỉ staging ({STAGING_PROJECT_REF}); không có đích production")
    parser.add_argument("--skill", choices=tuple(TABLES), required=True)
    parser.add_argument("--paper", required=True, help="test_id của đề, vd ILR-RDG-CAM-B13-T2")
    parser.add_argument("--expected-rows", type=Path, required=True,
                        help="after.json của gói sửa đề (vd /workspace/qa/pcj128/<đề>/after.json)")
    parser.add_argument("--plan-out", type=Path, help="ghi toàn bộ plan JSON ra file")
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--expected-plan-sha", help="SHA-256 của dry-run đã duyệt; bắt buộc khi --commit")
    parser.add_argument("--request-out", type=Path,
                        help="file ghi đúng SQL sẽ gửi (kết quả ở <file>.result); bắt buộc khi --commit")
    parser.add_argument("--local-database-url-env", help=argparse.SUPPRESS)
    return parser


def _summary(plan: dict) -> dict:
    return {key: plan[key] for key in ("sha256", "paper", "source_version", "target_version",
                                       "changed_questions", "changes", "review_notes", "expected_rows",
                                       "paper_md5")} | {"rows": len(plan["rows"])}


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.commit and (not args.expected_plan_sha or not args.request_out):
        parser.error("--commit cần --expected-plan-sha và --request-out")
    raw = args.expected_rows.read_bytes()
    expected = json.loads(raw)
    runner = make_runner(args)
    try:
        plan = build_plan(runner.load(load_sql(args.skill, args.paper)), expected_rows=expected,
                          expected_rows_sha256=hashlib.sha256(raw).hexdigest())
    except SyncRefused as refused:
        print(json.dumps({"refused": refused.reasons, "paper": args.paper}, ensure_ascii=False, indent=2))
        return 2
    if args.plan_out:
        args.plan_out.write_text(json.dumps(plan, ensure_ascii=False, indent=2))
    if not args.commit:
        print(json.dumps({"dry_run": _summary(plan)}, ensure_ascii=False, indent=2))
        return 0
    if args.expected_plan_sha != plan["sha256"]:
        print(f"Từ chối commit: plan SHA {plan['sha256']} khác --expected-plan-sha {args.expected_plan_sha}",
              file=sys.stderr)
        return 3
    sql = render_commit_sql(plan)
    if sql is None:
        print(json.dumps({"committed": None, "reason": "không có câu lệch — không tạo version"}, ensure_ascii=False))
        return 0
    args.request_out.write_text(sql)
    result_path = args.request_out.with_name(args.request_out.name + ".result")
    try:
        result = runner.execute(sql)
    except Exception as exc:  # noqa: BLE001 — record the failure, then stop
        result_path.write_text(f"FAILED: {exc}\n")
        print(f"Commit thất bại, không có gì được ghi: {exc}", file=sys.stderr)
        return 4
    check = readback(runner, plan)
    result_path.write_text(json.dumps({"response": result, "readback": check}, ensure_ascii=False, indent=2,
                                      default=str))
    print(json.dumps({"committed": _summary(plan), "readback": check}, ensure_ascii=False, indent=2))
    return 0 if check["ok"] else 5


if __name__ == "__main__":
    raise SystemExit(main())
