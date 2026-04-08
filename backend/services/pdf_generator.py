"""
services/pdf_generator.py — PDF report via ReportLab (pure Python, zero system deps)

Usage:
    from services.pdf_generator import generate_session_pdf
    pdf_bytes = await generate_session_pdf(session_id)

Requires: reportlab==4.4.10  (already in requirements.txt)
"""

import json
import logging
import os
from datetime import datetime, timezone
from io import BytesIO
from xml.sax.saxutils import escape as _esc

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from database import supabase_admin

logger = logging.getLogger(__name__)


def _round_half(val: float) -> float:
    """Round to the nearest 0.5 — IELTS display convention (mirrors frontend roundHalf)."""
    return round(val * 2) / 2

# ── Unicode font registration (required for Vietnamese text) ───────────────────
# Helvetica (built-in PDF) has no Vietnamese glyphs.  We try to register a
# system TTF font that covers the full Latin Extended / Vietnamese range.
# Priority: DejaVu (common on Ubuntu/Railway) → Liberation → Arial Unicode (macOS).
# Falls back to Helvetica only when no suitable font is found.

_VI_FONT   = "Helvetica"        # regular — overwritten below if a TTF is found
_VI_FONT_B = "Helvetica-Bold"   # bold    — overwritten below


def _init_unicode_font() -> None:
    global _VI_FONT, _VI_FONT_B
    candidates = [
        # Ubuntu / Debian (Railway) — guaranteed after: apt install fonts-dejavu-core
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        # Some Ubuntu setups put them here
        ("/usr/share/fonts/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
        # Liberation Sans (alternative on Ubuntu)
        ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
         "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
        # macOS — Arial Unicode ships with Office / macOS
        ("/Library/Fonts/Arial Unicode.ttf", None),
    ]
    for reg_path, bold_path in candidates:
        if not os.path.exists(reg_path):
            continue
        try:
            pdfmetrics.registerFont(TTFont("VI", reg_path))
            _VI_FONT = "VI"
            if bold_path and os.path.exists(bold_path):
                pdfmetrics.registerFont(TTFont("VI-Bold", bold_path))
                _VI_FONT_B = "VI-Bold"
            else:
                _VI_FONT_B = "VI"   # use regular for bold too — acceptable fallback
            logger.info("[pdf] unicode font registered: %s", reg_path)
            return
        except Exception as exc:
            logger.warning("[pdf] could not register %s: %s", reg_path, exc)
    logger.warning(
        "[pdf] no unicode font found — Vietnamese text will not render correctly. "
        "On Railway add 'fonts-dejavu-core' to apt packages (see nixpacks.toml)."
    )


_init_unicode_font()   # sets _VI_FONT / _VI_FONT_B before _T is built below

# ── Page geometry ──────────────────────────────────────────────────────────────
_MARGIN = 2 * cm
_COL_W  = A4[0] - 2 * _MARGIN          # ≈ 481.9 pt available width

# ── Colour palette ─────────────────────────────────────────────────────────────
_C = {
    "teal":     colors.HexColor("#0d9488"),
    "navy":     colors.HexColor("#0f172a"),
    "slate":    colors.HexColor("#334155"),
    "muted":    colors.HexColor("#64748b"),
    "v_muted":  colors.HexColor("#94a3b8"),
    "bg_teal":  colors.HexColor("#f0fdfa"),
    "bg_blue":  colors.HexColor("#eff6ff"),
    "blue_dk":  colors.HexColor("#1e3a5f"),
    "blue":     colors.HexColor("#3b82f6"),
    "border":   colors.HexColor("#e2e8f0"),
    "row_alt":  colors.HexColor("#f8fafc"),
}

# ── Criterion config ───────────────────────────────────────────────────────────
_CRITERIA = [
    ("band_fc",  "fc_feedback",  "Fluency & Coherence",          "FC"),
    ("band_lr",  "lr_feedback",  "Lexical Resource",             "LR"),
    ("band_gra", "gra_feedback", "Grammatical Range & Accuracy", "GRA"),
    ("band_p",   "p_feedback",   "Pronunciation",                "P"),
]

# ── Text styles ────────────────────────────────────────────────────────────────
def _ps(name, **kw) -> ParagraphStyle:
    return ParagraphStyle(name, **kw)

_T = {
    # Purely ASCII labels — Helvetica is fine and guaranteed available
    "logo":    _ps("logo",    fontName="Helvetica-Bold",    fontSize=17, textColor=_C["teal"],    leading=21),
    "sub":     _ps("sub",     fontName="Helvetica",         fontSize=9,  textColor=_C["muted"],   leading=12, spaceBefore=2),
    "bnd_lbl": _ps("bnd_lbl", fontName="Helvetica",         fontSize=8,  textColor=_C["muted"],   alignment=TA_RIGHT, leading=11),
    "bnd_big": _ps("bnd_big", fontName="Helvetica-Bold",    fontSize=44, textColor=_C["teal"],    alignment=TA_RIGHT, leading=52),
    "bnd_na":  _ps("bnd_na",  fontName="Helvetica-Bold",    fontSize=32, textColor=_C["v_muted"], alignment=TA_RIGHT, leading=40),
    "sec":     _ps("sec",     fontName="Helvetica-Bold",    fontSize=12, textColor=_C["navy"],    leading=15),
    "cr_abbr": _ps("cr_abbr", fontName="Helvetica-Bold",    fontSize=10, textColor=_C["navy"],    leading=13),
    "cr_full": _ps("cr_full", fontName="Helvetica",         fontSize=8,  textColor=_C["muted"],   leading=10),
    "cr_bnd":  _ps("cr_bnd",  fontName="Helvetica-Bold",    fontSize=16, textColor=_C["teal"],    alignment=TA_CENTER, leading=20),
    "cr_na":   _ps("cr_na",   fontName="Helvetica",         fontSize=13, textColor=_C["v_muted"], alignment=TA_CENTER, leading=17),
    "q_num":   _ps("q_num",   fontName="Helvetica-Bold",    fontSize=8,  textColor=_C["teal"],    leading=11, spaceBefore=2),
    "q_bnd":   _ps("q_bnd",   fontName="Helvetica-Bold",    fontSize=9,  textColor=_C["teal"],    leading=12, spaceAfter=5),
    "lbl":     _ps("lbl",     fontName="Helvetica-Bold",    fontSize=8,  textColor=_C["muted"],   leading=11, spaceAfter=2),
    "no_rsp":  _ps("no_rsp",  fontName="Helvetica-Oblique", fontSize=9,  textColor=_C["v_muted"], leading=13),
    "ft_gen":  _ps("ft_gen",  fontName="Helvetica",         fontSize=8,  textColor=_C["v_muted"], alignment=TA_CENTER, leading=11),
    "ft_hd":   _ps("ft_hd",   fontName="Helvetica-Bold",    fontSize=10, textColor=_C["navy"],    leading=14, spaceAfter=4),
    # Content that may contain Vietnamese — use Unicode-capable font (_VI_FONT)
    "meta":    _ps("meta",    fontName=_VI_FONT,   fontSize=9,  textColor=_C["slate"],   leading=15),
    "cr_fb":   _ps("cr_fb",   fontName=_VI_FONT,   fontSize=9,  textColor=_C["slate"],   leading=13),
    "q_txt":   _ps("q_txt",   fontName=_VI_FONT_B, fontSize=11, textColor=_C["navy"],    leading=15, spaceAfter=5),
    "trans":   _ps("trans",   fontName=_VI_FONT,   fontSize=10, textColor=_C["slate"],   leading=15),
    "impr":    _ps("impr",    fontName=_VI_FONT,   fontSize=10, textColor=_C["blue_dk"], leading=15),
    "ft_li":   _ps("ft_li",   fontName=_VI_FONT,   fontSize=9,  textColor=_C["slate"],   leading=13, leftIndent=8),
}


# ── Public entry point ─────────────────────────────────────────────────────────

async def generate_session_pdf(session_id: str, db=None) -> bytes:
    """
    Build a full PDF report for a completed (or in-progress) session.

    Args:
        session_id: UUID of the session.
        db: unused — project uses supabase_admin directly throughout.

    Returns:
        Raw PDF bytes ready to stream.

    Raises:
        ValueError: if session_id does not exist.
        RuntimeError: if ReportLab fails to render.
    """
    # ── 1. Load session ────────────────────────────────────────────────────────
    s_res = (
        supabase_admin.table("sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    if not s_res.data:
        raise ValueError(f"Session '{session_id}' không tồn tại")
    session = s_res.data[0]

    # ── 2. Load user display name ──────────────────────────────────────────────
    user_display = "—"
    try:
        u_res = (
            supabase_admin.table("users")
            .select("display_name, email")
            .eq("id", session["user_id"])
            .limit(1)
            .execute()
        )
        if u_res.data:
            u = u_res.data[0]
            user_display = u.get("display_name") or u.get("email") or "—"
    except Exception as exc:
        logger.warning("[pdf] could not load user: %s", exc)

    # ── 3. Load questions (ordered) ────────────────────────────────────────────
    q_res = (
        supabase_admin.table("questions")
        .select("*")
        .eq("session_id", session_id)
        .order("order_num")
        .execute()
    )
    questions = q_res.data or []

    # ── 4. Load responses (keyed by question_id) ───────────────────────────────
    r_res = (
        supabase_admin.table("responses")
        .select("*")
        .eq("session_id", session_id)
        .execute()
    )
    responses_by_qid: dict = {}
    all_strengths:    list = []
    all_improvements: list = []

    for r in (r_res.data or []):
        responses_by_qid[r["question_id"]] = r
        fb = _parse_feedback(r.get("feedback"))
        if fb:
            all_strengths.extend(fb.get("strengths") or [])
            all_improvements.extend(fb.get("improvements") or [])

    # ── 5. Resolve per-criterion bands and feedback text ───────────────────────
    band_vals: dict = {
        "band_fc":  session.get("band_fc"),
        "band_lr":  session.get("band_lr"),
        "band_gra": session.get("band_gra"),
        "band_p":   session.get("band_p"),
    }
    fb_texts: dict = {
        "fc_feedback":  session.get("fc_feedback"),
        "lr_feedback":  session.get("lr_feedback"),
        "gra_feedback": session.get("gra_feedback"),
        "p_feedback":   session.get("p_feedback"),
    }

    if not all(band_vals.values()):
        parsed = [_parse_feedback(r.get("feedback")) for r in (r_res.data or [])]
        parsed = [f for f in parsed if f]
        if parsed:
            for key in band_vals:
                if band_vals[key] is None:
                    vals = [f[key] for f in parsed if f.get(key) is not None]
                    band_vals[key] = round(sum(vals) / len(vals), 1) if vals else None

    if not all(fb_texts.values()):
        for r in reversed(r_res.data or []):
            fb = _parse_feedback(r.get("feedback"))
            if fb:
                for key in fb_texts:
                    if not fb_texts[key]:
                        fb_texts[key] = fb.get(key, "")
                break

    # ── 6. Assemble render inputs ──────────────────────────────────────────────
    overall_band = session.get("overall_band")
    part_label   = {1: "Part 1", 2: "Part 2", 3: "Part 3"}.get(session.get("part"), "—")
    date_str     = _fmt_date(session.get("started_at") or session.get("completed_at"))
    gen_date     = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    top_strengths    = list(dict.fromkeys(s for s in all_strengths    if s))[:3]
    top_improvements = list(dict.fromkeys(s for s in all_improvements if s))[:3]

    # ── 7. Render PDF ──────────────────────────────────────────────────────────
    try:
        pdf_bytes = _render_pdf(
            user_display  = user_display,
            date_str      = date_str,
            topic         = session.get("topic", "—"),
            part_label    = part_label,
            overall_band  = overall_band,
            band_vals     = band_vals,
            fb_texts      = fb_texts,
            questions     = questions,
            responses_by_qid = responses_by_qid,
            strengths     = top_strengths,
            improvements  = top_improvements,
            gen_date      = gen_date,
        )
    except Exception as exc:
        logger.error("[pdf] ReportLab render failed: %s", exc)
        raise RuntimeError(f"PDF render failed: {exc}") from exc

    logger.info("[pdf] rendered %d bytes for session=%s", len(pdf_bytes), session_id)
    return pdf_bytes


# ── Top-level renderer ─────────────────────────────────────────────────────────

def _render_pdf(
    user_display: str,
    date_str: str,
    topic: str,
    part_label: str,
    overall_band,
    band_vals: dict,
    fb_texts: dict,
    questions: list,
    responses_by_qid: dict,
    strengths: list,
    improvements: list,
    gen_date: str,
) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=_MARGIN,
        leftMargin=_MARGIN,
        topMargin=1.8 * cm,
        bottomMargin=2 * cm,
    )

    story: list = []

    # ── Header (logo + meta left | band score right) ───────────────────────────
    meta_xml = (
        f"<b>Candidate:</b> {_esc(user_display)}<br/>"
        f"<b>Date:</b> {_esc(date_str)}    <b>Part:</b> {_esc(part_label)}<br/>"
        f"<b>Topic:</b> {_esc(topic)}"
    )
    left_col = [
        Paragraph("IELTS Speaking Coach", _T["logo"]),
        Paragraph("Performance Report",   _T["sub"]),
        Spacer(1, 8),
        Paragraph(meta_xml, _T["meta"]),
    ]

    if overall_band is not None:
        right_col = [
            Paragraph("Overall Band",              _T["bnd_lbl"]),
            Paragraph(f"{_round_half(overall_band):.1f}", _T["bnd_big"]),
        ]
    else:
        right_col = [
            Paragraph("Overall Band", _T["bnd_lbl"]),
            Paragraph("—",            _T["bnd_na"]),
        ]

    hdr = Table(
        [[left_col, right_col]],
        colWidths=[_COL_W * 0.72, _COL_W * 0.28],
    )
    hdr.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
        ("LINEBELOW",     (0, 0), (-1, -1), 3, _C["teal"]),
    ]))
    story.append(hdr)
    story.append(Spacer(1, 18))

    # ── Score Overview ─────────────────────────────────────────────────────────
    story.append(_section_title("Score Overview"))
    story.append(Spacer(1, 8))
    story.append(_build_criteria_table(band_vals, fb_texts))
    story.append(Spacer(1, 22))

    # ── Question Details ───────────────────────────────────────────────────────
    story.append(_section_title("Question Details"))
    story.append(Spacer(1, 10))
    for block in _build_question_blocks(questions, responses_by_qid):
        story.append(block)
        story.append(Spacer(1, 10))

    # ── Footer ─────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 14))
    story.append(HRFlowable(width=_COL_W, thickness=1, color=_C["border"]))
    story.append(Spacer(1, 10))
    story.append(Paragraph(f"Generated by IELTS Speaking Coach · {gen_date}", _T["ft_gen"]))
    story.append(Spacer(1, 12))

    str_items  = [Paragraph(f"- {_esc(s)}", _T["ft_li"]) for s in strengths]    or [Paragraph("—", _T["ft_li"])]
    impr_items = [Paragraph(f"- {_esc(s)}", _T["ft_li"]) for s in improvements] or [Paragraph("—", _T["ft_li"])]

    ft = Table(
        [[
            [Paragraph("Strengths",      _T["ft_hd"])] + str_items,
            [Paragraph("Areas to Improve", _T["ft_hd"])] + impr_items,
        ]],
        colWidths=[_COL_W * 0.495, _COL_W * 0.495],
        hAlign="LEFT",
    )
    ft.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("LINEBEFORE",   (1, 0), (1, -1), 1, _C["border"]),
        ("LEFTPADDING",  (1, 0), (1, -1), 14),
    ]))
    story.append(ft)

    doc.build(story)
    return buf.getvalue()


# ── Section heading with teal left bar ────────────────────────────────────────

def _section_title(text: str) -> Table:
    t = Table([[Paragraph(text, _T["sec"])]], colWidths=[_COL_W])
    t.setStyle(TableStyle([
        ("LINEBEFORE",    (0, 0), (0, -1), 4, _C["teal"]),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
    ]))
    return t


# ── Criteria table ─────────────────────────────────────────────────────────────

def _build_criteria_table(band_vals: dict, fb_texts: dict) -> Table:
    W_NAME = 155
    W_BAND = 58
    W_FB   = _COL_W - W_NAME - W_BAND

    rows = []
    for band_key, fb_key, full_name, abbrev in _CRITERIA:
        band = band_vals.get(band_key)
        fb   = fb_texts.get(fb_key) or ""

        name_cell = [
            Paragraph(abbrev,    _T["cr_abbr"]),
            Paragraph(full_name, _T["cr_full"]),
        ]
        band_cell = (
            Paragraph(f"{_round_half(band):.1f}", _T["cr_bnd"])
            if band is not None
            else Paragraph("—", _T["cr_na"])
        )
        rows.append([name_cell, band_cell, Paragraph(_esc(fb), _T["cr_fb"])])

    t = Table(rows, colWidths=[W_NAME, W_BAND, W_FB])
    t.setStyle(TableStyle([
        ("GRID",          (0, 0), (-1, -1), 0.5, _C["border"]),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
        ("ALIGN",         (1, 0), (1, -1), "CENTER"),
        ("BACKGROUND",    (0, 1), (-1, 1), _C["row_alt"]),
        ("BACKGROUND",    (0, 3), (-1, 3), _C["row_alt"]),
    ]))
    return t


# ── Per-question blocks ────────────────────────────────────────────────────────

def _build_question_blocks(questions: list, responses_by_qid: dict) -> list:
    if not questions:
        return [Paragraph("No questions recorded.", _T["no_rsp"])]

    INNER_W = _COL_W - 28      # 14 pt padding each side inside the box

    blocks = []
    for i, q in enumerate(questions, start=1):
        qid        = q.get("id")
        q_text     = q.get("question_text") or "—"
        response   = responses_by_qid.get(qid)
        transcript = ""
        fb         = None
        q_band     = None

        if response:
            transcript = response.get("transcript") or ""
            q_band     = response.get("overall_band")
            fb         = _parse_feedback(response.get("feedback"))

        # Detect practice vs test mode from the feedback schema
        is_practice_fb = fb is not None and "grammar_issues" in fb

        inner: list = []
        inner.append(Paragraph(f"QUESTION {i}", _T["q_num"]))
        inner.append(Paragraph(_esc(q_text), _T["q_txt"]))

        if q_band is not None:
            inner.append(Paragraph(f"Band {_round_half(q_band):.1f}", _T["q_bnd"]))

        # Transcript block
        if transcript:
            inner.append(Paragraph("TRANSCRIPT", _T["lbl"]))
            trans_t = Table(
                [[Paragraph(_esc(transcript), _T["trans"])]],
                colWidths=[INNER_W],
            )
            trans_t.setStyle(TableStyle([
                ("LINEBEFORE",    (0, 0), (0, -1), 3, _C["teal"]),
                ("BACKGROUND",    (0, 0), (-1, -1), _C["row_alt"]),
                ("LEFTPADDING",   (0, 0), (-1, -1), 12),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
                ("TOPPADDING",    (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]))
            inner.append(trans_t)
            inner.append(Spacer(1, 8))
        else:
            inner.append(Paragraph("No recording submitted yet.", _T["no_rsp"]))

        # ── Practice mode: coaching-focused feedback sections ──────────────────
        if is_practice_fb and fb:
            # Strengths
            strengths = fb.get("strengths") or []
            if strengths:
                inner.append(Paragraph("STRENGTHS", _T["lbl"]))
                for s in strengths:
                    inner.append(Paragraph(f"• {_esc(s)}", _T["ft_li"]))
                inner.append(Spacer(1, 6))

            # Grammar Issues
            grammar = fb.get("grammar_issues") or []
            if grammar:
                inner.append(Paragraph("GRAMMAR ISSUES", _T["lbl"]))
                for g in grammar:
                    inner.append(Paragraph(f"• {_esc(g)}", _T["ft_li"]))
                inner.append(Spacer(1, 6))

            # Vocabulary Issues
            vocab = fb.get("vocabulary_issues") or []
            if vocab:
                inner.append(Paragraph("VOCABULARY ISSUES", _T["lbl"]))
                for v in vocab:
                    inner.append(Paragraph(f"• {_esc(v)}", _T["ft_li"]))
                inner.append(Spacer(1, 6))

            # Pronunciation Issues
            pronun = fb.get("pronunciation_issues") or []
            if pronun:
                inner.append(Paragraph("PRONUNCIATION", _T["lbl"]))
                for p in pronun:
                    inner.append(Paragraph(f"• {_esc(p)}", _T["ft_li"]))
                inner.append(Spacer(1, 6))

            # Corrections
            corrections = fb.get("corrections") or []
            if corrections:
                inner.append(Paragraph("CORRECTIONS", _T["lbl"]))
                for c in corrections:
                    orig  = _esc(c.get("original", ""))
                    fixed = _esc(c.get("corrected", ""))
                    expl  = _esc(c.get("explanation", ""))
                    corr_xml = (
                        f"<font color='#c0392b'>✗ {orig}</font>"
                        f"  →  "
                        f"<font color='#27ae60'>✓ {fixed}</font><br/>"
                        f"<i>{expl}</i>"
                    )
                    corr_t = Table(
                        [[Paragraph(corr_xml, _T["cr_fb"])]],
                        colWidths=[INNER_W],
                    )
                    corr_t.setStyle(TableStyle([
                        ("BACKGROUND",    (0, 0), (-1, -1), _C["bg_teal"]),
                        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
                        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
                        ("TOPPADDING",    (0, 0), (-1, -1), 6),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ]))
                    inner.append(corr_t)
                    inner.append(Spacer(1, 4))
                inner.append(Spacer(1, 2))

            # Sample Answer
            sample = fb.get("sample_answer") or ""
            if sample:
                inner.append(Paragraph("SAMPLE ANSWER", _T["lbl"]))
                sample_t = Table(
                    [[Paragraph(_esc(sample), _T["impr"])]],
                    colWidths=[INNER_W],
                )
                sample_t.setStyle(TableStyle([
                    ("LINEBEFORE",    (0, 0), (0, -1), 3, _C["blue"]),
                    ("BACKGROUND",    (0, 0), (-1, -1), _C["bg_blue"]),
                    ("LEFTPADDING",   (0, 0), (-1, -1), 12),
                    ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
                    ("TOPPADDING",    (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]))
                inner.append(sample_t)

        # ── Test mode: IELTS 4-criteria feedback ───────────────────────────────
        elif fb and not is_practice_fb:
            # Criterion feedback texts
            for band_key, fb_key, full_name, abbrev in _CRITERIA:
                fb_text = fb.get(fb_key) or ""
                if fb_text:
                    inner.append(Paragraph(f"{abbrev} — {full_name}", _T["lbl"]))
                    inner.append(Paragraph(_esc(fb_text), _T["cr_fb"]))
                    inner.append(Spacer(1, 6))

            # Strengths
            strengths = fb.get("strengths") or []
            if strengths:
                inner.append(Paragraph("STRENGTHS", _T["lbl"]))
                for s in strengths:
                    inner.append(Paragraph(f"• {_esc(s)}", _T["ft_li"]))
                inner.append(Spacer(1, 6))

            # Improvements
            improvements = fb.get("improvements") or []
            if improvements:
                inner.append(Paragraph("AREAS TO IMPROVE", _T["lbl"]))
                for imp in improvements:
                    inner.append(Paragraph(f"• {_esc(imp)}", _T["ft_li"]))
                inner.append(Spacer(1, 6))

            # Band 7+ model answer
            improved = fb.get("improved_response") or ""
            if improved:
                inner.append(Paragraph("BAND 7+ MODEL ANSWER", _T["lbl"]))
                impr_t = Table(
                    [[Paragraph(_esc(improved), _T["impr"])]],
                    colWidths=[INNER_W],
                )
                impr_t.setStyle(TableStyle([
                    ("LINEBEFORE",    (0, 0), (0, -1), 3, _C["blue"]),
                    ("BACKGROUND",    (0, 0), (-1, -1), _C["bg_blue"]),
                    ("LEFTPADDING",   (0, 0), (-1, -1), 12),
                    ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
                    ("TOPPADDING",    (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]))
                inner.append(impr_t)

        # Bordered box wrapping all inner content
        box = Table([[inner]], colWidths=[_COL_W])
        box.setStyle(TableStyle([
            ("BOX",           (0, 0), (-1, -1), 1, _C["border"]),
            ("LEFTPADDING",   (0, 0), (-1, -1), 14),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
            ("TOPPADDING",    (0, 0), (-1, -1), 12),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ]))

        # KeepTogether prevents page-break inside short blocks;
        # long blocks (big transcripts) will naturally flow across pages.
        blocks.append(KeepTogether([box]))

    return blocks


# ── Utilities ──────────────────────────────────────────────────────────────────

def _parse_feedback(raw) -> dict | None:
    """Parse the `feedback` column which may be a JSON string or already a dict."""
    if not raw:
        return None
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def _fmt_date(dt_str: str | None) -> str:
    """Format an ISO timestamp string to 'D Mon YYYY', e.g. '6 Apr 2026'."""
    if not dt_str:
        return "—"
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return dt.strftime("%d %b %Y").lstrip("0")
    except ValueError:
        return dt_str[:10]
