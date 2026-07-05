import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(REPO_ROOT, p), 'utf8');

const RESULT_HTML = read('frontend/pages/result.html');
const WIDGET_JS = read('frontend/js/kp-result-widget.js');
const REVIEW_JS = read('frontend/js/reading-review.js');

// ── Piece 2: result-page weak-KP funnel ──────────────────────────────────────
describe('result-page weak-KP widget', () => {
  test('result.html mounts the widget + loads its script', () => {
    assert.match(RESULT_HTML, /id="kp-weak-mount"/);
    assert.match(RESULT_HTML, /kp-result-widget\.js/);
  });

  test('widget fetches weak grammar mastery without redirecting the result page', () => {
    assert.match(WIDGET_JS, /\/api\/me\/kp-mastery\?status=weak&kp_type=grammar/);
    assert.match(WIDGET_JS, /noRedirect:\s*true/);
  });

  test('widget funnels to the personal roadmap', () => {
    assert.match(WIDGET_JS, /grammar-roadmap\.html/);
  });

  test('widget is token-compliant + escapes text', () => {
    const body = WIDGET_JS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(body, /rgba?\(/);
    assert.match(body, /var\(--av-error\)/);
    assert.match(body, /WC\.escapeHtml/);
  });
});

// ── Piece 3: KP-aware stepper in the reading review ──────────────────────────
describe('reading-review KP stepper', () => {
  test('renderCard reads the item.stepper view-model', () => {
    assert.match(REVIEW_JS, /var stp = item\.stepper/);
  });

  test('structured stepper is gated so prose L3 solutions are unchanged', () => {
    assert.match(REVIEW_JS, /_hasStructuredStepper\(stp\)/);
    // prose fallback still uses the legacy steps renderer
    assert.match(REVIEW_JS, /_stepsList\(sol\.steps\)/);
  });

  test('renders step action labels, kp-ref chips and distractor analysis', () => {
    assert.match(REVIEW_JS, /STEP_ACTION/);
    assert.match(REVIEW_JS, /_kpChips/);
    assert.match(REVIEW_JS, /_renderDistractors/);
  });

  test('micro-checks post KP evidence to the authed endpoint (skipped for anon)', () => {
    assert.match(REVIEW_JS, /\/api\/kp\/microcheck-answers/);
    assert.match(REVIEW_JS, /if \(anonIdFromUrl\(\)\) return;/);
    assert.match(REVIEW_JS, /_wireMicrochecks\(card\)/);
  });

  test('new stepper markup uses --av-* tokens (no hardcoded hex/rgb in helpers)', () => {
    // Scope to the stepper helper block we added.
    const start = REVIEW_JS.indexOf('KP-aware stepper');
    const end = REVIEW_JS.indexOf('function renderCard(');
    const region = REVIEW_JS.slice(start, end);
    assert.ok(start > 0 && end > start, 'stepper helper block present');
    assert.doesNotMatch(region, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(region, /rgba?\(/);
    assert.match(region, /var\(--av-primary\)/);
  });
});
