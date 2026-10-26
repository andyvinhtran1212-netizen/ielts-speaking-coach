"""Bind a MOCK0016 revision paper to its source paper's current explanation set.

Why: the MOCK0016 package (2026-10-06) published every Cambridge REVxx copy as a
new reading/listening paper, but the 2,880 web-explanation objects stay bound to
the ORIGINAL `ILR-*-CAM-Bxx-Tx` rows. A REVxx copy therefore has 0 objects and
`fn_approve_web_explanation_paper` refuses it (migration 319 reason `:none`),
so a class give with interactive explanations fails.

This tool gives the revision its OWN identity rows, exactly like
`fn_copy_mock_draft_paper` (migration 315/316) does for private draft copies:
`object_id = mock-<revision uuid>-<skill>-qNN`, the SAME content_version (so
mock pairing still resolves), payload/source_hash copied unchanged as source
evidence, binding on the row. Rights/editorial statuses start pending so the
give or mock approval records its own approval event for this paper. The source paper's
objects are never read for writing, deactivated or changed.

It never chooses a version: the operator names the source version
(`--expected-source-version`), the source must have exactly one current version
with Q1–Q40, the revision must have no objects at all, and every revision answer
key must agree with the explanation it would serve. The explanations were audited
against the source paper, so every question the revision changed (any field but
the worked `solution(s)` text) must be listed by the reviewer in
`--reviewed-changes`; a missing or extra number refuses. A question's content
includes its passage (reading) or its whole section — transcript, segments,
audio fields — (listening), since explanations quote that text. Any disagreement
refuses the whole paper. A human-adjudicated scoring override that would change the
revision's runtime key is also a refusal, because binding would change grading.

REVEXPLAIN-0023: "agree" means agree the way learners are MARKED. Forms are
compared after the runtime marker's own expansion (normalize_answer, spaced
" / " alternatives, optional parenthesised words), and a Listening mcq_multi
exercise is compared as the grader's any-order letter set. When the revision
marks right forms the explanation does not list, the revision's COPY lists
them (item.answer.accepted_forms + audit.revision_answer_sync); the reviewer
names every such question in --reviewed-answer-sync. Where the explanation
carries an adjudicated override, the copy holds the union of both sets; if
that union marks differently from the revision key, the owner must approve the
question in --approved-grading-changes. Answer keys are never written.

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
import copy
import hashlib
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.listening_test_grader import _expected_letters, normalize_answer  # noqa: E402
from services.mock_response_policy import (  # noqa: E402
    ResponsePolicyError, policy_answer_matches, validate_response_policy,
)

# Production MOCK0016 copies, and the staging Cam19 QA copies used to rehearse
# the same binding before production.
REVISION_RE = re.compile(
    r"^(?:MOCK0016-PROD-20261006|QA-CAM19-\d{8})-(?:ILR-)?((?:RDG|LIS)-CAM-B(?:1[3-9]|2[01])-T[1-4])-REV\d{2}$")
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


def marker_forms(values: Any) -> frozenset[str]:
    """Normalised forms the runtime marker accepts for these key entries.

    Mirrors listening_test_grader.answer_matches (also used by Reading): a
    spaced " / " separates alternatives, a parenthesised word is optional, and
    every variant goes through normalize_answer. Compact slashes stay literal.
    """
    out: set[str] = set()
    for value in _flat(values):
        text = str(value).strip()
        parts = [text]
        if re.search(r"\s/\s", text):
            parts = [part.strip() for part in re.split(r"\s+/\s+", text) if part.strip()]
        for part in parts:
            variants = [part]
            if re.search(r"\([^()]+\)", part):
                variants = [re.sub(r"\s*\([^()]+\)\s*", " ", part), part.replace("(", "").replace(")", "")]
            out.update(form for form in (normalize_answer(v) for v in variants) if form)
    return frozenset(out)


_LETTER = re.compile(r"^[A-Ha-h]$")


def _letters(values: Any) -> list[str] | None:
    items = _flat(values)
    if len(items) < 2 or not all(_LETTER.match(str(v).strip()) for v in items):
        return None
    return sorted(str(v).strip().lower() for v in items)


def _added_forms(base: frozenset[str], forms: list) -> list:
    """Raw revision forms (in key order) whose marked forms the base lacks."""
    added, covered = [], set(base)
    for form in forms:
        expanded = marker_forms(form)
        if expanded and not expanded <= covered:
            added.append(form)
            covered |= expanded
    return added


def fingerprint(value: Any) -> str:
    """Stable content hash used to find questions the revision changed."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def source_test_id_for(revision_test_id: str, skill: str) -> str:
    match = REVISION_RE.match(revision_test_id or "")
    expected_prefix = "RDG-" if skill == "reading" else "LIS-"
    if not match or not match.group(1).startswith(expected_prefix):
        raise BindingRefused([f"{revision_test_id}: không phải bản REV Cambridge {skill} (MOCK0016 hoặc QA-CAM19)"])
    return "ILR-" + match.group(1)


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
    reviewed_answer_sync: frozenset[int] | set[int] = frozenset(),
    approved_grading_changes: frozenset[int] | set[int] = frozenset(),
    revision_groups: dict[int, tuple[int, ...]] | None = None,
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
    classification: dict[str, str] = {}
    answer_sync: dict[str, dict] = {}
    groups = revision_groups or {}
    for o in sorted(current, key=lambda row: row["question_number"]):
        q = o["question_number"]
        key = revision_keys.get(q)
        if not isinstance(key, dict):
            reasons.append(f"Q{q:02d}: đáp án REV không đọc được ({type(key).__name__})")
            continue
        payload = o.get("payload") or {}
        answer = (payload.get("item") or {}).get("answer") or {}
        adjudication = (payload.get("audit") or {}).get("release_adjudication") or {}
        overridden = adjudication.get("override_version") == OVERRIDE_VERSION
        accepted_raw = [v for v in _flat(answer.get("accepted_forms")) if v is not None]
        documented = marker_forms(_flat(answer.get("canonical")) + accepted_raw)
        canonical = marker_forms(answer.get("canonical"))
        kind, added, grading_change = "equivalent", [], False

        # Literal agreement (0022) stays the fast path.
        literal_rev = _key_set(key.get("answer"), key.get("alternatives"))
        literal_ok = ("response_policy" not in key and literal_rev
                      and _key_set(answer.get("canonical"), answer.get("accepted_forms")) == literal_rev
                      and frozenset(_norm(v) for v in _flat(answer.get("canonical"))) <= literal_rev
                      and not (overridden and frozenset(_norm(v) for v in accepted_raw) != literal_rev))
        letters = _letters(answer.get("canonical"))
        group = groups.get(q) or ()
        if literal_ok:
            kind = "identical"
        elif "response_policy" in key:
            # Marking uses the authored policy alone; every form the explanation
            # documents must pass it, and the copy lists the policy's forms.
            kind = "policy"
            try:
                policy = validate_response_policy(key["response_policy"])
                failing = [v for v in _flat(answer.get("canonical")) + accepted_raw
                           if not policy_answer_matches(str(v), policy)]
                listed = [v for v in policy.get("accepted_answers") or [] if policy_answer_matches(str(v), policy)]
            except (ResponsePolicyError, TypeError, ValueError, KeyError) as exc:
                failing, listed = [f"policy không hợp lệ: {exc}"], []
            if failing or overridden or not documented:
                reasons.append(f"Q{q:02d}: đáp án REV có response_policy — lời giải ghi nhận dạng policy chấm sai "
                               f"{failing}" + (" và có scoring override" if overridden else ""))
                continue
            added = _added_forms(documented, listed)
        elif letters and len(group) > 1:
            # One mcq_multi exercise is graded as an any-order letter set.
            expected = sorted(_expected_letters([revision_keys.get(n) or {} for n in group]))
            kind = "group"
            if len(group) != len(letters) or expected != letters or overridden:
                reasons.append(f"Q{q:02d}: nhóm chọn nhiều {list(group)} chấm {expected}, lời giải ghi {letters}")
                continue
        else:
            rev_raw = [v for v in [key.get("answer"), *_flat(key.get("alternatives") or [])] if v not in (None, "")]
            rev_forms = marker_forms(rev_raw)
            if not rev_forms or not canonical:
                reasons.append(f"Q{q:02d}: đáp án REV {rev_raw} hoặc canonical lời giải rỗng")
                continue
            if overridden:
                # The copy's accepted_forms ARE the runtime key (apply_scoring_overrides).
                added = _added_forms(documented, rev_raw)
                runtime = marker_forms(_flat(answer.get("canonical")) + accepted_raw + added)
                grading_change = runtime != rev_forms
                kind = "grading_change" if grading_change else ("synced" if added else "equivalent")
                if grading_change and q not in approved_grading_changes:
                    reasons.append(f"Q{q:02d}: scoring override {sorted(marker_forms(accepted_raw))} sẽ đổi đáp án "
                                   f"chấm của REV {sorted(rev_forms)} (hợp: {sorted(runtime)}) — cần owner duyệt "
                                   "trong --approved-grading-changes")
                    continue
            else:
                if not documented <= rev_forms or not canonical <= rev_forms:
                    reasons.append(f"Q{q:02d}: đáp án REV {sorted(rev_forms)} chấm sai dạng lời giải ghi nhận "
                                   f"{sorted(documented - rev_forms)} (canonical {answer.get('canonical')!r})")
                    continue
                added = _added_forms(documented, rev_raw)
                kind = "synced" if added else "equivalent"

        out_payload = o.get("payload")
        # A grading change is recorded on the copy even when the REV adds no form
        # (the override alone widens marking), so the owner's approval is visible.
        if added or grading_change:
            out_payload = copy.deepcopy(payload)
            item = out_payload.setdefault("item", {})
            item_answer = item.setdefault("answer", {})
            item_answer["accepted_forms"] = (accepted_raw or _flat(answer.get("canonical"))) + added
            out_payload.setdefault("audit", {})["revision_answer_sync"] = {
                "spec": "REVEXPLAIN-0023", "revision_test_id": revision["test_id"],
                "added_forms": added, "grading_change": grading_change,
            }
            answer_sync[str(q)] = {"added_forms": added, "grading_change": grading_change}
        classification[str(q)] = kind
        object_id = f"mock-{revision['id']}-{skill}-q{q:02d}"
        rows.append({
            **{field: o.get(field) for field in COPIED},
            "payload": out_payload,
            "object_id": object_id,
            # Same version as the source, like 315/316 draft copies, so a mock
            # pairing a bound REV paper with another paper still resolves to one
            # shared version. Identity and provenance live in object_id and
            # import_batch_id.
            "content_version": o["content_version"],
            # Changed questions were never approved against THIS paper: the copy
            # waits for the give/mock approval, which records its own event.
            "rights_status": "BLOCKED_PENDING_RIGHTS_REVIEW",
            "editorial_status": "GENERATED_REQUIRES_EDITORIAL_REVIEW",
            "reading_test_id": revision["id"] if skill == "reading" else None,
            "listening_test_id": revision["id"] if skill == "listening" else None,
            "binding_status": "BOUND",
            "is_current": True,
        })
    synced = sorted(int(q) for q in answer_sync)
    if synced != sorted(set(reviewed_answer_sync)):
        reasons.append(f"câu cần đồng bộ đáp án là {synced}; --reviewed-answer-sync khai "
                       f"{sorted(set(reviewed_answer_sync))} — người duyệt phải xác nhận đúng tập này")
    changes = sorted(int(q) for q, v in answer_sync.items() if v["grading_change"])
    if changes != sorted(set(approved_grading_changes)):
        reasons.append(f"câu đổi cách chấm là {changes}; --approved-grading-changes khai "
                       f"{sorted(set(approved_grading_changes))}")
    if reasons:
        raise BindingRefused(reasons)

    plan = {
        "skill": skill,
        "revision": {"id": revision["id"], "test_id": revision["test_id"]},
        "source": {"id": source["id"], "test_id": source["test_id"],
                   "content_version": expected_source_version,
                   "object_ids": [o["object_id"] for o in sorted(current, key=lambda r: r["question_number"])]},
        "changed_questions": changed,
        "reviewed_changes": sorted(set(reviewed_changes)),
        "classification": classification,
        "answer_sync": answer_sync,
        "reviewed_answer_sync": sorted(set(reviewed_answer_sync)),
        "approved_grading_changes": sorted(set(approved_grading_changes)),
        # The SHA covers the reviewed content itself: any edit to the revision
        # between dry run and commit changes it and blocks the commit.
        "revision_fingerprints": {str(q): revision_fingerprints.get(q) for q in range(1, 41)},
        "source_fingerprints": {str(q): source_fingerprints.get(q) for q in range(1, 41)},
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
                          .eq(fk, source["id"]).order("question_number").order("id"))
    revision_objects = _all(lambda: db.table("web_explanation_objects").select("id,object_id")
                            .eq(fk, revision["id"]).order("object_id"))
    keys, revision_fp = _paper_questions(db, skill, revision["id"])
    _, source_fp = _paper_questions(db, skill, source["id"])
    return {"revision": revision, "source": source, "source_objects": source_objects,
            "revision_objects": revision_objects, "revision_keys": keys,
            "revision_fingerprints": revision_fp, "source_fingerprints": source_fp,
            "revision_groups": _mcq_multi_groups(db, skill, revision["id"])}


def _mcq_multi_groups(db, skill: str, paper_id: str) -> dict[int, tuple[int, ...]]:
    """q -> every slot of its Listening mcq_multi exercise, exactly as
    listening_test_grader.collect_answer_key groups them for marking."""
    if skill != "listening":
        return {}
    sections = [s["id"] for s in _all(lambda: db.table("listening_content").select("id")
                                      .eq("test_id", paper_id).order("id"))]
    groups: dict[int, tuple[int, ...]] = {}
    for exercise in _all(lambda: db.table("listening_exercises").select("id,payload")
                         .in_("content_id", sections).order("id")):
        payload = exercise.get("payload") if isinstance(exercise.get("payload"), dict) else {}
        if payload.get("template_kind") != "mcq_multi":
            continue
        slots = tuple(sorted(a["q_num"] for a in payload.get("answers") or []
                             if isinstance(a, dict) and isinstance(a.get("q_num"), int)))
        for q in slots:
            groups[q] = slots
    return groups


# Learner-facing worked solutions are not part of what an explanation object
# asserts, and the MOCK0016/Cam19 editorial passes rewrite them on purpose.
_IGNORED = {"solution", "solutions"}


def _strip(row: dict | None, *extra: str) -> dict:
    drop = {"id", "test_id", "content_id", "passage_id", "created_at", "updated_at", *extra}
    return {k: v for k, v in (row or {}).items() if k not in drop and k not in _IGNORED}


# Row bookkeeping that is not evidence an explanation can quote. A copy always
# differs here (new slug/owner/status/package labels), so including it would
# mark every question "changed" and make the reviewed list meaningless.
_ADMIN = ("slug", "status", "created_by", "topic_tags", "cefr_level", "metadata", "library")


def _passage_evidence(row: dict | None) -> dict:
    return _strip(row, *_ADMIN)


def _section_evidence(row: dict | None) -> dict:
    # The section label is admin text; its audio offset is evidence timing.
    evidence = _strip(row, *_ADMIN, "title")
    metadata = (row or {}).get("metadata") if isinstance((row or {}).get("metadata"), dict) else {}
    evidence["section_offset"] = metadata.get("section_offset")
    return evidence


LISTENING_AUDIO_BUCKET = "listening-audio"


def _listening_paper_audio(db, paper_id: str, bad: list[str]) -> dict:
    """Identity of the test-level recording learners actually hear.

    Mirrors routers/listening.py::_student_audio_url_for_test: the assembled
    track wins over the full premix. A copy always gets its own storage path,
    so the identity is the content SHA-256 (plus the assembly mode), not the
    path; the duration is derived from the same bytes.
    """
    rows = db.table("listening_tests").select(
        "id,audio_assembly_mode,assembled_audio_storage_path,full_audio_storage_path"
    ).eq("id", paper_id).execute().data or []
    if len(rows) != 1:
        bad.append(f"listening_tests {paper_id}: không tìm thấy đúng 1 dòng đề")
        return {}
    row = rows[0]
    path = row.get("assembled_audio_storage_path") or row.get("full_audio_storage_path")
    evidence = {"mode": row.get("audio_assembly_mode"), "sha256": None}
    if path:
        try:
            data = db.storage.from_(LISTENING_AUDIO_BUCKET).download(path)
        except Exception as exc:  # noqa: BLE001 — any failure refuses the paper
            bad.append(f"audio đề {path}: không tải được ({type(exc).__name__})")
            return evidence
        if not isinstance(data, (bytes, bytearray)) or not data:
            bad.append(f"audio đề {path}: rỗng hoặc không đọc được")
            return evidence
        evidence["sha256"] = hashlib.sha256(data).hexdigest()
    return evidence


def _paper_questions(db, skill: str, paper_id: str) -> tuple[dict[int, dict], dict[int, str]]:
    """Answer keys and per-question content fingerprints of one paper.

    A question's fingerprint includes the passage (reading) or the whole
    section — transcript, segments, audio fields — (listening) it belongs to,
    because explanations quote that text as evidence. Malformed rows refuse.
    """
    keys: dict[int, dict] = {}
    content: dict[int, dict] = {}
    bad: list[str] = []
    if skill == "reading":
        # Same scope as grading and the 306 snapshot: test passages only.
        passages = {p["id"]: p for p in _all(lambda: db.table("reading_passages").select("*")
                                              .eq("test_id", paper_id).eq("library", "l3_test").order("id"))}
        for row in _all(lambda: db.table("reading_questions").select("*")
                        .in_("passage_id", list(passages)).order("q_num").order("id")):
            try:
                q = int(row["q_num"])
            except (TypeError, ValueError, KeyError):
                bad.append(f"reading_questions {row.get('id')}: q_num không hợp lệ")
                continue
            if q in content:
                bad.append(f"Q{q:02d}: trùng câu trong đề")
            keys[q] = row.get("answer")
            payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
            content[q] = {"question": {**_strip(row, "payload"), "payload": _strip(payload)},
                          "passage": _passage_evidence(passages.get(row.get("passage_id")))}
    else:
        paper_audio = _listening_paper_audio(db, paper_id, bad)
        sections = {s["id"]: s for s in _all(lambda: db.table("listening_content").select("*")
                                              .eq("test_id", paper_id).order("id"))}
        for exercise in _all(lambda: db.table("listening_exercises").select("*")
                             .in_("content_id", list(sections)).order("id")):
            payload = exercise.get("payload") if isinstance(exercise.get("payload"), dict) else {}
            shared = {k: v for k, v in payload.items() if k not in _IGNORED | {"answers", "questions"}}
            questions = {}
            for item in payload.get("questions") or []:
                if isinstance(item, dict) and isinstance(item.get("q_num"), int):
                    questions[item["q_num"]] = item
            for answer in payload.get("answers") or []:
                if not isinstance(answer, dict) or not isinstance(answer.get("q_num"), int):
                    bad.append(f"listening_exercises {exercise.get('id')}: đáp án không hợp lệ")
                    continue
                q = answer["q_num"]
                if q in content:
                    bad.append(f"Q{q:02d}: trùng câu trong đề")
                keys[q] = answer
                content[q] = {"answer": answer, "question": questions.get(q),
                              "exercise": {**_strip(exercise, "payload"), "payload": shared},
                              "section": _section_evidence(sections.get(exercise.get("content_id"))),
                              "paper_audio": paper_audio}
    if bad:
        raise BindingRefused(bad)
    return keys, {q: fingerprint(value) for q, value in content.items()}


def commit_plan(db, plan: dict, *, imported_by: str | None) -> dict:
    batch = str(uuid.uuid4())
    rows = [{**row, "import_batch_id": batch, "imported_by": imported_by} for row in plan["rows"]]
    # One PostgREST insert = one INSERT statement: all 40 rows or none.
    db.table("web_explanation_objects").insert(rows).execute()
    fk = f"{plan['skill']}_test_id"
    columns = ",".join(sorted(plan["rows"][0]))
    bound = db.table("web_explanation_objects").select(columns) \
        .eq(fk, plan["revision"]["id"]).eq("is_current", True).order("object_id").execute().data or []
    source = db.table("web_explanation_objects").select("object_id") \
        .eq(fk, plan["source"]["id"]).eq("is_current", True).order("question_number").execute().data or []
    readback = {
        "revision_current": len(bound),
        "revision_versions": sorted({row["content_version"] for row in bound}),
        "source_unchanged": [row["object_id"] for row in source] == plan["source"]["object_ids"],
        "rows_equal_plan": bound == sorted(plan["rows"], key=lambda row: row["object_id"]),
        "import_batch_id": batch,
    }
    if readback["revision_current"] != 40 or len(readback["revision_versions"]) != 1 \
            or not readback["source_unchanged"] or not readback["rows_equal_plan"]:
        raise RuntimeError(f"readback không đạt: {readback}")
    return readback


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skill", choices=("reading", "listening"), required=True)
    parser.add_argument("--revision", required=True, help="test_id của bản REV")
    parser.add_argument("--expected-source-version", required=True)
    parser.add_argument("--reviewed-changes", default="",
                        help="danh sách câu REV khác bản gốc đã được người duyệt xác nhận, vd 11,20,21")
    parser.add_argument("--reviewed-answer-sync", default="",
                        help="REVEXPLAIN-0023: câu mà bản lời giải của REV được bổ sung dạng đáp án REV chấm đúng")
    parser.add_argument("--approved-grading-changes", default="",
                        help="REVEXPLAIN-0023: câu có scoring override mà owner duyệt lấy hợp hai bộ đáp án")
    parser.add_argument("--plan-out", type=Path)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--plan-sha", help="SHA-256 của dry-run đã duyệt; bắt buộc khi --commit")
    parser.add_argument("--imported-by", default=None)
    args = parser.parse_args()

    from database import supabase_admin  # noqa: WPS433 — needs env only when run

    try:
        def numbers(raw: str) -> frozenset[int]:
            return frozenset(int(x) for x in raw.split(",") if x.strip())
        plan = build_plan(skill=args.skill, expected_source_version=args.expected_source_version,
                          reviewed_changes=numbers(args.reviewed_changes),
                          reviewed_answer_sync=numbers(args.reviewed_answer_sync),
                          approved_grading_changes=numbers(args.approved_grading_changes),
                          **load_inputs(supabase_admin, args.skill, args.revision))
    except BindingRefused as refused:
        print(json.dumps({"refused": refused.reasons}, ensure_ascii=False, indent=2))
        return 2
    summary = {"sha256": plan["sha256"], "revision": plan["revision"], "source": {
        k: v for k, v in plan["source"].items() if k != "object_ids"},
        "rows": len(plan["rows"]), "changed_questions": plan["changed_questions"],
        "answer_sync": plan["answer_sync"],
        "classification": {k: v for k, v in plan["classification"].items() if v != "identical"},
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
