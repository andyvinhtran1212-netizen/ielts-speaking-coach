
import { useState, useRef, useCallback, useEffect } from 'react';

type RecorderState = 'inactive' | 'recording' | 'paused' | 'finished';

interface AudioRecorderControls {
  recorderState: RecorderState;
  audioURL: string | null;
  audioBlob: Blob | null;
  recordingTime: number;
  startRecording: () => void;
  stopRecording: () => void;
  resetRecording: () => void;
  error: string | null;
  mediaStream: MediaStream | null;
}

export const useAudioRecorder = ({ maxRecordingSeconds = 120 }: { maxRecordingSeconds?: number } = {}): AudioRecorderControls => {
  const [recorderState, setRecorderState] = useState<RecorderState>('inactive');
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const stopTimeoutRef = useRef<number | null>(null);

  const cleanupTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
    }
  }, []);
  
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && (recorderState === 'recording' || recorderState === 'paused')) {
      mediaRecorderRef.current.stop();
    }
    cleanupTimer();
  }, [recorderState, cleanupTimer]);


  const resetRecording = useCallback(() => {
    if (audioURL) {
      URL.revokeObjectURL(audioURL);
    }
    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        setMediaStream(null);
        mediaStreamRef.current = null;
    }
    setAudioURL(null);
    setAudioBlob(null);
    setRecorderState('inactive');
    audioChunksRef.current = [];
    setError(null);
    cleanupTimer();
    setRecordingTime(0);
  }, [audioURL, cleanupTimer]);
  
  const startRecording = async () => {
    resetRecording();
    setError(null);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setMediaStream(stream);

      // Preferred MIME types
      const mimeTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'];
      let selectedMime = '';
      for (const m of mimeTypes) {
          if (MediaRecorder.isTypeSupported(m)) {
              selectedMime = m;
              break;
          }
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMime });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Double check chunks
        const totalSize = audioChunksRef.current.reduce((acc, chunk) => acc + chunk.size, 0);
        
        if (totalSize === 0) {
            setError("No audio data captured. Please check your microphone and try again.");
            setRecorderState('inactive');
            return;
        }

        const currentAudioBlob = new Blob(audioChunksRef.current, { type: selectedMime || 'audio/webm' });
        const url = URL.createObjectURL(currentAudioBlob);
        setAudioBlob(currentAudioBlob);
        setAudioURL(url);
        setRecorderState('finished');
        
        // Stop all tracks to release the microphone
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            setMediaStream(null);
            mediaStreamRef.current = null;
        }
        cleanupTimer();
      };
      
      mediaRecorder.onerror = (event) => {
         console.error('Recorder error:', event);
         setError('An error occurred during recording.');
         setRecorderState('inactive');
         if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
         }
         cleanupTimer();
      };

      mediaRecorder.start(250); // Small interval to ensure data collection
      setRecorderState('recording');
      
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime(prevTime => prevTime + 1);
      }, 1000);
      
      stopTimeoutRef.current = window.setTimeout(stopRecording, maxRecordingSeconds * 1000);

    } catch (err) {
      console.error('Media access error:', err);
      setError('Could not access microphone. Please ensure permissions are granted.');
      setRecorderState('inactive');
    }
  };

  useEffect(() => {
    return () => {
      cleanupTimer();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [cleanupTimer]);

  return { recorderState, audioURL, audioBlob, startRecording, stopRecording, resetRecording, error, recordingTime, mediaStream };
};
