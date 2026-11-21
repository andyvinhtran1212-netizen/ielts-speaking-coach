// UIBASE-0056 G03-T06 (FR-005): Notice, PageState, MediaPlaceholder, PendingValue.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MediaPlaceholder, Notice, PageState, PendingValue } from '@/components/ui';

afterEach(cleanup);

describe('Notice', () => {
  it('info and success are polite status messages', () => {
    render(<Notice kind="success" title="Đã nộp bài.">Kết quả thường có sau 2 phút.</Notice>);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Đã nộp bài. Kết quả thường có sau 2 phút.');
  });

  it('warning and error are alerts with a word label, not colour alone', () => {
    render(
      <>
        <Notice kind="warning" title="Còn 5 phút.">Bài sẽ tự nộp khi hết giờ.</Notice>
        <Notice kind="error" title="Chưa nộp được bài." action={<a href="#retry">Thử nộp lại</a>}>Mất kết nối mạng.</Notice>
      </>,
    );
    const [warning, error] = screen.getAllByRole('alert');
    expect(within(warning).getByText('Cảnh báo')).toBeTruthy();
    expect(within(error).getByText('Lỗi')).toBeTruthy();
    expect(within(error).getByRole('link', { name: 'Thử nộp lại' })).toBeTruthy();
  });

  it('says Warning / Error in the exam room and can be a static part of the page', () => {
    render(<Notice kind="warning" lang="en" live="none" title="5 minutes left." />);
    expect(screen.queryByRole('alert')).toBeNull();
    const label = screen.getByText('Warning');
    expect(label.closest('[lang="en"]')).toBeTruthy();
  });
});

describe('PageState', () => {
  it('loading is a status with words for screen readers', () => {
    render(<PageState kind="loading" title="Đang tải danh sách đề" />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('Đang tải danh sách đề');
  });

  it('empty, error and locked have a heading, a body and one next step', () => {
    render(
      <>
        <PageState kind="empty" title="Chưa có bài nào được giao" body="Khi giáo viên giao bài…" action={<a href="#x">Tự luyện</a>} />
        <PageState kind="error" title="Chưa tải được danh sách đề" action={<button type="button">Tải lại</button>} />
        <PageState kind="locked" title="Nộp bài để AI chấm cần một khoá học" />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Chưa có bài nào được giao' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chưa tải được danh sách đề' })).toBeTruthy();
    expect(screen.getByText('Lỗi')).toBeTruthy();
    expect(screen.getByText('Cần khoá học')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeTruthy();
  });
});

describe('MediaPlaceholder and PendingValue', () => {
  it('names the media that will go here', () => {
    render(<MediaPlaceholder kind="chart" tag="BIỂU ĐỒ TASK 1" caption="ảnh đề bài" ratio="16:9" />);
    const img = screen.getByRole('img', { name: '[BIỂU ĐỒ TASK 1] ảnh đề bài' });
    expect(img.style.aspectRatio).toBe('16 / 9');
  });

  it('prints XXX with the title "Chưa chốt", never a made-up number', () => {
    render(<p>giá <PendingValue /></p>);
    const value = screen.getByTitle('Chưa chốt');
    expect(value.textContent).toBe('XXX');
  });
});
