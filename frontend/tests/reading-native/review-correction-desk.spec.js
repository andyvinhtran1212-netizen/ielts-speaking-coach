const { test, expect } = require('@playwright/test');
const { ATTEMPT, cors, installReadingHarness } = require('./reading-native-harness');

const explanation = (skill) => ({
  item: {
    options: [
      { label: 'A', text: 'A change in public policy' },
      { label: 'B', text: 'A decline in local demand' },
      { label: 'C', text: 'An unexpected research result' },
    ],
    answer: { canonical: 'B' },
  },
  explanation: {
    answer_summary: 'B. A decline in local demand',
    source_evidence: skill === 'reading'
      ? [{ location: 'Passage 1, paragraph 2', quote: 'Demand fell sharply after the first quarter.', relation: '“decline” paraphrases “fell sharply”.' }]
      : [{ location: 'Section 1', timestamp: '42-49s', quote: 'Actually, demand dropped after March.', relation: 'The speaker corrects the earlier estimate.' }],
    decisive_word_or_paraphrase: '**decline** = *fell sharply*',
    why_correct: 'The statement matches both the direction of change and the period described in the source.',
    why_other_answers_fail: 'A mentions policy, which is discussed later but does not explain this result. C reverses the cause and effect.',
    paraphrase: 'decline → fall sharply\nlocal demand → demand in the area',
    trap: 'Do not select an option merely because it repeats a nearby noun.',
    vocabulary: '`decline` — sự suy giảm',
  },
  remediation: { candidate_error_subtypes: [skill === 'reading' ? 'R07-DISTRACTOR' : 'L07-MISSED_CORRECTION'] },
  correction_flow: { same_source_repair: { prompt_vi: 'Chỉ ra từ nào phủ định phương án A.', pass_rule: 'Nêu đúng cụm quyết định.' } },
});

const readingReview = {
  attempt_id: ATTEMPT,
  test_id: 'CAMBRIDGE-18-R1',
  title: 'Cambridge IELTS 18 · Reading Test 1',
  status: 'submitted', score: 31, max_score: 40, band_estimate: 7,
  skill_breakdown: { inference: { correct: 6, total: 10 }, detail: { correct: 9, total: 10 } },
  passages: [{
    passage_order: 1,
    title: 'The changing role of public libraries',
    body_markdown: 'Public libraries have changed considerably over the past decade.\n\nDemand fell sharply after the first quarter, although visits for community events continued to rise.\n\nResearchers later found that residents valued access to quiet study areas more than expected.',
    translation_vi: 'Thư viện công cộng đã thay đổi đáng kể trong thập kỷ qua.',
  }],
  review: [
    { q_num: 1, passage_order: 1, correct: false, question_type: 'multiple choice', prompt: 'What was the main reason for the change described in paragraph 2?', user_answer: 'A', expected: 'B', web_explanation_object: explanation('reading') },
    { q_num: 2, passage_order: 1, correct: true, question_type: 'true / false / not given', prompt: 'Community-event visits continued to increase.', user_answer: 'TRUE', expected: 'TRUE', web_explanation_object: explanation('reading') },
  ],
};

const listeningReview = {
  attempt_id: ATTEMPT,
  test_id: 'CAMBRIDGE-18-L1',
  title: 'Cambridge IELTS 18 · Listening Test 1',
  status: 'submitted', score: 32, max_score: 40, band_estimate: 7.5,
  audio_url: 'https://audio.test/cambridge.mp3', audio_duration: 1800,
  sections: [{ section_num: 1, theme: 'Market research', transcript: '**Interviewer:** Was policy the main reason?\n\n**Researcher:** We thought so at first. Actually, demand dropped after March, while attendance at community events increased.\n\n**Interviewer:** That is useful to know.' }],
  review: [
    { q_num: 1, section: 'Section 1', correct: false, question_type: 'multiple choice', prompt: 'What caused the change?', user_answer: 'A', expected: 'B', transcript_anchor: 1, audio_window: { start: 42, end: 49, section: 'Section 1' }, solution: { skills: 'K2, K4' }, web_explanation_object: explanation('listening') },
    { q_num: 2, section: 'Section 1', correct: true, question_type: 'sentence completion', prompt: 'Attendance increased at community _____.', user_answer: 'events', expected: 'events', transcript_anchor: 1, audio_window: { start: 47, end: 52, section: 'Section 1' }, solution: { skills: 'K2' }, web_explanation_object: explanation('listening') },
  ],
};

async function apiReview({ route, request, url }) {
  if (url.pathname.endsWith(`/attempts/${ATTEMPT}/review`)) {
    await route.fulfill({ json: url.pathname.includes('/reading/') ? readingReview : listeningReview, headers: cors });
    return true;
  }
  if (request.method() === 'POST' && url.pathname.includes('/api/mock-corrections/')) {
    const event = request.postDataJSON()?.event_name;
    const states = {
      correction_result_seen: 'RESULT_ONLY', evidence_attempt_submitted: 'EVIDENCE_ATTEMPTED',
      hint_revealed: request.postDataJSON()?.payload?.hint_type === 'decisive' ? 'DECISIVE_HINT_SEEN' : 'LOCATION_HINT_SEEN',
      full_explanation_opened: 'FULL_EXPLANATION_SEEN', correction_output_submitted: 'CORRECTION_OUTPUT_SUBMITTED',
    };
    await route.fulfill({ json: { state: states[event] }, headers: cors });
    return true;
  }
  return false;
}

test('Reading review presents the guided correction desk in both themes', async ({ page }) => {
  await installReadingHarness(page, { route: `/reading/review?attempt_id=${ATTEMPT}`, handleApi: apiReview });
  await expect(page.getByRole('heading', { name: 'Hiểu lỗi, sửa đúng cách' })).toBeVisible();
  await page.getByText('Câu 1', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Tìm bằng chứng, thử lại, rồi mới mở lời giải' })).toBeVisible();
  await expect(page.locator('.wex-progress')).toBeVisible();
  await expect(page.locator('.rr-card.is-current')).toHaveCount(1);
  await page.screenshot({ path: '/tmp/reading-review-correction-desk-light.png', fullPage: false });
  await page.locator('.wex-panel').screenshot({ path: '/tmp/reading-review-explanation-light.png' });
  await page.getByRole('button', { name: 'Tôi chưa tìm được' }).click();
  await page.getByRole('button', { name: 'Chốt và tiếp tục' }).click();
  await page.getByRole('button', { name: 'Xem vị trí nguồn' }).click();
  await page.getByRole('button', { name: 'Mở gợi ý quyết định' }).click();
  await page.getByRole('button', { name: 'Mở lời giải đầy đủ' }).click();
  await expect(page.getByText('Đáp án chuẩn')).toBeVisible();
  await page.locator('.wex-panel').screenshot({ path: '/tmp/reading-review-explanation-full-light.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: '/tmp/reading-review-correction-desk-dark.png', fullPage: false });
  await page.locator('.wex-panel').screenshot({ path: '/tmp/reading-review-explanation-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    window.scrollTo(0, 0);
  });
  await expect(page.locator('.rr-card.is-current')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/reading-review-correction-desk-mobile.png', fullPage: false });
  await page.locator('.rr-card.is-current').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/reading-review-correction-card-mobile.png', fullPage: false });
});

test('Listening review keeps transcript, audio context and correction steps together', async ({ page }) => {
  await installReadingHarness(page, { route: `/listening/review?attempt_id=${ATTEMPT}`, handleApi: apiReview });
  await expect(page.getByRole('heading', { name: 'Nghe lại, nhận ra tín hiệu' })).toBeVisible();
  await page.getByText('Câu 1', { exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Nghe đoạn Section 1/ })).toBeVisible();
  await expect(page.locator('.wex-progress')).toBeVisible();
  await expect(page.locator('.lr-card.is-current')).toHaveCount(1);
  await page.screenshot({ path: '/tmp/listening-review-correction-desk-light.png', fullPage: false });
  await page.locator('.wex-panel').screenshot({ path: '/tmp/listening-review-explanation-light.png' });
  await page.getByRole('button', { name: 'Tôi chưa tìm được' }).click();
  await page.getByRole('button', { name: 'Chốt và tiếp tục' }).click();
  await page.getByRole('button', { name: 'Xem vị trí nguồn' }).click();
  await page.getByRole('button', { name: 'Mở gợi ý quyết định' }).click();
  await page.getByRole('button', { name: 'Mở lời giải đầy đủ' }).click();
  await expect(page.getByText('Đáp án chuẩn')).toBeVisible();
  await page.locator('.wex-panel').screenshot({ path: '/tmp/listening-review-explanation-full-light.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: '/tmp/listening-review-correction-desk-dark.png', fullPage: false });
  await page.locator('.wex-panel').screenshot({ path: '/tmp/listening-review-explanation-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    window.scrollTo(0, 0);
  });
  await expect(page.locator('.lr-card.is-current')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/listening-review-correction-desk-mobile.png', fullPage: false });
  await page.locator('.lr-card.is-current').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/listening-review-correction-card-mobile.png', fullPage: false });
});
