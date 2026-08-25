import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePublicRoadmap } from '../lib/public-roadmap-model.mjs';

describe('public roadmap canonical payload', () => {
  test('giữ title, thứ tự bài và metadata hợp lệ từ backend', () => {
    const data = normalizePublicRoadmap({
      title: 'Thì tiếng Anh',
      articles: [
        { slug: 'present-simple', title: 'Present Simple', category: 'tenses', level: 'beginner', reading_time: 4 },
        { slug: 'present-perfect', title: 'Present Perfect', category: 'tenses', status: 'updating', summary: 'Đang hoàn thiện' },
      ],
    });
    assert.equal(data.title, 'Thì tiếng Anh');
    assert.deepEqual(data.articles.map((article) => article.slug), ['present-simple', 'present-perfect']);
    assert.equal(data.articles[0].reading_time, 4);
    assert.equal(data.articles[1].status, 'updating');
  });

  test('mảng bài rỗng hợp lệ vẫn là trạng thái rỗng thật', () => {
    assert.deepEqual(normalizePublicRoadmap({ title: 'Chủ đề mới', articles: [] }), {
      title: 'Chủ đề mới', articles: [],
    });
  });

  test('payload hoặc article hỏng không được biến thành roadmap rỗng', () => {
    for (const payload of [
      null,
      {},
      { title: 'Tenses' },
      { title: '', articles: [] },
      { title: 'Tenses', articles: [{}] },
      { title: 'Tenses', articles: [{ slug: 'present-simple', title: 'Present Simple' }] },
    ]) assert.throws(() => normalizePublicRoadmap(payload), /invalid-public-roadmap/);
  });
});
