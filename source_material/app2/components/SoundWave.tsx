import React, { useRef, useEffect } from 'react';

interface SoundWaveProps {
  mediaStream: MediaStream | null;
  width?: number;
  height?: number;
  baseColor?: string;      // Color for low-intensity sound
  activeColor?: string;    // Color for high-intensity sound
  backgroundColor?: string;
}

// Helper to parse a hex color string into RGB components
const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
};

// Helper to linearly interpolate between two colors
const interpolateColor = (color1: string, color2: string, factor: number): string => {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);

  if (!c1 || !c2) return color2; // Fallback to the active color on parsing error

  // Clamp factor to be between 0 and 1
  const clampedFactor = Math.max(0, Math.min(factor, 1));

  const result = {
    r: Math.round(c1.r + clampedFactor * (c2.r - c1.r)),
    g: Math.round(c1.g + clampedFactor * (c2.g - c1.g)),
    b: Math.round(c1.b + clampedFactor * (c2.b - c1.b)),
  };

  return `rgb(${result.r}, ${result.g}, ${result.b})`;
};


const SoundWave: React.FC<SoundWaveProps> = ({ 
  mediaStream, 
  width = 200, 
  height = 50, 
  baseColor = '#E5E7EB',   // Tailwind gray-200
  activeColor = '#007BFF', // Primary blue
  backgroundColor = 'transparent' 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const audioStuffRef = useRef<{
    animationFrameId: number | null,
    audioContext: AudioContext | null,
    analyser: AnalyserNode | null,
    source: MediaStreamAudioSourceNode | null,
  }>({
    animationFrameId: null,
    audioContext: null,
    analyser: null,
    source: null,
  });

  useEffect(() => {
    const audioStuff = audioStuffRef.current;
    
    if (mediaStream && mediaStream.active) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(mediaStream);
      
      source.connect(analyser);
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7; // Smoother, more responsive animation

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      audioStuff.audioContext = audioContext;
      audioStuff.analyser = analyser;
      audioStuff.source = source;

      const canvas = canvasRef.current;
      const canvasCtx = canvas?.getContext('2d');

      const draw = () => {
        if (!audioStuff.analyser || !canvas || !canvasCtx) return;

        audioStuff.animationFrameId = requestAnimationFrame(draw);
        audioStuff.analyser.getByteFrequencyData(dataArray);

        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        canvasCtx.fillStyle = backgroundColor;
        canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        const barWidth = 4;
        const gap = 2;
        const numBars = Math.floor(canvasWidth / (barWidth + gap));
        const step = Math.floor(bufferLength / numBars);

        canvasCtx.lineWidth = barWidth;
        canvasCtx.lineCap = 'round';

        for (let i = 0; i < numBars; i++) {
          const dataIndex = i * step;
          const value = dataArray[dataIndex] / 255.0; // Normalize value [0, 1]
          
          let barHeight = value * canvasHeight;
          barHeight = Math.max(1, barHeight); // Minimum height of 1px

          const x = i * (barWidth + gap) + (barWidth / 2);
          const y1 = canvasHeight / 2 - barHeight / 2;
          const y2 = canvasHeight / 2 + barHeight / 2;
          
          // Determine bar color based on its height (intensity)
          canvasCtx.strokeStyle = interpolateColor(baseColor, activeColor, value);

          canvasCtx.beginPath();
          canvasCtx.moveTo(x, y1);
          canvasCtx.lineTo(x, y2);
          canvasCtx.stroke();
        }
      };

      draw();
    }

    return () => {
      if (audioStuff.animationFrameId) {
        cancelAnimationFrame(audioStuff.animationFrameId);
      }
      if (audioStuff.source) {
        audioStuff.source.disconnect();
      }
      if (audioStuff.audioContext && audioStuff.audioContext.state !== 'closed') {
        audioStuff.audioContext.close();
      }
      Object.assign(audioStuff, {
          animationFrameId: null,
          audioContext: null,
          analyser: null,
          source: null,
      });
    };
  }, [mediaStream, baseColor, activeColor, backgroundColor, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="rounded-lg" />;
};

export default SoundWave;