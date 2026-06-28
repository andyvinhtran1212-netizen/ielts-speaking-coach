// js/home.js — Sprint 5.1 multi-skill student homepage.
//
// The page renders skeleton cards on first paint and replaces them with real
// data when /api/student/home-summary returns. Skill cards are templated
// from the API payload (status='active' vs 'coming_soon'), so flipping
// Reading or Listening to active later is a backend-only change.
//
// ──────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const SKILLS_ORDER = ['writing', 'speaking', 'grammar', 'vocabulary', 'reading', 'listening'];

  // Static metadata per skill — icon, name, description copy, the
  // metric the card highlights. Coming-soon skills also live here so
  // the layout doesn't depend on backend payload for those.
  const SKILL_META = {
    writing: {
      icon: '✍︎',
      name: 'Writing',
      desc: 'Bài luận Task 1 & Task 2 với feedback chi tiết.',
    },
    speaking: {
      icon: '🎙',
      name: 'Speaking',
      desc: 'Luyện nói 3 phần và nhận điểm band tự động.',
    },
    grammar: {
      icon: '✦',
      name: 'Grammar',
      desc: '67 bài học ngữ pháp dành cho IELTS.',
    },
    vocabulary: {
      icon: '⌗',
      name: 'Vocabulary',
      desc: 'Wallet từ vựng cá nhân + flashcard SRS.',
    },
    reading: {
      icon: '✸',
      name: 'Reading',
      desc: 'Bài đọc IELTS với phân tích cấu trúc đoạn và chiến lược tìm ý chính.',
    },
    listening: {
      icon: '◐',
      name: 'Listening',
      desc: 'Bài nghe với note-taking pattern và phân tích bẫy đáp án.',
    },
  };

  // ── DOM refs ────────────────────────────────────────────────────────
  const refs = {};
  function $(id) { return document.getElementById(id); }

  // ── Time formatting ─────────────────────────────────────────────────
  // Exposed on window for the test suite (frontend/tests/home.test.js).
  function formatRelativeTime(isoString) {
    if (!isoString) return 'Chưa có hoạt động';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Chưa có hoạt động';
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'Hôm nay';
    if (diffDays === 0) return 'Hôm nay';
    if (diffDays === 1) return 'Hôm qua';
    if (diffDays < 7) return diffDays + ' ngày trước';
    if (diffDays < 30) return Math.floor(diffDays / 7) + ' tuần trước';
    if (diffDays < 365) return Math.floor(diffDays / 30) + ' tháng trước';
    return Math.floor(diffDays / 365) + ' năm trước';
  }

  // ── Per-skill metric formatters ─────────────────────────────────────
  // Each returns { primary: { value, unit }, sub: html-or-text }.
  // Pulled out into a map so adding Reading/Listening as active later is
  // a one-key addition, not a switch-statement edit.
  const METRIC_FORMATTERS = {
    writing(s) {
      const band = s.last_band != null ? s.last_band.toFixed(1) : '—';
      const inProgress = s.essays_in_progress || 0;
      return {
        primary: { value: band, unit: 'band' },
        sub: s.essays_count
          ? (s.essays_count + ' bài đã nộp'
              + (inProgress ? ' · <span class="pulse-wrap"><span class="pulse"></span>' + inProgress + ' đang chờ</span>' : ''))
          : 'Chưa có bài nào',
      };
    },
    speaking(s) {
      const band = s.last_band != null ? s.last_band.toFixed(1) : '—';
      return {
        primary: { value: band, unit: 'band' },
        sub: s.sessions_count
          ? s.sessions_count + ' session đã luyện'
          : 'Chưa luyện session nào',
      };
    },
    grammar(s) {
      return {
        primary: { value: String(s.lessons_viewed || 0), unit: 'bài đã xem' },
        sub: s.lessons_viewed
          ? 'Xem lại các bài đã đánh dấu'
          : 'Khám phá 67 bài học ngữ pháp',
      };
    },
    vocabulary(s) {
      const due = s.flashcards_due || 0;
      return {
        primary: { value: String(s.words_learned || 0), unit: 'từ' },
        sub: due
          ? '<span class="pulse"></span>' + due + ' thẻ đến hạn'
          : (s.words_learned ? 'Wallet từ vựng cá nhân' : 'Bắt đầu lưu từ mới'),
      };
    },
    reading(s) {
      const band = s.last_band != null ? s.last_band.toFixed(1) : '—';
      return {
        primary: { value: band, unit: 'band' },
        sub: s.attempts_count
          ? s.attempts_count + ' bài đã hoàn thành'
          : 'Luyện đọc với bài kiểm tra IELTS thực tế',
      };
    },
    listening(s) {
      if (s.last_band != null) {
        return {
          primary: { value: s.last_band.toFixed(1), unit: 'band' },
          sub: s.attempts_count
            ? s.attempts_count + ' bài đã hoàn thành'
            : 'Tiếp tục luyện nghe',
        };
      }
      return {
        primary: { value: String(s.attempts_count || 0), unit: 'bài' },
        sub: s.attempts_count
          ? 'Tiếp tục luyện nghe'
          : 'Luyện nghe với dictation và comprehension',
      };
    },
  };

  // ── Stat loading state ──────────────────────────────────────────────
  // The page paints `…` (class is-loading, blinking via home.css) instead of a
  // literal 0 so a not-yet-loaded number isn't misread as real data. setStat()
  // writes the value + stops the blink; clearStatLoading() is the safety sweep
  // for any stat the render path didn't touch — success → '0' (genuinely zero),
  // error → '—' (unavailable, never a misleading 0, and never blinking forever).
  function setStat(el, value) {
    if (!el) return;
    el.textContent = String(value);
    el.classList.remove('is-loading');
  }
  function clearStatLoading(fallback) {
    if (!document.querySelectorAll) return;   // defensive (also no-ops under the test DOM mock)
    document.querySelectorAll('.value-num.is-loading, .js-val.is-loading')
      .forEach((el) => { el.classList.remove('is-loading'); el.textContent = fallback; });
  }

  // ── Render: hero stats ──────────────────────────────────────────────
  function renderHero(data) {
    const greetName = $('greeting-name');
    if (greetName) greetName.textContent = data.student.name || 'bạn';

    const streakEl = $('hero-streak');
    const streak = data.streak.current_days || 0;
    setStat(streakEl.querySelector('.value-num'), streak);
    streakEl.querySelector('.unit').textContent = streak === 1 ? 'ngày' : 'ngày';
    if (streak > 0) {
      streakEl.classList.add('alive');
    }

    const sessions = data.totals.speaking_sessions || 0;
    const sessionsEl = $('hero-sessions');
    setStat(sessionsEl.querySelector('.value-num'), sessions);

    const essays = data.totals.writing_essays || 0;
    const essaysEl = $('hero-essays');
    setStat(essaysEl.querySelector('.value-num'), essays);
  }

  // ── Render: one skill card ──────────────────────────────────────────
  // `permissions` is the GET /api/student/permissions payload. When a
  // skill the user lacks permission for (Sprint 5.2: Writing) the card
  // renders in "locked" mode — same layout as coming-soon but the copy
  // points at the activation flow rather than a future release.
  function renderSkillCard(skillId, data, permissions) {
    const card = document.querySelector('[data-skill="' + skillId + '"]');
    if (!card) return;

    const meta = SKILL_META[skillId] || {};

    // Locked path: skill exists but the user's access code doesn't grant
    // it. Sprint 5.2 only checks Writing — extend to Speaking modes if
    // the same gate becomes desired there.
    if (skillId === 'writing' && permissions && permissions.writing === false) {
      card.classList.remove('skeleton');
      card.classList.add('coming-soon');
      card.dataset.locked = 'true';
      card.innerHTML =
        '<div class="head">'
          + '<div class="icon">' + meta.icon + '</div>'
          + '<span class="lock-tag">🔒 Chưa kích hoạt</span>'
        + '</div>'
        + '<h3>' + meta.name + '</h3>'
        + '<p class="desc">Quyền Writing chưa được kích hoạt cho tài khoản này. Liên hệ giảng viên để được hỗ trợ.</p>';
      // Click → toast (no navigation). Keyboard handled identically.
      const lockedAlert = () => alert('Quyền Writing chưa được kích hoạt. Liên hệ admin để được hỗ trợ.');
      card.tabIndex = 0;
      card.addEventListener('click', lockedAlert);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lockedAlert(); }
      });
      return;
    }

    // Coming-soon path: render once from static metadata, no API needed.
    if (data && data.status === 'coming_soon') {
      card.classList.remove('skeleton');
      card.classList.add('coming-soon');
      card.innerHTML =
        '<div class="head">'
          + '<div class="icon">' + meta.icon + '</div>'
          + '<span class="lock-tag">Sắp ra mắt</span>'
        + '</div>'
        + '<h3>' + meta.name + '</h3>'
        + '<p class="desc">' + meta.desc + '</p>';
      return;
    }

    // Active path: pull metric formatter, build markup.
    const formatter = METRIC_FORMATTERS[skillId];
    if (!formatter) return;
    const m = formatter(data || {});

    const jsVal = card.querySelector('.js-val');
    if (jsVal) {
      // Patch mode: pre-rendered card — update data spans in-place.
      setStat(jsVal, m.primary.value);
      const jsUnit = card.querySelector('.js-unit');
      if (jsUnit) jsUnit.textContent = m.primary.unit;
      const jsSub = card.querySelector('.js-sub');
      if (jsSub) jsSub.innerHTML = m.sub;
      const jsActivity = card.querySelector('.js-activity');
      if (jsActivity) jsActivity.textContent = formatRelativeTime(data.last_activity_at);
      const jsCta = card.querySelector('.js-cta');
      if (jsCta) jsCta.textContent = data.primary_cta || meta.name;
    } else {
      // Legacy mode: JS-rendered skeleton card — replace innerHTML.
      card.classList.remove('skeleton');
      card.innerHTML =
        '<div class="head">'
          + '<div class="icon">' + meta.icon + '</div>'
          + '<span class="arrow">→</span>'
        + '</div>'
        + '<h3>' + meta.name + '</h3>'
        + '<div class="metric-row">'
          + '<span class="metric">' + m.primary.value + '<span class="unit">' + m.primary.unit + '</span></span>'
        + '</div>'
        + '<div class="sub-metric">' + m.sub + '</div>'
        + '<div class="footer">'
          + '<span class="last-activity">' + formatRelativeTime(data.last_activity_at) + '</span>'
          + '<span class="cta">' + (data.primary_cta || meta.name) + '</span>'
        + '</div>';
    }

    if (data.primary_cta_url) {
      card.tabIndex = 0;
      card.setAttribute('role', 'link');
      card.setAttribute('aria-label', meta.name + ' — ' + (data.primary_cta || ''));
      card.addEventListener('click', () => {
        window.location.href = data.primary_cta_url;
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.href = data.primary_cta_url;
        }
      });
    }
  }

  // ── Render: error banner ────────────────────────────────────────────
  function renderError(msg) {
    const banner = $('error-banner');
    if (banner) {
      banner.textContent = msg;
      banner.classList.remove('hidden');
    }
  }

  // ── Boot ────────────────────────────────────────────────────────────
  async function loadHome() {
    let data;
    let permissions = null;
    try {
      // Fetch in parallel — home-summary is heavy, permissions is cheap.
      // Permissions failure is non-fatal: skill cards render unlocked
      // by default and the backend gate still enforces.
      const results = await Promise.allSettled([
        window.api.get('/api/student/home-summary'),
        window.api.get('/api/student/permissions'),
      ]);
      if (results[0].status === 'fulfilled') data = results[0].value;
      else throw results[0].reason;
      if (results[1].status === 'fulfilled') permissions = results[1].value;
      else console.warn('permissions fetch failed:', results[1].reason);
    } catch (err) {
      console.error('home-summary fetch failed:', err);
      renderError('Không tải được trang chủ. Vui lòng thử lại sau.');
      clearStatLoading('—');   // stop the blink; '—' = unavailable (not a misleading 0)
      return;
    }
    if (!data) return; // 401 → api.js redirects to login

    renderHero(data);
    SKILLS_ORDER.forEach(id => renderSkillCard(id, data.skills[id], permissions));
    // Any stat the render path didn't set (e.g. a skill with no formatter) is no
    // longer loading — show a genuine 0 rather than leaving it blinking forever.
    clearStatLoading('0');

    // Inform <aver-chrome> the user is logged in so the vocab nav link
    // updates to /pages/vocabulary.html synchronously — eliminates the race
    // where async session polling hasn't completed before the user clicks nav.
    const chrome = document.querySelector('aver-chrome');
    if (chrome && typeof chrome.setUser === 'function') {
      const student = (data && data.student) || {};
      chrome.setUser({ name: student.name || 'bạn' });
    }
  }

  // Wait for Supabase + auth to be ready before fetching.
  function bootstrap() {
    if (typeof window.api === 'undefined') {
      // api.js hasn't loaded yet — try again next tick.
      return setTimeout(bootstrap, 30);
    }
    loadHome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // Test surface — keep these names stable; tests reach in via window.
  window.__home = { formatRelativeTime, renderSkillCard, METRIC_FORMATTERS };
})();
