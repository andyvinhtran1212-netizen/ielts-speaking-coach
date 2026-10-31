// PC-J280 — /exercises redirects inside the same document, so the runtime
// boundary remounts while /js/error-reporter.js is still loading. next/script
// then only chains onLoad for the second <Script> with that src and never
// calls onReady, so a chain that waited on onReady stalled and AuthProvider
// sent the learner to /login. These tests use the real next/script.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { RouteScriptChain, type RouteScriptSpec } from '@/components/route-script-chain';

let seq = 0;
// next/script and the chain registry both cache by src for the whole module
// lifetime, so every test uses its own sources.
function chain(...names: string[]): RouteScriptSpec[] {
  seq += 1;
  return names.map(name => ({ src: `/js/j280-${seq}-${name}.js` }));
}

function scriptElements(src: string) {
  return Array.from(document.scripts).filter(element => element.getAttribute('src') === src);
}

async function fire(src: string, type: 'load' | 'error') {
  const [element] = scriptElements(src);
  expect(element, `${src} must be injected`).toBeTruthy();
  await act(async () => {
    element.dispatchEvent(new Event(type));
    // next/script settles its load promise in a microtask.
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
});

it('finishes the chain after a remount while the first script is still loading', async () => {
  const scripts = chain('runtime', 'reporter');
  const first = vi.fn();
  const view = render(<RouteScriptChain scripts={scripts} onComplete={first} />);
  await fire(scripts[0].src, 'load');
  expect(scriptElements(scripts[1].src)).toHaveLength(1);

  // Same-document client redirect: the tree unmounts mid-load and remounts.
  view.unmount();
  const second = vi.fn();
  render(<RouteScriptChain scripts={scripts} onComplete={second} />);
  // next/script does not inject the in-flight src a second time.
  expect(scriptElements(scripts[1].src)).toHaveLength(1);

  await fire(scripts[1].src, 'load');
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
});

it('survives a second remount during the same in-flight load', async () => {
  const scripts = chain('runtime', 'reporter');
  render(<RouteScriptChain scripts={scripts} />).unmount();
  render(<RouteScriptChain scripts={scripts} />).unmount();
  const third = vi.fn();
  render(<RouteScriptChain scripts={scripts} onComplete={third} />);

  // next/script reports onReady to a third mount before the script has run;
  // the chain must keep waiting for the real load.
  expect(third).not.toHaveBeenCalled();
  expect(scriptElements(scripts[1].src)).toHaveLength(0);

  await fire(scripts[0].src, 'load');
  expect(scriptElements(scripts[1].src)).toHaveLength(1);
  await fire(scripts[1].src, 'load');
  expect(third).toHaveBeenCalledTimes(1);
});

it('completes immediately when every script loaded before the chain mounted', async () => {
  const scripts = chain('runtime', 'reporter');
  const view = render(<RouteScriptChain scripts={scripts} />);
  await fire(scripts[0].src, 'load');
  await fire(scripts[1].src, 'load');
  view.unmount();

  const remounted = vi.fn();
  await act(async () => {
    render(<RouteScriptChain scripts={scripts} onComplete={remounted} />);
  });
  expect(remounted).toHaveBeenCalledTimes(1);
  expect(scriptElements(scripts[0].src)).toHaveLength(1);
  expect(scriptElements(scripts[1].src)).toHaveLength(1);
});

it('reports runtime-config readiness once per chain that becomes ready', async () => {
  const ready = vi.fn();
  window.addEventListener('aver:runtime-config-ready', ready);
  try {
    // The ready event is keyed to the real runtime-config src; this test owns
    // it, no other test in this file loads it.
    const scripts: RouteScriptSpec[] = [{ src: '/js/runtime-config.js' }];
    const view = render(<RouteScriptChain scripts={scripts} />);
    view.unmount();
    const remounted = vi.fn();
    render(<RouteScriptChain scripts={scripts} onComplete={remounted} />);
    await fire('/js/runtime-config.js', 'load');

    // The unmounted chain is gone; only the live one reports.
    expect(ready).toHaveBeenCalledTimes(1);
    expect(remounted).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener('aver:runtime-config-ready', ready);
  }
});

it('stays fail-closed when a required script fails, also after a remount', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const scripts = chain('required', 'next');
  const first = vi.fn();
  const view = render(<RouteScriptChain scripts={scripts} onComplete={first} />);
  view.unmount();
  const second = vi.fn();
  render(<RouteScriptChain scripts={scripts} onComplete={second} />);

  await fire(scripts[0].src, 'error');
  expect(scriptElements(scripts[1].src)).toHaveLength(0);
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(`[route-script-chain] Không tải được ${scripts[0].src}`);

  // A later mount sees the recorded failure instead of treating it as loaded.
  const third = vi.fn();
  await act(async () => {
    render(<RouteScriptChain scripts={scripts} onComplete={third} />);
  });
  expect(third).not.toHaveBeenCalled();
  expect(scriptElements(scripts[1].src)).toHaveLength(0);
});

it('continues past an optional script that fails during a remount', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seq += 1;
  const scripts: RouteScriptSpec[] = [
    { src: `/js/j280-${seq}-runtime.js` },
    { src: `/js/j280-${seq}-reporter.js`, continueOnError: true },
  ];
  const view = render(<RouteScriptChain scripts={scripts} />);
  await fire(scripts[0].src, 'load');
  view.unmount();
  const remounted = vi.fn();
  render(<RouteScriptChain scripts={scripts} onComplete={remounted} />);

  await fire(scripts[1].src, 'error');
  expect(remounted).toHaveBeenCalledTimes(1);
});
