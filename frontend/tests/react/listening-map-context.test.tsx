import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ListeningTestSession } from '@/app/(authed-listening-player)/listening/test/session/listening-test-session';

vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'map-admin' } }) }));
let get: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, '', '/listening/test/session?id=map-fixture&admin_preview=1');
  get = vi.fn(); Object.defineProperty(window, 'api', { configurable: true, value: { get } });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

it.each([
  ['Street map of the town', 'Street map of the town'],
  ['  ', 'Map or plan for questions 16 to 20'],
  [{ hidden: 'PRIVATE_HEADING' }, 'Map or plan for questions 16 to 20'],
])('uses the public visual context for map heading %s, without exposing private hints', async (heading, expected) => {
  get.mockResolvedValue({ id: 'map-fixture', title: 'Map fixture', test_type: 'mini', audio_url: 'https://audio.fixture.test/map.wav', sections: [{ section_num: 2, exercises: [{ id: 'map-row', payload: {
    variant: 'plan_label', template: { heading }, map_svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" /></svg>',
    questions: [16, 20].map(q_num => ({ q_num, prompt: `Place ${q_num}` })),
    metadata: { letter_options: ['A', 'B', 'C'], map_description: 'PRIVATE_ROUTE_HINT' },
  } }] }] });
  const view = render(<ListeningTestSession />);
  expect(await screen.findByRole('img', { name: expected as string })).toBeTruthy();
  expect(view.container.textContent).not.toContain('PRIVATE_ROUTE_HINT'); expect(view.container.textContent).not.toContain('PRIVATE_HEADING');
});
