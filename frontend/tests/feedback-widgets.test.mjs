/**
 * feedback-widgets.test.mjs — Feedback PR-2 student surfaces.
 *
 * Pins the shared widget contract (survey / report modal / per-card flag) +
 * its wiring into reading-review + listening-review + the HTML link tags +
 * the token-mapped CSS (light+dark, a11y). Source-assertion sentinels.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const WIDGETS = read('js', 'feedback-widgets.js');
const CSS = read('css', 'feedback.css');
const RD_JS = read('js', 'reading-review.js');
const LS_JS = read('js', 'listening-review.js');
const RD_HTML = read('pages', 'reading-review.html');
const LS_HTML = read('pages', 'listening-review.html');


describe('Feedback widgets — public API + POST contract', () => {
  it('exposes AverFeedback.{mountSurvey,openReportModal,attachCardFlag}', () => {
    assert.match(WIDGETS, /window\.AverFeedback\s*=/);
    assert.match(WIDGETS, /mountSurvey:\s*mountSurvey/);
    assert.match(WIDGETS, /openReportModal:\s*openReportModal/);
    assert.match(WIDGETS, /attachCardFlag:\s*attachCardFlag/);
  });
  it('POSTs to /api/feedback; anon reading uses postWith + X-Reading-Anon, else post', () => {
    assert.match(WIDGETS, /ctx\.anonId && window\.api\.postWith/);
    assert.match(WIDGETS, /postWith\('\/api\/feedback',\s*body,\s*\{\s*'X-Reading-Anon':\s*ctx\.anonId\s*\}/);
    assert.match(WIDGETS, /window\.api\.post\('\/api\/feedback',\s*body\)/);
    // the request body carries only skill + attempt_id + the type payload —
    // identity (created_by/anon_id) + test_id are derived server-side (PR-1).
    assert.match(WIDGETS, /var body = Object\.assign\(\{\s*skill:\s*ctx\.skill,\s*attempt_id:\s*ctx\.attemptId\s*\},\s*payload\)/);
  });
  it('builds the three payload types', () => {
    assert.match(WIDGETS, /type:\s*'rating',\s*rating_de/);
    assert.match(WIDGETS, /payload\.rating_audio\s*=\s*audio/);
    assert.match(WIDGETS, /type:\s*'report'/);
    assert.match(WIDGETS, /type:\s*'flag',\s*q_num:\s*qNum/);
  });
});


describe('Feedback survey — show-once + 409', () => {
  it('remembers state per attempt in localStorage (av-fb-survey:<attempt>)', () => {
    assert.match(WIDGETS, /'av-fb-survey:'\s*\+\s*attemptId/);
    assert.match(WIDGETS, /if \(surveyDone\(ctx\.attemptId\)\) return/);
  });
  it('treats a server 409 (already rated) as done, not an error', () => {
    assert.match(WIDGETS, /\/409\/\.test/);
    assert.match(WIDGETS, /markSurveyDone\(ctx\.attemptId,\s*'submitted'\)/);
  });
  it('is dismissable + idempotent re-mount (reading re-renders per part)', () => {
    assert.match(WIDGETS, /markSurveyDone\(ctx\.attemptId,\s*'dismissed'\)/);
    assert.match(WIDGETS, /if \(host\.querySelector\('\.fb-survey'\)\) return/);
  });
});


describe('Feedback report modal — category chips per skill + a11y', () => {
  it('reading categories EXCLUDE audio; listening INCLUDES audio_issue', () => {
    // reading block has no audio_issue; listening has it
    const cats = WIDGETS.slice(WIDGETS.indexOf('var CATEGORIES'), WIDGETS.indexOf('// ── 1. SURVEY'));
    const reading = cats.slice(cats.indexOf('reading:'), cats.indexOf('listening:'));
    assert.ok(!/audio_issue/.test(reading), 'reading must NOT offer audio_issue');
    assert.match(cats, /listening:[\s\S]*audio_issue/);
  });
  it('modal is a dialog with focus trap + Esc + scrim-close', () => {
    assert.match(WIDGETS, /role="dialog"\s+aria-modal="true"/);
    assert.match(WIDGETS, /e\.key === 'Escape'/);
    assert.match(WIDGETS, /e\.key === 'Tab'/);                 // focus trap
    assert.match(WIDGETS, /if \(e\.target === scrim\) close\(\)/);
  });
});


describe('Feedback wiring — reading-review', () => {
  it('mounts survey (hasAudio:false) + per-card flag, passing the anon token', () => {
    assert.match(RD_JS, /AverFeedback\.mountSurvey\(review,\s*\{[\s\S]*?skill:\s*'reading'[\s\S]*?hasAudio:\s*false/);
    assert.match(RD_JS, /anonId:\s*anonId/);                   // reading share-link anon
    assert.match(RD_JS, /AverFeedback\.attachCardFlag\(\{[\s\S]*?skill:\s*'reading'/);
    assert.match(RD_JS, /qNum:\s*Number\(c\.dataset\.q\)/);
  });
});


describe('Feedback wiring — listening-review', () => {
  it('mounts survey (hasAudio:true, anon null) + per-card flag', () => {
    assert.match(LS_JS, /AverFeedback\.mountSurvey\(host,\s*\{[\s\S]*?skill:\s*'listening'[\s\S]*?hasAudio:\s*true/);
    assert.match(LS_JS, /AverFeedback\.attachCardFlag\(\{[\s\S]*?skill:\s*'listening'[\s\S]*?anonId:\s*null/);
  });
});


describe('Feedback HTML link tags', () => {
  it('both review pages link feedback.css + feedback-widgets.js (before the page JS)', () => {
    assert.match(RD_HTML, /href="\/css\/feedback\.css"/);
    assert.match(LS_HTML, /href="\/css\/feedback\.css"/);
    // widgets script must come BEFORE the review script (defer runs in order → AverFeedback ready)
    assert.ok(RD_HTML.indexOf('feedback-widgets.js') < RD_HTML.indexOf('reading-review.js'));
    assert.ok(LS_HTML.indexOf('feedback-widgets.js') < LS_HTML.indexOf('listening-review.js'));
  });
});


describe('Feedback CSS — real aver tokens, light+dark, a11y', () => {
  it('maps mockup token names to real --av-* (not raw values)', () => {
    assert.match(CSS, /--fb-surface:\s*var\(--av-surface-card\)/);
    assert.match(CSS, /--fb-ink:\s*var\(--av-text-primary\)/);
    assert.match(CSS, /--fb-brand:\s*var\(--av-primary\)/);
    assert.match(CSS, /--fb-good:\s*var\(--av-success\)/);
    assert.match(CSS, /--fb-bad:\s*var\(--av-error\)/);
  });
  it('terracotta flag is a SCOPED token with a dark-theme override', () => {
    assert.match(CSS, /--fb-flag:\s*#d8643b/);
    assert.match(CSS, /\[data-theme="dark"\]\s*\.av-fb\s*\{[\s\S]*?--fb-flag:\s*#e8794f/);
  });
  it('honours reduced-motion + visible keyboard focus', () => {
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(CSS, /:focus-visible/);
  });
});
