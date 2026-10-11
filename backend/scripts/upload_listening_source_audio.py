#!/usr/bin/env python3
"""Validate all 80 reviewed MP3s, then upload immutable private variants on --commit."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import subprocess
import re
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.listening_package_import import PackageValidationError, _ensure_immutable_object
from services.listening_source_audio import audio_catalog


def validated_assets(audio_root: Path) -> list[dict]:
    root = audio_root.resolve(strict=True)
    catalog = audio_catalog()
    assets = []
    for row in catalog["days"]:
        path = root / f"day-{row['day']:02d}.mp3"
        if path.is_symlink() or not path.is_file():
            raise PackageValidationError(f"Missing audio Day {row['day']}")
        data = path.read_bytes()
        asset = row["kokoro"]
        if hashlib.sha256(data).hexdigest() != asset["sha256"]:
            raise PackageValidationError(f"Reviewed audio hash mismatch Day {row['day']}")
        expected = f"source-collections/{catalog['package_id']}/{catalog['manifest_sha256']}/variants/kokoro-v1/{asset['sha256']}.mp3"
        if asset["storage_path"] != expected:
            raise PackageValidationError("Unexpected audio storage path")
        assets.append({"path": path, **asset})
    return assets


def validated_original_clips(clip_root: Path) -> list[dict]:
    from services.listening_source_question_audio import clip_catalog
    from services.listening_source_native import revision
    from services.listening_source_supplements import catalog as supplements
    root = clip_root.resolve(strict=True)
    content, audio = clip_catalog(), audio_catalog()
    if (content["package_id"], content["manifest_sha256"]) != (audio["package_id"], audio["manifest_sha256"]):
        raise PackageValidationError("Original clip manifest mismatch")
    all_ids = {q["item_id"] for row in revision()["blocks"].values() for q in row["presentation"]["questions"]}
    missing = {row["item_id"] for row in supplements()["questions"] if row["day"] == 77 or (row["day"] == 76 and row["part_id"] not in {"80-days:day-76:part-1", "80-days:day-76:part-2"})}
    if {row["item_id"] for row in content["clips"]} != all_ids - missing or len(content["clips"]) != 1615:
        raise PackageValidationError("Incomplete original question clip coverage")
    assets = {}
    for row in content["clips"]:
        original = audio["days"][row["day"]-1]["original"]
        expected = f"source-collections/{content['package_id']}/{content['manifest_sha256']}/clips/original-v1/{row['sha256']}.mp3"
        if (not original or row["source_sha256"] != original["sha256"] or row["storage_path"] != expected
                or not 0 <= row["start"] < row["end"] <= original["duration_seconds"] + .05
                or not re.fullmatch(r"day-\d{2}-\d+-\d+\.mp3", row["local_file"])):
            raise PackageValidationError("Invalid original clip binding")
        path = root / row["local_file"]
        if path.is_symlink() or not path.is_file(): raise PackageValidationError("Missing original clip")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != row["sha256"] or len(data) != row["size_bytes"]:
            raise PackageValidationError("Original clip hash/size mismatch")
        if expected not in assets:
            duration = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)]))
            if abs(duration-row["duration_seconds"]) > .05 or abs(duration-(row["end"]-row["start"])) > .15:
                raise PackageValidationError("Original clip duration mismatch")
            assets[expected] = {"path": path, **row}
    return list(assets.values())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    roots = parser.add_mutually_exclusive_group(required=True)
    roots.add_argument("--audio-root")
    roots.add_argument("--original-clips-root")
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    assets = validated_original_clips(Path(args.original_clips_root)) if args.original_clips_root else validated_assets(Path(args.audio_root))
    if not args.commit:
        print(json.dumps({"verified_mp3s": len(assets), "writes": 0}))
        return 0
    from config import settings
    from database import supabase_admin
    bucket_info = supabase_admin.storage.get_bucket(settings.LISTENING_AUDIO_BUCKET)
    public = bucket_info.get("public") if isinstance(bucket_info, dict) else getattr(bucket_info, "public", None)
    if public is not False:
        raise PackageValidationError("Audio variants require an existing private bucket")
    bucket = supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET)
    counts = {"created": 0, "reused": 0}
    def upload(asset):
        data = asset["path"].read_bytes()
        if hashlib.sha256(data).hexdigest() != asset["sha256"]:
            raise PackageValidationError("Audio changed during upload")
        return _ensure_immutable_object(bucket, asset["storage_path"], data, "audio/mpeg")
    # A bounded three-worker upload retains the canonical immutable/readback path.
    with ThreadPoolExecutor(max_workers=3 if args.original_clips_root else 1) as pool:
        for index, action in enumerate(pool.map(upload, assets), 1):
            counts[action] += 1
            if args.original_clips_root and index % 25 == 0:
                print(json.dumps({"uploaded": index, "total": len(assets), **counts}), flush=True)
    print(json.dumps({"verified_mp3s": len(assets), **counts}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PackageValidationError as exc:
        print(f"FAIL CLOSED — {exc}", file=sys.stderr)
        raise SystemExit(2)
