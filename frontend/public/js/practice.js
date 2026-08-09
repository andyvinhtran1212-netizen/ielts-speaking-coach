// practice.js — IELTS Speaking practice: prep → record → grade → feedback
// Depends on: api.js (window.api, window.getSupabase, window.initSupabase)

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────────

  // Hard-stop recording after this many seconds per part (silent — not shown to user)
  var MAX_RECORD_SEC = { 1: 45, 2: 120, 3: 75 };

  // Sprint 14.2 — per-part minimum recording length (seconds). Backend
  // is authoritative (services/audio_validation.py raises 422 below the
  // floor); the client mirrors the cap-table so the "Nộp" gate can
  // pre-warn the user instead of letting them eat a network round-trip.
  // The numbers MUST stay in sync with MIN_DURATION_BY_PART in
  // backend/services/audio_validation.py — sentinel pins both sides.
  var MIN_RECORD_SEC = { 1: 15, 2: 80, 3: 25 };

  var P2_PREP_SEC  = 60;   // Part 2 prep countdown (seconds)
  var P2_SPEAK_SEC = 120;  // Part 2 speaking countdown (seconds)

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
  var _playerGeneration = 0;  // suppress stale async UI after soft navigation
  var _playerActive = false;

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
  var _processingRun = 0;

  // Part 2 timers
  var _p2PrepTimerId   = null;
  var _p2PrepSecsLeft  = 0;
  var _p2SpeakTimerId  = null;
  var _p2SpeakSecsLeft = 0;

  // Test mode
  var _testMode         = null;   // null | 'test_part' | 'test_full'
  var _testResults      = [];     // [{part, questionText, response}]
  var _ftP2Topic        = null;   // stored Part 2 topic for Full Test chaining
  var _ftCurrentPart    = null;   // current part being tested in Full Test (1 | 2 | 3)
  var _ftAllSessionIds  = [];     // all session IDs created during a Full Test (completed at the end)
  var _sittingId        = null;   // set when this full-test is part of a 4-skill mock sitting
  // B1 (audit 2026-07-03): track eager-upload / session-complete failures during
  // a Full Test so a swallowed error (previously console.warn only) surfaces to
  // the user instead of the answer silently vanishing from the aggregate.
  var _ftSubmitTotal    = 0;      // eager uploads attempted in this full test
  var _ftSubmitFailures = [];     // questionIds whose eager upload failed
  var _ftSubmitKeys     = {};     // session/question pairs already counted
  var _ftSubmitFailureKeys = {};  // pairs already represented in failures
  var _ftLegacyPending  = {};     // legacy-only upload promises keyed by session/question
  var _ftCompleteFailures = 0;    // sessions whose /complete call failed
  var _fullTestRetryInFlight = false;

  // Spike-2 fix (defect g, 2026-07-14, hardened per review #749): test_part
  // answers used to queue as in-memory blobs graded only at the end — a
  // refresh mid-test LOST every recorded-but-ungraded answer. test_part now
  // grades each answer through the SAME awaited path as practice
  // (_startProcessing → _uploadAndGrade), which persists the response
  // server-side BEFORE advancing to the next question — so the blob is never
  // the only copy across a screen transition. _showFeedback() short-circuits
  // for test mode (no feedback shown, just accumulate + advance). init()
  // resumes at the first still-unanswered question.


  // Blob URL for the current practice-mode recording (used for replay/download on feedback screen)
  var _feedbackAudioUrl = null;
  var _feedbackAudioIsBlob = false;
  var _feedbackReplayAudio = null;

  // response_id of the most recently graded response (practice mode — used for pron assessment)
  var _currentResponseId = null;

  // Question mode for Part 1 & 3 — 'visual' (read on screen) | 'listening' (hear via TTS)
  // Persisted in sessionStorage so the choice survives across questions in the same tab session.
  var _qMode = (function () {
    try { return sessionStorage.getItem('ielts_qmode') || 'visual'; } catch (e) { return 'visual'; }
  }());

  // ── Full-test chain persistence (spike-2 fix, 2026-07-14) ────────────────────
  // _ftAllSessionIds only lived in memory, so a refresh mid full-test LOST the
  // earlier parts' session ids and finalize-full-test aggregated the wrong
  // sessions (Part 1's score silently missing). The chain now mirrors to
  // sessionStorage — same tab-scoped contract family as ielts_ft_p2topic.
  var FT_CHAIN_KEY = 'ielts_ft_session_ids';

  function _getNativeFullTest() {
    var controller = window.PracticeFullTest;
    return controller
      && typeof controller.restore === 'function'
      && typeof controller.submitAnswer === 'function'
      && typeof controller.finalizeFullTest === 'function'
      && typeof controller.replaceChainIfCurrent === 'function'
      ? controller
      : null;
  }

  function _saveFtChain() {
    var nativeFullTest = _getNativeFullTest();
    if (nativeFullTest && _ftAllSessionIds.length) {
      nativeFullTest.replaceChain(_ftAllSessionIds);
      return;
    }
    try { sessionStorage.setItem(FT_CHAIN_KEY, JSON.stringify(_ftAllSessionIds)); } catch (e) { /* storage not available */ }
  }

  function _replaceLegacyFtChainIfCurrent(expectedIds, nextIds) {
    try {
      var storedIds = JSON.parse(sessionStorage.getItem(FT_CHAIN_KEY) || 'null');
      var unchanged = Array.isArray(storedIds)
        && storedIds.length === expectedIds.length
        && storedIds.every(function (id, index) { return id === expectedIds[index]; });
      if (!unchanged) return false;
      sessionStorage.setItem(FT_CHAIN_KEY, JSON.stringify(nextIds));
      return true;
    } catch (e) {
      return false;
    }
  }

  function _loadFtChain() {
    var nativeFullTest = _getNativeFullTest();
    if (nativeFullTest && _sessionId) {
      return nativeFullTest.restore({
        ownerId: _currentUserId,
        currentSessionId: _sessionId,
        responseLookupFailed: !!(
          _sessionData && _sessionData.response_lookup_failed === true
        ),
        responses: ((_sessionData && _sessionData.responses) || []).concat(
          (_sessionData && _sessionData.response_receipts) || []
        ),
      }).sessionIds;
    }
    try {
      var arr = JSON.parse(sessionStorage.getItem(FT_CHAIN_KEY) || 'null');
      if (!Array.isArray(arr) || arr.length === 0) return null;
      for (var i = 0; i < arr.length; i++) {
        if (typeof arr[i] !== 'string' || !arr[i]) return null;
      }
      return arr;
    } catch (e) { return null; }
  }

  function _clearFtChain() {
    var nativeFullTest = _getNativeFullTest();
    if (nativeFullTest) {
      nativeFullTest.clear();
      return;
    }
    try { sessionStorage.removeItem(FT_CHAIN_KEY); } catch (e) { /* storage not available */ }
  }

  // ── DOM helper ────────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function _getNativePlayer() {
    var controller = window.PracticePlayer;
    return controller
      && typeof controller.showState === 'function'
      && typeof controller.clearEffect === 'function'
      && typeof controller.startInterval === 'function'
      && typeof controller.startTimeout === 'function'
      && typeof controller.startCountdown === 'function'
      && typeof controller.listen === 'function'
      && typeof controller.createObjectUrl === 'function'
      && typeof controller.revokeObjectUrl === 'function'
      && typeof controller.cancelSpeech === 'function'
      ? controller
      : null;
  }

  function _getNativeView() {
    var controller = _getNativePlayer();
    return controller
      && typeof controller.updateView === 'function'
      && typeof controller.getViewSnapshot === 'function'
      ? controller
      : null;
  }

  function _updateNativeView(section, patch) {
    var view = _getNativeView();
    return view ? view.updateView(section, patch) : false;
  }

  // Legacy and Next players coexist during Gate E. Keep each implementation
  // on its own stable result URL so a rollback cannot move an active flow to
  // the other renderer. Controller presence is the ownership signal; pathname
  // sniffing would make copied URLs and coexistence drills ambiguous.
  function _singleSessionResultUrl(sessionId) {
    var path = _getNativeView() ? '/result' : '/pages/result.html';
    return path + '?id=' + encodeURIComponent(sessionId);
  }

  function _fullTestResultUrl(sessionIds) {
    var path = _getNativeView() ? '/full-test-result' : '/pages/full-test-result.html';
    var url = path + '?p1=' + encodeURIComponent(sessionIds[0] || '');
    if (sessionIds[1]) url += '&p2=' + encodeURIComponent(sessionIds[1]);
    if (sessionIds[2]) url += '&p3=' + encodeURIComponent(sessionIds[2]);
    return url;
  }

  function _startManagedInterval(key, callback, milliseconds) {
    var nativePlayer = _getNativePlayer();
    return nativePlayer
      ? nativePlayer.startInterval(key, callback, milliseconds)
      : setInterval(callback, milliseconds);
  }

  function _startManagedTimeout(key, callback, milliseconds) {
    var nativePlayer = _getNativePlayer();
    return nativePlayer
      ? nativePlayer.startTimeout(key, callback, milliseconds)
      : setTimeout(callback, milliseconds);
  }

  function _clearManagedEffect(key, legacyHandle, kind) {
    var nativePlayer = _getNativePlayer();
    if (nativePlayer) return nativePlayer.clearEffect(key);
    if (!legacyHandle) return false;
    if (kind === 'timeout') clearTimeout(legacyHandle);
    else clearInterval(legacyHandle);
    return true;
  }

  function _startManagedCountdown(key, options) {
    var nativePlayer = _getNativePlayer();
    return nativePlayer ? nativePlayer.startCountdown(key, options) : null;
  }

  function _listenManaged(key, target, type, listener, options) {
    var nativePlayer = _getNativePlayer();
    if (nativePlayer) return nativePlayer.listen(key, target, type, listener, options);
    if (!target || !target.addEventListener) return false;
    target.addEventListener(type, listener, options);
    return true;
  }

  function _createManagedObjectUrl(key, blob) {
    var nativePlayer = _getNativePlayer();
    return nativePlayer ? nativePlayer.createObjectUrl(key, blob) : URL.createObjectURL(blob);
  }

  function _revokeManagedObjectUrl(key, url) {
    var nativePlayer = _getNativePlayer();
    if (nativePlayer) return nativePlayer.revokeObjectUrl(key, url);
    if (!url) return false;
    try { URL.revokeObjectURL(url); } catch (_) {}
    return true;
  }

  function _cancelSpeech() {
    var nativePlayer = _getNativePlayer();
    _browserTtsGeneration++;
    _clearManagedEffect('tts-browser-sequence-delay', null, 'timeout');
    _clearManagedEffect('tts-ai-sequence-delay', null, 'timeout');
    if (nativePlayer) nativePlayer.cancelSpeech();
    else if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // ── Top-level state management ────────────────────────────────────────────────

  var _ALL_STATES = ['loading', 'error', 'mode-choice', 'prep', 'p2a', 'p2b', 'p2c', 'processing', 'feedback', 'test-results', 'completion', 'sheet'];


  /**
   * Chuyển giữa "đọc câu hỏi" và "nghe câu hỏi".
   *
   * Khối câu hỏi chữ bị ẨN HẲN chứ không để rỗng: một thẻ "Câu hỏi" trống là một
   * lời hứa hỏng — người học sẽ tưởng trang chưa tải xong.
   */
  function _applyListenOnlyUI(on) {
    var url = on ? ((_currentQ && _currentQ.audio_url) || '') : '';
    var nativeError = on && !url
      ? 'Bài này chưa có bản đọc đề. Báo giáo viên giúp nhé.'
      : '';
    if (_updateNativeView('prep', {
      listenOnly: !!on,
      listenAudioUrl: url,
      listenError: nativeError,
    })) return;

    var qCard = $('prep-q-card');
    var block = $('prep-listen');
    var audio = $('prep-listen-audio');
    var err   = $('prep-listen-error');
    if (qCard) qCard.classList.toggle('hidden', !!on);
    if (block) block.classList.toggle('hidden', !on);
    if (err) err.classList.add('hidden');
    if (!audio) return;

    if (!on) {
      audio.pause();
      audio.removeAttribute('src');
      return;
    }
    if (!url) {
      // Không có audio mà cũng không có chữ nghĩa là em ấy không có gì cả. Nói
      // ra, đừng để một ô trình phát rỗng.
      if (err) {
        err.textContent = 'Bài này chưa có bản đọc đề. Báo giáo viên giúp nhé.';
        err.classList.remove('hidden');
      }
      audio.removeAttribute('src');
      return;
    }
    if (audio.getAttribute('src') !== url) audio.setAttribute('src', url);
    audio.onerror = function () {
      if (err) {
        err.textContent = 'Chưa tải được câu hỏi. Kiểm tra kết nối rồi bấm phát lại.';
        err.classList.remove('hidden');
      }
    };
  }

  function showState(name) {
    if (!_playerActive && _playerGeneration > 0) return;
    var nativePlayer = _getNativePlayer();
    if (nativePlayer) {
      nativePlayer.showState(name);
      _currentState = name;
      return;
    }
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
    if (!_updateNativeView('frame', { errorMessage: msg })) {
      var el = $('error-msg');
      if (el) el.textContent = msg;
    }
    showState('error');
  }

  function _setLoadingMessage(message) {
    if (!_updateNativeView('frame', { loadingMessage: message })) {
      var el = $('loading-msg');
      if (el) el.textContent = message;
    }
  }

  // ── Recording sub-state management ───────────────────────────────────────────

  function _showRecSub(name) {
    // name: 'idle' | 'recording' | 'recorded'
    if (!_updateNativeView('recording', { substate: name })) {
      ['idle', 'recording', 'recorded'].forEach(function (s) {
        var el = $('rec-' + s);
        if (!el) return;
        el.style.display = (s === name) ? '' : 'none';
      });
    }
    _recSubState = name;
  }

  // ── Header ────────────────────────────────────────────────────────────────────

  function _updateHeader() {
    if (!_sessionData) return;
    // For Full Test Part 1, the topic is a '|||'-joined string — show only the part number.
    var topicStr = (_sessionData.topic || '');
    var headerTopic = (topicStr.indexOf('|||') !== -1) ? '' : (' · ' + topicStr);
    var infoText = 'Part ' + _sessionData.part + headerTopic;
    var progressText = (_currentIdx + 1) + ' / ' + _questions.length;
    var pct = 0;
    var labelText = '';
    if (_testMode === 'test_full') {
      // Cumulative questions before each part starts (Part 1: 9q, Part 2: 1q, Part 3: 5q → total 15)
      var _FT_BEFORE = { 1: 0, 2: 9, 3: 10 };
      var _FT_TOTAL  = 15;
      var currentPart        = _ftCurrentPart || _sessionData.part;
      var doneBeforeThisPart = _FT_BEFORE[currentPart] || 0;
      var overallDone        = doneBeforeThisPart + (_currentIdx + 1);
      pct = Math.round((overallDone / _FT_TOTAL) * 100);
      labelText = 'Part ' + currentPart + ' / 3  ·  Câu ' + (_currentIdx + 1) + ' / ' + _questions.length + '  ·  Tổng: ' + overallDone + ' / ' + _FT_TOTAL;
    } else if (_testMode) {
      pct = _questions.length > 0 ? Math.round((_currentIdx + 1) / _questions.length * 100) : 0;
      labelText = 'Câu ' + (_currentIdx + 1) + ' / ' + _questions.length;
    }

    if (_updateNativeView('header', {
      info: infoText,
      progress: progressText,
      visible: true,
      progressBarVisible: !!_testMode,
      progressBarLabel: labelText,
      progressBarPercent: pct,
    })) return;

    var info = $('hdr-info');
    if (info) {
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

    var counterText = 'Câu ' + (_currentIdx + 1) + ' / ' + _questions.length;
    var partBadge = 'Part ' + (_sessionData ? _sessionData.part : '');

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
    // Bài tập lớp Part 1/3: câu hỏi giao BẰNG AUDIO và backend không gửi chữ.
    // Kiểm cờ chứ không kiểm chuỗi rỗng: một câu bình thường cũng có thể rỗng
    // vì lỗi, và khi đó phải hiện lỗi chứ không lặng lẽ chuyển sang chế độ nghe.
    var listenOnly = !!(_currentQ && _currentQ.listen_only);
    _applyListenOnlyUI(listenOnly);
    var questionText = listenOnly ? '' : (_currentQ.question_text || '');

    // Full Test: hide question text by default (listening/exam mode)
    var revealTextVisible = !listenOnly && _testMode !== 'test_full';
    var revealButtonVisible = !listenOnly && _testMode === 'test_full';
    var nativePrep = _updateNativeView('prep', {
      partBadge: partBadge,
      topic: displayTopic,
      counter: counterText,
      questionText: questionText,
      revealTextVisible: revealTextVisible,
      revealButtonVisible: revealButtonVisible,
      cueVisible: false,
      cueBullets: [],
      cueReflection: '',
      inlineRecordingVisible: false,
      startButtonVisible: true,
    });

    if (!nativePrep) {
      $('prep-q-counter').textContent = counterText;
      $('prep-part-badge').textContent = partBadge;
      $('prep-topic').textContent = displayTopic;
      $('prep-q-text').textContent = questionText;

      // Issue 2: Reset inline recording section when showing prep
      var inlineRec = $('inline-rec-section');
      if (inlineRec) inlineRec.style.display = 'none';
      var startBtn = $('prep-start-btn');
      if (startBtn) startBtn.style.display = '';

    var revealWrap = $('prep-text-reveal');
    var revealBtn  = $('prep-reveal-btn');
    if (listenOnly) {
      // Không có gì để hiện — chữ chưa từng rời máy chủ. Để nút "Hiện câu hỏi"
      // ở đây sẽ hứa một việc mà bấm vào không xảy ra.
      if (revealWrap) revealWrap.style.display = 'none';
      if (revealBtn)  revealBtn.style.display  = 'none';
    } else if (_testMode === 'test_full') {
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
    if (!_updateNativeView('prep', {
      inlineRecordingVisible: true,
      startButtonVisible: false,
    })) {
      var inlineRec = $('inline-rec-section');
      if (inlineRec) inlineRec.style.display = '';
      var startBtn = $('prep-start-btn');
      if (startBtn) startBtn.style.display = 'none';
    }

    startRecording();          // begin recording immediately — no extra click needed
  }

  // ── Recording: start ──────────────────────────────────────────────────────────

  function _getNativeRecorder() {
    var recorder = window.PracticeRecorder;
    return recorder
      && typeof recorder.start === 'function'
      && typeof recorder.stop === 'function'
      && typeof recorder.reset === 'function'
      && typeof recorder.release === 'function'
      && typeof recorder.destroy === 'function'
      && typeof recorder.isStarting === 'function'
      && typeof recorder.getAnalyser === 'function'
      ? recorder
      : null;
  }

  var _nativeSubmissionSeen = false;

  function _getNativeSubmission() {
    var submission = window.PracticeSubmission;
    return submission
      && typeof submission.submit === 'function'
      && typeof submission.destroy === 'function'
      ? submission
      : null;
  }

  function _normalizeSubmissionResult(data) {
    if (!(data && data._reconciled && data._persisted_response)) return data;
    var row = data._persisted_response;
    var recovered = _respToFeedbackData(row);
    // Persistence is confirmed, grading is not. Never render an empty feedback
    // screen or call the slot fully graded merely because the row has an id.
    if (!_respGraded(row) && !_respFailed(row)) {
      recovered._stub = true;
      recovered._error = 'Bản ghi đã lưu, nhưng máy đang hoàn tất chấm câu này.';
      recovered._reason = 'reconciled_pending_grading';
    }
    recovered._reconciled = true;
    return recovered;
  }

  function _submissionFilename(blob) {
    var mime = String((blob && blob.type) || '').split(';')[0].trim().toLowerCase();
    var extensions = {
      'audio/flac': 'flac', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
      'audio/wave': 'wav', 'audio/webm': 'webm', 'audio/x-m4a': 'm4a',
    };
    return 'response.' + (extensions[mime] || 'webm');
  }

  function _knownResponseId(questionId) {
    var responses = (_sessionData && _sessionData.responses) || [];
    for (var i = 0; i < responses.length; i++) {
      if (String(responses[i].question_id) === String(questionId) && responses[i].id) {
        return responses[i].id;
      }
    }
    return null;
  }

  function _submitResponseTransport(sessionId, questionId, blob, opts) {
    var nativeSubmission = _getNativeSubmission();
    if (nativeSubmission) {
      _nativeSubmissionSeen = true;
      return nativeSubmission.submit({
        sessionId: sessionId,
        questionId: questionId,
        blob: blob,
        priorResponseId: opts && opts.priorResponseId,
      }).then(_normalizeSubmissionResult);
    }

    // Once the native route has owned a mutation, losing its bridge must fail
    // closed. Falling back would silently remove ambiguity reconciliation and
    // can mislabel Safari MP4 audio while the long-lived legacy IIFE survives.
    if (_nativeSubmissionSeen) {
      var unavailable = Object.assign(
        new Error(
          'Bộ gửi bài tạm thời chưa sẵn sàng. Bản ghi vẫn còn trên trang này; '
          + 'hãy đăng nhập lại ở tab khác nếu cần.'
        ),
        { code: 'runtime_unavailable' }
      );
      return Promise.reject(unavailable);
    }

    // Legacy URL fallback. The App Router route always installs the native
    // transport before PracticeApp.init(), so FormData ownership is native there.
    var fd = new FormData();
    fd.append('question_id', questionId);
    fd.append('audio_file', blob, _submissionFilename(blob));
    return window.api.upload('/sessions/' + sessionId + '/responses', fd);
  }

  function _handleRecordedBlob(blob, elapsed) {
    _recordedBlob = blob;
    if (typeof elapsed === 'number') _elapsedSecs = elapsed;
    _stopWaveform();

    // Show recorded sub-state with duration
    var m = Math.floor(_elapsedSecs / 60);
    var s = _elapsedSecs % 60;
    var durationText = 'Thời lượng ghi âm: ' + m + ':' + (s < 10 ? '0' + s : s);
    if (!_updateNativeView('recording', { duration: durationText })) {
      var durEl = $('rec-duration-display');
      if (durEl) durEl.textContent = durationText;
    }
    // Phiếu làm bài nộp NGAY câu vừa ghi và trả quyền micro — không đi qua
    // màn "đã ghi / nộp" của luồng phễu, vì ở phiếu mỗi ô tự quản trạng thái.
    if (_sheetActive()) {
      _showRecSub('idle');
      _sheetOnRecorded(_recordedBlob);
      return;
    }
    _renderRecordedPlayback();
    _renderRecordedLengthHint();
    _showRecSub('recorded');
  }

  async function _startNativeRecording(nativeRecorder) {
    var generation = _playerGeneration;
    _audioChunks = [];
    _recordedBlob = null;
    _elapsedSecs = 0;
    _renderTimer();
    try {
      var started = await nativeRecorder.start({
        maxSeconds: MAX_RECORD_SEC[_sessionData ? _sessionData.part : 1] || 90,
        onTick: function (seconds) {
          _elapsedSecs = seconds;
          _renderTimer();
        },
        onRecorded: _handleRecordedBlob,
      });
      if (!_playerActive || generation !== _playerGeneration) {
        nativeRecorder.reset();
        return false;
      }
      if (!started) {
        // A concurrent click may still own the pending permission request; a
        // sheet slot may also deliberately cancel it. Neither is a mic error.
        var cancelled = nativeRecorder.isStarting()
          || (_sheetActive() && _sheet.recIdx === -1);
        if (!cancelled) {
          _showRecError('Không thể bắt đầu ghi âm. Hãy kiểm tra microphone rồi thử lại.');
        }
        return false;
      }
      _analyser = nativeRecorder.getAnalyser();
      _startWaveform();
      _showRecSub('recording');
      return true;
    } catch (err) {
      if (!_playerActive || generation !== _playerGeneration) return false;
      _showRecError(err && err.message ? err.message : 'Không thể mở microphone.');
      return false;
    }
  }

  async function startRecording() {
    if (_recSubState === 'recording') return false;
    _stopAITts();
    _cancelSpeech();
    _clearRecError();

    var nativeRecorder = _getNativeRecorder();
    if (nativeRecorder) return _startNativeRecording(nativeRecorder);

    // Check API availability
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      _showRecError('Trình duyệt không hỗ trợ ghi âm. Hãy dùng Chrome, Firefox hoặc Edge phiên bản mới.');
      return false;
    }
    if (typeof MediaRecorder === 'undefined') {
      _showRecError('Trình duyệt không hỗ trợ MediaRecorder. Hãy dùng Chrome, Firefox hoặc Edge phiên bản mới.');
      return false;
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
        return false;
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
      _handleRecordedBlob(new Blob(_audioChunks, { type: type }), _elapsedSecs);
    };

    _recorder.start(250);   // fire ondataavailable every 250ms

    // Elapsed timer (counts up; hard-stop at MAX_RECORD_SEC)
    // Always clear any previous interval before starting a new one
    if (_timerId) { _clearManagedEffect('recording-elapsed', _timerId, 'interval'); _timerId = null; }
    _elapsedSecs = 0;
    _renderTimer();
    _timerId = _startManagedInterval('recording-elapsed', function () {
      _elapsedSecs++;
      _renderTimer();
      var maxSec = MAX_RECORD_SEC[_sessionData ? _sessionData.part : 1] || 90;
      if (_elapsedSecs >= maxSec) stopRecording();
    }, 1000);

    _startWaveform();
    _showRecSub('recording');

    // BÁO THÀNH CÔNG. Hàm này xử lý lỗi micro BÊN TRONG (hiện thông báo rồi
    // `return false`), nên caller không thể dùng `catch` để phân biệt "đã bắt
    // đầu ghi" với "micro bị từ chối" — chỉ có giá trị trả về nói được.
    // Thiếu dòng này thì phiếu làm bài coi MỌI lần ghi âm là hỏng micro, dù
    // micro đã mở và máy đang ghi thật.
    return true;
  }

  function _renderTimer() {
    var m = Math.floor(_elapsedSecs / 60);
    var s = _elapsedSecs % 60;
    var timerText = m + ':' + (s < 10 ? '0' + s : s);
    if (_updateNativeView('recording', { timer: timerText })) return;
    var el = $('rec-timer');
    if (el) el.textContent = timerText;
  }

  // ── Recording: stop ───────────────────────────────────────────────────────────

  function stopRecording() {
    if (_recSubState !== 'recording') return false;
    if (_timerId) { _clearManagedEffect('recording-elapsed', _timerId, 'interval'); _timerId = null; }
    _stopWaveform();
    var nativeRecorder = _getNativeRecorder();
    if (nativeRecorder) {
      if (nativeRecorder.stop()) return true;
      return _handleRecordingStopFailure();
    }
    if (_recorder && _recorder.state !== 'inactive') {
      try {
        _recorder.stop();
        // onstop callback → _showRecSub('recorded')
        return true;
      } catch (_) {
        return _handleRecordingStopFailure();
      }
    }
    return false;
  }

  function _handleRecordingStopFailure() {
    // The controller has already failed closed, but legacy MediaRecorder may
    // still own a stream. Cleanup is idempotent for both implementations.
    _releaseRecorderResources();
    _showRecSub('idle');
    var message = 'Không dừng được ghi âm. Hãy thử ghi lại.';
    if (_sheetActive() && _sheet.recIdx !== -1) {
      var slot = _sheet.slots[_sheet.recIdx];
      if (slot) {
        slot.state = slot.prevState || slot.hadWork || 'idle';
        slot.prevState = null;
        slot.error = message;
      }
      _sheet.recIdx = -1;
      _renderSheet();
    } else {
      _showRecError(message);
    }
    return false;
  }

  // ── Recording: reset (re-record) ──────────────────────────────────────────────

  function resetRecording() {
    _resetRecorder();
    _clearRecError();
    _showRecSub('idle');
  }

  function _resetRecorder() {
    if (_timerId) { _clearManagedEffect('recording-elapsed', _timerId, 'interval'); _timerId = null; }
    _stopWaveform();
    var nativeRecorder = _getNativeRecorder();
    if (nativeRecorder) {
      nativeRecorder.reset();
      _analyser = null;
    } else if (_recorder && _recorder.state !== 'inactive') {
      _recorder.onstop = null;   // prevent stale onstop from firing after reset
      try { _recorder.stop(); } catch (_) {}
    }
    _recorder     = null;
    _audioChunks  = [];
    _recordedBlob = null;
    _elapsedSecs  = 0;
    // Reset timer display
    if (!_updateNativeView('recording', { timer: '0:00', duration: '' })) {
      var timerEl = $('rec-timer');
      if (timerEl) timerEl.textContent = '0:00';
    }
    // Clear waveform canvas
    var canvas = $('rec-canvas');
    if (canvas) {
      var ctx2d = canvas.getContext('2d');
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
    // Sprint 14.2 — tear down playback URL + length hint so the next
    // recording starts clean. Skipping the revoke leaks blob URLs and
    // (worse) leaves the previous take playable on the next "Đã ghi
    // âm xong!" screen — a misleading UX.
    _teardownRecordedPlayback();
  }

  // Sprint 14.2 — playback widget + length-hint helpers ────────────────────────

  // Blob URL held by the <audio id="rec-playback"> element. Tracked
  // separately from _feedbackAudioUrl because the feedback screen's
  // URL is created later (in _showFeedback) and revoked on next render;
  // mixing them double-revokes.
  var _recordedPlaybackUrl = null;

  function _renderRecordedPlayback() {
    if (!_recordedBlob) return;
    if (_recordedPlaybackUrl) {
      _revokeManagedObjectUrl('recorded-playback', _recordedPlaybackUrl);
      _recordedPlaybackUrl = null;
    }
    _recordedPlaybackUrl = _createManagedObjectUrl('recorded-playback', _recordedBlob);
    if (_updateNativeView('recording', { playbackUrl: _recordedPlaybackUrl || '' })) return;
    var audioEl = $('rec-playback');
    if (!audioEl) return;
    audioEl.src = _recordedPlaybackUrl;
    audioEl.style.display = '';
  }

  function _renderRecordedLengthHint() {
    var part   = _sessionData ? _sessionData.part : null;
    var minSec = part ? (MIN_RECORD_SEC[part] || 0) : 0;
    if (!minSec || _elapsedSecs >= minSec) {
      if (_updateNativeView('recording', {
        lengthHint: '',
        lengthHintVisible: false,
        submitDisabled: false,
      })) return;
      var hintEl = $('rec-length-hint');
      var submit = $('rec-submit-btn');
      if (!hintEl) return;
      hintEl.style.display = 'none';
      hintEl.textContent = '';
      if (submit) { submit.disabled = false; submit.removeAttribute('aria-disabled'); }
      return;
    }

    var needMore = minSec - _elapsedSecs;
    var hintText =
      'Quá ngắn cho Part ' + part + ' — cần ít nhất ' + minSec +
      ' giây (còn thiếu ~' + needMore + 's). Hãy ghi lại trước khi nộp.';
    if (_updateNativeView('recording', {
      lengthHint: hintText,
      lengthHintVisible: true,
      submitDisabled: true,
    })) return;
    var hintEl = $('rec-length-hint');
    var submit = $('rec-submit-btn');
    if (!hintEl) return;
    hintEl.textContent = hintText;
    hintEl.style.display = '';
    if (submit) { submit.disabled = true; submit.setAttribute('aria-disabled', 'true'); }
  }

  function _teardownRecordedPlayback() {
    var audioEl = $('rec-playback');
    if (audioEl) {
      try { audioEl.pause(); } catch (_) {}
      audioEl.removeAttribute('src');
      audioEl.style.display = 'none';
    }
    if (_recordedPlaybackUrl) {
      _revokeManagedObjectUrl('recorded-playback', _recordedPlaybackUrl);
      _recordedPlaybackUrl = null;
    }
    if (_updateNativeView('recording', {
      playbackUrl: '',
      lengthHint: '',
      lengthHintVisible: false,
      submitDisabled: false,
    })) return;
    var hintEl = $('rec-length-hint');
    if (hintEl) { hintEl.style.display = 'none'; hintEl.textContent = ''; }
    var submit = $('rec-submit-btn');
    if (submit) { submit.disabled = false; submit.removeAttribute('aria-disabled'); }
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

    // Test modes: advance immediately (no grading spinner)
    if (_testMode === 'test_full') {
      // Eager upload — fire and forget; backend finalize handles aggregation
      _submitGradingEager(_sessionId, questionId, _recordedBlob);
      _advanceTestMode();
      return;
    }
    // test_part falls through to the awaited practice path below: each
    // answer is graded + persisted before _showFeedback (test short-circuit)
    // advances, so a refresh can never lose a confirmed answer (review #749).

    _startProcessing(_recordedBlob, questionId);
  }

  // ── Error banner in recording state ──────────────────────────────────────────

  function _showRecError(msg) {
    if (!_updateNativeView('recording', { error: msg, errorVisible: true })) {
      var el = $('rec-error');
      if (!el) return;
      el.textContent = msg;
      el.style.display = '';
    }
    // Auto-hide after 7 s
    _startManagedTimeout('recording-error-hide', function () {
      if (!_updateNativeView('recording', { errorVisible: false })) {
        var current = $('rec-error');
        if (current) current.style.display = 'none';
      }
    }, 7000);
  }

  function _clearRecError() {
    if (_updateNativeView('recording', { error: '', errorVisible: false })) return;
    var el = $('rec-error');
    if (el) el.style.display = 'none';
  }

  // ── STATE: Processing ─────────────────────────────────────────────────────────

  function _startProcessing(blob, questionId) {
    var generation = _playerGeneration;
    var processingRun = ++_processingRun;
    showState('processing');
    var idx   = 0;
    var nativeProcessing = _updateNativeView('processing', { text: PROCESSING_TEXTS[0] });
    var textEl = nativeProcessing ? null : $('processing-text');
    if (textEl) textEl.textContent = PROCESSING_TEXTS[0];
    if (_processingTimer) {
      _clearManagedEffect('processing-copy', _processingTimer, 'interval');
    }
    _processingTimer = _startManagedInterval('processing-copy', function () {
      idx = (idx + 1) % PROCESSING_TEXTS.length;
      if (!_updateNativeView('processing', { text: PROCESSING_TEXTS[idx] }) && textEl) {
        textEl.textContent = PROCESSING_TEXTS[idx];
      }
    }, 2000);
    _uploadAndGrade(blob, questionId, generation, processingRun);
  }

  async function _uploadAndGrade(blob, questionId, generation, processingRun) {
    var data = null;
    var nativeSubmission = _getNativeSubmission();
    try {
      data = await _submitResponseTransport(_sessionId, questionId, blob, {
        priorResponseId: _knownResponseId(questionId),
      });
    } catch (err) {
      if (!_playerActive || generation !== _playerGeneration || processingRun !== _processingRun) return;
      // Sprint 14.2 — audio-too-short is a *recoverable* user error, not
      // a server failure: route back to the recorded sub-state with the
      // backend's structured 422 detail rendered as the rec-error banner.
      // Other errors keep the legacy "AI temporarily unavailable" stub only
      // on the legacy URL; native transport below fails closed.
      var detail = err && err.detail;
      if ((err && err.code === 'audio_too_short') || (detail && detail.code === 'audio_too_short')) {
        if (_processingTimer) { _clearManagedEffect('processing-copy', _processingTimer, 'interval'); _processingTimer = null; }
        _handleAudioTooShort(detail);
        return;
      }
      // P0-2: the grade was NOT persisted (backend now fails loud with a 500 +
      // error_code instead of the old silent 200/null). Show retry, never enter
      // feedback — no silent data loss, and /complete won't see 0 responses.
      if ((err && err.code === 'response_persist_failed')
          || (err && err.status === 500 && detail && detail.error_code === 'response_persist_failed')) {
        if (_processingTimer) { _clearManagedEffect('processing-copy', _processingTimer, 'interval'); _processingTimer = null; }
        _handlePersistFailure(detail);
        return;
      }
      // Native transport never converts an unconfirmed mutation into feedback.
      // Network/5xx/malformed success is first reconciled against canonical
      // session responses; if still unknown, keep the blob and offer retry.
      if (nativeSubmission || (err && err.code === 'runtime_unavailable')) {
        if (_processingTimer) { _clearManagedEffect('processing-copy', _processingTimer, 'interval'); _processingTimer = null; }
        var explicitStop = err && (
          err.code === 'auth_required'
          || err.code === 'submission_forbidden'
          || err.code === 'session_unavailable'
          || err.code === 'runtime_unavailable'
        );
        var retryMessage = explicitStop
          ? err.message
          : (err && err.code === 'ambiguous_commit'
               ? 'Chưa thể xác nhận bản ghi đã được lưu. Bản ghi vẫn còn trên máy này; hãy bấm “Gửi” để kiểm tra và thử lại.'
               : 'Máy chủ chưa nhận bản ghi này. Bản ghi vẫn còn trên máy này; hãy bấm “Gửi” để thử lại.');
        _handlePersistFailure({ message: retryMessage });
        return;
      }
      var errMsg = err.message || 'Lỗi không xác định';
      if (errMsg === 'Failed to fetch' || errMsg.includes('NetworkError')) {
        errMsg = 'Không thể kết nối backend. Hãy kiểm tra server đang chạy.';
      }
      console.error('[practice] grading request failed:', err);
      data = { _stub: true, _error: errMsg };
    } finally {
      if (generation === _playerGeneration && processingRun === _processingRun && _processingTimer) {
        _clearManagedEffect('processing-copy', _processingTimer, 'interval');
        _processingTimer = null;
      }
    }
    if (!_playerActive || generation !== _playerGeneration || processingRun !== _processingRun) return;
    // P0-2 tolerant guard: a server 200 with no response_id means the grade was
    // NOT saved (old silent-fail backend, before this fix deployed). Treat it as
    // a persistence failure → retry, don't enter feedback with empty data.
    // Client-built error stubs carry `_error` and are exempt (legacy stub path).
    if (!_testMode && _gradeMissingPersist(data)) {
      _handlePersistFailure(null);
      return;
    }
    _clearP2SubmissionRetry();
    _showFeedback(data || { _stub: true, _error: 'Không có phản hồi từ server' });
  }

  // A server 200 whose payload has NO response_id = the grade was not saved (old
  // silent-fail backend). Client-built error stubs carry `_error` and are exempt
  // (they keep the legacy stub-feedback path). Pure → unit-testable (L20).
  function _gradeMissingPersist(data) {
    return !!(data && !data._error && !data.response_id);
  }

  // P0-2 — persistence failure: the grade was NOT saved. Keep the recording and
  // route back to the recorded sub-state so the existing "Gửi" button re-submits
  // (the retry), with a loud error banner. Never enter feedback (no silent loss).
  // Mirrors _handleAudioTooShort's recovery shape.
  function _handlePersistFailure(detail) {
    if (_processingTimer) { _clearManagedEffect('processing-copy', _processingTimer, 'interval'); _processingTimer = null; }
    var msg = (detail && detail.message)
      || 'Lỗi lưu kết quả chấm — kết quả CHƯA được lưu.';
    msg += ' Hãy bấm “Gửi” để thử lại.';
    var part = _sessionData ? _sessionData.part : null;
    if (part === 2) {
      // Keep the only local copy. Part 2 has no generic "recorded" sub-state,
      // so its cue-card screen owns an explicit replay / retry choice.
      _showP2SubmissionRetry(msg);
      return;
    }
    showState('recording');
    _showRecSub('recorded');
    _renderRecordedPlayback();
    _showRecError(msg);
  }

  // audit #3.4 — partial save means detail data was LOST; surface it as a REAL,
  // visible warning, not a faint color-free note. Reuses .ds-warning-banner
  // (the off-topic/length warning style — theme-safe --ds-warning-* tokens,
  // WCAG-AA verified), so being visible does not reintroduce a contrast bug.
  // Idempotent: removed when !show.
  function _showPartialNote(show) {
    var host = $('state-feedback');
    var note = $('feedback-partial-note');
    if (!show) { if (note) note.parentNode.removeChild(note); return; }
    if (!host) return;
    if (!note) {
      note = document.createElement('div');
      note.id = 'feedback-partial-note';
      note.className = 'ds-warning-banner';
      note.setAttribute('role', 'alert');
      host.insertBefore(note, host.firstChild);
    }
    note.innerHTML =
      '<span class="ds-warning-icon" aria-hidden="true">⚠️</span>'
      + '<p class="ds-warning-message">Kết quả chỉ lưu được MỘT PHẦN — một số dữ liệu chấm '
      + 'chi tiết đã không lưu. Phần chấm bên dưới vẫn xem được; nếu cần đầy đủ, hãy chấm lại câu này.</p>';
  }

  // Sprint 14.2 — handle backend's HTTP 422 audio_too_short by returning
  // to the recorded sub-state with a clear, actionable error banner.
  // The backend is authoritative on duration (Whisper-decoded); this
  // path fires when the user beats the client-side hint (e.g. timer
  // skew, Chrome < 115 MediaRecorder clock issues).
  function _handleAudioTooShort(detail) {
    var msg =
      'Bản ghi quá ngắn cho Part ' + detail.part + ' (' +
      Number(detail.duration_seconds).toFixed(1) + 's < ' +
      detail.min_seconds + 's tối thiểu). Hãy ghi lại với câu trả lời dài hơn.';
    // Part 2 has a different state machine (p2a → p2b → p2c) with no
    // "recorded" intermediate sub-state, so the only safe re-entry
    // point is the cue-card screen. The blob is discarded; the user
    // restarts the full P2 cycle.
    var part = _sessionData ? _sessionData.part : null;
    if (part === 2) {
      _clearP2SubmissionRetry();
      _resetRecorder();   // discard blob + clear playback URL
      showState('p2a');
      // p2a has no inline error region — surface via alert as a stopgap.
      // (A proper inline banner is a Phase B follow-up; the hard floor
      // is rare enough on a full 2-min P2 attempt that this is fine.)
      try { window.alert(msg); } catch (_) {}
      return;
    }
    // Practice mode P1/P3: snap back to recording state with the
    // recorded sub-state still showing the original blob + playback.
    // Submit stays disabled because _renderRecordedLengthHint will
    // re-check _elapsedSecs (which is < min_seconds, by definition).
    showState('recording');
    _showRecSub('recorded');
    _renderRecordedPlayback();
    _renderRecordedLengthHint();
    _showRecError(msg);
  }

  // ── STATE: Feedback ───────────────────────────────────────────────────────────

  function _nativeTextList(value) {
    return Array.isArray(value)
      ? value.filter(function (item) { return item != null && String(item).trim(); })
        .map(function (item) { return String(item); })
      : [];
  }

  function _nativeFiniteNumber(value) {
    var number = parseFloat(value);
    return isFinite(number) ? number : null;
  }

  function _nativeBandView(label, value) {
    var number = _nativeFiniteNumber(value);
    return {
      label: label,
      tone: _pillColorMap[label] || 'fc',
      value: number == null ? null : Math.round(number * 2) / 2,
      display: number == null ? '—' : (Math.round(number * 2) / 2).toFixed(1),
      title: number == null ? 'Chưa đánh giá phát âm' : '',
    };
  }

  function _nativeWarningViews(data) {
    if (!data) return [];
    var warnings = [];
    if (data.off_topic_verdict && data.off_topic_verdict.is_on_topic === false) {
      var reasoning = data.off_topic_verdict.reasoning || '';
      warnings.push({
        icon: '⚠️',
        message: 'Cảnh báo: Câu trả lời có thể chưa bám sát đề, nên band cho câu này đã bị giới hạn '
          + '(không phản ánh năng lực thật của bạn).'
          + (reasoning ? ' Lý do: ' + reasoning : ''),
      });
    }
    if (data.length_warning === true) {
      var duration = typeof data.audio_duration_seconds === 'number'
        ? data.audio_duration_seconds.toFixed(1) : '?';
      var threshold = typeof data.length_soft_threshold === 'number'
        ? Math.round(data.length_soft_threshold) : '?';
      warnings.push({
        icon: '⏱️',
        message: 'Cảnh báo: Câu trả lời chỉ ' + duration + 's, ngắn hơn ngưỡng '
          + 'tham khảo ' + threshold + 's. Có thể giới hạn band tối đa.',
      });
    }
    return warnings;
  }

  function _nativeReliabilityView(data) {
    var confidence = (data && data.score_confidence)
      || (data && data.assessment_confidence);
    if (!confidence || confidence === 'high') return null;
    var low = confidence === 'low';
    return {
      tone: low ? 'low' : 'medium',
      message: low
        ? 'Âm thanh ghi âm có chất lượng hạn chế — điểm số và nhận xét lần này chỉ mang tính tham khảo. '
          + 'Hãy thử ghi âm lại ở nơi yên tĩnh hơn hoặc nói to và rõ hơn để nhận được đánh giá chính xác hơn.'
        : 'Một số phần nhận xét có thể cần xem như gợi ý tham khảo — chất lượng âm thanh hoặc tốc độ nói '
          + 'có thể ảnh hưởng nhẹ đến độ chính xác của đánh giá.',
    };
  }

  function _nativeGrammarGroups(grammarCheck) {
    if (!grammarCheck || !Array.isArray(grammarCheck.errors)) {
      return { groups: [], moreCount: 0 };
    }
    var labels = {
      tense: 'Thì động từ',
      article: 'Mạo từ',
      preposition: 'Giới từ',
      missing_subject: 'Thiếu chủ ngữ',
      subject_verb_agreement: 'Sự hòa hợp chủ - động',
      verb_form: 'Dạng động từ',
      copula: 'Động từ to be',
      vocabulary: 'Từ vựng',
      punctuation: 'Dấu câu',
      spelling: 'Chính tả',
      style: 'Văn phong',
      grammar: 'Ngữ pháp',
      other: 'Khác',
    };
    var groups = [];
    var byCategory = {};
    grammarCheck.errors.forEach(function (error) {
      if (!error || typeof error !== 'object') return;
      var category = error.category || 'other';
      if (!byCategory[category]) {
        byCategory[category] = { category: category, label: labels[category] || category, errors: [] };
        groups.push(byCategory[category]);
      }
      var start = error.transcript_offset_start;
      var end = error.transcript_offset_end;
      byCategory[category].errors.push({
        id: String(start) + '-' + String(end),
        original: String(error.original_text || ''),
        suggestion: String(error.suggestion || '(?)'),
        explanation: String(error.explanation_vn || ''),
      });
    });
    var total = typeof grammarCheck.total_count === 'number' ? grammarCheck.total_count : 0;
    var displayed = typeof grammarCheck.displayed_count === 'number'
      ? grammarCheck.displayed_count : grammarCheck.errors.length;
    return { groups: groups, moreCount: Math.max(0, total - displayed) };
  }

  function _nativeTranscriptSegments(transcript, grammarCheck) {
    var raw = String(transcript == null ? '' : transcript);
    if (!raw) return [];
    var errors = grammarCheck && Array.isArray(grammarCheck.errors)
      ? grammarCheck.errors : [];
    var spans = errors.filter(function (error) {
      return error
        && typeof error.transcript_offset_start === 'number'
        && typeof error.transcript_offset_end === 'number'
        && error.transcript_offset_end > error.transcript_offset_start
        && error.transcript_offset_start >= 0
        && error.transcript_offset_end <= raw.length;
    }).slice().sort(function (a, b) {
      return a.transcript_offset_start - b.transcript_offset_start;
    });
    if (!spans.length) return [{ type: 'text', text: raw }];
    var segments = [];
    var cursor = 0;
    spans.forEach(function (error) {
      if (error.transcript_offset_start < cursor) return;
      if (error.transcript_offset_start > cursor) {
        segments.push({ type: 'text', text: raw.substring(cursor, error.transcript_offset_start) });
      }
      var text = raw.substring(error.transcript_offset_start, error.transcript_offset_end);
      var suggestion = String(error.suggestion || '');
      var explanation = String(error.explanation_vn || '');
      segments.push({
        type: 'error',
        text: text,
        id: error.transcript_offset_start + '-' + error.transcript_offset_end,
        suggestion: suggestion,
        tooltip: (suggestion || '(?)') + (explanation ? ' • ' + explanation : ''),
      });
      cursor = error.transcript_offset_end;
    });
    if (cursor < raw.length) segments.push({ type: 'text', text: raw.substring(cursor) });
    return segments;
  }

  function _nativeGrammarIssueViews(issues, recommendations) {
    var recMap = {};
    (Array.isArray(recommendations) ? recommendations : []).forEach(function (rec) {
      if (rec && rec.issue) recMap[rec.issue] = rec;
    });
    return _nativeTextList(issues).map(function (issue) {
      var rec = recMap[issue];
      var href = rec ? _grammarRecHref(rec) : '';
      return {
        text: issue,
        recommendation: href ? {
          href: href,
          title: String(rec.title || rec.slug || ''),
          recId: rec.rec_id || null,
          slug: rec.slug || null,
        } : null,
      };
    });
  }

  function _nativePronunciationView(pronunciation, responseId) {
    if (!pronunciation || pronunciation.status !== 'completed'
        || _nativeFiniteNumber(pronunciation.pronunciation_score) == null) {
      return responseId ? {
        visible: true,
        status: 'unavailable',
        message: 'Chưa phân tích được phát âm cho câu này — có thể do sự cố kỹ thuật tạm thời, '
          + 'không hẳn do cách bạn nói. Nếu tình trạng lặp lại ở câu sau, thử ghi âm nơi yên tĩnh và nói rõ hơn.',
      } : { visible: false, status: 'hidden' };
    }
    var scoreDefs = [
      ['Tổng thể', pronunciation.pronunciation_score],
      ['Lưu loát', pronunciation.fluency_score],
      ['Chính xác', pronunciation.accuracy_score],
      ['Đầy đủ', pronunciation.completeness_score],
      ['Ngữ điệu', pronunciation.prosody_score],
    ];
    var weakWords = (Array.isArray(pronunciation.words) ? pronunciation.words : [])
      .filter(function (word) { return word && word.error_type && word.error_type !== 'None'; })
      .slice(0, 6)
      .map(function (word) {
        return {
          word: String(word.word || ''),
          phonemes: Array.isArray(word.phonemes) ? word.phonemes.map(function (phoneme) {
            return {
              symbol: String(phoneme && phoneme.symbol || ''),
              score: _nativeFiniteNumber(phoneme && phoneme.score),
            };
          }) : [],
        };
      });
    return {
      visible: true,
      status: 'completed',
      scores: scoreDefs.map(function (definition) {
        var value = _nativeFiniteNumber(definition[1]);
        return { label: definition[0], value: value == null ? null : Math.round(value) };
      }),
      summary: _nativeTextList(pronunciation.short_summary),
      weakWords: weakWords,
    };
  }

  function _nativeFeedbackDetails(data) {
    var payload = data || {};
    var grammar = _nativeGrammarGroups(payload.grammar_check);
    var kind = payload._stub ? 'stub'
      : payload.grammar_issues ? 'practice'
      : payload.fc_feedback ? 'formal'
      : 'empty';
    var sample = null;
    if (kind === 'practice') {
      sample = payload.sample_answer
        ? { title: 'Sample Answer', text: String(payload.sample_answer), unavailable: false }
        : payload.sample_answer_status
          ? { title: 'Sample Answer', text: '', unavailable: true }
          : null;
    } else if (kind === 'formal') {
      sample = payload.improved_response
        ? { title: 'Câu trả lời mẫu Band 7+', text: String(payload.improved_response), unavailable: false }
        : payload.improved_response_status
          ? { title: 'Sample Answer', text: '', unavailable: true }
          : null;
    }
    return {
      warnings: _nativeWarningViews(payload),
      reliability: _nativeReliabilityView(payload),
      kind: kind,
      stub: kind === 'stub' ? {
        aiUnavailable: !!(payload._error && String(payload._error).includes('temporarily unavailable')),
        error: String(payload._error || ''),
      } : null,
      criteria: kind === 'formal' ? [
        { title: 'Fluency & Coherence', text: String(payload.fc_feedback || '') },
        { title: 'Lexical Resource', text: String(payload.lr_feedback || '') },
        { title: 'Grammar & Accuracy', text: String(payload.gra_feedback || '') },
        { title: 'Pronunciation', text: String(payload.p_feedback || '') },
      ].filter(function (item) { return item.text; }) : [],
      strengths: _nativeTextList(payload.strengths),
      improvements: _nativeTextList(payload.improvements),
      grammarIssues: _nativeGrammarIssueViews(payload.grammar_issues, payload.grammar_recommendations),
      grammarGroups: grammar.groups,
      grammarMoreCount: grammar.moreCount,
      vocabularyIssues: _nativeTextList(payload.vocabulary_issues),
      corrections: (Array.isArray(payload.corrections) ? payload.corrections : [])
        .filter(function (item) { return item && typeof item === 'object'; })
        .map(function (item) {
          return {
            original: String(item.original || ''),
            corrected: String(item.corrected || ''),
            explanation: String(item.explanation || ''),
          };
        }),
      sample: sample,
    };
  }

  function _nativeGrammarResource(data) {
    var recommendations = data && Array.isArray(data.grammar_recommendations)
      ? data.grammar_recommendations : [];
    var match = null;
    if (recommendations.length) {
      var rec = recommendations[0];
      var meta = _grMeta(rec.slug)
        || { category: rec.category, title: rec.title || rec.slug, summary: '' };
      match = {
        slug: rec.slug,
        meta: meta,
        topField: 'gi',
        topic: rec.issue,
        anchor: rec.anchor || null,
        rec_id: rec.rec_id || null,
      };
    } else {
      var matched = _matchGrArticles(_grTexts(data), 1);
      if (matched.length) match = matched[0];
    }
    if (!match || !match.meta) return null;
    var href = _grammarRecHref({
      category: match.meta.category,
      slug: match.slug,
      anchor: match.anchor,
    });
    if (!href) return null;
    _GR_TRACKER.track([match]);
    return {
      href: href,
      title: String(match.meta.title || match.slug || ''),
      summary: String(match.meta.summary || ''),
      reason: _grReason(match.topField, match.topic),
      recId: match.rec_id || null,
      slug: match.slug || null,
    };
  }

  function _prepareNativeFeedbackAudio(data) {
    if (_feedbackAudioUrl) {
      if (_feedbackAudioIsBlob) {
        _revokeManagedObjectUrl('feedback-audio', _feedbackAudioUrl);
      }
      _feedbackAudioUrl = null;
    }
    if (data && data._reviewAudioUrl) {
      _feedbackAudioUrl = data._reviewAudioUrl;
      _feedbackAudioIsBlob = false;
      return true;
    }
    if (data && data._review) return false;
    if (_recordedBlob) {
      _feedbackAudioUrl = _createManagedObjectUrl('feedback-audio', _recordedBlob);
      _feedbackAudioIsBlob = true;
      return !!_feedbackAudioUrl;
    }
    return false;
  }

  function _showFeedbackNative(data) {
    if (!_getNativeView()) return false;
    var payload = data || {};
    var details = _nativeFeedbackDetails(payload);
    var overallNumber = _nativeFiniteNumber(payload.overall_band);
    var isLast = _currentIdx >= _questions.length - 1;
    var reviewingSheet = _sheetReviewIdx >= 0;
    var pronunciation = _nativePronunciationView(payload.pronunciation, _currentResponseId);
    var weakWords = pronunciation.status === 'completed' ? pronunciation.weakWords : [];
    window.__pronSessionId = _sessionId;
    window.__pronWeakWords = weakWords;
    var updated = _updateNativeView('feedback', Object.assign({}, details, {
      partialVisible: !!payload.partial,
      overallBand: overallNumber == null ? null : overallNumber.toFixed(1),
      bands: payload.band_fc != null ? [
        _nativeBandView('FC', payload.band_fc),
        _nativeBandView('LR', payload.band_lr),
        _nativeBandView('GRA', payload.band_gra),
        _nativeBandView('P', payload.band_p),
      ] : [],
      transcriptVisible: !!payload.transcript,
      transcriptSegments: _nativeTranscriptSegments(payload.transcript, payload.grammar_check),
      audioVisible: _prepareNativeFeedbackAudio(payload),
      grammarResource: _nativeGrammarResource(payload),
      pronunciation: pronunciation,
      backToSheetVisible: reviewingSheet,
      nextVisible: !reviewingSheet && !isLast,
      finishVisible: !reviewingSheet && isLast,
      finishLabel: isLast ? 'Xem kết quả toàn session →' : 'Hoàn thành phiên luyện',
    }));
    if (!updated) return false;
    showState('feedback');
    return true;
  }

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

    // On the App Router route React owns the complete feedback surface. Keep
    // the legacy DOM renderer below as the rollback path for practice.html.
    if (_showFeedbackNative(data)) return;

    // P0-2 — partial save (core row only, full metadata lost): show the feedback
    // but with a soft warning. Tolerant: data.partial is absent on old backends.
    _showPartialNote(!!(data && data.partial));

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
      // Sprint 14.7 — warning banners stack above EVERY feedback
      // branch so off-topic/short-length signals surface even when AI
      // grading itself was stubbed. _warningBannerBlock returns '' when
      // no warnings fire so this is a zero-cost prefix in the common
      // case.
      var warningsHtml = _warningBannerBlock(data);
      if (data && data._stub) {
        var isAiDown = data._error && data._error.includes('temporarily unavailable');
        // Sprint 14.6.1 — Andy 2026-05-22 — migrate hardcoded
        // rgba(255,255,255,X) text colors to --ds-* tokens so they
        // flip per theme (Sprint 14.1 wired the tokens; this branch
        // was outside that PR's source-set). Banner background colors
        // (amber-tinted #fbbf24-based rgba) stay literal — they're
        // semantic surfaces, not text.
        commentsEl.innerHTML = warningsHtml + (isAiDown
          ? '<div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);'
            + 'border-radius:10px;padding:12px 14px;">'
            + '<p style="font-size:13px;font-weight:600;color:#fbbf24;margin:0 0 4px;">AI chấm điểm tạm thời không khả dụng</p>'
            + '<p style="font-size:13px;color:var(--ds-muted);margin:0;">'
            + 'Bản ghi âm và văn bản của bạn đã được lưu thành công. '
            + 'Chấm điểm sẽ khả dụng khi dịch vụ AI được khôi phục.</p>'
            + '</div>'
          : '<p style="font-size:13px;font-style:italic;color:var(--ds-faint);">'
            + 'Câu trả lời đã được ghi lại nhưng chưa thể chấm điểm ngay lúc này.'
            + (data._error ? ' (' + _esc(data._error) + ')' : '')
            + '</p>');
      } else if (data && data.grammar_issues) {
        // ── Practice mode coaching feedback ──────────────────────────────────
        // Sprint 14.8 — _grammarCheckBlock(data.grammar_check) renders
        // the structured LanguageTool + VI-learner regex output next
        // to Claude's qualitative `_grammarIssuesBlock` text. Both
        // surfaces coexist; the LT block returns '' when no errors.
        commentsEl.innerHTML = warningsHtml +
          '<div id="score-confidence-note">' + _reliabilityNote(data) + '</div>' +
          _listBlock('Strengths', data.strengths, '#4ade80') +
          _grammarIssuesBlock(data.grammar_issues, data.grammar_recommendations) +
          _grammarCheckBlock(data.grammar_check) +
          _listBlock('Vocabulary Issues', data.vocabulary_issues, '#fb923c') +
          _correctionsBlock(data.corrections) +
          (data.sample_answer ? _sampleAnswerBlock(data.sample_answer) : (data.sample_answer_status ? _sampleUnavailableBlock() : ''));
      } else if (data && data.fc_feedback) {
        // ── Test mode formal IELTS feedback ──────────────────────────────────
        commentsEl.innerHTML = warningsHtml +
          '<div id="score-confidence-note">' + _reliabilityNote(data) + '</div>' +
          _criterionBlock('Fluency &amp; Coherence', data.fc_feedback)  +
          _criterionBlock('Lexical Resource',        data.lr_feedback)  +
          _criterionBlock('Grammar &amp; Accuracy',  data.gra_feedback) +
          _criterionBlock('Pronunciation',           data.p_feedback)   +
          _listBlock('Điểm mạnh',      data.strengths,    '#4ade80')    +
          _listBlock('Cần cải thiện',  data.improvements, '#fb923c')    +
          (data.improved_response ? _improvedBlock(data.improved_response) : (data.improved_response_status ? _sampleUnavailableBlock() : ''));
      } else {
        commentsEl.innerHTML =
          '<p style="font-size:13px;font-style:italic;color:var(--ds-faint);">Không có nhận xét.</p>';
      }
    }

    // ── Transcript ───────────────────────────────────────────────────────────
    // Sprint 14.8 — when grammar_check.errors is present we render the
    // transcript with wavy-underline highlights so the learner can
    // SEE the offending spans. Falls back to plain textContent (the
    // pre-14.8 path) when no errors fire or grammar_check is null —
    // preserves the L16 backward-compat contract for old payloads.
    var transcriptWrap = $('feedback-transcript');
    var transcriptText = $('feedback-transcript-text');
    if (transcriptWrap && transcriptText) {
      if (data && data.transcript) {
        var gc = data.grammar_check;
        var hasGrammarErrors = gc && Array.isArray(gc.errors) && gc.errors.length > 0;
        if (hasGrammarErrors) {
          transcriptText.innerHTML = _renderTranscriptWithHighlights(data.transcript, gc);
        } else {
          // textContent path stays the canonical "no highlight" branch
          // — safer than innerHTML for arbitrary transcript content.
          transcriptText.textContent = data.transcript;
        }
        transcriptWrap.style.display = '';
      } else {
        transcriptWrap.style.display = 'none';
      }
    }

    // ── Audio replay / download ──────────────────────────────────────────────
    // Revoke any URL from the previous question before creating a new one
    if (_feedbackAudioUrl) {
      // CHỈ thu hồi URL do mình tạo. Gọi revokeObjectURL lên một URL đã ký của
      // máy chủ là vô hại nhưng sai nghĩa; và nếu sau này URL ấy được dùng lại
      // thì đây là chỗ nó chết một cách khó hiểu.
      if (_feedbackAudioIsBlob) {
        _revokeManagedObjectUrl('feedback-audio', _feedbackAudioUrl);
      }
      _feedbackAudioUrl = null;
    }
    var audioSection = $('feedback-audio-section');
    if (audioSection) {
      // Xem lại một ô của PHIẾU thì phát audio CỦA CHÍNH Ô ẤY, không phải
      // `_recordedBlob` — biến ấy luôn giữ bản ghi GẦN NHẤT, nên ghi câu 1, ghi
      // câu 2, rồi xem lại câu 1 sẽ nghe ra câu 2 (codex #931). Có bản ghi thật
      // thì phát nó; không có thì ẩn hẳn chứ không phát nhầm.
      if (data && data._reviewAudioUrl) {
        _feedbackAudioUrl = data._reviewAudioUrl;   // URL đã ký, KHÔNG revoke
        _feedbackAudioIsBlob = false;
        audioSection.style.display = '';
      } else if (data && data._review) {
        audioSection.style.display = 'none';
      } else if (_recordedBlob) {
        _feedbackAudioUrl = _createManagedObjectUrl('feedback-audio', _recordedBlob);
        _feedbackAudioIsBlob = true;
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

    // ── Pronunciation: render from the grade response (server-side Azure) ────
    // Audit 2026-07-02 — pronunciation is now measured server-side DURING
    // grading and returned in data.pronunciation, so we render it directly
    // instead of firing a redundant second Azure call. When the server couldn't
    // assess it (status !== 'completed'), show an honest note — never a
    // fabricated score.
    var pronSection = $('pronunciation-section');
    var pronLoading = $('pron-loading-block');
    var pronResult  = $('pron-result-block');
    if (pronSection) {
      var pron = data && data.pronunciation;
      if (pronLoading) { pronLoading.style.display = 'none'; }
      if (pron && pron.status === 'completed' && pron.pronunciation_score != null) {
        _renderPronBlock(pronResult, pron);
        if (pronResult) { pronResult.style.display = ''; }
        pronSection.style.display = '';
      } else if (_currentResponseId) {
        if (pronResult) {
          pronResult.innerHTML =
            '<p style="font-size:12px;color:rgba(255,255,255,0.28);line-height:1.6;font-style:italic;">'
            + 'Chưa phân tích được phát âm cho câu này — có thể do sự cố kỹ thuật tạm thời, '
            + 'không hẳn do cách bạn nói. Nếu tình trạng lặp lại ở câu sau, thử ghi âm nơi yên tĩnh và nói rõ hơn.</p>';
          pronResult.style.display = '';
        }
        pronSection.style.display = '';
      } else {
        pronSection.style.display = 'none';
        if (pronResult) { pronResult.style.display = 'none'; }
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
    'articles':              { category: 'foundations',         title: 'Articles (a / an / the)',    summary: 'Dùng đúng mạo từ trong mọi ngữ cảnh' },
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

  function _grammarRecHref(rec) {
    if (!rec || !rec.slug || !rec.category) return '';
    return '/grammar/' + encodeURIComponent(rec.category)
      + '/' + encodeURIComponent(rec.slug)
      + (rec.anchor ? '#' + encodeURIComponent(rec.anchor) : '');
  }

  function _grammarRecTelemetryAttrs(rec) {
    if (!rec || !rec.rec_id) return '';
    return ' data-rec-id="' + _esc(rec.rec_id) + '"'
      + ' onclick="if(this.dataset.recId)window.api.patch(\'/api/grammar/recommendations/\'+this.dataset.recId+\'/clicked\',{}).catch(function(){})"';
  }

  // Card HTML: primary = full treatment with summary, secondary = compact muted
  function _grammarCardHtml(match, isPrimary) {
    var slug   = match.slug, meta = match.meta;
    var href   = _grammarRecHref({
      category: meta.category,
      slug: slug,
      anchor: match.anchor,
    });
    var telemetryAttrs = _grammarRecTelemetryAttrs(match);
    var reason = _grReason(match.topField, match.topic);

    if (isPrimary) {
      return '<a href="' + href + '" target="_blank" rel="noopener"' + telemetryAttrs
        + ' style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;'
        + 'background:rgba(20,184,166,0.07);border:1px solid rgba(20,184,166,0.28);'
        + 'border-left:3px solid #14b8a6;border-radius:14px;text-decoration:none;'
        + 'transition:background 0.15s;"'
        + ' onmouseover="this.style.background=\'rgba(20,184,166,0.12)\'"'
        + ' onmouseout="this.style.background=\'rgba(20,184,166,0.07)\'">'
        + '<div style="flex:1;min-width:0;">'
        + '<p style="font-size:13px;font-weight:600;color:var(--ds-text);margin:0 0 3px;'
        + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(meta.title) + '</p>'
        + '<p style="font-size:12px;color:var(--ds-muted);margin:0 0 6px;line-height:1.4;">'
        + _esc(meta.summary) + '</p>'
        + '<p style="font-size:11px;color:rgba(20,184,166,0.7);margin:0;">' + _esc(reason) + '</p>'
        + '</div>'
        + '<span style="flex-shrink:0;font-size:11px;font-weight:700;color:#14b8a6;'
        + 'background:rgba(20,184,166,0.14);border-radius:8px;padding:5px 10px;'
        + 'white-space:nowrap;align-self:center;">Học ngay →</span>'
        + '</a>';
    }
    return '<a href="' + href + '" target="_blank" rel="noopener"' + telemetryAttrs
      + ' style="display:flex;align-items:center;gap:10px;padding:10px 14px;'
      + 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);'
      + 'border-radius:12px;text-decoration:none;transition:border-color 0.15s,background 0.15s;"'
      + ' onmouseover="this.style.borderColor=\'rgba(20,184,166,0.25)\';this.style.background=\'rgba(20,184,166,0.05)\'"'
      + ' onmouseout="this.style.borderColor=\'rgba(255,255,255,0.07)\';this.style.background=\'rgba(255,255,255,0.02)\'">'
      + '<div style="flex:1;min-width:0;">'
      + '<p style="font-size:12px;font-weight:600;color:var(--ds-text);margin:0 0 2px;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(meta.title) + '</p>'
      + '<p style="font-size:11px;color:var(--ds-faint);margin:0;">' + _esc(reason) + '</p>'
      + '</div>'
      + '<span style="flex-shrink:0;font-size:11px;color:var(--ds-faint);">→</span>'
      + '</a>';
  }

  // Practice: show 1 Quick Grammar Tip (top match only, primary styling)
  function _showGrammarResources(data) {
    var wrap  = $('grammar-resources');
    var cards = $('grammar-resources-cards');
    if (!wrap || !cards) return;

    // Primary path: use backend grammar_recommendations when available
    var recs = Array.isArray(data.grammar_recommendations) ? data.grammar_recommendations : [];
    if (recs.length) {
      var rec  = recs[0];
      var meta = _grMeta(rec.slug) || { category: rec.category, title: rec.title, summary: '' };
      var match = { slug: rec.slug, meta: meta, topField: 'gi', topic: rec.issue, anchor: rec.anchor || null, rec_id: rec.rec_id || null };
      _GR_TRACKER.track([match]);
      cards.innerHTML = _grammarCardHtml(match, true);
      wrap.style.display = '';
      return;
    }

    // Fallback: keyword matching via _GR_KW (test mode / no recs)
    var texts   = _grTexts(data);
    var matched = _matchGrArticles(texts, 1);
    if (!matched.length) { wrap.style.display = 'none'; return; }
    _GR_TRACKER.track(matched);
    cards.innerHTML = _grammarCardHtml(matched[0], true);
    wrap.style.display = '';
  }

  function _trackGrammarResource(recId, slug) {
    if (slug) _GR_TRACKER.markViewed(slug);
    if (!recId || !window.api || typeof window.api.patch !== 'function') return;
    window.api.patch(
      '/api/grammar/recommendations/' + encodeURIComponent(recId) + '/clicked',
      {},
    ).catch(function () { /* recommendation telemetry is best-effort */ });
  }

  // ── Audio replay / download (practice feedback screen) ───────────────────────

  function _replayAudio() {
    if (!_feedbackAudioUrl) return;
    if (_feedbackReplayAudio) {
      try { _feedbackReplayAudio.pause(); } catch (_) {}
      _feedbackReplayAudio = null;
    }
    var audio = new Audio(_feedbackAudioUrl);
    _feedbackReplayAudio = audio;
    audio.onended = function () {
      if (_feedbackReplayAudio === audio) _feedbackReplayAudio = null;
    };
    audio.onerror = function () {
      if (_feedbackReplayAudio === audio) _feedbackReplayAudio = null;
    };
    audio.play().catch(function (e) {
      if (_feedbackReplayAudio === audio) _feedbackReplayAudio = null;
      console.warn('[audio] replay failed:', e);
    });
  }

  function _downloadAudio() {
    if (!_feedbackAudioUrl) return;
    // Ở lượt XEM LẠI, `_feedbackAudioUrl` là URL đã ký và `_recordedBlob` là
    // null (tải lại trang xong thì bản ghi trong bộ nhớ không còn) — đọc
    // `_recordedBlob.type` ở đây là nổ ngay khi bấm Tải (codex #931). Đuôi tệp
    // suy từ chính URL, không cần bản ghi cục bộ.
    var ext = 'webm';
    if (_feedbackAudioIsBlob) {
      if (!_recordedBlob) return;
      ext = (_recordedBlob.type || 'audio/webm').split('/')[1].split(';')[0] || 'webm';
    } else {
      var m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(String(_feedbackAudioUrl));
      if (m) ext = m[1].toLowerCase();
    }
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
    // Audit 2026-07-02 — a null/NaN band (e.g. P when Azure pronunciation
    // hasn't been assessed) must render an HONEST placeholder ("—", tooltip
    // "chưa đánh giá"), never "NaN" and never a fabricated number.
    var num = parseFloat(value);
    var display = isFinite(num)
      ? (Math.round(num * 2) / 2).toFixed(1)
      : '—';
    var titleAttr = isFinite(num) ? '' : ' title="Chưa đánh giá phát âm"';
    return '<div data-criterion="' + label + '"' + titleAttr + ' style="display:inline-flex;flex-direction:column;align-items:center;'
      + 'border-radius:10px;padding:6px 14px;margin:0 3px;" class="ds-band-pill ds-band-pill-' + cls + '">'
      + '<span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;'
      + 'margin-bottom:2px;opacity:0.6;">' + label + '</span>'
      + '<span style="font-size:20px;font-weight:700;">'
      + display + '</span></div>';
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

    // Sprint 14.6.1 — migrate body-text rgba(255,255,255,X) → --ds-* tokens
    // so the reliability note reads on both themes. Background + border
    // colours come in via the bg/bd/borderColor args (semantic by reliability
    // level) and stay literal — they're tinted surface, not text.
    return '<div style="background:' + bgColor + ';border:1px solid ' + bdColor + ';'
      + 'border-left:3px solid ' + borderColor + ';border-radius:10px;'
      + 'padding:11px 14px;margin-bottom:14px;'
      + 'font-size:12.5px;line-height:1.6;color:var(--ds-muted);">'
      + msg
      + '</div>';
  }

  function _criterionBlock(title, text) {
    if (!text) return '';
    return '<div style="margin-bottom:14px;">' +
      '<p style="font-size:11px;font-weight:700;color:#14b8a6;text-transform:uppercase;' +
      'letter-spacing:.06em;margin:0 0 5px;">' + title + '</p>' +
      '<p style="font-size:13px;line-height:1.65;color:var(--ds-text);margin:0;">' +
      _esc(text) + '</p></div>';
  }

  /**
   * Sprint 14.8 — grammar check block (structured errors from
   * services.grammar_check; LanguageTool + VI-learner regex asset).
   *
   * Distinct from Sprint 14.5's `_grammarIssuesBlock(issues, recs)`
   * which renders Claude's qualitative coaching text — both surfaces
   * coexist in the practice-mode panel.
   *
   * Renders errors grouped by category (L5) with the original-text →
   * suggestion pair + the VN explanation. Bidirectional linking
   * (Pattern #32): each <li> carries data-error-id matching the
   * transcript highlight's data-error-id so clicking the highlight
   * scrolls here and flashes the entry.
   *
   * Pattern #26 (L14) — pure CSS-class styling; no inline colour or
   * background literals so the light-theme flip works on first load.
   */
  function _grammarCheckBlock(gc) {
    if (!gc || !Array.isArray(gc.errors) || gc.errors.length === 0) {
      return '';
    }
    // Group by category — insertion order is preserved across the
    // priority sort the backend already applied, so the high-severity
    // groups land on top of the panel naturally.
    var groups = {};
    var order  = [];
    for (var i = 0; i < gc.errors.length; i++) {
      var e = gc.errors[i];
      var cat = e.category || 'other';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(e);
    }

    var labels = {
      tense:                  'Thì động từ',
      article:                'Mạo từ',
      preposition:            'Giới từ',
      missing_subject:        'Thiếu chủ ngữ',
      subject_verb_agreement: 'Sự hòa hợp chủ - động',
      verb_form:              'Dạng động từ',
      copula:                 'Động từ to be',
      vocabulary:             'Từ vựng',
      punctuation:            'Dấu câu',
      spelling:               'Chính tả',
      style:                  'Văn phong',
      grammar:                'Ngữ pháp',
      other:                  'Khác',
    };

    var groupsHtml = order.map(function (cat) {
      var items = groups[cat].map(function (e) {
        var id  = e.transcript_offset_start + '-' + e.transcript_offset_end;
        var pair = '<div class="ds-grammar-error-pair">' +
          '<span class="ds-grammar-error-original">' + _esc(e.original_text || '') + '</span>' +
          '<span class="ds-grammar-error-arrow" aria-hidden="true">→</span>' +
          '<span class="ds-grammar-error-suggestion">' + _esc(e.suggestion || '(?)') + '</span>' +
        '</div>';
        var exp = e.explanation_vn
          ? '<p class="ds-grammar-error-explanation">' + _esc(e.explanation_vn) + '</p>'
          : '';
        return '<li class="ds-grammar-error-item" data-error-id="' + _esc(id) + '">' +
          pair + exp + '</li>';
      }).join('');
      return '<div class="ds-grammar-category">' +
        '<p class="ds-grammar-category-title">' + _esc(labels[cat] || cat) + '</p>' +
        '<ul class="ds-grammar-error-list">' + items + '</ul>' +
        '</div>';
    }).join('');

    var more = '';
    if (typeof gc.total_count === 'number' &&
        typeof gc.displayed_count === 'number' &&
        gc.total_count > gc.displayed_count) {
      more = '<p class="ds-grammar-more-info">+' +
        (gc.total_count - gc.displayed_count) +
        ' lỗi khác đã được phát hiện.</p>';
    }

    return '<div class="ds-grammar-section">' +
      '<p class="ds-grammar-section-head">Grammar Issues (LanguageTool)</p>' +
      groupsHtml + more +
      '</div>';
  }

  /**
   * Sprint 14.8 — transcript with positional grammar highlights.
   *
   * Each error span is wrapped in a <mark class="ds-grammar-highlight">
   * carrying data-error-id (matching the inline list entry's id) and
   * data-tooltip (suggestion + VN explanation). The tooltip + the
   * flash animation live in ds.css; the click handler down below
   * wires the bidirectional jump (Pattern #32).
   *
   * Returns plain-escaped HTML when no errors fire so old / cached
   * results render identically to pre-14.8 (L16 backward compat).
   *
   * @param {string} transcript
   * @param {object|null} grammarCheck
   * @returns {string} innerHTML for the transcript surface
   */
  function _renderTranscriptWithHighlights(transcript, grammarCheck) {
    var raw = String(transcript == null ? '' : transcript);
    if (!grammarCheck || !Array.isArray(grammarCheck.errors) || grammarCheck.errors.length === 0) {
      return _esc(raw);
    }
    // Sort by offset asc; drop malformed/overlapping spans defensively.
    var spans = grammarCheck.errors
      .filter(function (e) {
        return typeof e.transcript_offset_start === 'number' &&
               typeof e.transcript_offset_end   === 'number' &&
               e.transcript_offset_end > e.transcript_offset_start &&
               e.transcript_offset_start >= 0 &&
               e.transcript_offset_end   <= raw.length;
      })
      .slice()
      .sort(function (a, b) {
        return a.transcript_offset_start - b.transcript_offset_start;
      });

    var out    = '';
    var cursor = 0;
    for (var i = 0; i < spans.length; i++) {
      var e = spans[i];
      if (e.transcript_offset_start < cursor) {
        // Overlapping span — skip to keep offsets sane.
        continue;
      }
      if (e.transcript_offset_start > cursor) {
        out += _esc(raw.substring(cursor, e.transcript_offset_start));
      }
      var errText = raw.substring(e.transcript_offset_start, e.transcript_offset_end);
      var id      = e.transcript_offset_start + '-' + e.transcript_offset_end;
      var tip     = (e.suggestion || '(?)') +
        (e.explanation_vn ? ' • ' + e.explanation_vn : '');
      out += '<mark class="ds-grammar-highlight"' +
        ' data-error-id="' + _esc(id) + '"' +
        ' data-tooltip="'  + _esc(tip) + '"' +
        ' tabindex="0"' +
        ' role="button"' +
        ' aria-label="Lỗi ngữ pháp: ' + _esc(errText) +
        ' — gợi ý: ' + _esc(e.suggestion || '') + '">' +
        _esc(errText) +
        '</mark>';
      cursor = e.transcript_offset_end;
    }
    if (cursor < raw.length) {
      out += _esc(raw.substring(cursor));
    }
    return out;
  }

  /**
   * Sprint 14.7 — warning banner block.
   *
   * Renders off-topic + length warnings as stacked yellow banners
   * above the per-criterion feedback (L5/L9). Pattern #26 (Sprint
   * 14.6.1 lesson): use CSS classes only, NO inline color/background
   * styles — else light-theme flip breaks.
   *
   * Banner colours + contrast live in ds.css under .ds-warning-banner
   * (--ds-warning-bg/border/text tokens). The light-theme flip is
   * driven by [data-theme="light"] aliasing those tokens to amber-100/
   * 800/700 (WCAG AA verified).
   *
   * @param {object} data — the grading endpoint response payload.
   * @returns {string} HTML for the banner block, or '' when no warnings fire.
   */
  function _warningBannerBlock(data) {
    if (!data) return '';
    var warnings = [];

    // L3 — off_topic_verdict is {is_on_topic, reasoning} or null
    // (judge silent-skipped per L11/L13). Only render when the judge
    // produced a verdict AND it flagged off-topic.
    if (data.off_topic_verdict &&
        data.off_topic_verdict.is_on_topic === false) {
      var reasoning = data.off_topic_verdict.reasoning || '';
      warnings.push({
        icon: '⚠️',
        // audit #3.3 — say the band was CAPPED so a low hero band isn't
        // misread as weak ability. Cap fires under this same off-topic
        // condition (grading.py _apply_off_topic_penalty).
        message: 'Cảnh báo: Câu trả lời có thể chưa bám sát đề, nên band cho câu này đã bị giới hạn ' +
                 '(không phản ánh năng lực thật của bạn).' +
                 (reasoning ? ' Lý do: ' + reasoning : ''),
      });
    }

    // L7 — length_warning fires when duration is above the Sprint 14.2
    // hard reject but below the 2× soft threshold. Frontend shows the
    // numbers so the user knows exactly how short the response was.
    if (data.length_warning === true) {
      var dur = (typeof data.audio_duration_seconds === 'number')
        ? data.audio_duration_seconds.toFixed(1) : '?';
      var thr = (typeof data.length_soft_threshold === 'number')
        ? Math.round(data.length_soft_threshold) : '?';
      warnings.push({
        icon: '⏱️',
        message: 'Cảnh báo: Câu trả lời chỉ ' + dur + 's, ngắn hơn ngưỡng ' +
                 'tham khảo ' + thr + 's. Có thể giới hạn band tối đa.',
      });
    }

    if (warnings.length === 0) return '';

    var html = warnings.map(function (w) {
      return '<div class="ds-warning-banner" role="alert" ' +
             'aria-label="Cảnh báo kết quả">' +
        '<span class="ds-warning-icon" aria-hidden="true">' + w.icon + '</span>' +
        '<p class="ds-warning-message">' + _esc(w.message) + '</p>' +
        '</div>';
    }).join('');
    return '<div class="ds-result-warnings">' + html + '</div>';
  }

  function _listBlock(title, items, color) {
    if (!items || !items.length) return '';
    var lis = items.map(function (item) {
      // Sprint 14.6.1 — bullet text uses --ds-text so it flips per theme.
      // The leading `›` glyph keeps its semantic colour (the `color` arg —
      // mint for strengths, orange for vocab issues) which already reads
      // on both themes.
      return '<li style="font-size:13px;color:var(--ds-text);margin-bottom:5px;">' +
        '<span style="color:' + color + ';margin-right:6px;">›</span>' + _esc(item) + '</li>';
    }).join('');
    return '<div style="margin-bottom:14px;">' +
      '<p style="font-size:11px;font-weight:700;color:' + color + ';text-transform:uppercase;' +
      'letter-spacing:.06em;margin:0 0 6px;">' + title + '</p>' +
      '<ul style="list-style:none;padding:0;margin:0;">' + lis + '</ul></div>';
  }

  function _grammarIssuesBlock(issues, recs) {
    if (!issues || !issues.length) return '';
    var recMap = {};
    (recs || []).forEach(function (r) { if (r.issue) recMap[r.issue] = r; });
    var lis = issues.map(function (issue) {
      var rec = recMap[issue];
      var link = '';
      if (rec && rec.slug && rec.category) {
        var recHref = _grammarRecHref(rec);
        var recClick = _grammarRecTelemetryAttrs(rec);
        link = ' <a href="' + recHref + '" target="_blank" rel="noopener"' + recClick
          + ' style="font-size:11px;color:#14b8a6;text-decoration:none;white-space:nowrap;">'
          + '→ Học bài: ' + _esc(rec.title) + '</a>';
      }
      // Sprint 14.6.1 — bullet text uses --ds-text (theme-flipping); the
      // `›` glyph keeps its semantic red (#f87171) which is readable on
      // both surfaces.
      return '<li style="font-size:13px;color:var(--ds-text);margin-bottom:5px;">' +
        '<span style="color:#f87171;margin-right:6px;">›</span>' + _esc(issue) + link + '</li>';
    }).join('');
    return '<div style="margin-bottom:14px;">' +
      '<p style="font-size:11px;font-weight:700;color:#f87171;text-transform:uppercase;' +
      'letter-spacing:.06em;margin:0 0 6px;">Grammar Issues</p>' +
      '<ul style="list-style:none;padding:0;margin:0;">' + lis + '</ul></div>';
  }

  function _improvedBlock(text) {
    return '<div style="margin-top:16px;background:rgba(20,184,166,0.08);' +
      'border-left:3px solid #14b8a6;border-radius:0 6px 6px 0;padding:12px 14px;">' +
      '<p style="font-size:11px;font-weight:700;color:#14b8a6;text-transform:uppercase;' +
      'letter-spacing:.06em;margin:0 0 7px;">Câu trả lời mẫu Band 7+</p>' +
      '<p style="font-size:13px;line-height:1.7;color:var(--ds-text);margin:0;">' +
      _esc(text) + '</p></div>';
  }

  function _correctionsBlock(corrections) {
    if (!corrections || corrections.length === 0) return '';
    // Sprint 14.6.1 — row background + italic explanation use --ds-*
    // tokens (Sprint 14.1 wired the light-theme overrides). The
    // red ❌ + green ✓ lines stay literal — they're semantic colours
    // that read on both themes (and matched Andy's 2026-05-22 screenshot
    // observation that corrections was the only readable section).
    var rows = corrections.map(function (c) {
      return '<div style="margin-bottom:10px;padding:10px 12px;background:var(--ds-surface);border-radius:8px;">'
        + '<div style="font-size:12px;color:#f87171;margin-bottom:3px;">'
        + '<span style="opacity:0.6;">❌ </span>' + _esc(c.original) + '</div>'
        + '<div style="font-size:12px;color:#4ade80;margin-bottom:4px;">'
        + '<span style="opacity:0.6;">✓ </span>' + _esc(c.corrected) + '</div>'
        + '<div style="font-size:12px;color:var(--ds-muted);font-style:italic;">'
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
      + '<p style="font-size:13px;line-height:1.7;color:var(--ds-text);margin:0;">'
      + _esc(text) + '</p></div>';
  }

  // Mục 21 — the grader drops the sample/improved answer when it can't ground a
  // version in what the candidate said (or regeneration timed out). Explain WHY
  // instead of showing nothing. NEUTRAL wording (PR #594 review): the status is
  // "low relevance of the GENERATED answer", which is NOT the same as the learner
  // being off-topic — so don't blame their answer.
  function _sampleUnavailableBlock() {
    return '<div style="margin-top:16px;background:rgba(148,163,184,0.10);'
      + 'border-left:3px solid #94a3b8;border-radius:0 6px 6px 0;padding:12px 14px;">'
      + '<p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;'
      + 'letter-spacing:.06em;margin:0 0 7px;">Sample Answer</p>'
      + '<p style="font-size:13px;line-height:1.7;color:var(--ds-text-secondary,#94a3b8);margin:0;">'
      + 'Chưa tạo được mẫu câu trả lời phù hợp cho phần này. '
      + 'Bạn có thể thử lại để nhận mẫu sát với câu trả lời của mình hơn.</p></div>';
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

  // Re-pick if voices load asynchronously (common on Chrome). The listener is
  // bound from init through the Next-owned effect registry so soft navigation
  // cannot leave an old player callback installed.
  function _handleVoicesChanged() { _ttsVoice = null; }

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
    _cancelSpeech();
    if (!text || !text.trim()) return;
    window.speechSynthesis.speak(_makeUtterance(text));
  }

  // Speak an ordered array of segments with a natural pause between each.
  // pauseMs — gap in milliseconds between segments (default 600 ms).
  function _ttsSequence(segments, pauseMs) {
    if (!window.speechSynthesis) return;
    _cancelSpeech();
    var sequenceGeneration = _browserTtsGeneration;
    if (!segments || segments.length === 0) return;
    pauseMs = pauseMs || 600;

    var filtered = segments.filter(function (s) { return s && s.trim(); });
    if (filtered.length === 0) return;

    var idx = 0;
    function speakNext() {
      if (!_playerActive || sequenceGeneration !== _browserTtsGeneration || idx >= filtered.length) return;
      var utt = _makeUtterance(filtered[idx]);
      idx++;
      if (idx < filtered.length) {
        utt.onend = function () {
          _startManagedTimeout('tts-browser-sequence-delay', speakNext, pauseMs);
        };
      }
      window.speechSynthesis.speak(utt);
    }
    speakNext();
  }

  // ── AI TTS (OpenAI nova voice, falls back to browser TTS) ────────────────────

  var _ttsAudio      = null;   // current HTMLAudioElement for AI TTS playback
  var _ttsAudioUrlKey = null;
  var _ttsAudioUrl    = null;
  var _ttsGeneration = 0;      // incremented on every _ttsAI() call; stale fetches abort
  var _browserTtsGeneration = 0;

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
  function _markInteracted() { _userHasInteracted = true; }

  // Stop playback before revoking the owned blob URL. Removing `src` first
  // detaches the media element, so a soft navigation cannot leave either a
  // decoder or an object URL alive after the Next bridge is destroyed.
  function _stopAITts() {
    if (_ttsAudio) {
      _ttsAudio.onended = null;   // prevent ghost callbacks after stop
      _ttsAudio.onerror = null;
      _ttsAudio.pause();
      try { _ttsAudio.removeAttribute('src'); } catch (_) {}
      _ttsAudio = null;
    }
    if (_ttsAudioUrlKey) {
      _revokeManagedObjectUrl(_ttsAudioUrlKey, _ttsAudioUrl);
      _ttsAudioUrlKey = null;
      _ttsAudioUrl = null;
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
    if (!_playerActive || gen !== _ttsGeneration || !blob) return;
    var urlKey = 'tts-single-' + gen;
    var url = _createManagedObjectUrl(urlKey, blob);
    if (!url) return;
    var audio = new Audio(url);
    _ttsAudio = audio;
    _ttsAudioUrlKey = urlKey;
    _ttsAudioUrl = url;
    audio.onended = function () {
      _revokeManagedObjectUrl(urlKey, url);
      _ttsAudioUrlKey = null;
      _ttsAudioUrl = null;
      _ttsAudio = null;
    };
    audio.onerror = function () {
      _revokeManagedObjectUrl(urlKey, url);
      _ttsAudioUrlKey = null;
      _ttsAudioUrl = null;
      _ttsAudio = null;
    };
    audio.play().catch(function (err) {
      if (
        !_playerActive
        || gen !== _ttsGeneration
        || _ttsAudio !== audio
        || _ttsAudioUrlKey !== urlKey
        || _ttsAudioUrl !== url
      ) return;
      _stopAITts();
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
    _cancelSpeech();

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
        if (!_playerActive || gen !== _ttsGeneration) return;
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
    _cancelSpeech();

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
      if (usedFallback || !_playerActive || gen !== _ttsGeneration) return;
      usedFallback = true;
      _ttsSequence(filtered.slice(fromIdx), pauseMs);
    }

    function playNext() {
      if (usedFallback || !_playerActive || gen !== _ttsGeneration || idx >= filtered.length) return;
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
          var urlKey = 'tts-sequence-' + gen;
          var url = _createManagedObjectUrl(urlKey, blob);
          if (!url) return;
          var audio = new Audio(url);
          _ttsAudio = audio;
          _ttsAudioUrlKey = urlKey;
          _ttsAudioUrl = url;

          audio.onended = function () {
            _revokeManagedObjectUrl(urlKey, url);
            _ttsAudioUrlKey = null;
            _ttsAudioUrl = null;
            _ttsAudio = null;
            if (!usedFallback && gen === _ttsGeneration && idx < filtered.length) {
              _startManagedTimeout('tts-ai-sequence-delay', playNext, pauseMs);
            }
          };
          audio.onerror = function () {
            _revokeManagedObjectUrl(urlKey, url);
            _ttsAudioUrlKey = null;
            _ttsAudioUrl = null;
            _ttsAudio = null;
            _fallback(idx);   // continue remaining from next segment via browser TTS
          };
          console.debug('[tts] sequence playing gen=%d seg=%d', gen, segIdx);
          audio.play().catch(function (err) {
            if (
              usedFallback
              || !_playerActive
              || gen !== _ttsGeneration
              || _ttsAudio !== audio
              || _ttsAudioUrlKey !== urlKey
              || _ttsAudioUrl !== url
            ) return;
            _stopAITts();
            console.warn('[tts] sequence play() rejected, falling back:', err);
            _fallback(segIdx);   // retry this segment and rest via browser TTS
          });
        })
        .catch(function (err) {
          if (!_playerActive || gen !== _ttsGeneration) return;
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
    var instruction = isListening
      ? 'Nghe câu hỏi rồi nhấn ghi âm. Nhấn ↺ để nghe lại.'
      : 'Đọc câu hỏi kỹ, sau đó nhấn nút để bắt đầu ghi âm.';
    if (_updateNativeView('prep', {
      modeToggleVisible: false,
      listeningBarVisible: isListening,
      qCardOpacity: isListening ? 0.35 : 1,
      instruction: instruction,
      playLabel: 'Nghe câu hỏi',
      playIsReplay: false,
    })) return;

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
      inst.textContent = instruction;
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
      _cancelSpeech();
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
    if (!_updateNativeView('prep', { playLabel: 'Phát lại', playIsReplay: true })) {
      var btn = $('prep-play-btn');
      if (btn) btn.textContent = '↺ Phát lại';
    }
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
      _cancelSpeech();
    }
    _applyQModeUI();
    _showPrep();   // _showPrep() auto-plays TTS when _qMode === 'listening'
  }

  // ── END Question mode ─────────────────────────────────────────────────────────

  function _showP2Cue() {
    _clearP2SubmissionRetry();
    var q = _currentQ;
    var topic = _sessionData ? (_sessionData.topic || '') : '';
    var question = q.question_text || '';
    var bullets = q.cue_card_bullets && q.cue_card_bullets.length
      ? q.cue_card_bullets.slice()
      : [];
    var reflection = q.cue_card_reflection || '';
    if (!_updateNativeView('part2', {
      topic: topic,
      question: question,
      bullets: bullets,
      reflection: reflection,
    })) {
      var topicEl = $('p2a-topic');
      if (topicEl) topicEl.textContent = topic;

      var qEl = $('p2a-question');
      if (qEl) qEl.textContent = question;

      var bulletsEl = $('p2a-bullets');
      if (bulletsEl) {
        bulletsEl.innerHTML = bullets.map(function (b) {
          return '<div class="ds-cue-bullet">' + _esc(b) + '</div>';
        }).join('');
      }

      var reflEl = $('p2a-reflection');
      if (reflEl) reflEl.textContent = reflection;
    }

    showState('p2a');
  }

  var _p2RetryPlaybackUrl = null;
  var _p2RetryQuestionId = null;
  var _p2NotesRevision = 0;

  function _clearP2SubmissionRetry() {
    var audio = $('p2a-submit-retry-audio');
    if (audio) {
      try { audio.pause(); } catch (e) {}
      audio.removeAttribute('src');
    }
    if (_p2RetryPlaybackUrl) {
      _revokeManagedObjectUrl('p2-retry-playback', _p2RetryPlaybackUrl);
      _p2RetryPlaybackUrl = null;
    }
    _p2RetryQuestionId = null;
    if (_updateNativeView('part2', {
      retryVisible: false,
      retryMessage: '',
      retryPlaybackUrl: '',
      startVisible: true,
    })) return;
    var wrap = $('p2a-submit-retry');
    var start = $('p2a-start-btn');
    if (wrap) wrap.style.display = 'none';
    if (start) start.style.display = '';
  }

  function _showP2SubmissionRetry(message) {
    // Render the canonical cue first, then replace its start action with the
    // preserved-take recovery actions.
    _showP2Cue();
    _p2RetryQuestionId = _currentQ && (_currentQ.id || _currentQ.question_id);
    var audio = $('p2a-submit-retry-audio');
    if (_recordedBlob) {
      _p2RetryPlaybackUrl = _createManagedObjectUrl('p2-retry-playback', _recordedBlob);
    }
    if (!_updateNativeView('part2', {
      retryVisible: true,
      retryMessage: message,
      retryPlaybackUrl: _p2RetryPlaybackUrl || '',
      startVisible: false,
    })) {
      var wrap = $('p2a-submit-retry');
      var msg = $('p2a-submit-retry-msg');
      var start = $('p2a-start-btn');
      if (msg) msg.textContent = message;
      if (start) start.style.display = 'none';
      if (wrap) wrap.style.display = '';
      if (audio && _p2RetryPlaybackUrl) audio.src = _p2RetryPlaybackUrl;
    }
    showState('p2a');
  }

  function retryP2Submission() {
    if (!_recordedBlob || !_p2RetryQuestionId) {
      discardP2SubmissionRetry();
      showError('Không còn bản ghi để gửi lại. Hãy ghi âm lại câu trả lời.');
      return;
    }
    _startProcessing(_recordedBlob, _p2RetryQuestionId);
  }

  function discardP2SubmissionRetry() {
    _clearP2SubmissionRetry();
    _resetRecorder();
    _showP2Cue();
  }
  function startP2Prep() {
    _clearP2SubmissionRetry();
    _stopAITts();
    _cancelSpeech();

    var question = _currentQ ? (_currentQ.question_text || '') : '';
    _p2NotesRevision++;
    if (!_updateNativeView('part2', {
      prepQuestion: question,
      notesRevision: _p2NotesRevision,
    })) {
      var qEl = $('p2b-question');
      if (qEl) qEl.textContent = question;
      var notes = $('p2b-notes');
      if (notes) notes.value = '';
    }

    _p2PrepSecsLeft = P2_PREP_SEC;
    _renderP2PrepTimer();
    showState('p2b');

    if (_p2PrepTimerId) {
      _clearManagedEffect('p2-prep-countdown', _p2PrepTimerId, 'interval');
    }
    var nativePlayer = _getNativePlayer();
    if (nativePlayer) {
      _p2PrepTimerId = _startManagedCountdown('p2-prep-countdown', {
        seconds: P2_PREP_SEC,
        onTick: function (remaining) {
          _p2PrepSecsLeft = remaining;
          _renderP2PrepTimer();
        },
        onDone: function () {
          _p2PrepTimerId = null;
          _startP2Speaking();
        },
      });
    } else {
      _p2PrepTimerId = _startManagedInterval('p2-prep-countdown', function () {
        _p2PrepSecsLeft--;
        _renderP2PrepTimer();
        if (_p2PrepSecsLeft <= 0) {
          _clearManagedEffect('p2-prep-countdown', _p2PrepTimerId, 'interval');
          _p2PrepTimerId = null;
          _startP2Speaking();
        }
      }, 1000);
    }
  }

  function _renderP2PrepTimer() {
    var m = Math.floor(_p2PrepSecsLeft / 60);
    var s = _p2PrepSecsLeft % 60;
    var timerText = m + ':' + (s < 10 ? '0' + s : s);
    if (_updateNativeView('part2', {
      prepTimer: timerText,
      prepUrgent: _p2PrepSecsLeft <= 10,
    })) return;
    var el = $('p2b-timer');
    if (!el) return;
    el.textContent = timerText;
    el.style.color = _p2PrepSecsLeft <= 10 ? '#ef4444' : '#f97316';
  }

  function startP2SpeakingEarly() {
    if (_p2PrepTimerId) {
      _clearManagedEffect('p2-prep-countdown', _p2PrepTimerId, 'interval');
      _p2PrepTimerId = null;
    }
    _startP2Speaking();
  }

  function _handleP2RecordedBlob(blob) {
    _recordedBlob = blob;
    _stopWaveform();
    var questionId = _currentQ && (_currentQ.id || _currentQ.question_id);

    // Test modes: advance immediately (no grading spinner)
    if (_testMode === 'test_full') {
      // Eager upload — fire and forget; backend finalize handles aggregation
      _submitGradingEager(_sessionId, questionId, _recordedBlob);
      _advanceTestMode();
      return;
    }

    _startProcessing(_recordedBlob, questionId);
  }

  async function _startP2Speaking() {
    var generation = _playerGeneration;
    // Part 2 has its own recorder entry point, so clear any previous take even
    // when the native controller owns the device lifecycle.
    _audioChunks = [];
    _recordedBlob = null;
    _elapsedSecs = 0;
    var nativeRecorder = _getNativeRecorder();
    if (nativeRecorder) {
      try {
        var started = await nativeRecorder.start({
          // Part 2 owns its 120-second countdown + "Thank you" delay below.
          maxSeconds: 0,
          onRecorded: _handleP2RecordedBlob,
        });
        if (!_playerActive || generation !== _playerGeneration) {
          nativeRecorder.reset();
          return;
        }
        if (!started) {
          // A concurrent start is still in charge and should stay silent. Any
          // settled false result otherwise needs a visible recovery path.
          if (!nativeRecorder.isStarting()) {
            showError('Không thể bắt đầu ghi âm. Hãy kiểm tra microphone rồi thử lại.');
          }
          return;
        }
        _analyser = nativeRecorder.getAnalyser();
      } catch (err) {
        if (!_playerActive || generation !== _playerGeneration) return;
        showError(err && err.message ? err.message : 'Không thể mở microphone.');
        return;
      }
    } else {
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
      var type = (_recorder.mimeType && _recorder.mimeType !== '') ? _recorder.mimeType : 'audio/webm';
      _handleP2RecordedBlob(new Blob(_audioChunks, { type: type }));
    };

    _recorder.start(250);
    }

    _p2SpeakSecsLeft = P2_SPEAK_SEC;
    _renderP2SpeakTimer();
    showState('p2c');
    _startP2Waveform();

    if (_p2SpeakTimerId) {
      _clearManagedEffect('p2-speak-countdown', _p2SpeakTimerId, 'interval');
    }
    var nativePlayer = _getNativePlayer();
    var onSpeakingDone = function () {
      _p2SpeakTimerId = null;
      _tts('Thank you.');
      _startManagedTimeout('p2-thank-you-delay', _stopP2SpeakingInternal, 1500);
    };
    if (nativePlayer) {
      _p2SpeakTimerId = _startManagedCountdown('p2-speak-countdown', {
        seconds: P2_SPEAK_SEC,
        onTick: function (remaining) {
          _p2SpeakSecsLeft = remaining;
          _renderP2SpeakTimer();
        },
        onDone: onSpeakingDone,
      });
    } else {
      _p2SpeakTimerId = _startManagedInterval('p2-speak-countdown', function () {
        _p2SpeakSecsLeft--;
        _renderP2SpeakTimer();
        if (_p2SpeakSecsLeft <= 0) {
          _clearManagedEffect('p2-speak-countdown', _p2SpeakTimerId, 'interval');
          onSpeakingDone();
        }
      }, 1000);
    }
  }

  function _renderP2SpeakTimer() {
    var m = Math.floor(_p2SpeakSecsLeft / 60);
    var s = _p2SpeakSecsLeft % 60;
    var timerText = m + ':' + (s < 10 ? '0' + s : s);
    if (_updateNativeView('part2', {
      speakTimer: timerText,
      speakUrgent: _p2SpeakSecsLeft < 30,
    })) return;
    var el = $('p2c-timer');
    if (!el) return;
    el.textContent = timerText;
    el.style.color = _p2SpeakSecsLeft < 30 ? '#ef4444' : '#fff';
  }

  function stopP2SpeakingEarly() {
    if (_p2SpeakTimerId) {
      _clearManagedEffect('p2-speak-countdown', _p2SpeakTimerId, 'interval');
      _p2SpeakTimerId = null;
    }
    _clearManagedEffect('p2-thank-you-delay', null, 'timeout');
    _stopP2SpeakingInternal();
  }

  function _stopP2SpeakingInternal() {
    _stopWaveform();
    var nativeRecorder = _getNativeRecorder();
    if (nativeRecorder) {
      if (!nativeRecorder.stop()) {
        _releaseRecorderResources();
        showError('Không dừng được ghi âm. Hãy thử lại phần nói này.');
      }
      return;
    }
    if (_recorder && _recorder.state !== 'inactive') {
      try {
        _recorder.stop();
        // onstop → _startProcessing
      } catch (_) {
        _releaseRecorderResources();
        showError('Không dừng được ghi âm. Hãy thử lại phần nói này.');
      }
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

  // Fire a single grading request immediately (eager upload for test_full).
  // Returns a Promise that resolves/rejects when the upload completes.
  function _submitGradingEager(sessionId, questionId, blob, opts) {
    var generation = _playerGeneration;
    var submitOpts = Object.assign({}, opts || {});
    if (!submitOpts.priorResponseId) {
      submitOpts.priorResponseId = _knownResponseId(questionId);
    }
    var submitKey = String(sessionId) + '\u0000' + String(questionId);
    if (_testMode === 'test_full' && !_ftSubmitKeys[submitKey]) {
      _ftSubmitKeys[submitKey] = true;
      _ftSubmitTotal++;
    }
    var nativeFullTest = _testMode === 'test_full' ? _getNativeFullTest() : null;
    var operation = nativeFullTest
      ? nativeFullTest.submitAnswer({
          sessionId: sessionId,
          questionId: questionId,
          blob: blob,
          priorResponseId: submitOpts.priorResponseId,
        })
      : _submitResponseTransport(sessionId, questionId, blob, submitOpts);
    var tracked = operation
      .then(function (result) {
        if (!_playerActive || generation !== _playerGeneration) return result;
        if (_testMode === 'test_full' && _ftSubmitFailureKeys[submitKey]) {
          delete _ftSubmitFailureKeys[submitKey];
          var failureIndex = _ftSubmitFailures.indexOf(questionId);
          if (failureIndex !== -1) _ftSubmitFailures.splice(failureIndex, 1);
        }
        return result;
      })
      .catch(function (err) {
        if (!_playerActive || generation !== _playerGeneration) return;
        // B1: don't just warn — in a Full Test a failed upload means this
        // answer never reaches the server aggregate. Record it so the
        // completion screen can tell the user, instead of it vanishing silently.
        console.warn('[practice] eager grading failed for q', questionId, err);
        if (_testMode === 'test_full') {
          var failureKey = String(sessionId) + '\u0000' + String(questionId);
          if (!_ftSubmitFailureKeys[failureKey]) {
            _ftSubmitFailureKeys[failureKey] = true;
            // Preserve the historical array contract: consumers receive raw
            // question ids; the separate map owns session-aware deduplication.
            _ftSubmitFailures.push(questionId);
          }
          // This upload can reject AFTER the completion screen is already shown
          // (the final Part 3 answer starts uploading, then _fireAndForget…
          // renders immediately). Re-render the notice so the warning actually
          // appears — otherwise the dropped answer stays silent. Idempotent, and
          // a no-op while #state-completion is still hidden mid-test.
          _renderSubmitFailureNotice();
        }
        // NUỐT LỖI LÀ CHỦ ĐÍCH cho Full Test: ở đó màn hoàn thành đã hiện và
        // cảnh báo được vẽ riêng. Nhưng phiếu làm bài DỰA VÀO promise này để
        // quyết định ô có "đã lưu" hay không — nuốt ở đó nghĩa là ô hỏng vẫn
        // xanh, học viên bấm Nộp và mất câu trả lời mà không biết.
        if (submitOpts.rethrow) throw err;
      });
    if (_testMode === 'test_full' && !nativeFullTest) {
      _ftLegacyPending[submitKey] = tracked;
      void tracked.finally(function () {
        if (_ftLegacyPending[submitKey] === tracked) delete _ftLegacyPending[submitKey];
      }).catch(function () {});
    }
    return tracked;
  }

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
      // Every answer was graded + persisted before we got here (awaited
      // practice path) — hand straight off to the canonical result page.
      _finishTestAndShowResults();
    } else {
      // Full Test: do NOT grade between parts — go directly to next part
      var nextPart = _ftCurrentPart + 1;
      if (nextPart > 3) {
        // All parts done — fire grading in background, show completion screen immediately
        _fireAndForgetFullTestGrading();
      } else {
        // Transition directly to next part, no break screen, no mid-test grading
        _startNextPartInFullTest(nextPart);
      }
    }
  }

  // ── A5: reporting Speaking back to the mock sitting ─────────────────
  //
  // This call used to be fire-and-forget inside a swallowed .catch(). If it
  // failed, the sitting stayed `speaking_pending` FOREVER: _reconcile_terminal
  // never ran, no review row was created, the result was never released, and
  // nobody — student or admin — had any way to fix it. The speaking work itself
  // was fine; only the last hop was lost.
  //
  // Now: retry, and persist the debt so a reload finishes the job. The admin
  // also has POST /admin/mock-exams/sittings/{id}/record-speaking as the
  // last-resort unstick.
  // The queue itself lives in speaking-debt.js — practice.js is loaded only by
  // the practice pages, so a student who closed the completion tab and came
  // back through Home or the mock-exam page would never have settled the debt
  // (Codex review, PR #847). These thin wrappers keep the call sites here
  // unchanged and degrade to no-ops if the shared script is ever missing.
  var _currentUserId = null;

  function _reportSpeakingToSitting(sittingId, ids) {
    if (!window.SpeakingDebt) return Promise.resolve();
    return window.SpeakingDebt.report(sittingId, ids, 0, _currentUserId);
  }

  function _retryOwedSpeakingReport() {
    if (window.SpeakingDebt) window.SpeakingDebt.retryAll();
  }

  // Called when the last Part 3 question is submitted in test_full mode.
  // Calls the backend finalize endpoint — server handles all aggregation.
  // Browser is free to close immediately after this returns.
  function _fireAndForgetFullTestGrading() {
    var generation = _playerGeneration;
    _releaseRecorderResources();
    // Show completion screen immediately — no waiting
    showState('completion');
    _renderSubmitFailureNotice();

    // Tell backend to finalize: it marks sessions 'submitted', then polls DB until
    // all eager-upload grading requests complete, then aggregates band scores.
    var p1 = _ftAllSessionIds[0] || _sessionId;
    var p2 = _ftAllSessionIds[1] || null;
    var p3 = _ftAllSessionIds[2] || null;
    var sittingId = _sittingId;

    var body = { p1_id: p1 };
    if (p2) body.p2_id = p2;
    if (p3) body.p3_id = p3;

    var nativeFullTest = _getNativeFullTest();
    if (nativeFullTest) {
      nativeFullTest.replaceChain([p1, p2, p3].filter(Boolean));
      _setFullTestCompletionPhase('sending');
      return nativeFullTest.finalizeFullTest()
        .then(function () {
          return _onFullTestFinalizeAccepted(
            p1, p2, p3, sittingId,
            _playerActive && generation === _playerGeneration,
            nativeFullTest,
          );
        })
        .catch(function (err) {
          if (!_playerActive || generation !== _playerGeneration) return;
          console.warn('[practice] native full-test finalize paused:', err);
          _setFullTestCompletionPhase('error', err);
        });
    }

    // Legacy transport does not own retry blobs. Wait for every admitted eager
    // upload before finalizing, so "accepted" can never outrun a late failure.
    var pendingLegacy = Object.keys(_ftLegacyPending).map(function (key) {
      return _ftLegacyPending[key];
    });
    _setFullTestCompletionPhase('sending');
    return Promise.allSettled(pendingLegacy)
      .then(function () {
        if (_ftSubmitFailures.length) {
          _renderSubmitFailureNotice();
          _setFullTestCompletionPhase('legacy-upload-error');
          return null;
        }
        // Preserve the chain and completion screen on an expired token.
        return window.api.postWith(
          '/sessions/finalize-full-test', body, {}, { noRedirect: true }
        );
      })
      .then(function () {
        if (_ftSubmitFailures.length) return;
        // Spike-2 fix (review #748): clear the persisted chain only AFTER
        // the backend ACCEPTED finalize. Clearing before the call meant a
        // failed finalize (network/5xx — the catch below deliberately keeps
        // sessions in_progress for retry) lost the only persisted copy: a
        // Part-3 refresh would rebuild the chain as [p3] and the retried
        // finalize would aggregate WITHOUT Part 1/2.
        return _onFullTestFinalizeAccepted(
          p1, p2, p3, sittingId,
          _playerActive && generation === _playerGeneration,
        );
      })
      .catch(function (err) {
        if (!_playerActive || generation !== _playerGeneration) return;
        console.warn('[practice] finalize-full-test failed (non-fatal):', err);
        _setFullTestCompletionPhase('error', err);
      });
  }

  function _onFullTestFinalizeAccepted(
    p1, p2, p3, sittingId, renderUI, acceptedController
  ) {
    // Never look up the controller again after an async finalize. The route may
    // have remounted and installed a newer Full Test while the accepted request
    // was settling; only the controller captured by that request may clear.
    if (acceptedController) acceptedController.clear();
    else _clearFtChain();
    if (renderUI !== false) _setFullTestCompletionPhase('accepted');
    // 4-skill mock: report the completed speaking sessions to the sitting
    // and hand back to the orchestrator. The durable debt queue owns retries.
    if (!sittingId) return Promise.resolve();
    return _reportSpeakingToSitting(sittingId, [p1, p2, p3].filter(Boolean))
      .then(function () {
        if (renderUI !== false) {
          window.location.href = '/pages/mock-exam.html?sitting=' + encodeURIComponent(sittingId);
        }
      });
  }

  function _setFullTestCompletionPhase(phase, error) {
    var nativeFullTest = _getNativeFullTest();
    var snapshot = nativeFullTest ? nativeFullTest.getSnapshot() : null;

    if (phase === 'accepted') {
      if (_updateNativeView('completion', {
        title: 'Bạn đã nộp Full Test!',
        description: 'Hệ thống đã nhận đủ bản ghi và đang tổng hợp band score cùng nhận xét chi tiết.',
        statusTone: 'success',
        statusText: 'Đã xác nhận toàn bộ bản ghi trên máy chủ.',
        retryVisible: false,
        retryDisabled: false,
        retryLabel: 'Gửi lại và chốt bài',
        infoVisible: true,
        ctasVisible: true,
      })) return;
      var title = $('completion-title');
      var desc = $('completion-desc');
      var status = $('completion-submit-status');
      var retry = $('completion-retry-btn');
      var ctas = $('completion-ctas');
      var info = $('completion-info');
      if (title) title.textContent = 'Bạn đã nộp Full Test!';
      if (desc) desc.textContent = 'Hệ thống đã nhận đủ bản ghi và đang tổng hợp band score cùng nhận xét chi tiết.';
      if (status) {
        status.className = 'practice-completion-submit-status is-success';
        status.textContent = 'Đã xác nhận toàn bộ bản ghi trên máy chủ.';
      }
      if (retry) retry.style.display = 'none';
      if (ctas) ctas.style.display = '';
      if (info) info.style.display = '';
      return;
    }

    if (phase === 'legacy-upload-error') {
      var title = $('completion-title');
      var desc = $('completion-desc');
      var status = $('completion-submit-status');
      var retry = $('completion-retry-btn');
      var ctas = $('completion-ctas');
      var info = $('completion-info');
      var failedLegacy = _ftSubmitFailures.length;
      if (title) title.textContent = 'Có bản ghi chưa gửi được';
      if (desc) {
        desc.textContent = 'Full Test chưa được chốt. Hãy quay lại Speaking và làm lại bài; các phần đã lưu vẫn có trong lịch sử.';
      }
      if (status) {
        status.className = 'practice-completion-submit-status is-error';
        status.textContent = failedLegacy + ' bản ghi chưa được máy chủ xác nhận.';
      }
      if (retry) retry.style.display = 'none';
      if (ctas) ctas.style.display = '';
      if (info) info.style.display = 'none';
      return;
    }

    if (phase === 'error') {
      var retryCount = snapshot ? snapshot.retryCount : 0;
      var errorTitle = retryCount ? 'Còn bản ghi chưa gửi được' : 'Chưa chốt được Full Test';
      var errorDescription = retryCount
        ? 'Bản ghi vẫn còn trên thiết bị này. Đừng đóng trang; hãy gửi lại để bài thi đủ câu.'
        : 'Các bản ghi đã gửi, nhưng máy chủ chưa xác nhận chốt bài. Hãy thử lại.';
      var errorStatus = retryCount
        ? retryCount + ' bản ghi cần gửi lại.'
        : ((error && error.message) || 'Chưa thể xác nhận yêu cầu chốt bài.');
      var retryLabel = retryCount ? 'Gửi lại và chốt bài' : 'Thử chốt bài lại';
      if (_updateNativeView('completion', {
        title: errorTitle,
        description: errorDescription,
        statusTone: 'error',
        statusText: errorStatus,
        retryVisible: true,
        retryDisabled: false,
        retryLabel: retryLabel,
        infoVisible: false,
        ctasVisible: false,
      })) return;
      var title = $('completion-title');
      var desc = $('completion-desc');
      var status = $('completion-submit-status');
      var retry = $('completion-retry-btn');
      var ctas = $('completion-ctas');
      var info = $('completion-info');
      if (title) title.textContent = errorTitle;
      if (desc) desc.textContent = errorDescription;
      if (status) {
        status.className = 'practice-completion-submit-status is-error';
        status.textContent = errorStatus;
      }
      if (retry) {
        retry.style.display = '';
        retry.disabled = false;
        retry.textContent = retryLabel;
      }
      if (ctas) ctas.style.display = 'none';
      if (info) info.style.display = 'none';
      return;
    }

    if (_updateNativeView('completion', {
      title: 'Đang gửi nốt Full Test…',
      description: 'Hãy giữ trang này mở cho tới khi máy chủ xác nhận đủ tất cả bản ghi.',
      statusTone: 'pending',
      statusText: 'Đang kiểm tra và gửi nốt các câu trả lời…',
      retryVisible: false,
      retryDisabled: false,
      retryLabel: 'Gửi lại và chốt bài',
      infoVisible: false,
      ctasVisible: false,
    })) return;
    var title = $('completion-title');
    var desc = $('completion-desc');
    var status = $('completion-submit-status');
    var retry = $('completion-retry-btn');
    var ctas = $('completion-ctas');
    var info = $('completion-info');
    if (title) title.textContent = 'Đang gửi nốt Full Test…';
    if (desc) desc.textContent = 'Hãy giữ trang này mở cho tới khi máy chủ xác nhận đủ tất cả bản ghi.';
    if (status) {
      status.className = 'practice-completion-submit-status is-pending';
      status.textContent = 'Đang kiểm tra và gửi nốt các câu trả lời…';
    }
    if (retry) retry.style.display = 'none';
    if (ctas) ctas.style.display = 'none';
    if (info) info.style.display = 'none';
  }

  function retryFullTestSubmissions() {
    if (_fullTestRetryInFlight) return;
    var nativeFullTest = _getNativeFullTest();
    if (!nativeFullTest) return;
    _fullTestRetryInFlight = true;
    var generation = _playerGeneration;
    var sittingId = _sittingId;
    _setFullTestCompletionPhase('sending');
    if (!_updateNativeView('completion', {
      retryVisible: true,
      retryDisabled: true,
      retryLabel: 'Đang gửi lại…',
    })) {
      var btn = $('completion-retry-btn');
      if (btn) {
        btn.style.display = '';
        btn.disabled = true;
        btn.textContent = 'Đang gửi lại…';
      }
    }
    return nativeFullTest.retryFailed()
      .then(function () { return nativeFullTest.finalizeFullTest(); })
      .then(function () {
        if (_playerActive && generation === _playerGeneration) {
          _fullTestRetryInFlight = false;
        }
        var ids = nativeFullTest.getSnapshot().sessionIds;
        return _onFullTestFinalizeAccepted(
          ids[0], ids[1], ids[2], sittingId,
          _playerActive && generation === _playerGeneration,
          nativeFullTest,
        );
      })
      .catch(function (err) {
        if (!_playerActive || generation !== _playerGeneration) return;
        _fullTestRetryInFlight = false;
        console.warn('[practice] full-test retry failed:', err);
        _setFullTestCompletionPhase('error', err);
      });
  }

  // B1: surface eager-upload / complete failures on the completion screen so a
  // dropped answer isn't silently absent from the aggregate. Idempotent — safe
  // to call whether or not there were failures (removes a stale notice).
  function _renderSubmitFailureNotice() {
    // Native Full Test has a retryable, blob-owning status card. The legacy
    // warning below is intentionally informational only and cannot recover a
    // recording, so never render it over the native state.
    if (_getNativeFullTest()) return;
    var host = $('state-completion');
    if (!host) return;
    var existing = host.querySelector('.practice-submit-warning');
    if (existing) existing.remove();

    var failed = _ftSubmitFailures.length;
    if (failed === 0 && _ftCompleteFailures === 0) return;

    var ok = Math.max(0, _ftSubmitTotal - failed);
    var lines = [];
    if (failed > 0) {
      lines.push('Đã gửi thành công <strong>' + ok + '/' + _ftSubmitTotal +
        '</strong> câu. <strong>' + failed + '</strong> câu gặp lỗi mạng — ' +
        'điểm tổng có thể thiếu phần này.');
    }
    if (_ftCompleteFailures > 0) {
      lines.push('<strong>' + _ftCompleteFailures + '</strong> phần chưa chốt được điểm ' +
        '(lỗi kết nối). Kết quả có thể hiển thị thiếu — thử tải lại sau ít phút.');
    }
    lines.push('Nếu kết quả thiếu, liên hệ hỗ trợ để được chấm lại — không mất bài đã ghi.');

    var el = document.createElement('div');
    el.className = 'practice-submit-warning';
    el.setAttribute('role', 'alert');
    el.style.cssText =
      'margin:16px auto 0;max-width:520px;padding:12px 16px;border-radius:12px;' +
      'border:1px solid var(--av-warning);background:var(--av-warning-soft,rgba(251,146,60,0.12));' +
      'color:var(--av-text-primary);font-size:13px;line-height:1.6;text-align:left;';
    el.innerHTML = '<strong style="color:var(--av-warning);">⚠ Một số câu chưa gửi được</strong><br>' +
      lines.join('<br>');
    host.appendChild(el);
  }

  async function _startNextPartInFullTest(part) {
    var generation = _playerGeneration;
    var priorChain = _ftAllSessionIds.slice();
    var nativeFullTest = _getNativeFullTest();
    showState('loading');

    try {
      // NOTE: do NOT complete the current session here.
      // All part sessions are completed together at the very end (_finishTestAndShowResults).

      // Topic selection:
      //  Part 2 → use the topic stored by the dashboard (_ftP2Topic)
      //  Part 3 → inherit Part 2 session's topic (already in _sessionData.topic)
      var nextTopic = (part === 2 && _ftP2Topic)
        ? _ftP2Topic
        : (_sessionData.topic || 'General');

      _setLoadingMessage('Đang tạo Part ' + part + '...');
      var _createBody = { mode: 'test_full', part: part, topic: nextTopic };
      // The server derives the canonical Full Test attempt from the immediately
      // preceding owned session. Never send or trust a client-chosen attempt id.
      _createBody.previous_session_id = _sessionId;
      // Mock sitting: link later parts too, so their per-response grading is
      // sealed like the opening session.
      if (_sittingId) _createBody.sitting_id = _sittingId;
      var newSession = await window.api.post('/sessions', _createBody);

      var newId = newSession && (newSession.id || newSession.session_id);
      if (!newId) throw new Error('Server không trả về session_id cho Part ' + part);

      // Session creation is a mutation and cannot be assumed cancelled by a
      // soft navigation. A disposed controller may extend shared storage only
      // when no newer Full Test has replaced the exact chain it started from.
      var nextChain = priorChain.concat([newId]);
      var playerStillOwnsRoute = _playerActive && generation === _playerGeneration;
      if (nativeFullTest) {
        if (playerStillOwnsRoute) nativeFullTest.replaceChain(nextChain);
        else nativeFullTest.replaceChainIfCurrent(priorChain, nextChain);
      }
      else {
        if (playerStillOwnsRoute) {
          try { sessionStorage.setItem(FT_CHAIN_KEY, JSON.stringify(nextChain)); } catch (e) {}
        } else {
          _replaceLegacyFtChainIfCurrent(priorChain, nextChain);
        }
      }
      if (!playerStillOwnsRoute) return;

      // Commit module, chain and URL state together before the next network
      // mutation. The error screen then also refers to the session that truly
      // needs question generation retried.
      _sessionId     = newId;
      _sessionData   = newSession;
      _ftCurrentPart = part;
      if (!_sessionData.mode) _sessionData.mode = 'test_full';
      _ftAllSessionIds = nextChain;
      _saveFtChain(); // spike-2 fix: the chain must survive a refresh
      // Commit the routing source of truth in the SAME transition as the chain.
      // If question generation below fails or the tab reloads mid-request, the
      // native bootstrap resumes this new session and retries its empty question
      // set instead of returning to the old part and minting an orphan session.
      try {
        history.replaceState(null, '', '?session_id=' + encodeURIComponent(newId));
      } catch (e) { /* older browsers: refresh keeps legacy behavior */ }

      // Generate questions for this part
      _setLoadingMessage('Đang tạo câu hỏi Part ' + part + '...');
      var questions = await window.api.post('/sessions/' + newId + '/questions/generate', {});
      if (!_playerActive || generation !== _playerGeneration) return;
      if (!questions || questions.length === 0) throw new Error('Không tạo được câu hỏi Part ' + part);

      // Slice to full test exam count
      var maxQ = FULL_TEST_Q_COUNT[part] || questions.length;
      questions = questions.slice(0, maxQ);

      // Never start a persisted short exam. New backend generations are exact;
      // this also stops historical 3-question Part 3 fallbacks from being
      // presented as a complete Full Test.
      if (questions.length < maxQ) {
        throw new Error(
          'Không tạo đủ câu hỏi cho Full Test Part ' + part + ' (cần ' + maxQ +
          ', nhận được ' + questions.length + '). ' +
          'Vui lòng thử lại.'
        );
      }

      // Update question state for the already-committed new part.
      _questions   = questions;
      _currentIdx  = 0;

      _showPrep();

    } catch (err) {
      if (!_playerActive || generation !== _playerGeneration) return;
      showError('Không thể bắt đầu Part ' + part + ': ' + (err.message || 'Lỗi không xác định'));
    }
  }

  function _finishTestAndShowResults() {
    _releaseRecorderResources();
    // Complete ALL part sessions best-effort (fire and forget).
    var toComplete = _ftAllSessionIds.length > 0 ? _ftAllSessionIds : [_sessionId];
    toComplete.forEach(function (sid) {
      window.api.patch('/sessions/' + sid + '/complete', {}).catch(function (err) {
        // B1: a failed /complete means that part's band never aggregates. Log
        // it (was a no-op catch) and count it so it isn't invisible.
        console.warn('[practice] session complete failed', sid, err);
        _ftCompleteFailures++;
      });
    });

    if (_testMode === 'test_full' && _ftAllSessionIds.length > 0) {
      // Redirect to dedicated full-test result page
      window.location.href = _fullTestResultUrl(_ftAllSessionIds);
      return;
    }

    // test_part — redirect to the canonical result page so the post-session
    // summary matches what the user sees from "Lịch sử sessions" (single
    // source of truth).  Day 2 dogfood reported that the inline summary and
    // the dashboard-history view diverged enough to be confusing; both now
    // route through result.html?id=<session_id>.
    if (_sessionId) {
      window.location.href = _singleSessionResultUrl(_sessionId);
      return;
    }

    // Defensive fallback: if for any reason _sessionId is missing, fall back
    // to the legacy inline render so the user still sees something.
    _renderTestResults();
    showState('test-results');
  }

  function _nativeTestResultsView(results) {
    var source = Array.isArray(results) ? results : [];
    var nativeBands = source.map(function (result) {
      return _nativeFiniteNumber(result && result.response && result.response.overall_band);
    }).filter(function (band) { return band != null; });
    var nativeOverall = '—';
    if (nativeBands.length) {
      var nativeAverage = nativeBands.reduce(function (sum, band) {
        return sum + band;
      }, 0) / nativeBands.length;
      nativeOverall = (Math.round(nativeAverage * 2) / 2).toFixed(1);
    }
    var nativeCards = source.map(function (result, index) {
      var payload = result.response || {};
      var band = _nativeFiniteNumber(payload.overall_band);
      var details = _nativeFeedbackDetails(payload);
      var errorPrefix = 'test-result-' + index + '-';
      details.grammarGroups = details.grammarGroups.map(function (group) {
        return Object.assign({}, group, {
          errors: group.errors.map(function (error) {
            return Object.assign({}, error, { id: errorPrefix + error.id });
          }),
        });
      });
      var transcriptSegments = _nativeTranscriptSegments(payload.transcript, payload.grammar_check)
        .map(function (segment) {
          return segment.type === 'error'
            ? Object.assign({}, segment, { id: errorPrefix + segment.id })
            : segment;
        });
      return Object.assign({}, details, {
        key: String(result.sessionId || '') + ':' + index,
        part: result.part,
        questionNumber: index + 1,
        questionText: String(result.questionText || ''),
        overallBand: band == null ? null : band.toFixed(1),
        bands: payload.band_fc != null ? [
          _nativeBandView('FC', payload.band_fc),
          _nativeBandView('LR', payload.band_lr),
          _nativeBandView('GRA', payload.band_gra),
          _nativeBandView('P', payload.band_p),
        ] : [],
        transcriptVisible: !!payload.transcript,
        transcriptSegments: transcriptSegments,
      });
    });
    return {
      overallBand: nativeOverall,
      cards: nativeCards,
    };
  }

  function _renderTestResults() {
    if (_updateNativeView('testResults', _nativeTestResultsView(_testResults))) return;

    // Compute overall band from all graded responses
    var bands = _testResults
      .map(function (r) { return _nativeFiniteNumber(r.response && r.response.overall_band); })
      .filter(function (b) { return b != null; });

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
    // A3: canonical 4-tier token scale (≥7 success · 6–6.5 primary · 5–5.5
    // warning · <5 error), replacing the old hardcoded hex (fail-contrast on
    // light theme + a 4th, divergent band-colour system).
    var _b = data.overall_band;
    var bandColor = _b == null ? 'var(--av-text-muted)'
      : _b >= 7 ? 'var(--av-success)'
      : _b >= 6 ? 'var(--av-primary)'
      : _b >= 5 ? 'var(--av-warning)'
      : 'var(--av-error)';

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
        (data.improved_response ? _improvedBlock(data.improved_response) : (data.improved_response_status ? _sampleUnavailableBlock() : '')) +
        '</div>';
    } else if (data.grammar_issues) {
      // Practice mode coaching feedback
      feedbackHtml =
        '<div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">' +
        _listBlock('Strengths',          data.strengths,             '#4ade80') +
        _grammarIssuesBlock(data.grammar_issues, data.grammar_recommendations) +
        _listBlock('Vocabulary Issues',  data.vocabulary_issues,     '#fb923c') +
        _correctionsBlock(data.corrections) +
        (data.sample_answer ? _sampleAnswerBlock(data.sample_answer) : (data.sample_answer_status ? _sampleUnavailableBlock() : '')) +
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
                :                                 'var(--ds-faint)';
    return '<div style="display:inline-flex;flex-direction:column;align-items:center;'
      + 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);'
      + 'border-radius:10px;padding:6px 10px;min-width:64px;">'
      + '<span style="font-size:18px;font-weight:800;color:' + color + ';line-height:1;">' + display + '</span>'
      + '<span style="font-size:9px;color:var(--ds-muted);text-transform:uppercase;'
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
    // Sprint 15.1 — expose this render's weak words + their phonemes so the
    // drill-down modal (pronunciation-drilldown.js) can open from a badge.
    window.__pronSessionId = _sessionId;
    window.__pronWeakWords = words.map(function (w) {
      return { word: w.word, phonemes: w.phonemes || [] };
    });
    var wordHtml = words.length
      ? '<p style="font-size:11px;color:var(--ds-muted);margin:10px 0 4px;">Từ cần chú ý:</p>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
        + words.map(function (w, i) {
            var badge = 'background:rgba(251,146,60,0.12);border:1px solid rgba(251,146,60,0.3);'
              + 'border-radius:6px;padding:2px 8px;font-size:11px;color:#fb923c;';
            // Phoneme data present → clickable drill-down; else plain badge (old sessions, graceful).
            if (w.phonemes && w.phonemes.length) {
              return '<button type="button" class="ds-pron-weak-word" data-pron-idx="' + i + '"'
                + ' title="Xem âm cần luyện" style="' + badge + 'cursor:pointer;">'
                + _esc(w.word) + ' ⓘ</button>';
            }
            return '<span style="' + badge + '">' + _esc(w.word) + '</span>';
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
      + '<p style="font-size:10px;color:var(--ds-muted);margin:-4px 0 10px;">'
      + 'Điểm phát âm theo thang Azure 0–100 (khác thang band 0–9).</p>'
      + (summary ? '<ul style="font-size:12px;color:var(--ds-text);'
          + 'padding-left:16px;margin:0 0 4px;line-height:1.7;">' + summary + '</ul>' : '')
      + wordHtml
      // Sprint 15.3 — inline phoneme accordion (replaces the 15.1.2 modal). The
      // weak-word badges above scroll to + expand the matching sub-section.
      + (window.PronunciationDrilldown
          ? window.PronunciationDrilldown.renderPronunciationAccordion(window.__pronWeakWords)
          : '')
      + '</div>';
  }

  /**
   * Render full-test pronunciation block into #full-pron-block.
   * fullData: response from POST /sessions/{id}/pronunciation/full
   */
  function _nativeFullPronunciationView(fullData) {
    var data = fullData || {};
    var partDefs = [
      { key: 'part1', label: 'Phần 1' },
      { key: 'part2', label: 'Phần 2' },
      { key: 'part3', label: 'Phần 3' },
    ];
    var parts = partDefs.map(function (definition) {
      var sample = data.samples && data.samples[definition.key];
      if (!sample) return { key: definition.key, label: definition.label, available: false };
      var words = (Array.isArray(sample.words) ? sample.words : [])
        .filter(function (word) { return word && word.error_type && word.error_type !== 'None'; })
        .slice(0, 5)
        .map(function (word) { return String(word.word || ''); });
      return {
        key: definition.key,
        label: definition.label,
        available: true,
        selectionReason: String(sample.selection_reason || ''),
        segment: definition.key === 'part2'
          && _nativeFiniteNumber(sample.audio_start_s) != null
          && _nativeFiniteNumber(sample.audio_end_s) != null
          ? '⏱ Đoạn phân tích: ' + Math.round(sample.audio_start_s)
            + 's – ' + Math.round(sample.audio_end_s) + 's'
          : '',
        lowConfidence: !!sample.low_confidence_sample,
        pronunciationScore: _nativeFiniteNumber(sample.pronunciation_score),
        scores: [
          ['Lưu loát', sample.fluency_score],
          ['Chính xác', sample.accuracy_score],
          ['Đầy đủ', sample.completeness_score],
          ['Ngữ điệu', sample.prosody_score],
        ].map(function (score) {
          var value = _nativeFiniteNumber(score[1]);
          return { label: score[0], value: value == null ? null : Math.round(value) };
        }),
        weakWords: words,
      };
    });
    var assessed = typeof data.samples_assessed === 'number' ? data.samples_assessed : 0;
    return {
      visible: true,
      status: 'ready',
      overallScore: _nativeFiniteNumber(data.overall_pron_score),
      subtitle: assessed >= 3 ? '3 mẫu đại diện (Phần 1 + 2 + 3)'
        : assessed > 0 ? assessed + '/3 phần có dữ liệu'
        : 'Không đủ dữ liệu',
      parts: parts,
      reliability: _nativeReliabilityView({ score_confidence: data.overall_confidence }),
    };
  }

  function _renderFullPronBlock(el, fullData) {
    if (!el) return;

    var overallScore = fullData.overall_pron_score;
    var overallColor = (overallScore != null && overallScore >= 75) ? '#4ade80'
                     : (overallScore != null && overallScore >= 55) ? '#14b8a6'
                     : (overallScore != null)                       ? '#fb923c'
                     :                                                'var(--ds-muted)';

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
          + '<p style="font-size:11px;font-weight:700;color:var(--ds-muted);margin:0 0 4px;">'
          + _esc(def.label) + '</p>'
          + '<p style="font-size:11px;color:var(--ds-faint);margin:0;font-style:italic;">Không có dữ liệu</p>'
          + '</div>';
      }

      // Segment line for Part 2
      var segHtml = '';
      if (def.key === 'part2') {
        if (s.audio_start_s != null && s.audio_end_s != null) {
          segHtml = '<p style="font-size:10px;color:var(--ds-faint);margin:2px 0 0;">'
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
            + '<p style="font-size:10px;color:var(--ds-muted);margin:0;line-height:1.4;">'
            + _esc(s.selection_reason) + '</p>'
            + segHtml
          + '</div>'
          + '<div style="text-align:center;flex-shrink:0;">'
            + '<div style="font-size:24px;font-weight:800;color:' + overallColor + ';line-height:1;">'
            + (s.pronunciation_score != null ? Math.round(s.pronunciation_score) : '—') + '</div>'
            + '<div style="font-size:8px;color:var(--ds-faint);text-transform:uppercase;">/ 100</div>'
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
          + '<p style="font-size:10px;color:var(--ds-muted);margin:0;">' + _esc(subtitle) + '</p>'
        + '</div>'
        + '<div style="text-align:center;">'
          + '<div style="font-size:32px;font-weight:900;color:' + overallColor + ';line-height:1;">'
          + (overallScore != null ? Math.round(overallScore) : '—') + '</div>'
          + '<div style="font-size:9px;color:var(--ds-faint);text-transform:uppercase;letter-spacing:.05em;">/100</div>'
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
    var generation = _playerGeneration;
    var el      = $('full-pron-block');
    var section = $('full-pron-section');
    var nativeView = _getNativeView();
    if (!el && !nativeView) return;

    if (!_ftAllSessionIds.length) return;

    var primarySid = _ftAllSessionIds[0];
    var extraSids  = _ftAllSessionIds.slice(1);

    // Show wrapper section + loading state inside the block.
    if (nativeView) {
      _updateNativeView('testResults', {
        fullPronunciation: { visible: true, status: 'loading' },
      });
    } else {
      if (section) { section.style.display = ''; }
      el.innerHTML =
        '<div style="border:1px solid rgba(20,184,166,0.15);border-radius:14px;padding:20px 16px;'
        + 'text-align:center;">'
        + '<div class="spinner" style="width:22px;height:22px;border-width:2px;margin:0 auto 10px;"></div>'
        + '<p style="font-size:12px;color:var(--ds-muted);margin:0;">Đang tổng hợp phân tích phát âm cho toàn bài...</p>'
        + '</div>';
    }

    // F2: route through the canonical window.api.post — it attaches the Bearer
    // token, bounces to /login on 401, and parses 422 detail bodies, instead of
    // this module re-implementing the getSession→fetch→r.json() dance.
    window.api.post('/sessions/' + primarySid + '/pronunciation/full', { extra_session_ids: extraSids })
      .then(function (data) {
        if (!_playerActive || generation !== _playerGeneration) return;
        if (!data) return;  // 401 → api.post redirected to /login and resolved null
        if (_updateNativeView('testResults', {
          fullPronunciation: _nativeFullPronunciationView(data),
          overallBand: _nativeFiniteNumber(data.final_overall_band) != null
            ? _nativeFiniteNumber(data.final_overall_band).toFixed(1)
            : nativeView.getViewSnapshot().testResults.overallBand,
        })) return;
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
        if (!_playerActive || generation !== _playerGeneration) return;
        console.warn('[practice] full pron fetch failed:', err);
        if (_updateNativeView('testResults', {
          fullPronunciation: {
            visible: true,
            status: 'error',
            message: 'Chưa tổng hợp được phân tích phát âm cho bài này — nếu muốn xem kết quả, bạn thử lại sau nhé.',
          },
        })) return;
        el.innerHTML =
          '<div style="border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px 16px;">'
          + '<p style="font-size:12px;color:var(--ds-faint);margin:0;line-height:1.6;font-style:italic;">'
          + 'Chưa tổng hợp được phân tích phát âm cho bài này — nếu muốn xem kết quả, bạn thử lại sau nhé.</p>'
          + '</div>';
        el.style.display = '';
      });
  }


  // ── Navigation ────────────────────────────────────────────────────────────────

  // ── PHIẾU LÀM BÀI (bài tập lớp nhiều câu) ───────────────────────────────────
  //
  // Màn phễu cũ ép làm tuần tự: nghe câu 1 → ghi âm → nộp → nhận xét → câu 2.
  // Phiếu này cho cả hai ô cùng hiện, làm ô nào trước cũng được, và LƯU TỪNG Ô.
  //
  // Vì sao lưu-từng-ô đáng làm: nộp một câu là chấm ĐỒNG BỘ (15–30 giây). Ở màn
  // phễu, học viên ngồi nhìn màn hình chờ. Ở đây họ ghi âm ô kia trong lúc ô này
  // đang chấm — thời gian chờ biến mất mà không phải làm gì cho nhanh hơn.
  //
  // Một micro nên chỉ ghi âm được MỘT ô tại một thời điểm; chấm thì chạy song
  // song thoải mái.

  var _sheet = null;   // { slots: [{q, state, band, error, replays}], recIdx }
  var _sheetSubmitting = false;

  function _sheetActive() {
    return !!_sheet;
  }

  function _initSheet() {
    // Chỉ dùng cho bài tập lớp NHIỀU CÂU. Một câu thì phiếu không hơn gì màn cũ,
    // và luyện tự do vẫn đi luồng cũ — đổi cả hai cùng lúc là mở rộng phạm vi
    // sang thứ không ai yêu cầu.
    var isClassTask = !!(_sessionData && _sessionData.class_assignment_item_id);
    if (!isClassTask || !_questions || _questions.length < 2) return false;
    // DỰNG LẠI TỪ BÀI ĐÃ NỘP. `GET /sessions/{id}` vốn đã trả kèm `responses`,
    // nhưng phiếu trước đây dựng mọi ô ở 'idle' — nên tải lại trang là học viên
    // thấy bài mình vừa làm biến mất, dù server vẫn giữ đủ. Một em nhìn thấy
    // "Chưa làm" ở câu vừa nộp sẽ ghi âm lại, và mất luôn bản cũ.
    var byQid = {};
    (_sessionData.responses || []).forEach(function (r) {
      if (r && r.question_id) byQid[r.question_id] = r;
    });
    _sheet = {
      slots: _questions.map(function (q) {
        var r = byQid[q.id];
        if (!r) return { q: q, state: 'idle', band: null, error: null, replays: 0 };
        return {
          q: q,
          // Ba trạng thái khác nhau, đừng gộp: chấm xong = 'saved'; máy chấm
          // HỎNG = 'ungraded' (map nó vào 'grading' thì ô kẹt ở "Đang chấm…"
          // vĩnh viễn và khoá luôn nút Nộp); còn lại là đang chạy thật.
          state: _respGraded(r) ? 'saved' : (_respFailed(r) ? 'ungraded' : 'grading'),
          band:  _respBand(r),
          error: null,
          replays: 0,
          resp:  r,          // để xem lại nhận xét, không phải tải lại gì thêm
        };
      }),
      recIdx: -1,
    };
    _renderSheet();
    showState('sheet');
    // Thanh ngữ cảnh cao lên khi chữ xuống dòng ở màn hẹp, nên số đo phải theo
    // được. Gắn một lần cho cả vòng đời trang — trang này không unmount.
    if (!_meterTopBound) {
      _meterTopBound = true;
      _listenManaged('sheet-resize', window, 'resize', _syncMeterTop, { passive: true });
    }
    return true;
  }
  var _meterTopBound = false;

  var _SHEET_LABEL = {
    idle:      'Chưa làm',
    retry:     'Chưa gửi · có bản ghi',
    recording: 'Đang ghi âm',
    grading:   'Đang chấm…',
    saved:     'Đã lưu',
    // Bài ĐÃ LÊN SERVER nhưng máy chấm hỏng. Khác 'saved' (có điểm) và khác
    // 'grading' (còn đang chạy) — 3,8% lượt chấm trên prod rơi vào đây, và gộp
    // nó vào một trong hai kia đều là nói sai với học viên.
    ungraded:  'Đã lưu · chưa chấm được',
  };

  /**
   * Phiếu còn nhận bài không.
   *
   * Câu trả lời do BACKEND đưa (`class_task.accepting`, tính bằng chính hàm mà
   * lệnh nộp dùng) — không tự so `due_at` với đồng hồ máy học viên, vì đồng hồ
   * ấy sai được và hạn nộp là giờ Việt Nam do máy chủ chốt.
   *
   * Thiếu khối `class_task` (backend cũ, hoặc đọc hỏng) → KHÔNG khoá: khoá oan
   * một bài còn hạn tệ hơn để lệnh nộp từ chối một bài đã muộn.
   */
  function _sheetLocked() {
    var t = _sessionData && _sessionData.class_task;
    if (t && t.accepting === false) return true;
    if (t && t.submitted_at) return true;
    return !!(_sessionData && _sessionData.status === 'completed');
  }

  function _sheetLockNote(done, total) {
    var t = (_sessionData && _sessionData.class_task) || {};
    if (t.submitted_at || (_sessionData && _sessionData.status === 'completed')) {
      return 'Bài này đã nộp. Bạn vẫn xem lại nhận xét từng câu bất cứ lúc nào.';
    }
    return 'Đã hết hạn nộp — không nhận thêm bài. '
      + 'Đã lưu ' + done + '/' + total + ' câu, và bạn vẫn xem lại được.';
  }

  // ── Đọc một dòng `responses` đã lưu ────────────────────────────────────────
  //
  // `responses.feedback` giữ NGUYÊN hình dạng mà `_showFeedback` nhận lúc chấm
  // xong (band_fc/lr/gra/p, các đoạn nhận xét, strengths, improvements…), nên
  // xem lại KHÔNG cần một bộ vẽ thứ hai — dựng lại đúng object ấy là đủ. Hai
  // bộ vẽ song song cho cùng một nội dung là hai chỗ để trôi khỏi nhau.

  function _respFeedback(r) {
    var raw = r && r.feedback;
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function _respGraded(r) {
    // 'completed' là trạng thái duy nhất có nhận xét để đọc. Thiếu cột (dữ liệu
    // cũ) thì suy từ chỗ có nhận xét hay không, chứ không mặc định là xong.
    if (!r) return false;
    if (r.grading_status) return r.grading_status === 'completed';
    return !!_respFeedback(r);
  }

  /** Đã ghi âm và đã lưu, nhưng bộ chấm hỏng — KHÁC hẳn "đang chấm". */
  function _respFailed(r) {
    return !!(r && r.grading_status === 'failed');
  }

  function _respBand(r) {
    // Ưu tiên band ĐÃ HIỆU CHỈNH theo phát âm — đó là con số trang kết quả và
    // bảng của giáo viên dùng; hiện số thô ở đây sẽ mâu thuẫn với cả hai.
    if (!r) return null;
    var b = (r.final_overall_band != null) ? r.final_overall_band : r.overall_band;
    return (b == null || isNaN(parseFloat(b))) ? null : parseFloat(b);
  }

  /**
   * `pronunciation_payload` là một CHUỖI JSON nằm trong cột jsonb (4696/4696
   * dòng trên prod) — đọc thẳng ra sẽ là chuỗi, và `.words` thành undefined.
   */
  function _pronPayload(r) {
    var raw = r && r.pronunciation_payload;
    if (!raw) return {};
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { return {}; }
    }
    return (raw && typeof raw === 'object') ? raw : {};
  }

  /** Dòng đã lưu → đúng object `_showFeedback` nhận lúc vừa chấm xong. */
  function _respToFeedbackData(r) {
    var fb = _respFeedback(r) || {};
    var failed = r && (r.grading_status === 'failed' || fb._failed);
    return Object.assign({}, fb, failed ? {
      _stub: true,
      _error: 'AI grading is temporarily unavailable. Your recording and transcript were saved.',
    } : {}, {
      response_id:      r.id,
      transcript:       r.transcript || fb.transcript || '',
      duration_seconds: r.duration_seconds != null ? r.duration_seconds : fb.duration_seconds,
      overall_band:     _respBand(r),
      // Phát âm được đo lúc chấm và lưu thành cột riêng; `_showFeedback` đọc
      // `data.pronunciation`, nên gói lại đúng hình dạng ấy. Chưa đo được thì
      // để trống — hàm kia đã có nhánh nói thật về việc thiếu.
      pronunciation: (r.pronunciation_status === 'completed'
                      && r.pronunciation_score != null)
        // Tên cột DB KHÁC tên bộ vẽ đọc (`_renderPronBlock` dùng
        // fluency_score/accuracy_score/completeness_score). Đưa nguyên tên cột
        // xuống thì điểm tổng hiện ra còn ba ô con thành dấu gạch — trong khi
        // dữ liệu vẫn nằm đó. Ánh xạ y như trang kết quả đang làm.
        ? Object.assign({
            status:              'completed',
            pronunciation_score: r.pronunciation_score,
            fluency_score:       r.pronunciation_fluency,
            accuracy_score:      r.pronunciation_accuracy,
            completeness_score:  r.pronunciation_completeness,
          }, _pronPayload(r))
        : null,
    });
  }

  function _renderSheet() {
    if (!_sheet) return;
    var nativeLocked = _sheetLocked();
    var nativeDone = _sheet.slots.filter(function (s) {
      return s.state === 'saved' || s.state === 'ungraded';
    }).length;
    var nativeTotal = _sheet.slots.length;
    var nativeReady = nativeDone === nativeTotal;
    var nativeUngraded = _sheet.slots.filter(function (s) {
      return s.state === 'ungraded';
    }).length;
    var nativeSubmitNote = nativeLocked
      ? _sheetLockNote(nativeDone, nativeTotal)
      : (nativeReady
          ? (nativeUngraded
              ? 'Đã lưu cả ' + nativeTotal + ' câu, nhưng ' + nativeUngraded + ' câu máy chưa '
                + 'chấm được. Bạn vẫn nộp được — điểm những câu ấy sẽ để trống.'
              : 'Đã lưu cả ' + nativeTotal + ' câu. Nộp để chốt bài.')
          : 'Đã lưu ' + nativeDone + '/' + nativeTotal + ' câu — lưu nốt rồi mới nộp được.');
    var nativeSlots = _sheet.slots.map(function (s, i) {
      var recording = s.state === 'recording';
      var busy = _sheet.recIdx !== -1 && _sheet.recIdx !== i;
      var recordLabel = recording ? 'Dừng ghi âm'
        : (s.state === 'retry' ? 'Ghi lại'
          : ((s.state === 'saved' || s.state === 'ungraded') ? 'Ghi âm lại' : 'Ghi âm'));
      return Object.freeze({
        key: (s.q && s.q.id) || String(i),
        index: i,
        state: s.state,
        status: _SHEET_LABEL[s.state] || s.state,
        audioAvailable: !!(s.q && s.q.audio_url),
        replays: s.replays || 0,
        recording: recording,
        busy: busy,
        recordLabel: recordLabel,
        canRetry: !nativeLocked && !!s.retryBlob,
        canReview: s.state === 'saved' && !!s.resp,
        band: (s.band === null || s.band === undefined) ? null : Number(s.band),
        note: s.error || (s.state === 'grading'
          ? 'Bạn làm câu kia được ngay, không phải chờ.'
          : ''),
        noteTone: s.error ? 'error' : '',
      });
    });
    if (_updateNativeView('sheet', {
      slots: nativeSlots,
      meterVisible: nativeTotal >= 4,
      done: nativeDone,
      total: nativeTotal,
      ready: nativeReady && !nativeLocked,
      locked: nativeLocked,
      submitNote: nativeSubmitNote,
      submitLabel: nativeLocked ? 'Đã chốt' : 'Nộp bài',
    })) {
      _syncMeterTop();
      return;
    }
    var wrap = $('sheet-slots');
    if (!wrap) return;

    wrap.innerHTML = _sheet.slots.map(function (s, i) {
      var recording = s.state === 'recording';
      var busy = _sheet.recIdx !== -1 && _sheet.recIdx !== i;
      // Nút ghi âm nói ĐÚNG việc nó làm ở trạng thái hiện tại — "Ghi âm" khi
      // chưa làm, "Dừng" khi đang ghi, "Ghi âm lại" khi đã lưu. Một nhãn dùng
      // chung cho ba việc là bắt người ta đoán.
      var recLabel = recording ? 'Dừng ghi âm'
        : (s.state === 'retry' ? 'Ghi lại'
          : ((s.state === 'saved' || s.state === 'ungraded') ? 'Ghi âm lại' : 'Ghi âm'));
      // Hết hạn / đã chốt: phiếu thành CHỈ ĐỌC. Bài cũ vẫn xem lại được, chỉ
      // không nhận bài mới — để học viên khỏi nói xong mười câu rồi mới biết
      // là muộn.
      var locked = _sheetLocked();
      var band = (s.band === null || s.band === undefined) ? ''
        : '<span class="av-slot__band">' + Number(s.band).toFixed(1) + '</span>';
      var note = s.error
        ? '<p class="av-slot__note" data-tone="error">' + _esc(s.error) + '</p>'
        : (s.state === 'grading'
            ? '<p class="av-slot__note">Bạn làm câu kia được ngay, không phải chờ.</p>'
            : '');
      var replays = s.replays
        ? '<span class="av-slot__replays">đã nghe ' + s.replays + ' lần</span>' : '';
      // XEM NHẬN XÉT — chỉ khi thật sự có gì để đọc. Một điểm số trần trụi
      // không nói được vì sao; ở các chế độ luyện tập khác học viên luôn được
      // đọc nhận xét đầy đủ sau mỗi câu, và bài tập lớp không có lý do gì
      // nghèo hơn.
      var review = (s.state === 'saved' && s.resp)
        ? '<button type="button" class="btn btn-ghost" data-review="' + i + '">Xem nhận xét</button>'
        : '';
      var retry = (!locked && s.retryBlob)
        ? '<button type="button" class="btn btn-primary" data-retry="' + i + '"'
          + (busy ? ' disabled' : '') + '>Gửi lại bản ghi</button>'
        : '';

      return '<section class="av-slot" data-state="' + s.state + '" data-idx="' + i + '">'
        + '<span class="av-slot__spine" aria-hidden="true"></span>'
        + '<div class="av-slot__body">'
        +   '<div class="av-slot__head">'
        +     '<span class="av-slot__no">Câu ' + (i + 1) + '</span>'
        +     '<span class="av-slot__status">' + _SHEET_LABEL[s.state] + '</span>'
        +   '</div>'
        +   '<button type="button" class="av-slot__listen" data-listen="' + i + '"'
        +     (s.q.audio_url ? '' : ' disabled') + '>'
        +     '<span class="av-slot__listen-icon" aria-hidden="true">▶</span>'
        +     '<span>' + (s.q.audio_url ? 'Nghe câu hỏi' : 'Chưa có bản đọc đề') + '</span>'
        +     replays
        +   '</button>'
        +   '<div class="av-slot__actions">'
        +     (locked ? ''
        :       '<button type="button" class="btn ' + (recording ? 'btn-danger' : 'btn-secondary')
              +   '" data-rec="' + i + '"' + (busy ? ' disabled' : '') + '>' + recLabel + '</button>')
        +     retry
        +     review
        +     band
        +   '</div>'
        +   note
        + '</div></section>';
    }).join('');

    // 'ungraded' TÍNH LÀ XONG. Bài đã lên máy chủ rồi; máy chấm hỏng là việc
    // của hệ thống, không phải việc học viên phải sửa. Không tính thì nút Nộp
    // khoá vĩnh viễn và em ấy bị nhốt trong một bài không có lối ra.
    var done = _sheet.slots.filter(function (s) {
      return s.state === 'saved' || s.state === 'ungraded';
    }).length;
    var total = _sheet.slots.length;
    var ready = done === total;
    var lockedNow = _sheetLocked();
    $('sheet-submit').dataset.ready = String(ready && !lockedNow);
    // NÓI RÕ còn thiếu gì. Một nút mờ không lý do khiến học viên bấm mấy lần
    // rồi tưởng trang hỏng.
    // Nói RÕ khi có câu chưa chấm được. "Đã lưu cả 12 câu" mà thiếu điểm sẽ
    // khiến học viên tưởng mình bị chấm 0 — trong khi bài các em không sai gì.
    var ungraded = _sheet.slots.filter(function (s) {
      return s.state === 'ungraded';
    }).length;
    $('sheet-submit-note').textContent = lockedNow
      ? _sheetLockNote(done, total)
      : (ready
          ? (ungraded
              ? 'Đã lưu cả ' + total + ' câu, nhưng ' + ungraded + ' câu máy chưa '
                + 'chấm được. Bạn vẫn nộp được — điểm những câu ấy sẽ để trống.'
              : 'Đã lưu cả ' + total + ' câu. Nộp để chốt bài.')
          : 'Đã lưu ' + done + '/' + total + ' câu — lưu nốt rồi mới nộp được.');
    $('btn-sheet-submit').disabled = !ready || lockedNow;
    $('btn-sheet-submit').textContent = lockedNow ? 'Đã chốt' : 'Nộp bài';
    _renderSheetMeter(done, total);
  }

  // Từ mấy câu trở lên thì đáy phiếu ra khỏi màn hình. Bốn là chỗ điều đó bắt
  // đầu đúng trên điện thoại; dưới ngưỡng ấy thanh tiến độ chỉ là thứ nhắc lại
  // những gì đã nằm sẵn trong tầm mắt.
  var _SHEET_METER_FROM = 4;

  // Thanh ngữ cảnh của trang cũng `sticky top-0`, và nó nằm ở z-30 — cao hơn
  // thanh tiến độ. Hai thứ cùng dính ở đỉnh thì thanh tiến độ chui xuống dưới
  // và biến mất đúng lúc cần nhất: khi học viên đã cuộn qua vài ô.
  //
  // Đo thay vì đoán: thanh ấy cao bao nhiêu là do `py-3` cộng nội dung bên
  // trong, không có con số nào trong CSS. Ghim một hằng số ở đây là ghim một
  // giá trị sẽ sai ngay lần đầu ai đó đổi cỡ chữ trong thanh.
  function _syncMeterTop() {
    var bar = document.querySelector('.practice-context-bar');
    var sheet = $('state-sheet');
    if (!bar || !sheet) return;
    sheet.style.setProperty('--practice-meter-top', bar.offsetHeight + 'px');
  }

  function _renderSheetMeter(done, total) {
    var box = $('sheet-meter');
    if (!box) return;
    if (total < _SHEET_METER_FROM) { box.hidden = true; return; }
    box.hidden = false;
    _syncMeterTop();
    // Mỗi vạch là MỘT câu, đúng thứ tự. "3/12" không nói được các em đã bỏ qua
    // câu nào, mà làm câu nào trước cũng được — nên dãy vạch mới là thứ trả lời
    // câu hỏi thật: "còn câu nào chưa làm?".
    $('sheet-ticks').innerHTML = _sheet.slots.map(function (s) {
      return '<i data-state="' + s.state + '"></i>';
    }).join('');
    $('sheet-meter-count').innerHTML =
      'Đã lưu <strong>' + done + '/' + total + '</strong>';
  }

  function _sheetListen(i) {
    var s = _sheet && _sheet.slots[i];
    if (!s || !s.q.audio_url) return;
    s.replays += 1;
    // Một trình phát dùng chung: hai câu phát chồng nhau thì không nghe được câu
    // nào, và học viên tưởng audio hỏng.
    if (!_sheetAudio) _sheetAudio = new Audio();
    _sheetAudio.pause();
    _sheetAudio.src = s.q.audio_url;
    _sheetAudio.play().catch(function () {
      s.error = 'Trình duyệt chặn phát tự động — bấm lại giúp nhé.';
      _renderSheet();
    });
    _renderSheet();
  }
  var _sheetAudio = null;

  async function _sheetToggleRec(i) {
    var generation = _playerGeneration;
    var s = _sheet && _sheet.slots[i];
    if (!s) return;
    if (_sheet.recIdx === i) {
      var pendingRecorder = _getNativeRecorder();
      if (pendingRecorder && pendingRecorder.isStarting()) {
        pendingRecorder.reset();
        _analyser = null;
        s.state = s.prevState || s.hadWork || 'idle';
        s.prevState = null;
        s.error = null;
        _sheet.recIdx = -1;
        _renderSheet();
        return;
      }
      stopRecording();
      return;
    }
    if (_sheet.recIdx !== -1) return;      // một micro: ô khác đang ghi
    // Nhớ trạng thái CŨ để trả lại nguyên vẹn nếu micro không mở được.
    var prevState = s.state;
    // Và ghi lên chính ô ấy: `onstop` chạy SAU khi ô đã sang 'recording', nên
    // đọc `s.state` ở đó luôn ra 'recording' và không bao giờ biết ô này vốn đã
    // có bài trên máy chủ (codex PR 942 — lỗi trong chính bản vá vòng trước).
    //
    // Giữ nguyên TÊN trạng thái chứ không rút thành true/false: một ô 'saved'
    // ghi lại mà hỏng phải quay về 'saved' — hạ nó xuống 'ungraded' là giấu mất
    // nút "Xem nhận xét" của một bài ĐÃ CHẤM XONG trên máy chủ.
    s.hadWork = (prevState === 'saved' || prevState === 'ungraded') ? prevState : null;
    s.prevState = prevState;
    s.error = null;
    s.state = 'recording';
    _sheet.recIdx = i;
    _renderSheet();
    // Kiểm GIÁ TRỊ TRẢ VỀ, không chỉ bắt ngoại lệ: startRecording xử lý lỗi
    // micro bên trong (hiện thông báo) rồi trả về bình thường, nên `catch` một
    // mình sẽ không bao giờ chạy — và ô kẹt ở "đang ghi âm" với mọi nút khác
    // bị khoá cho tới khi tải lại trang.
    var ok = false;
    try {
      ok = await startRecording();
    } catch (err) {
      ok = false;
    }
    if (!_playerActive || generation !== _playerGeneration) return;
    // The same button can cancel a native start while getUserMedia is pending.
    // Its original invocation resumes later and must not overwrite that reset.
    if (_sheet.recIdx !== i) return;
    if (!ok) {
      // Trả về ĐÚNG trạng thái trước đó, đừng suy từ `band`. Ô 'ungraded' cố ý
      // không có band, nên suy-từ-band sẽ hạ nó xuống 'idle' — tức là vứt một
      // bài ĐÃ LÊN MÁY CHỦ khỏi số đếm và khoá lại nút Nộp, chỉ vì micro không
      // mở được ở lần thử lại (codex #942).
      s.state = prevState;
      s.prevState = null;
      s.error = 'Không ghi âm được. Kiểm tra quyền dùng micro rồi thử lại.';
      _sheet.recIdx = -1;
      _renderSheet();
    } else {
      // Starting a fresh take is the learner's explicit decision to replace the
      // locally retained failed take. Do not discard it before the microphone
      // actually starts: permission failure must leave the retry option intact.
      s.retryBlob = null;
      s.retryHadWork = null;
    }
  }

  function _sheetOnRecorded(blob) {
    var i = _sheet.recIdx;
    var s = _sheet.slots[i];
    // Ô ĐÃ CÓ BÀI TRÊN MÁY CHỦ trước lần ghi này — cờ do `_sheetToggleRec` đặt
    // LÚC BẤM. Không đọc `s.state` ở đây: lúc này ô đã sang 'recording'.
    var hadWork = (s && s.hadWork) || null;   // 'saved' | 'ungraded' | null
    // Máy có thể dừng ghi khi phiếu đã nhả ô ra (hết giờ tối đa, hoặc một lỗi
    // trước đó đã đặt lại recIdx). Không có ô để gắn thì bỏ bản ghi còn hơn
    // `slots[-1].state = …` làm nổ trang giữa lúc học viên đang làm bài.
    if (!s) return;
    s.prevState = null;
    _sheet.recIdx = -1;
    _sheetSubmitBlob(s, blob, hadWork);
  }

  function _sheetRetrySubmission(i) {
    var s = _sheet && _sheet.slots[i];
    if (!s || !s.retryBlob || s.state === 'grading') return;
    _sheetSubmitBlob(s, s.retryBlob, s.retryHadWork || null);
  }

  function _sheetSubmitBlob(s, blob, hadWork) {
    var generation = _playerGeneration;
    s.retryBlob = null;
    s.retryHadWork = null;
    s.state = 'grading';
    s.error = null;
    _renderSheet();

    _submitGradingEager(_sessionId, s.q.id, blob, {
      rethrow: true,
      priorResponseId: s.resp && (s.resp.id || s.resp.response_id),
    })
      .then(function (res) {
        if (!_playerActive || generation !== _playerGeneration) return;
        var g = (res && res.grading) ? res.grading : res;
        // `_stub` = máy chủ đã LƯU bài nhưng bộ chấm hỏng (200, không phải lỗi
        // mạng — nên `catch` bên dưới không bao giờ chạy). Không đọc cờ này thì
        // ô hiện "Đã lưu" mà không có điểm, không một lời giải thích nào.
        var stub = !!(g && g._stub);
        s.state = stub ? 'ungraded' : 'saved';
        s.band = (g && g.overall_band) || null;
        if (stub && g._reason === 'reconciled_pending_grading') {
          s.error = (g._error || 'Bản ghi đã lưu, máy đang hoàn tất chấm câu này.')
            + ' Bạn vẫn có thể nộp bài; điểm sẽ cập nhật từ bản đã lưu.';
        } else {
          s.error = stub
            ? 'Bài của bạn đã lưu, nhưng máy chưa chấm được câu này. Bạn vẫn nộp '
              + 'được — hoặc ghi âm lại để thử chấm lần nữa.'
            : null;
        }
        // Giữ lý do máy chủ đưa để lượt điều tra sau đọc được từ console, mà
        // KHÔNG bày ra màn hình: học viên không cần đọc lỗi kỹ thuật.
        if (stub && g._reason) {
          try { console.warn('[sheet] chấm hỏng câu', s.q.id, '—', g._reason); } catch (e) {}
        }
        // Giữ NGUYÊN phản hồi chấm để "Xem nhận xét" đọc được ngay, không bắt
        // học viên tải lại trang mới thấy nhận xét của câu mình vừa nói.
        // Hình dạng ở đây đã là hình dạng `_showFeedback` nhận, nên đánh dấu
        // để `_sheetReview` khỏi cố dựng lại từ một dòng cơ sở dữ liệu.
        s.resp = g ? Object.assign({}, g, { _live: true }) : null;
        s.retryBlob = null;
        s.retryHadWork = null;
      })
      .catch(function (err) {
        if (!_playerActive || generation !== _playerGeneration) return;
        // KHÔNG để ô về "đã lưu": bài này chưa tới server, và để nó xanh nghĩa
        // là học viên bấm Nộp rồi mất câu trả lời mà không biết.
        //
        // Nhưng nếu ô ĐÃ CÓ bài từ trước thì bản cũ vẫn còn nguyên trên server:
        // hạ nó về 'chưa làm' là nói sai và khoá luôn nút Nộp. Chỉ lần ghi ĐẦU
        // TIÊN giữ trạng thái retry cùng chính blob ấy.
        s.state = hadWork || 'retry';
        s.retryBlob = blob;
        s.retryHadWork = hadWork;
        s.error = hadWork
          ? 'Lần ghi âm lại này chưa gửi được — bản ghi trước vẫn còn. Bạn có thể gửi lại bản mới.'
          : 'Chưa gửi được câu này. Bản ghi vẫn còn trên thiết bị — hãy gửi lại.';
      })
      .then(function () {
        if (_playerActive && generation === _playerGeneration) _renderSheet();
      });
  }

  /**
   * Xem lại một câu của phiếu: DÙNG LẠI đúng màn nhận xét của luồng luyện tập.
   *
   * Không dựng một bộ vẽ rút gọn riêng — học viên đã quen màn kia, và hai bộ
   * vẽ cho cùng một nội dung là hai chỗ để trôi khỏi nhau.
   */
  var _sheetAudioUrls = null;      // question_id → URL đã ký
  var _sheetReviewRun = 0;

  /**
   * URL phát lại của các câu trong phiên. Nạp MỘT lần, lúc cần đầu tiên: bài
   * tập lớp có tới 12 câu và phần lớn lượt mở phiếu không xem lại câu nào.
   * Hỏng thì trả `{}` — màn xem lại vẫn có nhận xét, chỉ thiếu nút nghe.
   */
  async function _loadSheetAudioUrls() {
    if (_sheetAudioUrls) return _sheetAudioUrls;
    var generation = _playerGeneration;
    var sessionId = _sessionId;
    try {
      // Endpoint trả một MẢNG [{question_id, url}], không phải object — dựng
      // bảng tra ở đây thay vì đoán hình dạng.
      var rows = await window.api.get('/sessions/' + sessionId + '/audio-urls');
      if (!_playerActive || generation !== _playerGeneration || sessionId !== _sessionId) return {};
      var map = {};
      (rows || []).forEach(function (x) {
        if (x && x.question_id && x.url) map[x.question_id] = x.url;
      });
      _sheetAudioUrls = map;
    } catch (e) {
      if (!_playerActive || generation !== _playerGeneration || sessionId !== _sessionId) return {};
      _sheetAudioUrls = {};
    }
    return _sheetAudioUrls;
  }

  async function _sheetReview(i) {
    var generation = _playerGeneration;
    var reviewRun = ++_sheetReviewRun;
    var s = _sheet && _sheet.slots[i];
    if (!s || !s.resp) return;
    _sheetReviewIdx = i;
    var urls = await _loadSheetAudioUrls();
    if (!_playerActive || generation !== _playerGeneration || reviewRun !== _sheetReviewRun) return;
    // TẮT test-mode trong lúc xem lại. `_showFeedback` mở đầu bằng một nhánh
    // test-mode gom kết quả rồi `_advanceTestMode()` — bài giao lớp HOÀN TOÀN
    // có thể mang mode `test_part` (admin chọn "Luyện từng Part"), nên bấm
    // "Xem nhận xét" sẽ đá học viên sang luồng tuần tự cũ thay vì hiện nhận
    // xét em ấy vừa xin xem.
    var savedMode = _testMode;
    _testMode = null;
    try {
      // `_live` = phản hồi vừa chấm xong (đã đúng hình dạng); còn lại là dòng
      // đọc từ cơ sở dữ liệu, phải dựng lại.
      var data = s.resp._live ? Object.assign({}, s.resp) : _respToFeedbackData(s.resp);
      data._review = true;
      data._reviewAudioUrl = urls[s.q.id]
        || (s.resp.audio_url && !s.resp._live ? s.resp.audio_url : null);
      _showFeedback(data);
    } finally {
      _testMode = savedMode;
    }
    // `_showFeedback` bật hai nút điều hướng của luồng phễu. Ở đây không có
    // "câu tiếp theo" — học viên đang xem lại MỘT ô và cần về đúng chỗ cũ.
    var n = $('btn-next-q'); if (n) n.style.display = 'none';
    var f = $('btn-finish'); if (f) f.style.display = 'none';
    var b = $('btn-back-sheet'); if (b) b.style.display = '';
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function _backToSheet() {
    _sheetReviewRun++;
    var b = $('btn-back-sheet'); if (b) b.style.display = 'none';
    _sheetReviewIdx = -1;
    _renderSheet();
    showState('sheet');
  }

  var _sheetReviewIdx = -1;

  async function _sheetSubmit() {
    if (_sheetSubmitting) return;
    var generation = _playerGeneration;
    var sessionId = _sessionId;
    var unsent = _sheet && _sheet.slots
      ? _sheet.slots.filter(function (s) { return !!s.retryBlob; }).length
      : 0;
    if (unsent) {
      if (typeof window.confirm !== 'function') {
        var unavailableMessage =
          'Còn bản ghi mới chưa gửi được. Hãy gửi lại bản ghi trước khi nộp bài.';
        if (!_updateNativeView('sheet', { submitNote: unavailableMessage })) {
          var unavailableNote = $('sheet-submit-note');
          if (unavailableNote) unavailableNote.textContent = unavailableMessage;
        }
        return;
      }
      var confirmSubmit = window.confirm(
          'Còn ' + unsent + ' bản ghi mới chưa gửi được. Nộp bây giờ sẽ dùng '
          + 'bản cũ trên máy chủ và bỏ các bản ghi mới. Bạn vẫn muốn nộp?'
      );
      if (!confirmSubmit) return;
    }
    _sheetSubmitting = true;
    var nativeSubmit = _updateNativeView('sheet', { submitting: true });
    var btn = nativeSubmit ? null : $('btn-sheet-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang nộp…'; }
    // Completion may fail and leave the learner on this page. Release rather
    // than destroy so the microphone indicator always turns off and a retry or
    // re-record can still acquire a fresh controller session.
    _releaseRecorderResources();
    try {
      await window.api.patch('/sessions/' + sessionId + '/complete', {});
    } catch (err) {
      if (!_playerActive || generation !== _playerGeneration) return;
      _sheetSubmitting = false;
      var failureMessage = 'Chưa nộp được: ' + (err.message || err) + '. Bấm lại giúp nhé.';
      if (_updateNativeView('sheet', {
        submitting: false,
        submitNote: failureMessage,
      })) return;
      if (btn) { btn.disabled = false; btn.textContent = 'Nộp bài'; }
      $('sheet-submit-note').textContent = failureMessage;
      return;
    }
    if (!_playerActive || generation !== _playerGeneration || sessionId !== _sessionId) return;
    window.location.href = _singleSessionResultUrl(sessionId);
  }

  function nextQuestion() {
    if (_recSubState === 'recording') {
      _showRecError('Hãy nhấn "Dừng ghi âm" trước khi sang câu tiếp theo.');
      return;
    }
    if (_currentIdx >= _questions.length - 1) return;
    _currentIdx++;
    _showPrep();
  }

  function _releaseRecorderResources() {
    if (_timerId) { _clearManagedEffect('recording-elapsed', _timerId, 'interval'); _timerId = null; }
    _stopWaveform();
    _clearP2SubmissionRetry();
    var nativeRecorder = _getNativeRecorder();
    if (nativeRecorder) {
      nativeRecorder.release();
    } else {
      if (_recorder && _recorder.state !== 'inactive') {
        _recorder.onstop = null;
        try { _recorder.stop(); } catch (_) {}
      }
      _recorder = null;
      if (_stream) {
        _stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
        _stream = null;
      }
      if (_audioCtx) { try { _audioCtx.close(); } catch (_) {} _audioCtx = null; }
    }
    _analyser = null;
  }

  async function finishSession() {
    var generation = _playerGeneration;
    var sessionId = _sessionId;
    if (_recSubState === 'recording') {
      _showRecError('Hãy nhấn "Dừng ghi âm" trước khi hoàn thành phiên.');
      return;
    }
    var btn = $('btn-finish');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }

    // Clean up timers and TTS
    if (_p2PrepTimerId)  {
      _clearManagedEffect('p2-prep-countdown', _p2PrepTimerId, 'interval');
      _p2PrepTimerId = null;
    }
    if (_p2SpeakTimerId) {
      _clearManagedEffect('p2-speak-countdown', _p2SpeakTimerId, 'interval');
      _p2SpeakTimerId = null;
    }
    _clearManagedEffect('p2-thank-you-delay', null, 'timeout');
    _stopAITts();
    _cancelSpeech();

    // Release mic and AudioContext (native route + legacy fallback).
    _releaseRecorderResources();

    // Release feedback audio blob URL
    if (_feedbackAudioUrl && _feedbackAudioIsBlob) {
      _revokeManagedObjectUrl('feedback-audio', _feedbackAudioUrl);
    }
    _feedbackAudioUrl = null;
    _feedbackAudioIsBlob = false;

    try {
      await window.api.patch('/sessions/' + sessionId + '/complete', {});
    } catch (err) {
      if (!_playerActive || generation !== _playerGeneration) return;
      console.warn('[practice] session complete failed:', err.message);
    }

    if (!_playerActive || generation !== _playerGeneration || sessionId !== _sessionId) return;
    window.location.href = _singleSessionResultUrl(sessionId);
  }

  function destroy() {
    if (!_playerActive) return;
    _playerActive = false;
    _playerGeneration++;
    _processingRun++;
    _sheetReviewRun++;

    if (_processingTimer) {
      _clearManagedEffect('processing-copy', _processingTimer, 'interval');
      _processingTimer = null;
    }
    if (_p2PrepTimerId) {
      _clearManagedEffect('p2-prep-countdown', _p2PrepTimerId, 'interval');
      _p2PrepTimerId = null;
    }
    if (_p2SpeakTimerId) {
      _clearManagedEffect('p2-speak-countdown', _p2SpeakTimerId, 'interval');
      _p2SpeakTimerId = null;
    }
    _clearManagedEffect('p2-thank-you-delay', null, 'timeout');
    _clearManagedEffect('recording-error-hide', null, 'timeout');
    _clearManagedEffect('grammar-entry-flash', null, 'timeout');

    _ttsGeneration++;
    _stopAITts();
    _cancelSpeech();
    _ttsCache.clear();
    _releaseRecorderResources();
    _teardownRecordedPlayback();
    _applyListenOnlyUI(false);

    if (_feedbackReplayAudio) {
      _feedbackReplayAudio.onended = null;
      _feedbackReplayAudio.onerror = null;
      try { _feedbackReplayAudio.pause(); } catch (_) {}
      _feedbackReplayAudio = null;
    }
    if (_feedbackAudioUrl && _feedbackAudioIsBlob) {
      _revokeManagedObjectUrl('feedback-audio', _feedbackAudioUrl);
    }
    _feedbackAudioUrl = null;
    _feedbackAudioIsBlob = false;

    if (_sheetAudio) {
      _sheetAudio.onended = null;
      _sheetAudio.onerror = null;
      try { _sheetAudio.pause(); } catch (_) {}
      try { _sheetAudio.removeAttribute('src'); } catch (_) {}
      _sheetAudio = null;
    }

    _currentState = null;
    _recSubState = 'idle';
    _recordedBlob = null;
    _sessionId = null;
    _sessionData = null;
    _questions = [];
    _currentQ = null;
    _currentIdx = 0;
    _testMode = null;
    _testResults = [];
    _ftAllSessionIds = [];
    _sittingId = null;
    _sheet = null;
    _sheetSubmitting = false;
    _fullTestRetryInFlight = false;
    _sheetAudioUrls = null;
    _sheetReviewIdx = -1;
    _meterTopBound = false;
    _currentUserId = null;
    if (_grammarFlashEntry) {
      _grammarFlashEntry.classList.remove('is-flash');
      _grammarFlashEntry = null;
    }
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
    if (_updateNativeView('prep', {
      revealTextVisible: true,
      revealButtonVisible: false,
    })) return;
    var revealWrap = $('prep-text-reveal');
    var revealBtn  = $('prep-reveal-btn');
    if (revealWrap) revealWrap.style.display = '';
    if (revealBtn)  revealBtn.style.display  = 'none';
  }

  // ── Escape HTML ───────────────────────────────────────────────────────────────

  function _esc(s) {
    // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
    // local fallback kept so this module is safe if window.WC hasn't loaded.
    return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
      ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  function _handleSheetSlotsClick(e) {
    var listen = e.target.closest('[data-listen]');
    if (listen) { _sheetListen(Number(listen.dataset.listen)); return; }
    var rev = e.target.closest('[data-review]');
    if (rev) { _sheetReview(Number(rev.dataset.review)); return; }
    var retry = e.target.closest('[data-retry]');
    if (retry && !retry.disabled) {
      _sheetRetrySubmission(Number(retry.dataset.retry));
      return;
    }
    var rec = e.target.closest('[data-rec]');
    if (rec && !rec.disabled) _sheetToggleRec(Number(rec.dataset.rec));
  }

  function _bindSheet() {
    var slots = $('sheet-slots');
    if (!slots) return;
    // React buttons call the public actions directly. Binding this delegated
    // legacy listener as well would execute listen/record/retry twice.
    if (_getNativeView()) return;
    // Uỷ quyền: phiếu được vẽ lại sau MỖI thay đổi trạng thái, nên nút gắn tay
    // sẽ mất ngay ở lần vẽ kế tiếp.
    _listenManaged('sheet-slots-click', slots, 'click', _handleSheetSlotsClick);
    var btn = $('btn-sheet-submit');
    if (btn) _listenManaged('sheet-submit-click', btn, 'click', _sheetSubmit);
  }

  function _isNextPracticeBootstrap(bootstrap) {
    return !!bootstrap
      && bootstrap.source === 'next-native-bootstrap-v1'
      && typeof bootstrap.sessionId === 'string'
      && bootstrap.sessionId.length > 0
      && !!bootstrap.sessionData
      && typeof bootstrap.sessionData === 'object'
      && !Array.isArray(bootstrap.sessionData)
      && Array.isArray(bootstrap.questions)
      && bootstrap.questions.length > 0;
  }

  function _assertFullTestResponseLookup(sessionData) {
    if (!sessionData
        || sessionData.mode !== 'test_full'
        || sessionData.response_lookup_failed !== true) return;
    var lookupError = /** @type {any} */ (
      new Error('Không thể đọc tiến độ Full Test. Hãy tải lại trang trước khi ghi âm tiếp.')
    );
    lookupError.code = 'response_lookup_failed';
    throw lookupError;
  }

  async function init(bootstrap) {
    var generation = ++_playerGeneration;
    _playerActive = true;
    _sittingId = null;
    _ftAllSessionIds = [];
    _sheet = null;
    _sheetSubmitting = false;
    _fullTestRetryInFlight = false;
    _testMode = null;
    _bindPlayerEffects();
    _bindSheet();
    showState('loading');

    // Kick off grammar article index fetch in background (ready before feedback shown)
    _fetchGrArticleIndex();

    // The Next route owns auth + session/question loading. Legacy pages still
    // call init() with no argument and retain the exact existing bootstrap.
    // Fail closed if a caller tries to pass a partial/forged handoff: falling
    // back to a second network bootstrap would hide a broken route contract.
    var hasNextBootstrap = _isNextPracticeBootstrap(bootstrap);

    if (bootstrap && !hasNextBootstrap) {
      var handoffError = /** @type {any} */ (new Error('invalid-next-practice-bootstrap'));
      handoffError.code = 'invalid_handoff';
      handoffError.userMessage = 'Dữ liệu khởi động bài luyện không hợp lệ. Hãy tải lại trang.';
      throw handoffError;
    }

    if (hasNextBootstrap) {
      _currentUserId = bootstrap.userId || null;
      _sessionId = bootstrap.sessionId;
    } else {
      var sb = window.getSupabase && window.getSupabase();
      if (!sb) { showError('Không thể khởi tạo Supabase.'); return; }

      var result = await sb.auth.getSession();
      if (!_playerActive || generation !== _playerGeneration) return;
      if (!result.data.session) {
        window.location.href = window.api.url('login.html');
        return;
      }
      // Stamp any debt WE create with the owner, so a shared browser cannot let
      // one account's 403 delete another account's record.
      _currentUserId = (result.data.session.user && result.data.session.user.id) || null;

      var params = new URLSearchParams(window.location.search);
      _sessionId = params.get('session_id');
    }

    // Settle an unpaid Speaking report from a previous visit — AFTER the
    // session check, never at top level. practice.js is deferred while
    // initSupabase() runs in a later inline script, so a top-level call carries
    // no Bearer token: it 401s, api.js redirects to login and resolves null,
    // and the success handler then CLEARS the debt (Codex review, PR #847).
    _retryOwedSpeakingReport();

    if (!_sessionId) {
      showError('Thiếu session_id trong URL. Hãy bắt đầu phiên mới từ Dashboard.');
      return;
    }

    // Load stored Part 2 topic for Full Test chaining
    try { _ftP2Topic = sessionStorage.getItem('ielts_ft_p2topic') || null; } catch (_) {}

    var loadMsg = $('loading-msg');

    try {
      var questions;
      if (hasNextBootstrap) {
        _sessionData = bootstrap.sessionData;
        _assertFullTestResponseLookup(_sessionData);
        questions = bootstrap.questions.slice();
      } else {
        if (loadMsg) loadMsg.textContent = 'Đang tải session...';
        _sessionData = await window.api.get('/sessions/' + _sessionId);
        if (!_playerActive || generation !== _playerGeneration) return;
        _assertFullTestResponseLookup(_sessionData);

        if (loadMsg) loadMsg.textContent = 'Đang tải câu hỏi...';
        questions = await window.api.get('/sessions/' + _sessionId + '/questions');
        if (!_playerActive || generation !== _playerGeneration) return;

        if (!questions || questions.length === 0) {
          if (loadMsg) loadMsg.textContent = 'Đang tạo câu hỏi với AI...';
          questions = await window.api.post('/sessions/' + _sessionId + '/questions/generate', {});
          if (!_playerActive || generation !== _playerGeneration) return;
        }
      }

      if (!questions || questions.length === 0) {
        showError('Không thể tạo câu hỏi. Hãy kiểm tra kết nối mạng và thử lại.');
        return;
      }

      // Detect test mode
      _testMode = (_sessionData.mode === 'test_part' || _sessionData.mode === 'test_full')
        ? _sessionData.mode : null;
      _testResults = [];

      // 4-skill mock: this speaking full-test belongs to a sealed sitting (the
      // opening session was created with sitting_id). Carry it so later parts
      // are created linked too, and so we can complete Speaking at the end.
      if (_sessionData.sitting_id) _sittingId = _sessionData.sitting_id;
      // Full Test: initialise multi-part tracking on the opening session.
      // Spike-2 fix: RESTORE the chain persisted by earlier parts so a
      // refresh (or same-tab handoff) mid full-test keeps Part 1's session
      // id and finalize aggregates the right sessions. Membership check
      // keeps a stale chain from an OLDER full test out; anything after the
      // current session is truncated — those parts are being redone, and
      // advancing will mint fresh sessions for them.
      if (_testMode === 'test_full' && _ftAllSessionIds.length === 0) {
        var storedChain = _loadFtChain();
        var chainPos    = storedChain ? storedChain.indexOf(_sessionId) : -1;
        _ftCurrentPart   = _sessionData.part;
        _ftAllSessionIds = (chainPos !== -1)
          ? storedChain.slice(0, chainPos + 1)
          : [_sessionId];
        _saveFtChain();
        // B1: reset submit-failure trackers for a fresh full test.
        _ftSubmitTotal      = 0;
        _ftSubmitFailures   = [];
        _ftSubmitKeys       = {};
        _ftSubmitFailureKeys = {};
        _ftLegacyPending    = {};
        _ftCompleteFailures = 0;
      }

      if (_testMode) {
        if (!_updateNativeView('frame', { testModeBannerVisible: true })) {
          var banner = $('test-mode-banner');
          if (banner) banner.style.display = '';
        }
        // Slice questions to official exam count for test mode
        var qCountTable = (_testMode === 'test_full') ? FULL_TEST_Q_COUNT : TEST_Q_COUNT;
        var partKey     = (_testMode === 'test_full') ? _ftCurrentPart : _sessionData.part;
        var maxQ = qCountTable[partKey] || questions.length;
        questions = questions.slice(0, maxQ);

        // A historical incomplete persisted set must not run as a shorter exam.
        if (_testMode === 'test_full' && questions.length < maxQ) {
          showError(
            'Không tạo đủ câu hỏi cho Full Test Part ' + partKey + ' (cần ' + maxQ +
            ', nhận được ' + questions.length + '). ' +
            'Vui lòng quay lại Dashboard và thử lại.'
          );
          return;
        }
      }

      _questions  = questions;
      _currentIdx = 0;

      // Native Full Test persists confirmed question ids as they upload. This
      // works even for sealed mock sittings where GET /sessions intentionally
      // withholds response rows until release. Resume at the first unconfirmed
      // answer; if this part was already done, continue/finalize idempotently.
      var nativeFullTest = _testMode === 'test_full' ? _getNativeFullTest() : null;
      if (nativeFullTest) {
        nativeFullTest.confirmCanonical(
          _sessionId,
          ((_sessionData && _sessionData.responses) || []).concat(
            (_sessionData && _sessionData.response_receipts) || []
          )
        );
        var confirmedIds = nativeFullTest.confirmedQuestionIds(_sessionId);
        var confirmedSet = {};
        confirmedIds.forEach(function (id) { confirmedSet[id] = true; });
        while (_currentIdx < _questions.length &&
               confirmedSet[_questions[_currentIdx].id || _questions[_currentIdx].question_id]) {
          _currentIdx++;
        }
        if (_currentIdx >= _questions.length) {
          if (_ftCurrentPart < 3) {
            _startNextPartInFullTest(_ftCurrentPart + 1);
          } else {
            _fireAndForgetFullTestGrading();
          }
          return;
        }
      }

      // Spike-2 fix (defect g): with eager uploads, answered test_part
      // questions are already graded server-side — resume at the first
      // UNANSWERED question instead of forcing a redo from Q1 (which would
      // re-grade every answer). test_part only: practice keeps its flow;
      // sealed mock sittings return responses=[] and start at 0 as before.
      if (_testMode === 'test_part' && _sessionData.responses && _sessionData.responses.length) {
        var _answeredQ = {};
        _sessionData.responses.forEach(function (r) {
          if (r.question_id) _answeredQ[r.question_id] = true;
        });
        while (_currentIdx < _questions.length &&
               _answeredQ[_questions[_currentIdx].id || _questions[_currentIdx].question_id]) {
          _currentIdx++;
        }
        if (_currentIdx >= _questions.length) {
          // Refresh landed AFTER the last answer was submitted: everything
          // is graded — complete the session and go straight to the
          // canonical result page.
          _finishTestAndShowResults();
          return;
        }
      }

      // Show a warning banner if Gemini was unavailable and fallback questions are being used
      var isFallback = questions.some(function (q) { return q._fallback; });
      if (!_updateNativeView('prep', { fallbackWarningVisible: isFallback })) {
        var fallbackBanner = $('prep-fallback-warning');
        if (fallbackBanner) {
          fallbackBanner.style.display = isFallback ? '' : 'none';
        }
      }

      // Routing to first question:
      //  • BÀI TẬP LỚP nhiều câu → PHIẾU LÀM BÀI (hai ô cùng hiện, lưu từng ô)
      //  • Part 2        → cue card flow; skip mode-choice
      //  • test_full     → force listening (exam mode); hide question text
      //  • test_part     → force listening
      //  • practice      → default visual; skip mode-choice screen
      //
      // Phiếu đứng TRƯỚC mọi nhánh khác: nó là hình dạng của bài tập lớp, và
      // các nhánh dưới đều giả định màn phễu một-câu-một-lúc.
      if (_initSheet()) {
        // phiếu đã dựng xong
      } else if (_sessionData && _sessionData.part === 2) {
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
      if (!_playerActive || generation !== _playerGeneration) return;
      showError('Không thể tải session: ' + (err.message || 'Lỗi không xác định'));
    }
  }

  // ── PDF Export ────────────────────────────────────────────────────────────────

  // Download PDF for each session in the test (or just the current session).
  // btn — the button element (disabled during download to prevent double-click).
  async function _downloadPDFs(btn) {
    var generation = _playerGeneration;
    _clearManagedEffect('pdf-button-reset', null, 'timeout');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang tạo PDF...'; }

    var sessionIds = _ftAllSessionIds.length > 0 ? _ftAllSessionIds : [_sessionId];
    // F2 note: this path deliberately uses a raw authed fetch (not window.api.*)
    // because the response is a binary PDF blob — api.js's helpers JSON-parse the
    // body, which would corrupt the download. Only the Bearer token is reused.
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
        if (!_playerActive || generation !== _playerGeneration) return;
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var blob = await res.blob();
        if (!_playerActive || generation !== _playerGeneration) return;
        var urlKey = 'pdf-download-' + i + '-' + Date.now();
        var url = _createManagedObjectUrl(urlKey, blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'IELTS_Report_Part' + (i + 1) + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        (function (ownedKey, ownedUrl) {
          _startManagedTimeout('revoke-' + ownedKey, function () {
            _revokeManagedObjectUrl(ownedKey, ownedUrl);
          }, 3000);
        }(urlKey, url));
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
        _startManagedTimeout('pdf-button-reset', function () {
          if (btn) btn.textContent = '📄 Tải xuống báo cáo PDF';
        }, 3000);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  window.PracticeApp = {
    init:                 init,
    destroy:              destroy,
    goToRecording:        goToRecording,
    startRecording:       startRecording,
    stopRecording:        stopRecording,
    resetRecording:       resetRecording,
    submitRecording:      submitRecording,
    nextQuestion:         nextQuestion,
    finishSession:        finishSession,
    backToSheet:          _backToSheet,
    sheetListen:          _sheetListen,
    sheetReview:          _sheetReview,
    sheetRetrySubmission: _sheetRetrySubmission,
    sheetToggleRecording: _sheetToggleRec,
    submitSheet:          _sheetSubmit,
    startP2Prep:          startP2Prep,
    startP2SpeakingEarly: startP2SpeakingEarly,
    stopP2SpeakingEarly:  stopP2SpeakingEarly,
    retryP2Submission:    retryP2Submission,
    discardP2SubmissionRetry: discardP2SubmissionRetry,
    retryFullTestSubmissions: retryFullTestSubmissions,
    // Question mode (Part 1 & 3)
    setQMode:             _setQMode,
    playQuestion:         _playQuestion,
    chooseModeAndStart:   _chooseModeAndStart,
    revealQuestionText:   _revealQuestionText,
    // Audio replay / download on feedback screen
    replayAudio:          _replayAudio,
    downloadAudio:        _downloadAudio,
    trackGrammarResource: _trackGrammarResource,
    // PDF export
    downloadPDFs:         _downloadPDFs,
    // Sprint 14.8 — exposed for the cue-card / part-router tests +
    // future re-use. Pure functions, no DOM access.
    _grammarCheckBlock:                _grammarCheckBlock,
    _renderTranscriptWithHighlights:   _renderTranscriptWithHighlights,
    _nativeFeedbackDetails:            _nativeFeedbackDetails,
    _nativeTranscriptSegments:         _nativeTranscriptSegments,
    _nativePronunciationView:          _nativePronunciationView,
    _nativeTestResultsView:            _nativeTestResultsView,
  };

  // Sprint 14.8 — bidirectional linking (Pattern #32) between the
  // transcript highlights and the inline grammar list. A single
  // delegated click listener handles both directions: clicking a
  // <mark class="ds-grammar-highlight"> scrolls + flashes the matching
  // <li class="ds-grammar-error-item">; clicking the <li> itself does
  // the same (so the link is reciprocal for users who notice the list
  // first). Keyboard accessibility: Enter / Space on a focused span
  // performs the same scroll.
  function _scrollToGrammarEntry(errorId) {
    if (!errorId) return;
    var entry = document.querySelector(
      '.ds-grammar-error-item[data-error-id="' + errorId + '"]'
    );
    if (!entry) return;
    if (_grammarFlashEntry && _grammarFlashEntry !== entry) {
      _grammarFlashEntry.classList.remove('is-flash');
    }
    _grammarFlashEntry = entry;
    entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
    entry.classList.add('is-flash');
    _startManagedTimeout('grammar-entry-flash', function () {
      entry.classList.remove('is-flash');
      if (_grammarFlashEntry === entry) _grammarFlashEntry = null;
    }, 1500);
  }
  var _grammarFlashEntry = null;

  function _handleGrammarClick(e) {
    var hl = e.target.closest && e.target.closest('.ds-grammar-highlight');
    if (hl) {
      _scrollToGrammarEntry(hl.getAttribute('data-error-id'));
      return;
    }
    // Reverse direction — click on the list entry scrolls to the
    // first matching highlight on the transcript. Skipped when the
    // transcript surface isn't in view (e.g. test mode hides it).
    var li = e.target.closest && e.target.closest('.ds-grammar-error-item');
    if (li) {
      var id = li.getAttribute('data-error-id');
      var mark = id && document.querySelector(
        '.ds-grammar-highlight[data-error-id="' + id + '"]'
      );
      if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function _handleGrammarKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var hl = e.target && e.target.closest && e.target.closest('.ds-grammar-highlight');
    if (!hl) return;
    e.preventDefault();
    _scrollToGrammarEntry(hl.getAttribute('data-error-id'));
  }

  function _bindPlayerEffects() {
    var onceCapture = { once: true, capture: true };
    _listenManaged('interaction-click', document, 'click', _markInteracted, onceCapture);
    _listenManaged('interaction-keydown', document, 'keydown', _markInteracted, onceCapture);
    _listenManaged('interaction-touchstart', document, 'touchstart', _markInteracted, onceCapture);
    _listenManaged('grammar-click', document, 'click', _handleGrammarClick);
    _listenManaged('grammar-keydown', document, 'keydown', _handleGrammarKeydown);
    if (window.speechSynthesis) {
      _listenManaged(
        'tts-voiceschanged',
        window.speechSynthesis,
        'voiceschanged',
        _handleVoicesChanged,
      );
    }
  }

})();
