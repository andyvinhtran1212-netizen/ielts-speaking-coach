'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  nextIntervalLabel,
  normalizePersonalStack,
  normalizePublicStack,
  normalizeReviewReceipt,
  parseFlashcardStack,
} from '@/lib/flashcard-study-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'active' | 'summary' | 'empty' | 'disabled' | 'error';
type Rating = 'again' | 'hard' | 'good' | 'easy';
type PublicMark = 'review' | 'known';
type PendingRating = { rating: Rating; clientId: string };

const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];
const RATING_LABEL: Record<Rating, string> = {
  again: 'Quên', hard: 'Khó', good: 'Tốt', easy: 'Dễ',
};
const SOURCE_LABEL: Record<string, string> = {
  used_well: 'Dùng tốt',
  needs_review: 'Cần ôn',
  upgrade_suggested: 'Có thể nâng cấp',
  manual: 'Tự thêm',
};

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

function newReviewId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) return '';
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function parseResponse(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function personalRequest(
  expectedAccount: string,
  path: string,
  isCurrent: () => boolean,
  init?: RequestInit,
) {
  const sb = window.getSupabase() as any;
  const initial = await sb.auth.getSession();
  let session = initial.data?.session;
  if (initial.error || !session?.access_token || session.user?.id !== expectedAccount || !isCurrent()) {
    throw new Error('Tài khoản đã thay đổi trước khi gửi yêu cầu.');
  }

  const dispatch = async (token: string) => {
    const response = await fetch(`${window.api.base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
    return { response, payload: await parseResponse(response), token };
  };

  let result = await dispatch(session.access_token);
  if (result.response.status === 401 && isCurrent()) {
    const refreshed = await sb.auth.getSession();
    session = refreshed.data?.session;
    if (!refreshed.error && session?.user?.id === expectedAccount
      && session.access_token && session.access_token !== result.token) {
      result = await dispatch(session.access_token);
    }
  }
  if (!result.response.ok) {
    if (result.response.status === 401 && isCurrent()) {
      const latest = await sb.auth.getSession();
      const latestSession = latest.data?.session;
      if (isCurrent() && !latest.error
        && latestSession?.user?.id === expectedAccount
        && latestSession.access_token === result.token) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      }
    }
    const detail = result.payload?.detail;
    const error: any = new Error(
      typeof detail === 'string' ? detail : detail?.message || `HTTP ${result.response.status}`,
    );
    error.status = result.response.status;
    throw error;
  }
  return result.payload;
}

function readMarks(key: string): Record<string, PublicMark> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === 'known' || value === 'review'),
    ) as Record<string, PublicMark>;
  } catch { return {}; }
}

function persistMark(key: string, slug: string, mark: PublicMark) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...readMarks(key), [slug]: mark }));
    return true;
  } catch { return false; }
}

function playAudio(url: string, fallback: string) {
  try { window.speechSynthesis?.cancel(); } catch { /* no-op */ }
  const speak = () => {
    if (!fallback || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(fallback);
    utterance.lang = 'en-GB';
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  };
  if (!url) return speak();
  try {
    const audio = new Audio(url);
    void audio.play().catch(speak);
  } catch { speak(); }
}

function AudioButton({ url, say, label }: { url: string; say: string; label: string }) {
  return (
    <button
      type="button"
      className="fcs-audio"
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); playAudio(url, say); }}
    >
      <span aria-hidden="true">▶</span>
    </button>
  );
}

function Relation({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="fcs-relation">
      <span>{label}</span>
      <div>{items.map((item) => <span className="fcs-chip" key={item}>{item}</span>)}</div>
    </div>
  );
}

function StateCard({ children, tone = 'neutral', role }: {
  children: React.ReactNode;
  tone?: 'neutral' | 'error';
  role?: 'alert' | 'status';
}) {
  return <div className={`fcs-state fcs-state--${tone}`} role={role}>{children}</div>;
}

export function FlashcardStudyPlayer() {
  const { status, user } = useAuth();
  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  const accountRef = useRef<string | null>(accountKey);
  accountRef.current = accountKey;
  const generationRef = useRef(0);
  const mutationOwnerRef = useRef<symbol | null>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement>(null);
  const sourceDialogRef = useRef<HTMLElement>(null);
  const sourceCloseRef = useRef<HTMLButtonElement>(null);

  const [stack, setStack] = useState<any>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [title, setTitle] = useState('Học flashcard');
  const [message, setMessage] = useState('');
  const [cards, setCards] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingRating, setPendingRating] = useState<PendingRating | null>(null);
  const [saveError, setSaveError] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [storageOkay, setStorageOkay] = useState(true);
  const [breakdown, setBreakdown] = useState<Record<Rating, number>>({
    again: 0, hard: 0, good: 0, easy: 0,
  });
  const [publicBreakdown, setPublicBreakdown] = useState<Record<PublicMark, number>>({
    known: 0, review: 0,
  });

  const card = cards[index] || null;
  const publicMode = stack?.mode === 'wiki' || stack?.mode === 'exam';
  const loadIdentity = stack?.mode === 'personal' ? `${status}:${accountKey || ''}` : 'public';

  useEffect(() => {
    const descriptor = parseFlashcardStack(new URLSearchParams(window.location.search).get('stack'));
    if (!descriptor) {
      setMessage('Liên kết học thiếu hoặc có stack không hợp lệ.');
      setPhase('error');
      return;
    }
    setStack(descriptor);
  }, []);

  useEffect(() => {
    if (!stack) return;
    if (stack.mode === 'personal' && status === 'initial-loading') return;
    if (stack.mode === 'personal' && !accountKey) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    const generation = ++generationRef.current;
    let disposed = false;
    const controller = new AbortController();
    const expectedAccount = accountKey;
    const ownsLoad = () => !disposed && generationRef.current === generation
      && (stack.mode !== 'personal' || accountRef.current === expectedAccount);

    setPhase('loading');
    setMessage('');
    setCards([]);
    setIndex(0);
    setFlipped(false);
    setPendingRating(null);
    setSaveError('');
    setBusy(false);
    mutationOwnerRef.current = null;
    setBreakdown({ again: 0, hard: 0, good: 0, easy: 0 });
    setPublicBreakdown({ known: 0, review: 0 });

    void (async () => {
      const ready = await whenGlobalReady(
        () => Boolean(window.api?.base) && (stack.mode !== 'personal' || typeof window.getSupabase === 'function'),
        'Flashcard study runtime',
      );
      if (!ready || !ownsLoad()) {
        if (ownsLoad()) {
          setMessage('Không khởi tạo được trình học. Hãy tải lại trang.');
          setPhase('error');
        }
        return;
      }
      try {
        let payload;
        let normalized;
        if (stack.mode === 'personal') {
          payload = await personalRequest(
            expectedAccount!,
            `/api/flashcards/stacks/${encodeURIComponent(stack.raw)}/cards`,
            ownsLoad,
            { signal: controller.signal },
          );
          normalized = normalizePersonalStack(payload, stack.raw);
        } else {
          const path = stack.mode === 'wiki'
            ? `/api/vocabulary/categories/${encodeURIComponent(stack.key)}/cards`
            : `/api/vocabulary/exam/${encodeURIComponent(stack.key)}/cards`;
          const response = await fetch(`${window.api.base}${path}`, { signal: controller.signal });
          payload = await parseResponse(response);
          if (!response.ok) {
            const error: any = new Error(response.status === 404
              ? 'Bộ thẻ này không tồn tại.' : 'Không tải được bộ thẻ.');
            error.status = response.status;
            throw error;
          }
          normalized = normalizePublicStack(payload, stack);
        }
        if (!ownsLoad()) return;
        if (!normalized) throw new Error('Máy chủ trả về bộ thẻ không đúng định dạng.');
        setTitle(normalized.title);
        setCards(normalized.cards);
        setPhase(normalized.cards.length ? 'active' : 'empty');
      } catch (caught: any) {
        if (!ownsLoad()) return;
        if (caught?.status === 403) {
          setMessage('Flashcards chưa được bật cho tài khoản này.');
          setPhase('disabled');
        } else {
          setMessage(messageOf(caught));
          setPhase('error');
        }
      }
    })();

    return () => { disposed = true; controller.abort(); };
  }, [stack, loadIdentity]);

  useEffect(() => {
    if (!sourceOpen) return;
    sourceCloseRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSourceOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = sourceDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      sourceTriggerRef.current?.focus();
    };
  }, [sourceOpen]);

  const advance = useCallback(() => {
    setFlipped(false);
    setSaveError('');
    setPendingRating(null);
    if (index + 1 >= cards.length) setPhase('summary');
    else setIndex(index + 1);
  }, [cards.length, index]);

  const submitRating = useCallback(async (rating: Rating, retry?: PendingRating) => {
    if (!card || publicMode || busy || !accountKey) return;
    const operation = retry || { rating, clientId: newReviewId() };
    if (!operation.clientId) {
      setSaveError('Trình duyệt không tạo được mã lưu an toàn. Hãy tải lại trang.');
      return;
    }
    const expectedAccount = accountKey;
    const expectedGeneration = generationRef.current;
    const expectedCardId = card.id;
    const owner = Symbol('flashcard-review');
    mutationOwnerRef.current = owner;
    const ownsMutation = () => mutationOwnerRef.current === owner
      && accountRef.current === expectedAccount
      && generationRef.current === expectedGeneration;

    setPendingRating(operation);
    setBusy(true);
    setSaveError('');
    try {
      const payload = await personalRequest(
        expectedAccount,
        `/api/flashcards/${encodeURIComponent(expectedCardId)}/review`,
        ownsMutation,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': operation.clientId,
          },
          body: JSON.stringify({
            rating: operation.rating,
            client_review_id: operation.clientId,
          }),
        },
      );
      const receipt = normalizeReviewReceipt(payload, expectedCardId);
      if (!receipt) throw new Error('Máy chủ chưa xác nhận bản ghi SRS hợp lệ.');
      if (!ownsMutation()) return;
      setBreakdown((current) => ({ ...current, [operation.rating]: current[operation.rating] + 1 }));
      advance();
    } catch (caught) {
      if (ownsMutation()) setSaveError(`Chưa lưu được đánh giá: ${messageOf(caught)}`);
    } finally {
      if (mutationOwnerRef.current === owner) {
        mutationOwnerRef.current = null;
        if (accountRef.current === expectedAccount && generationRef.current === expectedGeneration) {
          setBusy(false);
        }
      }
    }
  }, [accountKey, advance, busy, card, publicMode]);

  const markPublic = useCallback((mark: PublicMark) => {
    if (!card || !publicMode || phase !== 'active') return;
    if (!persistMark(stack.storageKey, card.slug, mark)) setStorageOkay(false);
    setPublicBreakdown((current) => ({ ...current, [mark]: current[mark] + 1 }));
    advance();
  }, [advance, card, phase, publicMode, stack]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (phase !== 'active' || sourceOpen || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button, a, [contenteditable="true"]')) return;
      if (event.key === ' ') {
        event.preventDefault();
        setFlipped((value) => !value);
        return;
      }
      if (publicMode && event.key === '1') { event.preventDefault(); markPublic('review'); }
      else if (publicMode && event.key === '2') { event.preventDefault(); markPublic('known'); }
      else if (!publicMode && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        void submitRating(RATINGS[Number(event.key) - 1]);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [markPublic, phase, publicMode, sourceOpen, submitRating]);

  const restart = () => {
    setIndex(0);
    setFlipped(false);
    setPendingRating(null);
    setSaveError('');
    setBreakdown({ again: 0, hard: 0, good: 0, easy: 0 });
    setPublicBreakdown({ known: 0, review: 0 });
    setPhase(cards.length ? 'active' : 'empty');
  };

  if (phase === 'loading') {
    return <main className="fcs-width fcs-main"><StateCard role="status"><span className="fcs-spinner" /><p>Đang chuẩn bị bộ thẻ…</p></StateCard></main>;
  }
  if (phase === 'error' || phase === 'disabled') {
    return (
      <main className="fcs-width fcs-main">
        <StateCard tone="error" role="alert"><span className="fcs-state__icon">!</span><h2>Chưa thể mở phiên học</h2><p>{message}</p><a href={publicMode ? '/vocabulary/hub' : '/flashcards'}>Quay lại</a></StateCard>
      </main>
    );
  }
  if (phase === 'empty') {
    return <main className="fcs-width fcs-main"><StateCard><span className="fcs-state__icon">0</span><h2>Chưa có thẻ để học</h2><p>Bộ thẻ này đang trống hoặc chưa có thẻ đến hạn.</p><a href="/flashcards">Chọn stack khác</a></StateCard></main>;
  }
  if (phase === 'summary') {
    return (
      <main className="fcs-width fcs-main">
        <section className="fcs-summary">
          <span className="fcs-summary__check">✓</span>
          <p className="fcs-eyebrow">Session complete</p>
          <h2>Đã hoàn thành {cards.length} thẻ</h2>
          <p>{publicMode
            ? (storageOkay ? 'Đánh dấu đã được lưu trên thiết bị này.' : 'Trình duyệt không cho phép lưu; kết quả chỉ còn trong phiên này.')
            : 'Mọi đánh giá trong tổng kết đã được máy chủ xác nhận.'}</p>
          {publicMode ? (
            <div className="fcs-breakdown fcs-breakdown--two">
              <div><strong>{publicBreakdown.review}</strong><span>Cần ôn</span></div>
              <div><strong>{publicBreakdown.known}</strong><span>Đã thuộc</span></div>
            </div>
          ) : (
            <div className="fcs-breakdown">
              {RATINGS.map((rating) => <div key={rating}><strong>{breakdown[rating]}</strong><span>{RATING_LABEL[rating]}</span></div>)}
            </div>
          )}
          <div className="fcs-summary__actions">
            <button type="button" className="av-button av-button-primary" onClick={restart}>Học lại</button>
            <a className="av-button av-button-secondary" href={publicMode ? (stack.mode === 'exam' ? '/vocabulary/exam' : '/vocabulary/hub#vocab-topics') : '/flashcards'}>Chọn bộ khác</a>
          </div>
        </section>
      </main>
    );
  }

  const previousMark = publicMode ? readMarks(stack.storageKey)[card.slug] : null;
  const percent = cards.length ? Math.round((index / cards.length) * 100) : 0;
  const personalContent = !publicMode && !!(card.definitionVi || card.definitionEn || card.example);

  return (
    <main className="fcs-width fcs-main">
      <div className="fcs-progress">
        <div><span>{title}</span><strong>{index + 1} / {cards.length}</strong></div>
        <div className="fcs-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={index}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>

      <section className="fcs-stage" aria-live="polite">
        <div
          className={`fcs-card${flipped ? ' is-flipped' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={flipped ? 'Lật về mặt từ vựng' : 'Lật thẻ để xem nghĩa'}
          onClick={() => setFlipped((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            setFlipped((value) => !value);
          }}
        >
          <article className="fcs-face fcs-face--front">
            <div className="fcs-card__topline">
              <span className="fcs-pill">{publicMode ? title : (card.topic || 'My vocabulary')}</span>
              {previousMark && <span className={`fcs-memory fcs-memory--${previousMark}`}>{previousMark === 'known' ? 'Đã thuộc' : 'Cần ôn'}</span>}
            </div>
            <div className="fcs-word">
              <p>{card.headword}</p>
              {(card.pronunciation || card.ipa) && <span>{card.pronunciation || card.ipa}</span>}
              <AudioButton url={card.audioHeadword} say={card.headword} label={`Nghe phát âm ${card.headword}`} />
            </div>
            <p className="fcs-flip-hint"><span aria-hidden="true">↻</span> Chạm hoặc nhấn Space để xem nghĩa</p>
          </article>

          <article className="fcs-face fcs-face--back">
            <div className="fcs-back-head">
              <div><h2>{card.headword}</h2>{(card.pronunciation || card.ipa) && <span>{card.pronunciation || card.ipa}</span>}</div>
              <AudioButton url={card.audioHeadword} say={card.headword} label={`Nghe phát âm ${card.headword}`} />
            </div>
            {publicMode && (card.partOfSpeech || card.level) && <p className="fcs-meta">{[card.partOfSpeech, card.level].filter(Boolean).join(' · ')}</p>}
            {card.definitionVi && <p className="fcs-definition fcs-definition--primary">{card.definitionVi}</p>}
            {card.definitionEn && <p className="fcs-definition">{card.definitionEn}</p>}
            {card.example && (
              <div className="fcs-example">
                <div><span>Ví dụ</span>{publicMode && <AudioButton url={card.audioExample} say={card.example} label="Nghe câu ví dụ" />}</div>
                <p>{card.example}</p>
              </div>
            )}
            {!publicMode && !personalContent && <div className="fcs-callout fcs-callout--notice"><span>i</span><p>Chưa có định nghĩa chi tiết. Bạn vẫn có thể xem câu gốc để nhớ ngữ cảnh.</p></div>}
            {publicMode && <Relation label="Kết hợp thường gặp" items={card.collocations} />}
            {publicMode && <Relation label="Đồng nghĩa" items={card.synonyms} />}
            {publicMode && <Relation label="Trái nghĩa" items={card.antonyms} />}
            {publicMode && card.memoryHook && <div className="fcs-callout fcs-callout--memory"><span>✦</span><p>{card.memoryHook}</p></div>}
            {publicMode && card.commonError && <div className="fcs-callout fcs-callout--warning"><span>!</span><p>{card.commonError}</p></div>}
            {!publicMode && card.context && <button ref={sourceTriggerRef} type="button" className="fcs-source" onClick={(event) => { event.stopPropagation(); setSourceOpen(true); }}>Xem câu gốc</button>}
            {!publicMode && <p className="fcs-meta">{SOURCE_LABEL[card.sourceType] || card.sourceType || 'Từ vựng cá nhân'} · {card.review ? `Đã ôn ${card.review.reviewCount} lần` : 'Chưa học'}</p>}
          </article>
        </div>
      </section>

      {publicMode ? (
        <div className="fcs-actions fcs-actions--two">
          <button type="button" className="fcs-rate fcs-rate--again" onClick={() => markPublic('review')}><span>Cần ôn</span><kbd>1</kbd></button>
          <button type="button" className="fcs-rate fcs-rate--good" onClick={() => markPublic('known')}><span>Đã thuộc</span><kbd>2</kbd></button>
        </div>
      ) : (
        <>
          <div className="fcs-actions">
            {RATINGS.map((rating, ratingIndex) => (
              <button
                type="button"
                className={`fcs-rate fcs-rate--${rating}`}
                key={rating}
                disabled={busy || !!pendingRating}
                onClick={() => void submitRating(rating)}
              >
                <span>{RATING_LABEL[rating]}</span>
                <small>{nextIntervalLabel(card, rating)}</small>
                <kbd>{ratingIndex + 1}</kbd>
              </button>
            ))}
          </div>
          {(busy || saveError) && (
            <div className={`fcs-save-state${saveError ? ' fcs-save-state--error' : ''}`} role={saveError ? 'alert' : 'status'}>
              <p>{busy ? 'Đang xác nhận tiến độ với máy chủ…' : saveError}</p>
              {!busy && saveError && pendingRating && (
                <button type="button" onClick={() => void submitRating(pendingRating.rating, pendingRating)}>Thử lưu lại</button>
              )}
            </div>
          )}
        </>
      )}
      <p className="fcs-shortcuts">Space để lật thẻ · Phím số để đánh giá</p>

      {sourceOpen && (
        <div className="av-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSourceOpen(false); }}>
          <section ref={sourceDialogRef} className="av-modal" role="dialog" aria-modal="true" aria-labelledby="fcs-source-title" aria-describedby="fcs-source-note" tabIndex={-1}>
            <header className="av-modal-header">
              <div>
                <p className="fcs-eyebrow">Ngữ cảnh cá nhân</p>
                <h2 className="av-modal-title" id="fcs-source-title">Câu gốc của bạn</h2>
              </div>
            </header>
            <div className="av-modal-body">
              <blockquote className="fcs-source-quote">{card.context}</blockquote>
              <p className="fcs-source-note" id="fcs-source-note">Đây là câu chép lại từ bài nói và có thể còn lỗi ngữ pháp.</p>
            </div>
            <footer className="av-modal-footer">
              <button ref={sourceCloseRef} type="button" className="av-button av-button-primary" onClick={() => setSourceOpen(false)}>Đóng</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
