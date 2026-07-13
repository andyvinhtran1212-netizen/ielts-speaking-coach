/**
 * frontend/js/vocab-modules/_loader.js
 *
 * Sprint 7.3 — shared helper for the vocab-module loader contract
 * (DEBT-2026-05-09-B Phase 1).
 *
 * Every vocab module (my-vocab, future flashcards, future exercises)
 * ships:
 *
 *   export async function mount(container, opts) → { unmount }
 *
 * Where:
 *   - `container` is the HTMLElement the module should render into.
 *   - `opts.embedded` is true when mounted by the parent vocabulary.html
 *     tab UI, false when mounted by a standalone shell page.
 *
 * This file ships two helpers consumed by both the parent loader and
 * the modules themselves:
 *
 *   - renderSkeleton(container) — drops a minimal loading skeleton
 *     into the container while `await import()` is pending. Re-used
 *     so every vocab tab shows the same spinner.
 *
 *   - renderError(container, err, { onRetry }) — error state with
 *     a retry CTA. Used by parent vocab-landing.js when `import()`
 *     itself fails (network error, syntax error, etc.).
 *
 * The auth-redirect helper (`redirectToLogin`) chooses between
 * `window.location.href` (standalone) and `window.top.location.href`
 * (embedded) per Phase B Q2 — auth loss is a top-level event.
 */


/**
 * Render a generic loading skeleton into the container. Cleared by
 * the module's mount() call before rendering its own HTML.
 *
 * @param {HTMLElement} container
 */
export function renderSkeleton(container) {
  container.innerHTML = `
    <div class="vocab-module-skeleton" role="status" aria-live="polite">
      <div class="spinner" aria-hidden="true"></div>
      <p class="text-sm" style="color: var(--av-text-muted); margin-top: 12px;">Đang tải…</p>
    </div>
  `;
}


/**
 * Render an error state when dynamic `import()` fails (network,
 * parse error, etc.). Modules themselves render their own granular
 * error states for backend failures; this helper only handles the
 * loader-level failure case.
 *
 * @param {HTMLElement} container
 * @param {Error} err
 * @param {{ onRetry?: () => void }} [opts]
 */
export function renderError(container, err, { onRetry } = {}) {
  const detail = err && err.message ? err.message : 'Không xác định';
  container.innerHTML = `
    <div class="vocab-module-error text-center py-16 empty-state">
      <p class="text-lg font-medium mb-2">Không tải được module</p>
      <p class="text-sm mb-4" style="color: var(--av-text-muted);">
        Chi tiết: ${escapeText(detail)}
      </p>
      <button type="button" data-loader-retry
              class="mv-add-btn text-sm font-medium px-4 py-1.5 rounded-lg">
        Thử lại
      </button>
    </div>
  `;
  if (onRetry) {
    const btn = container.querySelector('[data-loader-retry]');
    if (btn) btn.addEventListener('click', onRetry, { once: true });
  }
}


/**
 * Auth-redirect helper. When the module detects an unauthenticated
 * session, it calls this with the embedded flag forwarded from
 * `mount(opts)`. Embedded calls escalate to the top frame because
 * auth loss is a top-level event (Phase B Q2).
 *
 * @param {{ embedded?: boolean }} [opts]
 */
export function redirectToLogin({ embedded = false } = {}) {
  const url = '/index.html';
  if (embedded && window.top && window.top !== window) {
    try {
      window.top.location.href = url;
      return;
    } catch (_) {
      // Cross-origin iframe (shouldn't happen here, but defensive):
      // fall through to local navigation.
    }
  }
  window.location.href = url;
}


/**
 * Idempotent-mount guard. Modules call this at the top of their
 * `mount()` to no-op on repeat calls. Sets a `data-mounted="true"`
 * attribute on the container; if the attribute is already there,
 * returns the previously-returned handle from the WeakMap.
 *
 * @param {HTMLElement} container
 * @returns {{ alreadyMounted: boolean, getHandle: () => any, setHandle: (h: any) => void }}
 */
const _handles = new WeakMap();
export function guardMount(container) {
  const alreadyMounted = container.dataset.mounted === 'true';
  return {
    alreadyMounted,
    getHandle: () => _handles.get(container) || null,
    setHandle: (h) => {
      container.dataset.mounted = 'true';
      _handles.set(container, h);
    },
    clearHandle: () => {
      delete container.dataset.mounted;
      _handles.delete(container);
    },
  };
}


/**
 * Minimal HTML-escape helper for loader-side strings (error
 * messages, etc.). Modules ship their own page-specific `esc()`
 * implementations for performance; this is loader-only.
 */
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
