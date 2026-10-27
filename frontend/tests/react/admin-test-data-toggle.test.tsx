import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
const visibility = vi.hoisted(() => ({ payload: {} as unknown }));
vi.mock('@/lib/browser-api', () => ({ getBrowserJson: vi.fn(async () => visibility.payload) }));

import { AdminTestDataToggle } from '@/components/admin-test-data-toggle';
import { getBrowserJson } from '@/lib/browser-api';
import { normalizeTestDataVisibility, SHOW_TEST_DATA_STORAGE_KEY } from '@/lib/admin-test-data-api';

const reload = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
});
afterEach(() => { cleanup(); reload.mockReset(); });

describe('TASK B2 staging test-data toggle', () => {
  it('renders nothing unless the backend reports hiding as active', async () => {
    for (const payload of [{}, null, { hiding_enabled: false, showing_test_data: false },
      { hiding_enabled: true }, { hiding_enabled: 'true', showing_test_data: false }]) {
      expect(normalizeTestDataVisibility(payload)).toBeNull();
    }
    visibility.payload = { hiding_enabled: false, showing_test_data: false };
    const view = render(<AdminTestDataToggle />);
    await waitFor(() => expect(getBrowserJson).toHaveBeenCalledWith('/admin/test-data/visibility'));
    expect(view.container.innerHTML).toBe('');
  });

  it('opts this browser in, then reloads so panels refetch with the header', async () => {
    visibility.payload = { hiding_enabled: true, showing_test_data: false };
    render(<AdminTestDataToggle />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hiện dữ liệu kiểm thử' }));
    expect(window.localStorage.getItem(SHOW_TEST_DATA_STORAGE_KEY)).toBe('1');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('follows the server answer and opts back out', async () => {
    window.localStorage.setItem(SHOW_TEST_DATA_STORAGE_KEY, '1');
    visibility.payload = { hiding_enabled: true, showing_test_data: true };
    render(<AdminTestDataToggle />);
    expect(await screen.findByText(/Đang hiện dữ liệu kiểm thử/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn dữ liệu kiểm thử' }));
    expect(window.localStorage.getItem(SHOW_TEST_DATA_STORAGE_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
