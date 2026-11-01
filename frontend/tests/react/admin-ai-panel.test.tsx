import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminAiFailuresWire, AdminAiModelsWire, AdminAiUsageWire } from '@/lib/admin-ai-api';

const api = vi.hoisted(() => ({
  getAdminAiModels: vi.fn(),
  getAdminAiUsage: vi.fn(),
  getAdminAiFailures: vi.fn(),
  patchAdminAiModel: vi.fn(),
}));

vi.mock('client-only', () => ({}));
vi.mock('@/lib/admin-ai-api', () => api);

import { AdminAiPanel, formatSaigon } from '@/app/(authed-admin-overview)/admin/admin-ai-panel';

function feature(name: string, overrides: Partial<AdminAiModelsWire['features'][number]> = {}) {
  return {
    feature: name,
    label: name === 'writing_grading' ? 'Chấm Writing' : 'Soát bài tự luận theo buổi',
    existing_provider: 'gemini',
    allowed_providers: ['anthropic', 'gemini'],
    effective_order: [
      { provider: 'anthropic', slot: 'anthropic', model: 'claude-sonnet-5-5', model_source: 'code_default', available: true, note: '' },
      { provider: 'gemini', slot: 'gemini', model: 'gemini-3.8-flash', model_source: 'env', available: true, note: '' },
    ],
    preferred_provider: { value: 'anthropic', source: 'env' },
    anthropic_model: { value: 'claude-sonnet-5-5', source: 'code_default' },
    existing_models: [{ model: 'gemini-3.8-flash', setting: 'WRITING_FLASH_MODEL', source: 'env', note: 'L1–L3' }],
    override: null,
    ...overrides,
  } as AdminAiModelsWire['features'][number];
}

function models(overrides: Partial<AdminAiModelsWire> = {}): AdminAiModelsWire {
  return {
    features: [feature('writing_grading'), feature('course_writing')],
    anthropic_models: ['claude-sonnet-5-5', 'claude-haiku-5-5'],
    anthropic_key_configured: true,
    store: { status: 'ok', last_refreshed_at: '2026-10-26T05:00:00Z', last_error: null, ttl_seconds: 30 },
    recent_changes: [],
    recent_changes_error: null,
    computed_at: '2026-10-26T05:00:00Z',
    ...overrides,
  } as AdminAiModelsWire;
}

const zeroTotals = {
  calls: 0, failed_calls: 0, input_tokens: 0, output_tokens: 0, thinking_tokens: 0,
  cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, priced_calls: 0, unpriced_calls: 0, legacy_calls: 0,
};
const window7 = { key: '7d', start: '2026-10-19T17:00:00Z', end: '2026-10-26T05:00:00Z', timezone: 'Asia/Saigon' };

function usage(totals = zeroTotals): AdminAiUsageWire {
  return {
    window: window7,
    totals,
    by_feature: totals.calls ? [{ ...totals, feature: 'writing_grading' }] : [],
    by_provider: totals.calls ? [{ ...totals, provider: 'anthropic' }] : [],
    meta: { source: 'ai_usage_logs', note: 'Chi phí là ước tính.' },
  } as AdminAiUsageWire;
}

function failures(overrides: Partial<AdminAiFailuresWire> = {}): AdminAiFailuresWire {
  return {
    window: window7,
    store_status: 'ok',
    totals: { total: 0, retry: 0, fallback: 0, final: 0 },
    by_provider_feature: [],
    recent: [],
    ...overrides,
  } as AdminAiFailuresWire;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  api.getAdminAiModels.mockResolvedValue(models());
  api.getAdminAiUsage.mockResolvedValue(usage());
  api.getAdminAiFailures.mockResolvedValue(failures());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminAiPanel', () => {
  it('shows loading, then the effective chain with value sources', async () => {
    const pending = deferred<AdminAiModelsWire>();
    api.getAdminAiModels.mockReturnValueOnce(pending.promise);
    render(<AdminAiPanel />);
    expect(screen.getByText('Đang tải cấu hình model…')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Model đang dùng theo tính năng' }).getAttribute('aria-busy')).toBe('true');

    await act(async () => pending.resolve(models()));
    const row = screen.getByRole('row', { name: /Chấm Writing/ });
    const [first, second] = within(row).getAllByRole('listitem');
    expect(first.textContent).toContain('Claude · claude-sonnet-5-5');
    expect(first.textContent).toContain('mặc định code');
    expect(second.textContent).toContain('Gemini · gemini-3.8-flash');
    expect(second.textContent).toContain('env');
    expect(within(row).getAllByText('mặc định code').length).toBeGreaterThan(0);
    expect(within(row).getAllByText('env').length).toBeGreaterThan(0);
    expect(screen.getByText(/làm mới mỗi 30s/).getAttribute('role')).toBe('status');
  });

  it('saves through PATCH, shows pending, then renders the canonical refetch', async () => {
    render(<AdminAiPanel />);
    const select = await screen.findByLabelText('Nhà cung cấp ưu tiên cho Chấm Writing');
    const save = screen.getByRole('button', { name: 'Lưu lựa chọn cho Chấm Writing' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'gemini' } });
    expect(save.disabled).toBe(false);

    const pending = deferred<AdminAiModelsWire>();
    api.patchAdminAiModel.mockReturnValueOnce(pending.promise);
    fireEvent.click(save);
    expect(api.patchAdminAiModel).toHaveBeenCalledWith('writing_grading', {
      preferred_provider: 'gemini', anthropic_model: null,
    });
    expect(save.textContent).toBe('Đang lưu…');
    expect((select as HTMLSelectElement).disabled).toBe(true);

    const canonical = models({
      features: [
        feature('writing_grading', {
          effective_order: [
            { provider: 'gemini', slot: 'gemini', model: 'gemini-3.8-flash', model_source: 'env', available: true, note: '' },
            { provider: 'anthropic', slot: 'anthropic', model: 'claude-sonnet-5-5', model_source: 'code_default', available: true, note: '' },
          ],
          preferred_provider: { value: 'gemini', source: 'db_override' },
          override: { preferred_provider: 'gemini', anthropic_model: null, updated_at: '2026-10-26T05:01:00Z', updated_by: 'a1', updated_by_email: 'owner@example.com', invalid_fields: [] },
        }),
        feature('course_writing'),
      ],
      recent_changes: [{
        id: 1, feature: 'writing_grading', action: 'insert', old_preferred_provider: null,
        new_preferred_provider: 'gemini', old_anthropic_model: null, new_anthropic_model: null,
        changed_by: 'a1', changed_by_email: 'owner@example.com', changed_at: '2026-10-26T05:01:00Z',
      }],
    });
    await act(async () => pending.resolve(canonical));

    const row = screen.getByRole('row', { name: /Chấm Writing/ });
    expect(within(row).getByText('DB override')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu lựa chọn cho Chấm Writing' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/owner@example.com/)).toBeTruthy();
    expect(api.getAdminAiModels).toHaveBeenCalledTimes(1);
  });

  it('keeps canonical values and shows the server message when a save is rejected', async () => {
    render(<AdminAiPanel />);
    const select = await screen.findByLabelText('Model Claude cho Soát bài tự luận theo buổi');
    fireEvent.change(select, { target: { value: 'claude-haiku-5-5' } });
    api.patchAdminAiModel.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), {
      status: 503,
      detail: { error_code: 'ai_override_store_unavailable', message: 'Chưa áp dụng migration 322 — không lưu được lựa chọn model.' },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lựa chọn cho Soát bài tự luận theo buổi' }));
    const alert = await screen.findByText('Chưa áp dụng migration 322 — không lưu được lựa chọn model.');
    expect(alert.getAttribute('role')).toBe('alert');
    const row = screen.getByRole('row', { name: /Soát bài tự luận/ });
    expect(within(row).queryByText('DB override')).toBeNull();
  });

  it('shows the field-level 422 message on the rejected row only and keeps canonical values', async () => {
    render(<AdminAiPanel />);
    fireEvent.change(await screen.findByLabelText('Model Claude cho Chấm Writing'), { target: { value: 'claude-haiku-5-5' } });
    api.patchAdminAiModel.mockRejectedValueOnce(Object.assign(new Error('HTTP 422'), {
      status: 422,
      detail: { error_code: 'ai_override_invalid', field: 'anthropic_model', message: 'anthropic_model không nằm trong danh sách cho phép.' },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lựa chọn cho Chấm Writing' }));

    const rejected = screen.getByRole('row', { name: /Chấm Writing/ });
    const alert = await within(rejected).findByRole('alert');
    expect(alert.textContent).toBe('anthropic_model không nằm trong danh sách cho phép.');
    expect(within(screen.getByRole('row', { name: /Soát bài tự luận/ })).queryByRole('alert')).toBeNull();
    expect(within(rejected).queryByText('DB override')).toBeNull();
    // The unsaved choice stays editable so the admin can correct it and retry.
    expect((screen.getByLabelText('Model Claude cho Chấm Writing') as HTMLSelectElement).value).toBe('claude-haiku-5-5');
    expect((screen.getByRole('button', { name: 'Lưu lựa chọn cho Chấm Writing' }) as HTMLButtonElement).disabled).toBe(false);
    expect(api.getAdminAiModels).toHaveBeenCalledTimes(1);
  });

  it('flags stored override fields that the backend reported as invalid', async () => {
    api.getAdminAiModels.mockResolvedValueOnce(models({
      features: [
        feature('writing_grading', {
          override: {
            preferred_provider: null, anthropic_model: null, updated_at: '2026-10-26T05:01:00Z',
            updated_by: 'a1', updated_by_email: 'owner@example.com',
            invalid_fields: ['preferred_provider', 'anthropic_model'],
          },
        }),
        feature('course_writing', {
          override: {
            preferred_provider: 'gemini', anthropic_model: null, updated_at: '2026-10-26T05:01:00Z',
            updated_by: 'a1', updated_by_email: 'owner@example.com', invalid_fields: [],
          },
        }),
      ],
    }));
    render(<AdminAiPanel />);
    const flagged = await screen.findByRole('row', { name: /Chấm Writing/ });
    expect(within(flagged).getByText('Giá trị DB không hợp lệ đã bị bỏ qua: preferred_provider, anthropic_model')).toBeTruthy();
    // The ignored values never reach the controls.
    expect((screen.getByLabelText('Nhà cung cấp ưu tiên cho Chấm Writing') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Model Claude cho Chấm Writing') as HTMLSelectElement).value).toBe('');
    // An empty list is not flagged.
    expect(within(screen.getByRole('row', { name: /Soát bài tự luận/ })).queryByText(/Giá trị DB không hợp lệ/)).toBeNull();
  });

  it('labels an unavailable store and shows the server refusal when a save is attempted', async () => {
    api.getAdminAiModels.mockResolvedValueOnce(models({
      store: { status: 'unavailable', last_refreshed_at: '2026-10-26T04:00:00Z', last_error: 'APIError', ttl_seconds: 30 },
    }));
    render(<AdminAiPanel />);
    const status = await screen.findByText('Không đọc được cấu hình DB — đang dùng env/mặc định code.');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.className).toContain('is-unavailable');
    expect(screen.queryByText(/Cấu hình DB đồng bộ/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Nhà cung cấp ưu tiên cho Chấm Writing'), { target: { value: 'gemini' } });
    api.patchAdminAiModel.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), {
      status: 503,
      detail: { error_code: 'ai_override_store_unavailable', status: 'unavailable', message: 'Không lưu được lựa chọn model; cấu hình hiện tại không đổi.' },
    }));
    const save = screen.getByRole('button', { name: 'Lưu lựa chọn cho Chấm Writing' }) as HTMLButtonElement;
    // Pinned on purpose: Save stays enabled when the store is unavailable; the server refuses (503).
    // Product decision pending (PR-1926 Q1). Change this assert deliberately if Q1 decides to disable Save.
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    const row = screen.getByRole('row', { name: /Chấm Writing/ });
    expect((await within(row).findByRole('alert')).textContent).toBe('Không lưu được lựa chọn model; cấu hình hiện tại không đổi.');
    expect(within(row).queryByText('DB override')).toBeNull();
    expect(screen.getByText('Không đọc được cấu hình DB — đang dùng env/mặc định code.')).toBeTruthy();
  });

  it('labels a stale store cache distinctly from ok and unavailable', async () => {
    api.getAdminAiModels.mockResolvedValueOnce(models({
      store: { status: 'stale', last_refreshed_at: '2026-10-26T04:00:00Z', last_error: null, ttl_seconds: 30 },
    }));
    render(<AdminAiPanel />);
    const status = await screen.findByText('Bộ đệm cấu hình DB đã quá hạn — đang dùng env/mặc định code.');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.className).toContain('is-stale');
    expect(screen.queryByText(/Cấu hình DB đồng bộ/)).toBeNull();
    expect(screen.queryByText(/Không đọc được cấu hình DB/)).toBeNull();
    expect(screen.getByRole('row', { name: /Chấm Writing/ })).toBeTruthy();
  });

  it('shows store problems, permission errors and retries the models panel', async () => {
    api.getAdminAiModels.mockRejectedValueOnce(Object.assign(new Error('HTTP 403'), { status: 403 }));
    render(<AdminAiPanel />);
    expect(await screen.findByText('Không có quyền xem mục AI.')).toBeTruthy();

    api.getAdminAiModels.mockResolvedValueOnce(models({
      store: { status: 'not_migrated', last_refreshed_at: null, last_error: 'APIError', ttl_seconds: 30 },
      anthropic_key_configured: false,
      recent_changes_error: 'not_migrated',
    }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Thử lại' })[0]);
    expect(await screen.findByText('Chưa áp dụng migration 322 — đang dùng env/mặc định code.')).toBeTruthy();
    expect(screen.getByText(/Thiếu ANTHROPIC_API_KEY/)).toBeTruthy();
    expect(screen.getByText('Chưa áp dụng migration 322 — chưa có lịch sử thay đổi.')).toBeTruthy();
  });

  it('renders empty usage/failure states and switches windows with the keyboard', async () => {
    render(<AdminAiPanel />);
    expect(await screen.findByText('Chưa có lượt gọi AI trong khoảng này.')).toBeTruthy();
    expect(await screen.findByText('Không có lỗi gọi AI trong khoảng này.')).toBeTruthy();
    expect(api.getAdminAiUsage).toHaveBeenLastCalledWith('today');

    const today = screen.getByRole('tab', { name: 'Hôm nay' });
    today.focus();
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    await waitFor(() => expect(api.getAdminAiUsage).toHaveBeenLastCalledWith('7d'));
    expect(api.getAdminAiFailures).toHaveBeenLastCalledWith('7d');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '7 ngày' }));
    expect(screen.getByRole('tab', { name: '7 ngày' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    await waitFor(() => expect(api.getAdminAiUsage).toHaveBeenLastCalledWith('30d'));
  });

  it('renders usage totals, unpriced notes and failure rows in Saigon time', async () => {
    api.getAdminAiUsage.mockResolvedValue(usage({
      ...zeroTotals, calls: 12, failed_calls: 2, input_tokens: 1_005_010, output_tokens: 2_700,
      thinking_tokens: 200, cache_read_tokens: 8_000, cache_write_tokens: 1_000, cost_usd: 0.354,
      priced_calls: 7, unpriced_calls: 3, legacy_calls: 2,
    }));
    api.getAdminAiFailures.mockResolvedValue(failures({
      totals: { total: 6, retry: 0, fallback: 6, final: 0 },
      by_provider_feature: [{ provider: 'anthropic', feature: 'course_writing', total: 6, retry: 0, fallback: 6, final: 0, by_error_type: { rate_limit: 5, timeout: 1 } }],
      recent: [{ id: 9, created_at: '2026-10-26T17:30:00Z', feature: 'course_writing', provider: 'anthropic', model: 'claude-haiku-5-5', route_slot: null, attempt: null, error_type: 'rate_limit', error_code: 'rate_limited', outcome: 'fallback' }],
    }));
    render(<AdminAiPanel />);
    expect((await screen.findAllByText('$0.3540')).length).toBe(3); // totals, feature, provider
    expect(screen.getByText(/3 lượt chưa có giá/)).toBeTruthy();
    expect(screen.getByText(/2 lượt cũ được định giá lại/)).toBeTruthy();
    expect(await screen.findByText('rate_limit × 5, timeout × 1')).toBeTruthy();
    // 17:30 UTC is 00:30 the next day in Saigon.
    const time = screen.getByText(formatSaigon('2026-10-26T17:30:00Z'));
    expect(time.textContent).toContain('00:30');
    expect(time.textContent).toContain('27');
  });

  it('shows usage errors with retry and the failure-log migration state independently', async () => {
    api.getAdminAiUsage.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), {
      status: 503, detail: { error_code: 'ai_dashboard_not_migrated', message: 'Chưa áp dụng migration 322 — chưa có tổng hợp token.' },
    }));
    api.getAdminAiFailures.mockResolvedValue(failures({ store_status: 'not_migrated' }));
    render(<AdminAiPanel />);
    expect(await screen.findByText('Chưa áp dụng migration 322 — chưa có tổng hợp token.')).toBeTruthy();
    expect(await screen.findByText('Chưa áp dụng migration 322 — chưa có nhật ký lỗi gọi AI.')).toBeTruthy();
    // The models panel is unaffected by the usage failure.
    expect(screen.getByRole('row', { name: /Chấm Writing/ })).toBeTruthy();

    fireEvent.click(within(screen.getByRole('region', { name: /Token và chi phí/ })).getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Chưa có lượt gọi AI trong khoảng này.')).toBeTruthy();
  });

  it('turns malformed or empty bodies into visible errors instead of crashing', async () => {
    api.getAdminAiModels.mockResolvedValueOnce({});
    api.getAdminAiUsage.mockResolvedValueOnce({ totals: null });
    api.getAdminAiFailures.mockResolvedValueOnce([]);
    render(<AdminAiPanel />);
    await waitFor(() => expect(screen.getAllByText('Phản hồi không hợp lệ từ máy chủ.')).toHaveLength(3));
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(within(screen.getByRole('region', { name: 'Model đang dùng theo tính năng' })).getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('row', { name: /Chấm Writing/ })).toBeTruthy();
  });

  it('serializes saves so an older full response cannot overwrite a newer one', async () => {
    render(<AdminAiPanel />);
    fireEvent.change(await screen.findByLabelText('Nhà cung cấp ưu tiên cho Chấm Writing'), { target: { value: 'gemini' } });
    fireEvent.change(screen.getByLabelText('Nhà cung cấp ưu tiên cho Soát bài tự luận theo buổi'), { target: { value: 'gemini' } });
    const pending = deferred<AdminAiModelsWire>();
    api.patchAdminAiModel.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lựa chọn cho Chấm Writing' }));

    const other = screen.getByRole('button', { name: 'Lưu lựa chọn cho Soát bài tự luận theo buổi' }) as HTMLButtonElement;
    expect(other.disabled).toBe(true);
    fireEvent.click(other);
    expect(api.patchAdminAiModel).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Nhà cung cấp ưu tiên cho Soát bài tự luận theo buổi') as HTMLSelectElement).disabled).toBe(true);

    await act(async () => pending.resolve(models()));
    // Once settled, the other row's unsaved choice is still there and can be saved.
    expect((screen.getByLabelText('Nhà cung cấp ưu tiên cho Soát bài tự luận theo buổi') as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByLabelText('Nhà cung cấp ưu tiên cho Soát bài tự luận theo buổi') as HTMLSelectElement).value).toBe('gemini');
    expect((screen.getByRole('button', { name: 'Lưu lựa chọn cho Soát bài tự luận theo buổi' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a routing note and disables controls for a feature that bypasses the router', async () => {
    api.getAdminAiModels.mockResolvedValueOnce(models({
      features: [feature('course_writing', {
        allowed_providers: [],
        routing_note: 'LISTENING_AUDIT_MODEL=claude-sonnet-5 được gọi trực tiếp, không qua ai_router; lựa chọn ưu tiên không áp dụng.',
      })],
    }));
    render(<AdminAiPanel />);
    expect(await screen.findByText(/được gọi trực tiếp, không qua ai_router/)).toBeTruthy();
    expect((screen.getByLabelText('Nhà cung cấp ưu tiên cho Soát bài tự luận theo buổi') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Model Claude cho Soát bài tự luận theo buổi') as HTMLSelectElement).disabled).toBe(true);
  });

  it('keeps an unsaved selection on another row when one row is saved', async () => {
    render(<AdminAiPanel />);
    fireEvent.change(await screen.findByLabelText('Model Claude cho Soát bài tự luận theo buổi'), { target: { value: 'claude-haiku-5-5' } });
    fireEvent.change(screen.getByLabelText('Nhà cung cấp ưu tiên cho Chấm Writing'), { target: { value: 'gemini' } });
    api.patchAdminAiModel.mockResolvedValueOnce(models());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lựa chọn cho Chấm Writing' }));
    await waitFor(() => expect(api.patchAdminAiModel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByLabelText('Nhà cung cấp ưu tiên cho Chấm Writing') as HTMLSelectElement).value).toBe(''));
    expect((screen.getByLabelText('Model Claude cho Soát bài tự luận theo buổi') as HTMLSelectElement).value).toBe('claude-haiku-5-5');
    expect((screen.getByRole('button', { name: 'Lưu lựa chọn cho Soát bài tự luận theo buổi' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
