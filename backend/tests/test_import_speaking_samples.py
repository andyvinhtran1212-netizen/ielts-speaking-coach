"""G06-T13: Speaking model-answer importer (contract v1, docs/SPEAKING_SAMPLE_CONTRACT.md).

Deliveries are short invented items written to a temp folder; the manifest is
the real one in the repository; the database is a small in-memory fake.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts import import_speaking_samples as iss  # noqa: E402

SLUG = "a-city-you-have-been-to-and-would-like-to-visit-again-part-2"
P1_SLUG = next(r["slug"] for r in json.loads(iss.DEFAULT_MANIFEST.read_text()) if r["part"] == 1)


def make_item(slug=SLUG, **over) -> dict:
    manifest = iss.load_manifest(iss.DEFAULT_MANIFEST)
    entry = manifest[slug]
    item = {
        "contract_version": 1,
        "slug": slug,
        "source_id": entry["source_id"],
        "part": entry["part"],
        "voice": "synthetic",
        "voice_model": "kokoro-test",
        "sample_text": "I'd like to talk about Hue. The old citadel is calm in the early morning.",
        "transcript": [
            {"start_ms": 0, "text": "I'd like to talk about Hue.", "marks": []},
            {"start_ms": 2400, "text": "The old citadel is calm in the early morning.",
             "marks": [{"kind": "vocab", "start": 4, "end": 15, "note": "kinh thành cổ"}]},
        ],
        "media": {"video_source": "youtube", "youtube_id": "AbCdEfGhIjK", "duration_ms": 6100},
        "outline": ["Nơi chốn", "Vì sao"],
        "vocabulary": [{"term": "old citadel", "meaning_vi": "kinh thành cổ"}],
        "related_part3": ["Why do people like visiting historic cities?"],
        "produced_at": "2026-11-18T09:00:00+07:00",
    }
    item.update(over)
    return item


def deliver(tmp_path: Path, *items: dict, extra_files: dict | None = None, listed=None) -> Path:
    folder = tmp_path / "speaking-delivery-20261123"
    folder.mkdir()
    for item in items:
        (folder / f"{item['slug']}.json").write_text(json.dumps(item, ensure_ascii=False), encoding="utf-8")
    for name, data in (extra_files or {}).items():
        (folder / name).write_bytes(data)
    index = {"contract_version": 1, "producer_ref": "abc123",
             "items": listed if listed is not None else [i["slug"] for i in items]}
    (folder / "index.json").write_text(json.dumps(index), encoding="utf-8")
    return folder


def run_check(folder: Path):
    manifest = iss.load_manifest(iss.DEFAULT_MANIFEST)
    return iss.read_delivery(folder, manifest, iss.load_cue_cards(iss.DEFAULT_BANK))


def codes_of(folder: Path) -> list[str]:
    problems, items = run_check(folder)
    return problems + [c for i in items for c in i.codes]


# ── contract checks (--check) ──────────────────────────────────────────────


def test_valid_youtube_item_builds_a_row(tmp_path):
    problems, items = run_check(deliver(tmp_path, make_item()))
    assert problems == [] and items[0].codes == []
    row = items[0].row
    assert row["source_id"] == "p2-001" and row["part"] == 2
    assert row["video_source"] == "youtube" and row["youtube_id"] == "AbCdEfGhIjK"
    assert row["duration_s"] == 6 and row["audio_path"] is None
    assert row["voice"] == "synthetic"
    assert row["cue_card"]["prompt"].startswith("Describe a city")
    assert row["cue_card"]["bullets"] and row["cue_card"]["reflection"]
    assert json.loads(row["source_note"]) == {"producer_ref": "abc123", "voice_model": "kokoro-test",
                                              "produced_at": "2026-11-18T09:00:00+07:00"}
    assert len(row["content_hash"]) == 64


def test_part1_cue_card_is_the_question_list(tmp_path):
    item = make_item(P1_SLUG, media=None,
                     transcript=[{"start_ms": None, "text": "I study.", "marks": []}], sample_text="I study.")
    _, items = run_check(deliver(tmp_path, item))
    assert items[0].codes == []
    assert items[0].row["cue_card"]["questions"]
    assert items[0].row["duration_s"] is None and items[0].row["video_source"] is None


def test_audio_item_maps_to_private_bucket_path(tmp_path):
    item = make_item(media={"audio_file": f"{SLUG}.mp3", "duration_ms": 6100})
    _, items = run_check(deliver(tmp_path, item, extra_files={f"{SLUG}.mp3": b"ID3audio"}))
    assert items[0].codes == []
    assert items[0].row["audio_path"] == "speaking-samples/p2-001/answer.mp3"
    assert items[0].row["video_source"] is None


@pytest.mark.parametrize("change, code", [
    ({"contract_version": 2}, "E_FIELD"),
    ({"source_id": "p2-999"}, "E_MANIFEST"),
    ({"part": 3}, "E_MANIFEST"),
    ({"sample_text": "  "}, "E_NO_TEXT"),
    ({"voice": "human"}, "E_VOICE"),
    ({"media": {"video_source": "youtube", "youtube_id": "short", "duration_ms": 6100}}, "E_MEDIA"),
    ({"media": {"video_source": "self_hosted", "video_url": "http://x/v.mp4", "duration_ms": 6100}}, "E_MEDIA"),
    ({"media": {"video_source": "youtube", "youtube_id": "AbCdEfGhIjK"}}, "E_MEDIA"),
    ({"media": {"audio_file": "missing.mp3", "duration_ms": 6100}}, "E_MEDIA"),
    ({"media": {"audio_file": "../x.mp3", "duration_ms": 6100}}, "E_MEDIA"),
    ({"vocabulary": [{"term": "x"}]}, "E_FIELD"),
])
def test_blocking_codes(tmp_path, change, code):
    found = codes_of(deliver(tmp_path, make_item(**change)))
    assert any(c.startswith(code) for c in found), found


def test_missing_required_field(tmp_path):
    item = make_item()
    del item["produced_at"]
    assert any(c.startswith("E_FIELD missing produced_at") for c in codes_of(deliver(tmp_path, item)))


@pytest.mark.parametrize("starts", [[0, None], [2400, 0], [0, 0], [-1, 10], [0, 6100]])
def test_bad_times_block(tmp_path, starts):
    item = make_item()
    for line, start in zip(item["transcript"], starts):
        line["start_ms"] = start
    assert any(c.startswith("E_TIMES") for c in codes_of(deliver(tmp_path, item)))


def test_times_need_media(tmp_path):
    item = make_item(media=None)
    assert any(c.startswith("E_TIMES") for c in codes_of(deliver(tmp_path, item)))


def test_all_null_times_are_fine_with_media(tmp_path):
    item = make_item()
    for line in item["transcript"]:
        line["start_ms"] = None
    assert codes_of(deliver(tmp_path, item)) == []


def test_transcript_must_join_to_sample_text(tmp_path):
    item = make_item(sample_text="Something else entirely.")
    assert any(c.startswith("E_JOIN") for c in codes_of(deliver(tmp_path, item)))


@pytest.mark.parametrize("mark", [
    {"kind": "vocab", "start": 4, "end": 99, "note": "x"},
    {"kind": "idiom", "start": 0, "end": 2, "note": "x"},
    {"kind": "vocab", "start": 3, "end": 3, "note": "x"},
])
def test_bad_marks_block(tmp_path, mark):
    item = make_item()
    item["transcript"][1]["marks"] = [mark]
    assert any(c.startswith("E_MARK") for c in codes_of(deliver(tmp_path, item)))


def test_audio_over_10_mb_blocks(tmp_path):
    item = make_item(media={"audio_file": f"{SLUG}.mp3", "duration_ms": 6100})
    big = b"0" * (iss.AUDIO_MAX_BYTES + 1)
    assert any("over 10 MB" in c for c in codes_of(deliver(tmp_path, item, extra_files={f"{SLUG}.mp3": big})))


def test_index_problems(tmp_path):
    folder = deliver(tmp_path, make_item(), listed=[SLUG, "not-delivered-part-2"])
    problems, items = run_check(folder)
    assert items[1].codes == ["E_INDEX listed but no <slug>.json"]
    (folder / "index.json").write_text("{}")
    problems, items = run_check(folder)
    assert problems and problems[0].startswith("E_INDEX") and items == []


def test_unlisted_file_is_reported_and_skipped(tmp_path):
    other = make_item(P1_SLUG)
    problems, items = run_check(deliver(tmp_path, make_item(), other, listed=[SLUG]))
    assert [i.slug for i in items] == [SLUG]
    assert any(P1_SLUG in p for p in problems)


def test_hash_is_stable_and_follows_content_and_audio(tmp_path):
    def hash_for(sub, item, audio=b"A"):
        (tmp_path / sub).mkdir()
        _, items = run_check(deliver(tmp_path / sub, item, extra_files={f"{SLUG}.mp3": audio}))
        return items[0].row["content_hash"]

    item = make_item(media={"audio_file": f"{SLUG}.mp3", "duration_ms": 6100})
    assert hash_for("a", item) == hash_for("b", copy.deepcopy(item))
    assert hash_for("c", item) != hash_for("d", item, audio=b"B")
    assert hash_for("e", item) != hash_for("f", make_item(media=item["media"], outline=["Khác"]))


# ── dry run and --execute against a fake database ───────────────────────────


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, _cols):
        return self

    def in_(self, col, values):
        self.filters.append(lambda r: r.get(col) in values)
        return self

    def eq(self, col, value):
        self.filters.append(lambda r: r.get(col) == value)
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            rows.append(dict(self.payload))
            self.db.writes.append(("insert", self.payload["slug"]))
        elif self.op == "update":
            for r in rows:
                if all(f(r) for f in self.filters):
                    r.update(self.payload)
            self.db.writes.append(("update", self.payload["slug"]))
        return type("R", (), {"data": [dict(r) for r in rows if all(f(r) for f in self.filters)]})()


class FakeDB:
    def __init__(self, tables):
        self.tables, self.writes, self.uploads = tables, [], []
        db = self

        class _Bucket:
            def __init__(self, name):
                self.name = name

            def upload(self, path, data, opts):
                db.uploads.append((self.name, path, opts["content-type"]))

        self.storage = type("S", (), {"from_": staticmethod(lambda name: _Bucket(name))})()

    def table(self, name):
        return _Q(self, name)


def _db(**extra):
    return FakeDB({
        "speaking_samples": extra.get("rows", []),
        "library_topics": [{"slug": "places", "shelves": ["writing", "speaking"]},
                           {"slug": "essays", "shelves": ["writing"]}],
        "topics": [{"id": "t-1", "title": "A city you have been to and would like to visit again", "part": 2}],
    })


def test_dry_run_plans_insert_and_matches_topic_id(tmp_path, capsys):
    db = _db()
    folder = deliver(tmp_path, make_item())
    assert iss.main(["--source", str(folder)], db=db) == 0
    out = capsys.readouterr().out
    assert f"INSERT   {SLUG}" in out and "dry run: nothing written" in out
    assert db.writes == [] and db.uploads == []


def test_execute_inserts_unpublished_uploads_audio_and_reads_back(tmp_path, capsys):
    db = _db()
    item = make_item(media={"audio_file": f"{SLUG}.mp3", "duration_ms": 6100})
    folder = deliver(tmp_path, item, extra_files={f"{SLUG}.mp3": b"ID3"})
    assert iss.main(["--source", str(folder), "--execute"], db=db) == 0
    row = db.tables["speaking_samples"][0]
    assert row["published"] is False and row["topic_id"] == "t-1"
    assert db.uploads == [("library-media", "speaking-samples/p2-001/answer.mp3", "audio/mpeg")]
    # A second run changes nothing.
    capsys.readouterr()
    assert iss.main(["--source", str(folder), "--execute"], db=db) == 0
    assert f"SAME     {SLUG}" in capsys.readouterr().out
    assert db.writes == [("insert", SLUG)]


def test_published_row_is_not_changed_without_flag(tmp_path, capsys):
    db = _db(rows=[{"source_id": "p2-001", "slug": SLUG, "content_hash": "old", "published": True, "topic_id": "t-1"}])
    folder = deliver(tmp_path, make_item())
    assert iss.main(["--source", str(folder), "--execute"], db=db) == 2
    assert "E_PUBLISHED" in capsys.readouterr().out and db.writes == []
    assert iss.main(["--source", str(folder), "--execute", "--allow-published-update"], db=db) == 0
    assert db.writes == [("update", SLUG)]
    assert db.tables["speaking_samples"][0]["published"] is True


def test_topic_slug_must_be_on_the_speaking_shelf(tmp_path, monkeypatch, capsys):
    manifest = iss.load_manifest(iss.DEFAULT_MANIFEST)
    manifest[SLUG] = {**manifest[SLUG], "topic_slug": "essays"}
    monkeypatch.setattr(iss, "load_manifest", lambda _p: manifest)
    assert iss.main(["--source", str(deliver(tmp_path, make_item()))], db=_db()) == 2
    assert "E_TOPIC essays" in capsys.readouterr().out


def test_check_mode_needs_no_database(tmp_path, capsys):
    assert iss.main(["--check", "--source", str(deliver(tmp_path, make_item()))], db=None) == 0
    assert "OK       " + SLUG in capsys.readouterr().out
