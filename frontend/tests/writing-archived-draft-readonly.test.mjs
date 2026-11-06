/** CLASSARCHIVE-0030 FR-004 / ui-states.md: an archived class's Writing give stays readable. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(FRONTEND);
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const NEXT = read('frontend/app/(authed-writing)/writing/dashboard/writing-behavior.tsx');
const PAGE = read('frontend/app/(authed-writing)/writing/dashboard/page-shell.tsx');

// Body runs from the declaration to the next top-level function declaration.
function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start !== -1, `${signature} missing`);
  const next = source.slice(start + signature.length).search(/\n(?:async )?function /);
  assert.ok(next !== -1, `no top-level declaration after ${signature}`);
  return source.slice(start, start + signature.length + next);
}

const OPEN = functionBody(NEXT, 'async function openSubmitModal(');
const RENDER = functionBody(NEXT, 'function renderModal(');

describe('archived class Writing give opens read-only', () => {
  test('a card the list marks archived reads its give before any claim or start', () => {
    const listed = OPEN.indexOf('listedAsArchived(assignmentId)');
    const preview = OPEN.indexOf('const preview = await api.get(');
    const readOnlyBranch = OPEN.indexOf('renderModal(preview, ms, null, true)');
    const claim = OPEN.indexOf("'/renderer-affinity'");
    const start = OPEN.indexOf('startPath');
    assert.ok(listed !== -1, 'archived card check missing');
    assert.ok(preview > listed, 'canonical detail read must follow the card check');
    assert.ok(readOnlyBranch > preview && readOnlyBranch < claim, 'read-only branch must return before the claim');
    assert.ok(start > claim, 'start stays after the claim for open give');
    assert.match(OPEN, /class_archived === true && .*archive_finish_allowed !== true/s);
  });

  test('non-archived cards keep the unchanged claim-first wire (no extra read)', () => {
    const listed = OPEN.indexOf('listedAsArchived(assignmentId)');
    const claim = OPEN.indexOf("'/renderer-affinity'");
    const branchEnd = OPEN.indexOf('\n    }\n', listed);
    assert.ok(listed !== -1 && branchEnd !== -1 && branchEnd < claim, 'archived block must close before the claim');
    assert.equal(OPEN.slice(listed, claim).split("'/renderer-affinity'").length, 1);
  });

  test('the card carries the archive flag and the helper reads it by assignment id', () => {
    assert.match(NEXT, /data-class-archived="' \+ \(a\.class_archived === true \? 'true' : 'false'\)/);
    assert.match(NEXT, /function listedAsArchived\(assignmentId: string\): boolean/);
    assert.match(NEXT, /getAttribute\('data-class-archived'\) === 'true'/);
  });

  test('the read-only render never starts a timer, auto-submits or enables writes', () => {
    assert.match(RENDER, /readOnly: boolean = false|readOnly = false/);
    assert.match(RENDER, /textarea\.readOnly = readOnly/);
    assert.match(RENDER, /ms\.workspaceReady = !readOnly/);
    const guard = RENDER.indexOf('if (readOnly)');
    assert.ok(guard !== -1, 'readOnly guard missing');
    assert.ok(guard < RENDER.indexOf('submitFromModal(ms, true)'), 'auto-submit must be behind the read-only guard');
    assert.ok(guard < RENDER.indexOf('startModalCountdown('), 'countdown must be behind the read-only guard');
    assert.match(RENDER, /draft\.draft_text \|\| ''/);
  });

  test('a 409 cohort_archived from a race is not reported as a submission in another tab', () => {
    const catchStart = OPEN.indexOf('} catch (err: any) {');
    const archived = OPEN.indexOf("err?.detail?.code === 'cohort_archived'");
    const generic = OPEN.indexOf('statusCode(err) === 409', catchStart);
    assert.ok(archived !== -1 && archived > catchStart, 'cohort_archived catch branch missing');
    assert.ok(archived < generic, 'archived branch must precede the generic 409 branch');
    const archivedBranch = OPEN.slice(archived, generic);
    assert.doesNotMatch(archivedBranch, /WritingSubmitReceipt\?\.remove/);
    assert.match(archivedBranch, /err\.detail\.message/);
  });

  test('the modal carries the archived notice that the read-only render shows', () => {
    assert.match(PAGE, /id="modal-archived"/);
    assert.match(PAGE, /Lớp đã lưu trữ — đã đóng/);
    assert.match(RENDER, /\$\('modal-archived'\)/);
  });
});
