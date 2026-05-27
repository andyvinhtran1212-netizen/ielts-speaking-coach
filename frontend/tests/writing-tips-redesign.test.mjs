/**
 * frontend/tests/writing-tips-redesign.test.mjs — Sprint 19.1B.
 *
 * Pins the writing tips library CMS:
 *   • admin page   /pages/admin/writing/tips.html  (CRUD, mirrors prompts.html)
 *   • shared render js/markdown.js + css/markdown.css (sanitized markdown)
 *   • admin chrome nav entry (subsection="tips")
 *
 * The student-side "Mẹo viết" tab lives in writing-dashboard.html and is
 * pinned by writing-dashboard-redesign.test.mjs.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let html, css, md_js, md_css, chrome_js;

before(() => {
  html      = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/tips.html'), 'utf8');
  css       = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'), 'utf8');
  md_js     = readFileSync(path.join(REPO_ROOT, 'frontend/js/markdown.js'), 'utf8');
  md_css    = readFileSync(path.join(REPO_ROOT, 'frontend/css/markdown.css'), 'utf8');
  chrome_js = readFileSync(path.join(REPO_ROOT, 'frontend/js/components/aver-admin-chrome.js'), 'utf8');
});


describe('admin/writing/tips.html / foundation + chrome', () => {
  test('uses <aver-admin-chrome active="writing" subsection="tips">', () => {
    assert.match(html, /<aver-admin-chrome\s+active="writing"\s+subsection="tips"\s*>/);
  });

  test('foundation order tokens → components → admin-writing.css → markdown.css', () => {
    const t  = html.indexOf('aver-design/tokens.css');
    const c  = html.indexOf('aver-design/components.css');
    const a  = html.indexOf('css/admin-writing.css');
    const m  = html.indexOf('css/markdown.css');
    assert.ok(t > -1 && c > -1 && a > -1 && m > -1, 'all four stylesheets linked');
    assert.ok(t < c && c < a, 'tokens → components → admin-writing order');
  });

  test('canonical anti-flash IIFE present', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.match(html, /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/);
  });

  test('no inline <style> block (class-driven only, Pattern #26)', () => {
    assert.equal((html.match(/<style[\s\S]*?<\/style>/g) || []).length, 0);
  });

  test('Plus Jakarta Sans + JetBrains Mono fonts (no Inter)', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.ok(!/family=Inter\b/.test(html));
  });

  test('api.js loaded via absolute /js path (3-segment rewrite safe)', () => {
    assert.match(html, /<script\s+src="\/js\/api\.js">/);
  });
});


describe('admin/writing/tips.html / CRUD contract', () => {
  test('hits the 5 admin endpoints under /admin/writing/tips', () => {
    assert.match(html, /window\.api\.get\('\/admin\/writing\/tips/);
    assert.match(html, /window\.api\.post\('\/admin\/writing\/tips'/);
    assert.match(html, /window\.api\.patch\('\/admin\/writing\/tips\/'/);
    assert.match(html, /window\.api\.delete\('\/admin\/writing\/tips\/'/);
  });

  test('form field IDs preserved', () => {
    for (const id of [
      'form-title', 'form-task-type', 'form-category', 'form-display-order',
      'form-slug', 'form-body', 'form-published', 'form-preview',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist`);
    }
  });

  test('state + list IDs preserved', () => {
    for (const id of ['state-loading', 'state-error', 'state-empty', 'tips-list',
                      'filter-task-type', 'filter-published', 'btn-create', 'btn-save']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist`);
    }
  });

  test('task_type options use the tips enum (task_1 / task_2 / both)', () => {
    assert.match(html, /value="task_1"/);
    assert.match(html, /value="task_2"/);
    assert.match(html, /value="both"/);
  });

  test('quick publish toggle + edit + delete row actions wired', () => {
    assert.match(html, /data-action="toggle"/);
    assert.match(html, /data-action="edit"/);
    assert.match(html, /data-action="delete"/);
  });

  test('live markdown preview reuses window.renderMarkdown', () => {
    assert.match(html, /window\.renderMarkdown/);
    assert.match(html, /id="form-preview"[^>]*class="md-body"/);
  });

  test('loads marked + DOMPurify + markdown.js for the preview', () => {
    assert.match(html, /marked@\d/);
    assert.match(html, /dompurify@\d/);
    assert.match(html, /\/js\/markdown\.js/);
  });
});


describe('js/markdown.js / sanitization safety', () => {
  test('exposes window.renderMarkdown', () => {
    assert.match(md_js, /window\.renderMarkdown\s*=\s*renderMarkdown/);
  });

  test('routes through DOMPurify.sanitize (never injects raw HTML)', () => {
    assert.match(md_js, /DOMPurify\.sanitize/);
    assert.match(md_js, /marked\.parse/);
  });

  test('falls back to escaped plaintext when a lib failed to load', () => {
    // The guard must escape rather than return raw HTML if marked/DOMPurify
    // are unavailable — this is the XSS backstop.
    assert.match(md_js, /md-fallback/);
    assert.match(md_js, /!hasMarked\s*\|\|\s*!hasPurify/);
  });
});


describe('css/markdown.css / token discipline', () => {
  test('.md-body declared', () => {
    assert.match(md_css, /\.md-body\s*\{/);
  });
  test('references --av-* tokens, no hardcoded hex / white', () => {
    assert.ok((md_css.match(/var\(--av-/g) || []).length > 15);
    const stripped = md_css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(stripped), 'no hex literals');
    assert.ok(!/:\s*white\b/.test(stripped), 'no bare white');
  });
  test('does NOT use skipped --av-space steps', () => {
    assert.ok(!/var\(--av-space-(5|7|9|10|11|13|14|15)\)/.test(md_css));
  });
});


describe('aver-admin-chrome.js / tips nav entry', () => {
  test('writing section carries a tips subsection → tips.html', () => {
    assert.match(chrome_js, /slug:\s*'tips'[\s\S]*?\/pages\/admin\/writing\/tips\.html/);
  });
});


describe('admin-writing.css / tips classes', () => {
  test('publish/draft pills + editor classes declared', () => {
    for (const cls of ['.aw-pill--published', '.aw-pill--draft', '.aw-md-textarea',
                       '.aw-tips-preview', '.aw-btn-toggle']) {
      assert.ok(css.includes(cls), `${cls} must be declared`);
    }
  });
});
