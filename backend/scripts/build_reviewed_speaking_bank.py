"""Build the assignable Part 1/3 bank from reviewed prompts and source metadata.

The Word extraction remains untouched. Editorial wording lives in two readable
Markdown-formatted text files, keyed by source IDs. They use .txt because the
grammar article inventory intentionally scans Markdown under backend/content.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

CONTENT = Path(__file__).resolve().parents[1] / "content" / "speaking_bank"
SOURCE = CONTENT / "2026-09-source.json"
REVIEWED = CONTENT / "2026-09-reviewed.json"
PROMPTS = {
    1: CONTENT / "2026-09-part1-reviewed.txt",
    3: CONTENT / "2026-09-part3-reviewed.txt",
}
_HEADING = re.compile(r"^## (p[13]-\d{3})$")


def read_prompts(path: Path) -> dict[str, list[str]]:
    prompts: dict[str, list[str]] = {}
    current: str | None = None
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        match = _HEADING.fullmatch(line)
        if match:
            current = match.group(1)
            if current in prompts:
                raise ValueError(f"Duplicate topic {current} in {path.name}:{number}")
            prompts[current] = []
        elif line.startswith("- ") and current:
            question = line[2:].strip()
            if not question.endswith("?") or len(question) < 15:
                raise ValueError(f"Malformed prompt in {path.name}:{number}")
            prompts[current].append(question)
        elif line and current:
            raise ValueError(f"Unexpected content in {path.name}:{number}")
    for source_id, questions in prompts.items():
        if len(questions) != 4 or len(set(questions)) != 4:
            raise ValueError(f"Expected four distinct prompts for {source_id}")
    return prompts


def build_reviewed_bank(source: dict, part1: dict[str, list[str]],
                        part3: dict[str, list[str]]) -> dict:
    expected = {
        part: {topic["source_id"] for topic in source["topics"] if topic["part"] == part}
        for part in (1, 3)
    }
    for part, prompts in ((1, part1), (3, part3)):
        if set(prompts) != expected[part]:
            missing = sorted(expected[part] - set(prompts))
            extra = sorted(set(prompts) - expected[part])
            raise ValueError(f"Part {part} editorial coverage: missing={missing}, extra={extra}")
    topics = []
    for topic in source["topics"]:
        part = topic["part"]
        if part not in (1, 3):
            continue
        row = {key: value for key, value in topic.items() if key != "questions"}
        row["questions"] = [
            {"part": part, "question_text": question, "question_type": "",
             "order_num": order}
            for order, question in enumerate((part1 if part == 1 else part3)[topic["source_id"]], 1)
        ]
        topics.append(row)
    return {
        "schema_version": 1,
        "source_document": source["source_document"],
        "source_sha256": source["source_sha256"],
        "source_window_policy": source["source_window_policy"],
        "editorial_revision": "2026-09-29",
        "editorial_files_sha256": {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in PROMPTS.values()
        },
        "topics": topics,
    }


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    reviewed = build_reviewed_bank(source, read_prompts(PROMPTS[1]), read_prompts(PROMPTS[3]))
    REVIEWED.write_text(json.dumps(reviewed, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    print(f"Wrote {REVIEWED}: {len(reviewed['topics'])} topics, "
          f"{sum(len(topic['questions']) for topic in reviewed['topics'])} questions")


if __name__ == "__main__":
    main()
