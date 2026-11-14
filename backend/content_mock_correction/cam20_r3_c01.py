"""Offline C01 plan/rehearsal SQL builder. Never connects to a database.

Input is the four-row read-only snapshot described in cam20_r3_c01.md.
Output SQL always rolls back. Applying a reviewed plan is a separate operation.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

SPEC_PATH = Path(__file__).with_suffix(".json")
SPEC = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
PROJECT_REF = "huwsmtubwulikhlmcirx"


def build_plan(snapshot: list[dict]) -> dict:
    """Validate exact paper/question identity and replace only payload.options."""
    if not isinstance(snapshot, list) or len(snapshot) != 4:
        raise ValueError("C01 requires exactly four snapshot rows")
    indexed = {}
    paper = None
    for entry in snapshot:
        question = entry["question"]
        q_num = question["q_num"]
        if type(q_num) is not int or q_num in indexed:
            raise ValueError("C01 duplicate or invalid question number")
        indexed[q_num] = question
        current_paper = entry["paper"]
        if any(current_paper.get(k) != v for k, v in SPEC["paper"].items()):
            raise ValueError("C01 paper identity or visibility/status drift")
        for field in ("mock_content_revision", "policy_revision"):
            if type(current_paper.get(field)) is not int or current_paper[field] < 1:
                raise ValueError("C01 missing revision guard")
        if paper is not None and current_paper != paper:
            raise ValueError("C01 inconsistent paper snapshots")
        paper = current_paper
    if set(indexed) != {37, 38, 39, 40}:
        raise ValueError("C01 expected Q37-Q40 only")
    changes = []
    for expected in SPEC["questions"]:
        before = indexed[expected["q_num"]]
        for field in ("id", "q_num", "prompt", "answer"):
            if before.get(field) != expected[field]:
                raise ValueError("C01 question identity, stem or answer drift")
        if (before.get("passage_id") != SPEC["passage_id"]
                or before.get("question_type") != "mcq_single"
                or not before.get("updated_at")):
            raise ValueError("C01 question membership/type/timestamp drift")
        if before.get("payload", {}).get("options") != SPEC["options_before"]:
            raise ValueError("C01 option bank drift or repair already applied")
        after = copy.deepcopy(before)
        after["payload"]["options"] = copy.deepcopy(expected["options"])
        changes.append({"before": copy.deepcopy(before), "after": after})
    return {"project_ref": PROJECT_REF, "paper": copy.deepcopy(paper), "changes": changes}


def rehearsal_sql(snapshot: list[dict]) -> str:
    """Emit one guarded atomic ROLLBACK rehearsal, never an auto-apply command."""
    plan = build_plan(snapshot)
    # A SQL string literal, not interpolated identifiers or dollar-quoted data.
    literal = json.dumps(plan, ensure_ascii=False).replace("'", "''")
    if "$c01$" in literal:
        raise ValueError("C01 snapshot contains reserved SQL delimiter")
    return """-- C01 offline-generated rehearsal. Review target and bytes before execution.
-- No production execution is authorized by creating or merging this PR.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL standard_conforming_strings = on;
DO $c01$
DECLARE
    plan jsonb := '""" + literal + """'::jsonb;
    actual jsonb;
    expected jsonb;
    item jsonb;
    paper_before jsonb;
    paper_after jsonb;
    touched integer;
BEGIN
    PERFORM public.fn_lock_mock_paper('reading', (plan->'paper'->>'id')::uuid);
    SELECT to_jsonb(t) INTO actual FROM public.reading_tests t
      WHERE t.id = (plan->'paper'->>'id')::uuid FOR UPDATE;
    IF actual IS NULL OR NOT actual @> (plan->'paper') THEN
        RAISE EXCEPTION 'C01 paper identity/policy/revision drift';
    END IF;
    paper_before := actual;
    PERFORM p.id FROM public.reading_passages p
      WHERE p.id = '90a57574-bcc8-527e-a2e2-4ee5cf0d51b6'::uuid
        AND p.test_id = (plan->'paper'->>'id')::uuid FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'C01 passage membership drift'; END IF;
    -- Check and lock every row before the first UPDATE. Any later failure is atomic.
    FOR item IN SELECT value FROM jsonb_array_elements(plan->'changes') LOOP
        SELECT to_jsonb(q) INTO actual FROM public.reading_questions q
          WHERE q.id = (item->'before'->>'id')::uuid FOR UPDATE;
        IF actual IS DISTINCT FROM item->'before' THEN
            RAISE EXCEPTION 'C01 question snapshot drift';
        END IF;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(plan->'changes') LOOP
        UPDATE public.reading_questions q SET payload = item->'after'->'payload'
          WHERE q.id = (item->'before'->>'id')::uuid AND to_jsonb(q) = item->'before';
        GET DIAGNOSTICS touched = ROW_COUNT;
        IF touched <> 1 THEN RAISE EXCEPTION 'C01 expected one updated row'; END IF;
        SELECT to_jsonb(q) - 'updated_at' INTO actual FROM public.reading_questions q
          WHERE q.id = (item->'before'->>'id')::uuid;
        expected := (item->'after') - 'updated_at';
        IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'C01 readback mismatch'; END IF;
    END LOOP;
    SELECT to_jsonb(t) INTO paper_after FROM public.reading_tests t
      WHERE t.id = (plan->'paper'->>'id')::uuid;
    expected := jsonb_set(paper_before, '{mock_content_revision}',
      to_jsonb((plan->'paper'->>'mock_content_revision')::integer + 4));
    IF (paper_after - 'updated_at') IS DISTINCT FROM (expected - 'updated_at') THEN
        RAISE EXCEPTION 'C01 unexpected paper policy or source revision';
    END IF;
END;
$c01$;
ROLLBACK;
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--sql", action="store_true", help="Print ROLLBACK rehearsal SQL")
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    print(rehearsal_sql(snapshot) if args.sql else json.dumps(build_plan(snapshot), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
