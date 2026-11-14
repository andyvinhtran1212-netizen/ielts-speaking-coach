"""Offline contract tests using invented prompts and locally generated silence."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import uuid
from copy import deepcopy
from pathlib import Path

import pytest
import yaml

from scripts import build_listening_exercise_book as builder
from services.listening_package_import import build_import_plan, discover_packages


@pytest.fixture
def book(tmp_path):
    source = tmp_path / "source"
    shutil.copytree(Path(builder.__file__).parent / "examples/exercise-book", source)
    audio = source / "silence.mp3"
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
        "anullsrc=r=24000:cl=mono", "-t", "0.2", "-c:a", "libmp3lame", str(audio),
    ], check=True, capture_output=True)
    path = source / "manifest.yaml"
    manifest = load(path)
    for activity in manifest["units"][0]["activities"]:
        activity["audio"]["sha256"] = hashlib.sha256(audio.read_bytes()).hexdigest()
    save(path, manifest)
    return path, tmp_path / "release"


def save(path, manifest):
    path.write_text(yaml.safe_dump(manifest, sort_keys=False))


def load(path):
    return yaml.safe_load(path.read_text())


def tree(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_deterministic_package_and_real_importer_handoff(book, monkeypatch):
    path, output = book
    monkeypatch.setattr(socket.socket, "connect", lambda *args: pytest.fail("network attempted"))
    calls = []
    run = builder.subprocess.run

    def observed(command, **kwargs):
        calls.append(command)
        return run(command, **kwargs)

    monkeypatch.setattr(builder.subprocess, "run", observed)
    first = builder.build_book(path, output)
    manifest_bytes = path.read_bytes()
    second_output = output.with_name("second-release")
    second = builder.build_book(path, second_output)
    assert tree(output) == tree(second_output)
    assert path.read_bytes() == manifest_bytes
    assert first["package_id"] == second["package_id"]
    assert "DRY RUN PASS" in first["dry_run"]
    assert any(Path(c[1]).name == "import_listening_content_package.py" and
               "--release-root" in c and not ({"--commit", "--publish", "--archive"} & set(c))
               for c in calls if len(c) > 1)
    plan = build_import_plan(discover_packages(output)[0])
    assert plan.report["dry_run_mutations"] == 0
    assert plan.report["counts"]["lessons"] == 1
    assert plan.report["counts"]["forms"] == 2
    assert plan.report["self_review_items"] == 2
    assert plan.report["objective_items"] == 1
    package = plan.location.package_root
    public = json.loads((package / "learner/content/lessons/u1.json").read_text())
    assert [q["interaction"] for q in public["items"]] == ["text", "keep_change", "mcq"]
    assert [q["policy_revision"] for q in public["items"]] == ["selfcheck-v1", "selfcheck-v1", "auto-v1"]
    assert "purple" not in (package / "learner/content/lessons/u1.json").read_text()
    assert all(b"answer_set_revision" not in data for name, data in tree(package).items()
               if name.startswith("learner/") and name.endswith(".json"))
    assert json.loads((package / "protected/exercise-book-manifest.json").read_text()) == load(path)


def test_uuid_generated_once_only_for_approved_answer_set(book):
    path, output = book
    manifest = load(path)
    del manifest["units"][0]["activities"][0]["answer_set_revision"]
    save(path, manifest)
    builder.build_book(path, output)
    first = load(path)
    revision = first["units"][0]["activities"][0]["answer_set_revision"]
    assert uuid.UUID(revision).version == 4
    builder.build_book(path, output.with_name("again"))
    assert load(path) == first


def test_content_revision_changes_and_new_package_per_revision(book):
    path, output = book
    first = builder.build_book(path, output)
    original = load(path)
    unit = original["units"][0]
    revision = unit["content_revision"]
    assert re.fullmatch(r"demo-book-u1-content-v1-[0-9a-f]{12}", revision)
    item_path = path.parent / "text-item.json"
    item = json.loads(item_path.read_text())
    item["prompt"] = "A revised invented prompt."
    item_path.write_text(json.dumps(item))
    unit["content_version"] = 2
    save(path, original)
    second = builder.build_book(path, output.with_name("v2"))
    changed = load(path)["units"][0]
    assert changed["content_revision"].startswith("demo-book-u1-content-v2-")
    assert changed["content_revision"] != revision
    assert changed["activities"][0]["answer_set_revision"] == unit["activities"][0]["answer_set_revision"]
    assert second["package_id"] != first["package_id"]


def test_answer_changes_cannot_reuse_bound_revision(book):
    path, output = book
    builder.build_book(path, output)
    item_path = path.parent / "text-item.json"
    item = json.loads(item_path.read_text())
    item["answers"] = ["orange"]
    item_path.write_text(json.dumps(item))
    before = path.read_bytes()
    with pytest.raises(builder.PackageValidationError, match="Approved answer set changed"):
        builder.build_book(path, output.with_name("bad"))
    assert path.read_bytes() == before
    manifest = load(path)
    activity = manifest["units"][0]["activities"][0]
    new_uuid = str(uuid.uuid4())
    activity["answer_set_revision"] = new_uuid
    del activity["answer_set_sha256"]
    save(path, manifest)
    builder.build_book(path, output.with_name("approved-v2"))
    assert load(path)["units"][0]["activities"][0]["answer_set_revision"] == new_uuid


@pytest.mark.parametrize(("failure", "expected"), [
    ("missing_id", "question_id"), ("duplicate_id", "Duplicate question_id"),
    ("sha", "audio SHA-256 mismatch"), ("interaction", "unknown interaction type"),
    ("missing_mode", "scoring_mode"), ("invalid_mode", "scoring_mode"),
    ("uuid", "UUID v4"), ("unapproved", "must be approved"),
    ("missing_content", "Missing or unsafe source file"),
    ("traversal", "Unsafe source path"), ("auto_text", "not supported by importer 295"),
])
def test_validation_errors_are_nonzero_and_leave_no_output(book, failure, expected, capsys):
    path, output = book
    manifest = load(path)
    activity = manifest["units"][0]["activities"][0]
    item = activity["items"][0]
    if failure == "missing_id":
        del item["question_id"]
    elif failure == "duplicate_id":
        manifest["units"][0]["activities"][1]["items"][0]["question_id"] = item["question_id"]
    elif failure == "sha":
        activity["audio"]["sha256"] = "0" * 64
    elif failure == "interaction":
        item["interaction"] = "telepathy"
    elif failure == "missing_mode":
        del item["scoring_mode"]
    elif failure == "invalid_mode":
        item["scoring_mode"] = "SELF-CHECK"
    elif failure == "uuid":
        activity["answer_set_revision"] = str(uuid.uuid1())
    elif failure == "unapproved":
        activity["answer_set_status"] = "draft"
    elif failure == "missing_content":
        item["content_file"] = "missing.json"
    elif failure == "traversal":
        item["content_file"] = "../outside.json"
    elif failure == "auto_text":
        item["scoring_mode"] = "AUTO"
    save(path, manifest)
    before = path.read_bytes()
    assert builder.main(["--manifest", str(path), "--output", str(output)]) == 2
    assert expected in capsys.readouterr().err
    assert path.read_bytes() == before
    assert not output.exists()
    assert not list(output.parent.glob("exercise-book-*"))


def test_importer_validation_failure_is_fatal(book, capsys):
    path, output = book
    content = path.parent / "choice-item.json"
    item = json.loads(content.read_text())
    item["answers"] = ["Z"]
    content.write_text(json.dumps(item))
    before = path.read_bytes()
    assert builder.main(["--manifest", str(path), "--output", str(output)]) == 2
    assert "Importer dry-run failed" in capsys.readouterr().err
    assert path.read_bytes() == before
    assert not output.exists()
    assert not list(output.parent.glob("exercise-book-*"))


def test_existing_output_is_never_overwritten(book):
    path, output = book
    builder.build_book(path, output)
    before = tree(output)
    with pytest.raises(builder.PackageValidationError, match="new directory"):
        builder.build_book(path, output)
    assert tree(output) == before


@pytest.mark.parametrize("change", ["transcript", "policy", "audio"])
def test_revision_hash_binds_all_source_layers(book, change):
    path, output = book
    first = builder.build_book(path, output)
    manifest = load(path)
    activity = manifest["units"][0]["activities"][0]
    revision = manifest["units"][0]["content_revision"]
    if change == "transcript":
        (path.parent / activity["transcript_file"]).write_text("Another invented transcript.")
    elif change == "policy":
        activity["items"][1]["scoring_mode"] = "AUTO"
    else:
        audio = path.parent / activity["audio"]["path"]
        subprocess.run([
            "ffmpeg", "-y", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
            "anullsrc=r=24000:cl=mono", "-t", "0.4", "-c:a", "libmp3lame", str(audio),
        ], check=True, capture_output=True)
        for row in manifest["units"][0]["activities"]:
            row["audio"]["sha256"] = hashlib.sha256(audio.read_bytes()).hexdigest()
    save(path, manifest)
    second = builder.build_book(path, output.with_name("changed"))
    assert load(path)["units"][0]["content_revision"] != revision
    assert second["package_id"] != first["package_id"]


def test_cli_runs_without_database_configuration(book):
    path, output = book
    env = {k: v for k, v in os.environ.items() if not k.startswith(("SUPABASE", "DATABASE", "PG"))}
    result = subprocess.run([
        sys.executable, builder.__file__, "--manifest", str(path), "--output", str(output),
    ], capture_output=True, text=True, env=env)
    assert result.returncode == 0, result.stderr
    assert "DRY RUN PASS" in result.stdout


def test_another_book_with_multiple_units_has_no_book_specific_paths(book):
    path, output = book
    manifest = load(path)
    manifest["book"] = "another-book"
    manifest["programme_id"] = "another-programme"
    unit = deepcopy(manifest["units"][0])
    unit["unit"] = "u2"
    for activity in unit["activities"]:
        activity["activity"] = activity["activity"].replace("u1", "u2")
        activity["answer_set_revision"] = str(uuid.uuid4())
        for item in activity["items"]:
            item["question_id"] = item["question_id"].replace("u1", "u2")
    manifest["units"].append(unit)
    save(path, manifest)
    builder.build_book(path, output)
    plan = build_import_plan(discover_packages(output)[0])
    assert plan.location.programme_id == "another-programme"
    assert plan.report["counts"]["lessons"] == 2
    assert plan.report["counts"]["forms"] == 4
    assert all(u["content_revision"].startswith(f"another-book-{u['unit']}-content-v1-")
               for u in load(path)["units"])
