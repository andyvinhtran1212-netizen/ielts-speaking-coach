// This utility manages a single, shared AudioContext instance for the entire application.
// This is crucial for handling browser autoplay policies, which require an AudioContext
// to be resumed (unlocked) by a direct user gesture before it can play any sound.

let audioContext: AudioContext | null = null;

/**
 * Returns the singleton AudioContext instance, creating it if it doesn't exist.
 * This allows the browser to select the optimal sample rate for the user's hardware.
 * @returns {AudioContext} The shared AudioContext instance.
 */
export const getAudioContext = (): AudioContext => {
  if (!audioContext || audioContext.state === 'closed') {
    try {
        // By not specifying a sampleRate, we allow the browser to choose the best
        // one for the device, which prevents conflicts with microphone input.
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
        console.error("Web Audio API is not supported in this browser.", e);
        // Return a dummy object or throw an error to handle gracefully
        throw new Error("AudioContext is not supported.");
    }
  }
  return audioContext;
};

/**
 * Unlocks the shared AudioContext if it's in a 'suspended' state.
 * This function MUST be called as a direct result of a user gesture (e.g., a click event).
 * It also unlocks the SpeechSynthesis API for iOS Safari.
 */
export const unlockAudioContext = async () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      console.log("AudioContext is suspended, attempting to resume...");
      await ctx.resume();
      console.log("AudioContext resumed successfully.");
    }
  } catch (e) {
      console.error("Failed to resume AudioContext:", e);
  }

  // Unlock SpeechSynthesis for iOS Safari
  if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(' ');
      utterance.volume = 0; // Silent
      window.speechSynthesis.speak(utterance);
  }
};
