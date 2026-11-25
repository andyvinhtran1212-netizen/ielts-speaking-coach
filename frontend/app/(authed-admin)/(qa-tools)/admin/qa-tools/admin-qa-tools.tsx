'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// ADMINIA-0074 FR-073: "Tạo lỗi thử" lives here, not in the error inbox, and
// only outside Production. The server refuses it on Production too
// (POST /admin/error-logs/test → 403), so this check only hides the button.

type TestErrorState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'received'; status: number }
  | { kind: 'failed'; text: string };

/**
 * What the admin is told after the POST. The transport cannot tell the
 * backend's deliberate 500 from any other 5xx, so a 5xx only says "the
 * server answered N, check the inbox" — never "created". Everything else
 * (no answer at all, 401/403, another 4xx, or an unexpected 2xx) says that
 * no test error was confirmed.
 */
export function testErrorOutcome(caught: unknown, resolved: boolean): TestErrorState {
  if (resolved) {
    return { kind: 'failed', text: 'Máy chủ trả về thành công thay vì lỗi 500 như dự kiến, nên không xác nhận được lỗi thử. Kiểm tra Báo lỗi trước khi thử lại.' };
  }
  const status = (caught as { status?: unknown } | null)?.status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status <= 0) {
    return { kind: 'failed', text: 'Không gửi được tới máy chủ (mất mạng hoặc lỗi kết nối). Không có lỗi thử nào được tạo.' };
  }
  if (status >= 500) return { kind: 'received', status };
  if (status === 403) return { kind: 'failed', text: 'Máy chủ từ chối: không tạo lỗi thử trên Production, hoặc tài khoản không có quyền admin. Không có lỗi thử nào được tạo.' };
  if (status === 401) return { kind: 'failed', text: 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại. Không có lỗi thử nào được tạo.' };
  return { kind: 'failed', text: `Máy chủ từ chối yêu cầu (HTTP ${status}). Không có lỗi thử nào được tạo.` };
}

/**
 * Whether this build may offer "Tạo lỗi thử". An unconfigured build has no
 * environment (`null`), which could be anything, so it fails closed.
 */
export function qaTestErrorAllowed(environment: unknown) {
  return typeof environment === 'string'
    && environment.trim() !== ''
    && environment.trim().toLowerCase() !== 'production';
}

function runtimeEnvironment(): unknown {
  return typeof window === 'undefined' ? null : window.__AVER_RUNTIME_CONFIG__?.environment ?? null;
}

const TOOLS = [
  {
    href: '/admin/grammar/recommend-test',
    title: 'Thử đề xuất ngữ pháp',
    text: 'Dán một câu trả lời, xem bài ngữ pháp nào được đề xuất.',
  },
  {
    href: '/admin/mock-exams/corrections',
    title: 'Sửa đáp án đề thi thử',
    text: 'Sửa đáp án sai trong đề thi thử đã có.',
  },
] as const;

export function AdminQaTools() {
  // Read after mount so the server render and the first client render agree.
  const [environment, setEnvironment] = useState<unknown>(undefined);
  const [state, setState] = useState<TestErrorState>({ kind: 'idle' });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setEnvironment(runtimeEnvironment());
    return () => { mounted.current = false; };
  }, []);

  const allowed = qaTestErrorAllowed(environment);

  const sendTestError = async () => {
    if (state.kind === 'sending' || !allowed) return;
    setState({ kind: 'sending' });
    // A 5xx is the expected answer: the backend raises on purpose so the
    // global exception path records the row.
    let next: TestErrorState;
    try {
      await window.api.post('/admin/error-logs/test?error_type=exception', {});
      next = testErrorOutcome(null, true);
    } catch (caught) {
      next = testErrorOutcome(caught, false);
    }
    if (mounted.current) setState(next);
  };

  return (
    <main className="aqa-shell">
      <header className="aqa-header">
        <p className="aqa-eyebrow">Hệ thống</p>
        <h1>Công cụ QA</h1>
        <p className="aqa-subtitle">Công cụ nội bộ để kiểm tra hệ thống. Học viên không thấy trang này.</p>
      </header>

      <section className="aqa-section" aria-labelledby="aqa-tools-title">
        <h2 id="aqa-tools-title">Công cụ kiểm tra</h2>
        <ul className="aqa-list">
          {TOOLS.map((tool) => (
            <li key={tool.href}>
              <Link href={tool.href} className="aqa-card">
                <strong>{tool.title}</strong>
                <span>{tool.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="aqa-section" aria-labelledby="aqa-test-error-title">
        <h2 id="aqa-test-error-title">Tạo lỗi thử</h2>
        <p className="aqa-text">
          Gửi một lỗi giả lên máy chủ để kiểm tra đường ghi lỗi. Lỗi hiện trong <Link href="/admin/error-logs">Báo lỗi</Link> với nhãn &ldquo;Thử nghiệm&rdquo;.
        </p>
        {environment === undefined ? null : allowed ? (
          <div className="aqa-actions">
            <button type="button" className="btn-secondary" disabled={state.kind === 'sending'} onClick={() => void sendTestError()}>
              {state.kind === 'sending' ? 'Đang tạo…' : 'Tạo lỗi thử'}
            </button>
          </div>
        ) : (
          <p className="aqa-note" role="note">
            {typeof environment === 'string' && environment.trim().toLowerCase() === 'production'
              ? 'Không có trên Production.'
              : 'Chưa xác định được môi trường của bản này nên nút được ẩn.'}
          </p>
        )}
        {state.kind === 'received' && (
          <p className="aqa-status" role="status">
            Máy chủ trả lỗi {state.status} như dự kiến. Mở <Link href="/admin/error-logs">Báo lỗi</Link> sau vài giây và kiểm tra có dòng &ldquo;Thử nghiệm&rdquo; mới. Không thấy dòng nào nghĩa là đường ghi lỗi chưa chạy.
          </p>
        )}
        {state.kind === 'failed' && <p className="aqa-status is-error" role="alert">{state.text}</p>}
      </section>
    </main>
  );
}
