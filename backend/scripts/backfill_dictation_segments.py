"""Backfill per-turn timed dictation segments for an already-imported test.

Test-linked dictation ("chép chính tả") plays a test's audio. Without
per-sentence timing it can only free-scrub the whole section — so the
narrator intro plays before the first dialogue and nothing auto-clips.

This script reads the test's original ``timings.json`` (whose ``turns[]``
carry per-turn start/end, aligned 1:1 with the stored transcript's speaker
turns) and writes ``metadata.dictation_segments`` onto each section's
``listening_content`` row:

    [{"idx": 0, "start": 48.24, "end": 56.22, "text": "Good afternoon..."}, ...]

The boot + grade endpoints then serve these with audio windows so the
player auto-clips (and auto-loops) each unit. Turns start AFTER the
preread, so the intro is skipped for free. No audio is re-uploaded and
the test row is untouched — only section metadata is merged.

Usage:
    cd backend
    python -m scripts.backfill_dictation_segments \
        --test-id <db-uuid> --timings /path/to/timings.json [--dry-run]

Falls back to free-scrub for any section whose turn count does not match
the transcript (reported, never silently guessed).
"""
from __future__ import annotations

import argparse
import json
import sys

from database import supabase_admin
from services.listening_grader import split_turns


def _section_turns(timings: dict) -> dict[int, list[dict]]:
    """timings.json → {section_num: [{start, end}, ...]} (section-relative)."""
    out: dict[int, list[dict]] = {}
    for sec in (timings.get("sections") or []):
        sid = str(sec.get("id") or "")
        digits = "".join(ch for ch in sid if ch.isdigit())
        if not digits:
            continue
        turns = [
            {"start": float(t["start"]), "end": float(t["end"])}
            for t in (sec.get("turns") or [])
            if t.get("start") is not None and t.get("end") is not None
        ]
        out[int(digits)] = turns
    return out


def _section_offsets(timings: dict) -> dict[str, float]:
    return (timings.get("full_test") or {}).get("section_offsets") or {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test-id", required=True, help="listening_tests.id (uuid)")
    ap.add_argument("--timings", required=True, help="path to the test's timings.json")
    ap.add_argument("--dry-run", action="store_true", help="preview, do not write")
    args = ap.parse_args()

    with open(args.timings, encoding="utf-8") as fh:
        timings = json.load(fh)

    turns_by_section = _section_turns(timings)
    offsets = _section_offsets(timings)
    if not any(turns_by_section.values()):
        print("ERROR: timings.json has no turns[] — cannot build per-turn "
              "segments. (This test likely needs Whisper alignment instead.)")
        return 2

    secs = (supabase_admin.table("listening_content")
            .select("id,section_num,transcript,metadata")
            .eq("test_id", args.test_id)
            .order("section_num").execute())
    if not secs.data:
        print(f"ERROR: no sections found for test_id={args.test_id}")
        return 2

    total_written = 0
    for s in secs.data:
        n = s.get("section_num")
        sid = f"S{n}"
        offset = float(offsets.get(sid, 0) or 0)
        turn_texts = split_turns(s.get("transcript") or "")
        turn_times = turns_by_section.get(n, [])

        if not turn_texts:
            print(f"S{n}: transcript empty — skipped")
            continue
        if len(turn_texts) != len(turn_times):
            print(f"S{n}: MISMATCH transcript_turns={len(turn_texts)} "
                  f"timings_turns={len(turn_times)} — skipped (stays free-scrub)")
            continue

        segments = [
            {"idx": i,
             "start": round(tt["start"] + offset, 2),
             "end":   round(tt["end"] + offset, 2),
             "text":  txt}
            for i, (txt, tt) in enumerate(zip(turn_texts, turn_times))
        ]
        print(f"S{n}: {len(segments)} timed segments (offset={offset}); "
              f"e.g. [{segments[0]['start']}–{segments[0]['end']}] "
              f"{segments[0]['text'][:60]!r}")

        if args.dry_run:
            continue

        meta = dict(s.get("metadata") or {})
        meta["dictation_segments"] = segments
        supabase_admin.table("listening_content").update(
            {"metadata": meta}).eq("id", s["id"]).execute()
        total_written += len(segments)

    if args.dry_run:
        print("\n(dry-run — nothing written)")
    else:
        print(f"\nDONE — wrote timed segments to {total_written} turns.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
