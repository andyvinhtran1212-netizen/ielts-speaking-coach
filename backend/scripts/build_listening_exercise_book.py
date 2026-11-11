#!/usr/bin/env python3
"""Build an immutable Listening release from local, approved exercise-book data."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
import wave
from copy import deepcopy
from pathlib import Path

import yaml

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from services.listening_convert import _MARKER_TO_TYPE  # noqa: E402
from services.listening_package_import import PackageValidationError  # noqa: E402

CLAIM_POLICY = "report_only_no_band_cefr_mastery_or_full_progression_claim"
# Aliases describe authored interactions, independently of legacy response types.
INTERACTIONS = frozenset(_MARKER_TO_TYPE) | {
    "text", "keep_change", "form", "table", "notes", "sentence", "mcq", "map",
}
OBJECTIVE_INTERACTIONS = {
    "mcq": "single_choice", "mcq_3option": "single_choice",
    "mcq_multi": "multiple_choice", "matching": "single_choice",
    "map": "map_label", "plan_label": "map_label", "keep_change": "single_choice",
}


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_json_bytes(value))


def _object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise PackageValidationError(f"{label}: expected an object")
    return value


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PackageValidationError(f"{label}: required non-empty string")
    return value


def _identity(value: object, label: str) -> str:
    value = _text(value, label)
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", value):
        raise PackageValidationError(f"{label}: invalid identifier {value!r}")
    return value


def _rows(value: object, label: str) -> list:
    if not isinstance(value, list) or not value:
        raise PackageValidationError(f"{label}: required non-empty list")
    return value


def _source(root: Path, raw: object) -> bytes:
    name = _text(raw, "content/audio path")
    if "\\" in name or any(part in {"", ".", ".."} for part in name.split("/")):
        raise PackageValidationError(f"Unsafe source path: {name}")
    path = root / name
    if (Path(name).is_absolute() or path.is_symlink() or not path.is_file()
            or not path.resolve().is_relative_to(root)):
        raise PackageValidationError(f"Missing or unsafe source file: {name}")
    return path.read_bytes()


def _decode_mp3(data: bytes) -> bytes:
    """Decode only in-memory MP3 bytes; never let ffmpeg resolve input URLs."""
    try:
        result = subprocess.run([
            "ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "pipe",
            "-f", "mp3", "-i", "pipe:0", "-map_metadata", "-1", "-ac", "1",
            "-ar", "24000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
        ], input=data, capture_output=True, check=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        raise PackageValidationError("MP3 decode failed (local ffmpeg required)") from exc
    if not result.stdout or len(result.stdout) % 2:
        raise PackageValidationError("MP3 decoded to empty/invalid PCM audio")
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(24000)
        target.writeframes(result.stdout)
    return output.getvalue()


def _answer_revision(activity: dict, answers: list) -> None:
    if activity.get("answer_set_status") != "approved":
        raise PackageValidationError("answer_set_status must be approved before building")
    digest = _sha(_json_bytes(answers))
    revision = activity.get("answer_set_revision")
    if revision is None:
        activity["answer_set_revision"] = str(uuid.uuid4())
    else:
        try:
            parsed = uuid.UUID(str(revision))
            if parsed.version != 4 or str(parsed) != revision:
                raise ValueError("not canonical UUID v4")
        except (ValueError, AttributeError) as exc:
            raise PackageValidationError("answer_set_revision must be a canonical UUID v4") from exc
        if activity.get("answer_set_sha256", digest) != digest:
            raise PackageValidationError(
                "Approved answer set changed: supply a new approved answer_set_revision "
                "and remove the old answer_set_sha256"
            )
    activity["answer_set_sha256"] = digest


def _prepare(manifest: dict, source_root: Path) -> tuple[list[dict], dict[str, bytes]]:
    book = _identity(manifest.get("book"), "book")
    programme = _identity(manifest.get("programme_id"), "programme_id")
    _text(manifest.get("title"), "title")
    lessons = []
    assets = {}
    seen_units, seen_activities, seen_questions, seen_answer_sets = set(), set(), set(), set()
    for unit in _rows(manifest.get("units"), "units"):
        unit = _object(unit, "unit")
        unit_id = _identity(unit.get("unit"), "unit")
        if unit_id in seen_units:
            raise PackageValidationError(f"Duplicate unit: {unit_id}")
        seen_units.add(unit_id)
        version = unit.get("content_version")
        if type(version) is not int or version < 1:
            raise PackageValidationError("content_version must be a positive integer")
        lesson = {
            "id": unit_id, "source_id": unit_id, "programme_id": programme,
            "title": _text(unit.get("title"), "unit.title"), "version": str(version),
            "claim_policy": CLAIM_POLICY, "stimuli": [], "items": [], "forms": [],
        }
        protected = {"items": [], "forms": []}
        source_hashes = {}
        for activity in _rows(unit.get("activities"), "activities"):
            activity = _object(activity, "activity")
            activity_id = _identity(activity.get("activity"), "activity")
            if activity_id in seen_activities:
                raise PackageValidationError(f"Duplicate activity: {activity_id}")
            seen_activities.add(activity_id)
            audio = _object(activity.get("audio"), f"{activity_id}.audio")
            audio_bytes = _source(source_root, audio.get("path"))
            if not str(audio.get("path", "")).lower().endswith(".mp3"):
                raise PackageValidationError(f"{activity_id}: audio path must end in .mp3")
            if _sha(audio_bytes) != audio.get("sha256"):
                raise PackageValidationError(f"{activity_id}: audio SHA-256 mismatch")
            wav = _decode_mp3(audio_bytes)
            source_hashes[audio["path"]] = _sha(audio_bytes)
            audio_path = f"learner/audio/{activity_id}.wav"
            timing_path = f"controlled-access/timing/{activity_id}.json"
            transcript_path = f"controlled-access/transcripts/{activity_id}.json"
            assets[audio_path] = wav
            transcript_bytes = _source(source_root, activity.get("transcript_file"))
            transcript = _text(transcript_bytes.decode("utf-8"), "transcript")
            source_hashes[activity["transcript_file"]] = _sha(transcript_bytes)
            with wave.open(io.BytesIO(wav), "rb") as handle:
                duration = handle.getnframes() / 24000
            segment = {"id": f"{activity_id}-transcript", "start": 0, "end": duration}
            assets[timing_path] = _json_bytes({"stimulus_id": activity_id, "segments": [segment]})
            assets[transcript_path] = _json_bytes({
                "stimulus_id": activity_id, "segments": [{**segment, "text": transcript}],
            })
            lesson["stimuli"].append({
                "id": activity_id, "audio": audio_path, "timing": timing_path,
                "controlled_transcript": transcript_path, "purpose": "practice",
            })
            item_ids, answer_set = [], []
            for item in _rows(activity.get("items"), "items"):
                item = _object(item, "item")
                qid = _identity(item.get("question_id"), "question_id")
                if qid in seen_questions:
                    raise PackageValidationError(f"Duplicate question_id: {qid}")
                seen_questions.add(qid)
                interaction = item.get("interaction")
                if not isinstance(interaction, str) or interaction not in INTERACTIONS:
                    raise PackageValidationError(f"{qid}: unknown interaction type {interaction!r}")
                mode = item.get("scoring_mode")
                if mode not in ("AUTO", "SELF_CHECK"):
                    raise PackageValidationError(f"{qid}: scoring_mode must be AUTO or SELF_CHECK")
                item["policy_revision"] = "auto-v1" if mode == "AUTO" else "selfcheck-v1"
                if mode == "AUTO" and interaction not in OBJECTIVE_INTERACTIONS:
                    raise PackageValidationError(
                        f"{qid}: AUTO {interaction} is not supported by importer 295; "
                        "use an objective interaction or SELF_CHECK"
                    )
                raw = _source(source_root, item.get("content_file"))
                source_hashes[item["content_file"]] = _sha(raw)
                content = _object(json.loads(raw), f"{qid}.content_file")
                prompt = _text(content.get("prompt"), f"{qid}.prompt")
                options = content.get("options", {})
                if not isinstance(options, dict) or any(
                    not isinstance(key, str) or not key.strip()
                    or not isinstance(value, str) or not value.strip()
                    for key, value in options.items()
                ):
                    raise PackageValidationError(f"{qid}: options must map non-empty IDs to text")
                answers = content.get("answers", [])
                alternatives = content.get("alternatives", [])
                if any(not isinstance(values, list) or any(
                    not isinstance(value, str) or not value.strip() for value in values
                ) for values in (answers, alternatives)):
                    raise PackageValidationError(f"{qid}: answers/alternatives must be lists of strings")
                rationale = content.get("rationale")
                if rationale is not None and not isinstance(rationale, str):
                    raise PackageValidationError(f"{qid}: rationale must be text")
                if not answers and not (isinstance(rationale, str) and rationale.strip()):
                    raise PackageValidationError(f"{qid}: approved answer or rationale required")
                response_type = OBJECTIVE_INTERACTIONS[interaction] if mode == "AUTO" else "short_answer"
                lesson["items"].append({
                    "id": qid, "question_id": qid, "stimulus_id": activity_id,
                    "prompt": prompt, "options": options,
                    "response_type": response_type, "interaction": interaction,
                    "scoring_mode": mode, "policy_revision": item["policy_revision"], "max_score": 1,
                })
                record = {"id": qid, "key": {
                    "answers": answers, "accepted_answers": alternatives, "rationale": rationale,
                }}
                protected["items"].append(record)
                answer_set.append(record)
                item_ids.append(qid)
            _answer_revision(activity, answer_set)
            if activity["answer_set_revision"] in seen_answer_sets:
                raise PackageValidationError("Duplicate answer_set_revision across activities")
            seen_answer_sets.add(activity["answer_set_revision"])
            form = {
                "id": activity_id, "title": _text(activity.get("title"), "activity.title"),
                "scoring_policy": "report_only", "purpose": "practice",
                "replay_policy": "allowed", "support_policy": "available",
                "item_ids": item_ids, "item_count": len(item_ids), "max_score": len(item_ids),
            }
            lesson["forms"].append(form)
            protected["forms"].append({
                **form, "stimulus_ids": [activity_id],
                "answer_set_revision": activity["answer_set_revision"],
            })
        digest = _sha(_json_bytes({
            "book": book, "lesson": lesson, "protected": protected, "source_hashes": source_hashes,
            "unit": {key: value for key, value in unit.items() if key != "content_revision"},
            "audio_hashes": {s["id"]: _sha(assets[s["audio"]]) for s in lesson["stimuli"]},
        }))
        unit["content_revision"] = f"{book}-{unit_id}-content-v{version}-{digest[:12]}"
        lesson["content_revision"] = unit["content_revision"]
        assets[f"learner/content/lessons/{unit_id}.json"] = _json_bytes(lesson)
        assets[f"protected/source-lessons/{unit_id}.json"] = _json_bytes(protected)
        lessons.append(lesson)
    return lessons, assets


def _dry_run(root: Path, package_id: str) -> str:
    result = subprocess.run([
        sys.executable, str(_BACKEND / "scripts/import_listening_content_package.py"),
        "--release-root", str(root), "--package", package_id,
    ], capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise PackageValidationError(f"Importer dry-run failed:\n{result.stderr or result.stdout}")
    return result.stdout


def build_book(manifest_path: Path, output_root: Path) -> dict:
    """Validate in a temporary directory, then persist revisions and expose output.

    Only the input YAML and a new output directory are written. No database,
    credentials, remote audio or publication actions are involved.
    """
    if manifest_path.is_symlink():
        raise PackageValidationError("Manifest must not be a symlink")
    manifest_path = manifest_path.resolve(strict=True)
    original = manifest_path.read_bytes()
    manifest = deepcopy(_object(yaml.safe_load(original), "manifest"))
    if output_root.is_symlink() or output_root.exists() or not output_root.parent.is_dir():
        raise PackageValidationError("Output must be a new directory in an existing parent")
    output_root = output_root.resolve()
    lessons, assets = _prepare(manifest, manifest_path.parent)
    package_digest = _sha(_json_bytes({
        key: value for key, value in manifest.items() if key != "package_id"
    }))
    manifest["package_id"] = f"{manifest['book']}-package-{package_digest[:12]}"
    package_id = manifest["package_id"]
    with tempfile.TemporaryDirectory(prefix="exercise-book-", dir=output_root.parent) as temporary:
        candidate = Path(temporary) / "release"
        package = candidate / manifest["programme_id"] / "packages" / package_id
        for relative, data in assets.items():
            target = package / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        _write_json(package / "learner/index.json", {
            "title": manifest["title"], "lesson_ids": [lesson["id"] for lesson in lessons],
        })
        _write_json(package / "protected/exercise-book-manifest.json", manifest)
        activity_count = sum(len(lesson["forms"]) for lesson in lessons)
        _write_json(package / "manifest.json", {
            "package_id": package_id, "programme_id": manifest["programme_id"], "learner_ready": True,
            "payload_boundaries": {"public": "learner/", "conditional_accessibility": "controlled-access/",
                                   "server_or_audit_only": "protected/"},
            "counts": {"lessons": len(lessons), "forms": activity_count,
                       "items": sum(len(lesson["items"]) for lesson in lessons),
                       "stimuli": activity_count, "audio": activity_count, "timing": activity_count, "visuals": 0},
            "artifact_hashes": {p.relative_to(package).as_posix(): _sha(p.read_bytes())
                                for p in sorted(package.rglob("*")) if p.is_file()},
        })
        _write_json(candidate / "release-index.json", {
            "learner_ready_packages": 1, "programmes": [{
                "id": manifest["programme_id"], "path": manifest["programme_id"],
                "packages": [{"package_id": package_id, "path": f"packages/{package_id}",
                              "learner_ready": True, "manifest_sha256": _sha((package / "manifest.json").read_bytes())}],
            }],
        })
        report = _dry_run(candidate, package_id)
        # Failed validation never allocates a persisted UUID or exposes a partial package.
        if manifest_path.read_bytes() != original:
            raise PackageValidationError("Manifest changed during build; refusing to overwrite")
        updated = yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False).encode()
        if yaml.safe_load(original) != manifest:
            with tempfile.NamedTemporaryFile(dir=manifest_path.parent, delete=False) as handle:
                pending = Path(handle.name)
                try:
                    handle.write(updated)
                    handle.flush()
                    os.chmod(pending, manifest_path.stat().st_mode & 0o777)
                    os.replace(pending, manifest_path)
                finally:
                    pending.unlink(missing_ok=True)
        candidate.rename(output_root)
    return {"package_id": package_id, "dry_run": report}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New release-root directory")
    args = parser.parse_args(argv)
    try:
        result = build_book(args.manifest, args.output)
    except (PackageValidationError, OSError, ValueError, yaml.YAMLError, subprocess.SubprocessError) as exc:
        print(f"FAIL CLOSED — {exc}", file=sys.stderr)
        return 2
    print(result["dry_run"], end="")
    print(f"Built {result['package_id']} at {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
