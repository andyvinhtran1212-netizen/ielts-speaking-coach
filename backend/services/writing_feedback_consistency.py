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
# One claim about both the current and previous essays, e.g. "bài này và các
# bài trước đều ...": naming the current essay does not scope it away from history.
_JOINT_SCOPE = re.compile(
    r"(?:bai (?:viet )?(?:nay|hien tai)|(?:current|this) essay)\s+(?:va|lan|cung nhu|and|as well as)\s+"
    r"(?:(?:cac|nhung|the|its|my|your)\s+)?(?:bai (?:viet )?truoc|previous|earlier)|"
    r"(?:bai (?:viet )?truoc|(?:previous|earlier) essays?)\s+(?:va|lan|cung nhu|and|as well as)\s+"
    r"(?:(?:the|this)\s+)?(?:bai (?:viet )?(?:nay|hien tai)|(?:current|this) essay)"
)
_NO_PATTERNS = re.compile(
    r"(?:chua|khong) (?:co |ghi nhan |thay )*(?:pattern|mau|loi).{0,25}lap lai|"
    r"no (?:recurring|repeated) (?:patterns?|errors?)"
)
_STRUCTURE_SCOPE = re.compile(r"cau truc|cau don|cau phuc|sentence|syntactic")
# Error domains a recurring-pattern denial or a stillRecurring item can name,
# by criterion. A denial that names none of them covers every domain.
_ERROR_DOMAINS = {
    "grammar": re.compile(
        r"ngu phap|grammar|grammatical|cau truc|cau don|cau phuc|cau ghep|sentence|run-on|fragment|"
        r"chia (?:dong tu|thi)|\btense|hoa hop|chu vi|subject[- ]verb|agreement|mao tu|\barticles?\b|"
        r"gioi tu|preposition|so (?:it|nhieu)|plural|singular|bi dong|passive|menh de|clause|"
        r"dau cau|punctuation"),
    "lexical": re.compile(
        r"tu vung|\b(?:dung|chon|lap) tu\b|tu loai|dang tu|\bwords?\b|vocabulary|lexical|collocation|"
        r"ket hop tu|chinh ta|spelling|paraphras"),
    "coherence": re.compile(r"lien ket|mach lac|coheren|cohesi|linking|tu noi|lien tu|doan van|paragraph"),
    "task": re.compile(
        r"so lieu|du lieu|\bdata\b|task (?:achievement|response)|overview|tong quan|y tuong|\bideas?\b|"
        r"lap luan|argument"),
}
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
# Advice in another clause is a warning to keep, even without a proposal verb.
# De-accented "cần" is English "can", so it only counts in Vietnamese text.
_ADVICE = re.compile(r"\b(?:nen|kiem tra|should|need|needs|check|verify)\b")
_VI_ADVICE = re.compile(r"\bcan\b")
# Reassurance is not a warning: "không cần thay đổi", "không có lỗi", "no errors".
_REASSURANCE = re.compile(
    r"\b(?:khong|chua)\s+(?:(?:co|mac|thay|con|gap)\s+)*(?:loi|sai sot|van de)\b|"
    r"\bkhong\s+(?:can|phai)\s+(?:thay doi|sua|chinh sua|kiem tra)\b|"
    r"\b(?:no|without)\s+(?:\w+\s+)?(?:errors?|mistakes?|problems?|issues?)\b|"
    r"\b(?:no need|(?:do|does|did)(?: not|n['’]t) need|needn['’]t|need not)\s+(?:to\s+)?"
    r"(?:change|fix|revise|edit|check)\b"
)
_AGE_GROUP = re.compile(r"\b(\d{1,2})\s*[-–—]\s*(\d{1,2})[ -]+year[ -]+olds\b")
_TASK_RESPONSE = re.compile(r"\bTask Response\b", re.IGNORECASE)
_NEUTRAL = "Tham khảo các lỗi và gợi ý cụ thể trong phần phân tích."


def _sentences(text: str) -> list[str]:
    return re.split(r"(?<=[.!?])\s+", text)


# Semicolons/contrast markers separate independently judged claims.
# Concessives too; bare "du" is avoided because it also spells "dữ".
_CLAUSE_SPLIT = re.compile(
    r";|\b(?:nhưng|nhung|tuy nhiên|tuy nhien|but|however|mặc dù|mac du|although|though|whereas)\b",
    re.IGNORECASE,
)


def _without_clauses(sentence: str, drop) -> str:
    """Rebuild sentence without the clauses whose plain text drop() rejects.

    Only the rejected clause and its leading marker go; the other clauses keep
    their original wording. Returns "" when every clause is rejected.
    """
    # Find boundaries before folding accents: "những" is not "nhưng".
    marks = [(m.start(), m.end()) for m in _CLAUSE_SPLIT.finditer(sentence)]
    starts = [0] + [end for _, end in marks]
    ends = [start for start, _ in marks] + [len(sentence)]
    clauses = [_plain(sentence[start:end]) for start, end in zip(starts, ends)]
    if not any(drop(clause) for clause in clauses):
        return sentence
    # An empty clause before a leading marker ("Mặc dù ...") is not content.
    kept = [k for k, clause in enumerate(clauses) if clause.strip(" ,;:") and not drop(clause)]
    if not kept:
        return ""
    pieces = [sentence[starts[k] if k == kept[0] else marks[k - 1][0]:ends[k]]
              for k in kept]
    text = "".join(pieces).strip().rstrip(",;: ")
    ending = re.search(r"[.!?]*$", sentence.rstrip()).group()
    text = text if text.endswith(ending) else text.rstrip(".!?") + ending
    return text[:1].upper() + text[1:]


def _data_error(explanation: str) -> bool:
    return any(_unnegated(_DATA_ERROR, _plain(clause))
               for clause in _CLAUSE_BREAK.split(explanation))


# Split the original accented text; folding first confuses "những" with "nhưng".
_CLAUSE_BREAK = re.compile(
    r"[,;:.!?()]|\b(?:mà|ma|nhưng|nhung|và|va|tuy nhiên|tuy nhien|but|and|however|rather|whereas)\b",
    re.IGNORECASE,
)
# Negation is adjacent to the error term, as on staging. Never reach across
# arbitrary words: "không sửa X" / "did not correct X" still affirm the error.
_NEGATED_TAIL = re.compile(
    r"(?:\b(?:khong(?: phai)?|chua|not|no|never|without)|n['’]t)\s+$"
)
# Specific data-error denials required by the earlier review regressions.
# Each phrase must directly precede the error; additive "not only" and
# negated correction/checking actions are deliberately absent.
_DATA_DENIAL_PREFIXES = (
    "khong phai la loi", "khong lam",
    "khong he", "khong han la", "khong lien quan den",
    "khong phai do", "khong phai vi", "khong phai la loi do",
    "not a", "not an", "not because", "not because the", "not that", "not that the",
)
_DATA_DENIAL_TAIL = re.compile(r"\b(?:" + "|".join(map(re.escape, _DATA_DENIAL_PREFIXES)) + r")\s+$")


def _unnegated(pattern: re.Pattern, text: str) -> bool:
    for match in pattern.finditer(text):
        prefix = text[:match.start()]
        if _NEGATED_TAIL.search(prefix):
            continue
        if pattern is _DATA_ERROR and _DATA_DENIAL_TAIL.search(prefix):
            continue
        return True
    return False


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
                # summary is the five-essay overview: only an explicitly
                # current-essay sentence there can contradict the GRA band.
                # Only the low-range clause goes: an independent warning or a
                # history clause in the same sentence stays.
                if (feedback.criteriaFeedback.grammaticalRange.bandScore >= 7
                        and _blanket_low_range(plain) and not historical
                        and (key == "current_essay_observation" or _CURRENT.search(plain))):
                    sentence = _without_clauses(sentence, lambda clause: (
                        _unnegated(_LOW_RANGE, clause)
                        and not (_HISTORY.search(clause) and not _CURRENT.search(clause))))
                    if not sentence:
                        continue
                    plain = _plain(sentence)
                if _NO_PATTERNS.search(plain):
                    # A sentence-structure summary cannot deny lexical patterns.
                    # Scope the claim to the supplied syntax history, if empty.
                    if ss.get("common_issues") == [] and not _STRUCTURE_SCOPE.search(plain):
                        sentence = "Chưa ghi nhận mẫu lỗi cấu trúc câu lặp lại trong dữ liệu cấu trúc câu."
                    # common_issues are copied from previous essays, so they
                    # cannot contradict a claim about the current essay only.
                    elif ss.get("common_issues") and (_JOINT_SCOPE.search(plain) or not (
                        _CURRENT.search(plain)
                        or (key == "current_essay_observation" and not historical)
                    )):
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
            still = recurring["stillRecurring"]
            listed = {name for item in (still if isinstance(still, list) else [still])
                      for name, domain in _ERROR_DOMAINS.items() if domain.search(_plain(str(item)))}

            # A denial contradicts stillRecurring only for the error types it
            # names; "Không có lỗi ngữ pháp lặp lại" stands beside Word Choice.
            def stale(clause: str) -> bool:
                named = {name for name, domain in _ERROR_DOMAINS.items() if domain.search(clause)}
                return bool(_NO_PATTERNS.search(clause)) and (not named or bool(named & listed))

            sentences = _sentences(summary)
            kept = [clean for s in sentences if (clean := _without_clauses(s, stale))]
            assign(recurring, "summary", summary if kept == sentences else " ".join(kept) or
                   "Các mẫu lỗi còn lặp lại được liệt kê bên dưới.", "recurringPatterns.summary")

    flagged = [p for m in feedback.mistakeAnalysis if (p := _phrase_pattern(m.original))]

    def warns(clause: str, vietnamese: bool) -> bool:
        rest = clause
        for p in flagged:
            rest = p.sub("", rest)
        rest = _REASSURANCE.sub(" ", rest)
        return bool(_CRITICISM.search(rest) or _ADVICE.search(rest)
                    or (vietnamese and _VI_ADVICE.search(rest))
                    or _PROPOSAL.search(_REASSURANCE.sub(" ", clause))
                    or _unnegated(_DATA_ERROR, rest))

    def narrative(text: str, *, allow_empty: bool = False) -> str:
        sentences = _sentences(text)
        kept = []
        for sentence in sentences:
            plain = _plain(sentence)
            clauses = [_plain(clause) for clause in _CLAUSE_SPLIT.split(sentence)]
            conflict = any(p.search(clause) and _PRAISE.search(p.sub("", clause))
                           and not _NEGATED_PRAISE.search(p.sub("", clause))
                           and not _CRITICISM.search(p.sub("", clause))
                           and not _PROPOSAL.search(clause)
                           and not (_HISTORY.search(clause) and not _CURRENT.search(clause))
                           for clause in clauses for p in flagged)
            # Never drop a warning: a sentence that also criticises or proposes
            # in another clause is kept whole rather than rewritten.
            vietnamese = plain != sentence.casefold()
            if not conflict or any(warns(clause, vietnamese) for clause in clauses):
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
