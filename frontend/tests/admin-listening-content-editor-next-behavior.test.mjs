import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildListeningContentPatch, listeningContentDetailHref, listeningContentDraft,
  listeningContentEditorHref, listeningContentEditorRollbackHref,
  listeningContentPatchMatches, normalizeListeningContentEditor,
  normalizePendingListeningContentEdit, parseListeningTopicTags,
  validateListeningContentDraft,
} from '../lib/admin-listening-content-editor-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'content', '[contentId]', 'edit', 'admin-listening-content-editor.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'content', '[contentId]', 'edit', 'page.tsx');
const DETAIL = read('app', '(authed-admin-listening)', 'admin', 'listening', 'content', '[contentId]', 'admin-listening-content-detail.tsx');
const LIST = read('app', '(authed-admin-listening)', 'admin', 'listening', 'admin-listening-content.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-listening-content-editor-next.css');
const BACKEND = readFileSync(join(here, '..', '..', 'backend', 'routers', 'listening.py'), 'utf8');

const raw = (patch = {}) => ({
  id: 'content-1', title: 'Cambridge 19', transcript: '  Keep transcript spacing.\n',
  accent_tag: 'uk_rp', cefr_level: null, ielts_section: null, topic_tags: ['Travel', 'travel', ' Work '],
  is_premium: false, external_license: null, external_source_url: null,
  status: 'draft', source_type: 'upload_mp3', audio_storage_path: 'content/audio.mp3',
  updated_at: '2026-08-14T01:02:03+00:00', ...patch,
});

describe('Admin Listening content editor model', () => {
  test('normalizes exact identity without inventing nullable classification', () => {
    const value = normalizeListeningContentEditor(raw(), 'content-1');
    assert.equal(value.transcript, '  Keep transcript spacing.\n');
    assert.equal(value.cefr, null);
    assert.equal(value.ieltsSection, null);
    assert.deepEqual(value.topicTags, ['Travel', 'Work']);
    assert.equal(normalizeListeningContentEditor(raw(), 'other'), null);
    assert.equal(normalizeListeningContentEditor(raw({ updated_at: null }), 'content-1'), null);
    assert.equal(normalizeListeningContentEditor(raw({ updated_at: 'not-a-date' }), 'content-1'), null);
  });

  test('validates attribution, URL scheme and NC paid-tier rule', () => {
    const baseline = normalizeListeningContentEditor(raw(), 'content-1');
    const draft = listeningContentDraft(baseline);
    assert.equal(validateListeningContentDraft({ ...draft, externalLicense: 'CC BY 4.0' }).ok, false);
    assert.equal(validateListeningContentDraft({ ...draft, externalSourceUrl: 'javascript:alert(1)' }).ok, false);
    assert.equal(validateListeningContentDraft({ ...draft, isPremium: true, externalLicense: 'cc by-nc 4.0', externalSourceUrl: 'https://example.com' }).ok, false);
    assert.equal(validateListeningContentDraft({ ...draft, isPremium: true, externalLicense: 'Ancillary commercial license', externalSourceUrl: 'https://example.com' }).ok, true);
    assert.equal(validateListeningContentDraft({ ...draft, cefr: null, ieltsSection: null }).ok, true);
  });

  test('builds only canonical deltas and carries the version token', () => {
    const baseline = normalizeListeningContentEditor(raw({ cefr_level: 'B2', ielts_section: 2, external_license: 'CC BY 4.0', external_source_url: 'https://old.example' }), 'content-1');
    const draft = { ...listeningContentDraft(baseline), title: '  Updated title ', cefr: null, ieltsSection: null, externalLicense: '', externalSourceUrl: '', topicTags: parseListeningTopicTags('Travel, travel, Work') };
    const result = buildListeningContentPatch(baseline, draft);
    assert.equal(result.ok, true);
    assert.deepEqual(result.patch, {
      title: 'Updated title', cefr_level: null, ielts_section: null,
      external_license: null, external_source_url: null,
      expected_updated_at: '2026-08-14T01:02:03+00:00',
    });
    assert.equal(Object.hasOwn(result.patch, 'transcript'), false);
  });

  test('reconciles exact patch fields and rejects foreign pending receipts', () => {
    const snapshot = normalizeListeningContentEditor(raw({ title: 'Updated' }), 'content-1');
    const patch = { title: 'Updated', expected_updated_at: 'old-version' };
    assert.equal(listeningContentPatchMatches(snapshot, patch), true);
    assert.equal(listeningContentPatchMatches(snapshot, { ...patch, title: 'Other' }), false);
    const pending = { account: 'admin-1', contentId: 'content-1', startedAt: '2026-08-14T00:00:00Z', patch };
    assert.deepEqual(normalizePendingListeningContentEdit(pending, 'admin-1', 'content-1'), pending);
    assert.equal(normalizePendingListeningContentEdit(pending, 'admin-2', 'content-1'), null);
  });

  test('uses the same lower-case tag fold as the backend', () => {
    assert.deepEqual(parseListeningTopicTags('Straße, STRASSE, Straße'), ['Straße', 'STRASSE']);
    assert.match(BACKEND, /folded = tag\.lower\(\)/);
    assert.doesNotMatch(BACKEND, /folded = tag\.casefold\(\)/);
  });

  test('owns stable native, detail and rollback links', () => {
    assert.equal(listeningContentEditorHref('a/b'), '/admin/listening/content/a%2Fb/edit');
    assert.equal(listeningContentDetailHref('a/b'), '/admin/listening/content/a%2Fb');
    assert.equal(listeningContentEditorRollbackHref('a/b'), '/pages/admin/listening/content-meta.html?id=a%2Fb');
  });
});

describe('native route behavior and design contract', () => {
  test('route is admin-gated and inventory/detail enter native editor', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /params: Promise<\{ contentId: string \}>/);
    assert.match(PAGE, /active="listening" subsection="content"/);
    assert.match(DETAIL, /\/admin\/listening\/content\/\$\{encodeURIComponent\(current\.id\)\}\/edit/);
    assert.match(LIST, /\/admin\/listening\/content\/\$\{encodeURIComponent\(row\.id\)\}\/edit/);
  });

  test('mutation is delta-only, versioned and concluded by canonical GET', () => {
    assert.match(CLIENT, /buildListeningContentPatch\(baseline, editorDraft\)/);
    assert.match(CLIENT, /window\.api\.patch\(`\/admin\/listening\/content\/\$\{encodeURIComponent\(contentId\)\}`/);
    assert.match(CLIENT, /const snapshot = await readCanonical\(\)/);
    assert.match(CLIENT, /listeningContentPatchMatches\(snapshot, operation\.patch\)/);
    assert.match(CLIENT, /let patchAcknowledged = false/);
    assert.match(CLIENT, /patchAcknowledged = true/);
    assert.match(CLIENT, /!patchAcknowledged && definitive\(status\)/);
    assert.match(CLIENT, /PATCH đã nhận, chưa đọc lại được/);
    assert.match(CLIENT, /Kết quả PATCH chưa rõ/);
    assert.match(CLIENT, /không tự phát lại PATCH/);
    assert.match(BACKEND, /expected_updated_at/);
    assert.match(BACKEND, /mutation = mutation\.eq\("updated_at", expected_updated_at\)/);
  });

  test('guards storage, account scope, unsaved navigation and destructive reset', () => {
    assert.match(CLIENT, /try \{ sessionStorage\.setItem/);
    assert.match(CLIENT, /sessionStorage\.getItem\(key\) === value/);
    assert.match(CLIENT, /if \(!writeReceipt/);
    assert.match(CLIENT, /Không thể tạo biên nhận an toàn/);
    assert.doesNotMatch(CLIENT, /memoryReceipts/);
    assert.match(CLIENT, /account\.current !== operation\.account/);
    assert.match(CLIENT, /beforeunload/);
    assert.match(CLIENT, /<Dialog open=\{confirm !== null\}/);
    assert.doesNotMatch(CLIENT, /alert\(/);
  });

  test('uses responsive token-only route CSS with focus and reduced motion', () => {
    assert.match(LAYOUT, /admin-listening-content-editor-next\.css/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(max-width:760px\)/);
    assert.match(CSS, /min-height:44px/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
  });
});
