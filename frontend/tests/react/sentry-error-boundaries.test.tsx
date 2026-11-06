import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RouteError from '@/app/error';
import GlobalError from '@/app/global-error';
import { initSentryClient, scrubSentryEvent } from '@/lib/sentry-client.mjs';

const DSN = 'https://publickey@o42.ingest.us.sentry.io/7';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
  await initSentryClient({}, vi.fn());
});

describe.each([
  { boundary: 'route', Component: RouteError, retry: 'Thử lại' },
  { boundary: 'global', Component: GlobalError, retry: 'Tải lại ứng dụng' },
])('$boundary error boundary', ({ boundary, Component, retry }) => {
  function mount(error: Error & { digest?: string }, reset = vi.fn()) {
    // The global boundary replaces the entire document, including html/body.
    const frame = boundary === 'global' ? document.body.appendChild(document.createElement('iframe')) : null;
    const container = frame?.contentDocument ?? document.body.appendChild(document.createElement('div'));
    return render(<Component error={error} reset={reset} />, { container });
  }

  it('captures once with the boundary tag and digest, and preserves recovery controls', async () => {
    const captureException = vi.fn();
    await initSentryClient({ dsn: DSN }, async () => ({ init: vi.fn(), captureException }));
    const error = Object.assign(new Error('render failed'), { digest: 'digest-a' });
    const reset = vi.fn();
    const view = mount(error, reset);

    await waitFor(() => expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      tags: { boundary }, extra: { digest: 'digest-a' },
    }));
    expect(view.getByText('digest-a').tagName).toBe('CODE');
    expect(view.getByRole('link', { name: 'Về trang chủ' }).getAttribute('href')).toBe('/');
    fireEvent.click(view.getByRole('button', { name: retry }));
    expect(reset).toHaveBeenCalledTimes(1);

    await act(async () => view.rerender(<Component error={error} reset={reset} />));
    expect(captureException).toHaveBeenCalledTimes(1);

    const nextError = new Error('a different render failed');
    view.rerender(<Component error={nextError} reset={reset} />);
    await waitFor(() => expect(captureException).toHaveBeenCalledTimes(2));
    expect(captureException).toHaveBeenLastCalledWith(nextError, {
      tags: { boundary }, extra: { digest: undefined },
    });
  });

  it.each([undefined, '', '   '])('does not load or capture when the DSN is %j', async (dsn) => {
    const captureException = vi.fn();
    const loadSdk = vi.fn(async () => ({ init: vi.fn(), captureException }));
    expect(await initSentryClient({ dsn }, loadSdk)).toBe(false);
    await act(async () => { mount(new Error('render failed')); });
    expect(loadSdk).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('waits for the existing lazy SDK initialisation before capturing an early failure', async () => {
    const captureException = vi.fn();
    const sdk = { init: vi.fn(), captureException };
    let finishLoad!: (value: typeof sdk) => void;
    const ready = initSentryClient({ dsn: DSN }, () => new Promise((resolve) => { finishLoad = resolve; }));
    const error = new Error('early render failed');
    await act(async () => { mount(error); });
    expect(captureException).not.toHaveBeenCalled();

    await act(async () => { finishLoad(sdk); await ready; });
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      tags: { boundary }, extra: { digest: undefined },
    });
  });

  it('keeps recovery usable when the SDK chunk fails to load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ready = initSentryClient({ dsn: DSN }, () => Promise.reject(new TypeError('chunk')));
    const reset = vi.fn();
    const view = mount(new Error('render failed'), reset);
    await act(async () => { expect(await ready).toBe(false); });
    fireEvent.click(view.getByRole('button', { name: retry }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('sends boundary exceptions through the existing SDK beforeSend scrubber', async () => {
    const Sentry = await import('@/lib/sentry-sdk.mjs');
    const events: any[] = [];
    let client: ReturnType<typeof Sentry.init>;
    try {
      await initSentryClient({ dsn: DSN }, async () => ({
        ...Sentry,
        init(options: Parameters<typeof Sentry.init>[0]) {
          expect(options!.beforeSend).toBe(scrubSentryEvent);
          client = Sentry.init({
            ...options,
            // In-memory transport: exercise real event preparation and beforeSend
            // without global browser instrumentation or any network request.
            integrations: [],
            transport: () => ({
              send(envelope) {
                for (const [header, payload] of envelope[1]) {
                  if (header.type === 'event') events.push(payload);
                }
                return Promise.resolve({});
              },
              flush: async () => true,
            }),
          });
          return client;
        },
      }));
      const error = Object.assign(new Error('contact learner@example.com or +84 90 123 4567'), { digest: 'digest-a' });
      mount(error);
      await waitFor(() => expect(events).toHaveLength(1));
      expect(events[0].exception.values[0].value).toBe('contact [email] or [redacted]');
      expect(events[0].tags.boundary).toBe(boundary);
      expect(events[0].extra.digest).toBe('digest-a');
      expect(JSON.stringify(events[0])).not.toContain('learner@example.com');
      expect(JSON.stringify(events[0])).not.toContain('+84 90 123 4567');
    } finally {
      await client?.close();
    }
  });
});
