/**
 * frontend/tests/d1-srs-indicator.test.mjs
 *
 * Sprint 10.3 — pin the D1 → SRS indicator contract on the frontend.
 *
 * Backend response (post-10.3): `{is_correct, correct_answer, score,
 * srs_updated: bool, srs_rating: 'good' | 'again' | null}`. The new
 * frontend renders "✓ Đã ghi nhận vào ôn tập" (good) or "📝 Lưu ý cho
 * lần ôn tới" (again, post-Sprint-10.3.1-hotfix) inside the
 * existing feedback box when
 * srs_updated is true; otherwise no indicator. Subsequent attempts
 * (which the backend skips per Andy Q2) leave srs_updated=false → no
 * indicator → user is not confused by repeated "Đã ghi nhận" toasts
 * on retries.
 *
 * Pattern matches vocab-module-loader.test.mjs and
 * my-vocab-optimistic-mastery.test.mjs (Sprint 10.2.1) — sentinel
 * string assertions against the module source so a regression that
 * (a) drops the JSON response parsing, (b) bypasses the indicator
 * render, or (c) renames the rating strings fails here loudly.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const D1_PATH = join(__dirname, '..', 'js', 'd1-exercise.js');
const PAGE_PATH = join(__dirname, '..', 'pages', 'd1-exercise.html');

const D1_SOURCE = readFileSync(D1_PATH, 'utf8');
const PAGE_SOURCE = readFileSync(PAGE_PATH, 'utf8');

describe('Sprint 10.3 — D1 SRS indicator wiring', () => {

  it('postAttemptWithRetry parses JSON body and returns it on success', () => {
    // Pre-10.3 returned a bare boolean; post-10.3 returns the parsed
    // body so the caller can read srs_updated/srs_rating. A refactor
    // that reverts to `return true;` would silently break the
    // indicator render — pin both shapes.
    assert.ok(
      D1_SOURCE.includes('await res.json()'),
      'postAttemptWithRetry must parse the response body.',
    );
    assert.ok(
      !/\breturn true;\s*\/\/.*ok/.test(D1_SOURCE),
      'Bare `return true;` on the ok branch would discard the body.',
    );
  });

  it('onAnswerClick chains .then(renderSrsIndicator) on the POST', () => {
    // The fire-and-forget pattern survives, but with a .then to
    // render the indicator before the .finally cleanup. Pin both
    // sites.
    assert.ok(
      /postAttemptWithRetry\([^)]+\)\s*\.then\(/.test(D1_SOURCE),
      '.then must follow postAttemptWithRetry to handle the SRS payload.',
    );
    assert.ok(
      D1_SOURCE.includes('renderSrsIndicator(data)'),
      'The .then callback must invoke renderSrsIndicator with the body.',
    );
  });

  it('renderSrsIndicator no-ops when srs_updated is false', () => {
    // Subsequent attempts (backend-gated) come back with
    // srs_updated=false. The user must NOT see "Đã ghi nhận" or
    // "Lưu ý" on a retry — that would falsely imply the retry fed
    // SRS. Pin the early-return.
    assert.ok(
      /if\s*\(!data\s*\|\|\s*!data\.srs_updated\)\s*return;/.test(D1_SOURCE),
      'renderSrsIndicator must early-return when srs_updated is falsy.',
    );
  });

  it('renderSrsIndicator branches on srs_rating to pick the label', () => {
    assert.ok(
      D1_SOURCE.includes("'✓ Đã ghi nhận vào ôn tập'"),
      "Correct-first-attempt label '✓ Đã ghi nhận vào ôn tập' must appear.",
    );
    assert.ok(
      D1_SOURCE.includes("'📝 Lưu ý cho lần ôn tới'"),
      "Wrong-first-attempt label '📝 Lưu ý cho lần ôn tới' must appear.",
    );
    // Branch is on srs_rating === 'good' (good → correct, else → 'again').
    assert.ok(
      /srs_rating\s*===\s*'good'/.test(D1_SOURCE),
      "Label branch must compare srs_rating to 'good'.",
    );
  });

  it('renderSrsIndicator clears any prior indicator before appending', () => {
    // Defensive: a fast clicker that triggers onAnswerClick twice
    // (or a slow-network second response landing late) must not
    // stack indicators in the DOM. Pin the .remove() call.
    assert.ok(
      D1_SOURCE.includes(".querySelector('.d1-srs-indicator')") &&
      D1_SOURCE.includes('prior.remove()'),
      'Indicator must be replaced (querySelector + remove), not appended blindly.',
    );
  });

  it('page CSS includes .d1-srs-indicator rule', () => {
    // Sentinel for the inline <style> rule in d1-exercise.html. A
    // refactor that moves CSS to an external file would still pass
    // this if the selector survives somewhere — the test pins the
    // class name only.
    assert.ok(
      PAGE_SOURCE.includes('.d1-srs-indicator'),
      'd1-exercise.html must style .d1-srs-indicator.',
    );
  });
});
