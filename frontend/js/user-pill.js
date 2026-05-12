/**
 * frontend/js/user-pill.js — canonical user pill dropdown binding
 * (Sprint 6.17 chrome unification).
 *
 * Wires the user-pill toggle button + dropdown menu + logout item.
 * Idempotent: safe to call multiple times; ignores pages missing the
 * canonical markup.
 *
 * Expected DOM (canonical chrome):
 *
 *   <div class="user-menu">
 *     <button class="user-pill" id="user-pill" aria-haspopup="true"
 *             aria-expanded="false">...</button>
 *     <div class="user-menu-dropdown" role="menu" hidden>
 *       <a href="/pages/profile.html" role="menuitem">Hồ sơ</a>
 *       <button id="user-menu-logout" role="menuitem">Đăng xuất</button>
 *     </div>
 *   </div>
 *
 * Sign-out path uses window.getSupabase() (exposed by api.js); falls
 * back to redirect-only if Supabase init isn't loaded.
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

// Auto-bind on DOMContentLoaded so pages can <script type="module" src=".../user-pill.js"></script>
// without needing per-page wiring code.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUserPill);
  } else {
    bindUserPill();
  }
}
