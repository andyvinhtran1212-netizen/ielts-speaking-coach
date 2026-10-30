"""Deterministic repairs of contradictory Writing feedback; never regrade.

Run on the final assembled AI result, including Deep deltas. Only explicit
contradictions are repaired: this is not a second chart judge or band scorer.
Source quotations, history counts, suggestions and criterion bands stay intact.
"""

from __future__ import annotations

import re
import unicodedata

from models.writing_feedback import WritingFeedback


def _plain(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.casefold())
                   if not unicodedata.combining(c)).replace("đ", "d")


_DATA_ERROR = re.compile(
    r"(?:sai|trai|khong (?:dung|chinh xac)|khong khop|mau thuan|chenh lech)"
    r"\s+(?:(?:so voi|voi|ve|theo)\s+)*(?:so lieu|du lieu|bieu do|xu huong|con so)|"
    r"(?:so lieu|du lieu|xu huong|con so)\s+(?:(?:nay|duoc mo ta|duoc neu|bi)\s+)*"
    r"(?:sai|khong (?:dung|chinh xac)|khong khop)|"
    r"(?:incorrect|inaccurate|wrong|misread|contradicts?)\s+(?:(?:the|chart)\s+)*"
    r"(?:data|figures?|chart|trend)|"
    r"(?:data|figures?|chart|trend)\s+(?:(?:is|are|was|were|description)\s+)*"
    r"(?:incorrect|inaccurate|wrong|mismatch)"
)
_LOW_RANGE = re.compile(
    r"cau truc cau (?:con |kha |qua |chu yeu |van )*don gian|"
    r"(?:chi|chu yeu|hau het) (?:su dung |dung |la )*cau don|"
    r"(?:chua|khong|thieu|it) (?:co |su dung |dung )*cau phuc|"
    r"(?:only|mostly|predominantly) (?:uses? |using )?simple sentences|"
    r"(?:lacks?|no|little) (?:use of )?complex (?:sentences|structures)|"
    r"limited (?:sentence|grammatical) range"
)
# A low-range phrase inside a positive or mixed-structure observation is not a
# blanket claim about the current essay, e.g. simple sentences used
# effectively alongside complex ones.
_MIXED_RANGE = re.compile(
    r"xen ke|ket hop|da dang|linh hoat|"
    r"\b(?:varied|variety|mix(?:ed)?|alongside|combined with)\b"
)
_UNAFFIRMED = re.compile(
    r"(?:\b(?:khong|chua|thieu|can|nen|not|no|lacks?|lacking|without|little|need|needs|should|more)"
    r"\s+(?:\w+\s+){0,2})$"
)
_HISTORY = re.compile(r"lich su|bai truoc|5 bai|nam bai|previous|earlier|historical")
_CURRENT = re.compile(r"bai (?:viet )?(?:nay|hien tai)|current essay|this essay")
_NO_PATTERNS = re.compile(
    r"(?:chua|khong) (?:co |ghi nhan |thay )*(?:pattern|mau|loi).{0,25}lap lai|"
    r"no (?:recurring|repeated) (?:patterns?|errors?)"
)
_STRUCTURE_SCOPE = re.compile(r"cau truc|cau don|cau phuc|sentence|syntactic")
_PRAISE = re.compile(
    r"phu hop|chinh xac|hieu qua|tu nhien|dung tot|dung dung|"
    r"cum (?:tu )?tot|diem manh|dung hay|"
    r"\b(?:accurate|appropriate|effective|well[- ]used|good (?:use|vocabulary)|natural)\b"
)
_PROPOSAL = re.compile(
    r"(?:nen|can|hay) (?:dung|thay|sua|viet)|de xuat|goi y|"
    r"ban sua|sau khi sua|thay .{0,80} bang|"
    r"\b(?:replace|rewrite|suggest|instead|should|could|corrected|revised)\b"
)
_NEGATED_PRAISE = re.compile(
    r"(?:khong|chua|kem|thieu|not|isn't|isnt|inaccurate|inappropriate)"
    r".{0,22}(?:phu hop|chinh xac|hieu qua|tu nhien|tot|accurate|appropriate|effective|natural)"
)
# Criticism in the same clause makes the praise ambiguous or about another
# subject; the criticism must survive, so such clauses are never deleted.
_CRITICISM = re.compile(
    r"\b(?:sai|loi|chua|khong|thieu|guong ep|"
    r"wrong|incorrect|error|mistake|not|awkward|unnatural)\b"
)
_AGE_GROUP = re.compile(r"\b(\d{1,2})\s*[-–—]\s*(\d{1,2})[ -]+year[ -]+olds\b")
_TASK_RESPONSE = re.compile(r"\bTask Response\b", re.IGNORECASE)
_NEUTRAL = "Tham khảo các lỗi và gợi ý cụ thể trong phần phân tích."


def _sentences(text: str) -> list[str]:
    return re.split(r"(?<=[.!?])\s+", text)


def _data_error(explanation: str) -> bool:
    return _unnegated(_DATA_ERROR, _plain(explanation))


def _unnegated(pattern: re.Pattern, text: str) -> bool:
    return any(not re.search(r"(?:khong(?: phai)?|chua|not|no|without)\s+$", text[:m.start()])
               for m in pattern.finditer(text))


def _affirmed(pattern: re.Pattern, text: str) -> bool:
    return any(not _UNAFFIRMED.search(text[:m.start()]) and not text[m.end():].startswith(" hon")
               for m in pattern.finditer(text))


def _blanket_low_range(plain: str) -> bool:
    return (_unnegated(_LOW_RANGE, plain)
            and not _affirmed(_MIXED_RANGE, plain)
            and not (_affirmed(_PRAISE, plain) and not _NEGATED_PRAISE.search(plain)))


def _phrase_pattern(original: str) -> re.Pattern | None:
    words = re.findall(r"\w+", _plain(original))
    # Short function words do not establish a conflicting vocabulary claim.
    if not words or (len(words) == 1 and len(words[0]) < 5):
        return None
    return re.compile(r"(?<!\w)" + r"[\W_]+".join(map(re.escape, words)) + r"(?!\w)")


def repair_writing_consistency(feedback: WritingFeedback, task_type: str) -> list[str]:
    """Repair in place and return field paths only, safe for operational logs.

    No extra provider calls and no retry/fallback/billing changes. Labels come
    from task_type; data errors require an explicit accuracy criticism already
    present in the answer. Ambiguous semantic contradictions are left alone.
    """
    changed: list[str] = []

    def assign(obj, key: str, value, path: str):
        old = obj.get(key) if isinstance(obj, dict) else getattr(obj, key)
        if old != value:
            if isinstance(obj, dict):
                obj[key] = value
            else:
                setattr(obj, key, value)
            changed.append(path)

    task1 = task_type.startswith("task1")
    main = feedback.criteriaFeedback.mainCriterion
    assign(main, "title", "Task Achievement" if task1 else "Task Response",
           "criteriaFeedback.mainCriterion.title")
    trajectory = feedback.bandTrajectoryAnalysis or {}
    for i, row in enumerate(trajectory.get("criteria_breakdown") or []):
        if isinstance(row, dict) and _plain(str(row.get("criterion", ""))) in {
            "task response", "task achievement", "tr", "ta",
        }:
            assign(row, "criterion", main.title,
                   f"bandTrajectoryAnalysis.criteria_breakdown[{i}].criterion")

    for i, mistake in enumerate(feedback.mistakeAnalysis):
        if task1:
            assign(mistake, "criterion", _TASK_RESPONSE.sub("Task Achievement", mistake.criterion),
                   f"mistakeAnalysis[{i}].criterion")
        if task_type == "task1_academic" and (
            _plain(mistake.mistakeType) in {"data accuracy", "data error", "chart accuracy"}
            or _data_error(mistake.explanation)
        ):
            assign(mistake, "mistakeType", "Data Accuracy", f"mistakeAnalysis[{i}].mistakeType")
            assign(mistake, "criterion", "Task Achievement", f"mistakeAnalysis[{i}].criterion")

    if task_type == "task1_academic":
        for i, item in enumerate(feedback.coherenceAnalysis or []):
            if _data_error(item.issue + " " + item.explanation):
                for key in ("issue", "explanation"):
                    value = re.sub(r"mâu thuẫn logic|logical contradiction", "sai so với dữ liệu biểu đồ",
                                   getattr(item, key), flags=re.IGNORECASE)
                    assign(item, key, value, f"coherenceAnalysis[{i}].{key}")

    ss = feedback.sentenceStructureAnalysis
    if isinstance(ss, dict):
        for key in ("summary", "current_essay_observation"):
            if not isinstance(ss.get(key), str):
                continue
            sentences = _sentences(ss[key])
            kept = []
            for sentence in sentences:
                plain = _plain(sentence)
                historical = _HISTORY.search(plain) and not _CURRENT.search(plain)
                if (feedback.criteriaFeedback.grammaticalRange.bandScore >= 7
                        and _blanket_low_range(plain) and not historical):
                    continue
                if _NO_PATTERNS.search(plain):
                    # A sentence-structure summary cannot deny lexical patterns.
                    # Scope the claim to the supplied syntax history, if empty.
                    if ss.get("common_issues") == [] and not _STRUCTURE_SCOPE.search(plain):
                        sentence = "Chưa ghi nhận mẫu lỗi cấu trúc câu lặp lại trong dữ liệu cấu trúc câu."
                    elif ss.get("common_issues"):
                        continue
                    elif not _STRUCTURE_SCOPE.search(plain) and (
                        feedback.recurringPatterns or {}
                    ).get("stillRecurring"):
                        continue
                kept.append(sentence)
            value = ss[key] if kept == sentences else " ".join(kept) or _NEUTRAL
            assign(ss, key, value, f"sentenceStructureAnalysis.{key}")

    recurring = feedback.recurringPatterns
    if isinstance(recurring, dict) and recurring.get("stillRecurring"):
        summary = recurring.get("summary")
        if isinstance(summary, str) and _NO_PATTERNS.search(_plain(summary)):
            kept = [s for s in _sentences(summary) if not _NO_PATTERNS.search(_plain(s))]
            assign(recurring, "summary", " ".join(kept) or
                   "Các mẫu lỗi còn lặp lại được liệt kê bên dưới.", "recurringPatterns.summary")

    flagged = [p for m in feedback.mistakeAnalysis if (p := _phrase_pattern(m.original))]

    def narrative(text: str, *, allow_empty: bool = False) -> str:
        sentences = _sentences(text)
        kept = []
        for sentence in sentences:
            plain = _plain(sentence)
            # Semicolons/contrast markers separate independently judged claims.
            # Concessives too; bare "du" is avoided because it also spells "dữ".
            clauses = re.split(r";|\b(?:nhung|tuy nhien|but|however|mac du|"
                               r"although|though|whereas)\b", plain)
            conflict = any(p.search(clause) and _PRAISE.search(p.sub("", clause))
                           and not _NEGATED_PRAISE.search(p.sub("", clause))
                           and not _CRITICISM.search(p.sub("", clause))
                           and not _PROPOSAL.search(clause)
                           and not (_HISTORY.search(clause) and not _CURRENT.search(clause))
                           for clause in clauses for p in flagged)
            if not conflict:
                kept.append(sentence)
        value = text if kept == sentences else " ".join(kept)
        if text and not value and not allow_empty:
            value = _NEUTRAL
        return _TASK_RESPONSE.sub("Task Achievement", value) if task1 else value

    # Source excerpts and rewrites are deliberately excluded from this sweep.
    for name in ("mainCriterion", "coherenceCohesion", "lexicalResource", "grammaticalRange"):
        criterion = getattr(feedback.criteriaFeedback, name)
        for key in ("feedback", "explanation"):
            assign(criterion, key, narrative(getattr(criterion, key)),
                   f"criteriaFeedback.{name}.{key}")
    assign(feedback.keyTakeaways, "strengths",
           [clean for s in feedback.keyTakeaways.strengths if (clean := narrative(s, allow_empty=True))],
           "keyTakeaways.strengths")
    assign(feedback, "overallBandScoreSummary", narrative(feedback.overallBandScoreSummary),
           "overallBandScoreSummary")
    for section in ("coherenceAnalysis", "ideaDevelopmentAnalysis"):
        for i, item in enumerate(getattr(feedback, section) or []):
            for key in ("issue", "explanation"):
                assign(item, key, narrative(getattr(item, key)), f"{section}[{i}].{key}")
    if feedback.counterargumentAnalysis:
        item = feedback.counterargumentAnalysis
        assign(item, "feedback", narrative(item.feedback), "counterargumentAnalysis.feedback")
    for section in ("sentenceStructureAnalysis", "recurringPatterns", "bandTrajectoryAnalysis"):
        obj = getattr(feedback, section)
        if isinstance(obj, dict):
            for key in ("summary", "current_essay_observation", "trend_explanation"):
                if isinstance(obj.get(key), str):
                    assign(obj, key, narrative(obj[key]), f"{section}.{key}")

    assign(feedback, "improvedEssay", _AGE_GROUP.sub(r"\1–\2-year-olds", feedback.improvedEssay),
           "improvedEssay")
    return list(dict.fromkeys(changed))
