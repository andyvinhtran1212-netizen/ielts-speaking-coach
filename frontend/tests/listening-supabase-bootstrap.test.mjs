/**
 * frontend/tests/listening-supabase-bootstrap.test.mjs
 *
 * Every Listening page-script that calls the API must first initialise the
 * Supabase client.
 *
 * This is a sweep, not a per-file assertion, because the failure it guards is
 * silent and total. api.js reads the session off the Supabase client; without
 * the init there is no token on the request, the API answers 401, and the page
 * bounces to /login — which sees a live session and bounces on to the home
 * page. The learner sees a login flash and lands somewhere they did not ask
 * for, with nothing in the console pointing at the cause. Shipped exactly that
 * way on listening-practice-run.js: 14 sibling scripts did the bootstrap and
 * the fifteenth did not, so nothing in the codebase noticed.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS_DIR = join(__dirname, '..', 'public', 'js');

const scripts = readdirSync(JS_DIR)
  .filter((f) => f.startsWith('listening-') && f.endsWith('.js'))
  .map((f) => ({ name: f, src: readFileSync(join(JS_DIR, f), 'utf8') }));


describe('Listening page-scripts initialise Supabase before calling the API', () => {
  it('finds the Listening scripts at all (a moved directory must not pass silently)', () => {
    assert.ok(scripts.length >= 10,
      `expected the Listening page-scripts, found ${scripts.length}`);
  });

  it('every script that calls window.api bootstraps the client', () => {
    const missing = scripts
      .filter((s) => /window\.api\./.test(s.src) && !/initSupabase/.test(s.src))
      .map((s) => s.name);
    assert.deepEqual(missing, [],
      `these call the API with no Supabase session — every request 401s and the `
      + `page bounces to /login then home: ${missing.join(', ')}`);
  });

  it('the bootstrap is guarded, so a script stays importable without a window', () => {
    // The tests import these modules directly. An unguarded window reference at
    // module scope would throw at import time and take the whole suite down.
    for (const s of scripts.filter((x) => /initSupabase/.test(x.src))) {
      assert.match(
        s.src, /(typeof window !== 'undefined' && window\.initSupabase|if \(window\.initSupabase\))/,
        `${s.name} must guard the bootstrap`,
      );
    }
  });
});
