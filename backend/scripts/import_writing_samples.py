"""Validate the 549 Writing sample sets for the public Library (G06-T03).

Only ``--check`` exists in this version. It reads the source sets (the
``incoming/`` folder of the separate ``ielts-pipeline`` project) and the
manifest kept in this repository, and reports every set that would be blocked
from publishing. It needs no database and writes nothing, except the manifest
when ``--write-hashes`` is given and a CSV when ``--band-csv`` is given.

The staging dry run and ``--execute`` modes need the Library tables of
LIBRARY-0061 (G06-T02) and are refused until that spec is approved and the
migration exists.

Inputs
------
``--source``    folder holding ``<stem>.json`` + ``<stem>.mark.json``; its
                ``_archive/`` subfolder is ignored. Required: the path is on
                the content owner's machine and is never hard-coded.
``--manifest``  ``backend/content/library/writing-samples-manifest.json``: a
                JSON list of ``{source_key, slug, title_en, topic_slug,
                publish, review:{status, by, at, note}, content_hash,
                overrides}``. A missing file means "no decisions yet".
``--topics``    ``backend/content/library/topics.json``: a JSON list of
                ``{slug, label_vi}``. A missing file means "no topics yet".
``--figures``   folder of Task 1 figures (``sources/task1_figures``). When
                omitted, ``prompt.image_path`` is resolved against the source
                folder and its parent.

``overrides`` (G06-T19) lets reviewed additions live in this repository
without editing the source project:
``{"image_path": "<path relative to the manifest folder>",
   "justification_jumps": {"LR": [{"pair": "6.0->7.0", "changes": [...]}]}}``.

Codes (one line per set, totals at the end; ``E_*`` blocks publishing):
E_PARSE, E_MARK, E_NO_REVIEW, E_NO_TITLE, E_SLUG, E_TYPE, E_TOPIC, E_FIGURE,
E_PAIR, E_ESSAYS, E_BAND_FAR, W_HASH (blocks until re-reviewed),
W_BAND_NEAR, W_DELTA_MATCH.

The script never writes to the source project and never calls AI.

Usage
-----
    cd backend
    python -m scripts.import_writing_samples --check --source "<incoming>" \\
        [--figures "<sources/task1_figures>"] [--band-csv /tmp/band-near.csv]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any, Optional

LIBRARY_DIR = Path(__file__).resolve().parent.parent / "content" / "library"
DEFAULT_MANIFEST = LIBRARY_DIR / "writing-samples-manifest.json"
DEFAULT_TOPICS = LIBRARY_DIR / "topics.json"

BANDS = ("7.5", "7.0", "6.0")
CRITERIA = ("TR", "CC", "LR", "GRA")
REQUIRED_PAIRS = ("6.0->7.0", "7.0->7.5")
QUESTION_TYPES = ("opinion", "discussion", "problem_solution",
                  "advantages_disadvantages", "two_part", "positive_negative")
TASK1_SUBTYPES = ("bar", "line", "pie", "table", "process", "map", "mixed")
REVIEW_STATUSES = ("approved", "needs_review", "excluded")
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SLUG_MAX = 80
TITLE_MIN, TITLE_MAX = 3, 70
FIGURE_MAX_BYTES = 2 * 1024 * 1024  # library-public bucket limit (LIBRARY-0061 §5.5)

BLOCKING = ("E_PARSE", "E_MARK", "E_NO_REVIEW", "E_NO_TITLE", "E_SLUG", "E_TYPE",
            "E_TOPIC", "E_FIGURE", "E_PAIR", "E_ESSAYS", "E_BAND_FAR", "W_HASH")
WARNINGS = ("W_BAND_NEAR", "W_DELTA_MATCH")
ALL_CODES = BLOCKING + WARNINGS

# (delta list, band holding ``before``, band holding ``after``)
DELTA_SIDES = (("delta_75_70", "7.5", "7.0"), ("delta_70_60", "7.0", "6.0"))
_QUOTES = str.maketrans({"‘": "'", "’": "'", "‚": "'", "′": "'",
                         "“": '"', "”": '"', "„": '"', "″": '"'})


# ── pure helpers ─────────────────────────────────────────────────────────────

def ielts_round(x: Fraction | float) -> float:
    """Same rule as ``backend/services/band_rounding.py`` (and the source
    project's ``ielts/marking.py``): nearest 0.5, half rounds up."""
    return math.floor(Fraction(x) * 2 + Fraction(1, 2)) / 2


def normalise_text(s: str) -> str:
    """NFC, one quote style, single spaces — for matching delta excerpts."""
    s = unicodedata.normalize("NFC", s or "").translate(_QUOTES)
    return re.sub(r"\s+", " ", s).strip()


def has_vietnamese_marks(s: str) -> bool:
    if "đ" in s.lower():
        return True
    return any(unicodedata.combining(ch) for ch in unicodedata.normalize("NFD", s)
               if not ch.isascii())


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def task_type_of(prompt: dict) -> Optional[str]:
    task = prompt.get("task")
    if task in (None, "", "task2"):
        return "task2"
    if task == "task1_academic":
        return "task1_academic"
    return None


def imported_view(source: dict) -> dict:
    """The exact source fields the importer copies; ``content_hash`` covers them.

    Internal notes (``domain``, ``difficulty_notes``, ``integrity_check``,
    ``ideas_used``, the ``.mark.json`` file) are not imported.
    """
    prompt = source.get("prompt") or {}
    essays = source.get("essays") or {}
    view = {
        "prompt": {k: prompt.get(k) for k in ("text", "task", "subtype", "question_type")},
        "essays": {b: {k: (essays.get(b) or {}).get(k)
                       for k in ("text", "word_count", "outline", "vocab_table", "structures")}
                   for b in BANDS},
        "delta_75_70": source.get("delta_75_70"),
        "delta_70_60": source.get("delta_70_60"),
        "justification": {"by_criterion": (source.get("justification") or {}).get("by_criterion")},
    }
    if task_type_of(prompt) == "task1_academic":
        view["task1_data"] = source.get("data")
    return view


def content_hash(source: dict) -> str:
    return hashlib.sha256(canonical_json(imported_view(source)).encode("utf-8")).hexdigest()


def _is_figure(data: bytes) -> bool:
    return data.startswith(b"\x89PNG\r\n\x1a\n") or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")


# ── loading ──────────────────────────────────────────────────────────────────

@dataclass
class SourceSet:
    key: str
    path: Path
    data: Optional[dict] = None
    mark: Optional[dict] = None
    parse_error: Optional[str] = None
    mark_error: Optional[str] = None


def load_sources(source_dir: Path) -> list[SourceSet]:
    sets = []
    for path in sorted(source_dir.glob("*.json")):
        if path.name.endswith(".mark.json"):
            continue
        item = SourceSet(key=path.stem, path=path)
        try:
            item.data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(item.data, dict):
                raise ValueError("top level is not an object")
        except (OSError, ValueError) as exc:
            item.data, item.parse_error = None, str(exc)
        mark_path = path.with_name(f"{path.stem}.mark.json")
        try:
            item.mark = json.loads(mark_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            item.mark_error = "missing .mark.json"
        except (OSError, ValueError) as exc:
            item.mark_error = str(exc)
        sets.append(item)
    return sets


def load_json_list(path: Path, what: str) -> list[dict]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not all(isinstance(x, dict) for x in data):
        raise SystemExit(f"{what} {path} must be a JSON list of objects")
    return data


# ── checks ───────────────────────────────────────────────────────────────────

@dataclass
class SetResult:
    key: str
    codes: dict[str, str] = field(default_factory=dict)  # code → one-line detail
    publish: bool = False
    band_near: list[tuple[str, float]] = field(default_factory=list)
    hash: Optional[str] = None

    @property
    def blocked(self) -> bool:
        return any(c in BLOCKING for c in self.codes)


def _figure_candidates(rel: str, source_dir: Path, figures: Optional[Path]) -> list[Path]:
    p = Path(rel)
    if p.is_absolute():
        return [p]
    if figures is not None:
        return [figures / p.name, figures / p]
    return [source_dir / p, source_dir.parent / p]


def check_figure(rel: Optional[str], bases: list[Path]) -> Optional[str]:
    if not rel:
        return "no image_path"
    for cand in bases:
        if cand.is_file():
            size = cand.stat().st_size
            if size > FIGURE_MAX_BYTES:
                return f"{cand.name} is {size} bytes (> 2 MB)"
            with cand.open("rb") as fh:
                if not _is_figure(fh.read(16)):
                    return f"{cand.name} is not a PNG/WebP file"
            return None
    return f"{rel} not found"


def check_set(item: SourceSet, entry: Optional[dict], *, topics: set[str],
              titles: dict[str, int], slugs: dict[str, int], manifest_dir: Path,
              source_dir: Path, figures: Optional[Path]) -> SetResult:
    entry = entry or {}
    res = SetResult(key=item.key, publish=entry.get("publish") is True)
    codes = res.codes
    if item.data is None:
        codes["E_PARSE"] = item.parse_error or "unreadable"
        return res
    src = item.data
    prompt = src.get("prompt") if isinstance(src.get("prompt"), dict) else {}
    overrides = entry.get("overrides") if isinstance(entry.get("overrides"), dict) else {}
    review = entry.get("review") if isinstance(entry.get("review"), dict) else {}

    # review
    if not src.get("review_status") and review.get("status") != "approved":
        codes["E_NO_REVIEW"] = "source has no review_status and manifest is not approved"

    # title / slug
    title = entry.get("title_en")
    if not isinstance(title, str) or not title.strip():
        codes["E_NO_TITLE"] = "no title_en"
    elif not TITLE_MIN <= len(title) <= TITLE_MAX:
        codes["E_NO_TITLE"] = f"title_en is {len(title)} characters"
    elif has_vietnamese_marks(title):
        codes["E_NO_TITLE"] = "title_en has Vietnamese diacritics"
    elif titles.get(title.strip().casefold(), 0) > 1:
        codes["E_NO_TITLE"] = "title_en is used by another set"
    slug = entry.get("slug")
    if slug is not None or "E_NO_TITLE" not in codes:
        if not isinstance(slug, str) or not SLUG_RE.match(slug) or len(slug) > SLUG_MAX:
            codes["E_SLUG"] = f"slug {slug!r} does not match the pattern"
        elif slugs.get(slug, 0) > 1:
            codes["E_SLUG"] = f"slug {slug!r} is used by another set"

    # type
    task_type = task_type_of(prompt)
    qtype, subtype = prompt.get("question_type"), prompt.get("subtype")
    if task_type is None:
        codes["E_TYPE"] = f"unknown task {prompt.get('task')!r}"
    elif task_type == "task2" and qtype not in QUESTION_TYPES:
        codes["E_TYPE"] = f"Task 2 question_type {qtype!r}"
    elif task_type == "task1_academic" and (subtype not in TASK1_SUBTYPES or qtype):
        codes["E_TYPE"] = f"Task 1 subtype {subtype!r}, question_type {qtype!r}"

    # topic
    if entry.get("topic_slug") not in topics:
        codes["E_TOPIC"] = f"topic_slug {entry.get('topic_slug')!r} is not in topics.json"

    # figure
    if task_type == "task1_academic":
        if overrides.get("image_path"):
            problem = check_figure(overrides["image_path"], [manifest_dir / overrides["image_path"]])
        else:
            rel = prompt.get("image_path")
            problem = check_figure(rel, _figure_candidates(rel, source_dir, figures) if rel else [])
        if problem:
            codes["E_FIGURE"] = problem

    # justification pairs (overrides merged)
    extra = overrides.get("justification_jumps") if isinstance(overrides.get("justification_jumps"), dict) else {}
    justification = src.get("justification") if isinstance(src.get("justification"), dict) else {}
    by_crit = justification.get("by_criterion")
    by_crit = by_crit if isinstance(by_crit, list) else []
    pairs: dict[str, set[str]] = {c: set() for c in CRITERIA}
    for crit in by_crit:
        if isinstance(crit, dict) and crit.get("criterion") in pairs:
            jumps = crit.get("jumps") if isinstance(crit.get("jumps"), list) else []
            pairs[crit["criterion"]].update(j.get("pair") for j in jumps if isinstance(j, dict))
    for c, jumps in extra.items():
        if c in pairs and isinstance(jumps, list):
            pairs[c].update(j.get("pair") for j in jumps if isinstance(j, dict))
    missing = [f"{c} {p}" for c in CRITERIA for p in REQUIRED_PAIRS if p not in pairs[c]]
    if missing:
        codes["E_PAIR"] = "missing " + ", ".join(missing)

    # essays
    essays = src.get("essays") if isinstance(src.get("essays"), dict) else {}
    bad = []
    for b in BANDS:
        e = essays.get(b)
        if not isinstance(e, dict) or not str(e.get("text") or "").strip():
            bad.append(f"{b} text")
            continue
        for k in ("outline", "vocab_table"):
            if not isinstance(e.get(k), list) or not e[k]:
                bad.append(f"{b} {k}")
    if bad:
        codes["E_ESSAYS"] = "missing " + ", ".join(bad)

    # estimated band vs label
    mark_essays = item.mark.get("essays") if isinstance(item.mark, dict) else None
    if item.mark is None:
        codes["E_MARK"] = item.mark_error or "unreadable .mark.json"
    elif not isinstance(mark_essays, dict):
        codes["E_MARK"] = ".mark.json has no essays object"
    else:
        far = []
        for b in BANDS:
            scores = mark_essays.get(b)
            try:
                est = ielts_round(sum(Fraction(str(scores[c])) for c in CRITERIA) / 4)
            except (KeyError, TypeError, ValueError):
                far.append(f"{b} has no four criteria")
                continue
            diff = abs(est - float(b))
            if diff > 0.5:
                far.append(f"{b} estimated {est}")
            elif diff > 0:
                res.band_near.append((b, est))
        if far:
            codes["E_BAND_FAR"] = "; ".join(far)
        if res.band_near:
            codes["W_BAND_NEAR"] = "; ".join(f"{b} estimated {est}" for b, est in res.band_near)

    # delta excerpts present verbatim (after normalisation) in the essays
    if not bad:
        texts = {b: normalise_text(essays[b]["text"]) for b in BANDS}
        misses = 0
        for key, hi, lo in DELTA_SIDES:
            deltas = src.get(key)
            if deltas is None:
                continue
            if not isinstance(deltas, list):
                codes["E_PARSE"] = f"{key} is not a list"
                continue
            for d in deltas:
                if not isinstance(d, dict):
                    misses += 1
                    continue
                if normalise_text(d.get("before") or "") not in texts[hi]:
                    misses += 1
                if normalise_text(d.get("after") or "") not in texts[lo]:
                    misses += 1
        if misses:
            codes["W_DELTA_MATCH"] = f"{misses} excerpt(s) not found verbatim; shown in the margin"

    # content hash
    res.hash = content_hash(src)
    if entry.get("content_hash") and entry["content_hash"] != res.hash:
        codes["W_HASH"] = "source changed after review; confirm again"
    return res


def validate_manifest_shape(manifest: list[dict], source_keys: set[str]) -> list[str]:
    problems, seen = [], set()
    for i, e in enumerate(manifest):
        key = e.get("source_key")
        if not isinstance(key, str) or not key:
            problems.append(f"entry {i}: no source_key")
            continue
        if key in seen:
            problems.append(f"{key}: listed twice")
        seen.add(key)
        if key not in source_keys:
            problems.append(f"{key}: no such set in --source")
        if "publish" in e and not isinstance(e["publish"], bool):
            problems.append(f"{key}: publish must be true or false")
        status = (e.get("review") or {}).get("status")
        if status is not None and status not in REVIEW_STATUSES:
            problems.append(f"{key}: review.status {status!r}")
        if e.get("publish") is True and status == "excluded":
            problems.append(f"{key}: excluded set marked publish")
    return problems


def run_check(source_dir: Path, manifest: list[dict], topic_rows: list[dict], *,
              manifest_dir: Path, figures: Optional[Path] = None,
              out=print) -> tuple[int, list[SetResult]]:
    sets = load_sources(source_dir)
    by_key = {e.get("source_key"): e for e in manifest if isinstance(e.get("source_key"), str)}
    topics = {t.get("slug") for t in topic_rows if isinstance(t.get("slug"), str)}
    titles: dict[str, int] = {}
    slugs: dict[str, int] = {}
    for e in manifest:
        if isinstance(e.get("title_en"), str) and e["title_en"].strip():
            k = e["title_en"].strip().casefold()
            titles[k] = titles.get(k, 0) + 1
        if isinstance(e.get("slug"), str):
            slugs[e["slug"]] = slugs.get(e["slug"], 0) + 1

    shape = validate_manifest_shape(manifest, {s.key for s in sets})
    for p in shape:
        out(f"MANIFEST {p}")

    results = []
    for s in sets:
        try:
            r = check_set(s, by_key.get(s.key), topics=topics, titles=titles, slugs=slugs,
                          manifest_dir=manifest_dir, source_dir=source_dir, figures=figures)
        except Exception as exc:  # unexpected shape: report this set, keep checking the rest
            r = SetResult(key=s.key, publish=(by_key.get(s.key) or {}).get("publish") is True)
            r.codes["E_PARSE"] = f"unexpected structure ({type(exc).__name__}: {exc})"
        results.append(r)
    for r in results:
        if r.codes:
            out(f"{r.key}: " + " | ".join(f"{c} {d}" for c, d in sorted(r.codes.items())))

    counts = {c: sum(1 for r in results if c in r.codes) for c in ALL_CODES}
    task_counts = {"task2": 0, "task1_academic": 0}
    for s in sets:
        t = task_type_of((s.data or {}).get("prompt") or {}) if s.data else None
        if t in task_counts:
            task_counts[t] += 1
    blocked_published = [r.key for r in results if r.publish and r.blocked]
    out(f"SETS {len(sets)} (task2 {task_counts['task2']}, task1_academic {task_counts['task1_academic']})")
    out("SUMMARY " + json.dumps(counts))
    out(f"CLEAN {sum(1 for r in results if not r.blocked)} sets without a blocking code")
    out(f"PUBLISH {sum(1 for r in results if r.publish)} marked publish, "
        f"{len(blocked_published)} of them blocked")
    for key in blocked_published:
        out(f"BLOCKED_PUBLISH {key}")
    return (1 if shape or blocked_published else 0), results


def write_band_csv(path: Path, results: list[SetResult]) -> int:
    rows = [(r.key, b, est) for r in results for b, est in r.band_near]
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["source_key", "label_band", "estimated_band"])
        w.writerows(rows)
    return len(rows)


def write_hashes(path: Path, manifest: list[dict], results: list[SetResult]) -> int:
    hashes = {r.key: r.hash for r in results if r.hash}
    changed = 0
    for e in manifest:
        h = hashes.get(e.get("source_key"))
        if h and e.get("content_hash") != h:
            e["content_hash"] = h
            changed += 1
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", type=Path, required=True,
                        help="folder with <stem>.json and <stem>.mark.json")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--topics", type=Path, default=DEFAULT_TOPICS)
    parser.add_argument("--figures", type=Path, default=None)
    parser.add_argument("--check", action="store_true", help="validate only (no database)")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--write-hashes", action="store_true",
                        help="store each set's content_hash in the manifest")
    parser.add_argument("--band-csv", type=Path, default=None,
                        help="write the W_BAND_NEAR list for reviewers")
    args = parser.parse_args(argv)

    if args.check and args.execute:
        print("--execute is not available yet and is ignored: running --check only.",
              file=sys.stderr)
    if not args.check:
        print("Only --check is available: the staging dry run and --execute need the "
              "LIBRARY-0061 tables (G06-T02).", file=sys.stderr)
        return 2
    if not args.source.is_dir():
        print(f"--source {args.source} is not a folder", file=sys.stderr)
        return 2
    manifest = load_json_list(args.manifest, "manifest")
    topic_rows = load_json_list(args.topics, "topics")
    status, results = run_check(args.source, manifest, topic_rows,
                                manifest_dir=args.manifest.parent, figures=args.figures)
    if args.band_csv:
        n = write_band_csv(args.band_csv, results)
        print(f"BAND_CSV {args.band_csv} ({n} essays)")
    if args.write_hashes:
        if not args.manifest.exists():
            print("--write-hashes needs an existing manifest", file=sys.stderr)
            return 2
        n = write_hashes(args.manifest, manifest, results)
        print(f"HASHES {n} entries updated in {args.manifest}")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
