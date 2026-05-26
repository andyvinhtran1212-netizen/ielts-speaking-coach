/**
 * frontend/tests/sprint-18-3-1-3-toolbar-split.test.mjs — Sprint 18.3.1.3
 *
 * STRUCTURAL fix (Codex audit, Pattern #45): after 3 micro-fixes inside the
 * single-row "filters ↔ CTA" flex-negotiation frame, the toolbar is split into
 * two intentional rows — a filter row (wraps internally) + an actions row
 * (right-aligned CTA). This removes the negotiation (and the 96px nested-padding
 * width-budget squeeze) entirely. Source-scan; visuals via Andy dogfood.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCESS = readFileSync(join(__dirname, '..', 'pages', 'admin', 'access-codes', 'index.html'), 'utf8');


describe('Sprint 18.3.1.3 — two-row toolbar (no single-row negotiation)', () => {
  test('.ac-toolbar is a column (stacked rows), not a wrapping single row', () => {
    assert.match(ACCESS, /\.ac-toolbar\s*\{[\s\S]*?flex-direction:\s*column/);
    assert.doesNotMatch(ACCESS, /\.ac-toolbar\s*\{[\s\S]*?justify-content:\s*space-between/);
  });
  test('actions row exists + right-aligns the CTA', () => {
    assert.match(ACCESS, /\.ac-toolbar-actions\s*\{[\s\S]*?justify-content:\s*flex-end/);
  });
  test('CTA "+ Tạo mã mới" lives in the actions row', () => {
    assert.match(ACCESS, /<div class="ac-toolbar-actions">\s*<button class="adm-btn-primary" id="btn-create"/);
  });
  test('filters still wrap within their own row', () => {
    assert.match(ACCESS, /\.ac-filter-bar\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  });
});
