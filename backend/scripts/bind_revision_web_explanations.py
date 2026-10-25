"""Bind a MOCK0016 revision paper to its source paper's current explanation set.

Why: the MOCK0016 package (2026-10-06) published every Cambridge REVxx copy as a
new reading/listening paper, but the 2,880 web-explanation objects stay bound to
the ORIGINAL `ILR-*-CAM-Bxx-Tx` rows. A REVxx copy therefore has 0 objects and
`fn_approve_web_explanation_paper` refuses it (migration 319 reason `:none`),
so a class give with interactive explanations fails.

This tool gives the revision its OWN identity rows, exactly like
`fn_copy_mock_draft_paper` (migration 315/316) does for private draft copies:
`object_id = mock-<revision uuid>-<skill>-qNN`, payload/source_hash/statuses
copied unchanged as source evidence, binding on the row. The source paper's
objects are never read for writing, deactivated or changed.

It never chooses a version: the operator names the source version
(`--expected-source-version`), the source must have exactly one current version
with Q1–Q40, the revision must have no objects at all, and every revision answer
key must agree with the explanation it would serve. The explanations were audited
against the source paper, so every question the revision changed (any field but
the worked `solution(s)` text) must be listed by the reviewer in
`--reviewed-changes`; a missing or extra number refuses. Any disagreement
refuses the whole paper. A human-adjudicated scoring override that would change the
revision's runtime key is also a refusal, because binding would change grading.

Default is a read-only dry run that prints the plan and its SHA-256. `--commit`
requires `--plan-sha` equal to the reviewed dry-run SHA and inserts all 40 rows
in ONE insert statement, then reads them back.

    python backend/scripts/bind_revision_web_explanations.py \
        --skill reading \
        --revision MOCK0016-PROD-20261006-ILR-RDG-CAM-B19-T1-REV01 \
        --expected-source-version cambridge-web-explanations/2026-09-10-v1 \
        --reviewed-changes 11,14,15
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REVISION_RE = re.compile(r"^MOCK0016-PROD-20261006-(ILR-(?:RDG|LIS)-CAM-B(1[3-9]|2[01])-T[1-4])-REV\d{2}$")
OVERRIDE_VERSION = "cambridge-release-overrides/1.0"
SERVABLE = "ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES"
COPIED = ("source_test_key", "skill", "book_number", "test_number", "question_number",
          "payload", "source_hash", "audit_verdict", "rights_status", "editorial_status",
          "serving_status")


class BindingRefused(Exception):
    """The paper is not bound; every reason is listed."""

    def __init__(self, reasons: list[str]):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value).strip().lower())


def _flat(value: Any) -> list:
    if isinstance(value, (list, tuple)):
        return [item for part in value for item in _flat(part)]
    return [] if value in (None, "") else [value]


def _key_set(answer: Any, alternatives: Any) -> frozenset[str]:
    return frozenset(_norm(v) for v in _flat(answer) + _flat(alternatives or []))


def fingerprint(value: Any) -> str:
    """Stable content hash used to find questions the revision changed."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def source_test_id_for(revision_test_id: str, skill: str) -> str:
    match = REVISION_RE.match(revision_test_id or "")
    expected_prefix = "ILR-RDG-" if skill == "reading" else "ILR-LIS-"
    if not match or not match.group(1).startswith(expected_prefix):
        raise BindingRefused([f"{revision_test_id}: không phải bản REV Cambridge {skill} của gói MOCK0016"])
    return match.group(1)


def build_plan(
    *,
    skill: str,
    revision: dict,
    source: dict,
    source_objects: list[dict],
    revision_objects: list[dict],
    revision_keys: dict[int, dict],
    revision_fingerprints: dict[int, str],
    source_fingerprints: dict[int, str],
    reviewed_changes: frozenset[int] | set[int],
    expected_source_version: str,
) -> dict:
    """Pure: decide the exact 40 rows to insert, or refuse with every reason."""
    reasons: list[str] = []
    if skill not in ("reading", "listening"):
        raise BindingRefused([f"skill không hỗ trợ: {skill}"])
    if source_test_id_for(revision["test_id"], skill) != source["test_id"]:
        reasons.append(f"nguồn {source['test_id']} không phải bản gốc của {revision['test_id']}")
    if revision.get("status") != "published":
        reasons.append(f"bản REV đang {revision.get('status')}, không phải published")
    if revision_objects:
        reasons.append(f"bản REV đã có {len(revision_objects)} object (không gắn chồng)")

    current = [o for o in source_objects if o.get("is_current")]
    versions = sorted({o["content_version"] for o in current})
    if len(versions) != 1:
        reasons.append(f"bản gốc có {len(versions)} content version hiện hành: {versions}")
    elif versions[0] != expected_source_version:
        reasons.append(f"version hiện hành của bản gốc là {versions[0]}, không phải {expected_source_version}")
    numbers = sorted(o["question_number"] for o in current)
    if numbers != list(range(1, 41)):
        reasons.append(f"bản gốc không có đúng Q1–Q40 hiện hành ({len(numbers)} object)")
    for o in current:
        if o.get("binding_status") != "BOUND" or o.get(f"{skill}_test_id") != source["id"]:
            reasons.append(f"{o['object_id']}: không bound vào bản gốc")
        if o.get("serving_status") != SERVABLE:
            reasons.append(f"{o['object_id']}: serving_status={o.get('serving_status')}")
    if sorted(revision_keys) != list(range(1, 41)):
        reasons.append(f"bản REV không có đủ đáp án Q1–Q40 ({len(revision_keys)})")

    # The explanations were audited against the SOURCE paper. Questions the
    # revision left identical keep that evidence; every changed question must be
    # named by the reviewer, so no edit is accepted silently.
    changed = sorted(q for q in range(1, 41)
                     if revision_fingerprints.get(q) != source_fingerprints.get(q))
    if changed != sorted(set(reviewed_changes)):
        reasons.append(f"câu REV khác bản gốc là {changed}; --reviewed-changes khai "
                       f"{sorted(set(reviewed_changes))} — người duyệt phải xác nhận đúng tập này")

    rows: list[dict] = []
    for o in sorted(current, key=lambda row: row["question_number"]):
        q = o["question_number"]
        key = revision_keys.get(q)
        if key is None:
            continue
        item = (o.get("payload") or {}).get("item") or {}
        answer = item.get("answer") or {}
        accepted = _key_set(answer.get("canonical"), answer.get("accepted_forms"))
        rev_set = _key_set(key.get("answer"), key.get("alternatives"))
        canonical = frozenset(_norm(v) for v in _flat(answer.get("canonical")))
        if not rev_set or not canonical or not rev_set <= accepted or not canonical <= rev_set:
            reasons.append(f"Q{q:02d}: đáp án REV {sorted(rev_set)} không khớp lời giải "
                           f"(canonical {answer.get('canonical')!r}, accepted {sorted(accepted)})")
        adjudication = ((o.get("payload") or {}).get("audit") or {}).get("release_adjudication") or {}
        if adjudication.get("override_version") == OVERRIDE_VERSION:
            override = frozenset(_norm(v) for v in answer.get("accepted_forms") or [] if v is not None)
            if override != rev_set:
                reasons.append(f"Q{q:02d}: scoring override {sorted(override)} sẽ đổi đáp án chấm của REV "
                               f"{sorted(rev_set)}")
        object_id = f"mock-{revision['id']}-{skill}-q{q:02d}"
        rows.append({
            **{field: o.get(field) for field in COPIED},
            "object_id": object_id,
            "content_version": f"{o['content_version']}@{revision['test_id']}",
            "reading_test_id": revision["id"] if skill == "reading" else None,
            "listening_test_id": revision["id"] if skill == "listening" else None,
            "binding_status": "BOUND",
            "is_current": True,
        })
    if reasons:
        raise BindingRefused(reasons)

    plan = {
        "skill": skill,
        "revision": {"id": revision["id"], "test_id": revision["test_id"]},
        "source": {"id": source["id"], "test_id": source["test_id"],
                   "content_version": expected_source_version,
                   "object_ids": [o["object_id"] for o in sorted(current, key=lambda r: r["question_number"])]},
        "changed_questions": changed,
        "rows": rows,
    }
    plan["sha256"] = hashlib.sha256(
        json.dumps({k: v for k, v in plan.items() if k != "sha256"}, sort_keys=True,
                   ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    return plan


def _all(query) -> list[dict]:
    rows, start = [], 0
    while True:
        page = query().range(start, start + 999).execute().data or []
        rows.extend(page)
        if len(page) < 1000:
            return rows
        start += 1000


def load_inputs(db, skill: str, revision_test_id: str) -> dict:
    table = "reading_tests" if skill == "reading" else "listening_tests"
    fk = f"{skill}_test_id"
    columns = "id,test_id,status"
    revision = (db.table(table).select(columns).eq("test_id", revision_test_id).execute().data or [])
    source_test_id = source_test_id_for(revision_test_id, skill)
    source = (db.table(table).select(columns).eq("test_id", source_test_id).execute().data or [])
    if len(revision) != 1 or len(source) != 1:
        raise BindingRefused([f"không tìm thấy đúng 1 dòng cho {revision_test_id} / {source_test_id}"])
    revision, source = revision[0], source[0]
    objects = "id,object_id,content_version,question_number,is_current,binding_status," \
              f"{fk},{','.join(COPIED)}"
    source_objects = _all(lambda: db.table("web_explanation_objects").select(objects)
                          .eq(fk, source["id"]).order("question_number"))
    revision_objects = _all(lambda: db.table("web_explanation_objects").select("id,object_id")
                            .eq(fk, revision["id"]).order("object_id"))
    keys, revision_fp = _paper_questions(db, skill, revision["id"])
    _, source_fp = _paper_questions(db, skill, source["id"])
    return {"revision": revision, "source": source, "source_objects": source_objects,
            "revision_objects": revision_objects, "revision_keys": keys,
            "revision_fingerprints": revision_fp, "source_fingerprints": source_fp}


# Learner-facing worked solutions are not part of what an explanation object
# asserts, and the MOCK0016/Cam19 editorial passes rewrite them on purpose.
_IGNORED = {"solution", "solutions"}


def _paper_questions(db, skill: str, paper_id: str) -> tuple[dict[int, dict], dict[int, str]]:
    """Answer keys and per-question content fingerprints of one paper."""
    keys: dict[int, dict] = {}
    content: dict[int, dict] = {}
    if skill == "reading":
        passages = db.table("reading_passages").select("id").eq("test_id", paper_id).execute().data or []
        for row in _all(lambda: db.table("reading_questions")
                        .select("q_num,question_type,prompt,answer,payload")
                        .in_("passage_id", [p["id"] for p in passages]).order("q_num")):
            q = int(row["q_num"])
            keys[q] = row.get("answer") or {}
            content[q] = {"type": row.get("question_type"), "prompt": row.get("prompt"),
                          "answer": row.get("answer"),
                          "payload": {k: v for k, v in (row.get("payload") or {}).items() if k not in _IGNORED}}
    else:
        sections = db.table("listening_content").select("id,section_num").eq("test_id", paper_id).execute().data or []
        for exercise in _all(lambda: db.table("listening_exercises").select("content_id,order_num,exercise_type,payload")
                             .in_("content_id", [s["id"] for s in sections]).order("id")):
            payload = exercise.get("payload") or {}
            shared = {k: v for k, v in payload.items() if k not in _IGNORED | {"answers", "questions"}}
            questions = {int(x["q_num"]): x for x in payload.get("questions") or [] if "q_num" in x}
            for answer in payload.get("answers") or []:
                q = int(answer["q_num"])
                keys[q] = answer
                content[q] = {"type": exercise.get("exercise_type"), "answer": answer,
                              "question": questions.get(q), "exercise": shared}
    return keys, {q: fingerprint(value) for q, value in content.items()}


def commit_plan(db, plan: dict, *, imported_by: str | None) -> dict:
    batch = str(uuid.uuid4())
    rows = [{**row, "import_batch_id": batch, "imported_by": imported_by} for row in plan["rows"]]
    # One PostgREST insert = one INSERT statement: all 40 rows or none.
    db.table("web_explanation_objects").insert(rows).execute()
    fk = f"{plan['skill']}_test_id"
    bound = db.table("web_explanation_objects").select("object_id,content_version,is_current") \
        .eq(fk, plan["revision"]["id"]).eq("is_current", True).execute().data or []
    source = db.table("web_explanation_objects").select("object_id") \
        .eq(fk, plan["source"]["id"]).eq("is_current", True).order("question_number").execute().data or []
    readback = {
        "revision_current": len(bound),
        "revision_versions": sorted({row["content_version"] for row in bound}),
        "source_unchanged": [row["object_id"] for row in source] == plan["source"]["object_ids"],
        "import_batch_id": batch,
    }
    if readback["revision_current"] != 40 or len(readback["revision_versions"]) != 1 \
            or not readback["source_unchanged"]:
        raise RuntimeError(f"readback không đạt: {readback}")
    return readback


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skill", choices=("reading", "listening"), required=True)
    parser.add_argument("--revision", required=True, help="test_id của bản REV")
    parser.add_argument("--expected-source-version", required=True)
    parser.add_argument("--reviewed-changes", default="",
                        help="danh sách câu REV khác bản gốc đã được người duyệt xác nhận, vd 11,20,21")
    parser.add_argument("--plan-out", type=Path)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--plan-sha", help="SHA-256 của dry-run đã duyệt; bắt buộc khi --commit")
    parser.add_argument("--imported-by", default=None)
    args = parser.parse_args()

    from database import supabase_admin  # noqa: WPS433 — needs env only when run

    try:
        reviewed = frozenset(int(x) for x in args.reviewed_changes.split(",") if x.strip())
        plan = build_plan(skill=args.skill, expected_source_version=args.expected_source_version,
                          reviewed_changes=reviewed,
                          **load_inputs(supabase_admin, args.skill, args.revision))
    except BindingRefused as refused:
        print(json.dumps({"refused": refused.reasons}, ensure_ascii=False, indent=2))
        return 2
    summary = {"sha256": plan["sha256"], "revision": plan["revision"], "source": {
        k: v for k, v in plan["source"].items() if k != "object_ids"},
        "rows": len(plan["rows"]), "changed_questions": plan["changed_questions"],
        "content_version": plan["rows"][0]["content_version"],
        "first_object_id": plan["rows"][0]["object_id"]}
    if args.plan_out:
        args.plan_out.write_text(json.dumps(plan, ensure_ascii=False, indent=2))
    if not args.commit:
        print(json.dumps({"dry_run": summary}, ensure_ascii=False, indent=2))
        return 0
    if args.plan_sha != plan["sha256"]:
        print(f"Từ chối commit: plan SHA {plan['sha256']} khác --plan-sha {args.plan_sha}", file=sys.stderr)
        return 3
    print(json.dumps({"committed": summary,
                      "readback": commit_plan(supabase_admin, plan, imported_by=args.imported_by)},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
