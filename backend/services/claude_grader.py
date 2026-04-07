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

{
  "band_fc":   6,
  "band_lr":   6,
  "band_gra":  7,
  "band_p":    6,
  "overall_band": 6.5,
  "fc_feedback":  "Your speech flows naturally with good use of...",
  "lr_feedback":  "Good range of vocabulary. Consider using...",
  "gra_feedback": "Mostly accurate grammar with some errors in...",
  "p_feedback":   "Based on the transcript, pronunciation appears...",
  "strengths":    ["Good use of discourse markers", "Natural topic development"],
  "improvements": ["Incorporate more sophisticated vocabulary", "Vary sentence structures"],
  "improved_response": "Here is an example of a Band 7+ response:\\n[rewritten answer]"
}
"""

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
) -> dict:
    """
    Chấm 1 câu trả lời IELTS Speaking.

    Args:
        question:    Câu hỏi của examiner (e.g. "Do you enjoy outdoor activities?").
        transcript:  Văn bản câu trả lời của thí sinh (từ Whisper STT).
        part:        IELTS part (1, 2, hoặc 3) — ảnh hưởng đến kỳ vọng độ dài.
        band_target: Band mục tiêu của thí sinh — dùng để cá nhân hóa góc độ feedback.

    Returns:
        dict với các trường:
            band_fc, band_lr, band_gra, band_p  (float, 0.5-increment)
            overall_band                         (float, 0.5-increment)
            fc_feedback, lr_feedback, gra_feedback, p_feedback  (str)
            strengths       (list[str])
            improvements    (list[str])
            improved_response (str)

    Raises:
        RuntimeError: Nếu ANTHROPIC_API_KEY chưa cấu hình.
        ValueError:   Nếu Claude trả về JSON không hợp lệ sau 2 lần thử.
        anthropic.APIError: Lỗi API network/auth.
    """
    user_message = _build_user_message(question, transcript, part, band_target)
    client       = _get_client()

    # ── Attempt 1 ─────────────────────────────────────────────────────────────
    raw = await _call_claude(client, user_message)
    result, error = _parse_and_validate(raw)

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

    raw2 = await _call_claude(client, retry_message)
    result2, error2 = _parse_and_validate(raw2)

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


async def _call_claude(client: anthropic.AsyncAnthropic, user_message: str) -> str:
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
                "text":          SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},  # cache system prompt
            }
        ],
        messages=[
            {"role": "user", "content": user_message}
        ],
        temperature=0.2,   # low temp for consistent, deterministic grading
    )

    # Log cache usage when available
    usage = getattr(response, "usage", None)
    if usage:
        cache_read    = getattr(usage, "cache_read_input_tokens",    0) or 0
        cache_created = getattr(usage, "cache_creation_input_tokens", 0) or 0
        logger.debug(
            "Claude usage — input: %s, output: %s, cache_read: %s, cache_created: %s",
            getattr(usage, "input_tokens", "?"),
            getattr(usage, "output_tokens", "?"),
            cache_read,
            cache_created,
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


def _round_band(value: float) -> float:
    """Round to nearest 0.5, clamped to [1.0, 9.0]. Used for overall_band."""
    rounded = math.floor(value * 2 + 0.5) / 2
    return max(1.0, min(9.0, rounded))
