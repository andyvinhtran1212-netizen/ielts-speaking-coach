/**
 * Trang "Nhận xét Speaking" — nhận xét chi tiết của giáo viên chấm.
 *
 * TÁCH RA TỪ MÃ INLINE của `pages/speaking-result.html` khi port sang Next
 * (không đổi một dòng logic nào). Bản Next chạy CHÍNH mã này, không chép lại.
 *
 * KHÔNG tự gọi `initSupabase`: bản legacy gọi ngay trước `mount()`, bản Next để
 * `AuthedShell` lo — cùng khuôn `/js/full-test.js`, `/js/vocab-practice.js`.
 */
  var $ = function (id) { return document.getElementById(id); };
  function showState(name) {
    ['loading', 'error', 'content'].forEach(function (s) {
      $('state-' + s).classList.toggle('hidden', s !== name);
    });
  }
  function fmtBand(v) { return (v == null || v === '') ? '—' : Number(v).toFixed(1); }
  function div(cls, text, parent) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;   // authored content — never innerHTML
    if (parent) parent.appendChild(d);
    return d;
  }

  function render(spk) {
    var host = $('spr-body');
    var meta = spk.meta || {};
    $('spr-meta').textContent = [meta.parts, meta.duration ? ('Bài thi dài ' + meta.duration) : null]
      .filter(Boolean).join(' · ');
    if (spk.intro) div('spr-quote', spk.intro, host);

    var h = div('spr-h2', 'Band theo từng tiêu chí', host); void h;
    var CRIT = [['fc', 'Fluency & Coherence'], ['lr', 'Lexical Resource'],
                ['gra', 'Grammar'], ['p', 'Pronunciation']];
    var grid = div('spr-band-grid', null, host);
    CRIT.forEach(function (c) {
      var b = (spk.bands || {})[c[0]];
      if (b == null) return;
      var cell = div('spr-band', null, grid);
      div('spr-band-label', c[1], cell);
      div('spr-band-val', fmtBand(b), cell);
      var m = div('spr-band-meter', null, cell);
      m.setAttribute('aria-hidden', 'true');
      var fill = document.createElement('span');
      fill.style.width = Math.round(Math.min(9, Math.max(0, Number(b))) / 9 * 100) + '%';
      m.appendChild(fill);
    });

    var metrics = spk.metrics || [];
    if (metrics.length) {
      div('spr-h2', 'Số đo từ bản ghi buổi thi', host);
      var tbl = document.createElement('table'); tbl.className = 'spr-metrics';
      var tr0 = tbl.insertRow();
      ['', 'Của bạn', 'Trung bình lớp'].forEach(function (t) {
        var th = document.createElement('th'); th.textContent = t; tr0.appendChild(th);
      });
      metrics.forEach(function (mrow) {
        var tr = tbl.insertRow();
        [mrow.label, mrow.value, mrow.class_avg].forEach(function (t) {
          tr.insertCell().textContent = t == null ? '—' : t;
        });
      });
      host.appendChild(tbl);
    }

    if ((spk.sections || []).length) div('spr-h2', 'Nhận xét & cách luyện', host);
    (spk.sections || []).forEach(function (sec) {
      var box = div('spr-note', null, host);
      div('spr-note__title', sec.title, box);
      if (sec.body) div('spr-note__body', sec.body, box);
      if (sec.advice) div('spr-note__advice', 'Cách luyện: ' + sec.advice, box);
    });
  }

  async function boot() {
    var sittingId = new URLSearchParams(location.search).get('sitting');
    if (!sittingId) { $('state-error').textContent = 'Thiếu mã lượt thi.'; showState('error'); return; }
    $('back-link').href = '/mock/result?sitting=' + encodeURIComponent(sittingId);
    try {
      var data = await window.api.get('/api/mock-exams/sittings/' + encodeURIComponent(sittingId) + '/result');
      var spk = (data.per_skill_notes || {}).speaking;
      if (!spk || typeof spk !== 'object') {
        $('state-error').textContent = 'Lượt thi này không có nhận xét Speaking.'; showState('error'); return;
      }
      render(spk);
      showState('content');
    } catch (e) {
      $('state-error').textContent = 'Không tải được nhận xét: ' + (e && e.message ? e.message : e);
      showState('error');
    }
  }

export async function mount() {
  await boot();
}
