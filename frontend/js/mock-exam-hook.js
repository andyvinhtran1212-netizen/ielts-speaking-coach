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

  return { sittingId: sittingId, active: active, attach: attach,
           isSealedResponse: isSealedResponse, showSealedAndReturn: showSealedAndReturn };
})();
