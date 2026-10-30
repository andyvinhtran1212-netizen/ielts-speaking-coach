import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const systemPage = readFileSync(new URL(
  '../app/(authed-admin-system)/admin/system/page.tsx', import.meta.url,
), 'utf8');
const writingGradePage = readFileSync(new URL(
  '../app/(authed-admin-writing-grade)/admin/writing/grade/page.tsx', import.meta.url,
), 'utf8');

test('/admin/system describes its operational purpose in Vietnamese', () => {
  assert.doesNotMatch(systemPage, /Sprint 12\.8|monolith|carve/);
  assert.match(systemPage, /<p className="subtitle">\s*Chi phí AI và sự cố chấm bài\.\s*<\/p>/);
});

test('/admin/writing/grade uses the current admin tab title', () => {
  assert.match(writingGradePage, /title: 'Chấm Writing · Admin'/);
  assert.doesNotMatch(writingGradePage, /Writing Coach Admin/);
});
