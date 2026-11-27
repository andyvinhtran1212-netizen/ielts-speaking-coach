/**
 * mock-review-blankable-bands.test.mjs — the review console must let the
 * examiner leave a band blank when the raw score HAS no band (Listening 0/40,
 * any Phase-1 General Training Reading), and must still refuse a forgotten one.
 *
 * Codex P1 on PR #779: the backend allowance was unreachable because the client
 * demanded every required band, so the POST never fired.
 *
 * LEGACYJS-0075 W2 retired `admin-mock-reviews.js`; the save gate now lives in
 * `buildFinalBandsPayload` (lib/admin-mock-reviews-model.mjs) and is RUN here,
 * because a source match would not catch a gate that kills the feature.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bandCaption, buildFinalBandsPayload, normalizeReviewDetail } from '../lib/admin-mock-reviews-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSX = readFileSync(join(__dirname, '..', 'app', '(authed-admin)', '(mock-reviews)', 'admin', 'mock-reviews', 'admin-mock-reviews.tsx'), 'utf8');

const REQUIRED = ['listening', 'reading', 'writing'];

function save({ bands, blankable }) {
  const detail = normalizeReviewDetail({
    required_skills: REQUIRED,
    blankable_skills: blankable,
    review: { id: 'rv-1', sitting_id: 'st-1', status: 'claimed', ai_draft: {}, final_bands: {}, retest_flags: {} },
    sitting: { id: 'st-1' },
  });
  assert.ok(detail, 'the fixture must be a canonical review');
  return buildFinalBandsPayload(detail, bands, {}, '');
}

describe('review console — a band with no published score may be left blank', () => {
  test('a blankable skill saves, and is OMITTED rather than sent as null', () => {
    const r = save({ bands: { reading: '6.5', writing: '6.0' }, blankable: ['listening'] });
    assert.equal(r.ok, true, 'the save must reach the server');
    assert.deepEqual(r.value.final_bands, { reading: 6.5, writing: 6 });
    assert.ok(!('listening' in r.value.final_bands), 'a blank must be omitted, not sent as NaN/null');
  });
  test('a forgotten Writing band is still refused', () => {
    const r = save({ bands: { listening: '7.0', reading: '6.5' }, blankable: ['listening'] });
    assert.equal(r.ok, false);
    assert.match(r.error, /writing/);
  });
  test('a blank Listening that DOES convert is still refused', () => {
    // 30/40 has a band — leaving it empty is forgetfulness, not a missing row.
    const r = save({ bands: { reading: '6.5', writing: '6.0' }, blankable: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /listening/);
  });
  test('a complete set saves unchanged', () => {
    const r = save({ bands: { listening: '7.0', reading: '6.5', writing: '6.0' }, blankable: [] });
    assert.deepEqual(r.value.final_bands, { listening: 7, reading: 6.5, writing: 6 });
  });
  test('the console reads blankable_skills from the review payload', () => {
    assert.equal(normalizeReviewDetail({
      required_skills: REQUIRED, blankable_skills: ['reading'],
      review: { id: 'rv-1', sitting_id: 'st-1', status: 'claimed' }, sitting: { id: 'st-1' },
    }).blankableSkills[0], 'reading');
  });
  test('the input says WHY it may be left empty', () => {
    // Without a reason the blank reads as an oversight, and the examiner invents a band.
    const detail = normalizeReviewDetail({
      required_skills: REQUIRED, blankable_skills: ['listening'],
      review: { id: 'rv-1', sitting_id: 'st-1', status: 'claimed', ai_draft: {}, final_bands: {}, retest_flags: {} },
      sitting: { id: 'st-1' },
    });
    assert.equal(bandCaption(detail, 'listening'), 'Điểm thô không có band trong bảng IELTS — có thể để trống (overall sẽ để trống theo).');
    assert.match(TSX, /<small>\{bandCaption\(detail, skill\)\}<\/small>/);
  });
});
