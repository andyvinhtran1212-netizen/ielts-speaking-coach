"""Check citations of the learner's writing, without restricting new suggestions.

This is a literal-evidence guard, not a second IELTS grader. It cannot verify
unquoted semantic claims or band calibration. Historical examples, task facts,
rewrites and suggestions are deliberately not treated as the current essay.
"""
from __future__ import annotations

import json
import re
import unicodedata

from models.writing_feedback import Pass2Refinement, Pass3Rewrites, WritingFeedback


GROUNDING_INSTRUCTION = """
## Source grounding — original essay only
Grade ONLY the learner's original essay. Do not credit words, phrases or
sentences from improvedEssay, rewrites, suggestions, the task prompt, calibration
examples or previous essays as language the learner used in this essay.
Every original/context excerpt must be copied from the current essay. In
criteria feedback, summary and strengths, quote actual essay excerpts whenever
you attribute a word or construction to the learner; do not evade this rule by
removing quotation marks. Keep proposed new language explicitly labelled as a
suggestion, separate from observations about what the learner wrote. New words
are welcome in suggestions and rewrites; they are not evidence for band scores.
Before output, verify each citation against the original essay and reassess any
claim or score that relied on language you generated yourself.
""".strip()

_PUNCTUATION = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"',
                              "–": "-", "—": "-", "‑": "-"})
# Apostrophes inside words (including plural possessives) are not quote ends.
_QUOTES = re.compile(
    r'"([^"]+)"'
    r"|(?<!\w)'((?:[^']|(?<=\w)'(?=\w)|(?<=s)'(?=\s))+)'(?!\w)"
    r'|`([^`]+)`'
)
_PROPOSAL = re.compile(
    r"\b(?:có thể|nên|hãy|gợi ý|đề xuất|thử dùng|thay(?: thế)?\b[^.!?;]*?\bbằng|"
    r"chưa dùng|chưa sử dụng|không dùng|không sử dụng|thiếu|"
    r"could|should|consider|suggest|replace\b[^.!?;]*?\bwith|instead use|"
    r"does not use|did not use|doesn't use|missing)\b", re.I
)
_ATTRIBUTION = re.compile(
    r"\b(?:(?:em|bạn|anh|chị|học viên)\s+(?:đã\s+)?(?:sử dụng|dùng|viết|nêu)|"
    r"(?:you|the student|the learner)\s+(?:have\s+|has\s+)?(?:used|use|wrote|write))\b",
    re.I,
)


def _normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).translate(_PUNCTUATION).casefold().split())


def _in_essay(excerpt: str, essay: str, *, allow_ellipsis: bool = False) -> bool:
    excerpt = _normalize(excerpt).strip()
    if allow_ellipsis and "..." in excerpt:
        # Explicit omissions are allowed in prose citations. Each remaining
        # fragment must still occur verbatim, in order and at word boundaries.
        fragments = [part.strip() for part in excerpt.split("...") if part.strip()]
        offset = 0
        for fragment in fragments:
            match = re.search(r"(?<!\w)" + re.escape(fragment) + r"(?!\w)", essay[offset:])
            if match is None:
                return False
            offset += match.end()
        return bool(fragments)
    return bool(excerpt) and re.search(r"(?<!\w)" + re.escape(excerpt) + r"(?!\w)", essay) is not None


class UngroundedWritingFeedbackError(ValueError):
    def __init__(self, issues: list[tuple[str, str]]):
        self.issues = issues
        # Exception text reaches operational logs. Keep learner/model prose out.
        super().__init__("Unsupported essay citations at " + ", ".join(p for p, _ in issues[:8]))

    def repair_instruction(self) -> str:
        return (
            "\n\nThe previous response attributed these excerpts to the original "
            "essay, but they are absent: "
            + json.dumps(self.issues[:10], ensure_ascii=False)
            + ". Regenerate the complete requested JSON using only the original "
            "essay as evidence. Reassess affected claims and scores; do not merely "
            "remove quotation marks or substitute a made-up excerpt. Keep genuinely "
            "new language only in clearly labelled suggestions/rewrites."
        )


def validate_writing_grounding(feedback, essay_text: str) -> None:
    essay = _normalize(essay_text)
    issues: list[tuple[str, str]] = []

    def original(path: str, text: str):
        if not _in_essay(text, essay):
            issues.append((path, text[:240]))

    def observations(path: str, text: str):
        text = text.translate(_PUNCTUATION)
        for match in _QUOTES.finditer(text):
            excerpt = next(g for g in match.groups() if g is not None)
            if _in_essay(excerpt, essay, allow_ellipsis=True):
                continue
            # A clearly proposed/absent expression is not a claim of usage.
            # A later explicit attribution resets that distinction, including
            # mixed "could use X, but you used Y" sentences.
            prefix = re.split(r"[.!?;\n]", _QUOTES.sub("", text[:match.start()]))[-1]
            proposals = list(_PROPOSAL.finditer(prefix))
            attributions = list(_ATTRIBUTION.finditer(prefix))
            if proposals and (not attributions or proposals[-1].start() > attributions[-1].start()):
                continue
            issues.append((path, excerpt[:240]))

    def mistakes(items, prefix):
        for i, item in enumerate(items):
            original(f"{prefix}[{i}].original", item.original)

    if isinstance(feedback, Pass2Refinement):
        mistakes(feedback.added_mistakes, "added_mistakes")
        observations("rationale", feedback.rationale)
    elif isinstance(feedback, Pass3Rewrites):
        for i, item in enumerate(feedback.sentence_rewrites):
            original(f"sentence_rewrites[{i}].original_sentence", item.original_sentence)
    elif isinstance(feedback, WritingFeedback):
        observations("overallBandScoreSummary", feedback.overallBandScoreSummary)
        for name, item in feedback.criteriaFeedback:
            observations(f"criteriaFeedback.{name}.feedback", item.feedback)
        for i, text in enumerate(feedback.keyTakeaways.strengths):
            observations(f"keyTakeaways.strengths[{i}]", text)
        for i, text in enumerate(feedback.keyTakeaways.areasForImprovement):
            observations(f"keyTakeaways.areasForImprovement[{i}]", text)
        mistakes(feedback.mistakeAnalysis, "mistakeAnalysis")
        for i, item in enumerate(feedback.ideaDevelopmentAnalysis or []):
            for field in ("originalIdea", "issue", "explanation"):
                observations(f"ideaDevelopmentAnalysis[{i}].{field}", getattr(item, field))
        for i, item in enumerate(feedback.coherenceAnalysis or []):
            for field in ("location", "issue", "explanation"):
                observations(f"coherenceAnalysis[{i}].{field}", getattr(item, field))
        if feedback.counterargumentAnalysis:
            observations("counterargumentAnalysis.feedback", feedback.counterargumentAnalysis.feedback)
        if feedback.lexicalAnalysis:
            for i, item in enumerate(feedback.lexicalAnalysis.wordsToUpgrade):
                original(f"lexicalAnalysis.wordsToUpgrade[{i}].original", item.original)
                original(f"lexicalAnalysis.wordsToUpgrade[{i}].context", item.context)
        structure = feedback.sentenceStructureAnalysis or {}
        for i, item in enumerate(structure.get("sentenceUpgrades") or []):
            if isinstance(item, dict) and isinstance(item.get("original"), str):
                original(f"sentenceStructureAnalysis.sentenceUpgrades[{i}].original", item["original"])
        current = structure.get("current_essay_observation")
        if isinstance(current, str):
            observations("sentenceStructureAnalysis.current_essay_observation", current)
        # Other structure/history fields can legitimately quote older essays.
        # Suggestions, improvedEssay and rewritten sentences may use new words.
    if issues:
        raise UngroundedWritingFeedbackError(issues)
