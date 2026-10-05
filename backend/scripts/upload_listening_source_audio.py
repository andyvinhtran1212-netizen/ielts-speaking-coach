#!/usr/bin/env python3
"""Validate all 80 reviewed MP3s, then upload immutable private variants on --commit."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio-root", required=True)
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    assets = validated_assets(Path(args.audio_root))
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
    for asset in assets:
        data = asset["path"].read_bytes()
        if hashlib.sha256(data).hexdigest() != asset["sha256"]:
            raise PackageValidationError("Audio changed during upload")
        counts[_ensure_immutable_object(bucket, asset["storage_path"], data, "audio/mpeg")] += 1
    print(json.dumps({"verified_mp3s": len(assets), **counts}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PackageValidationError as exc:
        print(f"FAIL CLOSED — {exc}", file=sys.stderr)
        raise SystemExit(2)
