import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { applyModalPromptImage } from '@/app/(authed-writing)/writing/dashboard/writing-behavior';

// B10 — a private Task 1 chart whose signing failed arrives as
// prompt_image_url: null + prompt_image_lookup_failed: true. The assignment
// workspace must warn and offer a GET-only retry, never show a chartless prompt.
afterEach(() => { cleanup(); delete (window as any).api; });

function setup(get: (path: string) => Promise<unknown>) {
  render(<div id="modal-workspace">
    <img id="modal-prompt-image" className="hidden" alt="chart" />
    <div id="modal-prompt-image-failed" className="hidden" role="alert">
      <span>Không tải được hình đề Task 1.</span>
      <button id="modal-prompt-image-retry" type="button">Tải lại hình</button>
    </div>
  </div>);
  const api = { get: vi.fn(get), post: vi.fn(), postWith: vi.fn() };
  (window as any).api = api;
  return { api, ms: { dead: false, assignmentId: 'a-1' } };
}
const failedEl = () => document.getElementById('modal-prompt-image-failed')!;
const imgEl = () => document.getElementById('modal-prompt-image') as HTMLImageElement;
const retry = () => screen.getByRole('button', { name: 'Tải lại hình' }) as HTMLButtonElement;

it('signing failure shows the warning; retry re-reads the assignment and swaps in the signed chart', async () => {
  const { api, ms } = setup(async () => ({ assignment: { writing_prompts: { prompt_image_url: 'https://s/sign/c.png' } } }));
  applyModalPromptImage({ prompt_image_url: null, prompt_image_lookup_failed: true }, ms, 'a-1');
  expect(failedEl().classList.contains('hidden')).toBe(false);
  expect(imgEl().classList.contains('hidden')).toBe(true);
  expect(document.getElementById('modal-workspace')!.classList.contains('has-prompt-image')).toBe(false);

  fireEvent.click(retry());
  await waitFor(() => expect(imgEl().classList.contains('hidden')).toBe(false));
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith('/api/writing/my-assignments/a-1');
  expect(api.post).not.toHaveBeenCalled();
  expect(api.postWith).not.toHaveBeenCalled();
  expect(imgEl().src).toBe('https://s/sign/c.png');
  expect(failedEl().classList.contains('hidden')).toBe(true);
  expect(document.getElementById('modal-workspace')!.classList.contains('has-prompt-image')).toBe(true);
});

it('a retry that fails again keeps the warning and re-enables the button', async () => {
  const { api, ms } = setup(async () => { throw new Error('network'); });
  applyModalPromptImage({ prompt_image_url: null, prompt_image_lookup_failed: true }, ms, 'a-1');
  fireEvent.click(retry());
  expect(retry().disabled).toBe(true);
  await waitFor(() => expect(retry().disabled).toBe(false));
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(failedEl().classList.contains('hidden')).toBe(false);

  api.get.mockImplementationOnce(async () => ({ assignment: { writing_prompts: { prompt_image_url: null, prompt_image_lookup_failed: true } } }));
  fireEvent.click(retry());
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(retry().disabled).toBe(false));
  expect(failedEl().classList.contains('hidden')).toBe(false);
  expect(imgEl().classList.contains('hidden')).toBe(true);
});

it('a retry resolving after the modal moved to another assignment does not touch it', async () => {
  let resolve!: (v: unknown) => void;
  const { ms } = setup(() => new Promise(r => { resolve = r; }));
  applyModalPromptImage({ prompt_image_url: null, prompt_image_lookup_failed: true }, ms, 'a-1');
  fireEvent.click(retry());
  ms.assignmentId = 'a-2';
  resolve({ assignment: { writing_prompts: { prompt_image_url: 'https://s/sign/old.png' } } });
  await new Promise(r => setTimeout(r, 0));
  expect(imgEl().classList.contains('hidden')).toBe(true);
  expect(imgEl().getAttribute('src')).not.toBe('https://s/sign/old.png');
});

it('a prompt without a chart, or with a signed chart, shows no warning', () => {
  const { ms } = setup(async () => ({}));
  applyModalPromptImage({ prompt_image_url: null }, ms, 'a-1');
  expect(failedEl().classList.contains('hidden')).toBe(true);
  expect(imgEl().classList.contains('hidden')).toBe(true);
  applyModalPromptImage({ prompt_image_url: 'https://s/sign/c.png', prompt_image_lookup_failed: true }, ms, 'a-1');
  expect(failedEl().classList.contains('hidden')).toBe(true);
  expect(imgEl().classList.contains('hidden')).toBe(false);
});
