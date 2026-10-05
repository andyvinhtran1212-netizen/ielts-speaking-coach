import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
