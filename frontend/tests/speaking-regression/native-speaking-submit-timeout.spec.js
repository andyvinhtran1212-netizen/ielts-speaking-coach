const { test, expect } = require('@playwright/test');
const { SID, installHarness } = require('./native-speaking-harness');

// Isolate submission recovery from microphone permissions: the real player
// receives a playable WAV through its recorder callback and uses real fetch.
async function installRecordedTake(page) {
  await page.evaluate(() => {
    const samples = 8_000;
    const bytes = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(bytes);
    const text = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
    text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, samples, true); view.setUint32(28, samples * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples * 2, true);
    const blob = new Blob([bytes], { type: 'audio/wav' });
    let onRecorded;
    window.PracticeRecorder.start = async (options) => { onRecorded = options.onRecorded; return true; };
    window.PracticeRecorder.getAnalyser = () => null;
    window.PracticeRecorder.stop = () => { onRecorded(blob); return true; };
    window.PracticeRecorder.getBlob = () => blob;
  });
}

for (const hangReadback of [false, true]) {
  test(`Part 2 keeps playable audio after upload timeout${hangReadback ? ' and readback timeout' : ''}, then recovers without reupload`, async ({ page }) => {
    let persisted = false;
    let sessionReads = 0;
    let submissionId;
    const { calls, pageErrors } = await installHarness(page, {
      session: () => ({
        id: SID, session_id: SID, mode: 'practice', part: 2,
        topic: 'A special cake', status: 'in_progress', submission_retry_safe: true,
        responses: persisted ? [{
          id: 'saved-timeout-take', question_id: 'q1', grading_status: 'completed', submission_id: submissionId,
          transcript: 'I received a special cake for my birthday.',
          overall_band: 6.5, feedback: { overall_band: 6.5 },
        }] : [],
      }),
      questions: [{ id: 'q1', part: 2, order_num: 1, question_text: 'Describe a special cake you received.' }],
      handleApi: async ({ request, path }) => {
        if (request.method() === 'POST' && path === `/sessions/${SID}/responses`) {
          submissionId = request.postData().match(/name="submission_id"\r\n\r\n([^\r]+)/)[1];
          // Leave the real browser request pending until its AbortSignal fires.
          return true;
        }
        if (request.method() === 'GET' && path === `/sessions/${SID}`) {
          sessionReads += 1;
          if (hangReadback && sessionReads === 3) return true;
        }
        return false;
      },
    });
    await installRecordedTake(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.locator('#p2a-start-btn').click();
    await page.locator('#state-p2b button').click();
    await expect(page.locator('#state-p2c')).toHaveClass(/\bactive\b/);
    await page.locator('#state-p2c button').click();
    await expect(page.locator('#state-processing')).toHaveClass(/\bactive\b/);
    await expect.poll(() => calls.filter((call) => call === `POST /sessions/${SID}/responses`).length).toBe(1);

    await page.clock.fastForward(180_001);
    await expect.poll(() => sessionReads).toBe(3);
    if (hangReadback) await page.clock.fastForward(15_001);
    await expect(page.locator('#p2a-submit-retry')).toBeVisible();
    await expect(page.locator('#state-processing')).not.toHaveClass(/\bactive\b/);
    await expect(page.locator('#p2a-submit-retry-msg')).toContainText('Bản ghi vẫn còn');
    const replay = page.locator('#p2a-submit-retry-audio');
    await expect(replay).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => replay.evaluate((audio) => audio.duration)).toBe(1);
    await replay.evaluate((audio) => audio.play());
    await expect.poll(() => replay.evaluate((audio) => audio.paused)).toBe(false);
    await replay.evaluate((audio) => audio.pause());

    // The server finishes after the browser deadline. Retry must read that
    // canonical response rather than sending a second copy of the recording.
    persisted = true;
    await page.locator('#p2a-submit-retry button').filter({ hasText: 'Gửi lại bản ghi' }).click();
    await expect(page.locator('#state-feedback')).toHaveClass(/\bactive\b/);
    expect(sessionReads).toBe(4);
    expect(calls.filter((call) => call === `POST /sessions/${SID}/responses`)).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  });
}

test('Part 2 Retry submits retained audio when the upload adapter never settles', async ({ page }) => {
  const { pageErrors } = await installHarness(page, {
    session: { id: SID, session_id: SID, mode: 'practice', part: 2,
      topic: 'A special cake', status: 'in_progress', responses: [] },
    questions: [{ id: 'q1', part: 2, order_num: 1, question_text: 'Describe a special cake you received.' }],
    handleApi: async ({ route, request, path, cors }) => {
      if (request.method() !== 'POST' || path !== `/sessions/${SID}/responses`) return false;
      await route.fulfill({ headers: cors, json: { response_id: 'retry-r1', overall_band: 6.5,
        transcript: 'I received a special cake for my birthday.' } });
      return true;
    },
  });
  await installRecordedTake(page);
  await page.evaluate(() => {
    const realUpload = window.api.uploadWith.bind(window.api);
    window.__timeoutRecordingKeys = [];
    window.api.uploadWith = (path, data, ...rest) => {
      window.__timeoutRecordingKeys.push(data.get('submission_id'));
      return window.__timeoutRecordingKeys.length === 1
        ? new Promise(() => {}) : realUpload(path, data, ...rest);
    };
  });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.locator('#p2a-start-btn').click();
  await page.locator('#state-p2b button').click();
  await page.locator('#state-p2c button').click();
  await expect.poll(() => page.evaluate(() => window.__timeoutRecordingKeys.length)).toBe(1);
  await page.clock.fastForward(180_001);
  await expect(page.locator('#p2a-submit-retry')).toBeVisible();
  await expect(page.locator('#p2a-submit-retry-audio')).toHaveAttribute('src', /^blob:/);
  await page.locator('#p2a-submit-retry button').filter({ hasText: 'Gửi lại bản ghi' }).click();
  await expect(page.locator('#state-feedback')).toHaveClass(/\bactive\b/);
  const keys = await page.evaluate(() => window.__timeoutRecordingKeys);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(pageErrors).toEqual([]);
});
