#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Grammar Checker (Tiếng Anh) — bilingual feedback for learners.

Người dùng nhập câu → chương trình:
  1) Phát hiện lỗi bằng LanguageTool (offline) hoặc Public API (online fallback).
  2) Chỉ ra điểm ngữ pháp liên quan trên mindmap.
  3) Giải thích trọng tâm vấn đề (song ngữ VI + EN).
  4) Đề xuất câu đúng.

Cách dùng:
    $ python grammar_checker.py                  # CLI tương tác
    $ python grammar_checker.py --gui            # Giao diện Tkinter
    $ python grammar_checker.py "She go home."   # Một câu
    $ python grammar_checker.py --online "..."   # Ép dùng API online
    $ python grammar_checker.py --no-color "..." # Tắt màu ANSI

Yêu cầu:
    - Python 3.8+
    - pip install language_tool_python    (cài LanguageTool offline)
    - Java 8+ trên máy. Nếu không có Java, tự fallback sang Public API.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import List, Dict, Any, Optional, Tuple

from grammar_data import find_tip_for_rule, GRAMMAR_TREE  # noqa: F401


# ----------- ANSI colors with --no-color toggle -----------
class C:
    enabled = sys.stdout.isatty() and os.name != "nt"
    @classmethod
    def _w(cls, code: str) -> str:
        return code if cls.enabled else ""
    @classmethod
    def disable(cls): cls.enabled = False

def _c(code): return code if C.enabled else ""

def _r(): return _c("\033[31m")
def _g(): return _c("\033[32m")
def _y(): return _c("\033[33m")
def _b(): return _c("\033[34m")
def _m(): return _c("\033[35m")
def _cy(): return _c("\033[36m")
def _bo(): return _c("\033[1m")
def _di(): return _c("\033[2m")
def _un(): return _c("\033[4m")
def _e(): return _c("\033[0m")


# ===========================================================================
# 1. Backends
# ===========================================================================

class LTBackend:
    """Adapter exposing a uniform .check(text) -> list[dict] interface."""

    def __init__(self, prefer_offline: bool = True, language: str = "en-US"):
        self.language = language
        self._mode = None
        self._tool = None
        if prefer_offline:
            try:
                import language_tool_python  # noqa
                self._tool = language_tool_python.LanguageTool(language)
                self._mode = "offline"
            except Exception as e:
                print(f"{_y()}[!] Không khởi động được LanguageTool offline: {e}{_e()}", file=sys.stderr)
                print(f"{_y()}[!] Chuyển sang dùng LanguageTool Public API.{_e()}", file=sys.stderr)
                self._mode = "online"
        else:
            self._mode = "online"

    @property
    def mode(self) -> str: return self._mode or "online"

    def check(self, text: str) -> List[Dict[str, Any]]:
        if self._mode == "offline" and self._tool is not None:
            try:
                matches = self._tool.check(text)
            except Exception as e:
                print(f"{_y()}[!] Lỗi LT offline: {e}. Thử fallback online.{_e()}", file=sys.stderr)
                self._mode = "online"
                return self._check_online(text)
            results = []
            for m in matches:
                results.append({
                    "ruleId": getattr(m, "ruleId", "") or "",
                    "category": getattr(m, "category", "") or "",
                    "message": getattr(m, "message", "") or "",
                    "offset": getattr(m, "offset", 0),
                    "errorLength": getattr(m, "errorLength", 0),
                    "replacements": list(getattr(m, "replacements", []) or [])[:5],
                })
            return results
        return self._check_online(text)

    def _check_online(self, text: str) -> List[Dict[str, Any]]:
        url = "https://api.languagetool.org/v2/check"
        data = urllib.parse.urlencode({
            "text": text, "language": self.language, "enabledOnly": "false",
        }).encode("utf-8")
        last_err = None
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, data=data, headers={
                    "User-Agent": "GrammarCourseChecker/1.0",
                    "Accept": "application/json",
                })
                with urllib.request.urlopen(req, timeout=20) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as e:
                last_err = e
                if e.code == 429:  # rate limit
                    time.sleep(2 ** attempt)
                    continue
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last_err = e
                time.sleep(1)
                continue
        else:
            print(f"{_r()}[x] Không gọi được API LanguageTool sau 3 lần: {last_err}{_e()}", file=sys.stderr)
            return []
        if last_err and isinstance(last_err, urllib.error.HTTPError) and last_err.code != 429:
            print(f"{_y()}[!] LT API trả về HTTP {last_err.code}{_e()}", file=sys.stderr)
            return []

        results = []
        for m in payload.get("matches", []):
            results.append({
                "ruleId": m.get("rule", {}).get("id", ""),
                "category": m.get("rule", {}).get("category", {}).get("id", ""),
                "message": m.get("message", ""),
                "offset": m.get("offset", 0),
                "errorLength": m.get("length", 0),
                "replacements": [r.get("value", "") for r in m.get("replacements", [])[:5]],
            })
        return results

    def close(self):
        if self._tool is not None:
            try:
                self._tool.close()
            except Exception:
                pass
            self._tool = None


# ===========================================================================
# 2. Helpers for verb morphology
# ===========================================================================

# Verbs whose past/V3 form is identical to base — must be excluded from many rules
_V3_EQUALS_BASE = {"read", "put", "cut", "let", "set", "hit", "hurt", "shut", "cost", "spread", "burst", "split", "shed", "broadcast", "cast"}

# Multi-syllable verbs that do NOT double final consonant when adding -ing (unstressed final syllable)
_NO_DOUBLE_ING = {
    "open", "happen", "visit", "listen", "enter", "offer", "suffer", "answer",
    "remember", "consider", "deliver", "develop", "differ", "gather", "wander",
    "wonder", "cover", "bother", "whisper", "labour", "labor", "limit", "edit",
    "profit", "promise", "imagine", "examine", "balance", "manage", "follow",
    "borrow", "swallow", "narrow",
}

def _be_form(subj: str) -> str:
    s = subj.lower()
    if s == "i":
        return "am"
    if s in ("he", "she", "it"):
        return "is"
    return "are"

def _add_s(verb: str) -> str:
    """Form 3rd-person singular present."""
    v = verb.lower()
    irregular = {"have": "has", "do": "does", "go": "goes", "be": "is"}
    if v in irregular:
        return irregular[v]
    if v.endswith(("s", "x", "z", "ch", "sh")):
        return v + "es"
    if v.endswith("y") and len(v) > 1 and v[-2] not in "aeiou":
        return v[:-1] + "ies"
    if v.endswith("o") and len(v) > 1 and v[-2] not in "aeiou":
        return v + "es"
    return v + "s"

_V_BACK_TO_BASE = {
    # Irregular past forms
    "went": "go", "came": "come", "saw": "see", "ate": "eat", "drank": "drink",
    "wrote": "write", "got": "get", "knew": "know", "took": "take", "gave": "give",
    "spoke": "speak", "brought": "bring", "bought": "buy", "made": "make",
    "said": "say", "told": "tell", "found": "find", "left": "leave", "met": "meet",
    "paid": "pay", "sat": "sit", "stood": "stand", "won": "win", "lost": "lose",
    "ran": "run", "sang": "sing", "swam": "swim", "flew": "fly", "drove": "drive",
    "sent": "send", "spent": "spend", "caught": "catch", "taught": "teach",
    "thought": "think", "read": "read",
    # Irregular 3rd-sg forms
    "goes": "go", "does": "do", "has": "have", "is": "be", "was": "be",
    # Auxiliary edge cases
}

_V2_TO_V3 = {
    "went": "gone", "came": "come", "saw": "seen", "ate": "eaten", "drank": "drunk",
    "wrote": "written", "got": "gotten", "knew": "known", "took": "taken", "gave": "given",
    "spoke": "spoken", "ran": "run", "sang": "sung", "swam": "swum", "flew": "flown",
    "drove": "driven", "chose": "chosen", "froze": "frozen", "broke": "broken",
    "stole": "stolen", "woke": "woken", "wore": "worn", "tore": "torn", "threw": "thrown",
    "grew": "grown", "blew": "blown", "drew": "drawn", "forgot": "forgotten",
    "forgave": "forgiven", "hid": "hidden", "rode": "ridden", "rose": "risen",
    "shook": "shaken",
}

def _v2_to_v3(verb: str) -> str:
    """Convert past simple (V2) to past participle (V3)."""
    return _V2_TO_V3.get(verb.lower(), verb.lower())

def _to_base(verb: str) -> str:
    """Convert 3rd-sg present or past form back to base."""
    v = verb.lower()
    if v in _V_BACK_TO_BASE:
        return _V_BACK_TO_BASE[v]
    # Reverse -ies → -y
    if v.endswith("ies") and len(v) > 3:
        return v[:-3] + "y"
    # Reverse -es (sh/ch/x/z/o) → base
    if v.endswith("es") and len(v) > 2 and v[-3] in "sxzohc":
        # checks like "watches" → "watch"
        return v[:-2]
    # Reverse -s → base
    if v.endswith("s") and len(v) > 1:
        return v[:-1]
    return v

def _add_ing(verb: str) -> str:
    """Form V-ing with correct spelling rules."""
    v = verb.lower()
    # Special cases
    irregular = {"be": "being", "see": "seeing", "agree": "agreeing", "lie": "lying", "die": "dying", "tie": "tying"}
    if v in irregular:
        return irregular[v]
    # Drop silent -e
    if v.endswith("e") and not v.endswith("ee") and len(v) > 2:
        return v[:-1] + "ing"
    # Double final consonant only when stressed-CVC. Heuristic:
    #   - skip explicit non-doublers
    #   - only double if word is short (<= 5 letters) — most monosyllables
    if v in _NO_DOUBLE_ING:
        return v + "ing"
    if (len(v) >= 3 and len(v) <= 5
            and v[-1] in "bdfgklmnprstvz" and v[-2] in "aeiou" and v[-3] not in "aeiou"
            and not v.endswith("w") and not v.endswith("y") and not v.endswith("x")):
        return v + v[-1] + "ing"
    return v + "ing"


# ===========================================================================
# 3. Local rules — high-precision regex for common Vietnamese-learner errors
# ===========================================================================

VI_LEARNER_RULES: List[Dict[str, Any]] = [
    # ---- BE / linking ----
    {
        "name": "Missing 'to be' before adjective",
        # Must NOT be preceded by an aux/linking verb context like "look I happy"
        "pattern": re.compile(
            r"(?<![A-Za-z'])(I|You|He|She|It|We|They)\s+"
            r"(beautiful|happy|tired|sad|hungry|busy|ready|angry|sick|young|tall|short|kind|smart|hot|cold|thirsty|bored|excited|nervous|scared|proud|jealous|confused|fine|ok|okay)"
            r"(?:\b|[.,!?])"
        ),
        "point": "Linking verbs (be + Adj)",
        "area": "sentence_structure",
        "tip_vi": "Thiếu 'to be' trước tính từ. Cần am/is/are giữa chủ ngữ và tính từ.",
        "tip_en": "Missing 'to be' before an adjective. Use am/is/are between subject and adjective.",
        "fix": lambda m: f"{m.group(1)} {_be_form(m.group(1))} {m.group(2)}",
    },
    {
        "name": "I + are/is (should be 'am')",
        "pattern": re.compile(r"\bI\s+(are|is)\b"),
        "point": "Subject-verb agreement (I + am)",
        "area": "advanced",
        "tip_vi": "'I' luôn đi với 'am' (hoặc 'was' ở quá khứ).",
        "tip_en": "'I' always takes 'am' (or 'was' in the past).",
        "fix": lambda m: "I am",
    },
    {
        "name": "'be + agree' (wrong)",
        "pattern": re.compile(r"\b(am|is|are|was|were)\s+agree\b", re.IGNORECASE),
        "point": "Sentence Structure (no 'be' with 'agree')",
        "area": "sentence_structure",
        "tip_vi": "KHÔNG dùng 'be' trước 'agree'. Nói: 'I agree with you.' (NOT 'I am agree with you.')",
        "tip_en": "Don't use 'be' before 'agree'. Say 'I agree', not 'I am agree'.",
        "fix": lambda m: "agree",
    },
    {
        "name": "Missing 'was' with 'born'",
        "pattern": re.compile(r"\b(I|you|he|she|we|they)\s+born\b(?!\s+(of|to))", re.IGNORECASE),
        "point": "Passive (be + born)",
        "area": "voice_mood",
        "tip_vi": "'born' luôn đi với 'be': 'I was born in 1990.' (KHÔNG 'I born in 1990.')",
        "tip_en": "'born' must follow 'be': 'I was born in 1990.'",
        "fix": None,
    },

    # ---- Subject-verb agreement ----
    {
        "name": "He/She/It + base verb (missing -s)",
        # Excludes verbs where base==past (read/put/cut/let/set/hit/cost/shut/spread/burst/hurt)
        # to avoid FP like "He read the book last night."
        "pattern": re.compile(
            r"(?<![A-Za-z'])(?<!\bdoes\s)(?<!\bdo\s)(?<!\bdid\s)"
            r"(?<!\blet\s)(?<!\bmake\s)(?<!\bhelp\s)(?<!\bsee\s)(?<!\bhear\s)(?<!\bwatch\s)"
            r"(He|She|It)\s+"
            r"(go|do|have|come|run|like|love|eat|drink|play|study|live|work|write|watch|listen|speak|teach|need|want|see|hear|know|think|feel|seem|look|stay|wait|try|cook|clean|sing|dance|sleep)"
            r"\b(?!\s*(?:not|n['’]?t))"
        ),
        "point": "Subject-verb agreement (3rd-singular -s)",
        "area": "advanced",
        "tip_vi": "Ngôi thứ 3 số ít (he/she/it) ở thì hiện tại đơn cần thêm -s/-es vào động từ.",
        "tip_en": "3rd-person singular needs -s/-es in present simple.",
        "fix": lambda m: f"{m.group(1)} {_add_s(m.group(2))}",
    },
    {
        "name": "He/She/It + don't / do not (should be doesn't / does not)",
        "pattern": re.compile(r"\b(He|She|It)\s+(don['’]?t|do\s+not)\b", re.IGNORECASE),
        "point": "Subject-verb agreement (do/does)",
        "area": "advanced",
        "tip_vi": "Ngôi thứ 3 số ít dùng 'doesn't' / 'does not' (KHÔNG 'don't' / 'do not'): 'He doesn't like coffee.'",
        "tip_en": "3rd-person singular uses 'doesn't' / 'does not' (not 'don't' / 'do not').",
        "fix": lambda m: f"{m.group(1)} {'does not' if 'not' in m.group(2).lower() and ' ' in m.group(2) else 'doesn'+chr(39)+'t'}",
    },
    {
        "name": "doesn't/don't/didn't (or do/does/did + not) + V-s or past form",
        "pattern": re.compile(
            r"\b(doesn['’]?t|don['’]?t|didn['’]?t|do\s+not|does\s+not|did\s+not)\s+"
            r"(goes|does|has|comes|runs|likes|loves|eats|drinks|plays|studies|lives|works|reads|writes|watches|listens|speaks|wants|needs|knows|thinks|feels|sees|hears|cooks|cleans|sings|dances|sleeps|stays|waits|tries|went|came|saw|ate|drank|wrote|got|knew|took|gave|spoke|brought|bought|made|said|told|found|left|met|paid|sat|stood|won|lost)"
            r"\b",
            re.IGNORECASE),
        "point": "Negative present/past (use base form after do/does/did)",
        "area": "tenses",
        "tip_vi": "Sau do/does/did (kể cả don't/doesn't/didn't và 'do/does/did + not') dùng động từ NGUYÊN MẪU. Vd: 'He doesn't go' (KHÔNG 'He doesn't goes').",
        "tip_en": "After do/does/did (incl. negatives) use the BASE form.",
        "fix": lambda m: f"{m.group(1)} {_to_base(m.group(2))}",
    },
    {
        "name": "have/has + irregular past (should be V3 past participle)",
        # have went → have gone, has saw → has seen, etc.
        "pattern": re.compile(
            r"\b(have|has|had)\s+(went|came|saw|ate|drank|wrote|got|knew|took|gave|spoke|ran|sang|swam|flew|drove|chose|froze|broke|stole|woke|wore|tore|threw|grew|blew|drew|forgot|forgave|hid|rode|rose|shook)\b",
            re.IGNORECASE),
        "point": "Present/Past Perfect (have + V3 past participle)",
        "area": "tenses",
        "tip_vi": "Sau have/has/had cần V3 (past participle), KHÔNG dùng V2 (past simple). Vd: 'He has gone' (KHÔNG 'He has went').",
        "tip_en": "After have/has/had use V3 (past participle), not V2. E.g., 'He has gone' (not 'went').",
        "fix": lambda m: f"{m.group(1)} {_v2_to_v3(m.group(2))}",
    },
    {
        "name": "We/You/They + was (should be were)",
        "pattern": re.compile(r"\b(We|You|They)\s+was\b", re.IGNORECASE),
        "point": "Past Simple of 'be' (was/were)",
        "area": "tenses",
        "tip_vi": "Quá khứ của 'be': I/he/she/it + was; we/you/they + were.",
        "tip_en": "Past of 'be': I/he/she/it + was; we/you/they + were.",
        "fix": lambda m: f"{m.group(1)} were",
    },
    {
        "name": "Plural noun + is (people/police/cattle/staff exceptions)",
        "pattern": re.compile(r"\b(people|police|cattle|staff)\s+(is|was)\b", re.IGNORECASE),
        "point": "Subject-verb agreement (tricky)",
        "area": "advanced",
        "tip_vi": "'people', 'police', 'cattle', 'staff' luôn là số NHIỀU → dùng are/were.",
        "tip_en": "'people', 'police', 'cattle', 'staff' are PLURAL → use are/were.",
        "fix": lambda m: f"{m.group(1)} {'are' if m.group(2).lower()=='is' else 'were'}",
    },

    # ---- Tense / aux + verb form ----
    {
        "name": "Did/Didn't + past form (should be base)",
        "pattern": re.compile(
            r"\b(did|didn['’]?t)\s+(?:[a-z]+\s+)?(went|came|saw|ate|drank|wrote|got|knew|took|gave|spoke|brought|bought|caught|taught|thought|ran|sang|swam|flew|drove|made|said|told|found|left|met|paid|sat|stood|won|lost|sent|spent)\b",
            re.IGNORECASE),
        "point": "Past Simple with 'did' (use base form)",
        "area": "tenses",
        "tip_vi": "Sau 'did/didn't' dùng động từ NGUYÊN MẪU. Vd: 'Did you go?' (NOT 'Did you went?').",
        "tip_en": "After 'did/didn't' use the BASE form. E.g., 'Did you go?'.",
        "fix": None,
    },
    {
        "name": "Will + 3rd-sg / past form",
        "pattern": re.compile(
            r"\bwill\s+(goes|does|has|comes|runs|likes|loves|eats|drinks|plays|studies|lives|works|reads|writes|watches|listens|speaks|wants|needs|knows|thinks|feels|sees|hears|went|came|saw|ate|drank|wrote|got|took|gave|made|said|told|found|left|met|paid)\b",
            re.IGNORECASE),
        "point": "Future Simple (will + V-bare)",
        "area": "tenses",
        "tip_vi": "Sau 'will' luôn dùng động từ NGUYÊN MẪU.",
        "tip_en": "After 'will' use the bare infinitive.",
        "fix": None,
    },
    {
        "name": "Modal + V-s / past form",
        "pattern": re.compile(
            r"\b(can|could|shall|should|may|might|must|would)\s+(goes|does|has|comes|runs|likes|loves|eats|drinks|plays|studies|lives|works|reads|writes|watches|speaks|wants|needs|knows|thinks|feels|sees|hears|went|came|saw|ate|drank|wrote|got|took|gave|made|said|told|found|left|met|paid)\b",
            re.IGNORECASE),
        "point": "Modal verb + V-bare",
        "area": "modality",
        "tip_vi": "Sau modal dùng động từ NGUYÊN MẪU. KHÔNG chia thì, KHÔNG thêm -s.",
        "tip_en": "After a modal use the bare infinitive (no inflection).",
        "fix": None,
    },
    {
        "name": "Modal + to + V (incorrect)",
        "pattern": re.compile(r"\b(can|could|will|would|shall|should|may|might|must)\s+to\s+(\w+)\b", re.IGNORECASE),
        "point": "Modal verb + V-bare (no 'to')",
        "area": "modality",
        "tip_vi": "Sau modal KHÔNG có 'to'. Modal + động từ nguyên mẫu (bare infinitive). Vd: 'I can swim.' (NOT 'I can to swim.')",
        "tip_en": "No 'to' after a modal. Modal + bare infinitive.",
        "fix": lambda m: f"{m.group(1).lower()} {m.group(2)}",
    },
    {
        "name": "If-clause with 'will' (type 1)",
        "pattern": re.compile(r"\bif\s+\w+(?:\s+\w+){0,4}?\s+will\b", re.IGNORECASE),
        # "I wonder if he will come." — 'if' = 'whether' (embedded question), not a condition.
        "skip_if_match_left": re.compile(
            r"\b(?:wonder(?:s|ed|ing)?|ask(?:s|ed|ing)?|know(?:s|ing)?|knew|sure|doubt(?:s|ed|ing)?|see|saw|check(?:s|ed|ing)?)"
            r"(?:\s+(?:me|you|him|her|us|them))?\s+$",
            re.IGNORECASE),
        "point": "Conditional sentences",
        "area": "sentence_types",
        "tip_vi": "Mệnh đề 'if' (loại 1) KHÔNG dùng 'will'. Dùng hiện tại đơn: 'If it rains, I will stay home.'",
        "tip_en": "Don't use 'will' in an if-clause (Type 1). Use present simple.",
        "fix": None,
    },
    {
        "name": "Continuous tense (be + V-ing missing)",
        # Verbs that are also nouns ("study time", "work room") are excluded by noun-context lookahead.
        # 'to' is INTENTIONALLY not excluded — we want to catch "I am go to school".
        "pattern": re.compile(
            r"\b(am|is|are|was|were)\s+"
            r"(study|work|play|run|write|eat|drink|cook|sleep|sing|dance|walk|talk|look|listen|watch|wait|stay|go|come|do|make|take|get|sit|stand|drive|fly|swim|teach|learn|live|move|clean|wash|build|draw|paint|practice|practise|exercise|search|prepare|fix)\b"
            r"(?!\s+(?:time\b|room\b|group\b|session\b|hall\b|hour\b|day\b|night\b|week\b|month\b|year\b|class\b|club\b|leader\b|book\b|guide\b|skill\b|test\b|game\b|kit\b|set\b|partner\b|space\b|area\b|zone\b|station\b))",
            re.IGNORECASE),
        "point": "Continuous tense (be + V-ing)",
        "area": "tenses",
        "tip_vi": "Thì tiếp diễn cần V-ing sau 'be': 'I am studying English.' (KHÔNG 'I am study English.')",
        "tip_en": "Continuous tense needs V-ing after 'be'.",
        "fix": lambda m: f"{m.group(1)} {_add_ing(m.group(2))}",
    },
    {
        "name": "Past time marker + present verb",
        # Excludes verbs where base==past (read/put/cut/let/set/hit/cost/shut/spread/burst/hurt/split)
        # so "Yesterday I read a book" (read = past) is NOT flagged.
        "pattern": re.compile(
            r"\b(yesterday|last\s+(?:week|month|year|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d+\s+(?:days?|weeks?|months?|years?)\s+ago|in\s+\d{4})\b[^.!?\n]{0,40}?\b(I|you|he|she|it|we|they)\s+"
            r"(go|come|do|have|see|eat|drink|run|play|study|live|work|write|cook|sleep|stay|wait|sing|dance|watch|listen|speak|teach|need|want|know|think|feel|seem|look|try|clean)\b",
            re.IGNORECASE),
        # "Since last year I have lived here." / "In the last year I have been busy." —
        # the marker sits inside a since- or in/over/during/for-the-phrase, which
        # anchors present perfect. A bare finished-past marker stays flagged even
        # with have + V3 ("Yesterday I have eaten lunch.").
        "skip_if_match_left": re.compile(r"\b(?:since|(?:in|over|during|for)\s+the)\s+$", re.IGNORECASE),
        # ...but only when the matched verb is "have" used as the present-perfect
        # auxiliary. Participles and adverb runs are open-ended ("have used",
        # "have paid", "have never really been"), so the exemption holds unless
        # "have" is clearly possessive: followed by a determiner, number,
        # possessive, a common colour/size adjective, or "to". "Since last year
        # I live here." (verb is not "have") and "Since last year I have a dog."
        # stay flagged; a missed error is preferred to a false flag.
        "skip_requires_match_from_verb": re.compile(
            r"have\s+(?!(?:a|an|the|my|your|his|her|its|our|their|some|any|no|many|much"
            r"|this|that|these|those|one|two|three|four|five|six|seven|eight|nine|ten|\d+"
            r"|lots|plenty|enough|to|red|green|blue|black|white|brown|grey|gray|yellow"
            r"|pink|purple|orange|long|short|big|small|curly|straight|blond|blonde)\b)[a-z]",
            re.IGNORECASE),
        "point": "Past Simple (with past time markers)",
        "area": "tenses",
        "tip_vi": "Câu có từ chỉ thời gian quá khứ (yesterday, last…, ago) → động từ phải chia QUÁ KHỨ (V2).",
        "tip_en": "With past-time markers (yesterday, last…, ago), the verb must be past (V2).",
        "fix": None,
    },

    # ---- Articles / determiners ----
    {
        "name": "Two articles in a row",
        "pattern": re.compile(r"\b(a|an|the)\s+(a|an|the)\s+", re.IGNORECASE),
        "point": "Determiners & Articles",
        "area": "parts_of_speech",
        "tip_vi": "Không dùng hai mạo từ liền nhau. Chọn một: 'a', 'an' hoặc 'the'.",
        "tip_en": "Don't use two articles in a row.",
        "fix": None,
    },

    # ---- Quantifiers ----
    {
        "name": "Much + countable plural",
        "pattern": re.compile(r"\bmuch\s+(books|people|friends|cars|things|students|children|ideas|problems|questions|years|hours|days|minutes|countries|cities|languages|teachers|hospitals|restaurants|shops|jobs|songs|movies|cats|dogs|apples|oranges|chairs|tables|computers|phones|houses)\b", re.IGNORECASE),
        "point": "Quantifiers (much vs many)",
        "area": "parts_of_speech",
        "tip_vi": "'much' đi với DT KHÔNG đếm được. Với DT đếm được số nhiều dùng 'many'.",
        "tip_en": "'much' is for uncountable nouns. Use 'many' for plural countables.",
        "fix": lambda m: "many " + m.group(1).lower(),
    },
    {
        "name": "Many + uncountable",
        "pattern": re.compile(r"\bmany\s+(water|information|advice|money|news|furniture|equipment|knowledge|homework|research|traffic|weather|luggage|baggage|bread|rice|milk|coffee|tea|sugar|salt|music|work)\b", re.IGNORECASE),
        "point": "Quantifiers (much vs many)",
        "area": "parts_of_speech",
        "tip_vi": "'many' đi với DT đếm được số nhiều. Với DT không đếm được dùng 'much' / 'a lot of'.",
        "tip_en": "'many' is for plural countables. Use 'much' / 'a lot of' for uncountables.",
        "fix": lambda m: "much " + m.group(1).lower(),
    },
    {
        "name": "Less + countable plural (should be 'fewer')",
        "pattern": re.compile(r"\bless\s+(books|people|friends|cars|things|students|children|ideas|problems|questions|countries|cities|teachers|songs|movies|jobs|chairs|tables|computers|phones|houses|cookies|items|words|hours|days|minutes)\b", re.IGNORECASE),
        "point": "Quantifiers (less vs fewer)",
        "area": "parts_of_speech",
        "tip_vi": "Trong tiếng Anh chuẩn: 'fewer' đi với DT đếm được số nhiều, 'less' đi với DT không đếm được. Vd: 'fewer people' (KHÔNG 'less people').",
        "tip_en": "Standard English: 'fewer' for countable plurals, 'less' for uncountables.",
        "fix": lambda m: "fewer " + m.group(1).lower(),
    },
    {
        "name": "Plural form of uncountable noun",
        "pattern": re.compile(r"\b(informations|advices|furnitures|equipments|knowledges|homeworks|researches|musics|moneys|luggages|baggages)\b", re.IGNORECASE),
        "point": "Countable vs Uncountable nouns",
        "area": "parts_of_speech",
        "tip_vi": "Đây là danh từ KHÔNG đếm được nên không có dạng số nhiều. Vd: 'information' (KHÔNG 'informations').",
        "tip_en": "These are uncountable; no plural form. E.g., 'information' (not 'informations').",
        "fix": lambda m: m.group(1).lower().rstrip("s"),
    },

    # ---- Adjective form ----
    {
        "name": "Double comparative (more + Adj-er)",
        "pattern": re.compile(
            r"\bmore\s+(taller|bigger|smaller|older|younger|faster|slower|nicer|happier|easier|harder|richer|poorer|hotter|colder|cheaper|stronger|weaker|longer|shorter|higher|lower|better|worse|prettier|kinder|smarter|larger|warmer|cooler)\b",
            re.IGNORECASE),
        "point": "Comparatives & Superlatives",
        "area": "parts_of_speech",
        "tip_vi": "Không dùng 'more' cùng tính từ đã có -er. Chọn một dạng: 'taller' HOẶC 'more tall' (chỉ với từ dài).",
        "tip_en": "Don't combine 'more' with an -er adjective.",
        "fix": lambda m: m.group(1).lower(),
    },

    # ---- Prepositions (frequent Vietnamese learner errors) ----
    {
        "name": "discuss about (no 'about')",
        "pattern": re.compile(r"\bdiscuss(ed|es|ing)?\s+about\b", re.IGNORECASE),
        "point": "Common verb + preposition combos",
        "area": "parts_of_speech",
        "tip_vi": "'discuss' là ngoại động từ, KHÔNG đi với 'about'. Nói: 'We discussed the issue.'",
        "tip_en": "'discuss' takes a direct object, no 'about'.",
        "fix": lambda m: f"discuss{m.group(1) or ''}",  # preserve original tense
    },
    {
        "name": "marry with (no 'with')",
        "pattern": re.compile(r"\bmarry\s+with\b", re.IGNORECASE),
        "point": "Common verb + preposition combos",
        "area": "parts_of_speech",
        "tip_vi": "'marry' là ngoại động từ, KHÔNG đi với 'with'. Nói: 'She married him.'",
        "tip_en": "'marry' takes a direct object, no 'with'.",
        "fix": lambda m: "marry",
    },
    {
        "name": "listen + (no 'to')",
        "pattern": re.compile(r"\blisten\s+(music|the\s+radio|songs|news)\b", re.IGNORECASE),
        "point": "Common verb + preposition combos",
        "area": "parts_of_speech",
        "tip_vi": "'listen' luôn đi với 'to': 'listen to music'.",
        "tip_en": "'listen' always takes 'to': 'listen to music'.",
        "fix": lambda m: "listen to " + m.group(1).lower(),
    },
    {
        "name": "explain me / suggest me (no 'me')",
        "pattern": re.compile(r"\b(explain|suggest|describe|mention|introduce)\s+(me|him|her|us|them)\s+(?!to\b)", re.IGNORECASE),
        "point": "Common verb + preposition combos",
        "area": "parts_of_speech",
        "tip_vi": "Các động từ 'explain/suggest/describe/mention/introduce' cần 'to + người'. Nói: 'Explain it to me.' (KHÔNG 'Explain me.')",
        "tip_en": "Verbs like 'explain/suggest/describe' need 'to + person': 'Explain it to me.'",
        "fix": None,
    },
    {
        "name": "despite of / in spite (wrong)",
        "pattern": re.compile(r"\bdespite\s+of\b", re.IGNORECASE),
        "point": "Common verb + preposition combos",
        "area": "parts_of_speech",
        "tip_vi": "'despite' KHÔNG đi với 'of'. Đúng: 'despite + N/V-ing' hoặc 'in spite of + N/V-ing'.",
        "tip_en": "'despite' takes no 'of'. Use 'despite + N/V-ing' or 'in spite of + N/V-ing'.",
        "fix": lambda m: "despite",
    },

    # ---- Word order in questions ----
    {
        "name": "Question word + S + aux (should invert)",
        "pattern": re.compile(r"\b(Where|When|Why|How|What|Who)\s+(I|you|he|she|it|we|they)\s+(am|is|are|was|were|do|does|did|can|will|would|should)\b", re.IGNORECASE),
        "point": "Question word order",
        "area": "sentence_types",
        "tip_vi": "Trong câu hỏi trực tiếp, trợ động từ/tobe đứng TRƯỚC chủ ngữ. Vd: 'Where are you going?' (KHÔNG 'Where you are going?')",
        "tip_en": "In direct questions, aux/be comes BEFORE the subject: 'Where are you going?'",
        "fix": None,
    },

    # ---- Confused words ----
    {
        "name": "Your + welcome/Adj (should be you're)",
        "pattern": re.compile(r"\bYour\s+(welcome|right|wrong|correct|amazing|beautiful|smart|kind|here|there|late|early|hungry|tired|funny|so)\b", re.IGNORECASE),
        "point": "Confused words (your vs you're)",
        "area": "advanced",
        "tip_vi": "'your' = sở hữu (của bạn); 'you're' = you are. Ở đây cần 'You're + tính từ'.",
        "tip_en": "'your' is possessive; 'you're' = you are.",
        "fix": lambda m: f"You're {m.group(1).lower()}",
    },
]


def run_local_rules(text: str) -> List[Dict[str, Any]]:
    findings = []
    for rule in VI_LEARNER_RULES:
        for m in rule["pattern"].finditer(text):
            # Optional "skip if match left" guard
            skip_re = rule.get("skip_if_match_left")
            if skip_re:
                left = text[:m.start()]
                # Optional qualifier: the left guard only applies when the text
                # from the rule's last captured group (the verb) also matches.
                verb_re = rule.get("skip_requires_match_from_verb")
                if skip_re.search(left) and (
                    verb_re is None or verb_re.match(text, m.start(m.lastindex or 0))
                ):
                    continue
            replacement = None
            if rule.get("fix") is not None:
                try:
                    replacement = rule["fix"](m)
                except Exception:
                    replacement = None
            findings.append({
                "ruleId": "LOCAL_" + re.sub(r"\W+", "_", rule["name"].upper()).strip("_"),
                "category": "GRAMMAR",
                "message": rule["name"],
                "offset": m.start(),
                "errorLength": m.end() - m.start(),
                "replacements": [replacement] if replacement else [],
                "_tip": {
                    "point": rule["point"],
                    "area": rule["area"],
                    "tip_vi": rule["tip_vi"],
                    "tip_en": rule["tip_en"],
                },
            })
    return findings


# ===========================================================================
# 4. Merge + dedupe + correction
# ===========================================================================

def merge_findings(text: str, lt_findings: List[Dict[str, Any]], local_findings: List[Dict[str, Any]]):
    combined = list(lt_findings) + list(local_findings)
    for f in combined:
        if "_tip" not in f:
            f["_tip"] = find_tip_for_rule(f.get("ruleId", ""), f.get("category", ""))
    # Sort by offset
    combined.sort(key=lambda x: (x.get("offset", 0), -x.get("errorLength", 0)))
    # Dedupe: keep first when two findings span the same range AND the later one is from LT (or same tip)
    deduped: List[Dict[str, Any]] = []
    for f in combined:
        s, e = f["offset"], f["offset"] + f["errorLength"]
        dup = False
        for g in deduped:
            gs, ge = g["offset"], g["offset"] + g["errorLength"]
            # Exact same span and same tip point → drop
            if (s, e) == (gs, ge) and g["_tip"].get("point") == f["_tip"].get("point"):
                dup = True
                break
        if not dup:
            deduped.append(f)
    return deduped


def auto_correct(text: str, findings: List[Dict[str, Any]]) -> str:
    """Apply non-overlapping first-replacements from right to left."""
    fs = sorted([f for f in findings if f.get("replacements") and f["replacements"][0]],
                key=lambda x: x["offset"], reverse=True)
    out = text
    used_spans: List[Tuple[int, int]] = []
    for f in fs:
        s, e = f["offset"], f["offset"] + f["errorLength"]
        if any(not (e <= a or s >= b) for a, b in used_spans):
            continue
        out = out[:s] + f["replacements"][0] + out[e:]
        used_spans.append((s, e))
    return out


def chained_correct(text: str, backend: Optional[LTBackend] = None, max_iters: int = 3) -> Tuple[str, List[List[Dict[str, Any]]]]:
    """Run check + auto-correct until stable (catch chained errors like 'He don't goes')."""
    history = []
    current = text
    for _ in range(max_iters):
        local = run_local_rules(current)
        lt = backend.check(current) if backend else []
        merged = merge_findings(current, lt, local)
        history.append(merged)
        if not merged:
            break
        corrected = auto_correct(current, merged)
        if corrected == current:
            break
        current = corrected
    return current, history


# ===========================================================================
# 5. Output formatting
# ===========================================================================

def underline_error(text: str, offset: int, length: int) -> str:
    if length <= 0:
        return text
    return f"{text[:offset]}{_r()}{_bo()}{_un()}{text[offset:offset+length]}{_e()}{text[offset+length:]}"


def print_report(text: str, findings: List[Dict[str, Any]]) -> None:
    if not findings:
        print(f"\n{_g()}{_bo()}✓ Không phát hiện lỗi ngữ pháp rõ rệt.{_e()}")
        print(f"  {_di()}Câu: {text}{_e()}\n")
        return

    print(f"\n{_bo()}{_un()}KẾT QUẢ KIỂM TRA NGỮ PHÁP{_e()}\n")
    print(f"{_bo()}Câu bạn nhập:{_e()}\n  {text}\n")
    print(f"{_bo()}Số vấn đề phát hiện:{_e()} {_y()}{len(findings)}{_e()}\n")

    for i, f in enumerate(findings, 1):
        tip = f.get("_tip", {})
        marked = underline_error(text, f["offset"], f["errorLength"])
        print(f"{_bo()}{_m()}[Lỗi #{i}]{_e()} {_di()}({f.get('ruleId','')} / {f.get('category','')}){_e()}")
        print(f"  {_di()}→{_e()} {marked}")
        print(f"  {_bo()}{_cy()}🎯 Điểm ngữ pháp:{_e()} {_bo()}{tip.get('point','-')}{_e()} "
              f"{_di()}[mindmap area: {tip.get('area','-')}]{_e()}")
        print(f"  {_g()}🇻🇳 {tip.get('tip_vi','')}{_e()}")
        print(f"  {_b()}🇬🇧 {tip.get('tip_en','')}{_e()}")
        if f.get("message"):
            print(f"  {_di()}LT: {f['message']}{_e()}")
        if f.get("replacements"):
            shown = ", ".join(r for r in f["replacements"][:3] if r)
            if shown:
                print(f"  {_y()}💡 Gợi ý sửa:{_e()} {shown}")
        print()


def print_chained_report(text: str, final: str, history: List[List[Dict[str, Any]]]) -> None:
    if not history or not history[0]:
        print(f"\n{_g()}{_bo()}✓ Không phát hiện lỗi ngữ pháp rõ rệt.{_e()}")
        print(f"  {_di()}Câu: {text}{_e()}\n")
        return
    print_report(text, history[0])
    if final != text:
        print(f"{_bo()}{_g()}Câu sau khi áp dụng tất cả gợi ý (chuỗi){_e()}:")
        print(f"  {_g()}{final}{_e()}\n")
        if len(history) > 1 and len(history[-1]) == 0:
            print(f"{_di()}(Đã sửa qua {len(history)-1} vòng — không còn lỗi nào được phát hiện.){_e()}\n")
        elif len(history) > 1:
            print(f"{_di()}(Đã sửa qua {len(history)-1} vòng — vẫn còn {len(history[-1])} lỗi cần xem xét thủ công.){_e()}\n")
    print(f"{_di()}Mở grammar_mindmap.html để xem chi tiết các điểm ngữ pháp được nhắc đến.{_e()}\n")


# ===========================================================================
# 6. CLI + Tkinter GUI
# ===========================================================================

def cli_loop(backend: LTBackend):
    print(f"{_bo()}{_b()}Grammar Checker (EN) — bilingual feedback{_e()}")
    print(f"{_di()}Backend: {backend.mode}. Nhập câu/đoạn văn tiếng Anh. Gõ 'q' để thoát.{_e()}\n")
    while True:
        try:
            text = input(f"{_bo()}> {_e()}").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not text:
            continue
        if text.lower() in {"q", "quit", "exit"}:
            break
        final, history = chained_correct(text, backend=backend)
        print_chained_report(text, final, history)


def gui(backend: LTBackend):
    try:
        import tkinter as tk
        from tkinter import scrolledtext
    except Exception as e:
        print(f"{_r()}Không khởi động GUI được: {e}{_e()}")
        return

    win = tk.Tk()
    win.title("Grammar Checker — Bilingual Feedback")
    win.geometry("960x680")

    tk.Label(win, text="Grammar Checker (A1 - C1)",
             font=("Helvetica", 16, "bold"), pady=8).pack()
    tk.Label(win, text="Nhập câu tiếng Anh → bấm 'Kiểm tra' để xem lỗi và điểm ngữ pháp liên quan.",
             font=("Helvetica", 10), fg="#555").pack()

    input_box = scrolledtext.ScrolledText(win, height=6, font=("Helvetica", 12), wrap="word")
    input_box.pack(fill="x", padx=10, pady=8)
    input_box.insert("1.0", "She go to school every day.")

    def run_check():
        text = input_box.get("1.0", "end").strip()
        out_box.config(state="normal")
        out_box.delete("1.0", "end")
        if not text:
            out_box.insert("end", "Hãy nhập câu trước.")
            out_box.config(state="disabled")
            return
        final, history = chained_correct(text, backend=backend)
        findings = history[0] if history else []
        if not findings:
            out_box.insert("end", "✓ Không phát hiện lỗi ngữ pháp rõ rệt.\n")
        else:
            out_box.insert("end", f"Phát hiện {len(findings)} vấn đề:\n\n", "bold")
            for i, f in enumerate(findings, 1):
                tip = f.get("_tip", {})
                err_segment = text[f["offset"]:f["offset"]+f["errorLength"]] or "(?)"
                out_box.insert("end", f"[#{i}] {tip.get('point','-')}\n", "h2")
                out_box.insert("end", f"   Vị trí lỗi: «{err_segment}»\n", "err")
                out_box.insert("end", f"   🇻🇳 {tip.get('tip_vi','')}\n", "vi")
                out_box.insert("end", f"   🇬🇧 {tip.get('tip_en','')}\n", "en")
                if f.get("replacements"):
                    rs = ", ".join(r for r in f["replacements"][:3] if r)
                    if rs:
                        out_box.insert("end", f"   💡 Gợi ý: {rs}\n", "hint")
                if f.get("message"):
                    out_box.insert("end", f"   (LT: {f['message']})\n", "dim")
                out_box.insert("end", f"   → Mindmap area: {tip.get('area','-')}\n\n", "dim")
            if final != text:
                out_box.insert("end", "Câu sau khi sửa (chuỗi):\n", "h2")
                out_box.insert("end", final + "\n", "ok")
        out_box.config(state="disabled")

    btn_row = tk.Frame(win); btn_row.pack(fill="x", padx=10)
    tk.Button(btn_row, text="Kiểm tra", command=run_check,
              bg="#1e88e5", fg="white", font=("Helvetica", 11, "bold"),
              padx=14, pady=6).pack(side="left")
    tk.Button(btn_row, text="Xoá", command=lambda: input_box.delete("1.0", "end")).pack(side="left", padx=6)

    out_box = scrolledtext.ScrolledText(win, font=("Helvetica", 11), wrap="word")
    out_box.tag_configure("bold", font=("Helvetica", 12, "bold"))
    out_box.tag_configure("h2", font=("Helvetica", 11, "bold"), foreground="#6a1b9a")
    out_box.tag_configure("err", foreground="#c62828")
    out_box.tag_configure("vi", foreground="#1b5e20")
    out_box.tag_configure("en", foreground="#0d47a1")
    out_box.tag_configure("hint", foreground="#ef6c00")
    out_box.tag_configure("ok", foreground="#2e7d32", font=("Helvetica", 11, "bold"))
    out_box.tag_configure("dim", foreground="#777")
    out_box.pack(fill="both", expand=True, padx=10, pady=10)
    win.mainloop()


def main():
    p = argparse.ArgumentParser(description="Bilingual English grammar checker.")
    p.add_argument("sentence", nargs="*", help="Câu cần kiểm tra.")
    p.add_argument("--gui", action="store_true", help="Mở Tkinter GUI.")
    p.add_argument("--online", action="store_true", help="Dùng LT Public API.")
    p.add_argument("--no-color", action="store_true", help="Tắt màu ANSI.")
    p.add_argument("--language", default="en-US", help="en-US, en-GB, ...")
    args = p.parse_args()

    if args.no_color:
        C.disable()

    backend = LTBackend(prefer_offline=not args.online, language=args.language)
    try:
        if args.gui:
            gui(backend); return
        if args.sentence:
            text = " ".join(args.sentence)
            final, history = chained_correct(text, backend=backend)
            print_chained_report(text, final, history)
        else:
            cli_loop(backend)
    finally:
        backend.close()


if __name__ == "__main__":
    main()
