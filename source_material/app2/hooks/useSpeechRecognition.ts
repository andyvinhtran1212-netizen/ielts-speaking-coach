
import { useState, useEffect, useRef, useCallback } from 'react';

// START FIX: Add manual type definitions for the Web Speech API to resolve TypeScript errors.
// These types are not always available in the default TypeScript DOM library.
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

// Represents an instance of the speech recognition object.
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
}
// END FIX

// Check for vendor-prefixed implementations.
// FIX: Correctly access SpeechRecognition properties on `window` which may not be in standard types.
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

interface SpeechRecognitionHookProps {
  onResult: (transcript: string) => void;
  onEnd?: () => void; 
}

interface SpeechRecognitionControls {
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
  error: string | null;
}

export const useSpeechRecognition = ({ onResult, onEnd }: SpeechRecognitionHookProps): SpeechRecognitionControls => {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const isSupported = !!SpeechRecognition;

  useEffect(() => {
    if (!isSupported) {
      setError("Speech recognition is not supported in this browser. For the best experience, please use Google Chrome or Microsoft Edge.");
      return;
    }
    
    const recognition: SpeechRecognition = new SpeechRecognition();
    recognition.continuous = true; // Keep listening even after a pause in speech.
    recognition.interimResults = true; // Get results as they are being spoken for real-time feedback.
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Rebuild the full transcript from the results list on every event.
      // This is more robust than accumulating parts and prevents duplication.
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = 0; i < event.results.length; ++i) {
        const transcriptPart = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcriptPart;
        } else {
          interimTranscript += transcriptPart;
        }
      }
      onResult(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      let errMessage;
      if (event.error === 'no-speech') {
        errMessage = "No speech was detected. Please make sure your microphone is working.";
      } else if (event.error === 'audio-capture') {
        errMessage = "Microphone not available. Please ensure it is connected and not in use by another app.";
      } else if (event.error === 'not-allowed') {
        errMessage = "Microphone permission was denied. Please allow microphone access in your browser settings to use this feature.";
      } else {
        errMessage = `An error occurred with speech recognition: ${event.error}`;
      }
      setError(errMessage);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (onEnd) {
        onEnd();
      }
    };
    
    recognitionRef.current = recognition;

    // Cleanup: stop recognition if the component unmounts.
    return () => {
      recognition.stop();
    };
  }, [isSupported, onResult, onEnd]);

  const startListening = useCallback(() => {
    if (isListening || !recognitionRef.current) return;
    
    // Clear the display for a new session.
    onResult(''); 
    
    try {
      recognitionRef.current.start();
      setIsListening(true);
      setError(null);
    } catch(err) {
      console.error("Error starting speech recognition:", err);
      setError("Could not start listening. Please wait a moment and try again.");
    }
  }, [isListening, onResult]);

  const stopListening = useCallback(() => {
    if (!isListening || !recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  }, [isListening]);
  
  return { isListening, startListening, stopListening, isSupported, error };
};
