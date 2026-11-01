import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { NextPageViewBeacon } from '@/components/next-page-view-beacon';

type ScriptCallbacks = { onLoad?: () => void; onReady?: () => void };
const script = vi.hoisted(() => ({ callbacks: {} as ScriptCallbacks }));
vi.mock('next/script', () => ({
  default: (props: ScriptCallbacks) => {
    script.callbacks = props;
    return null;
  },
}));
vi.mock('next/navigation', () => ({ usePathname: () => window.location.pathname }));

const beaconSource = readFileSync(resolve(process.cwd(), 'public/js/analytics-beacon.js'), 'utf8');
const post = vi.fn(async (_url: string, _body: { event_data: { path: string } }) => ({}));

function navigate(pathname: string) {
  window.history.replaceState(null, '', pathname);
}

// Execute the actual beacon so assertions count emitted events, including its
// automatic first send and same-path deduplication, rather than mock invocations.
function loadBeacon() {
  window.eval(beaconSource);
}

function sentPaths() {
  return post.mock.calls.map(([, body]) => body.event_data.path);
}

beforeEach(() => {
  post.mockClear();
  script.callbacks = {};
  Reflect.deleteProperty(window, 'aver');
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { base: 'https://api.example', post },
  });
  navigate('/login');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'aver');
  Reflect.deleteProperty(window, 'api');
});

it('keeps tracking pathname changes after a mid-load remount receives only onLoad', () => {
  render(<NextPageViewBeacon />).unmount();
  navigate('/home');
  const view = render(<NextPageViewBeacon />);
  expect(post).not.toHaveBeenCalled();

  act(() => {
    loadBeacon();
    // next/script only chains onLoad when the src is already loading.
    script.callbacks.onLoad?.();
  });
  navigate('/grammar');
  view.rerender(<NextPageViewBeacon />);
  navigate('/writing');
  view.rerender(<NextPageViewBeacon />);

  expect(sentPaths()).toEqual(['/home', '/grammar', '/writing']);
});

it('tracks the current path immediately when trackPageView exists before mount', () => {
  loadBeacon();
  post.mockClear();
  navigate('/home');
  render(<NextPageViewBeacon />);

  // Neither Next callback fires: readiness must come from the existing global.
  expect(sentPaths()).toEqual(['/home']);
});

it('still tracks after onReady and does not duplicate sends when onLoad also fires', () => {
  const view = render(<NextPageViewBeacon />);
  act(() => {
    loadBeacon();
    script.callbacks.onReady?.();
  });
  act(() => { script.callbacks.onLoad?.(); });
  expect(sentPaths()).toEqual(['/login']);

  navigate('/grammar');
  view.rerender(<NextPageViewBeacon />);
  view.rerender(<NextPageViewBeacon />);
  navigate('/login');
  view.rerender(<NextPageViewBeacon />);
  expect(sentPaths()).toEqual(['/login', '/grammar', '/login']);
});
