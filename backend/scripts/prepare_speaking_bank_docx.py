"""Convert the supplied Speaking DOCX into reviewable, dated bank data.

The dates in the document are source claims, not verified IELTS exam windows.
This converter never writes to a database. It fails on unexpected document
shapes so a changed attachment cannot silently produce a partial import.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
WINDOWS = {
    "Always in use": (None, None, "evergreen"),
    "September 2026 to April 2027": ("2026-09-01", "2027-04-30", "dated"),
    "May to December 2026": ("2026-05-01", "2026-12-31", "dated"),
    "January to August 2026": ("2026-01-01", "2026-08-31", "dated"),
    "January to August 2025": ("2025-01-01", "2025-08-31", "dated"),
}
QUESTION = re.compile(r"^\d+\.\s+(.+\?)$")
NUMBERED_HEADING = re.compile(r"^\d+\.\s+(.+)$")


def paragraphs(path: Path):
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    for paragraph in root.findall(".//w:body/w:p", NS):
        text = "".join(node.text or "" for node in paragraph.findall(".//w:t", NS)).strip()
        if not text:
            continue
        style = paragraph.find("w:pPr/w:pStyle", NS)
        yield (style.get(f"{{{NS['w']}}}val") if style is not None else "", text)


def convert(path: Path) -> dict:
    groups: list[dict] = []
    part = 0
    current: dict | None = None
    for style, text in paragraphs(path):
        if style == "Heading1":
            part += 1
            if part > 3:
                raise ValueError("Unexpected fourth Speaking part")
        elif style == "Heading2":
            if part not in (1, 2, 3):
                raise ValueError(f"Heading outside a Part: {text}")
            current = {"part": part, "heading": text, "rows": []}
            groups.append(current)
        elif current is not None:
            current["rows"].append((style, text))

    topics: list[dict] = []
    for group in groups:
        part = group["part"]
        heading = group["heading"]
        number = re.search(r"\d+", heading)
        if number is None:
            raise ValueError(f"Missing source number: {heading}")
        rows = group["rows"]
        if not rows or not rows[0][1].startswith("Giai đoạn trong ảnh: "):
            raise ValueError(f"Missing source period: {heading}")
        window = rows[0][1].removeprefix("Giai đoạn trong ảnh: ")
        if window not in WINDOWS:
            raise ValueError(f"Unknown source period: {window}")
        start, end, kind = WINDOWS[window]
        questions: list[dict] = []
        if part == 2:
            cue = rows[1][1]
            bullets = [text for style, text in rows if style == "ListBullet"]
            if not cue.startswith("Describe ") or len(bullets) != 4 or not bullets[-1].startswith("and explain "):
                raise ValueError(f"Malformed cue card: {heading}")
            questions.append({
                "part": 2, "question_text": cue, "question_type": "cuecard",
                "order_num": 1, "cue_card_bullets": bullets[:3],
                "cue_card_reflection": bullets[3],
            })
            followups = [match.group(1) for _, text in rows if (match := QUESTION.match(text))]
            if len(followups) != 2:
                raise ValueError(f"Expected two rounding-off questions: {heading}")
            questions.extend({"part": 3, "question_text": text,
                              "question_type": "rounding_off", "order_num": index + 2}
                             for index, text in enumerate(followups))
            title = cue.removeprefix("Describe ").rstrip(".")
            title = title[0].upper() + title[1:]
        else:
            title_match = NUMBERED_HEADING.match(heading)
            if title_match is None:
                raise ValueError(f"Malformed topic heading: {heading}")
            title = title_match.group(1)
            texts = [match.group(1) for _, text in rows if (match := QUESTION.match(text))]
            expected = 7 if part == 1 else 8
            if len(texts) != expected:
                raise ValueError(f"Expected {expected} Part {part} questions in {heading}, found {len(texts)}")
            questions = [{"part": part, "question_text": text, "question_type": "",
                          "order_num": index + 1} for index, text in enumerate(texts)]
        topics.append({
            "source_id": f"p{part}-{int(number.group()):03d}",
            "part": part, "title": title, "source_window": window,
            "window_start": start, "window_end": end,
            "window_kind": kind, "questions": questions,
        })

    counts = {str(part): sum(item["part"] == part for item in topics) for part in (1, 2, 3)}
    if counts != {"1": 57, "2": 84, "3": 69}:
        raise ValueError(f"Unexpected topic counts: {counts}")
    return {
        "schema_version": 1,
        "source_document": path.name,
        "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "source_window_policy": "Dates are transcribed from the supplied document. They describe suggested practice relevance, not verified live IELTS questions or an official exam schedule.",
        "topics": topics,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = convert(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Converted {len(result['topics'])} topics and {sum(len(t['questions']) for t in result['topics'])} questions")


if __name__ == "__main__":
    main()
