"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import CrystalizedBall from "./CrystalizedBall";

type DustParticle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number };
const MAX_STREAM_PARTICLES = 360;
const STREAM_PARTICLES_PER_SECOND = 180;

export default function CrystalizedWave({ playing, disabled, onClick }: { playing: boolean; disabled: boolean; onClick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const particles = useRef<DustParticle[]>([]);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const receive = (event: Event) => setLevel((event as CustomEvent<number>).detail || 0);
    window.addEventListener("trapchik:audio-level", receive);
    return () => window.removeEventListener("trapchik:audio-level", receive);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const button = buttonRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true, desynchronized: true });
    if (!canvas || !button || !ctx) return;

    const resize = () => {
      // A 1x overlay keeps the full-screen dust inexpensive on high-DPI phones.
      canvas.width = Math.max(1, window.innerWidth);
      canvas.height = Math.max(1, window.innerHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let previousTime = 0;
    let emissionRemainder = 0;
    const frame = (now: number) => {
      raf = 0;
      if (previousTime && now - previousTime < 32) { raf = requestAnimationFrame(frame); return; }
      const dt = previousTime ? Math.min(0.075, (now - previousTime) / 1000) : 1 / 30;
      previousTime = now;

      const bounds = button.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      if (playing) {
        emissionRemainder += dt * STREAM_PARTICLES_PER_SECOND;
        const count = Math.floor(emissionRemainder);
        emissionRemainder -= count;
        const surfaceRadius = Math.min(bounds.width, bounds.height) * 0.35;
        for (let i = 0; i < count && particles.current.length < MAX_STREAM_PARTICLES; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 100 + Math.random() * 220;
          const life = 1.1 + Math.random() * 1.1;
          const startRadius = surfaceRadius * (0.92 + Math.random() * 0.12);
          particles.current.push({
            x: centerX + Math.cos(angle) * startRadius,
            y: centerY + Math.sin(angle) * startRadius,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life,
            maxLife: life,
            size: 0.8 + Math.random() * 1.8,
          });
        }
      } else {
        emissionRemainder = 0;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const buckets: Path2D[] = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      const alphaLevels = [0.18, 0.38, 0.62, 0.86];
      let activeCount = 0;
      for (let i = particles.current.length - 1; i >= 0; i--) {
        const particle = particles.current[i];
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 1 - dt * 0.18;
        particle.vy *= 1 - dt * 0.18;
        particle.life -= dt;
        if (particle.life <= 0) {
          particles.current.splice(i, 1);
          continue;
        }
        activeCount++;
        const alpha = particle.life / particle.maxLife;
        const bucket = Math.min(3, Math.floor(alpha * 4));
        const radius = Math.max(0.35, particle.size * (0.35 + alpha * 0.65));
        buckets[bucket].moveTo(particle.x + radius, particle.y);
        buckets[bucket].arc(particle.x, particle.y, radius, 0, Math.PI * 2);
      }
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < buckets.length; i++) {
        ctx.fillStyle = `rgba(255, 211, 110, ${alphaLevels[i]})`;
        ctx.fill(buckets[i]);
      }
      ctx.globalCompositeOperation = "source-over";

      if (playing || activeCount) raf = requestAnimationFrame(frame);
      else previousTime = 0;
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [playing]);

  function activate(_event: MouseEvent<HTMLButtonElement>) {
    onClick();
  }

  return <div className="waveExperience">
    <canvas ref={canvasRef} className={`waveBurstCanvas${playing ? " active" : ""}`} aria-hidden="true" />
    <div className="waveTitle">МОЯ ВОЛНА</div>
    <button ref={buttonRef} type="button" disabled={disabled} className={`crystalWaveButton${playing ? " isPlaying" : ""}`} onClick={activate} aria-label={playing ? "Перемешать Мою волну и продолжить воспроизведение" : "Запустить Мою волну"}>
      <CrystalizedBall className="crystalizedWaveBall" preset="solar" color={playing ? "#FFD36E" : "#858585"} size={0.7} crackle={0.7} fill={0.55} interactive hoverStrength={playing ? 1 : 0.35} flares={playing ? 1 : 0.25} glow={playing ? 1.1 : 0.32} sparks={playing ? 1 : 0.15} particleCount={13500} sway={0.7} haze={playing ? 0.8 : 0.22} dustSpeed={2} speed={1.55} audioLevel={level} paused={!playing} />
    </button>
  </div>;
}
