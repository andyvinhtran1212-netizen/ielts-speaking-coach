/**
 * frontend/js/components/audio-player.js — Sprint 11.2 (DEBT-LISTENING-
 * MODULE foundation 2/5).
 *
 * Vanilla custom element wrapping a native <audio>. Built for the
 * dictation surface (frontend/pages/listening-dictation.html) but
 * intentionally generic — Sprint 11.3+ gist/T-F/MCQ pages reuse it.
 *
 * Usage:
 *
 *   <audio-player src="https://..." duration-hint="42"></audio-player>
 *
 *   <script type="module" src="/js/components/audio-player.js"></script>
 *
 *   const el = document.querySelector('audio-player');
 *   el.addEventListener('av-audio-ended', () => { ... });
 *
 * Attributes:
 *   src             — initial playable URL (typically a Supabase signed URL).
 *                     Reactive: changing it after mount swaps the source +
 *                     resets the transport.
 *   duration-hint   — optional integer seconds for the total-time readout
 *                     while metadata loads. Native <audio> overwrites this
 *                     on `loadedmetadata`.
 *   refetch-url     — optional URL that, when GET'd, returns
 *                     {audio_signed_url: "..."} — used to refresh the src
 *                     transparently when the signed URL TTL expires. The
 *                     dictation page wires this to /api/listening/content/{id}.
 *
 * Methods:
 *   play() / pause() — control transport from page JS.
 *   reset()          — seek to 0 and pause.
 *
 * Events (bubbled + composed so they cross the shadow boundary):
 *   av-audio-play     — playback started
 *   av-audio-pause    — playback paused
 *   av-audio-ended    — playback ran to end (replay-5s does NOT fire this)
 *   av-audio-error    — playback errored AFTER the signed-URL refetch
 *                       retry. Pages may surface a toast.
 *
 * Sprint 11.0 §6 design: matches vocabulary.css `.mode-card` token
 * palette. No new --av- variables. JetBrains Mono for time numerics
 * (same convention as the speaking timer).
 *
 * Signed URL refresh:
 *   Supabase signed URLs have a 1h TTL. If <audio> errors AND a
 *   refetch-url attribute is set, we GET it once (with Bearer token
 *   if supabase is initialised) and swap src silently. A second
 *   error after refresh surfaces the av-audio-error event — pages
 *   handle (e.g. show "Audio expired, refresh the page").
 */

const STYLE = /* css */ `
:host {
  display: block;
  font-family: var(--av-font-sans);
  color: var(--av-text-primary);
}
.av-player {
  display: flex;
  flex-direction: column;
  gap: var(--av-space-3);
  padding: var(--av-space-4) var(--av-space-6);
  background: var(--av-surface-card);
  border: 1px solid var(--av-border-default);
  border-radius: var(--av-radius-lg);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.av-row {
  display: flex;
  align-items: center;
  gap: var(--av-space-3);
}
.av-row--main { gap: var(--av-space-4); }

.av-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--av-radius-pill);
  border: 1px solid var(--av-border-default);
  background: var(--av-surface-card);
  color: var(--av-text-primary);
  cursor: pointer;
  transition: background var(--av-duration-fast) var(--av-easing-default),
              border-color var(--av-duration-fast) var(--av-easing-default);
  padding: 0;
}
.av-btn:hover { border-color: var(--av-brand-teal-700); }
.av-btn:focus-visible {
  outline: 2px solid var(--av-brand-teal-700);
  outline-offset: 2px;
}
.av-btn--primary {
  width: 52px;
  height: 52px;
  background: var(--av-brand-teal-700);
  border-color: var(--av-brand-teal-700);
  color: var(--av-text-on-primary);
}
.av-btn--primary:hover { background: var(--av-brand-teal-800); }
.av-btn svg { width: 20px; height: 20px; }
.av-btn--primary svg { width: 22px; height: 22px; }

.av-scrub {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  background: var(--av-surface-sunken);
  border-radius: var(--av-radius-pill);
  cursor: pointer;
}
.av-scrub::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px; height: 16px;
  background: var(--av-brand-teal-700);
  border-radius: 50%;
  cursor: pointer;
}
.av-scrub::-moz-range-thumb {
  width: 16px; height: 16px;
  background: var(--av-brand-teal-700);
  border-radius: 50%;
  border: none;
  cursor: pointer;
}

.av-time {
  font-family: var(--av-font-mono);
  font-size: var(--av-fs-sm);
  color: var(--av-text-secondary);
  min-width: 80px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.av-speeds { display: inline-flex; gap: var(--av-space-1); }
.av-speed-btn {
  font-family: var(--av-font-mono);
  font-size: var(--av-fs-xs);
  padding: 4px 10px;
  border-radius: var(--av-radius-md);
  border: 1px solid var(--av-border-default);
  background: transparent;
  color: var(--av-text-secondary);
  cursor: pointer;
  transition: all var(--av-duration-fast) var(--av-easing-default);
}
.av-speed-btn:hover { color: var(--av-text-primary); }
.av-speed-btn[aria-pressed="true"] {
  background: var(--av-brand-teal-700);
  color: var(--av-text-on-primary);
  border-color: var(--av-brand-teal-700);
}

.av-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--av-fs-xs);
  color: var(--av-text-muted);
  text-transform: uppercase;
  letter-spacing: var(--av-tracking-widest);
}

[hidden] { display: none !important; }
`;

const TEMPLATE = /* html */ `
<div class="av-player" role="group" aria-label="Audio player">
  <div class="av-row av-row--main">
    <button class="av-btn av-btn--primary" id="btn-play" type="button" aria-label="Phát">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" id="icon-play">
        <path d="M8 5v14l11-7z"/>
      </svg>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" id="icon-pause" hidden>
        <path d="M6 4h4v16H6zM14 4h4v16h-4z"/>
      </svg>
    </button>
    <button class="av-btn" id="btn-replay" type="button" aria-label="Tua lại 5 giây">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
        <path d="M3 3v5h5"/>
      </svg>
    </button>
    <input class="av-scrub" id="scrub" type="range" min="0" max="0" step="0.1" value="0"
           aria-label="Tiến độ phát">
    <span class="av-time" id="time">0:00 / 0:00</span>
  </div>
  <div class="av-row av-meta">
    <span>Speed</span>
    <span class="av-speeds" role="group" aria-label="Tốc độ phát">
      <button class="av-speed-btn" data-speed="0.75" type="button" aria-pressed="false">0.75x</button>
      <button class="av-speed-btn" data-speed="1" type="button" aria-pressed="true">1x</button>
      <button class="av-speed-btn" data-speed="1.25" type="button" aria-pressed="false">1.25x</button>
    </span>
  </div>
</div>
`;

function _fmt(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class AverAudioPlayer extends HTMLElement {
  static get observedAttributes() { return ['src', 'duration-hint', 'refetch-url']; }

  constructor() {
    super();
    this._audio = null;
    this._refetched = false;
  }

  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;

    this._audio = new Audio();
    this._audio.preload = 'metadata';

    this._$ = (id) => shadow.getElementById(id);
    this._bindControls();
    this._bindAudio();
    this._applySrc(this.getAttribute('src'));
    this._applyDurationHint(this.getAttribute('duration-hint'));
  }

  disconnectedCallback() {
    if (this._audio) {
      try { this._audio.pause(); } catch { /* swallow */ }
      this._audio.src = '';
      this._audio = null;
    }
  }

  attributeChangedCallback(name, _old, val) {
    if (!this._mounted) return;
    if (name === 'src') {
      this._refetched = false;  // new explicit src → re-allow one refetch retry
      this._applySrc(val);
    } else if (name === 'duration-hint') {
      this._applyDurationHint(val);
    }
  }

  // ── Public methods ────────────────────────────────────────────────

  play() { if (this._audio) return this._audio.play(); }
  pause() { if (this._audio) this._audio.pause(); }
  reset() {
    if (!this._audio) return;
    this._audio.pause();
    this._audio.currentTime = 0;
  }

  // ── Internals ─────────────────────────────────────────────────────

  _applySrc(url) {
    if (!this._audio) return;
    if (!url) { this._audio.src = ''; return; }
    this._audio.src = url;
    this._audio.load();
  }

  _applyDurationHint(val) {
    const hint = Number(val);
    if (Number.isFinite(hint) && hint > 0 && this._audio && !Number.isFinite(this._audio.duration)) {
      this._$('scrub').max = hint;
      this._$('time').textContent = `0:00 / ${_fmt(hint)}`;
    }
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, {
      bubbles: true, composed: true, detail: detail || null,
    }));
  }

  _bindControls() {
    this._$('btn-play').addEventListener('click', () => {
      if (this._audio.paused) this._audio.play().catch(() => { /* error event handles */ });
      else this._audio.pause();
    });

    this._$('btn-replay').addEventListener('click', () => {
      if (!this._audio) return;
      const t = Math.max(0, (this._audio.currentTime || 0) - 5);
      this._audio.currentTime = t;
      if (this._audio.paused) this._audio.play().catch(() => {});
    });

    this._$('scrub').addEventListener('input', (e) => {
      if (!this._audio) return;
      this._audio.currentTime = Number(e.target.value);
    });

    this.shadowRoot.querySelectorAll('.av-speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rate = Number(btn.dataset.speed);
        if (!Number.isFinite(rate)) return;
        this._audio.playbackRate = rate;
        this.shadowRoot.querySelectorAll('.av-speed-btn').forEach((b) => {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
      });
    });
  }

  _bindAudio() {
    const a = this._audio;

    a.addEventListener('loadedmetadata', () => {
      this._$('scrub').max = a.duration || 0;
      this._$('time').textContent = `${_fmt(a.currentTime)} / ${_fmt(a.duration)}`;
    });

    a.addEventListener('timeupdate', () => {
      this._$('scrub').value = a.currentTime || 0;
      this._$('time').textContent = `${_fmt(a.currentTime)} / ${_fmt(a.duration)}`;
    });

    a.addEventListener('play', () => {
      this._$('icon-play').hidden = true;
      this._$('icon-pause').hidden = false;
      this._$('btn-play').setAttribute('aria-label', 'Tạm dừng');
      this._emit('av-audio-play');
    });

    a.addEventListener('pause', () => {
      this._$('icon-play').hidden = false;
      this._$('icon-pause').hidden = true;
      this._$('btn-play').setAttribute('aria-label', 'Phát');
      this._emit('av-audio-pause');
    });

    a.addEventListener('ended', () => {
      this._emit('av-audio-ended');
    });

    a.addEventListener('error', () => {
      // First error → try refetch-url once (signed URL TTL likely expired).
      const refetchUrl = this.getAttribute('refetch-url');
      if (!this._refetched && refetchUrl) {
        this._refetched = true;
        this._refreshSignedUrl(refetchUrl).catch(() => this._emit('av-audio-error'));
        return;
      }
      this._emit('av-audio-error');
    });
  }

  async _refreshSignedUrl(refetchUrl) {
    // Prefer the global api helper so the Authorization header gets attached.
    if (window.api && typeof window.api.get === 'function') {
      const data = await window.api.get(refetchUrl);
      const fresh = data && (data.audio_signed_url || data.signed_url || data.signedURL);
      if (fresh) { this._applySrc(fresh); return; }
    }
    // Fallback: raw fetch (no auth header — only works for public endpoints).
    const r = await fetch(refetchUrl);
    if (!r.ok) throw new Error(`refetch HTTP ${r.status}`);
    const data = await r.json();
    const fresh = data && (data.audio_signed_url || data.signed_url || data.signedURL);
    if (!fresh) throw new Error('refetch payload missing audio_signed_url');
    this._applySrc(fresh);
  }
}

if (!customElements.get('audio-player')) {
  customElements.define('audio-player', AverAudioPlayer);
}
