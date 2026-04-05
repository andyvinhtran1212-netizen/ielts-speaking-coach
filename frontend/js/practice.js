// practice.js — IELTS Speaking practice: prep → record → grade → feedback
// Depends on: api.js (window.api, window.getSupabase, window.initSupabase)

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────────

  // Hard-stop recording after this many seconds per part
  var MAX_RECORD_SEC = { 1: 60, 2: 150, 3: 90 };

  var PROCESSING_TEXTS = [
    'Đang chuyển giọng nói thành văn bản...',
    'AI đang phân tích câu trả lời...',
    'Đang tạo nhận xét chi tiết...',
    'Đang tổng hợp kết quả...',
  ];

  // ── Session state ─────────────────────────────────────────────────────────────

  var _sessionId    = null;
  var _sessionData  = null;
  var _questions    = [];
  var _currentIdx   = 0;
  var _currentQ     = null;
  var _currentState = null;   // top-level state name

  // ── Recorder state ────────────────────────────────────────────────────────────

  var _recSubState  = 'idle'; // 'idle' | 'recording' | 'recorded'
  var _stream       = null;   // MediaStream — held across questions, released on finish
  var _recorder     = null;   // MediaRecorder
  var _audioChunks  = [];
  var _recordedBlob = null;
  var _audioCtx     = null;
  var _analyser     = null;
  var _waveAnimId   = null;
  var _timerId      = null;
  var _elapsedSecs  = 0;

  // Processing text rotation
  var _processingTimer = null;

  // ── DOM helper ────────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  // ── Top-level state management ────────────────────────────────────────────────

  var _ALL_STATES = ['loading', 'error', 'prep', 'recording', 'processing', 'feedback'];

  function showState(name) {
    _ALL_STATES.forEach(function (s) {
      var el = $('state-' + s);
      if (!el) return;
      if (s === name) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
    _currentState = name;
  }

  function showError(msg) {
    var el = $('error-msg');
    if (el) el.textContent = msg;
    showState('error');
  }

  // ── Recording sub-state management ───────────────────────────────────────────

  function _showRecSub(name) {
    // name: 'idle' | 'recording' | 'recorded'
    ['idle', 'recording', 'recorded'].forEach(function (s) {
      var el = $('rec-' + s);
      if (!el) return;
      el.style.display = (s === name) ? '' : 'none';
    });
    _recSubState = name;
  }

  // ── Header ────────────────────────────────────────────────────────────────────

  function _updateHeader() {
    if (!_sessionData) return;
    var info = $('hdr-info');
    if (info) info.textContent = 'Part ' + _sessionData.part + ' · ' + (_sessionData.topic || '');
    var prog = $('hdr-progress');
    if (prog) prog.textContent = (_currentIdx + 1) + ' / ' + _questions.length;
  }

  // ── STATE: Prep ───────────────────────────────────────────────────────────────

  function _showPrep() {
    _currentQ = _questions[_currentIdx];
    _updateHeader();

    $('prep-q-counter').textContent = 'Câu ' + (_currentIdx + 1) + ' / ' + _questions.length;
    $('prep-part-badge').textContent = 'Part ' + (_sessionData ? _sessionData.part : '');
    $('prep-topic').textContent = _sessionData ? (_sessionData.topic || '') : '';
    $('prep-q-text').textContent = _currentQ.question_text || '';

    // Cue card — Part 2 only
    var cueBlock = $('prep-cue');
    var hasCue = _sessionData && _sessionData.part === 2
      && _currentQ.cue_card_bullets && _currentQ.cue_card_bullets.length;

    if (hasCue) {
      $('prep-cue-bullets').innerHTML = _currentQ.cue_card_bullets.map(function (b) {
        return '<li class="flex items-start gap-2">'
          + '<span style="color:#14b8a6;margin-top:3px;">›</span>'
          + '<span>' + _esc(b) + '</span></li>';
      }).join('');
      var refl = $('prep-cue-reflection');
      if (refl) refl.textContent = _currentQ.cue_card_reflection || '';
      cueBlock && cueBlock.classList.remove('hidden');
    } else {
      cueBlock && cueBlock.classList.add('hidden');
    }

    showState('prep');
  }

  // Called by prep button "Bắt đầu ghi âm"
  function goToRecording() {
    if (!_currentQ) return;
    var recQ = $('rec-question');
    if (recQ) recQ.textContent = _currentQ.question_text || '';
    _clearRecError();
    _resetRecorder();          // clean slate for this question
    _showRecSub('idle');
    showState('recording');
  }

  // ── Recording: start ──────────────────────────────────────────────────────────

  async function startRecording() {
    if (_recSubState === 'recording') return;
    _clearRecError();

    // Check API availability
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      _showRecError('Trình duyệt không hỗ trợ ghi âm. Hãy dùng Chrome, Firefox hoặc Edge phiên bản mới.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      _showRecError('Trình duyệt không hỗ trợ MediaRecorder. Hãy dùng Chrome, Firefox hoặc Edge phiên bản mới.');
      return;
    }

    // Request mic (reuse existing stream across questions)
    if (!_stream || !_stream.active) {
      try {
        _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err) {
        var msg;
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = 'Bạn đã từ chối quyền microphone. Hãy cho phép trong thanh địa chỉ trình duyệt rồi thử lại.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msg = 'Không tìm thấy microphone. Hãy cắm thiết bị và thử lại.';
        } else if (err.name === 'NotReadableError') {
          msg = 'Microphone đang được dùng bởi ứng dụng khác. Hãy đóng ứng dụng đó và thử lại.';
        } else {
          msg = 'Không thể mở microphone: ' + err.message;
        }
        _showRecError(msg);
        return;
      }
    }

    // AudioContext for waveform visualisation (optional — failure is non-fatal)
    try {
      if (!_audioCtx || _audioCtx.state === 'closed') {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (_audioCtx.state === 'suspended') await _audioCtx.resume();
      var src = _audioCtx.createMediaStreamSource(_stream);
      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = 256;
      src.connect(_analyser);
    } catch (_) {
      _analyser = null;
    }

    // Pick supported MIME type
    var mimeType = '';
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) { mimeType = candidates[i]; break; }
    }

    _audioChunks  = [];
    _recordedBlob = null;

    try {
      _recorder = new MediaRecorder(_stream, mimeType ? { mimeType: mimeType } : {});
    } catch (_) {
      _recorder = new MediaRecorder(_stream);
    }

    _recorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) _audioChunks.push(e.data);
    };

    _recorder.onstop = function () {
      var type = (_recorder.mimeType && _recorder.mimeType !== '') ? _recorder.mimeType : 'audio/webm';
      _recordedBlob = new Blob(_audioChunks, { type: type });
      // Show recorded sub-state with duration
      var durEl = $('rec-duration-display');
      if (durEl) {
        var m = Math.floor(_elapsedSecs / 60);
        var s = _elapsedSecs % 60;
        durEl.textContent = 'Thời lượng ghi âm: ' + m + ':' + (s < 10 ? '0' + s : s);
      }
      _showRecSub('recorded');
    };

    _recorder.start(250);   // fire ondataavailable every 250ms

    // Elapsed timer (counts up; hard-stop at MAX_RECORD_SEC)
    // Always clear any previous interval before starting a new one
    if (_timerId) { clearInterval(_timerId); _timerId = null; }
    _elapsedSecs = 0;
    _renderTimer();
    _timerId = setInterval(function () {
      _elapsedSecs++;
      _renderTimer();
      var maxSec = MAX_RECORD_SEC[_sessionData ? _sessionData.part : 1] || 90;
      if (_elapsedSecs >= maxSec) stopRecording();
    }, 1000);

    _startWaveform();
    _showRecSub('recording');
  }

  function _renderTimer() {
    var el = $('rec-timer');
    if (!el) return;
    var m = Math.floor(_elapsedSecs / 60);
    var s = _elapsedSecs % 60;
    el.textContent = m + ':' + (s < 10 ? '0' + s : s);
  }

  // ── Recording: stop ───────────────────────────────────────────────────────────

  function stopRecording() {
    if (_recSubState !== 'recording') return;
    if (_timerId) { clearInterval(_timerId); _timerId = null; }
    _stopWaveform();
    if (_recorder && _recorder.state !== 'inactive') {
      _recorder.stop();
      // onstop callback → _showRecSub('recorded')
    }
  }

  // ── Recording: reset (re-record) ──────────────────────────────────────────────

  function resetRecording() {
    _resetRecorder();
    _clearRecError();
    _showRecSub('idle');
  }

  function _resetRecorder() {
    if (_timerId) { clearInterval(_timerId); _timerId = null; }
    _stopWaveform();
    if (_recorder && _recorder.state !== 'inactive') {
      _recorder.onstop = null;   // prevent stale onstop from firing after reset
      try { _recorder.stop(); } catch (_) {}
    }
    _recorder     = null;
    _audioChunks  = [];
    _recordedBlob = null;
    _elapsedSecs  = 0;
    // Reset timer display
    var timerEl = $('rec-timer');
    if (timerEl) timerEl.textContent = '0:00';
    // Clear waveform canvas
    var canvas = $('rec-canvas');
    if (canvas) {
      var ctx2d = canvas.getContext('2d');
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ── Recording: submit for grading ─────────────────────────────────────────────

  function submitRecording() {
    if (!_recordedBlob) {
      _showRecError('Chưa có bản ghi âm. Hãy nhấn "Bắt đầu ghi âm" và ghi âm câu trả lời trước.');
      return;
    }
    if (!_currentQ || !_currentQ.id) {
      _showRecError('Lỗi: không xác định được câu hỏi hiện tại. Hãy tải lại trang.');
      return;
    }
    _startProcessing(_recordedBlob);
  }

  // ── Error banner in recording state ──────────────────────────────────────────

  function _showRecError(msg) {
    var el = $('rec-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
    // Auto-hide after 7 s
    setTimeout(function () { el.style.display = 'none'; }, 7000);
  }

  function _clearRecError() {
    var el = $('rec-error');
    if (el) el.style.display = 'none';
  }

  // ── STATE: Processing ─────────────────────────────────────────────────────────

  function _startProcessing(blob) {
    showState('processing');
    var idx   = 0;
    var textEl = $('processing-text');
    if (textEl) textEl.textContent = PROCESSING_TEXTS[0];
    _processingTimer = setInterval(function () {
      idx = (idx + 1) % PROCESSING_TEXTS.length;
      if (textEl) textEl.textContent = PROCESSING_TEXTS[idx];
    }, 2000);
    _uploadAndGrade(blob);
  }

  async function _uploadAndGrade(blob) {
    var data = null;
    try {
      var fd = new FormData();
      fd.append('question_id', _currentQ.id);          // must match backend Form param
      fd.append('audio_file',  blob, 'response.webm'); // must match backend File param
      data = await window.api.upload(
        '/sessions/' + _sessionId + '/responses',
        fd
      );
    } catch (err) {
      console.error('[practice] grading request failed:', err);
      data = { _stub: true, _error: err.message };
    } finally {
      if (_processingTimer) { clearInterval(_processingTimer); _processingTimer = null; }
    }
    _showFeedback(data || { _stub: true, _error: 'Không có phản hồi từ server' });
  }

  // ── STATE: Feedback ───────────────────────────────────────────────────────────

  function _showFeedback(data) {
    // ── Overall band circle ──────────────────────────────────────────────────
    var bandWrapper = $('feedback-band-wrapper');
    var bandEl      = $('feedback-band');
    var band        = (data && data.overall_band != null) ? data.overall_band : null;

    if (band != null && bandWrapper && bandEl) {
      bandEl.textContent = parseFloat(band).toFixed(1);
      bandWrapper.style.display = 'flex';
    } else if (bandWrapper) {
      bandWrapper.style.display = 'none';
    }

    // ── Per-criterion band pills ─────────────────────────────────────────────
    var bandsRow = $('feedback-bands-row');
    if (bandsRow) {
      if (data && data.band_fc != null) {
        bandsRow.innerHTML =
          _bandPill('FC',  data.band_fc)  +
          _bandPill('LR',  data.band_lr)  +
          _bandPill('GRA', data.band_gra) +
          _bandPill('P',   data.band_p);
        bandsRow.style.display = 'flex';
      } else {
        bandsRow.style.display = 'none';
      }
    }

    // ── Comments / feedback blocks ───────────────────────────────────────────
    var commentsEl = $('feedback-comments');
    if (commentsEl) {
      if (data && data._stub) {
        var errNote = data._error ? (' (' + _esc(data._error) + ')') : '';
        commentsEl.innerHTML =
          '<p style="font-size:13px;font-style:italic;color:rgba(255,255,255,0.4);">' +
          'Câu trả lời đã được ghi lại nhưng chưa thể chấm điểm ngay lúc này.' +
          errNote + '</p>';
      } else if (data && data.fc_feedback) {
        commentsEl.innerHTML =
          _criterionBlock('Fluency &amp; Coherence', data.fc_feedback)  +
          _criterionBlock('Lexical Resource',        data.lr_feedback)  +
          _criterionBlock('Grammar &amp; Accuracy',  data.gra_feedback) +
          _criterionBlock('Pronunciation',           data.p_feedback)   +
          _listBlock('Điểm mạnh',      data.strengths,    '#4ade80')    +
          _listBlock('Cần cải thiện',  data.improvements, '#fb923c')    +
          (data.improved_response ? _improvedBlock(data.improved_response) : '');
      } else {
        commentsEl.innerHTML =
          '<p style="font-size:13px;font-style:italic;color:rgba(255,255,255,0.4);">Không có nhận xét.</p>';
      }
    }

    // ── Transcript ───────────────────────────────────────────────────────────
    var transcriptWrap = $('feedback-transcript');
    var transcriptText = $('feedback-transcript-text');
    if (transcriptWrap && transcriptText) {
      if (data && data.transcript) {
        transcriptText.textContent = data.transcript;
        transcriptWrap.style.display = '';
      } else {
        transcriptWrap.style.display = 'none';
      }
    }

    // ── Next / Finish buttons ────────────────────────────────────────────────
    var isLast    = (_currentIdx >= _questions.length - 1);
    var btnNext   = $('btn-next-q');
    var btnFinish = $('btn-finish');
    if (btnNext)   { btnNext.style.display   = isLast ? 'none' : ''; }
    if (btnFinish) { btnFinish.style.display = isLast ? '' : 'none'; }

    showState('feedback');
  }

  // ── Feedback render helpers ───────────────────────────────────────────────────

  function _bandPill(label, value) {
    return '<div style="display:inline-flex;flex-direction:column;align-items:center;' +
      'background:rgba(255,255,255,0.07);border-radius:10px;padding:6px 14px;margin:0 3px;">' +
      '<span style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;' +
      'letter-spacing:.06em;margin-bottom:2px;">' + label + '</span>' +
      '<span style="font-size:20px;font-weight:700;color:#14b8a6;">' +
      parseFloat(value).toFixed(1) + '</span></div>';
  }

  function _criterionBlock(title, text) {
    if (!text) return '';
    return '<div style="margin-bottom:14px;">' +
      '<p style="font-size:11px;font-weight:700;color:#14b8a6;text-transform:uppercase;' +
      'letter-spacing:.06em;margin:0 0 5px;">' + title + '</p>' +
      '<p style="font-size:13px;line-height:1.65;color:rgba(255,255,255,0.75);margin:0;">' +
      _esc(text) + '</p></div>';
  }

  function _listBlock(title, items, color) {
    if (!items || !items.length) return '';
    var lis = items.map(function (item) {
      return '<li style="font-size:13px;color:rgba(255,255,255,0.75);margin-bottom:5px;">' +
        '<span style="color:' + color + ';margin-right:6px;">›</span>' + _esc(item) + '</li>';
    }).join('');
    return '<div style="margin-bottom:14px;">' +
      '<p style="font-size:11px;font-weight:700;color:' + color + ';text-transform:uppercase;' +
      'letter-spacing:.06em;margin:0 0 6px;">' + title + '</p>' +
      '<ul style="list-style:none;padding:0;margin:0;">' + lis + '</ul></div>';
  }

  function _improvedBlock(text) {
    return '<div style="margin-top:16px;background:rgba(20,184,166,0.08);' +
      'border-left:3px solid #14b8a6;border-radius:0 6px 6px 0;padding:12px 14px;">' +
      '<p style="font-size:11px;font-weight:700;color:#14b8a6;text-transform:uppercase;' +
      'letter-spacing:.06em;margin:0 0 7px;">Câu trả lời mẫu Band 7+</p>' +
      '<p style="font-size:13px;line-height:1.7;color:rgba(255,255,255,0.8);margin:0;">' +
      _esc(text) + '</p></div>';
  }

  // ── Navigation ────────────────────────────────────────────────────────────────

  function nextQuestion() {
    if (_recSubState === 'recording') {
      alert('Hãy nhấn "Dừng ghi âm" trước khi sang câu tiếp theo.');
      return;
    }
    if (_currentIdx >= _questions.length - 1) return;
    _currentIdx++;
    _showPrep();
  }

  async function finishSession() {
    if (_recSubState === 'recording') {
      alert('Hãy nhấn "Dừng ghi âm" trước khi hoàn thành phiên.');
      return;
    }
    var btn = $('btn-finish');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }

    // Release mic and AudioContext
    if (_stream) { _stream.getTracks().forEach(function (t) { t.stop(); }); _stream = null; }
    if (_audioCtx) { try { _audioCtx.close(); } catch (_) {} _audioCtx = null; }

    try {
      await window.api.patch('/sessions/' + _sessionId + '/complete', {});
    } catch (err) {
      console.warn('[practice] session complete failed:', err.message);
    }

    window.location.href = '/pages/dashboard.html?completed=1';
  }

  // ── Waveform visualiser ───────────────────────────────────────────────────────

  function _startWaveform() {
    var canvas = $('rec-canvas');
    if (!canvas || !_analyser) return;
    var ctx = canvas.getContext('2d');
    var buf = new Uint8Array(_analyser.frequencyBinCount);

    function draw() {
      _waveAnimId = requestAnimationFrame(draw);
      _analyser.getByteTimeDomainData(buf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(20,184,166,0.85)';
      ctx.lineWidth   = 2;
      var sliceW = canvas.width / buf.length;
      var x = 0;
      for (var i = 0; i < buf.length; i++) {
        var v = buf[i] / 128.0;
        var y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceW;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    }
    draw();
  }

  function _stopWaveform() {
    if (_waveAnimId) { cancelAnimationFrame(_waveAnimId); _waveAnimId = null; }
  }

  // ── Escape HTML ───────────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  async function init() {
    showState('loading');

    var sb = window.getSupabase && window.getSupabase();
    if (!sb) { showError('Không thể khởi tạo Supabase.'); return; }

    var result = await sb.auth.getSession();
    if (!result.data.session) {
      window.location.href = '/index.html';
      return;
    }

    var params = new URLSearchParams(window.location.search);
    _sessionId = params.get('session_id');

    if (!_sessionId) {
      showError('Thiếu session_id trong URL. Hãy bắt đầu phiên mới từ Dashboard.');
      return;
    }

    var loadMsg = $('loading-msg');

    try {
      if (loadMsg) loadMsg.textContent = 'Đang tải session...';
      _sessionData = await window.api.get('/sessions/' + _sessionId);

      if (loadMsg) loadMsg.textContent = 'Đang tải câu hỏi...';
      var questions = await window.api.get('/sessions/' + _sessionId + '/questions');

      if (!questions || questions.length === 0) {
        if (loadMsg) loadMsg.textContent = 'Đang tạo câu hỏi với AI...';
        questions = await window.api.post('/sessions/' + _sessionId + '/questions/generate', {});
      }

      if (!questions || questions.length === 0) {
        showError('Không có câu hỏi nào được tạo. Hãy thử lại.');
        return;
      }

      _questions  = questions;
      _currentIdx = 0;
      _showPrep();

    } catch (err) {
      showError('Không thể tải session: ' + (err.message || 'Lỗi không xác định'));
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  window.PracticeApp = {
    init:            init,
    goToRecording:   goToRecording,
    startRecording:  startRecording,
    stopRecording:   stopRecording,
    resetRecording:  resetRecording,
    submitRecording: submitRecording,
    nextQuestion:    nextQuestion,
    finishSession:   finishSession,
  };

})();
