"""Bulk-import Foundation listening LESSONS (1-section mini tests) into prod.

Mirrors the admin route (routers/listening.py ``admin_import_fulltest_commit``
with mini=True) but as a standalone CLI, reusing
services.listening_fulltest_import so persisted rows — including the per-turn
``metadata.dictation_segments`` generated at import — are identical to the
route's output.

A lesson bundle (per ``ILR-LIS-LSN-LNN``):
  Lessons/<id>_Question_Paper.md · Answer_Keys_Full/<id>_Solution.md ·
  audio_output/<id>/timings.json · audio_output/<id>/<section>.mp3

Audio: the SECTION mp3 (e.g. S3.mp3) — a mini plays its single section's own
file (starts at 0), so dictation segment windows use offset 0 (build_section_
persistence handles this via its is_mini branch).

Safety:
  • --dry-run (default) does NO writes — parses + prints a verify table
    (segments count, duplicate status).
  • --commit writes. Idempotent on ACTIVE test_id UNLESS --replace, which
    archives the existing active test + its content first (re-upload).
  • --status defaults to 'draft'.

Usage (from backend/, prod .env):
  python3 scripts/import_listening_lessons.py --lessons-dir <dir> --dry-run
  python3 scripts/import_listening_lessons.py --lessons-dir <dir> \
      --ids ILR-LIS-LSN-L01 ... --commit --replace --status published
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from config import settings                                    # noqa: E402
from database import supabase_admin                            # noqa: E402
from services import listening_fulltest_import, listening_audio  # noqa: E402


def _load_bundle(lessons_dir: Path, lid: str):
    """Return (qp_text, sol_text, timings, audio_bytes) or raise."""
    qp = (lessons_dir / "Lessons" / f"{lid}_Question_Paper.md")
    sol = (lessons_dir / "Answer_Keys_Full" / f"{lid}_Solution.md")
    audio_dir = lessons_dir / "audio_output" / lid
    tpath = audio_dir / "timings.json"
    for p in (qp, sol, tpath):
        if not p.exists():
            raise FileNotFoundError(f"missing {p}")
    timings = json.loads(tpath.read_text(encoding="utf-8"))
    secs = timings.get("sections") or []
    section_file = (secs[0].get("file") if secs else None) or "full_test.mp3"
    mp3 = audio_dir / section_file
    if not mp3.exists():
        raise FileNotFoundError(f"missing audio {mp3}")
    return (qp.read_text(encoding="utf-8"), sol.read_text(encoding="utf-8"),
            timings, mp3.read_bytes())


def _active_dup(test_id: str) -> dict | None:
    res = (supabase_admin.table("listening_tests")
           .select("id,status").eq("test_id", test_id)
           .neq("status", "archived").limit(1).execute())
    return res.data[0] if res.data else None


def _archive(test_row: dict) -> None:
    tid = test_row["id"]
    supabase_admin.table("listening_content").update(
        {"status": "archived"}).eq("test_id", tid).execute()
    supabase_admin.table("listening_tests").update(
        {"status": "archived"}).eq("id", tid).execute()


def _commit_one(lid: str, res, qp_text: str, audio_bytes, av, status: str) -> dict:
    test_uuid = str(uuid.uuid4())
    storage_path = f"tests/{test_uuid}/full.mp3"
    offsets = res.metadata.get("section_offsets") or {}
    test_payload = {
        "id":                          test_uuid,
        "test_id":                     lid,
        "title":                       res.metadata.get("title") or lid,
        "version":                     res.metadata.get("format_version") or "1.0",
        "band_target":                 res.metadata.get("band_target"),
        "accent_profile":              list(res.metadata.get("accent_profile") or []),
        "themes":                      dict(res.metadata.get("topic_distribution") or {}),
        "full_audio_storage_path":     storage_path,
        "full_audio_duration_seconds": av["duration_seconds"],
        "full_audio_size_bytes":       av["size_bytes"],
        "cue_points":                  listening_fulltest_import.build_cue_points(offsets),
        "audio_assembly_mode":         "full_premixed",
        "metadata": {
            "source_format":   "listening-fulltest-v1.1",
            "section_offsets": offsets,
            "band_conversion": res.metadata.get("band_conversion") or [],
            "test_type":       "mini",
        },
        "status":                      status,
    }
    created_content_ids: list[str] = []
    audio_uploaded = False

    def _rollback():
        try:
            for cid in created_content_ids:
                supabase_admin.table("listening_exercises").delete().eq("content_id", cid).execute()
            supabase_admin.table("listening_content").delete().eq("test_id", test_uuid).execute()
            supabase_admin.table("listening_tests").delete().eq("id", test_uuid).execute()
            if audio_uploaded:
                supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).remove([storage_path])
        except Exception as exc:  # pragma: no cover
            print(f"    !! rollback failed: {exc}", file=sys.stderr)

    try:
        supabase_admin.table("listening_tests").insert(test_payload).execute()
        supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).upload(
            storage_path, audio_bytes, {"content-type": "audio/mpeg", "x-upsert": "true"})
        audio_uploaded = True
        sections = listening_fulltest_import.build_section_persistence(res, qp_text)
        seg_total = 0
        for sec in sections:
            content_row = dict(sec["content_row"])
            content_row["id"] = str(uuid.uuid4())
            content_row["test_id"] = test_uuid
            supabase_admin.table("listening_content").insert(content_row).execute()
            created_content_ids.append(content_row["id"])
            seg_total += len((content_row.get("metadata") or {}).get("dictation_segments") or [])
            for ex in sec["exercise_rows"]:
                supabase_admin.table("listening_exercises").insert({
                    "id":            str(uuid.uuid4()),
                    "content_id":    content_row["id"],
                    "exercise_type": ex.get("exercise_type", "dictation"),
                    "payload":       ex.get("payload", {}),
                    "order_num":     ex.get("order_num", 1),
                    "cefr_level":    content_row.get("cefr_level"),
                    "status":        "draft",
                }).execute()
        return {"id": test_uuid, "segments": seg_total}
    except Exception:
        _rollback()
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description="Bulk-import listening lessons (mini tests).")
    ap.add_argument("--lessons-dir", type=Path, required=True)
    ap.add_argument("--ids", nargs="*", help="lesson ids (default: L01..L13)")
    ap.add_argument("--commit", action="store_true", help="write to prod (default: dry-run)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--replace", action="store_true",
                    help="archive an existing ACTIVE test before re-importing")
    ap.add_argument("--status", choices=["draft", "published"], default="draft")
    args = ap.parse_args()
    if args.dry_run:
        args.commit = False
    ids = args.ids or [f"ILR-LIS-LSN-L{i:02d}" for i in range(1, 14)]

    mode = "COMMIT" if args.commit else "DRY-RUN"
    print(f"== Lesson import [{mode}] · status={args.status} · replace={args.replace} ==\n")
    print(f"{'lesson':<22}{'q':>3} {'segs':>5}  dup            result")
    print("-" * 78)

    ok = skipped = failed = 0
    for lid in ids:
        try:
            qp, sol, timings, audio_bytes = _load_bundle(args.lessons_dir, lid)
            res = listening_fulltest_import.parse_fulltest(qp, sol, timings)
        except Exception as exc:
            print(f"{lid:<22}  LOAD/PARSE ERROR: {exc}")
            failed += 1
            continue
        if not res.ok:
            print(f"{lid:<22}  INVALID: {res.errors}")
            failed += 1
            continue

        rows = listening_fulltest_import.build_section_persistence(res, qp)
        segs = sum(len((r["content_row"]["metadata"].get("dictation_segments") or [])) for r in rows)
        av = listening_audio.validate_section_audio(audio_bytes)
        if av["errors"]:
            print(f"{lid:<22}{len(res.questions):>3} {segs:>5}  AUDIO ERROR: {av['errors']}")
            failed += 1
            continue

        dup = _active_dup(lid)
        dup_lbl = f"active({dup['status']})" if dup else "none"
        line = f"{lid:<22}{len(res.questions):>3} {segs:>5}  {dup_lbl:<14} "

        if dup and not args.replace:
            print(line + "SKIP (active; use --replace)")
            skipped += 1
            continue
        if not args.commit:
            print(line + ("would REPLACE" if dup else "would IMPORT") + f" ({segs} segs)")
            ok += 1
            continue

        try:
            if dup:
                _archive(dup)
            out = _commit_one(lid, res, qp, audio_bytes, av, args.status)
            print(line + f"{'REPLACED' if dup else 'IMPORTED'} id={out['id'][:8]} segs={out['segments']}")
            ok += 1
        except Exception as exc:
            print(line + f"COMMIT FAILED (rolled back): {exc}")
            failed += 1

    print("-" * 78)
    print(f"ok={ok}  skipped={skipped}  failed={failed}")
    if not args.commit:
        print("\n(dry-run — no writes. Add --commit [--replace] to import.)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
