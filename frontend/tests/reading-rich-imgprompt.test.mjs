/**
 * frontend/tests/reading-rich-imgprompt.test.mjs
 *
 * reading-rich Part B — the extracted IMG-PROMPT (Part A → passage
 * metadata.img_prompts; surfaced by the admin preview serve) is shown next to
 * each diagram/flow block's #374 upload control on the run's LEAD question,
 * collapsible + a copy button, for the copy → generate-externally → upload
 * workflow. Matched to its block by qrange. Graceful when a block has none.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const previewJs = read('frontend/js/admin-reading-preview.js');
const css = read('frontend/css/admin-reading.css');
const router = read('backend/routers/admin_reading.py');


describe('A — serve surfaces img_prompts (deployed-only)', () => {
  test('admin preview select includes metadata + maps it to img_prompts', () => {
    // the passages select gained `metadata`, and the handler surfaces a clean
    // img_prompts list while dropping the raw metadata blob.
    assert.match(router, /admin_get_reading_test[\s\S]{0,1200}status,metadata/);
    assert.match(router, /p\["img_prompts"\]\s*=\s*\(p\.pop\("metadata", None\) or \{\}\)\.get\("img_prompts"\)/);
  });
});


describe('B — prompt rendered on the run lead, matched by qrange', () => {
  test('a prompt is matched to its run lead by qrange low bound', () => {
    assert.match(previewJs, /function _qrangeLow\(qrange\)/);
    assert.match(previewJs, /function _promptForLead\(imgPrompts, leadQNum\)/);
    assert.match(previewJs, /_qrangeLow\(ip && ip\.qrange\) === leadQNum/);
    // run detection passes the matched prompt only on the lead
    assert.match(previewJs, /imgPrompt = _promptForLead\(imgPrompts, leadQNum\)/);
    assert.match(previewJs, /renderQuestionsForPassage\(qs, p\.img_prompts\)/);
  });

  test('lead block renders upload control + the IMG-PROMPT (collapsible + copy)', () => {
    assert.match(previewJs, /role\.lead[\s\S]{0,400}renderDiagramControls\(q\) \+ renderImgPrompt\(imgPrompt\)/);
    assert.match(previewJs, /function renderImgPrompt\(ip\)/);
    assert.match(previewJs, /<details class="ar-imgprompt">/);
    assert.match(previewJs, /data-action="copy-prompt"/);
    assert.match(previewJs, /copy để generate/);
  });

  test('copy button copies the raw prompt via clipboard (XSS-safe escapeHtml render)', () => {
    // displayed via escapeHtml; copied from the <pre> textContent (round-trips)
    assert.match(previewJs, /'<pre class="ar-imgprompt__text">' \+ escapeHtml\(ip\.prompt\)/);
    assert.match(previewJs, /navigator\.clipboard\.writeText\(text\)/);
    assert.match(previewJs, /pre\.textContent/);
  });
});


describe('C — graceful + no regression', () => {
  test('no matching prompt → renderImgPrompt returns empty (block shows only upload)', () => {
    assert.match(previewJs, /function renderImgPrompt\(ip\)\s*\{\s*if \(!ip \|\| !ip\.prompt\) return ''/);
  });

  test('#374 upload control + non-lead shared-note unchanged', () => {
    assert.match(previewJs, /function renderDiagramControls\(q\)/);
    assert.match(previewJs, /upload-diagram-image/);
    assert.match(previewJs, /Dùng chung ảnh sơ đồ với Q/);
  });

  test('prompt styles are token-driven (no undefined --av-space)', () => {
    const block = css.replace(/\/\*[\s\S]*?\*\//g, '')
      .match(/\.ar-imgprompt[\s\S]*?(?=\n\/\*|\n\.ar-(?!imgprompt)|$)/);
    assert.ok(block, 'ar-imgprompt styles present');
    assert.match(block[0], /var\(--av-/);
    assert.ok(!/--av-space-(5|7|9|10|11|13|14|15)\b/.test(block[0]));
  });
});
