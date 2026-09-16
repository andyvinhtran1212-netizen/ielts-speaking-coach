"""Deterministic builder for the 30-lesson Advanced Vocabulary package.

The builder reads the canonical course sources and writes only to an explicit,
new output directory. It never edits source documents or imports data.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import yaml
from docx import Document
from docx.document import Document as DocumentObject
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph

from services.advanced_vocab_package_validator import (
    FIRST_RELEASE_LOCKED_REVISIONS,
    READING_LEARNER_QUESTION_FIELDS,
    READING_PRIVATE_QUESTION_FIELDS,
    SOURCE_MANIFEST_NAME,
    validate_package,
    validate_source_inputs_manifest,
)


CONVERTER_VERSION = "2.3.0"
DEFAULT_COMMON_ERROR_OVERRIDES = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "advanced_vocab_common_error_overrides.json"
)
CORE_TOPIC_CODES = tuple(f"T{i:02d}" for i in range(1, 31))
FRONTMATTER_SEPARATOR_RE = re.compile(r"^---\s*$", re.MULTILINE)
PART_RE = re.compile(r"\bPART\s*([0-8])\b", re.IGNORECASE)
ANSWER_KEY_RE = re.compile(r"ĐÁP\s+ÁN\s+THAM\s+KHẢO|ANSWER\s+KEY", re.IGNORECASE)
KNOWN_RATIONALE_RE = re.compile(
    r"^(?:Correct|Distractor|Outdated/Rejected|Partial Truth|Overgeneralized|"
    r"Irrelevant Detail)\b",
    re.IGNORECASE,
)
CLUSTER_TITLES = {
    "C1": "People and Self",
    "C2": "Health, Culture and Society",
    "C3": "Environment, Science and Time",
    "C4": "Places, Mobility and Change",
    "C5": "Work, Business and Media",
    "C6": "Law, Technology and Global Systems",
}


@dataclass(frozen=True)
class BuildPaths:
    source_root: Path
    topic_docx: Path
    assessment_docx: Path
    vocab_cards: tuple[Path, ...]
    quickcheck: Path
    reading_json: Path
    listening_json: Path
    audio_dir: Path
    wt1_assets: tuple[Path, ...]
    wt1_question_bank: Path
    wt2_question_bank: Path
    wt2_idea_bank: Path


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _declared_inputs(manifest: dict[str, Any]) -> dict[tuple[str, str], str]:
    rows = manifest.get("inputs") if isinstance(manifest, dict) else None
    if not isinstance(rows, list):
        return {}
    return {
        (str(row.get("root") or ""), str(row.get("path") or "")): str(
            row.get("sha256") or ""
        )
        for row in rows if isinstance(row, dict)
    }


def _require_consumed_inputs_declared(
    manifest: dict[str, Any],
    root_name: str,
    root: Path,
    consumed: Iterable[Path],
) -> None:
    """Reject files the builder consumes but the locked manifest does not cover."""
    declared = _declared_inputs(manifest)
    root = root.resolve()
    missing: list[str] = []
    for path in consumed:
        resolved = path.resolve()
        try:
            relative = resolved.relative_to(root).as_posix()
        except ValueError as exc:
            raise ValueError(f"Consumed input escapes {root_name} root: {path}") from exc
        if path.is_symlink() or declared.get((root_name, relative)) != _sha256_file(resolved):
            missing.append(relative)
    if missing:
        raise ValueError(
            f"Consumed {root_name} inputs are absent or mismatched in "
            f"{SOURCE_MANIFEST_NAME}: {', '.join(sorted(missing))}"
        )


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _slug(value: str) -> str:
    normalized = value.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def _lexeme_id(headword: str) -> str:
    return "lex_" + _slug(headword).replace("-", "_")


def parse_frontmatter_records(path: Path) -> list[tuple[dict[str, Any], str]]:
    """Read repeated Markdown frontmatter records from course bank files."""
    text = path.read_text(encoding="utf-8-sig")
    chunks = FRONTMATTER_SEPARATOR_RE.split(text)
    records: list[tuple[dict[str, Any], str]] = []
    for index in range(1, len(chunks), 2):
        metadata = yaml.safe_load(chunks[index])
        if not isinstance(metadata, dict):
            raise ValueError(f"Invalid frontmatter object in {path} at record {index // 2 + 1}")
        body = chunks[index + 1].strip() if index + 1 < len(chunks) else ""
        records.append((metadata, body))
    if not records:
        raise ValueError(f"No frontmatter records found in {path}")
    return records


def _iter_docx_blocks(parent: DocumentObject | _Cell) -> Iterable[Paragraph | Table]:
    parent_element = parent.element.body if isinstance(parent, DocumentObject) else parent._tc
    for child in parent_element.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, parent)
        elif isinstance(child, CT_Tbl):
            yield Table(child, parent)


def _paragraph_block(paragraph: Paragraph, source_index: int) -> dict[str, Any] | None:
    text = paragraph.text.strip()
    has_image = bool(paragraph._p.xpath(".//a:blip"))
    if not text and not has_image:
        return None
    if has_image and not text:
        return {
            "type": "embedded_image_placeholder",
            "alt": "Embedded source illustration",
            "source_index": source_index,
        }
    style = str(paragraph.style.name or "") if paragraph.style else ""
    style_lower = style.lower()
    if style_lower.startswith("heading"):
        match = re.search(r"(\d+)", style_lower)
        return {
            "type": "heading",
            "level": int(match.group(1)) if match else 2,
            "text": text,
            "source_index": source_index,
        }
    if style_lower == "title":
        return {"type": "title", "text": text, "source_index": source_index}
    if "list bullet" in style_lower:
        return {"type": "list_item", "text": text, "source_index": source_index}
    if "list number" in style_lower:
        return {
            "type": "list_item_number",
            "text": text,
            "source_index": source_index,
        }
    if PART_RE.search(text):
        return {
            "type": "heading",
            "level": 1,
            "text": text,
            "source_index": source_index,
        }
    return {"type": "paragraph", "text": text, "source_index": source_index}


def extract_docx_blocks(path: Path) -> list[dict[str, Any]]:
    document = Document(path)
    blocks: list[dict[str, Any]] = []
    for source_index, element in enumerate(_iter_docx_blocks(document), start=1):
        if isinstance(element, Paragraph):
            block = _paragraph_block(element, source_index)
        else:
            block = {
                "type": "table",
                "rows": [
                    [cell.text.strip() for cell in row.cells]
                    for row in element.rows
                ],
                "source_index": source_index,
            }
        if block:
            blocks.append(block)
    return blocks


@lru_cache(maxsize=4)
def _extract_shared_docx_blocks(path: Path) -> tuple[dict[str, Any], ...]:
    """Parse shared course-wide banks once per package build process."""
    return tuple(extract_docx_blocks(path))


def split_topic_sections(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    current = {"section_id": "preface", "title": "Preface", "blocks": []}
    sections.append(current)
    for block in blocks:
        part_match = PART_RE.search(str(block.get("text") or ""))
        if block.get("type") == "heading" and part_match:
            number = int(part_match.group(1))
            current = {
                "section_id": f"part_{number}",
                "title": str(block.get("text") or f"Part {number}"),
                "blocks": [],
            }
            sections.append(current)
            continue
        current["blocks"].append(block)
    return sections


def _section(sections: list[dict[str, Any]], section_id: str) -> dict[str, Any]:
    for section in sections:
        if section.get("section_id") == section_id:
            return section
    raise ValueError(f"Required topic section missing: {section_id}")


def _heading_groups(section: dict[str, Any]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for block in section.get("blocks") or []:
        if block.get("type") == "heading":
            current = {"heading": block.get("text", ""), "blocks": []}
            groups.append(current)
        elif current is not None:
            current["blocks"].append(block)
    return groups


def _matching_groups(section: dict[str, Any], patterns: tuple[str, ...]) -> list[dict[str, Any]]:
    return [
        group
        for group in _heading_groups(section)
        if any(re.search(pattern, str(group["heading"]), re.IGNORECASE) for pattern in patterns)
    ]


def _writing_topic_slice(
    blocks: list[dict[str, Any]], topic_code: str,
) -> tuple[str, list[dict[str, Any]]]:
    """Return one Txx entry from a shared Writing bank."""
    topic_pattern = re.compile(rf"^{re.escape(topic_code)}\b", re.IGNORECASE)
    any_topic_pattern = re.compile(r"^T\d{2}\b", re.IGNORECASE)
    title = ""
    selected: list[dict[str, Any]] = []
    collecting = False
    for block in blocks:
        text = str(block.get("text") or "").strip()
        is_topic = block.get("type") == "heading" and any_topic_pattern.search(text)
        if is_topic and topic_pattern.search(text):
            title = text
            collecting = True
            continue
        if collecting and is_topic:
            break
        if collecting:
            selected.append(block)
    if not title or not selected:
        raise ValueError(f"Writing bank entry missing for {topic_code}")
    return title, selected


def _writing_question_bank_entry(
    blocks: list[dict[str, Any]], topic_code: str,
) -> dict[str, Any]:
    title, topic_blocks = _writing_topic_slice(blocks, topic_code)
    buckets: dict[str, list[dict[str, Any]]] = {
        "prompt": [], "source_data": [], "chart_placeholder": [],
        "model_7": [], "model_8": [], "band_comparison": [],
    }
    current: str | None = None
    for block in topic_blocks:
        text = str(block.get("text") or "").strip()
        if re.match(r"^ĐỀ BÀI", text, re.IGNORECASE):
            current = "prompt"
        elif re.match(r"^BẢNG SỐ LIỆU", text, re.IGNORECASE):
            current = "source_data"
        elif re.match(r"^BIỂU ĐỒ", text, re.IGNORECASE):
            current = "chart_placeholder"
        elif re.match(r"^BÀI (?:LUẬN )?MẪU BAND\s*7", text, re.IGNORECASE):
            current = "model_7"
        elif re.match(r"^BÀI (?:LUẬN )?MẪU BAND\s*8", text, re.IGNORECASE):
            current = "model_8"
        elif re.match(r"^▸?\s*Khác biệt Band", text, re.IGNORECASE):
            current = "band_comparison"
        elif current is not None:
            buckets[current].append(block)
    if not buckets["prompt"] or not buckets["model_7"] or not buckets["model_8"]:
        raise ValueError(f"Writing question bank entry incomplete for {topic_code}")
    task_match = re.search(r"\[([^]]+)\]", title)
    return {
        "title": title,
        "task_type": task_match.group(1) if task_match else None,
        "prompt": buckets["prompt"],
        "source_data": buckets["source_data"],
        "model_answers": [
            {"band": "7.0", "blocks": buckets["model_7"]},
            {"band": "8.0", "blocks": buckets["model_8"]},
        ],
        "band_comparison": buckets["band_comparison"],
    }


def _writing_idea_bank_entry(
    blocks: list[dict[str, Any]], topic_code: str,
) -> dict[str, Any]:
    title, topic_blocks = _writing_topic_slice(blocks, topic_code)
    groups = _heading_groups({"blocks": topic_blocks})
    word_bank = [group for group in groups if "WORD BANK" in str(group["heading"]).upper()]
    idea_sections = [group for group in groups if group not in word_bank]
    if len(idea_sections) < 12:
        raise ValueError(
            f"Writing idea bank entry for {topic_code} needs 12 sections; "
            f"found {len(idea_sections)}"
        )
    return {"title": title, "idea_sections": idea_sections, "word_bank": word_bank}


def build_writing_reference(
    sections: list[dict[str, Any]],
    *,
    topic_code: str | None = None,
    wt1_bank_blocks: list[dict[str, Any]] | None = None,
    wt2_bank_blocks: list[dict[str, Any]] | None = None,
    wt2_idea_blocks: list[dict[str, Any]] | None = None,
    illustration_refs: list[str] | None = None,
) -> dict[str, Any]:
    """Build learner reference material without essay/model-answer submission UI."""
    part_3 = _section(sections, "part_3")
    part_7 = _section(sections, "part_7")
    part_8 = _section(sections, "part_8")
    writing_sections = (part_7, part_8)
    prompt = [
        group
        for section in writing_sections
        for group in _matching_groups(section, (r"đề bài", r"question"))
    ]
    outline = [
        group
        for section in writing_sections
        for group in _matching_groups(section, (r"dàn bài", r"outline"))
    ]
    useful_language = [
        group
        for section in writing_sections
        for group in _matching_groups(
            section,
            (r"từ vựng", r"mẫu câu", r"useful language", r"diễn đạt học thuật"),
        )
    ]
    prompt_analysis = [
        group
        for section in writing_sections
        for group in _matching_groups(section, (r"phân tích", r"chiến lược"))
    ]
    idea_map = _matching_groups(part_8, (r"ý tưởng", r"brainstorm"))
    if not idea_map:
        idea_map = [{"heading": part_3["title"], "blocks": part_3["blocks"]}]
    reference = {
        "purpose": "prompt_analysis_and_ideas_reference_only",
        "prompt": prompt,
        "prompt_analysis": prompt_analysis,
        "idea_map": idea_map,
        "outline": outline,
        "useful_language": useful_language,
        "annotated_examples": [],
        "common_traps": _matching_groups(part_7, (r"chiến lược", r"trap")),
        "excluded_content": ["band_7_model_essay", "band_8_model_essay"],
    }
    bank_inputs = (wt1_bank_blocks, wt2_bank_blocks, wt2_idea_blocks)
    if topic_code and all(bank is not None for bank in bank_inputs):
        task_1 = _writing_question_bank_entry(wt1_bank_blocks or [], topic_code)
        task_2 = _writing_question_bank_entry(wt2_bank_blocks or [], topic_code)
        idea_bank = _writing_idea_bank_entry(wt2_idea_blocks or [], topic_code)
        task_1["illustrations"] = list(illustration_refs or [])
        task_2.update({
            "idea_bank_title": idea_bank["title"],
            "idea_sections": idea_bank["idea_sections"],
            "word_bank": idea_bank["word_bank"],
        })
        reference.update({
            "tasks": {"task_1": task_1, "task_2": task_2},
            "model_answers_visibility": "collapsed_reference",
            "excluded_content": [],
        })
    return reference


def split_assessment(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    prompt_blocks: list[dict[str, Any]] = []
    solution_blocks: list[dict[str, Any]] = []
    in_solutions = False
    for block in blocks:
        if ANSWER_KEY_RE.search(str(block.get("text") or "")):
            in_solutions = True
            continue
        (solution_blocks if in_solutions else prompt_blocks).append(block)
    if not prompt_blocks or not solution_blocks:
        raise ValueError("Assessment must contain both prompts and an answer key")
    return {
        "prompts": prompt_blocks,
        "solutions": solution_blocks,
        "solutions_visibility": "after_attempt",
    }


def sanitize_reading_source(source: dict[str, Any]) -> dict[str, Any]:
    """Split the authored Reading lesson into learner material and solutions."""
    passages = [dict(passage) for passage in source.get("passages") or []]
    questions: list[dict[str, Any]] = []
    solutions: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()

    for source_item in source.get("items") or []:
        if not isinstance(source_item, dict):
            raise ValueError("Reading item must be an object")
        qnum = str(source_item.get("question_number") or "")
        if not qnum or qnum in seen:
            raise ValueError(f"Reading item has missing/duplicate question_number={qnum!r}")
        seen.add(qnum)
        unexpected = sorted(
            set(source_item)
            - READING_LEARNER_QUESTION_FIELDS
            - READING_PRIVATE_QUESTION_FIELDS
        )
        if unexpected:
            raise ValueError(
                "Reading item contains unknown fields: " + ", ".join(unexpected)
            )
        question = {
            key: source_item[key]
            for key in READING_LEARNER_QUESTION_FIELDS if key in source_item
        }
        questions.append(question)
        solutions[qnum] = {
            key: source_item[key]
            for key in READING_PRIVATE_QUESTION_FIELDS
            if source_item.get(key) is not None
        }

    if not passages or not questions:
        raise ValueError("Reading source must contain passages and questions")
    return {
        "test_id": source.get("test_id"),
        "title": source.get("title"),
        "module": source.get("module"),
        "target_band": source.get("target_band"),
        "passages": passages,
        "question_material": list(source.get("question_material") or []),
        "questions": questions,
        "solutions": solutions,
        "solutions_visibility": "after_attempt",
    }


def sanitize_listening_source(
    source: dict[str, Any],
    timings: dict[str, Any],
) -> dict[str, Any]:
    """Separate learner choices from duplicated option rationales and answers."""
    learner_sections: list[dict[str, Any]] = []
    flat_questions: list[dict[str, Any]] = []
    solutions: dict[str, dict[str, Any]] = {}
    timing_index = timings.get("question_index") or {}

    for source_section in source.get("sections") or []:
        section = {
            key: value
            for key, value in source_section.items()
            if key not in {"audio_script", "question_blocks"}
        }
        section["question_blocks"] = []
        for source_block in source_section.get("question_blocks") or []:
            block = {
                key: value
                for key, value in source_block.items()
                if key not in {"answers", "questions"}
            }
            answer_by_q: dict[str, dict[str, Any]] = {}
            for answer in source_block.get("answers") or []:
                if not isinstance(answer, dict):
                    continue
                answer_qnum = str(
                    answer.get("qnum") or answer.get("question_number") or ""
                )
                if not answer_qnum or answer_qnum in answer_by_q:
                    raise ValueError(
                        f"Listening answer has missing/duplicate qnum={answer_qnum!r}"
                    )
                answer_by_q[answer_qnum] = answer
            block_questions: list[dict[str, Any]] = []
            for source_question in source_block.get("questions") or []:
                question = dict(source_question)
                qnum = str(question.get("question_number") or question.get("qnum") or "")
                options = question.get("options")
                rationales: dict[str, str] = {}
                if isinstance(options, list):
                    visible: list[Any] = []
                    seen: set[str] = set()
                    for index, option in enumerate(options):
                        if not isinstance(option, dict):
                            visible.append(option)
                            continue
                        key = str(option.get("letter") or option.get("key") or index)
                        text = str(option.get("text") or "")
                        if key not in seen:
                            visible.append(option)
                            seen.add(key)
                        elif text:
                            if not KNOWN_RATIONALE_RE.search(text):
                                raise ValueError(
                                    f"Unexpected duplicate option {key!r} for question "
                                    f"{qnum or '?'}: {text!r}"
                                )
                            rationales[key] = text
                    question["options"] = visible
                answer = answer_by_q.get(qnum)
                if not answer:
                    raise ValueError(f"Listening question {qnum or '?'} has no answer")
                question_type = str(question.get("question_type") or "").lower()
                if question_type == "mcq":
                    visible_keys = {
                        str(option.get("letter") or option.get("key") or index)
                        for index, option in enumerate(question.get("options") or [])
                        if isinstance(option, dict)
                    }
                    if str(answer.get("answer") or "") not in visible_keys:
                        raise ValueError(
                            f"Listening question {qnum or '?'} answer does not match an option"
                        )
                solution = dict(answer)
                solution["timing"] = timing_index.get(qnum)
                if rationales:
                    solution["distractor_rationales"] = rationales
                solutions[qnum] = solution
                block_questions.append(question)
                flat_questions.append(question)
            block["questions"] = block_questions
            section["question_blocks"].append(block)
        learner_sections.append(section)

    return {
        "test_id": source.get("test_id"),
        "title": source.get("title"),
        "target_band_range": source.get("target_band_range"),
        "questions": flat_questions,
        "sections": learner_sections,
        "solutions": solutions,
        "solutions_visibility": "after_guided_retry",
        "private_support": {
            "audio_scripts": [
                section.get("audio_script")
                for section in source.get("sections") or []
                if section.get("audio_script")
            ],
            "visibility": "admin_only",
        },
    }


def _source_paths(source_root: Path, topic_code: str) -> BuildPaths:
    topic_matches = sorted(
        (source_root / "_CORRECTED/Advanced/01_Topics_Upgraded").glob(
            f"Cluster_C*/{topic_code}_*_Advanced_Upgraded.docx"
        )
    )
    if len(topic_matches) != 1:
        raise ValueError(f"Expected one topic DOCX for {topic_code}, found {len(topic_matches)}")
    assessment = source_root / "Advanced/05_Assessments" / (
        f"{topic_code}_Assessment_Rewrite_Advanced.docx"
    )
    vocab_cards = tuple(
        source_root / "Vocab_Quiz/Advanced_Markdown_Upload" / f"{topic_code}_Group{group}.md"
        for group in "ABC"
    )
    quickcheck = source_root / "Vocab_Quiz/Advanced_banks" / f"{topic_code}_QuickCheck.md"
    reading_json = (
        source_root
        / "_CORRECTED/Advanced/03_Listening_Reading_v2/Reading_Lessons_Web"
        / "Source_JSON"
        / f"VOC-ADV-RDG-LSN-{topic_code}.json"
    )
    listening_root = (
        source_root
        / "_CORRECTED/Advanced/03_Listening_Reading_v2/Listening_Lessons_Web"
    )
    listening_json = (
        listening_root / "Source_JSON" / f"VOC-ADV-LIS-LSN-{topic_code}.json"
    )
    audio_dir = listening_root / "audio_output" / f"VOC-ADV-LIS-LSN-{topic_code}"
    wt1_assets = tuple(sorted((source_root / "Advanced/06_WT1_Illustrations").glob(
        f"{topic_code}_*.*"
    )))
    writing_root = source_root / "Advanced/03_Writing"
    paths = BuildPaths(
        source_root=source_root,
        topic_docx=topic_matches[0],
        assessment_docx=assessment,
        vocab_cards=vocab_cards,
        quickcheck=quickcheck,
        reading_json=reading_json,
        listening_json=listening_json,
        audio_dir=audio_dir,
        wt1_assets=wt1_assets,
        wt1_question_bank=writing_root / "WT1_Question_Bank_Advanced.docx",
        wt2_question_bank=writing_root / "WT2_Question_Bank_Advanced.docx",
        wt2_idea_bank=writing_root / "WT2_Idea_Bank_Advanced.docx",
    )
    required = (
        paths.topic_docx,
        paths.assessment_docx,
        *paths.vocab_cards,
        paths.quickcheck,
        paths.reading_json,
        paths.listening_json,
        paths.audio_dir / "manifest.json",
        paths.audio_dir / "timings.json",
        paths.audio_dir / "full_test.mp3",
        paths.wt1_question_bank,
        paths.wt2_question_bank,
        paths.wt2_idea_bank,
    )
    missing = [path for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Missing {topic_code} sources: {missing}")
    return paths


def load_common_error_overrides(path: str | Path) -> tuple[dict[str, str], dict[str, Any]]:
    """Load the versioned supplement without mutating shared course sources."""
    source = Path(path).expanduser().resolve()
    payload = json.loads(source.read_text(encoding="utf-8"))
    rows = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ValueError(f"common_error overlay must contain an items array: {source}")
    overrides: dict[str, str] = {}
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise ValueError(f"common_error overlay item {index} is not an object")
        key = str(row.get("lesson_lexeme_id") or "").strip()
        value = str(row.get("common_error") or "").strip()
        if not key or not value:
            raise ValueError(f"common_error overlay item {index} needs id and text")
        if key in overrides:
            raise ValueError(f"Duplicate common_error overlay key: {key}")
        overrides[key] = value
    metadata = {
        "override_id": str(payload.get("override_id") or source.stem),
        "schema_version": str(payload.get("schema_version") or "1.0.0"),
        "checksum": _sha256_file(source),
        "item_count": len(overrides),
    }
    return overrides, metadata


def load_vocab_audio_bundle(path: str | Path) -> tuple[Path, dict[str, Any]]:
    """Read and integrity-check a Kokoro audio bundle before package assembly."""
    root = Path(path).expanduser().resolve()
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("engine") != "kokoro":
        raise ValueError(f"Unsupported vocabulary audio engine in {manifest_path}")
    cards = manifest.get("cards")
    clips = manifest.get("clips")
    if not isinstance(cards, dict) or not isinstance(clips, dict):
        raise ValueError(f"Invalid vocabulary audio bundle: {manifest_path}")
    expected_bundle_checksum = str(manifest.get("bundle_checksum") or "")
    manifest_without_checksum = dict(manifest)
    manifest_without_checksum.pop("bundle_checksum", None)
    if expected_bundle_checksum != _sha256_bytes(_canonical_json(manifest_without_checksum)):
        raise ValueError(f"Vocabulary audio bundle checksum mismatch: {manifest_path}")
    for clip_id, clip in clips.items():
        if not isinstance(clip, dict):
            raise ValueError(f"Invalid audio clip metadata: {clip_id}")
        clip_path = (root / str(clip.get("path") or "")).resolve()
        try:
            clip_path.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"Unsafe vocabulary audio path: {clip_path}") from exc
        expected_path = (root / "clips" / f"{clip_id}.mp3").resolve()
        if clip_path != expected_path:
            raise ValueError(
                f"Vocabulary audio path/key mismatch for {clip_id}: {clip_path}"
            )
        if not clip_path.is_file():
            raise FileNotFoundError(f"Vocabulary audio clip missing: {clip_path}")
        if _sha256_file(clip_path) != clip.get("checksum"):
            raise ValueError(f"Vocabulary audio checksum mismatch: {clip_path}")
    for lesson_lexeme_id, card in cards.items():
        if not isinstance(card, dict):
            raise ValueError(f"Invalid vocabulary audio card: {lesson_lexeme_id}")
        for role in ("headword", "example"):
            ref = card.get(role)
            clip_id = ref.get("clip_id") if isinstance(ref, dict) else None
            checksum = ref.get("checksum") if isinstance(ref, dict) else None
            if clip_id not in clips or checksum != clips[clip_id].get("checksum"):
                raise ValueError(
                    f"Invalid {role} audio reference for {lesson_lexeme_id}"
                )
    return root, manifest


def _load_vocab(
    paths: BuildPaths,
    lesson_id: str,
    common_error_overrides: dict[str, str] | None = None,
    audio_manifest: dict[str, Any] | None = None,
    applied_override_ids: set[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    vocabulary: list[dict[str, Any]] = []
    headword_ids: dict[str, str] = {}
    for path in paths.vocab_cards:
        for metadata, body in parse_frontmatter_records(path):
            headword = str(metadata.get("headword") or "").strip()
            if not headword:
                raise ValueError(f"Vocabulary card without headword in {path}")
            lexeme_id = _lexeme_id(headword)
            lesson_lexeme_id = f"{lesson_id}__{lexeme_id}"
            card = dict(metadata)
            card.update({
                "lexeme_id": lexeme_id,
                "lesson_lexeme_id": lesson_lexeme_id,
                "mastery_target": "productive",
                "body_markdown": body,
            })
            if not str(card.get("common_error") or "").strip():
                override = (common_error_overrides or {}).get(lesson_lexeme_id)
                if override:
                    card["common_error"] = override
                    card["common_error_source"] = "versioned_overlay"
                    if applied_override_ids is not None:
                        applied_override_ids.add(lesson_lexeme_id)
            if audio_manifest is not None:
                audio_card = (audio_manifest.get("cards") or {}).get(lesson_lexeme_id)
                if not isinstance(audio_card, dict):
                    raise ValueError(f"Vocabulary audio missing for {lesson_lexeme_id}")
                headword_audio = audio_card.get("headword")
                example_audio = audio_card.get("example")
                if not isinstance(headword_audio, dict) or not isinstance(example_audio, dict):
                    raise ValueError(f"Headword/example audio incomplete for {lesson_lexeme_id}")
                clips = audio_manifest.get("clips") or {}
                rendered_headword = clips.get(headword_audio.get("clip_id"), {})
                rendered_example = clips.get(example_audio.get("clip_id"), {})
                if rendered_headword.get("text") != headword:
                    raise ValueError(f"Stale headword audio for {lesson_lexeme_id}")
                if rendered_example.get("text") != str(card.get("example") or "").strip():
                    raise ValueError(f"Stale example audio for {lesson_lexeme_id}")
                card.update({
                    "audio_headword": f"assets/vocab-audio/{headword_audio['clip_id']}.mp3",
                    "audio_example": f"assets/vocab-audio/{example_audio['clip_id']}.mp3",
                    "audio_status": "final",
                    "audio_provenance": {
                        "engine": audio_manifest["engine"],
                        "model_tag": audio_manifest["model_tag"],
                        "voice": audio_manifest["voice"],
                        "headword_checksum": headword_audio["checksum"],
                        "example_checksum": example_audio["checksum"],
                    },
                })
            vocabulary.append(card)
            headword_ids[headword.casefold()] = lexeme_id
    if len(vocabulary) != 24:
        raise ValueError(f"{lesson_id} requires 24 vocabulary cards, found {len(vocabulary)}")
    return vocabulary, headword_ids


def collect_core_vocabulary_cards(source_root: str | Path) -> list[dict[str, Any]]:
    """Return the 720 canonical core cards in stable lesson/source order."""
    source = Path(source_root).expanduser().resolve()
    cards: list[dict[str, Any]] = []
    for topic_code in CORE_TOPIC_CODES:
        lesson_id = f"ADV-{topic_code}"
        vocabulary, _headword_ids = _load_vocab(_source_paths(source, topic_code), lesson_id)
        cards.extend(vocabulary)
    return cards


def _load_quiz(path: Path, lesson_id: str,
               headword_ids: dict[str, str]) -> dict[str, Any]:
    records = parse_frontmatter_records(path)
    config = dict(records[0][0])
    items: list[dict[str, Any]] = []
    for metadata, _body in records[1:]:
        legacy_id = str(metadata.get("id") or "")
        if not legacy_id:
            raise ValueError(f"Quiz item without id in {path}")
        item = dict(metadata)
        item.pop("id", None)
        item["legacy_id"] = legacy_id
        item["item_id"] = f"{lesson_id}__{legacy_id}"
        headword = str(item.get("headword") or "").casefold()
        if headword in headword_ids:
            item["lexeme_id"] = headword_ids[headword]
        items.append(item)
    return {
        "config": config,
        "item_count": len(items),
        "item_types": _counts(items, "type"),
        "skills": _counts(items, "skill"),
        "items": items,
    }


def _counts(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    result: dict[str, int] = {}
    for row in rows:
        value = str(row.get(key) or "unknown")
        result[value] = result.get(value, 0) + 1
    return dict(sorted(result.items()))


def _extract_objectives(part_0: dict[str, Any]) -> list[str]:
    objectives: list[str] = []
    collecting = False
    for block in part_0.get("blocks") or []:
        text = str(block.get("text") or "")
        if block.get("type") == "heading" and re.search(r"0\.1|can-do", text, re.IGNORECASE):
            collecting = True
            continue
        if collecting and block.get("type") == "heading":
            break
        if collecting and block.get("type") in {"list_item", "paragraph"} and text:
            if re.search(r"\b(?:writing|essay|bài luận)\b", text, re.IGNORECASE):
                text = (
                    "Phân tích đề Writing và tham khảo ý tưởng, dàn bài, "
                    "ngôn ngữ hữu ích trước khi làm assignment do giáo viên giao"
                )
            if text not in objectives:
                objectives.append(text)
    return objectives


def _audio_metadata(
    paths: BuildPaths,
    media_approval_ref: str | None,
) -> tuple[dict[str, Any], dict[str, Any], str, dict[str, Any] | None]:
    manifest = json.loads((paths.audio_dir / "manifest.json").read_text(encoding="utf-8"))
    timings = json.loads((paths.audio_dir / "timings.json").read_text(encoding="utf-8"))
    release_status = str(manifest.get("release_status") or "REVIEW_REQUIRED").upper()
    if media_approval_ref:
        package_status = "approved"
        approval = {
            "decision": "approved",
            "authority": "content_owner",
            "approval_ref": media_approval_ref,
            "source_release_status": release_status,
            "acknowledged_source_blockers": manifest.get("release_blockers") or [],
        }
    else:
        package_status = (
            "approved" if release_status == "APPROVED" else "rendered_review_required"
        )
        approval = None
    return manifest, timings, package_status, approval


def _build_lesson(
    paths: BuildPaths,
    topic_code: str,
    output_root: Path,
    *,
    common_error_overrides: dict[str, str],
    common_error_metadata: dict[str, Any],
    applied_override_ids: set[str],
    vocab_audio_manifest: dict[str, Any] | None,
    media_approval_ref: str | None,
) -> dict[str, Any]:
    lesson_id = f"ADV-{topic_code}"
    topic_blocks = extract_docx_blocks(paths.topic_docx)
    sections = split_topic_sections(topic_blocks)
    for part in range(9):
        _section(sections, f"part_{part}")
    assessment = split_assessment(extract_docx_blocks(paths.assessment_docx))
    vocabulary, headword_ids = _load_vocab(
        paths,
        lesson_id,
        common_error_overrides,
        vocab_audio_manifest,
        applied_override_ids,
    )
    adaptive_quiz = _load_quiz(paths.quickcheck, lesson_id, headword_ids)
    reading_source = json.loads(paths.reading_json.read_text(encoding="utf-8"))
    reading = sanitize_reading_source(reading_source)
    listening_source = json.loads(paths.listening_json.read_text(encoding="utf-8"))
    audio_manifest, timings, audio_status, media_approval = _audio_metadata(
        paths, media_approval_ref
    )
    listening = sanitize_listening_source(listening_source, timings)

    quiz_header = adaptive_quiz["config"]
    title = str(quiz_header.get("topic") or topic_code).replace(" & ", " and ")
    cluster_id = paths.topic_docx.parent.name.removeprefix("Cluster_").split("_")[0]
    review_number = (int(topic_code[1:]) - 1) // 5 + 1
    lesson_dir = output_root / "lessons" / lesson_id
    listening_figure_sources: list[Path] = []
    for section in listening.get("sections") or []:
        figure = str(section.get("figure") or "")
        if not figure:
            continue
        source_asset = paths.listening_json.parent.parent / figure
        if not source_asset.is_file():
            raise FileNotFoundError(f"Missing Listening figure: {source_asset}")
        destination = lesson_dir / figure
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_asset, destination)
        section["figure_checksum"] = _sha256_file(source_asset)
        listening_figure_sources.append(source_asset)
    illustration_refs: list[str] = []
    for source_asset in paths.wt1_assets:
        destination = lesson_dir / "assets" / "wt1" / source_asset.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_asset, destination)
        illustration_refs.append(f"assets/wt1/{source_asset.name}")
    if audio_status == "approved":
        destination = lesson_dir / "assets" / "audio" / "full_test.mp3"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(paths.audio_dir / "full_test.mp3", destination)

    source_files = {
        "topic_docx": _relative(paths.topic_docx, paths.source_root),
        "assessment_docx": _relative(paths.assessment_docx, paths.source_root),
        "card_markdown": [_relative(path, paths.source_root) for path in paths.vocab_cards],
        "quickcheck_markdown": _relative(paths.quickcheck, paths.source_root),
        "reading_json": _relative(paths.reading_json, paths.source_root),
        "listening_json": _relative(paths.listening_json, paths.source_root),
        "listening_manifest": _relative(paths.audio_dir / "manifest.json", paths.source_root),
        "listening_timings": _relative(paths.audio_dir / "timings.json", paths.source_root),
        "listening_audio": _relative(paths.audio_dir / "full_test.mp3", paths.source_root),
        "listening_figures": [
            _relative(path, paths.source_root) for path in listening_figure_sources
        ],
        "wt1_illustrations": [_relative(path, paths.source_root) for path in paths.wt1_assets],
        "wt1_question_bank": _relative(paths.wt1_question_bank, paths.source_root),
        "wt2_question_bank": _relative(paths.wt2_question_bank, paths.source_root),
        "wt2_idea_bank": _relative(paths.wt2_idea_bank, paths.source_root),
    }
    checksum_paths = (
        paths.topic_docx,
        paths.assessment_docx,
        *paths.vocab_cards,
        paths.quickcheck,
        paths.reading_json,
        paths.listening_json,
        paths.audio_dir / "manifest.json",
        paths.audio_dir / "timings.json",
        paths.audio_dir / "full_test.mp3",
        *listening_figure_sources,
        *paths.wt1_assets,
        paths.wt1_question_bank,
        paths.wt2_question_bank,
        paths.wt2_idea_bank,
    )
    source_checksums = {
        _relative(path, paths.source_root): _sha256_file(path)
        for path in checksum_paths
    }
    artifact_checksums = audio_manifest.get("artifact_sha256")
    manifest_audio_checksum = (
        artifact_checksums.get("full_test.mp3")
        if isinstance(artifact_checksums, dict)
        else artifact_checksums
    )
    full_audio_checksum = str(
        manifest_audio_checksum
        or timings.get("full_audio_sha256")
        or source_checksums[source_files["listening_audio"]]
    )
    lesson: dict[str, Any] = {
        "schema_version": "2.0.0",
        "package_version": "2.3.0",
        "package_type": "advanced_vocabulary_lesson",
        "lesson_id": lesson_id,
        "course_id": "ADV-VOCAB",
        "topic_code": topic_code,
        "title": title,
        "slug": _slug(title),
        "cluster": {
            "cluster_id": cluster_id,
            "title": CLUSTER_TITLES[cluster_id],
        },
        "language": {"instruction": "vi", "target": "en"},
        "level": {"cefr": "C1-C2", "ielts_target": "7.0-8.0"},
        "delivery": {
            "mode": "self_study",
            "estimated_core_minutes": 80,
            "resume_supported": True,
            "required_stages": [
                "vocabulary", "adaptive_practice", "reading", "controlled_rewrite",
                "listening",
            ],
            "retention_stage": "review_d7",
        },
        "objectives": _extract_objectives(_section(sections, "part_0")),
        "source_files": source_files,
        "content": {
            "visibility": "admin_only",
            "sections": sections,
            "assessment": assessment,
        },
        "vocabulary": vocabulary,
        "adaptive_quiz": adaptive_quiz,
        "activities": [
            {
                "activity_id": f"{lesson_id}__vocabulary",
                "activity_type": "vocabulary_reference",
                "interaction_policy": "self_check",
                "grading_policy": "self_check",
                "completion_policy": "required",
                "reveal_policy": "always",
                "content_ref": "vocabulary",
            },
            {
                "activity_id": f"{lesson_id}__adaptive_practice",
                "activity_type": "adaptive_practice",
                "interaction_policy": "auto_graded",
                "grading_policy": "automatic",
                "completion_policy": "required",
                "reveal_policy": "after_attempt",
                "content_ref": "adaptive_quiz",
            },
            {
                "activity_id": f"{lesson_id}__controlled_rewrite",
                "activity_type": "controlled_rewrite",
                "interaction_policy": "self_check",
                "grading_policy": "self_check",
                "completion_policy": "required",
                "reveal_policy": "after_attempt",
                "submittable": False,
                "content": assessment,
            },
            {
                "activity_id": f"{lesson_id}__reading",
                "activity_type": "reading_lab",
                "interaction_policy": "auto_graded",
                "grading_policy": "automatic",
                "completion_policy": "required",
                "reveal_policy": "after_attempt",
                "content": reading,
            },
            {
                "activity_id": f"{lesson_id}__listening",
                "activity_type": "listening_lab",
                "interaction_policy": "auto_graded",
                "grading_policy": "automatic",
                "completion_policy": "required",
                "reveal_policy": "after_guided_retry",
                "media_release_status": audio_status,
                "content": listening,
            },
            {
                "activity_id": f"{lesson_id}__writing_reference",
                "activity_type": "writing_reference",
                "interaction_policy": "read_only",
                "grading_policy": "none",
                "completion_policy": "reference_only",
                "reveal_policy": "always",
                "submittable": False,
                "teacher_assignment_required_for_grading": True,
                "content": build_writing_reference(
                    sections,
                    topic_code=topic_code,
                    wt1_bank_blocks=list(_extract_shared_docx_blocks(paths.wt1_question_bank)),
                    wt2_bank_blocks=list(_extract_shared_docx_blocks(paths.wt2_question_bank)),
                    wt2_idea_blocks=list(_extract_shared_docx_blocks(paths.wt2_idea_bank)),
                    illustration_refs=illustration_refs,
                ),
            },
            {
                "activity_id": f"{lesson_id}__speaking_practice",
                "activity_type": "speaking_practice",
                "interaction_policy": "practice_recording",
                "grading_policy": "none",
                "completion_policy": "optional",
                "reveal_policy": "always",
                "graded_by_default": False,
                "content": _section(sections, "part_5"),
            },
        ],
        "review": {
            "checkpoint_review_id": f"R{review_number:02d}",
            "schedule": [
                {"offset_days": 1, "required": True, "mode": "error_weighted"},
                {"offset_days": 7, "required": True, "mode": "unseen_context"},
                {"offset_days": 30, "required": False, "mode": "sampled_retention"},
            ],
        },
        "media": {
            "wt1_illustrations": illustration_refs,
            "audio": [{
                "audio_id": f"{lesson_id}__listening_full_test",
                "role": "listening_full_test",
                "status": audio_status,
                "expected_audio_path": "assets/audio/full_test.mp3",
                "source_path": source_files["listening_audio"],
                "duration_seconds": audio_manifest.get("full_test_duration_seconds"),
                "checksum": full_audio_checksum,
                "qc_status": (
                    "content_owner_approved"
                    if media_approval is not None
                    else ("passed" if audio_status == "approved" else "pending")
                ),
                "release_blockers": [] if audio_status == "approved" else (
                    audio_manifest.get("release_blockers") or []
                ),
                "source_release_status": str(
                    audio_manifest.get("release_status") or "REVIEW_REQUIRED"
                ).upper(),
                "source_release_blockers": audio_manifest.get("release_blockers") or [],
                "approval": media_approval,
            }],
        },
        "runtime_contract": {
            "page_view_does_not_complete": True,
            "completion_requires_submission": False,
            "completion_requires_revision_after_feedback": False,
            "writing_submission_route": "teacher_assignment_only",
            "speaking_graded_by_default": False,
        },
        "provenance": {
            "converter_version": CONVERTER_VERSION,
            "source_checksums": source_checksums,
            "content_supplements": {
                "common_errors": common_error_metadata,
            },
        },
    }
    lesson["provenance"]["content_checksum"] = _sha256_bytes(_canonical_json(lesson))
    return lesson


def _build_review(source_root: Path, review_number: int) -> dict[str, Any]:
    review_id = f"R{review_number:02d}"
    matches = sorted((source_root / "Vocab_Quiz/Advanced_banks/review").glob(
        f"{review_id}_InterleavedReview_*.md"
    ))
    if len(matches) != 1:
        raise ValueError(f"Expected one source for {review_id}, found {len(matches)}")
    source_path = matches[0]
    records = parse_frontmatter_records(source_path)
    config = dict(records[0][0])
    items: list[dict[str, Any]] = []
    for metadata, _body in records[1:]:
        legacy_id = str(metadata.get("id") or "")
        if not legacy_id:
            raise ValueError(f"Review item without id in {source_path}")
        item = dict(metadata)
        item.pop("id", None)
        item["legacy_id"] = legacy_id
        item["item_id"] = f"ADV-{review_id}__{legacy_id}"
        items.append(item)
    review = {
        "schema_version": "2.0.0",
        "package_type": "advanced_vocabulary_review",
        "review_id": review_id,
        "review_of_lessons": config.get("review_of_lessons") or [],
        "checkpoint_after": config.get("checkpoint_after"),
        "title": config.get("title"),
        "config": config,
        "item_count": len(items),
        "items": items,
        "provenance": {
            "converter_version": CONVERTER_VERSION,
            "source_path": _relative(source_path, source_root),
            "source_checksum": _sha256_file(source_path),
        },
    }
    review["provenance"]["content_checksum"] = _sha256_bytes(_canonical_json(review))
    return review


def _build_package_contents(
    source: Path,
    output: Path,
    spec_path: str | Path | None,
    common_error_overrides_path: str | Path,
    vocab_audio_bundle_path: str | Path | None,
    media_approval_ref: str | None,
    source_manifest_path: Path,
) -> Path:
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    common_error_overrides, common_error_metadata = load_common_error_overrides(
        common_error_overrides_path
    )
    applied_override_ids: set[str] = set()
    vocab_audio_manifest: dict[str, Any] | None = None
    if vocab_audio_bundle_path is not None:
        audio_root, vocab_audio_manifest = load_vocab_audio_bundle(vocab_audio_bundle_path)
        if vocab_audio_manifest.get("bundle_checksum") != FIRST_RELEASE_LOCKED_REVISIONS[
            "kokoro_bundle_sha256"
        ]:
            raise ValueError("Vocabulary audio bundle does not match AVOC-0002 lock")
        destination = output / "assets" / "vocab-audio"
        shutil.copytree(audio_root / "clips", destination)

    lessons: list[dict[str, Any]] = []
    for topic_code in CORE_TOPIC_CODES:
        lesson = _build_lesson(
            _source_paths(source, topic_code),
            topic_code,
            output,
            common_error_overrides=common_error_overrides,
            common_error_metadata=common_error_metadata,
            applied_override_ids=applied_override_ids,
            vocab_audio_manifest=vocab_audio_manifest,
            media_approval_ref=media_approval_ref,
        )
        lesson_path = output / "lessons" / lesson["lesson_id"] / "lesson.json"
        _write_json(lesson_path, lesson)
        lessons.append(lesson)

    declared_source = {
        str(row.get("path") or ""): str(row.get("sha256") or "")
        for row in source_manifest.get("inputs") or []
        if isinstance(row, dict) and row.get("root") == "source"
    }
    for lesson in lessons:
        for relative, checksum in (
            (lesson.get("provenance") or {}).get("source_checksums") or {}
        ).items():
            if declared_source.get(str(relative)) != str(checksum):
                raise ValueError(
                    "Generated lesson source provenance is absent or mismatched in "
                    f"{SOURCE_MANIFEST_NAME}: {relative}"
                )

    unused_overrides = set(common_error_overrides) - applied_override_ids
    if unused_overrides:
        raise ValueError(
            "common_error overlay contains keys that did not fill blank source fields: "
            + ", ".join(sorted(unused_overrides))
        )
    if vocab_audio_manifest is not None:
        lesson_card_ids = {
            str(card["lesson_lexeme_id"])
            for lesson in lessons
            for card in lesson["vocabulary"]
        }
        bundle_card_ids = set(vocab_audio_manifest["cards"])
        if lesson_card_ids != bundle_card_ids:
            raise ValueError(
                "Vocabulary audio bundle card set does not match core-30 source; "
                f"missing={sorted(lesson_card_ids - bundle_card_ids)}, "
                f"extra={sorted(bundle_card_ids - lesson_card_ids)}"
            )

    reviews: list[dict[str, Any]] = []
    for review_number in range(1, 7):
        review = _build_review(source, review_number)
        _write_json(output / "reviews" / f"R{review_number:02d}.json", review)
        reviews.append(review)
    for review in reviews:
        provenance = review.get("provenance") or {}
        relative = str(provenance.get("source_path") or "")
        checksum = str(provenance.get("source_checksum") or "")
        if declared_source.get(relative) != checksum:
            raise ValueError(
                "Generated review source provenance is absent or mismatched in "
                f"{SOURCE_MANIFEST_NAME}: {relative}"
            )

    manifest = {
        "schema_version": "2.0.0",
        "package_version": "2.3.0",
        "course_id": "ADV-VOCAB",
        "title": "Advanced Vocabulary Self-paced Course",
        "audience": "assigned_only",
        "lesson_count": 30,
        "review_count": 6,
        "converter_version": CONVERTER_VERSION,
        "source_revision": source_manifest["source_revision"],
        "content_supplements": {
            "common_errors": common_error_metadata,
            "vocabulary_audio": ({
                "engine": vocab_audio_manifest["engine"],
                "model_tag": vocab_audio_manifest["model_tag"],
                "voice": vocab_audio_manifest["voice"],
                "card_count": vocab_audio_manifest["card_count"],
                "clip_count": vocab_audio_manifest["clip_count"],
                "bundle_checksum": vocab_audio_manifest["bundle_checksum"],
            } if vocab_audio_manifest is not None else None),
        },
        "media_approval": ({
            "authority": "content_owner",
            "approval_ref": media_approval_ref,
            "scope": "core-30-listening-media",
        } if media_approval_ref else None),
        "lessons": [
            {
                "lesson_id": lesson["lesson_id"],
                "topic_code": lesson["topic_code"],
                "title": lesson["title"],
                "cluster_id": lesson["cluster"]["cluster_id"],
                "checkpoint_review_id": lesson["review"]["checkpoint_review_id"],
                "json_path": f"lessons/{lesson['lesson_id']}/lesson.json",
                "content_checksum": lesson["provenance"]["content_checksum"],
            }
            for lesson in lessons
        ],
        "reviews": [
            {
                "review_id": review["review_id"],
                "review_of_lessons": review["review_of_lessons"],
                "json_path": f"reviews/{review['review_id']}.json",
                "content_checksum": review["provenance"]["content_checksum"],
            }
            for review in reviews
        ],
    }
    manifest["package_checksum"] = _sha256_bytes(_canonical_json(manifest))
    _write_json(output / "course-manifest.json", manifest)
    shutil.copyfile(source_manifest_path, output / SOURCE_MANIFEST_NAME)

    if spec_path is not None:
        source_spec = Path(spec_path).expanduser().resolve()
        spec_destination = output / "spec" / source_spec.name
        spec_destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_spec, spec_destination)
    return output


def build_package(
    source_root: str | Path,
    output_root: str | Path,
    spec_path: str | Path | None = None,
    *,
    common_error_overrides_path: str | Path = DEFAULT_COMMON_ERROR_OVERRIDES,
    vocab_audio_bundle_path: str | Path | None = None,
    media_approval_ref: str | None = None,
    source_manifest_path: str | Path | None = None,
) -> Path:
    """Build core-30 atomically and refuse to overwrite an existing output."""
    source = Path(source_root).expanduser().resolve()
    output = Path(output_root).expanduser().resolve()
    if not source.is_dir():
        raise FileNotFoundError(f"Source root does not exist: {source}")
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite existing output: {output}")
    if output == source or source in output.parents:
        raise ValueError("Output directory must be outside the canonical source tree")
    manifest_path = Path(
        source_manifest_path or source / SOURCE_MANIFEST_NAME
    ).expanduser().resolve()
    overrides_root = Path(common_error_overrides_path).expanduser().resolve().parent
    manifest_roots: dict[str, Path] = {
        "source": source,
        "common_error_overrides": overrides_root,
    }
    if vocab_audio_bundle_path is not None:
        manifest_roots["vocab_audio_bundle"] = (
            Path(vocab_audio_bundle_path).expanduser().resolve()
        )
    source_report = validate_source_inputs_manifest(
        manifest_path, roots=manifest_roots,
    )
    if not source_report.schema_valid:
        summary = "; ".join(
            f"{issue.code}: {issue.message}" for issue in source_report.errors
        )
        raise ValueError(f"Source input manifest validation failed: {summary}")
    source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    override_path = Path(common_error_overrides_path).expanduser().resolve()
    _require_consumed_inputs_declared(
        source_manifest,
        "common_error_overrides",
        overrides_root,
        [override_path],
    )
    if vocab_audio_bundle_path is not None:
        audio_root = Path(vocab_audio_bundle_path).expanduser().resolve()
        clip_root = audio_root / "clips"
        consumed_audio = [audio_root / "manifest.json"]
        if clip_root.is_dir():
            consumed_audio.extend(
                path for path in clip_root.rglob("*") if path.is_file()
            )
        _require_consumed_inputs_declared(
            source_manifest,
            "vocab_audio_bundle",
            audio_root,
            consumed_audio,
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(
        prefix=f".{output.name}.building-",
        dir=output.parent,
    ))
    try:
        _build_package_contents(
            source,
            staging,
            spec_path,
            common_error_overrides_path,
            vocab_audio_bundle_path,
            media_approval_ref,
            manifest_path,
        )
        package_report = validate_package(staging)
        if not package_report.publish_ready:
            summary = "; ".join(
                f"{issue.code}: {issue.message}"
                for issue in (*package_report.errors, *package_report.warnings)
            )
            raise ValueError(f"Generated package validation failed: {summary}")
        staging.rename(output)
    except Exception:
        shutil.rmtree(staging)
        raise
    return output
