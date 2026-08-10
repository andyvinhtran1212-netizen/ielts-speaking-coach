// Spike-2 fix — full-test chain persistence source pins (behavioral coverage
// lives in tests/e2e/full_test_chain_persistence.spec.js; these pin the
// invariants a refactor could silently drop).
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(path.join(FRONTEND, 'js', 'practice.js'), 'utf8');

test('chain persists under the stable sessionStorage key', () => {
  assert.match(SRC, /var FT_CHAIN_KEY = 'ielts_ft_session_ids';/,
    'key is a cross-page/tab contract — renaming breaks in-flight full tests');
  assert.match(SRC, /_ftAllSessionIds\.push\(newId\);\s*\n\s*_saveFtChain\(\);/,
    'every part push must persist the chain');
});

test('init restores with membership check + truncation', () => {
  assert.match(SRC, /storedChain\.indexOf\(_sessionId\)/,
    'a stale chain from another full test must be rejected');
  assert.match(SRC, /storedChain\.slice\(0, chainPos \+ 1\)/,
    'parts after the current session are being redone — truncate them');
});

test('chain is cleared ONLY after finalize is ACCEPTED (review #748)', () => {
  const finalizeIdx = SRC.indexOf("'/sessions/finalize-full-test'");
  const acceptedFn = SRC.slice(
    SRC.indexOf('function _onFullTestFinalizeAccepted'),
    SRC.indexOf('function _setFullTestCompletionPhase'),
  );
  assert.ok(finalizeIdx !== -1);
  assert.match(
    SRC.slice(finalizeIdx, finalizeIdx + 180),
    /noRedirect: true/,
    'finalize auth expiry must preserve the chain and visible retry state',
  );
  assert.match(acceptedFn, /_clearFtChain\(\)/,
    'the chain clears in the shared accepted-only callback');
  // Legacy finalization may call the accepted callback only from its success
  // arm; native finalization validates/reconciles acceptance in its controller.
  const thenBlock = SRC.slice(finalizeIdx, SRC.indexOf('.catch', finalizeIdx));
  assert.ok(thenBlock.includes('_onFullTestFinalizeAccepted('),
    'legacy clear belongs behind the success path');
  const pendingIdx = SRC.indexOf('Promise.allSettled(pendingLegacy)');
  assert.ok(pendingIdx !== -1 && pendingIdx < finalizeIdx,
    'legacy finalize must wait for every eager upload to settle first');
  assert.match(
    SRC.slice(pendingIdx, finalizeIdx),
    /_ftSubmitFailures\.length[\s\S]*?legacy-upload-error/,
    'a rejected eager upload must block finalize and render a truthful error state',
  );
  assert.match(SRC, /nativeFullTest\.finalizeFullTest\(\)[\s\S]{0,240}?_onFullTestFinalizeAccepted/,
    'native clear belongs behind validated finalize acceptance');
});

test('part swap keeps the URL as routing source of truth', () => {
  assert.match(SRC, /history\.replaceState\(null, '', '\?session_id=' \+ encodeURIComponent\(newId\)\)/,
    'without this a refresh in Part 2/3 reloads Part 1\'s session');
  const push = SRC.indexOf('_ftAllSessionIds.push(newId)');
  const replace = SRC.indexOf("history.replaceState(null, '', '?session_id=' + encodeURIComponent(newId))", push);
  const generate = SRC.indexOf("'/questions/generate'", push);
  assert.ok(push < replace && replace < generate,
    'chain + URL must commit before question generation so reload resumes the new session');
});

test('all Full Test parts reject a persisted short question set', () => {
  assert.match(SRC, /_testMode === 'test_full' && questions\.length < maxQ/);
  assert.match(SRC, /Không tạo đủ câu hỏi cho Full Test Part/);
});
