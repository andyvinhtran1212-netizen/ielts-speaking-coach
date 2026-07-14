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
  const finalizeIdx = SRC.indexOf("window.api.post('/sessions/finalize-full-test'");
  const clearIdx = SRC.indexOf('_clearFtChain();', SRC.indexOf('function _fireAndForgetFullTestGrading'));
  assert.ok(finalizeIdx !== -1 && clearIdx !== -1);
  assert.ok(clearIdx > finalizeIdx,
    'clearing BEFORE the finalize call loses the only persisted copy when finalize fails — a Part-3 refresh would then retry finalize without Part 1/2');
  // and it must sit in the success .then, before any sitting redirect
  const thenBlock = SRC.slice(finalizeIdx, SRC.indexOf('.catch', finalizeIdx));
  assert.ok(thenBlock.includes('_clearFtChain();'), 'clear belongs to the success path');
});

test('part swap keeps the URL as routing source of truth', () => {
  assert.match(SRC, /history\.replaceState\(null, '', '\?session_id=' \+ encodeURIComponent\(newId\)\)/,
    'without this a refresh in Part 2/3 reloads Part 1\'s session');
});
