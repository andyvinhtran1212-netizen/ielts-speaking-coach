import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/admin-grammar-revision.json';
import sourceFixture from '../fixtures/grammar-exact-form-banks.json';
import type { RevisionCode } from '@/lib/admin-grammar-revision-model';
import { AdminGrammarRevision } from '@/app/(authed-admin-vocab)/admin/vocab/quiz/admin-grammar-revision';
import { AdminVocabQuizImport } from '@/app/(authed-admin-vocab)/admin/vocab/quiz/admin-vocab-quiz-import';

const context = vi.hoisted(() => ({ actor: '11111111-1111-4111-8111-111111111111', params: new URLSearchParams('skill_area=grammar') }));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: context.actor, role: 'admin' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => context.params }));
vi.mock('client-only', () => ({}));

const clone = structuredClone;
const row = fixture.rows[0];
const source = (code = row.code) => sourceFixture.banks.find((b) => b.code === code)!.raw_source;
const file = (code = row.code) => new File([source(code)], `${code}.md`, { type: 'text/markdown' });
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (v: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const error = (status: number) => Object.assign(new Error('backend error'), { status });
// Transport stubs deliberately admit arbitrary JSON so negative responses are
// tested at the real component's runtime guards, without a fabricated model.
let get: ReturnType<typeof vi.fn<(path: string, headers?: unknown, options?: unknown) => Promise<any>>>;
let post: ReturnType<typeof vi.fn<(path: string, body: Record<string, unknown>, headers?: unknown, options?: unknown) => Promise<any>>>;
let upload: ReturnType<typeof vi.fn<(path: string, body?: FormData) => Promise<any>>>;
let selected: typeof row;
let committed: boolean;
let calls: { method: string; path: string; body?: unknown }[];
const observeNavigation = () => {
  const actualWindow = window; const redirects: string[] = [];
  const location = { get href() { return actualWindow.location.href; }, set href(value: string) { redirects.push(value); } };
  vi.stubGlobal('window', new Proxy(actualWindow, { get(target, key) { return key === 'location' ? location : Reflect.get(target, key, target); } }));
  return redirects;
};

beforeEach(() => {
  context.actor = fixture.actor; context.params = new URLSearchParams('skill_area=grammar');
  vi.stubGlobal('crypto', webcrypto);
  selected = clone(row); committed = false; calls = [];
  get = vi.fn(async (path: string) => {
    calls.push({ method: 'GET', path });
    const code = decodeURIComponent(path.split('/').at(-1)!);
    const item = code === selected.code ? selected : fixture.rows.find((r) => r.code === code)!;
    if (!item) throw error(404);
    return clone(committed && code === selected.code ? item.ack.canonical : item.read);
  });
  post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    calls.push({ method: 'POST', path, body: clone(body) });
    if (path.endsWith('/preview')) return clone(selected.preview);
    committed = true;
    return { ...clone(selected.ack), operation_id: body.operation_id };
  });
  upload = vi.fn();
  window.api = { getWith: get, postWith: post, get, post, upload, delete: vi.fn() } as unknown as typeof window.api;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function chooseSource(code = row.code) {
  fireEvent.change(screen.getByLabelText('File nguồn UTF-8 đã duyệt'), { target: { files: [file(code)] } });
  await waitFor(() => expect((screen.getByLabelText('Nguồn Markdown Grammar') as HTMLTextAreaElement).value).toBe(source(code)));
}
async function preview() {
  await screen.findByText(/Nguồn gốc chưa được sửa/);
  await chooseSource();
  fireEvent.click(screen.getByRole('button', { name: 'Xem trước bản sửa Grammar' }));
  await screen.findByText('Diff đã được backend xác minh');
}
function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra và xác nhận bản sửa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo bản sửa' }));
}
const commitCalls = () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/commit'));

describe('account-owned Grammar revision console', () => {
  it('Safari without randomUUID commits a secure operation and verifies its canonical receipt', async () => {
    vi.stubGlobal('crypto', { subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    render(<AdminGrammarRevision />); await preview(); confirm();
    await screen.findByText('Receipt đã đối chiếu canonical');
    expect(commitCalls()).toHaveLength(1);
    expect((commitCalls()[0].body as { operation_id: string }).operation_id)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('actual local PG/ASGI public wire uses exact captured preview/commit body and explicit same-operation replay', async () => {
    const captured = fixture.actual_admin_capture;
    const [initial, checked, applied, replayed, current] = captured.requests;
    const operation = applied.request_without_source!.operation_id!;
    const code = captured.canonical_code;
    context.actor = captured.actor_id;
    vi.stubGlobal('crypto', { subtle: webcrypto.subtle, randomUUID: () => operation });
    const originalGet = get.getMockImplementation()!;
    get.mockImplementation(async (path: string) => {
      if (!path.endsWith(code)) return originalGet(path);
      calls.push({ method: 'GET', path });
      return clone(committed ? current.response : initial.response);
    });
    let writes = 0;
    post.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      calls.push({ method: 'POST', path, body: clone(body) });
      if (path.endsWith('/preview')) {
        expect(body).toEqual({ source_markdown: source(code), ...checked.request_without_source });
        return clone(checked.response);
      }
      expect(body).toEqual({ source_markdown: source(code), ...applied.request_without_source });
      committed = true;
      if (++writes === 1) throw new Error('captured applied receipt deliberately withheld');
      return clone(replayed.response);
    });
    const view = render(<AdminGrammarRevision />);
    fireEvent.change(screen.getByLabelText('Nguồn Grammar đã duyệt'), { target: { value: code } });
    await screen.findByText(/Nguồn gốc chưa được sửa/);
    await chooseSource(code);
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước bản sửa Grammar' }));
    await screen.findByText('Diff đã được backend xác minh'); confirm();
    await screen.findByRole('button', { name: 'Khôi phục bằng cùng mã và nội dung' });
    expect(commitCalls()).toHaveLength(1);
    expect(screen.getByText(/Tải lại trang sẽ mất lệnh đang chờ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục bằng cùng mã và nội dung' }));
    await screen.findByText('Receipt đã đối chiếu canonical');
    expect(commitCalls()).toHaveLength(2); expect(commitCalls()[1].body).toEqual(commitCalls()[0].body);
    expect(screen.getByText(replayed.response.original_history_sha256!)).toBeTruthy();
    // A new mounted workspace reads canonical truth only; it cannot claim the
    // prior command's receipt without carrying that command identity.
    view.unmount(); render(<AdminGrammarRevision />);
    fireEvent.change(screen.getByLabelText('Nguồn Grammar đã duyệt'), { target: { value: code } });
    await screen.findByText(/Nguồn đã có bản sửa/);
    expect(screen.queryByText('Receipt đã đối chiếu canonical')).toBeNull();
    expect(commitCalls()).toHaveLength(2);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Xem trước bản sửa Grammar' }).disabled).toBe(true);
  });

  it('passive mount/StrictMode reads only; explicit preview, cancel/focus, one commit and strict GET readback', async () => {
    render(<StrictMode><AdminGrammarRevision /></StrictMode>);
    await screen.findByText(/Nguồn gốc chưa được sửa/);
    expect(post).not.toHaveBeenCalled();
    await preview();
    const opener = screen.getByRole('button', { name: 'Kiểm tra và xác nhận bản sửa' });
    opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    const first = within(dialog).getByRole('button', { name: 'Đóng' });
    const last = within(dialog).getByRole('button', { name: 'Xác nhận tạo bản sửa' });
    last.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(first);
    first.focus(); fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
    expect(commitCalls()).toHaveLength(0);
    confirm();
    await screen.findByText('Receipt đã đối chiếu canonical');
    expect(commitCalls()).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Đọc lại trạng thái Grammar' })));
    expect(calls.at(-1)?.method).toBe('GET');
    expect((commitCalls()[0].body as Record<string, unknown>).source_markdown).toBe(source());
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Nguồn Markdown Grammar' }).readOnly).toBe(true);
    expect(screen.getByText(/Fingerprint lịch sử là chứng cứ lúc sửa/)).toBeTruthy();
  });

  it('lost commit ACK has no automatic retry and explicit recovery keeps identical UUID and payload', async () => {
    let attempts = 0;
    post.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      calls.push({ method: 'POST', path, body: clone(body) });
      if (path.endsWith('/preview')) return clone(selected.preview);
      committed = true;
      if (++attempts === 1) throw new Error('ACK lost after commit');
      return { ...clone(selected.ack), operation_id: body.operation_id, outcome: 'already_applied' };
    });
    render(<AdminGrammarRevision />); await preview(); confirm();
    const recovery = await screen.findByRole('button', { name: 'Khôi phục bằng cùng mã và nội dung' });
    await waitFor(() => expect(document.activeElement).toBe(recovery));
    expect(commitCalls()).toHaveLength(1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Đọc lại trạng thái Grammar' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục bằng cùng mã và nội dung' }));
    await screen.findByText('Receipt đã đối chiếu canonical');
    expect(commitCalls()).toHaveLength(2); expect(commitCalls()[1].body).toEqual(commitCalls()[0].body);
    expect(screen.getByText(/Thao tác đã được áp dụng trước đó/)).toBeTruthy();
  });

  it('ACK then failed readback retains receipt; explicit retry is GET only', async () => {
    let rejectReadback = true;
    const originalGet = get.getMockImplementation()!;
    get.mockImplementation(async (path: string) => { if (committed && rejectReadback) { calls.push({ method: 'GET', path }); throw error(503); } return originalGet(path); });
    render(<AdminGrammarRevision />); await preview(); confirm();
    await screen.findByText('Receipt đã nhận; đọc lại chưa xác nhận');
    expect(screen.queryByText('Receipt đã đối chiếu canonical')).toBeNull(); expect(commitCalls()).toHaveLength(1);
    expect(screen.queryByText(/Nguồn gốc chưa được sửa/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đối soát receipt bằng cùng mã và nội dung' })).toBeNull();
    rejectReadback = false;
    fireEvent.click(screen.getByRole('button', { name: 'Đọc lại canonical sau ACK' }));
    await screen.findByText('Receipt đã đối chiếu canonical'); expect(commitCalls()).toHaveLength(1);
  });

  it.each([404, 409, 422])('definitive commit %s permits explicit discard + canonical GET + fresh preview before a new command', async (status) => {
    let writes = 0;
    const originalPost = post.getMockImplementation()!;
    post.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (!path.endsWith('/commit') || ++writes > 1) return originalPost(path, body);
      calls.push({ method: 'POST', path, body: clone(body) }); throw error(status);
    });
    render(<AdminGrammarRevision />); await preview(); confirm();
    const first = clone(commitCalls()[0].body as Record<string, unknown>);
    await screen.findByRole('button', { name: 'Bỏ lệnh bị từ chối và đọc lại trạng thái' });
    expect(commitCalls()).toHaveLength(1);
    selected.read.revision = 'b'.repeat(64); selected.preview.canonical = clone(selected.read);
    selected.preview.preview_fingerprint = 'c'.repeat(64); selected.preview.proposed_revision = 'd'.repeat(64);
    selected.ack.canonical.current_bank_revision = selected.preview.proposed_revision;
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lệnh bị từ chối và đọc lại trạng thái' }));
    await screen.findByText(/Nguồn gốc chưa được sửa/);
    expect(calls.at(-1)?.method).toBe('GET'); expect(commitCalls()).toHaveLength(1);
    expect(screen.queryByText('Diff đã được backend xác minh')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước bản sửa Grammar' }));
    await screen.findByText('Diff đã được backend xác minh'); confirm();
    await screen.findByText('Receipt đã đối chiếu canonical');
    const second = commitCalls()[1].body as Record<string, unknown>;
    expect(second.operation_id).not.toBe(first.operation_id);
    expect(second.expected_revision).toBe(selected.read.revision);
    expect(second.preview_fingerprint).toBe(selected.preview.preview_fingerprint);
  });

  it('unknown commit503 remains frozen, while409 after a valid ACK remains GET-only readback recovery', async () => {
    const originalPost = post.getMockImplementation()!;
    post.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (!path.endsWith('/commit')) return originalPost(path, body);
      calls.push({ method: 'POST', path, body: clone(body) }); throw error(503);
    });
    const view = render(<AdminGrammarRevision />); await preview(); confirm();
    await screen.findByRole('button', { name: 'Khôi phục bằng cùng mã và nội dung' });
    expect(screen.queryByRole('button', { name: 'Bỏ lệnh bị từ chối và đọc lại trạng thái' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Đọc lại trạng thái Grammar' }).disabled).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('File nguồn UTF-8 đã duyệt').disabled).toBe(true);
    view.unmount(); post.mockImplementation(originalPost);
    const originalGet = get.getMockImplementation()!;
    get.mockImplementation(async (path: string) => { if (committed) throw error(409); return originalGet(path); });
    render(<AdminGrammarRevision />); await preview(); confirm();
    await screen.findByText('Receipt đã nhận; đọc lại chưa xác nhận');
    expect(screen.getByRole('button', { name: 'Đọc lại canonical sau ACK' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bỏ lệnh bị từ chối và đọc lại trạng thái' })).toBeNull();
  });

  it('malformed ACK never claims success and retains the same frozen operation for explicit reconciliation', async () => {
    const originalPost = post.getMockImplementation()!;
    post.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      const result = await originalPost(path, body);
      return path.endsWith('/commit') ? { ...result, operation_id: fixture.actor } : result;
    });
    render(<AdminGrammarRevision />); await preview(); confirm();
    await screen.findByRole('button', { name: 'Khôi phục bằng cùng mã và nội dung' });
    expect(screen.queryByText('Receipt đã đối chiếu canonical')).toBeNull(); expect(commitCalls()).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1);
  });

  it('busy confirmation refuses duplicate actions and Escape while the single request is pending', async () => {
    const held = deferred<unknown>(); const originalPost = post.getMockImplementation()!;
    post.mockImplementation(async (path: string, body: Record<string, unknown>) => path.endsWith('/commit')
      ? (calls.push({ method: 'POST', path, body: clone(body) }), held.promise) : originalPost(path, body));
    render(<AdminGrammarRevision />); await preview(); confirm();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đang xác nhận…' }));
    expect(commitCalls()).toHaveLength(1);
    const body = commitCalls()[0].body as Record<string, unknown>; committed = true;
    held.resolve({ ...clone(selected.ack), operation_id: body.operation_id });
    await screen.findByText('Receipt đã đối chiếu canonical');
  });

  it('authoritative-review footprint remains visible but cannot commit even with a validated source', async () => {
    selected.read.footprint.authoritative_review_required = true;
    selected.read.footprint.classifications = { unknown_reset_or_review: 1 } as unknown as typeof selected.read.footprint.classifications;
    selected.preview.canonical = clone(selected.read);
    render(<AdminGrammarRevision />); await preview();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Kiểm tra và xác nhận bản sửa' }).disabled).toBe(true);
    expect(screen.getByText(/Lịch sử chưa đủ rõ để phân loại/)).toBeTruthy(); expect(commitCalls()).toHaveLength(0);
  });

  it.each([401, 403, 404, 409, 422, 503])('canonical %s is unavailable and never displayed as empty activity', async (status) => {
    const redirects = status === 401 ? observeNavigation() : [];
    get.mockRejectedValue(error(status)); render(<AdminGrammarRevision />);
    await screen.findByRole('alert');
    expect(screen.getByText(/Số lượng lịch sử chưa xác định/)).toBeTruthy();
    expect(screen.queryByText('Người học')).toBeNull(); expect(post).not.toHaveBeenCalled();
    expect(redirects).toEqual(status === 401 ? ['/login'] : []);
  });

  it.each(['account', 'code', 'unmount'] as const)('delayed old401 after %s neither redirects nor clears the new owned workspace', async (transition) => {
    const redirects = observeNavigation(); const held = deferred<unknown>();
    const originalGet = get.getMockImplementation()!; let initial = true;
    get.mockImplementation((path: string) => { if (!initial) return originalGet(path); initial = false; calls.push({method:'GET',path}); return held.promise; });
    const view = render(<AdminGrammarRevision />);
    const options = get.mock.calls[0][2] as { signal: AbortSignal; noRedirect: boolean };
    expect(options.noRedirect).toBe(true);
    if (transition === 'account') { context.actor = '33333333-3333-4333-8333-333333333333'; view.rerender(<AdminGrammarRevision />); }
    else if (transition === 'code') fireEvent.change(screen.getByLabelText('Nguồn Grammar đã duyệt'), { target: { value: fixture.rows[1].code } });
    else view.unmount();
    if (transition !== 'unmount') await screen.findByText(/Nguồn gốc chưa được sửa/);
    expect(options.signal.aborted).toBe(true);
    await act(async () => { held.reject(error(401)); });
    expect(redirects).toEqual([]); expect(screen.queryByText(/Phiên đăng nhập không còn hợp lệ/)).toBeNull();
    if (transition !== 'unmount') expect(screen.getByText('Người học')).toBeTruthy();
  });

  it('malformed footprint and already-managed source refuse cutover instead of offering a second revision', async () => {
    get.mockResolvedValue({ ...row.read, footprint: null });
    const view = render(<AdminGrammarRevision />); await screen.findByRole('alert');
    expect(screen.queryByText('Người học')).toBeNull(); view.unmount();
    get.mockResolvedValue(clone(row.ack.canonical)); render(<AdminGrammarRevision />);
    await screen.findByText(/Nguồn đã có bản sửa/); await chooseSource();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Xem trước bản sửa Grammar' }).disabled).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it('changing code/file discards a held old preview, without dispatching an automatic new preview', async () => {
    const held = deferred<unknown>(); post.mockImplementation((path: string, body: unknown) => { calls.push({ method: 'POST', path, body }); return held.promise; });
    const view = render(<AdminGrammarRevision />); await screen.findByText(/Nguồn gốc chưa được sửa/); await chooseSource();
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước bản sửa Grammar' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const next = fixture.rows[1]; view.rerender(<AdminGrammarRevision imported={{ code: next.code as RevisionCode, file: file(next.code) }} />);
    await waitFor(() => expect((screen.getByLabelText('Nguồn Markdown Grammar') as HTMLTextAreaElement).value).toBe(source(next.code)));
    held.resolve(clone(row.preview));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Xem trước bản sửa Grammar' }).disabled).toBe(false));
    expect(screen.queryByText('Diff đã được backend xác minh')).toBeNull(); expect(post).toHaveBeenCalledTimes(1);
  });

  it('source changes before awaited SHA completes fence the old preview before any POST', async () => {
    const held = deferred<ArrayBuffer>();
    vi.stubGlobal('crypto', { subtle: { digest: () => held.promise }, randomUUID: () => fixture.operation_id });
    const view = render(<AdminGrammarRevision />); await screen.findByText(/Nguồn gốc chưa được sửa/); await chooseSource();
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước bản sửa Grammar' }));
    const next = fixture.rows[1]; view.rerender(<AdminGrammarRevision imported={{ code: next.code as RevisionCode, file: file(next.code) }} />);
    await waitFor(() => expect((screen.getByLabelText('Nguồn Markdown Grammar') as HTMLTextAreaElement).value).toBe(source(next.code)));
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(source()));
    await act(async () => { held.resolve(digest); });
    expect(post).not.toHaveBeenCalled(); expect(screen.queryByText('Diff đã được backend xác minh')).toBeNull();
  });

  it.each(['account', 'unmount', 'import-source'] as const)('held commit ACK after %s cannot dispatch readback or expose old receipt', async (change) => {
    const held = deferred<unknown>(); const originalPost = post.getMockImplementation()!;
    post.mockImplementation((path: string, body: Record<string, unknown>) => path.endsWith('/commit')
      ? (calls.push({ method: 'POST', path, body: clone(body) }), held.promise) : originalPost(path, body));
    const view = render(<AdminGrammarRevision />); await preview(); confirm();
    const before = calls.filter((c) => c.method === 'GET').length;
    if (change === 'account') { context.actor = '33333333-3333-4333-8333-333333333333'; view.rerender(<AdminGrammarRevision />); }
    else if (change === 'unmount') view.unmount();
    else view.rerender(<AdminGrammarRevision imported={{ code: row.code as RevisionCode, file: new File([source() + '\n'], 'another-source.md') }} />);
    const expectedReads = change === 'unmount' ? before : before + 1;
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(expectedReads));
    const body = commitCalls()[0].body as Record<string, unknown>;
    await act(async () => { held.resolve({ ...clone(row.ack), operation_id: body.operation_id }); });
    await waitFor(() => expect(screen.queryByText('Receipt đã đối chiếu canonical')).toBeNull());
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(expectedReads); expect(commitCalls()).toHaveLength(1);
  });

  it('raw malformed or oversized UTF-8 file never sends a source preview', async () => {
    render(<AdminGrammarRevision />); await screen.findByText(/Nguồn gốc chưa được sửa/);
    fireEvent.change(screen.getByLabelText('File nguồn UTF-8 đã duyệt'), { target: { files: [new File([new Uint8Array([0xff])], 'invalid.md')] } });
    await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('File nguồn UTF-8 đã duyệt'), { target: { files: [new File(['a'.repeat(262145)], 'large.md')] } });
    await screen.findByText(/File cần chứa/); expect(post).not.toHaveBeenCalled();
  });

  it('commit permission loss clears private source/operation; conflicting canonical readback never claims success', async () => {
    const originalPost = post.getMockImplementation()!;
    post.mockImplementation(async (path: string, body: Record<string, unknown>) => path.endsWith('/commit') ? Promise.reject(error(403)) : originalPost(path, body));
    const view = render(<AdminGrammarRevision />); await preview(); confirm();
    await screen.findByText(/Tài khoản hiện tại không có quyền sửa Grammar/);
    expect(screen.queryByRole('button', { name: 'Khôi phục bằng cùng mã và nội dung' })).toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Nguồn Markdown Grammar' }).value).toBe('');
    view.unmount(); post.mockImplementation(originalPost);
    const originalGet = get.getMockImplementation()!;
    get.mockImplementation(async (path: string) => {
      const result = await originalGet(path);
      return committed ? { ...result, revision: 'e'.repeat(64) } : result;
    });
    render(<AdminGrammarRevision />); await preview(); confirm();
    await screen.findByText('Receipt đã nhận; canonical hiện tại khác');
    expect(screen.queryByText('Receipt đã đối chiếu canonical')).toBeNull();
    expect(screen.getByRole('button', { name: 'Đọc lại canonical sau ACK' })).toBeTruthy();
  });

  it('fresh paused canonical drift is displayed without verified success; explicit same-tuple receipt reconciliation then GET is supported', async () => {
    const originalGet = get.getMockImplementation()!;
    get.mockImplementation(async (path: string) => {
      const value = await originalGet(path);
      return committed ? { ...value, revision: 'd'.repeat(64), new_starts_enabled: false } : value;
    });
    render(<AdminGrammarRevision />); await preview(); confirm();
    await screen.findByText('Receipt đã nhận; canonical hiện tại khác');
    expect(screen.getByText(/Nguồn đã có bản sửa/)).toBeTruthy();
    expect(screen.getByText(/Lượt bắt đầu mới đang tạm ngừng/)).toBeTruthy();
    expect(screen.queryByText('Receipt đã đối chiếu canonical')).toBeNull(); expect(commitCalls()).toHaveLength(1);
    const first = clone(commitCalls()[0].body);
    selected.ack.outcome = 'already_applied' as typeof selected.ack.outcome;
    selected.ack.current_revision = 'd'.repeat(64); selected.ack.current_matches_committed = false;
    selected.ack.canonical.revision = 'd'.repeat(64); selected.ack.canonical.new_starts_enabled = false;
    fireEvent.click(screen.getByRole('button', { name: 'Đối soát receipt bằng cùng mã và nội dung' }));
    await screen.findByText('Receipt đã đối chiếu canonical');
    expect(commitCalls()).toHaveLength(2); expect(commitCalls()[1].body).toEqual(first);
    expect(calls.at(-1)?.method).toBe('GET');
    expect(screen.getByText(/Tại thời điểm ACK, revision đã khác receipt/)).toBeTruthy();
  });
});

describe('existing general-import ownership', () => {
  function installGeneric(skill: 'grammar' | 'vocab', code: string) {
    const candidate = fixture.rows.find((item) => item.code === code) ?? row;
    const bank = sourceFixture.banks.find((item) => item.code === code) ?? sourceFixture.banks[0];
    const topic = { id: candidate.read.topic_id, slug: 'synthetic-topic', title: 'Synthetic topic', title_vi: null, description: null, order: 1, is_published: true, skill_area: skill };
    const result = { dry_run: true, meta: { code, title: 'Synthetic bank', skill_area: skill }, questions: bank.questions.map((q, index) => ({ index, qid: q.qid, item_key: q.item_key, type: q.type, skill: q.skill, validation_errors: [] })), validation_errors: [], summary: { words: 4, questions: bank.questions.length, errors: 0, pools: 4 }, committed_bank_id: null as string | null };
    context.params = new URLSearchParams(skill === 'grammar' ? 'skill_area=grammar' : '');
    get.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/content-topics')) return [topic];
      if (path.startsWith('/admin/quiz/banks')) return committed ? [{ id: candidate.ack.corrected_bank_id, topic_id: topic.id, code, title: 'Synthetic bank', skill_area: skill, words_count: 4, is_published: true }] : [];
      const canonical = fixture.rows.find((item) => path === `/admin/quiz/grammar-revisions/${encodeURIComponent(item.code)}`);
      if (!canonical) throw error(404);
      return clone(canonical.read);
    });
    upload.mockImplementation(async (path: string) => { calls.push({ method: 'UPLOAD', path }); if (path.includes('dry_run=false')) { committed = true; return { ...result, dry_run: false, committed_bank_id: candidate.ack.corrected_bank_id }; } return result; });
  }
  it.each(fixture.rows)('reviewed Grammar $code is directed to its revision and never generic commit-ready', async (candidate) => {
    installGeneric('grammar', candidate.code); render(<AdminVocabQuizImport />);
    await screen.findByRole('option', { name: /Synthetic topic/ });
    fireEvent.change(screen.getByLabelText('Chủ đề (topic)'), { target: { value: candidate.read.topic_id } });
    const genericFile = screen.getByText('File Markdown').closest('label')!.querySelector('input')!;
    fireEvent.change(genericFile, { target: { files: [file(candidate.code)] } });
    await screen.findByText(/Dùng phần Xem trước và xác nhận/);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Lưu vào hệ thống' }).disabled).toBe(true);
    expect(screen.queryByText(/Bank sẵn sàng được lưu/)).toBeNull();
    await waitFor(() => expect((screen.getByLabelText('Nguồn Markdown Grammar') as HTMLTextAreaElement).value).toBe(source(candidate.code)));
    expect((screen.getByLabelText('Nguồn Grammar đã duyệt') as HTMLSelectElement).value).toBe(candidate.code);
    const currentBank = (await screen.findByText('Bank hiện hành')).closest('p')!;
    expect(within(currentBank).getByText(candidate.read.current_bank_id)).toBeTruthy();
    expect(upload).toHaveBeenCalledTimes(1); expect(post).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.method === 'UPLOAD' && call.path.includes('dry_run=false'))).toHaveLength(0);
  });
  it.each(['vocab', 'grammar'] as const)('unreviewed %s generic import keeps its existing canonical commit flow', async (skill) => {
    installGeneric(skill, skill === 'grammar' ? 'G-unmanaged-other' : 'V-existing'); render(<AdminVocabQuizImport />);
    await screen.findByRole('option', { name: /Synthetic topic/ });
    fireEvent.change(screen.getByLabelText('Chủ đề (topic)'), { target: { value: row.read.topic_id } });
    fireEvent.change(screen.getByText('File Markdown').closest('label')!.querySelector('input')!, { target: { files: [file()] } });
    await screen.findByText('Dry-run hợp lệ. Bank sẵn sàng được lưu.');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vào hệ thống' }));
    await screen.findByText(/Đã lưu bank/);
    expect(upload).toHaveBeenCalledTimes(2); expect(post).not.toHaveBeenCalled();
  });
});
