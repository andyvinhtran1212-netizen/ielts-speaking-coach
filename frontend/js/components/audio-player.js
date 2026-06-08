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

/* OPT-IN compact variant (listening-review bottom chrome): collapse the two
   stacked rows into ONE low row and blend into the host surface — roughly
   halves the player height. Default (no [compact]) is unchanged, so every other
   caller (the live test player, etc.) keeps the full two-row layout. */
:host([compact]) .av-player {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--av-space-3);
  padding: var(--av-space-2) 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
:host([compact]) .av-row--main { flex: 1 1 320px; min-width: 0; gap: var(--av-space-3); }
:host([compact]) .av-btn { width: 36px; height: 36px; }
:host([compact]) .av-btn--primary { width: 40px; height: 40px; }
:host([compact]) .av-meta { flex: 0 0 auto; text-transform: none; letter-spacing: normal; }
:host([compact]) .av-meta > span:first-child { display: none; }   /* hide the "Speed" word */

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
  // Sprint 11.3 — segment-mode attributes added: segment-start, segment-end,
  // auto-loop. When segment-start is set, playback is constrained to the
  // [segment-start, segment-end] window — auto-pauses at the end, replay
  // button rewinds to segment-start (not -5s), scrub + time readout are
  // segment-local.
  static get observedAttributes() {
    return ['src', 'duration-hint', 'refetch-url',
            'segment-start', 'segment-end', 'auto-loop'];
  }

  constructor() {
    super();
    this._audio = null;
    this._refetched = false;
    this._loopTimer = null;
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
    this._syncIcon();
  }

  disconnectedCallback() {
    if (this._loopTimer) { clearTimeout(this._loopTimer); this._loopTimer = null; }
    if (this._audio) {
      try { this._audio.pause(); } catch { /* swallow */ }
      this._audio.src = '';
      this._audio = null;
    }
  }

  attributeChangedCallback(name, _old, val) {
    if (!this._mounted) return;
    if (name === 'src') {
      this._refetched = false;
      this._applySrc(val);
    } else if (name === 'duration-hint') {
      this._applyDurationHint(val);
    } else if (name === 'segment-start' || name === 'segment-end') {
      this._applySegmentBounds();
    }
    // auto-loop is read on demand inside the ended handler.
  }

  // ── Public methods ────────────────────────────────────────────────

  play() { if (this._audio) return this._audio.play(); }
  pause() { if (this._audio) this._audio.pause(); }
  reset() {
    if (!this._audio) return;
    this._audio.pause();
    this._audio.currentTime = this._segmentStart();
  }
  // listening-review polish — full-track "locate": seek to an absolute second
  // and keep playing to the end (no segment window). Caller should NOT set
  // segment-start/-end when using this (otherwise segment-mode would constrain
  // playback). Additive; existing segment-mode callers are unaffected.
  seekTo(sec) {
    if (!this._audio) return;
    const t = Math.max(0, Number(sec) || 0);
    try { this._audio.currentTime = t; } catch (e) { /* metadata not ready yet */ }
    this._audio.play().catch(() => { /* error event handles it */ });
  }

  // ── Segment helpers ────────────────────────────────────────────────

  _segmentStart() {
    const v = Number(this.getAttribute('segment-start'));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }
  _segmentEnd() {
    const v = Number(this.getAttribute('segment-end'));
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  _isSegmentMode() {
    return this.hasAttribute('segment-start') && this._segmentEnd() != null;
  }
  _isAutoLoop() {
    const v = (this.getAttribute('auto-loop') || '').toLowerCase();
    return v === 'true' || v === '1' || v === '';  // bare attribute counts as on
  }

  _applySegmentBounds() {
    if (!this._audio || !this._isSegmentMode()) return;
    const start = this._segmentStart();
    const end = this._segmentEnd();
    // Snap currentTime into the new window.
    if (this._audio.currentTime < start || this._audio.currentTime >= end) {
      this._audio.currentTime = start;
    }
    this._$('scrub').min = start;
    this._$('scrub').max = end;
    this._updateTimeReadout();
  }

  _updateTimeReadout() {
    if (!this._audio) return;
    if (this._isSegmentMode()) {
      const start = this._segmentStart();
      const end = this._segmentEnd();
      const cur = Math.max(0, (this._audio.currentTime || 0) - start);
      const span = Math.max(0, end - start);
      this._$('time').textContent = `${_fmt(cur)} / ${_fmt(span)}`;
    } else {
      this._$('time').textContent =
        `${_fmt(this._audio.currentTime)} / ${_fmt(this._audio.duration)}`;
    }
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
      if (!this._isSegmentMode()) {
        this._$('scrub').max = hint;
        this._$('time').textContent = `0:00 / ${_fmt(hint)}`;
      }
    }
  }

  /**
   * Sprint 11.3 Bug 1 fix — drive icon visibility off audio.paused via
   * the `hidden` HTML attribute (not the IDL property). The IDL `hidden`
   * setter on SVG elements is flaky in some browsers; an explicit
   * setAttribute/removeAttribute always reflects to the CSS `[hidden]`
   * rule and produces the visible swap. Called from play+pause events
   * AND any state-changing entry point so the icon is always in sync.
   */
  _syncIcon() {
    if (!this._audio) return;
    const playEl = this._$('icon-play');
    const pauseEl = this._$('icon-pause');
    const btn = this._$('btn-play');
    if (!playEl || !pauseEl || !btn) return;
    if (this._audio.paused) {
      playEl.removeAttribute('hidden');
      pauseEl.setAttribute('hidden', '');
      btn.setAttribute('aria-label', 'Phát');
      btn.setAttribute('data-state', 'paused');
    } else {
      playEl.setAttribute('hidden', '');
      pauseEl.removeAttribute('hidden');
      btn.setAttribute('aria-label', 'Tạm dừng');
      btn.setAttribute('data-state', 'playing');
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
      // Segment mode: rewind to segment start (common dictation pattern).
      // Free mode: rewind 5s.
      const target = this._isSegmentMode()
        ? this._segmentStart()
        : Math.max(0, (this._audio.currentTime || 0) - 5);
      this._audio.currentTime = target;
      if (this._audio.paused) this._audio.play().catch(() => {});
    });

    this._$('scrub').addEventListener('input', (e) => {
      if (!this._audio) return;
      let t = Number(e.target.value);
      if (this._isSegmentMode()) {
        const start = this._segmentStart();
        const end = this._segmentEnd();
        if (t < start) t = start;
        if (t > end) t = end;
      }
      this._audio.currentTime = t;
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
      if (this._isSegmentMode()) {
        this._applySegmentBounds();
      } else {
        this._$('scrub').max = a.duration || 0;
      }
      this._updateTimeReadout();
    });

    a.addEventListener('timeupdate', () => {
      this._$('scrub').value = a.currentTime || 0;
      this._updateTimeReadout();
      // Segment auto-pause: stop at segment-end.
      if (this._isSegmentMode()) {
        const end = this._segmentEnd();
        if (a.currentTime >= end - 0.01 && !a.paused) {
          a.pause();
          a.currentTime = end;
          // Auto-loop: restart after a brief pause if configured.
          if (this._isAutoLoop()) {
            if (this._loopTimer) clearTimeout(this._loopTimer);
            this._loopTimer = setTimeout(() => {
              this._loopTimer = null;
              if (!this._audio) return;
              this._audio.currentTime = this._segmentStart();
              this._audio.play().catch(() => {});
            }, 500);
          }
        }
      }
    });

    a.addEventListener('play', () => {
      this._syncIcon();
      this._emit('av-audio-play');
    });

    a.addEventListener('pause', () => {
      this._syncIcon();
      this._emit('av-audio-pause');
    });

    a.addEventListener('ended', () => {
      this._syncIcon();
      this._emit('av-audio-ended');
    });

    a.addEventListener('error', () => {
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
