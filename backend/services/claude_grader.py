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

import asyncio
import json
import logging
import math
import re

import anthropic

from config import settings
from services import ai_usage_logger
from services.grammar_content import grammar_service
from services.grading_orchestrator import (
    GRADING_PROVIDER_ORDER,
    GradingOrchestrator,
    build_default as _build_default_orchestrator,
)
from services.grading_providers.errors import (
    AllProvidersFailedError,
    FallbackEvent,
)

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
   - Band 3: speaks with long pauses; limited ability to link simple sentences; frequently unable to convey basic message
   - Band 2: pauses lengthily before most words; little communication possible
   - Band 1: no communication possible; no rateable language

   SPEECH RATE SIGNAL: You will be given duration_seconds and word_count.
   Use these to estimate speaking rate (words per second):
   - < 1.0 w/s: very slow or many long pauses — likely Band 4-5 FC
   - 1.0–1.5 w/s: measured pace, may be careful or hesitant — Band 5-6 FC
   - 1.5–2.5 w/s: natural IELTS pace — consistent with Band 6-8 FC
   - 2.5–3.5 w/s: fluent and confident — consistent with Band 7-9 FC
   - > 3.5 w/s: very fast or possible transcript error — use with caution
   If duration_seconds is unavailable, assess FC from transcript patterns only.

2. LEXICAL RESOURCE (LR)
   Measures: vocabulary range, precision, collocations, idiomatic expressions, paraphrase.
   - Band 9: uses vocabulary with full flexibility; idiomatic language naturally used
   - Band 8: uses wide vocabulary; occasional inaccuracies; effective circumlocution
   - Band 7: uses vocabulary resource flexibly; some inappropriate choices
   - Band 6: adequate vocabulary for familiar topics; attempts less common items
   - Band 5: manages basic communication; limited range; errors cause some strain
   - Band 4: limited resource; basic vocabulary; frequent inappropriate choices
   - Band 3: simple personal vocabulary only; insufficient for less familiar topics
   - Band 2: only isolated words or memorised utterances
   - Band 1: no rateable language

3. GRAMMATICAL RANGE & ACCURACY (GRA)
   Measures: variety of structures, tense accuracy, error frequency, error impact.
   - Band 9: uses full range; only rare slips; consistently accurate
   - Band 8: wide range; minor errors occasionally
   - Band 7: uses a range of complex structures; some errors without loss of communication
   - Band 6: mix of simple and complex; makes errors but meaning is clear
   - Band 5: uses basic sentence forms accurately; limited complex structures
   - Band 4: basic sentence forms only; errors are frequent and cause strain
   - Band 3: attempts basic sentences with limited success or memorised phrases; numerous errors
   - Band 2: cannot produce basic sentence forms
   - Band 1: no rateable language

PRONUNCIATION (P) — NOT SCORED HERE.
   You are working from a TEXT TRANSCRIPT and cannot hear the audio, so you do
   NOT assess pronunciation. The P band is measured separately from the real
   audio by a dedicated speech-analysis service (Azure) and merged in after
   grading. Do NOT output band_p or p_feedback, and do NOT claim to have heard
   the speaker. Score only FLUENCY & COHERENCE, LEXICAL RESOURCE, and
   GRAMMATICAL RANGE & ACCURACY below.

═══════════════════════════════════════════════════
VIETNAMESE-LEARNER GRAMMAR PATTERNS
═══════════════════════════════════════════════════
When transcript evidence allows, surface these high-frequency L1-Vietnamese
grammar issues in gra_feedback (don't invent — only flag when visible in the
transcript or strongly implied by spelling/word choice):

GRAMMAR (visible directly in the transcript):
- Missing third-person -s ("she go", "he have")
- Missing articles ("I went to school" where "the school" required)
- Tense drift (mixing past and present in narratives)
- Plural marker omission ("two book")
- "to be" omission ("I happy", "she beautiful")
- Adjective-after-noun word order ("a movie interesting")

Cite the specific transcript phrase in feedback where possible (e.g.
"trong câu 'he go to work' thiếu -s ở 'goes'"). Do NOT mention these
patterns when no transcript evidence supports them — false positives
damage learner trust.

═══════════════════════════════════════════════════
BAND SCALE
═══════════════════════════════════════════════════
Individual criterion bands (FC, LR, GRA) are WHOLE INTEGERS ONLY: 1 2 3 4 5 6 7 8 9
Do NOT use half-bands for individual criteria (no 5.5, no 6.5, etc.).

Overall band = mean of FC + LR + GRA, rounded to nearest 0.5. (Pronunciation is
measured separately from the audio and folded into the final band afterwards —
you do not include it.) Overall band MAY be a half-band (e.g. 5.5, 6.5).

═══════════════════════════════════════════════════
STRICT CALIBRATION RULES
═══════════════════════════════════════════════════
These rules OVERRIDE your default scoring instincts. Apply them before assigning bands.

SHORT RESPONSE PENALTIES (word count in transcript):
- Part 1 (< 15 words): FC cannot exceed Band 3. Candidate barely responded.
- Part 1 (15–39 words): FC cannot exceed Band 5. Insufficient development.
- Part 2 (< 40 words): FC cannot exceed Band 3. Long-turn task requires sustained speech.
- Part 2 (40–99 words): FC cannot exceed Band 5. Underdeveloped.
- Part 3 (< 20 words): FC cannot exceed Band 4. Discussion requires elaboration.
- Part 3 (20–49 words): FC cannot exceed Band 5. Needs more development.
- For very short responses (Part 1 < 15w, Part 2 < 40w, Part 3 < 20w): LR and GRA also cannot exceed Band 5 — insufficient sample to award higher.

GRAMMAR ERROR WEIGHTING:
- If the same grammar error pattern repeats 2+ times (e.g. repeated wrong tense, missing articles consistently, repeated subject-verb disagreement), reduce GRA by at least 1 band compared to your initial estimate.
- Frequent, repeated errors signal a systemic gap, not a slip.

FLUENCY CALIBRATION:
- Simple, short sentences with no complexity do not earn above Band 5 for FC, regardless of correctness.
- Filler-heavy speech (many "uh", "like", "um", "you know" without substance) should not exceed Band 5 for FC.

LOW-BAND CALIBRATION (Sprint 14.5 — anti-inflation):
LLM defaults tend to be generous; do NOT round up out of politeness. Apply
these floors-of-the-ceiling honestly:
- Transcript ≤ 5 meaningful words OR completely failing to address the
  question: ALL criteria ≤ Band 2. Use Band 1 if there is no rateable
  language at all (silence, single syllables, "I don't know" only).
- Transcript is one or two memorised utterances with no original
  language ("I think it is good. Thank you."): GRA + LR ≤ Band 3.
- Speaker pauses dominate, basic message frequently unconveyed,
  and sentences cannot be linked: FC ≤ Band 3.
- Speaker uses ONLY simple personal vocabulary ("good", "nice", "I like",
  "my family") for the entire response: LR ≤ Band 4 (Band 3 if vocabulary
  is exhausted within the first sentence).
A Band 3 or 4 score is a CORRECT score for low-effort answers — it is
better feedback than a sympathetic Band 5.

FEEDBACK SPECIFICITY (Sprint 14.5):
- Every weakness MUST cite a specific phrase or pattern from the transcript
  (e.g. "trong cụm 'he go to school' thiếu -s ở 'goes'"). Generic
  observations ("vocabulary could be wider") are not allowed.
- fc_feedback, lr_feedback, gra_feedback each ≤ 80 words
  Vietnamese — say one specific thing well, not three things vaguely.

═══════════════════════════════════════════════════
GRADING APPROACH
═══════════════════════════════════════════════════
1. Read the question and the candidate's transcript carefully.
2. Check STRICT CALIBRATION RULES first — apply any mandatory caps before scoring.
3. Identify positive features and weaknesses for EACH criterion.
4. Assign a whole integer band for FC, LR, and GRA independently (integers only: 1–9). Do NOT score pronunciation.
5. Compute overall_band = round((FC + LR + GRA) / 3, nearest 0.5). This may be a half-band.
6. Write specific, actionable feedback (2-4 sentences each criterion).
7. List 2-3 genuine strengths and 2-3 concrete improvements.
8. Write an improved_response that preserves the candidate's key ideas and stance,
   demonstrating Band 7+ grammar, vocabulary, and coherence. Do not invent a completely
   different response — build from what the candidate said. The improved response should
   be natural spoken English, not formal writing.

═══════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY
═══════════════════════════════════════════════════
Respond ONLY with this exact JSON object. No markdown, no explanation, no code fences.

STRICT OUTPUT RULES — violations cause grading failure:
- Your ENTIRE response must be the JSON object: start with `{`, end with `}`, nothing else.
- NEVER wrap output in ``` or ```json fences.
- NEVER add any text before or after the JSON.
- NEVER use literal newline characters inside string values — use the two-character escape \\n instead.
- NEVER add trailing commas after the last item in any object or array.
- Use double quotes only. Never use single quotes.

IMPORTANT LANGUAGE RULES:
- fc_feedback, lr_feedback, gra_feedback: write in VIETNAMESE (tiếng Việt)
- strengths, improvements: write each item in VIETNAMESE (tiếng Việt)
- improved_response: write in ENGLISH only (this is a model answer for the learner to read)

Do NOT include band_p or p_feedback — pronunciation is scored separately from the audio.

{
  "band_fc":   6,
  "band_lr":   6,
  "band_gra":  7,
  "overall_band": 6.5,
  "fc_feedback":  "Bài nói của bạn khá trôi chảy với sự sử dụng tốt các từ nối...",
  "lr_feedback":  "Vốn từ vựng khá đa dạng. Hãy cân nhắc sử dụng thêm...",
  "gra_feedback": "Ngữ pháp phần lớn chính xác với một số lỗi nhỏ trong...",
  "strengths":    ["Sử dụng tốt các từ liên kết", "Phát triển chủ đề tự nhiên"],
  "improvements": ["Sử dụng từ vựng phức tạp hơn", "Đa dạng hóa cấu trúc câu"],
  "improved_response": "Here is an example of a Band 7+ response.\\nSecond sentence here.",
  "rubric_version": "v3"
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
  IMPORTANT — Article/determiner false-positive guard: Before flagging "Thiếu mạo từ"
  or any missing-article/determiner issue, inspect the full noun phrase in the transcript.
  If the noun phrase already contains any determiner — a, an, the, this, that, these,
  those, my, your, his, her, our, their, some, any, each, every, either, neither, or a
  number — do NOT flag a missing article. Only flag if the noun phrase truly has no
  determiner at all.

VOCABULARY ISSUES — Identify up to 4 vocabulary weaknesses.
  Each issue: one phrase (e.g. "Lặp từ 'good' quá nhiều lần",
  "Chưa dùng collocation phù hợp", "Từ 'very' kém ấn tượng — thay bằng từ mạnh hơn").
  IMPORTANT — Lexical consistency guard: Only flag a vocabulary issue when there is a
  clear problem — wrong meaning, clearly awkward collocation, wrong register, or repeated
  overuse of the same word. Do NOT flag a word simply because a fancier synonym exists.
  If the word is natural and appropriate in context, leave it. This prevents contradictory
  corrections across sessions.

PRONUNCIATION ISSUES — Identify up to 3 pronunciation coaching points.
  Focus on common areas Vietnamese learners can improve: word stress, linking sounds,
  sentence rhythm, consonant clarity at word endings, and intonation patterns.
  Write each as a friendly coaching tip in Vietnamese — as a teacher encouraging the learner,
  NOT as a technical diagnosis.
  Each issue: one short Vietnamese phrase (e.g. "Chú ý nối âm tự nhiên giữa các từ để câu nghe mượt hơn",
  "Luyện thêm trọng âm từ — nhấn đúng âm tiết giúp người nghe dễ hiểu hơn",
  "Thử giữ âm cuối /t/ và /d/ rõ ràng hơn — tránh bỏ âm khi nói nhanh").
  If the response is short or simple, give 1 general encouragement about clear pronunciation practice.

CORRECTIONS — Pick the 2–4 most important errors. For each:
  - original:    exact phrase from the transcript (keep short, ≤ 15 words)
  - corrected:   improved version
  - explanation: 1–2 câu giải thích bằng tiếng Việt tại sao cách này tốt hơn

STRENGTHS — 2–3 genuine things the learner did well (tiếng Việt).

SAMPLE ANSWER — Write a complete Band 7 spoken answer to the same question.
  - Natural, conversational, ≈ 60–120 words for Part 1, ≈ 150–200 for Part 2/3.
  - English only. Show, do not tell.
  - IMPORTANT — Content relevance guard: The sample answer must be grounded in the
    candidate's own response. Preserve their key ideas, stance, and topic direction —
    do not invent an entirely different answer. If the candidate expressed a clear opinion
    or gave specific examples, build the sample answer around those same points at Band 7.

OVERALL BAND — Honest estimate of current band level (nearest 0.5, range 1–9).
  Base this on fluency, vocabulary, grammar, and intelligibility holistically.

═══════════════════════════════════════════════════
LOW-BAND CALIBRATION (Sprint 14.5 — anti-inflation)
═══════════════════════════════════════════════════
Coach mode is encouraging but not dishonest. When the transcript is genuinely
weak, the overall_band MUST reflect that — a misleading Band 5 robs the
learner of accurate self-assessment. Apply these honestly:
- ≤ 5 meaningful words OR no real attempt at the question → overall_band 1-2.
- Memorised one-liners only ("I think it is good. Thank you.") → 2-3.
- Long pauses dominate AND basic message often fails → 3.
- Only simple personal vocabulary, no original sentence construction → 3-4.

Pair the honest band with celebratory framing — the band itself stays
calibrated, but `strengths` always finds something genuine to acknowledge
(took a risk, attempted topic, etc.). Calibration and encouragement are
independent — do not soften the number to be kind.

═══════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY
═══════════════════════════════════════════════════
Respond ONLY with this exact JSON object. No markdown, no explanation, no code fences.

STRICT OUTPUT RULES — violations cause grading failure:
- Your ENTIRE response must be the JSON object: start with `{`, end with `}`, nothing else.
- NEVER wrap output in ``` or ```json fences.
- NEVER add any text before or after the JSON.
- NEVER use literal newline characters inside string values — use the two-character escape \\n instead.
- NEVER add trailing commas after the last item in any object or array.
- Use double quotes only. Never use single quotes.

{
  "grammar_issues":       ["Lỗi thứ 1", "Lỗi thứ 2"],
  "vocabulary_issues":    ["Vấn đề từ vựng 1", "Vấn đề từ vựng 2"],
  "pronunciation_issues": ["Vấn đề phát âm 1", "Vấn đề phát âm 2"],
  "corrections": [
    {"original": "phrase from transcript", "corrected": "better version", "explanation": "giải thích bằng tiếng Việt"}
  ],
  "strengths":   ["Điểm mạnh 1", "Điểm mạnh 2"],
  "sample_answer": "A complete Band 7 spoken answer here.\\nSecond sentence here.",
  "overall_band": 5.5,
  "rubric_version": "v3"
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

# Required keys and their expected Python types for validation.
# Audit 2026-07-02 — band_p / p_feedback are NO LONGER produced by the grader:
# pronunciation is measured from the real audio by Azure and merged in by
# routers/grading.py. The grader scores FC / LR / GRA only.
_REQUIRED_FIELDS: dict[str, type] = {
    "band_fc":           (int, float),
    "band_lr":           (int, float),
    "band_gra":          (int, float),
    "overall_band":      (int, float),
    "fc_feedback":       str,
    "lr_feedback":       str,
    "gra_feedback":      str,
    "strengths":         list,
    "improvements":      list,
    "improved_response": str,
}

_CRITERION_FIELDS = ("band_fc", "band_lr", "band_gra")   # must be integers (P is audio-measured)
_OVERALL_FIELDS   = ("overall_band",)                     # 0.5 increments OK

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


# Sprint 14.3 — lazy orchestrator singleton. Providers are heavy (each
# carries an SDK client with an API key); building once per process
# matches the legacy _client pattern above. Tests can override via
# `set_orchestrator` below.
_orchestrator: GradingOrchestrator | None = None


def _get_orchestrator() -> GradingOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = _build_default_orchestrator(settings)
    return _orchestrator


def set_orchestrator(orchestrator: GradingOrchestrator | None) -> None:
    """Test hook — inject a fake orchestrator. Pass None to reset."""
    global _orchestrator
    _orchestrator = orchestrator


# ── Public function ────────────────────────────────────────────────────────────

async def grade_response(
    question:         str,
    transcript:       str,
    part:             int,
    band_target:      float = 6.5,
    mode:             str   = "test",
    user_id:          str | None = None,
    session_id:       str | None = None,
    reliability:      dict | None = None,
    duration_seconds: float | None = None,
    word_count:       int | None = None,
    fallback_events:  list[FallbackEvent] | None = None,
    length_context:   str | None = None,
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
        Test mode dict (band_p / p_feedback are NOT produced here — pronunciation
        is measured from the audio by Azure and merged in by routers/grading.py):
            band_fc, band_lr, band_gra, overall_band,
            fc_feedback, lr_feedback, gra_feedback,
            strengths, improvements, improved_response

    Raises:
        RuntimeError: Nếu ANTHROPIC_API_KEY chưa cấu hình.
        ValueError:   Nếu Claude trả về JSON không hợp lệ sau 2 lần thử.
        anthropic.APIError: Lỗi API network/auth.
    """
    is_practice = (mode == "practice")
    system_prompt = SYSTEM_PROMPT_PRACTICE if is_practice else SYSTEM_PROMPT
    validator     = _parse_and_validate_practice if is_practice else _parse_and_validate

    user_message = _build_user_message(
        question, transcript, part, band_target, reliability,
        duration_seconds=duration_seconds,
        word_count=word_count,
        length_context=length_context,
    )
    # Sprint 14.3 — `client` kept for the OPTIONAL sample/improved-answer
    # regeneration in post-processing (Claude Haiku). The grading LLM call
    # itself goes through the orchestrator (SPEAKING_GRADING_MODEL). Audit
    # 2026-07-02: make this lazy/optional so a Gemini-only deployment (no
    # ANTHROPIC_API_KEY) can still grade — _get_client() would otherwise raise
    # here before the orchestrator is ever reached. When None, regeneration is
    # skipped and a drifting sample is dropped with a status (graceful).
    try:
        client = _get_client()
    except RuntimeError as exc:
        logger.info(
            "Anthropic client unavailable (%s) — sample regeneration disabled; "
            "grading routes to SPEAKING_GRADING_MODEL via the orchestrator", exc,
        )
        client = None
    orchestrator = _get_orchestrator()

    # ── Attempt 1 ─────────────────────────────────────────────────────────────
    raw = await _invoke_orchestrator(
        orchestrator, system_prompt, user_message,
        user_id=user_id, session_id=session_id,
        sink=fallback_events,
    )
    result, error = validator(raw)

    if result is not None:
        logger.info("Claude grader: thành công lần 1 — overall_band=%.1f", result["overall_band"])
        if is_practice:
            await _post_process_practice_result(result, transcript, question, client)
            _attach_grammar_recommendations(result)
        else:
            await _post_process_test_result(result, transcript, question, client)
        return result

    # ── Attempt 2 (retry with explicit correction nudge) ──────────────────────
    logger.warning("Claude grader: lần 1 thất bại (%s) — thử lại", error)

    retry_message = (
        user_message
        + "\n\n---\n"
        + f"IMPORTANT: Your previous response failed JSON validation ({error}). "  # noqa: E501
        + "Start your response with `{` and end with `}` — nothing before, nothing after. "
        + "Do NOT wrap in ``` or ```json fences. "
        + "Do NOT use literal newlines inside string values; write \\n instead. "
        + "Output the raw JSON object only."
    )

    raw2 = await _invoke_orchestrator(
        orchestrator, system_prompt, retry_message,
        user_id=user_id, session_id=session_id,
        sink=fallback_events,
    )
    result2, error2 = validator(raw2)

    if result2 is not None:
        logger.info("Claude grader: thành công lần 2 — overall_band=%.1f", result2["overall_band"])
        if is_practice:
            await _post_process_practice_result(result2, transcript, question, client)
            _attach_grammar_recommendations(result2)
        else:
            await _post_process_test_result(result2, transcript, question, client)
        return result2

    # Log a safe preview (first 300 chars, newlines escaped) — no PII in the snippet
    preview = (raw2 or "")[:300].replace("\n", "\\n")
    raise ValueError(
        f"Claude grader: không thể parse JSON sau 2 lần thử. "
        f"Lỗi lần 2: {error2}. "
        f"Response preview: {preview!r}"
    )


# ── Internal helpers ───────────────────────────────────────────────────────────

def _build_user_message(
    question: str,
    transcript: str,
    part: int,
    band_target: float,
    reliability: dict | None = None,
    duration_seconds: float | None = None,
    word_count: int | None = None,
    length_context: str | None = None,
) -> str:
    part_context = {
        1: "Part 1 (Introduction & Interview — short personal answers, ~1–2 min total)",
        2: "Part 2 (Long Turn — 1–2 min monologue on a cue card topic)",
        3: "Part 3 (Discussion — abstract, analytical answers, ~4–5 min total)",
    }.get(part, f"Part {part}")

    msg = (
        f"IELTS Speaking {part_context}\n"
        f"Candidate's target band: {band_target}\n\n"
    )

    # ── Speaking metrics (FC signal) ─────────────────────────────────────────────
    if duration_seconds is not None and word_count is not None and duration_seconds > 0:
        wps = round(word_count / duration_seconds, 2)
        msg += (
            f"SPEAKING METRICS:\n"
            f"  Duration:   {duration_seconds:.1f}s\n"
            f"  Words:      {word_count}\n"
            f"  Rate:       {wps} words/sec\n\n"
        )
    elif duration_seconds is not None:
        msg += f"SPEAKING METRICS:\n  Duration: {duration_seconds:.1f}s\n\n"

    msg += (
        f"EXAMINER QUESTION:\n{question.strip()}\n\n"
        f"CANDIDATE TRANSCRIPT:\n{transcript.strip()}"
    )

    # ── Transcript reliability signal ────────────────────────────────────────────
    if reliability:
        label   = reliability.get("reliability_label", "high")
        score   = reliability.get("reliability_score", 1.0)
        reasons = reliability.get("reasons", [])

        if label == "low":
            msg += (
                f"\n\n⚠ TRANSCRIPT RELIABILITY: LOW (score: {score:.2f})\n"
                "Reasons: " + ("; ".join(reasons) if reasons else "unknown") + "\n"
                "IMPORTANT: The STT transcript is likely unreliable — the audio may have been "
                "noisy, cut off, or spoken too quietly. "
                "Assign lower band scores for GRA and LR, and state explicitly in gra_feedback "
                "and lr_feedback that the assessment is limited by transcription quality. "
                "Do NOT invent grammar errors that may be STT artefacts."
            )
        elif label == "medium":
            msg += (
                f"\n\n⚠ TRANSCRIPT RELIABILITY: MEDIUM (score: {score:.2f})\n"
                "Note: Some transcript segments have reduced confidence. "
                "Exercise caution with GRA and LR — acknowledge minor uncertainty in feedback "
                "where relevant, but do not dramatically downgrade scores."
            )
        # High reliability: no note needed — don't pollute the prompt

    # ── Sprint 14.7 — Length context (L8) ────────────────────────────────────
    # Soft-warning context is informational: the grader notes the
    # limitation in feedback if relevant, but must NOT cap bands solely
    # on duration (Sprint 14.5 anti-inflation discipline still applies
    # to the *transcript*; duration is one signal among many).
    if length_context:
        msg += f"\n\nAUDIO LENGTH CONTEXT:\n{length_context}"

    return msg


# ── JSON extraction helpers ────────────────────────────────────────────────────

def _extract_json_object(text: str) -> str | None:
    """
    Robustly extract the outermost JSON object from arbitrary Claude output.

    Handles:
    - Code fences anywhere (```json ... ```, ``` ... ```)
    - Leading/trailing prose ("Here is the result:\n{...}")
    - Nested objects and arrays
    Uses brace-counting rather than greedy regex to avoid false matches.
    """
    if not text:
        return None

    # Strip ALL code-fence markers before scanning
    cleaned = re.sub(r"```(?:json|JSON)?\s*", "", text)
    cleaned = re.sub(r"```", "", cleaned).strip()

    start = cleaned.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    i = start
    while i < len(cleaned):
        ch = cleaned[i]
        if in_string:
            if ch == "\\":
                i += 2          # skip the escaped character
                continue
            if ch == '"':
                in_string = False
        else:
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return cleaned[start : i + 1]
        i += 1

    return None     # no balanced { } block found


def _fix_json_strings(text: str) -> str:
    """
    Replace unescaped control characters (newlines, carriage returns, tabs)
    *inside JSON string values* with their JSON escape sequences.

    Recovers from Claude emitting literal newlines inside string values —
    which is invalid JSON but a common LLM failure mode.
    """
    result: list[str] = []
    in_string = False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == "\\":
                result.append(ch)
                i += 1
                if i < len(text):
                    result.append(text[i])
            elif ch == '"':
                in_string = False
                result.append(ch)
            elif ch == "\n":
                result.append("\\n")
            elif ch == "\r":
                result.append("\\r")
            elif ch == "\t":
                result.append("\\t")
            else:
                result.append(ch)
        else:
            if ch == '"':
                in_string = True
            result.append(ch)
        i += 1
    return "".join(result)


def _parse_json_response(raw: str) -> tuple[dict | None, str | None]:
    """
    Multi-strategy JSON parser for LLM output.

    Strategies applied in order until one succeeds:
      1. Extract JSON object → direct json.loads
      2. Extract JSON object → fix unescaped control chars → json.loads
      3. Extract JSON object → remove trailing commas → json.loads
      4. Extract JSON object → both fixes → json.loads

    Returns (parsed_dict, None) on success, (None, error_str) on failure.
    The error_str includes a safe response preview (no PII — just the first 200 chars).
    """
    json_str = _extract_json_object(raw)
    if json_str is None:
        preview = (raw or "")[:200].replace("\n", "\\n")
        return None, f"no JSON object found. Preview: {preview!r}"

    # Strategy 1 — direct parse
    try:
        return json.loads(json_str), None
    except json.JSONDecodeError as e:
        first_err = str(e)

    # Strategy 2 — fix unescaped control characters inside strings
    try:
        return json.loads(_fix_json_strings(json_str)), None
    except json.JSONDecodeError:
        pass

    # Strategy 3 — remove trailing commas before } or ]
    no_trailing = re.sub(r",(\s*[}\]])", r"\1", json_str)
    try:
        return json.loads(no_trailing), None
    except json.JSONDecodeError:
        pass

    # Strategy 4 — both fixes combined
    try:
        both_fixed = re.sub(r",(\s*[}\]])", r"\1", _fix_json_strings(json_str))
        return json.loads(both_fixed), None
    except json.JSONDecodeError:
        pass

    preview = json_str[:200].replace("\n", "\\n")
    return None, (
        f"JSON parse failed after 4 strategies. "
        f"First error: {first_err}. "
        f"Snippet: {preview!r}"
    )


async def _invoke_orchestrator(
    orchestrator: GradingOrchestrator,
    system_prompt: str,
    user_message: str,
    *,
    user_id: str | None,
    session_id: str | None,
    sink: list[FallbackEvent] | None,
) -> str:
    """Sprint 14.3 — replaces direct `_call_claude` calls.

    Drives the full Haiku → Gemini → Sonnet fallback chain and appends
    every attempt (success or failure) to ``sink`` so the caller can
    persist telemetry. Raises :class:`AllProvidersFailedError` when the
    entire chain is exhausted — the grading-endpoint catches that and
    falls back to the existing "AI tạm thời không khả dụng" stub UX (L8).
    """
    try:
        raw, events = await orchestrator.invoke(
            system_prompt,
            user_message,
            user_id=user_id,
            session_id=session_id,
            order=GRADING_PROVIDER_ORDER,
        )
    except AllProvidersFailedError as exc:
        if sink is not None:
            sink.extend(exc.events)
        raise
    if sink is not None:
        sink.extend(events)
    return raw


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

    Sprint 14.3 — RETAINED for backward compatibility (admin regrade
    plus a handful of post-processing helpers still call it directly).
    The main `grade_response` path now goes through the orchestrator
    via `_invoke_orchestrator`.
    """
    response = await client.beta.prompt_caching.messages.create(
        model=_MODEL,
        max_tokens=2048,   # 1024 was too low for test mode: 4× Vietnamese feedbacks + improved_response (150-250w) routinely truncated the JSON
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
    Parse và validate Claude response cho test mode.

    Returns:
        (result_dict, None)   — nếu hợp lệ
        (None, error_message) — nếu không hợp lệ
    """
    if not raw or not raw.strip():
        return None, "response rỗng"

    data, err = _parse_json_response(raw)
    if data is None:
        return None, err

    # ── Field presence & type check ────────────────────────────────────────────
    for key, expected_type in _REQUIRED_FIELDS.items():
        if key not in data:
            return None, f"thiếu field '{key}'"
        if not isinstance(data[key], expected_type):
            return None, f"field '{key}' sai kiểu: expected {expected_type}, got {type(data[key])}"

    # ── Criterion bands: must be whole integers 1–9 (auto-repair halves) ──────
    for key in _CRITERION_FIELDS:
        val = float(data[key])
        if not (1.0 <= val <= 9.0):
            return None, f"band '{key}' ngoài phạm vi [1, 9]: {val}"
        snapped = float(round(val))
        if snapped != val:
            logger.debug("criterion band '%s' snapped %.1f → %.0f", key, val, snapped)
        data[key] = snapped

    # ── Overall band: snap to nearest 0.5 ─────────────────────────────────────
    for key in _OVERALL_FIELDS:
        val = float(data[key])
        if not (1.0 <= val <= 9.0):
            return None, f"band '{key}' ngoài phạm vi [1, 9]: {val}"
        snapped = _round_band(val)
        if snapped != val:
            logger.debug("overall_band snapped %.2f → %.1f", val, snapped)
        data[key] = snapped

    # ── Cross-check overall_band against criterion mean ────────────────────────
    # FC/LR/GRA only — pronunciation is measured from audio (Azure) and folded
    # into the final band later by routers/grading.py.
    computed = _round_band(
        (data["band_fc"] + data["band_lr"] + data["band_gra"]) / 3
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

    # Sprint 14.5 — rubric_version. Optional + additive. Default "v1"
    # so old graded rows (pre-14.5) and any provider that silently drops
    # the field keep validating. The prompt asks for "v2"; we normalise
    # whatever the model returned without rejecting.
    rv = data.get("rubric_version")
    data["rubric_version"] = str(rv) if isinstance(rv, str) and rv else "v1"

    return data, None


def _parse_and_validate_practice(raw: str) -> tuple[dict | None, str | None]:
    """
    Parse và validate Claude response cho practice mode.

    Returns:
        (result_dict, None)   — if valid
        (None, error_message) — if invalid
    """
    if not raw or not raw.strip():
        return None, "response rỗng"

    data, err = _parse_json_response(raw)
    if data is None:
        return None, err

    for key, expected_type in _REQUIRED_FIELDS_PRACTICE.items():
        if key not in data:
            return None, f"thiếu field '{key}'"
        if not isinstance(data[key], expected_type):
            return None, f"field '{key}' sai kiểu: expected {expected_type}, got {type(data[key])}"

    val = float(data["overall_band"])
    if not (1.0 <= val <= 9.0):
        return None, f"overall_band ngoài phạm vi [1, 9]: {val}"
    data["overall_band"] = _round_band(val)

    data["grammar_issues"]       = [str(s) for s in data["grammar_issues"]]
    data["vocabulary_issues"]    = [str(s) for s in data["vocabulary_issues"]]
    data["pronunciation_issues"] = [str(s) for s in data.get("pronunciation_issues", [])]
    data["strengths"]            = [str(s) for s in data["strengths"]]

    valid_corrections = []
    for c in data.get("corrections", []):
        if isinstance(c, dict) and "original" in c and "corrected" in c and "explanation" in c:
            valid_corrections.append({
                "original":    str(c["original"]),
                "corrected":   str(c["corrected"]),
                "explanation": str(c["explanation"]),
            })
    data["corrections"] = valid_corrections

    # Sprint 14.5 — rubric_version (additive, optional, default "v1").
    rv = data.get("rubric_version")
    data["rubric_version"] = str(rv) if isinstance(rv, str) and rv else "v1"

    return data, None


def _round_band(value: float) -> float:
    """Round to nearest 0.5, clamped to [1.0, 9.0]. Used for overall_band."""
    rounded = math.floor(value * 2 + 0.5) / 2
    return max(1.0, min(9.0, rounded))


# ── Code-level feedback post-processing guards ────────────────────────────────

_DETERMINERS = frozenset({
    "a", "an", "the", "this", "that", "these", "those",
    "my", "your", "his", "her", "our", "their", "its",
    "some", "any", "each", "every", "either", "neither",
    "no", "both", "all", "half",
    # Quantifiers that also cover noun phrases
    "many", "several", "most", "another", "other", "much",
    "few", "little", "more", "less", "enough",
})

_ARTICLE_ISSUE_KEYWORDS = (
    "mạo từ", "thiếu the", "thiếu a ", "thiếu an ",
    "missing article", "missing determiner",
)

_STOPWORDS = frozenset({
    "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she",
    "her", "it", "its", "they", "them", "their", "what", "which", "who",
    "this", "that", "these", "those", "am", "is", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "shall", "should", "may", "might", "must", "can", "could",
    "a", "an", "the", "and", "but", "if", "or", "because", "as", "until",
    "while", "of", "at", "by", "for", "with", "about", "to", "from", "in",
    "on", "so", "than", "too", "very", "just", "also", "not", "no", "more",
    "then", "when", "where", "how", "all", "both", "each", "up", "out",
    "only", "over", "after", "before", "off", "into", "other",
})

# Cue-card instruction verbs that are NOT part of the topic — they inflate the
# question-overlap denominator without being content a relevant sample echoes
# (PR #591 review). The bulk of cue-card scaffolding ("You should say:" +
# bullets) is dropped by taking the first line; these are the leftover verbs.
_CUE_CARD_FILLERS = frozenset({
    "describe", "explain", "talk", "tell", "say", "give", "mention",
})

_RELEVANCE_THRESHOLD = 0.15

# Indicators that a correction is a genuine error (not just style preference).
# Also covers substitution language that implies a real usage rule.
_CORRECTION_KEEP_INDICATORS = frozenset({
    # Explicit error markers
    "sai", "lỗi", "thiếu", "thừa", "incorrect", "wrong", "missing", "error",
    "awkward", "unnatural", "inappropriate",
    # Vietnamese substitution/usage-rule language (e.g. "Dùng well thay vì good")
    "thay vì", "nên dùng", "không phù hợp", "cách dùng", "khi bổ nghĩa",
    "đứng sau", "đứng trước", "theo sau", "trước danh từ", "sau động từ",
})

# Markers that a vocabulary issue is a genuine weakness (not a synonym suggestion).
_VOCAB_GENUINE_FLAGS = (
    "lặp", "lặp lại", "sai", "lỗi", "thiếu", "kém ấn tượng",
    "không phù hợp", "chưa dùng", "chưa sử dụng",
    "quá nhiều lần", "quá đơn giản", "overuse", "repetiti", "wrong",
)
# Pure synonym-preference framing — drop these vocabulary issues.
_VOCAB_STYLE_ONLY_FLAGS = (
    "có thể dùng", "alternatively", "thay thế được", "also possible",
)


def _content_words(text: str) -> set[str]:
    """Return lowercase alpha content words, excluding stopwords."""
    words = re.findall(r"[a-z]+", text.lower())
    return {w for w in words if w not in _STOPWORDS and len(w) > 2}


def _question_topic_words(question: str) -> set[str]:
    """Content words of the cue-card TOPIC only. A Part 2 question_text can carry
    the full Cambridge-format prompt ('You should say:' + bullets, newline-
    joined) — the topic is the first line. Instruction fillers are dropped too,
    so a long cue card's scaffolding doesn't shrink the empty-transcript
    relevance fallback below threshold for an on-topic sample (PR #591 review)."""
    topic_line = question.split("\n", 1)[0]
    return _content_words(topic_line) - _CUE_CARD_FILLERS


def _validate_sample_relevance(transcript: str, sample: str, question: str = "") -> float:
    """How grounded the sample answer is in the candidate's response AND/OR the
    question topic — the MAX of the two content-word overlap ratios.

    Mục 19 (B3): when the transcript has NO content words (e.g. the user barely
    spoke / Whisper returned only stopwords), transcript-overlap is undefined;
    QUESTION overlap catches an off-topic sample while keeping an on-topic one.

    Finding #6 (audit 2026-07-02): the old code used transcript overlap ALONE
    whenever the transcript had content words, ignoring the question. That
    false-dropped good samples that legitimately paraphrase the candidate's
    ideas with different words (low transcript overlap) but are clearly on-topic
    for the question. Taking the MAX of transcript- and question-topic overlap
    keeps a sample that is grounded in EITHER — strictly reducing false drops
    while still catching a sample that drifts from BOTH (low on both → below
    threshold → regenerated). Bag-of-words is still crude, but max-of-two is
    materially more robust than transcript-only at the same threshold."""
    sample_words = _content_words(sample)
    trans_words  = _content_words(transcript)
    q_words      = _question_topic_words(question)

    scores: list[float] = []
    if trans_words:
        scores.append(len(trans_words & sample_words) / len(trans_words))
    if q_words:
        scores.append(len(q_words & sample_words) / len(q_words))
    if not scores:
        return 1.0   # nothing to measure against → no evidence of drift, keep sample
    return max(scores)


def _filter_false_article_flags(grammar_issues: list[str], transcript: str) -> list[str]:
    """
    Remove article/determiner issues where the flagged noun already has a
    determiner in the transcript, indicating a false positive from Claude.

    Handles:
    - Single-word quoted nouns ('book', "car")
    - Multi-word quoted phrases ('my old house', "the main reason")
    - Possessive noun phrases ('John's', "the teacher's")
    """
    transcript_lower = transcript.lower()
    det_pattern_str = r"\b(?:" + "|".join(re.escape(d) for d in _DETERMINERS) + r")\b"
    # Per-type alternations so apostrophes inside possessives don't close spans early.
    # Straight single-quote branch allows internal ' only when followed by s+word-boundary
    # (covers John's) while still closing on ' followed by space/end (students' → "students").
    _QUOTE_RE = re.compile(
        r'"([^"]{1,60})"'                           # straight double quotes
        r"|\u201c([^\u201d]{1,60})\u201d"           # curly double quotes " "
        r"|\u2018([^\u2019]{1,60})\u2019"           # curly single quotes ' '
        r"|'((?:[^']|'(?=s\b)){1,60})'"             # straight single quotes; 's allowed inside
    )
    _PREPS_PAT = r"(?:of|with|in|for|on|at|from|by|to|about|into|over|near|nearby)"
    filtered = []
    for issue in grammar_issues:
        issue_lower = issue.lower()
        if not any(kw in issue_lower for kw in _ARTICLE_ISSUE_KEYWORDS):
            filtered.append(issue)
            continue

        quoted_phrases = [
            next(g for g in m.groups() if g is not None).strip().lower()
            for m in _QUOTE_RE.finditer(issue)
        ]
        if not quoted_phrases:
            # Mục 7 (B3): an article/determiner flag with NO quoted noun phrase
            # can't be validated against the transcript, so we can't tell a real
            # issue from a Claude false positive — and it's also un-actionable for
            # the user (no specific phrase to fix). Since false article flags erode
            # trust (the project's top feedback-quality concern), drop the
            # unvalidatable flag rather than surface it unchecked. Well-formed
            # article corrections quote the phrase, so this targets vague flags
            # like "Thiếu mạo từ" with no quoted noun.
            logger.debug(
                "article false-positive guard: dropped unquoted article issue '%s'",
                issue[:80],
            )
            continue

        phrase = quoted_phrases[-1]  # use last quoted phrase as the target

        words = phrase.split()

        # Case 1: phrase contains a possessive (e.g. "John's car", "students' opinions",
        # "teacher's").  Matches both 's and bare ' (plural possessives).
        poss_m = re.search(r"(\w+)'s?(?:\s|$)", phrase)
        if poss_m:
            poss_root = poss_m.group(1)
            if re.search(r"\b" + re.escape(poss_root) + r"'", transcript_lower):
                logger.debug(
                    "article false-positive guard: dropped '%s' (possessive '%s' in transcript)",
                    issue[:80], phrase,
                )
                continue
            filtered.append(issue)
            continue

        # Case 2: phrase already starts with a determiner — already covered
        head_noun = words[-1] if words else phrase
        head_noun = re.sub(r"[^\w]", "", head_noun)

        if words and words[0] in _DETERMINERS:
            logger.debug(
                "article false-positive guard: dropped '%s' (phrase '%s' already has determiner)",
                issue[:80], phrase,
            )
            continue

        # Case 3: head noun directly preceded by a determiner (≤2 adjectives between).
        # Preposition-boundary lookahead prevents cross-phrase false suppression:
        # "a city with museum" — "with" blocks suppression of the museum flag.
        pattern = (
            det_pattern_str
            + r"\s+(?:(?!" + _PREPS_PAT + r"\b)\w+\s+){0,2}\b"
            + re.escape(head_noun) + r"\b"
        )
        if re.search(pattern, transcript_lower):
            logger.debug(
                "article false-positive guard: dropped '%s' (noun '%s' already covered)",
                issue[:80], head_noun,
            )
            continue

        filtered.append(issue)
    return filtered


def _filter_style_corrections(corrections: list[dict]) -> list[dict]:
    """
    Drop corrections that appear to be synonym-preference suggestions rather
    than genuine errors (no error-indicator words in explanation, short original).
    """
    filtered = []
    for c in corrections:
        explanation = c.get("explanation", "").lower()
        original = c.get("original", "").strip()
        if any(kw in explanation for kw in _CORRECTION_KEEP_INDICATORS):
            filtered.append(c)
            continue
        if len(original.split()) >= 2:
            filtered.append(c)
            continue
        logger.debug(
            "style-correction guard: dropped '%s' → '%s' (no error indicators)",
            original, c.get("corrected", ""),
        )
    return filtered


def _filter_style_vocab_issues(vocab_issues: list[str]) -> list[str]:
    """
    Drop vocabulary suggestions that are pure synonym preferences rather than
    genuine weaknesses (overuse, wrong word, inappropriately informal, etc.).
    """
    filtered = []
    for issue in vocab_issues:
        issue_lower = issue.lower()
        if any(flag in issue_lower for flag in _VOCAB_STYLE_ONLY_FLAGS):
            logger.debug("vocab style-only guard: dropped '%s...'", issue[:60])
            continue
        filtered.append(issue)
    return filtered


_REGEN_TIMEOUT_SECONDS = 20.0   # Mục 18 (B4): bound the regen so it can't hang grading


async def _regen_grounded_answer(
    client: "anthropic.AsyncAnthropic",
    transcript: str,
    question: str,
) -> str | None:
    """
    Regenerate a sample answer that stays grounded in the candidate's own response.
    Called when the initial sample_answer or improved_response drifts too far from
    the transcript (overlap ratio below _RELEVANCE_THRESHOLD).

    ``client`` is None on a Gemini-only deployment (no ANTHROPIC_API_KEY) — in
    that case regeneration is skipped and the caller drops the drifting sample
    with a status, exactly as it does on any regen failure.
    """
    if client is None:
        return None
    prompt = (
        f"Question: {question}\n\n"
        f"Candidate's response: {transcript}\n\n"
        "Write a short improved version of the candidate's answer that stays closely "
        "connected to what they actually said — correcting grammar and vocabulary while "
        "keeping the same topic, examples, and ideas. "
        "Output only the improved answer text, no preamble."
    )
    try:
        # Mục 18 (B4): bound the regen so a hung Haiku call can't block the whole
        # grading response. asyncio.TimeoutError is caught below → returns None →
        # the caller drops the sample gracefully.
        msg = await asyncio.wait_for(
            client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                temperature=0.2,
                messages=[{"role": "user", "content": prompt}],
            ),
            timeout=_REGEN_TIMEOUT_SECONDS,
        )
        text = msg.content[0].text.strip() if msg.content else ""
        return text or None
    except Exception as exc:  # noqa: BLE001
        logger.warning("_regen_grounded_answer failed: %s", exc)
        return None


async def _post_process_practice_result(
    result: dict,
    transcript: str,
    question: str,
    client: "anthropic.AsyncAnthropic",
) -> None:
    """
    Apply code-level feedback quality guards to a practice result in-place.

    1. Article false-positive guard
    2. Style correction filter
    3. Vocabulary style-only filter
    4. Sample relevance check — regenerate grounded answer if sample drifts
    """
    if result.get("grammar_issues"):
        result["grammar_issues"] = _filter_false_article_flags(
            result["grammar_issues"], transcript
        )

    if result.get("corrections"):
        result["corrections"] = _filter_style_corrections(result["corrections"])

    if result.get("vocabulary_issues"):
        result["vocabulary_issues"] = _filter_style_vocab_issues(result["vocabulary_issues"])

    sample = result.get("sample_answer") or ""
    if sample and transcript:
        overlap = _validate_sample_relevance(transcript, sample, question)
        if overlap < _RELEVANCE_THRESHOLD:
            logger.warning(
                "sample_answer relevance low (%.2f < %.2f) — regenerating grounded answer",
                overlap, _RELEVANCE_THRESHOLD,
            )
            new_sample = await _regen_grounded_answer(client, transcript, question)
            if new_sample:
                new_overlap = _validate_sample_relevance(transcript, new_sample, question)
                if new_overlap >= _RELEVANCE_THRESHOLD:
                    result["sample_answer"] = new_sample
                else:
                    # Mục 21 (B3 follow-up): don't drop the sample silently — flag
                    # WHY, so the frontend can explain instead of just showing nothing.
                    logger.warning(
                        "regen sample_answer still low (%.2f) — removing", new_overlap
                    )
                    result.pop("sample_answer", None)
                    result["sample_answer_status"] = "removed_low_relevance"
            else:
                result.pop("sample_answer", None)
                result["sample_answer_status"] = "removed_low_relevance"


async def _post_process_test_result(
    result: dict,
    transcript: str,
    question: str,
    client: "anthropic.AsyncAnthropic",
) -> None:
    """Apply code-level guards to a test-mode grading result in-place."""
    improved = result.get("improved_response") or ""
    if improved and transcript:
        overlap = _validate_sample_relevance(transcript, improved, question)
        if overlap < _RELEVANCE_THRESHOLD:
            logger.warning(
                "improved_response relevance low (%.2f < %.2f) — regenerating",
                overlap, _RELEVANCE_THRESHOLD,
            )
            new_improved = await _regen_grounded_answer(client, transcript, question)
            if new_improved:
                new_overlap = _validate_sample_relevance(transcript, new_improved, question)
                if new_overlap >= _RELEVANCE_THRESHOLD:
                    result["improved_response"] = new_improved
                else:
                    # Mục 21 (B3 follow-up): flag WHY the improved answer was dropped.
                    logger.warning(
                        "regen improved_response still low (%.2f) — removing", new_overlap
                    )
                    result.pop("improved_response", None)
                    result["improved_response_status"] = "removed_low_relevance"
            else:
                result.pop("improved_response", None)
                result["improved_response_status"] = "removed_low_relevance"


def _attach_grammar_recommendations(result: dict) -> None:
    """
    Mutate a practice-mode grading result in-place:
    For each grammar_issue, find the best-matching wiki article and attach
    a `grammar_recommendations` list to the dict.

    Each item: { issue, slug, category, title, score }
    Items with no match (score <= 0.3) are excluded.
    Article-family articles are capped at 1 across all slugs (title-based detection).
    """
    issues: list[str] = result.get("grammar_issues") or []
    recs: list[dict] = []
    seen_slugs: set[str] = set()
    _ARTICLE_FAMILY_SLUGS = frozenset({
        "articles", "article-errors", "articles-a-an-the",
        "definite-article", "indefinite-article",
        "articles-a-an-sound-rules",
    })
    article_family_count = 0
    for issue in issues:
        match = grammar_service.find_best_match(issue)
        if not match:
            continue
        slug = match["slug"]
        article = grammar_service.get_article_by_slug(slug) or {}
        if article.get("status") == "draft":
            logger.info(
                "grammar_recommendations_skipped event=grammar_recommendations_skipped "
                "reason=draft_article slug=%s issue=%r",
                slug, issue[:160],
                extra={
                    "event": "grammar_recommendations_skipped",
                    "reason": "draft_article",
                    "slug": slug,
                    "issue": issue[:160],
                },
            )
            continue
        if slug in seen_slugs:
            continue
        title_lower = match["title"].lower()
        is_article_family = (
            slug in _ARTICLE_FAMILY_SLUGS
            or "article" in title_lower
            or "determiner" in title_lower
        )
        if is_article_family:
            if article_family_count >= 1:
                continue
            article_family_count += 1
        seen_slugs.add(slug)
        # Sprint 4 Phase 4: enrich with anchor for deep-link routing.
        # Returns None if no mapping resolves above the 0.35 threshold —
        # frontend then falls back to the article-level URL it was
        # rendering before.
        anchor = grammar_service.find_best_anchor(issue, slug)
        recs.append({
            "issue":    issue,
            "slug":     slug,
            "category": match["category"],
            "title":    match["title"],
            "score":    match["score"],
            "anchor":   anchor,
        })
    # Sprint 6.5 diagnostic: log final shape so we can correlate with
    # Railway-side persistence (recommended_anchor=NULL on every prod row).
    with_anchor_count = sum(1 for r in recs if r.get("anchor"))
    with_slug_count   = sum(1 for r in recs if r.get("slug"))
    logger.info(
        "grammar_recommendations_built event=grammar_recommendations_built "
        "count=%d with_anchor=%d with_slug=%d",
        len(recs), with_anchor_count, with_slug_count,
        extra={
            "event":             "grammar_recommendations_built",
            "count":             len(recs),
            "with_anchor_count": with_anchor_count,
            "with_slug_count":   with_slug_count,
            "sample_first":      recs[0] if recs else None,
        },
    )
    result["grammar_recommendations"] = recs
