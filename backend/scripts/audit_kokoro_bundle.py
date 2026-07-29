"""Gate the `audio_pipeline/v2` Kokoro bundle before any of it is imported.

The bundle ships 978 audio blocks / 12.000 questions, but its own README
records an unfinished step ("844 block mới chưa có audio"). That step was
never completed, so a large slice of the corpus is text with no sound behind
it — `Gen_Contra.md` alone declares 536 questions over a 5.8-second .wav.
Importing by folder would publish those as practice.

This script decides, per block, whether every question in it can actually be
heard, and writes a manifest the importer can be pointed at.

Verdicts
    UPLOADABLE        every question's script is inside the block's transcript,
                      AND the .wav the companion names is present and playable
    PARTIAL           the block has audio, but some questions are not in it
    NO_AUDIO_CONTENT  no question in the block is in its audio
    NO_AUDIO_FILE     no .md companion, or its .wav is missing / empty

Read-only. Touches nothing outside the bundle directory.

Usage:
    python3 scripts/audit_kokoro_bundle.py --bundle <path/to/audio_pipeline/v2>
    python3 scripts/audit_kokoro_bundle.py --bundle <...> --manifest out.csv
    python3 scripts/audit_kokoro_bundle.py --bundle <...> --verdict UPLOADABLE
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import os
import re
import sys
import unicodedata

TRANSCRIPT_RE = re.compile(
    r"## Transcript\n\n<details><summary>.*?</summary>\n\n(.*?)\n\n</details>", re.S)
FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)
QUOTE_RE = re.compile(r'Câu chứa đáp án: \*"(.+?)"\*')

# How many leading words of an item's script must appear verbatim in the
# block transcript for the item to count as audible. Long enough that a
# coincidental match is implausible, short enough to survive the punctuation
# differences between corpus and companion.
_PROBE_WORDS = 8


def norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


def parse_fm(txt: str) -> dict:
    m = FM_RE.match(txt)
    fm: dict[str, str] = {}
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                fm[k.strip()] = v.strip().strip('"')
    return fm


# A .wav smaller than this is a stub, not speech (a header alone is 44 bytes).
_MIN_WAV_BYTES = 2048


def wav_state(md_path: str, fm: dict) -> tuple[str, int]:
    """Is the audio the companion names actually on disk and non-empty?

    The .md is generated from the corpus and exists whether or not the TTS
    step ever ran for that block — so transcript text alone must never be
    taken as proof of audio. Returns (state, bytes) where state is
    "ok" | "missing" | "empty".
    """
    name = (fm.get("audio") or "").strip()
    if not name:
        name = os.path.basename(md_path)[:-3] + ".wav"
    path = os.path.join(os.path.dirname(md_path), name)
    if not os.path.exists(path):
        return "missing", 0
    size = os.path.getsize(path)
    return ("ok" if size >= _MIN_WAV_BYTES else "empty"), size


def load_disk(audio_dir: str) -> dict:
    """block id -> {dir, transcript(normalised), raw, fm, wav_state, wav_bytes}."""
    out = {}
    for dirpath, _, files in os.walk(audio_dir):
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            path = os.path.join(dirpath, f)
            txt = open(path, encoding="utf-8").read()
            m = TRANSCRIPT_RE.search(txt)
            raw = m.group(1) if m else ""
            fm = parse_fm(txt)
            state, size = wav_state(path, fm)
            out[f[:-3]] = {
                "dir": os.path.relpath(dirpath, audio_dir),
                "path": path,
                "transcript": norm(raw),
                "raw_transcript": raw,
                "fm": fm,
                "quotes": QUOTE_RE.findall(txt),
                "wav_state": state,
                "wav_bytes": size,
            }
    return out


def item_scripts(item: dict) -> str:
    parts = [item.get("script") or ""]
    parts += [(t.get("text") if isinstance(t, dict) else str(t))
              for t in (item.get("dialogueTurns") or [])]
    return norm(" ".join(p for p in parts if p))


def audit(bundle: str) -> list[dict]:
    audio_dir = os.path.join(bundle, "audio_output_kokoro")
    corpus_path = os.path.join(bundle, "corpus_v2.json")
    for p in (audio_dir, corpus_path):
        if not os.path.exists(p):
            sys.exit(f"not found: {p}")

    items = json.load(open(corpus_path, encoding="utf-8"))
    if isinstance(items, dict):
        items = items.get("items", items)
    disk = load_disk(audio_dir)

    by_block = collections.defaultdict(list)
    for it in items:
        by_block[it.get("subsection")].append(it)

    rows = []
    for block, its in sorted(by_block.items()):
        d = disk.get(block)
        if not d or d["wav_state"] != "ok":
            # No companion at all, or one whose .wav was never rendered. A
            # transcript with no file behind it is text, not a listening
            # exercise — it must never reach UPLOADABLE.
            rows.append({"block": block, "batch": d["dir"].split(os.sep)[0] if d else "?",
                         "verdict": "NO_AUDIO_FILE",
                         "questions": len(its), "unheard": len(its), "seconds": 0,
                         "sec_per_q": 0, "part": "", "tasks": "", "image": "",
                         "image_ok": "", "quotes_verbatim": "",
                         "wav": (d["wav_state"] if d else "no_companion")})
            continue

        unheard = 0
        for it in its:
            toks = item_scripts(it).split()
            if not toks or " ".join(toks[:_PROBE_WORDS]) not in d["transcript"]:
                unheard += 1

        try:
            secs = float(d["fm"].get("audio_seconds") or 0)
        except ValueError:
            secs = 0.0

        image = d["fm"].get("image", "")
        image_ok = ""
        if image:
            p = os.path.normpath(os.path.join(os.path.dirname(d["path"]), image))
            image_ok = "yes" if os.path.exists(p) else "MISSING"

        quotes = d["quotes"]
        verbatim = sum(1 for q in quotes if q and q in d["raw_transcript"])

        rows.append({
            "block": block,
            "batch": d["dir"].split(os.sep)[0],
            "verdict": ("UPLOADABLE" if unheard == 0 else
                        "PARTIAL" if unheard < len(its) else "NO_AUDIO_CONTENT"),
            "questions": len(its),
            "unheard": unheard,
            "seconds": round(secs, 1),
            "sec_per_q": round(secs / len(its), 1) if its else 0,
            "part": d["fm"].get("part", ""),
            "tasks": d["fm"].get("task_types", ""),
            "image": image,
            "image_ok": image_ok,
            "quotes_verbatim": f"{verbatim}/{len(quotes)}" if quotes else "",
            "wav": d["wav_state"],
        })
    return rows


def report(rows: list[dict], min_sec_per_q: float) -> None:
    tot_q = sum(r["questions"] for r in rows)
    print(f"blocks {len(rows)}   questions {tot_q}   "
          f"audio {sum(r['seconds'] for r in rows) / 3600:.1f} h\n")

    for verdict in ("UPLOADABLE", "PARTIAL", "NO_AUDIO_CONTENT", "NO_AUDIO_FILE"):
        sub = [r for r in rows if r["verdict"] == verdict]
        if not sub:
            continue
        print(f"{verdict:18s} {len(sub):4d} blocks  {sum(r['questions'] for r in sub):6d} q"
              f"  ({sum(r['unheard'] for r in sub)} unheard)")
        by_batch = collections.Counter(r["batch"] for r in sub)
        print(f"{'':18s} {dict(by_batch.most_common(8))}")

    up = [r for r in rows if r["verdict"] == "UPLOADABLE"]
    if up:
        pace = sorted(r["sec_per_q"] for r in up if r["questions"])
        print(f"\npacing across UPLOADABLE — median {pace[len(pace) // 2]:.1f} s/question "
              f"(a real IELTS section runs ~30)")
        slow = [r for r in up if r["sec_per_q"] >= min_sec_per_q]
        print(f"blocks at >= {min_sec_per_q} s/question: {len(slow)} / {len(up)}")

    no_wav = [r for r in rows if r.get("wav") in ("missing", "empty", "no_companion")]
    if no_wav:
        print(f"\nblocks with no playable .wav: {len(no_wav)} "
              f"({sum(r['questions'] for r in no_wav)} questions) — "
              f"{[r['block'] for r in no_wav][:6]}")

    bad_img = [r for r in rows if r["image_ok"] == "MISSING"]
    if bad_img:
        print(f"\nbroken image refs: {len(bad_img)} — {[r['block'] for r in bad_img][:5]}")
    map_no_img = [r for r in rows if "map" in str(r["tasks"]).lower() and not r["image"]]
    if map_no_img:
        print(f"map-labelling blocks with NO diagram: {len(map_no_img)} — "
              f"{[r['block'] for r in map_no_img][:6]}")

    # "Câu chứa đáp án" is presented to the learner as the sentence the answer
    # came from. Where it is a paraphrase it is mislabelled, and where the
    # information is absent from the audio it is simply untrue.
    with_q = [r for r in rows if r["quotes_verbatim"]]
    if with_q:
        exact = sum(1 for r in with_q if r["quotes_verbatim"].split("/")[0]
                    == r["quotes_verbatim"].split("/")[1])
        print(f"\nblocks whose \"Câu chứa đáp án\" lines are all verbatim: "
              f"{exact} / {len(with_q)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", required=True,
                    help="path to audio_pipeline/v2 (holds corpus_v2.json + audio_output_kokoro/)")
    ap.add_argument("--manifest", help="write the per-block verdict table to this CSV")
    ap.add_argument("--verdict", help="print only block ids with this verdict")
    ap.add_argument("--min-sec-per-q", type=float, default=15.0,
                    help="pacing floor used in the summary (default 15)")
    args = ap.parse_args()

    rows = audit(args.bundle)

    if args.verdict:
        for r in rows:
            if r["verdict"] == args.verdict:
                print(r["block"])
        return

    report(rows, args.min_sec_per_q)

    if args.manifest:
        with open(args.manifest, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(sorted(rows, key=lambda r: (r["verdict"], r["batch"], r["block"])))
        print(f"\nwrote {args.manifest}")


if __name__ == "__main__":
    main()
