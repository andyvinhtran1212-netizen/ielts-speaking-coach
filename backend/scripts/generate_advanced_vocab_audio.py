#!/usr/bin/env python3
"""Generate a local Kokoro bundle for all core-30 vocab headwords/examples."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from services.advanced_vocab_audio_builder import (  # noqa: E402
    DEFAULT_VOICE,
    generate_vocab_audio_bundle,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Canonical Vocab course root")
    parser.add_argument("output", help="New audio bundle directory; must not exist")
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    args = parser.parse_args()

    def report(done: int, total: int, text: str) -> None:
        if done == 1 or done % 25 == 0 or done == total:
            print(f"[{done}/{total}] {text[:72]}", flush=True)

    output = generate_vocab_audio_bundle(
        args.source, args.output, voice=args.voice, progress=report
    )
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    print(json.dumps({
        "output": str(output),
        "engine": manifest["engine"],
        "voice": manifest["voice"],
        "card_count": manifest["card_count"],
        "clip_count": manifest["clip_count"],
        "bundle_checksum": manifest["bundle_checksum"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
