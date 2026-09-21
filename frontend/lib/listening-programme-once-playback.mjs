/**
 * Start the browser player first, then persist the canonical one-play claim.
 * A rejected `play()` must never consume the attempt. If the acknowledgement
 * response is lost, `unconfirmed` lets the UI retry the same claim without
 * playing the audio a second time.
 *
 * @param {{play(): Promise<void>, pause(): void}} audio
 * @param {() => Promise<boolean>} acknowledge
 * @returns {Promise<{state: 'ready'|'playing'|'unconfirmed'|'done', message: string}>}
 */
export async function startProgrammeOncePlayback(audio, acknowledge) {
  try {
    await audio.play();
  } catch {
    return {
      state: 'ready',
      message: 'Trình duyệt chưa phát được audio. Lượt nghe của bạn vẫn còn.',
    };
  }
  try {
    const accepted = await acknowledge();
    if (accepted) return { state: 'playing', message: '' };
    audio.pause();
    return {
      state: 'done',
      message: 'Lượt nghe đã được bắt đầu trên một cửa sổ hoặc thiết bị khác.',
    };
  } catch {
    audio.pause();
    return {
      state: 'unconfirmed',
      message: 'Audio đã bắt đầu nhưng chưa xác nhận được lượt nghe. Hãy xác nhận lại.',
    };
  }
}

/**
 * Retry only the canonical acknowledgement; never call play() again.
 * @param {{play(): Promise<void>, pause(): void}} audio
 * @param {() => Promise<boolean>} acknowledge
 * @returns {Promise<{state: 'paused'|'unconfirmed'|'done', message: string}>}
 */
export async function confirmProgrammeOncePlayback(audio, acknowledge) {
  try {
    const accepted = await acknowledge();
    return accepted
      ? { state: 'paused', message: '' }
      : {
          state: 'done',
          message: 'Lượt nghe đã được bắt đầu trên một cửa sổ hoặc thiết bị khác.',
        };
  } catch {
    audio.pause();
    return {
      state: 'unconfirmed',
      message: 'Chưa xác nhận được lượt nghe. Vui lòng thử lại.',
    };
  }
}
