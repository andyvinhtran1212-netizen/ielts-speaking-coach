/**
 * frontend/js/admin-listening-render.js — Sprint 13.3
 * (DEBT-ADMIN-LISTENING-AUTHORING 3/N).
 *
 * Controller for /pages/admin/listening/render.html. Flow:
 *   1. Mount → GET /admin/listening/render/feature-flag.
 *      - enabled=false → render the 503 banner + message, hide the form.
 *      - enabled=true (or 401/network fail = fail-open) → reveal the form.
 *   2. Script field changes (debounced 500ms) → POST /render/validate to
 *      refresh the cost preview pills + inline issues.
 *   3. Voice card click → mark active + auto-sync accent dropdown.
 *   4. Model card click → mark active.
 *   5. "Kiểm tra trước khi render" → POST /render/validate, render issues,
 *      enable submit only when no errors.
 *   6. "Render & lưu draft" → POST /admin/listening/render with the full
 *      body. Server returns {content_id, estimated_render_seconds, …}.
 *      Frontend redirects to content-detail.html?id=<content_id>&
 *      just_rendered=true so Andy can watch the draft land.
 */

const SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();


const $ = (id) => document.getElementById(id);

const DEBOUNCE_MS = 500;

// Sarah → us_general, Alice → uk_rp. Voice card → accent sync.
const VOICE_TO_ACCENT = {
  'EXAVITQu4vr4xnSDxMaL': 'us_general',
  'Xb7hH8MSUJpSbSDYk0k2': 'uk_rp',
};

const STATE = {
  ffEnabled: null,
  voiceId:   'EXAVITQu4vr4xnSDxMaL',  // Sarah default
  model:     'eleven_multilingual_v2',
  debounceHandle: null,
};


function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


function showBanner(text, kind = 'error') {
  showToast(text, kind, { persist: true });
}


function hideBanner() {
  clearToasts();
}


// ── Feature-flag gate on mount ───────────────────────────────────────────────


async function checkFeatureFlag() {
  try {
    const res = await window.api.get('/admin/listening/render/feature-flag');
    STATE.ffEnabled = !!res.enabled;
    if (res.enabled) {
      $('rn-503-banner').hidden = true;
      $('rn-form').hidden = false;
    } else {
      $('rn-503-banner').hidden = false;
      $('rn-503-message').textContent = res.message || '';
      $('rn-form').hidden = true;
    }
  } catch (e) {
    // Fail-open: assume enabled so admin convenience doesn't suffer
    // from a transient FF endpoint hiccup. Server-side gate still blocks
    // the actual /render call.
    STATE.ffEnabled = true;
    $('rn-503-banner').hidden = true;
    $('rn-form').hidden = false;
  }
}


// ── Script stats + debounced cost preview ────────────────────────────────────


function countWords(s) {
  // Whitespace-split (NOT /[\w']+/ — \w is ASCII-only, so it shattered every
  // accented Vietnamese word into pieces: "Tôi yêu tiếng Việt" counted 8, not
  // 4). Trim + split on Unicode whitespace, which JS \s already covers —
  // including the non-breaking space ( ) common in pasted Vietnamese.
  // Matches the student-facing counters (writing-dashboard / writing-result).
  if (!s) return 0;
  var t = String(s).trim();
  return t ? t.split(/\s+/).length : 0;
}


function updateScriptStats() {
  const text = $('rn-script').value;
  $('rn-script-chars').textContent = String(text.length);
  $('rn-script-words').textContent = String(countWords(text));
}


function applyCostPreview(payload) {
  if (!payload) {
    $('rn-cost-credits').textContent = '— credits';
    $('rn-cost-usd').textContent     = '~ $—';
    $('rn-cost-secs').textContent    = 'render ~—s';
    return;
  }
  $('rn-cost-credits').textContent = `${payload.estimated_cost_credits ?? '—'} credits`;
  $('rn-cost-usd').textContent     = `~ $${(payload.estimated_cost_usd ?? 0).toFixed(4)}`;
  $('rn-cost-secs').textContent    = `render ~${payload.estimated_render_seconds ?? '—'}s`;
}


function readForm() {
  const tags = $('rn-tags').value.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    script_text:   $('rn-script').value,
    voice_id:      STATE.voiceId,
    model:         STATE.model,
    title:         $('rn-title').value.trim() || 'Untitled listening',
    accent_tag:    $('rn-accent').value,
    cefr_level:    $('rn-cefr').value,
    ielts_section: Number($('rn-section').value),
    topic_tags:    tags,
    is_premium:    $('rn-premium').checked,
  };
}


async function refreshCostPreview() {
  // Light call — only used to keep the cost pills fresh as Andy types.
  // The full validate (button) renders inline issues too.
  const body = readForm();
  if (!body.script_text || body.script_text.trim().length === 0) {
    applyCostPreview(null);
    return;
  }
  try {
    const res = await window.api.post('/admin/listening/render/validate', body);
    applyCostPreview(res);
  } catch {
    // Silent — preview is best-effort.
  }
}


function scheduleCostPreview() {
  if (STATE.debounceHandle) clearTimeout(STATE.debounceHandle);
  STATE.debounceHandle = setTimeout(refreshCostPreview, DEBOUNCE_MS);
}


// ── Voice + model picker ────────────────────────────────────────────────────


function setVoice(voiceId) {
  STATE.voiceId = voiceId;
  document.querySelectorAll('.rn-voice-card').forEach((card) => {
    const isMatch = card.dataset.voiceId === voiceId;
    card.classList.toggle('is-active', isMatch);
    card.setAttribute('aria-checked', isMatch ? 'true' : 'false');
  });
  // Auto-sync accent dropdown to match the voice's locked accent.
  const accent = VOICE_TO_ACCENT[voiceId];
  if (accent) {
    $('rn-accent').value = accent;
  }
  scheduleCostPreview();
}


function setModel(model) {
  STATE.model = model;
  document.querySelectorAll('.rn-model-card').forEach((card) => {
    const isMatch = card.dataset.model === model;
    card.classList.toggle('is-active', isMatch);
    card.setAttribute('aria-checked', isMatch ? 'true' : 'false');
  });
  scheduleCostPreview();
}


// ── Full validate (button) + issues rendering ────────────────────────────────


function renderIssues(errors, warnings) {
  const container = $('rn-issues');
  const parts = [];
  for (const e of (errors || [])) {
    parts.push(`<div class="rn-issue is-error" data-code="${escapeHtml(e.code)}">⚠ ${escapeHtml(e.message)}</div>`);
  }
  for (const w of (warnings || [])) {
    parts.push(`<div class="rn-issue is-warning" data-code="${escapeHtml(w.code)}">⚑ ${escapeHtml(w.message)}</div>`);
  }
  if (!parts.length) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.innerHTML = parts.join('');
  container.hidden = false;
}


async function onValidate() {
  hideBanner();
  $('rn-validate').disabled = true;
  try {
    const body = readForm();
    const res = await window.api.post('/admin/listening/render/validate', body);
    renderIssues(res.errors, res.warnings);
    applyCostPreview(res);
    $('rn-submit').disabled = !res.ok;
    if (res.ok && !(res.warnings || []).length) {
      showBanner('Validation passed — sẵn sàng render.', 'success');
    } else if (res.ok) {
      showBanner('Có warning nhưng vẫn render được.', 'info');
    } else {
      showBanner('Có lỗi validation — fix trước khi render.', 'error');
    }
  } catch (e) {
    showBanner(`Validate thất bại: ${e.message || e}`, 'error');
  } finally {
    $('rn-validate').disabled = false;
  }
}


// ── Submit render ───────────────────────────────────────────────────────────


function startCountdown(seconds) {
  const el = $('rn-countdown');
  const secsEl = $('rn-countdown-secs');
  let remaining = Math.max(1, Number(seconds) || 10);
  el.hidden = false;
  secsEl.textContent = String(remaining);
  const handle = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(handle);
      el.hidden = true;
    } else {
      secsEl.textContent = String(remaining);
    }
  }, 1000);
  return handle;
}


async function onSubmit() {
  hideBanner();
  $('rn-submit').disabled = true;
  $('rn-validate').disabled = true;
  const body = readForm();
  let countdownHandle = null;
  try {
    const res = await window.api.post('/admin/listening/render', body);
    countdownHandle = startCountdown(res.estimated_render_seconds || 10);
    const contentId = res.content_id || res.job_id;
    if (!contentId) {
      showBanner('Render trả về dạng không hợp lệ — thiếu content_id.', 'error');
      return;
    }
    // Redirect with ?just_rendered=true so content-detail.html shows the
    // post-render banner + auto-poll for the draft row to land.
    window.location.href =
      `/pages/admin/listening/content-detail.html?id=${encodeURIComponent(contentId)}&just_rendered=true`;
  } catch (e) {
    if (countdownHandle) clearInterval(countdownHandle);
    $('rn-countdown').hidden = true;
    showBanner(`Render thất bại: ${e.message || e}`, 'error');
    $('rn-submit').disabled = false;
  } finally {
    $('rn-validate').disabled = false;
  }
}


// ── Wire ────────────────────────────────────────────────────────────────────


function wire() {
  $('rn-script').addEventListener('input', () => {
    updateScriptStats();
    scheduleCostPreview();
  });

  // Voice picker — click + keyboard.
  document.querySelectorAll('.rn-voice-card').forEach((card) => {
    const pick = () => setVoice(card.dataset.voiceId);
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
  });

  // Model picker — click + keyboard.
  document.querySelectorAll('.rn-model-card').forEach((card) => {
    const pick = () => setModel(card.dataset.model);
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
  });

  // Accent dropdown override — keep STATE in sync but don't snap voice.
  $('rn-accent').addEventListener('change', scheduleCostPreview);
  $('rn-cefr').addEventListener('change', scheduleCostPreview);
  $('rn-section').addEventListener('change', scheduleCostPreview);

  $('rn-validate').addEventListener('click', onValidate);
  $('rn-submit').addEventListener('click', onSubmit);
}


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    wire();
    updateScriptStats();
    await checkFeatureFlag();
  });
}
