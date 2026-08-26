import { createActiveTimer } from './course-active-timer.js';

/** Course pronunciation + shadowing: one sentence at a time, one final submit. */

const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const DB_NAME = 'aver-course-pronunciation';
const DB_VERSION = 1;
const STORE = 'recordings';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return resolve(null);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(key, value) {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (_error) { /* a broken draft cache must not block recording */ }
}

async function dbGet(key) {
  try {
    const db = await openDb();
    if (!db) return null;
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  } catch (_error) { return null; }
}

async function dbDelete(keys) {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      keys.forEach((key) => tx.objectStore(STORE).delete(key));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (_error) { /* best effort privacy cleanup */ }
}

function score(value) {
  return value == null ? '—' : String(Math.round(Number(value)));
}

function scoreTier(value) {
  if (value == null) return 'none';
  if (Number(value) < 60) return 'low';
  if (Number(value) < 80) return 'mid';
  return 'high';
}

function recorderOptions() {
  const candidates = [
    'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm',
  ];
  const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
  return mimeType ? { mimeType } : undefined;
}

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

const indexedDbDraftStore = { put: dbPut, get: dbGet, delete: dbDelete };

export function createPronunciation({ api, userId, assignmentItemId = null,
  draftStore = indexedDbDraftStore, now = () => Date.now() }) {
  let bankId = null;
  let exercise = null;
  let latest = null;
  let selected = 0;
  let speed = 0.85;
  let recorder = null;
  let stream = null;
  let chunks = [];
  let recordingId = null;
  let stopPromise = null;
  let finishStop = null;
  let destroyed = false;
  let microphoneGeneration = 0;
  let startingMicrophone = false;
  let clientId = null;
  let submitting = false;
  let errorMessage = '';
  let attemptNo = 1;
  const activeTimer = createActiveTimer(now);
  const recordings = new Map();
  const objectUrls = new Map();

  const sentences = () => exercise?.sentences || [];
  const attemptSuffix = () => attemptNo > 1 ? `:a${attemptNo}` : '';
  const cacheKey = (id) => `${userId}:${bankId}${attemptSuffix()}:${id}`;
  const attemptKey = (name) => `${userId}:${bankId}${attemptSuffix()}:attempt:${name}`;
  const attemptCacheKeys = () => [
    ...sentences().map((sentence) => cacheKey(sentence.id)),
    attemptKey('active'), attemptKey('client-id'),
  ];

  function setBlob(id, blob) {
    const old = objectUrls.get(id);
    if (old) URL.revokeObjectURL(old);
    recordings.set(id, blob);
    objectUrls.set(id, URL.createObjectURL(blob));
  }

  async function restore() {
    for (const sentence of sentences()) {
      const blob = await draftStore.get(cacheKey(sentence.id));
      if (blob instanceof Blob && blob.size) setBlob(sentence.id, blob);
    }
  }

  function clearRecordings() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    recordings.clear();
    objectUrls.clear();
  }

  async function persistActiveAttempt() {
    clientId = clientId || uuid();
    await Promise.all([
      draftStore.put(attemptKey('active'), true),
      draftStore.put(attemptKey('client-id'), clientId),
    ]);
  }

  async function clearAttemptCache() {
    await draftStore.delete(attemptCacheKeys());
  }

  function stopStream() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function renderResult() {
    const result = latest?.results || {};
    const rows = result.sentences || [];
    const weakest = rows.slice().sort((a, b) =>
      Number(a.accuracy_score ?? 999) - Number(b.accuracy_score ?? 999)).slice(0, 3);
    return `<article class="cp-shell cp-result">
      <button class="cp-back" id="cp-back" type="button">← Quay lại tổng kết</button>
      <header class="cp-result__hero"><div><p class="cp-kicker">Kết quả phát âm</p>
        <h2>${esc(exercise.title)}</h2><p>Kết quả được lưu từ ${latest.batch_count || 0} cụm chấm.</p></div>
        <strong>${score(latest.pronunciation_score)}<small>/100</small></strong></header>
      <ul class="cp-metrics">
        <li><span>Độ chính xác</span><b>${score(latest.accuracy_score)}</b></li>
        <li><span>Độ trôi chảy</span><b>${score(latest.fluency_score)}</b></li>
        <li><span>Độ đầy đủ</span><b>${score(latest.completeness_score)}</b></li>
      </ul>
      ${weakest.length ? `<section class="cp-focus"><p class="cp-kicker">Nên luyện lại trước</p>
        <div>${weakest.map((row) => `<span>Câu ${row.order} · ${score(row.accuracy_score)}/100</span>`).join('')}</div>
      </section>` : ''}
      <section class="cp-result__sentences"><h3>Kết quả từng câu</h3>
        ${rows.map((row) => {
          const weak = row.weak_words || [];
          const own = objectUrls.get(row.id);
          return `<article class="cp-result-row" data-tier="${scoreTier(row.accuracy_score)}">
            <header><span>Câu ${row.order}</span><b>${score(row.accuracy_score)}/100</b></header>
            <p lang="en">${esc(row.text)}</p>
            ${weak.length ? `<div class="cp-weak" aria-label="Từ cần luyện">${weak.slice(0, 8).map((word) =>
              `<span>${esc(word.word)} <b>${word.error_type === 'Omission' ? 'bỏ sót' : score(word.accuracy_score)}</b></span>`).join('')}</div>`
              : '<p class="cp-good">Không có từ nào dưới ngưỡng cần luyện.</p>'}
            ${own ? `<audio controls preload="metadata" src="${esc(own)}">Không phát được bản ghi.</audio>` : ''}
          </article>`;
        }).join('')}
      </section>
      <footer class="cp-submitbar"><p>Lượt luyện lại sẽ tạo một kết quả mới.</p>
        <button class="av-button av-button-primary" id="cp-new" type="button">Luyện lại ${sentences().length} câu</button></footer>
    </article>`;
  }

  function renderPractice() {
    const list = sentences();
    const current = list[selected];
    if (!current) return '';
    const recorded = recordings.size;
    const own = objectUrls.get(current.id);
    const isRecording = recordingId === current.id;
    const complete = recorded === list.length;
    return `<article class="cp-shell">
      <button class="cp-back" id="cp-back" type="button">← Quay lại tổng kết</button>
      <header class="cp-hero"><div><p class="cp-kicker">Phát âm & shadowing</p>
        <h2>${esc(exercise.title)}</h2><p>Nghe mẫu, shadow theo rồi thu từng câu. Hệ thống chỉ chấm khi bạn nộp đủ cả bộ.</p></div>
        <strong>${recorded}<small>/${list.length} đã thu</small></strong></header>
      <div class="cp-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${list.length}"
        aria-valuenow="${recorded}"><i style="width:${Math.round(100 * recorded / list.length)}%"></i></div>
      ${errorMessage ? `<p class="cp-error" role="alert">${esc(errorMessage)}</p>` : ''}
      <section class="cp-card" aria-labelledby="cp-sentence-title">
        <header><span>Câu ${current.order}/${list.length}</span><span>${own ? '✓ Đã thu' : 'Chưa thu'}</span></header>
        <h3 id="cp-sentence-title" lang="en">${esc(current.text)}</h3>
        <div class="cp-shadow">
          <div><p class="cp-kicker">1 · Nghe và shadow</p>
            <audio id="cp-sample" controls preload="metadata" src="${esc(current.audio_url || '')}">
              Không phát được audio mẫu.</audio></div>
          <div class="cp-speed" role="group" aria-label="Tốc độ audio mẫu">
            ${(exercise.playback_rates || [0.85, 1]).map((rate) =>
              `<button type="button" class="cp-speed-btn" data-cp-rate="${rate}" aria-pressed="${speed === Number(rate)}">${Number(rate).toFixed(2).replace(/\.?0+$/, '')}×</button>`).join('')}
          </div>
        </div>
        <div class="cp-record"><div><p class="cp-kicker">2 · Thu giọng của bạn</p>
          <p>${isRecording ? 'Đang thu — đọc trọn câu rồi bấm dừng.'
            : own ? 'Nghe lại bên dưới hoặc thu lại câu này.'
              : 'Bấm thu, chờ tín hiệu rồi đọc rõ cả câu.'}</p></div>
          <button class="cp-record-btn" id="cp-record" type="button" data-recording="${isRecording}">
            <i aria-hidden="true"></i>${isRecording ? 'Dừng thu' : own ? 'Thu lại' : 'Bắt đầu thu'}</button></div>
        ${own ? `<audio class="cp-own" controls preload="metadata" src="${esc(own)}">Không phát được bản ghi.</audio>` : ''}
        <footer class="cp-nav"><button type="button" id="cp-prev" ${selected ? '' : 'disabled'}>← Câu trước</button>
          <button type="button" id="cp-next" ${selected < list.length - 1 ? '' : 'disabled'}>Câu tiếp →</button></footer>
      </section>
      <section class="cp-queue"><header><div><p class="cp-kicker">Toàn bộ câu</p><h3>Kiểm tra trước khi nộp</h3></div>
        <span>${complete ? 'Đã sẵn sàng' : `Còn ${list.length - recorded} câu`}</span></header>
        <ol>${list.map((sentence, index) => `<li><button type="button" data-cp-index="${index}"
          aria-current="${index === selected ? 'step' : 'false'}"><span>${sentence.order}</span>
          <b>${esc(sentence.text)}</b><i>${recordings.has(sentence.id) ? 'Đã thu' : 'Chưa thu'}</i></button></li>`).join('')}</ol>
      </section>
      <footer class="cp-submitbar" id="cp-submitbar"><p>${complete
        ? recordingId
          ? '<strong>Đang thu âm.</strong> Hãy bấm dừng trước khi nộp.'
          : `<strong>Đã đủ ${list.length} câu.</strong> Một lần nộp, hệ thống tự chia các lượt chấm.`
        : `Bạn cần thu thêm <strong>${list.length - recorded}</strong> câu trước khi nộp.`}</p>
        <button class="av-button av-button-primary" id="cp-submit" type="button"
          ${complete && !submitting && !recordingId ? '' : 'disabled'}>${submitting ? 'Đang ghép và chấm…' : 'Nộp để chấm phát âm'}</button></footer>
    </article>`;
  }

  function render() {
    if (!exercise) return '';
    return latest?.status === 'completed' ? renderResult() : renderPractice();
  }

  async function stopRecording() {
    // Also invalidates an unresolved getUserMedia() request. Browsers do not
    // expose an AbortSignal here, so a generation guard owns cancellation.
    microphoneGeneration += 1;
    startingMicrophone = false;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      await stopPromise;
    }
  }

  async function toggleRecording() {
    errorMessage = '';
    if (recorder && recorder.state === 'recording') {
      await stopRecording();
      return false;
    }
    if (startingMicrophone) {
      await stopRecording();
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      errorMessage = 'Trình duyệt này chưa hỗ trợ ghi âm. Hãy dùng Chrome, Safari hoặc Edge phiên bản mới.';
      return false;
    }
    const sentence = sentences()[selected];
    const generation = ++microphoneGeneration;
    let requestedStream = null;
    startingMicrophone = true;
    try {
      requestedStream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      if (destroyed || generation !== microphoneGeneration) {
        requestedStream.getTracks().forEach((track) => track.stop());
        return false;
      }
      stream = requestedStream;
      startingMicrophone = false;
      chunks = [];
      recorder = new MediaRecorder(stream, recorderOptions());
      recordingId = sentence.id;
      stopPromise = new Promise((resolve) => { finishStop = resolve; });
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', async () => {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
          if (!destroyed && blob.size) {
            setBlob(sentence.id, blob);
            await draftStore.put(cacheKey(sentence.id), blob);
          }
        } finally {
          chunks = [];
          recordingId = null;
          recorder = null;
          stopStream();
          finishStop?.();
          finishStop = null;
          stopPromise = null;
        }
      }, { once: true });
      recorder.start();
      return true;
    } catch (_error) {
      requestedStream?.getTracks().forEach((track) => track.stop());
      if (generation === microphoneGeneration && !destroyed) {
        recordingId = null;
        errorMessage = 'Chưa mở được micro. Hãy cho phép truy cập micro rồi thử lại.';
      }
      return false;
    } finally {
      if (generation === microphoneGeneration) startingMicrophone = false;
    }
  }

  async function submit() {
    if (!exercise || recordings.size !== sentences().length || submitting || recordingId) return false;
    submitting = true;
    errorMessage = '';
    await persistActiveAttempt();
    const ids = sentences().map((sentence) => sentence.id);
    const form = new FormData();
    form.append('bank_id', bankId);
    if (assignmentItemId) form.append('class_item', assignmentItemId);
    form.append('client_id', clientId);
    form.append('sentence_ids', JSON.stringify(ids));
    form.append('duration_sec', String(activeTimer.seconds()));
    ids.forEach((id) => {
      const blob = recordings.get(id);
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('recordings', blob, `${id}.${ext}`);
    });
    try {
      latest = await api.upload('/api/quiz/course/pronunciation/submit', form);
      if (latest?.status === 'completed') {
        activeTimer.setActive(false);
        await clearAttemptCache();
        clientId = null;
      }
      return true;
    } catch (error) {
      errorMessage = `Chưa chấm được: ${error?.message || error}. Các bản ghi vẫn còn nguyên.`;
      return false;
    } finally {
      submitting = false;
    }
  }

  async function load(nextBankId) {
    bankId = nextBankId;
    try {
      const state = await api.get('/api/quiz/course/pronunciation?bank_id=' + encodeURIComponent(bankId)
        + (assignmentItemId ? '&class_item=' + encodeURIComponent(assignmentItemId) : ''));
      attemptNo = Math.max(1, Number(state?.attempt_no) || 1);
      exercise = state?.exercise || null;
      latest = state?.latest_attempt || null;
      activeTimer.reset();
      speed = Number(exercise?.playback_rates?.[0] || 0.85);
      if (exercise) {
        const [cachedActive, cachedClientId] = await Promise.all([
          draftStore.get(attemptKey('active')),
          draftStore.get(attemptKey('client-id')),
        ]);
        await restore();
        const hasDraft = recordings.size > 0;
        if (cachedActive === true || hasDraft) {
          if (latest?.status === 'completed'
              && cachedClientId && latest.client_id === cachedClientId) {
            // The same request finished while this tab was away. Its server
            // result is canonical; the cached upload is no longer a new draft.
            clearRecordings();
            await clearAttemptCache();
            clientId = null;
          } else {
            // A newer local retry must win over an older completed result.
            clientId = cachedClientId || uuid();
            await persistActiveAttempt();
            if (latest?.status === 'completed') latest = null;
          }
        } else if (latest?.status !== 'completed') {
          clientId = latest?.client_id || uuid();
          await persistActiveAttempt();
        }
      }
      errorMessage = latest?.status === 'failed' ? String(latest.error_message || '') : '';
      return !!exercise;
    } catch (error) {
      if (error?.status === 404) { exercise = null; return false; }
      throw error;
    }
  }

  return {
    get exists() { return !!exercise; },
    get count() { return sentences().length; },
    get isRecording() { return !!recordingId; },
    get submitting() { return submitting; },
    get completed() { return latest?.status === 'completed'; },
    get course() { return latest?.course || null; },
    load,
    render,
    setActive(active) { activeTimer.setActive(active); },
    select(index) { selected = Math.max(0, Math.min(sentences().length - 1, Number(index) || 0)); },
    move(delta) { selected = Math.max(0, Math.min(sentences().length - 1, selected + Number(delta || 0))); },
    setSpeed(rate) { speed = Number(rate) || 0.85; },
    applySpeed() {
      const audio = document.getElementById('cp-sample');
      if (!audio) return;
      audio.playbackRate = speed;
      if ('preservesPitch' in audio) audio.preservesPitch = true;
    },
    toggleRecording,
    stopRecording,
    submit,
    async newAttempt() {
      latest = null;
      selected = 0;
      clearRecordings();
      await clearAttemptCache();
      clientId = uuid();
      activeTimer.reset();
      await persistActiveAttempt();
    },
    destroy() {
      destroyed = true;
      microphoneGeneration += 1;
      startingMicrophone = false;
      if (recorder?.state === 'recording') recorder.stop();
      stopStream();
      clearRecordings();
    },
  };
}
