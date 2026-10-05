import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({ window: {} });
vm.runInContext(readFileSync(new URL('../public/js/writing-renderers.js', import.meta.url), 'utf8'), context);
const render = context.window.WritingRenderers.SECTION_RENDERERS.counterargument;

test('renders the persisted ContextInsertion schema without changing feedback or accepting markup', () => {
  const value = { isPresent: false, feedback: 'Cần xét quan điểm khác.', suggestion: 'Thêm phản đề.', context: { insertionPoint: 'Sau đoạn 2 <script>alert(1)</script>', reasoning: 'Giữ liên kết với luận điểm.' } };
  const before = JSON.stringify(value);
  const html = render(value);
  assert.ok(html.includes('Sau đoạn 2 &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Giữ liên kết với luận điểm.'));
  assert.ok(html.includes('Cần xét quan điểm khác.'));
  assert.ok(html.includes('Thêm phản đề.'));
  assert.ok(html.includes('Không có counterargument'));
  assert.ok(!html.includes('[object Object]'));
  assert.equal(JSON.stringify(value), before);
});

test('retains legacy text context and instruction suggestions', () => {
  const html = render({ isPresent: true, context: 'Sau phần mở bài.', feedback: 'Phản đề phù hợp.', suggestion: { instruction: 'Bổ sung dẫn chứng.' } });
  for (const text of ['Có counterargument', 'Sau phần mở bài.', 'Phản đề phù hợp.', 'Bổ sung dẫn chứng.']) assert.ok(html.includes(text));
});

test('renders partial schema context and omits empty context fields', () => {
  const html = render({ isPresent: false, context: { insertionPoint: '', reasoning: 'Phản đề chưa được hỗ trợ.' } });
  assert.ok(html.includes('Phản đề chưa được hỗ trợ.'));
  assert.ok(!html.includes('Vị trí bổ sung:'));
  for (const context of [null, {}, { insertionPoint: '', reasoning: '' }]) {
    const empty = render({ isPresent: false, context });
    assert.ok(empty.includes('Không có counterargument'));
    assert.ok(!/\[object Object\]|undefined|>null</.test(empty));
  }
});

test('does not stringify malformed nested objects or arrays as prose', () => {
  const html = render({ isPresent: false, context: ['bad'], feedback: { text: 'bad' }, suggestion: { instruction: { text: 'bad' } } });
  assert.ok(!/\[object Object\]|undefined|>null<|>bad</.test(html));
});
