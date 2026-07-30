"""Convert Kokoro bundle blocks into lesson packs the listening importer accepts.

The bundle stores one block as `<stem>.md` + `<stem>.timing.json` + `<stem>.wav`.
``scripts/import_listening_lessons.py`` wants something else entirely:

    Lessons/<ID>_Question_Paper.md
    Answer_Keys_Full/<ID>_Solution.md
    audio_output/<ID>/timings.json
    audio_output/<ID>/S1.mp3

Each block becomes a ONE-SECTION mini test. That is the honest mapping: a block
is a single audio with N questions, which is exactly what a mini is.

The hard part is not the markdown — it is the per-question replay window. The
bundle has no question→audio mapping at all; it has sentence segments. So for
each question this finds the segment that actually SAYS the answer, matching
digits against spoken forms ("1610" ↔ "sixteen ten") the way IELTS audio really
reads them. A question whose answer cannot be located gets no invented window:
the block is rejected. `parse_fulltest` enforces `audio://` == timings ±0.1s, so
a guessed window would surface later as a broken replay button instead.

Every generated pack is fed back through the REAL importer parser before being
written. A pack that does not parse clean is not emitted — the converter cannot
claim success the importer would refuse.

Read-only w.r.t. the bundle. Writes only under --out.

Usage:
    python3 scripts/convert_kokoro_to_lesson.py --bundle <v2> --audio-dir audio_output_kokoro_v2 \
        --manifest /tmp/manifest_v2.csv --out /tmp/lesson_packs --limit 5
    python3 scripts/convert_kokoro_to_lesson.py --bundle <v2> ... --write
"""
from __future__ import annotations

import argparse
import collections
import csv
import json

import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from services.listening_fulltest_import import parse_fulltest   # noqa: E402

# Corpus taskType -> the importer's explicit qtype marker. An explicit marker is
# used rather than relying on instruction-regex classification, so a reworded
# instruction can never silently reclassify a whole block.
_QTYPE = {
    "note-completion":     "notes_completion",
    "sentence-completion": "sentence_completion",
    "summary-completion":  "summary_completion",
    # A corpus "matching" item carries its own inline options and one letter
    # answer — graded identically to an MCQ. It is emitted as an MCQ rather than
    # the importer's `matching`, which expects a shared A-E bank across items.
    "matching":            "mcq_3option",
    "mcq":                 "mcq_3option",
}
# Needs a diagram the pack format cannot carry; handled by the admin map-upload
# flow, not here. Blocks containing one are reported, never silently dropped.
_UNSUPPORTED = {"map-labelling"}

_ACCENT = {"en-GB": "BrE", "en-US": "AmE", "en-AU": "AusE", "en-NZ": "NzE", "en-CA": "CaE"}

_ONES = ("zero one two three four five six seven eight nine ten eleven twelve thirteen "
         "fourteen fifteen sixteen seventeen eighteen nineteen").split()
_TENS = {20: "twenty", 30: "thirty", 40: "forty", 50: "fifty",
         60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety"}


def norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("-", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


def spoken_forms(n: int) -> set[str]:
    """Spoken renderings of an integer, as IELTS audio actually reads them."""
    out: set[str] = set()
    if n < 20:
        out.add(_ONES[n])
    elif n < 100:
        t, r = (n // 10) * 10, n % 10
        out.add(_TENS[t] if not r else f"{_TENS[t]} {_ONES[r]}")
    elif n < 1000 and n % 100 == 0:
        out.add(f"{_ONES[n // 100]} hundred")
    if 1000 <= n <= 2100:                      # years: "sixteen ten", "nineteen oh five"
        hi, lo = n // 100, n % 100
        if hi < 20:
            if lo == 0:
                out.add(f"{_ONES[hi]} hundred")
            elif lo < 10:
                out.add(f"{_ONES[hi]} oh {_ONES[lo]}")
            elif lo < 20:
                out.add(f"{_ONES[hi]} {_ONES[lo]}")
            else:
                t, r = (lo // 10) * 10, lo % 10
                out.add(f"{_ONES[hi]} {_TENS[t]}" if not r
                        else f"{_ONES[hi]} {_TENS[t]} {_ONES[r]}")
    if n % 1000 == 0 and 0 < n // 1000 < 20:
        out.add(f"{_ONES[n // 1000]} thousand")
    return out


_ORDINALS = {1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth",
             9: "ninth", 12: "twelfth", 20: "twentieth", 30: "thirtieth"}


def _ordinal_word(n: int) -> str | None:
    """Spoken ordinal for a day-of-month ("3" -> "third"). Dates are read as
    ordinals, so the cardinal form alone never matches the transcript."""
    if n in _ORDINALS:
        return _ORDINALS[n]
    if n < 20:
        return _ONES[n] + "th" if n < 20 else None
    tens, unit = (n // 10) * 10, n % 10
    if unit == 0:
        return _TENS.get(tens, "").replace("y", "ieth") or None
    base = _ORDINALS.get(unit) or (_ONES[unit] + "th")
    return f"{_TENS[tens]} {base}"


def answer_variants(ans: str) -> set[str]:
    """Every plausible way the transcript may render this answer."""
    a = norm(ans)
    if not a:
        return set()
    out = {a}
    for m in re.finditer(r"\d+", a):
        d = int(m.group())
        for sp in spoken_forms(d):
            out.add(f"{a[:m.start()]}{sp}{a[m.end():]}".strip())
    digits = [c for c in a if c.isdigit()]
    if len(digits) >= 4:
        # Phone / postcode, read out one character at a time. The transcript may
        # spell them as words ("zero seven nine…") or keep the numerals spaced
        # ("0 7 9 3 8…") — the bundle does the latter, so both are needed.
        chars = [c for c in a if c != " "]
        out.add(" ".join(_ONES[int(c)] if c.isdigit() else c for c in chars))
        out.add(" ".join(chars))
    m = re.match(r"^(\d+)(st|nd|rd|th)? ([a-z]+)$", a)     # "3rd august"
    if m:
        d, month = int(m.group(1)), m.group(3)
        out.add(f"{month} the {d}")
        for sp in spoken_forms(d) | {_ordinal_word(d)} - {None}:
            out.add(f"{month} the {sp}")
            out.add(f"the {sp} of {month}")
    return {re.sub(r"\s+", " ", v).strip() for v in out if v.strip()}


_NEGATIVE_RE = re.compile(r"\bNOT\b|\bEXCEPT\b|\bnever\b", re.UNICODE)


def _match_segment(text: str, norms: list) -> tuple[float, float] | None:
    for v in answer_variants(text):
        for s, ns in norms:
            if v and v in ns:
                return float(s["start"]), float(s["end"])
    return None


def find_window(item: dict, segments: list[dict]) -> tuple[float, float] | None:
    """The segment that actually says this question's answer.

    Tried in order of how directly each signal names the answer. `coreInfo` and
    `answerSentence` are only paraphrases, so they are a last resort and must
    match a decent share of their content words rather than any single one.
    """
    norms = [(s, norm(s.get("text"))) for s in segments]
    options = dict((l, t) for l, t in (item.get("options") or []))

    # An MCQ often carries only `answerLetter`, with `acceptedAnswers` empty —
    # the words that appear in the audio are the correct OPTION's text, so
    # resolve the letter before giving up.
    probes = list(item.get("acceptedAnswers") or [])
    letter = item.get("answerLetter")
    if letter and options.get(letter):
        probes.append(options[letter])
    for ans in probes:
        w = _match_segment(ans, norms)
        if w:
            return w

    # A negative question ("Which method was NOT used?") is answered by what the
    # audio DOESN'T say, so no segment can contain the answer — searching for one
    # is the wrong question. The evidence is the passage that lists the options
    # it DOES mention, so span those.
    q = str(item.get("question") or "")
    if options and _NEGATIVE_RE.search(q):
        wrong = {norm(a) for a in (item.get("acceptedAnswers") or [])}
        if letter and options.get(letter):
            wrong.add(norm(options[letter]))
        spans = [w for l, opt in options.items() if norm(opt) not in wrong
                 for w in [_match_segment(opt, norms)] if w]
        if len(spans) >= 2:
            return min(s for s, _e in spans), max(e for _s, e in spans)

    for key in ("answerSentence", "coreInfo"):
        probe = norm(item.get(key))
        if not probe:
            continue
        toks = [t for t in probe.split() if len(t) > 2]
        if not toks:
            continue
        best, score = None, 0.0
        for s, ns in norms:
            hit = sum(1 for t in toks if t in ns) / len(toks)
            if hit > score:
                best, score = s, hit
        if best is not None and score >= 0.6:
            return float(best["start"]), float(best["end"])
    return None


def make_test_id(stem: str, prefix: str) -> str:
    return f"{prefix}-{re.sub(r'[^A-Za-z0-9]+', '-', stem).strip('-')}"


def _gap_line(n: int, question: str) -> str:
    """One completion question as markdown the importer's extractors read.

    Corpus prompts already carry a `__________` placeholder. A trailing gap
    behind a label becomes a form bullet (which preserves the label as the
    prompt); a gap mid-sentence becomes the inline sentence shape.
    """
    q = (question or "").strip()
    if not q:
        return f"**{n}.** ___________"
    if re.search(r"_{3,}\s*$", q):
        head = re.sub(r"\s*_{3,}\s*$", "", q).rstrip()
        if head.endswith(":"):
            return f"- {head[:-1].strip()}: **{n}** ___________"
        return f"- {head}: **{n}** ___________"
    if re.search(r"_{3,}", q):
        return f"**{n}.** " + re.sub(r"_{3,}", "___________", q, count=1)
    return f"- {q.rstrip(':')}: **{n}** ___________"


def build_pack(stem: str, items: list[dict], timing: dict, prefix: str) -> dict:
    """Render the three text artifacts for one block. Raises ValueError on any
    question whose replay window cannot be located."""
    segments = timing.get("segments") or []
    tid = make_test_id(stem, prefix)
    accent = _ACCENT.get(((items[0].get("audio") or {}).get("accent")), "BrE")
    part = items[0].get("part")
    topic = (items[0].get("topic") or "").strip() or stem

    windows: dict[int, tuple[float, float]] = {}
    for n, it in enumerate(items, 1):
        w = find_window(it, segments)
        if w is None:
            raise ValueError(f"Q{n} ({it.get('id')}): không định vị được đoạn audio chứa đáp án")
        if w[1] <= w[0]:
            raise ValueError(f"Q{n}: cửa sổ audio không hợp lệ {w}")
        windows[n] = w

    # ── Question paper ───────────────────────────────────────────────────────
    qp = [
        f"# IELTS LISTENING — {tid}", "",
        f"**Test title:** {topic}  ",
        "**Target band:** 5.5  ",
        f"**Total questions:** {len(items)}", "",
        "---", "", "## SECTION 1", "",
    ]
    # One heading per run of same-typed questions, so each run can carry its own
    # qtype marker (a block mixing shapes would classify as one and lose the rest).
    runs: list[tuple[str, int, int]] = []
    for n, it in enumerate(items, 1):
        tt = it.get("taskType")
        if runs and runs[-1][0] == tt:
            runs[-1] = (tt, runs[-1][1], n)
        else:
            runs.append((tt, n, n))

    for tt, lo, hi in runs:
        marker = _QTYPE[tt]
        wl = next((items[i - 1].get("wordLimit") for i in range(lo, hi + 1)
                   if items[i - 1].get("wordLimit")), None)
        qp.append(f"### Questions {lo}-{hi}" if hi > lo else f"### Question {lo}")
        qp.append("")
        qp.append(f"<!-- qtype: {marker} -->")
        if marker == "mcq_3option":
            qp.append("> Choose the correct letter.")
        else:
            qp.append("> Complete the notes below.")
            qp.append(f"> Write {wl} for each answer." if wl
                      else "> Write ONE WORD AND/OR A NUMBER for each answer.")
        qp.append("")
        for n in range(lo, hi + 1):
            it = items[n - 1]
            if marker == "mcq_3option":
                qp.append(f"**{n}.** {(it.get('question') or '').strip()}")
                for letter, text in (it.get("options") or []):
                    qp.append(f"   - **{letter}** {text}")
            else:
                qp.append(_gap_line(n, it.get("question")))
            qp.append("")
    qp.append("**END OF QUESTION PAPER**")
    qp.append("")

    # ── Solution ─────────────────────────────────────────────────────────────
    def canonical(it: dict) -> str:
        if it.get("answerLetter"):
            return it["answerLetter"]
        acc = it.get("acceptedAnswers") or []
        return " / ".join(acc) if acc else ""

    sol = [
        f"# IELTS LISTENING — {tid} — Script & Answer Key", "",
        f"**Test title:** {topic}  ",
        "**Target band:** 5.5  ",
        f"**Accent profile:** {accent}", "",
        "## Topic distribution", "",
        "| Section | Chủ đề | Question types |", "|---|---|---|",
        f"| S1 | {topic} | {', '.join(sorted({i.get('taskType') for i in items}))} |", "",
        "## Quick Answer Key", "",
        "| Section 1 |", "|---|",
    ]
    for n, it in enumerate(items, 1):
        sol.append(f"| **{n}.** {canonical(it)} |")
    sol.append("")

    for n, it in enumerate(items, 1):
        st, en = windows[n]
        sol += [
            f"### Q{n}", "",
            f"**Answer:** {canonical(it)}  ",
            f"**Trích đoạn audio:** [nghe lại](audio://S1.mp3?start={st:.2f}&end={en:.2f}&q={n}&section=S1)  ",
        ]
        if it.get("trapPrimary"):
            sol.append(f"**Bẫy:** {it['trapPrimary']}  ")
        if it.get("lesson"):
            sol.append(f"**Kĩ năng:** {it['lesson']}  ")
        sol.append("")

    # Display transcript (v1.2) — one paragraph per segment, so the review pane
    # shows the real reading rather than joined per-question extracts.
    sol += ["# Transcript (bản đọc — chỉ vai thoại, không chú thích sản xuất)", "",
            "## Section 1", ""]
    spk_vi = {"M": "Nam", "F": "Nữ", "T": "Giảng viên", "narrator": "Người dẫn"}
    for s in segments:
        who = spk_vi.get(s.get("speaker") or "narrator", s.get("speaker") or "Người dẫn")
        sol += [f"**{who}:** {s.get('text','').strip()}", ""]

    # Source copy — same turns, carrying (Qn) markers so each question anchors to
    # its display paragraph.
    # Anchor each question to the FIRST segment its window covers — a negative
    # question spans several segments, so an exact start/end match would find
    # none and silently leave that question without a transcript anchor.
    q_by_seg: dict[int, list[int]] = collections.defaultdict(list)
    for n, (st, en) in windows.items():
        for i, s in enumerate(segments):
            if float(s["start"]) >= st - 1e-6 and float(s["end"]) <= en + 1e-6:
                q_by_seg[i].append(n)
                break
    sol += ["# Audio Transcript / Script đầy đủ", "", "### SECTION 1 (S1)", ""]
    for i, s in enumerate(segments):
        who = (s.get("speaker") or "narrator").upper()
        marks = "".join(f" (Q{n})" for n in sorted(q_by_seg.get(i, [])))
        sol += [f"**[{who}]**", f"{s.get('text','').strip()}{marks}", ""]
    sol += ["# Hết", ""]

    # ── timings.json ─────────────────────────────────────────────────────────
    # Offset 0: a mini plays its own section file, so section-relative windows
    # are already absolute and `audio://` matches without arithmetic.
    timings = {
        "test_id": tid,
        "timebase": "seconds",
        "method": "kokoro-segments",
        "full_test": {"file": "full_test.mp3", "section_offsets": {"S1": 0}},
        "sections": [{
            "id": "S1", "file": "S1.mp3",
            "duration": round(float(timing.get("total_seconds") or 0), 2),
            "events": [],
            "turns": [{"idx": i, "speaker": s.get("speaker") or "narrator",
                       "start": round(float(s["start"]), 2),
                       "end": round(float(s["end"]), 2),
                       "questions": sorted(q_by_seg.get(i, []))}
                      for i, s in enumerate(segments)],
            "questions": {str(n): {"start": round(w[0], 2), "end": round(w[1], 2),
                                   "turn": 0, "confidence": "segment"}
                          for n, w in windows.items()},
        }],
    }
    return {"test_id": tid, "qp": "\n".join(qp), "sol": "\n".join(sol),
            "timings": timings, "part": part, "questions": len(items)}


def convert_block(bundle: Path, audio_dir: str, stem: str, byid: dict,
                  prefix: str) -> dict:
    """One block → a validated pack dict, or {'error': …}."""
    md = next(bundle.joinpath(audio_dir).rglob(f"{stem}.md"), None)
    if md is None:
        return {"stem": stem, "error": "không thấy .md"}
    tpath = md.parent / f"{stem}.timing.json"
    if not tpath.exists():
        return {"stem": stem, "error": "không thấy .timing.json"}
    timing = json.loads(tpath.read_text(encoding="utf-8"))
    ids = timing.get("item_ids") or []
    items = [byid[i] for i in ids if i in byid]
    if not items:
        return {"stem": stem, "error": "timing.json không có item_ids khớp corpus"}

    bad = sorted({i.get("taskType") for i in items} & _UNSUPPORTED)
    if bad:
        return {"stem": stem, "error": f"dạng chưa hỗ trợ: {', '.join(bad)} (cần sơ đồ)"}
    unknown = sorted({i.get("taskType") for i in items} - set(_QTYPE))
    if unknown:
        return {"stem": stem, "error": f"taskType lạ: {', '.join(map(str, unknown))}"}
    multi = [i.get("id") for i in items if len(i.get("gaps") or []) > 1]
    if multi:
        return {"stem": stem, "error": f"câu nhiều chỗ trống chưa hỗ trợ: {multi[:3]}"}

    try:
        pack = build_pack(stem, items, timing, prefix)
    except ValueError as e:
        return {"stem": stem, "error": str(e)}

    # The real importer parser is the acceptance test: emit nothing it refuses.
    res = parse_fulltest(pack["qp"], pack["sol"], pack["timings"])
    if res.errors:
        return {"stem": stem, "error": "parse_fulltest: " + " | ".join(res.errors[:3])}
    pack.update(stem=stem, wav=str(md.parent / f"{stem}.wav"),
                warnings=[w for w in res.warnings])
    return pack


def write_pack(pack: dict, out: Path, bitrate: str) -> None:
    lessons = out / "Lessons"
    keys = out / "Answer_Keys_Full"
    adir = out / "audio_output" / pack["test_id"]
    for d in (lessons, keys, adir):
        d.mkdir(parents=True, exist_ok=True)
    tid = pack["test_id"]
    (lessons / f"{tid}_Question_Paper.md").write_text(pack["qp"], encoding="utf-8")
    (keys / f"{tid}_Solution.md").write_text(pack["sol"], encoding="utf-8")
    (adir / "timings.json").write_text(
        json.dumps(pack["timings"], ensure_ascii=False, indent=2), encoding="utf-8")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", pack["wav"], "-b:a", bitrate,
         str(adir / "S1.mp3")], check=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--audio-dir", default="audio_output_kokoro_v2")
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", help="CSV from audit_kokoro_bundle.py")
    ap.add_argument("--verdict", default="UPLOADABLE")
    ap.add_argument("--blocks", help="explicit comma-separated stems")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--bitrate", default="96k")
    ap.add_argument("--write", action="store_true", help="actually write (default: dry-run)")
    args = ap.parse_args()

    bundle = Path(args.bundle)
    items = json.loads((bundle / "corpus_v2.json").read_text(encoding="utf-8"))
    if isinstance(items, dict):
        items = items.get("items", items)
    byid = {i["id"]: i for i in items if i.get("id")}

    if args.blocks:
        stems = [s.strip() for s in args.blocks.split(",") if s.strip()]
    elif args.manifest:
        with open(args.manifest, encoding="utf-8") as fh:
            stems = [r["block"] for r in csv.DictReader(fh)
                     if r["verdict"] == args.verdict]
    else:
        sys.exit("cần --manifest hoặc --blocks")
    if args.limit:
        stems = stems[:args.limit]

    if args.write and not shutil.which("ffmpeg"):
        sys.exit("cần ffmpeg để chuyển wav -> mp3")

    out = Path(args.out)
    ok, failed, warned = [], [], 0
    for stem in stems:
        pack = convert_block(bundle, args.audio_dir, stem, byid, "ILR-LIS-KKR")
        if pack.get("error"):
            failed.append((stem, pack["error"]))
            continue
        warned += 1 if pack.get("warnings") else 0
        if args.write:
            write_pack(pack, out, args.bitrate)
        ok.append(pack)

    print(f"{'GHI' if args.write else 'CHẠY THỬ'} — {len(ok)}/{len(stems)} block chuyển được, "
          f"{sum(p['questions'] for p in ok)} câu")
    if warned:
        print(f"  (có cảnh báo parser: {warned} pack)")
    if failed:
        print(f"\nKHÔNG chuyển được: {len(failed)}")
        by_reason = collections.Counter(
            re.sub(r"\d+", "N", e).split(":")[0] for _s, e in failed)
        for reason, n in by_reason.most_common(8):
            print(f"  {n:5d}  {reason}")
        for s, e in failed[:5]:
            print(f"    - {s}: {e[:110]}")
    if args.write:
        print(f"\nĐã ghi vào {out}")
        print(f"Import: python3 scripts/import_listening_lessons.py --lessons-dir {out} --dry-run")


if __name__ == "__main__":
    main()
