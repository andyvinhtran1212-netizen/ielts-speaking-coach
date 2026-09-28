"""Bulk-import listening skill drills into the explicitly selected Supabase project.

Uses the same drill parser as the admin import route, with the full per-question
explanations from Answer_Keys_Full included in the batch payload.

Audio: uses the SECTION mp3 (e.g. S2.mp3) — the direct skill audio — NOT the
assembled full_test.mp3, matching how a 1-section drill should sound. The
per-question windows in timings.json are section-relative, so they line up with
the section file.

Safety:
  • --dry-run (default) does NO writes — parses + prints a verify table.
  • --commit writes only when --expected-project-ref matches the configured
    Supabase URL. Idempotent: skips a test_id that already has an ACTIVE row.
  • --status defaults to 'draft'. Keep unapproved drills draft until their
    content and audio QA gates have been signed off.

Usage (from backend/, venv with the target environment's .env):
  python scripts/import_skill_drills.py --drills-dir /path/to/11_Skill_Drills_Web --all --dry-run
  python scripts/import_skill_drills.py --drills-dir /path/to/11_Skill_Drills_Web --all \
    --commit --status draft --expected-project-ref PROJECT_REF
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

# Run-from-anywhere: when invoked as `python3 scripts/import_skill_drills.py`,
# Python puts backend/scripts (not backend/) on sys.path, so `import config`
# would fail. Put the backend root first so the app modules resolve whether
# this is run as a file or as `python3 -m scripts.import_skill_drills`.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _script_env import load_env                             # noqa: E402
load_env()                     # .env TRƯỚC mọi import ứng dụng: config/
                               # database dựng client Supabase lúc import.


from config import settings                                    # noqa: E402
from database import supabase_admin                            # noqa: E402
from services import listening_drill_import, listening_audio   # noqa: E402

DEFAULT_DRILLS_DIR = Path(
    "/Users/trantrongvinh/Documents/Co-work/IELTS Listening - Reading/"
    "IELTS_Listening_50_Đề/11_Skill_Drills_Web"
)
DEFAULT_IDS = [
    "ILR-LIS-DRL-FLOW-L1-T1", "ILR-LIS-DRL-FLOW-L1-T2", "ILR-LIS-DRL-FLOW-L1-T3",
    "ILR-LIS-DRL-FORM-L1-T1", "ILR-LIS-DRL-FORM-L1-T2", "ILR-LIS-DRL-FORM-L1-T3",
]


def _load_bundle(drills_dir: Path, test_id: str, audio_kind: str):
    """Return source, timings, audio, rich solution and provenance hashes."""
    sj_path = drills_dir / "Source_JSON" / f"{test_id}.json"
    solution_path = drills_dir / "Answer_Keys_Full" / f"{test_id}_Solution.md"
    audio_dir = drills_dir / "audio_output" / test_id
    if not sj_path.exists():
        raise FileNotFoundError(f"Source JSON missing: {sj_path}")
    if not solution_path.exists():
        raise FileNotFoundError(f"Rich solution missing: {solution_path}")
    source_bytes = sj_path.read_bytes()
    solution_bytes = solution_path.read_bytes()
    sj = json.loads(source_bytes)
    solution_text = solution_bytes.decode("utf-8")
    hashes = {
        "source_json": hashlib.sha256(source_bytes).hexdigest(),
        "solution_md": hashlib.sha256(solution_bytes).hexdigest(),
    }

    timings = None
    tpath = audio_dir / "timings.json"
    if tpath.exists():
        timing_bytes = tpath.read_bytes()
        timings = json.loads(timing_bytes)
        hashes["timings_json"] = hashlib.sha256(timing_bytes).hexdigest()

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
            hashes["audio_mp3"] = hashlib.sha256(audio_bytes).hexdigest()
    return sj, timings, audio_bytes, audio_name, solution_text, hashes


def _dup_active(test_id: str) -> dict | None:
    res = (
        supabase_admin.table("listening_tests")
        .select("id,status,metadata").eq("test_id", test_id)
        .neq("status", "archived").limit(1).execute()
    )
    return res.data[0] if res.data else None


def _commit_one(test_id: str, res, audio_bytes, status: str, hashes: dict) -> dict:
    """Insert one drill (tests + content + exercises) + upload audio. Raises on
    failure after a best-effort rollback."""
    av = listening_audio.validate_section_audio(audio_bytes, test_type="drill")
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
        "metadata":        {**(tm.get("metadata") or {}), "source_hashes": hashes},
        # Mig 157 — test_type là cột thật (CHECK full|mini|drill).
        "test_type":       tm.get("test_type") or "drill",
        "status":          status,
    }
    created_content_ids: list[str] = []
    def _rollback():
        try:
            for cid in created_content_ids:
                supabase_admin.table("listening_exercises").delete().eq("content_id", cid).execute()
            supabase_admin.table("listening_content").delete().eq("test_id", test_uuid).execute()
            supabase_admin.table("listening_tests").delete().eq("id", test_uuid).execute()
        except Exception as exc:  # pragma: no cover
            print(f"    !! rollback cleanup failed: {exc}", file=sys.stderr)
        # A storage upload can succeed server-side yet fail while decoding the
        # response, so remove this unique path even without a success receipt.
        try:
            supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).remove([storage_path])
        except Exception as exc:  # pragma: no cover
            print(f"    !! rollback audio cleanup failed: {exc}", file=sys.stderr)

    try:
        supabase_admin.table("listening_tests").insert(test_payload).execute()
        supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).upload(
            storage_path, audio_bytes,
            {"content-type": "audio/mpeg", "x-upsert": "true"})
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
    ap.add_argument("--all", action="store_true", help="import every Source_JSON/*.json")
    ap.add_argument("--audio", choices=["section", "full"], default="section")
    ap.add_argument("--commit", action="store_true", help="write to the selected project (default: dry-run)")
    ap.add_argument("--expected-project-ref", help="required with --commit; must match SUPABASE_URL")
    # Explicit no-op so the documented `--dry-run` command works. Dry-run is the
    # default (absence of --commit); --dry-run just makes intent explicit and
    # overrides --commit if both are somehow passed.
    ap.add_argument("--dry-run", action="store_true",
                    help="verify only, no writes (default; overrides --commit if both given)")
    ap.add_argument("--status", choices=["draft", "published"], default="draft")
    args = ap.parse_args()
    if args.dry_run:
        args.commit = False
    if args.all:
        args.ids = sorted(p.stem for p in (args.drills_dir / "Source_JSON").glob("*.json"))
        if not args.ids:
            ap.error(f"no Source_JSON/*.json files found under {args.drills_dir}")
    if args.commit:
        actual_ref = (urlsplit(settings.SUPABASE_URL).hostname or "").split(".")[0]
        if not args.expected_project_ref or actual_ref != args.expected_project_ref:
            ap.error("--commit requires --expected-project-ref matching SUPABASE_URL")

    mode = "COMMIT" if args.commit else "DRY-RUN"
    print(f"== Skill-drill import [{mode}] · audio={args.audio} · status={args.status} ==\n")
    print(f"{'test_id':<26} {'type':<10} {'lvl':<4} {'q':>3} {'audio':<12} {'dur':>7}  status")
    print("-" * 86)

    ok = skipped = failed = 0
    for test_id in args.ids:
        try:
            sj, timings, audio_bytes, audio_name, solution_text, hashes = _load_bundle(
                args.drills_dir, test_id, args.audio)
            res = listening_drill_import.parse_drill(sj, timings, solution_text)
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
        av = listening_audio.validate_section_audio(audio_bytes, test_type="drill")
        if av["errors"]:
            print(line + f"ERRORS: {av['errors']}")
            failed += 1
            continue

        dup = _dup_active(test_id)
        if dup:
            saved_hashes = (dup.get("metadata") or {}).get("source_hashes")
            state = "unchanged" if saved_hashes == hashes else "changed/unknown — review before replacing"
            print(line + f"SKIP: already ACTIVE (status={dup.get('status')}; {state})")
            skipped += 1
            continue

        if res.warnings:
            line += f"[warn: {'; '.join(res.warnings)[:40]}] "

        if not args.commit:
            print(line + "OK (dry-run)")
            ok += 1
            continue

        try:
            out = _commit_one(test_id, res, audio_bytes, args.status, hashes)
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
