/**
 * admin-listening-fulltest-import.test.mjs — admin-fulltest-import-ui.
 *
 * Phase A (import page) + Phase B (publish/archive on the tests list). Static
 * sentinels pin the wiring + the contracts, plus real-value checks where the
 * helper is pure:
 *   • token is AUTOMATIC (window.api / supabase session) — no pasted JWT;
 *   • Lesson 16: a dry-run with errors HARD-disables the Import button;
 *   • dup-ACTIVE = archive-old-then-commit in one action;
 *   • 26MB commit shows real upload progress (xhr.upload.onprogress);
 *   • Phase B status buttons PATCH /tests/{id}/status then refetch (no optimistic).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const html     = read('frontend/pages/admin/listening/import-fulltest.html');
const js       = read('frontend/js/admin-listening-fulltest-import.js');
const testsHtml = read('frontend/pages/admin/listening/tests.html');
const listJs   = read('frontend/js/admin-listening-tests-list.js');
const router   = read('backend/routers/listening.py');


describe('Phase A — import page shell (admin chrome + 4 files + steps)', () => {
  test('reuses admin chrome + api.js + loads the module', () => {
    assert.match(html, /<aver-admin-chrome active="listening"/);
    assert.match(html, /src="\/js\/api\.js"/);
    assert.match(html, /src="\/js\/admin-listening-fulltest-import\.js"/);
  });
  test('has the 4 pack file inputs (qp · solution · timings · audio)', () => {
    for (const id of ['fi-qp', 'fi-sol', 'fi-tim', 'fi-aud']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
    assert.match(html, /id="fi-aud"[^>]*accept="audio\/mpeg,\.mp3"/);
  });
  test('ships the 3-step buttons: Kiểm tra (dry-run) → Import → Publish', () => {
    assert.match(html, /id="fi-check"/);
    assert.match(html, /id="fi-import"/);
    assert.match(html, /id="fi-archive-import"/);       // dup-ACTIVE combined action
    assert.match(html, /id="fi-publish"/);
    assert.match(html, /id="fi-progress-bar"/);         // upload progress (26MB)
  });
});


describe('Phase A — token is AUTOMATIC (no pasted JWT)', () => {
  test('dry-run goes through window.api.upload (Bearer attached by api.js)', () => {
    assert.match(js, /window\.api\.upload\('\/admin\/listening\/import-fulltest', fd\)/);
  });
  test('commit XHR reuses the supabase SESSION token — never a hand-typed one', () => {
    assert.match(js, /getSupabase\(\)\.auth\.getSession\(\)/);
    assert.match(js, /setRequestHeader\('Authorization', 'Bearer ' \+ token\)/);
    assert.match(js, /window\.api\.base \+ '\/admin\/listening\/import-fulltest\/commit'/);
  });
});


describe('Phase A — Lesson 16: dry-run errors HARD-block commit', () => {
  test('Import enabled only when ok && audio && not-duplicate; canBase gates on p.ok', () => {
    const fn = js.slice(js.indexOf('function refreshImportBtns'), js.indexOf('// ── STEP 2'));
    assert.match(fn, /var canBase = !!p\.ok && !STATE\.busy/);            // ok required
    assert.match(fn, /importBtn\.disabled = !\(canBase && hasAudio && !dup\)/);
    assert.match(fn, /archiveBtn\.disabled = !\(canBase && hasAudio && dup\)/);
  });
  test('a failed dry-run renders the per-error list (escaped) and no green ok', () => {
    const fn = js.slice(js.indexOf('function renderResult'), js.indexOf('function refreshImportBtns'));
    assert.match(fn, /fi-banner--err/);
    assert.match(fn, /p\.errors\.map/);
    assert.match(fn, /escapeHtml\(e\)/);          // XSS-safe error render
  });
});


describe('Phase A — dup-ACTIVE handled in one action (archive old → commit)', () => {
  test('onArchiveImport finds the live bundle by test_id, archives it, then commits', () => {
    const fn = js.slice(js.indexOf('async function onArchiveImport'), js.indexOf('function renderDone'));
    assert.match(fn, /\/admin\/listening\/tests\?status=all/);                 // look up by test_id
    assert.match(fn, /t\.status !== 'archived'/);                              // the ACTIVE one
    assert.match(fn, /patchStatus\(id, 'archived'\)/);                         // PATCH archive (via helper)
    assert.match(fn, /return doCommit\(\)/);                                    // commit dep calls doCommit
  });
});


describe('Phase A — 26MB upload shows real progress', () => {
  test('the commit XHR reports upload progress into the bar', () => {
    assert.match(js, /xhr\.upload\.onprogress/);
    assert.match(js, /function setProgress/);
    const sp = js.slice(js.indexOf('function setProgress'));
    assert.match(sp, /\$\('fi-progress-bar'\)\.style\.width = pct \+ '%'/);
  });
  test('publish posts the status transition for the freshly imported test', () => {
    const fn = js.slice(js.indexOf('async function onPublish'));
    assert.match(fn, /\/admin\/listening\/tests\/'\s*\+\s*encodeURIComponent\(STATE\.newTest\.id\)\s*\+\s*'\/status'/);
    assert.match(fn, /\{ status: 'published' \}/);
  });
});


describe('Phase B — publish/archive on the tests list (replaces manual SQL)', () => {
  test('statusActions returns the right buttons per status (real value)', () => {
    const m = listJs.match(/function statusActions\(t\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'statusActions present');
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const fn = new Function('escapeHtml', m[0] + '\nreturn statusActions;')(esc);
    const labels = (t) => (fn(t).match(/>([^<]+)<\/button>/g) || []).map((x) => x.replace(/[><]|\/button/g, '').trim());
    assert.deepEqual(labels({ id: 'a', status: 'draft' }),     ['Publish', 'Archive']);
    assert.deepEqual(labels({ id: 'a', status: 'published' }), ['Archive']);
    assert.deepEqual(labels({ id: 'a', status: 'archived' }),  ['Khôi phục']);
    assert.match(fn({ id: 'x"y', status: 'draft' }), /data-id="x&quot;y"/);   // XSS-safe id
  });
  test('changeStatus PATCHes /tests/{id}/status then REFETCHES (no optimistic state)', () => {
    const fn = listJs.slice(listJs.indexOf('async function changeStatus'));
    assert.match(fn, /window\.api\.patch\(`\/admin\/listening\/tests\/\$\{encodeURIComponent\(id\)\}\/status`, \{ status \}\)/);
    assert.match(fn, /fetchTests\(\)/);                       // canonical refetch
    assert.match(fn, /confirm\(/);                            // archive is confirmed
  });
  test('the rows wire a delegated click handler for the status buttons', () => {
    assert.match(listJs, /\.tl-status-btn/);
    assert.match(listJs, /closest\('\.tl-status-btn'\)/);
    assert.match(listJs, /changeStatus\(b\.dataset\.id, b\.dataset\.status\)/);
  });
  test('the tests page links to the new import flow', () => {
    assert.match(testsHtml, /href="\/pages\/admin\/listening\/import-fulltest\.html"/);
  });
});


describe('Phase A — 4 slots: all-four gating + multi-file auto-routing', () => {
  test('Kiểm tra requires ALL 4 files (qp + solution + timings + audio)', () => {
    const fn = js.slice(js.indexOf('function refreshCheckBtn'), js.indexOf('async function onCheck'));
    assert.match(fn, /f\.question_paper && f\.solution && f\.timings && f\.audio/);
  });
  test('_routeField maps each dropped file to the right slot (real value)', () => {
    const m = js.match(/function _routeField\(name\) \{[\s\S]*?\n  \}/);
    assert.ok(m, '_routeField present');
    const routeField = new Function(m[0] + '\nreturn _routeField;')();
    assert.equal(routeField('ILR_LIS_001_Question_Paper.md'), 'question_paper');
    assert.equal(routeField('ILR_LIS_001_Solution.md'), 'solution');
    assert.equal(routeField('timings.json'), 'timings');
    assert.equal(routeField('full_test.mp3'), 'audio');
    assert.equal(routeField('notes.txt'), null);
  });
  test('a multi-file drop auto-routes each file (drag all 4 at once works)', () => {
    const fn = js.slice(js.indexOf('function acceptFiles'), js.indexOf('function wireDrop'));
    assert.match(fn, /files\.length === 1.*assignToSlot\(slotField, files\[0\]\)/s);
    assert.match(fn, /assignToSlot\(_routeField\(f\.name\), f\)/);     // each routed
  });
  test('HTML guides dragging all 4 + numbered labels', () => {
    assert.match(html, /class="fi-droptip"/);
    assert.match(html, /1 · Đề/);
    assert.match(html, /4 · Audio/);
  });
});


describe('Phase B — content preview + IMG-PROMPT extraction (real value)', () => {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function loadPreview() {
    const m = js.match(/function previewHtml\(p\) \{[\s\S]*?\n  \}/);
    assert.ok(m, 'previewHtml present');
    return new Function('escapeHtml', m[0] + '\nreturn previewHtml;')(esc);
  }
  test('renders the REAL question count + prompt + answer from the dry-run', () => {
    const previewHtml = loadPreview();
    const out = previewHtml({ questions: [
      { q_num: 1, section: 'S1', prompt: 'Which city?', answer: 'Brighton' },
      { q_num: 2, section: 'S1', prompt: 'Postcode?', answer: 'BN1 6QR' },
    ] });
    assert.match(out, /Preview nội dung — 2 câu/);
    assert.match(out, /Câu 1/);
    assert.match(out, /Which city\?/);
    assert.match(out, /Brighton/);
  });
  test('a question WITH img_prompt produces a copyable IMG-PROMPT block; without → none', () => {
    const previewHtml = loadPreview();
    const out = previewHtml({ questions: [
      { q_num: 1, section: 'S1', prompt: 'City?', answer: 'Brighton' },                         // no img
      { q_num: 31, section: 'S4', prompt: 'Label the map', img_prompt: 'Top-down museum plan.' },
    ] });
    assert.match(out, /1 IMG-PROMPT/);                          // count in summary
    assert.match(out, /IMG-PROMPT \(câu 31\)/);
    assert.match(out, /data-copy="Top-down museum plan\."/);    // copyable real value
    assert.match(out, /Top-down museum plan\./);
    assert.equal((out.match(/class="fi-imgprompt"/g) || []).length, 1, 'only the q WITH img_prompt gets a block');
  });
  test('XSS-safe + empty questions render nothing', () => {
    const previewHtml = loadPreview();
    assert.equal(previewHtml({ questions: [] }), '');
    const out = previewHtml({ questions: [{ q_num: 1, prompt: '<script>x</script>', answer: '"&<' }] });
    assert.ok(!out.includes('<script>x'), 'prompt escaped');
    assert.match(out, /&lt;script&gt;/);
  });
  test('renderResult wires the preview + HTML has the container', () => {
    assert.match(js, /renderPreview\(p\);/);
    assert.match(html, /id="fi-preview"/);
  });
});


describe('Phase A — Archive & Import recovery-on-failure (no 0-published window)', () => {
  function loadCore() {
    const m = js.match(/async function _archiveThenCommit\(deps\) \{[\s\S]*?\n  \}/);
    assert.ok(m, '_archiveThenCommit present');
    return new Function(m[0] + '\nreturn _archiveThenCommit;')();
  }
  test('commit FAILS after archive → the archived bundle is RESTORED to its prior status', async () => {
    const core = loadCore();
    const calls = [];
    const r = await core({
      listOld: async () => [{ id: 'old1', status: 'published' }],
      archive: async (id) => { calls.push(['archive', id]); },
      commit:  async () => { calls.push(['commit']); return { ok: false, error: 'timeout' }; },
      restore: async (id, status) => { calls.push(['restore', id, status]); },
    });
    assert.equal(r.committed, false);
    assert.deepEqual(r.restored, ['old1']);
    // real value + order: archive → commit → restore(back to published)
    assert.deepEqual(calls, [['archive', 'old1'], ['commit'], ['restore', 'old1', 'published']]);
  });
  test('commit SUCCEEDS → NO restore (old stays archived, new committed)', async () => {
    const core = loadCore();
    const calls = [];
    const r = await core({
      listOld: async () => [{ id: 'old1', status: 'published' }],
      archive: async (id) => { calls.push(['archive', id]); },
      commit:  async () => { calls.push(['commit']); return { ok: true }; },
      restore: async (id, status) => { calls.push(['restore', id, status]); },
    });
    assert.equal(r.committed, true);
    assert.deepEqual(r.restored, []);
    assert.ok(!calls.some((c) => c[0] === 'restore'), 'no restore on success');
  });
  test('restores EACH archived bundle to ITS OWN prior status (draft vs published)', async () => {
    const core = loadCore();
    const restored = [];
    await core({
      listOld: async () => [{ id: 'a', status: 'published' }, { id: 'b', status: 'draft' }],
      archive: async () => {},
      commit:  async () => ({ ok: false, error: 'x' }),
      restore: async (id, status) => { restored.push([id, status]); },
    });
    assert.deepEqual(restored, [['a', 'published'], ['b', 'draft']]);
  });
  test('doCommit signals success/failure so the orchestrator can recover', () => {
    assert.match(js, /return \{ ok: true \}/);
    assert.match(js, /return \{ ok: false, error: msg \}/);
  });
  test('onArchiveImport wires the recovery + a "site still live" message', () => {
    const fn = js.slice(js.indexOf('async function onArchiveImport'), js.indexOf('function renderDone'));
    assert.match(fn, /_archiveThenCommit\(deps\)/);
    assert.match(fn, /đã KHÔI PHỤC/);
    assert.match(fn, /restore: function \(id, status\) \{ return patchStatus\(id, status \|\| 'published'\)/);
  });
});


describe('Phase A — commit enable-gate: both buttons enable after a passing dry-run', () => {
  // Run the REAL refreshImportBtns with injected STATE + fake DOM and assert the
  // actual .disabled values (L20 — not "element exists").
  function gate(state) {
    const m = js.match(/function refreshImportBtns\(\) \{[\s\S]*?\n  \}/);
    assert.ok(m, 'refreshImportBtns present');
    const els = {
      'fi-import':         { disabled: true, hidden: false },
      'fi-archive-import': { disabled: true, hidden: false },
      'fi-import-note':    { hidden: true, textContent: '' },
    };
    const $ = (id) => els[id];
    new Function('STATE', '$', m[0] + '\nreturn refreshImportBtns;')(state, $)();
    return els;
  }
  const ready = (extra) => Object.assign({ preview: { ok: true }, busy: false, files: { audio: {} } }, extra);

  test('no-dup + ok + 4 files + not busy → Import ENABLED (disabled === false)', () => {
    const els = gate(ready({ preview: { ok: true, duplicate_test_id: false } }));
    assert.equal(els['fi-import'].disabled, false);
  });
  test('dup + ok → "Archive & Import" ENABLED (disabled === false)', () => {
    const els = gate(ready({ preview: { ok: true, duplicate_test_id: true } }));
    assert.equal(els['fi-archive-import'].disabled, false);
  });
  test('dry-run FAIL → both commit buttons disabled (L16)', () => {
    const els = gate(ready({ preview: { ok: false } }));
    assert.equal(els['fi-import'].disabled, true);
    assert.equal(els['fi-archive-import'].disabled, true);
  });
  test('regression guard: while busy=true the gate is false (so it MUST be recomputed after busy clears)', () => {
    const els = gate(ready({ preview: { ok: true, duplicate_test_id: false }, busy: true }));
    assert.equal(els['fi-import'].disabled, true);   // the exact bug condition
  });
  test('onCheck recomputes the import gate AFTER STATE.busy clears (the fix)', () => {
    const fin = js.slice(js.indexOf('STATE.busy = false;', js.indexOf('async function onCheck')),
                         js.indexOf('function errText'));
    assert.match(fin, /refreshImportBtns\(\)/);   // recompute lives in the finally, after busy=false
  });
});


describe('cross-ref — the endpoints the UI drives exist + are admin-gated', () => {
  test('dry-run + commit + status-transition routes are present', () => {
    assert.match(router, /@admin_router\.post\("\/import-fulltest"\)/);
    assert.match(router, /@admin_router\.post\("\/import-fulltest\/commit"\)/);
    assert.match(router, /@admin_router\.patch\("\/tests\/\{test_id\}\/status"\)/);
    assert.match(router, /require_admin\(authorization\)/);
  });
});
