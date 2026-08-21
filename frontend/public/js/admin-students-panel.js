/**
 * frontend/js/admin-students-panel.js — bảng Học viên trong trang gộp
 * "Lớp & Học viên" (GĐ 1b).
 *
 * Kế hoạch: docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md
 *
 * MOVED VERBATIM from the inline <script> of /pages/admin/students/index.html.
 * The logic is unchanged — same functions, same element ids, same endpoints — so
 * that this step is a relocation, reviewable as one, and not a rewrite of 500
 * lines of working code (search, CSV import, bulk assign-to-class, and the
 * per-student drawer with writing + listening progress).
 *
 * Exactly two things differ from the original, both forced by the merge:
 *
 *   1. The whole thing is wrapped in an IIFE. As an inline page script it leaked
 *      ~20 names onto window; sharing a document with admin-classes.js, that is
 *      an accident waiting to happen.
 *
 *   2. `_boot()` no longer runs on load. It is exposed as
 *      window.AdminStudentsPanel.init and called by admin-classes.js when the
 *      Học viên tab is first opened — the Lớp tab must not pay for
 *      /admin/students + /admin/cohorts it never renders.
 *
 * The auth gate inside _boot() is unchanged and still reveals #state-ready /
 * #state-denied; those elements now live inside the Học viên panel, so a
 * non-admin sees the same refusal in the same words.
 */

(function () {
    'use strict';

    var SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
    var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

    var _editingId = null;  // null = creating new
    var _searchValue = '';
    var _selectedIds = new Set();   // WF-1 bulk-assign selection
    var _cohortsLoaded = false;
    var _drawerCohortName = '';     // cohort_name from the clicked row (detail endpoint lacks it)
    var _drawerLastFocus = null;    // element to restore focus to when the drawer closes
    var _editorLastFocus = null;    // element to restore after create/edit closes
    var _studentReqSeq = 0;         // stale searches must not overwrite newer results/KPIs
    var _TASK_LABELS = { task1_academic: 'Task 1 (Academic)', task1_general: 'Task 1 (General)', task2: 'Task 2' };

    // ── Local helpers (replace the removed WC.* utilities) ──────
    function esc(s) {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    function debounce(fn, ms) {
      var t = null;
      return function () {
        var args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(ctx, args); }, ms || 250);
      };
    }
    function _show(id) { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
    function _hide(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); }

    function setAlert(kind, msg) {
      if (kind === 'error') showToast(msg, 'error', { persist: true });
      else showToast(msg, kind === 'success' ? 'success' : 'warn', { timeout: 4000 });
    }

    /**
     * MỘT ô cho cả mục tiêu, mức hiện tại và hạn đích.
     *
     * Ba cột riêng đo được trên prod là RỖNG 44/44 — 237px bề ngang không mang
     * một chữ nào, trong khi cột Họ tên chỉ có 155px. Nhưng ba trường ấy có
     * thật: sửa được trong hộp thoại và hiện trong ngăn kéo, chỉ là chưa ai
     * nhập. Xoá chúng khỏi bảng là bịt luôn đường đọc khi có dữ liệu, nên gộp
     * chứ không xoá.
     *
     * Chưa đặt gì thì một dấu gạch, không phải ba — "—  —  —" đọc ra là ba thứ
     * đang hỏng, chứ không phải một mục tiêu chưa đặt.
     */
    function goalCell(r) {
      var t = r.target_band, c = r.current_band_estimate, d = r.target_date;
      if (t == null && c == null && !d) return '<span class="st-none">—</span>';
      // `c` là mức ước lượng HIỆN TẠI, `t` là đích. Mũi tên đọc được ngay là
      // "đang ở đây, cần tới đó" — hai con số trần cạnh nhau thì không.
      var band = (c == null ? '?' : c) + ' → ' + (t == null ? '?' : t);
      return '<b class="st-goal">' + esc(band) + '</b>'
        + (d ? '<small class="st-goal-date">' + esc(d) + '</small>' : '');
    }

    function renderRows(rows) {
      var tb = document.getElementById('students-tbody');
      // Each (re)load starts with a clean selection — ids from a prior list
      // may no longer be present after a search/refresh.
      _selectedIds.clear();
      updateBulkBar();
      var sa = document.getElementById('bulk-select-all');
      if (sa) sa.checked = false;
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var in90Days = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
      // Canonical truth is the active membership array. The legacy pointer is
      // only a rollout fallback; lookup failure must never look unassigned.
      var unassigned = rows.filter(function (r) {
        return !(r.cohorts || []).length && !r.cohort_id && !r.membership_lookup_failed;
      }).length;
      var upcoming = rows.filter(function (r) {
        if (!r.target_date) return false;
        var d = new Date(r.target_date + 'T00:00:00');
        return !isNaN(d.getTime()) && d >= today && d <= in90Days;
      }).length;
      document.getElementById('student-kpi-total').textContent = rows.length;
      document.getElementById('student-kpi-unassigned').textContent = unassigned;
      document.getElementById('student-kpi-upcoming').textContent = upcoming;
      document.getElementById('row-count').textContent = rows.length === 200
        ? '200+ học viên — thu hẹp tìm kiếm để đếm chính xác'
        : rows.length + ' học viên trong kết quả';
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="6" class="st-empty">Chưa có học viên.</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(function (r) {
        var code  = esc(r.student_code);
        var name  = esc(r.full_name);
        var cohortNames = (r.cohorts || []).map(function (item) { return item.name; }).filter(Boolean);
        var legacyLop = r.cohort_name ? esc(r.cohort_name) : '—';
        var lop   = cohortNames.length ? esc(cohortNames.join(', '))
          : r.membership_lookup_failed ? '⚠ lookup failed' : legacyLop;
        var goal  = goalCell(r);
        var checked = _selectedIds.has(r.id) ? ' checked' : '';
        var cohortAttr = esc(cohortNames.join(', ') || r.cohort_name || '');
        return '<tr>' +
          '<td class="th-check"><input type="checkbox" class="row-check" aria-label="Chọn ' + name + '" data-id="' + esc(r.id) + '"' + checked + ' /></td>' +
          '<td class="code-cell">' + code + '</td>' +
          // `aria-label` nói ra VIỆC, không chỉ tên. Nút "Tổng quan" bên phải đã
          // gỡ (nó trùng nút này), nên với người đọc màn hình cái tên trần là
          // tất cả những gì còn lại — nghe "Chinh Le, nút" thì không biết bấm
          // vào sẽ ra gì (codex cục bộ 07/08).
          '<td><button class="st-namebtn" data-act="summary" aria-label="Xem tổng quan của ' + name + '" data-id="' + esc(r.id) + '" data-name="' + name + '" data-cohort="' + cohortAttr + '">' + name + '</button></td>' +
          '<td>' + lop + '</td>' +
          '<td class="goal-cell">' + goal + '</td>' +
          // Nút "Tổng quan" đã gỡ: nó mang ĐÚNG `data-act="summary"` với đúng
          // bộ dữ liệu như nút tên ngay bên trái — hai nút cùng một việc, nhân
          // lên 44 hàng. Bỏ nó là cột Thao tác hết phải xuống hai dòng.
          '<td><div class="st-row-actions">' +
            '<button class="adm-btn-secondary" data-act="essay" data-id="' + esc(r.id) + '">Giao bài viết</button>' +
            '<button class="adm-btn-secondary" data-act="edit" data-id="' + esc(r.id) + '">Sửa</button>' +
            '<button class="adm-btn-danger" data-act="delete" data-id="' + esc(r.id) + '" data-code="' + code + '">Xoá</button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
    }

    // ── WF-1 bulk-assign-to-cohort ───────────────────────────────────
    function updateBulkBar() {
      var bar = document.getElementById('bulk-bar');
      if (!bar) return;
      bar.hidden = _selectedIds.size === 0;
      var c = document.getElementById('bulk-count');
      if (c) c.textContent = _selectedIds.size + ' đã chọn';
    }

    async function populateBulkCohorts() {
      if (_cohortsLoaded) return;
      var sel = document.getElementById('bulk-cohort');
      try {
        var res = await window.api.get('/admin/cohorts');
        var cohorts = (res && res.cohorts) || [];
        sel.innerHTML = '<option value="">— Chọn lớp —</option>'
          + cohorts.map(function (c) {
              return '<option value="' + esc(c.id) + '">' + esc(c.name || '(Lớp)') + '</option>';
            }).join('');
        _cohortsLoaded = true;
      } catch (e) {
        sel.innerHTML = '<option value="">Không tải được lớp</option>';
      }
    }

    async function doBulkAssign() {
      var cohortId = document.getElementById('bulk-cohort').value;
      if (!cohortId) { setAlert('error', 'Chọn lớp để gán.'); return; }
      if (!_selectedIds.size) { setAlert('error', 'Chọn ít nhất 1 học viên.'); return; }
      var ids = Array.from(_selectedIds);
      var btn = document.getElementById('bulk-assign');
      btn.disabled = true;
      try {
        var r = await window.api.post(
          '/admin/cohorts/' + encodeURIComponent(cohortId) + '/students/bulk',
          { student_ids: ids });
        setAlert('success', 'Đã gán ' + (r.assigned != null ? r.assigned : ids.length) + ' học viên vào lớp.');
        loadStudents();   // refetch → cột Lớp + selection reset (canonical state)
      } catch (e) {
        setAlert('error', 'Gán lớp thất bại: ' + (e.message || e));
      } finally {
        btn.disabled = false;
      }
    }

    async function loadStudents() {
      var seq = ++_studentReqSeq;
      var tb = document.getElementById('students-tbody');
      tb.innerHTML = '<tr><td colspan="8" class="st-empty">Đang tải danh sách học viên…</td></tr>';
      document.getElementById('row-count').textContent = 'Đang tải…';
      try {
        var path = '/admin/students?limit=200';
        if (_searchValue) path += '&search=' + encodeURIComponent(_searchValue);
        var rows = await window.api.get(path);
        if (seq !== _studentReqSeq) return;
        renderRows(rows || []);
      } catch (e) {
        if (seq !== _studentReqSeq) return;
        setAlert('error', 'Không tải được danh sách: ' + e.message);
        document.getElementById('student-kpi-total').textContent = '—';
        document.getElementById('student-kpi-unassigned').textContent = '—';
        document.getElementById('student-kpi-upcoming').textContent = '—';
        document.getElementById('row-count').textContent = 'Chưa đọc được dữ liệu';
        tb.innerHTML = '<tr><td colspan="8" class="st-empty">Không đọc được danh sách học viên. '
          + '<button class="adm-btn-secondary" type="button" data-act="retry">Thử lại</button></td></tr>';
      }
    }

    function openModal(student) {
      if (!_editorLastFocus) _editorLastFocus = document.activeElement;
      _editingId = student ? student.id : null;
      document.getElementById('modal-title').textContent = student ? 'Sửa học viên' : 'Học viên mới';
      document.getElementById('f-code').value         = student ? student.student_code : '';
      document.getElementById('f-name').value         = student ? student.full_name    : '';
      document.getElementById('f-target-band').value  = student && student.target_band  != null ? student.target_band  : '';
      document.getElementById('f-current-band').value = student && student.current_band_estimate != null ? student.current_band_estimate : '';
      document.getElementById('f-target-date').value  = student ? (student.target_date  || '') : '';
      document.getElementById('f-notes').value        = student ? (student.persona_notes || '') : '';
      document.getElementById('modal').classList.remove('hidden');
      document.getElementById('f-code').focus();
    }
    function closeModal() {
      document.getElementById('modal').classList.add('hidden');
      _editingId = null;
      if (_editorLastFocus && typeof _editorLastFocus.focus === 'function') {
        try { _editorLastFocus.focus(); } catch (e) { /* opener may have been replaced */ }
      }
      _editorLastFocus = null;
    }

    async function handleSave(e) {
      e.preventDefault();
      var saveBtn = document.getElementById('btn-save');
      var payload = {
        student_code: document.getElementById('f-code').value.trim(),
        full_name:    document.getElementById('f-name').value.trim(),
      };
      var tb = document.getElementById('f-target-band').value.trim();
      var cb = document.getElementById('f-current-band').value.trim();
      var td = document.getElementById('f-target-date').value;
      var notes = document.getElementById('f-notes').value.trim();
      if (tb !== '') payload.target_band = parseFloat(tb);
      if (cb !== '') payload.current_band_estimate = parseFloat(cb);
      if (td)        payload.target_date = td;
      if (notes)     payload.persona_notes = notes;

      saveBtn.disabled = true;
      try {
        if (_editingId) {
          await window.api.patch('/admin/students/' + _editingId, payload);
          setAlert('success', 'Đã cập nhật học viên.');
        } else {
          await window.api.post('/admin/students', payload);
          setAlert('success', 'Đã tạo học viên mới.');
        }
        closeModal();
        loadStudents();
      } catch (e) {
        setAlert('error', e.message);
      } finally {
        saveBtn.disabled = false;
      }
    }

    async function handleTableClick(e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var id = btn.dataset.id;
      var act = btn.dataset.act;

      if (act === 'retry') {
        loadStudents();
        return;
      }

      if (act === 'summary') {
        _drawerCohortName = btn.dataset.cohort || '';
        _drawerLastFocus = btn;   // return focus here when the drawer closes
        await openSummary(id, btn.dataset.name || '');
        return;
      }
      if (act === 'essay') {
        window.location.href = '/pages/admin/writing/new.html?student_id=' + encodeURIComponent(id);
        return;
      }
      if (act === 'edit') {
        try {
          var s = await window.api.get('/admin/students/' + id);
          openModal(s);
        } catch (e) { setAlert('error', e.message); }
        return;
      }
      if (act === 'delete') {
        var code = btn.dataset.code;
        if (!confirm('Xóa học viên "' + code + '"? Tất cả essays của học viên này cũng sẽ bị xóa.')) return;
        try {
          await window.api.delete('/admin/students/' + id);
          setAlert('success', 'Đã xóa học viên.');
          loadStudents();
        } catch (e) { setAlert('error', e.message); }
      }
    }

    // ── Student summary modal ───────────────────────────────────
    function _formatBand(v) {
      return (v == null || v === '') ? '—' : v;
    }
    function _formatDateShort(iso) {
      if (!iso) return '—';
      var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00' : iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    function _bandFromEssay(e) {
      // GV-1a: the embed is the writing_feedback_current view (aliased to the
      // `writing_feedback` key), a to-one → a DICT (the current version), or
      // absent when no feedback exists. Kept array-tolerant too: legacy base
      // embeds returned an array, and the cardinality can flip across
      // supabase-py versions.
      var fb = e.writing_feedback;
      if (Array.isArray(fb) && fb.length) return fb[0].overall_band_score;
      if (fb && typeof fb === 'object')   return fb.overall_band_score;
      return null;
    }

    // Student Hub drawer. Consumes two existing endpoints (0 backend new):
    //   GET /admin/students/{id}            → profile + bands + user_id + essay_history
    //   GET /admin/writing/students/{id}/summary → writing stats + recent essays/assignments
    // Signature kept as (studentId, fallbackName) — tested contract.
    async function openSummary(studentId, fallbackName) {
      var modal = document.getElementById('summary-modal');
      if (!_drawerLastFocus) _drawerLastFocus = document.activeElement;

      // Reset to a loading state.
      document.getElementById('summary-title').textContent = fallbackName || 'Đang tải…';
      document.getElementById('summary-subtitle').textContent = '';
      var accBadge = document.getElementById('summary-account-badge');
      var cohBadge = document.getElementById('summary-cohort');
      var noAcc    = document.getElementById('summary-noaccount');
      accBadge.hidden = true; cohBadge.hidden = true; noAcc.hidden = true;
      document.getElementById('stat-total').textContent = '—';
      document.getElementById('stat-graded').textContent = '—';
      document.getElementById('stat-flagged').textContent = '—';
      document.getElementById('stat-avg-band').textContent = '—';
      document.getElementById('summary-essays').innerHTML = '<li class="st-list-empty">Đang tải…</li>';
      document.getElementById('summary-history').innerHTML = '<li class="st-list-empty">Đang tải…</li>';
      document.getElementById('stat-listen-total').textContent = '—';
      document.getElementById('stat-listen-acc').textContent = '—';
      document.getElementById('stat-listen-abandoned').textContent = '—';
      document.getElementById('stat-listen-dict').textContent = '—';
      document.getElementById('summary-listening').innerHTML = '<li class="st-list-empty">Đang tải…</li>';
      document.getElementById('summary-assignments').innerHTML = '';
      document.getElementById('summary-assign').setAttribute(
        'href', '/pages/admin/writing/assignments.html?assign_student=' + encodeURIComponent(studentId));

      // Lớp comes from the clicked row — the detail endpoint returns cohort_id
      // but not cohort_name.
      if (_drawerCohortName) { cohBadge.textContent = _drawerCohortName; cohBadge.hidden = false; }

      modal.classList.remove('hidden');
      var closeBtn = document.getElementById('summary-close');
      if (closeBtn) closeBtn.focus();   // focus-trap entry point

      // Both endpoints in parallel; tolerate partial failure (no silent fail).
      var results = await Promise.allSettled([
        window.api.get('/admin/students/' + studentId),
        window.api.get('/admin/writing/students/' + studentId + '/summary'),
      ]);
      var detail  = results[0].status === 'fulfilled' ? results[0].value : null;
      var summary = results[1].status === 'fulfilled' ? results[1].value : null;

      if (!detail && !summary) {
        setAlert('error', 'Không tải được dữ liệu học viên.');
        closeSummary();
        return;
      }

      // ── Header: profile + target-vs-current + account state ──────────
      var stu  = (summary && summary.student) || {};
      var code = (detail && detail.student_code) || stu.student_code || '';
      var name = (detail && detail.full_name) || stu.full_name || fallbackName || '';
      document.getElementById('summary-title').textContent = name || code || 'Học viên';

      var tBand = detail && detail.target_band != null ? detail.target_band
                : (stu.target_band != null ? stu.target_band : null);
      var cBand = detail && detail.current_band_estimate != null ? detail.current_band_estimate
                : (stu.current_band_estimate != null ? stu.current_band_estimate : null);
      var sub = [(code ? code + ' · ' : '') + 'Mục tiêu: ' + _formatBand(tBand)
        + ' · Hiện tại: ' + _formatBand(cBand)];
      var tDate = (detail && detail.target_date) || stu.target_date;
      if (tDate) sub.push('Hạn: ' + tDate);
      if (stu.is_under_review || (detail && detail.is_under_review)) sub.push('Đang xem xét lại');
      document.getElementById('summary-subtitle').textContent = sub.join(' · ');

      // has_account derived from user_id; absence shows an explicit "chưa kích
      // hoạt" notice (never a silent inactive state).
      if (detail) {
        var hasAccount = !!detail.user_id;
        if (hasAccount) {
          accBadge.textContent = '✓ Đã kích hoạt tài khoản';
          accBadge.className = 'st-badge is-account';
        } else {
          accBadge.textContent = '○ Chưa kích hoạt';
          accBadge.className = 'st-badge is-noaccount';
          noAcc.textContent = 'Học viên chưa kích hoạt tài khoản (mã: ' + (code || '—') +
            '). Dữ liệu các kỹ năng khác sẽ hiện sau khi kích hoạt.';
          noAcc.hidden = false;
        }
        accBadge.hidden = false;
      }

      // ── Tiến độ (writing) + recent essays/assignments — from summary ──
      if (summary) {
        var st = summary.stats || {};
        document.getElementById('stat-total').textContent    = st.total_essays || 0;
        document.getElementById('stat-graded').textContent   = st.graded_count || 0;
        document.getElementById('stat-flagged').textContent  = st.flagged_count || 0;
        document.getElementById('stat-avg-band').textContent = _formatBand(st.average_band_last5);

        var essays = summary.recent_essays || [];
        document.getElementById('summary-essays').innerHTML = essays.length
          ? essays.map(function (e) {
              var band = _bandFromEssay(e);
              var bandLabel = band != null ? 'Band ' + band : esc(e.status || '—');
              var flagged = e.is_flagged ? ' <span class="st-pill st-pill--flagged">⚠ Đã gắn cờ</span>' : '';
              var regraded = (e.regrade_count || 0) > 0 ? ' <span class="st-pill">chấm lại ×' + e.regrade_count + '</span>' : '';
              return '<li><a href="/pages/admin/writing/grade.html?essay_id=' + esc(e.id) + '">' +
                _formatDateShort(e.created_at) + ' · ' + esc(bandLabel) + '</a>' + flagged + regraded + '</li>';
            }).join('')
          : '<li class="st-list-empty">Chưa có bài viết.</li>';

        var assigns = summary.recent_assignments || [];
        document.getElementById('summary-assignments').innerHTML = assigns.length
          ? assigns.map(function (a) {
              var p = a.writing_prompts || {};
              return '<li>' + esc(p.title || '—') + ' <span class="st-pill">' + esc(a.status || '—') + '</span></li>';
            }).join('')
          : '<li class="st-list-empty">Chưa có bài giao.</li>';
      } else {
        document.getElementById('summary-essays').innerHTML = '<li class="st-list-empty">Không tải được tổng quan writing.</li>';
        document.getElementById('summary-assignments').innerHTML = '<li class="st-list-empty">—</li>';
      }

      // ── Tiến độ (listening) — detail.listening (audit 2026-07-17 đợt 3) ──
      var lis = detail && detail.listening;
      var lisList = document.getElementById('summary-listening');
      if (lis) {
        document.getElementById('stat-listen-total').textContent = lis.attempts_total || 0;
        document.getElementById('stat-listen-acc').textContent =
          lis.avg_accuracy != null ? Math.round(lis.avg_accuracy * 100) + '%' : '—';
        document.getElementById('stat-listen-abandoned').textContent = lis.attempts_abandoned || 0;
        document.getElementById('stat-listen-dict').textContent =
          (lis.dictation_total || 0) +
          (lis.dictation_avg_accuracy != null
            ? ' (' + Math.round(lis.dictation_avg_accuracy * 100) + '%)' : '');
        var userQ = lis.user_email || '';
        var linkQs = userQ ? ('?user=' + encodeURIComponent(userQ)) : '';
        var lisRows = [];
        if (lis.last_attempt_at) {
          lisRows.push('<li>Lượt gần nhất: ' + _formatDateShort(lis.last_attempt_at) +
            (lis.avg_duration_seconds != null
              ? ' · TB ' + Math.round(lis.avg_duration_seconds / 60) + ' phút/bài' : '') + '</li>');
        }
        lisRows.push('<li><a href="/pages/admin/listening/attempts.html' + linkQs + '">Xem lượt làm bài</a>' +
          ' · <a href="/admin/listening/dictation' + linkQs + '">Chép chính tả</a></li>');
        lisList.innerHTML = lisRows.join('');
      } else if (detail && !detail.user_id) {
        lisList.innerHTML = '<li class="st-list-empty">Chưa kích hoạt tài khoản — chưa có dữ liệu listening.</li>';
      } else {
        lisList.innerHTML = '<li class="st-list-empty">Không tải được dữ liệu listening.</li>';
      }

      // ── Lịch sử nộp bài — essay_history from the detail endpoint ──────
      if (detail) {
        var hist = detail.essay_history || [];
        document.getElementById('summary-history').innerHTML = hist.length
          ? hist.map(function (h) {
              var task = _TASK_LABELS[h.task_type] || h.task_type || '—';
              return '<li><a href="/pages/admin/writing/grade.html?essay_id=' + esc(h.id) + '">' +
                _formatDateShort(h.created_at) + ' · ' + esc(task) + '</a> ' +
                '<span class="st-pill">' + esc(h.status || '—') + '</span></li>';
            }).join('')
          : '<li class="st-list-empty">Chưa có bài nộp.</li>';
      } else {
        document.getElementById('summary-history').innerHTML = '<li class="st-list-empty">Không tải được hồ sơ.</li>';
      }
    }
    function closeSummary() {
      document.getElementById('summary-modal').classList.add('hidden');
      // a11y — return focus to the row control that opened the drawer.
      if (_drawerLastFocus && typeof _drawerLastFocus.focus === 'function') {
        try { _drawerLastFocus.focus(); } catch (e) { /* element gone */ }
      }
      _drawerLastFocus = null;
    }

    async function handleCsvImport(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var fd = new FormData();
      fd.append('file', file);
      try {
        var result = await window.api.upload('/admin/students/import', fd);
        var msg = 'Import xong: ' + result.imported + ' học viên';
        if (result.errors && result.errors.length) {
          msg += '. ' + result.errors.length + ' dòng lỗi (xem console).';
          console.warn('CSV import errors:', result.errors);
        }
        setAlert(result.errors && result.errors.length ? 'warn' : 'success', msg);
        loadStudents();
      } catch (err) {
        setAlert('error', err.message);
      } finally {
        e.target.value = '';
      }
    }

    function _wireReady() {
      document.getElementById('btn-new').addEventListener('click', function () { openModal(null); });
      document.getElementById('btn-cancel').addEventListener('click', closeModal);
      document.getElementById('btn-st-close').addEventListener('click', closeModal);
      document.getElementById('student-form').addEventListener('submit', handleSave);
      document.getElementById('students-tbody').addEventListener('click', handleTableClick);
      document.getElementById('csv-input').addEventListener('change', handleCsvImport);

      // WF-1 bulk-assign: per-row checkbox (delegated), choose-all, assign.
      document.getElementById('students-tbody').addEventListener('change', function (e) {
        var cb = e.target.closest('input.row-check[data-id]');
        if (!cb) return;
        var id = cb.getAttribute('data-id');
        if (cb.checked) _selectedIds.add(id); else _selectedIds.delete(id);
        updateBulkBar();
      });
      document.getElementById('bulk-select-all').addEventListener('change', function (e) {
        var on = e.target.checked;
        document.querySelectorAll('#students-tbody input.row-check[data-id]').forEach(function (cb) {
          cb.checked = on;
          var id = cb.getAttribute('data-id');
          if (on) _selectedIds.add(id); else _selectedIds.delete(id);
        });
        updateBulkBar();
      });
      document.getElementById('bulk-assign').addEventListener('click', doBulkAssign);
      document.getElementById('bulk-clear').addEventListener('click', function () {
        _selectedIds.clear();
        document.querySelectorAll('#students-tbody input.row-check[data-id]').forEach(function (cb) {
          cb.checked = false;
        });
        document.getElementById('bulk-select-all').checked = false;
        updateBulkBar();
      });
      populateBulkCohorts();
      document.getElementById('modal').addEventListener('click', function (e) {
        if (e.target.id === 'modal') closeModal();
      });
      // Keep keyboard focus inside the editor while it claims aria-modal=true.
      document.getElementById('modal').addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        var modal = document.getElementById('modal');
        if (modal.classList.contains('hidden')) return;
        var focusable = Array.prototype.slice.call(modal.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(function (el) { return el.offsetParent !== null; });
        if (!focusable.length) return;
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      // Student summary modal close + ESC dismiss.
      document.getElementById('summary-close').addEventListener('click', closeSummary);
      document.getElementById('summary-modal').addEventListener('click', function (e) {
        if (e.target.id === 'summary-modal') closeSummary();
      });
      // a11y — focus-trap: keep Tab within the open drawer.
      document.getElementById('summary-modal').addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        var dr = document.getElementById('summary-modal');
        if (dr.classList.contains('hidden')) return;
        var f = Array.prototype.slice.call(dr.querySelectorAll(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter(function (el) { return el.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var m = document.getElementById('summary-modal');
          if (m && !m.classList.contains('hidden')) closeSummary();
          var em = document.getElementById('modal');
          if (em && !em.classList.contains('hidden')) closeModal();
        }
      });

      var debounced = debounce(function () {
        _searchValue = document.getElementById('search-input').value.trim();
        loadStudents();
      }, 300);
      document.getElementById('search-input').addEventListener('input', debounced);

      loadStudents();
    }

    // ── Auth gate (replaces WC.bootstrap): admin-only, reveals #state-ready ──
    async function _boot() {
      _hide('state-ready');
      _hide('state-denied');
      _show('state-loading');
      try { initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch (e) { /* swallow */ }
      try {
        var me = await window.api.get('/auth/me');
        if (!me || me.role !== 'admin') {
          _hide('state-loading');
          _hide('state-ready');
          _show('state-denied');
          return;
        }
        _hide('state-loading');
        _hide('state-denied');
        _show('state-ready');
        _wireReady();
      } catch (e) {
        // api.js redirects to login on 401; this covers network / non-401 errors.
        window.location.href = window.api.url('index.html');
      }
    }

  // GĐ 1b — initialised on first activation of the Học viên tab (see header).
  window.AdminStudentsPanel = { init: _boot };
})();
