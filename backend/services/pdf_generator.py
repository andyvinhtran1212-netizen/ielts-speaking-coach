"""
services/pdf_generator.py — PDF report generation via WeasyPrint

Usage:
    from services.pdf_generator import generate_session_pdf
    pdf_bytes = await generate_session_pdf(session_id)

Requires: weasyprint==62.3  (already in requirements.txt)
"""

import json
import logging
from datetime import datetime, timezone
from html import escape

from weasyprint import HTML as WeasyHTML

from database import supabase_admin

logger = logging.getLogger(__name__)

# Criterion display labels (abbrev → full name)
_CRITERIA = [
    ("band_fc",  "fc_feedback",  "Fluency & Coherence",         "FC"),
    ("band_lr",  "lr_feedback",  "Lexical Resource",            "LR"),
    ("band_gra", "gra_feedback", "Grammatical Range & Accuracy", "GRA"),
    ("band_p",   "p_feedback",   "Pronunciation",               "P"),
]


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
        RuntimeError: if WeasyPrint fails to render.
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
    #   Priority: session columns → averaged from individual response feedback
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

    # If any band is missing, compute average from responses
    if not all(band_vals.values()):
        parsed = [_parse_feedback(r.get("feedback")) for r in (r_res.data or [])]
        parsed = [f for f in parsed if f]
        if parsed:
            for key in band_vals:
                if band_vals[key] is None:
                    vals = [f[key] for f in parsed if f.get(key) is not None]
                    band_vals[key] = round(sum(vals) / len(vals), 1) if vals else None

    # If any feedback text is missing, take from the last graded response
    if not all(fb_texts.values()):
        for r in reversed(r_res.data or []):
            fb = _parse_feedback(r.get("feedback"))
            if fb:
                for key in fb_texts:
                    if not fb_texts[key]:
                        fb_texts[key] = fb.get(key, "")
                break

    # ── 6. Render HTML → PDF ───────────────────────────────────────────────────
    overall_band = session.get("overall_band")
    part_label   = {1: "Part 1", 2: "Part 2", 3: "Part 3"}.get(session.get("part"), "—")
    date_str     = _fmt_date(session.get("started_at") or session.get("completed_at"))
    gen_date     = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    top_strengths    = list(dict.fromkeys(s for s in all_strengths    if s))[:3]
    top_improvements = list(dict.fromkeys(s for s in all_improvements if s))[:3]

    criteria_html  = _build_criteria_table(band_vals, fb_texts)
    questions_html = _build_question_sections(questions, responses_by_qid)

    html = _render_html(
        user_display     = user_display,
        date_str         = date_str,
        topic            = session.get("topic", "—"),
        part_label       = part_label,
        overall_band     = overall_band,
        criteria_html    = criteria_html,
        questions_html   = questions_html,
        strengths        = top_strengths,
        improvements     = top_improvements,
        generated_date   = gen_date,
    )

    try:
        pdf_bytes: bytes = WeasyHTML(string=html).write_pdf()
    except Exception as exc:
        logger.error("[pdf] WeasyPrint render failed: %s", exc)
        raise RuntimeError(f"PDF render failed: {exc}") from exc

    logger.info("[pdf] rendered %d bytes for session=%s", len(pdf_bytes), session_id)
    return pdf_bytes


# ── HTML builders ──────────────────────────────────────────────────────────────

def _build_criteria_table(band_vals: dict, fb_texts: dict) -> str:
    rows = []
    for band_key, fb_key, full_name, abbrev in _CRITERIA:
        band = band_vals.get(band_key)
        fb   = fb_texts.get(fb_key) or ""
        band_cell = (
            f'<span class="criterion-band">{band:.0f}</span>'
            if band is not None
            else '<span class="criterion-band-na">—</span>'
        )
        rows.append(
            f'<tr>'
            f'<td class="crit-name"><strong>{abbrev}</strong><br>'
            f'<span class="crit-fullname">{full_name}</span></td>'
            f'<td class="crit-band">{band_cell}</td>'
            f'<td class="crit-fb">{escape(fb)}</td>'
            f'</tr>'
        )
    return (
        '<table class="criteria-table">'
        '<thead><tr>'
        '<th style="width:180px;">Criterion</th>'
        '<th style="width:60px;text-align:center;">Band</th>'
        '<th>Feedback</th>'
        '</tr></thead>'
        '<tbody>' + "".join(rows) + '</tbody>'
        '</table>'
    )


def _build_question_sections(questions: list, responses_by_qid: dict) -> str:
    if not questions:
        return '<p style="color:#94a3b8;font-style:italic;">No questions recorded.</p>'

    blocks = []
    for i, q in enumerate(questions, start=1):
        qid        = q.get("id")
        q_text     = q.get("question_text") or "—"
        response   = responses_by_qid.get(qid)
        transcript = ""
        band_html  = ""
        improved   = ""

        if response:
            transcript = response.get("transcript") or ""
            overall    = response.get("overall_band")
            fb         = _parse_feedback(response.get("feedback"))

            if overall is not None:
                band_html = f'<div class="q-band">Band {overall:.1f}</div>'

            if fb:
                improved = fb.get("improved_response") or ""

        transcript_block = (
            f'<div class="transcript-label">Transcript</div>'
            f'<div class="transcript">{escape(transcript)}</div>'
            if transcript
            else '<div class="no-response">No recording submitted yet.</div>'
        )

        improved_block = (
            f'<div class="improved-label">Band 7+ Model Answer</div>'
            f'<div class="improved">{escape(improved)}</div>'
            if improved
            else ""
        )

        blocks.append(
            f'<div class="q-block">'
            f'<div class="q-number">Question {i}</div>'
            f'<div class="q-text">{escape(q_text)}</div>'
            f'{band_html}'
            f'{transcript_block}'
            f'{improved_block}'
            f'</div>'
        )

    return "\n".join(blocks)


# ── Full HTML template ─────────────────────────────────────────────────────────

def _render_html(
    user_display: str,
    date_str: str,
    topic: str,
    part_label: str,
    overall_band,
    criteria_html: str,
    questions_html: str,
    strengths: list,
    improvements: list,
    generated_date: str,
) -> str:
    overall_text = f"{overall_band:.1f}" if overall_band is not None else "—"
    band_class   = "band-score" if overall_band is not None else "band-score-na"

    strengths_li    = "".join(f"<li>{escape(s)}</li>" for s in strengths)    or "<li>—</li>"
    improvements_li = "".join(f"<li>{escape(s)}</li>" for s in improvements) or "<li>—</li>"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>

@page {{
  size: A4;
  margin: 1.8cm 2cm 2cm 2cm;
}}

* {{ box-sizing: border-box; margin: 0; padding: 0; }}

body {{
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 10.5pt;
  color: #1e293b;
  line-height: 1.55;
  background: #ffffff;
}}

/* ── Header ─────────────────────────────────────────────────────── */
.header {{
  display: table;
  width: 100%;
  border-bottom: 3px solid #0d9488;
  padding-bottom: 18px;
  margin-bottom: 24px;
}}
.header-left  {{ display: table-cell; vertical-align: top; }}
.header-right {{ display: table-cell; vertical-align: top; text-align: right; white-space: nowrap; }}

.logo        {{ font-size: 17pt; font-weight: 700; color: #0d9488; letter-spacing: -0.2px; }}
.logo-sub    {{ font-size: 8.5pt; color: #64748b; margin-top: 2px; }}
.meta        {{ margin-top: 12px; font-size: 9.5pt; color: #475569; }}
.meta-row    {{ margin-bottom: 3px; }}
.meta-label  {{ font-weight: 700; color: #0f172a; }}

.band-label  {{ font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; }}
.band-score  {{ font-size: 48pt; font-weight: 700; color: #0d9488; line-height: 1; }}
.band-score-na {{ font-size: 36pt; font-weight: 700; color: #94a3b8; line-height: 1; }}

/* ── Section titles ──────────────────────────────────────────────── */
.section-title {{
  font-size: 12pt;
  font-weight: 700;
  color: #0f172a;
  border-left: 4px solid #0d9488;
  padding-left: 9px;
  margin-top: 26px;
  margin-bottom: 12px;
}}

/* ── Criteria table ──────────────────────────────────────────────── */
.criteria-table {{
  width: 100%;
  border-collapse: collapse;
}}
.criteria-table thead th {{
  background: #f0fdfa;
  color: #0d9488;
  font-size: 9.5pt;
  font-weight: 700;
  padding: 7px 10px;
  text-align: left;
  border: 1px solid #ccfbf1;
}}
.criteria-table tbody td {{
  padding: 9px 10px;
  border: 1px solid #e2e8f0;
  vertical-align: top;
  font-size: 10pt;
}}
.criteria-table tbody tr:nth-child(even) td {{
  background: #f8fafc;
}}
.crit-name     {{ width: 170px; }}
.crit-fullname {{ font-size: 8.5pt; color: #64748b; font-weight: normal; }}
.crit-band     {{ width: 56px; text-align: center; }}
.criterion-band    {{ font-size: 16pt; font-weight: 700; color: #0d9488; }}
.criterion-band-na {{ font-size: 14pt; font-weight: 400; color: #94a3b8; }}

/* ── Question blocks ─────────────────────────────────────────────── */
.q-block {{
  margin-bottom: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 14px 16px;
  page-break-inside: avoid;
}}
.q-number  {{ font-size: 8.5pt; font-weight: 700; color: #0d9488; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }}
.q-text    {{ font-size: 11.5pt; font-weight: 700; color: #0f172a; margin-bottom: 10px; }}
.q-band    {{
  display: inline-block;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  color: #0d9488;
  font-size: 9.5pt;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 20px;
  margin-bottom: 10px;
}}
.transcript-label {{ font-size: 8.5pt; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }}
.transcript {{
  font-style: italic;
  color: #334155;
  border-left: 3px solid #0d9488;
  padding: 7px 12px;
  background: #f8fafc;
  font-size: 10pt;
  line-height: 1.6;
  margin-bottom: 12px;
}}
.improved-label {{ font-size: 8.5pt; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }}
.improved {{
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-left: 3px solid #3b82f6;
  padding: 7px 12px;
  font-size: 10pt;
  color: #1e3a5f;
  line-height: 1.6;
}}
.no-response {{ color: #94a3b8; font-style: italic; font-size: 9.5pt; }}

/* ── Footer ──────────────────────────────────────────────────────── */
.footer {{
  margin-top: 32px;
  padding-top: 14px;
  border-top: 1px solid #e2e8f0;
}}
.footer-generated {{ font-size: 8.5pt; color: #94a3b8; text-align: center; margin-bottom: 14px; }}
.footer-cols {{ display: table; width: 100%; }}
.footer-col  {{ display: table-cell; width: 50%; vertical-align: top; padding-right: 16px; }}
.footer-col:last-child {{ padding-right: 0; padding-left: 12px; border-left: 1px solid #e2e8f0; }}
.footer-col-title {{ font-size: 10pt; font-weight: 700; color: #0f172a; margin-bottom: 6px; }}
.footer-col ul {{ padding-left: 15px; font-size: 9.5pt; color: #334155; }}
.footer-col li {{ margin-bottom: 4px; line-height: 1.4; }}

</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="header-left">
    <div class="logo">IELTS Speaking Coach</div>
    <div class="logo-sub">Performance Report</div>
    <div class="meta">
      <div class="meta-row"><span class="meta-label">Candidate: </span>{escape(user_display)}</div>
      <div class="meta-row"><span class="meta-label">Date: </span>{date_str}&nbsp;&nbsp;&nbsp;<span class="meta-label">Part: </span>{part_label}</div>
      <div class="meta-row"><span class="meta-label">Topic: </span>{escape(topic)}</div>
    </div>
  </div>
  <div class="header-right">
    <div class="band-label">Overall Band</div>
    <div class="{band_class}">{overall_text}</div>
  </div>
</div>

<!-- SCORE OVERVIEW -->
<div class="section-title">Score Overview</div>
{criteria_html}

<!-- QUESTION DETAILS -->
<div class="section-title">Question Details</div>
{questions_html}

<!-- FOOTER -->
<div class="footer">
  <div class="footer-generated">Generated by IELTS Speaking Coach &middot; {generated_date}</div>
  <div class="footer-cols">
    <div class="footer-col">
      <div class="footer-col-title">&#10003; Strengths</div>
      <ul>{strengths_li}</ul>
    </div>
    <div class="footer-col">
      <div class="footer-col-title">&#8593; Focus on</div>
      <ul>{improvements_li}</ul>
    </div>
  </div>
</div>

</body>
</html>"""


# ── Small utilities ────────────────────────────────────────────────────────────

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
    """Format an ISO timestamp string to 'DD MMM YYYY', e.g. '06 Apr 2026'."""
    if not dt_str:
        return "—"
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return dt.strftime("%-d %b %Y")
    except ValueError:
        return dt_str[:10]
