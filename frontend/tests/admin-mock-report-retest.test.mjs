import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const JS = readFileSync(join(root, 'public', 'js', 'admin-mock-report.js'), 'utf8');
const HTML = readFileSync(join(root, 'public', 'pages', 'admin', 'mock-reviews', 'report.html'), 'utf8');
const NEXT = readFileSync(join(root, 'app', '(authed-admin-mock-reviews)', 'admin', 'mock-reviews', 'report', 'admin-mock-review-report.tsx'), 'utf8');

const lift = (source, regex, label) => {
  const match = source.match(regex);
  assert.ok(match, `could not lift ${label}`);
  return match[0];
};

const renderRetestSource = lift(
  JS,
  /function renderRetest\(retestFlags\) \{[\s\S]*?\n  \}/,
  'renderRetest',
);
const reportSkillsSource = lift(
  JS,
  /function reportSkills\(requiredSkills, finalBands\) \{[\s\S]*?\n  \}/,
  'reportSkills',
);

function runReportSkills(requiredSkills, finalBands) {
  const SKILL_VI = { listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };
  return new Function(
    'requiredSkills',
    'finalBands',
    'SKILL_VI',
    `${reportSkillsSource}\nreturn reportSkills(requiredSkills, finalBands);`,
  )(requiredSkills, finalBands, SKILL_VI);
}

function runRenderRetest(flags) {
  const classes = new Set(['rp-retest', 'hidden']);
  const wrap = {
    innerHTML: '',
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  const el = (id) => (id === 'rp-retest' ? wrap : null);
  const SKILL_VI = { listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };
  const esc = (value) => String(value);
  new Function('retestFlags', 'el', 'SKILL_VI', 'esc', `${renderRetestSource}\nrenderRetest(retestFlags);`)(
    flags, el, SKILL_VI, esc,
  );
  return { wrap, classes };
}

describe('admin mock report — retest preserves the completed score report', () => {
  test('the report no longer blocks when a retest flag is true', () => {
    assert.doesNotMatch(JS, /needsRetest/);
    assert.doesNotMatch(JS, /còn kỹ năng cần test lại — chưa thể tạo phiếu/);
    assert.match(JS, /renderRetest\(review\.retest_flags \|\| \{\}\)/);
  });

  test('a Speaking retest renders a visible instruction while keeping this result official', () => {
    const { wrap, classes } = runRenderRetest({ speaking: true });
    assert.ok(!classes.has('hidden'));
    assert.match(wrap.innerHTML, /Cần test lại: Speaking/);
    assert.match(wrap.innerHTML, /vẫn là kết quả chính thức của lần mock test này/);
  });

  test('multiple retest skills are named and no flags keep the banner hidden', () => {
    assert.match(runRenderRetest({ listening: true, speaking: true }).wrap.innerHTML,
      /Listening, Speaking/);
    const empty = runRenderRetest({});
    assert.ok(empty.classes.has('hidden'));
    assert.equal(empty.wrap.innerHTML, '');
  });

  test('the report owns a semantic retest banner', () => {
    assert.match(HTML, /id="rp-retest" class="rp-retest hidden" role="note"/);
    assert.match(NEXT, /className="mrr-report-retest" role="note"/);
    assert.match(NEXT, /retestSkills\.length > 0/);
    assert.match(NEXT, /window\.print\(\)/);
    assert.doesNotMatch(NEXT, /Object\.values\(detail\.review\.retestFlags\)\.some\(Boolean\)/);
  });

  test('teacher-assessed live Speaking stays visible outside the LRW exam config', () => {
    assert.deepEqual(
      runReportSkills(
        ['listening', 'reading', 'writing'],
        { listening: 6, reading: 5.5, writing: 6, speaking: 5.5, overall: 6 },
      ),
      ['listening', 'reading', 'writing', 'speaking'],
    );
    assert.match(JS, /skills\.indexOf\('speaking'\) !== -1/);
  });

  test('an LRW-only result does not invent a Speaking card', () => {
    assert.deepEqual(
      runReportSkills(
        ['listening', 'reading', 'writing'],
        { listening: 6, reading: 5.5, writing: 6, overall: 6 },
      ),
      ['listening', 'reading', 'writing'],
    );
  });
});
