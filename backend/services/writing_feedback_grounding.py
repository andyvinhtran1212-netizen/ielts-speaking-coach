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
# Reference labels that the learner omitted and correction contrasts introduce
# new language too. Later explicit learner attribution still takes precedence;
# source-only fields never use this proposal exemption.
_PROPOSAL = re.compile(
    r"\b(?:có thể|nên|hãy|gợi ý|đề xuất|thử dùng|thay(?: thế)?\b[^.!?;]*?\bbằng|"
    r"thay vì|thay cho|nhầm lẫn giữa|phân biệt giữa|"
    r"(?:quên|bỏ sót)\s+(?:nêu|gọi tên|ghi|định danh|tên|nhãn)|"
    r"không rõ\s+là\s+(?:nhóm|danh mục)|"
    r"chưa giới thiệu(?: rõ)?\s+(?:nhóm|danh mục)|"
    r"cần\s+(?:dùng|sử dụng|thêm|bổ sung|viết|giải thích|nêu|định danh|gọi tên)|"
    r"chưa dùng|chưa sử dụng|không dùng|không sử dụng|thiếu|"
    r"could|should|need(?:s)? to (?:use|add|explain)|consider|suggest|replace\b[^.!?;]*?\bwith|instead use|"
    r"does not use|did not use|doesn't use|missing)\b", re.I
)
_ATTRIBUTION = re.compile(
    r"\b(?:(?:em|bạn|anh|chị|học viên)\s+(?:đã\s+)?(?:sử dụng|dùng|viết|nêu)|"
    r"(?:you|the student|the learner)\s+(?:have\s+|has\s+)?(?:used|use|wrote|write))\b",
    re.I,
)
# Advice to KEEP a usage presupposes that the learner already used it.
_CONTINUATION = re.compile(
    r"\b(?:tiếp tục|duy trì|phát huy|giữ lại|continue(?: to)? (?:use|using)|"
    r"keep using|retain|maintain)\b", re.I,
)
_PEDAGOGICAL_QUESTION = re.compile(
    r"(?:trả lời|giải thích|làm rõ|answer|explain)\s*(?:được\s*)?"
    r"(?:(?:câu hỏi|the question)\s*)?[:：]?\s*$|"
    r"(?:câu hỏi|the question)\s*[:：]?\s*$", re.I,
)
_QUESTION_LABELS = {"như thế nào", "tại sao", "vì sao", "cụ thể", "how", "why", "so what"}
_EXAMPLE_LABEL = re.compile(
    r"\s*(?:ví dụ(?: minh họa)?|example(?: wording)?|for example|for instance)"
    r"\s*[:：,]?\s*(?:(?:,|/|or\b|and\b|hoặc\b|hay\b|và\b)\s*)*", re.I,
)
_SUGGESTION_LABEL = re.compile(
    r"\s*(?:suggestion|suggested (?:example|wording|revision)|"
    r"proposed (?:example|wording|revision))\s*[:：]\s*"
    r"(?:(?:,|/|or\b|and\b)\s*)*", re.I,
)
_GRAMMAR_CONTEXT = re.compile(r"\b(?:mẫu câu|cấu trúc|mệnh đề|liên từ)\b", re.I)
_GRAMMAR_NOTATION = re.compile(r"\b(?:[SVXYZ]|V(?:-?ing|inf|[123])|NP|Adj|Adv)\b")
_TASK_SOURCE = re.compile(r"\btrong (?:biểu đồ|đồ thị|bảng|đề bài)\b", re.I)
_TASK_LABEL = re.compile(
    r"\b(?:nhóm(?: không tên| tần suất| danh mục)?|tần suất|danh mục)\s*\(?\s*$", re.I,
)
_GLOSS_CONTEXT = re.compile(
    r"\b(?:để|phrasal verb|nghĩa của(?: phrasal verb)?|có nghĩa là|mang nghĩa|dịch là)\s*$", re.I,
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


def _grounded_gloss(excerpt: str, preceding: str, prefix: str, essay: str) -> bool:
    """A translation or dictionary lemma explains an already-quoted source.

    This never validates an original excerpt or credits an unrelated English
    phrase. Lemmas must inflect to a phrase actually present in the essay.
    """
    if not _GLOSS_CONTEXT.search(prefix):
        return False
    grounded_source = any(
        _in_essay(next(g for g in m.groups() if g is not None), essay, allow_ellipsis=True)
        for m in _QUOTES.finditer(preceding)
    )
    if not grounded_source:
        return False
    if any(c.isalpha() and not c.isascii() for c in excerpt):
        return True  # Explicit non-English gloss of the grounded source.
    first, separator, rest = _normalize(excerpt).partition(" ")
    if not separator or not first.isascii() or not first.isalpha():
        return False
    forms = [first + ending for ending in ("s", "ed", "ing")]
    if first.endswith("e"):
        forms.append(first[:-1] + "ing")
    return any(_in_essay(form + " " + rest, essay) for form in forms)


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


def validate_writing_grounding(feedback, essay_text: str, *, task_type: str | None = None) -> None:
    essay = _normalize(essay_text)
    issues: list[tuple[str, str]] = []

    def original(path: str, text: str):
        if not _in_essay(text, essay):
            issues.append((path, text[:240]))

    def observations(path: str, text: str, *, allow_proposals: bool = True):
        text = text.translate(_PUNCTUATION)
        for match in _QUOTES.finditer(text):
            excerpt = next(g for g in match.groups() if g is not None)
            if _in_essay(excerpt, essay, allow_ellipsis=True):
                continue
            preceding = text[:match.start()]
            masked_prefix = _QUOTES.sub("", preceding)
            prefix = re.split(r"[.!?;\n]", masked_prefix)[-1]
            # Abstract grammar notation is a structural description, not a
            # verbatim citation, including in strengths/current observations.
            # Source fields still go through original(), which has no exemption.
            if _GRAMMAR_CONTEXT.search(prefix) and _GRAMMAR_NOTATION.search(excerpt):
                continue
            # Source-only fields cannot turn invented evidence into a proposal.
            if not allow_proposals:
                issues.append((path, excerpt[:240]))
                continue
            # A clearly proposed/absent expression is not a claim of usage.
            # A later explicit attribution resets that distinction, including
            # mixed "could use X, but you used Y" sentences.
            proposals = list(_PROPOSAL.finditer(prefix))
            attributions = list(_ATTRIBUTION.finditer(prefix)) + list(_CONTINUATION.finditer(prefix))
            last_attribution = max((m.start() for m in attributions), default=-1)
            # The shipped L3 calibration asks the learner to answer "NHƯ THẾ
            # NÀO". That is a teaching question, not quoted learner vocabulary.
            question = _PEDAGOGICAL_QUESTION.search(prefix)
            if (question and question.start() > last_attribution
                    and _normalize(excerpt).rstrip(" ?!:") in _QUESTION_LABELS):
                continue
            if proposals and proposals[-1].start() > last_attribution:
                continue
            # A chart category need not appear in an essay that omitted its
            # label. Restrict this to Task 1 and do not exempt explicit learner
            # wording claims such as "Em đã dùng 'invented category'".
            if (task_type == "task1_academic" and last_attribution < 0
                    and (_TASK_SOURCE.search(prefix) or _TASK_LABEL.search(prefix))):
                continue
            if _grounded_gloss(excerpt, preceding, prefix, essay):
                continue
            # A standalone example label introduces new language. Match the
            # whole prefix so "You used ... For example ..." cannot disguise
            # existing-usage praise as a proposal. Explicit suggestion labels
            # must occupy the clause prefix, never a possessive or past verb.
            if (_EXAMPLE_LABEL.fullmatch(masked_prefix)
                    or _SUGGESTION_LABEL.fullmatch(prefix)):
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
            observations(f"keyTakeaways.strengths[{i}]", text, allow_proposals=False)
        for i, text in enumerate(feedback.keyTakeaways.areasForImprovement):
            observations(f"keyTakeaways.areasForImprovement[{i}]", text)
        mistakes(feedback.mistakeAnalysis, "mistakeAnalysis")
        for i, item in enumerate(feedback.ideaDevelopmentAnalysis or []):
            for field in ("originalIdea", "issue", "explanation"):
                observations(f"ideaDevelopmentAnalysis[{i}].{field}", getattr(item, field),
                             allow_proposals=field != "originalIdea")
        for i, item in enumerate(feedback.coherenceAnalysis or []):
            for field in ("location", "issue", "explanation"):
                observations(f"coherenceAnalysis[{i}].{field}", getattr(item, field),
                             allow_proposals=field != "location")
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
            observations("sentenceStructureAnalysis.current_essay_observation", current,
                         allow_proposals=False)
        # Other structure/history fields can legitimately quote older essays.
        # Suggestions, improvedEssay and rewritten sentences may use new words.
    if issues:
        raise UngroundedWritingFeedbackError(issues)
