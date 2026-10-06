import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningSourceAudio } from '@/components/listening-source-audio';

const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'learner-a' } as { id: string } | null }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));
function payload(day = 1, original = true) {
  const variant = (id: string, label: string) => ({ variant_id: id, label_vi: label, synthetic: id !== 'original', url: `https://private.example/${day}-${id}.mp3`, duration_seconds: 100, note_vi: `${label} — ghi chú nguồn` });
  return { day, variants: [...(original ? [variant('original', 'Bản ghi gốc')] : []), variant('kokoro-v1', 'Bản luyện nghe')] };
}
beforeEach(() => {
  auth.status = 'signed-in'; auth.user = { id: 'learner-a' };
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  Object.assign(window, { api: { getWith: vi.fn(async () => payload()), postWith: vi.fn() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('defaults to the new recording, switches to the original without creating attempts and clears old media', async () => {
  const view = render(<ListeningSourceAudio day={1} />);
  const select = await screen.findByRole('combobox', { name: 'Phiên bản audio' });
  const old = view.container.querySelector('audio')!;
  expect(old.getAttribute('src')).toContain('1-kokoro-v1');
  expect(screen.queryByText(/Kokoro/)).toBeNull();
  fireEvent.change(select, { target: { value: 'original' } });
  expect(view.container.querySelector('audio')?.getAttribute('src')).toContain('1-original');
  expect(old.getAttribute('src')).toBeNull();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  expect(window.api.postWith).not.toHaveBeenCalled();
});

it('shows truthful unavailable audio and allows retry', async () => {
  const data = payload(77, false); data.variants[0].url = null as unknown as string;
  window.api.getWith = vi.fn(async () => data);
  const view = render(<ListeningSourceAudio day={77} />);
  await screen.findByText('Bản audio này chưa sẵn sàng để phát.');
  expect(view.container.querySelector('audio')).toBeNull();
  expect(screen.queryByRole('option', { name: 'Bản ghi gốc' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại audio' }));
  await waitFor(() => expect(window.api.getWith).toHaveBeenCalledTimes(2));
});

it.each(['day', 'account', 'status'] as const)('removes signed media immediately on %s scope change and ignores late old responses', async (boundary) => {
  const view = render(<ListeningSourceAudio day={1} />);
  await screen.findByRole('combobox');
  const old = view.container.querySelector('audio')!;
  let resolve!: (value: unknown) => void;
  window.api.getWith = vi.fn(() => new Promise((yes) => { resolve = yes; }));
  if (boundary === 'account') auth.user = { id: 'learner-b' };
  if (boundary === 'status') auth.status = 'loading';
  view.rerender(<ListeningSourceAudio day={boundary === 'day' ? 2 : 1} />);
  expect(view.container.querySelector('audio')).toBeNull();
  expect(old.getAttribute('src')).toBeNull();
  if (boundary !== 'status') {
    await waitFor(() => expect(window.api.getWith).toHaveBeenCalledTimes(1));
    await act(async () => resolve(payload(2)));
    expect(view.container.querySelector('audio')?.getAttribute('src')).toContain('2-kokoro-v1');
  }
});

it('reports playback errors and reloads URLs instead of hiding the failure', async () => {
  const view = render(<ListeningSourceAudio day={1} />);
  await screen.findByRole('combobox');
  fireEvent.error(view.container.querySelector('audio')!);
  expect(screen.getByRole('alert').textContent).toContain('Chưa phát được audio');
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại audio' }));
  await waitFor(() => expect(window.api.getWith).toHaveBeenCalledTimes(2));
});
