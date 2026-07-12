"""One-off: import ILR-RDG-001 Academic Reading full test (prose Test+Solution
pair) into reading_tests / reading_passages / reading_questions, so it can be
selected as the Reading test for a 4-skill full mock exam.

Reuses the SAME pipeline as the admin `/admin/reading/import-bundle` endpoint:
    build_parsed_reading_test_from_prose(test, solution)  → ParsedReadingTest
    _commit_l3_parsed(parsed, dry_run, admin, test_type)  → validate + store

    cd backend && venv/bin/python -m scripts.import_ilr_rdg_001            # DRY-RUN (no DB)
    cd backend && venv/bin/python -m scripts.import_ilr_rdg_001 --commit   # write to Supabase
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.content_import_service import validate_reading_test  # noqa: E402
from services.reading_prose_import import build_parsed_reading_test_from_prose  # noqa: E402

_BASE = ("/Users/trantrongvinh/Documents/Co-work/IELTS Listening - Reading/"
         "IELTS_Reading_Project/02_Markdown_Package/IELTS_Reading_Markdown")
TEST = _BASE + "/Tests/ILR-RDG-001_Test.md"
SOL = _BASE + "/Answer_Keys_Full/ILR-RDG-001_Solution.md"
ADMIN = {"id": None}   # created_by is nullable; INSERT path is fine


def _parse():
    test_text = Path(TEST).read_text(encoding="utf-8")
    sol_text = Path(SOL).read_text(encoding="utf-8")
    return build_parsed_reading_test_from_prose(test_text, sol_text, published=True)


def dry_run():
    parsed = _parse()
    errs = validate_reading_test(parsed)
    print("=" * 64)
    print("test_id       :", parsed.test_id)
    print("title         :", parsed.title)
    print("module        :", parsed.module)
    print("total_questions:", parsed.total_questions, "| band_target:", parsed.band_target)
    print("passages      :", len(parsed.passages))
    all_q = []
    for p in parsed.passages:
        qs = p.get("questions") or []
        all_q.extend(qs)
        types = sorted(set(q.get("question_type") for q in qs))
        print(f"  P{p.get('passage_order')}: {p.get('title')!r} — {len(qs)} Qs")
        print(f"       types: {types}")
        print(f"       translation_vi: {'yes' if p.get('translation_vi') else 'no'}"
              f" | img_prompts: {len(p.get('img_prompts') or [])}"
              f" | Qs with rich solution: {sum(1 for q in qs if q.get('solution'))}")
    print("-" * 64)
    print("total Qs parsed:", len(all_q))
    print("sample answers :")
    for q in all_q[:8]:
        print(f"   Q{q.get('q_num')} [{q.get('question_type')}] answer={q.get('answer')!r}"
              f" alt={q.get('alternatives')}")
    print("warnings       :", list(getattr(parsed, "warnings", []) or []) or "none")
    print("VALIDATION     :", "NONE ✓" if not errs else f"{len(errs)} ERROR(S):")
    for e in errs:
        print("   ✗", e)
    print("=" * 64)
    return parsed, errs


async def commit():
    from routers.admin_reading import _commit_l3_parsed  # noqa: E402
    parsed = _parse()
    result = await _commit_l3_parsed(parsed, dry_run=False, admin=ADMIN, test_type="full")
    print("COMMIT action :", result.get("action"))
    print("committed_id  :", result.get("committed_id"))
    print("validation    :", result.get("validation_errors") or "NONE ✓")


if __name__ == "__main__":
    if "--commit" in sys.argv:
        asyncio.run(commit())
    else:
        dry_run()
