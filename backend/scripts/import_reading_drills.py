"""Import 03_Drills_By_Type single-passage drills as Reading MINI tests.

One drill = one passage + 7 questions of ONE type → `reading_tests` row with
`test_type='mini'`, so it surfaces in the Reading mini-test library
(`GET /reading/test?test_type=mini`) and NOT in the full-test browse.

Reuses the same pipeline as the admin `/admin/reading/import-bundle` endpoint:
    build_parsed_reading_test_from_drill(drill, solution) → ParsedReadingTest
    validate_reading_test(parsed)                         → hard gate
    _commit_l3_parsed(parsed, dry_run, admin, "mini")     → store

    cd backend
    venv/bin/python -m scripts.import_reading_drills --source-dir /path/to/03_Drills_By_Type
    venv/bin/python -m scripts.import_reading_drills --source-dir /path/to/03_Drills_By_Type --commit
    venv/bin/python -m scripts.import_reading_drills --source-dir /path/to/03_Drills_By_Type --only TC
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.content_import_service import validate_reading_test  # noqa: E402
from services.reading_drill_import import (  # noqa: E402
    build_parsed_reading_test_from_drill,
)

# The 10 requested types, in exam order. Unit = L2-T1 for each.
TYPES = ["TFNG", "YNG", "MH", "SC", "SUM", "NC", "TC", "FC", "DL", "SAQ"]
UNIT = "L2-T1"
ADMIN = {"id": None}   # created_by is nullable

# ── Diagram images ────────────────────────────────────────────────────
#
# Only `diagram_label_completion` / `flow_chart_completion` render an image, and
# only from `payload.template.image_storage_path` (SVG is rejected by the
# magic-byte sniff — PNG/JPG/WebP only). The image attaches to the FIRST
# question of the run; the student fetch signs it into `payload.image_url`.
#
# FC-L2-T1 is deliberately ABSENT: its PNG is unusable (question numbers
# overprint the box text — "cuts th(2)model", "st(7)tures" — and the (4)/(6)
# blanks fall outside their boxes), and the artwork still shows the "nozzle"
# leak that was just corrected in the drill source. Text-only until it is
# redrawn — see Figures/_FIGURES_README.md.


def _paths(base: Path, t: str) -> tuple[Path, Path]:
    stem = f"ILR-RDG-DRL-{t}-{UNIT}"
    return (base / "Drills" / f"{stem}_Drill.md",
            base / "Solutions" / f"{stem}_Solution.md")


def _parse(base: Path, t: str, published: bool = True):
    drill_p, sol_p = _paths(base, t)
    return build_parsed_reading_test_from_drill(
        drill_p.read_text(encoding="utf-8"),
        sol_p.read_text(encoding="utf-8"),
        published=published,
    )


async def _attach_image(base: Path, t: str, test_uuid: str) -> str:
    """Upload the drill's figure onto the FIRST question of the run."""
    from config import settings
    from database import supabase_admin
    from services import reading_image

    png = ({
        "DL": base / "Figures" / "ILR-RDG-DRL-DL-L2-T1_figure.png",
    }).get(t)
    if not png or not png.exists():
        return "no image"

    pas = supabase_admin.table("reading_passages").select("id") \
        .eq("test_id", test_uuid).order("passage_order").limit(1).execute()
    if not pas.data:
        return "image FAILED: passage not found"
    rows = supabase_admin.table("reading_questions") \
        .select("id,q_num,payload").eq("passage_id", pas.data[0]["id"]) \
        .order("q_num").limit(1).execute()
    if not rows.data:
        return "image FAILED: question not found"

    q = rows.data[0]
    meta = reading_image.upload_diagram_image(
        contents=png.read_bytes(),
        question_id=q["id"],
        test_id=test_uuid,
        supabase=supabase_admin,
        bucket=settings.READING_IMAGES_BUCKET,
    )
    payload = q.get("payload") or {}
    payload["template"] = {**(payload.get("template") or {}), **meta}
    supabase_admin.table("reading_questions").update({"payload": payload}) \
        .eq("id", q["id"]).execute()
    return f"image → Q{q['q_num']} ({meta['image_size_bytes']} B {meta['image_format']})"


def dry_run(base: Path, types: list[str]) -> int:
    bad = 0
    for t in types:
        parsed = _parse(base, t)
        errs = validate_reading_test(parsed)
        p = parsed.passages[0] if parsed.passages else {}
        qs = p.get("questions") or []
        print("=" * 78)
        print(f"{t:5} {parsed.test_id}  — {parsed.title}")
        print(f"      band_target={parsed.band_target}  questions={len(qs)}  "
              f"body={len(p.get('body_markdown') or '')} chars  "
              f"translation={'yes' if p.get('translation_vi') else 'NO'}")
        types_seen = sorted({q["question_type"] for q in qs})
        print(f"      types={types_seen}")
        for q in qs:
            extra = []
            if q.get("options"):
                extra.append(f"options={len(q['options'])}")
            if q.get("template"):
                extra.append("TEMPLATE")
            if q.get("solution"):
                extra.append("sol")
            alts = q.get("alternatives") or []
            print(f"        Q{q['q_num']} [{q['skill_tag']}/{q.get('sub_skill')}] "
                  f"ans={q['answer']!r}" + (f" alts={alts}" if alts else "")
                  + (f"  {' '.join(extra)}" if extra else ""))
            print(f"             prompt: {q['prompt'][:110]}")
            if q.get("template"):
                tmpl = q["template"]["summary_text"]
                for line in tmpl.splitlines()[:12]:
                    print(f"             | {line[:104]}")
        if parsed.warnings:
            print("      WARNINGS:")
            for w in parsed.warnings:
                print(f"        ! {w}")
        if errs:
            bad += 1
            print(f"      VALIDATION: {len(errs)} ERROR(S)")
            for e in errs:
                print(f"        ✗ {e}")
        else:
            print("      VALIDATION: OK ✓")
    print("=" * 78)
    print(f"{len(types)} unit(s); {bad} with validation errors.")
    return bad


async def commit(base: Path, types: list[str]) -> None:
    from routers.admin_reading import _commit_l3_parsed  # noqa: E402
    for t in types:
        parsed = _parse(base, t, published=True)
        errs = validate_reading_test(parsed)
        if errs:
            print(f"{t:5} SKIPPED — {len(errs)} validation error(s)")
            continue
        result = await _commit_l3_parsed(
            parsed, dry_run=False, admin=ADMIN, test_type="mini",
        )
        test_uuid = result.get("committed_id")
        img = await _attach_image(base, t, test_uuid) if test_uuid else "skipped"
        print(f"{t:5} {parsed.test_id}  action={result.get('action')}  "
              f"id={test_uuid}  errors={result.get('validation_errors') or 'none'}  "
              f"| {img}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True,
                        help="đường dẫn thư mục 03_Drills_By_Type")
    parser.add_argument("--only", choices=TYPES, type=str.upper)
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    source_dir = args.source_dir.expanduser().resolve()
    if not (source_dir / "Drills").is_dir() or not (source_dir / "Solutions").is_dir():
        parser.error("--source-dir phải chứa hai thư mục Drills và Solutions")
    selected = [args.only] if args.only else TYPES
    if args.commit:
        asyncio.run(commit(source_dir, selected))
    else:
        sys.exit(1 if dry_run(source_dir, selected) else 0)
