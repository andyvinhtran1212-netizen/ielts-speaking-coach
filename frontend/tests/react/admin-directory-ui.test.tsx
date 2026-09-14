import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@/components/admin-directory-ui';

afterEach(cleanup);

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
});
