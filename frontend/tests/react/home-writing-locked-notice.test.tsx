// G02-T14 / FR-02-012 — the locked Writing card on /home explains itself in the
// page instead of opening a browser alert box.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'learner-1' } }) }));

import { HomeBehavior } from '@/app/(authed-home)/home/home-behavior';

const LOCKED_TEXT = 'Bạn chưa có quyền dùng Writing. Hỏi giáo viên hoặc quản trị viên lớp để được mở.';

function mountShell() {
  document.body.innerHTML = '<article class="skill-card" data-skill="writing"><div class="head"></div></article>';
}

beforeEach(() => {
  mountShell();
  (window as unknown as { api: unknown }).api = {
    get: vi.fn(async (path: string) => {
      if (path === '/api/student/permissions') return { writing: false };
      if (path === '/api/student/home-summary') return { student: { name: 'Lan' }, skills: {} };
      return null;
    }),
  };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('Home locked Writing card', () => {
  it('shows an in-card status notice on click and never calls window.alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<HomeBehavior />);

    const card = document.querySelector<HTMLElement>('[data-skill="writing"]')!;
    await waitFor(() => expect(card.dataset.locked).toBe('true'));

    const note = card.querySelector<HTMLElement>('.lock-note')!;
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toBe('');

    fireEvent.click(card);
    expect(note.textContent).toBe(LOCKED_TEXT);
    expect(card.textContent).not.toMatch(/mua|đăng ký/i);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('shows the same notice from the keyboard (Enter)', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<HomeBehavior />);

    const card = document.querySelector<HTMLElement>('[data-skill="writing"]')!;
    await waitFor(() => expect(card.dataset.locked).toBe('true'));

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(card.querySelector('.lock-note')!.textContent).toBe(LOCKED_TEXT);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
