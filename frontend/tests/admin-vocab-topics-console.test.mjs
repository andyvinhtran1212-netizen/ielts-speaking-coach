/**
 * frontend/tests/admin-vocab-topics-console.test.mjs — Pha 3.
 * Pins the topic-centric admin console contract (structure + endpoints + links).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const html = readFileSync(path.join(ROOT, 'frontend/pages/admin/vocab/topics.html'), 'utf8');
const chrome = readFileSync(path.join(ROOT, 'frontend/js/components/aver-admin-chrome.js'), 'utf8');
const quiz = readFileSync(path.join(ROOT, 'frontend/pages/admin/vocab/quiz.html'), 'utf8');
const content = readFileSync(path.join(ROOT, 'frontend/pages/admin/vocab/content.html'), 'utf8');

describe('topic console page', () => {
  test('mounts admin chrome at vocab/topics', () => {
    assert.match(html, /<aver-admin-chrome active="vocab" subsection="topics">/);
  });
  test('has the canonical anti-flash IIFE', () => {
    assert.match(html, /localStorage\.getItem\('av-theme'\)/);
    assert.match(html, /setAttribute\('data-theme'/);
  });
  test('uses the content-topics CRUD + bundle endpoints (not the speaking /admin/topics)', () => {
    assert.match(html, /\/admin\/content-topics\?skill_area=' \+ SKILL/);
    assert.match(html, /\/admin\/content-topics\/' \+ id \+ '\/bundle/);
    assert.match(html, /api\.post\('\/admin\/content-topics'/);
    assert.match(html, /api\.delete\('\/admin\/content-topics\/'/);
    assert.ok(!/\/admin\/topics(["'?])/.test(html), 'must not hit the speaking-topics route');
  });
  test('manages the topic\'s quiz banks (publish toggle + delete + import link)', () => {
    assert.match(html, /api\.patch\('\/admin\/quiz\/banks\/'/);
    assert.match(html, /api\.delete\('\/admin\/quiz\/banks\/'/);
    assert.match(html, /\/pages\/admin\/vocab\/quiz\.html\?topic=/);
  });
  test('links to the topic\'s vocab cards via category prefilter', () => {
    assert.match(html, /\/pages\/admin\/vocab\/content\.html\?category=/);
  });
});

describe('cross-page wiring', () => {
  test('chrome nav registers the topics subsection', () => {
    assert.match(chrome, /slug: 'topics',\s*label: 'Chủ đề \(Topics\)'/);
  });
  test('quiz import page preselects ?topic=', () => {
    assert.match(quiz, /URLSearchParams\(location\.search\)\.get\('topic'\)/);
  });
  test('content page prefilters from ?category=', () => {
    assert.match(content, /URLSearchParams\(location\.search\)\.get\('category'\)/);
  });
});

describe('Pha 4 — grammar exercises wiring', () => {
  const player = readFileSync(path.join(ROOT, 'frontend/pages/quiz.html'), 'utf8');
  test('topic console supports a vocab/grammar skill_area toggle', () => {
    assert.match(html, /get\('skill_area'\) === 'grammar'/);
    assert.match(html, /\/admin\/content-topics\?skill_area=' \+ SKILL/);
    assert.match(html, /id="tp-sk-vocab"/);
    assert.match(html, /id="tp-sk-grammar"/);
  });
  test('quiz import page is skill_area-aware', () => {
    assert.match(quiz, /get\('skill_area'\) === 'grammar'/);
    assert.match(quiz, /\/admin\/content-topics\?skill_area=' \+ SKILL/);
    assert.match(quiz, /\/admin\/quiz\/banks\?skill_area=' \+ SKILL/);
  });
  test('chrome nav exposes Grammar → exercises (shared console, grammar mode)', () => {
    assert.match(chrome, /slug: 'exercises',\s*label: 'Bài tập \(Exercises\)',\s*href: '\/pages\/admin\/vocab\/topics\.html\?skill_area=grammar'/);
  });
  test('player shows a "review article" link on a wrong grammar answer', () => {
    assert.match(player, /article_url/);
    assert.match(player, /Ôn lại bài/);
  });
});
