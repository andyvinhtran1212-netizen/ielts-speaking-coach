// Execute the deployed controller's preview lifecycle, including failed and
// stale permission reads. Geometry/CLS is covered by the rendered Next harness.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

const source = readFileSync(new URL('../app/(authed-writing)/writing/dashboard/writing-behavior.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const dom = new JSDOM(`<div id="content" class="wd-permissions-pending">
    <div id="writing-preview-banner" class="hidden">Chế độ xem trước</div>
    <button class="btn-start-assignment">Bắt đầu</button>
    <button id="modal-btn-submit">Nộp bài</button>
  </div>`);
  const exports = {};
  const warnings = [];
  vm.runInNewContext(compiled + '\nexports.preview = prepareWritingPreview; exports.gate = applyWritingPermissionGating;', {
    exports, require: () => ({}), document: dom.window.document,
    console: { warn: (...args) => warnings.push(args) },
  });
  const node = id => dom.window.document.getElementById(id);
  return { ...exports, node, warnings, close: () => dom.window.close() };
}

for (const [label, perms, permitted] of [
  ['Writing access', { writing: true }, true],
  ['no Writing access', { writing: false }, false],
  ['missing Writing flag', {}, false],
  ['truthy non-boolean flag', { writing: 'true' }, false],
]) {
  test(`preview first paint and post-render buttons agree for ${label}`, async t => {
    const h = harness(); t.after(h.close);
    let release;
    const permissions = new Promise(resolve => { release = resolve; });
    const preparing = h.preview(permissions, () => true);
    assert.ok(h.node('content').classList.contains('wd-permissions-pending'));
    release(perms);
    await preparing;
    assert.equal(h.node('content').classList.contains('wd-permissions-pending'), false);
    assert.equal(h.node('writing-preview-banner').classList.contains('hidden'), permitted);
    await h.gate(permissions, () => true);
    assert.equal(h.node('modal-btn-submit').disabled, !permitted);
    assert.equal(h.node('content').querySelector('.btn-start-assignment').disabled, !permitted);
    assert.equal(h.warnings.length, 0);
  });
}

test('rejected permission read releases pending content and retains the existing warning', async t => {
  const h = harness(); t.after(h.close);
  const permissions = Promise.reject(new Error('fixture timeout'));
  await h.preview(permissions, () => true);
  assert.equal(h.node('content').classList.contains('wd-permissions-pending'), false);
  assert.ok(h.node('writing-preview-banner').classList.contains('hidden'));
  await h.gate(permissions, () => true);
  assert.equal(h.warnings.length, 1);
});

test('empty permission response releases pending content without inventing a permission', async t => {
  const h = harness(); t.after(h.close);
  await h.preview(Promise.resolve(null), () => true);
  assert.equal(h.node('content').classList.contains('wd-permissions-pending'), false);
  assert.ok(h.node('writing-preview-banner').classList.contains('hidden'));
});

for (const rejected of [false, true]) {
  test(`a stale ${rejected ? 'rejected' : 'resolved'} read cannot reveal another learner's content`, async t => {
    const h = harness(); t.after(h.close);
    let release, reject;
    const permissions = new Promise((resolve, fail) => { release = resolve; reject = fail; });
    let current = true;
    const preparing = h.preview(permissions, () => current);
    current = false;
    if (rejected) reject(new Error('stale timeout'));
    else release({ writing: false });
    await preparing;
    assert.ok(h.node('content').classList.contains('wd-permissions-pending'));
    assert.ok(h.node('writing-preview-banner').classList.contains('hidden'));
  });
}
