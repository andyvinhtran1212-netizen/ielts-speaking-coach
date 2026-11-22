// UIBASE-0056 G03-T15 (FR-009, FR-025): FocusShell behaviour in both modes.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FocusShell, FocusStatus, FocusTimer, type FocusShellProps } from '@/components/ui/shell/focus-shell';
import { navigationGuardBlocks } from '@/lib/navigation-guard';

// jsdom has no HTMLDialogElement.showModal/close; see overlays.test.tsx.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Any Vietnamese letter with a diacritic (Latin-1 Supplement to Latin Extended Additional, plus đ/Đ).
const VIETNAMESE = /[À-ÿĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;

function stubAssign() {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  return assign;
}

function practice(props: Partial<FocusShellProps> = {}) {
  return render(
    <FocusShell
      mode="practice"
      title="Luyện Speaking Part 1 · Quê hương"
      exitHref="/practice"
      hasUnsavedWork={() => false}
      right={<><FocusStatus tone="recording">Đang ghi âm 00:42</FocusStatus><FocusStatus>Câu 2 trên 5</FocusStatus></>}
      {...props}
    >
      <p>Nội dung</p>
    </FocusShell>,
  );
}

function exam(props: Partial<FocusShellProps> = {}) {
  return render(
    <FocusShell
      mode="exam"
      title="Reading · Academic Test 1"
      detail="Passage 1 of 3"
      exitHref="/tests"
      hasUnsavedWork={() => false}
      right={<><FocusStatus>Saved at 10:42</FocusStatus><FocusTimer label="Time remaining" value="52:18" /></>}
      bottom={<button type="button">Submit test</button>}
      {...props}
    >
      <p>Question 1</p>
    </FocusShell>,
  );
}

describe('practice mode (Vietnamese, paper bar)', () => {
  it('leaves at once when nothing would be lost', () => {
    const assign = stubAssign();
    practice();
    fireEvent.click(screen.getByRole('button', { name: 'Thoát' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(assign).toHaveBeenCalledWith('/practice');
  });

  it('asks when work would be lost: stay is focused, Esc stays, the danger button leaves', async () => {
    const assign = stubAssign();
    const onLeave = vi.fn();
    practice({ hasUnsavedWork: () => true, onLeave });
    fireEvent.click(screen.getByRole('button', { name: 'Thoát' }));
    const box = screen.getByRole('alertdialog', { name: 'Thoát khi đang ghi âm?' });
    const stay = within(box).getByRole('button', { name: 'Ở lại ghi tiếp' });
    await waitFor(() => expect(document.activeElement).toBe(stay));
    expect(within(box).getAllByRole('button').map((b) => b.textContent))
      .toEqual(expect.arrayContaining(['Ở lại ghi tiếp', 'Bỏ đoạn ghi và thoát']));

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(assign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Thoát' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ đoạn ghi và thoát' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/practice');
  });

  it('page words can replace the box words', () => {
    practice({ hasUnsavedWork: () => true, leaveCopy: { title: 'Thoát bài đang làm?', stayLabel: 'Ở lại làm tiếp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thoát' }));
    expect(screen.getByRole('alertdialog', { name: 'Thoát bài đang làm?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ở lại làm tiếp' })).toBeTruthy();
  });
});

describe('exam mode (English only, ink bar)', () => {
  it('always asks, says the server timer keeps running, and has no "Save and exit"', () => {
    const assign = stubAssign();
    exam();
    fireEvent.click(screen.getByRole('button', { name: 'Leave test' }));
    const box = screen.getByRole('alertdialog', { name: 'Leave this test?' });
    expect(box.textContent).toContain('The timer keeps running on our server while you are away.');
    expect(within(box).getByRole('button', { name: 'Stay in test' })).toBeTruthy();
    expect(screen.queryByText(/save and exit/i)).toBeNull();
    fireEvent.click(within(box).getByRole('button', { name: 'Leave test' }));
    expect(assign).toHaveBeenCalledWith('/tests');
  });

  it('no Vietnamese letter anywhere, with the leave box open', () => {
    const { container } = exam({ onAbandon: () => {} });
    fireEvent.click(screen.getByRole('button', { name: 'Leave test' }));
    expect(container.textContent).not.toMatch(VIETNAMESE);
    const labels = [...container.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label')).join(' ');
    expect(labels).not.toMatch(VIETNAMESE);
    expect(container.firstElementChild?.getAttribute('lang')).toBe('en');
  });

  it('"Abandon test" only when the page passes it (self-selected tests)', () => {
    exam();
    expect(screen.queryByRole('button', { name: 'Abandon test' })).toBeNull();
    cleanup();
    const onAbandon = vi.fn();
    exam({ onAbandon });
    fireEvent.click(screen.getByRole('button', { name: 'Abandon test' }));
    expect(onAbandon).toHaveBeenCalledTimes(1);
  });

  it('the timer is a timer named by its label', () => {
    exam();
    expect(screen.getByRole('timer', { name: 'Time remaining' }).textContent).toBe('52:18');
  });

  it('the full-test room stays light (FR-025); a course test follows the site theme', () => {
    const { container } = exam();
    expect(container.firstElementChild?.classList.contains('av2-always-light')).toBe(true);
    cleanup();
    const course = exam({ fullTestRoom: false });
    expect(course.container.firstElementChild?.classList.contains('av2-always-light')).toBe(false);
  });
});

describe('both modes', () => {
  it('no footer, AI credits, account button, bell or section nav; practice has no lang override', () => {
    const { container } = practice();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(container.textContent).not.toMatch(/Lượt|Tài khoản|Thông báo/);
    expect(container.firstElementChild?.hasAttribute('lang')).toBe(false);
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('the same hasUnsavedWork guards tab close, reload and links', () => {
    stubAssign();
    let unsaved = true;
    practice({ hasUnsavedWork: () => unsaved });
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(true);
    expect(navigationGuardBlocks()).toBe(true);
    unsaved = false;
    expect(unload()).toBe(false);
    expect(navigationGuardBlocks()).toBe(false);

    // Once the learner confirmed leaving, the guard lets the page go.
    unsaved = true;
    fireEvent.click(screen.getByRole('button', { name: 'Thoát' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ đoạn ghi và thoát' }));
    expect(unload()).toBe(false);
  });

  it('demo mode (library page) renders no <main>, no skip link and no guard', () => {
    practice({ demo: true, hasUnsavedWork: () => true });
    expect(screen.queryByRole('main')).toBeNull();
    expect(navigationGuardBlocks()).toBe(false);
  });
});
