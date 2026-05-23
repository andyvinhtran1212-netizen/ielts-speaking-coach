/**
 * frontend/tests/no-raw-fetch-relative-path.test.mjs — Sprint 14.6.3
 *
 * Pattern #34 source-scan sentinel.
 *
 * Sprint 14.6.2 shipped a `fetch('/sessions/cuecard/generate', ...)`
 * call with a raw relative path. In production the Vercel frontend
 * resolved that against its own origin (www.averlearning.com)
 * instead of the Railway backend, producing a 404 HTML page. The
 * Sprint 14.6.2 unit tests passed because they injected a `fetch`
 * stub that accepted any URL — the production base-URL gap was
 * invisible to CI.
 *
 * Pattern #34: integration sentinels MUST assert the outbound URL,
 * not just the mock call shape. A scoped variant of Sprint 14.6.1's
 * Pattern #26 (CSS source scan): "mocked call invisible to unit
 * tests" is the same failure shape as "inline style invisible to
 * CSS source scan."
 *
 * This sentinel scans every file under frontend/js/ for a literal
 * `fetch('/foo/...')` pattern — i.e. a raw fetch whose first
 * argument is a *string literal* starting with a single `/`. Those
 * calls bypass the canonical `window.api.post(...)` helper (which
 * prepends the Railway backend base) and will 404 in production.
 *
 * The scan is intentionally narrow:
 *
 *   - Allowed: `fetch(BASE + '/...')`, `fetch(${BASE}/...)`,
 *     `fetch(_API_BASE + path)`, `fetch(variable)` — any first
 *     argument that isn't a string literal escapes the check.
 *   - Allowed: `frontend/js/api.js` itself (it IS the helper that
 *     does the base-URL prepend).
 *   - Forbidden: `fetch('/sessions/...')`, `fetch('/api/...')`,
 *     `fetch("/health")` etc.
 *
 * A future raw-fetch landing in frontend/js/ fails CI before reaching
 * production. To intentionally bypass (e.g. fetching a same-origin
 * static asset like `/favicon.ico`), refactor through window.api or
 * extend the whitelist in this file.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const _FRONT_DIR = join(__dirname, '..');
const _JS_DIR    = join(_FRONT_DIR, 'js');


// ── File walk ─────────────────────────────────────────────────────────────


function _walkJs(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const s    = statSync(full);
    if (s.isDirectory()) {
      _walkJs(full, out);
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}


// ── The scan ──────────────────────────────────────────────────────────────


/**
 * Literal pattern that catches a raw relative-path fetch.
 *
 * Scoped narrowly to the exact identifier `fetch` (the global) so
 * legitimate wrapper helpers — `fetchGrammarAPI`, `apiFetch`,
 * `myFetch`, etc. that themselves prepend a base URL — are NOT
 * flagged. The cost of a false positive (forcing the refactor of a
 * safe helper) is high; the global-`fetch` case captures the
 * overwhelmingly common bug shape.
 *
 * KNOWN gap: a local alias like
 *     var fetchImpl = fetch;
 *     fetchImpl('/sessions/...');
 * slips through because `fetchImpl(...)` doesn't match `\bfetch\b`.
 * That was Sprint 14.6.2's actual shape — but the alias pattern
 * itself is a code-smell that review catches; the global-fetch
 * idiom is the failure mode this sentinel is built to stop.
 *
 * Matches:        fetch('/...'),  fetch("/..."),  fetch(`/...`)
 * Doesn't match:  fetch('//cdn'),                  // protocol-relative
 *                 fetch(BASE + '/...'),            // not a string literal
 *                 fetch(`${BASE}/...`),            // template w/ interpolation
 *                 fetch(url),                      // variable
 *                 fetchGrammarAPI('/foo')          // wrapper — identifier ≠ fetch
 *                 apiFetch('/foo')                 // wrapper — identifier ≠ fetch
 *
 * The ``(?!/)`` after the leading slash excludes `//host/path`
 * protocol-relative URLs, which DO hit a different origin and don't
 * suffer the same base-URL bug.
 */
const _RAW_RELATIVE_FETCH_RE =
  /\bfetch\s*\(\s*(['"`])\/(?!\/)[a-zA-Z0-9_\-./?&=%]+\1/;


/** Files whose internals legitimately call the network primitive — they
 *  ARE the helpers that handle base-URL prepending themselves. */
const _ALLOWED_BASENAMES = new Set([
  'api.js',          // canonical helper: prepends _API_BASE
]);

/**
 * Strip /*...*\/ block comments and // line comments from a source
 * file so we don't false-positive on commented-out code or doc
 * snippets. JavaScript comment-stripping is intentionally crude
 * (literal regex below); good enough for sentinel scans.
 */
function _stripComments(src) {
  // Block comments first — handles multi-line.
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments. Run line-by-line so we don't accidentally chew
  // through string literals containing `//` (e.g. URLs in code).
  return src.split('\n').map(function (line) {
    // Walk char-by-char tracking simple string/template state so we
    // don't strip "//" inside a string literal.
    let out = '';
    let i = 0, q = null;
    while (i < line.length) {
      const c = line[i];
      if (q) {
        out += c;
        if (c === '\\' && i + 1 < line.length) { out += line[i + 1]; i += 2; continue; }
        if (c === q) q = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        q = c;
        out += c;
        i++;
        continue;
      }
      if (c === '/' && line[i + 1] === '/') break;   // rest is a line comment
      out += c;
      i++;
    }
    return out;
  }).join('\n');
}


describe('Sprint 14.6.3 — Pattern #34: no raw relative-path fetch() in frontend/js', () => {

  test('every frontend/js/*.js file routes API calls through window.api (or a BASE-prefixed fetch)', () => {
    const files      = _walkJs(_JS_DIR);
    const violations = [];

    for (const file of files) {
      const basename = file.split('/').pop();
      if (_ALLOWED_BASENAMES.has(basename)) continue;

      const src     = _stripComments(readFileSync(file, 'utf8'));
      const lines   = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (_RAW_RELATIVE_FETCH_RE.test(lines[i])) {
          violations.push(
            relative(_FRONT_DIR, file) + ':' + (i + 1) + ': ' + lines[i].trim(),
          );
        }
      }
    }

    assert.strictEqual(
      violations.length, 0,
      'Sprint 14.6.3 — Pattern #34: found ' + violations.length +
      ' raw fetch() call(s) with a relative API path. These bypass ' +
      'window.api.post (which prepends the Railway backend base URL) ' +
      'and 404 in production. Migrate to window.api.post(...) or ' +
      'fetch(BASE + path) like every other module.\n\n' +
      violations.join('\n'),
    );
  });

  test('the sentinel catches the canonical bad pattern (self-test)', () => {
    // Defensive — make sure the regex doesn't silently drift. A
    // refactor that broadens or narrows the pattern must keep
    // catching the canonical direct-`fetch` failure mode.
    const pinnedBadLines = [
      // The direct shape (most common — Sprint 14.6.2 production
      // bug used this exact form via an alias):
      "var resp = await fetch('/sessions/cuecard/generate', {});",
      "fetch(\"/api/foo\")",
      "await fetch(`/api/foo`)",   // plain template literal (no ${})
    ];
    for (const line of pinnedBadLines) {
      assert.match(line, _RAW_RELATIVE_FETCH_RE,
        'The Pattern #34 regex must catch the canonical direct-fetch ' +
        'failure shape. If this fails, the regex was narrowed too far. ' +
        'Line: ' + JSON.stringify(line));
    }
  });

  test('the sentinel does NOT flag BASE-prefixed fetches (allowed pattern)', () => {
    // A negative anchor — these are the legitimate calls the entire
    // rest of frontend/js/ uses. They MUST NOT trip the sentinel.
    const goodLines = [
      "const res = await fetch(`${BASE}/api/foo`, {});",
      "var response = await fetch(_API_BASE + path, init);",
      "fetch(base + '/health')",
      "fetch(url)",                       // variable — escapes the literal regex
      "await fetch('//cdn.example/x')",   // protocol-relative — different origin
      "const r = await fetchGrammarAPI('/category/x')",  // safe wrapper
      "await apiFetch('/stats')",         // safe wrapper
    ];
    for (const line of goodLines) {
      assert.doesNotMatch(line, _RAW_RELATIVE_FETCH_RE,
        'Pattern #34 must not false-positive on legitimate BASE-prefixed ' +
        'fetch lines or named wrappers: ' + JSON.stringify(line));
    }
  });

});
