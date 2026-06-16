/**
 * hide-subbands-toggle.test.mjs — hide-subbands T3·2 (FE).
 *
 * Admin grade.html: a "Ẩn điểm thành phần" checkbox at deliver time sends
 * hide_subbands in the mark-delivered body (BE T3·1 persists it). Student
 * writing-result.html: when essay.hide_subbands, the 4 criterion sub-band
 * cards are skipped + the section collapsed, while the OVERALL band (sticky
 * header) is untouched. Default false → render everything (legacy).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const G = read('pages', 'admin', 'writing', 'grade.html');     // admin
const R = read('pages', 'writing-result.html');                 // student
const C = read('css', 'admin-writing-grade.css');


describe('hide-subbands — admin toggle at deliver', () => {
  test('checkbox exists next to the deliver action', () => {
    assert.match(G, /id="hide-subbands-toggle"[^>]*type="checkbox"|type="checkbox"[^>]*id="hide-subbands-toggle"/);
    assert.match(G, /Ẩn điểm thành phần/);
  });
  test('handleDeliver reads the checkbox and sends hide_subbands in the body', () => {
    assert.match(G, /getElementById\('hide-subbands-toggle'\)/);
    assert.match(G, /var hideSubbands = !!\(hideToggle && hideToggle\.checked\)/);
    assert.match(
      G,
      /\/mark-delivered'[\s\S]{0,80}?\{ method: 'google_docs_paste', hide_subbands: hideSubbands \}/
    );
  });
  test('toggle styled minimally in admin-writing-grade.css', () => {
    assert.match(C, /\.hide-subbands-toggle/);
  });
});


describe('hide-subbands — student conditional render', () => {
  test('reads essay.hide_subbands', () => {
    assert.match(R, /var hideSubbands = !!essay\.hide_subbands/);
  });
  test('skips rendering the 4-criterion cards when hidden', () => {
    assert.match(R, /if \(sectionKey === 'criteria' && hideSubbands\) return;/);
  });
  test('collapses the sub-band section via maybeHideSubbands', () => {
    assert.match(R, /maybeHideSubbands\(hideSubbands\)/);
    assert.match(R, /function maybeHideSubbands\(hide\)[\s\S]*?getElementById\('section-criteria'\)/);
    assert.match(R, /section\.style\.display = hide \? 'none' : ''/);
  });
  test('default false → renders everything (legacy, zero regression)', () => {
    // hideSubbands is a plain bool from the flag; when false the forEach
    // never early-returns for criteria, so the section renders as before.
    assert.match(R, /var hideSubbands = !!essay\.hide_subbands/);
  });
});


describe('hide-subbands — overall band ALWAYS shown', () => {
  test('overall band lives in the sticky header, untouched by the flag', () => {
    assert.match(R, /id="band-display"/);
    // The band-display assignment is not gated on hideSubbands.
    assert.match(R, /getElementById\('band-display'\)\.textContent = bandText/);
    assert.doesNotMatch(R, /hideSubbands[\s\S]{0,40}band-display/);
  });
});


describe('hide-subbands — band/transition logic untouched', () => {
  test('grade.html still the .aw-* island (no admin-components migration)', () => {
    assert.match(G, /admin-writing-grade\.css/);
    assert.doesNotMatch(G, /aver-design\/admin-components\.css/);
  });
});
