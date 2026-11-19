"""G06-T03: ``--check`` of the Writing sample importer (no database).

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


def run(tree, manifest, topics=TOPICS, figures=True):
    lines: list[str] = []
    status, results = iws.run_check(tree["src"], manifest, topics, manifest_dir=tree["man_dir"],
                                    figures=tree["figures"] if figures else None, out=lines.append)
    return status, {r.key: r for r in results}, lines


def test_clean_task2_and_task1_have_no_codes(tree):
    tree["write"]("t2_ok", make_set())
    tree["write"]("t1_ok", make_set("task1"))
    status, res, lines = run(tree, [entry("t2_ok", publish=True), entry("t1_ok", publish=True)])
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
    status, res, _ = run(tree, [entry("near", publish=True), entry("far")])
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


def test_main_refuses_non_check_modes(tree, capsys):
    assert iws.main(["--source", str(tree["src"])]) == 2
    assert iws.main(["--source", str(tree["src"]), "--execute"]) == 2
    assert "LIBRARY-0061" in capsys.readouterr().err


def test_main_says_execute_is_ignored_with_check(tree, capsys):
    tree["write"]("t2", make_set())
    man = tree["man_dir"] / "m.json"
    man.write_text(json.dumps([entry("t2")]), encoding="utf-8")
    topics = tree["man_dir"] / "topics.json"
    topics.write_text(json.dumps(TOPICS), encoding="utf-8")
    iws.main(["--check", "--execute", "--source", str(tree["src"]), "--manifest", str(man),
              "--topics", str(topics)])
    assert "--execute is not available yet and is ignored" in capsys.readouterr().err


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
