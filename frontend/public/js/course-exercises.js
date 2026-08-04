/**
 * course-exercises.js — làm bài tập ngữ pháp theo buổi.
 *
 * KHÁC HẲN quiz-engine.js, và cố ý. Bộ máy kia dựng cho TỪ VỰNG: nó xoay vòng
 * một hàng đợi từ, đổi kỹ năng mỗi lượt, có thời gian nghỉ giữa hai lần gặp lại,
 * và dừng khi "thuộc". Một buổi bài tập ngữ pháp thì làm TUẦN TỰ một lần cho hết
 * — không có gì để lặp tới khi thuộc, và trộn hai mô hình vào một tệp sẽ khiến
 * cả hai đều khó đọc.
 *
 * DÙNG CHUNG chỗ đáng dùng chung: cùng endpoint `/api/quiz/*`, cùng bảng lượt
 * làm — nên thống kê admin và màn xem lại bài chạy được ngay.
 *
 * ĐIỀU QUAN TRỌNG NHẤT ở đây: khi học viên chọn sai, các em phải thấy dòng nói
 * về ĐÚNG PHƯƠNG ÁN MÌNH ĐÃ CHỌN (`why_wrong`), chứ không phải đọc lại lời giải
 * chung. Lời giải chung nói vì sao đáp án đúng là đúng — nó không chạm tới hiểu
 * lầm mà em ấy đang mang.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var api = window.api;

  // Mười câu một chặng. 100 câu liền một mạch là quá dài cho một buổi tối, và
  // một lượt bỏ dở giữa chừng thì không có chỗ nào để nói "em đã làm tới đâu".
  var STAGE = 10;

  var _bank = null;
  var _qs = [];
  var _stage = 0;       // chỉ số chặng, 0-based
  var _at = 0;          // vị trí trong chặng
  var _marks = [];      // 'right' | 'wrong' | 'self' cho từng câu trong chặng
  var _sessionId = null;
  var _pending = [];    // lượt làm chờ gửi
  var _shownAt = 0;
  var _startedAt = 0;
  var _answered = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * `**in đậm**` → <mark>. Thoát HTML TRƯỚC rồi mới dựng thẻ: nội dung đi từ cơ
   * sở dữ liệu ra màn hình, và một dấu `<` trong câu tiếng Anh không được biến
   * thành thẻ.
   */
  function md(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<mark>$1</mark>');
  }

  /**
   * Đề tách làm hai phần: DÒNG ĐẦU là câu hỏi, phần còn lại là MẪU VẬT — câu
   * tiếng Anh đang bị mổ. Nguồn viết đúng như vậy (71/100 câu có một dòng xuống,
   * 25 câu có hai), và tách ra khiến câu hỏi đọc như câu hỏi còn mẫu vật đọc như
   * mẫu vật.
   */
  function splitStem(de) {
    var i = String(de || '').indexOf('\n');
    if (i === -1) return { ask: de || '', spec: '' };
    return { ask: de.slice(0, i), spec: de.slice(i + 1).trim() };
  }

  var KEYS = ['A', 'B', 'C', 'D'];

  // ── Vẽ ────────────────────────────────────────────────────────────────

  function stageQuestions() {
    return _qs.slice(_stage * STAGE, _stage * STAGE + STAGE);
  }

  function renderStage() {
    var qs = stageQuestions();
    var total = Math.ceil(_qs.length / STAGE);
    $('cx-stage').hidden = false;
    $('cx-stage-label').innerHTML =
      esc(_bank.title) + ' · chặng <strong>' + (_stage + 1) + '/' + total + '</strong>';
    $('cx-stage-ticks').innerHTML = qs.map(function (_q, i) {
      var s = i < _marks.length ? _marks[i] : (i === _at ? 'now' : '');
      return '<i' + (s ? ' data-s="' + s + '"' : '') + '></i>';
    }).join('');
  }

  function levelDots(n) {
    var out = '';
    for (var i = 1; i <= 3; i++) out += '<i' + (i <= (n || 1) ? ' data-on' : '') + '></i>';
    return '<span class="cx-level" title="Mức ' + (n || 1) + '/3" aria-label="Mức ' + (n || 1) + ' trên 3">' + out + '</span>';
  }

  var DANG = {
    A1: 'GÁN NHÃN Ô', A2: 'GỌI TÊN', A3: 'TÌM HẠT NHÂN',
    B1: 'CHỌN DẠNG ĐÚNG', B2: 'CHỌN CẢ CỤM', B3: 'CẶP TỐI THIỂU',
    C1: 'TÌM LỖI', C2: 'VÌ SAO SAI', C3: 'CÂU NÀO ĐÚNG', C4: 'BẢN SỬA ĐÃ ỔN CHƯA',
    D1: 'GIỮ NGUYÊN NGHĨA', D2: 'ĐỔI CHỮ ĐỔI NGHĨA', D3: 'VI PHẠM RÀNG BUỘC NÀO',
    D4: 'NGỮ CẢNH', E1: 'VIẾT LẠI', E2: 'GỘP CÂU', E3: 'SỬA + GHI LÝ DO',
  };

  function renderQuestion() {
    var q = stageQuestions()[_at];
    if (!q) return renderDone();
    _answered = false;
    _shownAt = Date.now();
    var st = splitStem(q.prompt);
    var isWrite = q.type === 'writing';

    var body = ''
      + '<div class="cx-q__head">'
      + '<span class="cx-tag"><b>' + esc(q.subtype || '') + '</b>'
      + esc(DANG[q.subtype] || '') + '</span>'
      + levelDots(q.points) + '</div>'
      + '<p class="cx-q__ask">' + md(st.ask) + '</p>'
      + (st.spec ? '<div class="cx-spec">' + md(st.spec) + '</div>' : '');

    if (isWrite) {
      body += '<textarea class="cx-write" id="cx-write" '
        + 'placeholder="Viết câu trả lời của bạn…" aria-label="Câu trả lời"></textarea>'
        + '<div id="cx-selfcheck"></div>';
    } else {
      var opts = Array.isArray(q.options) ? q.options : [];
      body += '<div class="cx-opts" id="cx-opts" role="group">' + opts.map(function (o, i) {
        return '<button type="button" class="cx-opt" data-i="' + i + '">'
          + '<span class="cx-opt__key">' + KEYS[i] + '</span>'
          + '<span class="cx-opt__body"><span class="cx-opt__text">' + md(o) + '</span></span>'
          + '</button>';
      }).join('') + '</div>';
    }
    body += '<div id="cx-why"></div>';

    $('cx-q').innerHTML = body;
    $('cx-q').hidden = false;
    $('cx-done').hidden = true;
    $('cx-next').hidden = false;
    $('cx-next').innerHTML = isWrite
      ? '<button class="av-button av-button-primary" id="cx-reveal" type="button">Xem đáp án mẫu</button>'
      : '';
    renderStage();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  /** Đã trả lời — vẽ lại các ô, và NỞ cái bẫy ngay trong ô đã chọn. */
  function markOptions(q, picked) {
    var rows = document.querySelectorAll('.cx-opt');
    var why = q.why_wrong || {};
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      el.disabled = true;
      var idx = Number(el.dataset.i);
      var role = idx === q.answer
        ? (idx === picked ? 'hit' : 'key')
        : (idx === picked ? 'miss' : 'off');
      el.dataset.r = role;
      if (role === 'miss') {
        // Dòng của ĐÚNG phương án em vừa chọn. Đây là chỗ đáng giá nhất của cả
        // kho — nó nói hiểu lầm cụ thể mà phương án ấy được soạn để bẫy.
        var trap = why[String(idx)];
        if (trap) {
          el.querySelector('.cx-opt__body').insertAdjacentHTML('beforeend',
            '<span class="cx-trap"><b>Bẫy ở đây</b>' + esc(trap) + '</span>');
        }
      }
    }
  }

  function renderWhy(q) {
    $('cx-why').innerHTML = '<div class="cx-why">' + md(q.explain || '')
      + (q.item_key ? '<span class="cx-why__axis">Trục: ' + esc(q.item_key) + '</span>' : '')
      + '</div>';
    $('cx-next').innerHTML =
      '<button class="av-button av-button-primary" id="cx-go" type="button">Câu tiếp</button>';
  }

  // ── Trả lời ───────────────────────────────────────────────────────────

  function answer(picked) {
    if (_answered) return;
    _answered = true;
    var q = stageQuestions()[_at];
    var ok = picked === q.answer;
    _marks[_at] = ok ? 'right' : 'wrong';
    markOptions(q, picked);
    renderWhy(q);
    renderStage();
    queueAttempt(q, ok, String(picked));
  }

  function revealSelfCheck() {
    if (_answered) return;
    _answered = true;
    var q = stageQuestions()[_at];
    var written = ($('cx-write') || {}).value || '';
    $('cx-write').readOnly = true;
    // KHÔNG chấm đúng/sai. Người soạn kèm tiêu chí ("Thiếu be ⟹ 0 điểm"), tức là
    // chính họ coi đây là việc cần người chấm — trang không giả vờ làm được.
    $('cx-selfcheck').innerHTML = '<div class="cx-selfcheck">'
      + '<p><strong>Tự đối chiếu.</strong> Câu này không chấm máy — so bài của bạn với đáp án mẫu bên dưới.</p>'
      + md(q.explain || '').split('\n\n').map(function (p) { return '<p>' + p + '</p>'; }).join('')
      + '</div>';
    _marks[_at] = 'self';
    renderStage();
    $('cx-next').innerHTML =
      '<button class="av-button av-button-primary" id="cx-go" type="button">Câu tiếp</button>';
    // Ghi lại là em ấy CÓ LÀM, nhưng không kèm đúng/sai — xem `queueAttempt`.
    queueAttempt(q, null, written.slice(0, 500));
  }

  function next() {
    _at += 1;
    save();          // sau MỖI câu: đóng tab giữa chặng vẫn quay lại đúng chỗ
    if (_at >= stageQuestions().length) return renderDone();
    renderQuestion();
  }

  // ── Ghi lượt làm ──────────────────────────────────────────────────────

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function queueAttempt(q, ok, given) {
    // Câu tự luận KHÔNG gửi: backend bỏ qua mọi lượt không có `is_correct`
    // (quiz_service.log_progress), nên gửi đi là gửi vào hư không. Ghi một giá
    // trị đúng/sai bịa ra thì còn tệ hơn — nó làm sai chính con số giáo viên đọc.
    if (ok === null) return;
    _pending.push({
      client_id: uuid(),
      item_key: q.item_key || q.qid,
      qid: q.qid,
      skill: q.skill,
      type: q.type,
      subtype: q.subtype,
      is_correct: ok,
      answer_given: given,
      response_time_ms: Math.max(0, Date.now() - _shownAt),
      attempt_no: 1,
    });
    if (_pending.length >= 5) flush();
  }

  function flush(keepalive) {
    if (!_sessionId || !_pending.length) return Promise.resolve();
    var batch = _pending.splice(0, _pending.length);
    return api.post('/api/quiz/sessions/' + _sessionId + '/progress',
      { attempts: batch, word_stats: [] })
      .catch(function () {
        // Gửi hỏng thì TRẢ LẠI hàng đợi: mất lượt làm nghĩa là giáo viên đọc một
        // con số thấp hơn thực tế và tưởng em ấy bỏ bài.
        if (!keepalive) _pending = batch.concat(_pending);
      });
  }

  // ── Hết chặng ─────────────────────────────────────────────────────────

  function renderDone() {
    var qs = stageQuestions();
    var graded = qs.filter(function (q) { return q.type !== 'writing'; });
    var right = 0;
    qs.forEach(function (_q, i) { if (_marks[i] === 'right') right += 1; });

    // Trục nào sai nhiều nhất. Đây là thứ học viên KHÔNG tự thấy — số câu đúng
    // thì các em tự đếm được.
    var byAxis = {};
    qs.forEach(function (q, i) {
      if (_marks[i] !== 'wrong' || !q.item_key) return;
      byAxis[q.item_key] = (byAxis[q.item_key] || 0) + 1;
    });
    var axes = Object.keys(byAxis).sort(function (a, b) { return byAxis[b] - byAxis[a]; });

    var total = Math.ceil(_qs.length / STAGE);
    var more = _stage + 1 < total;
    $('cx-q').hidden = true;
    $('cx-next').hidden = true;
    $('cx-done').hidden = false;
    $('cx-done').innerHTML = ''
      + '<div class="cx-done__score">' + right + '<small>/ ' + graded.length + ' câu đúng</small></div>'
      + (axes.length
        ? '<h2>Sai dồn vào những trục này</h2><ul class="cx-axes">' + axes.map(function (a) {
          return '<li class="cx-axis"><span>' + esc(a) + '</span>'
            + '<span class="cx-axis__n">' + byAxis[a] + ' câu</span></li>';
        }).join('') + '</ul>'
        : '<h2>Không sai câu nào trong chặng này.</h2>')
      + '<div class="cx-next" style="position:static">'
      + (more
        ? '<button class="av-button av-button-primary" id="cx-more" type="button">Làm chặng ' + (_stage + 2) + '</button>'
        : '<span class="cx-empty" style="flex:1">Xong cả ' + _qs.length + ' câu của buổi này.</span>')
      + '</div>';
    endSession(right, graded.length);
    save();
  }

  /**
   * KẾT phiên. Thiếu bước này thì `quiz_admin_student_rollup` bỏ qua cả lượt
   * làm — nó chỉ đếm phiên có `ended_at` — nên giáo viên mở mặt đọc ra thấy
   * TRỐNG dù học viên vừa làm xong. (Chính tôi vấp phải đúng chỗ này khi mô
   * phỏng một lượt để xem dữ liệu đổ về, và vẫn quên nối nó.)
   *
   * Đẩy nốt lượt làm TRƯỚC rồi mới chốt phiên: chốt trước thì con số tổng kết
   * được ghi khi chưa có đủ lượt để đối chiếu.
   */
  async function endSession(right, graded) {
    if (!_sessionId) return;
    await flush();
    try {
      await api.patch('/api/quiz/sessions/' + _sessionId, {
        duration_sec: Math.round((Date.now() - _startedAt) / 1000),
        total_questions: graded,
        total_correct: right,
        total_wrong: Math.max(0, graded - right),
        ended_by: 'completed',
      });
    } catch (err) { /* lượt làm đã ghi rồi; mất phần tổng kết là mất ít nhất */ }
  }

  // ── Nhớ chỗ đang làm ──────────────────────────────────────────────────

  function key() { return 'cx:' + (_bank && _bank.id); }

  /**
   * Nhớ CẢ vị trí trong chặng, không chỉ số chặng.
   *
   * Chỉ lưu `stage` thì làm 9/10 câu rồi đóng tab sẽ quay lại đầu chặng — làm
   * lại chín câu vừa làm là thứ khiến người ta bỏ hẳn.
   */
  function save() {
    try {
      localStorage.setItem(key(), JSON.stringify(
        { stage: _stage, at: _at, marks: _marks }));
    } catch (e) { /* trình duyệt chặn lưu — làm bài vẫn chạy */ }
  }

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(key()) || '{}');
      if (typeof v.stage === 'number') _stage = v.stage;
      if (typeof v.at === 'number') _at = v.at;
      if (Array.isArray(v.marks)) _marks = v.marks;
    } catch (e) { /* bỏ qua */ }
  }

  // ── Khởi động ─────────────────────────────────────────────────────────

  function fail(msg) {
    $('cx-loading').hidden = true;
    $('cx-error').hidden = false;
    $('cx-error').textContent = msg;
  }

  async function boot() {
    var p = new URLSearchParams(location.search);
    var bankId = p.get('bank');
    if (!bankId) return fail('Thiếu mã bài tập trên đường dẫn (?bank=…).');

    try {
      var r = await api.get('/api/quiz/banks/' + encodeURIComponent(bankId));
      _bank = r.bank;
      _qs = r.questions || [];
    } catch (err) {
      return fail('Không mở được bài tập: ' + (err.message || err));
    }
    if (!_qs.length) return fail('Bài tập này chưa có câu hỏi nào.');

    load();
    if (_stage * STAGE >= _qs.length) { _stage = 0; _at = 0; _marks = []; }
    if (_at >= STAGE) { _at = 0; _marks = []; }     // buổi bị soạn ngắn lại
    try {
      var s = await api.post('/api/quiz/sessions', { bank_id: _bank.id });
      _sessionId = s && (s.id || s.session_id);
    } catch (err) { _sessionId = null; }
    if (!_sessionId) {
      // Vẫn cho làm — chặn lại thì em ấy mất cả buổi vì một lỗi mạng. Nhưng
      // PHẢI nói ra: im lặng nghĩa là làm xong 10 câu rồi mới biết không có gì
      // được ghi, và giáo viên thì tưởng em ấy bỏ bài.
      $('cx-error').hidden = false;
      $('cx-error').textContent =
        'Không kết nối được để lưu bài. Bạn vẫn làm được, nhưng kết quả sẽ KHÔNG '
        + 'tới giáo viên — tải lại trang để thử lại.';
    }

    $('cx-loading').hidden = true;
    _startedAt = Date.now();
    renderQuestion();
  }

  // Uỷ quyền: nội dung được vẽ lại sau mỗi câu, nên gắn tay từng nút sẽ mất ngay
  // ở lần vẽ kế tiếp.
  document.addEventListener('click', function (e) {
    var opt = e.target.closest && e.target.closest('.cx-opt');
    if (opt && !opt.disabled) return answer(Number(opt.dataset.i));
    if (e.target.id === 'cx-go') return next();
    if (e.target.id === 'cx-reveal') return revealSelfCheck();
    if (e.target.id === 'cx-more') {
      _stage += 1; _at = 0; _marks = []; save();
      return renderQuestion();
    }
  });

  // Đóng tab giữa chừng vẫn giữ được phần đã làm.
  window.addEventListener('pagehide', function () { flush(true); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
