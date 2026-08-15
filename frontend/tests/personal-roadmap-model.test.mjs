import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePersonalRoadmap } from '../lib/personal-roadmap-model.mjs';

describe('personal roadmap canonical payload', () => {
  test('giữ thứ tự prerequisite, status và weak count từ backend', () => {
    const data = normalizePersonalRoadmap({
      mode: 'personal', weak_count: 1, nodes: [
        { slug: 'sentence-elements', title: 'Sentence Elements', category: 'sentence-structures', status: 'unseen', is_weak: false },
        { slug: 'relative-clauses', title: 'Relative Clauses', category: 'clauses', status: 'weak', is_weak: true },
      ],
    });
    assert.equal(data.weakCount, 1);
    assert.deepEqual(data.nodes.map((node) => node.slug), ['sentence-elements', 'relative-clauses']);
    assert.deepEqual(data.nodes.map((node) => node.isWeak), [false, true]);
  });

  test('static là trạng thái rỗng thật do backend xác nhận', () => {
    assert.deepEqual(normalizePersonalRoadmap({ mode: 'static', nodes: [] }), {
      mode: 'static', weakCount: 0, nodes: [],
    });
  });

  test('payload hỏng không được biến thành trạng thái rỗng', () => {
    for (const payload of [null, {}, { mode: 'personal', nodes: [] }, { mode: 'static' }, { mode: 'static', nodes: [{}] }, {
      mode: 'personal', weak_count: 1, nodes: [{ slug: 'x', title: 'X', status: 'mystery', is_weak: true }],
    }, {
      mode: 'personal', weak_count: 1, nodes: [],
    }, {
      mode: 'personal', weak_count: null,
      nodes: [{ slug: 'x', title: 'X', status: 'weak', is_weak: true }],
    }, {
      mode: 'personal', weak_count: 2,
      nodes: [{ slug: 'x', title: 'X', status: 'weak', is_weak: true }],
    }, {
      mode: 'personal', weak_count: 1,
      nodes: [{ slug: 'x', title: 'X', status: 'unseen', is_weak: false }],
    }]) assert.throws(() => normalizePersonalRoadmap(payload), /invalid-personal-roadmap/);
  });

  test('node thiếu category vẫn hiển thị được nhưng không bịa link bài viết', () => {
    const data = normalizePersonalRoadmap({
      mode: 'personal', weak_count: 1,
      nodes: [{ slug: 'orphan', title: 'Orphan', category: null, status: 'weak', is_weak: true }],
    });
    assert.equal(data.nodes[0].category, null);
  });
});
