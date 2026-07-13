/**
 * frontend/js/user-pill.js — canonical user pill dropdown binding +
 * populate (Sprint 6.17 chrome unification + Sprint 7.8-hotfix
 * populate canonicalization).
 *
 * Wires the user-pill toggle button + dropdown menu + logout item, AND
 * populates `#user-pill-name` + `#user-avatar` from the Supabase
 * session. Idempotent: safe to call multiple times; ignores pages
 * missing the canonical markup.
 *
 * Expected DOM (canonical chrome):
 *
 *   <div class="user-menu">
 *     <button class="user-pill" id="user-pill" aria-haspopup="true"
 *             aria-expanded="false">
 *       <span class="avatar" id="user-avatar">·</span>
 *       <span id="user-pill-name">…</span>
 *     </button>
 *     <div class="user-menu-dropdown" role="menu" hidden>
 *       <a href="/pages/profile.html" role="menuitem">Hồ sơ</a>
 *       <button id="user-menu-logout" role="menuitem">Đăng xuất</button>
 *     </div>
 *   </div>
 *
 * Sign-out path uses window.getSupabase() (exposed by api.js); falls
 * back to redirect-only if Supabase init isn't loaded.
 *
 * Canonical initials (Sprint 7.8-hotfix Bug 3 fix): 2 letters from
 * first letter of each name word, capped at 2. Naturally handles
 * single-name case (single letter for one-word names). Matches the
 * Sprint 6.17.1 speaking.html implementation that became the de-facto
 * reference; supersedes the 1-letter logic in legacy home.html.
 */

export function bindUserPill() {
  const toggle  = document.getElementById('user-pill');
  const menu    = toggle && toggle.parentElement
                  && toggle.parentElement.querySelector('.user-menu-dropdown');
  const logout  = document.getElementById('user-menu-logout');
  if (!toggle || !menu) return;

  // Avoid double-binding (e.g., when multiple modules try to bind on the
  // same page).
  if (toggle.dataset.userPillBound === '1') return;
  toggle.dataset.userPillBound = '1';

  function close() {
    menu.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', 'false');
  }
  function open() {
    menu.removeAttribute('hidden');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function isOpen() {
    return !menu.hasAttribute('hidden');
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen()) close(); else open();
  });

  // Close on outside click.
  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (toggle.parentElement.contains(e.target)) return;
    close();
  });

  // Close on Escape.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      close();
      toggle.focus();
    }
  });

  if (logout) {
    logout.addEventListener('click', async () => {
      try {
        const sb = (typeof window !== 'undefined'
                    && typeof window.getSupabase === 'function')
                   ? window.getSupabase()
                   : null;
        if (sb && sb.auth && typeof sb.auth.signOut === 'function') {
          await sb.auth.signOut();
        }
      } catch (err) {
        console.error('Sign-out failed:', err);
      }
      window.location.href = '/index.html';
    });
  }
}

/**
 * Compute canonical 2-letter initials from a display name.
 *
 * "Vinh Tran"   → "VT"
 * "Vinh"        → "V"
 * "Nguyễn Văn A" → "NV"  (slice(0,2) caps at 2)
 * ""            → "·"   (single-character fallback matches the HTML default)
 */
export function canonicalInitials(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '·';
  const initials = trimmed
    .split(/\s+/)
    .map((w) => w[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return initials || '·';
}


/**
 * Populate `#user-pill-name` + `#user-avatar` from the Supabase
 * session. Idempotent — refuses to overwrite already-populated values
 * so pages with their own bootstrap (e.g., speaking.html `renderUser`
 * which carries permissions context) keep priority.
 *
 * The placeholder values match the HTML defaults:
 *   `#user-pill-name` → "…" (U+2026)
 *   `#user-avatar`    → "·" (U+00B7 middle dot)
 *
 * If either has been overwritten by a page-specific bootstrap, skip
 * — that bootstrap is the authoritative source for that page.
 */
export async function populateUserPill() {
  const pillName = document.getElementById('user-pill-name');
  const avatar   = document.getElementById('user-avatar');
  if (!pillName && !avatar) return;

  // Idempotency guard.
  const root = pillName || avatar;
  if (root.dataset.userPillPopulated === '1') return;

  // Defer to a page's own bootstrap if it has already populated the
  // pill. The HTML defaults are "…" and "·" — any other value means
  // someone already wrote here.
  const isPillPlaceholder   = !pillName || pillName.textContent.trim() === '' || pillName.textContent === '…';
  const isAvatarPlaceholder = !avatar   || avatar.textContent.trim()   === '' || avatar.textContent   === '·';
  if (!isPillPlaceholder && !isAvatarPlaceholder) {
    if (root) root.dataset.userPillPopulated = '1';
    return;
  }

  const sb = (typeof window !== 'undefined' && typeof window.getSupabase === 'function')
    ? window.getSupabase()
    : null;
  if (!sb || !sb.auth || typeof sb.auth.getSession !== 'function') return;

  let session = null;
  try {
    const result = await sb.auth.getSession();
    session = result && result.data && result.data.session;
  } catch (err) {
    console.warn('[user-pill] getSession failed:', err);
    return;
  }
  if (!session || !session.user) return;

  const meta  = session.user.user_metadata || {};
  const email = session.user.email || '';
  const name  = meta.display_name || meta.full_name || meta.name
                || (email.split('@')[0] || 'bạn');

  if (pillName && isPillPlaceholder) {
    pillName.textContent = name.length > 14 ? name.slice(0, 13) + '…' : name;
  }
  if (avatar && isAvatarPlaceholder) {
    avatar.textContent = canonicalInitials(name);
  }
  if (root) root.dataset.userPillPopulated = '1';
}


// Auto-bind on DOMContentLoaded so pages can <script type="module" src=".../user-pill.js"></script>
// without needing per-page wiring code.
if (typeof document !== 'undefined') {
  const boot = () => { bindUserPill(); populateUserPill(); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
