/**
 * Sprint Perf-3 — shared chrome preconnect/dns-prefetch sentinels.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const PERF_HINTS = read('js', 'components', 'perf-hints.js');
const CHROME = read('js', 'components', 'aver-chrome.js');
const ADMIN_CHROME = read('js', 'components', 'aver-admin-chrome.js');


describe('Sprint Perf-3 — shared chrome resource hints', () => {
  it('declares the 3 warmed production origins', () => {
    for (const origin of [
      'https://ielts-speaking-coach-production.up.railway.app',
      'https://nqhrtqspznepmveyurzm.supabase.co',
      'https://res.cloudinary.com',
    ]) {
      assert.match(PERF_HINTS, new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('installs both preconnect and dns-prefetch hints', () => {
    assert.match(PERF_HINTS, /appendHint\(['"]preconnect['"]/);
    assert.match(PERF_HINTS, /appendHint\(['"]dns-prefetch['"]/);
    assert.match(PERF_HINTS, /crossOrigin\s*=/);
  });

  it('skips preconnect work for Save-Data users', () => {
    assert.match(PERF_HINTS, /navigator\.connection[\s\S]{0,80}\.saveData/);
    assert.match(PERF_HINTS, /if\s*\([^)]+saveData\)\s*return/);
  });

  it('dedupes repeated installs across page modules', () => {
    assert.match(PERF_HINTS, /querySelector\(`link\[rel="\$\{rel\}"\]\[href="\$\{href\}"\]`\)/);
  });

  it('student and admin chrome both install the shared hints', () => {
    assert.match(CHROME, /import\s+\{\s*installPerfResourceHints\s*\}/);
    assert.match(CHROME, /installPerfResourceHints\(\)/);
    assert.match(ADMIN_CHROME, /import\s+\{\s*installPerfResourceHints\s*\}/);
    assert.match(ADMIN_CHROME, /installPerfResourceHints\(\)/);
  });
});
