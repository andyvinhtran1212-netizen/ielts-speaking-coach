

import React, { useRef, useEffect } from 'react';
import { getAudioContext } from '../utils/audioContext';

interface WaveformVisualizerProps {
  mediaStream: MediaStream | null;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({ mediaStream }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!mediaStream || !canvasRef.current) return;

    let audioContext: AudioContext;
    try {
        audioContext = getAudioContext();
    } catch {
        console.error("Web Audio API is not supported in this browser.");
        return;
    }

    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);

    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    let animationFrameId: number;

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      if (canvasCtx) {
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw center line
        canvasCtx.lineWidth = 1;
        canvasCtx.strokeStyle = 'rgba(229, 231, 235, 0.5)'; // neutral-200
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, canvas.height / 2);
        canvasCtx.lineTo(canvas.width, canvas.height / 2);
        canvasCtx.stroke();

        // Draw waveform
        canvasCtx.lineWidth = 3;
        canvasCtx.strokeStyle = '#4F46E5'; // brand-primary (indigo-600)
        canvasCtx.lineCap = 'round';
        canvasCtx.lineJoin = 'round';
        canvasCtx.beginPath();

        const sliceWidth = canvas.width * 1.0 / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = v * canvas.height / 2;

          if (i === 0) {
            canvasCtx.moveTo(x, y);
          } else {
            canvasCtx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        canvasCtx.lineTo(canvas.width, canvas.height / 2);
        canvasCtx.stroke();
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      source.disconnect();
    };
  }, [mediaStream]);

  return (
    <div className="w-full h-full flex items-center justify-center">
        <canvas ref={canvasRef} width="600" height="96" className="w-full h-full opacity-80"></canvas>
    </div>
  );
};