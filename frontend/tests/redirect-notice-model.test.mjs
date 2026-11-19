import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTICE_KEYS, PARENT_LABELS, redirectNoticeHref, redirectNoticeMessage, takeRedirectNotice,
} from '../lib/redirect-notice-model.mjs';

// G02-T11 (FR-02-010): one plain sentence, page name from our own table.
describe('redirectNoticeMessage', () => {
  test('names the parent page from the table', () => {
    assert.equal(redirectNoticeMessage('lien-ket-thieu', '/speaking'),
      'Liên kết bạn vừa mở chưa đủ thông tin nên bạn được đưa về trang Speaking.');
    assert.equal(redirectNoticeMessage('khong-tim-thay', '/grammar/'),
      'Không tìm thấy nội dung bạn muốn mở nên bạn được đưa về Grammar Wiki.');
  });
  test('an unknown key shows nothing; an unknown page gets a neutral name', () => {
    assert.equal(redirectNoticeMessage('<script>', '/speaking'), null);
    assert.equal(redirectNoticeMessage('__proto__', '/speaking'), null);
    assert.equal(redirectNoticeMessage(null, '/speaking'), null);
    assert.equal(redirectNoticeMessage('lien-ket-thieu', '/somewhere'),
      'Liên kết bạn vừa mở chưa đủ thông tin nên bạn được đưa về trang này.');
  });
  test('no sentence names a parameter, an error code or English', () => {
    for (const key of Object.values(NOTICE_KEYS)) {
      for (const path of Object.keys(PARENT_LABELS)) {
        assert.doesNotMatch(redirectNoticeMessage(key, path), /_id|slug|session|Unable|lỗi/i);
      }
    }
  });
});

describe('redirectNoticeHref / takeRedirectNotice', () => {
  test('adds the key and keeps the parent query and hash', () => {
    assert.equal(redirectNoticeHref('/speaking'), '/speaking?notice=lien-ket-thieu');
    assert.equal(redirectNoticeHref('/admin/mock-tests?tab=review', 'khong-tim-thay'),
      '/admin/mock-tests?tab=review&notice=khong-tim-thay');
    assert.equal(redirectNoticeHref('/grammar#top'), '/grammar?notice=lien-ket-thieu#top');
  });
  test('refuses a non-path parent or an unknown key', () => {
    assert.throws(() => redirectNoticeHref('https://evil.example'));
    assert.throws(() => redirectNoticeHref('//evil.example'));
    // Browsers read `\` as `/`, so `/\evil.example` is another origin.
    assert.throws(() => redirectNoticeHref('/\\evil.example'));
    assert.throws(() => redirectNoticeHref('/speaking', 'other'));
  });
  test('round trip: the parent reads the key and drops only the notice', () => {
    const href = redirectNoticeHref('/admin/mock-tests?tab=review');
    const search = href.slice(href.indexOf('?'));
    assert.deepEqual(takeRedirectNotice(search), { key: 'lien-ket-thieu', search: '?tab=review' });
    assert.deepEqual(takeRedirectNotice('?notice=lien-ket-thieu'), { key: 'lien-ket-thieu', search: '' });
    assert.deepEqual(takeRedirectNotice('?tab=x'), { key: null, search: '?tab=x' });
    assert.deepEqual(takeRedirectNotice(''), { key: null, search: '' });
  });
});
