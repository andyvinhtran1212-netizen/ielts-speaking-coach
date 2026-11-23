'use client';

// /account/orders: "Đơn đăng ký của tôi" (ENROLL-0060 FR-041, sheet ThanhToan
// screen 7). Reads G04's `GET /api/enrollment-orders/me` (#2526), newest
// first, 20 a page, "Xem thêm" while `next_cursor` is set. One table on
// desktop; below 768 px each row is a card with the short title. Every row has
// exactly one next step (FR-041), linked only when its page is live, so no row
// points at a planned page. No empty table: an empty list is its own state.
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { PageState } from '@/components/ui/page-state';
import { liveHref } from '@/components/ui/shell/learner-sections';
import {
  formatVnd,
  normalizeOrderPage,
  orderDateText,
  orderNextStep,
  orderStatusLabel,
  type OrderRow,
} from '@/lib/orders-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './orders.module.css';

const PAGE = 20;
const resolve = (href: string) => liveHref({ href, today: null });
const COURSES = resolve('/courses');
const ACTIVATE = resolve('/activate');

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: OrderRow[]; nextCursor: string | null; more: 'idle' | 'loading' | 'error' };

async function readPage(cursor: string | null, signal?: AbortSignal) {
  const query = `limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  try {
    const data = await window.api.getWith<unknown>(`/api/enrollment-orders/me?${query}`, undefined, signal ? { signal } : undefined);
    return normalizeOrderPage(data);
  } catch {
    return null;
  }
}

function NextStep({ order }: { order: OrderRow }) {
  const step = orderNextStep(order, resolve);
  if (!step?.href) return null;
  return <a className={styles.action} href={step.href}>{step.label}</a>;
}

export function OrdersPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const alive = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    alive.current = abort;
    setState({ kind: 'loading' });
    (async () => {
      const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (orders)');
      if (abort.signal.aborted) return;
      const page = ok ? await readPage(null, abort.signal) : null;
      if (abort.signal.aborted) return;
      setState(page ? { kind: 'ready', items: page.items, nextCursor: page.nextCursor, more: 'idle' } : { kind: 'error' });
    })();
    return () => abort.abort();
  }, [attempt]);

  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready' || !state.nextCursor || state.more === 'loading') return;
    const signal = alive.current?.signal;
    setState({ ...state, more: 'loading' });
    const page = await readPage(state.nextCursor, signal);
    if (signal?.aborted) return;
    setState(page
      ? { kind: 'ready', items: [...state.items, ...page.items], nextCursor: page.nextCursor, more: 'idle' }
      : { ...state, more: 'error' });
  }, [state]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Tài khoản</p>
        <h1 className={styles.title}>Đơn đăng ký của tôi</h1>
      </header>

      {state.kind === 'loading' ? <PageState kind="loading" title="Đang tải đơn đăng ký…" /> : null}
      {state.kind === 'error' ? (
        <PageState
          kind="error"
          title="Chưa tải được đơn đăng ký"
          body="Kết nối có thể đang chập chờn."
          action={<Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Thử lại</Button>}
        />
      ) : null}

      {state.kind === 'ready' && state.items.length === 0 ? (
        <section className={styles.empty} aria-labelledby="orders-empty-title">
          <h2 id="orders-empty-title" className={styles.emptyTitle}>Bạn chưa đăng ký khoá nào.</h2>
          {COURSES || ACTIVATE ? (
            <div className={styles.emptyActions}>
              {COURSES ? <Button variant="primary" href={COURSES}>Xem các khoá online</Button> : null}
              {ACTIVATE ? <Button variant="secondary" href={ACTIVATE}>Nhập mã kích hoạt của lớp</Button> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {state.kind === 'ready' && state.items.length > 0 ? (
        <>
          <table className={styles.table}>
            <caption className={styles.caption}>Đơn mới nhất ở trên cùng.</caption>
            <thead>
              <tr>
                <th scope="col">Khoá</th>
                <th scope="col">Mã đơn</th>
                <th scope="col">Ngày đăng ký</th>
                <th scope="col">Học phí</th>
                <th scope="col">Trạng thái</th>
                <th scope="col"><span className={styles.srOnly}>Việc tiếp theo</span></th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((order) => (
                <tr key={order.code} className={styles.row}>
                  <th scope="row" className={styles.course}>
                    <span className={order.shortTitle ? styles.full : undefined}>{order.title}</span>
                    {order.shortTitle ? <span className={styles.short}>{order.shortTitle}</span> : null}
                  </th>
                  <td data-label="Mã đơn" className={styles.code}>{order.code}</td>
                  <td data-label="Ngày đăng ký">{orderDateText(order.createdAt) ?? '—'}</td>
                  <td data-label="Học phí">{formatVnd(order.tuition) ?? '—'}</td>
                  <td data-label="Trạng thái"><span className={styles.status} data-status={order.status}>{orderStatusLabel(order.status)}</span></td>
                  <td className={styles.next}><NextStep order={order} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.nextCursor ? (
            <div className={styles.more}>
              <Button variant="secondary" onClick={loadMore} loading={state.more === 'loading'} loadingLabel="Đang tải…">
                Xem thêm
              </Button>
              {state.more === 'error' ? <p className={styles.moreError} role="alert">Chưa tải thêm được. Thử lại.</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
