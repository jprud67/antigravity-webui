import React, { useEffect, useRef, useState } from 'react';

interface VoiceWaveformVisualizerProps {
  isActive: boolean;
  height?: number;
  barCount?: number;
  className?: string;
}

export const VoiceWaveformVisualizer: React.FC<VoiceWaveformVisualizerProps> = ({
  isActive,
  height = 36,
  barCount = 28,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasMicAccess, setHasMicAccess] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isActive) return;

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let stream: MediaStream | null = null;
    let animationFrameId: number | null = null;
    let simulatedPhase = 0;

    const setupAudio = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setHasMicAccess(false);
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

        if (!AudioContextClass) {
          setHasMicAccess(false);
          return;
        }

        audioCtx = new AudioContextClass();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        setHasMicAccess(true);
      } catch (err) {
        console.warn('Microphone stream access unavailable for visualizer:', err);
        setHasMicAccess(false);
      }
    };

    setupAudio();

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, width, h);

      const totalBars = barCount;
      const barWidth = Math.max(3, (width - (totalBars - 1) * 3) / totalBars);
      const gap = 3;

      if (analyser) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        for (let i = 0; i < totalBars; i++) {
          const dataIndex = Math.min(Math.floor((i / totalBars) * bufferLength), bufferLength - 1);
          const rawValue = dataArray[dataIndex] || 0;
          const normalized = rawValue / 255;
          const minBarHeight = 4;
          const barHeight = Math.max(minBarHeight, normalized * (h - 6));
          const x = i * (barWidth + gap);
          const y = (h - barHeight) / 2;

          const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
          gradient.addColorStop(0, '#38BDF8');
          gradient.addColorStop(0.5, '#818CF8');
          gradient.addColorStop(1, '#C084FC');

          ctx.fillStyle = gradient;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, barWidth, barHeight, [barWidth / 2]);
          } else {
            ctx.rect(x, y, barWidth, barHeight);
          }
          ctx.fill();
        }
      } else {
        // Fallback animated sine wave equalizer bars
        simulatedPhase += 0.08;
        for (let i = 0; i < totalBars; i++) {
          const wave = Math.sin(simulatedPhase + i * 0.35) * 0.5 + 0.5;
          const minBarHeight = 4;
          const barHeight = Math.max(minBarHeight, wave * (h - 10));
          const x = i * (barWidth + gap);
          const y = (h - barHeight) / 2;

          const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
          gradient.addColorStop(0, '#06B6D4');
          gradient.addColorStop(1, '#6366F1');

          ctx.fillStyle = gradient;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, barWidth, barHeight, [barWidth / 2]);
          } else {
            ctx.rect(x, y, barWidth, barHeight);
          }
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (audioCtx) {
        try {
          audioCtx.close();
        } catch {}
      }
    };
  }, [isActive, barCount]);

  if (!isActive) return null;

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        width={barCount * 6}
        height={height}
        className="w-full max-w-[200px] sm:max-w-[280px] rounded-lg"
        style={{ height: `${height}px` }}
        title={
          hasMicAccess === false
            ? 'Animation d\'ondes vocales simulée'
            : 'Visualiseur de microphone en direct'
        }
      />
    </div>
  );
};
