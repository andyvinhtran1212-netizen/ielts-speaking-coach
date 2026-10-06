#!/usr/bin/env python3
"""Verify all reviewed GPT PNGs and upload immutable private assets on --commit."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.listening_package_import import PackageValidationError, _ensure_immutable_object
from services.listening_source_figures import figure_catalog


def validated_assets(root: Path) -> list[dict]:
    root = root.resolve(strict=True)
    output = []
    for asset in figure_catalog()["figures"].values():
        path = root / asset["file"]
        if path.parent != root or path.is_symlink() or not path.is_file():
            raise PackageValidationError("Missing reviewed figure")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != asset["sha256"]:
            raise PackageValidationError("Reviewed figure hash mismatch")
        if data[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">II", data[16:24]) != (asset["width"], asset["height"]):
            raise PackageValidationError("Reviewed figure dimensions mismatch")
        output.append({**asset, "path": path})
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--figure-root", required=True)
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    assets = validated_assets(Path(args.figure_root))
    if not args.commit:
        print(json.dumps({"verified_figures": len(assets), "writes": 0}))
        return
    from config import settings
    from database import supabase_admin
    bucket_info = supabase_admin.storage.get_bucket(settings.LISTENING_AUDIO_BUCKET)
    public = bucket_info.get("public") if isinstance(bucket_info, dict) else getattr(bucket_info, "public", None)
    if public is not False:
        raise PackageValidationError("Generated figures require an existing private bucket")
    bucket = supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET)
    counts = {"created": 0, "reused": 0}
    for asset in assets:
        data = asset["path"].read_bytes()
        if hashlib.sha256(data).hexdigest() != asset["sha256"]:
            raise PackageValidationError("Figure changed during upload")
        counts[_ensure_immutable_object(bucket, asset["storage_path"], data, "image/png")] += 1
    print(json.dumps({"verified_figures": len(assets), **counts}))


if __name__ == "__main__":
    main()
