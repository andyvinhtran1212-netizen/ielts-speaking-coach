/*
 * admin-exam-content.js — "Đề kỳ thi": cấp khoá học + lớp (Đợt 3).
 *
 * Lives ON the Full Test admin page rather than in a page of its own: this table
 * exists to answer "which paper for which class" at the exact moment the admin
 * is picking one. A separate page is one more place to remember, and the thing
 * it was meant to replace was remembering.
 *
 * Reads /admin/exam-content, which spans all three libraries (reading tests,
 * listening tests, writing prompts) so the question can be asked ACROSS them.
 */
(function () {
  'use strict';

  var KIND_LABEL = { reading: 'Reading', listening: 'Listening', writing: 'Writing' };
  var _cohorts = [];          // [{id, name}]
  var _rows = [];
  var _level = null;          // tab đang chọn: null = tất cả, '' = chưa đặt
  // A literal U+0000 was used here, but the HTML parser rewrites NULL to U+FFFD,
  // so getAttribute() could never match it and "Tất cả" filtered to nothing.
  // course_level is free text, so the sentinel must be a value it cannot hold —
  // a level with surrounding underscores is not one an admin types.
  var ALL_TABS = '__all__';

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return (window.WC && window.WC.escapeHtml)
      ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s);
  }

  function cohortName(id) {
    for (var i = 0; i < _cohorts.length; i++) {
      if (String(_cohorts[i].id) === String(id)) return _cohorts[i].name || _cohorts[i].id;
    }
    return id;
  }

  function fillSelect(sel, items, valueOf, labelOf, keepFirst) {
    if (!sel) return;
    var cur = sel.value;
    var head = keepFirst && sel.options.length ? sel.options[0].outerHTML : '';
    sel.innerHTML = head + items.map(function (it) {
      return '<option value="' + esc(valueOf(it)) + '">' + esc(labelOf(it)) + '</option>';
    }).join('');
    sel.value = cur;
  }

  // ── Load ────────────────────────────────────────────────────────────
  async function load() {
    var host = el('ec-list');
    if (!host) return;
    host.textContent = 'Đang tải…';
    var qs = [];
    if (el('ec-kind').value) qs.push('kind=' + encodeURIComponent(el('ec-kind').value));
    if (el('ec-level').value) qs.push('course_level=' + encodeURIComponent(el('ec-level').value));
    if (el('ec-cohort').value) qs.push('cohort_id=' + encodeURIComponent(el('ec-cohort').value));
    if (el('ec-exam-only').checked) qs.push('exam_only=true');
    try {
      var d = await window.api.get('/admin/exam-content' + (qs.length ? '?' + qs.join('&') : ''));
      _rows = d.items || [];
      fillSelect(el('ec-level'), d.levels || [],
                 function (l) { return l; }, function (l) { return l; }, true);
      // NAME the library that failed. Rendering a short list silently is exactly
      // how an admin picks a paper from incomplete data without knowing.
      var warn = el('ec-warn');
      var failed = d.failed_kinds || [];
      if (warn) {
        warn.hidden = !failed.length;
        warn.textContent = failed.length
          ? '⚠ Không tải được: ' + failed.map(function (k) { return KIND_LABEL[k] || k; }).join(', ')
            + '. Danh sách dưới đây THIẾU các đề đó — đừng chọn đề khi chưa tải lại được.'
          : '';
      }
      renderTabs();
      render();
    } catch (e) {
      host.innerHTML = '<span style="color:var(--av-error)">Lỗi tải: '
        + esc(e && e.message) + '</span>';
    }
  }

  // Tabs are DERIVED from the data, never listed in code: course_level is free
  // text on purpose (a CHECK would need a migration per new course), so a
  // hardcoded tab strip would go stale the first time a course is added.
  function renderTabs() {
    var host = el('ec-tabs');
    if (!host) return;
    var levels = [];
    _rows.forEach(function (r) {
      var v = r.course_level || '';
      if (levels.indexOf(v) === -1) levels.push(v);
    });
    levels.sort(function (a, b) {
      if (a === '') return 1;          // "chưa đặt" always last
      if (b === '') return -1;
      return a.localeCompare(b);
    });
    var tab = function (val, label, count) {
      var on = (_level === val) || (_level === null && val === null);
      return '<button type="button" class="ec-tab' + (on ? ' is-active' : '') + '"'
        + ' data-level="' + (val === null ? ALL_TABS : esc(val)) + '">'
        + esc(label) + ' <span class="me-muted">(' + count + ')</span></button>';
    };
    var html = tab(null, 'Tất cả', _rows.length);
    levels.forEach(function (v) {
      var n = _rows.filter(function (r) { return (r.course_level || '') === v; }).length;
      html += tab(v, v || 'Chưa đặt cấp khoá', n);
    });
    host.innerHTML = html;
    host.querySelectorAll('.ec-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-level');
        _level = (v === ALL_TABS) ? null : v;
        renderTabs(); render();
      });
    });
  }

  function visibleRows() {
    if (_level === null) return _rows;
    return _rows.filter(function (r) { return (r.course_level || '') === _level; });
  }

  function render() {
    var host = el('ec-list');
    var rows = visibleRows();
    if (!rows.length) { host.textContent = 'Không có đề nào khớp bộ lọc.'; return; }
    host.innerHTML = '<table class="adm-table"><thead><tr>'
      + '<th>Kỹ năng</th><th>Mã / Tiêu đề</th><th>Trạng thái</th>'
      + '<th>Cấp khoá</th><th>Lớp</th><th></th></tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr data-kind="' + esc(r.kind) + '" data-id="' + esc(r.id) + '">'
          + '<td>' + esc(KIND_LABEL[r.kind] || r.kind) + '</td>'
          + '<td>' + (r.code ? '<code>' + esc(r.code) + '</code> ' : '') + esc(r.title || '') + '</td>'
          + '<td>' + esc(r.status || '') + '</td>'
          + '<td><input class="ec-level-in" style="width:90px" value="'
            + esc(r.course_level || '') + '" placeholder="C2"></td>'
          + '<td class="ec-cohorts">' + (r.cohort_ids || []).map(function (c) {
              return '<span class="me-chip">' + esc(cohortName(c)) + '</span>';
            }).join(' ') + '</td>'
          + '<td><button type="button" class="av-btn ec-edit">Sửa lớp</button> '
          // Unchecking "chỉ đề dành cho kỳ thi" loads library rows too. Labelling
          // those "Trả về thư viện" tells the admin they are reserved when they
          // are not, and confirms an operation that changes nothing.
          +     (r.exam_only
                  ? '<button type="button" class="av-btn ec-release">Trả về thư viện</button>'
                  : '<span class="me-muted">Đang ở thư viện</span>') + '</td>'
          + '</tr>';
      }).join('') + '</tbody></table>';

    host.querySelectorAll('.ec-level-in').forEach(function (inp) {
      inp.addEventListener('change', function () { saveLevel(inp); });
    });
    host.querySelectorAll('.ec-edit').forEach(function (b) {
      b.addEventListener('click', function () { editCohorts(b.closest('tr')); });
    });
    host.querySelectorAll('.ec-release').forEach(function (b) {
      b.addEventListener('click', function () { releaseToLibrary(b.closest('tr')); });
    });
  }

  function rowKey(tr) {
    return { kind: tr.getAttribute('data-kind'), id: tr.getAttribute('data-id') };
  }

  async function saveLevel(inp) {
    var k = rowKey(inp.closest('tr'));
    try {
      await window.api.patch(
        '/admin/exam-content/' + encodeURIComponent(k.kind) + '/'
          + encodeURIComponent(k.id) + '/level',
        { course_level: inp.value.trim() });
      if (window.toast) toast('Đã lưu cấp khoá.');
      load();                       // refetch: the level list may have grown
    } catch (e) {
      if (window.toast) toast('Lưu cấp khoá thất bại: ' + (e && e.message));
    }
  }

  // Whole-set editing, because the endpoint REPLACES the set — offering
  // "add one" here would misdescribe what the server does.
  async function editCohorts(tr) {
    var k = rowKey(tr);
    var row = null;
    for (var i = 0; i < _rows.length; i++) {
      if (_rows[i].kind === k.kind && String(_rows[i].id) === String(k.id)) row = _rows[i];
    }
    var current = (row && row.cohort_ids) || [];
    var listed = _cohorts.map(function (c, i) {
      return (i + 1) + '. ' + (c.name || c.id) + (current.indexOf(String(c.id)) !== -1 ? ' ✓' : '');
    }).join('\n');
    var picked = prompt(
      'Lớp dùng đề này — nhập các SỐ, cách nhau bằng dấu phẩy.\n'
      + 'Để trống = không lớp nào. Danh sách này THAY THẾ toàn bộ lựa chọn cũ.\n\n'
      + listed, '');
    if (picked === null) return;    // cancelled — not "clear everything"
    var ids = picked.split(',').map(function (n) {
      var idx = parseInt(n.trim(), 10) - 1;
      return (idx >= 0 && _cohorts[idx]) ? String(_cohorts[idx].id) : null;
    }).filter(Boolean);
    try {
      await window.api.patch(
        '/admin/exam-content/' + encodeURIComponent(k.kind) + '/'
          + encodeURIComponent(k.id) + '/cohorts',
        { cohort_ids: ids });
      if (window.toast) toast('Đã lưu lớp.');
      load();
    } catch (e) {
      if (window.toast) toast('Lưu lớp thất bại: ' + (e && e.message));
    }
  }


  // Hand a paper back to the student library. Refused server-side (409) while a
  // non-archived exam still binds it — NOT pre-checked here, because a second
  // copy of that rule in the browser is the copy that goes stale.
  var RELEASE_URL = {
    reading:   function (id) { return '/admin/reading/content/tests/' + encodeURIComponent(id) + '/exam-only'; },
    listening: function (id) { return '/admin/listening/tests/' + encodeURIComponent(id); },
    writing:   function (id) { return '/admin/writing/prompts/' + encodeURIComponent(id); },
  };

  async function releaseToLibrary(tr) {
    var k = rowKey(tr);
    var row = null;
    for (var i = 0; i < _rows.length; i++) {
      if (_rows[i].kind === k.kind && String(_rows[i].id) === String(k.id)) row = _rows[i];
    }
    if (!window.confirm(
      'Trả "' + ((row && (row.code || row.title)) || k.id) + '" về thư viện luyện tập?\n\n'
      + 'Học viên sẽ luyện được đề này. Nếu nó từng dùng cho một kỳ thi ĐÃ LƯU TRỮ, '
      + 'khoá sau có thể luyện đúng đề khoá trước vừa thi.')) return;
    try {
      // Reading is keyed by its human test_id everywhere on its admin surface;
      // the other two take the UUID.
      var idForUrl = (k.kind === 'reading' && row && row.code) ? row.code : k.id;
      if (k.kind === 'reading') {
        await window.api.post(RELEASE_URL.reading(idForUrl), { exam_only: false });
      } else {
        await window.api.patch(RELEASE_URL[k.kind](idForUrl), { exam_only: false });
      }
      if (window.toast) toast('Đã trả về thư viện.');
      load();
    } catch (e) {
      if (window.toast) toast('Không trả về được: ' + (e && e.message ? e.message : e));
    }
  }

  // ── Boot ────────────────────────────────────────────────────────────
  async function boot() {
    if (!document.getElementById('ec-list')) return;   // not this page
    try {
      var res = await window.api.get('/admin/cohorts?is_active=true');
      _cohorts = Array.isArray(res) ? res : ((res && (res.items || res.cohorts)) || []);
      fillSelect(el('ec-cohort'), _cohorts,
                 function (c) { return c.id; },
                 function (c) { return c.name || c.id; }, true);
    } catch (e) { /* the table still works without the class filter */ }
    ['ec-kind', 'ec-level', 'ec-cohort', 'ec-exam-only'].forEach(function (id) {
      var e2 = el(id); if (e2) e2.addEventListener('change', load);
    });
    var rl = el('ec-reload'); if (rl) rl.addEventListener('click', load);
    load();
  }
  boot();
})();
