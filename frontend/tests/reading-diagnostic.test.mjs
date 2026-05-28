import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const READING_EXAM_HTML = readFileSync(path.join(REPO_ROOT, 'frontend/pages/reading-exam.html'), 'utf8');
const READING_EXAM_JS = readFileSync(path.join(REPO_ROOT, 'frontend/js/reading-exam.js'), 'utf8');
const READING_EXAM_CSS = readFileSync(path.join(REPO_ROOT, 'frontend/css/reading-exam.css'), 'utf8');

describe('reading diagnostic integration guards', () => {
  test('results surface reserves a learner-facing diagnostic section', () => {
    assert.match(READING_EXAM_HTML, /id="results-diagnostic"/);
    assert.match(READING_EXAM_HTML, /Chẩn đoán & bước tiếp theo/);
  });

  test('results page fetches diagnostic for the submitted attempt and links to L2 exercises', () => {
    assert.match(READING_EXAM_JS, /\/api\/reading\/diagnostic\?attempt_id=/);
    assert.match(READING_EXAM_JS, /\/pages\/reading-skill-exercise\.html\?slug=/);
    assert.match(READING_EXAM_JS, /loadDiagnostic\(result\.attempt_id\)/);
  });

  test('diagnostic cards have dedicated styling hooks', () => {
    assert.match(READING_EXAM_CSS, /\.exam-results-diagnostic/);
    assert.match(READING_EXAM_CSS, /\.exam-diagnostic-card/);
  });
});
