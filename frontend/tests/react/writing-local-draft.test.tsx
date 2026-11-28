import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  createModalState,
  createPageState,
  keepModalLocalDraft,
  renderModal,
  saveDraft,
} from '@/app/(authed-writing)/writing/dashboard/writing-behavior';
import { registerDraftSaver, resetDraftSavers, saveAllDrafts } from '@/lib/auth/draft-savers.mjs';
import { keepLocalDraft, readLocalDraft } from '@/lib/writing-local-draft.mjs';

// R119 (ENROLL-0060 FR-052 follow-up): when another device takes the session,
// the server refuses this device's token, so the last few seconds of typing in
// the Writing editor cannot be autosaved. They are kept in this tab and given
// back when the same account opens the same assignment after signing in.

const ACCOUNT = 'u-1';
const ASSIGNMENT = 'a-1';
const BASE = '2026-11-23T10:00:00+00:00';

beforeEach(() => {
  window.sessionStorage.clear();
  resetDraftSavers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as any).api;
  delete (window as any).WritingSubmitReceipt;
});

function setup() {
  render(<div>
    <div id="modal-notice" className="wd-submit-notice hidden" role="status"></div>
    <textarea id="modal-essay-textarea" aria-label="Bài viết"></textarea>
    <span id="modal-save-pending" className="hidden"></span>
    <span id="modal-save-status" className="hidden"></span>
    <span id="modal-save-error" className="hidden" role="alert"></span>
  </div>);
  const ms = createModalState(createPageState());
  ms.accountId = ACCOUNT;
  ms.assignmentId = ASSIGNMENT;
  const api = { patchWith: vi.fn(async (_path: string, body: any) => ({ assignment_id: ASSIGNMENT, draft_text: body.draft_text, updated_at: '2026-11-23T10:01:00+00:00' })) };
  (window as any).api = api;
  return { ms, api };
}
const textarea = () => document.getElementById('modal-essay-textarea') as HTMLTextAreaElement;
const notice = () => document.getElementById('modal-notice')!;
const open = (ms: any, draft: any, readOnly = false) => renderModal(
  { assignment: { id: ASSIGNMENT, writing_prompts: { task_type: 'task2' } }, draft },
  ms, { is_timed: false }, readOnly,
);

it('displaced: the registered saver keeps the open text and counts as saved; the refused PATCH leaves it', async () => {
  const { ms, api } = setup();
  open(ms, { draft_text: 'First para.', updated_at: BASE });
  textarea().value = 'First para. Second para typed just now.';
  registerDraftSaver(() => keepModalLocalDraft(ms));

  expect(await saveAllDrafts()).toBe(1);
  expect(readLocalDraft(window.sessionStorage, ACCOUNT, ASSIGNMENT)).toMatchObject({
    text: 'First para. Second para typed just now.', base: BASE,
  });

  api.patchWith.mockRejectedValueOnce(Object.assign(new Error('Phiên đã kết thúc'), { status: 401 }));
  await saveDraft(ms);
  expect(readLocalDraft(window.sessionStorage, ACCOUNT, ASSIGNMENT)?.text).toBe('First para. Second para typed just now.');
});

it('keeps the copy when the session-displaced redirect returns no draft acknowledgment', async () => {
  const { ms, api } = setup();
  open(ms, { draft_text: 'First para.', updated_at: BASE });
  textarea().value = 'Text typed before the session ended.';
  keepModalLocalDraft(ms);
  api.patchWith.mockImplementationOnce(async () => null as any);

  await saveDraft(ms);

  expect(readLocalDraft(window.sessionStorage, ACCOUNT, ASSIGNMENT)?.text).toBe(textarea().value);
  expect(document.getElementById('modal-save-status')?.classList.contains('hidden')).toBe(true);
});

it('the saver reports nothing kept when no editor is open or it is blank, so /login claims no draft', async () => {
  const { ms } = setup();
  registerDraftSaver(() => keepModalLocalDraft(ms));
  expect(await saveAllDrafts()).toBe(0);
  open(ms, { draft_text: '', updated_at: null });
  textarea().value = '   ';
  expect(await saveAllDrafts()).toBe(0);
  expect(readLocalDraft(window.sessionStorage, ACCOUNT, ASSIGNMENT)).toBeNull();
});

it('after sign-in, the same server version restores the local text and saves it', async () => {
  vi.useFakeTimers();
  const { ms, api } = setup();
  keepLocalDraft(window.sessionStorage, { accountId: ACCOUNT, assignmentId: ASSIGNMENT, text: 'Typed before the sign-out.', base: BASE });
  open(ms, { draft_text: 'Typed before', updated_at: BASE });

  expect(textarea().value).toBe('Typed before the sign-out.');
  expect(notice().classList.contains('hidden')).toBe(false);
  expect(notice().textContent).toContain('Đã khôi phục phần bài bạn viết dở trên máy này');

  await vi.advanceTimersByTimeAsync(3000);
  expect(api.patchWith).toHaveBeenCalledTimes(1);
  expect(api.patchWith.mock.calls[0][1]).toEqual({ draft_text: 'Typed before the sign-out.' });
  expect(readLocalDraft(window.sessionStorage, ACCOUNT, ASSIGNMENT)).toBeNull();
  expect(ms.draftBase).toBe('2026-11-23T10:01:00+00:00');
});

it('a server draft saved elsewhere later is kept; the local text is only offered', () => {
  const { ms, api } = setup();
  keepLocalDraft(window.sessionStorage, { accountId: ACCOUNT, assignmentId: ASSIGNMENT, text: 'Old local text.', base: BASE });
  open(ms, { draft_text: 'Newer text from the other device.', updated_at: '2026-11-23T10:30:00+00:00' });

  expect(textarea().value).toBe('Newer text from the other device.');
  expect(notice().textContent).toContain('đã được lưu ở nơi khác');
  expect(api.patchWith).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Dùng bản viết dở trên máy này' }));
  expect(textarea().value).toBe('Old local text.');
  expect(notice().classList.contains('hidden')).toBe(true);
});

it('typing keeps a copy; a save of that exact text drops it, a keystroke during the save keeps it rebased', async () => {
  const { ms, api } = setup();
  open(ms, { draft_text: '', updated_at: BASE });
  textarea().value = 'abc';
  keepModalLocalDraft(ms);
  expect(readLocalDraft(window.sessionStorage, ACCOUNT, ASSIGNMENT)?.text).toBe('abc');

  let release!: () => void;
  api.patchWith.mockImplementationOnce((_p: string, body: any) => new Promise((resolve) => {
    release = () => resolve({ assignment_id: ASSIGNMENT, draft_text: body.draft_text, updated_at: '2026-11-23T10:02:00+00:00' });
  }));
  const saving = saveDraft(ms);
  textarea().value = 'abc def';
  keepModalLocalDraft(ms);
  release();
  await saving;
  expect(readLocalDraft(window.sessionStorage, ACCOUNT, ASSIGNMENT)).toMatchObject({
    text: 'abc def', base: '2026-11-23T10:02:00+00:00',
  });

  await saveDraft(ms);
  expect(readLocalDraft(window.sessionStorage, ACCOUNT, ASSIGNMENT)).toBeNull();
});

it('a pending submit receipt wins, and a read-only open ignores the copy without deleting it', () => {
  const { ms } = setup();
  keepLocalDraft(window.sessionStorage, { accountId: ACCOUNT, assignmentId: ASSIGNMENT, text: 'Local.', base: BASE });
  (window as any).WritingSubmitReceipt = { read: () => ({ essayText: 'Receipt text.' }) };
  open(ms, { draft_text: 'Server.', updated_at: BASE });
  expect(textarea().value).toBe('Receipt text.');
  expect(notice().classList.contains('hidden')).toBe(true);

  delete (window as any).WritingSubmitReceipt;
  open(ms, { draft_text: 'Server.', updated_at: BASE }, true);
  expect(textarea().value).toBe('Server.');
  expect(readLocalDraft(window.sessionStorage, ACCOUNT, ASSIGNMENT)?.text).toBe('Local.');
});
