import { coreOperationRequest } from './core-operation-intent.mjs';

// This is observation only, not blob persistence, upload deduplication or
// grading. SpeakingSubmissionController still owns ordering and reconciliation.
export function createSpeakingOperationTransport({ enabled, request = coreOperationRequest,
  crypto = globalThis.crypto, timeoutMs = 500 }) {
  return function upload({ accountId, path, formData }, send) {
    let active = false;
    try { active = enabled() === true; } catch { /* observation is optional */ }
    if (!active) return send({}); // old path has no extra async boundary
    let timer;
    const prepare = async () => {
      const audio = formData.get('audio_file');
      const questionId = formData.get('question_id');
      if (typeof questionId !== 'string' || !audio || typeof audio.arrayBuffer !== 'function'
          || !Number.isFinite(audio.size) || audio.size <= 0 || audio.size > 50 * 1024 * 1024) {
        throw new Error('audio observation unavailable');
      }
      const bytes = await audio.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return { question_id: questionId, audio_sha256: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join(''),
        filename: String(audio.name || ''), content_type: String(audio.type || '') };
    };
    // The losing digest operation performs no storage/network writes. A slow
    // or unavailable digest must not block an otherwise valid learner upload.
    return Promise.race([
      prepare(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('audio observation timeout')), timeoutMs); }),
    ]).then(
      input => request({ accountId, method: 'POST', path, input, slot: input.question_id,
        acknowledged: value => typeof value?.response_id === 'string' && !!value.response_id }, send),
      () => send({}),
    ).finally(() => clearTimeout(timer));
  };
}

export const coreSpeakingUpload = createSpeakingOperationTransport({
  enabled: () => globalThis.window?.__AVER_RUNTIME_CONFIG__?.coreOperationCorrelationEnabled === true,
});
