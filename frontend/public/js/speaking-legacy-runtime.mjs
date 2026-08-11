import { SpeakingFullTestController } from './speaking-full-test-controller.mjs';
import { SpeakingSubmissionController } from './speaking-submission-controller.mjs';

/**
 * Mount the same persistence controllers used by the Next practice route onto
 * the rollback-safe legacy page. The legacy renderer remains unchanged; only
 * upload confirmation, retry ownership and Full Test resume state are shared.
 */
export function mountLegacySpeakingRuntime(win = globalThis) {
  const existing = win.PracticeLegacyRuntime;
  if (existing && typeof existing.destroy === 'function') return existing;

  // Browsers can expose the property while denying access to its getter
  // (privacy mode, sandboxed embeds, or blocked storage). Persistence is
  // best-effort; failing to read storage must not prevent PracticeApp startup.
  let storage = null;
  try { storage = win.sessionStorage; } catch { /* storage unavailable */ }

  const submission = new SpeakingSubmissionController({
    upload: (path, formData) => win.api.upload(path, formData),
    getSession: (path) => win.api.get(path),
  });
  const fullTest = new SpeakingFullTestController({
    storage,
    submit: (request) => submission.submit(request),
    finalize: (body) => win.api.post('/sessions/finalize-full-test', body),
    getSession: (sessionId) => (
      win.api.get(`/sessions/${encodeURIComponent(sessionId)}`)
    ),
  });

  const warnBeforeUnload = (event) => {
    if (!fullTest.hasUnsavedAudio()) return;
    event.preventDefault();
    event.returnValue = '';
  };

  const runtime = {
    submission,
    fullTest,
    destroy() {
      win.removeEventListener?.('beforeunload', warnBeforeUnload);
      submission.destroy();
      fullTest.destroy();
      if (win.PracticeSubmission === submission) delete win.PracticeSubmission;
      if (win.PracticeFullTest === fullTest) delete win.PracticeFullTest;
      if (win.PracticeLegacyRuntime === runtime) delete win.PracticeLegacyRuntime;
    },
  };

  win.PracticeSubmission = submission;
  win.PracticeFullTest = fullTest;
  win.PracticeLegacyRuntime = runtime;
  win.addEventListener?.('beforeunload', warnBeforeUnload);
  return runtime;
}

if (typeof window !== 'undefined' && window.document) {
  mountLegacySpeakingRuntime(window);
}
