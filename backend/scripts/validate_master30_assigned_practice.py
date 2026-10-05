#!/usr/bin/env python3
"""Offline release check: exact reviewed content and no reserved source reuse.

The independent semantic reviewer remains required: hashes and string checks
cannot prove unique answers, teaching coverage or absence of a paraphrased item.
No database access or source mutation is performed by this verifier.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.grammar_lesson_content import content_sha256, load_version


def normalized(value: str) -> str:
    return re.sub(r"[^\w]+", "", unicodedata.normalize("NFKC", value).casefold())


def validate_independence(package: dict, source_root: Path) -> dict:
    diagnostic = source_root / "MASTER30-DIAGNOSTIC/web-upload/diagnostic"
    qmatrix = json.loads((diagnostic / "q-matrix.json").read_text())["items"]
    runtime = json.loads((diagnostic / "runtime-bank.json").read_text())["items"]
    reserved = {row["item_id"] for row in qmatrix if row["diagnostic_status"] in {
        "DIAGNOSTIC_APPROVED", "CONFIRMATION_RESERVED", "HOLDOUT_RESERVED",
    }} | {row["id"] for row in runtime}
    reserved_families = {row["stimulus_family"] for row in qmatrix
                         if row["item_id"] in reserved and row.get("stimulus_family")}
    reserved_parallel_sets = {row["parallel_set_id"] for row in qmatrix
                              if row["item_id"] in reserved and row.get("parallel_set_id")}
    prompts = {normalized(row["prompt"]) for row in runtime}
    for path in sorted(source_root.glob("Buoi-*/KBT-buoi-*.jsonl")):
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            item = json.loads(line)
            if item["id"] in reserved:
                prompts.add(normalized(item["de"]))
    seen = set()
    for lesson_id, lesson in package["lessons"].items():
        for question in lesson["questions"]:
            provenance = question.get("provenance") or {}
            qid = question["id"]
            prompt = normalized(question["prompt"])
            if (qid in reserved or prompt in prompts or prompt in seen
                    or provenance.get("source_item_id") in reserved
                    or provenance.get("stimulus_family") in reserved_families
                    or provenance.get("parallel_set_id") in reserved_parallel_sets):
                raise ValueError(f"Reserved or duplicate practice question: {lesson_id}/{qid}")
            seen.add(prompt)
    return {
        "version": package["version"],
        "package_sha256": content_sha256(package),
        "lesson_count": len(package["lessons"]),
        "question_count": len(seen),
        "reserved_source_ids": len(reserved),
        "exact_overlaps": 0,
        "semantic_near_copy_gate": "Independent senior reviewer; string checks are not proof",
        "source_hashes": {name: hashlib.sha256((diagnostic / name).read_bytes()).hexdigest()
                          for name in ["runtime-bank.json", "q-matrix.json"]},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="v2")
    parser.add_argument("--source-root", type=Path, required=True)
    args = parser.parse_args()
    package = load_version(args.version)
    print(json.dumps(validate_independence(package, args.source_root),
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
