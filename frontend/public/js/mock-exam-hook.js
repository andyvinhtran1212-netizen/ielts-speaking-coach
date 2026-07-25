/*
 * mock-exam-hook.js — thin bridge so the existing reading/listening runners can
 * participate in a 4-skill mock sitting without rewriting them.
 *
 * A runner opts in when the URL carries ?sitting_id=<id>. Then:
 *   - after it creates its attempt, it calls MockHook.attach(section, attemptId)
 *     so the backend links the attempt to the sitting (which makes submit sealed);
 *   - when its submit returns a SEALED ack ({received:true}) instead of a score,
 *     it calls MockHook.isSealedResponse(res) → showSealedAndReturn(section),
 *     which shows "đã thu bài" and hands control back to the orchestrator.
 *
 * No-op on normal (non-mock) runs — the runner code paths are unchanged.
 */
window.MockHook = (function () {
  'use strict';

  function sittingId() { return new URLSearchParams(location.search).get('sitting_id'); }
  function active() { return !!sittingId(); }
  function embedded() { return new URLSearchParams(location.search).get('mock_embed') === '1'; }

  // In the 4-skill mock, Reading/Listening run as iframes inside one page with
  // ONE total timer. Hide the runner's own timer + submit (the parent owns them)
  // and auto-enter the attempt so the student just sees the questions.
  function setupEmbed() {
    if (!embedded()) return;
    var css = document.createElement('style');
    css.textContent =
      '#exam-timer-wrap,#exam-submit-btn,#btn-submit,.ft-timer,.exam-topbar-actions{display:none !important}';
    document.head.appendChild(css);
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      // RESUME ALWAYS WINS. This auto-click is why a refresh used to be
      // destructive: it fired the runner's start path, which for Listening
      // abandons the open attempt and mints an empty one. Both runners now
      // publish a resume button, and it is preferred whenever it is on screen.
      var resume = document.getElementById('exam-resume-btn-prestart')
        || document.getElementById('ft-resume-btn');
      var start = document.getElementById('exam-start-btn') || document.getElementById('btn-start');
      var btn = (resume && resume.offsetParent !== null) ? resume : start;
      if (btn && btn.offsetParent !== null) { btn.click(); clearInterval(iv); }
      else if (tries > 50) clearInterval(iv);   // give up after ~10s
    }, 200);
  }

  // Seconds since the invigilator opened the CURRENT section, from the shared
  // exam clock (not this student's own start click). A Listening runner that
  // resumes mid-section seeks the audio here so the student rejoins the room
  // where it actually is — they lose the audio that played while they were
  // gone, exactly as in a real exam hall.
  //
  // Returns null when there is no sitting, the lookup fails, or the section is
  // self-timed (retake) — the caller must then leave the audio alone rather
  // than guess an offset.
  async function sectionElapsedSeconds(section) {
    var sid = sittingId();
    if (!sid || !(window.api && window.api.get)) return null;
    try {
      var st = await window.api.get('/api/mock-exams/sittings/' + encodeURIComponent(sid));
      if (!st || st.active_section !== section) return null;
      // Retake has no CLASS clock, but it does have a per-SITTING one, and the
      // endpoint already computes time-left from it. Returning null here threw
      // that anchor away, so a retake refresh remounted the audio at 0 and let
      // the student hear the opening again while their own countdown kept
      // running (Codex review, PR #834).
      var total = st.section_duration_seconds, left = st.section_time_left_seconds;
      if (total == null || left == null) return null;
      return Math.max(0, total - left);
    } catch (e) {
      console.warn('[mock-hook] section elapsed lookup failed', e);
      return null;
    }
  }

  async function attach(section, attemptId) {
    var sid = sittingId();
    if (!sid || !attemptId || !(window.api && window.api.post)) return;
    // FAIL-CLOSED: the domain submit only withholds the score once sitting_id is
    // written on the attempt, so a failed attach must NOT be swallowed — the
    // caller awaits this and must block the exam if it rejects, otherwise the
    // student could submit and get a normal (unsealed) score.
    try {
      await window.api.post(
        '/api/mock-exams/sittings/' + encodeURIComponent(sid) + '/attach',
        { section: section, attempt_id: attemptId }
      );
    } catch (e) {
      console.warn('[mock-hook] attach failed', e);
      throw e;
    }
  }

  function isSealedResponse(res) {
    return !!(res && (res.received === true || res.sealed === true));
  }

  function showSealedAndReturn(section) {
    var sid = sittingId();
    var label = { listening: 'Listening', reading: 'Reading' }[section] || section;
    document.body.innerHTML =
      '<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-family:system-ui,sans-serif;background:#0b1220;color:#fff;text-align:center;padding:24px">' +
      '<div style="font-size:20px;font-weight:700;margin-bottom:8px">Đã thu bài ' + label + '</div>' +
      '<div style="opacity:.8">Đang quay lại kỳ thi…</div></div>';
    setTimeout(function () {
      location.href = '/pages/mock-exam.html?sitting=' + encodeURIComponent(sid) + '&done=' + encodeURIComponent(section);
    }, 1200);
  }

  // Run the embed presentation setup as soon as the runner DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEmbed);
  } else {
    setupEmbed();
  }

  return { sittingId: sittingId, active: active, embedded: embedded, attach: attach,
           isSealedResponse: isSealedResponse, showSealedAndReturn: showSealedAndReturn,
           setupEmbed: setupEmbed, sectionElapsedSeconds: sectionElapsedSeconds };
})();
