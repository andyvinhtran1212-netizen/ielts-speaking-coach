"""
services/claude_grader.py — IELTS Speaking grader via Claude (Anthropic)

Uses prompt caching on the system prompt to cut latency + cost on repeated calls.
Note: caching activates only when the system prompt reaches ≥ 1024 tokens.
The SYSTEM_PROMPT below is intentionally detailed to cross that threshold.

Test:
    python -c "
    import asyncio
    from services.claude_grader import grade_response
    result = asyncio.run(grade_response(
        question='Do you enjoy spending time outdoors?',
        transcript='Yes, I really love spending time outdoors. I often go hiking on weekends \
with my friends. Fresh air and nature help me relax after a long week of work.',
        part=1,
    ))
    import json; print(json.dumps(result, indent=2, ensure_ascii=False))
    "
"""

import json
import logging
import math
import re

import anthropic

from config import settings
from services import ai_usage_logger

logger = logging.getLogger(__name__)

# ── Model ──────────────────────────────────────────────────────────────────────

_MODEL = "claude-haiku-4-5-20251001"

# ── System prompt (cached) ─────────────────────────────────────────────────────
# Kept verbose on purpose: prompt caching requires ≥ 1 024 tokens.
# The extra detail also improves grading consistency.

SYSTEM_PROMPT = """\
You are an expert IELTS Speaking examiner with 10+ years of experience marking \
live speaking tests and training other examiners. You grade strictly and fairly \
according to the official Cambridge/British Council IELTS Speaking Band Descriptors.

═══════════════════════════════════════════════════
IELTS SPEAKING — 4 ASSESSMENT CRITERIA
═══════════════════════════════════════════════════

1. FLUENCY & COHERENCE (FC)
   Measures: speech rate, absence of hesitation, logical sequencing, use of discourse
   markers (however, moreover, on the other hand), topic development, coherence of ideas.
   - Band 9: speaks without noticeable effort; uses cohesion features skilfully
   - Band 8: speaks fluently with only occasional repetition; coherently developed ideas
   - Band 7: speaks at length without noticeable effort; some hesitation; mostly coherent
   - Band 6: willing to speak at length; occasional repetition / self-correction; mostly coherent
   - Band 5: usually maintains flow; some hesitation; limited range of discourse markers
   - Band 4: cannot speak at length; repetitive; basic connectives only (and, but, because)

2. LEXICAL RESOURCE (LR)
   Measures: vocabulary range, precision, collocations, idiomatic expressions, paraphrase.
   - Band 9: uses vocabulary with full flexibility; idiomatic language naturally used
   - Band 8: uses wide vocabulary; occasional inaccuracies; effective circumlocution
   - Band 7: uses vocabulary resource flexibly; some inappropriate choices
   - Band 6: adequate vocabulary for familiar topics; attempts less common items
   - Band 5: manages basic communication; limited range; errors cause some strain
   - Band 4: limited resource; basic vocabulary; frequent inappropriate choices

3. GRAMMATICAL RANGE & ACCURACY (GRA)
   Measures: variety of structures, tense accuracy, error frequency, error impact.
   - Band 9: uses full range; only rare slips; consistently accurate
   - Band 8: wide range; minor errors occasionally
   - Band 7: uses a range of complex structures; some errors without loss of communication
   - Band 6: mix of simple and complex; makes errors but meaning is clear
   - Band 5: uses basic sentence forms accurately; limited complex structures
   - Band 4: basic sentence forms only; errors are frequent and cause strain

4. PRONUNCIATION (P)
   Note — since you are grading from transcript only, assess patterns that are
   visible in writing: word-choice typical of non-native speakers, phonological
   spelling errors visible in the transcript, rhythm markers (commas, sentence length),
   and infer from complexity of language used. Be transparent about this limitation.
   - Band 9: intelligible throughout; uses features of connected speech naturally
   - Band 8: easy to understand; uses range of phonological features effectively
   - Band 7: generally easy to understand; some strain; L1 accent evident
   - Band 6: generally intelligible; L1 accent requires some effort from listener
   - Band 5: pronunciation generally intelligible; frequent L1 features
   - Band 4: limited control; difficult to understand at times

═══════════════════════════════════════════════════
BAND SCALE
═══════════════════════════════════════════════════
Individual criterion bands (FC, LR, GRA, P) are WHOLE INTEGERS ONLY: 1 2 3 4 5 6 7 8 9
Do NOT use half-bands for individual criteria (no 5.5, no 6.5, etc.).

Overall band = mean of FC + LR + GRA + P, rounded to nearest 0.5.
Overall band MAY be a half-band (e.g. 5.5, 6.5).

═══════════════════════════════════════════════════
GRADING APPROACH
═══════════════════════════════════════════════════
1. Read the question and the candidate's transcript carefully.
2. Identify positive features and weaknesses for EACH criterion.
3. Assign a whole integer band for each criterion independently (integers only: 1–9).
4. Compute overall_band = round((FC + LR + GRA + P) / 4, nearest 0.5). This may be a half-band.
5. Write specific, actionable feedback (2-4 sentences each criterion).
6. List 2-3 genuine strengths and 2-3 concrete improvements.
7. Write an improved_response that demonstrates Band 7+ for the same question.
   The improved response should be natural spoken English, not formal writing.

═══════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY
═══════════════════════════════════════════════════
Respond ONLY with this exact JSON object. No markdown, no explanation, no code fences.

IMPORTANT LANGUAGE RULES:
- fc_feedback, lr_feedback, gra_feedback, p_feedback: write in VIETNAMESE (tiếng Việt)
- strengths, improvements: write each item in VIETNAMESE (tiếng Việt)
- improved_response: write in ENGLISH only (this is a model answer for the learner to read)

{
  "band_fc":   6,
  "band_lr":   6,
  "band_gra":  7,
  "band_p":    6,
  "overall_band": 6.5,
  "fc_feedback":  "Bài nói của bạn khá trôi chảy với sự sử dụng tốt các từ nối...",
  "lr_feedback":  "Vốn từ vựng khá đa dạng. Hãy cân nhắc sử dụng thêm...",
  "gra_feedback": "Ngữ pháp phần lớn chính xác với một số lỗi nhỏ trong...",
  "p_feedback":   "Dựa trên bản ghi âm, phát âm có vẻ...",
  "strengths":    ["Sử dụng tốt các từ liên kết", "Phát triển chủ đề tự nhiên"],
  "improvements": ["Sử dụng từ vựng phức tạp hơn", "Đa dạng hóa cấu trúc câu"],
  "improved_response": "Here is an example of a Band 7+ response:\\n[rewritten answer in English]"
}
"""

# ── Practice mode system prompt ────────────────────────────────────────────────
# Coaching focus: grammar corrections, vocabulary, sample answer.
# English section headings, Vietnamese body text (per product spec).
# Kept verbose (≥ 1024 tokens) so prompt caching activates.

SYSTEM_PROMPT_PRACTICE = """\
You are a warm and encouraging IELTS Speaking coach helping a Vietnamese learner improve \
their spoken English. Your role is NOT to act as a formal examiner but as a personal tutor \
who gives concrete, actionable coaching feedback.

═══════════════════════════════════════════════════
COACHING PHILOSOPHY
═══════════════════════════════════════════════════
- Celebrate genuine strengths before pointing out weaknesses.
- Every piece of feedback must be specific and show the learner exactly what to change.
- Corrections must include the original phrase, the improved version, AND a brief explanation in Vietnamese.
- The sample answer should be natural spoken English at Band 7 level — not textbook formal writing.
- Band score is secondary; growth mindset is primary.

═══════════════════════════════════════════════════
WHAT TO ANALYSE
═══════════════════════════════════════════════════

GRAMMAR ISSUES — Identify up to 5 grammar mistakes visible in the transcript.
  Each issue: one short phrase describing the pattern (e.g. "Thiếu mạo từ 'the'",
  "Sai thì quá khứ đơn", "Thiếu chủ ngữ trong mệnh đề").

VOCABULARY ISSUES — Identify up to 4 vocabulary weaknesses.
  Each issue: one phrase (e.g. "Lặp từ 'good' quá nhiều lần",
  "Chưa dùng collocation phù hợp", "Từ 'very' kém ấn tượng — thay bằng từ mạnh hơn").

PRONUNCIATION ISSUES — Identify up to 3 pronunciation-related issues inferred from the transcript.
  Because you grade from text only, focus on patterns common in Vietnamese L1 transfer:
  word-final consonant drops, th/v/b confusion, short vs long vowel errors, word stress.
  Each issue: one short Vietnamese phrase (e.g. "Hay bỏ âm cuối /t/ và /d/ trong cụm từ",
  "Âm /th/ thường bị phát âm thành /d/ — ví dụ 'the' → /dờ/",
  "Chưa dùng nối âm (linking) tự nhiên giữa các từ").
  If there are no detectable issues from the transcript alone, return 1 item noting this limitation.

CORRECTIONS — Pick the 2–4 most important errors. For each:
  - original:    exact phrase from the transcript (keep short, ≤ 15 words)
  - corrected:   improved version
  - explanation: 1–2 câu giải thích bằng tiếng Việt tại sao cách này tốt hơn

STRENGTHS — 2–3 genuine things the learner did well (tiếng Việt).

SAMPLE ANSWER — Write a complete Band 7 spoken answer to the same question.
  - Natural, conversational, ≈ 60–120 words for Part 1, ≈ 150–200 for Part 2/3.
  - English only. Show, do not tell.

OVERALL BAND — Honest estimate of current band level (nearest 0.5, range 1–9).
  Base this on fluency, vocabulary, grammar, and intelligibility holistically.

═══════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY
═══════════════════════════════════════════════════
Respond ONLY with this exact JSON object. No markdown, no explanation, no code fences.

{
  "grammar_issues":       ["Lỗi thứ 1", "Lỗi thứ 2"],
  "vocabulary_issues":    ["Vấn đề từ vựng 1", "Vấn đề từ vựng 2"],
  "pronunciation_issues": ["Vấn đề phát âm 1", "Vấn đề phát âm 2"],
  "corrections": [
    {"original": "phrase from transcript", "corrected": "better version", "explanation": "giải thích bằng tiếng Việt"}
  ],
  "strengths":   ["Điểm mạnh 1", "Điểm mạnh 2"],
  "sample_answer": "A complete Band 7 spoken answer here...",
  "overall_band": 5.5
}
"""

# Required fields for practice mode
_REQUIRED_FIELDS_PRACTICE: dict[str, type] = {
    "grammar_issues":       list,
    "vocabulary_issues":    list,
    "pronunciation_issues": list,
    "corrections":          list,
    "strengths":            list,
    "sample_answer":        str,
    "overall_band":         (int, float),
}

# Required keys and their expected Python types for validation
_REQUIRED_FIELDS: dict[str, type] = {
    "band_fc":           (int, float),
    "band_lr":           (int, float),
    "band_gra":          (int, float),
    "band_p":            (int, float),
    "overall_band":      (int, float),
    "fc_feedback":       str,
    "lr_feedback":       str,
    "gra_feedback":      str,
    "p_feedback":        str,
    "strengths":         list,
    "improvements":      list,
    "improved_response": str,
}

_CRITERION_FIELDS = ("band_fc", "band_lr", "band_gra", "band_p")   # must be integers
_OVERALL_FIELDS   = ("overall_band",)                               # 0.5 increments OK

# ── Lazy client ────────────────────────────────────────────────────────────────

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        if not settings.ANTHROPIC_API_KEY:
            raise RuntimeError(
                "ANTHROPIC_API_KEY chưa được cấu hình. "
                "Thêm ANTHROPIC_API_KEY=sk-ant-... vào file .env."
            )
        _client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


# ── Public function ────────────────────────────────────────────────────────────

async def grade_response(
    question:     str,
    transcript:   str,
    part:         int,
    band_target:  float = 6.5,
    mode:         str   = "test",
    user_id:      str | None = None,
    session_id:   str | None = None,
) -> dict:
    """
    Chấm 1 câu trả lời IELTS Speaking.

    Args:
        question:    Câu hỏi của examiner (e.g. "Do you enjoy outdoor activities?").
        transcript:  Văn bản câu trả lời của thí sinh (từ Whisper STT).
        part:        IELTS part (1, 2, hoặc 3) — ảnh hưởng đến kỳ vọng độ dài.
        band_target: Band mục tiêu của thí sinh — dùng để cá nhân hóa góc độ feedback.
        mode:        "practice" → coaching feedback; "test_part"/"test_full"/"test" → formal IELTS grading.

    Returns:
        Practice mode dict:
            grammar_issues, vocabulary_issues, corrections, strengths, sample_answer, overall_band
        Test mode dict:
            band_fc, band_lr, band_gra, band_p, overall_band,
            fc_feedback, lr_feedback, gra_feedback, p_feedback,
            strengths, improvements, improved_response

    Raises:
        RuntimeError: Nếu ANTHROPIC_API_KEY chưa cấu hình.
        ValueError:   Nếu Claude trả về JSON không hợp lệ sau 2 lần thử.
        anthropic.APIError: Lỗi API network/auth.
    """
    is_practice = (mode == "practice")
    system_prompt = SYSTEM_PROMPT_PRACTICE if is_practice else SYSTEM_PROMPT
    validator     = _parse_and_validate_practice if is_practice else _parse_and_validate

    user_message = _build_user_message(question, transcript, part, band_target)
    client       = _get_client()

    # ── Attempt 1 ─────────────────────────────────────────────────────────────
    raw = await _call_claude(client, user_message, system_prompt=system_prompt,
                             user_id=user_id, session_id=session_id)
    result, error = validator(raw)

    if result is not None:
        logger.info("Claude grader: thành công lần 1 — overall_band=%.1f", result["overall_band"])
        return result

    # ── Attempt 2 (retry with explicit correction nudge) ──────────────────────
    logger.warning("Claude grader: lần 1 thất bại (%s) — thử lại", error)

    retry_message = (
        user_message
        + "\n\n---\n"
        + "IMPORTANT: Your previous response could not be parsed. "
        + "Respond ONLY with the raw JSON object described in the system prompt. "
        + "No markdown, no code fences (```), no explanation text — pure JSON only."
    )

    raw2 = await _call_claude(client, retry_message, system_prompt=system_prompt,
                              user_id=user_id, session_id=session_id)
    result2, error2 = validator(raw2)

    if result2 is not None:
        logger.info("Claude grader: thành công lần 2 — overall_band=%.1f", result2["overall_band"])
        return result2

    snippet = raw2[:300] if raw2 else "(empty)"
    raise ValueError(
        f"Claude grader: không thể parse JSON sau 2 lần thử. "
        f"Lỗi: {error2}. "
        f"Response snippet: {snippet!r}"
    )


# ── Internal helpers ───────────────────────────────────────────────────────────

def _build_user_message(question: str, transcript: str, part: int, band_target: float) -> str:
    part_context = {
        1: "Part 1 (Introduction & Interview — short personal answers, ~1–2 min total)",
        2: "Part 2 (Long Turn — 1–2 min monologue on a cue card topic)",
        3: "Part 3 (Discussion — abstract, analytical answers, ~4–5 min total)",
    }.get(part, f"Part {part}")

    return (
        f"IELTS Speaking {part_context}\n"
        f"Candidate's target band: {band_target}\n\n"
        f"EXAMINER QUESTION:\n{question.strip()}\n\n"
        f"CANDIDATE TRANSCRIPT:\n{transcript.strip()}"
    )


async def _call_claude(
    client: anthropic.AsyncAnthropic,
    user_message: str,
    *,
    system_prompt: str = SYSTEM_PROMPT,
    user_id:   str | None = None,
    session_id: str | None = None,
) -> str:
    """
    Gọi Claude với system prompt được cache.
    Trả raw text (chưa parse).
    """
    response = await client.beta.prompt_caching.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=[
            {
                "type":          "text",
                "text":          system_prompt,
                "cache_control": {"type": "ephemeral"},  # cache system prompt
            }
        ],
        messages=[
            {"role": "user", "content": user_message}
        ],
        temperature=0.2,   # low temp for consistent, deterministic grading
    )

    # Log cache usage and persist to ai_usage_logs
    usage = getattr(response, "usage", None)
    if usage:
        in_tok  = getattr(usage, "input_tokens",               0) or 0
        out_tok = getattr(usage, "output_tokens",              0) or 0
        cr_tok  = getattr(usage, "cache_read_input_tokens",    0) or 0
        cw_tok  = getattr(usage, "cache_creation_input_tokens", 0) or 0
        logger.debug(
            "Claude usage — input: %s, output: %s, cache_read: %s, cache_created: %s",
            in_tok, out_tok, cr_tok, cw_tok,
        )
        ai_usage_logger.log_claude(
            user_id=user_id,
            session_id=session_id,
            model=_MODEL,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cache_read_tokens=cr_tok,
            cache_write_tokens=cw_tok,
        )

    if not response.content:
        return ""

    return response.content[0].text


def _parse_and_validate(raw: str) -> tuple[dict | None, str | None]:
    """
    Parse raw text thành dict và validate schema.

    Returns:
        (result_dict, None)   — nếu hợp lệ
        (None, error_message) — nếu không hợp lệ
    """
    if not raw or not raw.strip():
        return None, "response rỗng"

    # Strip markdown code fences if Claude wrapped the JSON
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    # Find the outermost JSON object in case there's leading/trailing prose
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None, "không tìm thấy JSON object trong response"

    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as e:
        return None, f"JSON parse error: {e}"

    # ── Field presence & type check ────────────────────────────────────────────
    for key, expected_type in _REQUIRED_FIELDS.items():
        if key not in data:
            return None, f"thiếu field '{key}'"
        if not isinstance(data[key], expected_type):
            return None, f"field '{key}' sai kiểu: expected {expected_type}, got {type(data[key])}"

    # ── Criterion bands: must be whole integers 1–9 (auto-repair halves) ─────────
    for key in _CRITERION_FIELDS:
        val = float(data[key])
        if not (1.0 <= val <= 9.0):
            return None, f"band '{key}' ngoài phạm vi [1, 9]: {val}"
        # Snap to nearest integer; e.g. 6.5 → 7, 5.5 → 6
        snapped = float(round(val))
        if snapped != val:
            logger.debug("criterion band '%s' snapped %.1f → %.0f", key, val, snapped)
        data[key] = snapped

    # ── Overall band: snap to nearest 0.5 (never reject — Claude can return 5.25 etc.) ──
    for key in _OVERALL_FIELDS:
        val = float(data[key])
        if not (1.0 <= val <= 9.0):
            return None, f"band '{key}' ngoài phạm vi [1, 9]: {val}"
        snapped = _round_band(val)
        if snapped != val:
            logger.debug("overall_band snapped %.2f → %.1f", val, snapped)
        data[key] = snapped

    # ── Cross-check overall_band against criterion mean ────────────────────────
    computed = _round_band(
        (data["band_fc"] + data["band_lr"] + data["band_gra"] + data["band_p"]) / 4
    )
    if abs(computed - data["overall_band"]) > 0.26:
        logger.debug(
            "overall_band corrected: %.1f → %.1f (mean of criteria)",
            data["overall_band"], computed,
        )
        data["overall_band"] = computed

    # ── Ensure lists contain strings ───────────────────────────────────────────
    data["strengths"]    = [str(s) for s in data["strengths"]]
    data["improvements"] = [str(s) for s in data["improvements"]]

    return data, None


def _parse_and_validate_practice(raw: str) -> tuple[dict | None, str | None]:
    """
    Parse and validate Claude response for practice mode.

    Returns:
        (result_dict, None)   — if valid
        (None, error_message) — if invalid
    """
    if not raw or not raw.strip():
        return None, "response rỗng"

    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None, "không tìm thấy JSON object trong response"

    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as e:
        return None, f"JSON parse error: {e}"

    for key, expected_type in _REQUIRED_FIELDS_PRACTICE.items():
        if key not in data:
            return None, f"thiếu field '{key}'"
        if not isinstance(data[key], expected_type):
            return None, f"field '{key}' sai kiểu: expected {expected_type}, got {type(data[key])}"

    # Validate and snap overall_band
    val = float(data["overall_band"])
    if not (1.0 <= val <= 9.0):
        return None, f"overall_band ngoài phạm vi [1, 9]: {val}"
    data["overall_band"] = _round_band(val)

    # Ensure list items are strings
    data["grammar_issues"]       = [str(s) for s in data["grammar_issues"]]
    data["vocabulary_issues"]    = [str(s) for s in data["vocabulary_issues"]]
    data["pronunciation_issues"] = [str(s) for s in data.get("pronunciation_issues", [])]
    data["strengths"]            = [str(s) for s in data["strengths"]]

    # Validate corrections shape — keep only well-formed items
    valid_corrections = []
    for c in data.get("corrections", []):
        if isinstance(c, dict) and "original" in c and "corrected" in c and "explanation" in c:
            valid_corrections.append({
                "original":    str(c["original"]),
                "corrected":   str(c["corrected"]),
                "explanation": str(c["explanation"]),
            })
    data["corrections"] = valid_corrections

    return data, None


def _round_band(value: float) -> float:
    """Round to nearest 0.5, clamped to [1.0, 9.0]. Used for overall_band."""
    rounded = math.floor(value * 2 + 0.5) / 2
    return max(1.0, min(9.0, rounded))
