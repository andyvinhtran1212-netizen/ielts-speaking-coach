'use client';

// /enroll/[orderCode]: one enrollment order (ENROLL-0060 FR-037…FR-040,
// FR-055, FR-056; sheet ThanhToan screens 2–6). Reads G04's
// `GET /api/enrollment-orders/{code}` (#2526) and shows the screen of its
// status: 2 transfer, 3 waiting (with the screen-6 block for `needs_info`),
// 4 unlocked, 5 expired or cancelled. Every action posts to G04 and shows
// the order the server returns; nothing here moves an order on its own.
//
// Not drawn yet, on purpose:
// - the VietQR image: spec 0060 open question 2 ("Cục bộ" needs a QR
//   library) is unanswered, and its fallback is the full manual block;
// - the shared contact block (G05-T23) and the `site-info.enroll` hours
//   (T02/T23): sentences that need them are left out;
// - "Học trước trong lúc chờ" (FR-057): its flag is off by default.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Notice } from '@/components/ui/notice';
import { PageState } from '@/components/ui/page-state';
import { liveHref } from '@/components/ui/shell/learner-sections';
import { TextArea } from '@/components/ui/text-area';
import { getBrowserJson, getBrowserJsonAt, postBrowserJsonAtWith } from '@/lib/browser-api';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  carryFor,
  carryText,
  dateText,
  holdHours,
  normalizeOrder,
  pollsStatus,
  rawAccountNo,
  rawAmount,
  screenFor,
  shortfall,
  vnd,
  whenText,
  type EnrollOrder,
} from '@/lib/enroll-order-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './enroll-order.module.css';

/** FR-040: ask again every 20 s while the tab is visible, at most 30 min. */
export const POLL_MS = 20_000;
export const POLL_LIMIT_MS = 30 * 60_000;
const COPIED_MS = 3_000;

const resolve = (href: string) => liveHref({ href, today: null });
const ORDERS = resolve('/account/orders') ?? '/account/orders';
const NOT_FOUND = `${ORDERS}?khong-tim-thay`;

type ApiError = { status?: number; detail?: { error_code?: string } | string };
const statusOf = (e: unknown) => (e && typeof e === 'object' ? (e as ApiError).status ?? null : null);
const codeOf = (e: unknown) => {
  const detail = e && typeof e === 'object' ? (e as ApiError).detail : null;
  return detail && typeof detail === 'object' ? detail.error_code ?? null : null;
};

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; order: EnrollOrder };
type Message = { kind: 'success' | 'warning' | 'error'; text: string } | null;

/**
 * The order hangs under a key of the signed-in account: a session change
 * or sign-out unmounts it in the same render, so another account's order
 * never stays on screen (same pattern as /account and /account/orders).
 */
export function EnrollOrderPage({ code }: { code: string }) {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id ?? null : null;
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);
  if (!accountId) {
    return (
      <div className={styles.page}>
        <PageState kind="loading" title="Đang tải đơn đăng ký…" />
      </div>
    );
  }
  return <OrderContent key={`${accountId}:${code}`} code={code} email={user?.email ?? null} />;
}

function OrderContent({ code, email }: { code: string; email: string | null }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pollStopped, setPollStopped] = useState(false);
  const [carry, setCarry] = useState<ReturnType<typeof carryFor>>(null);
  const alive = useRef<AbortController | null>(null);
  const opened = useRef(Date.now());
  // A second click before the re-render must not post twice (FR-039 idempotent anyway).
  const inFlight = useRef(false);
  const path = `/api/enrollment-orders/${encodeURIComponent(code)}`;

  const read = useCallback(async (signal: AbortSignal): Promise<EnrollOrder | 'missing' | null> => {
    try {
      const order = normalizeOrder(await getBrowserJsonAt('/api/enrollment-orders/{order_code}', path, signal));
      return order;
    } catch (error) {
      return statusOf(error) === 404 ? 'missing' : null;
    }
  }, [path]);

  const show = useCallback((order: EnrollOrder | 'missing' | null, quiet: boolean) => {
    if (order === 'missing') { window.location.replace(NOT_FOUND); return; }
    if (order) setLoad({ kind: 'ready', order });
    else if (!quiet) setLoad({ kind: 'error' });
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    alive.current = abort;
    setLoad({ kind: 'loading' });
    (async () => {
      const ok = await whenGlobalReady(() => typeof window.api?.getWith === 'function', 'window.api (enroll)');
      if (abort.signal.aborted) return;
      const order = ok ? await read(abort.signal) : null;
      if (!abort.signal.aborted) show(order, false);
    })();
    return () => abort.abort();
  }, [attempt, read, show]);

  const order = load.kind === 'ready' ? load.order : null;
  const screen = screenFor(order);

  // FR-040: screen 3 asks again while the tab is visible; a hidden tab
  // pauses it, and it stops for good 30 minutes after the page opened.
  const polling = pollsStatus(order) && !pollStopped && !busy;
  useEffect(() => {
    if (!polling) return undefined;
    let pending: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      pending?.abort();
      if (Date.now() - opened.current >= POLL_LIMIT_MS) { setPollStopped(true); return; }
      if (document.visibilityState === 'visible') {
        const request = new AbortController();
        pending = request;
        const next = await read(request.signal);
        if (request.signal.aborted) return;
        if (!inFlight.current) show(next, true);
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      pending?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [polling, read, show]);

  // FR-055: carried credits come from G04's course list, never computed here.
  const unlockedSlug = screen === 'unlocked' ? order?.slug ?? null : null;
  useEffect(() => {
    if (!unlockedSlug) return;
    const signal = alive.current?.signal;
    (async () => {
      try {
        const courses = await getBrowserJson('/api/me/courses', undefined, signal);
        if (!signal?.aborted) setCarry(carryFor(courses, unlockedSlug));
      } catch {
        if (!signal?.aborted) setCarry(null);
      }
    })();
  }, [unlockedSlug]);

  const act = useCallback(async (action: 'report-transfer' | 'supplement' | 'cancel', body: object, done?: string): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    const signal = alive.current?.signal;
    setBusy(action);
    setMessage(null);
    let ok = false;
    try {
      const reply = await postBrowserJsonAtWith(`/api/enrollment-orders/{order_code}/${action}`, `${path}/${action}`, body, { signal });
      if (signal?.aborted) return false;
      const next = normalizeOrder(reply);
      if (next) { setLoad({ kind: 'ready', order: next }); ok = true; if (done) setMessage({ kind: 'success', text: done }); }
      else setMessage({ kind: 'error', text: 'Chưa gửi được. Thử lại.' });
    } catch (error) {
      if (signal?.aborted) return false;
      if (statusOf(error) === 404) { window.location.replace(NOT_FOUND); return false; }
      if (codeOf(error) === 'invalid_transition' && signal) {
        const latest = await read(signal);
        if (signal.aborted) return false;
        show(latest, true);
        setMessage({ kind: 'warning', text: 'Đơn đăng ký này vừa đổi trạng thái. Trang đã cập nhật.' });
      } else if (codeOf(error) === 'invalid_note') {
        setMessage({ kind: 'error', text: 'Ghi chú cần ít nhất 3 ký tự.' });
      } else {
        setMessage({ kind: 'error', text: 'Chưa gửi được. Thử lại.' });
      }
    } finally {
      inFlight.current = false;
      if (!signal?.aborted) setBusy(null);
    }
    return ok;
  }, [path, read, show]);

  const cancelOpen = confirmCancel && screen === 'transfer';

  if (load.kind === 'loading') {
    return <div className={styles.page}><PageState kind="loading" title="Đang tải đơn đăng ký…" /></div>;
  }
  if (load.kind === 'error' || !order) {
    return (
      <div className={styles.page}>
        <PageState
          kind="error"
          title="Chưa tải được đơn đăng ký"
          body="Kết nối có thể đang chập chờn."
          action={<Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Thử lại</Button>}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <p className={styles.back}><a href={ORDERS}>‹ Đơn đăng ký của tôi</a></p>
      {message && !(cancelOpen && message.kind === 'error') ? <Notice kind={message.kind} live={message.kind === "error" ? "alert" : "status"} className={styles.message}>{message.text}</Notice> : null}

      {screen === 'transfer' ? (
        <TransferScreen
          order={order}
          email={email}
          busy={busy}
          onReport={() => void act('report-transfer', {})}
          onCancel={() => setConfirmCancel(true)}
        />
      ) : null}
      {screen === 'waiting' ? (
        <WaitingScreen
          order={order}
          email={email}
          busy={busy}
          pollStopped={pollStopped}
          onCheck={() => { opened.current = Date.now(); setPollStopped(false); setAttempt((n) => n + 1); }}
          onSupplement={(note) => act('supplement', { note }, 'Đã gửi phần bổ sung. Admin sẽ đối chiếu lại đơn này.')}
        />
      ) : null}
      {screen === 'unlocked' ? <UnlockedScreen order={order} email={email} carry={carry} /> : null}
      {screen === 'closed' ? (
        <ClosedScreen order={order} busy={busy} onReport={() => void act('report-transfer', {})} />
      ) : null}

      <ConfirmDialog
        open={cancelOpen}
        tone="warning"
        title={`Huỷ đơn ${order.code}?`}
        body={(
          <>
            Nếu bạn đã chuyển tiền, đừng huỷ mà báo đã chuyển.
            {message?.kind === 'error' ? <><br /><strong role="alert">{message.text}</strong></> : null}
          </>
        )}
        confirmLabel="Huỷ đơn"
        cancelLabel="Giữ đơn"
        busy={busy === 'cancel'}
        busyLabel="Đang huỷ…"
        onCancel={() => { setConfirmCancel(false); setMessage(null); }}
        onConfirm={async () => {
          // Closes only once the server took the cancel. A failed request keeps
          // the question open with the reason; a 409 that moved the order on
          // leaves screen 2, which closes it (CR #2641 nit a).
          if (await act('cancel', {})) setConfirmCancel(false);
        }}
      />
    </div>
  );
}

function Header({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className={styles.header}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </header>
  );
}

/** FR-038: copy writes the raw value and says "Đã sao chép" for 3 s. */
function CopyRow({ label, shown, raw, statusId }: { label: string; shown: string; raw?: string; statusId: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => setState('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw ?? shown);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <div className={styles.copyRow}>
      <dt>{label}</dt>
      <dd>
        <span className={styles.value}>{shown}</span>
        {raw !== undefined ? (
          <Button variant="secondary" size="sm" onClick={copy} aria-describedby={statusId}>
            {state === 'copied' ? 'Đã sao chép' : 'Sao chép'}
          </Button>
        ) : null}
        {raw !== undefined ? (
          <span id={statusId} role="status" className={styles.copyStatus}>
            {state === 'copied' ? `Đã sao chép ${label.toLowerCase()}.` : state === 'failed' ? 'Chưa sao chép được. Bạn chép tay nhé.' : ''}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function ManualTransfer({ order }: { order: EnrollOrder }) {
  const base = useId();
  const t = order.transfer;
  if (!t) {
    return (
      <Notice kind="warning" title="Chưa có thông tin chuyển khoản">
        Thông tin tài khoản nhận chưa sẵn sàng. Bạn chưa cần chuyển; quay lại trang này sau ít phút nhé.
      </Notice>
    );
  }
  return (
    <section className={styles.block} aria-labelledby={`${base}-manual`}>
      <h2 id={`${base}-manual`} className={styles.blockTitle}>Chuyển khoản theo thông tin này</h2>
      <dl className={styles.copyList}>
        {t.bankName ? <CopyRow label="Ngân hàng" shown={t.bankName} statusId={`${base}-bank`} /> : null}
        <CopyRow label="Số tài khoản" shown={t.accountNo} raw={rawAccountNo(t.accountNo)} statusId={`${base}-acct`} />
        {t.accountName ? <CopyRow label="Chủ tài khoản" shown={t.accountName} statusId={`${base}-name`} /> : null}
        <CopyRow label="Số tiền" shown={vnd(t.amount) ?? String(t.amount)} raw={rawAmount(t.amount)} statusId={`${base}-amount`} />
        <CopyRow label="Nội dung" shown={t.memo} raw={t.memo} statusId={`${base}-memo`} />
      </dl>
      <div className={styles.rules}>
        <p className={styles.rule}>Ghi đúng nội dung chuyển khoản: {t.memo}</p>
        <p>Mã đơn là cách duy nhất để biết khoản tiền này của bạn. Không thêm tên khoá, không viết tắt.</p>
        <p>Chuyển đúng học phí {vnd(t.amount)} trong một lần. Nếu ngân hàng tự thêm chữ trước hay sau mã đơn thì vẫn được.</p>
        <p>Lỡ ghi sai hoặc thiếu mã: đừng chuyển lại. Bấm &ldquo;Tôi đã chuyển khoản&rdquo; rồi làm theo hướng dẫn ở màn chờ.</p>
      </div>
    </section>
  );
}

function TransferScreen({ order, email, busy, onReport, onCancel }: {
  order: EnrollOrder; email: string | null; busy: string | null; onReport: () => void; onCancel: () => void;
}) {
  const payBy = whenText(order.payBy);
  const hours = holdHours(order);
  return (
    <>
      <Header eyebrow={`${order.title} · Thanh toán`} title={`Chuyển khoản cho đơn ${order.code}`}>
        {email ? <p className={styles.lead}>Thông tin chuyển khoản này cũng đã gửi tới {email} ngay khi tạo đơn, kèm đường dẫn quay lại trang này.</p> : null}
      </Header>
      {payBy ? (
        <p className={styles.hold}>
          <strong>Đơn đang được giữ tới {payBy}</strong>
          {hours ? ` · ${hours} giờ kể từ lúc tạo.` : '.'} Quá hạn mà chưa báo chuyển khoản thì đơn hết hạn; nếu sau đó khoản chuyển đúng mã đơn tới nơi, đơn tự mở lại.
        </p>
      ) : null}
      <ManualTransfer order={order} />
      <div className={styles.actions}>
        <Button variant="primary" onClick={onReport} loading={busy === 'report-transfer'} loadingLabel="Đang gửi…" disabled={!order.transfer}>
          Tôi đã chuyển khoản
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy !== null}>Huỷ đơn này</Button>
      </div>
      <p className={styles.note}>Bấm sau khi ngân hàng báo thành công. Nút này báo admin đối chiếu, chưa mở khoá ngay.</p>
    </>
  );
}

/** Screen 6 inside screen 3: the real numbers and what to do (FR-037). */
function NeedsInfo({ order, email, busy, onSupplement }: {
  order: EnrollOrder; email: string | null; busy: string | null; onSupplement: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const short = shortfall(order);
  const until = whenText(order.supplementBy);
  const submit = async () => {
    if (note.trim().length < 3) { setError('Ghi chú cần ít nhất 3 ký tự.'); return; }
    setError(null);
    if (await onSupplement(note.trim())) { setSent(true); setNote(''); }
  };
  let title = 'Đơn cần bạn bổ sung';
  let body: ReactNode = null;
  if (short) {
    title = 'Thiếu tiền · chưa mở khoá';
    body = (
      <>
        <p>Đã nhận {vnd(short.received)}, đơn cần {vnd(short.tuition)}, còn thiếu <strong>{vnd(short.missing)}</strong>.</p>
        <p>Chuyển thêm phần còn thiếu với cùng nội dung {order.code}{until ? ` trước ${until}` : ''}; khoá mở khi đủ.</p>
      </>
    );
  } else if (order.infoKind === 'not_found') {
    title = 'Chưa tìm thấy khoản chuyển khớp mã đơn';
    body = (
      <>
        <p>Có thể nội dung bị thiếu hoặc ghi khác {order.code}. Bạn không cần chuyển lại.</p>
        <p>Gửi số tiền, giờ chuyển và tên ngân hàng của bạn ở ô dưới đây{until ? ` trước ${until}` : ''}. Admin tìm theo các thông tin này.</p>
      </>
    );
  }
  return (
    <section className={styles.block} aria-labelledby="needs-info-title">
      <h2 id="needs-info-title" className={styles.blockTitle}>{title}</h2>
      {body}
      {order.adminMessage ? (
        <div className={styles.adminMessage}>
          <p className={styles.adminLabel}>Lời nhắn của admin</p>
          <p className={styles.verbatim}>{order.adminMessage}</p>
        </div>
      ) : null}
      {!short && order.infoKind !== 'not_found' && until ? <p>Hạn bổ sung: {until}.</p> : null}
      {email ? <p>Chúng tôi đã gửi thư tới {email}.</p> : null}
      {sent ? null : (
        <div className={styles.supplement}>
          <TextArea
            label="Bạn đã bổ sung gì?"
            hint="Ví dụ: đã chuyển thêm 200.000 đ lúc 14:30, từ ngân hàng của bạn."
            value={note}
            error={error ?? undefined}
            rows={3}
            maxLength={1000}
            onChange={(value) => setNote(value)}
          />
          <Button variant="primary" onClick={submit} loading={busy === 'supplement'} loadingLabel="Đang gửi…">Tôi đã bổ sung</Button>
        </div>
      )}
    </section>
  );
}

function WaitingScreen({ order, email, busy, pollStopped, onCheck, onSupplement }: {
  order: EnrollOrder; email: string | null; busy: string | null; pollStopped: boolean;
  onCheck: () => void; onSupplement: (note: string) => Promise<boolean>;
}) {
  const needsInfo = order.status === 'needs_info';
  const reported = whenText(order.transferReportedAt);
  return (
    <>
      <Header
        eyebrow={`${order.title} · Đơn ${order.code}`}
        title={needsInfo ? 'Đơn cần bạn bổ sung' : 'Đã ghi nhận, đang chờ xác nhận'}
      />
      {needsInfo ? (
        <NeedsInfo
          // A new admin question (message or deadline) is a new form: "sent" resets (CR #2641 nit b).
          key={`${order.adminMessage ?? ''}|${order.supplementBy ?? ''}`}
          order={order}
          email={email}
          busy={busy}
          onSupplement={onSupplement}
        />
      ) : (
        <section className={styles.block} aria-labelledby="next-title">
          <h2 id="next-title" className={styles.blockTitle}>Điều gì sẽ xảy ra</h2>
          <p>Admin đối chiếu sao kê ngân hàng: đúng học phí {vnd(order.tuition) ?? ''} và nội dung {order.code}.</p>
          <p>
            Khớp thì khoá mở ngay trên tài khoản này{email ? ` và bạn nhận email tại ${email}` : ''}. Chưa tìm thấy khoản
            chuyển hoặc số tiền lệch, chúng tôi cũng gửi thư{email ? ' tới địa chỉ này' : ''}, nói rõ bạn cần bổ sung gì.
            Bạn không cần ở lại trang này.
          </p>
          <p>Trong lúc chờ, Thư viện vẫn mở miễn phí.</p>
        </section>
      )}
      <section className={styles.block} aria-labelledby="status-title">
        <h2 id="status-title" className={styles.blockTitle}>Trạng thái đơn {order.code}</h2>
        <ul className={styles.timeline}>
          {order.createdAt ? <li>Đã tạo đơn · {whenText(order.createdAt)}</li> : null}
          {reported ? <li>Bạn báo đã chuyển khoản · {reported}</li> : null}
          <li><strong>{needsInfo ? 'Cần bổ sung' : 'Chờ xác nhận'}</strong></li>
        </ul>
        {pollStopped ? (
          <div className={styles.pollStopped}>
            <p role="status">Trang đã ngừng tự kiểm tra. Bạn không cần ở lại trang này.</p>
            <Button variant="secondary" onClick={onCheck}>Kiểm tra lại</Button>
          </div>
        ) : (
          <p className={styles.note}>Trang tự cập nhật khi admin xác nhận, không cần tải lại.</p>
        )}
      </section>
    </>
  );
}

function UnlockedScreen({ order, email, carry }: { order: EnrollOrder; email: string | null; carry: ReturnType<typeof carryFor> }) {
  const until = dateText(order.entitlementExpiresAt);
  const start = resolve('/course') ?? resolve('/home') ?? '/home';
  const carried = carryText(carry);
  return (
    <>
      <Header eyebrow={`Đơn ${order.code} · đã xác nhận`} title={`${order.title} đã mở`}>
        <p className={styles.lead}>Đã nhận đủ học phí{order.tuition !== null ? ` ${vnd(order.tuition)}` : ''}. Khoá nằm trong tài khoản của bạn từ bây giờ.</p>
      </Header>
      {order.overpaid ? (
        <section className={styles.block} aria-labelledby="overpaid-title">
          <h2 id="overpaid-title" className={styles.blockTitle}>Thừa tiền · đã mở khoá</h2>
          <p>Đã nhận {vnd(order.received)}, đơn cần {vnd(order.tuition)}, thừa <strong>{vnd(order.overpaid)}</strong>.</p>
          <p>Khoá đã mở bình thường. Phần thừa được hoàn về tài khoản đã chuyển; cần đổi tài khoản nhận thì báo cho chúng tôi.</p>
          {order.adminMessage ? <p className={styles.verbatim}>{order.adminMessage}</p> : null}
        </section>
      ) : null}
      <dl className={styles.facts}>
        {until ? <div><dt>Học được tới</dt><dd>hết ngày {until}</dd></div> : null}
        {order.creditsGranted ? (
          <div>
            <dt>Lượt chấm AI</dt>
            <dd>
              {order.creditsGranted} lượt · cộng vào số lượt bạn đang có; Writing và Speaking dùng chung
              {order.creditValidDays ? `, dùng trong ${order.creditValidDays} ngày` : ''}
              {carried ? <span className={styles.carry}>{carried}</span> : null}
            </dd>
          </div>
        ) : carried ? <div><dt>Lượt chấm AI</dt><dd>{carried}</dd></div> : null}
        <div>
          <dt>Tài khoản</dt>
          <dd>Đã kích hoạt. Mở luôn phần luyện Reading, Listening, ngữ pháp và từ vựng dành cho tài khoản đã kích hoạt.</dd>
        </div>
        {email ? <div><dt>Email xác nhận</dt><dd>đã gửi tới {email}</dd></div> : null}
      </dl>
      <div className={styles.actions}>
        <Button variant="primary" href={start}>Bắt đầu học</Button>
        <Button variant="secondary" href={ORDERS}>Xem đơn đăng ký của tôi</Button>
      </div>
    </>
  );
}

function ClosedScreen({ order, busy, onReport }: { order: EnrollOrder; busy: string | null; onReport: () => void }) {
  const renew = order.slug ? resolve(`/courses/${encodeURIComponent(order.slug)}/enroll`) : null;
  if (order.status === 'expired') {
    const hours = holdHours(order);
    const late = whenText(order.lateTransferReportedAt);
    return (
      <>
        <Header eyebrow={`${order.title} · Hết hạn`} title={`Đơn ${order.code} đã hết thời gian giữ`}>
          <p className={styles.lead}>{hours ? `Sau ${hours} giờ chưa có báo chuyển khoản nên đơn tự đóng.` : 'Chưa có báo chuyển khoản trong thời gian giữ nên đơn tự đóng.'}</p>
        </Header>
        <section className={styles.block} aria-labelledby="paid-title">
          <h2 id="paid-title" className={styles.blockTitle}>Đã chuyển tiền rồi?</h2>
          <p>
            Đừng chuyển lại. Khi admin thấy khoản chuyển khớp mã {order.code}, đơn tự mở lại và khoá mở, kể cả khi bạn
            chưa bấm nút. Bấm &ldquo;Tôi đã chuyển cho đơn này&rdquo; để được đối chiếu sớm hơn.
          </p>
          {late ? <Notice kind="success" live="status">Đã ghi nhận bạn báo đã chuyển lúc {late}. Admin sẽ đối chiếu theo mã đơn.</Notice> : null}
        </section>
        {late && order.transfer ? <ManualTransfer order={order} /> : null}
        <div className={styles.actions}>
          {renew ? <Button variant="primary" href={renew}>Tạo đơn mới</Button> : null}
          {late ? null : (
            <Button variant="secondary" onClick={onReport} loading={busy === 'report-transfer'} loadingLabel="Đang gửi…">
              Tôi đã chuyển cho đơn này
            </Button>
          )}
        </div>
      </>
    );
  }
  const at = whenText(order.cancelledAt);
  return (
    <>
      <Header eyebrow={`${order.title} · Đã huỷ`} title={`Đơn ${order.code} đã huỷ`} />
      <section className={styles.block} aria-label="Lý do huỷ">
        {order.cancelReason === 'learner' ? (
          <p>Bạn đã bấm &ldquo;Huỷ đơn này&rdquo;{at ? ` lúc ${at}` : ''}.</p>
        ) : (
          <>
            <p>Admin đã huỷ đơn này{at ? ` lúc ${at}` : ''}. Nếu bạn đã chuyển tiền và có biên lai, liên hệ kèm mã đơn.</p>
            {order.cancelNote ? <p className={styles.verbatim}>{order.cancelNote}</p> : null}
          </>
        )}
      </section>
      <div className={styles.actions}>
        {renew ? <Button variant="primary" href={renew}>Tạo đơn mới</Button> : null}
        <Button variant="secondary" href={ORDERS}>Xem đơn đăng ký của tôi</Button>
      </div>
    </>
  );
}
