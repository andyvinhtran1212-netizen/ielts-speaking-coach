// UIBASE-0056 G03-T05 (FR-005): Button and IconButton behaviour.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, IconButton } from '@/components/ui';

afterEach(cleanup);

describe('Button', () => {
  it('is a type="button" button named by its label', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Nộp bài</Button>);
    const button = screen.getByRole('button', { name: 'Nộp bài' });
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps type="submit" when asked', () => {
    render(<form><Button type="submit">Gửi</Button></form>);
    expect(screen.getByRole('button', { name: 'Gửi' }).getAttribute('type')).toBe('submit');
  });

  it('while loading: aria-disabled + aria-busy, says the busy label, ignores clicks, stays focusable', () => {
    const onClick = vi.fn();
    render(<Button loading loadingLabel="Đang nộp…" onClick={onClick}>Nộp bài</Button>);
    const button = screen.getByRole('button', { name: 'Đang nộp…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('text buttons have no loading state', () => {
    render(<Button variant="text" loading>Xem lại đáp án</Button>);
    const button = screen.getByRole('button', { name: 'Xem lại đáp án' });
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('disabled uses the native attribute', () => {
    render(<Button disabled>Lưu nháp</Button>);
    expect((screen.getByRole('button', { name: 'Lưu nháp' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('with href renders a link; disabled link has no href and aria-disabled', () => {
    const { rerender } = render(<Button href="/courses">Xem các khoá</Button>);
    expect(screen.getByRole('link', { name: 'Xem các khoá' }).getAttribute('href')).toBe('/courses');
    rerender(<Button href="/courses" disabled>Xem các khoá</Button>);
    const link = screen.getByRole('link', { name: 'Xem các khoá' });
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.getAttribute('aria-disabled')).toBe('true');
  });

  it('the start icon is not part of the accessible name', () => {
    render(<Button iconStart={<svg><title>plus</title></svg>}>Thêm câu hỏi</Button>);
    expect(screen.getByRole('button', { name: 'Thêm câu hỏi' })).toBeTruthy();
  });
});

describe('IconButton', () => {
  it('is named by its label and hides the icon from screen readers', () => {
    render(<IconButton icon="close" label="Đóng" />);
    const button = screen.getByRole('button', { name: 'Đóng' });
    expect(button.getAttribute('title')).toBe('Đóng');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('forwards clicks and disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<IconButton icon="trash" label="Xoá bài nháp" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá bài nháp' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<IconButton icon="trash" label="Xoá bài nháp" onClick={onClick} disabled />);
    expect((screen.getByRole('button', { name: 'Xoá bài nháp' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
