import { useState, useRef, useCallback, useEffect } from 'react';

export const useAudioRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const isUnmountedRef = useRef(false);
  const isStartingRef = useRef(false);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    try {
      // Stop any existing recording first
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      if (isUnmountedRef.current) {
          // If component unmounted while waiting for user permission
          stream.getTracks().forEach(track => track.stop());
          isStartingRef.current = false;
          return;
      }

      streamRef.current = stream;
      setMediaStream(stream);

      const options = { mimeType: 'audio/mp4' };
      let recorder;
      if (MediaRecorder.isTypeSupported(options.mimeType)) {
        recorder = new MediaRecorder(stream, options);
      } else {
        console.warn(`${options.mimeType} is not supported, falling back to default available type.`);
        recorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = recorder;

      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error starting recording:", err);
      throw err; // Propagate the error to the caller
    } finally {
      isStartingRef.current = false;
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.onstop = () => {
          const mimeType = mediaRecorderRef.current?.mimeType || 'audio/mp4';
          const newAudioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          streamRef.current?.getTracks().forEach(track => track.stop());
          setMediaStream(null);
          streamRef.current = null;
          resolve(newAudioBlob);
        };
        mediaRecorderRef.current.onerror = (event) => {
            console.error("MediaRecorder error:", event);
            reject(event);
        };

        mediaRecorderRef.current.stop();
        setIsRecording(false);
      } else {
        // Resolve with an empty blob if not recording or already stopped
        const mimeType = mediaRecorderRef.current?.mimeType || 'audio/mp4';
        resolve(new Blob([], { type: mimeType }));
      }
    });
  }, []);

  return { isRecording, startRecording, stopRecording, mediaStream };
};