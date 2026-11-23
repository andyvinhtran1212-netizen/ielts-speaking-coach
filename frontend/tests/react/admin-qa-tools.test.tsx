import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { AdminQaTools, qaTestErrorAllowed } from '@/app/(authed-admin)/(qa-tools)/admin/qa-tools/admin-qa-tools';

type RuntimeWindow = Window & { __AVER_RUNTIME_CONFIG__?: { environment?: string | null }; api?: unknown };

function setRuntime(environment: string | null, post = vi.fn()) {
  const w = window as RuntimeWindow;
  w.__AVER_RUNTIME_CONFIG__ = { environment };
  w.api = { post };
  return post;
}

afterEach(() => {
  cleanup();
  const w = window as RuntimeWindow;
  delete w.__AVER_RUNTIME_CONFIG__;
  delete w.api;
});

describe('qaTestErrorAllowed (ADMINIA-0074 FR-073)', () => {
  it('allows only a known environment that is not Production', () => {
    expect(qaTestErrorAllowed('staging')).toBe(true);
    expect(qaTestErrorAllowed('preview')).toBe(true);
    expect(qaTestErrorAllowed('test')).toBe(true);
    expect(qaTestErrorAllowed('production')).toBe(false);
    expect(qaTestErrorAllowed(' Production ')).toBe(false);
    expect(qaTestErrorAllowed(null)).toBe(false);
    expect(qaTestErrorAllowed('')).toBe(false);
    expect(qaTestErrorAllowed(undefined)).toBe(false);
  });
});

describe('AdminQaTools', () => {
  it('links the QA tools and sends one test error on staging', async () => {
    const post = setRuntime('staging', vi.fn().mockRejectedValue(Object.assign(new Error('HTTP 500'), { status: 500 })));
    render(<AdminQaTools />);
    expect(screen.getByRole('link', { name: /Thử đề xuất ngữ pháp/ }).getAttribute('href')).toBe('/admin/grammar/recommend-test');
    expect(screen.getByRole('link', { name: /Sửa đáp án đề thi thử/ }).getAttribute('href')).toBe('/admin/mock-exams/corrections');

    const button = await screen.findByRole('button', { name: 'Tạo lỗi thử' });
    await act(async () => { fireEvent.click(button); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/admin/error-logs/test?error_type=exception', {});
    // The 500 is the expected answer: the backend raises on purpose.
    expect(screen.getByRole('status').textContent).toContain('Đã gửi lỗi thử');
  });

  it('has no button on Production and makes no request', async () => {
    const post = setRuntime('production');
    render(<AdminQaTools />);
    expect(await screen.findByText('Không có trên Production.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tạo lỗi thử' })).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('hides the button when the build does not know its environment', async () => {
    setRuntime(null);
    render(<AdminQaTools />);
    expect(await screen.findByText(/Chưa xác định được môi trường/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tạo lỗi thử' })).toBeNull();
  });

  it('says the server refused when it answers 403', async () => {
    setRuntime('staging', vi.fn().mockRejectedValue(Object.assign(new Error('HTTP 403'), { status: 403 })));
    render(<AdminQaTools />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Tạo lỗi thử' })); });
    expect(screen.getByRole('alert').textContent).toContain('Máy chủ từ chối');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
