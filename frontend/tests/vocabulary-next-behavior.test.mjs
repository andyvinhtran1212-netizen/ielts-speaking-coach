import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(public-content)', 'vocabulary', 'page.tsx');
const CLIENT = read('app', '(public-content)', 'vocabulary', 'vocabulary-wiki.tsx');
const API = read('lib', 'vocabulary-api.ts');
const LAYOUT = read('app', '(public-content)', 'layout.tsx');
const PARITY = read('tooling', 'parity-diff.mjs');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/vocabulary native public wiki', () => {
  test('route is public PPR and loads canonical server data', () => {
    assert.match(PAGE, /<Suspense fallback={<VocabularySkeleton \/>}>/);
    assert.match(PAGE, /getVocabularyCategories\(\)/);
    assert.match(PAGE, /getVocabularyArticle\(selected\.category, selected\.slug\)/);
    assert.match(API, /getPublicJson\('\/api\/vocabulary\/categories'\)/);
    assert.match(API, /\/api\/vocabulary\/articles\/\$\{encodeURIComponent\(category\)\}\/\$\{encodeURIComponent\(slug\)\}/);
    assert.doesNotMatch(PAGE, /AuthProvider|login\.html|vocabulary\.js/);
  });

  test('React owns compound identity, filters, clean deep links and stale-request abort', () => {
    assert.match(CLIENT, /vocabularyKey\(word\.category, word\.slug\)/);
    assert.match(CLIENT, /word\.glossVi\.toLocaleLowerCase/);
    assert.match(CLIENT, /requestRef\.current\?\.abort\(\)/);
    assert.match(CLIENT, /new AbortController\(\)/);
    assert.match(CLIENT, /normalizeVocabularyArticle\(payload, word\.category, word\.slug\)/);
    assert.match(CLIENT, /replaceState\(null, '', `\/vocabulary\?cat=/);
    assert.match(CLIENT, /setShowDetail\(false\)/);
    assert.match(CLIENT, /<button type="button" className="vmd-row-main"/);
    assert.doesNotMatch(CLIENT, /className={`vmd-row[^\n]*[\s\S]{0,120}role="button"/);
  });

  test('audio, anonymous feedback and analytics keep their canonical contracts', () => {
    assert.match(CLIENT, /new Audio\(audio\)/);
    assert.match(CLIENT, /new SpeechSynthesisUtterance\(say\)/);
    assert.match(CLIENT, /window\.speechSynthesis\?\.cancel\(\)/);
    assert.match(CLIENT, /window\.api\.post\('\/api\/feedback'/);
    assert.match(CLIENT, /skill: 'vocabulary'/);
    assert.match(CLIENT, /category: reason === 'audio' \? 'audio_issue' : 'content_issue'/);
    assert.match(CLIENT, /event_name: 'vocab_wiki_viewed'/);
  });

  test('legacy card stylesheet remains before Tailwind and public parity covers both widths', () => {
    assert.ok(LAYOUT.indexOf('/css/vocab-wiki.css') < LAYOUT.indexOf('/css/tailwind.build.css'));
    assert.match(PARITY, /name: 'vocabulary-wiki'/);
    assert.match(PARITY, /legacy: '\/vocabulary\.html\?cat=technology&slug=cutting-edge'/);
    assert.match(PARITY, /next: '\/vocabulary\?cat=technology&slug=cutting-edge'/);
    assert.match(WORKFLOW, /frontend\/app\/\(public-content\)\/vocabulary\/\*\*/);
    assert.match(WORKFLOW, /Kiểm luồng Vocabulary Wiki native[\s\S]*?verify-vocabulary-wiki-flow\.mjs/);
  });

  test('auth-aware chrome and learner/admin entry points use the clean owner URL', () => {
    const chrome = read('public', 'js', 'components', 'aver-chrome.js');
    const hub = read('app', '(authed-vocabulary-hub)', 'vocabulary', 'hub', 'vocabulary-hub-behavior.tsx');
    const feedback = read('lib', 'admin-feedback-model.mjs');
    assert.match(chrome, /loggedIn \? '\/vocabulary\/hub' : '\/vocabulary'/);
    assert.doesNotMatch(chrome, /loggedIn \? '\/vocabulary\/hub' : '\/vocabulary\.html'/);
    assert.match(hub, /href={`\/vocabulary\?cat=\$\{encodedSlug\}`}/);
    assert.match(feedback, /`\/vocabulary\?cat=\$\{encodeURIComponent/);
  });
});
