/**
 * D1 rollback-client persistence contract.
 *
 * One learner answer owns one secure UUID. The same request body is reused by
 * the transient retry so the backend can replay a committed attempt instead of
 * consuming quota or inserting a duplicate after a lost ACK.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, '..', 'js', 'd1-exercise.js'), 'utf8');

describe('D1 attempt idempotency', () => {
  it('creates one key before calling the retry helper', () => {
    assert.match(
      source,
      /const clientAttemptId = newClientAttemptId\(\);[\s\S]{0,180}persistAnswerBeforeAdvance\(ex\.id, choice, _session\.id, clientAttemptId, nextBtn\)/,
    );
  });

  it('uses Web Crypto and never Math.random for attempt identity', () => {
    assert.ok(source.includes('cryptoApi?.randomUUID'));
    assert.ok(source.includes('cryptoApi?.getRandomValues'));
    const helper = source.match(/function newClientAttemptId\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
    assert.ok(helper, 'newClientAttemptId helper must exist');
    assert.ok(!helper.includes('Math.random'), 'attempt identity must use secure randomness');
  });

  it('serializes the key into the single init object reused by both retries', () => {
    assert.match(source, /const init = \{[\s\S]{0,400}client_attempt_id: clientAttemptId/);
    assert.match(source, /for \(let attempt = 0; attempt < 2; attempt\+\+\)[\s\S]{0,180}fetch\(url, init\)/);
    assert.equal(
      (source.match(/client_attempt_id:/g) || []).length,
      1,
      'both retries must reuse one serialized request body',
    );
  });

  it('unlocks Next only after persistence and retries manually with the same key', () => {
    const helper = source.match(
      /async function persistAnswerBeforeAdvance\([\s\S]*?\n  \}/,
    )?.[0] || '';
    assert.ok(helper, 'persistence gate helper must exist');
    assert.match(helper, /nextBtn\.disabled = true/);
    assert.match(
      helper,
      /data = await postAttemptWithRetry\(\s*exerciseId, choice, sessionId, clientAttemptId,/,
    );
    assert.match(helper, /if \(data\)[\s\S]*?nextBtn\.disabled = false/);
    assert.match(
      helper,
      /retry\.onclick[\s\S]*?persistAnswerBeforeAdvance\([\s\S]*?clientAttemptId/,
      'manual retry must reuse the original clientAttemptId',
    );
  });

  it('does not increment a local failure counter and advance on an unsaved answer', () => {
    assert.ok(!source.includes('_session.failed_attempts += 1'));
    assert.ok(source.includes('Next remains locked'));
  });
});
