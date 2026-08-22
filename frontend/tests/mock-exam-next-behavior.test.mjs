import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const RUNNER = read('app', '(authed-mock-exam)', 'mock-exam', 'mock-exam-runner.tsx');
const PAGE = read('app', '(authed-mock-exam)', 'mock-exam', 'page.tsx');
const LAYOUT = read('app', '(authed-mock-exam)', 'layout.tsx');
const CSS = read('public', 'css', 'mock-exam-next.css');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const LISTENING_PLAYER = read('app', '(authed-listening-player)', 'listening', 'test', 'session', 'listening-test-session.tsx');
const READING_PLAYER = read('app', '(authed-reading-player)', 'reading', 'exam', 'session', 'reading-exam-session.tsx');
const LEGACY_RUNNER = read('public', 'js', 'mock-exam-runner.js');
const LEGACY_READING = read('public', 'js', 'reading-exam.js');

describe('/mock-exam native runner ownership', () => {
  test('owns the App Router surface without booting the legacy runner', () => {
    assert.match(PAGE, /MockExamRunner/);
    assert.match(LAYOUT, /AuthedShell/);
    assert.match(LAYOUT, /mock-exam-next\.css/);
    assert.doesNotMatch(LAYOUT + PAGE, /mock-exam-runner\.js/);
    assert.match(RUNNER, /status === 'signed-out'[\s\S]*window\.location\.replace\('\/login'\)/);
    assert.match(LEGACY_RUNNER, /Thiếu mã kỳ thi \(\?code=\) hoặc mã lượt thi \(\?sitting=\)\./);
  });

  test('binds state to the authenticated owner and current query identity', () => {
    assert.match(RUNNER, /mock-sitting-owner-mismatch/);
    assert.match(RUNNER, /normalizeMockExamState\(payload, id\)/);
    assert.match(RUNNER, /controllerRef\.current\?\.abort\(\)/);
    assert.match(RUNNER, /if \(!params\.error\) return/);
    const integrity = RUNNER.split('const bumpIntegrity')[1].split('const reportIntegrity')[0];
    assert.equal((integrity.match(/values\[key\]\s*=/g) || []).length, 1);
  });

  test('ignores an older sitting-state response after a newer read starts', () => {
    assert.match(RUNNER, /const generation = \+\+stateReadGenerationRef\.current/);
    assert.match(RUNNER, /generation !== stateReadGenerationRef\.current[\s\S]*return next[\s\S]*return commitState\(next\)/);
  });

  test('uses the server clock and never exposes an early manual submit', () => {
    assert.match(RUNNER, /sectionTimeLeftSeconds/);
    assert.match(RUNNER, /timerAnchorRef/);
    assert.match(RUNNER, /next === 0[\s\S]*timerSubmitTriggeredRef\.current = activeSection[\s\S]*!alreadyTriggered[\s\S]*submitRef\.current\(activeSection\)/);
    assert.match(RUNNER, /sectionTimeLeftSeconds > 0[\s\S]*timerSubmitTriggeredRef\.current = null/);
    assert.doesNotMatch(RUNNER, />\s*Nộp bài\s*</);
  });

  test('flushes same-origin child players before domain and sitting finalization', () => {
    assert.match(RUNNER, /event\.origin !== window\.location\.origin/);
    assert.match(RUNNER, /event\.source !== frame\.contentWindow/);
    assert.match(RUNNER, /mock-embed-unsaved-answers/);
    assert.match(RUNNER, /mock-embed-invalid-flush-response/);
    assert.match(RUNNER, /mock-embed-not-ready/);
    assert.doesNotMatch(RUNNER, /!frame\?\.contentWindow\) \{ resolve\(\)/);
    assert.match(RUNNER, /EMBED_FLUSH_TIMEOUT_MS = 8_000/);
    assert.match(RUNNER, /window\.clearTimeout\(timeout\)/);
    assert.match(RUNNER, /typeof unsaved !== 'number'/);
    const submit = RUNNER.split('const doSubmit')[1].split('const submitSection')[0];
    assert.ok(submit.indexOf('await flushEmbed(section)') < submit.indexOf('const domainPath'));
    assert.ok(submit.indexOf('const domainPath') < submit.indexOf('/sections/${section}/submit'));
    assert.match(LISTENING_PLAYER, /event\.source !== window\.parent/);
    assert.match(READING_PLAYER, /event\.source !== window\.parent/);
    assert.match(RUNNER, /awaitingCollectionFlush[\s\S]*renderedSection/);
    assert.match(RUNNER, /await flushEmbed\(pendingCollectionSection\)[\s\S]*acknowledgeCollectionFlush\(pendingCollectionSection\)[\s\S]*setFlushedCollectionKey/);
    assert.match(RUNNER, /\/sections\/\$\{section\}\/flush-ack/);
    assert.match(RUNNER, /<iframe inert=\{awaitingCollectionFlush\}/);
    assert.match(RUNNER, /WritingWorkspace[\s\S]*locked=\{awaitingCollectionFlush\}/);
    assert.match(RUNNER, /readOnly=\{locked\}/);
    for (const player of [LISTENING_PLAYER, READING_PLAYER]) {
      const handler = player.split("event.data?.type !== 'mock-flush'")[1];
      assert.ok(handler.indexOf('collectionFrozenRef.current = true') < handler.indexOf('coordinatorRef.current?.flush?.()'));
      assert.match(handler, /document\.body\.inert = true/);
      assert.match(player, /if \(collectionFrozenRef\.current\) return/);
    }
    assert.match(LEGACY_READING, /_flushPendingSavesForMock/);
    assert.match(LEGACY_READING, /_waitForInflightSaves\(\)\.then/);
    assert.match(LEGACY_READING, /SESSION\.inflight\.size === 0/);
    assert.match(LEGACY_READING, /unsaved: clean \? 0 : Math\.max\(1, SESSION\.unsaved\.size\)/);
    assert.doesNotMatch(LEGACY_READING, /mock-flushed', section: 'reading' \},/);
  });

  test('serializes Writing autosave and reuses one immutable final payload', () => {
    assert.match(RUNNER, /if \(active\) \{ try \{ await active; \}/);
    assert.match(RUNNER, /finalWritingBodyRef\.current/);
    assert.match(RUNNER, /canDiscardWritingDrafts\(next\.sitting\.writingSubmission, localDrafts\)[\s\S]*clearLocalDrafts\(next\.sitting\.id\)/);
    assert.match(RUNNER, /SUBMIT_RETRY_DELAYS/);
    assert.match(RUNNER, /isMockSubmitSettled/);
    assert.match(RUNNER, /const settled = isMockSubmitSettled\(state, 'writing'\)[\s\S]*activeSection === 'writing'/);
    assert.match(RUNNER, /pendingCollectionSection === 'writing'[\s\S]*await bridge\.flush\(\)[\s\S]*acknowledgeCollectionFlush/);
    assert.match(RUNNER, /return true;[\s\S]*catch \{ return false; \}/);
    assert.match(RUNNER, /setLocalBackupFailed\(!writeLocalDraft/);
    assert.match(RUNNER, /const task1BackedUp = writeLocalDraft[\s\S]*const task2BackedUp = writeLocalDraft[\s\S]*setLocalBackupFailed\(!task1BackedUp \|\| !task2BackedUp\)/);
    assert.match(RUNNER, /const edit = useCallback[\s\S]*setSaveCue\(\(current\) => current === 'failed' \? current : 'idle'\);[\s\S]*setLocalBackupFailed\(!writeLocalDraft/);
    assert.match(RUNNER, /const retryPending = retryRef\.current > 0;[\s\S]*delta >= 400[\s\S]*!retryPending/);
    assert.match(RUNNER, /Trình duyệt không tạo được bản dự phòng trên thiết bị/);
    assert.match(RUNNER, /Đã lưu lên máy chủ lúc/);
    assert.match(RUNNER, /Chưa lưu được lên máy chủ và trình duyệt không tạo được bản dự phòng/);
    assert.doesNotMatch(RUNNER, /bài vẫn giữ trên máy này/);
  });

  test('ships responsive accessible panes and a hermetic browser gate', () => {
    assert.match(RUNNER, /role="separator"/);
    assert.match(RUNNER, /aria-orientation=\{narrow/);
    assert.match(CSS, /@media \(max-width: 860px\)/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(WORKFLOW, /verify-mock-exam-flow\.mjs/);
  });
});
