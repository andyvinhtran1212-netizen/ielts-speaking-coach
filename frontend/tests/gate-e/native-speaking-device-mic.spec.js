// Gate E exit 3 automated matrix. Runs unchanged on Chromium desktop, WebKit
// desktop and WebKit with an iPhone 13 context. Real Safari/iOS hardware stays
// a separately versioned manual drill; Playwright WebKit is not relabelled as it.
const { test, expect } = require('@playwright/test');
const { SID, installHarness } = require('./native-speaking-harness');

function practiceSession() {
  return {
    id: SID,
    session_id: SID,
    mode: 'practice',
    part: 1,
    topic: 'Home',
    status: 'in_progress',
    responses: [],
  };
}

const questions = [{
  id: 'q1',
  part: 1,
  order_num: 1,
  question_text: 'Tell me about your home.',
}];

async function installEngineOwnedMic(page, { denyFirst }) {
  let stoppedTracks = 0;
  await page.exposeFunction('__gateETrackStopped', () => {
    stoppedTracks += 1;
  });

  await page.addInitScript(({ shouldDenyFirst }) => {
    window.__gateEMic = { calls: 0, acquired: 0, installed: false };
    const media = navigator.mediaDevices || {};
    const fixtureGetUserMedia = async (constraints) => {
      window.__gateEMic.calls += 1;
      if (shouldDenyFirst && window.__gateEMic.calls === 1) {
        throw new DOMException('fixture denied once', 'NotAllowedError');
      }
      if (!constraints?.audio) throw new TypeError('audio constraint required');
      // A Web Audio tone is a real engine-owned MediaStreamTrack and produces
      // real MediaRecorder bytes, while avoiding OS/hardware permission state
      // that differs between local macOS and CI. Real Safari/iOS hardware is a
      // separate manual drill and is never inferred from this fixture.
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) throw new Error('Web Audio unavailable');
      const audioContext = new AudioContextCtor();
      await audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const destination = audioContext.createMediaStreamDestination();
      oscillator.frequency.value = 440;
      oscillator.connect(destination);
      oscillator.start();
      const stream = destination.stream;
      window.__gateEMic.acquired += 1;
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        let stopped = false;
        track.stop = () => {
          if (stopped) return;
          stopped = true;
          stop();
          // Report outside the document so a navigation cannot erase evidence
          // before the assertion reads it from the destination route.
          try { void window.__gateETrackStopped(); } catch {}
          try { oscillator.stop(); } catch {}
          try { void audioContext.close(); } catch {}
        };
      }
      return stream;
    };

    // WebKit exposes getUserMedia through a host object whose direct assignment
    // can be ignored. An own descriptor makes fixture installation auditable.
    Object.defineProperty(media, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: fixtureGetUserMedia,
    });
    if (navigator.mediaDevices !== media) {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: media,
      });
    }
    window.__gateEMic.installed = navigator.mediaDevices?.getUserMedia === fixtureGetUserMedia;
  }, { shouldDenyFirst: denyFirst });

  return () => stoppedTracks;
}

async function bootPractice(page, denyFirst = true) {
  const stoppedTracks = await installEngineOwnedMic(page, { denyFirst });
  const harness = await installHarness(page, {
    session: practiceSession(),
    questions,
  });
  expect(await page.evaluate(() => window.__gateEMic?.installed)).toBe(true);
  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  return { ...harness, stoppedTracks };
}

test('permission denial can retry and survive parallel-tab pressure', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  const { pageErrors, stoppedTracks } = await bootPractice(page);
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(layout.content, `${testInfo.project.name} horizontal overflow`).toBeLessThanOrEqual(
    layout.viewport + 1,
  );

  // First user gesture receives a real recorder-domain permission error.
  await page.locator('#prep-start-btn').click();
  await expect(page.locator('#rec-error')).toBeVisible();
  await expect(page.locator('#rec-error')).toContainText(
    'Bạn đã từ chối quyền microphone. Hãy cho phép trong thanh địa chỉ trình duyệt rồi thử lại.',
  );
  expect(await page.evaluate(() => window.__gateEMic.calls)).toBe(1);
  expect(await page.evaluate(() => window.PracticeRecorder.isRecording())).toBe(false);

  // Retry stays in the same React state and uses a real engine-owned track.
  await page.locator('#rec-idle button').click();
  await expect(page.locator('#rec-error')).toBeHidden();
  await expect(page.locator('#rec-recording')).toBeVisible();
  expect(await page.evaluate(() => window.__gateEMic.calls)).toBe(2);
  expect(await page.evaluate(() => window.PracticeRecorder.isRecording())).toBe(true);

  await page.waitForTimeout(1_500);
  await page.locator('#rec-recording button').click();
  await expect(page.locator('#rec-recorded')).toBeVisible();
  const recorded = await page.evaluate(() => {
    const blob = window.PracticeRecorder.getBlob();
    return { size: blob?.size || 0, type: blob?.type || '' };
  });
  expect(recorded.size).toBeGreaterThan(100);
  if (browserName === 'chromium') expect(recorded.type).toContain('webm');
  else expect(recorded.type).toMatch(/mp4|webm|ogg/);

  // Start another take and open a competing app tab. Headless browser contexts
  // do not expose a trustworthy OS-level background visibility transition, so
  // this proves only cross-tab pressure. The real background/lock-screen case
  // remains in the manual Safari/iOS drill.
  await page.locator('#rec-recorded button').filter({ hasText: 'Ghi lại' }).click();
  await page.locator('#rec-idle button').click();
  await expect(page.locator('#rec-recording')).toBeVisible();

  const foreground = await context.newPage();
  await foreground.goto('/next-probe');
  await foreground.bringToFront();
  await page.waitForTimeout(500);
  await page.bringToFront();
  expect(await page.evaluate(() => window.PracticeRecorder.isRecording())).toBe(true);

  await page.evaluate(() => window.PracticeRecorder.release());
  await expect.poll(stoppedTracks).toBeGreaterThanOrEqual(1);
  expect(pageErrors).toEqual([]);
  await foreground.close();
});

test('Next route unmount releases every owned microphone track', async ({ page }) => {
  const { pageErrors, stoppedTracks } = await bootPractice(page, false);
  await page.locator('#prep-start-btn').click();
  await expect(page.locator('#rec-recording')).toBeVisible();
  expect(await page.evaluate(() => window.PracticeRecorder.isRecording())).toBe(true);

  // The native Next link exercises React's unmount cleanup. A hard page.goto
  // would let the browser release hardware by destroying the whole document
  // and could hide a missing route-owned cleanup.
  await page.evaluate(() => { window.__gateESameDocument = true; });
  await page.locator('.practice-back-link').click();
  await expect(page).toHaveURL(/\/speaking$/);
  expect(await page.evaluate(() => window.__gateESameDocument)).toBe(true);
  await expect.poll(stoppedTracks).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => typeof window.PracticeRecorder)).toBe('undefined');
  expect(pageErrors).toEqual([]);
});
