// B8 — frontend polish: alert() → non-blocking notices, root-relative routing,
// truthful pricing copy. Structural assertions over the sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const resultSrc = read('pages', 'result.html');
const practiceSrc = read('js', 'practice.js');
const pricingSrc = read('pricing.html');


// ── Mục 36 — result.html errors are non-blocking, no raw err.message ──

test('result.html uses _toast (not alert) for PDF + retry errors', () => {
  assert.match(resultSrc, /function\s+_toast\s*\(/);
  assert.doesNotMatch(resultSrc, /alert\('Không thể tải PDF/);
  assert.doesNotMatch(resultSrc, /alert\('Không thể tạo phiên mới/);
  // the recoverable-error toasts use friendly copy, not the raw err.message
  // (other err.message uses — e.g. the fatal page-load showError — are unchanged)
  assert.match(resultSrc, /_toast\('Không thể tải PDF\. Vui lòng thử lại\.'\)/);
  assert.match(resultSrc, /_toast\('Không thể tạo phiên mới\. Vui lòng thử lại\.'\)/);
});


// ── Mục 37 — root-relative routing via api.url ──

test('result.html retry routes via window.api.url, not a bare relative path', () => {
  assert.match(resultSrc, /window\.api\.url\('pages\/practice\.html'\)/);
  assert.doesNotMatch(resultSrc, /window\.location\.href\s*=\s*'practice\.html\?/);
});


// ── Mục 34-35 — practice nav-guards use the transient rec-error banner ──

test('practice.js nav-guards use _showRecError, not alert', () => {
  assert.match(practiceSrc, /_showRecError\('Hãy nhấn "Dừng ghi âm" trước khi sang/);
  assert.match(practiceSrc, /_showRecError\('Hãy nhấn "Dừng ghi âm" trước khi hoàn thành/);
  assert.doesNotMatch(practiceSrc, /alert\('Hãy nhấn "Dừng ghi âm"/);
});


// ── Mục 38-39 — pricing copy matches the page's own (manual) model ──

test('pricing.html drops subscription-implying copy', () => {
  assert.doesNotMatch(pricingSrc, /Huỷ bất kỳ lúc nào/);   // no "cancel anytime" — no auto-renew
  assert.doesNotMatch(pricingSrc, /nâng cấp khi cần/);     // no self-serve upgrade
  assert.match(pricingSrc, /Hoàn tiền trong 7 ngày đầu/);  // the page's actual policy
  assert.match(pricingSrc, /Chọn gói phù hợp với mục tiêu của bạn\./);
});
