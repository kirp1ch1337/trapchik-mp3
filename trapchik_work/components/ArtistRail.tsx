"use client";

import { useRef, useState, type PointerEvent } from "react";

export type ArtistRailItem = { key: string; name: string; count: number };

export default function ArtistRail({ artists, selectedArtist, onSelect }: {
  artists: ArtistRailItem[];
  selectedArtist: string | null;
  onSelect: (name: string) => void;
}) {
  const ringRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const [cursorActive, setCursorActive] = useState(false);

  function moveCursor(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const ring = ringRef.current;
    const dot = dotRef.current;
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-artist-card]") : null;
    if (!ring || !dot) return;
    dot.style.transform = `translate3d(${event.clientX - 3}px,${event.clientY - 3}px,0)`;
    if (!target) { ring.style.opacity = "0"; return; }
    const bounds = target.getBoundingClientRect();
    ring.style.width = `${bounds.width}px`;
    ring.style.height = `${bounds.height}px`;
    ring.style.transform = `translate3d(${bounds.left}px,${bounds.top}px,0)`;
    ring.style.opacity = "1";
  }

  function hideCursor() {
    setCursorActive(false);
    if (ringRef.current) ringRef.current.style.opacity = "0";
    if (dotRef.current) dotRef.current.style.opacity = "0";
  }

  return <div className={`artistTabs${cursorActive ? " cursorHover" : ""}`} role="group" aria-label="Список артистов" onPointerEnter={event => { if (event.pointerType !== "touch") { setCursorActive(true); if (ringRef.current) ringRef.current.style.opacity = "1"; if (dotRef.current) dotRef.current.style.opacity = "1"; } }} onPointerMove={moveCursor} onPointerLeave={hideCursor}>
    {artists.map((artist, index) => {
      const active = selectedArtist?.toLocaleLowerCase("ru-RU") === artist.key;
      return <button type="button" data-artist-card key={artist.key} aria-pressed={active} className={`artistTab artistColor${index % 5}${active ? " active" : ""}`} onClick={() => onSelect(artist.name)}>
        <span>{artist.name}</span><small>{artist.count} {artist.count === 1 ? "трек" : "треков"}</small>
      </button>;
    })}
    <span ref={ringRef} className="artistCursorRing" aria-hidden="true" />
    <span ref={dotRef} className="artistCursorDot" aria-hidden="true" />
  </div>;
}
