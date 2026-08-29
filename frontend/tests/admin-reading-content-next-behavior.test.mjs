import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalReadingShareUrl, normalizeDeleteAck, normalizeExamOnlyAck,
  normalizeLockAck, normalizeReadingContentList, normalizeReadingImport,
  normalizeShareAck, readingPreviewRows,
} from '../lib/admin-reading-content-model.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-reading-content)', 'admin', 'reading', 'content', 'admin-reading-content.tsx');
const PAGE = read('app', '(authed-admin-reading-content)', 'admin', 'reading', 'content', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-reading-content)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-reading-content-next.css');

test('normalizes canonical list and rejects envelope drift', () => {
  const good = normalizeReadingContentList({ items: [{ id: 'u1', slug: 'R-1', library: 'l3_test', title: 'Test', status: 'published', locked: true, content_audit_status: 'passed_after_fix', content_audited_at: '2026-08-29T00:00:00Z' }], total: 1, limit: 25, offset: 0 }, { limit: 25, offset: 0 });
  assert.equal(good.rows[0].slug, 'R-1');
  assert.equal(good.rows[0].locked, true);
  assert.equal(good.rows[0].contentAuditStatus, 'passed_after_fix');
  assert.equal(good.rows[0].contentAuditedAt, '2026-08-29T00:00:00Z');
  assert.equal(good.malformedCount, 0);
  assert.equal(normalizeReadingContentList({ items: [], total: 0, limit: 100, offset: 0 }, { limit: 25, offset: 0 }), null);
  const partial = normalizeReadingContentList({ items: [{ id: 'x' }, { id: 'p', slug: 'p', library: 'l1_vocab', status: 'draft' }], total: 2, limit: 25, offset: 0 });
  assert.equal(partial.rows.length, 1); assert.equal(partial.malformedCount, 1);
});

test('pins dry-run/commit identities and mutation ACKs', () => {
  assert.ok(normalizeReadingImport({ dry_run: true, parsed_data: { slug: 'x' }, validation_errors: [], warnings: [] }, true));
  assert.equal(normalizeReadingImport({ dry_run: false, parsed_data: {}, validation_errors: [] }, true), null);
  assert.equal(normalizeExamOnlyAck({ test_id: 'T1', exam_only: true }, 'T1', true), true);
  assert.deepEqual(normalizeLockAck({ test_id: 'T1', locked: true, password: 'ABCD-1234' }, 'T1', true), { locked: true, password: 'ABCD-1234' });
  assert.equal(normalizeLockAck({ test_id: 'T1', locked: true, password: null }, 'T1', true), null);
  assert.deepEqual(normalizeShareAck({ test_id: 'T1', share: { token: 'secret', expires_at: '2026-08-20T00:00:00Z' } }, 'T1'), { token: 'secret', expiresAt: '2026-08-20T00:00:00Z' });
  assert.deepEqual(normalizeDeleteAck({ test_id: 'T1', action: 'archived', attempts_preserved: 4 }, { slug: 'T1', library: 'l3_test' }), { action: 'archived', attemptsPreserved: 4 });
});

test('preview rows and canonical share URL stay safe', () => {
  const rows = readingPreviewRows({ content_type: 'reading_full_test', test_id: 'T1', title: '<script>', total_questions: 40 });
  assert.ok(rows.some((row) => row.value === '<script>'));
  assert.equal(canonicalReadingShareUrl('a b', { protocol: 'https:', hostname: 'averlearning.com.', port: '' }), 'https://www.averlearning.com/core-player/launch?surface=reading_exam&share=a%20b');
});

test('native route preserves admin gate, contracts, rollback and responsive layout', () => {
  assert.match(PAGE, /active="reading" subsection="content"/);
  assert.match(PAGE, /AdminAccessGate/);
  assert.match(LAYOUT, /admin-reading-content-next\.css/);
  for (const contract of ['dry_run=true', 'dry_run=false', 'import-bundle', '/exam-only', '/lock', '/share', 'findCanonical']) assert.match(CLIENT, new RegExp(contract.replace('/', '\\/')));
  assert.match(CLIENT, /readingPreviewHref\(row\.slug\)/);
  assert.match(CLIENT, /`\/reading\/vocab\/\$\{encodeURIComponent\(row\.slug\)\}`/);
  assert.match(CLIENT, /`\/reading\/skill\/\$\{encodeURIComponent\(row\.slug\)\}`/);
  assert.doesNotMatch(CLIENT, /pages\/(?:reading-vocab-passage|reading-skill-exercise)\.html/);
  assert.match(CLIENT, /normalizeDeleteAck/);
  assert.match(CLIENT, /Nội dung đã audit/);
  assert.match(CSS, /@media\(max-width:900px\)/);
  assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
});

test('one-time credentials survive a failed canonical readback', () => {
  const passwordAck = CLIENT.indexOf('const credential = next ?');
  const passwordReadback = CLIENT.indexOf("await findCanonical('l3_test', row.slug)", passwordAck);
  assert.ok(passwordAck > -1 && passwordReadback > passwordAck, 'password ACK must be rendered before readback');
  assert.match(CLIENT.slice(passwordAck, passwordReadback), /setAction\(null\); setBanner\(\{ kind: 'info', text: credential \}\)/);

  const shareAck = CLIENT.indexOf('const url = canonicalReadingShareUrl');
  const shareReadback = CLIENT.indexOf("await findCanonical('l3_test', shareRow.slug)", shareAck);
  assert.ok(shareAck > -1 && shareReadback > shareAck, 'share URL must be rendered before readback');
  assert.match(CLIENT.slice(shareAck, shareReadback), /setShareUrl\(url\)/);
  assert.match(CLIENT, /shareReadbackWarning/);
});
