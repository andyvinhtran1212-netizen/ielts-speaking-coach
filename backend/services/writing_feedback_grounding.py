"""Check citations of the learner's writing, without restricting new suggestions.

This is a literal-evidence guard, not a second IELTS grader. It cannot verify
unquoted semantic claims or band calibration. Historical examples, task facts,
rewrites and suggestions are deliberately not treated as the current essay.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field

from models.writing_feedback import Pass2Refinement, Pass3Rewrites, WritingFeedback
from services.mistake_authenticity import is_noncorrection


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
Copy every "original"/"context" field and every quoted excerpt
character-for-character from one contiguous stretch of the essay, keeping the
learner's own spelling, grammar errors and verb forms: do not correct, inflect,
shorten, join or add words (no added subject such as "it"). Only essay excerpts
go inside quotation marks: do not quote the task prompt, a paraphrase or
Vietnamese summary of the learner's idea, a term or concept the learner did not
use, or a sentence pattern presented as if it were the learner's wording.
This never discourages reporting errors: a mistakeAnalysis "original" is meant
to contain the learner's faulty wording, so quote a sentence with errors
exactly as written and put the correction only in "suggestion".
""".strip()

# Quote detection in prose keeps its original mark set.
_QUOTE_MARKS = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"',
                              "–": "-", "—": "-", "‑": "-"})
# One comparison fold for essay and excerpt alike: variants of the same mark
# only (the mistake_authenticity/highlighter apostrophes, double quotes and
# dashes, plus Unicode hyphens). Zero-width characters and soft hyphens go.
_PUNCTUATION = str.maketrans({
    "’": "'", "‘": "'", "ʼ": "'", "′": "'",
    "“": '"', "”": '"', "„": '"',
    "–": "-", "—": "-", "―": "-", "−": "-", "‑": "-", "‐": "-", "‒": "-",
    "\u200b": None, "\u200c": None, "\u200d": None, "\ufeff": None, "\u00ad": None,
})
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
    r"(?:bài viết|bài làm)(?: này)?\s+(?:đã\s+)?(?:sử dụng|dùng|viết|nêu|gọi)|"
    r"(?:you|the student|the learner)\s+(?:have\s+|has\s+)?(?:used|use|wrote|write)|"
    r"(?:the essay|this essay|the writing)\s+(?:has\s+)?(?:used|uses|wrote|states|calls|called))\b",
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
_GRAMMAR_NOTATION = re.compile(r"\b(?:[SVXYZ]|V(?:-?ing|inf|[123])|NP|Adj|Adv)\b|\S\s*\+\s*\S")
_TASK_LABEL = re.compile(
    r"\b(?:nhóm(?: không tên| tần suất| danh mục)?|tần suất|danh mục)\s*\(?\s*$", re.I,
)
# Naming a concept or technical term right before the quote ("hiện tượng
# 'induced demand'", "thuật ngữ chuyên môn như 'social mobility'") introduces
# reference language. Only listed qualifiers may intervene, so a usage claim
# such as "hiện tượng lặp từ 'X'" (repeats X) is still checked.
_TERM_LABEL = re.compile(
    r"\b(?:thuật ngữ|khái niệm|hiện tượng|term|concept|phenomenon)"
    r"(?:\s+(?:chuyên môn|học thuật|quy hoạch|đô thị|kinh tế|xã hội|kinh điển|này|đó|"
    r"như|là|gọi là|hoặc|hay|và|technical|academic|this|such as|like|called|known as|or|and)"
    r"|\s*,|\s*\([^()]*\))*\s*\(?\s*$", re.I,
)
# Absence right before the quote ("đoạn 2 lại không có 'Firstly'").
_ABSENCE = re.compile(
    r"(?:\b(?:không|chưa)\s+có|\b(?:lacks?|lacking|without))(?:\s+(?:từ|cụm từ|câu|the word|the phrase))?\s*$",
    re.I,
)
# A quoted mention of the task question ("câu hỏi 'To what extent ...'").
_PROMPT_REFERENCE = re.compile(r"\b(?:câu hỏi|đề bài|chủ đề|yêu cầu|question|prompt|task)\b", re.I)
# Usage claims that _ATTRIBUTION does not name: nominal or possessive use
# ("your use of the term", "việc sử dụng thuật ngữ") and naming verbs with a
# learner subject ("em gọi hiện tượng này"). They disable reference exemptions.
_USAGE_CLAIM = re.compile(
    r"\b(?:use|usage)\s+of\b|"
    r"\b(?:việc|cách)\s+(?:em\s+|bạn\s+)?(?:sử dụng|dùng|vận dụng)\b|"
    r"\b(?:em|bạn|anh|chị|học viên|you|the student|the learner|the writer|the essay|this essay)"
    r"\s+(?:đã\s+|has\s+|have\s+)?(?:gọi|call(?:s|ed)?|name[sd]?)\b",
    re.I,
)
# Claims about the learner's wording (not ideas): "em dùng", "you used".
_WORDING_VERB = re.compile(r"\b(?:sử dụng|dùng|viết|gọi|use[sd]?|wrote|write|calls?|called)\b", re.I)
_NEGATIONS = {"not", "no", "never", "cannot", "nor", "none", "nothing", "neither"}
_SIBILANT_ENDINGS = ("s", "x", "z", "ch", "sh")
_NEAR_MISS_GAP = 2


_VI_MARKS = {"\u031b", "\u0306", "\u0309", "\u0323"}   # horn, breve, hook, dot below
_VI_TONES = {"\u0300", "\u0301", "\u0303", "\u0309", "\u0323"}


def _is_negation(word: str) -> bool:
    return word in _NEGATIONS or word.endswith("n't")


def _vietnamese(text: str) -> bool:
    """Letters only Vietnamese writes: horn/breve/hook/dot-below marks, đ,
    ĩ/ũ/ỹ, or a circumflex stacked with a tone (ấ, ề). A lone acute or
    grave ('cliché', 'giá') is not enough on its own."""
    for char in unicodedata.normalize("NFC", text.casefold()):
        if char == "đ":
            return True
        base, *marks = unicodedata.normalize("NFD", char)
        if (_VI_MARKS.intersection(marks)
                or ("\u0303" in marks and base in "iuy")
                or ("\u0302" in marks and _VI_TONES.intersection(marks))):
            return True
    return False


def _vietnamese_quote(excerpt: str, sentence: str) -> bool:
    """A Vietnamese description, never an excerpt of the English essay: the
    quote itself is Vietnamese, or it is an accented word quoted in the same
    sentence as a Vietnamese quote ("giữa 'giá' và 'chất lượng'")."""
    if _vietnamese(excerpt):
        return True
    if not any(c.isalpha() and not c.isascii() for c in excerpt):
        return False
    return any(_vietnamese(next(g for g in m.groups() if g is not None))
               for m in _QUOTES.finditer(sentence))


def _tokens(text: str) -> list[str]:
    return re.findall(r"\w+(?:'\w+)*", text)


def _same_word(a: str, b: str) -> bool:
    """Equal, or the same word with/without a plural or third-person -s:
    'reduce'/'reduces', 'bus'/'buses', 'city'/'cities'. No ending is stripped,
    so 'plan'/'plane' or 'car'/'care' stay different words (Codex #1729)."""
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    if len(short) < 3:
        return False
    if long_ == short + "s":
        return True
    if long_ == short + "es" and short.endswith(_SIBILANT_ENDINGS):
        return True
    return short.endswith("y") and short[-2] not in "aeiou" and long_ == short[:-1] + "ies"


def _near_miss(excerpt: str, essay: str) -> bool:
    """A slightly misquoted excerpt of language the learner really wrote.

    Every quoted word must occur in the essay, in the same order, up to a
    plural/third-person -s (see _same_word), inside one window at most two essay words longer
    (an omitted "more"). The quote can never add a word or drop a negation.
    Used only to downgrade prose misquotes to warnings, never to ground a
    strict original/context field.
    """
    quoted = _tokens(_normalize(excerpt))
    if not quoted or "..." in excerpt or "…" in excerpt:
        return False
    words = _tokens(essay)
    for start, word in enumerate(words):
        if not _same_word(word, quoted[0]):
            continue
        i, j = 1, start + 1
        limit = min(len(words), start + len(quoted) + _NEAR_MISS_GAP)
        while i < len(quoted) and j < limit:
            if _same_word(words[j], quoted[i]):
                i += 1
            elif _is_negation(words[j]):
                break
            j += 1
        if i == len(quoted):
            return True
    return False


_GLOSS_CONTEXT = re.compile(
    r"\b(?:để|phrasal verb|nghĩa của(?: phrasal verb)?|có nghĩa là|mang nghĩa|dịch là)\s*$", re.I,
)


_BRACKETED_ELLIPSIS = re.compile(r"[\[(]\s*\.\.\.\s*[\])]")
_TRAILING_PUNCTUATION = ",.;:!? "


def _normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).translate(_PUNCTUATION).casefold().split())


_EDGE_PUNCTUATION = ",.;:!?"


def _in_essay(excerpt: str, essay: str, *, allow_ellipsis: bool = False) -> bool:
    excerpt = _normalize(excerpt).strip()
    # A sentence copied verbatim may end in "." where the essay continues with
    # "," (or start after a stripped comma). Every word must still be verbatim
    # and contiguous; no other prose convention applies to strict fields.
    excerpt = excerpt.strip(_EDGE_PUNCTUATION + " ") or excerpt
    if allow_ellipsis:
        # Prose quoting conventions, not new wording: "[...]" marks an omission
        # like "...", and a closing , . ; : ! ? may sit inside the quotes. Every
        # remaining word must still occur verbatim; strict fields never opt in.
        excerpt = _BRACKETED_ELLIPSIS.sub("...", excerpt)
        excerpt = excerpt.rstrip(_TRAILING_PUNCTUATION).strip() or excerpt
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
    if not excerpt:
        return False
    if re.search(r"(?<!\w)" + re.escape(excerpt) + r"(?!\w)", essay) is not None:
        return True
    if allow_ellipsis and "/" in excerpt:
        # "low incomes/people with low incomes" lists two real excerpts.
        parts = [part.strip() for part in excerpt.split("/")]
        return all(parts) and all(_in_essay(part, essay) for part in parts)
    return False


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
    if not first.isascii() or not first.isalpha():
        return False
    forms = [first + ending for ending in ("s", "ed", "ing")]
    if first.endswith("e"):
        forms.append(first[:-1] + "ing")
    suffix = " " + rest if separator else ""
    return any(_in_essay(form + suffix, essay) for form in forms)


REPAIR_SPAN_CHARS = 120
# Bounded degradation: a response whose only unsupported citations sit in a few
# list items keeps everything else; those items are dropped. Any failure in a
# single-valued field (summary, criterion feedback, observations, rationale),
# more than MAX_DROPPED_ITEMS items, or a list that would lose its last item or
# more than half of its items still rejects the response (repair / retry).
MAX_DROPPED_ITEMS = 3
_DROPPABLE = re.compile(
    r"^((?:keyTakeaways\.(?:strengths|areasForImprovement)|mistakeAnalysis|"
    r"ideaDevelopmentAnalysis|coherenceAnalysis|lexicalAnalysis\.wordsToUpgrade|"
    r"sentenceStructureAnalysis\.sentenceUpgrades|added_mistakes|sentence_rewrites))"
    r"\[(\d+)\]"
)


class UngroundedWritingFeedbackError(ValueError):
    def __init__(self, issues: list[tuple[str, str]]):
        self.issues = issues
        # Exception text reaches operational logs. Keep learner/model prose out.
        super().__init__("Unsupported essay citations at " + ", ".join(p for p, _ in issues[:8]))

    def repair_instruction(self) -> str:
        lines = "\n".join(
            f"- {path}: {json.dumps(span[:REPAIR_SPAN_CHARS], ensure_ascii=False)}"
            for path, span in self.issues[:10]
        )
        return (
            "\n\nThe previous response attributed these excerpts to the original "
            "essay, but they are absent (JSON path: excerpt as written):\n" + lines
            + "\nFix exactly these citations. Copy each excerpt character-for-character "
            "from one stretch of the essay, keeping the learner's own spelling, errors "
            "and verb forms; never correct, inflect, shorten or add words. If it is not "
            "the learner's wording (task question, paraphrase, Vietnamese summary, term "
            "or pattern), do not present it as an essay quote. Regenerate the complete "
            "requested JSON using only the original essay as evidence. Reassess affected "
            "claims and scores; do not merely remove quotation marks or substitute a "
            "made-up excerpt. Keep genuinely new language only in clearly labelled "
            "suggestions/rewrites."
        )


# Below this overall band an essay always has at least one real, quotable
# issue (Rule 1 in prompts/writing/v2/shared/strict_grammar_check.md). Only a
# genuinely error-free 8.5+ script may return an empty mistakeAnalysis.
MISTAKE_ANALYSIS_EMPTY_MIN_BAND = 8.5


class MissingMistakeAnalysisError(ValueError):
    """A full pass-1 answer below band 8.5 with no real correction."""

    error_code = "missing_mistake_analysis"

    def __init__(self, band: float):
        self.band = band
        # Operational text only: the band, never learner or model prose.
        super().__init__(
            f"mistakeAnalysis has no real correction at overallBandScore {band:g} "
            f"(< {MISTAKE_ANALYSIS_EMPTY_MIN_BAND:g})"
        )

    def repair_instruction(self) -> str:
        return (
            f"\n\nThe previous response returned no usable mistakeAnalysis entries for an "
            f"essay graded overallBandScore {self.band:g}. Below band "
            f"{MISTAKE_ANALYSIS_EMPTY_MIN_BAND:g} every essay contains real issues: re-scan "
            "the essay sentence by sentence (grammar, articles, prepositions, word choice, "
            "collocation, punctuation, awkward phrasing) and list each real error in "
            "mistakeAnalysis. Copy every \"original\" character-for-character from one "
            "contiguous stretch of the essay, INCLUDING the learner's errors (quoting a "
            "faulty sentence exactly is what grounding requires), with a \"suggestion\" "
            "that actually differs from it. Never invent an error, and do not raise the "
            "band to avoid listing errors: set every score from the band descriptors. "
            "Regenerate the complete requested JSON."
        )


def missing_mistake_analysis(feedback) -> bool:
    """True for a full pass-1 WritingFeedback below band 8.5 whose
    mistakeAnalysis has no real correction (the entries essay_service keeps
    after drop_noncorrection_mistakes). Pass 2/3 schemas are never checked."""
    if not isinstance(feedback, WritingFeedback):
        return False
    if feedback.overallBandScore >= MISTAKE_ANALYSIS_EMPTY_MIN_BAND:
        return False
    return not any(not is_noncorrection(m.original, m.suggestion)
                   for m in feedback.mistakeAnalysis)


@dataclass
class GroundingReport:
    """Non-fatal outcome: paths only, never learner or model text."""

    dropped: list[str] = field(default_factory=list)    # removed list items
    warnings: list[str] = field(default_factory=list)   # near-miss prose quotes

    def metadata(self) -> dict:
        meta: dict = {}
        if self.dropped:
            meta["grounding_dropped_count"] = len(self.dropped)
            meta["grounding_dropped"] = self.dropped[:MAX_DROPPED_ITEMS]
        if self.warnings:
            meta["grounding_warning_count"] = len(self.warnings)
            meta["grounding_warnings"] = self.warnings[:10]
        return meta


def _list_slots(feedback) -> dict:
    """Droppable list name -> (current items, setter)."""
    slots: dict = {}

    def add(name, owner, attr):
        items = getattr(owner, attr, None)
        if isinstance(items, list):
            slots[name] = (items, lambda kept, o=owner, a=attr: setattr(o, a, kept))

    if isinstance(feedback, Pass2Refinement):
        add("added_mistakes", feedback, "added_mistakes")
    elif isinstance(feedback, Pass3Rewrites):
        add("sentence_rewrites", feedback, "sentence_rewrites")
    elif isinstance(feedback, WritingFeedback):
        add("keyTakeaways.strengths", feedback.keyTakeaways, "strengths")
        add("keyTakeaways.areasForImprovement", feedback.keyTakeaways, "areasForImprovement")
        for attr in ("mistakeAnalysis", "ideaDevelopmentAnalysis", "coherenceAnalysis"):
            add(attr, feedback, attr)
        if feedback.lexicalAnalysis:
            add("lexicalAnalysis.wordsToUpgrade", feedback.lexicalAnalysis, "wordsToUpgrade")
        structure = feedback.sentenceStructureAnalysis
        if isinstance(structure, dict) and isinstance(structure.get("sentenceUpgrades"), list):
            slots["sentenceStructureAnalysis.sentenceUpgrades"] = (
                structure["sentenceUpgrades"],
                lambda kept, d=structure: d.__setitem__("sentenceUpgrades", kept),
            )
    return slots


def _drop_plan(feedback, issues) -> dict | None:
    """{list name: indexes to drop} when every issue is a bounded list-item
    failure; None when the response must be rejected."""
    plan: dict[str, set[int]] = {}
    for path, _ in issues:
        match = _DROPPABLE.match(path)
        if match is None:
            return None
        plan.setdefault(match.group(1), set()).add(int(match.group(2)))
    if sum(len(v) for v in plan.values()) > MAX_DROPPED_ITEMS:
        return None
    slots = _list_slots(feedback)
    for name, indexes in plan.items():
        items = slots.get(name, ([], None))[0]
        kept = len(items) - len(indexes)
        if kept < 1 or 2 * kept < len(items):
            return None
    return plan


def validate_writing_grounding(feedback, essay_text: str, *, task_type: str | None = None,
                               prompt_text: str | None = None) -> GroundingReport:
    """Reject unsupported essay citations; return non-fatal findings.

    Bounded list-item failures are removed from ``feedback`` in place and named
    in the report. Raises :class:`UngroundedWritingFeedbackError` otherwise.
    """
    essay = _normalize(essay_text)
    prompt = _normalize(prompt_text or "")
    issues: list[tuple[str, str]] = []
    report = GroundingReport()

    def original(path: str, text: str):
        if not _in_essay(text, essay):
            issues.append((path, text[:240]))

    def unsupported(path: str, excerpt: str):
        # A prose misquote of real essay language ("reduces inequality" for
        # "reduce inequality") is a warning, not invented evidence.
        # Fabricated words never qualify.
        if _near_miss(excerpt, essay):
            report.warnings.append(path)
        else:
            issues.append((path, excerpt[:240]))

    def observations(path: str, text: str, *, allow_proposals: bool = True,
                     allow_grammar: bool = False):
        text = text.translate(_QUOTE_MARKS)
        for match in _QUOTES.finditer(text):
            excerpt = next(g for g in match.groups() if g is not None)
            if _in_essay(excerpt, essay, allow_ellipsis=True):
                continue
            preceding = text[:match.start()]
            masked_prefix = _QUOTES.sub("", preceding)
            prefix = re.split(r"[.!?;\n]", masked_prefix)[-1]
            # Abstract grammar notation is a structural description, not a
            # verbatim citation, including in strengths/current observations.
            # Strict source excerpts, original ideas and locations never opt in.
            if (allow_grammar and _GRAMMAR_CONTEXT.search(prefix)
                    and _GRAMMAR_NOTATION.search(excerpt)):
                continue
            # Source-only fields cannot turn invented evidence into a proposal.
            if not allow_proposals:
                unsupported(path, excerpt)
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
            if _ABSENCE.search(prefix):
                continue
            # Reference language that never claims learner usage: the task
            # question quoted as the question or a named concept/term. An
            # explicit learner attribution in the clause ("Em dùng 'make public
            # transport free'") or a usage claim ("Your use of the term
            # 'subsidies'") still rejects.
            claims_usage = last_attribution >= 0 or _USAGE_CLAIM.search(prefix) is not None
            if not claims_usage:
                if (prompt and _PROMPT_REFERENCE.search(prefix)
                        and _in_essay(excerpt, prompt, allow_ellipsis=True)):
                    continue
                if _TERM_LABEL.search(prefix):
                    continue
            # A Vietnamese paraphrase of an idea ("Em nêu rằng 'khuyến khích
            # ...'") is not a wording claim; "em đã dùng 'quay lại'" is.
            sentence = (re.split(r"[.!?;\n]", preceding)[-1]
                        + re.split(r"[.!?;\n]", text[match.start():])[0])
            if (_vietnamese_quote(excerpt, sentence) and not _USAGE_CLAIM.search(prefix)
                    and not any(_WORDING_VERB.search(m.group()) for m in attributions)):
                continue
            # A chart category need not appear in an essay that omitted its
            # label. Restrict this to Task 1 and do not exempt explicit learner
            # wording claims such as "Em đã dùng 'invented category'".
            if (task_type == "task1_academic" and not claims_usage
                    and _TASK_LABEL.search(prefix)):
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
            unsupported(path, excerpt)

    def mistakes(items, prefix):
        for i, item in enumerate(items):
            original(f"{prefix}[{i}].original", item.original)

    if isinstance(feedback, Pass2Refinement):
        mistakes(feedback.added_mistakes, "added_mistakes")
        observations("rationale", feedback.rationale, allow_grammar=True)
    elif isinstance(feedback, Pass3Rewrites):
        for i, item in enumerate(feedback.sentence_rewrites):
            original(f"sentence_rewrites[{i}].original_sentence", item.original_sentence)
    elif isinstance(feedback, WritingFeedback):
        observations("overallBandScoreSummary", feedback.overallBandScoreSummary, allow_grammar=True)
        for name, item in feedback.criteriaFeedback:
            observations(f"criteriaFeedback.{name}.feedback", item.feedback, allow_grammar=True)
        for i, text in enumerate(feedback.keyTakeaways.strengths):
            observations(f"keyTakeaways.strengths[{i}]", text, allow_proposals=False, allow_grammar=True)
        for i, text in enumerate(feedback.keyTakeaways.areasForImprovement):
            observations(f"keyTakeaways.areasForImprovement[{i}]", text, allow_grammar=True)
        mistakes(feedback.mistakeAnalysis, "mistakeAnalysis")
        for i, item in enumerate(feedback.ideaDevelopmentAnalysis or []):
            for field in ("originalIdea", "issue", "explanation"):
                observations(f"ideaDevelopmentAnalysis[{i}].{field}", getattr(item, field),
                             allow_proposals=field != "originalIdea", allow_grammar=field != "originalIdea")
        for i, item in enumerate(feedback.coherenceAnalysis or []):
            for field in ("location", "issue", "explanation"):
                observations(f"coherenceAnalysis[{i}].{field}", getattr(item, field),
                             allow_proposals=field != "location", allow_grammar=field != "location")
        if feedback.counterargumentAnalysis:
            observations("counterargumentAnalysis.feedback", feedback.counterargumentAnalysis.feedback,
                         allow_grammar=True)
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
                         allow_proposals=False, allow_grammar=True)
        # Other structure/history fields can legitimately quote older essays.
        # Suggestions, improvedEssay and rewritten sentences may use new words.
    if not issues:
        return report
    plan = _drop_plan(feedback, issues)
    if plan is None:
        raise UngroundedWritingFeedbackError(issues)
    slots = _list_slots(feedback)
    for name, indexes in sorted(plan.items()):
        items, setter = slots[name]
        setter([item for i, item in enumerate(items) if i not in indexes])
        report.dropped.extend(f"{name}[{i}]" for i in sorted(indexes))
    return report
