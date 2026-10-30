import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useLayoutEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog as UsersPageDialog } from '@/app/(authed-admin-users)/admin/users/admin-user-ui';
import { Dialog } from '@/components/admin-directory-ui';

afterEach(cleanup);

function FocusFixture({ kind, busy = false, onClose = () => {} }: {
  kind: 'input' | 'textarea' | 'select' | 'none';
  busy?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lateField, setLateField] = useState(false);
  const close = () => { onClose(); setOpen(false); };
  const openDialog = () => { setLateField(false); setOpen(true); };
  return <>
    <button type="button" onClick={openDialog}>Mở đầu tiên</button>
    <button type="button" onClick={openDialog}>Mở tiếp theo</button>
    <Dialog open={open} title="Chỉnh sửa" busy={busy} onClose={close} actions={<button type="button" disabled={busy} onClick={close}>Hủy</button>}>
      {kind === 'input' && <input autoFocus aria-label="Tên" />}
      {kind === 'textarea' && <textarea autoFocus aria-label="Tên" />}
      {kind === 'select' && <select autoFocus aria-label="Tên"><option>Topic</option></select>}
      <button type="button" onClick={() => setLateField(true)}>Nhập lý do</button>
      {lateField && <textarea autoFocus aria-label="Lý do" />}
    </Dialog>
  </>;
}

describe('shared admin Dialog', () => {
  it.each(['Lưu trữ', 'Khôi phục'])('%s moves focus before paint and restores the trigger on Escape', (title) => {
    const focusAtPaint: (Element | null)[] = [];
    function Fixture() {
      const [open, setOpen] = useState(false);
      useLayoutEffect(() => {
        if (open) focusAtPaint.push(document.activeElement);
      }, [open]);
      return <>
        <button onClick={() => setOpen(true)}>{title} học viên</button>
        <Dialog open={open} title={title} onClose={() => setOpen(false)} actions={<button>Hủy</button>}>
          {title === 'Lưu trữ' && <textarea aria-label="Lý do" />}
        </Dialog>
      </>;
    }
    render(<StrictMode><Fixture /></StrictMode>);
    const trigger = screen.getByRole('button', { name: `${title} học viên` });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(focusAtPaint).toEqual([dialog]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('moves focus inside, traps keyboard focus, closes on Escape, and restores focus', () => {
    const onClose = vi.fn();
    const origin = document.createElement('button');
    origin.textContent = 'Open';
    document.body.append(origin);
    origin.focus();

    const view = render(
      <Dialog open title="Xác nhận" onClose={onClose} actions={<button type="button">Lưu</button>}>
        <input aria-label="Tên" />
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Xác nhận' });
    const close = screen.getByRole('button', { name: 'Đóng' });
    const save = screen.getByRole('button', { name: 'Lưu' });
    expect(document.activeElement).toBe(dialog);

    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(<Dialog open={false} title="Xác nhận" onClose={onClose} actions={null} />);
    expect(document.activeElement).toBe(origin);
    origin.remove();
  });

  it('wraps Shift+Tab from the initially focused panel to the last control instead of leaving the dialog', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    render(<Dialog open title="Xác nhận" onClose={() => {}} actions={<><button type="button">Hủy</button><button type="button">Giao thêm</button></>} />);
    const dialog = screen.getByRole('dialog', { name: 'Xác nhận' });
    expect(document.activeElement).toBe(dialog);

    const reverse = fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(reverse).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Giao thêm' }));

    dialog.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Đóng' }));

    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Giao thêm' }));
    outside.remove();
  });

  it('blocks Escape, backdrop, and close-button dismissal while a write is busy', () => {
    const onClose = vi.fn();
    render(<Dialog open busy title="Đang lưu" onClose={onClose} actions={<button type="button">Đợi</button>} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.querySelector('.acd-dialog-backdrop')!);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Đóng' }).disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['input', 'textarea', 'select'] as const)('restores the opener when an initial %s autoFocus precedes the panel effect', (kind) => {
    render(<StrictMode><FocusFixture kind={kind} /></StrictMode>);
    const opener = screen.getByRole('button', { name: 'Mở đầu tiên' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Chỉnh sửa' }));
    screen.getByLabelText('Tên').focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('survives StrictMode effect replay when an autoFocus dialog is initially mounted open', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const view = render(<StrictMode><Dialog open title="Chỉnh sửa" onClose={() => {}} actions={null}><input autoFocus aria-label="Tên" /></Dialog></StrictMode>);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps the original opener through busy rerenders and resets it for a different subsequent opener', () => {
    const onClose = vi.fn();
    const view = render(<StrictMode><FocusFixture kind="input" onClose={onClose} /></StrictMode>);
    const first = screen.getByRole('button', { name: 'Mở đầu tiên' });
    first.focus();
    fireEvent.click(first);
    screen.getByLabelText('Tên').focus();
    view.rerender(<StrictMode><FocusFixture kind="input" busy onClose={onClose} /></StrictMode>);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.querySelector('.acd-dialog-backdrop')!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(<StrictMode><FocusFixture kind="input" onClose={onClose} /></StrictMode>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(first);
    expect(onClose).toHaveBeenCalledOnce();
    const next = screen.getByRole('button', { name: 'Mở tiếp theo' });
    next.focus();
    fireEvent.click(next);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(document.activeElement).toBe(next);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('allows a late conditional field to take focus without replacing the non-autoFocus dialog opener', () => {
    render(<StrictMode><FocusFixture kind="none" /></StrictMode>);
    const opener = screen.getByRole('button', { name: 'Mở đầu tiên' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    const reject = screen.getByRole('button', { name: 'Nhập lý do' });
    reject.focus();
    fireEvent.click(reject);
    expect(document.activeElement).toBe(screen.getByLabelText('Lý do'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('does not focus a disconnected opener or steal focus from its connected replacement', () => {
    const opener = document.createElement('button');
    const replacement = document.createElement('button');
    document.body.append(opener, replacement);
    opener.focus();
    const view = render(<Dialog open title="Chỉnh sửa" onClose={() => {}} actions={null}><input autoFocus aria-label="Tên" /></Dialog>);
    opener.remove();
    const focus = vi.spyOn(opener, 'focus');
    replacement.focus();
    view.unmount();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(replacement);
    replacement.remove();
  });

  it('a dialog opened over another owns Escape and the Tab trap until it closes', () => {
    const closeLower = vi.fn();
    const closeUpper = vi.fn();
    function Stacked() {
      const [upper, setUpper] = useState(false);
      return (
        <>
          <Dialog open title="Tạm khóa" busy onClose={closeLower} actions={<button type="button" onClick={() => setUpper(true)}>Mở mã</button>}>
            <input aria-label="Lý do" />
          </Dialog>
          <Dialog open={upper} title="Xác thực 2 bước" onClose={() => { closeUpper(); setUpper(false); }} actions={<button type="button">Hủy</button>}>
            <input aria-label="Mã 6 số" />
          </Dialog>
        </>
      );
    }
    render(<Stacked />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở mã' }));
    const code = screen.getByLabelText('Mã 6 số');
    code.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(code);  // the lower dialog no longer pulls focus back
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Xác thực 2 bước' }).contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeUpper).toHaveBeenCalledTimes(1);
    expect(closeLower).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Xác thực 2 bước' })).toBeNull();
    // Back on top, the lower dialog traps Tab again.
    const reason = screen.getByLabelText('Lý do');
    reason.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Tạm khóa' }).contains(document.activeElement)).toBe(true);
  });

  // PR #2023 Codex P2 (r4420067407): /admin/users' suspend/reactivate dialog is
  // page-local (admin-user-ui.tsx). Busy, it has no enabled control, and its
  // own Tab trap used to focus its panel on every Tab — the prompt above then
  // snapped focus back to its first control, so the code input was unreachable.
  it('a page-local busy users dialog under the step-up prompt lets Tab walk every prompt control', () => {
    const closeLower = vi.fn();
    // The confirm dialog is open (and busy with the PATCH) before the refusal opens the prompt.
    const stacked = (prompt: boolean) => (
      <>
        <UsersPageDialog open busy title="Tạm khóa tài khoản" onClose={closeLower} actions={<><button type="button" disabled>Hủy</button><button type="button" disabled>Tạm khóa</button></>}>
          <textarea aria-label="Lý do" disabled />
        </UsersPageDialog>
        <Dialog open={prompt} title="Xác thực 2 bước" onClose={() => {}} actions={<button type="button">Hủy</button>}>
          <input aria-label="Mã 6 số" />
          <button type="button">Xác thực</button>
        </Dialog>
      </>
    );
    const view = render(stacked(false));
    view.rerender(stacked(true));
    const prompt = screen.getByRole('dialog', { name: 'Xác thực 2 bước' });
    // Browser Tab emulation: keydown on the focused element, then — unless a
    // handler prevented it — move to the next tabbable control in DOM order.
    const tabbables = () => Array.from(document.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])'));
    const pressTab = (shiftKey = false) => {
      const from = document.activeElement as HTMLElement;
      const prevented = !fireEvent.keyDown(from, { key: 'Tab', shiftKey });
      if (prevented) return;
      const list = tabbables();
      const at = list.indexOf(from);
      list[(at + (shiftKey ? -1 : 1) + list.length) % list.length]?.focus();
    };
    const visited = new Set<string>();
    for (let step = 0; step < 8; step += 1) {
      pressTab();
      expect(prompt.contains(document.activeElement)).toBe(true);
      visited.add((document.activeElement as HTMLElement).getAttribute('aria-label') || document.activeElement!.textContent || '');
    }
    expect([...visited].sort()).toEqual(['Hủy', 'Mã 6 số', 'Đóng', 'Xác thực'].sort());
    for (let step = 0; step < 8; step += 1) {
      pressTab(true);
      expect(prompt.contains(document.activeElement)).toBe(true);
    }
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(closeLower).not.toHaveBeenCalled();
  });
});
