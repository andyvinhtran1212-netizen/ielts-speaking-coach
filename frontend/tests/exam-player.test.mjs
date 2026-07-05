import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(REPO_ROOT, p), 'utf8');

const EXAM_HTML = read('frontend/pages/exam.html');
const PLAYER_JS = read('frontend/js/exam-player.js');
const STEPPER_JS = read('frontend/js/kp-stepper.js');

describe('exam player wiring', () => {
  test('exam.html loads the stepper + player and boots examPlayer.init', () => {
    assert.match(EXAM_HTML, /kp-stepper\.js/);
    assert.match(EXAM_HTML, /exam-player\.js/);
    assert.match(EXAM_HTML, /examPlayer\.init\(\)/);
  });

  test('player hits the exam endpoints (list, detail, submit, review)', () => {
    assert.match(PLAYER_JS, /window\.api\.get\('\/api\/exams'/);
    assert.match(PLAYER_JS, /window\.api\.get\('\/api\/exams\/'/);
    assert.match(PLAYER_JS, /window\.api\.post\('\/api\/exams\/'/);
    assert.match(PLAYER_JS, /\/api\/exams\/attempts\/'/);
  });

  test('player collects one answer per question and renders the KP stepper review', () => {
    assert.match(PLAYER_JS, /input\[name="q'/);
    assert.match(PLAYER_JS, /window\.KPStepper\.renderHtml/);
    assert.match(PLAYER_JS, /window\.KPStepper\.wire/);
  });

  test('player is token-compliant + escapes untrusted text', () => {
    const body = PLAYER_JS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(body, /rgba?\(/);
    assert.match(body, /var\(--av-/);
    assert.match(body, /WC\.escapeHtml/);
  });
});

describe('shared KP stepper renderer', () => {
  test('exposes renderHtml + wire', () => {
    assert.match(STEPPER_JS, /window\.KPStepper = \{ renderHtml: renderHtml, wire: wire \}/);
  });

  test('grammar chips deep-link via enriched category; micro-checks post evidence', () => {
    assert.match(STEPPER_JS, /ref\.type === 'grammar' && ref\.category/);
    assert.match(STEPPER_JS, /'\/grammar\/'/);
    assert.match(STEPPER_JS, /\/api\/kp\/microcheck-answers/);
  });

  test('renders action labels + is token-compliant + escapes text', () => {
    assert.match(STEPPER_JS, /STEP_ACTION/);
    const body = STEPPER_JS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(body, /rgba?\(/);
    assert.match(body, /var\(--av-primary\)/);
    assert.match(body, /WC\.escapeHtml/);
  });
});
