import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  MIX_CRITERIA,
  assembleInstructorPreview,
  defaultInstructorPicks,
  instructorCompareBackHref,
  instructorComposePayload,
  normalizeInstructorVersions,
} from '../lib/instructor-compare-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'app', '(authed-instructor-compare)', 'instructor', 'compare', 'page.tsx'), 'utf8');
const VIEW = readFileSync(join(ROOT, 'app', '(authed-instructor-compare)', 'instructor', 'compare', 'instructor-compare.tsx'), 'utf8');
const LAYOUT = readFileSync(join(ROOT, 'app', '(authed-instructor-compare)', 'layout.tsx'), 'utf8');

function feedback(version, bands) {
  return {
    overallBandScore: 6,
    overallBandScoreSummary: `summary-v${version}`,
    keyTakeaways: { strengths: [`strength-v${version}`], areasForImprovement: [] },
    criteriaFeedback: Object.fromEntries(MIX_CRITERIA.map((key, index) => [key, {
      bandScore: bands[index],
      feedback: `${key}-v${version}`,
      explanation: `explain-${key}-v${version}`,
    }])),
    mistakeAnalysis: [{ original: `mistake-v${version}` }],
    improvedEssay: `essay-v${version}`,
  };
}

function envelope() {
  return {
    versions: [
      { version: 2, source: 'ai_pro', overall_band_score: 7, created_at: '2026-08-16T00:00:00Z', feedback_json: feedback(2, [7, 7, 7, 7]) },
      { version: 1, source: 'ai_pro', overall_band_score: 6, created_at: '2026-08-15T00:00:00Z', feedback_json: feedback(1, [6, 6, 6, 6]) },
    ],
    budget: { live_count: 2, max: 3, can_compose: true },
  };
}

describe('/instructor/compare canonical model', () => {
  test('accepts the full canonical payload and rejects partial or contradictory state', () => {
    const normalized = normalizeInstructorVersions(envelope());
    assert.equal(normalized.versions[0].feedbackJson.improvedEssay, 'essay-v2');
    assert.equal(normalized.budget.liveCount, 2);

    const missingFullFeedback = envelope();
    delete missingFullFeedback.versions[0].feedback_json;
    assert.equal(normalizeInstructorVersions(missingFullFeedback), null);

    const badCount = envelope();
    badCount.budget.live_count = 1;
    assert.equal(normalizeInstructorVersions(badCount), null);

    const badOrder = envelope();
    badOrder.versions.reverse();
    assert.equal(normalizeInstructorVersions(badOrder), null);

    const badBand = envelope();
    badBand.versions[0].feedback_json.criteriaFeedback.lexicalResource.bandScore = 12;
    assert.equal(normalizeInstructorVersions(badBand), null);
  });

  test('assembles all four whole criteria and keeps non-criteria content from the selected base', () => {
    const snapshot = normalizeInstructorVersions(envelope());
    const picks = { ...defaultInstructorPicks(snapshot) };
    picks.grammaticalRange = 1;
    const preview = assembleInstructorPreview(snapshot, 1, picks);
    assert.equal(preview.criteriaFeedback.mainCriterion.feedback, 'mainCriterion-v2');
    assert.equal(preview.criteriaFeedback.grammaticalRange.feedback, 'grammaticalRange-v1');
    assert.equal(preview.overallBandScore, 7);
    assert.equal(preview.improvedEssay, 'essay-v1');
    assert.equal(preview.overallBandScoreSummary, 'summary-v1');
  });

  test('builds the exact mutation body and safe legacy-grade back link', () => {
    const picks = Object.fromEntries(MIX_CRITERIA.map((key) => [key, 2]));
    assert.deepEqual(instructorComposePayload(1, picks), {
      base_version: 1,
      mainCriterion: 2,
      coherenceCohesion: 2,
      lexicalResource: 2,
      grammaticalRange: 2,
    });
    assert.equal(
      instructorCompareBackHref('essay/a', 'teacher/b'),
      '/pages/instructor/grade.html?essay_id=essay%2Fa&as_instructor=teacher%2Fb',
    );
    assert.throws(() => instructorCompareBackHref('', null), /essay-id-required/);
  });
});

describe('/instructor/compare native route contracts', () => {
  test('owns a native App Router page and reuses the learner renderer', () => {
    assert.match(PAGE, /InstructorCompare/);
    assert.match(LAYOUT, /chrome="none"/);
    assert.match(LAYOUT, /writing-renderers\.css/);
    assert.match(LAYOUT, /writing-renderers\.js/);
    assert.match(LAYOUT, /instructor-compare-next\.css/);
    assert.match(VIEW, /window\.WritingRenderers/);
    assert.doesNotMatch(VIEW, /window\.location\.href\s*=\s*['"]\/pages\/instructor\/compare\.html/);
  });

  test('role-gates before owner reads and propagates impersonation through the shared helper', () => {
    const roleGuard = VIEW.indexOf("['instructor', 'admin'].includes(profile.role)");
    const ownerRead = VIEW.indexOf('await readCanonical(query.essayId, effective)');
    assert.ok(roleGuard >= 0 && ownerRead > roleGuard);
    assert.match(VIEW, /normalizeInstructorProfile\(await window\.api\.get<unknown>\('\/auth\/me'\)\)/);
    assert.match(VIEW, /instructorApiPath\(`\/instructor\/essays\/\$\{encodeURIComponent\(id\)\}\/versions`, target\)/);
    assert.match(VIEW, /profile\.role === 'admin' \? query\.requestedInstructor : null/);
  });

  test('reconciles compose by canonical GET and never automatically replays POST', () => {
    assert.match(VIEW, /await window\.api\.post\(path, instructorComposePayload\(baseVersion, picks\)\)/);
    assert.match(VIEW, /const canonical = await readCanonical\(essayId, asInstructor\)/);
    assert.match(VIEW, /không tự gửi lại mutation/);
    assert.doesNotMatch(VIEW, /while\s*\([^)]*\)[\s\S]{0,300}window\.api\.post/);
    assert.match(VIEW, /ownerId !== accountRef\.current/);
    assert.match(VIEW, /mutationScope !== sequence\.current/);
    assert.match(VIEW, /needsReconcile \? 'Đọc lại trạng thái'/);
    assert.match(VIEW, /không mutation nào được gửi/);
  });
});
