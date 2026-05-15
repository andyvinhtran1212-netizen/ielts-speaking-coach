/**
 * frontend/js/pending-vocab.js
 *
 * Sprint 10.4 — Capture confirmation UI on result.html.
 *
 * Public surface:
 *
 *   import { mount } from '/js/pending-vocab.js';
 *   const handle = await mount(container, { token });
 *   // ... later, optionally:
 *   handle.unmount();
 *
 * Lifecycle:
 *   1. mount() fetches GET /api/vocabulary/bank/pending. If the list
 *      is empty, the container stays hidden and we return early — no
 *      empty-state UI (Andy spec § 8: "If pending list empty: skip
 *      section entirely").
 *   2. Otherwise the panel renders with one card per pending item
 *      plus a "Giữ tất cả" header button.
 *   3. Per-card actions and the batch button use the optimistic
 *      update pattern from Sprint 10.2.1 (my-vocab.js): the card
 *      fades out synchronously, the POST fires in the background,
 *      and a flashToast rolls back the fade on network failure.
 *
 * Pattern lineage:
 *   - Card layout family: needs-review.js (Sprint 10.1.5)
 *   - Soft-delete behaviour: same (drop = is_archived=true)
 *   - Optimistic update + rollback + flashToast: my-vocab.js (10.2.1)
 *
 * Re-mount safety: the mount() function is idempotent on a per-DOM-
 * element basis via a `data-pending-mounted` attribute. Calling it
 * twice on the same container short-circuits the second call.
 */

const _BASE = (typeof window !== 'undefined' && window.api && window.api.base)
  ? window.api.base
  : '';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cardHtml(item) {
  // Re-use the .mode-card / vocab-card design tokens that Sprint 9.x +
  // 10.1.5 needs-review settled on. Layout: headword → definition →
  // quoted context → AI feedback → action buttons.
  const definitionLine =
    (item.definition_en || item.definition_vi)
      ? '<div class="pending-card__def">'
        + (item.definition_en ? `<span>${esc(item.definition_en)}</span>` : '')
        + (item.definition_vi
            ? `<span class="pending-card__def-vi"> · ${esc(item.definition_vi)}</span>`
            : '')
        + '</div>'
      : '';
  const context = item.context_sentence
    ? `<p class="pending-card__context">"${esc(item.context_sentence)}"</p>`
    : '';
  const reason = item.reason
    ? `<p class="pending-card__reason">${esc(item.reason)}</p>`
    : '';
  return `
    <div class="pending-card" data-pending-id="${esc(item.id)}">
      <div class="pending-card__head">
        <span class="pending-card__headword">${esc(item.headword)}</span>
      </div>
      ${definitionLine}
      ${context}
      ${reason}
      <div class="pending-card__actions">
        <button class="pending-card__btn pending-card__btn--keep"
                data-action="keep" data-id="${esc(item.id)}">Giữ</button>
        <button class="pending-card__btn pending-card__btn--drop"
                data-action="drop" data-id="${esc(item.id)}">Bỏ</button>
      </div>
    </div>`;
}

function panelHtml(items) {
  const cards = items.map(cardHtml).join('');
  return `
    <section class="pending-panel" data-pending-panel>
      <header class="pending-panel__head">
        <h2 class="pending-panel__title">Từ vựng mới ghi nhận</h2>
        <p class="pending-panel__subtitle">Xem qua và xác nhận để lưu vào bộ từ của bạn.</p>
        <button class="pending-panel__keep-all" data-action="keep-all">
          Giữ tất cả
        </button>
      </header>
      <div class="pending-panel__list" data-pending-list>
        ${cards}
      </div>
      <p class="pending-panel__notice">
        💡 Tự động lưu sau 24h nếu bạn không xác nhận.
      </p>
    </section>`;
}

// Sprint 10.2.1 flashToast reuse — minimal lift here so this module
// stays standalone (no /js/vocab-modules/my-vocab.js import). Mounts
// a singleton DOM node on first call.
let _flashToastTimer = null;
function flashToast(message, kind) {
  let el = document.getElementById('pending-vocab-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pending-vocab-toast';
    el.className = 'mv-toast';
    document.body.appendChild(el);
  }
  el.className = `mv-toast mv-toast--${kind === 'error' ? 'error' : 'info'}`;
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout(_flashToastTimer);
  _flashToastTimer = setTimeout(function () { el.style.opacity = '0'; }, 2500);
}

async function apiJson(path, opts, token) {
  const res = await fetch(`${_BASE}/api/vocabulary/bank${path}`, {
    ...(opts || {}),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...((opts && opts.headers) || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // 204 / empty body tolerance.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Optimistic fade — slides the card to opacity 0 + removes after the
// CSS transition. Caller passes a rollback callback that re-shows the
// card if the network request fails.
function fadeCard(cardEl) {
  cardEl.classList.add('pending-card--leaving');
  setTimeout(function () {
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
  }, 200);
}

function restoreCard(cardEl) {
  if (!cardEl) return;
  cardEl.classList.remove('pending-card--leaving');
}

export async function mount(container, opts) {
  if (!container) return { unmount: function () {} };
  if (container.getAttribute('data-pending-mounted') === '1') {
    return { unmount: function () {} };
  }

  const token = (opts && opts.token) || '';
  let items;
  try {
    items = await apiJson('/pending', { method: 'GET' }, token);
  } catch (err) {
    console.warn('[pending-vocab] fetch failed (panel stays hidden):', err);
    return { unmount: function () {} };
  }

  // Andy spec § 8 — empty pending list = skip the section entirely.
  if (!Array.isArray(items) || items.length === 0) {
    return { unmount: function () {} };
  }

  container.classList.remove('hidden');
  container.innerHTML = panelHtml(items);
  container.setAttribute('data-pending-mounted', '1');

  // Single click handler for the whole panel — data-action dispatch.
  function onClick(ev) {
    const btn = ev.target && ev.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (action === 'keep') return keepItem(btn);
    if (action === 'drop') return dropItem(btn);
    if (action === 'keep-all') return keepAll();
  }

  async function keepItem(btn) {
    const id = btn.getAttribute('data-id');
    const card = btn.closest('.pending-card');
    if (!id || !card) return;
    // Optimistic fade.
    fadeCard(card);
    try {
      await apiJson(`/pending/${id}/confirm`, { method: 'POST' }, token);
      maybeUnmountIfEmpty();
    } catch (err) {
      restoreCard(card);
      flashToast('Không lưu được, thử lại nhé.', 'error');
      console.error('[pending-vocab] confirm failed:', err);
    }
  }

  async function dropItem(btn) {
    const id = btn.getAttribute('data-id');
    const card = btn.closest('.pending-card');
    if (!id || !card) return;
    fadeCard(card);
    try {
      await apiJson(`/pending/${id}/drop`, { method: 'POST' }, token);
      maybeUnmountIfEmpty();
    } catch (err) {
      restoreCard(card);
      flashToast('Không bỏ được, thử lại nhé.', 'error');
      console.error('[pending-vocab] drop failed:', err);
    }
  }

  async function keepAll() {
    const cards = Array.from(container.querySelectorAll('.pending-card'));
    if (cards.length === 0) return;
    const ids = cards
      .map(function (c) { return c.getAttribute('data-pending-id'); })
      .filter(Boolean);
    if (ids.length === 0) return;
    // Optimistic fade-all.
    cards.forEach(fadeCard);
    try {
      await apiJson(
        '/pending/bulk-confirm',
        { method: 'POST', body: JSON.stringify({ ids: ids }) },
        token,
      );
      maybeUnmountIfEmpty();
    } catch (err) {
      cards.forEach(restoreCard);
      flashToast('Không lưu được, thử lại nhé.', 'error');
      console.error('[pending-vocab] bulk-confirm failed:', err);
    }
  }

  function maybeUnmountIfEmpty() {
    // When all cards have faded out, hide the panel container so the
    // empty header + footer don't linger. Slight delay so the fade
    // transition completes before the wrapper collapses.
    setTimeout(function () {
      const remaining = container.querySelectorAll('.pending-card');
      if (remaining.length === 0) {
        container.classList.add('hidden');
      }
    }, 250);
  }

  container.addEventListener('click', onClick);

  return {
    unmount: function () {
      container.removeEventListener('click', onClick);
      container.removeAttribute('data-pending-mounted');
      container.innerHTML = '';
      container.classList.add('hidden');
    },
  };
}
