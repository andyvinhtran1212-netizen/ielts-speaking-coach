/** Gate E Writing: claim the canonical assignment renderer before mutation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORE_PLAYER_AFFINITY_POLICY,
  admitCorePlayer,
  corePlayerUrl,
} from '../lib/core-player-affinity.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const NEXT = read('frontend/app/(authed-writing)/writing/dashboard/writing-behavior.tsx');
const LEGACY = read('frontend/public/pages/writing-dashboard.html');
const ROUTER = read('backend/routers/writing_student.py');

describe('Writing assignment affinity foundation', () => {
  test('preserves current Next admission and both stable rollback URLs', () => {
    const policy = CORE_PLAYER_AFFINITY_POLICY.surfaces.writing_assignment;
    assert.equal(policy.admit_new, 'next');
    assert.equal(
      admitCorePlayer('writing_assignment', { assignment_id: 'assignment-1' }),
      '/core-player/launch?surface=writing_assignment&assignment_id=assignment-1',
    );
    assert.equal(
      corePlayerUrl('writing_assignment', 'legacy', { assignment_id: 'assignment-1' }),
      '/pages/writing-dashboard.html?assignment_id=assignment-1',
    );
    assert.equal(
      corePlayerUrl('writing_assignment', 'next', { assignment_id: 'assignment-1' }),
      '/writing/dashboard?assignment_id=assignment-1',
    );
  });

  test('both renderers claim before starting or reading mutable workspace state', () => {
    for (const [label, source, renderer] of [
      ['Next', NEXT, 'next'],
      ['Legacy', LEGACY, 'legacy'],
    ]) {
      const claim = source.indexOf("'/renderer-affinity'");
      const start = source.indexOf("'/start'");
      const detail = source.indexOf("encodeURIComponent(assignmentId)\n    );", claim);
      assert.ok(claim !== -1, `${label} claim missing`);
      assert.ok(start !== -1 && claim < start, `${label} must claim before /start`);
      assert.ok(detail === -1 || claim < detail, `${label} must claim before assignment detail`);
      assert.match(source, new RegExp(`renderer_affinity:\\s*'${renderer}'`));
      assert.match(source, /window\.location\.replace\(writingAssignmentHref\(assignmentId, affinity\)\)/);
    }
  });

  test('fresh cards use runtime admission while claimed cards stay direct and reloadable', () => {
    assert.match(NEXT, /admitCorePlayer\('writing_assignment'/);
    assert.match(NEXT, /corePlayerUrl\('writing_assignment', affinity/);
    assert.match(NEXT, /data-renderer-affinity/);
    assert.match(NEXT, /URLSearchParams\(window\.location\.search\)\.get\('assignment_id'\)/);

    assert.match(LEGACY, /core-player\/launch\?surface=writing_assignment&assignment_id=/);
    assert.match(LEGACY, /data-renderer-affinity/);
    assert.match(LEGACY, /URLSearchParams\(window\.location\.search\)\.get\('assignment_id'\)/);
  });

  test('backend exposes canonical affinity on list/detail and claims via owner-scoped RPC', () => {
    assert.match(ROUTER, /renderer_affinity,[\s\S]*writing_prompts/);
    assert.match(ROUTER, /fn_claim_writing_assignment_renderer_affinity/);
    assert.match(ROUTER, /"p_student_id": student\["id"\]/);
    assert.match(ROUTER, /assignment\["status"\] not in _ACTIVE_ASSIGNMENT_STATES/);
    assert.match(ROUTER, /if affinity not in \("legacy", "next"\)/);
  });
});
