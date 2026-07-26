/*
 * admin-mock-live.js — invigilator console for a 4-skill full mock exam.
 *
 * The existing admin page answers "how many have submitted". During a live
 * exam that is the wrong unit: an invigilator needs to know WHO — who is in
 * the room, who is still working, who has a blank paper, who dropped off, and
 * who never arrived. This renders one row per student on the roster, per
 * section, from state the server already persists (answer rows, submit
 * timestamps) — no new client telemetry, so a student whose browser is gone
 * still reports truthfully: their answer count simply stops moving.
 *
 * Two exams can be live at once (one per class, each with its own
 * active_section clock). Every destructive control here therefore names the
 * exam AND the class it will act on, and is disabled while its request is in
 * flight — a mis-aimed "Mở phần tiếp theo" cannot be undone.
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  var POLL_MS = 5000;
  var SECTION_LABEL = { not_started: 'Chưa bắt đầu', listening: 'Listening',
                        reading: 'Reading', writing: 'Writing', done: 'Đã xong' };
  var FILTERS = [
    { key: 'all',      label: 'Tất cả' },
    { key: 'working',  label: 'Đang làm' },
    { key: 'problem',  label: 'Cần chú ý' },
    { key: 'absent',   label: 'Chưa vào' },
  ];

  var S = { examId: null, data: null, filter: 'all', busy: false, tick: null, poll: null,
            // Monotonic request id — only the newest load() may paint.
            reqGen: 0 };

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }
  // toast.js exports window.showToast (NOT window.toast) — the old wrapper
  // checked a name that never existed, so every failure this page reported went
  // to console.log and nowhere the invigilator could see it, including the 409
  // from a conflicting advance (Codex review, PR #833).
  function toast(m, kind) {
    if (window.showToast) return window.showToast(m, kind === 'error' ? 'error' : 'success', { timeout: 5000 });
    console.log(m);
  }

  function show(name) {
    ['loading', 'error', 'board'].forEach(function (s) {
      el('state-' + s).classList.toggle('hidden', s !== name);
    });
  }

  function fmtClock(secs) {
    if (secs == null) return '—';
    var s = Math.max(0, Math.floor(secs));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h > 0 ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Load ────────────────────────────────────────────────────────────
  async function loadExams() {
    var res = await window.api.get('/admin/mock-exams');
    var exams = ((res && res.exams) || []).filter(function (e) { return e.status === 'published'; });
    var sel = el('exam-picker');
    sel.innerHTML = exams.length ? '' : '<option value="">(chưa có đề nào published)</option>';
    exams.forEach(function (e) {
      var o = document.createElement('option');
      o.value = e.id;
      // The picker is where two live exams are told apart, so it carries the
      // live state too — not just the code.
      o.textContent = (e.code || e.id) + ' — ' + (e.title || '') +
        (e.exam_mode === 'retake' ? ' [test lại]' : (e.is_open ? ' • ĐANG MỞ' : ' • đóng'));
      sel.appendChild(o);
    });
    return exams;
  }

  async function load() {
    if (!S.examId) { show('error'); el('state-error').textContent = 'Chọn một kỳ thi.'; return; }
    // Tag the request with the exam it was made for. Two 5s polls can overlap,
    // or the admin can switch exams mid-flight — and a slower response for the
    // PREVIOUS exam arriving last would repaint the board (and rewire the
    // irreversible open/advance handlers) for a class the picker is no longer
    // showing (Codex review, PR #833).
    var want = S.examId;
    var gen = ++S.reqGen;
    try {
      var data = await window.api.get('/admin/mock-exams/' + encodeURIComponent(want) + '/live');
      if (gen !== S.reqGen || want !== S.examId) return;   // superseded — drop it
      S.data = data;
      render();
      show('board');
    } catch (e) {
      if (gen !== S.reqGen || want !== S.examId) return;   // superseded — stay quiet
      el('state-error').textContent = 'Không tải được bảng theo dõi: ' + (e && e.message ? e.message : e);
      show('error');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  function render() {
    renderIdent();
    renderStats();
    renderFilters();
    renderGrid();
    el('updated-at').textContent = 'Cập nhật lúc ' + fmtTime(S.data.server_time);
  }

  function renderIdent() {
    var ex = S.data.exam, r = S.data.roster;
    var retake = ex.exam_mode === 'retake';
    var open = ex.is_open
      ? '<span class="ml-pill ml-pill--live">Đang mở</span>'
      : '<span class="ml-pill ml-pill--shut">Đã đóng</span>';
    // Retake has no shared clock and no advance — say so instead of rendering
    // dead controls the mode does not have.
    //
    // PAUSED: the papers are in and the next section is not open. active_section
    // deliberately does not change during the break, so without the canonical
    // marker the console kept rendering AND TICKING the collected section's
    // clock — contradicting the clock-free pause it had just announced
    // (Codex review, PR #843).
    var paused = !retake && ex.collected_section
      && ex.collected_section === ex.active_section;
    var clock = retake ? '' : (paused
      ? '<div><span class="ml-clock__cap">Đã thu bài — ' +
          esc(SECTION_LABEL[ex.collected_section] || ex.collected_section) + '</span>' +
        '<div class="ml-clock" id="clock">—</div></div>'
      : '<div><span class="ml-clock__cap">Còn lại — ' + esc(SECTION_LABEL[ex.active_section] || ex.active_section) + '</span>' +
        '<div class="ml-clock' + ((ex.section_time_left_seconds != null && ex.section_time_left_seconds <= 120) ? ' is-low' : '') +
        '" id="clock">' + fmtClock(ex.section_time_left_seconds) + '</div></div>');

    el('ident').innerHTML =
      '<div class="ml-ident__top">' +
        '<span class="ml-code">' + esc(ex.code || '') + '</span>' +
        '<span class="ml-title">' + esc(ex.title || '') + '</span>' +
        open +
        '<span class="ml-pill">' + (retake ? 'Test lại' : 'Sequential') + '</span>' +
        '<span class="ml-pill">' + esc(SECTION_LABEL[ex.active_section] || ex.active_section) + '</span>' +
        (r.off_roster.length ? '<span class="ml-pill ml-pill--warn">' + r.off_roster.length + ' ngoài danh sách</span>' : '') +
      '</div>' +
      '<div class="ml-clockrow">' + clock +
        '<div class="ml-actions">' + (retake ? '' : sequentialActions(ex)) +
          '<a class="av-btn" href="/pages/admin/mock-reviews/index.html?mock_exam_id=' + encodeURIComponent(ex.id) + '">Duyệt bài →</a>' +
        '</div>' +
      '</div>';

    var bo = el('btn-open'); if (bo) bo.addEventListener('click', toggleOpen);
    var bc = el('btn-collect'); if (bc) bc.addEventListener('click', collectSection);
    var ba = el('btn-advance'); if (ba) ba.addEventListener('click', advance);
    startClockTick();
  }

  // B4 — "thu bài" and "mở phần sau" are two actions, in that order.
  //
  //   [Thu bài phần này]  → papers in, class to the waiting room, NO clock
  //          ↓  (đếm đủ, cho nghỉ)
  //   [Mở phần tiếp theo] → next section + its clock
  //
  // Once collected, nobody is still working, so the collect button retires and
  // advance becomes the only forward move.
  function sequentialActions(ex) {
    // A FINISHED exam cannot be reopened — the server refuses it (409) and every
    // student gate rejects entry anyway. Offering the button meant the admin
    // could press it, be told nothing was wrong, and believe the room was open
    // while it was not (Codex review, PR #858).
    var done = ex.active_section === 'done';
    var openBtn = done && !ex.is_open
      ? '<span class="me-muted">Kỳ thi đã kết thúc</span>'
      : '<button type="button" class="av-btn" id="btn-open">' +
        (ex.is_open ? 'Đóng kỳ' : 'Mở kỳ (live)') + '</button>';
    if (done) return openBtn;
    if (ex.active_section === 'not_started') {
      return openBtn +
        '<button type="button" class="av-btn av-btn--primary" id="btn-advance">Bắt đầu — mở phần đầu tiên</button>';
    }
    var sec = S.data.sections[ex.active_section] || {};
    var stillWorking = sec.working || 0;
    return openBtn +
      (stillWorking > 0
        ? '<button type="button" class="av-btn av-btn--primary" id="btn-collect">Thu bài phần này (' + stillWorking + ' chưa nộp)</button>'
        : '<span class="ml-pill ml-pill--live">Đã thu đủ bài</span>') +
      '<button type="button" class="av-btn' + (stillWorking > 0 ? '' : ' av-btn--primary') +
        '" id="btn-advance">Mở phần tiếp theo →</button>';
  }

  function collectSection() {
    var ex = S.data.exam;
    var sec = S.data.sections[ex.active_section] || {};
    var pending = sec.working || 0;
    var msg = 'Kỳ thi "' + ex.code + '"\n\n' +
      'THU BÀI phần ' + (SECTION_LABEL[ex.active_section] || ex.active_section) +
      (pending ? ' — ' + pending + ' học viên chưa nộp sẽ bị thu tự động' : '') + '.\n\n' +
      'Cả lớp sẽ vào phòng chờ, KHÔNG đồng hồ nào chạy. Phần tiếp theo chỉ mở khi bạn bấm nút thứ hai.\n\n' +
      'Hành động này KHÔNG hoàn tác được.';
    if (!confirm(msg)) return;
    return guard(el('btn-collect'), function () {
      // Carry the section THIS screen is showing, so a stale tab is rejected
      // instead of sweeping whichever section is now open.
      return window.api.post('/admin/mock-exams/' + encodeURIComponent(ex.id) +
        '/collect?from_section=' + encodeURIComponent(ex.active_section), {})
        .then(function (r) {
          toast('Đang thu ' + r.pending + ' bài phần ' +
            (SECTION_LABEL[r.section] || r.section) + ' — bảng sẽ cập nhật dần.');
          return load();
        })
        .catch(function (e) { toast('Thu bài thất bại: ' + (e && e.message)); });
    });
  }

  // The clock ticks locally between polls so it reads as a live countdown, but
  // every poll re-anchors it from the server — the browser clock is never the
  // source of truth for how much time the class has left.
  function startClockTick() {
    if (S.tick) clearInterval(S.tick);
    var left = S.data.exam.section_time_left_seconds;
    if (left == null) return;
    S.tick = setInterval(function () {
      left = Math.max(0, left - 1);
      var c = el('clock');
      if (!c) { clearInterval(S.tick); S.tick = null; return; }
      c.textContent = fmtClock(left);
      c.classList.toggle('is-low', left <= 120);
    }, 1000);
  }

  function renderStats() {
    var r = S.data.roster, secs = S.data.sections, ex = S.data.exam;
    var problems = S.data.students.filter(isProblem).length;
    var cards = [];
    // "expected: null" means the exam has no cohort — an unknown roster, which
    // is a different answer from zero and must not render as one.
    cards.push(stat('Danh sách lớp', r.expected == null ? '—' : r.expected,
      r.expected == null ? 'Đề không gắn lớp' : 'học viên được xếp thi'));
    cards.push(stat('Đã vào thi', r.started,
      (r.expected == null ? '' : 'vắng ' + Math.max(0, r.expected - r.started)),
      r.expected != null && r.started < r.expected));
    cards.push(stat('Cần chú ý', problems, 'trắng / im / chưa vào', problems > 0));
    (ex.configured_sections || []).forEach(function (s) {
      var v = secs[s] || { submitted: 0, expected: 0, missed: 0 };
      cards.push(stat(SECTION_LABEL[s], v.submitted + '/' + v.expected,
        v.missed ? v.missed + ' bài CHƯA THU' : 'đã nộp', !!v.missed));
    });
    el('stats').innerHTML = cards.join('');
    renderMissedBanner();
  }

  // A section the exam moved past without taking every paper — i.e. a
  // background sweep that died (a restart mid-task). Silent by design until it
  // happens, then loud, because the papers are recoverable ONLY while the
  // attempts still exist.
  function renderMissedBanner() {
    var host = el('missed-banner');
    if (!host) return;
    var secs = S.data.sections, ex = S.data.exam;
    var broken = (ex.configured_sections || []).filter(function (s) {
      return (secs[s] || {}).missed > 0;
    });
    if (!broken.length) { host.innerHTML = ''; host.classList.remove('on'); return; }
    host.classList.add('on');
    host.innerHTML = broken.map(function (s) {
      return '<div>⚠ Phần <b>' + esc(SECTION_LABEL[s]) + '</b> còn <b>' +
        secs[s].missed + '</b> bài chưa được thu (đợt thu tự động bị gián đoạn). ' +
        '<button type="button" class="av-btn" data-recollect="' + s + '">Thu lại phần ' +
        esc(SECTION_LABEL[s]) + '</button></div>';
    }).join('');
    host.querySelectorAll('[data-recollect]').forEach(function (b) {
      b.addEventListener('click', function () {
        recollect(b.getAttribute('data-recollect'), b);
      });
    });
  }

  function recollect(section, btn) {
    var ex = S.data.exam;
    if (!confirm('Thu lại phần ' + (SECTION_LABEL[section] || section) +
                 ' của kỳ "' + ex.code + '"?\n\nCác bài chưa thu sẽ được thu như hiện trạng.')) return;
    return guard(btn, function () {
      // from_section is REQUIRED by the endpoint (the stale-screen guard), and
      // a recovery click is by definition made from a screen showing a LATER
      // section — or 'done'. Sending the section we are recovering as both
      // would 409; sending nothing 422s before the preflight even runs, which
      // made the advertised recovery path unusable (Codex review, PR #844).
      return window.api.post('/admin/mock-exams/' + encodeURIComponent(ex.id) +
        '/collect?section=' + encodeURIComponent(section) +
        '&from_section=' + encodeURIComponent(ex.active_section), {})
        .then(function (r) {
          toast('Đang thu lại ' + r.pending + ' bài phần ' + (SECTION_LABEL[r.section] || r.section) + '…');
          return load();
        })
        .catch(function (e) { toast('Thu lại thất bại: ' + (e && e.message)); });
    });
  }

  function stat(k, n, sub, alert) {
    return '<div class="ml-stat"><div class="ml-stat__k">' + esc(k) + '</div>' +
      '<div class="ml-stat__n' + (alert ? ' ml-stat__n--alert' : '') + '">' + esc(n) + '</div>' +
      (sub ? '<div class="ml-stat__sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function renderFilters() {
    el('filters').innerHTML = FILTERS.map(function (f) {
      var n = S.data.students.filter(function (s) { return matches(s, f.key); }).length;
      return '<button type="button" class="ml-filter" data-f="' + f.key + '" aria-pressed="' +
        (S.filter === f.key) + '">' + esc(f.label) + ' (' + n + ')</button>';
    }).join('');
    el('filters').querySelectorAll('[data-f]').forEach(function (b) {
      b.addEventListener('click', function () { S.filter = b.dataset.f; renderFilters(); renderGrid(); });
    });
  }

  // "Cần chú ý" is the invigilator's walk-the-room list: someone who never
  // arrived, someone working on a paper the server has nothing for, someone
  // whose answers stopped landing.
  function isProblem(s) {
    if (!s.started) return true;
    return Object.keys(s.sections).some(function (k) {
      var c = s.sections[k];
      if (c.state !== 'working' || !c.live) return false;
      return c.stalled || c.answered === 0;
    });
  }
  function isWorking(s) {
    return Object.keys(s.sections).some(function (k) { return s.sections[k].state === 'working'; });
  }
  function matches(s, f) {
    if (f === 'all') return true;
    if (f === 'absent') return !s.started;
    if (f === 'working') return isWorking(s);
    return isProblem(s);
  }

  function renderGrid() {
    var ex = S.data.exam;
    var cols = ex.configured_sections || [];
    var rows = S.data.students.filter(function (s) { return matches(s, S.filter); });
    var speaking = S.data.students.some(function (s) { return s.speaking.required; });

    var head = '<thead><tr><th>Học viên</th>' +
      cols.map(function (c) { return '<th>' + esc(SECTION_LABEL[c]) + '</th>'; }).join('') +
      (speaking ? '<th>Speaking</th>' : '') +
      '<th>Trạng thái</th><th></th></tr></thead>';

    var body = rows.length
      ? rows.map(function (s) {
          var cls = [];
          if (!s.started) cls.push('ml-row--absent');
          if (!s.in_roster) cls.push('ml-row--offroster');
          return '<tr class="' + cls.join(' ') + '">' +
            '<td><span class="ml-name">' + esc(s.student_name) + '</span>' +
              (s.in_roster ? '' : ' <span class="ml-pill ml-pill--warn">ngoài DS</span>') +
              (s.needs_retest ? ' <span class="ml-pill">cần test lại</span>' : '') + '</td>' +
            cols.map(function (c) { return '<td>' + cellHtml(s, c) + '</td>'; }).join('') +
            (speaking ? '<td>' + speakingHtml(s) + '</td>' : '') +
            '<td class="ml-muted">' + esc(s.status) + integrityHtml(s) + '</td>' +
            // Pacing is available for ANY sitting — a finished one is exactly
            // when you want to look at how it was spent. Voiding is not: a
            // released sitting is a published result the student can already
            // see, so erasing it would leave an unsealed `void` row. The server
            // rejects that too; the UI just shouldn't offer it.
            '<td>' + (s.sitting_id
              ? '<a class="ml-void" href="/pages/admin/mock-pacing/index.html?sitting=' +
                  encodeURIComponent(s.sitting_id) + '" style="text-decoration:none">Nhịp làm bài</a> ' +
                (s.status !== 'released'
                  ? '<button type="button" class="ml-void" data-void="' + esc(s.sitting_id) +
                    '" data-name="' + esc(s.student_name) + '">Huỷ lượt</button>'
                  : '')
              : '') + '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="' + (cols.length + (speaking ? 4 : 3)) + '" class="ml-muted" style="padding:24px;text-align:center">Không có học viên nào khớp bộ lọc.</td></tr>';

    el('grid').innerHTML = head + '<tbody>' + body + '</tbody>';
    el('grid').querySelectorAll('[data-void]').forEach(function (b) {
      b.addEventListener('click', function () {
        voidSitting(b.getAttribute('data-void'), b.getAttribute('data-name'), b);
      });
    });
  }

  // The in-room escape hatch. A sitting can get stuck — a tech failure, a
  // student who opened the wrong exam, a row left in `registered` by someone
  // who never started. While one live sitting per student is enforced across
  // ALL exams, a stuck row locks that student out of everything, so the
  // invigilator needs to clear it themselves rather than filing a ticket
  // mid-exam.
  //
  // Voiding keeps the row (audit) and keeps it SEALED — a cancelled sitting
  // never publishes results.
  function voidSitting(sittingId, name, btn) {
    var reason = prompt('Huỷ lượt thi của "' + name + '"?\n\nNhập lý do (bắt buộc):');
    if (reason == null) return;
    reason = String(reason).trim();
    if (!reason) { toast('Cần nêu lý do huỷ.'); return; }
    return guard(btn, function () {
      return window.api.post(
        '/admin/mock-exams/sittings/' + encodeURIComponent(sittingId) + '/void',
        { reason: reason }
      ).then(function () { toast('Đã huỷ lượt thi của ' + name + '.'); return load(); })
        .catch(function (e) { toast('Huỷ thất bại: ' + (e && e.message)); });
    });
  }

  function cellHtml(s, section) {
    var c = s.sections[section];
    // A retaker not assigned this skill was never set it — an empty cell, not
    // a gap they failed to fill.
    if (!c) return '<span class="ml-cell__note">—</span>';
    var dot = '<i class="ml-dot ml-dot--' + c.state + '"></i>';
    if (c.state === 'absent') return '<span class="ml-cell">' + dot + '<span class="ml-cell__note">chưa vào</span></span>';
    if (c.state === 'waiting') return '<span class="ml-cell">' + dot + '<span class="ml-cell__note">chờ mở</span></span>';
    // The exam moved past this section without taking their paper — a sweep
    // that died. Distinct from "chờ mở", which would read as "not their turn
    // yet" and hide real lost work.
    if (c.state === 'missed') return '<span class="ml-cell">' + dot + '<b class="ml-flag ml-flag--blank">chưa thu</b></span>';
    if (c.state === 'submitted') {
      return '<span class="ml-cell">' + dot +
        '<span class="ml-cell__note">nộp ' + esc(fmtTime(c.submitted_at)) + '</span></span>';
    }
    // working — the number is the point of this whole page.
    if (!c.live) {
      // Writing has no server-side draft; a "0" here would be a lie.
      return '<span class="ml-cell">' + dot + '<span class="ml-cell__note">đang viết (chưa gửi bản nháp)</span></span>';
    }
    var flags = '';
    if (c.answered === 0) flags += ' <b class="ml-flag ml-flag--blank">trắng</b>';
    else if (c.stalled) flags += ' <b class="ml-flag ml-flag--stalled">im</b>';
    return '<span class="ml-cell">' + dot +
      '<span class="ml-num">' + (c.answered == null ? '—' : c.answered) +
      (c.total ? '/' + c.total : '') + '</span>' + flags +
      (c.last_activity_at ? '<span class="ml-cell__note">' + esc(fmtTime(c.last_activity_at)) + '</span>' : '') +
      '</span>';
  }

  // Soft signals, deliberately understated. They are context for a surprising
  // result — "was the tab hidden, did the connection die" — NOT an accusation,
  // and nothing here feeds a band.
  function integrityHtml(s) {
    var i = s.integrity || {};
    var bits = [];
    if (i.blur_count) {
      bits.push('rời tab ' + i.blur_count + '×' +
        (i.blur_seconds ? ' (' + Math.round(i.blur_seconds / 60) + 'p)' : ''));
    }
    if (i.offline_events) bits.push('mất mạng ' + i.offline_events + '×');
    // `> 1` was left over from when the runner counted the first boot too.
    // It now records only actual RE-entries, so the commonest real case — one
    // mid-exam reload, resumes === 1 — was persisted by the backend and then
    // hidden by this condition (Codex review, PR #849).
    if (i.resumes) bits.push('vào lại ' + i.resumes + '×');
    if (!bits.length) return '';
    return '<span class="ml-cell__note" style="display:block">' + esc(bits.join(' · ')) + '</span>';
  }

  function speakingHtml(s) {
    if (!s.speaking.required) return '<span class="ml-cell__note">—</span>';
    return s.speaking.completed_at
      ? '<span class="ml-cell"><i class="ml-dot ml-dot--submitted"></i><span class="ml-cell__note">' + esc(fmtTime(s.speaking.completed_at)) + '</span></span>'
      : '<span class="ml-cell"><i class="ml-dot ml-dot--waiting"></i><span class="ml-cell__note">' + s.speaking.count + ' phần</span></span>';
  }

  // ── Controls ────────────────────────────────────────────────────────
  // Both name the exam. With two classes live, a confirm that says only
  // "mở phần Reading?" is the same sentence for both of them.
  function guard(btn, fn) {
    if (S.busy) return;
    S.busy = true;
    if (btn) btn.disabled = true;
    return fn().finally(function () {
      S.busy = false;
      if (btn) btn.disabled = false;
    });
  }

  function toggleOpen() {
    var ex = S.data.exam, next = !ex.is_open;
    if (!confirm((next ? 'MỞ' : 'ĐÓNG') + ' kỳ thi "' + ex.code + ' — ' + (ex.title || '') + '"?')) return;
    return guard(el('btn-open'), function () {
      return window.api.post('/admin/mock-exams/' + encodeURIComponent(ex.id) + '/open', { is_open: next })
        .then(function () { toast(next ? 'Đã mở kỳ.' : 'Đã đóng kỳ.'); return load(); })
        .catch(function (e) { toast('Thất bại: ' + (e && e.message), 'error'); });
    });
  }

  function advance() {
    var ex = S.data.exam, secs = S.data.sections;
    var cur = ex.active_section;
    // Who is about to have their paper taken. `working` (not expected−submitted)
    // is the right count: a student who never showed up is absent, not someone
    // whose paper is being swept.
    var pending = (secs[cur] || {}).working || 0;
    var msg = 'Kỳ thi "' + ex.code + '"\n\n';
    msg += (cur === 'not_started')
      ? 'Bắt đầu kỳ thi và mở phần đầu tiên cho cả lớp?'
      // Advance still sweeps stragglers, so it stays safe if the admin skips
      // the collect step — but now it SAYS so instead of hiding it.
      : (pending
          ? 'Mở phần tiếp theo? ' + pending + ' học viên chưa nộp phần ' +
            (SECTION_LABEL[cur] || cur) + ' sẽ bị thu tự động.'
          : 'Phần ' + (SECTION_LABEL[cur] || cur) + ' đã thu đủ bài. Mở phần tiếp theo cho cả lớp?');
    msg += '\n\nHành động này KHÔNG hoàn tác được.';
    if (!confirm(msg)) return;
    return guard(el('btn-advance'), function () {
      return window.api.post('/admin/mock-exams/' + encodeURIComponent(ex.id) + '/advance',
        // the section THIS console is showing — a stale tab is rejected
        { from_section: cur })
        .then(function () { toast('Đã chuyển phần.'); return load(); })
        .catch(function (e) { toast('Thất bại: ' + (e && e.message), 'error'); });
    });
  }

  // ── Boot ────────────────────────────────────────────────────────────
  function startPolling() {
    if (S.poll) clearInterval(S.poll);
    if (!el('auto-refresh').checked) return;
    S.poll = setInterval(function () { if (!S.busy) load(); }, POLL_MS);
  }

  async function boot() {
    var sb = window.getSupabase && window.getSupabase();
    if (sb) { var s = await sb.auth.getSession(); if (!s.data.session) { location.href = '/index.html'; return; } }
    var exams;
    try { exams = await loadExams(); }
    catch (e) {
      el('state-error').textContent = 'Không tải được danh sách đề: ' + (e && e.message ? e.message : e);
      show('error'); return;
    }
    var wanted = new URLSearchParams(location.search).get('exam_id');
    if (wanted && !exams.some(function (e) { return e.id === wanted; })) {
      // Say so instead of silently monitoring a DIFFERENT class. Falling back to
      // the first published exam put the invigilator in front of another
      // classroom's irreversible open/advance controls while they believed they
      // had followed their own link (Codex review, PR #833).
      el('state-error').textContent =
        'Không mở được kỳ thi này (chưa publish, đã archive, hoặc mã không đúng). ' +
        'Chọn kỳ thi từ danh sách phía trên.';
      show('error');
    } else {
      S.examId = wanted || (exams[0] && exams[0].id) || null;
      if (S.examId) el('exam-picker').value = S.examId;
    }

    // WIRED UNCONDITIONALLY. Returning early on a bad ?exam_id= left the board
    // with only a picker: after the admin selected a valid exam as instructed
    // it loaded ONCE and then silently went stale for the rest of the exam,
    // with both refresh controls inert (Codex review, PR #833).
    el('exam-picker').addEventListener('change', function () {
      S.examId = el('exam-picker').value;
      // Keep the URL in step so a reload — or a second monitor on another
      // screen — comes back to the same class.
      history.replaceState(null, '', '?exam_id=' + encodeURIComponent(S.examId));
      show('loading'); load(); startPolling();
    });
    el('refresh-now').addEventListener('click', function () { load(); });
    el('auto-refresh').addEventListener('change', startPolling);

    if (!S.examId) return;      // nothing selected yet — the picker starts it
    await load();
    startPolling();
  }
  boot();
})();
