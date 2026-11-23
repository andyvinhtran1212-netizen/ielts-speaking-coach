'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// ADMINIA-0074 FR-073: "Tạo lỗi thử" lives here, not in the error inbox, and
// only outside Production. The server refuses it on Production too
// (POST /admin/error-logs/test → 403), so this check only hides the button.

type TestErrorState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'refused'; text: string };

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
    let next: TestErrorState = { kind: 'sent' };
    try {
      await window.api.post('/admin/error-logs/test?error_type=exception', {});
    } catch (caught) {
      // A 5xx is the expected answer: the backend raises on purpose so the
      // global exception path records the row. 401/403 mean nothing was made.
      const status = (caught as { status?: number } | null)?.status;
      if (status === 403) next = { kind: 'refused', text: 'Máy chủ từ chối: không tạo lỗi thử trên Production, hoặc tài khoản không có quyền admin.' };
      else if (status === 401) next = { kind: 'refused', text: 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.' };
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
        {state.kind === 'sent' && (
          <p className="aqa-status" role="status">
            Đã gửi lỗi thử. Mở <Link href="/admin/error-logs">Báo lỗi</Link> sau vài giây để thấy dòng &ldquo;Thử nghiệm&rdquo;.
          </p>
        )}
        {state.kind === 'refused' && <p className="aqa-status is-error" role="alert">{state.text}</p>}
      </section>
    </main>
  );
}
