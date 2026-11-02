import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({ window: {} });
vm.runInContext(readFileSync(new URL('../public/js/writing-renderers.js', import.meta.url), 'utf8'), context);
const render = context.window.WritingRenderers.SECTION_RENDERERS.recurring;

// CM-approved wording (PC-J369). The window is not stated as "5 bài": the
// summary is model-authored and a regrade's history can include this essay.
const LABEL = 'Nhận xét chung qua các bài gần đây của bạn (không riêng bài này):';
const LABEL_HTML = `<strong class="recurring-summary-label">${LABEL}</strong>`;
const STAFF_LABEL = 'Nhận xét chung qua các bài gần đây của học viên (không riêng bài này):';
const STRUCTURE_LABEL = 'Nhận xét chung về cấu trúc câu qua các bài gần đây (không riêng bài này):';
const renderStructure = context.window.WritingRenderers.SECTION_RENDERERS['sentence-structure'];

test('labels the recurring summary as history-wide, bold, directly above the summary inside the callout', () => {
  const html = render({ summary: 'Cấu trúc câu đơn giản, cần câu phức.', improvements: [], stillRecurring: [] });
  assert.ok(html.startsWith(`<div class="callout-info">${LABEL_HTML}<p>Cấu trúc câu đơn giản, cần câu phức.</p></div>`));
  assert.equal(html.split(LABEL).length - 1, 1);
});

test('keeps escaping the summary below the label', () => {
  const html = render({ summary: 'Lỗi <b>mạo từ</b>' });
  assert.ok(html.includes(`${LABEL_HTML}<p>Lỗi &lt;b&gt;mạo từ&lt;/b&gt;</p>`));
});

test('uses the exact staff wording only when the viewer option is set', () => {
  const value = { summary: 'Lỗi <b>mạo từ</b>' };
  for (const options of [undefined, {}, { isStaffViewer: false }]) {
    assert.equal(render(value, options), render(value));
  }
  const html = render(value, { isStaffViewer: true });
  assert.equal(html, render(value).replace(LABEL, STAFF_LABEL));
  assert.ok(html.includes(`<strong class="recurring-summary-label">${STAFF_LABEL}</strong><p>Lỗi &lt;b&gt;mạo từ&lt;/b&gt;</p>`));
});

test('omits the label when there is no summary', () => {
  for (const value of [
    { summary: '', improvements: ['Mạo từ'], stillRecurring: ['Thì động từ'] },
    { summary: '   ', stillRecurring: ['Thì động từ'] },
    { improvements: ['Mạo từ'] },
    {},
    null,
  ]) {
    for (const options of [undefined, { isStaffViewer: true }]) {
      const html = render(value, options);
      assert.ok(!html.includes(LABEL));
      assert.ok(!html.includes(STAFF_LABEL));
      assert.ok(!html.includes('recurring-summary-label'));
    }
  }
  const chips = render({ summary: ' ', stillRecurring: ['Thì động từ'] });
  assert.ok(chips.includes('Thì động từ'));
  assert.ok(!chips.includes('callout-info'));
});

test('labels the history-based sentence summary identically for learners and staff', () => {
  const value = {
    summary: 'Qua các bài: <b>câu phức</b>.',
    current_essay_observation: 'Riêng bài này đã tiến bộ.',
  };
  const html = renderStructure(value);
  assert.ok(html.startsWith(`<div class="prose-block"><strong class="recurring-summary-label">${STRUCTURE_LABEL}</strong><p>Qua các bài: &lt;b&gt;câu phức&lt;/b&gt;.</p></div>`));
  assert.equal(html.split(STRUCTURE_LABEL).length - 1, 1);
  assert.ok(html.includes('📍 Quan sát bài này</span><p>Riêng bài này đã tiến bộ.</p>'));
  assert.equal(renderStructure(value, { isStaffViewer: true }), html);
});

test('does not label absent sentence history or legacy sentence upgrades', () => {
  for (const value of [
    null, {}, { summary: '' }, { summary: '   ' },
    { current_essay_observation: 'Nhận xét riêng bài này.' },
    { sentenceUpgrades: [] },
    { sentenceUpgrades: [{ original: 'It works.', rewritten: 'It works well.' }] },
  ]) {
    const html = renderStructure(value);
    assert.ok(!html.includes('recurring-summary-label'));
  }
  assert.ok(renderStructure({ sentenceUpgrades: [{ original: 'It works.', rewritten: 'It works well.' }] }).includes('It works well.'));
});
