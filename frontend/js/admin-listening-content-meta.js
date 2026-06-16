/**
 * frontend/js/admin-listening-content-meta.js — Sprint 13.1
 * (DEBT-ADMIN-LISTENING-AUTHORING 1/N).
 *
 * Edit form for the 9 editable metadata fields. Loads the row via the
 * existing admin GET, lets admin edit, and PATCHes the deltas back.
 * Client-side validation mirrors the backend allow-list + premium+NC
 * combo rule so the user never round-trips for a known-bad payload.
 *
 * Endpoints:
 *   GET   /admin/listening/content/{id}
 *   PATCH /admin/listening/content/{id}
 */

const SUPABASE_URL  = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();


const $ = (id) => document.getElementById(id);


const ACCENTS = new Set(['us_general', 'uk_rp', 'au', 'ca', 'other']);
const CEFRS   = new Set(['A2', 'B1', 'B2', 'C1', 'C2']);


const STATE = {
  contentId: null,
  current:   null,
};


function getIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return (sp.get('id') || '').trim() || null;
}


function showBanner(text, kind = 'success') {
  showToast(text, kind, { persist: true });
}


function hydrateForm(row) {
  $('mta-title').value      = row.title || '';
  $('mta-transcript').value = row.transcript || '';
  $('mta-accent').value     = ACCENTS.has(row.accent_tag) ? row.accent_tag : 'us_general';
  $('mta-cefr').value       = CEFRS.has(row.cefr_level)   ? row.cefr_level : 'B2';
  $('mta-section').value    = String(row.ielts_section || 1);
  $('mta-tags').value       = (row.topic_tags || []).join(', ');
  $('mta-premium').checked  = !!row.is_premium;
  $('mta-license').value    = row.external_license    || '';
  $('mta-source-url').value = row.external_source_url || '';
}


function buildPatchBody() {
  const tags = $('mta-tags').value
    .split(',').map((s) => s.trim()).filter(Boolean);
  return {
    title:               $('mta-title').value.trim(),
    transcript:          $('mta-transcript').value,
    accent_tag:          $('mta-accent').value,
    cefr_level:          $('mta-cefr').value,
    ielts_section:       Number($('mta-section').value),
    topic_tags:          tags,
    is_premium:          $('mta-premium').checked,
    external_license:    $('mta-license').value.trim() || null,
    external_source_url: $('mta-source-url').value.trim() || null,
  };
}


function validateClientSide(body) {
  // Mirror backend allow-list. The selects already constrain accent
  // and cefr to enum values, but a hand-crafted POST could bypass —
  // be defensive.
  if (!body.title) return 'Title không được rỗng.';
  if (!body.transcript || !body.transcript.trim()) return 'Transcript không được rỗng.';
  if (!ACCENTS.has(body.accent_tag)) return `accent_tag không hợp lệ: ${body.accent_tag}`;
  if (!CEFRS.has(body.cefr_level))   return `cefr_level không hợp lệ: ${body.cefr_level}`;
  if (!(body.ielts_section >= 1 && body.ielts_section <= 4)) {
    return 'ielts_section phải nằm 1-4.';
  }
  if (body.external_license && !body.external_source_url) {
    return 'Có external_license thì phải có external_source_url (attribution rule).';
  }
  if (body.is_premium && body.external_license && /NC/.test(body.external_license)) {
    return 'Không thể đánh dấu nội dung NC-licensed là premium (Sprint 11.0 §4E).';
  }
  return null;
}


async function load() {
  const id = getIdFromUrl();
  if (!id) {
    showBanner('Thiếu ?id trong URL.', 'error');
    return;
  }
  STATE.contentId = id;
  const backLink = $('mta-back-link');
  const cancelLink = $('mta-cancel-link');
  const detailHref = `/pages/admin/listening/content-detail.html?id=${encodeURIComponent(id)}`;
  if (backLink) backLink.href = detailHref;
  if (cancelLink) cancelLink.href = detailHref;

  try {
    const row = await window.api.get(`/admin/listening/content/${encodeURIComponent(id)}`);
    STATE.current = row;
    hydrateForm(row);
  } catch (e) {
    showBanner(`Tải bài thất bại: ${e.message || e}`, 'error');
  }
}


async function onSubmit(e) {
  e.preventDefault();
  if (!STATE.contentId) return;

  const body = buildPatchBody();
  const err = validateClientSide(body);
  if (err) {
    showBanner(err, 'error');
    return;
  }

  $('btn-save').disabled = true;
  try {
    const updated = await window.api.patch(
      `/admin/listening/content/${encodeURIComponent(STATE.contentId)}`,
      body,
    );
    STATE.current = { ...STATE.current, ...updated };
    showBanner('Đã lưu metadata. Đang chuyển về trang chi tiết…', 'success');
    setTimeout(() => {
      window.location.href = `/pages/admin/listening/content-detail.html?id=${encodeURIComponent(STATE.contentId)}`;
    }, 800);
  } catch (e) {
    showBanner(`Lưu thất bại: ${e.message || e}`, 'error');
  } finally {
    $('btn-save').disabled = false;
  }
}


function wire() {
  const form = $('mta-form');
  if (form) form.addEventListener('submit', onSubmit);
}


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    wire();
    load();
  });
}
