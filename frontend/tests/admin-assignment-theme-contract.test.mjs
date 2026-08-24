import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const assignments = read('public', 'css', 'admin-writing-assignments-next.css');
const prompts = read('public', 'css', 'admin-writing-prompts-next.css');
const classes = read('public', 'css', 'admin-classes-next.css');
const students = read('public', 'css', 'admin-students-next.css');
const homework = read('public', 'css', 'admin-class-homework-next.css');
const classDetail = read('public', 'css', 'admin-class-detail-next.css');
const myClassBase = read('public', 'css', 'my-class-base.css');
const myClass = read('public', 'css', 'my-class.css');
const tokens = read('public', 'css', 'aver-design', 'tokens.css');

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(left, right) {
  const [bright, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

function blend(foreground, alpha, background) {
  return foreground.map((value, index) => value * alpha + background[index] * (1 - alpha));
}

function mediaBlock(css, width) {
  const match = new RegExp(`@media\\s*\\(max-width:\\s*${width}px\\)\\s*\\{`).exec(css);
  assert.ok(match, `missing ${width}px media query`);
  let depth = 1;
  let end = match.index + match[0].length;
  for (; end < css.length && depth > 0; end += 1) {
    if (css[end] === '{') depth += 1;
    else if (css[end] === '}') depth -= 1;
  }
  assert.equal(depth, 0, `unclosed ${width}px media query`);
  return css.slice(match.index + match[0].length, end - 1);
}

const auditedCss = [assignments, prompts, classes, students, homework, classDetail, myClassBase, myClass];

describe('admin assignment surfaces use theme-owned semantic color roles', () => {
  test('Writing assignment interaction and receipt states do not use fixed teal palette values', () => {
    for (const css of auditedCss) assert.doesNotMatch(css, /--av-brand-teal-/);
    for (const token of ['--av-primary-soft', '--av-primary-border', '--av-text-on-primary']) {
      assert.ok(assignments.includes(token), token);
    }
    assert.match(assignments, /\.awa-option:hover\{background:color-mix\(in srgb,var\(--av-primary\) 8%,var\(--av-surface-card\)\)\}/);
  });

  test('Writing prompt visual and analysis states follow the active theme', () => {
    assert.match(prompts, /\.awp-card__visual[^}]+--av-primary-soft/);
    assert.match(prompts, /\.awp-analysis\.is-ready[^}]+--av-primary-border[^}]+--av-primary-soft[^}]+--av-primary/);
    assert.match(prompts, /\.acd-dialog :is\(a,button,input,select,textarea\):focus-visible\{outline:2px solid var\(--av-primary\)/);
    assert.match(assignments, /\.acd-dialog :is\(a,button,input,select,textarea\):focus-visible\{outline:2px solid var\(--av-primary\)/);
  });

  test('Class, student and homework interactive foregrounds use --av-primary', () => {
    for (const css of [classes, students, homework, classDetail]) {
      assert.doesNotMatch(css, /color:\s*var\(--av-brand-teal-(?:700|800)\)/);
    }
    assert.match(homework, /label:has\(input:checked\)[^}]+--av-primary-border[^}]+--av-primary-soft[^}]+--av-primary/);
  });
});

describe('wide admin tables become labelled mobile cards', () => {
  test('class homework keeps every operational value without horizontal scrolling', () => {
    const mobile = mediaBlock(homework, 768);
    assert.match(mobile, /\.ach-table thead\s*\{[^}]*clip:/);
    assert.match(mobile, /\.ach-table \.ach-due-cell::before\s*\{\s*content:\s*'Hạn nộp'\s*\/\s*''/);
    assert.match(mobile, /\.ach-table \.ach-progress-cell::before\s*\{\s*content:\s*'Tình hình nộp'\s*\/\s*''/);
  });

  test('student directory preserves class, account and goal context on mobile', () => {
    const mobile = mediaBlock(students, 768);
    assert.match(mobile, /\.asd-table thead\s*\{[^}]*clip:/);
    assert.match(mobile, /\.asd-table \.asd-cohort-cell::before\s*\{\s*content:\s*'Lớp'\s*\/\s*''/);
    assert.match(mobile, /\.asd-table \.asd-account-cell::before\s*\{\s*content:\s*'Tài khoản'\s*\/\s*''/);
    assert.match(mobile, /\.asd-table \.asd-goal-cell::before\s*\{\s*content:\s*'Mục tiêu'\s*\/\s*''/);
  });

  test('prompt assignment primary action is reachable at phone width', () => {
    assert.match(mediaBlock(prompts, 520), /\.awp-card footer \.adm-btn-primary\{[^}]*grid-column:1\/-1/);
  });
});

describe('meaningful small copy stays on the AA text ladder', () => {
  test('semantic tokens are defined for explicit light and dark themes', () => {
    for (const token of ['--av-primary-soft:', '--av-primary-border:', '--av-text-on-primary:']) {
      assert.ok(tokens.split(token).length - 1 >= 2, `${token} needs light and dark definitions`);
    }
  });

  test('secondary text clears 4.5:1 on light and dark page/card surfaces', () => {
    assert.match(tokens, /--av-text-secondary:\s*rgba\(15, 23, 42, 0\.68\)/);
    for (const surface of [[255, 255, 255], [250, 250, 249]]) {
      assert.ok(contrast(blend([15, 23, 42], 0.68, surface), surface) >= 4.5);
    }
    assert.match(tokens, /--av-text-secondary:\s*rgba\(241, 245, 249, 0\.72\)/);
    for (const surface of [[17, 34, 54], [10, 22, 40]]) {
      assert.ok(contrast(blend([241, 245, 249], 0.72, surface), surface) >= 4.5);
    }
  });

  test('primary foreground clears 4.5:1 over its soft light and dark surfaces', () => {
    for (const surface of [[255, 255, 255], [250, 250, 249]]) {
      const soft = blend([15, 118, 110], 0.08, surface);
      assert.ok(contrast([15, 118, 110], soft) >= 4.5);
    }
    for (const surface of [[17, 34, 54], [10, 22, 40]]) {
      const soft = blend([20, 184, 166], 0.12, surface);
      assert.ok(contrast([20, 184, 166], soft) >= 4.5);
    }
  });

  test('audited metadata selectors use secondary rather than muted copy', () => {
    for (const [name, css, selectors] of [
      ['assignments', assignments, ['.awa-row small', '.awa-option small', '.awa-review dt']],
      ['prompts', prompts, ['.awp-overview span', '.awp-filters label>span']],
      ['classes', classes, ['.acd-tabs a small', '.acd-field > span', '.acd-result-bar']],
      ['students', students, ['.asd-goal span', '.asd-stats span', '.asd-profile li small']],
      ['homework', homework, ['.ach-table td > small', '.ach-progress span', '.ach-log-row time']],
      ['my-class-base', myClassBase, ['.mc-rhythm__label', '.mc-stat-label', '.mc-item-sub', '.mc-empty']],
      ['my-class', myClass, ['.mc-section-head > p', '.mc-item-kind']],
    ]) {
      for (const selector of selectors) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(css, new RegExp(`${escaped}[^}]*--av-text-secondary`), `${name}: ${selector}`);
      }
    }
  });
});
