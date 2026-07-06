"""Bulk-import listening skill drills into prod Supabase.

Mirrors the admin commit route (routers/listening.py
``admin_import_drill_commit``) but as a standalone CLI so a batch can be
imported before the admin panel ships. Reuses services.listening_drill_import
.parse_drill so the persisted rows are byte-identical to the route's output.

Audio: uses the SECTION mp3 (e.g. S2.mp3) — the direct skill audio — NOT the
assembled full_test.mp3, matching how a 1-section drill should sound. The
per-question windows in timings.json are section-relative, so they line up with
the section file.

Safety:
  • --dry-run (default) does NO writes — parses + prints a verify table.
  • --commit writes. Idempotent: skips a test_id that already has an ACTIVE
    (non-archived) row.
  • --status defaults to 'draft'. Keep drills draft until PR #673 (the
    test_type=drill list-exclusion) is deployed — publishing sooner would leak
    drills into the live Cambridge full-tests list.

Usage (from backend/, venv with prod .env):
  python3 scripts/import_skill_drills.py --dry-run
  python3 scripts/import_skill_drills.py --commit --status draft
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

from config import settings
from database import supabase_admin
from services import listening_drill_import, listening_audio

DEFAULT_DRILLS_DIR = Path(
    "/Users/trantrongvinh/Documents/Co-work/IELTS Listening - Reading/"
    "IELTS_Listening_50_Đề/11_Skill_Drills_Web"
)
DEFAULT_IDS = [
    "ILR-LIS-DRL-FLOW-L1-T1", "ILR-LIS-DRL-FLOW-L1-T2", "ILR-LIS-DRL-FLOW-L1-T3",
    "ILR-LIS-DRL-FORM-L1-T1", "ILR-LIS-DRL-FORM-L1-T2", "ILR-LIS-DRL-FORM-L1-T3",
]


def _load_bundle(drills_dir: Path, test_id: str, audio_kind: str):
    """Return (source_json, timings, audio_bytes, audio_name) or raise."""
    sj_path = drills_dir / "Source_JSON" / f"{test_id}.json"
    audio_dir = drills_dir / "audio_output" / test_id
    if not sj_path.exists():
        raise FileNotFoundError(f"Source JSON missing: {sj_path}")
    sj = json.loads(sj_path.read_text(encoding="utf-8"))

    timings = None
    tpath = audio_dir / "timings.json"
    if tpath.exists():
        timings = json.loads(tpath.read_text(encoding="utf-8"))

    audio_bytes = None
    audio_name = None
    if timings:
        # section file (S2.mp3, S1.mp3, …) = direct skill audio.
        secs = timings.get("sections") or []
        section_file = secs[0].get("file") if secs else None
        candidate = section_file if audio_kind == "section" else "full_test.mp3"
        mp3 = audio_dir / (candidate or "full_test.mp3")
        if mp3.exists():
            audio_bytes = mp3.read_bytes()
            audio_name = mp3.name
    return sj, timings, audio_bytes, audio_name


def _dup_active(test_id: str) -> dict | None:
    res = (
        supabase_admin.table("listening_tests")
        .select("id,status").eq("test_id", test_id)
        .neq("status", "archived").limit(1).execute()
    )
    return res.data[0] if res.data else None


def _commit_one(test_id: str, res, audio_bytes, status: str) -> dict:
    """Insert one drill (tests + content + exercises) + upload audio. Raises on
    failure after a best-effort rollback."""
    av = listening_audio.validate_section_audio(audio_bytes)
    if av["errors"]:
        raise RuntimeError("; ".join(av["errors"]))

    test_uuid = str(uuid.uuid4())
    storage_path = f"drills/{test_uuid}/full.mp3"
    tm = res.test_metadata
    test_payload = {
        "id":              test_uuid,
        "test_id":         test_id,
        "title":           tm.get("title") or test_id,
        "band_target":     tm.get("band_target"),
        "accent_profile":  list(tm.get("accent_profile") or []),
        "themes":          dict(tm.get("themes") or {}),
        "cue_points":      res.cue_points,
        "audio_assembly_mode": "full_premixed",
        "full_audio_storage_path":     storage_path,
        "full_audio_duration_seconds": av["duration_seconds"],
        "full_audio_size_bytes":       av["size_bytes"],
        "metadata":        tm.get("metadata") or {},
        "status":          status,
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
            print(f"    !! rollback cleanup failed: {exc}", file=sys.stderr)

    try:
        supabase_admin.table("listening_tests").insert(test_payload).execute()
        supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).upload(
            storage_path, audio_bytes,
            {"content-type": "audio/mpeg", "x-upsert": "true"})
        audio_uploaded = True
        content_row = dict(res.content_row)
        content_row["id"] = str(uuid.uuid4())
        content_row["test_id"] = test_uuid
        supabase_admin.table("listening_content").insert(content_row).execute()
        created_content_ids.append(content_row["id"])
        ex_count = 0
        for ex in res.exercise_rows:
            supabase_admin.table("listening_exercises").insert({
                "id":            str(uuid.uuid4()),
                "content_id":    content_row["id"],
                "exercise_type": ex.get("exercise_type", "dictation"),
                "payload":       ex.get("payload", {}),
                "order_num":     ex.get("order_num", 1),
                "cefr_level":    content_row.get("cefr_level"),
                "status":        "draft",
            }).execute()
            ex_count += 1
        return {"id": test_uuid, "exercises": ex_count, "storage_path": storage_path}
    except Exception:
        _rollback()
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description="Bulk-import listening skill drills.")
    ap.add_argument("--drills-dir", type=Path, default=DEFAULT_DRILLS_DIR)
    ap.add_argument("--ids", nargs="*", default=DEFAULT_IDS)
    ap.add_argument("--audio", choices=["section", "full"], default="section")
    ap.add_argument("--commit", action="store_true", help="write to prod (default: dry-run)")
    ap.add_argument("--status", choices=["draft", "published"], default="draft")
    args = ap.parse_args()

    mode = "COMMIT" if args.commit else "DRY-RUN"
    print(f"== Skill-drill import [{mode}] · audio={args.audio} · status={args.status} ==\n")
    print(f"{'test_id':<26} {'type':<10} {'lvl':<4} {'q':>3} {'audio':<12} {'dur':>7}  status")
    print("-" * 86)

    ok = skipped = failed = 0
    for test_id in args.ids:
        try:
            sj, timings, audio_bytes, audio_name = _load_bundle(args.drills_dir, test_id, args.audio)
            res = listening_drill_import.parse_drill(sj, timings)
        except Exception as exc:
            print(f"{test_id:<26} LOAD/PARSE ERROR: {exc}")
            failed += 1
            continue

        md = res.test_metadata.get("metadata") or {}
        dur = res.audio_duration_seconds
        durs = f"{dur:.0f}s" if dur else "—"
        audio_lbl = audio_name or "(none)"
        line = (f"{test_id:<26} {md.get('drill_type',''):<10} {md.get('level',''):<4} "
                f"{res.question_count:>3} {audio_lbl:<12} {durs:>7}  ")

        if res.errors:
            print(line + f"ERRORS: {res.errors}")
            failed += 1
            continue
        if not audio_bytes:
            print(line + "SKIP: no audio (would import draft only — not requested here)")
            skipped += 1
            continue

        dup = _dup_active(test_id)
        if dup:
            print(line + f"SKIP: already ACTIVE (status={dup.get('status')})")
            skipped += 1
            continue

        if res.warnings:
            line += f"[warn: {'; '.join(res.warnings)[:40]}] "

        if not args.commit:
            print(line + "OK (dry-run)")
            ok += 1
            continue

        try:
            out = _commit_one(test_id, res, audio_bytes, args.status)
            print(line + f"IMPORTED id={out['id'][:8]} ex={out['exercises']}")
            ok += 1
        except Exception as exc:
            print(line + f"COMMIT FAILED (rolled back): {exc}")
            failed += 1

    print("-" * 86)
    print(f"ok={ok}  skipped={skipped}  failed={failed}")
    if not args.commit:
        print("\n(dry-run — no writes. Re-run with --commit to import.)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
