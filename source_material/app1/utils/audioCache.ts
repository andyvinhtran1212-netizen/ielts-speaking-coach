// utils/audioCache.ts
const CACHE_PREFIX = 'ielts_audio_cache_';
const CACHE_VERSION = 'v1'; // To invalidate old caches if needed

/**
 * Creates a simple hash from a string to use as a key.
 * This avoids storing potentially very long strings in localStorage keys.
 */
const getKey = (text: string): string => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return `${CACHE_PREFIX}${CACHE_VERSION}_${hash}`;
};

/**
 * Retrieves cached audio from localStorage.
 * @param text The original text of the audio to retrieve.
 * @returns The base64 encoded audio string, or null if not found.
 */
export const getCachedAudio = (text: string): string | null => {
    try {
        const key = getKey(text);
        return localStorage.getItem(key);
    } catch (error) {
        console.error("Error getting cached audio:", error);
        return null;
    }
};

/**
 * Stores audio in localStorage. If storage is full, it clears the old audio cache and retries.
 * @param text The original text used to generate the audio.
 * @param base64Audio The base64 encoded audio string to store.
 */
export const setCachedAudio = (text: string, base64Audio: string): void => {
    try {
        const key = getKey(text);
        localStorage.setItem(key, base64Audio);
    } catch (error) {
        if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
            console.warn("LocalStorage quota exceeded. Clearing all app audio cache and retrying.");
            
            // Collect all keys to remove
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(CACHE_PREFIX)) {
                    keysToRemove.push(key);
                }
            }
            
            // Remove them
            keysToRemove.forEach(key => localStorage.removeItem(key));

            // Retry setting the item
            try {
                const key = getKey(text);
                localStorage.setItem(key, base64Audio);
            } catch (retryError) {
                console.error("Error setting cached audio even after clearing cache. The audio file might be too large for localStorage.", retryError);
            }
        } else {
            console.error("Error setting cached audio:", error);
        }
    }
};
