"""G06-T03: the Writing sample importer: ``--check`` (no database), and the
dry run and ``--execute`` against an in-memory stand-in of the service-role
client (no network, no AI).

Fixtures are short invented sets written to a temp folder; no real sample
text is copied into the repository.
"""
from __future__ import annotations

import copy
import json
import sys
from fractions import Fraction
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts import import_writing_samples as iws  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

ESSAY = {
    "7.5": "Remote work offers flexibility that many employees value highly.",
    "7.0": "Working from home gives workers more flexibility.",
    "6.0": "Working at home is more flexible for workers.",
}


def _essay(band: str) -> dict:
    return {"text": ESSAY[band], "word_count": len(ESSAY[band].split()),
            "outline": [{"paragraph": 1, "function": "intro"}],
            "vocab_table": [{"term": "flexibility"}], "structures": []}


def _jumps(criterion: str, pairs=iws.REQUIRED_PAIRS) -> dict:
    return {"criterion": criterion, "summary_vi": "x",
            "jumps": [{"pair": p, "changes": []} for p in pairs]}


def make_set(task: str = "task2") -> dict:
    prompt = {"text": "Some people work from home. Discuss.", "domain": "work",
              "difficulty_notes": "internal"}
    if task == "task2":
        prompt["question_type"] = "advantages_disadvantages"
    else:
        prompt.update(task="task1_academic", subtype="bar", image_path="sources/task1_figures/f.png")
    data = {
        "prompt": prompt,
        "essays": {b: _essay(b) for b in iws.BANDS},
        "delta_75_70": [{"criterion": "LR", "before": "Remote work offers flexibility",
                         "after": "Working from home gives workers more flexibility", "why": "x"}],
        "delta_70_60": [{"criterion": "LR", "before": "gives workers more flexibility",
                         "after": "is more flexible for workers", "why": "x"}],
        "justification": {"by_criterion": [_jumps(c) for c in iws.CRITERIA],
                          "integrity_check": {"ok": True}},
        "review_status": "revised_20261017",
    }
    if task != "task2":
        data["data"] = {"type": "bar", "title": "t", "numbers": [1, 2]}
    return data


def make_mark(scores: dict | None = None) -> dict:
    scores = scores or {b: {c: float(b) for c in iws.CRITERIA} for b in iws.BANDS}
    return {"essays": scores, "note": "internal"}


def entry(key: str, **kw) -> dict:
    base = {"source_key": key, "slug": key.replace("_", "-"), "title_en": f"Title for {key}",
            "topic_slug": "work", "publish": False, "review": {"status": "needs_review"}}
    base.update(kw)
    return base


@pytest.fixture
def tree(tmp_path):
    src = tmp_path / "incoming"
    (src / "_archive").mkdir(parents=True)
    figures = tmp_path / "figures"
    figures.mkdir()
    (figures / "f.png").write_bytes(PNG)
    man_dir = tmp_path / "library"
    man_dir.mkdir()

    def write(key, data, mark=None):
        (src / f"{key}.json").write_text(json.dumps(data), encoding="utf-8")
        if mark is not False:
            (src / f"{key}.mark.json").write_text(json.dumps(mark or make_mark()), encoding="utf-8")

    return {"src": src, "figures": figures, "man_dir": man_dir, "write": write}


TOPICS = [{"slug": "work", "label_vi": "Công việc"}]
# A set may be marked publish only with an approved, signed review (E_NOT_APPROVED).
APPROVED = {"status": "approved", "by": "andy", "at": "2026-11-20"}


def run(tree, manifest, topics=TOPICS, figures=True):
    lines: list[str] = []
    status, results = iws.run_check(tree["src"], manifest, topics, manifest_dir=tree["man_dir"],
                                    figures=tree["figures"] if figures else None, out=lines.append)
    return status, {r.key: r for r in results}, lines


def test_clean_task2_and_task1_have_no_codes(tree):
    tree["write"]("t2_ok", make_set())
    tree["write"]("t1_ok", make_set("task1"))
    status, res, lines = run(tree, [entry("t2_ok", publish=True, review=APPROVED),
                                    entry("t1_ok", publish=True, review=APPROVED)])
    assert status == 0
    assert res["t2_ok"].codes == {} and res["t1_ok"].codes == {}
    assert "SETS 2 (task2 1, task1_academic 1)" in lines


def test_archive_folder_and_mark_files_are_not_sets(tree):
    tree["write"]("t2_ok", make_set())
    (tree["src"] / "_archive" / "old.json").write_text("{}", encoding="utf-8")
    _, res, _ = run(tree, [entry("t2_ok")])
    assert set(res) == {"t2_ok"}


def test_missing_review_status_blocks_until_manifest_approves(tree):
    data = make_set()
    del data["review_status"]
    tree["write"]("t2_new", data)
    _, res, _ = run(tree, [entry("t2_new")])
    assert "E_NO_REVIEW" in res["t2_new"].codes
    _, res, _ = run(tree, [entry("t2_new", review={"status": "approved", "by": "x", "at": "2026-11-18"})])
    assert "E_NO_REVIEW" not in res["t2_new"].codes


@pytest.mark.parametrize("title", [None, "ab", "x" * 71, "Làm việc tại nhà", "Đi làm"])
def test_bad_titles(tree, title):
    tree["write"]("t2_ok", make_set())
    _, res, _ = run(tree, [entry("t2_ok", title_en=title)])
    assert "E_NO_TITLE" in res["t2_ok"].codes


def test_duplicate_title_is_flagged_on_both_sets(tree):
    tree["write"]("a", make_set())
    tree["write"]("b", make_set())
    _, res, _ = run(tree, [entry("a", title_en="Same title"), entry("b", title_en="same TITLE")])
    assert "E_NO_TITLE" in res["a"].codes and "E_NO_TITLE" in res["b"].codes


@pytest.mark.parametrize("slug", ["Bad Slug", "trailing-", "a" * 81, None])
def test_bad_slug(tree, slug):
    tree["write"]("t2_ok", make_set())
    _, res, _ = run(tree, [entry("t2_ok", slug=slug)])
    assert "E_SLUG" in res["t2_ok"].codes


def test_duplicate_slug(tree):
    tree["write"]("a", make_set())
    tree["write"]("b", make_set())
    _, res, _ = run(tree, [entry("a", slug="same"), entry("b", slug="same")])
    assert "E_SLUG" in res["a"].codes and "E_SLUG" in res["b"].codes


def test_no_manifest_entry_reports_title_but_not_slug(tree):
    tree["write"]("t2_ok", make_set())
    _, res, _ = run(tree, [])
    assert {"E_NO_TITLE", "E_TOPIC"} <= set(res["t2_ok"].codes)
    assert "E_SLUG" not in res["t2_ok"].codes


@pytest.mark.parametrize("mutate", [
    lambda p: p.update(question_type="essay"),
    lambda p: p.pop("question_type"),
    lambda p: p.update(task="task1_general"),
])
def test_task2_type_errors(tree, mutate):
    data = make_set()
    mutate(data["prompt"])
    tree["write"]("t2", data)
    _, res, _ = run(tree, [entry("t2")])
    assert "E_TYPE" in res["t2"].codes


@pytest.mark.parametrize("mutate", [
    lambda p: p.update(subtype="radar"),
    lambda p: p.update(question_type="opinion"),
])
def test_task1_type_errors(tree, mutate):
    data = make_set("task1")
    mutate(data["prompt"])
    tree["write"]("t1", data)
    _, res, _ = run(tree, [entry("t1")])
    assert "E_TYPE" in res["t1"].codes


def test_unknown_topic(tree):
    tree["write"]("t2_ok", make_set())
    _, res, _ = run(tree, [entry("t2_ok", topic_slug="space")])
    assert "E_TOPIC" in res["t2_ok"].codes
    _, res, _ = run(tree, [entry("t2_ok")], topics=[])
    assert "E_TOPIC" in res["t2_ok"].codes


def test_task1_figure_missing_unreadable_or_overridden(tree):
    data = make_set("task1")
    del data["prompt"]["image_path"]
    tree["write"]("t1_noimg", data)
    other = make_set("task1")
    other["prompt"]["image_path"] = "sources/task1_figures/broken.png"
    (tree["figures"] / "broken.png").write_bytes(b"not an image")
    tree["write"]("t1_broken", other)
    _, res, _ = run(tree, [entry("t1_noimg"), entry("t1_broken")])
    assert "E_FIGURE" in res["t1_noimg"].codes and "E_FIGURE" in res["t1_broken"].codes

    (tree["man_dir"] / "figures").mkdir()
    (tree["man_dir"] / "figures" / "t1_noimg.png").write_bytes(PNG)
    _, res, _ = run(tree, [entry("t1_noimg", overrides={"image_path": "figures/t1_noimg.png"})])
    assert "E_FIGURE" not in res["t1_noimg"].codes


def test_figure_resolves_against_source_parent_without_figures_flag(tree):
    tree["write"]("t1_ok", make_set("task1"))
    target = tree["src"].parent / "sources" / "task1_figures"
    target.mkdir(parents=True)
    (target / "f.png").write_bytes(PNG)
    _, res, _ = run(tree, [entry("t1_ok")], figures=False)
    assert "E_FIGURE" not in res["t1_ok"].codes


def test_oversized_figure(tree):
    (tree["figures"] / "f.png").write_bytes(PNG + b"\x00" * iws.FIGURE_MAX_BYTES)
    tree["write"]("t1", make_set("task1"))
    _, res, _ = run(tree, [entry("t1")])
    assert "E_FIGURE" in res["t1"].codes


def test_missing_pair_and_override_fills_it(tree):
    data = make_set("task1")
    data["justification"]["by_criterion"][2] = _jumps("LR", ["7.0->7.5"])
    tree["write"]("t1", data)
    _, res, _ = run(tree, [entry("t1")])
    assert res["t1"].codes["E_PAIR"] == "missing LR 6.0->7.0"
    fill = {"justification_jumps": {"LR": [{"pair": "6.0->7.0", "changes": []}]}}
    _, res, _ = run(tree, [entry("t1", overrides=fill)])
    assert "E_PAIR" not in res["t1"].codes


def test_missing_criterion_is_a_missing_pair(tree):
    data = make_set()
    data["justification"]["by_criterion"].pop()
    tree["write"]("t2", data)
    _, res, _ = run(tree, [entry("t2")])
    assert "GRA 6.0->7.0" in res["t2"].codes["E_PAIR"]


@pytest.mark.parametrize("mutate", [
    lambda e: e.pop("6.0"),
    lambda e: e["7.0"].update(text="  "),
    lambda e: e["7.5"].update(outline=[]),
    lambda e: e["6.0"].pop("vocab_table"),
])
def test_essay_errors(tree, mutate):
    data = make_set()
    mutate(data["essays"])
    tree["write"]("t2", data)
    _, res, _ = run(tree, [entry("t2")])
    assert "E_ESSAYS" in res["t2"].codes


def test_band_far_and_near(tree):
    scores = {b: {c: float(b) for c in iws.CRITERIA} for b in iws.BANDS}
    near = copy.deepcopy(scores)
    near["7.5"]["LR"] = 8.5  # mean 7.75 → 8.0, off by 0.5
    far = copy.deepcopy(scores)
    far["6.0"] = {"TR": 7.0, "CC": 7.0, "LR": 7.0, "GRA": 7.0}
    tree["write"]("near", make_set(), make_mark(near))
    tree["write"]("far", make_set(), make_mark(far))
    status, res, _ = run(tree, [entry("near", publish=True, review=APPROVED), entry("far")])
    assert res["near"].codes.keys() == {"W_BAND_NEAR"}
    assert res["near"].band_near == [("7.5", 8.0)]
    assert "E_BAND_FAR" in res["far"].codes
    assert status == 0  # a warning never blocks publishing


def test_missing_mark_file(tree):
    tree["write"]("t2", make_set(), mark=False)
    _, res, _ = run(tree, [entry("t2")])
    assert "E_MARK" in res["t2"].codes


@pytest.mark.parametrize("mark", [[], {"essays": []}, {"essays": {"7.5": [1]}}, "text"])
def test_wrong_shape_mark_file_is_reported_and_other_sets_still_checked(tree, mark):
    tree["write"]("a_bad", make_set())
    (tree["src"] / "a_bad.mark.json").write_text(json.dumps(mark), encoding="utf-8")
    tree["write"]("b_ok", make_set())
    _, res, lines = run(tree, [entry("a_bad"), entry("b_ok")])
    assert res["a_bad"].codes.keys() & {"E_MARK", "E_BAND_FAR"}
    assert res["b_ok"].codes == {}
    assert any(line.startswith("SETS 2") for line in lines)


@pytest.mark.parametrize("value", [5, "x", {"before": "a"}])
def test_delta_that_is_not_a_list_is_reported(tree, value):
    data = make_set()
    data["delta_75_70"] = value
    tree["write"]("a_bad", data)
    tree["write"]("b_ok", make_set())
    _, res, _ = run(tree, [entry("a_bad"), entry("b_ok")])
    assert "E_PARSE" in res["a_bad"].codes
    assert res["b_ok"].codes == {}


@pytest.mark.parametrize("mutate", [
    lambda d: d.update(justification=[]),
    lambda d: d["justification"].update(by_criterion={"TR": 1}),
    lambda d: d["justification"]["by_criterion"][0].update(jumps=5),
])
def test_wrong_shape_justification_is_a_missing_pair(tree, mutate):
    data = make_set()
    mutate(data)
    tree["write"]("t2", data)
    _, res, _ = run(tree, [entry("t2")])
    assert "E_PAIR" in res["t2"].codes


def test_set_that_is_not_an_object_is_reported(tree):
    (tree["src"] / "a_bad.json").write_text("[1, 2]", encoding="utf-8")
    (tree["src"] / "a_bad.mark.json").write_text(json.dumps(make_mark()), encoding="utf-8")
    tree["write"]("b_ok", make_set())
    _, res, _ = run(tree, [entry("a_bad"), entry("b_ok")])
    assert "E_PARSE" in res["a_bad"].codes
    assert res["b_ok"].codes == {}


def test_unparsable_set(tree):
    (tree["src"] / "bad.json").write_text("{nope", encoding="utf-8")
    _, res, _ = run(tree, [])
    assert res["bad"].codes.keys() == {"E_PARSE"}


def test_delta_match_normalises_quotes_and_spaces(tree):
    data = make_set()
    data["essays"]["7.5"]["text"] = "Remote  work offers flexibility that ‘many’ value."
    data["delta_75_70"][0]["before"] = "Remote work offers flexibility that 'many'"
    tree["write"]("t2", data)
    _, res, _ = run(tree, [entry("t2")])
    assert "W_DELTA_MATCH" not in res["t2"].codes
    data["delta_70_60"][0]["after"] = "text that is not in the essay"
    tree["write"]("t2", data)
    _, res, _ = run(tree, [entry("t2")])
    assert res["t2"].codes.keys() == {"W_DELTA_MATCH"}


def test_hash_ignores_key_order_and_internal_notes(tree):
    a = make_set()
    b = json.loads(json.dumps(a, sort_keys=True))
    b["prompt"]["difficulty_notes"] = "changed note"
    b["justification"]["integrity_check"] = {"ok": False}
    assert iws.content_hash(a) == iws.content_hash(b)
    b["essays"]["7.0"]["text"] += " More."
    assert iws.content_hash(a) != iws.content_hash(b)


def test_changed_source_after_review_blocks(tree):
    data = make_set()
    tree["write"]("t2", data)
    good = iws.content_hash(data)
    _, res, _ = run(tree, [entry("t2", content_hash=good, publish=True)])
    assert "W_HASH" not in res["t2"].codes
    status, res, lines = run(tree, [entry("t2", content_hash="0" * 64, publish=True)])
    assert "W_HASH" in res["t2"].codes and status == 1
    assert "BLOCKED_PUBLISH t2" in lines


def test_manifest_shape_problems_fail_the_check(tree):
    tree["write"]("t2", make_set())
    status, _, lines = run(tree, [entry("t2"), entry("t2"), entry("ghost"),
                                  entry("t2x", publish="yes"), {"slug": "x"}])
    assert status == 1
    joined = "\n".join(lines)
    for text in ("t2: listed twice", "ghost: no such set", "entry 4: no source_key"):
        assert text in joined


def test_ielts_round_matches_pipeline_rule():
    assert iws.ielts_round(Fraction(625, 100)) == 6.5
    assert iws.ielts_round(Fraction(6125, 1000)) == 6.0
    assert iws.ielts_round(Fraction(675, 100)) == 7.0
    assert iws.ielts_round(7.0) == 7.0


@pytest.mark.parametrize("url", ["", "https://prodref0000000000000.supabase.co", "http://localhost:54321"])
def test_database_modes_refuse_anything_but_staging(tree, monkeypatch, url):
    from scripts import _script_env
    monkeypatch.setattr(_script_env, "load_env", lambda *a, **k: None)
    monkeypatch.setenv("SUPABASE_URL", url)
    for extra in ([], ["--execute"]):
        with pytest.raises(SystemExit, match="is not staging"):
            iws.main(["--source", str(tree["src"]), *extra])


def test_database_modes_do_not_take_check_only_flags(tree, capsys):
    assert iws.main(["--source", str(tree["src"]), "--band-csv", "/tmp/x.csv"]) == 2
    assert "go with --check" in capsys.readouterr().err


def test_main_says_execute_is_ignored_with_check(tree, capsys):
    tree["write"]("t2", make_set())
    man = tree["man_dir"] / "m.json"
    man.write_text(json.dumps([entry("t2")]), encoding="utf-8")
    topics = tree["man_dir"] / "topics.json"
    topics.write_text(json.dumps(TOPICS), encoding="utf-8")
    iws.main(["--check", "--execute", "--source", str(tree["src"]), "--manifest", str(man),
              "--topics", str(topics)])
    assert "--check runs alone and nothing is written" in capsys.readouterr().err


def test_main_check_writes_csv_and_hashes(tree, tmp_path):
    scores = {b: {c: float(b) for c in iws.CRITERIA} for b in iws.BANDS}
    scores["6.0"]["TR"] = 7.0  # 6.25 → 6.5
    tree["write"]("t2", make_set(), make_mark(scores))
    manifest = tree["man_dir"] / "m.json"
    manifest.write_text(json.dumps([entry("t2")]), encoding="utf-8")
    topics = tree["man_dir"] / "topics.json"
    topics.write_text(json.dumps(TOPICS), encoding="utf-8")
    out = tmp_path / "near.csv"
    rc = iws.main(["--check", "--source", str(tree["src"]), "--manifest", str(manifest),
                   "--topics", str(topics), "--figures", str(tree["figures"]),
                   "--band-csv", str(out), "--write-hashes"])
    assert rc == 0
    assert out.read_text(encoding="utf-8").splitlines() == [
        "source_key,label_band,estimated_band", "t2,6.0,6.5"]
    saved = json.loads(manifest.read_text(encoding="utf-8"))
    assert saved[0]["content_hash"] == iws.content_hash(make_set())


# ── dry run and --execute against an in-memory store ────────────────────────

class FakeStore:
    """Stand-in for the service-role client: rows kept as plain dicts, JSON
    columns as Python objects, as supabase-py returns them."""

    def __init__(self, rows=(), topics=(), history=()):
        self.rows = {r["id"]: copy.deepcopy(r) for r in rows}
        self.history = [dict(h) for h in history]
        self.topics = {t["slug"]: copy.deepcopy(t) for t in topics}
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.writes: list[tuple] = []
        self.fail_on: set[str] = set()
        self._next = 0

    def list_topics(self):
        return [copy.deepcopy(t) for t in self.topics.values()]

    def list_samples(self):
        return [copy.deepcopy(r) for r in self.rows.values()]

    def list_slug_history(self):
        return [dict(h) for h in self.history]

    def upsert_topics(self, rows):
        self.writes.append(("topics", [r["slug"] for r in rows]))
        for r in rows:
            self.topics[r["slug"]] = copy.deepcopy(r)

    def insert(self, row):
        if row["source_key"] in self.fail_on:
            raise RuntimeError("insert refused")
        self._next += 1
        self.writes.append(("insert", row["source_key"]))
        self.rows[f"id-{self._next}"] = {"id": f"id-{self._next}", **copy.deepcopy(row)}

    def update(self, row_id, patch):
        if self.rows[row_id]["source_key"] in self.fail_on:
            raise RuntimeError("update refused")
        self.writes.append(("update", self.rows[row_id]["source_key"], sorted(patch)))
        self.rows[row_id].update(copy.deepcopy(patch))

    def upload_figure(self, path, data, content_type):
        self.writes.append(("upload", path))
        self.objects[path] = (data, content_type)


class FakeBatchModule:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def start(self, **kw):
        self.calls.append(("start", kw))
        return "batch-1"

    def add_item(self, batch, **kw):
        if self.fail:
            raise RuntimeError("batch table missing")
        self.calls.append(("add_item", batch, kw))

    def finish(self, batch, counts, error_report_path):
        self.calls.append(("finish", batch, counts, error_report_path))


NOW = "2026-11-23T10:00:00+00:00"


def do_import(tree, manifest, store, *, execute=False, topics=TOPICS, batch=None):
    lines: list[str] = []
    log = iws.BatchLog(batch, lines.append) if batch is not False else iws.BatchLog(None, lines.append)
    status = iws.run_import(store, tree["src"], manifest, topics, manifest_dir=tree["man_dir"],
                            figures=tree["figures"], execute=execute, out=lines.append,
                            batch_log=log, now=NOW)
    return status, lines


def by_key(store):
    return {r["source_key"]: r for r in store.rows.values()}


def two_sets(tree):
    tree["write"]("t2", make_set())
    tree["write"]("t1", make_set("task1"))
    return [entry("t2", publish=True, review=APPROVED), entry("t1")]


def test_not_approved_publish_is_blocked(tree):
    for key in ("unsigned", "pending", "signed"):
        tree["write"](key, make_set())
    status, res, lines = run(tree, [
        entry("unsigned", publish=True, review={"status": "approved", "by": "andy", "at": None}),
        entry("pending", publish=True, review={"status": "needs_review", "by": "andy", "at": "2026-11-20"}),
        entry("signed", publish=True, review=APPROVED),
    ])
    assert res["unsigned"].codes == {"E_NOT_APPROVED": "publish without review.at"}
    assert "E_NOT_APPROVED" in res["pending"].codes
    assert res["signed"].codes == {}
    assert status == 1 and "BLOCKED_PUBLISH pending" in lines
    # A draft never needs the signature.
    status, res, _ = run(tree, [entry("unsigned"), entry("pending"), entry("signed")])
    assert status == 0 and not any("E_NOT_APPROVED" in r.codes for r in res.values())


def test_dry_run_plans_and_writes_nothing(tree):
    store = FakeStore()
    status, lines = do_import(tree, two_sets(tree), store)
    assert status == 0 and store.writes == [] and store.objects == {}
    assert "INSERT t1" in lines and "INSERT t2" in lines
    assert any(l.startswith("TOPIC work ") for l in lines)
    assert 'PLAN {"insert": 2, "update": 0, "unpublish": 0, "skip": 0, "topics": 1}' in lines
    assert "DRY RUN: nothing written. Add --execute to apply." in lines


def test_execute_writes_the_imported_view_and_reads_it_back(tree):
    manifest = two_sets(tree)
    manifest[1]["overrides"] = {"justification_jumps": {"LR": [{"pair": "6.0->6.5", "changes": [{"x": 1}]}]}}
    store = FakeStore()
    status, lines = do_import(tree, manifest, store, execute=True)
    assert status == 0, lines
    assert lines[-1] == "EXECUTE done: the database matches the plan"
    # Topics first (the samples point to them), with the shelf as an array.
    assert store.writes[0] == ("topics", ["work"])
    assert store.topics["work"] == {"slug": "work", "label_vi": "Công việc", "shelves": ["writing"], "display_order": 1}
    rows = by_key(store)
    t2, t1 = rows["t2"], rows["t1"]
    assert t2["published"] is True and t2["published_at"] == NOW and t2["updated_at"] == NOW
    assert t1["published"] is False and t1["published_at"] is None
    assert (t2["task_type"], t2["question_type"], t2["task1_subtype"]) == ("task2", "advantages_disadvantages", None)
    assert (t1["task_type"], t1["question_type"], t1["task1_subtype"]) == ("task1_academic", None, "bar")
    assert t1["task1_data"] == {"type": "bar", "title": "t", "numbers": [1, 2]} and t2["task1_data"] is None
    assert t2["source_review_status"] == "revised_20261017"
    assert t2["content_hash"] == iws.content_hash(make_set())
    # Internal notes never reach the table.
    dumped = json.dumps(list(rows.values()))
    for internal in ("difficulty_notes", "integrity_check", "domain", '"note"'):
        assert internal not in dumped
    assert set(t2["essays"]["7.5"]) == {"text", "word_count", "outline", "vocab_table", "structures"}
    # The override pair is merged into the stored justification.
    lr = next(b for b in t1["justification"]["by_criterion"] if b["criterion"] == "LR")
    assert [j["pair"] for j in lr["jumps"]] == ["6.0->7.0", "7.0->7.5", "6.0->6.5"]
    # The Task 1 figure is in the private bucket under a digest path; the row keeps the path.
    path = t1["prompt_image_path"]
    assert path.startswith("writing/t1/figure-") and path.endswith(".png")
    assert store.objects[path] == (PNG, "image/png") and t2["prompt_image_path"] is None


def test_a_second_run_changes_nothing(tree):
    manifest = two_sets(tree)
    store = FakeStore()
    do_import(tree, manifest, store, execute=True)
    store.writes.clear()
    status, lines = do_import(tree, manifest, store, execute=True)
    assert status == 0 and store.writes == []
    assert 'PLAN {"insert": 0, "update": 0, "unpublish": 0, "skip": 2, "topics": 0}' in lines


def test_content_change_updates_and_moves_updated_at(tree):
    manifest = two_sets(tree)
    store = FakeStore()
    do_import(tree, manifest, store, execute=True)
    changed = make_set()
    changed["prompt"]["text"] = "Some people work from home. Discuss both views."
    tree["write"]("t2", changed)
    later = "2026-11-24T00:00:00+00:00"
    store.writes.clear()
    lines: list[str] = []
    status = iws.run_import(store, tree["src"], manifest, TOPICS, manifest_dir=tree["man_dir"],
                            figures=tree["figures"], execute=True, out=lines.append,
                            batch_log=iws.BatchLog(None, lines.append), now=later)
    assert status == 0
    assert store.writes == [("update", "t2", ["content_hash", "prompt_text", "updated_at"])]
    t2 = by_key(store)["t2"]
    assert t2["updated_at"] == later and t2["published_at"] == NOW  # first publish date kept


def test_publishing_later_sets_published_at_but_not_updated_at(tree):
    manifest = two_sets(tree)
    store = FakeStore()
    do_import(tree, manifest, store, execute=True)
    manifest[1].update(publish=True, review=APPROVED)
    store.writes.clear()
    status, _ = do_import(tree, manifest, store, execute=True)
    assert status == 0
    assert store.writes == [("update", "t1", ["published", "published_at"])]
    assert by_key(store)["t1"]["updated_at"] == NOW


def test_unpublish_when_the_manifest_says_so_or_the_set_is_now_blocked(tree):
    manifest = two_sets(tree)
    manifest[1].update(publish=True, review=APPROVED)
    store = FakeStore()
    do_import(tree, manifest, store, execute=True)
    # t2 taken off by the manifest; t1's source changes after review (W_HASH blocks it).
    manifest[0]["publish"] = False
    manifest[1]["content_hash"] = iws.content_hash(make_set("task1"))
    manifest[1]["publish"] = False  # a blocked set may not stay marked publish under --execute
    changed = make_set("task1")
    changed["prompt"]["text"] = "A different chart."
    tree["write"]("t1", changed)
    store.writes.clear()
    status, lines = do_import(tree, manifest, store, execute=True)
    assert status == 0, lines
    assert "UNPUBLISH t2 (published)" in lines
    assert "UNPUBLISH t1 (W_HASH)" in lines
    rows = by_key(store)
    assert rows["t2"]["published"] is False and rows["t1"]["published"] is False
    # A blocked set is only switched off, never rewritten.
    assert rows["t1"]["prompt_text"] == "Some people work from home. Discuss."
    assert ("update", "t1", ["published"]) in store.writes


def test_execute_is_refused_while_a_publish_set_is_blocked(tree):
    tree["write"]("t2", make_set())
    store = FakeStore()
    status, lines = do_import(tree, [entry("t2", publish=True, review=APPROVED, topic_slug="nowhere")],
                              store, execute=True)
    assert status == 1 and store.writes == []
    assert "REFUSED --execute: fix the manifest problems or the blocked publish sets above first" in lines


def test_dry_run_still_shows_the_plan_when_blocked(tree):
    tree["write"]("t2", make_set())
    status, lines = do_import(tree, [entry("t2", publish=True, review=APPROVED, topic_slug="nowhere")], FakeStore())
    assert status == 1
    assert "SKIP t2 (E_TOPIC)" in lines


def test_slug_stays_after_first_publish(tree):
    manifest = two_sets(tree)
    store = FakeStore()
    do_import(tree, manifest, store, execute=True)
    manifest[0]["slug"] = "a-new-name"
    store.writes.clear()
    status, lines = do_import(tree, manifest, store, execute=True)
    assert status == 0
    assert by_key(store)["t2"]["slug"] == "t2" and store.writes == []
    assert any("slug stays 't2'" in l for l in lines)
    # Before the first publish a slug may still change.
    manifest[1]["slug"] = "renamed-draft"
    status, _ = do_import(tree, manifest, store, execute=True)
    assert status == 0 and by_key(store)["t1"]["slug"] == "renamed-draft"


def test_orphan_rows_are_reported_and_left_alone_and_their_slug_is_not_taken(tree):
    tree["write"]("t2", make_set())
    orphan = {"id": "old", "source_key": "gone", "slug": "t2", "published": True, "published_at": NOW}
    store = FakeStore(rows=[orphan])
    status, lines = do_import(tree, [entry("t2", publish=True, review=APPROVED)], store, execute=True)
    assert status == 1 and "SLUG_CONFLICT 1 set(s) not imported: t2" in lines
    assert "ORPHAN gone (published=True; not a source set, left alone)" in lines
    assert "SKIP t2 (slug 't2' is held by row 'gone')" in lines
    assert store.rows["old"] == orphan and len(store.rows) == 1


def test_a_failed_write_is_named_the_rest_land_and_the_run_fails(tree):
    manifest = two_sets(tree)
    store = FakeStore()
    store.fail_on.add("t1")
    status, lines = do_import(tree, manifest, store, execute=True)
    assert status == 1
    assert "FAILED t1: RuntimeError: insert refused" in lines
    assert "NOT_APPLIED insert t1" in lines
    assert lines[-1] == "EXECUTE incomplete: 1 failed, 1 not applied, 0 slug conflict(s)"
    assert set(by_key(store)) == {"t2"}


def test_topic_upsert_keeps_a_speaking_shelf(tree):
    store = FakeStore(topics=[{"slug": "work", "label_vi": "Việc", "shelves": ["speaking"], "display_order": 9}])
    assert iws.plan_topics(TOPICS, store.list_topics()) == [
        {"slug": "work", "label_vi": "Công việc", "shelves": ["speaking", "writing"], "display_order": 1}]
    same = [{"slug": "work", "label_vi": "Công việc", "shelves": ["writing"], "display_order": 1}]
    assert iws.plan_topics(TOPICS, same) == []


def test_batch_log_records_execute_only(tree):
    manifest = two_sets(tree)
    module = FakeBatchModule()
    do_import(tree, manifest, FakeStore(), batch=module)
    assert module.calls == []  # dry run: no batch
    do_import(tree, manifest, FakeStore(), execute=True, batch=module)
    assert module.calls[0] == ("start", {"script": "import_writing_samples", "skill": "writing", "mode": "execute"})
    items = [c[2] for c in module.calls if c[0] == "add_item"]
    assert {(i["kind"], i["id"], i["action"]) for i in items} == {("writing_sample", "t2", "insert"),
                                                                  ("writing_sample", "t1", "insert")}
    assert module.calls[-1][0] == "finish" and module.calls[-1][2]["failed"] == 0


def test_a_failing_batch_log_never_fails_the_import(tree):
    status, lines = do_import(tree, two_sets(tree), FakeStore(), execute=True, batch=FakeBatchModule(fail=True))
    assert status == 0
    assert any(l.startswith("WARNING batch log add_item failed") for l in lines)


def test_missing_batch_helper_warns_once_and_imports(tree, monkeypatch):
    import builtins
    real_import = builtins.__import__

    def no_helper(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "services" and fromlist and "import_batch_log" in fromlist:
            raise ImportError("no import_batch_log")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", no_helper)
    lines: list[str] = []
    log = iws.BatchLog.load(lines.append)
    status = iws.run_import(FakeStore(), tree["src"], two_sets(tree), TOPICS, manifest_dir=tree["man_dir"],
                            figures=tree["figures"], execute=True, out=lines.append, batch_log=log, now=NOW)
    assert status == 0
    assert sum(l.startswith("WARNING batch log unavailable") for l in lines) == 1


def test_figure_path_is_stable_and_safe():
    a, ctype = iws.figure_object("t1", PNG)
    assert iws.figure_object("t1", PNG) == (a, ctype) and ctype == "image/png"
    assert iws.figure_object("t1", PNG + b"\x01")[0] != a
    odd, _ = iws.figure_object("../x y", PNG)
    assert ".." not in odd and " " not in odd
    webp = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 8
    assert iws.figure_object("t1", webp) [0].endswith(".webp")


@pytest.mark.parametrize("url,ok", [
    (f"https://{iws.STAGING_PROJECT_REF}.supabase.co", True),
    (f"https://{iws.STAGING_PROJECT_REF}.supabase.co/rest/v1", True),
    ("https://otherref.supabase.co", False),
    (f"https://{iws.STAGING_PROJECT_REF}.supabase.co.evil.example", False),
    ("", False),
])
def test_assert_staging(url, ok):
    if ok:
        iws.assert_staging(url)
    else:
        with pytest.raises(SystemExit):
            iws.assert_staging(url)


def test_a_former_slug_in_the_308_history_is_never_reused(tree):
    # "renamed" was published as old-name, then renamed in /admin/library;
    # old-name now answers 308 to it. A new set may not take old-name.
    tree["write"]("renamed", make_set())
    tree["write"]("newcomer", make_set())
    live = {"id": "r1", "source_key": "renamed", "slug": "new-name", "published": True, "published_at": NOW}
    store = FakeStore(rows=[live], history=[{"old_slug": "old-name", "sample_id": "r1"}])
    manifest = [entry("renamed", slug="new-name", publish=True, review=APPROVED),
                entry("newcomer", slug="old-name", publish=True, review=APPROVED)]
    # The dry run shows the refusal and fails, so the manifest gets fixed first.
    status, dry = do_import(tree, manifest, store)
    assert status == 1
    assert "SKIP newcomer (slug 'old-name' is a former slug of 'renamed' (308 history); choose another)" in dry
    assert "SLUG_CONFLICT 1 set(s) not imported: newcomer" in dry
    status, lines = do_import(tree, manifest, store, execute=True)
    assert status == 1 and "newcomer" not in by_key(store)
    assert lines[-1] == "EXECUTE incomplete: 0 failed, 0 not applied, 1 slug conflict(s)"
    # The renamed set itself is untouched apart from its content columns.
    assert by_key(store)["renamed"]["slug"] == "new-name" and by_key(store)["renamed"]["published"] is True
