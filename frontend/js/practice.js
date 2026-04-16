// practice.js — IELTS Speaking practice: prep → record → grade → feedback
// Depends on: api.js (window.api, window.getSupabase, window.initSupabase)

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────────

  // Hard-stop recording after this many seconds per part (silent — not shown to user)
  var MAX_RECORD_SEC = { 1: 45, 2: 120, 3: 75 };

  var P2_PREP_SEC  = 60;   // Part 2 prep countdown (seconds)
  var P2_SPEAK_SEC = 120;  // Part 2 speaking countdown (seconds)

  var BREAK_SEC = 30;      // Inter-part break in Full Test mode

  // Exam question counts per part
  var TEST_Q_COUNT      = { 1: 5, 2: 1, 3: 4 };   // test_part mode
  var FULL_TEST_Q_COUNT = { 1: 9, 2: 1, 3: 5 };   // test_full mode

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

  // Part 2 timers
  var _p2PrepTimerId   = null;
  var _p2PrepSecsLeft  = 0;
  var _p2SpeakTimerId  = null;
  var _p2SpeakSecsLeft = 0;

  // Test mode
  var _testMode         = null;   // null | 'test_part' | 'test_full'
  var _testResults      = [];     // [{part, questionText, response}]
  var _breakTimerId     = null;
  var _breakSecsLeft    = 0;
  var _ftP2Topic        = null;   // stored Part 2 topic for Full Test chaining
  var _ftCurrentPart    = null;   // current part being tested in Full Test (1 | 2 | 3)
  var _ftAllSessionIds  = [];     // all session IDs created during a Full Test (completed at the end)

  // Deferred grading: answers collected during test flow, processed in batch at end of part
  var _pendingTestAnswers = [];  // [{questionId, blob, questionText, part}]

  // Blob URL for the current practice-mode recording (used for replay/download on feedback screen)
  var _feedbackAudioUrl = null;

  // response_id of the most recently graded response (practice mode — used for pron assessment)
  var _currentResponseId = null;

  // Question mode for Part 1 & 3 — 'visual' (read on screen) | 'listening' (hear via TTS)
  // Persisted in sessionStorage so the choice survives across questions in the same tab session.
  var _qMode = (function () {
    try { return sessionStorage.getItem('ielts_qmode') || 'visual'; } catch (e) { return 'visual'; }
  }());

  // ── DOM helper ────────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  // ── Top-level state management ────────────────────────────────────────────────

  var _ALL_STATES = ['loading', 'error', 'mode-choice', 'prep', 'p2a', 'p2b', 'p2c', 'processing', 'feedback', 'break', 'test-results'];

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
    if (info) {
      // For Full Test Part 1, the topic is a '|||'-joined string — show only the part number.
      var topicStr = (_sessionData.topic || '');
      var headerTopic = (topicStr.indexOf('|||') !== -1) ? '' : (' · ' + topicStr);
      info.textContent = 'Part ' + _sessionData.part + headerTopic;
      info.classList.remove('hidden');
    }
    var prog = $('hdr-progress');
    if (prog) {
      prog.textContent = (_currentIdx + 1) + ' / ' + _questions.length;
      prog.classList.remove('hidden');
    }

    // Progress bar — only shown in test modes
    var barWrap  = $('progress-bar-wrap');
    var barFill  = $('progress-bar-fill');
    var barLabel = $('progress-bar-label');
    if (barWrap && barFill && barLabel) {
      if (_testMode) {
        barWrap.style.display = '';
        var pct, labelText;
        if (_testMode === 'test_full') {
          // Cumulative questions before each part starts (Part 1: 9q, Part 2: 1q, Part 3: 5q → total 15)
          var _FT_BEFORE = { 1: 0, 2: 9, 3: 10 };
          var _FT_TOTAL  = 15;
          var currentPart        = _ftCurrentPart || _sessionData.part;
          var doneBeforeThisPart = _FT_BEFORE[currentPart] || 0;
          var overallDone        = doneBeforeThisPart + (_currentIdx + 1);
          pct = Math.round((overallDone / _FT_TOTAL) * 100);
          labelText = 'Part ' + currentPart + ' / 3  ·  Câu ' + (_currentIdx + 1) + ' / ' + _questions.length + '  ·  Tổng: ' + overallDone + ' / ' + _FT_TOTAL;
        } else {
          // test_part
          pct = _questions.length > 0 ? Math.round((_currentIdx + 1) / _questions.length * 100) : 0;
          labelText = 'Câu ' + (_currentIdx + 1) + ' / ' + _questions.length;
        }
        barFill.style.width = pct + '%';
        barLabel.textContent = labelText;
      } else {
        barWrap.style.display = 'none';
      }
    }
  }

  // ── STATE: Prep ───────────────────────────────────────────────────────────────

  function _showPrep() {
    _currentQ = _questions[_currentIdx];
    _updateHeader();

    // Part 2 uses the dedicated cue-card flow
    if (_sessionData && _sessionData.part === 2) {
      _showP2Cue();
      return;
    }

    $('prep-q-counter').textContent = 'Câu ' + (_currentIdx + 1) + ' / ' + _questions.length;
    $('prep-part-badge').textContent = 'Part ' + (_sessionData ? _sessionData.part : '');

    // Full Test Part 1 — show subtopic group header
    var rawTopic = _sessionData ? (_sessionData.topic || '') : '';
    var displayTopic = rawTopic;
    if (_testMode === 'test_full' && _sessionData && _sessionData.part === 1) {
      // Prefer data-driven subtopic field (set by backend per question)
      if (_currentQ && _currentQ.subtopic) {
        var subtopics = rawTopic.indexOf('|||') !== -1
          ? rawTopic.split('|||').map(function (t) { return t.trim(); }).filter(Boolean)
          : [_currentQ.subtopic];
        var groupTopic = _currentQ.subtopic;
        // Determine group index by finding unique subtopic order
        var seenSubtopics = [];
        for (var si = 0; si <= _currentIdx; si++) {
          var st = _questions[si] && _questions[si].subtopic;
          if (st && seenSubtopics.indexOf(st) === -1) seenSubtopics.push(st);
        }
        var groupIdx = seenSubtopics.indexOf(groupTopic);
        if (groupIdx === -1) groupIdx = seenSubtopics.length - 1;
        var totalGroups = subtopics.length || 3;
        displayTopic = 'Nhóm ' + (groupIdx + 1) + '/' + totalGroups + ' · ' + groupTopic;
      } else if (rawTopic.indexOf('|||') !== -1) {
        // Fallback: positional grouping when subtopic field is absent
        var subtopics = rawTopic.split('|||').map(function (t) { return t.trim(); }).filter(Boolean);
        var groupIdx  = Math.floor(_currentIdx / 3);
        var groupTopic = subtopics[groupIdx] || subtopics[0] || rawTopic;
        displayTopic = 'Nhóm ' + (groupIdx + 1) + '/' + subtopics.length + ' · ' + groupTopic;
      }
    }
    $('prep-topic').textContent = displayTopic;

    $('prep-q-text').textContent = _currentQ.question_text || '';

    // Issue 2: Reset inline recording section when showing prep
    var inlineRec = $('inline-rec-section');
    if (inlineRec) inlineRec.style.display = 'none';
    var startBtn = $('prep-start-btn');
    if (startBtn) startBtn.style.display = '';

    // Full Test: hide question text by default (listening/exam mode)
    var revealWrap = $('prep-text-reveal');
    var revealBtn  = $('prep-reveal-btn');
    if (_testMode === 'test_full') {
      if (revealWrap) revealWrap.style.display = 'none';
      if (revealBtn)  revealBtn.style.display  = '';
    } else {
      if (revealWrap) revealWrap.style.display = '';
      if (revealBtn)  revealBtn.style.display  = 'none';
    }

    // Cue card — Part 2 only
    var cueBlock = $('prep-cue');
    var hasCue = _sessionData && _sessionData.part === 2
      && _currentQ.cue_card_bullets && _currentQ.cue_card_bullets.length;

    if (hasCue) {
      $('prep-cue-bullets').innerHTML = _currentQ.cue_card_bullets.map(function (b) {
        return '<div class="ds-cue-bullet">' + _esc(b) + '</div>';
      }).join('');
      var refl = $('prep-cue-reflection');
      if (refl) refl.textContent = _currentQ.cue_card_reflection || '';
      cueBlock && cueBlock.classList.remove('hidden');
    } else {
      cueBlock && cueBlock.classList.add('hidden');
    }

    showState('prep');
    _applyQModeUI();   // render toggle + controls for current mode

    // Auto-play question in listening mode (exam simulation for test_full).
    // _ttsAI falls back to browser TTS automatically if the user hasn't yet
    // interacted with this page (first question), so no silence ever occurs.
    if (_qMode === 'listening' && _currentQ) {
      _ttsAI(_currentQ.question_text || '', _currentQ.id);
    }
  }

  // Called by prep button "Bắt đầu ghi âm"
  function goToRecording() {
    if (!_currentQ) return;
    _clearRecError();
    _resetRecorder();          // clean slate for this question

    // Show inline recording section; hide the start button
    var inlineRec = $('inline-rec-section');
    if (inlineRec) inlineRec.style.display = '';
    var startBtn = $('prep-start-btn');
    if (startBtn) startBtn.style.display = 'none';

    startRecording();          // begin recording immediately — no extra click needed
  }

  // ── Recording: start ──────────────────────────────────────────────────────────

  async function startRecording() {
    if (_recSubState === 'recording') return;
    _stopAITts();
    window.speechSynthesis && window.speechSynthesis.cancel();
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
    var questionId = _currentQ && (_currentQ.id || _currentQ.question_id);
    if (!questionId) {
      _showRecError('Lỗi: không xác định được câu hỏi hiện tại. Hãy tải lại trang.');
      return;
    }

    // Test modes: defer grading — collect answer and advance immediately
    if (_testMode) {
      _pendingTestAnswers.push({
        sessionId:    _sessionId,
        questionId:   questionId,
        blob:         _recordedBlob,
        questionText: _currentQ ? (_currentQ.question_text || '') : '',
        part:         _sessionData ? _sessionData.part : null,
      });
      _advanceTestMode();
      return;
    }

    _startProcessing(_recordedBlob, questionId);
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

  function _startProcessing(blob, questionId) {
    showState('processing');
    var idx   = 0;
    var textEl = $('processing-text');
    if (textEl) textEl.textContent = PROCESSING_TEXTS[0];
    _processingTimer = setInterval(function () {
      idx = (idx + 1) % PROCESSING_TEXTS.length;
      if (textEl) textEl.textContent = PROCESSING_TEXTS[idx];
    }, 2000);
    _uploadAndGrade(blob, questionId);
  }

  async function _uploadAndGrade(blob, questionId) {
    var data = null;
    try {
      var fd = new FormData();
      fd.append('question_id', questionId);            // must match backend Form param
      fd.append('audio_file',  blob, 'response.webm'); // must match backend File param
      data = await window.api.upload(
        '/sessions/' + _sessionId + '/responses',
        fd
      );
    } catch (err) {
      var errMsg = err.message || 'Lỗi không xác định';
      if (errMsg === 'Failed to fetch' || errMsg.includes('NetworkError')) {
        errMsg = 'Không thể kết nối backend. Hãy kiểm tra server đang chạy.';
      }
      console.error('[practice] grading request failed:', err);
      data = { _stub: true, _error: errMsg };
    } finally {
      if (_processingTimer) { clearInterval(_processingTimer); _processingTimer = null; }
    }
    _showFeedback(data || { _stub: true, _error: 'Không có phản hồi từ server' });
  }

  // ── STATE: Feedback ───────────────────────────────────────────────────────────

  function _showFeedback(data) {
    // ── Test mode: skip feedback, accumulate and advance ──────────────────────
    if (_testMode) {
      _testResults.push({
        part:         _sessionData.part,
        questionText: _currentQ ? (_currentQ.question_text || '') : '',
        response:     data,
        sessionId:    _sessionId,
      });
      _advanceTestMode();
      return;
    }

    // ── Capture response_id for on-demand pronunciation ───────────────────────
    _currentResponseId = (data && data.response_id) ? data.response_id : null;

    // ── Overall band circle ──────────────────────────────────────────────────
    var bandWrapper = $('feedback-band-wrapper');
    var bandEl      = $('feedback-band');
    var band        = (data && data.overall_band != null) ? data.overall_band : null;

    if (band != null && bandWrapper && bandEl) {
      bandEl.textContent = parseFloat(band).toFixed(1);
      bandWrapper.style.display = 'block';
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
        var isAiDown = data._error && data._error.includes('temporarily unavailable');
        commentsEl.innerHTML = isAiDown
          ? '<div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);'
            + 'border-radius:10px;padding:12px 14px;">'
            + '<p style="font-size:13px;font-weight:600;color:#fbbf24;margin:0 0 4px;">AI chấm điểm tạm thời không khả dụng</p>'
            + '<p style="font-size:13px;color:rgba(255,255,255,0.55);margin:0;">'
            + 'Bản ghi âm và văn bản của bạn đã được lưu thành công. '
            + 'Chấm điểm sẽ khả dụng khi dịch vụ AI được khôi phục.</p>'
            + '</div>'
          : '<p style="font-size:13px;font-style:italic;color:rgba(255,255,255,0.4);">'
            + 'Câu trả lời đã được ghi lại nhưng chưa thể chấm điểm ngay lúc này.'
            + (data._error ? ' (' + _esc(data._error) + ')' : '')
            + '</p>';
      } else if (data && data.grammar_issues) {
        // ── Practice mode coaching feedback ──────────────────────────────────
        commentsEl.innerHTML =
          '<div id="score-confidence-note">' + _reliabilityNote(data) + '</div>' +
          _listBlock('Strengths', data.strengths, '#4ade80') +
          _listBlock('Grammar Issues', data.grammar_issues, '#f87171') +
          _listBlock('Vocabulary Issues', data.vocabulary_issues, '#fb923c') +
          _correctionsBlock(data.corrections) +
          (data.sample_answer ? _sampleAnswerBlock(data.sample_answer) : '');
      } else if (data && data.fc_feedback) {
        // ── Test mode formal IELTS feedback ──────────────────────────────────
        commentsEl.innerHTML =
          '<div id="score-confidence-note">' + _reliabilityNote(data) + '</div>' +
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

    // ── Audio replay / download ──────────────────────────────────────────────
    // Revoke any URL from the previous question before creating a new one
    if (_feedbackAudioUrl) {
      URL.revokeObjectURL(_feedbackAudioUrl);
      _feedbackAudioUrl = null;
    }
    var audioSection = $('feedback-audio-section');
    if (audioSection) {
      if (_recordedBlob) {
        _feedbackAudioUrl = URL.createObjectURL(_recordedBlob);
        audioSection.style.display = '';
      } else {
        audioSection.style.display = 'none';
      }
    }

    // ── Next / Finish buttons ────────────────────────────────────────────────
    var isLast    = (_currentIdx >= _questions.length - 1);
    var btnNext   = $('btn-next-q');
    var btnFinish = $('btn-finish');
    if (btnNext)   { btnNext.style.display   = isLast ? 'none' : ''; }
    if (btnFinish) {
      btnFinish.style.display = isLast ? '' : 'none';
      if (isLast) {
        btnFinish.textContent = 'Xem kết quả toàn session →';
      }
    }

    // ── Grammar Resources ────────────────────────────────────────────────────
    _showGrammarResources(data);

    // ── Pronunciation: auto-trigger (practice mode only) ─────────────────────
    var pronSection = $('pronunciation-section');
    var pronLoading = $('pron-loading-block');
    var pronResult  = $('pron-result-block');
    if (pronSection) {
      if (_currentResponseId && _recordedBlob) {
        // Show loading, hide result — states are mutually exclusive
        if (pronLoading) { pronLoading.style.display = 'flex'; }
        if (pronResult)  { pronResult.style.display = 'none'; pronResult.innerHTML = ''; }
        pronSection.style.display = '';
        // Fire and forget — does not block feedback rendering
        assessSinglePronunciation(null);
      } else {
        pronSection.style.display = 'none';
        if (pronLoading) { pronLoading.style.display = 'none'; }
        if (pronResult)  { pronResult.style.display = 'none'; }
      }
    }

    showState('feedback');
  }

  // ── Grammar Resources v3 ─────────────────────────────────────────────────────

  // Keyword index: slug + Vietnamese topic label + keywords
  var _GR_KW = [
    { slug: 'articles',              topic: 'mạo từ',                  kw: ['article', ' a ', ' an ', ' the ', 'definite', 'indefinite', 'mạo từ'] },
    { slug: 'present-perfect',       topic: 'thì hiện tại hoàn thành', kw: ['present perfect', 'have been', 'has been', 'have + past participle', 'for and since', 'already', 'just', 'yet'] },
    { slug: 'present-continuous',    topic: 'thì hiện tại tiếp diễn',  kw: ['present continuous', 'present progressive', 'is + v-ing', 'are + v-ing', 'am + v-ing'] },
    { slug: 'present-simple',        topic: 'thì hiện tại đơn',        kw: ['present simple', 'simple present', 'third person', 's-form', 'frequency adverb'] },
    { slug: 'past-simple',           topic: 'thì quá khứ đơn',         kw: ['past simple', 'simple past', 'past tense', 'irregular verb', 'regular verb', 'v2'] },
    { slug: 'future-forms',          topic: 'thì tương lai',            kw: ['future', 'going to', "won't", 'will be'] },
    { slug: 'gerund',                topic: 'danh động từ',             kw: ['gerund', 'v-ing form', '-ing form', 'enjoy', 'avoid', 'finish', 'after preposition'] },
    { slug: 'infinitive',            topic: 'to-infinitive',            kw: ['to-infinitive', 'to infinitive', 'want to', 'hope to', 'plan to', 'decide to', 'need to'] },
    { slug: 'bare-infinitive',       topic: 'bare infinitive',          kw: ['bare infinitive', 'modal verb', 'after modal', 'can swim', 'should study', 'must use'] },
    { slug: 'gerund-vs-infinitive',  topic: 'gerund và infinitive',     kw: ['gerund or infinitive', 'gerund vs infinitive', 'stop doing', 'stop to', 'remember doing', 'remember to', 'try doing', 'try to'] },
    { slug: 'adjectives',            topic: 'tính từ',                  kw: ['adjective', 'describing noun', 'attributive', 'predicative'] },
    { slug: 'adverbs',               topic: 'trạng từ',                 kw: ['adverb', 'adverbs', 'manner adverb', 'frequency adverb', 'adverbial'] },
    { slug: 'adjective-vs-adverb',   topic: 'tính từ và trạng từ',     kw: ['adjective or adverb', 'adjective vs adverb', 'adjective instead of adverb', 'good or well', 'linking verb', 'look good', 'feel bad', 'sounds great'] },
    { slug: 'sentence-elements',     topic: 'thành phần câu',           kw: ['subject', 'subject-verb agreement', 'verb agreement', 'sentence element', 'subject and verb'] },
    { slug: 'countable-vs-uncountable', topic: 'danh từ đếm được',     kw: ['countable', 'uncountable', 'count noun', 'mass noun', 'much or many', 'little or few'] },
    { slug: 'singular-vs-plural',    topic: 'số ít / số nhiều',        kw: ['singular', 'plural', 'singular verb', 'plural verb', 'verb agreement'] },
    { slug: 'compound-sentence',     topic: 'câu ghép',                 kw: ['compound sentence', 'coordinating conjunction', 'fanboys', 'run-on sentence'] },
    { slug: 'complex-sentence',      topic: 'câu phức',                 kw: ['complex sentence', 'subordinate', 'subordinating conjunction', 'relative clause', 'because', 'although', 'even though'] },
  ];

  // Fallback metadata (used if API fetch fails or hasn't resolved yet)
  var _GR_META_FALLBACK = {
    'articles':              { category: 'advanced',            title: 'Articles (a / an / the)',    summary: 'Dùng đúng mạo từ trong mọi ngữ cảnh' },
    'present-perfect':       { category: 'tenses',              title: 'Present Perfect',             summary: 'Hiện tại hoàn thành — cấu trúc, cách dùng và phân biệt với past simple' },
    'present-continuous':    { category: 'tenses',              title: 'Present Continuous',          summary: 'Thì hiện tại tiếp diễn — hành động đang xảy ra hoặc kế hoạch tương lai' },
    'present-simple':        { category: 'tenses',              title: 'Present Simple',              summary: 'Thì hiện tại đơn — thói quen, sự thật và trạng thái thường trực' },
    'past-simple':           { category: 'tenses',              title: 'Past Simple',                 summary: 'Thì quá khứ đơn — sự kiện và hành động đã hoàn thành' },
    'future-forms':          { category: 'tenses',              title: 'Future Forms',                summary: 'Các dạng tương lai — will, going to và present continuous' },
    'gerund':                { category: 'verb-patterns',       title: 'Gerund (V-ing)',              summary: 'Danh động từ — khi nào dùng V-ing thay vì to-infinitive' },
    'infinitive':            { category: 'verb-patterns',       title: 'To-Infinitive',               summary: 'Động từ nguyên thể có "to" — cấu trúc và cách dùng' },
    'bare-infinitive':       { category: 'verb-patterns',       title: 'Bare Infinitive',             summary: 'Động từ nguyên thể không có "to" — sau modal verbs và let/make' },
    'gerund-vs-infinitive':  { category: 'verb-patterns',       title: 'Gerund vs. Infinitive',       summary: 'Khi nào dùng V-ing, khi nào dùng to-V — và các động từ có nghĩa khác nhau' },
    'adjectives':            { category: 'modifiers',           title: 'Adjectives',                  summary: 'Tính từ — vị trí, thứ tự và cách dùng trong tiếng Anh' },
    'adverbs':               { category: 'modifiers',           title: 'Adverbs',                     summary: 'Trạng từ — các loại và vị trí đúng trong câu' },
    'adjective-vs-adverb':   { category: 'modifiers',           title: 'Adjective vs. Adverb',        summary: 'Phân biệt tính từ và trạng từ — lỗi phổ biến nhất trong speaking' },
    'sentence-elements':     { category: 'foundations',         title: 'Sentence Elements',           summary: 'Các thành phần câu cơ bản — subject, verb, object, complement' },
    'countable-vs-uncountable': { category: 'foundations',      title: 'Countable vs. Uncountable',   summary: 'Danh từ đếm được và không đếm được — dùng how much hay how many?' },
    'singular-vs-plural':    { category: 'foundations',         title: 'Singular & Plural',           summary: 'Số ít và số nhiều — cách chia động từ cho đúng' },
    'compound-sentence':     { category: 'sentence-structures', title: 'Compound Sentence',           summary: 'Câu ghép — nối hai mệnh đề độc lập bằng coordinating conjunctions' },
    'complex-sentence':      { category: 'sentence-structures', title: 'Complex Sentence',            summary: 'Câu phức — mệnh đề chính và mệnh đề phụ thuộc' },
  };

  // Dynamic metadata fetched from /api/grammar/categories (slug → {category, title, summary})
  var _grArticleIndex = null; // null = not yet fetched; {} = fetched (may be empty on error)

  // Eager-fetch article index so it's ready when feedback is shown
  function _fetchGrArticleIndex() {
    var base = (window.api && window.api.base) ? window.api.base : '';
    fetch(base + '/api/grammar/categories')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var idx = {};
        if (data && Array.isArray(data.categories)) {
          data.categories.forEach(function (cat) {
            if (Array.isArray(cat.articles)) {
              cat.articles.forEach(function (art) {
                idx[art.slug] = { category: art.category, title: art.title, summary: art.summary };
              });
            }
          });
        }
        _grArticleIndex = idx;
      })
      .catch(function () { _grArticleIndex = {}; });
  }

  // Resolve metadata for a slug: prefer live index, fall back to hardcoded
  function _grMeta(slug) {
    var live = _grArticleIndex && _grArticleIndex[slug];
    if (live && live.category) return live;
    return _GR_META_FALLBACK[slug] || null;
  }

  // ── Grammar Resources Tracker ─────────────────────────────────────────────────
  // sessionStorage-based; structured for easy backend/dashboard integration later
  var _GR_TRACKER = {
    _key: 'gr_shown_v1',
    track: function (matches) {
      try {
        var hist = this._load();
        var ts = Date.now();
        matches.forEach(function (m) {
          if (!hist[m.slug]) hist[m.slug] = { first: ts, count: 0, viewed: false };
          hist[m.slug].count += 1;
          hist[m.slug].last = ts;
        });
        sessionStorage.setItem(this._key, JSON.stringify(hist));
      } catch (e) {}
    },
    markViewed: function (slug) {
      try {
        var hist = this._load();
        if (hist[slug]) { hist[slug].viewed = true; sessionStorage.setItem(this._key, JSON.stringify(hist)); }
      } catch (e) {}
    },
    getHistory: function () { return this._load(); },
    _load: function () {
      try { return JSON.parse(sessionStorage.getItem(this._key) || '{}'); } catch (e) { return {}; }
    },
  };

  // Collect feedback text into 4 weighted buckets
  // grammar_issues ×4 | corrections ×3 | improvements ×2 | gra_feedback ×1
  // Excluded: sample_answer, strengths, lr_feedback, p_feedback, fc_feedback, vocabulary_issues
  function _grTexts(data) {
    if (!data || data._stub) return { gi: '', co: '', im: '', gf: '' };
    var gi = [], co = [], im = [], gf = [];
    if (Array.isArray(data.grammar_issues)) data.grammar_issues.forEach(function (s) { if (s) gi.push(String(s)); });
    if (Array.isArray(data.corrections)) {
      data.corrections.forEach(function (c) {
        if (c.explanation) co.push(String(c.explanation));
        if (c.original)    co.push(String(c.original));
        if (c.corrected)   co.push(String(c.corrected));
      });
    }
    if (Array.isArray(data.improvements)) data.improvements.forEach(function (s) { if (s) im.push(String(s)); });
    if (data.improved_response) im.push(String(data.improved_response));
    if (data.gra_feedback) gf.push(String(data.gra_feedback));
    return {
      gi: gi.join(' ').toLowerCase(),
      co: co.join(' ').toLowerCase(),
      im: im.join(' ').toLowerCase(),
      gf: gf.join(' ').toLowerCase(),
    };
  }

  // Score each keyword entry across 4 buckets; track which bucket drove the match
  function _matchGrArticles(texts, maxCount) {
    if (!texts.gi && !texts.co && !texts.im && !texts.gf) return [];
    var scored = [];
    _GR_KW.forEach(function (entry) {
      var sgi = 0, sco = 0, sim = 0, sgf = 0;
      entry.kw.forEach(function (kw) {
        var k = kw.toLowerCase();
        if (texts.gi && texts.gi.indexOf(k) !== -1) sgi += 4;
        if (texts.co && texts.co.indexOf(k) !== -1) sco += 3;
        if (texts.im && texts.im.indexOf(k) !== -1) sim += 2;
        if (texts.gf && texts.gf.indexOf(k) !== -1) sgf += 1;
      });
      var total = sgi + sco + sim + sgf;
      if (total > 0) {
        var meta = _grMeta(entry.slug);
        if (meta) {
          var buckets = [{ f: 'gi', s: sgi }, { f: 'co', s: sco }, { f: 'im', s: sim }, { f: 'gf', s: sgf }];
          var topField = buckets.reduce(function (best, cur) { return cur.s > best.s ? cur : best; }).f;
          scored.push({ slug: entry.slug, meta: meta, score: total, topField: topField, topic: entry.topic || '' });
        }
      }
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, maxCount);
  }

  // Human-readable reason text explaining why an article was matched
  function _grReason(topField, topic) {
    var t = topic ? ' về ' + topic : '';
    if (topField === 'gi') return 'Gợi ý vì bài có lỗi ngữ pháp' + t;
    if (topField === 'co') return 'Gợi ý vì có correction liên quan' + t;
    if (topField === 'im') return 'Gợi ý để cải thiện' + t;
    return 'Gợi ý dựa trên grammar feedback' + t;
  }

  // Card HTML: primary = full treatment with summary, secondary = compact muted
  function _grammarCardHtml(match, isPrimary) {
    var slug   = match.slug, meta = match.meta;
    var href   = 'grammar-article.html?category=' + meta.category + '&slug=' + slug;
    var reason = _grReason(match.topField, match.topic);

    if (isPrimary) {
      return '<a href="' + href + '" target="_blank" rel="noopener"'
        + ' style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;'
        + 'background:rgba(20,184,166,0.07);border:1px solid rgba(20,184,166,0.28);'
        + 'border-left:3px solid #14b8a6;border-radius:14px;text-decoration:none;'
        + 'transition:background 0.15s;"'
        + ' onmouseover="this.style.background=\'rgba(20,184,166,0.12)\'"'
        + ' onmouseout="this.style.background=\'rgba(20,184,166,0.07)\'">'
        + '<div style="flex:1;min-width:0;">'
        + '<p style="font-size:13px;font-weight:600;color:#e2e8f0;margin:0 0 3px;'
        + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(meta.title) + '</p>'
        + '<p style="font-size:12px;color:rgba(255,255,255,0.45);margin:0 0 6px;line-height:1.4;">'
        + _esc(meta.summary) + '</p>'
        + '<p style="font-size:11px;color:rgba(20,184,166,0.7);margin:0;">' + _esc(reason) + '</p>'
        + '</div>'
        + '<span style="flex-shrink:0;font-size:11px;font-weight:700;color:#14b8a6;'
        + 'background:rgba(20,184,166,0.14);border-radius:8px;padding:5px 10px;'
        + 'white-space:nowrap;align-self:center;">Học ngay →</span>'
        + '</a>';
    }
    return '<a href="' + href + '" target="_blank" rel="noopener"'
      + ' style="display:flex;align-items:center;gap:10px;padding:10px 14px;'
      + 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);'
      + 'border-radius:12px;text-decoration:none;transition:border-color 0.15s,background 0.15s;"'
      + ' onmouseover="this.style.borderColor=\'rgba(20,184,166,0.25)\';this.style.background=\'rgba(20,184,166,0.05)\'"'
      + ' onmouseout="this.style.borderColor=\'rgba(255,255,255,0.07)\';this.style.background=\'rgba(255,255,255,0.02)\'">'
      + '<div style="flex:1;min-width:0;">'
      + '<p style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.7);margin:0 0 2px;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(meta.title) + '</p>'
      + '<p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0;">' + _esc(reason) + '</p>'
      + '</div>'
      + '<span style="flex-shrink:0;font-size:11px;color:rgba(255,255,255,0.25);">→</span>'
      + '</a>';
  }

  // Practice: show 1 Quick Grammar Tip (top match only, primary styling)
  function _showGrammarResources(data) {
    var wrap  = $('grammar-resources');
    var cards = $('grammar-resources-cards');
    if (!wrap || !cards) return;

    var texts   = _grTexts(data);
    var matched = _matchGrArticles(texts, 1);

    if (!matched.length) {
      wrap.style.display = 'none';
      return;
    }

    _GR_TRACKER.track(matched);
    cards.innerHTML = _grammarCardHtml(matched[0], true);
    wrap.style.display = '';
  }

  // ── Audio replay / download (practice feedback screen) ───────────────────────

  function _replayAudio() {
    if (!_feedbackAudioUrl) return;
    var audio = new Audio(_feedbackAudioUrl);
    audio.play().catch(function (e) {
      console.warn('[audio] replay failed:', e);
    });
  }

  function _downloadAudio() {
    if (!_feedbackAudioUrl || !_recordedBlob) return;
    var mime = _recordedBlob.type || 'audio/webm';
    var ext  = mime.split('/')[1].split(';')[0] || 'webm';
    var ts   = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    var a    = document.createElement('a');
    a.href   = _feedbackAudioUrl;
    a.download = 'ielts_answer_' + ts + '.' + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── Feedback render helpers ───────────────────────────────────────────────────

  var _pillColorMap = { FC: 'fc', LR: 'lr', GRA: 'gra', P: 'p' };
  function _bandPill(label, value) {
    var cls = _pillColorMap[label] || 'fc';
    return '<div data-criterion="' + label + '" style="display:inline-flex;flex-direction:column;align-items:center;'
      + 'border-radius:10px;padding:6px 14px;margin:0 3px;" class="ds-band-pill ds-band-pill-' + cls + '">'
      + '<span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;'
      + 'margin-bottom:2px;opacity:0.6;">' + label + '</span>'
      + '<span style="font-size:20px;font-weight:700;">'
      + (Math.round(parseFloat(value) * 2) / 2).toFixed(1) + '</span></div>';
  }

  function _reliabilityNote(data) {
    // Use score_confidence (multi-signal) when available; fall back to assessment_confidence.
    var conf = (data && data.score_confidence) || (data && data.assessment_confidence);
    if (!conf || conf === 'high') return '';

    var isLow = conf === 'low';
    var borderColor = isLow ? '#f87171' : '#fbbf24';
    var bgColor     = isLow ? 'rgba(248,113,113,0.06)' : 'rgba(251,191,36,0.06)';
    var bdColor     = isLow ? 'rgba(248,113,113,0.22)' : 'rgba(251,191,36,0.22)';

    var msg = isLow
      ? 'Âm thanh ghi âm có chất lượng hạn chế — điểm số và nhận xét lần này chỉ mang tính tham khảo. '
        + 'Hãy thử ghi âm lại ở nơi yên tĩnh hơn hoặc nói to và rõ hơn để nhận được đánh giá chính xác hơn.'
      : 'Một số phần nhận xét có thể cần xem như gợi ý tham khảo — chất lượng âm thanh hoặc tốc độ nói '
        + 'có thể ảnh hưởng nhẹ đến độ chính xác của đánh giá.';

    return '<div style="background:' + bgColor + ';border:1px solid ' + bdColor + ';'
      + 'border-left:3px solid ' + borderColor + ';border-radius:10px;'
      + 'padding:11px 14px;margin-bottom:14px;'
      + 'font-size:12.5px;line-height:1.6;color:rgba(255,255,255,0.6);">'
      + msg
      + '</div>';
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

  function _correctionsBlock(corrections) {
    if (!corrections || corrections.length === 0) return '';
    var rows = corrections.map(function (c) {
      return '<div style="margin-bottom:10px;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:8px;">'
        + '<div style="font-size:12px;color:#f87171;margin-bottom:3px;">'
        + '<span style="opacity:0.6;">❌ </span>' + _esc(c.original) + '</div>'
        + '<div style="font-size:12px;color:#4ade80;margin-bottom:4px;">'
        + '<span style="opacity:0.6;">✓ </span>' + _esc(c.corrected) + '</div>'
        + '<div style="font-size:12px;color:rgba(255,255,255,0.55);font-style:italic;">'
        + _esc(c.explanation) + '</div>'
        + '</div>';
    }).join('');
    return '<div style="margin-bottom:14px;">'
      + '<p style="font-size:11px;font-weight:700;color:#fb923c;text-transform:uppercase;'
      + 'letter-spacing:.06em;margin:0 0 8px;">Corrections</p>'
      + rows + '</div>';
  }

  function _sampleAnswerBlock(text) {
    return '<div style="margin-top:16px;background:rgba(20,184,166,0.08);'
      + 'border-left:3px solid #14b8a6;border-radius:0 6px 6px 0;padding:12px 14px;">'
      + '<p style="font-size:11px;font-weight:700;color:#14b8a6;text-transform:uppercase;'
      + 'letter-spacing:.06em;margin:0 0 7px;">Sample Answer</p>'
      + '<p style="font-size:13px;line-height:1.7;color:rgba(255,255,255,0.8);margin:0;">'
      + _esc(text) + '</p></div>';
  }

  // ── Part 2 flow ───────────────────────────────────────────────────────────────

  // ── TTS helpers ───────────────────────────────────────────────────────────────

  // Ordered preference list: names that match (case-insensitive substring) are tried
  // first. Falls back to the first en-* voice, then whatever the browser defaults to.
  var _TTS_VOICE_PREFS = [
    'samantha',        // macOS / iOS — the most natural built-in English voice
    'karen',           // macOS Australian
    'daniel',          // macOS British
    'google uk english female',
    'google us english',
    'microsoft aria',  // Windows 11
    'microsoft jenny',
    'microsoft guy',
  ];

  var _ttsVoice = null;   // cached after first selection

  function _pickVoice() {
    if (_ttsVoice) return _ttsVoice;
    var voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    // Try preferred voices in order
    for (var pi = 0; pi < _TTS_VOICE_PREFS.length; pi++) {
      var pref = _TTS_VOICE_PREFS[pi];
      for (var vi = 0; vi < voices.length; vi++) {
        if (voices[vi].name.toLowerCase().indexOf(pref) !== -1) {
          _ttsVoice = voices[vi];
          return _ttsVoice;
        }
      }
    }

    // Fallback: first en-GB, then en-US, then any en-*
    var enGB = voices.filter(function (v) { return v.lang === 'en-GB'; });
    var enUS = voices.filter(function (v) { return v.lang === 'en-US'; });
    var enAny = voices.filter(function (v) { return v.lang.indexOf('en') === 0; });
    _ttsVoice = (enGB[0] || enUS[0] || enAny[0]) || null;
    return _ttsVoice;
  }

  // Re-pick if voices load asynchronously (common on Chrome)
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = function () { _ttsVoice = null; };
  }

  function _ttsPreprocess(text) {
    return text
      // Part labels → spoken words
      .replace(/\bPart\s*1\b/gi, 'Part one')
      .replace(/\bPart\s*2\b/gi, 'Part two')
      .replace(/\bPart\s*3\b/gi, 'Part three')
      // Common abbreviations that browsers mis-read
      .replace(/\be\.g\./gi, 'for example')
      .replace(/\bi\.e\./gi, 'that is')
      .replace(/\betc\./gi, 'and so on')
      // Trim extra whitespace / newlines → single space (TTS will pause at commas/periods)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _makeUtterance(text) {
    var utt = new SpeechSynthesisUtterance(_ttsPreprocess(text));
    utt.lang   = 'en-GB';
    utt.rate   = 0.88;    // slightly slower than default feels more examiner-like
    utt.pitch  = 1.0;
    utt.volume = 1.0;
    var v = _pickVoice();
    if (v) utt.voice = v;
    return utt;
  }

  // Speak a single string (cancel any ongoing speech first)
  function _tts(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (!text || !text.trim()) return;
    window.speechSynthesis.speak(_makeUtterance(text));
  }

  // Speak an ordered array of segments with a natural pause between each.
  // pauseMs — gap in milliseconds between segments (default 600 ms).
  function _ttsSequence(segments, pauseMs) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (!segments || segments.length === 0) return;
    pauseMs = pauseMs || 600;

    var filtered = segments.filter(function (s) { return s && s.trim(); });
    if (filtered.length === 0) return;

    var idx = 0;
    function speakNext() {
      if (idx >= filtered.length) return;
      var utt = _makeUtterance(filtered[idx]);
      idx++;
      if (idx < filtered.length) {
        utt.onend = function () {
          setTimeout(speakNext, pauseMs);
        };
      }
      window.speechSynthesis.speak(utt);
    }
    speakNext();
  }

  // ── AI TTS (OpenAI nova voice, falls back to browser TTS) ────────────────────

  var _ttsAudio      = null;   // current HTMLAudioElement for AI TTS playback
  var _ttsGeneration = 0;      // incremented on every _ttsAI() call; stale fetches abort

  // In-memory TTS audio cache (session-scoped, cleared on page unload).
  // Key: 'q:<questionId>' when available, else 't:<djb2hash>'.
  // Value: Blob (audio/mpeg) — a fresh blob URL is created per play and revoked after.
  var _ttsCache = new Map();

  // Returns a Promise<object> with the auth headers needed for /tts fetch calls.
  // window.api._apiRequest can't be reused here because it calls .json() on the
  // response, but /tts returns audio/mpeg. We build the headers manually instead.
  function _ttsAuthHeaders() {
    var sb = window.getSupabase ? window.getSupabase() : null;
    if (!sb) return Promise.resolve({ 'Content-Type': 'application/json' });
    return sb.auth.getSession().then(function (result) {
      var headers = { 'Content-Type': 'application/json' };
      var token = result.data && result.data.session && result.data.session.access_token;
      if (token) headers['Authorization'] = 'Bearer ' + token;
      return headers;
    }).catch(function () {
      return { 'Content-Type': 'application/json' };
    });
  }

  // Track whether the user has performed a gesture on this document.
  // Browsers block HTMLAudioElement.play() until a gesture occurs.
  // Web Speech API (browser TTS) is not subject to this restriction.
  var _userHasInteracted = false;
  (function () {
    function _markInteracted() { _userHasInteracted = true; }
    document.addEventListener('click',      _markInteracted, { once: true, capture: true });
    document.addEventListener('keydown',    _markInteracted, { once: true, capture: true });
    document.addEventListener('touchstart', _markInteracted, { once: true, capture: true });
  }());

  // Stop playback. Does NOT revoke the blob URL — revoking while the browser
  // is still buffering causes net::ERR_FILE_NOT_FOUND on the blob: scheme.
  // URLs are revoked only inside onended (after the browser finishes reading).
  function _stopAITts() {
    if (_ttsAudio) {
      _ttsAudio.onended = null;   // prevent ghost callbacks after stop
      _ttsAudio.onerror = null;
      _ttsAudio.pause();
      _ttsAudio = null;
    }
  }

  // Cache key: stable per question ID (preferred) or per text content (fallback).
  function _ttsCacheKey(text, questionId) {
    if (questionId) return 'q:' + questionId;
    // djb2-style hash — not cryptographic, just for deduplication
    var h = 5381;
    for (var i = 0; i < text.length; i++) {
      h = ((h << 5) + h) ^ text.charCodeAt(i);
      h = h & h;
    }
    return 't:' + (h >>> 0).toString(16);
  }

  // Play a Blob as audio. Guards against stale generation. Falls back to browser TTS.
  function _playTtsBlob(blob, text, gen) {
    if (gen !== _ttsGeneration || !blob) return;
    var url = URL.createObjectURL(blob);
    var audio = new Audio(url);
    _ttsAudio = audio;
    audio.onended = function () {
      URL.revokeObjectURL(url);   // safe: browser finished reading
      _ttsAudio = null;
    };
    audio.onerror = function () {
      URL.revokeObjectURL(url);
      _ttsAudio = null;
    };
    audio.play().catch(function (err) {
      _ttsAudio = null;
      console.warn('[tts] play() rejected, falling back to browser TTS:', err);
      _tts(text);
    });
  }

  // Speak text using the backend /tts endpoint (OpenAI nova voice).
  // Checks _ttsCache first — a cache hit skips the API call entirely.
  // Falls back to browser TTS if not yet interacted or if fetch/play fails.
  // questionId: optional — used as cache key; pass _currentQ.id when available.
  function _ttsAI(text, questionId) {
    if (!text || !text.trim()) return;
    _stopAITts();
    window.speechSynthesis && window.speechSynthesis.cancel();

    var gen = ++_ttsGeneration;
    var cacheKey = _ttsCacheKey(text, questionId);
    console.debug('[tts] _ttsAI gen=%d key=%s text="%s"', gen, cacheKey, text.slice(0, 40));

    // No user gesture yet → browser will block Audio.play(); use browser TTS instead.
    if (!_userHasInteracted) {
      _tts(text);
      return;
    }

    // Cache hit → play from stored Blob; no API call needed.
    if (_ttsCache.has(cacheKey)) {
      console.debug('[tts] cache HIT key=%s', cacheKey);
      _playTtsBlob(_ttsCache.get(cacheKey), text, gen);
      return;
    }

    // Cache miss → fetch from backend, cache the Blob, then play.
    var base = window.api && window.api.base ? window.api.base : '';
    _ttsAuthHeaders().then(function (headers) {
      return fetch(base + '/tts', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ text: text, voice: 'nova' }),
      });
    })
      .then(function (res) {
        if (!res.ok) throw new Error('TTS HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        // Stale — a newer _ttsAI() call superseded this one; discard silently.
        if (gen !== _ttsGeneration) {
          console.debug('[tts] gen=%d stale (current=%d), discarding', gen, _ttsGeneration);
          return;
        }
        _ttsCache.set(cacheKey, blob);
        console.debug('[tts] cache SET key=%s (%d bytes)', cacheKey, blob.size);
        _playTtsBlob(blob, text, gen);
      })
      .catch(function (err) {
        console.warn('[tts] AI TTS fetch failed, falling back to browser TTS:', err);
        _tts(text);
      });
  }

  // Speak an ordered array of segments via AI TTS with a pause between each.
  // Falls back to _ttsSequence (browser TTS) when not yet safe to play or on error.
  function _ttsAISequence(segments, pauseMs) {
    if (!segments || segments.length === 0) return;
    pauseMs = pauseMs || 650;
    var filtered = segments.filter(function (s) { return s && s.trim(); });
    if (filtered.length === 0) return;

    _stopAITts();
    window.speechSynthesis && window.speechSynthesis.cancel();

    // Bump generation so any in-flight fetch from a previous call knows it is stale.
    var gen = ++_ttsGeneration;
    console.debug('[tts] _ttsAISequence gen=%d segments=%d', gen, filtered.length);

    // No user gesture yet → fall back to browser TTS sequence.
    if (!_userHasInteracted) {
      _ttsSequence(filtered, pauseMs);
      return;
    }

    var base = window.api && window.api.base ? window.api.base : '';
    var idx = 0;
    var usedFallback = false;

    function _fallback(fromIdx) {
      if (usedFallback) return;
      usedFallback = true;
      _ttsSequence(filtered.slice(fromIdx), pauseMs);
    }

    function playNext() {
      if (usedFallback || idx >= filtered.length) return;
      var seg = filtered[idx];
      var segIdx = idx;   // capture for fallback slice
      idx++;

      _ttsAuthHeaders().then(function (headers) {
        return fetch(base + '/tts', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ text: seg, voice: 'nova' }),
        });
      })
        .then(function (res) {
          if (!res.ok) throw new Error('TTS HTTP ' + res.status);
          return res.blob();
        })
        .then(function (blob) {
          if (usedFallback) return;
          // Stale — a newer TTS call superseded this sequence; discard silently.
          if (gen !== _ttsGeneration) {
            console.debug('[tts] sequence gen=%d stale (current=%d), discarding', gen, _ttsGeneration);
            return;
          }
          var url = URL.createObjectURL(blob);
          var audio = new Audio(url);
          _ttsAudio = audio;

          audio.onended = function () {
            URL.revokeObjectURL(url);   // safe: browser finished reading
            _ttsAudio = null;
            if (!usedFallback && gen === _ttsGeneration && idx < filtered.length) {
              setTimeout(playNext, pauseMs);
            }
          };
          audio.onerror = function () {
            URL.revokeObjectURL(url);
            _ttsAudio = null;
            _fallback(idx);   // continue remaining from next segment via browser TTS
          };
          console.debug('[tts] sequence playing gen=%d seg=%d', gen, segIdx);
          audio.play().catch(function (err) {
            // Don't revoke — browser may still be loading; null ref and fall back.
            _ttsAudio = null;
            console.warn('[tts] sequence play() rejected, falling back:', err);
            _fallback(segIdx);   // retry this segment and rest via browser TTS
          });
        })
        .catch(function (err) {
          console.warn('[tts] AI TTS sequence fetch failed, falling back:', err);
          _fallback(segIdx);
        });
    }

    playNext();
  }

  // ── END AI TTS ────────────────────────────────────────────────────────────────

  // ── Question mode (Visual / Listening) ────────────────────────────────────────
  // Applies to Part 1 & 3 only. Part 2 ignores this toggle entirely.

  function _applyQModeUI() {
    var isListening = (_qMode === 'listening');

    // Mode toggle is never useful — all flows force their mode programmatically
    var toggleWrap = $('prep-mode-toggle');
    if (toggleWrap) toggleWrap.style.display = 'none';

    // Toggle button highlight
    var vBtn = $('prep-mode-visual');
    var lBtn = $('prep-mode-listening');
    if (vBtn) {
      vBtn.style.background = isListening ? 'transparent' : 'rgba(20,184,166,0.18)';
      vBtn.style.color      = isListening ? 'rgba(255,255,255,0.4)' : '#14b8a6';
    }
    if (lBtn) {
      lBtn.style.background = isListening ? 'rgba(20,184,166,0.18)' : 'transparent';
      lBtn.style.color      = isListening ? '#14b8a6' : 'rgba(255,255,255,0.4)';
    }

    // Show/hide listening bar
    var listenBar = $('prep-listen-bar');
    if (listenBar) listenBar.style.display = isListening ? '' : 'none';

    // Dim question text in listening mode (UX: listening is the focus)
    var qCard = $('prep-q-card');
    if (qCard) qCard.style.opacity = isListening ? '0.35' : '1';

    // Swap instruction text
    var inst = $('prep-instruction');
    if (inst) {
      inst.textContent = isListening
        ? 'Nghe câu hỏi rồi nhấn ghi âm. Nhấn ↺ để nghe lại.'
        : 'Đọc câu hỏi kỹ, sau đó nhấn nút để bắt đầu ghi âm.';
    }

    // Reset play button label to default
    var playBtn = $('prep-play-btn');
    if (playBtn) playBtn.textContent = '🔊 Nghe câu hỏi';
  }

  // Called by mode toggle buttons (onclick="PracticeApp.setQMode(...)").
  function _setQMode(mode) {
    _qMode = mode;
    try { sessionStorage.setItem('ielts_qmode', mode); } catch (e) { /* storage not available */ }

    // Switching to visual → stop any playing TTS immediately
    if (mode === 'visual') {
      _stopAITts();
      window.speechSynthesis && window.speechSynthesis.cancel();
    }

    _applyQModeUI();

    // Switching to listening mid-question → play right away (test_full only)
    if (mode === 'listening' && _currentQ && _testMode === 'test_full') {
      _ttsAI(_currentQ.question_text || '', _currentQ.id);
    }
  }

  // Called by the "🔊 Nghe câu hỏi / ↺ Phát lại" button (test_full only).
  function _playQuestion() {
    if (!_currentQ || _testMode !== 'test_full') return;
    var btn = $('prep-play-btn');
    if (btn) btn.textContent = '↺ Phát lại';
    _ttsAI(_currentQ.question_text || '', _currentQ.id);
  }

  // Called by the mode-choice screen buttons at session start.
  // Sets mode, persists it, then proceeds to the first question prep screen.
  // Because this is triggered by a user click, _userHasInteracted is already true,
  // so AI TTS will fire immediately when listening mode is chosen.
  function _chooseModeAndStart(mode) {
    _qMode = mode;
    try { sessionStorage.setItem('ielts_qmode', mode); } catch (e) {}
    if (mode === 'visual') {
      _stopAITts();
      window.speechSynthesis && window.speechSynthesis.cancel();
    }
    _applyQModeUI();
    _showPrep();   // _showPrep() auto-plays TTS when _qMode === 'listening'
  }

  // ── END Question mode ─────────────────────────────────────────────────────────

  function _showP2Cue() {
    var q = _currentQ;
    var topicEl = $('p2a-topic');
    if (topicEl) topicEl.textContent = _sessionData ? (_sessionData.topic || '') : '';

    var qEl = $('p2a-question');
    if (qEl) qEl.textContent = q.question_text || '';

    var bulletsEl = $('p2a-bullets');
    if (bulletsEl && q.cue_card_bullets && q.cue_card_bullets.length) {
      bulletsEl.innerHTML = q.cue_card_bullets.map(function (b) {
        return '<div class="ds-cue-bullet">' + _esc(b) + '</div>';
      }).join('');
    }

    var reflEl = $('p2a-reflection');
    if (reflEl) reflEl.textContent = q.cue_card_reflection || '';

    showState('p2a');
  }

  function startP2Prep() {
    _stopAITts();
    window.speechSynthesis && window.speechSynthesis.cancel();

    var qEl = $('p2b-question');
    if (qEl) qEl.textContent = _currentQ ? (_currentQ.question_text || '') : '';

    var notes = $('p2b-notes');
    if (notes) notes.value = '';

    _p2PrepSecsLeft = P2_PREP_SEC;
    _renderP2PrepTimer();
    showState('p2b');

    if (_p2PrepTimerId) clearInterval(_p2PrepTimerId);
    _p2PrepTimerId = setInterval(function () {
      _p2PrepSecsLeft--;
      _renderP2PrepTimer();
      if (_p2PrepSecsLeft <= 0) {
        clearInterval(_p2PrepTimerId);
        _p2PrepTimerId = null;
        _startP2Speaking();
      }
    }, 1000);
  }

  function _renderP2PrepTimer() {
    var el = $('p2b-timer');
    if (!el) return;
    var m = Math.floor(_p2PrepSecsLeft / 60);
    var s = _p2PrepSecsLeft % 60;
    el.textContent = m + ':' + (s < 10 ? '0' + s : s);
    el.style.color = _p2PrepSecsLeft <= 10 ? '#ef4444' : '#f97316';
  }

  function startP2SpeakingEarly() {
    if (_p2PrepTimerId) { clearInterval(_p2PrepTimerId); _p2PrepTimerId = null; }
    _startP2Speaking();
  }

  async function _startP2Speaking() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('Trình duyệt không hỗ trợ ghi âm.');
      return;
    }

    if (!_stream || !_stream.active) {
      try {
        _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err) {
        showError('Không thể mở microphone: ' + err.message);
        return;
      }
    }

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
      _stopWaveform();
      var type = (_recorder.mimeType && _recorder.mimeType !== '') ? _recorder.mimeType : 'audio/webm';
      _recordedBlob = new Blob(_audioChunks, { type: type });
      var questionId = _currentQ && (_currentQ.id || _currentQ.question_id);

      // Test modes: defer grading
      if (_testMode) {
        _pendingTestAnswers.push({
          sessionId:    _sessionId,
          questionId:   questionId,
          blob:         _recordedBlob,
          questionText: _currentQ ? (_currentQ.question_text || '') : '',
          part:         _sessionData ? _sessionData.part : null,
        });
        _advanceTestMode();
        return;
      }

      _startProcessing(_recordedBlob, questionId);
    };

    _recorder.start(250);

    _p2SpeakSecsLeft = P2_SPEAK_SEC;
    _renderP2SpeakTimer();
    showState('p2c');
    _startP2Waveform();

    if (_p2SpeakTimerId) clearInterval(_p2SpeakTimerId);
    _p2SpeakTimerId = setInterval(function () {
      _p2SpeakSecsLeft--;
      _renderP2SpeakTimer();
      if (_p2SpeakSecsLeft <= 0) {
        clearInterval(_p2SpeakTimerId);
        _p2SpeakTimerId = null;
        _tts('Thank you.');
        setTimeout(function () { _stopP2SpeakingInternal(); }, 1500);
      }
    }, 1000);
  }

  function _renderP2SpeakTimer() {
    var el = $('p2c-timer');
    if (!el) return;
    var m = Math.floor(_p2SpeakSecsLeft / 60);
    var s = _p2SpeakSecsLeft % 60;
    el.textContent = m + ':' + (s < 10 ? '0' + s : s);
    el.style.color = _p2SpeakSecsLeft < 30 ? '#ef4444' : '#fff';
  }

  function stopP2SpeakingEarly() {
    if (_p2SpeakTimerId) { clearInterval(_p2SpeakTimerId); _p2SpeakTimerId = null; }
    _stopP2SpeakingInternal();
  }

  function _stopP2SpeakingInternal() {
    _stopWaveform();
    if (_recorder && _recorder.state !== 'inactive') {
      _recorder.stop();
      // onstop → _startProcessing
    }
  }

  function _startP2Waveform() {
    var canvas = $('p2c-canvas');
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

  // ── Test Mode logic ───────────────────────────────────────────────────────────

  function _advanceTestMode() {
    var isLastQ = (_currentIdx >= _questions.length - 1);

    if (!isLastQ) {
      // More questions in this part — go to next
      _currentIdx++;
      _showPrep();
      return;
    }

    // Last question in this part
    if (_testMode === 'test_part') {
      // Single-part test: grade everything, then show results
      _processPendingAnswers(function () {
        _finishTestAndShowResults();
      });
    } else {
      // Full Test: do NOT grade between parts — go directly to next part
      var nextPart = _ftCurrentPart + 1;
      if (nextPart > 3) {
        // All parts done — now grade everything and show results
        _processPendingAnswers(function () {
          _finishTestAndShowResults();
        });
      } else {
        // Transition directly to next part, no break screen, no mid-test grading
        _startNextPartInFullTest(nextPart);
      }
    }
  }

  function _showBreak(nextPart) {
    var label = $('break-part-label');
    if (label) label.textContent = 'Chuẩn bị cho Part ' + nextPart;
    _breakSecsLeft = BREAK_SEC;
    _renderBreakTimer();
    showState('break');

    _breakTimerId = setInterval(function () {
      _breakSecsLeft--;
      _renderBreakTimer();
      if (_breakSecsLeft <= 0) {
        clearInterval(_breakTimerId);
        _breakTimerId = null;
        _startNextPartInFullTest(nextPart);
      }
    }, 1000);
  }

  function _renderBreakTimer() {
    var el = $('break-timer');
    if (el) el.textContent = _breakSecsLeft;
  }

  async function _startNextPartInFullTest(part) {
    showState('loading');
    var loadMsg = $('loading-msg');

    try {
      // NOTE: do NOT complete the current session here.
      // All part sessions are completed together at the very end (_finishTestAndShowResults).

      // Topic selection:
      //  Part 2 → use the topic stored by the dashboard (_ftP2Topic)
      //  Part 3 → inherit Part 2 session's topic (already in _sessionData.topic)
      var nextTopic = (part === 2 && _ftP2Topic)
        ? _ftP2Topic
        : (_sessionData.topic || 'General');

      if (loadMsg) loadMsg.textContent = 'Đang tạo Part ' + part + '...';
      var newSession = await window.api.post('/sessions', {
        mode:  'test_full',
        part:  part,
        topic: nextTopic,
      });

      var newId = newSession && (newSession.id || newSession.session_id);
      if (!newId) throw new Error('Server không trả về session_id cho Part ' + part);

      // Track this session so we can complete all of them at the end
      _ftAllSessionIds.push(newId);

      // Generate questions for this part
      if (loadMsg) loadMsg.textContent = 'Đang tạo câu hỏi Part ' + part + '...';
      var questions = await window.api.post('/sessions/' + newId + '/questions/generate', {});
      if (!questions || questions.length === 0) throw new Error('Không tạo được câu hỏi Part ' + part);

      // Slice to full test exam count
      var maxQ = FULL_TEST_Q_COUNT[part] || questions.length;
      questions = questions.slice(0, maxQ);

      // Validate Part 1 grouping: must have exactly 9 questions for 3×3 structure
      if (part === 1 && questions.length < 9) {
        throw new Error(
          'Không tạo đủ câu hỏi cho Full Test Part 1 (cần 9, nhận được ' + questions.length + '). ' +
          'Vui lòng thử lại.'
        );
      }

      // Update module state for new part
      _sessionId     = newId;
      _sessionData   = newSession;
      _ftCurrentPart = part;
      if (!_sessionData.mode) _sessionData.mode = 'test_full';
      _questions   = questions;
      _currentIdx  = 0;

      _showPrep();

    } catch (err) {
      showError('Không thể bắt đầu Part ' + part + ': ' + (err.message || 'Lỗi không xác định'));
    }
  }

  // Sequentially grade all deferred answers collected during test mode.
  // Shows a "Đang chấm điểm X/Y" processing screen while working.
  // Calls callback() when all done (or on failure).
  function _processPendingAnswers(callback) {
    var answers = _pendingTestAnswers.slice();
    _pendingTestAnswers = [];

    if (!answers.length) {
      callback();
      return;
    }

    var total   = answers.length;
    var current = 0;

    var textEl = $('processing-text');
    showState('processing');

    function gradeNext() {
      if (current >= total) {
        if (_processingTimer) { clearInterval(_processingTimer); _processingTimer = null; }
        callback();
        return;
      }

      var item = answers[current];
      current++;

      if (textEl) textEl.textContent = 'Đang chấm điểm câu ' + current + ' / ' + total + '...';

      var fd = new FormData();
      fd.append('question_id', item.questionId);
      fd.append('audio_file',  item.blob, 'response.webm');

      window.api.upload('/sessions/' + item.sessionId + '/responses', fd)
        .then(function (data) {
          _testResults.push({
            part:         item.part,
            questionText: item.questionText,
            response:     data,
            sessionId:    item.sessionId,
          });
        })
        .catch(function (err) {
          console.warn('[practice] deferred grading failed for q', item.questionId, err);
          _testResults.push({
            part:         item.part,
            questionText: item.questionText,
            response:     { _stub: true, _error: err.message || 'Lỗi không xác định' },
            sessionId:    item.sessionId,
          });
        })
        .then(function () { gradeNext(); });
    }

    gradeNext();
  }

  function _finishTestAndShowResults() {
    // Complete ALL part sessions best-effort (fire and forget).
    var toComplete = _ftAllSessionIds.length > 0 ? _ftAllSessionIds : [_sessionId];
    toComplete.forEach(function (sid) {
      window.api.patch('/sessions/' + sid + '/complete', {}).catch(function () {});
    });

    if (_testMode === 'test_full' && _ftAllSessionIds.length > 0) {
      // Redirect to dedicated full-test result page
      var p1 = _ftAllSessionIds[0] || '';
      var p2 = _ftAllSessionIds[1] || '';
      var p3 = _ftAllSessionIds[2] || '';
      var url = '/pages/full-test-result.html?p1=' + encodeURIComponent(p1);
      if (p2) url += '&p2=' + encodeURIComponent(p2);
      if (p3) url += '&p3=' + encodeURIComponent(p3);
      window.location.href = url;
      return;
    }

    // test_part or edge case — show inline results as before
    _renderTestResults();
    showState('test-results');
  }

  function _renderTestResults() {
    // Compute overall band from all graded responses
    var bands = _testResults
      .map(function (r) { return r.response && r.response.overall_band; })
      .filter(function (b) { return b != null && !isNaN(b); });

    var overallEl = $('test-overall-band');
    if (overallEl) {
      if (bands.length > 0) {
        var avg = bands.reduce(function (a, b) { return a + b; }, 0) / bands.length;
        var rounded = Math.round(avg * 2) / 2;
        overallEl.textContent = parseFloat(rounded).toFixed(1);
      } else {
        overallEl.textContent = '—';
      }
    }

    var listEl = $('test-results-list');
    if (!listEl) return;
    listEl.innerHTML = _testResults.map(function (r, i) {
      return _testResultCard(r, i);
    }).join('');
  }

  function _testResultCard(r, idx) {
    var data = r.response || {};
    var band = data.overall_band != null ? parseFloat(data.overall_band).toFixed(1) : '—';
    var bandColor = data.overall_band >= 7 ? '#4ade80' : data.overall_band >= 5.5 ? '#14b8a6' : '#fb923c';

    var criteriaHtml = '';
    if (data.band_fc != null) {
      criteriaHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">' +
        _bandPill('FC',  data.band_fc)  +
        _bandPill('LR',  data.band_lr)  +
        _bandPill('GRA', data.band_gra) +
        _bandPill('P',   data.band_p)   +
        '</div>';
    }

    // Detailed feedback section
    var feedbackHtml = '';
    if (data._stub) {
      feedbackHtml = '<p style="font-size:12px;font-style:italic;color:rgba(255,255,255,0.35);margin:8px 0 0;">' +
        (data._error ? _esc(data._error) : 'Chưa thể chấm điểm câu này.') + '</p>';
    } else if (data.fc_feedback) {
      // Test mode formal feedback (criterion blocks)
      feedbackHtml =
        '<div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">' +
        _criterionBlock('Fluency &amp; Coherence', data.fc_feedback) +
        _criterionBlock('Lexical Resource',        data.lr_feedback) +
        _criterionBlock('Grammar &amp; Accuracy',  data.gra_feedback) +
        _criterionBlock('Pronunciation',           data.p_feedback) +
        _listBlock('Điểm mạnh',     data.strengths,    '#4ade80') +
        _listBlock('Cần cải thiện', data.improvements, '#fb923c') +
        (data.improved_response ? _improvedBlock(data.improved_response) : '') +
        '</div>';
    } else if (data.grammar_issues) {
      // Practice mode coaching feedback
      feedbackHtml =
        '<div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">' +
        _listBlock('Strengths',          data.strengths,             '#4ade80') +
        _listBlock('Grammar Issues',     data.grammar_issues,        '#f87171') +
        _listBlock('Vocabulary Issues',  data.vocabulary_issues,     '#fb923c') +
        _correctionsBlock(data.corrections) +
        (data.sample_answer ? _sampleAnswerBlock(data.sample_answer) : '') +
        '</div>';
    }

    var transcriptHtml = '';
    if (data.transcript) {
      transcriptHtml = '<p style="font-size:12px;color:rgba(255,255,255,0.4);margin:8px 0 0;' +
        'border-top:1px solid rgba(255,255,255,0.07);padding-top:8px;line-height:1.5;">' +
        _esc(data.transcript) + '</p>';
    }

    return '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);' +
      'border-radius:14px;padding:14px 16px;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '<div style="flex:1;min-width:0;">' +
          '<p style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;' +
          'letter-spacing:.07em;margin:0 0 4px;">Part ' + r.part + ' · Câu ' + (idx + 1) + '</p>' +
          '<p style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);margin:0;line-height:1.45;">' +
          _esc(r.questionText) + '</p>' +
        '</div>' +
        '<div style="text-align:center;flex-shrink:0;">' +
          '<div style="font-size:28px;font-weight:800;color:' + bandColor + ';">' + band + '</div>' +
          '<div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:.06em;">band</div>' +
        '</div>' +
      '</div>' +
      criteriaHtml +
      feedbackHtml +
      transcriptHtml +
      '</div>';
  }

  // ── Pronunciation Assessment ──────────────────────────────────────────────────

  /**
   * Compact score chip: label (Vietnamese) + value/100 or "—"
   */
  function _pronChip(label, value) {
    var display = (value != null) ? Math.round(value) : '—';
    var color   = (value != null && value >= 75) ? '#4ade80'
                : (value != null && value >= 55) ? '#14b8a6'
                : (value != null)               ? '#fb923c'
                :                                 'rgba(255,255,255,0.3)';
    return '<div style="display:inline-flex;flex-direction:column;align-items:center;'
      + 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);'
      + 'border-radius:10px;padding:6px 10px;min-width:64px;">'
      + '<span style="font-size:18px;font-weight:800;color:' + color + ';line-height:1;">' + display + '</span>'
      + '<span style="font-size:9px;color:rgba(255,255,255,0.35);text-transform:uppercase;'
      + 'letter-spacing:.06em;margin-top:3px;">' + _esc(label) + '</span>'
      + '</div>';
  }

  /**
   * Render single-response pronunciation result into a container element.
   * pronData: the API response from /pronunciation
   */
  function _renderPronBlock(el, pronData) {
    if (!el) return;
    var summary = (pronData.short_summary || []).map(function (s) {
      return '<li style="margin-bottom:4px;">' + _esc(s) + '</li>';
    }).join('');

    var words = (pronData.words || [])
      .filter(function (w) { return w.error_type && w.error_type !== 'None'; })
      .slice(0, 6);
    var wordHtml = words.length
      ? '<p style="font-size:11px;color:rgba(255,255,255,0.4);margin:10px 0 4px;">Từ cần chú ý:</p>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
        + words.map(function (w) {
            return '<span style="background:rgba(251,146,60,0.12);border:1px solid rgba(251,146,60,0.3);'
              + 'border-radius:6px;padding:2px 8px;font-size:11px;color:#fb923c;">'
              + _esc(w.word) + '</span>';
          }).join('')
        + '</div>'
      : '';

    el.innerHTML =
      '<div style="padding:14px 16px;background:rgba(20,184,166,0.05);'
      + 'border:1px solid rgba(20,184,166,0.2);border-radius:12px;">'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">'
      + _pronChip('Tổng thể',   pronData.pronunciation_score)
      + _pronChip('Lưu loát',   pronData.fluency_score)
      + _pronChip('Chính xác',  pronData.accuracy_score)
      + _pronChip('Đầy đủ',     pronData.completeness_score)
      + _pronChip('Ngữ điệu',   pronData.prosody_score)
      + '</div>'
      + (summary ? '<ul style="font-size:12px;color:rgba(255,255,255,0.62);'
          + 'padding-left:16px;margin:0 0 4px;line-height:1.7;">' + summary + '</ul>' : '')
      + wordHtml
      + '</div>';
  }

  /**
   * Render full-test pronunciation block into #full-pron-block.
   * fullData: response from POST /sessions/{id}/pronunciation/full
   */
  function _renderFullPronBlock(el, fullData) {
    if (!el) return;

    var overallScore = fullData.overall_pron_score;
    var overallColor = (overallScore != null && overallScore >= 75) ? '#4ade80'
                     : (overallScore != null && overallScore >= 55) ? '#14b8a6'
                     : (overallScore != null)                       ? '#fb923c'
                     :                                                'rgba(255,255,255,0.4)';

    var partDefs = [
      { key: 'part1', label: 'Phần 1', note: '1 câu trả lời' },
      { key: 'part2', label: 'Phần 2', note: '1 đoạn nói dài' },
      { key: 'part3', label: 'Phần 3', note: '1 câu trả lời' },
    ];

    var partsHtml = partDefs.map(function (def) {
      var s = fullData.samples && fullData.samples[def.key];
      if (!s) {
        return '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);'
          + 'border-radius:10px;padding:12px 14px;margin-bottom:10px;">'
          + '<p style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);margin:0 0 4px;">'
          + _esc(def.label) + '</p>'
          + '<p style="font-size:11px;color:rgba(255,255,255,0.25);margin:0;font-style:italic;">Không có dữ liệu</p>'
          + '</div>';
      }

      // Segment line for Part 2
      var segHtml = '';
      if (def.key === 'part2') {
        if (s.audio_start_s != null && s.audio_end_s != null) {
          segHtml = '<p style="font-size:10px;color:rgba(255,255,255,0.3);margin:2px 0 0;">'
            + '⏱ Đoạn phân tích: ' + Math.round(s.audio_start_s) + 's – ' + Math.round(s.audio_end_s) + 's'
            + '</p>';
        }
      }

      var lowConfHtml = s.low_confidence_sample
        ? '<p style="font-size:10px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);'
          + 'border-radius:6px;padding:4px 8px;color:#fbbf24;margin:6px 0 0;">'
          + '⚠ Phần trả lời khá ngắn — nhận xét mang tính tham khảo, bạn nên luyện nói dài hơn để được đánh giá chính xác hơn</p>'
        : '';

      var words = (s.words || [])
        .filter(function (w) { return w.error_type && w.error_type !== 'None'; })
        .slice(0, 5);
      var wordHtml = words.length
        ? '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;">'
          + words.map(function (w) {
              return '<span style="background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.25);'
                + 'border-radius:5px;padding:1px 7px;font-size:10px;color:#fb923c;">'
                + _esc(w.word) + '</span>';
            }).join('')
          + '</div>'
        : '';

      return '<div style="background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.08);'
        + 'border-radius:10px;padding:12px 14px;margin-bottom:10px;">'
        + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">'
          + '<div style="flex:1;min-width:0;">'
            + '<p style="font-size:11px;font-weight:700;color:#14b8a6;margin:0 0 2px;">' + _esc(def.label) + '</p>'
            + '<p style="font-size:10px;color:rgba(255,255,255,0.35);margin:0;line-height:1.4;">'
            + _esc(s.selection_reason) + '</p>'
            + segHtml
          + '</div>'
          + '<div style="text-align:center;flex-shrink:0;">'
            + '<div style="font-size:24px;font-weight:800;color:' + overallColor + ';line-height:1;">'
            + (s.pronunciation_score != null ? Math.round(s.pronunciation_score) : '—') + '</div>'
            + '<div style="font-size:8px;color:rgba(255,255,255,0.3);text-transform:uppercase;">/ 100</div>'
          + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">'
        + _pronChip('Lưu loát',  s.fluency_score)
        + _pronChip('Chính xác', s.accuracy_score)
        + _pronChip('Đầy đủ',    s.completeness_score)
        + _pronChip('Ngữ điệu',  s.prosody_score)
        + '</div>'
        + lowConfHtml
        + wordHtml
        + '</div>';
    }).join('');

    var assessed = fullData.samples_assessed || 0;
    var subtitle = assessed >= 3 ? '3 mẫu đại diện (Phần 1 + 2 + 3)'
                 : assessed > 0  ? assessed + '/3 phần có dữ liệu'
                 :                 'Không đủ dữ liệu';

    el.innerHTML =
      '<div style="border:1px solid rgba(20,184,166,0.25);border-radius:14px;overflow:hidden;">'
      + '<div style="background:rgba(20,184,166,0.08);padding:14px 16px;display:flex;'
        + 'align-items:center;justify-content:space-between;gap:10px;">'
        + '<div>'
          + '<p style="font-size:11px;font-weight:700;color:#14b8a6;text-transform:uppercase;'
            + 'letter-spacing:.08em;margin:0 0 2px;">Phân tích phát âm chuyên sâu</p>'
          + '<p style="font-size:10px;color:rgba(255,255,255,0.35);margin:0;">' + _esc(subtitle) + '</p>'
        + '</div>'
        + '<div style="text-align:center;">'
          + '<div style="font-size:32px;font-weight:900;color:' + overallColor + ';line-height:1;">'
          + (overallScore != null ? Math.round(overallScore) : '—') + '</div>'
          + '<div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:.05em;">/100</div>'
        + '</div>'
      + '</div>'
      + '<div style="padding:14px 16px;">' + partsHtml + '</div>'
      + '</div>';

    el.style.display = '';
  }

  /**
   * Async: call pronunciation/full, render into #full-pron-block.
   * Uses _ftAllSessionIds[0] as primary session, rest as extra_session_ids.
   * Non-blocking — shows spinner while loading.
   */
  function _fetchAndRenderFullPron() {
    var el      = $('full-pron-block');
    var section = $('full-pron-section');
    if (!el) return;

    if (!_ftAllSessionIds.length) return;

    var primarySid = _ftAllSessionIds[0];
    var extraSids  = _ftAllSessionIds.slice(1);

    // Show wrapper section + loading state inside the block
    if (section) { section.style.display = ''; }
    el.innerHTML =
      '<div style="border:1px solid rgba(20,184,166,0.15);border-radius:14px;padding:20px 16px;'
      + 'text-align:center;">'
      + '<div class="spinner" style="width:22px;height:22px;border-width:2px;margin:0 auto 10px;"></div>'
      + '<p style="font-size:12px;color:rgba(255,255,255,0.38);margin:0;">Đang tổng hợp phân tích phát âm cho toàn bài...</p>'
      + '</div>';

    var base = (window.api && window.api.base) ? window.api.base : '';

    var sb = window.getSupabase ? window.getSupabase() : null;
    var sessionPromise = sb ? sb.auth.getSession() : Promise.resolve({ data: {} });

    sessionPromise.then(function (result) {
      var token = result.data.session ? result.data.session.access_token : null;
      return fetch(base + '/sessions/' + primarySid + '/pronunciation/full', {
        method:  'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { 'Authorization': 'Bearer ' + token } : {}
        ),
        body: JSON.stringify({ extra_session_ids: extraSids }),
      });
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        _renderFullPronBlock(el, data);
        // Surface aggregate confidence as a contextual note below the full pron block
        if (data && data.overall_confidence && data.overall_confidence !== 'high') {
          var confHtml = _reliabilityNote({ score_confidence: data.overall_confidence });
          if (confHtml) {
            var noteEl = document.createElement('div');
            noteEl.innerHTML = confHtml;
            el.appendChild(noteEl.firstChild);
          }
        }
        // Post-hoc band adjustment: update overall band in full-test summary
        if (data && data.final_overall_band != null) {
          var overallEl = $('test-overall-band');
          if (overallEl) {
            overallEl.textContent = parseFloat(data.final_overall_band).toFixed(1);
          }
        }
      })
      .catch(function (err) {
        console.warn('[practice] full pron fetch failed:', err);
        el.innerHTML =
          '<div style="border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px 16px;">'
          + '<p style="font-size:12px;color:rgba(255,255,255,0.28);margin:0;line-height:1.6;font-style:italic;">'
          + 'Chưa tổng hợp được phân tích phát âm cho bài này — nếu muốn xem kết quả, bạn thử lại sau nhé.</p>'
          + '</div>';
        el.style.display = '';
      });
  }

  /**
   * Auto-triggered pronunciation assessment for practice mode (single response).
   * Called automatically from _showFeedback when response_id + audio are available.
   * btn param is unused (kept for API compatibility) — pass null.
   */
  function assessSinglePronunciation(btn) {
    if (!_currentResponseId || !_sessionId) return;

    var pronLoading = $('pron-loading-block');
    var pronResult  = $('pron-result-block');

    // Guard: ensure loading is visible, result is hidden (in case called externally)
    if (pronLoading) { pronLoading.style.display = 'flex'; }
    if (pronResult)  { pronResult.style.display = 'none'; }

    var base = (window.api && window.api.base) ? window.api.base : '';
    var sb = window.getSupabase ? window.getSupabase() : null;
    var sessionPromise = sb ? sb.auth.getSession() : Promise.resolve({ data: {} });

    sessionPromise.then(function (result) {
      var token = result.data.session ? result.data.session.access_token : null;
      return fetch(base + '/sessions/' + _sessionId + '/responses/' + _currentResponseId + '/pronunciation', {
        method:  'POST',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      });
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        // Hide loading, render result
        if (pronLoading) { pronLoading.style.display = 'none'; }
        _renderPronBlock(pronResult, data);
        if (pronResult)  { pronResult.style.display = ''; }

        // If pronunciation signals updated score_confidence, refresh the note in-place
        if (data && data.score_confidence) {
          var confNote = document.getElementById('score-confidence-note');
          if (confNote) {
            confNote.innerHTML = _reliabilityNote({ score_confidence: data.score_confidence });
          }
        }
        // Post-hoc band adjustment: update overall band circle if pronunciation improved it
        if (data && data.final_overall_band != null) {
          var bandEl = $('feedback-band');
          if (bandEl) {
            bandEl.textContent = parseFloat(data.final_overall_band).toFixed(1);
          }
        }
        // Post-hoc band adjustment: update P criterion pill if in test mode
        if (data && data.final_band_p != null) {
          var bandsRow = $('feedback-bands-row');
          if (bandsRow && bandsRow.style.display !== 'none') {
            // Replace only the P pill — re-render the whole row preserving FC/LR/GRA
            var pills = bandsRow.querySelectorAll('[data-criterion]');
            pills.forEach(function (pill) {
              if (pill.getAttribute('data-criterion') === 'P') {
                pill.outerHTML = _bandPill('P', data.final_band_p);
              }
            });
          }
        }
      })
      .catch(function (err) {
        console.warn('[practice] single pron failed:', err);
        // Hide loading, show gentle fallback in result block
        if (pronLoading) { pronLoading.style.display = 'none'; }
        if (pronResult) {
          pronResult.innerHTML =
            '<p style="font-size:12px;color:rgba(255,255,255,0.28);line-height:1.6;font-style:italic;">'
            + 'Chưa phân tích được phát âm lần này — thử nói to và rõ hơn một chút ở câu tiếp theo nhé.</p>';
          pronResult.style.display = '';
        }
      });
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

    // Clean up timers and TTS
    if (_p2PrepTimerId)  { clearInterval(_p2PrepTimerId);  _p2PrepTimerId  = null; }
    if (_p2SpeakTimerId) { clearInterval(_p2SpeakTimerId); _p2SpeakTimerId = null; }
    if (_breakTimerId)   { clearInterval(_breakTimerId);   _breakTimerId   = null; }
    _stopAITts();
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    // Release mic and AudioContext
    if (_stream) { _stream.getTracks().forEach(function (t) { t.stop(); }); _stream = null; }
    if (_audioCtx) { try { _audioCtx.close(); } catch (_) {} _audioCtx = null; }

    // Release feedback audio blob URL
    if (_feedbackAudioUrl) { URL.revokeObjectURL(_feedbackAudioUrl); _feedbackAudioUrl = null; }

    try {
      await window.api.patch('/sessions/' + _sessionId + '/complete', {});
    } catch (err) {
      console.warn('[practice] session complete failed:', err.message);
    }

    window.location.href = window.api.url('pages/result.html') + '?id=' + encodeURIComponent(_sessionId);
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

  // ── Reveal question text (Full Test) ─────────────────────────────────────────

  function _revealQuestionText() {
    var revealWrap = $('prep-text-reveal');
    var revealBtn  = $('prep-reveal-btn');
    if (revealWrap) revealWrap.style.display = '';
    if (revealBtn)  revealBtn.style.display  = 'none';
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

    // Kick off grammar article index fetch in background (ready before feedback shown)
    _fetchGrArticleIndex();

    var sb = window.getSupabase && window.getSupabase();
    if (!sb) { showError('Không thể khởi tạo Supabase.'); return; }

    var result = await sb.auth.getSession();
    if (!result.data.session) {
      window.location.href = window.api.url('login.html');
      return;
    }

    var params = new URLSearchParams(window.location.search);
    _sessionId = params.get('session_id');

    if (!_sessionId) {
      showError('Thiếu session_id trong URL. Hãy bắt đầu phiên mới từ Dashboard.');
      return;
    }

    // Load stored Part 2 topic for Full Test chaining
    try { _ftP2Topic = sessionStorage.getItem('ielts_ft_p2topic') || null; } catch (_) {}

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
        showError('Không thể tạo câu hỏi. Hãy kiểm tra kết nối mạng và thử lại.');
        return;
      }

      // Detect test mode
      _testMode = (_sessionData.mode === 'test_part' || _sessionData.mode === 'test_full')
        ? _sessionData.mode : null;
      _testResults = [];

      // Full Test: initialise multi-part tracking on the opening session
      if (_testMode === 'test_full' && _ftAllSessionIds.length === 0) {
        _ftCurrentPart   = _sessionData.part;
        _ftAllSessionIds = [_sessionId];
      }

      if (_testMode) {
        var banner = $('test-mode-banner');
        if (banner) banner.style.display = '';
        // Slice questions to official exam count for test mode
        var qCountTable = (_testMode === 'test_full') ? FULL_TEST_Q_COUNT : TEST_Q_COUNT;
        var partKey     = (_testMode === 'test_full') ? _ftCurrentPart : _sessionData.part;
        var maxQ = qCountTable[partKey] || questions.length;
        questions = questions.slice(0, maxQ);

        // Validate Full Test Part 1 grouping structure
        if (_testMode === 'test_full' && _sessionData.part === 1 && questions.length < 9) {
          showError(
            'Không tạo đủ câu hỏi cho Full Test Part 1 (cần 9, nhận được ' + questions.length + '). ' +
            'Vui lòng quay lại Dashboard và thử lại.'
          );
          return;
        }
      }

      _questions  = questions;
      _currentIdx = 0;

      // Show a warning banner if Gemini was unavailable and fallback questions are being used
      var isFallback = questions.some(function (q) { return q._fallback; });
      var fallbackBanner = $('prep-fallback-warning');
      if (fallbackBanner) {
        fallbackBanner.style.display = isFallback ? '' : 'none';
      }

      // Routing to first question:
      //  • Part 2        → cue card flow; skip mode-choice
      //  • test_full     → force listening (exam mode); hide question text
      //  • test_part     → force listening
      //  • practice      → default visual; skip mode-choice screen
      if (_sessionData && _sessionData.part === 2) {
        _showPrep();
      } else if (_testMode === 'test_full') {
        // Full Test: listening/exam mode — examiner reads the question aloud
        _qMode = 'listening';
        try { sessionStorage.setItem('ielts_qmode', 'listening'); } catch (e) {}
        _applyQModeUI();
        _showPrep();
      } else if (_testMode === 'test_part') {
        // Part test: visual mode — no TTS
        _qMode = 'visual';
        try { sessionStorage.setItem('ielts_qmode', 'visual'); } catch (e) {}
        _applyQModeUI();
        _showPrep();
      } else {
        // Practice mode: always visual, skip mode-choice screen
        _qMode = 'visual';
        try { sessionStorage.setItem('ielts_qmode', 'visual'); } catch (e) {}
        _applyQModeUI();
        _showPrep();
      }

    } catch (err) {
      showError('Không thể tải session: ' + (err.message || 'Lỗi không xác định'));
    }
  }

  // ── PDF Export ────────────────────────────────────────────────────────────────

  // Download PDF for each session in the test (or just the current session).
  // btn — the button element (disabled during download to prevent double-click).
  async function _downloadPDFs(btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang tạo PDF...'; }

    var sessionIds = _ftAllSessionIds.length > 0 ? _ftAllSessionIds : [_sessionId];
    var sb = window.getSupabase && window.getSupabase();
    var token = '';
    try {
      if (sb) {
        var sess = await sb.auth.getSession();
        token = sess.data && sess.data.session && sess.data.session.access_token || '';
      }
    } catch (_) {}

    var base = window.api && window.api.base ? window.api.base : '';
    var errors = [];

    for (var i = 0; i < sessionIds.length; i++) {
      var sid = sessionIds[i];
      try {
        var res = await fetch(base + '/sessions/' + sid + '/export/pdf', {
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var blob = await res.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'IELTS_Report_Part' + (i + 1) + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      } catch (err) {
        errors.push('Part ' + (i + 1) + ': ' + (err.message || 'Lỗi'));
      }
    }

    if (btn) {
      btn.disabled = false;
      if (errors.length > 0) {
        btn.textContent = '⚠️ ' + errors.join(', ');
      } else {
        btn.textContent = '✅ Đã tải xuống';
        setTimeout(function () {
          if (btn) btn.textContent = '📄 Tải xuống báo cáo PDF';
        }, 3000);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  window.PracticeApp = {
    init:                 init,
    goToRecording:        goToRecording,
    startRecording:       startRecording,
    stopRecording:        stopRecording,
    resetRecording:       resetRecording,
    submitRecording:      submitRecording,
    nextQuestion:         nextQuestion,
    finishSession:        finishSession,
    startP2Prep:          startP2Prep,
    startP2SpeakingEarly: startP2SpeakingEarly,
    stopP2SpeakingEarly:  stopP2SpeakingEarly,
    // Question mode (Part 1 & 3)
    setQMode:             _setQMode,
    playQuestion:         _playQuestion,
    chooseModeAndStart:   _chooseModeAndStart,
    revealQuestionText:   _revealQuestionText,
    // Audio replay / download on feedback screen
    replayAudio:          _replayAudio,
    downloadAudio:        _downloadAudio,
    // On-demand pronunciation assessment (practice mode)
    assessSinglePronunciation: assessSinglePronunciation,
    // PDF export
    downloadPDFs:         _downloadPDFs,
    // exposed for state-break skip button (optional future use)
    showState:            showState,
  };

})();
