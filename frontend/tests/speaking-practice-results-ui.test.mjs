import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

const legacySpeaking = read('public/pages/speaking.html');
const nextSpeaking = read('app/(authed-speaking)/speaking/page-shell.tsx');
const speakingCss = read('public/css/speaking.css');
const practice = read('public/pages/practice.html');
const practiceCss = read('public/css/practice.css');
const result = read('public/pages/result.html');
const resultCss = read('public/css/result.css');
const fullResult = read('public/pages/full-test-result.html');
const fullResultCss = read('public/css/full-test-result.css');

describe('three Speaking setup modes', () => {
  for (const source of [legacySpeaking, nextSpeaking]) {
    test('each shell exposes truthful orientation facts', () => {
      assert.match(source, /aria-label=["']Thông tin chế độ Luyện tập["']/);
      assert.match(source, /aria-label=["']Thông tin chế độ Luyện từng Part["']/);
      assert.match(source, /aria-label=["']Thông tin chế độ Full Test["']/);
      assert.match(source, /Ngay sau khi nói/);
      assert.match(source, /Tổng kết cuối phiên/);
      assert.match(source, /Khoảng 11–14 phút/);
    });

    test('Part selectors are native buttons and Full Test separates readiness', () => {
      for (const part of [1, 2, 3]) {
        assert.match(source, new RegExp(`<button[^>]+id=["']pbp-card-${part}["']`));
      }
      assert.match(source, /class(?:Name)?=["']fulltest-setup-grid["']/);
      assert.match(source, /class(?:Name)?=["']fulltest-start-panel["']/);
    });
  }

  test('setup CSS has desktop and mobile layouts plus keyboard focus', () => {
    assert.match(speakingCss, /\.speaking-mode-facts\s*\{/);
    assert.match(speakingCss, /\.fulltest-setup-grid\s*\{[\s\S]*?grid-template-columns:/);
    assert.match(speakingCss, /\.pbp-part-card:focus-visible/);
    assert.match(speakingCss, /@media\s*\(max-width:\s*640px\)/);
  });
});

describe('shared Speaking player and immediate feedback', () => {
  test('core player states opt into one stable stage without changing IDs', () => {
    for (const id of ['state-mode-choice', 'state-prep', 'state-p2a', 'state-p2b',
      'state-p2c', 'state-feedback', 'state-completion', 'state-test-results']) {
      assert.match(practice, new RegExp(`id=["']${id}["'][^>]*practice-stage`));
    }
  });

  test('feedback is grouped into overview, evidence, learning, and actions', () => {
    assert.match(practice, /class="practice-feedback-header"/);
    assert.match(practice, /class="practice-feedback-overview"/);
    assert.match(practice, /class="practice-feedback-evidence"/);
    assert.match(practice, /class="practice-feedback-actions/);
    assert.match(practiceCss, /\.practice-feedback-overview\s*\{/);
    assert.match(practiceCss, /\.practice-feedback-evidence\s*\{/);
  });
});

describe('single-session result workspace', () => {
  test('prioritizes canonical score, coaching focus, evidence, then actions', () => {
    const score = result.indexOf('class="result-score-panel"');
    const coaching = result.indexOf('class="result-coaching-panel"');
    const details = result.indexOf('class="result-detail-section"');
    const actions = result.indexOf('class="result-action-bar');
    assert.ok(score > -1 && score < coaching && coaching < details && details < actions);
    assert.match(result, /id="result-learning-section"[^>]+style="display:none;"/);
    assert.match(result, /if \(section\) section\.style\.display = '';/);
    for (const id of ['overall-band', 'criterion-grid', 'strengths-list',
      'improvements-list', 'accordion-container', 'btn-retry']) {
      assert.match(result, new RegExp(`id=["']${id}["']`));
    }
  });

  test('workspace collapses to one column on narrow screens', () => {
    assert.match(resultCss, /\.result-overview-grid\s*\{[\s\S]*?grid-template-columns:/);
    assert.match(resultCss, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.result-overview-grid/);
    assert.match(resultCss, /\.result-action-bar\s*\{[\s\S]*?position:\s*sticky/);
  });
});

describe('Full Test summary workspace', () => {
  test('pairs the canonical overall band with criteria and groups analysis', () => {
    assert.match(fullResult, /class="ftr-hero-grid"/);
    assert.match(fullResult, /class="ftr-criteria-panel"/);
    assert.match(fullResult, /class="ftr-analysis-grid/);
    assert.match(fullResult, /class="ftr-action-bar/);
    for (const id of ['overall-band', 'crit-fc', 'crit-lr', 'crit-gra', 'crit-p',
      'parts-grid', 'grammar-list', 'pron-radar', 'detail-links']) {
      assert.match(fullResult, new RegExp(`id=["']${id}["']`));
    }
  });

  test('Full Test summary has responsive overview and analysis layouts', () => {
    assert.match(fullResultCss, /\.ftr-hero-grid\s*\{/);
    assert.match(fullResultCss, /\.ftr-analysis-grid\s*\{/);
    assert.match(fullResultCss, /@media\s*\(max-width:\s*900px\)/);
  });
});
