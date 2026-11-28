// LEARNERCORE-0063 FR-062: /help search is case- and accent-insensitive over
// question and answer; the six groups are fixed.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { HELP_GROUPS } from '../lib/help-faq.mjs';
import { filterHelp, foldVietnamese } from '../lib/help-search-model.mjs';

describe('help search model', () => {
  test('folds case, accents and đ', () => {
    assert.equal(foldVietnamese('  Học   PHÍ  '), 'hoc phi');
    assert.equal(foldVietnamese('Đăng ký'), 'dang ky');
    assert.equal(foldVietnamese(null), '');
  });

  test('"hoc phi" finds "Học phí" in an answer', () => {
    const { groups, hits, searching } = filterHelp(HELP_GROUPS, 'hoc phi');
    assert.equal(searching, true);
    assert.ok(hits >= 1);
    assert.ok(groups.some((g) => g.items.some((it) => it.a.includes('học phí'))));
  });

  test('matches the question too, and drops groups with no match', () => {
    const { groups } = filterHelp(HELP_GROUPS, 'MICRO');
    assert.deepEqual(groups.map((g) => g.id), ['ky-thuat']);
  });

  test('no match → zero hits; empty query → every group whole', () => {
    assert.deepEqual(filterHelp(HELP_GROUPS, 'zzqx').hits, 0);
    const all = filterHelp(HELP_GROUPS, '   ');
    assert.equal(all.searching, false);
    assert.equal(all.groups.length, HELP_GROUPS.length);
  });

  test('six fixed groups, unique ids, no placeholder copy, internal links only', () => {
    assert.equal(HELP_GROUPS.length, 6);
    const ids = HELP_GROUPS.flatMap((g) => g.items.map((it) => it.id));
    assert.equal(new Set(ids).size, ids.length);
    for (const item of HELP_GROUPS.flatMap((g) => g.items)) {
      assert.doesNotMatch(`${item.q} ${item.a}`, /XXX|\.dc\.html/, item.id);
      if (item.href) assert.match(item.href, /^\/[a-z]/, item.id);
      assert.equal(Boolean(item.href), Boolean(item.link), `${item.id}: link label and href go together`);
    }
  });
});
