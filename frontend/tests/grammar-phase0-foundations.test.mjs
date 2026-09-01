/** Regression pins for the Grammar Wiki Phase 0 foundation repairs. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(HERE, '..');
const read = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');

const HOME = read('app', '(public-content)', 'grammar', 'page.tsx');
const SHELL = read('app', '(public-content)', 'grammar', '[category]', '[slug]', 'page-shell.tsx');
const BEHAVIOR = read('app', '(public-content)', 'grammar', '[category]', '[slug]', 'article-behavior.tsx');
const CSS = read('public', 'css', 'grammar-wiki.css');
const CHROME = read('public', 'js', 'components', 'aver-chrome.js');

describe('Grammar Wiki Phase 0 foundations', () => {
  test('canonical home copy does not freeze a stale group count', () => {
    assert.ok(!HOME.includes('9 nhóm'), 'group count must come from data or remain count-free');
    assert.match(HOME, /async function GroupCountLink/);
    assert.match(HOME, /Array\.isArray\(groups\) \? groups\.length : 0/);
    assert.match(HOME, /Xem các nhóm chủ đề/);
  });

  test('article shell exposes TOC navigation on desktop and mobile', () => {
    assert.match(SHELL, /className="gw-mobile-toc lg:hidden/);
    assert.match(SHELL, /id="mobile-toc-container"/);
    assert.match(SHELL, /className="toc-rail hidden lg:block/);
    assert.match(CSS, /\.toc-rail\s*\{[^}]*align-self:\s*stretch/s);
    assert.match(CSS, /\.gw-mobile-toc\s*\{/);
    assert.match(CSS, /summary:focus-visible/);
  });

  test('TOC active state is synchronized across both render targets', () => {
    assert.match(BEHAVIOR, /#toc-container \.toc-link, #mobile-toc-container \.toc-link/);
    assert.match(BEHAVIOR, /#mobile-toc-container a\[href=/);
  });

  test('mobile primary nav scrolls and reveals the active destination', () => {
    assert.match(CHROME, /\.nav-links a,[\s\S]*?flex:\s*0 0 auto/);
    assert.match(CHROME, /overflow-x:\s*auto/);
    assert.match(CHROME, /setAttribute\('aria-current', 'page'\)/);
    assert.match(CHROME, /nav\.scrollLeft\s*=\s*Math\.max/);
  });
});
