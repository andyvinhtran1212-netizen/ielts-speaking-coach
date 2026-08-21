/**
 * Trang "Thống kê luyện tập" — tổng hợp kết quả Quick-Check.
 *
 * TÁCH RA TỪ MÃ INLINE của `pages/quiz-progress.html` khi port sang Next (không
 * đổi một dòng logic nào). Bản Next chạy CHÍNH mã này, không chép lại.
 *
 * KHÔNG tự gọi `initSupabase`: bản legacy gọi ngay trước `mount()`, bản Next để
 * `AuthedShell` lo.
 */
import { formatCourseExplanation } from './course-explanation-format.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
// Same prompt formatting the player uses, so a review card reads identically
// to the question the learner saw: **bold** + the ____ blank placeholder.
const fmt = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/_{2,}/g, '<u>&nbsp;&nbsp;&nbsp;</u>');

// Audit 2026-07-28 §C3 — this page is reachable from the Vocabulary hub AND
// from a grammar Quick-Check, so it scopes itself by the caller's skill_area
// instead of mixing both skills' banks and sessions into one list.
const SKILL = new URLSearchParams(location.search).get('skill_area') || '';
const qs = (extra) => (SKILL ? '?skill_area=' + encodeURIComponent(SKILL) : '') + (extra || '');

// Humanize seconds → "2h 5m" / "18m" / "42s".
function fmtHm(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return h + 'h ' + (m ? m + 'm' : '');
  if (m) return m + 'm';
  return sec + 's';
}

function statCard(label, valHtml) {
  return '<div class="av-card pg-stat"><div class="pg-stat__label">' + esc(label) + '</div>'
    + '<div class="pg-stat__val">' + valHtml + '</div></div>';
}

// ── Mistakes review ──────────────────────────────────────────
function mistakeQuestionHtml(q) {
  return '<div class="pg-mk__q">'
    + '<div class="pg-mk__prompt">' + fmt(q.prompt) + '</div>'
    + (q.hint ? '<div class="pg-mk__hint">💡 ' + fmt(q.hint) + '</div>' : '')
    + '<div class="pg-mk__row">Bạn trả lời: <span class="pg-mk__ans is-wrong">'
      + fmt(String(q.your_answer == null ? '' : q.your_answer)) + '</span> ✗'
      + (q.wrong_times > 1 ? ' <span class="pg-mk__meta">(sai ' + q.wrong_times + ' lần)</span>' : '')
    + '</div>'
    + (q.correct_answer
        ? '<div class="pg-mk__row">Đáp án đúng: <span class="pg-mk__ans is-right">'
          + fmt(String(q.correct_answer)) + '</span></div>'
        : '')
    + (q.explain ? '<div class="pg-mk__explain course-explain">'
      + formatCourseExplanation(q.explain) + '</div>' : '')
    + (q.article_url
        ? '<div class="pg-mk__row"><a href="' + esc(q.article_url)
          + '" target="_blank" rel="noopener">📖 Ôn lại bài</a></div>'
        : '')
    + '</div>';
}

function renderMistakes(m) {
  const host = $('pg-mistakes');
  const items = (m && m.items) || [];
  if (!items.length) {
    host.innerHTML = '<p class="pg-empty">🎉 Chưa có câu nào bị sai — hoặc bạn chưa làm bài nào.</p>';
    return;
  }
  host.innerHTML = items.map((it, i) => {
    // A word the learner later mastered still belongs here (that's the point
    // of reviewing), but it must read as fixed rather than as an open error.
    const fixed = it.status === 'mastered';
    return '<div class="av-card pg-mk">'
      + '<button type="button" class="pg-mk__head" data-i="' + i + '" aria-expanded="false">'
      + '<span class="pg-mk__word">' + esc(it.item_key) + ' '
      + '<span class="pg-mk__meta" style="font-weight:400;">' + esc(it.code || '') + '</span></span>'
      + '<span class="pg-mk__meta">' + (fixed ? '✓ đã thuộc · ' : '')
      + it.questions.length + ' câu sai ▾</span>'
      + '</button>'
      + '<div class="pg-mk__body hidden" data-body="' + i + '">'
      + it.questions.map(mistakeQuestionHtml).join('')
      + '</div></div>';
  }).join('');
  host.querySelectorAll('.pg-mk__head').forEach((btn) => {
    btn.onclick = () => {
      const body = host.querySelector('[data-body="' + btn.dataset.i + '"]');
      const open = body.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', String(!open));
    };
  });
  if (m.capped) {
    const cap = $('pg-mistakes-cap');
    cap.textContent = 'Chỉ hiển thị ' + m.attempts_scanned + ' câu sai gần nhất.';
    cap.classList.remove('hidden');
  }
}

async function boot() {
  if (SKILL === 'grammar') {
    $('pg-back').href = '/grammar';
    $('pg-back-label').textContent = 'Grammar';
  }
  let p;
  try { p = await window.api.get('/api/quiz/progress' + qs()); }
  catch (e) {
    $('pg-loading').classList.add('hidden');
    $('pg-error').textContent = 'Không tải được thống kê: ' + e.message;
    $('pg-error').classList.remove('hidden');
    return;
  }
  $('pg-loading').classList.add('hidden');
  $('pg-main').classList.remove('hidden');

  // ── Lifetime totals ──────────────────────────────────────────
  const t = p.totals || { sessions: 0, time_sec: 0, words_mastered: 0, avg_accuracy: null };
  $('pg-totals').innerHTML =
    statCard('Tổng thời gian', fmtHm(t.time_sec))
    + statCard('Số phiên', String(t.sessions || 0))
    + statCard('Từ đã thuộc', (t.words_mastered || 0) + '<small>từ</small>')
    + statCard('Độ chính xác TB', pct(t.avg_accuracy));

  // ── Per-bank progress ────────────────────────────────────────
  const banks = p.banks || [];
  $('pg-banks').innerHTML = banks.length
    ? banks.map((b) => {
        const total = b.words_count || (b.mastered + b.in_progress) || 0;
        const w = total ? Math.round(b.mastered / total * 100) : 0;
        return '<div class="av-card pg-bank"><div class="pg-bank__row">'
          + '<span class="pg-bank__name">' + esc(b.code || '') + ' '
          + '<span class="pg-bank__meta" style="font-weight:400;">' + esc(b.title || '') + '</span></span>'
          + '<span class="pg-bank__meta">Đã thuộc ' + b.mastered + '/' + total + '</span></div>'
          + '<div class="pg-track"><div class="pg-bar" style="width:' + w + '%;"></div></div></div>';
      }).join('')
    : '<p class="pg-empty">Chưa có dữ liệu. Hãy làm một bài Quick-Check để bắt đầu.</p>';

  // ── Recent sessions ──────────────────────────────────────────
  const sessions = p.recent_sessions || [];
  $('pg-sessions').innerHTML = sessions.length
    ? '<table class="pg-sess"><thead><tr><th>Bộ</th><th>Chính xác</th><th>Đã thuộc</th>'
      + '<th>Thời gian</th><th>Kết thúc</th></tr></thead><tbody>'
      + sessions.map((s) => '<tr><td>' + esc(s.code || '') + '</td>'
          + '<td>' + pct(s.accuracy) + '</td>'
          + '<td>' + (s.words_mastered || 0) + '</td>'
          + '<td>' + (s.duration_sec ? fmtHm(s.duration_sec) : '—') + '</td>'
          + '<td>' + esc((s.ended_at || '').slice(0, 10))
          + (s.ended_by === 'paused' ? ' <span class="av-badge av-badge-warning">tạm dừng</span>' : '')
          + '</td></tr>').join('')
      + '</tbody></table>'
    : '<p class="pg-empty">Chưa có phiên nào.</p>';

  // ── Wrong answers ────────────────────────────────────────────
  // Independent of the block above: a mistakes-read failure must not blank
  // the progress the learner already loaded.
  try {
    renderMistakes(await window.api.get('/api/quiz/mistakes' + qs()));
  } catch (e) {
    $('pg-mistakes').innerHTML =
      '<p class="pg-empty">Không tải được danh sách câu sai: ' + esc(e.message) + '</p>';
  }
}

export async function mount() {
  await boot();
}
