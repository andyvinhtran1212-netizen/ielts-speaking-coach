"""Import Speaking model answers for the public Library (LIBRARY-0061 T013, G06-T13).

Reads one delivery folder from the VIDEO MAKING repository, laid out as
``docs/SPEAKING_SAMPLE_CONTRACT.md`` (contract version 1) describes, checks
every item against that contract and the manifest kept in this repository, and
writes ``speaking_samples`` rows.

Modes
-----
``--check``     contract checks only. No database, writes nothing.
(default)       dry run: the checks, then a plan against the database
                (INSERT / UPDATE / SAME per slug, the ``topics`` row matched by
                title + part for "Luyện nói đề này"). Writes nothing.
``--execute``   the plan above, then: write each row, upload its audio file to the private
                ``library-media`` bucket at ``speaking-samples/<source_id>/answer.<ext>``,
                upsert the rows, read them back and compare ``content_hash``.

Rules
-----
* New rows are written with ``published = false``. Publishing is a separate,
  reviewed step (``/admin/library``, T020); this script never publishes.
* A row that is already published is not changed unless
  ``--allow-published-update`` is given, because its new content would go live
  at once.
* An item with any ``E_*`` code is skipped; the others are still imported.
* Batch records (GOI-06 5.8) wait for the G09-T36 helper; until it exists the
  run prints its summary only.
* The script never reads or runs anything in the VIDEO MAKING repository, never
  calls AI and never invents timings.

Codes (one line per item, totals at the end; ``E_*`` blocks the item):
E_PARSE, E_INDEX, E_FIELD, E_MANIFEST, E_NO_TEXT, E_VOICE, E_TIMES, E_JOIN,
E_MARK, E_MEDIA, E_TOPIC (dry run only), E_PUBLISHED (dry run only),
W_NO_TOPIC_ID.

Usage
-----
    cd backend
    python -m scripts.import_speaking_samples --check --source "<speaking-delivery-YYYYMMDD>"
    python -m scripts.import_speaking_samples --source "<folder>"            # dry run (staging env)
    python -m scripts.import_speaking_samples --source "<folder>" --execute  # staging, with approval
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = BACKEND / "content" / "library" / "speaking-samples-manifest.json"
DEFAULT_BANK = BACKEND / "content" / "speaking_bank"
BANK_FILES = {1: "2026-09-reviewed.json", 2: "2026-09-source.json", 3: "2026-09-reviewed.json"}

CONTRACT_VERSION = 1
BUCKET = "library-media"
AUDIO_MAX_BYTES = 10 * 1024 * 1024
AUDIO_TYPES = {".mp3": "audio/mpeg", ".m4a": "audio/mp4"}
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
REQUIRED = ("contract_version", "slug", "source_id", "part", "voice", "voice_model",
            "sample_text", "transcript", "produced_at")
MARK_KINDS = ("vocab", "structure")
TABLE = "speaking_samples"


@dataclass
class Item:
    slug: str
    codes: list[str] = field(default_factory=list)
    row: Optional[dict] = None
    audio: Optional[Path] = None
    action: str = ""

    @property
    def blocked(self) -> bool:
        return any(c.startswith("E_") for c in self.codes)


def squash(text: str) -> str:
    return " ".join(text.split())


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def load_manifest(path: Path) -> dict[str, dict]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    return {r["slug"]: r for r in rows if isinstance(r, dict) and r.get("slug")}


def load_cue_cards(bank_dir: Path) -> dict[str, dict]:
    """``source_id`` -> what the page shows above the answer: the Part 2 cue
    card (prompt, bullets, reflection) or the Part 1/3 question list."""
    cards: dict[str, dict] = {}
    for part, name in BANK_FILES.items():
        path = bank_dir / name
        if not path.exists():
            continue
        for topic in json.loads(path.read_text(encoding="utf-8")).get("topics") or []:
            if topic.get("part") != part:
                continue
            questions = [q for q in topic.get("questions") or [] if isinstance(q, dict)]
            if part == 2:
                cue = next((q for q in questions if q.get("question_type") == "cuecard"), None)
                if cue:
                    cards[topic["source_id"]] = {
                        "prompt": cue.get("question_text"),
                        "bullets": list(cue.get("cue_card_bullets") or []),
                        "reflection": cue.get("cue_card_reflection"),
                    }
            else:
                cards[topic["source_id"]] = {
                    "questions": [q.get("question_text") for q in questions if q.get("question_text")],
                }
    return cards


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def check_transcript(data: dict, duration_ms: Optional[int]) -> list[str]:
    codes: list[str] = []
    transcript = data.get("transcript")
    if not isinstance(transcript, list) or not transcript:
        return ["E_FIELD transcript must be a non-empty list"]
    starts = []
    for i, line in enumerate(transcript):
        if not isinstance(line, dict) or not isinstance(line.get("text"), str) or not line["text"].strip():
            codes.append(f"E_FIELD transcript[{i}] needs text")
            continue
        starts.append(line.get("start_ms"))
        for j, mark in enumerate(line.get("marks") or []):
            ok = (
                isinstance(mark, dict) and mark.get("kind") in MARK_KINDS
                and _is_int(mark.get("start")) and _is_int(mark.get("end"))
                and 0 <= mark["start"] < mark["end"] <= len(line["text"])
            )
            if not ok:
                codes.append(f"E_MARK transcript[{i}].marks[{j}]")
    if codes:
        return codes
    if any(s is None for s in starts):
        if not all(s is None for s in starts):
            codes.append("E_TIMES start_ms mixes numbers and null")
    elif not all(_is_int(s) for s in starts):
        codes.append("E_TIMES start_ms must be integers")
    else:
        if starts[0] < 0 or any(a >= b for a, b in zip(starts, starts[1:])):
            codes.append("E_TIMES start_ms must be >= 0 and strictly increasing")
        if duration_ms is None:
            codes.append("E_TIMES start_ms given without media.duration_ms")
        elif starts[-1] >= duration_ms:
            codes.append("E_TIMES start_ms reaches media.duration_ms")
    joined = squash(" ".join(line["text"] for line in transcript))
    if joined != squash(data.get("sample_text") or ""):
        codes.append("E_JOIN transcript text does not join to sample_text")
    return codes


def check_media(data: dict, folder: Path) -> tuple[list[str], dict, Optional[Path]]:
    """Contract 3.2. Returns codes, the media columns and the audio file."""
    media = data.get("media")
    cols = {"video_source": None, "youtube_id": None, "video_url": None, "duration_s": None}
    if media is None:
        return [], cols, None
    if not isinstance(media, dict):
        return ["E_MEDIA media must be an object"], cols, None
    codes: list[str] = []
    audio: Optional[Path] = None
    source = media.get("video_source")
    duration = media.get("duration_ms")
    if source == "youtube":
        if not isinstance(media.get("youtube_id"), str) or not YOUTUBE_ID_RE.match(media["youtube_id"]):
            codes.append("E_MEDIA youtube_id must be 11 characters [A-Za-z0-9_-]")
        cols.update(video_source="youtube", youtube_id=media.get("youtube_id"))
    elif source == "self_hosted":
        if not isinstance(media.get("video_url"), str) or not media["video_url"].startswith("https://"):
            codes.append("E_MEDIA video_url must be https://")
        cols.update(video_source="self_hosted", video_url=media.get("video_url"))
    elif source is not None:
        codes.append("E_MEDIA video_source must be youtube or self_hosted")
    elif media.get("audio_file") is not None:
        name = media["audio_file"]
        path = folder / name if isinstance(name, str) and "/" not in name and "\\" not in name else None
        if path is None or path.suffix.lower() not in AUDIO_TYPES:
            codes.append("E_MEDIA audio_file must be a .mp3 or .m4a file next to the item")
        elif not path.is_file():
            codes.append(f"E_MEDIA audio_file {name} is missing")
        elif path.stat().st_size > AUDIO_MAX_BYTES:
            codes.append(f"E_MEDIA audio_file {name} is over 10 MB")
        else:
            audio = path
    else:
        codes.append("E_MEDIA media has neither a video nor an audio_file")
    if source is not None and media.get("audio_file") is not None:
        codes.append("E_MEDIA audio_file is only for items without video")
    if source is not None or media.get("audio_file") is not None:
        if not _is_int(duration) or duration <= 0:
            codes.append("E_MEDIA duration_ms must be a positive integer")
        else:
            cols["duration_s"] = max(1, round(duration / 1000))
    return codes, cols, audio


def check_item(path: Path, manifest: dict[str, dict], cue_cards: dict[str, dict],
               producer_ref: Optional[str]) -> Item:
    item = Item(slug=path.stem)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        item.codes.append(f"E_PARSE {type(exc).__name__}")
        return item
    if not isinstance(data, dict):
        item.codes.append("E_PARSE not an object")
        return item
    missing = [k for k in REQUIRED if k not in data]
    if missing:
        item.codes.append("E_FIELD missing " + ", ".join(missing))
        return item
    if data["contract_version"] != CONTRACT_VERSION:
        item.codes.append(f"E_FIELD contract_version must be {CONTRACT_VERSION}")
    entry = manifest.get(data["slug"])
    if data["slug"] != path.stem:
        item.codes.append("E_MANIFEST file name and slug differ")
    if entry is None:
        item.codes.append("E_MANIFEST slug is not in the manifest")
    elif data["source_id"] != entry.get("source_id") or data["part"] != entry.get("part"):
        item.codes.append("E_MANIFEST source_id or part does not match the manifest")
    if not isinstance(data["sample_text"], str) or not data["sample_text"].strip():
        # Stop here: the transcript checks below compare against this text.
        item.codes.append("E_NO_TEXT sample_text is empty or not a string")
        return item
    if data["voice"] != "synthetic":
        item.codes.append("E_VOICE voice must be synthetic")
    media_codes, media_cols, audio = check_media(data, path.parent)
    item.codes += media_codes
    duration_ms = data["media"].get("duration_ms") if isinstance(data.get("media"), dict) else None
    item.codes += check_transcript(data, duration_ms if _is_int(duration_ms) else None)
    for key in ("outline", "related_part3"):
        if key in data and not (isinstance(data[key], list) and all(isinstance(s, str) for s in data[key])):
            item.codes.append(f"E_FIELD {key} must be a list of strings")
    vocabulary = data.get("vocabulary", [])
    if not isinstance(vocabulary, list) or not all(
        isinstance(v, dict) and isinstance(v.get("term"), str) and isinstance(v.get("meaning_vi"), str)
        for v in vocabulary
    ):
        item.codes.append("E_FIELD vocabulary must be [{term, meaning_vi, note?}]")
    if item.blocked or entry is None:
        return item

    item.audio = audio
    audio_path = f"speaking-samples/{entry['source_id']}/answer{audio.suffix.lower()}" if audio else None
    audio_sha = hashlib.sha256(audio.read_bytes()).hexdigest() if audio else None
    row = {
        "source_id": entry["source_id"],
        "slug": entry["slug"],
        "part": entry["part"],
        "title_en": entry["title_en"],
        "title_vi": entry.get("title_vi"),
        "topic_slug": entry.get("topic_slug"),
        "topic_id": entry.get("topic_id"),
        "cue_card": cue_cards.get(entry["source_id"]),
        **media_cols,
        "transcript": [
            {"start_ms": line.get("start_ms"), "text": line["text"],
             "marks": [{k: m.get(k) for k in ("kind", "start", "end", "note")} for m in line.get("marks") or []]}
            for line in data["transcript"]
        ],
        "sample_text": data["sample_text"].strip(),
        "audio_path": audio_path,
        "voice": "synthetic",
        "outline": data.get("outline") or [],
        "vocabulary": [{k: v.get(k) for k in ("term", "meaning_vi", "note") if v.get(k) is not None}
                       for v in vocabulary],
        "related_part3": data.get("related_part3") or [],
        "source_note": canonical_json({
            "producer_ref": producer_ref, "voice_model": data["voice_model"],
            "produced_at": data["produced_at"],
        }),
    }
    row["content_hash"] = hashlib.sha256(
        canonical_json({**{k: v for k, v in row.items() if k != "topic_id"}, "audio_sha256": audio_sha}).encode()
    ).hexdigest()
    item.row = row
    return item


def read_delivery(source: Path, manifest: dict[str, dict], cue_cards: dict[str, dict]) -> tuple[list[str], list[Item]]:
    problems: list[str] = []
    index_path = source / "index.json"
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return [f"E_INDEX index.json unreadable ({type(exc).__name__})"], []
    if not isinstance(index, dict) or index.get("contract_version") != CONTRACT_VERSION:
        return [f"E_INDEX index.json must be an object with contract_version {CONTRACT_VERSION}"], []
    listed = index.get("items")
    if not isinstance(listed, list) or not all(isinstance(s, str) for s in listed):
        return ["E_INDEX items must be a list of slugs"], []
    files = {p.stem: p for p in source.glob("*.json") if p.name != "index.json"}
    for slug in sorted(set(files) - set(listed)):
        problems.append(f"E_INDEX {slug}.json is not listed in index.json (skipped)")
    items = []
    for slug in listed:
        if slug not in files:
            items.append(Item(slug=slug, codes=["E_INDEX listed but no <slug>.json"]))
            continue
        items.append(check_item(files[slug], manifest, cue_cards, index.get("producer_ref")))
    return problems, items


# ── database ────────────────────────────────────────────────────────────────


_PAGE = 1000


def _paged(query_factory, order_by: str) -> list[dict]:
    """Every row of a select, read in pages: PostgREST caps one read at 1000."""
    rows: list[dict] = []
    start = 0
    while True:
        page = query_factory().order(order_by).range(start, start + _PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def plan(db, items: list[Item], *, allow_published_update: bool) -> None:
    """Fills ``action`` (INSERT / UPDATE / SAME) and the DB-only codes."""
    ready = [i for i in items if not i.blocked]
    if not ready:
        return
    existing = {
        r["source_id"]: r for r in (
            db.table(TABLE).select("source_id, slug, content_hash, published, topic_id")
            .in_("source_id", [i.row["source_id"] for i in ready]).execute().data or []
        )
    }
    topics = {r["slug"]: r for r in _paged(lambda: db.table("library_topics").select("slug, shelves"), "slug")}
    bank = _paged(lambda: db.table("topics").select("id, title, part"), "id")
    by_title = {}
    for t in bank:
        by_title.setdefault((str(t.get("title") or "").casefold().strip(), t.get("part")), []).append(t.get("id"))
    for item in ready:
        row = item.row
        slug_topic = row.get("topic_slug")
        if slug_topic and "speaking" not in (topics.get(slug_topic, {}).get("shelves") or []):
            item.codes.append(f"E_TOPIC {slug_topic} is not a Speaking topic in library_topics")
        if not row.get("topic_id"):
            matches = by_title.get((row["title_en"].casefold().strip(), row["part"])) or []
            if len(matches) == 1:
                row["topic_id"] = matches[0]
            else:
                item.codes.append(f"W_NO_TOPIC_ID {len(matches)} topics rows match title + part")
        current = existing.get(row["source_id"])
        if current and current.get("slug") != row["slug"]:
            item.codes.append("E_MANIFEST source_id is stored under another slug")
        if current is None:
            item.action = "INSERT"
        elif current.get("content_hash") == row["content_hash"] and current.get("topic_id") == row.get("topic_id"):
            item.action = "SAME"
        else:
            item.action = "UPDATE"
            if current.get("published") and not allow_published_update:
                item.codes.append("E_PUBLISHED row is published; rerun with --allow-published-update")


def execute(db, items: list[Item]) -> list[str]:
    """Upserts rows (new rows unpublished), then uploads audio, then reads back.

    The row is written first, so a failed write never leaves an orphan object in
    the bucket. A new row is unpublished, so its audio being uploaded a moment
    later is never seen; the media route answers 404 until the object exists."""
    failures: list[str] = []
    todo = [i for i in items if not i.blocked and i.action in ("INSERT", "UPDATE")]
    for item in todo:
        payload = dict(item.row)
        if item.action == "INSERT":
            payload["published"] = False
            db.table(TABLE).insert(payload).execute()
        else:
            db.table(TABLE).update(payload).eq("source_id", payload["source_id"]).execute()
        if item.audio is not None:
            db.storage.from_(BUCKET).upload(
                item.row["audio_path"], item.audio.read_bytes(),
                {"content-type": AUDIO_TYPES[item.audio.suffix.lower()], "upsert": "true"},
            )
    if todo:
        back = {
            r["source_id"]: r for r in (
                db.table(TABLE).select("source_id, content_hash")
                .in_("source_id", [i.row["source_id"] for i in todo]).execute().data or []
            )
        }
        for item in todo:
            got = back.get(item.row["source_id"], {}).get("content_hash")
            if got != item.row["content_hash"]:
                failures.append(f"{item.slug}: read-back content_hash {got!r} differs")
    return failures


def report(problems: list[str], items: list[Item], out=None) -> None:
    out = out or sys.stdout
    for line in problems:
        print(line, file=out)
    for item in items:
        state = "BLOCKED" if item.blocked else (item.action or "OK")
        print(f"{state:8} {item.slug}" + ("" if not item.codes else "  " + " | ".join(item.codes)), file=out)
    blocked = sum(1 for i in items if i.blocked)
    actions = {a: sum(1 for i in items if not i.blocked and i.action == a) for a in ("INSERT", "UPDATE", "SAME")}
    print(f"items={len(items)} blocked={blocked} " + " ".join(f"{k.lower()}={v}" for k, v in actions.items()), file=out)


def main(argv: Optional[list[str]] = None, *, db=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", type=Path, required=True, help="speaking-delivery-<YYYYMMDD> folder")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--bank", type=Path, default=DEFAULT_BANK, help="speaking_bank folder (cue cards)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="contract checks only (no database)")
    mode.add_argument("--execute", action="store_true", help="write rows and audio (staging, approved runs)")
    parser.add_argument("--allow-published-update", action="store_true")
    args = parser.parse_args(argv)

    problems, items = read_delivery(args.source, load_manifest(args.manifest), load_cue_cards(args.bank))
    if not args.check and items:
        if db is None:
            from database import supabase_admin as db  # noqa: PLC0415 - only DB modes need it
        plan(db, items, allow_published_update=args.allow_published_update)
    failures: list[str] = []
    if args.execute:
        failures = execute(db, items)
    report(problems, items)
    for line in failures:
        print("E_READBACK " + line)
    if not args.execute and not args.check:
        print("dry run: nothing written")
    print("batch record: skipped (G09-T36 helper not available yet)")
    if any(p.startswith("E_INDEX index.json") for p in problems) or failures:
        return 1
    return 2 if any(i.blocked for i in items) else 0


if __name__ == "__main__":
    sys.exit(main())
