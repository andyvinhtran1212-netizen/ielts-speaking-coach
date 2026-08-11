// Gate E evidence: drive the hydrated native `/practice/session` route through
// each supported Speaking shape. Supabase, backend and third-party scripts are
// deterministic browser fixtures; no request leaves the Playwright process.
const { test, expect } = require('@playwright/test');
const { SID, installHarness } = require('./native-speaking-harness');
const CHAIN_KEY = 'ielts_ft_session_ids';

function question(id, part, text, extra = {}) {
  return {
    id,
    part,
    order_num: Number(id.replace(/\D/g, '')) || 1,
    question_text: text,
    ...extra,
  };
}

function partOneQuestions(count = 3) {
  return Array.from({ length: count }, (_, index) => question(
    `q${index + 1}`,
    1,
    `Question ${index + 1}?`,
    { subtopic: index < 3 ? 'Home' : index < 6 ? 'Work' : 'Hobbies' },
  ));
}

function baseSession(overrides = {}) {
  return {
    id: SID,
    session_id: SID,
    mode: 'practice',
    part: 1,
    topic: 'Home',
    status: 'in_progress',
    responses: [],
    ...overrides,
  };
}

test('practice boots into the native visual prep state', async ({ page }) => {
  await installHarness(page, {
    session: baseSession(),
    questions: partOneQuestions(3),
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 1 / 3');
  await expect(page.locator('#prep-q-text')).toHaveText('Question 1?');
  await expect(page.locator('#test-mode-banner')).toBeHidden();
});

test('test_part exposes exam progress but keeps the visual question', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({ mode: 'test_part' }),
    questions: partOneQuestions(5),
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#test-mode-banner')).toBeVisible();
  await expect(page.locator('#progress-bar-label')).toHaveText('Câu 1 / 5');
  await expect(page.locator('#prep-q-text')).toHaveText('Question 1?');
  await expect(page.locator('#prep-text-reveal')).toBeVisible();
});

test('test_full boots in listening mode and persists its canonical attempt identity', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({
      mode: 'test_full',
      topic: 'Home|||Work|||Hobbies',
      full_test_attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }),
    questions: partOneQuestions(9),
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#test-mode-banner')).toBeVisible();
  await expect(page.locator('#progress-bar-label')).toContainText('Tổng: 1 / 15');
  await expect(page.locator('#prep-text-reveal')).toBeHidden();
  await expect(page.locator('#prep-reveal-btn')).toBeVisible();
  await expect.poll(() => page.evaluate((key) => (
    JSON.parse(window.sessionStorage.getItem(key) || 'null')
  ), CHAIN_KEY)).toEqual([SID]);
});

test('Part 2 renders the dedicated cue-card state', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({ part: 2, topic: 'A useful skill' }),
    questions: [question('q1', 2, 'Describe a useful skill you learned.', {
      cue_card_bullets: ['what the skill is', 'how you learned it', 'why it is useful'],
      cue_card_reflection: 'and explain how it changed your daily life',
    })],
  });

  await expect(page.locator('#state-p2a')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#p2a-question')).toHaveText('Describe a useful skill you learned.');
  await expect(page.locator('#p2a-bullets li')).toHaveCount(3);
  await expect(page.locator('#p2a-reflection')).toContainText('changed your daily life');
});

test('class assignment renders the multi-question answer sheet from persisted truth', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({
      class_assignment_item_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      class_task: { accepting: true, submitted_at: null },
      responses: [{
        id: 'r1',
        question_id: 'q1',
        grading_status: 'completed',
        overall_band: 6.5,
        feedback: { overall_band: 6.5 },
      }],
    }),
    questions: partOneQuestions(2),
  });

  await expect(page.locator('#state-sheet')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#sheet-slots .av-slot')).toHaveCount(2);
  await expect(page.locator('#sheet-meter-count')).toHaveText('Đã lưu 1/2');
  await expect(page.locator('#sheet-slots .av-slot').nth(0)).toHaveAttribute('data-state', 'saved');
  await expect(page.locator('#sheet-slots .av-slot').nth(1)).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#btn-sheet-submit')).toBeDisabled();
});

test('sealed mock resumes from response receipts without leaking result data', async ({ page }) => {
  await installHarness(page, {
    session: baseSession({
      mode: 'test_full',
      topic: 'Home|||Work|||Hobbies',
      sitting_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      full_test_attempt_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      results_sealed: true,
      responses: [],
      response_receipts: [{ id: 'sealed-r1', question_id: 'q1' }],
    }),
    questions: partOneQuestions(9),
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 2 / 9');
  await expect(page.locator('#prep-q-text')).toHaveText('Question 2?');
  await expect(page.locator('#state-feedback')).not.toHaveClass(/\bactive\b/);
  await expect(page.locator('body')).not.toContainText('6.5');
  await expect(page.locator('body')).not.toContainText('sealed-r1');
});
