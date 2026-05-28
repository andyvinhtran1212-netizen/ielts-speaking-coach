import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const RESULT_HTML = readFileSync(path.join(REPO_ROOT, 'frontend/pages/result.html'), 'utf8');
const PRACTICE_JS = readFileSync(path.join(REPO_ROOT, 'frontend/js/practice.js'), 'utf8');
const GRAMMAR_JS = readFileSync(path.join(REPO_ROOT, 'frontend/js/grammar.js'), 'utf8');
const GRAMMAR_CSS = readFileSync(path.join(REPO_ROOT, 'frontend/css/grammar-wiki.css'), 'utf8');

describe('grammar recommendation reliability guards', () => {
  test('inline recommendation links use article routes instead of grammar.html query URLs', () => {
    assert.doesNotMatch(RESULT_HTML, /\/grammar\.html\?category=/);
    assert.doesNotMatch(PRACTICE_JS, /\/grammar\.html\?category=/);
    assert.match(RESULT_HTML, /return '\/*grammar\/'|return '\/grammar\//);
    assert.match(PRACTICE_JS, /return '\/grammar\//);
  });

  test('result and practice telemetry patch recommendation clicks', () => {
    const clickedEndpoint = /\/api\/grammar\/recommendations\/\\?'\+this\.dataset\.recId\+\\?'\/clicked/;
    assert.match(RESULT_HTML, clickedEndpoint);
    assert.match(PRACTICE_JS, clickedEndpoint);
  });

  test('grammar article page re-runs anchor handling on hashchange', () => {
    assert.match(GRAMMAR_JS, /window\.addEventListener\('hashchange',\s*_scrollToHashAnchor\)/);
  });

  test('grammar article page shows inline fallback notice when anchor is missing', () => {
    assert.match(GRAMMAR_JS, /grammar-anchor-notice/);
    assert.match(GRAMMAR_JS, /Phần được đề xuất không tìm thấy trong bài này/);
    assert.match(GRAMMAR_JS, /window\.scrollTo\(\{\s*top:\s*0,\s*behavior:\s*'smooth'\s*\}\)/);
    assert.match(GRAMMAR_CSS, /\.grammar-anchor-notice/);
  });
});
