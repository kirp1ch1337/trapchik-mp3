"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { MusicMoodId } from "@/lib/music";

export type SyncedLyric = { time: number; text: string };
export type PlayerTrack = { id: string; title: string; artist_name: string; description?: string | null; lyrics?: SyncedLyric[]; moods?: MusicMoodId[]; artworkUrl?: string; audioUrl: string; clipUrl?: string };

const audioGraphs = new WeakMap<HTMLAudioElement, { context: AudioContext; analyser: AnalyserNode }>();

function clock(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function PlayerIcon({ name }: { name: "previous" | "next" | "play" | "pause" | "repeat" | "expand" | "volume" }) {
  const common = { className: "playerIcon", viewBox: "0 0 24 24", "aria-hidden": true as const };
  if (name === "previous") return <svg {...common}><path d="M6 5v14M19 5 8 12l11 7z"/></svg>;
  if (name === "next") return <svg {...common}><path d="M18 5v14M5 5l11 7-11 7z"/></svg>;
  if (name === "play") return <svg {...common}><path d="m7 4 13 8-13 8z"/></svg>;
  if (name === "pause") return <svg {...common}><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>;
  if (name === "repeat") return <svg {...common}><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/></svg>;
  if (name === "expand") return <svg {...common}><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5M3 8l6-5M21 8l-6-5M21 16l-6 5M3 16l6 5"/></svg>;
  return <svg {...common}><path d="M4 10v4h4l5 4V6l-5 4H4zM17 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12"/></svg>;
}

export default function AudioPlayer({ track, onNext, onPrevious, onAudioLevel, onPlaybackChange }: { track: PlayerTrack | null; onNext: () => void; onPrevious: () => void; onAudioLevel: (level: number) => void; onPlaybackChange: (playing: boolean) => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [repeat, setRepeat] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const onAudioLevelRef = useRef(onAudioLevel);
  const onPlaybackChangeRef = useRef(onPlaybackChange);

  useEffect(() => { onAudioLevelRef.current = onAudioLevel; }, [onAudioLevel]);
  useEffect(() => { onPlaybackChangeRef.current = onPlaybackChange; }, [onPlaybackChange]);

  function markPlaying(value: boolean) {
    setPlaying(value);
    onPlaybackChangeRef.current(value);
    if (!value) onAudioLevelRef.current(0);
  }

  useEffect(() => {
    const el = audio.current;
    if (!el || typeof window === "undefined") return;
    let graph = audioGraphs.get(el);
    try {
      if (!graph) {
        const context = new window.AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.58;
        const source = context.createMediaElementSource(el);
        source.connect(analyser);
        analyser.connect(context.destination);
        graph = { context, analyser };
        audioGraphs.set(el, graph);
      }
    } catch {
      return;
    }
    const resumeAudio = () => { void graph!.context.resume().catch(() => undefined); };
    window.addEventListener("trapchik:resume-audio", resumeAudio);
    const values = new Uint8Array(graph.analyser.frequencyBinCount);
    let animation = 0;
    let idleTimer = 0;
    let lastSent = 0;
    let lastEnergy = 0;
    const sample = (now: number) => {
      graph!.analyser.getByteFrequencyData(values);
      if (el.paused) {
        if (lastEnergy !== 0) { lastEnergy = 0; onAudioLevelRef.current(0); }
        idleTimer = window.setTimeout(() => { animation = requestAnimationFrame(sample); }, 180);
        return;
      }
      let energy = 0;
      const bins = Math.min(40, values.length);
      // Emphasize kick and bass; averaging the spectrum made the sphere barely move.
      for (let i = 1; i < bins; i++) energy += (values[i] / 255) ** 2 * (i < 12 ? 2.2 : 0.7);
      energy = bins ? Math.sqrt(energy / bins) : 0;
      energy = Math.max(0, Math.min(1, (energy - 0.012) * 10));
      if (now - lastSent > 40) { onAudioLevelRef.current(energy); lastEnergy = energy; lastSent = now; }
      animation = requestAnimationFrame(sample);
    };
    animation = requestAnimationFrame(sample);
    return () => { cancelAnimationFrame(animation); window.clearTimeout(idleTimer); window.removeEventListener("trapchik:resume-audio", resumeAudio); };
  }, []);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (track) {
      const expectedSource = new URL(track.audioUrl, window.location.href).href;
      if (el.src === expectedSource && !el.paused) { setPlaying(true); return; }
    }
    el.pause();
    markPlaying(false);
    setPosition(0);
    setDuration(0);
    if (track) {
      const graph = audioGraphs.get(el);
      if (graph) void graph.context.resume().catch(() => undefined);
      void el.play().then(() => markPlaying(true)).catch(() => markPlaying(false));
    }
  }, [track?.id]);

  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);

  async function toggle() {
    const el = audio.current;
    if (!el || !track) return;
    if (el.paused) { try { const graph = audioGraphs.get(el); if (graph) await graph.context.resume(); await el.play(); markPlaying(true); } catch { markPlaying(false); } }
    else { el.pause(); markPlaying(false); }
  }

  useEffect(() => {
    const open = () => setFullscreen(true);
    window.addEventListener("trapchik:open-player-fullscreen", open);
    return () => window.removeEventListener("trapchik:open-player-fullscreen", open);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setFullscreen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [fullscreen]);

  return <>
    <audio id="trapchik-audio-player" ref={audio} src={track?.audioUrl} crossOrigin="anonymous" preload={track ? "metadata" : "none"} loop={repeat} style={!track ? { display: "none" } : undefined} onPlay={() => markPlaying(true)} onPause={() => markPlaying(false)} onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)} onEnded={() => { if (!repeat) onNext(); }} />
    {!track ? null : <>
    <aside className="playerDock hasTrack" aria-label="Музыкальный плеер" onClick={event => {
      const target = event.target;
      if (target instanceof Element && target.closest("button,input,select,textarea,a,label,[role='button'],[role='slider']")) return;
      setFullscreen(true);
    }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setFullscreen(true); } }} tabIndex={0}>
      <div className="playerIdentity">
        {track.artworkUrl ? <Image src={track.artworkUrl} alt="" width={52} height={52} unoptimized /> : <div className="playerArtwork">♫</div>}
        <div className="playerTitles"><b>{track.title}</b><span>{track.artist_name}</span></div>
      </div>
      <div className="playerControls">
        <div className="playerButtons">
          <button type="button" aria-label="Предыдущий трек" title="Предыдущий трек" onClick={onPrevious}><PlayerIcon name="previous"/></button>
          <button type="button" className="playerPlay" aria-label={playing ? "Пауза" : "Воспроизвести"} title={playing ? "Пауза" : "Воспроизвести"} onClick={toggle}><PlayerIcon name={playing ? "pause" : "play"}/></button>
          <button type="button" aria-label="Следующий трек" title="Следующий трек" onClick={onNext}><PlayerIcon name="next"/></button>
          <button type="button" className={repeat ? "active" : ""} aria-label="Повторять трек" title="Повторять трек" aria-pressed={repeat} onClick={() => setRepeat(v => !v)}><PlayerIcon name="repeat"/></button>
          <button type="button" aria-label="Развернуть плеер" title="Развернуть плеер" onClick={() => setFullscreen(true)}><PlayerIcon name="expand"/></button>
        </div>
        <div className="playerTimeline"><time>{clock(position)}</time><input aria-label="Позиция воспроизведения" type="range" min={0} max={duration || 0} step="0.1" value={Math.min(position, duration || 0)} disabled={!duration} onChange={e => { if (audio.current) audio.current.currentTime = Number(e.target.value); }} /><time>{clock(duration)}</time></div>
      </div>
      <label className="playerVolume" title="Громкость"><PlayerIcon name="volume"/><input aria-label="Громкость" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>
    </aside>
    {fullscreen && <div className="playerFullscreen" role="dialog" aria-modal="true" aria-label="Полноэкранный плеер">
      <button className="playerFullscreenClose" type="button" aria-label="Закрыть полноэкранный плеер" onClick={() => setFullscreen(false)}>×</button>
      <NowPlayingPanel track={track} playing={playing} onToggle={toggle} onNext={onNext} onPrevious={onPrevious} />
    </div>}
    </>}
  </>;
}

export function NowPlayingPanel({ track, playing, onToggle, onNext, onPrevious }: {
  track: PlayerTrack | null;
  playing: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const clip = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setPosition(0);
    setDuration(0);
  }, [track?.id]);

  useEffect(() => {
    const audio = document.getElementById("trapchik-audio-player") as HTMLAudioElement | null;
    const video = clip.current;
    if (!audio) return;
    let raf = 0;
    let lastPaint = 0;
    const sync = (now: number) => {
      if (video && track?.clipUrl) {
        if (Math.abs(video.currentTime - audio.currentTime) > 0.7) {
          try { video.currentTime = audio.currentTime; } catch { /* wait for video metadata */ }
        }
        if (playing && video.paused) void video.play().catch(() => undefined);
        else if (!playing && !video.paused) video.pause();
      }
      if (now - lastPaint > 180) {
        setPosition(audio.currentTime || 0);
        setDuration(audio.duration || 0);
        lastPaint = now;
      }
      if (playing) raf = requestAnimationFrame(sync);
    };
    if (track?.clipUrl) {
      if (Math.abs(video!.currentTime - audio.currentTime) > 0.7) video!.currentTime = audio.currentTime;
      if (playing) void video!.play().catch(() => undefined);
    }
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [track?.id, track?.clipUrl, playing]);

  if (!track) return null;
  const activeLyric = track.lyrics?.reduce((active, line, index) => line.time <= position ? index : active, -1) ?? -1;
  return <section className="nowPlayingPanel" aria-label="Сейчас играет">
    <div className="nowPlayingMain">
      <div className="nowPlayingVisual">
        {track.clipUrl ? <video ref={clip} src={track.clipUrl} poster={track.artworkUrl} muted loop playsInline preload="metadata" /> : track.artworkUrl ? <Image src={track.artworkUrl} alt={`Обложка: ${track.title}`} fill sizes="(max-width: 900px) 100vw, 65vw" unoptimized /> : <div className="nowPlayingNoClip">♫</div>}
        <button className="nowPlayingExpand" type="button" aria-label="Открыть полноэкранный плеер" onClick={() => window.dispatchEvent(new Event("trapchik:open-player-fullscreen"))}><PlayerIcon name="expand"/></button>
        <div className="nowPlayingVisualCaption"><span className="liveDot"/> {track.clipUrl ? "КЛИП" : "СЕЙЧАС ИГРАЕТ"}</div>
      </div>
      <aside className="nowPlayingLyrics">
        <h3><span>♫</span> Текст песни</h3>
        {track.lyrics?.length ? <div className="lyricsScroll" aria-live="polite">{track.lyrics.map((line, index) => <p className={index === activeLyric ? "lyricLine active" : "lyricLine"} key={`${line.time}-${index}`}>{line.text}</p>)}</div> : <div className="lyricsEmpty">Текст песни пока не добавлен</div>}
      </aside>
    </div>
    <div className="nowPlayingTrackBar">
      <div className="nowPlayingArtwork">{track.artworkUrl ? <Image src={track.artworkUrl} alt="" width={94} height={94} unoptimized /> : <span>♫</span>}</div>
      <div className="nowPlayingMeta"><span className="nowPlayingBadge"><i/> Сейчас играет</span><h2>{track.title}</h2><p>{track.artist_name}</p></div>
      <div className="nowPlayingControls">
        <div className="nowPlayingButtons"><button type="button" aria-label="Предыдущий трек" onClick={onPrevious}><PlayerIcon name="previous"/></button><button type="button" className="nowPlayingPlay" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={onToggle}><PlayerIcon name={playing ? "pause" : "play"}/></button><button type="button" aria-label="Следующий трек" onClick={onNext}><PlayerIcon name="next"/></button></div>
        <div className="nowPlayingTimeline"><time>{clock(position)}</time><input aria-label="Позиция воспроизведения" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration || 0)} disabled={!duration} onChange={e => { const audio = document.getElementById("trapchik-audio-player") as HTMLAudioElement | null; if (audio) audio.currentTime = Number(e.target.value); }} /><time>{clock(duration)}</time></div>
      </div>
    </div>
    <details className="nowPlayingDescription" open><summary><b>▤　Описание трека</b><span>⌄</span></summary><p>{track.description || "Исполнитель пока не добавил описание этого трека."}</p></details>
  </section>;
}
