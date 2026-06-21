/**
 * F2 PR-2 (FE) — compare + mix. Pure assemble-logic (real merge + overall
 * recompute) + static wiring sentinels (no jsdom; zero-dep node:test).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleComposed, overallFromPicks, roundHalf, MIX_CRITERIA }
  from '../js/instructor-compose-util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');


// ── helpers ───────────────────────────────────────────────────────────

function crit(key, v, band) {
  return { title: `T-${key}`, explanation: `exp-${key}-v${v}`, feedback: `${key}-v${v}`, bandScore: band };
}
function fj(v, bands) {
  const [tr, cc, lr, gra] = bands;
  return {
    overallBandScore: 6.0, overallBandScoreSummary: `summary-v${v}`,
    keyTakeaways: { strengths: [`s-v${v}`], areasForImprovement: ['a'] },
    criteriaFeedback: {
      mainCriterion: crit('mainCriterion', v, tr),
      coherenceCohesion: crit('coherenceCohesion', v, cc),
      lexicalResource: crit('lexicalResource', v, lr),
      grammaticalRange: crit('grammaticalRange', v, gra),
    },
    mistakeAnalysis: [], improvedEssay: `improved-v${v}`,
  };
}
const VERSIONS = { 1: fj(1, [6, 6, 6, 6]), 2: fj(2, [7, 7, 7, 7]) };


// ── pure assemble-logic ───────────────────────────────────────────────

describe('assembleComposed — per-criterion mix', () => {
  test('each criterion takes the WHOLE sub-object from ONE picked version', () => {
    const out = assembleComposed(VERSIONS, 2, {
      mainCriterion: 2, coherenceCohesion: 2, lexicalResource: 2, grammaticalRange: 1,
    });
    const gra = out.criteriaFeedback.grammaticalRange;
    assert.equal(gra.bandScore, 6);          // band from v1
    assert.equal(gra.feedback, 'grammaticalRange-v1');   // …and feedback from the SAME version
    assert.equal(gra.explanation, 'exp-grammaticalRange-v1');
    const tr = out.criteriaFeedback.mainCriterion;
    assert.equal(tr.bandScore, 7);
    assert.equal(tr.feedback, 'mainCriterion-v2');
  });

  test('overall is recomputed (IELTS round of mean of 4 picks), not any source overall', () => {
    const out = assembleComposed(VERSIONS, 2, {
      mainCriterion: 2, coherenceCohesion: 2, lexicalResource: 2, grammaticalRange: 1,
    });
    // mean(7,7,7,6) = 6.75 → round-half-up → 7.0 (≠ v1's 6.0 or any stored overall)
    assert.equal(out.overallBandScore, 7.0);
  });

  test('non-criteria content is base-derived (from base_version)', () => {
    const out = assembleComposed(VERSIONS, 1, {
      mainCriterion: 2, coherenceCohesion: 2, lexicalResource: 2, grammaticalRange: 2,
    });
    assert.equal(out.improvedEssay, 'improved-v1');           // base = v1
    assert.equal(out.overallBandScoreSummary, 'summary-v1');
    assert.equal(out.overallBandScore, 7.0);                  // mean(7,7,7,7)=7.0
  });

  test('does not mutate the source version objects', () => {
    const snapshot = JSON.stringify(VERSIONS);
    assembleComposed(VERSIONS, 1, {
      mainCriterion: 2, coherenceCohesion: 1, lexicalResource: 2, grammaticalRange: 1,
    });
    assert.equal(JSON.stringify(VERSIONS), snapshot);
  });

  test('throws on a pick outside the supplied versions', () => {
    assert.throws(() => assembleComposed(VERSIONS, 2, {
      mainCriterion: 9, coherenceCohesion: 2, lexicalResource: 2, grammaticalRange: 1,
    }));
  });
});

describe('overall rounding (IELTS round-half-up)', () => {
  test('roundHalf / overallFromPicks', () => {
    assert.equal(roundHalf(6.75), 7.0);
    assert.equal(roundHalf(6.25), 6.5);
    assert.equal(overallFromPicks([6, 6, 6, 7]), 6.5);   // mean 6.25 → 6.5
    assert.equal(overallFromPicks([7, 7, 7, 6]), 7.0);   // mean 6.75 → 7.0
  });
  test('the 4 criteria keys are the canonical set', () => {
    assert.deepEqual(MIX_CRITERIA,
      ['mainCriterion', 'coherenceCohesion', 'lexicalResource', 'grammaticalRange']);
  });
});


// ── static wiring sentinels ───────────────────────────────────────────

describe('instructor-compose.js — wiring', () => {
  const CTRL = front('js', 'instructor-compose.js');

  test('all backend calls go through window.api + IMP (no raw fetch to backend)', () => {
    assert.match(CTRL, /_api\s*=\s*window\.api/);
    assert.match(CTRL, /function IMP\(/);
    assert.match(CTRL, /api\.get\(\s*['"]\/instructor\/essays\//);
    assert.match(CTRL, /api\.post\(\s*['"]\/instructor\/essays\//);
    // No raw fetch() to the API at all — that path caused the CORS/404 incident.
    assert.doesNotMatch(CTRL, /\bfetch\s*\(/);
  });

  test('reuses window.WritingRenderers (does NOT rebuild the renderer)', () => {
    assert.match(CTRL, /window\.WritingRenderers/);
    assert.match(CTRL, /SECTION_RENDERERS/);
    assert.match(CTRL, /SECTION_KEYS/);
    // imports the shared pure assemble util (no inline re-implementation)
    assert.match(CTRL, /from '\.\/instructor-compose-util\.js'/);
  });

  test('budget pre-disable: Commit disabled when can_compose is false', () => {
    assert.match(CTRL, /can_compose/);
    assert.match(CTRL, /cm-commit['"]\)\.disabled\s*=\s*true/);
  });

  test('preview overall uses the 4 picks (overallFromPicks), not a source overall', () => {
    assert.match(CTRL, /overallFromPicks\(pickedBands\)/);
  });
});

describe('compare.html + grade.html entry', () => {
  const PAGE = front('pages', 'instructor', 'compare.html');
  const GRADE_JS = front('js', 'instructor-grade.js');

  test('compare.html loads the shared renderers + the compose module', () => {
    assert.match(PAGE, /writing-renderers\.js/);
    assert.match(PAGE, /writing-renderers\.css/);
    assert.match(PAGE, /instructor-compose\.js/);
    assert.match(PAGE, /\/js\/api\.js/);
  });

  test('grade.html entry shows only when ≥2 live versions', () => {
    assert.match(GRADE_JS, /live_count\)\s*\|\|\s*0/);
    assert.match(GRADE_JS, /liveCount\s*>=\s*2/);
    assert.match(GRADE_JS, /compare\.html\?essay_id=/);
  });
});
