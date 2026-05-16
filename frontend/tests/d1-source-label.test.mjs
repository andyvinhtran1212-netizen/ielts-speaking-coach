/**
 * frontend/tests/d1-source-label.test.mjs
 *
 * Sprint 10.5 Phase 2 — pin the per-question source label contract.
 *
 * Backend session endpoint now tags every question with a `source`
 * field (`personalized` | `admin_fallback`). The frontend renders a
 * small pill above the sentence so the learner can see whether the
 * question came from their own vocab bank or the generic admin pool.
 *
 * Pattern matches d1-srs-indicator.test.mjs — sentinel string
 * assertions against the module + page source so a regression that
 * (a) drops the conditional rendering, (b) renames the source values,
 * or (c) deletes the supporting CSS fails here loudly.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const D1_PATH   = join(__dirname, '..', 'js',   'd1-exercise.js');
const PAGE_PATH = join(__dirname, '..', 'pages', 'd1-exercise.html');

const D1_SOURCE   = readFileSync(D1_PATH,   'utf8');
const PAGE_SOURCE = readFileSync(PAGE_PATH, 'utf8');


describe('Sprint 10.5 Phase 2 — D1 source label wiring', () => {

  it('renders Vietnamese label "Từ vốn từ của bạn" for personalized questions', () => {
    assert.ok(
      D1_SOURCE.includes('Từ vốn từ của bạn'),
      'd1-exercise.js must show "Từ vốn từ của bạn" for source=personalized.',
    );
  });

  it('renders Vietnamese label "Bài luyện tập chung" for admin_fallback questions', () => {
    assert.ok(
      D1_SOURCE.includes('Bài luyện tập chung'),
      'd1-exercise.js must show "Bài luyện tập chung" for source=admin_fallback.',
    );
  });

  it('checks ex.source === "personalized" and "admin_fallback" exactly', () => {
    assert.ok(
      /ex\.source\s*===\s*['"]personalized['"]/.test(D1_SOURCE),
      'd1-exercise.js must compare ex.source against the literal "personalized".',
    );
    assert.ok(
      /ex\.source\s*===\s*['"]admin_fallback['"]/.test(D1_SOURCE),
      'd1-exercise.js must compare ex.source against the literal "admin_fallback".',
    );
  });

  it('emits the .d1-source-label primitive class with --personalized / --admin variants', () => {
    assert.ok(
      D1_SOURCE.includes('d1-source-label--personalized'),
      'd1-exercise.js must emit the personalized variant class.',
    );
    assert.ok(
      D1_SOURCE.includes('d1-source-label--admin'),
      'd1-exercise.js must emit the admin-fallback variant class.',
    );
  });

  it('d1-exercise.html styles both source label variants', () => {
    assert.ok(
      PAGE_SOURCE.includes('.d1-source-label--personalized'),
      'Inline <style> in d1-exercise.html must style --personalized.',
    );
    assert.ok(
      PAGE_SOURCE.includes('.d1-source-label--admin'),
      'Inline <style> in d1-exercise.html must style --admin.',
    );
  });

  it('renders no label when source field is missing (legacy payloads)', () => {
    // Defensive: pre-Sprint-10.5 sessions don't send `source`. The
    // ternary chain must terminate with empty string, not throw.
    assert.ok(
      /ex\.source\s*===\s*['"]admin_fallback['"][\s\S]{0,200}:\s*['"]['"]/.test(D1_SOURCE),
      'd1-exercise.js must fall through to empty string when source missing.',
    );
  });
});
