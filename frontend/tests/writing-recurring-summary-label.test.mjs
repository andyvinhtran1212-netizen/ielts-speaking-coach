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

test('labels the recurring summary as history-wide, bold, directly above the summary inside the callout', () => {
  const html = render({ summary: 'Cấu trúc câu đơn giản, cần câu phức.', improvements: [], stillRecurring: [] });
  assert.ok(html.startsWith(`<div class="callout-info">${LABEL_HTML}<p>Cấu trúc câu đơn giản, cần câu phức.</p></div>`));
  assert.equal(html.split(LABEL).length - 1, 1);
});

test('keeps escaping the summary below the label', () => {
  const html = render({ summary: 'Lỗi <b>mạo từ</b>' });
  assert.ok(html.includes(`${LABEL_HTML}<p>Lỗi &lt;b&gt;mạo từ&lt;/b&gt;</p>`));
});

test('omits the label when there is no summary', () => {
  for (const value of [
    { summary: '', improvements: ['Mạo từ'], stillRecurring: ['Thì động từ'] },
    { summary: '   ', stillRecurring: ['Thì động từ'] },
    { improvements: ['Mạo từ'] },
    {},
    null,
  ]) {
    const html = render(value);
    assert.ok(!html.includes(LABEL));
    assert.ok(!html.includes('recurring-summary-label'));
  }
  const chips = render({ summary: ' ', stillRecurring: ['Thì động từ'] });
  assert.ok(chips.includes('Thì động từ'));
  assert.ok(!chips.includes('callout-info'));
});
