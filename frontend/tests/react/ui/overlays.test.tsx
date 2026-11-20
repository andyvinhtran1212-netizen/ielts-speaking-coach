// UIBASE-0056 G03-T06 (FR-005): Dialog and ConfirmDialog behaviour.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Button, ConfirmDialog, Dialog } from '@/components/ui';

// jsdom 26 has no HTMLDialogElement.showModal/close (GOI-03 §T05–T10 note).
// These stand-ins only toggle the `open` attribute; the real top-layer and
// inert behaviour is checked in the browser on /ui-library.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
});

afterEach(cleanup);

function Opener({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Mở</Button>
      <Dialog
        open={open}
        busy={busy}
        onClose={() => setOpen(false)}
        title="Gửi nhắc nhở cho 3 học viên?"
        actions={<Button onClick={() => setOpen(false)}>Gửi nhắc nhở</Button>}
      >
        <p>Mỗi học viên nhận một email.</p>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('opens as a modal named by its title and moves focus inside', async () => {
    render(<Opener />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    const dialog = screen.getByRole('dialog', { name: 'Gửi nhắc nhở cho 3 học viên?' });
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('closes on Esc and returns focus to the button that opened it', async () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Mở' });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes from the close button and from a click on the backdrop', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Xem nhanh" closeLabel="Đóng xem nhanh" />);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng xem nhanh' }));
    const dialog = screen.getByRole('dialog', { name: 'Xem nhanh' });
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close while busy', () => {
    const onClose = vi.fn();
    render(<Dialog open busy onClose={onClose} title="Đang gửi" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('button', { name: 'Đóng' }).hasAttribute('disabled')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays in sync when the browser closes it natively (second Esc)', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open onClose={onClose} title="Xem nhanh" />);
    const dialog = screen.getByRole('dialog') as HTMLDialogElement;
    dialog.removeAttribute('open');
    fireEvent(dialog, new Event('close'));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<Dialog open busy onClose={onClose} title="Xem nhanh" />);
    const calls = (HTMLDialogElement.prototype.showModal as ReturnType<typeof vi.fn>).mock.calls.length;
    dialog.removeAttribute('open');
    fireEvent(dialog, new Event('close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect((HTMLDialogElement.prototype.showModal as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls + 1);
    expect(dialog.hasAttribute('open')).toBe(true);
  });

  it('keeps Tab inside the dialog', async () => {
    render(<Opener />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    const dialog = screen.getByRole('dialog');
    const last = screen.getByRole('button', { name: 'Gửi nhắc nhở' });
    const first = screen.getByRole('button', { name: 'Đóng' });
    // jsdom has no layout, so the hook's visibility filter needs client rects.
    for (const el of [first, last]) el.getClientRects = () => ({ length: 1 } as DOMRectList);
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('ConfirmDialog', () => {
  const base = {
    open: true,
    tone: 'warning' as const,
    title: 'Nộp bài khi còn 3 câu chưa trả lời?',
    body: 'Câu 7, 12 và 13 đang để trống.',
    confirmLabel: 'Nộp bài',
    cancelLabel: 'Quay lại làm tiếp',
  };

  it('is an alertdialog with the question as name and the body as description', () => {
    render(<ConfirmDialog {...base} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog', { name: base.title });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe(base.body);
    expect(screen.getByText('Cảnh báo')).toBeTruthy();
  });

  it('starts on the way back and reports each choice', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} onConfirm={onConfirm} onCancel={onCancel} />);
    const back = screen.getByRole('button', { name: 'Quay lại làm tiếp' });
    await waitFor(() => expect(document.activeElement).toBe(back));
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));
    fireEvent.click(back);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('while busy: confirm is busy, the way back is disabled and Esc is ignored', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} busy busyLabel="Đang nộp…" onConfirm={vi.fn()} onCancel={onCancel} />);
    const confirm = screen.getByRole('button', { name: 'Đang nộp…' });
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Quay lại làm tiếp' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('uses English words in the exam room', () => {
    render(
      <ConfirmDialog
        open
        tone="warning"
        lang="en"
        title="Submit the test?"
        confirmLabel="Submit test"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Warning')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
