"""Bounded, manually authored support for L1/L2 only. No provider calls."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def plain_source(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    return re.sub(r"\s+", " ", re.sub(r"[*_`#]", "", text)).strip()


def word_count(body: str) -> int:
    return len(re.findall(r"\b[\w]+(?:['’\-][\w]+)*\b", plain_source(body)))


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class PracticePhrase(_Strict):
    source: str = Field(min_length=1, max_length=300)
    target: str = Field(min_length=1, max_length=400)


class PracticeUnit(_Strict):
    id: str = Field(pattern=r"^[a-z0-9-]{1,40}$")
    source: str = Field(min_length=1, max_length=4000)
    translation_vi: str = Field(min_length=1, max_length=6000)
    precision: Literal["sentence", "paragraph"] = "sentence"
    phrases: list[PracticePhrase] = Field(default_factory=list, max_length=24)


class PracticeIllustration(_Strict):
    src: str = Field(pattern=r"^/reading-illustrations/[a-z0-9-]+\.svg$")
    alt: str = Field(min_length=1, max_length=800)
    caption: str = Field(min_length=1, max_length=800)


class PracticeSupport(_Strict):
    schema_version: Literal[1]
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    translation_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    units: list[PracticeUnit] = Field(default_factory=list, max_length=160)
    illustrations: list[PracticeIllustration] = Field(default_factory=list, max_length=6)


class PracticeEvidence(_Strict):
    source: str = Field(min_length=1, max_length=4000)
    precision: Literal["quote"] = "quote"
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    illustrations: list[PracticeIllustration] = Field(default_factory=list, max_length=6)


def question_digest(question: dict) -> str:
    return digest(json.dumps({key: question.get(key) for key in
                             ("q_num", "question_type", "prompt", "payload", "answer")},
                            sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def validated_support(metadata: dict, body: str) -> PracticeSupport | None:
    raw = metadata.get("practice_support")
    if not isinstance(raw, dict) or len(json.dumps(raw, ensure_ascii=False)) > 250_000:
        return None
    # Evidence and answer-bearing figures are retained on the server until check.
    public = {key: value for key, value in raw.items()
              if key not in {"question_evidence"}}
    try:
        support = PracticeSupport.model_validate(public)
    except ValidationError:
        return None
    translation = metadata.get("translation_vi") or ""
    if not isinstance(translation, str) or support.source_sha256 != digest(body) \
            or support.translation_sha256 != digest(translation):
        return None
    source = plain_source(body)
    ids: set[str] = set()
    ranges: list[tuple[int, int]] = []
    for unit in support.units:
        if unit.id in ids or source.count(unit.source) != 1:
            return None
        ids.add(unit.id)
        at = source.index(unit.source)
        span = (at, at + len(unit.source))
        if any(span[0] < end and start < span[1] for start, end in ranges):
            return None
        ranges.append(span)
        for side in ("source", "target"):
            text = unit.source if side == "source" else unit.translation_vi
            spans: list[tuple[int, int]] = []
            for phrase in unit.phrases:
                value = getattr(phrase, side)
                if text.count(value) != 1:
                    return None
                start = text.index(value)
                end = start + len(value)
                if any(start < previous_end and previous_start < end for previous_start, previous_end in spans):
                    return None
                spans.append((start, end))
    return support


def checked_evidence(metadata: dict, body: str, question: dict) -> PracticeEvidence | None:
    if not validated_support(metadata, body):
        return None
    raw = metadata["practice_support"].get("question_evidence", {})
    if not isinstance(raw, dict) or len(raw) > 80:
        return None
    item = raw.get(str(question["q_num"]))
    if not isinstance(item, dict) or item.get("question_sha256") != question_digest(question):
        return None
    try:
        evidence = PracticeEvidence.model_validate({
            **{key: value for key, value in item.items() if key != "question_sha256"},
            "source_sha256": digest(body),
        })
    except ValidationError:
        return None
    if plain_source(body).count(evidence.source) != 1:
        return None
    return evidence


class ReadingPracticeDetail(BaseModel):
    id: str
    slug: str
    title: str
    body_markdown: str
    source_sha256: str | None = None
    difficulty_level: str | None = None
    topic_tags: list[str] = Field(default_factory=list)
    image_url: str | None = None
    glossary: list[dict] = Field(default_factory=list)
    skill_focus: str | None = None
    word_count: int | None = None
    estimated_minutes: int | None = None
    translation_vi: str | None = None
    grammar_focus: list[dict] = Field(default_factory=list)
    practice_support: PracticeSupport | None = None
    questions: list[dict] = Field(default_factory=list)


class ReadingPracticeResult(BaseModel):
    q_num: int
    correct: bool
    expected: str
    explanation: str | None = None
    skill_tag: str | None = None
    evidence: PracticeEvidence | None = None


class ReadingPracticeCheck(BaseModel):
    results: list[ReadingPracticeResult]
