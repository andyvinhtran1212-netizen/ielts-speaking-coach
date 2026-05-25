"""
services/phoneme_ref.py — Python port of the Sprint 15.1/15.3 phoneme lookup +
weak-word extractor (mirror of frontend/js/pronunciation-drilldown.js).

Why a port and not a reuse:
  - The IPA / examples / VN-tip lookup (``PHONEME_REF``) lived only in the JS
    drill-down module; there was no Python copy.
  - ``azure_pronunciation.extract_weak_phonemes`` returns a *flat top-N* list,
    but result.html's accordion (and therefore the PDF, for parity) needs the
    *word-grouped* shape produced by JS ``extractWeakWordsFromPayload``.

Parity is guarded by ``backend/tests/test_pdf_generator.py`` which asserts the
PHONEME_REF key set here matches the JS file (Pattern #34 integration sentinel).
If you add/remove a symbol in one file, update the other.

Symbols are SAPI phones (e.g. ``ih``, ``ay`` — NOT IPA); scores are HundredMark
0–100. Symbols missing from the lookup degrade gracefully (Pattern #29).
"""

import json

# SAPI (en-US) → display IPA + example words + Vietnamese learner tip.
# Mirror of PHONEME_REF in frontend/js/pronunciation-drilldown.js (tip_en omitted
# — the PDF, like result.html, renders only the VN tip).
PHONEME_REF: dict[str, dict] = {
    # ── Vowels ──
    "aa": {"ipa": "ɑ",  "examples": ["father", "hot", "car"],     "tip_vn": 'Mở miệng rộng, âm "a" dài và sâu trong cổ họng.'},
    "ae": {"ipa": "æ",  "examples": ["cat", "bad", "apple"],      "tip_vn": 'Miệng mở rộng theo chiều ngang, giữa "a" và "e".'},
    "ah": {"ipa": "ʌ",  "examples": ["cup", "luck", "but"],       "tip_vn": 'Âm "ơ" ngắn, miệng thả lỏng tự nhiên.'},
    "ao": {"ipa": "ɔ",  "examples": ["dog", "law", "caught"],     "tip_vn": 'Tròn môi, âm "o" mở.'},
    "aw": {"ipa": "aʊ", "examples": ["now", "house", "out"],      "tip_vn": 'Trượt từ "a" sang "u", môi tròn dần.'},
    "ax": {"ipa": "ə",  "examples": ["about", "sofa", "taken"],   "tip_vn": 'Âm "ơ" rất nhẹ, không nhấn (schwa).'},
    "ay": {"ipa": "aɪ", "examples": ["my", "time", "like"],       "tip_vn": 'Trượt từ "a" sang "i", rõ cả hai phần.'},
    "eh": {"ipa": "ɛ",  "examples": ["bed", "head", "said"],      "tip_vn": 'Âm "e" ngắn, miệng mở vừa.'},
    "er": {"ipa": "ɝ",  "examples": ["bird", "her", "work"],      "tip_vn": 'Cong lưỡi lên, giữ âm "ơ-r" — đừng bỏ /r/.'},
    "ey": {"ipa": "eɪ", "examples": ["day", "name", "say"],       "tip_vn": 'Trượt từ "ê" sang "i".'},
    "ih": {"ipa": "ɪ",  "examples": ["sit", "bit", "ship"],       "tip_vn": 'Âm "i" ngắn, lưỡi thấp hơn /iy/ — khác "ee".'},
    "iy": {"ipa": "iː", "examples": ["see", "eat", "machine"],    "tip_vn": 'Âm "i" dài, căng, kéo môi sang ngang.'},
    "ow": {"ipa": "oʊ", "examples": ["go", "boat", "know"],       "tip_vn": 'Trượt từ "ô" sang "u", tròn môi dần.'},
    "oy": {"ipa": "ɔɪ", "examples": ["boy", "coin", "enjoy"],     "tip_vn": 'Trượt từ "o" sang "i".'},
    "uh": {"ipa": "ʊ",  "examples": ["book", "put", "good"],      "tip_vn": 'Âm "u" ngắn, môi tròn nhẹ.'},
    "uw": {"ipa": "uː", "examples": ["food", "blue", "soon"],     "tip_vn": 'Âm "u" dài, tròn môi mạnh.'},
    # ── Consonants ──
    "b":  {"ipa": "b",  "examples": ["big", "job", "rubber"],     "tip_vn": "Bật hai môi, có rung thanh."},
    "ch": {"ipa": "tʃ", "examples": ["chair", "watch", "cheese"], "tip_vn": 'Âm "ch" bật mạnh, không thành "sh".'},
    "d":  {"ipa": "d",  "examples": ["dog", "red", "ladder"],     "tip_vn": "Đầu lưỡi chạm lợi, có rung."},
    "dh": {"ipa": "ð",  "examples": ["this", "mother", "the"],    "tip_vn": 'Lưỡi chạm răng trên, có rung — không thành "d"/"z".'},
    "f":  {"ipa": "f",  "examples": ["fish", "phone", "laugh"],   "tip_vn": "Răng trên chạm môi dưới, thổi hơi."},
    "g":  {"ipa": "g",  "examples": ["go", "bag", "bigger"],      "tip_vn": "Cuống lưỡi chạm vòm mềm, có rung."},
    "hh": {"ipa": "h",  "examples": ["hat", "who", "behind"],     "tip_vn": "Thở nhẹ ra, không nghẹn cổ."},
    "jh": {"ipa": "dʒ", "examples": ["job", "page", "bridge"],    "tip_vn": 'Âm "j" có rung, mạnh hơn "ch".'},
    "k":  {"ipa": "k",  "examples": ["cat", "book", "school"],    "tip_vn": "Cuống lưỡi bật, có hơi."},
    "l":  {"ipa": "l",  "examples": ["light", "feel", "yellow"],  "tip_vn": "Đầu lưỡi chạm lợi; cuối từ giữ rõ /l/."},
    "m":  {"ipa": "m",  "examples": ["man", "time", "summer"],    "tip_vn": "Ngậm môi, âm mũi."},
    "n":  {"ipa": "n",  "examples": ["no", "sun", "dinner"],      "tip_vn": "Đầu lưỡi chạm lợi, âm mũi."},
    "ng": {"ipa": "ŋ",  "examples": ["sing", "long", "thinking"], "tip_vn": 'Âm mũi cuối, cuống lưỡi nâng — không thêm "g".'},
    "p":  {"ipa": "p",  "examples": ["pen", "stop", "happy"],     "tip_vn": "Bật hai môi, có hơi, không rung."},
    "r":  {"ipa": "ɹ",  "examples": ["red", "very", "around"],    "tip_vn": 'Cong/lùi lưỡi, không chạm — khác "l".'},
    "s":  {"ipa": "s",  "examples": ["see", "bus", "lesson"],     "tip_vn": "Hơi xì rõ, không rung."},
    "sh": {"ipa": "ʃ",  "examples": ["she", "wish", "nation"],    "tip_vn": 'Âm "s" tròn môi hơn, "sh".'},
    "t":  {"ipa": "t",  "examples": ["top", "cat", "better"],     "tip_vn": "Đầu lưỡi bật ở lợi, có hơi; giữ /t/ cuối từ."},
    "th": {"ipa": "θ",  "examples": ["think", "bath", "three"],   "tip_vn": 'Lưỡi chạm răng trên, thổi hơi — không thành "t"/"s".'},
    "v":  {"ipa": "v",  "examples": ["very", "love", "seven"],    "tip_vn": 'Răng trên chạm môi dưới, có rung — khác "w"/"b".'},
    "w":  {"ipa": "w",  "examples": ["we", "away", "quick"],      "tip_vn": "Tròn môi mạnh, trượt nhanh."},
    "y":  {"ipa": "j",  "examples": ["yes", "you", "beyond"],     "tip_vn": 'Lưỡi nâng cao, trượt từ "i".'},
    "z":  {"ipa": "z",  "examples": ["zoo", "is", "busy"],        "tip_vn": 'Như "s" nhưng có rung.'},
    "zh": {"ipa": "ʒ",  "examples": ["measure", "vision", "beige"], "tip_vn": 'Như "sh" nhưng có rung.'},
}


def tier(score) -> str:
    """Score → quality tier (mirror of JS _tier): <60 low, <80 mid, else high."""
    if score is None:
        return "mid"
    if score < 60:
        return "low"
    if score < 80:
        return "mid"
    return "high"


def extract_weak_words_from_payload(payload, threshold: float = 70.0) -> dict:
    """Parse a persisted raw Azure ``pronunciation_payload`` ({...NBest...}) into
    the per-word weak-word shape the drill-down renders. 1:1 port of JS
    ``extractWeakWordsFromPayload``.

    Returns:
        {"weak_words": [{"word", "phonemes": [{"symbol", "score"}], "word_index"}],
         "legacy": bool}
        - legacy=True  → words present but no Phonemes arrays (pre-15.1 Word
          granularity) → caller shows a placeholder.
        - {"weak_words": [], "legacy": False} → null/empty/malformed payload or no
          recognition (Pattern #29 graceful degradation).
    """
    raw = payload
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            raw = None
    if not isinstance(raw, dict):
        return {"weak_words": [], "legacy": False}

    nbest = raw.get("NBest") or []
    if not nbest:
        return {"weak_words": [], "legacy": False}
    words = nbest[0].get("Words") or []
    if not words:
        return {"weak_words": [], "legacy": False}

    any_phonemes = any(
        isinstance(w.get("Phonemes"), list) and w.get("Phonemes") for w in words
    )
    if not any_phonemes:
        return {"weak_words": [], "legacy": True}   # pre-15.1 Word-granularity

    weak_words: list[dict] = []
    for idx, w in enumerate(words):
        phs = [
            {"symbol": p.get("Phoneme"), "score": p.get("AccuracyScore")}
            for p in (w.get("Phonemes") or [])
            if p.get("Phoneme") is not None and p.get("AccuracyScore") is not None
        ]
        if not phs:
            continue
        has_weak = any(p["score"] < threshold for p in phs)
        err = w.get("ErrorType")
        errored = bool(err) and err != "None"
        if has_weak or errored:
            weak_words.append({
                "word": w.get("Word") or "",
                "phonemes": phs,
                "word_index": idx,
            })
    return {"weak_words": weak_words, "legacy": False}
