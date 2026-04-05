// practice.js — 5-state IELTS recording practice
// Depends on: api.js (window.api, window.getSupabase, window.initSupabase)

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────

  var MAX_RECORD_SEC = { 1: 45, 2: 120, 3: 60 };

  var PROCESSING_TEXTS = [
    'Đang chuyển giọng nói thành văn bản...',
    'AI đang phân tích câu trả lời...',
    'Đang tạo nhận xét chi tiết...',
    'Đang tổng hợp kết quả...',
  ];

  // ── State ────────────────────────────────────────────────────────────────────

  var _currentState = null;   // 'loading' | 'prep' | 'reading' | 'recording' | 'processing' | 'feedback' | 'error'
  var _sessionId    = null;
  var _sessionData  = null;
  var _questions    = [];
  var _currentIdx   = 0;
  var _currentQ     = null;

  // Recording
  var _stream        = null;   // MediaStream from getUserMedia
  var _recorder      = null;   // MediaRecorder
  var _audioChunks   = [];
  var _recordedBlob  = null;

  // AudioContext / waveform
  var _audioCtx    = null;
  var _analyser    = null;
  var _waveAnimId  = null;

  // Countdown timer
  var _timerId   = null;
  var _secsLeft  = 0;

  // Processing text rotation
  var _processingTimerId = null;
  var _processingIdx     = 0;

  // ── DOM helper ───────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  // ── State management ─────────────────────────────────────────────────────────

  function showState(name) {
    var all = ['loading', 'error', 'prep', 'reading', 'recording', 'processing', 'feedback'];
    all.forEach(function (s) {
      var el = $('state-' + s);
      if (el) el.classList.toggle('active', s === name);
    });
    _currentState = name;
  }

  function showError(msg) {
    var el = $('error-msg');
    if (el) el.textContent = msg;
    showState('error');
  }

  // ── Session header ────────────────────────────────────────────────────────────

  function updateHeader() {
    if (!_sessionData) return;
    var el = $('hdr-info');
    if (el) {
      el.textContent = 'Part ' + _sessionData.part + ' · ' + (_sessionData.topic || '');
    }
    var prog = $('hdr-progress');
    if (prog) {
      prog.textContent = (_currentIdx + 1) + ' / ' + _questions.length;
    }
  }

  // ── STATE 1: Preparation ──────────────────────────────────────────────────────

  function showPrep() {
    _currentQ = _questions[_currentIdx];
    updateHeader();

    $('prep-q-counter').textContent = 'Câu ' + (_currentIdx + 1) + ' / ' + _questions.length;
    $('prep-part-badge').textContent = 'Part ' + (_sessionData ? _sessionData.part : '');
    $('prep-topic').textContent = _sessionData ? (_sessionData.topic || '') : '';
    $('prep-q-text').textContent = _currentQ.question_text || '';

    // Cue card (Part 2 only)
    var cueBlock = $('prep-cue');
    if (
      _sessionData && _sessionData.part === 2 &&
      _currentQ.cue_card_bullets && _currentQ.cue_card_bullets.length
    ) {
      $('prep-cue-bullets').innerHTML = _currentQ.cue_card_bullets
        .map(function (b) {
          return '<li class="flex items-start gap-2">'
            + '<span style="color:#14b8a6;margin-top:3px;">›</span>'
            + '<span>' + b + '</span>'
            + '</li>';
        })
        .join('');
      var refl = $('prep-cue-reflection');
      if (refl) refl.textContent = _currentQ.cue_card_reflection || '';
      cueBlock.classList.remove('hidden');
    } else {
      cueBlock.classList.add('hidden');
    }

    showState('prep');
  }

  // ── STATE 2: AI Reading (TTS) ─────────────────────────────────────────────────

  function startReading() {
    $('reading-q-text').textContent = _currentQ.question_text || '';
    $('reading-q-counter').textContent = 'Câu ' + (_currentIdx + 1) + ' / ' + _questions.length;
    showState('reading');

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      var utt  = new SpeechSynthesisUtterance(_currentQ.question_text || '');
      utt.lang = 'en-US';
      utt.rate = 0.88;
      utt.onend = function () {
        if (_currentState === 'reading') _startRecording();
      };
      utt.onerror = function () {
        if (_currentState === 'reading') _startRecording();
      };
      window.speechSynthesis.speak(utt);
    } else {
      // No TTS — go straight to recording
      setTimeout(function () {
        if (_currentState === 'reading') _startRecording();
      }, 800);
    }
  }

  function skipReading() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    _startRecording();
  }

  // ── STATE 3: Recording ────────────────────────────────────────────────────────

  async function _startRecording() {
    // Request mic (re-use stream if available)
    if (!_stream) {
      try {
        _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        showError('Không thể truy cập microphone: ' + err.message + '. Hãy cấp quyền và thử lại.');
        return;
      }
    }

    // AudioContext for waveform
    try {
      if (!_audioCtx || _audioCtx.state === 'closed') {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (_audioCtx.state === 'suspended') await _audioCtx.resume();
      var source = _audioCtx.createMediaStreamSource(_stream);
      _analyser  = _audioCtx.createAnalyser();
      _analyser.fftSize = 512;
      source.connect(_analyser);
    } catch (_) {
      // Waveform is optional — continue without it
      _analyser = null;
    }

    // MediaRecorder
    _audioChunks  = [];
    _recordedBlob = null;
    var mimeType  = '';
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) { mimeType = candidates[i]; break; }
    }

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
      _processRecording();
    };

    _recorder.start(250);

    // Countdown
    _secsLeft = MAX_RECORD_SEC[_sessionData ? _sessionData.part : 1] || 60;
    _updateTimer();
    _timerId = setInterval(function () {
      _secsLeft--;
      _updateTimer();
      if (_secsLeft <= 0) stopRecording();
    }, 1000);

    // Waveform
    _startWaveform();

    showState('recording');

    // Pulse class on mic button
    var btn = $('btn-mic-pulse');
    if (btn) btn.classList.add('recording');
  }

  function _updateTimer() {
    var el = $('recording-timer');
    if (!el) return;
    var m = Math.floor(_secsLeft / 60);
    var s = _secsLeft % 60;
    el.textContent = m + ':' + (s < 10 ? '0' + s : s);

    if (_secsLeft < 10) {
      el.style.color = '#f87171';
    } else {
      el.style.color = '';
    }
  }

  function stopRecording() {
    if (_timerId) { clearInterval(_timerId); _timerId = null; }
    _stopWaveform();
    if (_recorder && _recorder.state !== 'inactive') {
      _recorder.stop();
    }
    // onstop → _processRecording
  }

  // ── Waveform ──────────────────────────────────────────────────────────────────

  function _startWaveform() {
    var canvas = $('recording-canvas');
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
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
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

  // ── STATE 4: Processing ───────────────────────────────────────────────────────

  function _processRecording() {
    showState('processing');

    _processingIdx = 0;
    var textEl = $('processing-text');
    if (textEl) textEl.textContent = PROCESSING_TEXTS[0];

    _processingTimerId = setInterval(function () {
      _processingIdx = (_processingIdx + 1) % PROCESSING_TEXTS.length;
      if (textEl) textEl.textContent = PROCESSING_TEXTS[_processingIdx];
    }, 2000);

    _uploadAndGetFeedback(_recordedBlob);
  }

  async function _uploadAndGetFeedback(blob) {
    var feedback = null;

    try {
      var fd = new FormData();
      fd.append('question_id', _currentQ.id);
      fd.append('audio_file', blob, 'response.webm');
      feedback = await window.api.upload(
        '/sessions/' + _sessionId + '/responses',
        fd
      );
    } catch (err) {
      console.warn('[practice] Grading upload failed:', err.message);
      feedback = { _stub: true, _error: err.message };
    }

    if (_processingTimerId) { clearInterval(_processingTimerId); _processingTimerId = null; }
    _showFeedback(feedback || {});
  }

  // ── STATE 5: Feedback ─────────────────────────────────────────────────────────

  function _showFeedback(data) {
    // Band score
    var bandWrapper = $('feedback-band-wrapper');
    var bandEl      = $('feedback-band');
    var band        = (data && data.overall_band != null) ? data.overall_band : null;

    if (band != null && bandEl) {
      bandEl.textContent = parseFloat(band).toFixed(1);
      bandWrapper && bandWrapper.classList.remove('hidden');
    } else {
      bandWrapper && bandWrapper.classList.add('hidden');
    }

    // Per-criterion bands row
    var bandsRow = $('feedback-bands-row');
    if (bandsRow) {
      if (data && data.band_fc != null) {
        bandsRow.innerHTML = _bandPill('FC', data.band_fc)
          + _bandPill('LR', data.band_lr)
          + _bandPill('GRA', data.band_gra)
          + _bandPill('P', data.band_p);
        bandsRow.classList.remove('hidden');
      } else {
        bandsRow.classList.add('hidden');
      }
    }

    // Comments
    var commentsEl = $('feedback-comments');
    if (commentsEl) {
      if (data && data._stub) {
        var errNote = data._error ? (' (' + _escHtml(data._error) + ')') : '';
        commentsEl.innerHTML = '<p class="text-sm italic" style="color:rgba(255,255,255,0.35);">'
          + 'Câu trả lời đã được ghi lại. Nhận xét chi tiết chưa sẵn sàng.' + errNote + '</p>';
      } else if (data && data.fc_feedback) {
        commentsEl.innerHTML = _criterionBlock('Fluency & Coherence', data.fc_feedback)
          + _criterionBlock('Lexical Resource', data.lr_feedback)
          + _criterionBlock('Grammar', data.gra_feedback)
          + _criterionBlock('Pronunciation', data.p_feedback)
          + _listBlock('Điểm mạnh', data.strengths, '#4ade80')
          + _listBlock('Cần cải thiện', data.improvements, '#fb923c')
          + (data.improved_response ? _improvedBlock(data.improved_response) : '');
      } else {
        commentsEl.innerHTML = '<p class="text-sm italic" style="color:rgba(255,255,255,0.35);">'
          + 'Không có nhận xét.</p>';
      }
    }

    // Transcript
    var transcriptEl = $('feedback-transcript');
    if (transcriptEl) {
      if (data && data.transcript) {
        transcriptEl.innerHTML = '<p class="text-xs leading-relaxed" style="color:rgba(255,255,255,0.5);">'
          + _escHtml(data.transcript) + '</p>';
        transcriptEl.classList.remove('hidden');
      } else {
        transcriptEl.classList.add('hidden');
      }
    }

    // Next / Finish
    var isLast = (_currentIdx >= _questions.length - 1);
    var btnNext   = $('btn-next-q');
    var btnFinish = $('btn-finish');
    if (btnNext)   btnNext.classList.toggle('hidden', isLast);
    if (btnFinish) btnFinish.classList.toggle('hidden', !isLast);

    showState('feedback');
  }

  function _bandPill(label, value) {
    return '<div style="display:inline-flex;flex-direction:column;align-items:center;'
      + 'background:rgba(255,255,255,0.07);border-radius:8px;padding:6px 12px;margin:0 4px;">'
      + '<span style="font-size:10px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:.05em;">' + label + '</span>'
      + '<span style="font-size:18px;font-weight:700;color:#14b8a6;">' + parseFloat(value).toFixed(1) + '</span>'
      + '</div>';
  }

  function _criterionBlock(title, text) {
    if (!text) return '';
    return '<div style="margin-bottom:12px;">'
      + '<p style="font-size:11px;font-weight:600;color:#14b8a6;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + _escHtml(title) + '</p>'
      + '<p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.75);">' + _escHtml(text) + '</p>'
      + '</div>';
  }

  function _listBlock(title, items, color) {
    if (!items || !items.length) return '';
    var lis = items.map(function (item) {
      return '<li style="font-size:13px;color:rgba(255,255,255,0.75);margin-bottom:4px;">'
        + '<span style="color:' + color + ';margin-right:6px;">›</span>' + _escHtml(item) + '</li>';
    }).join('');
    return '<div style="margin-bottom:12px;">'
      + '<p style="font-size:11px;font-weight:600;color:' + color + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">' + _escHtml(title) + '</p>'
      + '<ul style="list-style:none;padding:0;margin:0;">' + lis + '</ul>'
      + '</div>';
  }

  function _improvedBlock(text) {
    return '<div style="margin-top:14px;background:rgba(20,184,166,0.08);border-left:3px solid #14b8a6;border-radius:4px;padding:12px;">'
      + '<p style="font-size:11px;font-weight:600;color:#14b8a6;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Câu trả lời mẫu (Band 7+)</p>'
      + '<p style="font-size:13px;line-height:1.7;color:rgba(255,255,255,0.8);">' + _escHtml(text) + '</p>'
      + '</div>';
  }

  function nextQuestion() {
    if (_currentIdx >= _questions.length - 1) return;
    _currentIdx++;
    showPrep();
  }

  async function finishSession() {
    var btn = $('btn-finish');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }

    // Stop media stream
    if (_stream) {
      _stream.getTracks().forEach(function (t) { t.stop(); });
      _stream = null;
    }
    if (_audioCtx) {
      try { _audioCtx.close(); } catch (_) {}
      _audioCtx = null;
    }

    try {
      await window.api.patch('/sessions/' + _sessionId + '/complete', {});
    } catch (err) {
      console.warn('[practice] Session complete failed:', err.message);
    }

    window.location.href = '/pages/dashboard.html?completed=1';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function _escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  async function init() {
    showState('loading');

    // Auth guard
    var sb = window.getSupabase && window.getSupabase();
    if (!sb) { showError('Không thể khởi tạo Supabase.'); return; }

    var result = await sb.auth.getSession();
    if (!result.data.session) {
      window.location.href = '/index.html';
      return;
    }

    var params    = new URLSearchParams(window.location.search);
    var sessionId = params.get('session_id');

    if (!sessionId) {
      window.location.href = '/pages/dashboard.html';
      return;
    }

    _sessionId = sessionId;

    var loadMsg = $('loading-msg');

    try {
      // Load session
      if (loadMsg) loadMsg.textContent = 'Đang tải session...';
      _sessionData = await window.api.get('/sessions/' + _sessionId);

      // Load or generate questions
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
      showPrep();

    } catch (err) {
      showError('Không thể tải session: ' + err.message);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  window.PracticeApp = {
    init:          init,
    startReading:  startReading,
    skipReading:   skipReading,
    stopRecording: stopRecording,
    nextQuestion:  nextQuestion,
    finishSession: finishSession,
  };
})();
