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
    NO_AUDIO_FILE     the .wav is missing, undecodable, truncated, silent, or a
                      different length than the companion advertises
    NOT_RENDERED      corpus questions that no audio file claims at all
    ORPHAN_AUDIO      an audio file whose questions are not in the corpus

One audio file = one exercise. A block may be split across several files
(`Gen_Contra` -> `Gen_Contra_p01`..`_p05`); `item_ids` in timing.json says which
questions each file serves.

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
import wave

TRANSCRIPT_RE = re.compile(
    r"## Transcript\n\n<details><summary>.*?</summary>\n\n(.*?)\n\n</details>", re.S)
FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)
QUOTE_RE = re.compile(r'Câu chứa đáp án: \*"(.+?)"\*')

# How many leading words of an item's script must appear verbatim in the
# block transcript for the item to count as audible. Long enough that a
# coincidental match is implausible, short enough to survive the punctuation
# differences between corpus and companion.
_PROBE_WORDS = 8


# A dialogue transcript interleaves speaker labels: "**Nữ:** …  **Nam:** …".
# They must come out BEFORE normalising, or a probe that spans two turns is
# broken by a label that is not part of the speech. Left in, `Gen_FormVenue`
# (whose first turn is only five words long) read as NO_AUDIO_CONTENT across
# all 90 blocks while its audio was in fact correct.
_SPEAKER_LABEL_RE = re.compile(r"\*\*[^*\n]{1,24}:\*\*")


def norm(s) -> str:
    s = _SPEAKER_LABEL_RE.sub(" ", str(s or ""))
    s = unicodedata.normalize("NFKD", s)
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


# Shorter than this and there is nothing to listen to, whatever the header says.
_MIN_WAV_SECONDS = 0.5
# How far the real duration may drift from the companion's `audio_seconds`
# before the pair is untrustworthy (dictation windows are cut from that number).
_DURATION_TOLERANCE = 1.5
# Payload is read in chunks so a long file never has to fit in memory at once.
_READ_CHUNK_FRAMES = 65_536


def wav_state(md_path: str, fm: dict) -> tuple[str, float]:
    """Is the audio the companion names on disk, decodable, audible, and the
    length it claims?

    Three things are deliberately NOT trusted here, because each has been a
    real failure mode of an interrupted render:

      * the .md itself — it is generated from the corpus whether or not the
        TTS step ever ran, so transcript text is never proof of audio;
      * byte size — a large file can be undecodable junk;
      * the RIFF header — ``getnframes()`` reports the data-chunk size the
        header *advertises*. A file truncated mid-write still advertises the
        full length, so the header alone would pass a truncated stub.

    So the payload is actually read, in chunks. The returned duration is
    computed from the frames that could really be read, and that number — not
    the header's — is compared with the companion's ``audio_seconds`` (the
    dictation windows are cut from it; a mismatch makes every seek land in the
    wrong place even when the file plays). An all-zero payload is silence, not
    speech, and is rejected too.

    Returns (state, seconds); state is one of
    "ok" | "missing" | "unreadable" | "empty" | "truncated" | "silent"
    | "duration_mismatch".
    """
    name = (fm.get("audio") or "").strip()
    if not name:
        name = os.path.basename(md_path)[:-3] + ".wav"
    path = os.path.join(os.path.dirname(md_path), name)
    if not os.path.isfile(path):
        return "missing", 0.0

    try:
        with wave.open(path) as w:
            rate = w.getframerate()
            declared_frames = w.getnframes()
            frame_bytes = max(1, w.getnchannels() * w.getsampwidth())
            if not rate or declared_frames <= 0:
                return "empty", 0.0

            read_frames, has_signal = 0, False
            while True:
                chunk = w.readframes(_READ_CHUNK_FRAMES)
                if not chunk:
                    break
                read_frames += len(chunk) // frame_bytes
                if not has_signal and any(chunk):
                    has_signal = True
    except (wave.Error, EOFError, OSError):
        return "unreadable", 0.0

    seconds = read_frames / float(rate)
    if read_frames <= 0 or seconds < _MIN_WAV_SECONDS:
        return "empty", seconds
    # Header promised more audio than the file actually holds.
    if (declared_frames - read_frames) / float(rate) > _DURATION_TOLERANCE:
        return "truncated", seconds
    if not has_signal:
        return "silent", seconds

    try:
        advertised = float(fm.get("audio_seconds") or 0)
    except ValueError:
        advertised = 0.0
    if advertised and abs(advertised - seconds) > _DURATION_TOLERANCE:
        return "duration_mismatch", seconds
    return "ok", seconds


def load_disk(audio_dir: str) -> dict:
    """block id -> {dir, transcript(normalised), raw, fm, wav_state, wav_seconds}."""
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
            state, secs = wav_state(path, fm)
            stem = f[:-3]
            # `item_ids` says which corpus questions THIS audio file serves.
            # Needed since a block can be split across several files
            # (`Gen_Contra` -> `Gen_Contra_p01`..`_p05`), so the file name is
            # no longer a `subsection`. Absent on pre-split bundles.
            ids = []
            tpath = os.path.join(dirpath, stem + ".timing.json")
            if os.path.exists(tpath):
                try:
                    ids = json.load(open(tpath, encoding="utf-8")).get("item_ids") or []
                except Exception:
                    ids = []
            out[stem] = {
                "dir": os.path.relpath(dirpath, audio_dir),
                "path": path,
                "transcript": norm(raw),
                "raw_transcript": raw,
                "fm": fm,
                "quotes": QUOTE_RE.findall(txt),
                "wav_state": state,
                "wav_seconds": secs,
                "item_ids": ids,
            }
    return out


def item_spans(item: dict) -> list[str]:
    """This item's spoken parts, kept SEPARATE — monologue script and each
    dialogue turn on its own.

    They used to be concatenated and probed by their first eight words. A block
    whose audio carried the shared opening but dropped later answer-bearing
    turns then passed as UPLOADABLE, so the gate approved questions a learner
    cannot hear — the exact failure it exists to catch. Every span must be
    present independently.
    """
    out = [item.get("script") or ""]
    out += [(t.get("text") if isinstance(t, dict) else str(t))
            for t in (item.get("dialogueTurns") or [])]
    return [norm(p) for p in out if norm(p)]


def span_is_audible(span: str, transcript: str) -> bool:
    """Is this one spoken span in the transcript?

    Long spans are probed by their opening words (a sentence split differently
    between corpus and render would otherwise read as missing); short ones must
    appear whole, since a few words are not distinctive enough to sample.
    """
    toks = span.split()
    if not toks:
        return True
    probe = " ".join(toks[:_PROBE_WORDS]) if len(toks) > _PROBE_WORDS else span
    return probe in transcript


def item_is_audible(item: dict, transcript: str) -> bool:
    spans = item_spans(item)
    return bool(spans) and all(span_is_audible(s, transcript) for s in spans)


def audit(bundle: str, audio_subdir: str = "audio_output_kokoro") -> list[dict]:
    audio_dir = os.path.join(bundle, audio_subdir)
    corpus_path = os.path.join(bundle, "corpus_v2.json")
    for p in (audio_dir, corpus_path):
        if not os.path.exists(p):
            sys.exit(f"not found: {p}")

    items = json.load(open(corpus_path, encoding="utf-8"))
    if isinstance(items, dict):
        items = items.get("items", items)
    disk = load_disk(audio_dir)

    by_block = collections.defaultdict(list)
    byid = {}
    for it in items:
        by_block[it.get("subsection")].append(it)
        if it.get("id"):
            byid[it["id"]] = it

    # Walk the AUDIO FILES, not the corpus: one file = one exercise. A block may
    # now be split across several files, so a corpus-first walk would look for a
    # `Gen_Contra.wav` that does not exist and never see the five that do.
    rows = []
    covered = set()
    for block, d in sorted(disk.items()):
        its = [byid[i] for i in d["item_ids"] if i in byid]
        if not its:
            its = by_block.get(block) or []          # bundle without item_ids
        if not its:
            rows.append({"block": block, "batch": d["dir"].split(os.sep)[0],
                         "verdict": "ORPHAN_AUDIO", "questions": 0, "unheard": 0,
                         "seconds": round(d["wav_seconds"], 1), "sec_per_q": 0,
                         "part": "", "tasks": "", "image": "", "image_ok": "",
                         "quotes_verbatim": "", "wav": d["wav_state"]})
            continue
        covered.update(o["id"] for o in its if o.get("id"))

        if d["wav_state"] != "ok":
            # A transcript with no playable file behind it is text, not a
            # listening exercise — it must never reach UPLOADABLE.
            rows.append({"block": block, "batch": d["dir"].split(os.sep)[0],
                         "verdict": "NO_AUDIO_FILE",
                         "questions": len(its), "unheard": len(its), "seconds": 0,
                         "sec_per_q": 0, "part": "", "tasks": "", "image": "",
                         "image_ok": "", "quotes_verbatim": "",
                         "wav": d["wav_state"]})
            continue

        unheard = sum(1 for it in its if not item_is_audible(it, d["transcript"]))

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
        # Compare sentence-for-sentence after normalising, not byte-for-byte:
        # the companion drops a comma ("…the training apart from…" vs
        # "…the training, apart from…") and a raw substring test would call a
        # genuinely verbatim quote a mislabel.
        sentences = {norm(x) for x in re.split(r"(?<=[.!?])\s+", d["raw_transcript"])}
        sentences.discard("")
        verbatim = sum(1 for q in quotes if q and norm(q) in sentences)

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

    # Questions no audio file claims. On a full render this means a block was
    # skipped; with `--max-parts` it is the deliberately un-rendered tail. Either
    # way they are reported, never silently dropped — a shorter corpus that
    # looks 100% clean is exactly how truncation hides.
    missing = collections.defaultdict(list)
    for it in items:
        if it.get("id") and it["id"] not in covered:
            missing[it.get("subsection")].append(it)
    for block, its in sorted(missing.items()):
        rows.append({"block": block, "batch": (its[0].get("section") or "?"),
                     "verdict": "NOT_RENDERED", "questions": len(its),
                     "unheard": len(its), "seconds": 0, "sec_per_q": 0,
                     "part": "", "tasks": "", "image": "", "image_ok": "",
                     "quotes_verbatim": "", "wav": "no_file"})
    return rows


def report(rows: list[dict], min_sec_per_q: float) -> None:
    tot_q = sum(r["questions"] for r in rows)
    print(f"blocks {len(rows)}   questions {tot_q}   "
          f"audio {sum(r['seconds'] for r in rows) / 3600:.1f} h\n")

    for verdict in ("UPLOADABLE", "PARTIAL", "NO_AUDIO_CONTENT", "NO_AUDIO_FILE",
                    "NOT_RENDERED", "ORPHAN_AUDIO"):
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

    bad_wav = [r for r in rows if r.get("wav") and r["wav"] != "ok"]
    if bad_wav:
        print(f"\nblocks with no playable .wav: {len(bad_wav)} "
              f"({sum(r['questions'] for r in bad_wav)} questions)")
        for state, n in collections.Counter(r["wav"] for r in bad_wav).most_common():
            sample = [r["block"] for r in bad_wav if r["wav"] == state][:4]
            print(f"    {state:18s} {n:4d}  {sample}")

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
                    help="path to audio_pipeline/v2 (holds corpus_v2.json + the audio dir)")
    ap.add_argument("--audio-dir", default="audio_output_kokoro",
                    help="audio directory inside the bundle (default audio_output_kokoro)")
    ap.add_argument("--manifest", help="write the per-block verdict table to this CSV")
    ap.add_argument("--verdict", help="print only block ids with this verdict")
    ap.add_argument("--min-sec-per-q", type=float, default=15.0,
                    help="pacing floor used in the summary (default 15)")
    args = ap.parse_args()

    rows = audit(args.bundle, args.audio_dir)

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
