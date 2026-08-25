/**
 * Rollback implementation for the native Grammar exercise directory.
 *
 * The backend payload is the canonical source for category, level and article
 * metadata. Keep the initial anonymous render semantically aligned with the
 * Next route; signed-in mastery is a progressive enhancement.
 */
  function prettify(s) {
    return (s || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = { banks: [], mastery: {}, query: '', category: '', level: '' };

  function masteryLabel(status) {
    if (status === 'weak') return 'Cần luyện';
    if (status === 'strong') return 'Đã vững';
    return 'Đang học';
  }

  function render() {
    var query = state.query.trim().toLowerCase();
    var visible = state.banks.filter(function (bank) {
      var haystack = ((bank.title || '') + ' ' + (bank.summary || '')).toLowerCase();
      return (!query || haystack.indexOf(query) !== -1)
        && (!state.category || bank.category === state.category)
        && (!state.level || bank.level === state.level);
    });
    document.getElementById('ex-count').textContent = visible.length;
    document.getElementById('ex-grid').innerHTML = visible.map(function (bank) {
      var status = bank.slug ? state.mastery[bank.slug] : '';
      return '<a href="/quiz?bank=' + encodeURIComponent(bank.id) + '" class="gw-exercise-card">' +
        '<div class="gw-exercise-card-top"><span>' + esc(prettify(bank.category || 'Grammar')) + '</span>' +
        (status ? '<small class="is-' + esc(status) + '">' + masteryLabel(status) + '</small>' : '') + '</div>' +
        '<h2>' + esc(bank.title || bank.code) + '</h2>' +
        '<p>' + esc(bank.summary || 'Luyện đúng trọng tâm của bài Grammar Wiki này.') + '</p>' +
        '<div><span>' + esc(bank.level || 'mixed level') + '</span><strong>' +
        (bank.words_count ? esc(bank.words_count + ' điểm') : 'Bắt đầu') + ' →</strong></div></a>';
    }).join('');
    document.getElementById('ex-grid').classList.toggle('hidden', !visible.length);
    document.getElementById('ex-no-match').classList.toggle('hidden', !!visible.length);
  }

  function bindFilters() {
    var query = document.getElementById('ex-query');
    var category = document.getElementById('ex-category');
    var level = document.getElementById('ex-level');
    query.addEventListener('input', function () { state.query = query.value; render(); });
    category.addEventListener('change', function () { state.category = category.value; render(); });
    level.addEventListener('change', function () { state.level = level.value; render(); });
  }

  async function loadMastery() {
    try {
      var supabase = window.getSupabase && window.getSupabase();
      var session = supabase && await supabase.auth.getSession();
      if (!session || !session.data || !session.data.session) return;
      var data = await window.api.get('/api/me/kp-mastery?kp_type=grammar');
      state.mastery = Object.fromEntries(((data && data.items) || [])
        .filter(function (item) { return item.ref_slug; })
        .map(function (item) { return [item.ref_slug, item.status || 'learning']; }));
      render();
    } catch (_) {
      // Mastery is optional. Public practice discovery stays available.
    }
  }

export async function mount() {
  try {
    var data = await window.api.get('/api/grammar/exercises');
    state.banks = Array.isArray(data && data.banks) ? data.banks : [];
    document.getElementById('ex-skeleton').classList.add('hidden');
    if (!state.banks.length) {
      document.getElementById('ex-empty').classList.remove('hidden');
      return;
    }
    var categories = Array.from(new Set(state.banks.map(function (bank) { return bank.category; }).filter(Boolean))).sort();
    document.getElementById('ex-category').insertAdjacentHTML('beforeend', categories.map(function (category) {
      return '<option value="' + esc(category) + '">' + esc(prettify(category)) + '</option>';
    }).join(''));
    bindFilters();
    document.getElementById('ex-workspace').classList.remove('hidden');
    render();
    loadMastery();
  } catch (_) {
    document.getElementById('ex-skeleton').classList.add('hidden');
    document.getElementById('ex-error').classList.remove('hidden');
  }
}
