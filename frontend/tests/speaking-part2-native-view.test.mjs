import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(HERE, '..', 'public', 'js', 'practice.js'), 'utf8');

function renderTimer(functionName, secondsVariable, seconds) {
  const start = JS.indexOf(`  function ${functionName}()`);
  const end = JS.indexOf('\n  function ', start + 1);
  assert.ok(start !== -1 && end > start, `${functionName} not found`);
  let published = null;
  const update = (section, patch) => {
    assert.equal(section, 'part2');
    published = patch;
    return true;
  };
  new Function('_updateNativeView', secondsVariable,
    `${JS.slice(start, end)} ${functionName}();`)(update, seconds);
  return published;
}

describe('Part 2 native view-model', () => {
  test('prep countdown publishes copy and urgent state at ten seconds', () => {
    assert.deepEqual(renderTimer('_renderP2PrepTimer', '_p2PrepSecsLeft', 11), {
      prepTimer: '0:11',
      prepUrgent: false,
    });
    assert.deepEqual(renderTimer('_renderP2PrepTimer', '_p2PrepSecsLeft', 10), {
      prepTimer: '0:10',
      prepUrgent: true,
    });
  });

  test('speaking countdown changes urgency below thirty seconds', () => {
    assert.deepEqual(renderTimer('_renderP2SpeakTimer', '_p2SpeakSecsLeft', 30), {
      speakTimer: '0:30',
      speakUrgent: false,
    });
    assert.deepEqual(renderTimer('_renderP2SpeakTimer', '_p2SpeakSecsLeft', 29), {
      speakTimer: '0:29',
      speakUrgent: true,
    });
  });

  test('cue, retry and notes are all published through the Part 2 section', () => {
    const cue = JS.slice(
      JS.indexOf('  function _showP2Cue()'),
      JS.indexOf('  function retryP2Submission()'),
    );
    assert.match(cue, /_updateNativeView\('part2', \{[\s\S]*?topic:/);
    assert.match(cue, /retryPlaybackUrl:/);
    assert.match(cue, /startVisible:/);
    const prep = JS.slice(
      JS.indexOf('  function startP2Prep()'),
      JS.indexOf('  function startP2SpeakingEarly()'),
    );
    assert.match(prep, /notesRevision:/);
    assert.match(prep, /prepQuestion:/);
  });
});
