"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { MUSIC_ARTISTS, MUSIC_MOODS, splitArtistNames, type MusicArtistDefinition, type MusicMoodDefinition, type MusicMoodId } from "@/lib/music";

const BUCKET = "music-media";

function parseTimedLyrics(value: string) {
  return value.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^\[(\d+):(\d{2}(?:\.\d+)?)\]\s*(.+)$/);
    return match ? [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim() }] : [];
  });
}

type FileKind = "audio" | "video" | "image";
type RoleState = "checking" | "allowed" | "denied";
type Notice = { type: "success" | "error"; text: string } | null;
type AlbumTrackDraft = { key: string; title: string; artists: string; description: string; lyrics: string; moods: MusicMoodId[]; audio: File | null; video: File | null };
type SoonTrackDraft = { key: string; title: string; artists: string; preview: File | null };
type ManagedAlbum = { id: string; title: string; artist_name: string; artwork_key: string | null };
type ManagedTrack = { id: string; album_id: string | null; title: string; artist_name: string; track_number: number | null; original_audio_key: string | null; stream_audio_key: string | null; video_key: string | null; artwork_key: string | null };
type ManagedSoon = { id: string; title: string; artist_name: string; release_type: "single" | "ep" | "album"; release_at: string | null; description: string | null; artwork_key: string | null; track_count: number };

const MIME_BY_EXTENSION: Record<FileKind, Record<string, string>> = {
  audio: { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac" },
  video: { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" },
  image: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" },
};

function validateFile(file: File, kind: FileKind) {
  if (file.size === 0) return "Файл пустой. Выбери другой файл.";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const expectedMime = MIME_BY_EXTENSION[kind][extension];
  if (!expectedMime) {
    const formats = kind === "audio" ? "MP3, M4A, AAC, WAV, OGG или FLAC" : kind === "video" ? "MP4, WebM или MOV" : "JPG, PNG или WebP";
    return `Формат не поддерживается. Допустимые форматы: ${formats}.`;
  }
  const acceptedReportedTypes = new Set([expectedMime, ...(extension === "flac" ? ["audio/x-flac"] : []), ...(extension === "wav" ? ["audio/x-wav"] : [])]);
  if (file.type && !acceptedReportedTypes.has(file.type.toLowerCase())) return "Тип выбранного файла не совпадает с его расширением.";
  return null;
}

function artistsToText(value: string) {
  return value.split(/[\n,;]+/).map(name => name.trim()).filter(Boolean).join(", ");
}

function MoodPicker({ definitions, value, onChange }: { definitions: MusicMoodDefinition[]; value: MusicMoodId[]; onChange: (value: MusicMoodId[]) => void }) {
  function toggle(mood: MusicMoodId) {
    onChange(value.includes(mood) ? value.filter(item => item !== mood) : [...value, mood]);
  }
  return <div className="moodPicker">{definitions.map(mood => <label key={mood.id} className={`moodCheck${value.includes(mood.id) ? " selected" : ""}`} style={{ "--mood-color": mood.color } as CSSProperties}>
    <input type="checkbox" checked={value.includes(mood.id)} onChange={() => toggle(mood.id)} />
    <span className="moodCheckDot" />{mood.name}
  </label>)}</div>;
}

function ArtistPicker({ artists, value, onChange }: { artists: MusicArtistDefinition[]; value: string[]; onChange: (value: string[]) => void }) {
  function toggle(name: string) {
    onChange(value.some(item => item.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))
      ? value.filter(item => item.toLocaleLowerCase("ru-RU") !== name.toLocaleLowerCase("ru-RU"))
      : [...value, name]);
  }
  return <div className="adminArtistPicker">{artists.map((artist, index) => {
    const selected = value.some(item => item.toLocaleLowerCase("ru-RU") === artist.name.toLocaleLowerCase("ru-RU"));
    return <label key={artist.id} className={`adminArtistOption artistColor${index % 5}${selected ? " selected" : ""}`}>
      <input type="checkbox" checked={selected} onChange={() => toggle(artist.name)} />{artist.name}
    </label>;
  })}</div>;
}

function artistsChosenFromDefinitions(value: string, definitions: MusicArtistDefinition[]) {
  return splitArtistNames(value).filter(name => definitions.some(item => item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU")));
}

function updateStandardArtists(current: string, selected: string[], definitions: MusicArtistDefinition[]) {
  const custom = splitArtistNames(current).filter(name => !definitions.some(item => item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU")));
  return [...selected, ...custom].join(", ");
}

export default function AdminPage() {
  const supabase = useMemo(() => { try { return supabaseBrowser(); } catch { return null; } }, []);
  const [access, setAccess] = useState<RoleState>("checking");
  const [form, setForm] = useState<"home" | "track" | "album" | "soon" | "manage" | "definitions">("home");
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("Обрабатываем…");
  const [notice, setNotice] = useState<Notice>(null);

  const [trackTitle, setTrackTitle] = useState("");
  const [trackArtists, setTrackArtists] = useState("");
  const [trackDescription, setTrackDescription] = useState("");
  const [trackLyrics, setTrackLyrics] = useState("");
  const [trackMoods, setTrackMoods] = useState<MusicMoodId[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [trackArtwork, setTrackArtwork] = useState<File | null>(null);

  const [albumTitle, setAlbumTitle] = useState("");
  const [albumArtists, setAlbumArtists] = useState("");
  const [albumDescription, setAlbumDescription] = useState("");
  const [albumArtwork, setAlbumArtwork] = useState<File | null>(null);
  const [albumTracks, setAlbumTracks] = useState<AlbumTrackDraft[]>([{ key: "draft-1", title: "", artists: "", description: "", lyrics: "", moods: [], audio: null, video: null }]);
  const [soonTitle, setSoonTitle] = useState("");
  const [soonArtists, setSoonArtists] = useState("");
  const [soonDescription, setSoonDescription] = useState("");
  const [soonType, setSoonType] = useState<"single" | "ep" | "album">("single");
  const [soonDate, setSoonDate] = useState("");
  const [soonArtwork, setSoonArtwork] = useState<File | null>(null);
  const [soonTracks, setSoonTracks] = useState<SoonTrackDraft[]>([{ key: "soon-1", title: "", artists: "", preview: null }]);
  const [editingSoonId, setEditingSoonId] = useState<string | null>(null);
  const [managedAlbums, setManagedAlbums] = useState<ManagedAlbum[]>([]);
  const [managedTracks, setManagedTracks] = useState<ManagedTrack[]>([]);
  const [managedSoon, setManagedSoon] = useState<ManagedSoon[]>([]);
  const [managedArtists, setManagedArtists] = useState<MusicArtistDefinition[]>(MUSIC_ARTISTS);
  const [managedMoods, setManagedMoods] = useState<MusicMoodDefinition[]>(MUSIC_MOODS);
  const [definitionTab, setDefinitionTab] = useState<"artists" | "moods">("artists");
  const [newArtistName, setNewArtistName] = useState("");
  const [newMoodName, setNewMoodName] = useState("");
  const [newMoodColor, setNewMoodColor] = useState("#b9e34b");

  useEffect(() => {
    let alive = true;
    async function checkAccess() {
      if (!supabase) { if (alive) setAccess("denied"); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!alive) return;
      if (!user) { setAccess("denied"); return; }
      const { data: profile, error } = await supabase.from("profiles").select("role,status").eq("id", user.id).maybeSingle();
      if (alive) setAccess(!error && profile?.role === "admin" && profile.status === "active" ? "allowed" : "denied");
    }
    void checkAccess();
    return () => { alive = false; };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || access !== "allowed") return;
    let alive = true;
    Promise.all([
      supabase.from("music_artists").select("id,name").order("name"),
      supabase.from("music_moods").select("id,name,color").order("created_at"),
    ]).then(([artistsResult, moodsResult]) => {
      if (!alive) return;
      if (artistsResult.data) setManagedArtists(artistsResult.data as MusicArtistDefinition[]);
      if (moodsResult.data) setManagedMoods(moodsResult.data as MusicMoodDefinition[]);
      if (artistsResult.error || moodsResult.error) setNotice({ type: "error", text: `Не удалось загрузить определения: ${(artistsResult.error || moodsResult.error)?.message}` });
    });
    return () => { alive = false; };
  }, [access, supabase]);

  async function createArtist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const name = newArtistName.trim();
    if (!name) return;
    setBusy(true); setNotice(null);
    const { data, error } = await supabase.from("music_artists").insert({ id: crypto.randomUUID(), name }).select("id,name").single();
    setBusy(false);
    if (error) { setNotice({ type: "error", text: `Не удалось добавить артиста: ${error.message}` }); return; }
    setManagedArtists(rows => [...rows, data as MusicArtistDefinition].sort((a, b) => a.name.localeCompare(b.name, "ru")));
    setNewArtistName(""); setNotice({ type: "success", text: `Артист «${name}» добавлен в список.` });
  }

  async function createMood(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const name = newMoodName.trim();
    if (!name) return;
    setBusy(true); setNotice(null);
    const { data, error } = await supabase.from("music_moods").insert({ id: crypto.randomUUID(), name, color: newMoodColor }).select("id,name,color").single();
    setBusy(false);
    if (error) { setNotice({ type: "error", text: `Не удалось добавить определение: ${error.message}` }); return; }
    setManagedMoods(rows => [...rows, data as MusicMoodDefinition]);
    setNewMoodName(""); setNotice({ type: "success", text: `Определение «${name}» добавлено.` });
  }

  async function uploadFile(file: File, kind: FileKind) {
    setBusyMessage(`Загружаем «${file.name}»…`);
    const error = validateFile(file, kind);
    if (error) throw new Error(error);
    const extension = file.name.split(".").pop()!.toLowerCase();
    const key = `${kind === "audio" ? "tracks" : kind === "video" ? "videos" : "artwork"}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase!.storage.from(BUCKET).upload(key, file, {
      contentType: MIME_BY_EXTENSION[kind][extension],
      upsert: false,
    });
    if (uploadError) throw new Error(`Не удалось загрузить файл «${file.name}»: ${uploadError.message}`);
    return key;
  }

  async function removeUploaded(keys: string[]) {
    if (keys.length) {
      const { error } = await supabase!.storage.from(BUCKET).remove(keys);
      if (error) throw error;
    }
  }

  async function loadContent(silent = false) {
    if (!supabase) return;
    if (!silent) { setBusy(true); setNotice(null); }
    const [albumsResult, tracksResult, soonResult, soonTracksResult] = await Promise.all([
      supabase.from("albums").select("id,title,artist_name,artwork_key").order("created_at", { ascending: false }),
      supabase.from("tracks").select("id,album_id,title,artist_name,track_number,original_audio_key,stream_audio_key,video_key,artwork_key").order("created_at", { ascending: false }),
      supabase.from("upcoming_releases").select("id,title,artist_name,release_type,release_at,description,artwork_key").order("created_at", { ascending: false }),
      supabase.from("upcoming_release_tracks").select("upcoming_release_id"),
    ]);
    if (!silent) setBusy(false);
    if (albumsResult.error || tracksResult.error || soonResult.error || soonTracksResult.error) { if (!silent) setNotice({ type: "error", text: `Не удалось загрузить список: ${(albumsResult.error || tracksResult.error || soonResult.error || soonTracksResult.error)?.message}` }); return; }
    setManagedAlbums((albumsResult.data ?? []) as ManagedAlbum[]);
    setManagedTracks((tracksResult.data ?? []) as ManagedTrack[]);
    const soonCounts = new Map<string, number>();
    for (const row of soonTracksResult.data ?? []) soonCounts.set(row.upcoming_release_id, (soonCounts.get(row.upcoming_release_id) ?? 0) + 1);
    setManagedSoon((soonResult.data ?? []).map(row => ({ ...row, release_type: row.release_type as ManagedSoon["release_type"], track_count: soonCounts.get(row.id) ?? 0 })));
  }

  async function deleteTrack(track: ManagedTrack) {
    if (!supabase || !window.confirm(`Удалить трек «${track.title}»? Это действие нельзя отменить.`)) return;
    setBusy(true); setNotice(null);
    const { error } = await supabase.from("tracks").delete().eq("id", track.id);
    if (error) { setBusy(false); setNotice({ type: "error", text: `Не удалось удалить трек: ${error.message}` }); return; }
    const keys = [...new Set([track.original_audio_key, track.stream_audio_key, track.video_key, track.album_id ? null : track.artwork_key].filter((key): key is string => Boolean(key)))];
    let warning = "";
    try { await removeUploaded(keys); } catch { warning = " Запись удалена, но файлы в хранилище нужно удалить вручную."; }
    setManagedTracks(rows => rows.filter(row => row.id !== track.id));
    setBusy(false); setNotice({ type: warning ? "error" : "success", text: `Трек удалён.${warning}` });
  }

  async function deleteAlbum(album: ManagedAlbum) {
    if (!supabase) return;
    const children = managedTracks.filter(track => track.album_id === album.id);
    const reviewWarning = " Связанные оценки и комментарии альбома тоже будут удалены.";
    if (!window.confirm(`Удалить альбом «${album.title}» и ${children.length} треков?${reviewWarning}`)) return;
    setBusy(true); setNotice(null);
    if (children.length) {
      const { error: tracksError } = await supabase.from("tracks").delete().eq("album_id", album.id);
      if (tracksError) { setBusy(false); setNotice({ type: "error", text: `Не удалось удалить треки альбома: ${tracksError.message}` }); return; }
    }
    const { error } = await supabase.from("albums").delete().eq("id", album.id);
    if (error) { setBusy(false); setNotice({ type: "error", text: `Треки удалены, но альбом удалить не удалось: ${error.message}` }); void loadContent(); return; }
    const keys = [...new Set([album.artwork_key, ...children.flatMap(track => [track.original_audio_key, track.stream_audio_key, track.video_key, track.artwork_key])].filter((key): key is string => Boolean(key)))];
    let warning = "";
    try { await removeUploaded(keys); } catch { warning = " Альбом удалён, но часть файлов в хранилище нужно удалить вручную."; }
    setManagedAlbums(rows => rows.filter(row => row.id !== album.id));
    setManagedTracks(rows => rows.filter(row => row.album_id !== album.id));
    setBusy(false); setNotice({ type: warning ? "error" : "success", text: `Альбом и его треки удалены.${warning}` });
  }

  function updateAlbumTrack(index: number, update: Partial<AlbumTrackDraft>) {
    setAlbumTracks(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...update } : row));
  }

  async function publishSoon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!supabase) return;
    const artists = artistsToText(soonArtists);
    if (!artists || !soonTitle.trim() || !soonTracks.length || soonTracks.some(track => !track.title.trim())) {
      setNotice({ type: "error", text: "Заполни название релиза, исполнителей и названия треков." }); return;
    }
    setBusy(true); setNotice(null);
    setBusyMessage(editingSoonId ? "Обновляем анонс…" : "Подготавливаем анонс…");
    const uploaded: string[] = [];
    let releaseId: string | null = null;
    try {
      const artworkKey = soonArtwork ? await uploadFile(soonArtwork, "image") : null;
      if (artworkKey) uploaded.push(artworkKey);
      const releaseValues = {
        title: soonTitle.trim(), artist_name: artists, release_type: soonType,
        description: soonDescription.trim() || null,
        release_at: soonDate ? new Date(soonDate).toISOString() : null, status: "published", facts: [],
      };
      if (editingSoonId) {
        releaseId = editingSoonId;
        const { error } = await supabase.from("upcoming_releases").update({ ...releaseValues, ...(artworkKey ? { artwork_key: artworkKey } : {}) }).eq("id", editingSoonId);
        if (error) throw new Error(`Не удалось обновить анонс: ${error.message}`);
      } else {
        const { data: release, error } = await supabase.from("upcoming_releases").insert({ ...releaseValues, artwork_key: artworkKey }).select("id").single();
        if (error) throw new Error(`Не удалось создать анонс: ${error.message}`);
        releaseId = release.id;
      }
      setBusyMessage("Сохраняем треклист анонса…");
      const trackRows = [];
      const firstTrackNumber = editingSoonId ? (managedSoon.find(release => release.id === editingSoonId)?.track_count ?? 0) : 0;
      for (let index = 0; index < soonTracks.length; index++) {
        const draft = soonTracks[index];
        const previewKey = draft.preview ? await uploadFile(draft.preview, "audio") : null;
        if (previewKey) uploaded.push(previewKey);
        trackRows.push({ upcoming_release_id: releaseId, title: draft.title.trim(), track_number: firstTrackNumber + index + 1, preview_audio_key: previewKey, facts: { artists: artistsToText(draft.artists) || artists } });
      }
      const { error: tracksError } = await supabase.from("upcoming_release_tracks").insert(trackRows);
      if (tracksError) throw new Error(`Анонс создан, но его треклист не сохранился: ${tracksError.message}`);
      setNotice({ type: "success", text: editingSoonId ? "Треклист и сниппеты добавлены к анонсу." : "Анонс опубликован во вкладке «Скоро»." });
      setSoonTitle(""); setSoonArtists(""); setSoonDescription(""); setSoonDate(""); setSoonArtwork(null);
      setSoonTracks([{ key: `soon-${Date.now()}`, title: "", artists: "", preview: null }]);
      setEditingSoonId(null);
      formElement.reset();
      void loadContent(true);
    } catch (error) {
      if (releaseId && !editingSoonId) await supabase.from("upcoming_releases").delete().eq("id", releaseId);
      let cleanupFailed = false;
      try { await removeUploaded(uploaded); } catch { cleanupFailed = true; }
      const message = error instanceof Error ? error.message : "Не удалось опубликовать анонс.";
      setNotice({ type: "error", text: `${message}${cleanupFailed ? " Не удалось удалить временные файлы." : ""}` });
    } finally { setBusy(false); }
  }

  async function publishTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!supabase || !audioFile) { setNotice({ type: "error", text: "Выбери обязательный аудиофайл." }); return; }
    const artists = artistsToText(trackArtists);
    if (!artists) { setNotice({ type: "error", text: "Укажи хотя бы одного исполнителя." }); return; }
    setBusy(true); setNotice(null);
    setBusyMessage("Подготавливаем трек…");
    const uploaded: string[] = [];
    try {
      const audioKey = await uploadFile(audioFile, "audio");
      uploaded.push(audioKey);
      const videoKey = videoFile ? await uploadFile(videoFile, "video") : null;
      if (videoKey) uploaded.push(videoKey);
      const artworkKey = trackArtwork ? await uploadFile(trackArtwork, "image") : null;
      if (artworkKey) uploaded.push(artworkKey);
      setBusyMessage("Сохраняем трек в библиотеку…");
      const { error } = await supabase.from("tracks").insert({
        title: trackTitle.trim(), artist_name: artists, description: trackDescription.trim() || null,
        original_audio_key: audioKey, stream_audio_key: null, video_key: videoKey,
        artwork_key: artworkKey, album_id: null, status: "published", lyrics_lines: parseTimedLyrics(trackLyrics), moods: trackMoods,
      });
      if (error) throw new Error(`Файлы загружены, но трек не опубликован: ${error.message}`);
      setNotice({ type: "success", text: "Трек опубликован." });
      setTrackTitle(""); setTrackArtists(""); setTrackDescription(""); setTrackLyrics(""); setTrackMoods([]); setAudioFile(null); setVideoFile(null); setTrackArtwork(null);
      formElement.reset();
    } catch (error) {
      let cleanupFailed = false;
      try { await removeUploaded(uploaded); } catch { cleanupFailed = true; }
      const message = error instanceof Error ? error.message : "Не удалось опубликовать трек. Попробуй ещё раз.";
      setNotice({ type: "error", text: `${message}${cleanupFailed ? " Не удалось удалить временные файлы; сообщи администратору." : ""}` });
    } finally { setBusy(false); }
  }

  async function publishAlbum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!supabase) return;
    const artists = artistsToText(albumArtists);
    if (!artists) { setNotice({ type: "error", text: "Укажи хотя бы одного исполнителя." }); return; }
    if (!albumTracks.length || albumTracks.some(track => !track.title.trim() || !track.audio)) { setNotice({ type: "error", text: "У каждого трека в альбоме должны быть название и аудиофайл." }); return; }
    setBusy(true); setNotice(null);
    setBusyMessage("Подготавливаем альбом…");
    const uploaded: string[] = [];
    let albumId: string | null = null;
    try {
      const artworkKey = albumArtwork ? await uploadFile(albumArtwork, "image") : null;
      if (artworkKey) uploaded.push(artworkKey);
      const { data: album, error } = await supabase.from("albums").insert({
        title: albumTitle.trim(), artist_name: artists, description: albumDescription.trim() || null,
        artwork_key: artworkKey, status: "published",
      }).select("id").single();
      if (error) throw new Error(`Обложка загружена, но альбом не опубликован: ${error.message}`);
      albumId = album.id;
      const trackRows = [];
      for (let index = 0; index < albumTracks.length; index++) {
        const draft = albumTracks[index];
        setBusyMessage(`Загружаем трек ${index + 1} из ${albumTracks.length}…`);
        const audioKey = await uploadFile(draft.audio!, "audio"); uploaded.push(audioKey);
        const videoKey = draft.video ? await uploadFile(draft.video, "video") : null;
        if (videoKey) uploaded.push(videoKey);
          trackRows.push({
          album_id: albumId, title: draft.title.trim(), artist_name: artistsToText(draft.artists) || artists, description: draft.description.trim() || null,
          track_number: index + 1, original_audio_key: audioKey, stream_audio_key: null, video_key: videoKey,
          artwork_key: artworkKey, status: "published", lyrics_lines: parseTimedLyrics(draft.lyrics), moods: draft.moods,
        });
      }
      setBusyMessage(`Публикуем альбом и сохраняем ${trackRows.length} трек(а/ов)…`);
      const { error: tracksError } = await supabase.from("tracks").insert(trackRows);
      if (tracksError) throw new Error(`Альбом создан, но треклист не сохранился: ${tracksError.message}`);
      setNotice({ type: "success", text: `Альбом и ${trackRows.length} трек(а/ов) опубликованы.` });
      setAlbumTitle(""); setAlbumArtists(""); setAlbumDescription(""); setAlbumArtwork(null); setAlbumTracks([{ key: `draft-${Date.now()}`, title: "", artists: "", description: "", lyrics: "", moods: [], audio: null, video: null }]);
      formElement.reset();
    } catch (error) {
      if (albumId) await supabase.from("albums").delete().eq("id", albumId);
      let cleanupFailed = false;
      try { await removeUploaded(uploaded); } catch { cleanupFailed = true; }
      const message = error instanceof Error ? error.message : "Не удалось опубликовать альбом. Попробуй ещё раз.";
      setNotice({ type: "error", text: `${message}${cleanupFailed ? " Не удалось удалить временные файлы; сообщи администратору." : ""}` });
    } finally { setBusy(false); }
  }

  if (access === "checking") return <main className="shell"><div className="adminMessage">Проверяем доступ…</div></main>;
  if (access === "denied") return <main className="shell"><div className="adminMessage"><h1>Нет доступа</h1><p>Админ-панель доступна только активным администраторам.</p><Link href="/">Вернуться на главную</Link></div></main>;

  return <main className="shell adminShell">
    <header className="adminTop"><Link className="brand" href="/"><span className="brandMark">Т</span><span>ТРАПЧИК<span className="brandDot">.МР3</span></span></Link><Link className="adminBack" href="/">← На главную</Link></header>
    <section className="adminSection">
      <div className="eyebrow">УПРАВЛЕНИЕ КОНТЕНТОМ</div>
      <h1 className="adminTitle">Админ-панель</h1>
      {notice && <div className={`notice ${notice.type === "error" ? "noticeError" : ""}`} role="status">{notice.text}</div>}
      {form === "home" ? <div className="adminCards">
        <button className="adminCard" onClick={() => { setNotice(null); setForm("track"); }}><span className="adminCardIcon">♫</span><b>Создать трек</b><small>Опубликовать сингл, клип и обложку</small><span className="adminCardArrow">↗</span></button>
        <button className="adminCard" onClick={() => { setNotice(null); setForm("album"); }}><span className="adminCardIcon">▧</span><b>Создать альбом</b><small>Добавить обложку и треклист с клипами</small><span className="adminCardArrow">↗</span></button>
        <button className="adminCard" onClick={() => { setNotice(null); setEditingSoonId(null); setSoonTitle(""); setSoonArtists(""); setSoonDescription(""); setSoonDate(""); setSoonArtwork(null); setSoonType("single"); setSoonTracks([{ key: `soon-${Date.now()}`, title: "", artists: "", preview: null }]); setForm("soon"); }}><span className="adminCardIcon">◷</span><b>Скоро</b><small>Создать анонс и загрузить сниппеты</small><span className="adminCardArrow">↗</span></button>
        <button className="adminCard" onClick={() => { setForm("manage"); void loadContent(); }}><span className="adminCardIcon">⌫</span><b>Контент сайта</b><small>Удалять релизы и исправлять анонсы</small><span className="adminCardArrow">↗</span></button>
        <button className="adminCard" onClick={() => { setNotice(null); setDefinitionTab("artists"); setForm("definitions"); }}><span className="adminCardIcon">✳</span><b>Артисты и определения</b><small>Добавлять стандартные имена артистов и настроения волн</small><span className="adminCardArrow">↗</span></button>
      </div> : form === "definitions" ? <>
        <button className="adminFormBack" type="button" onClick={() => { setForm("home"); setNotice(null); }}>← К разделам</button>
        <nav className="definitionTabs" aria-label="Типы стандартных определений"><button type="button" className={definitionTab === "artists" ? "active" : ""} onClick={() => setDefinitionTab("artists")}>Артисты <span>{managedArtists.length}</span></button><button type="button" className={definitionTab === "moods" ? "active" : ""} onClick={() => setDefinitionTab("moods")}>Настроения <span>{managedMoods.length}</span></button></nav>
        {definitionTab === "artists" ? <div className="definitionsLayout"><form className="adminForm definitionForm" onSubmit={createArtist}><h2>Добавить артиста</h2><p className="fieldHint">Имя появится в списке выбора исполнителей при создании треков и альбомов, а также в артистах на вкладке «Музыка».</p><label>Имя артиста<input required maxLength={80} value={newArtistName} onChange={e => setNewArtistName(e.target.value)} placeholder="Например, Новый артист" /></label><button className="primary" disabled={busy}>{busy ? "Добавляем…" : "Добавить артиста"}</button></form><section className="definitionList"><h2>Стандартные артисты</h2>{managedArtists.map(artist => <div className="definitionRow" key={artist.id}><span className="definitionAvatar">{artist.name.slice(0, 1).toLocaleUpperCase("ru-RU")}</span><b>{artist.name}</b><small>Доступен при публикации</small></div>)}</section></div> : <div className="definitionsLayout"><form className="adminForm definitionForm" onSubmit={createMood}><h2>Добавить настроение</h2><p className="fieldHint">Созданное настроение станет новой цветной волной и появится при назначении трекам.</p><label>Название<input required maxLength={60} value={newMoodName} onChange={e => setNewMoodName(e.target.value)} placeholder="Например, Ностальгическое" /></label><label>Цвет кнопки<input className="moodColorInput" type="color" value={newMoodColor} onChange={e => setNewMoodColor(e.target.value)} /></label><button className="primary" disabled={busy}>{busy ? "Добавляем…" : "Добавить настроение"}</button></form><section className="definitionList"><h2>Стандартные настроения</h2>{managedMoods.map(mood => <div className="definitionRow" key={mood.id}><span className="definitionMoodSwatch" style={{ backgroundColor: mood.color, boxShadow: `0 0 18px ${mood.color}66` }} /><b>{mood.name}</b><small>{mood.color}</small></div>)}</section></div>}
      </> : <>
        <button className="adminFormBack" type="button" onClick={() => { setForm("home"); setEditingSoonId(null); setNotice(null); }}>← К разделам</button>
        {form === "track" ? <form className="adminForm" onSubmit={publishTrack}>
          <h2>Новый трек</h2>
          <label>Название трека<input required maxLength={160} value={trackTitle} onChange={e => setTrackTitle(e.target.value)} /></label>
          <label>Исполнитель или исполнители <span className="fieldHint">Можно выбрать стандартные имена ниже или ввести своих. Несколько участников разделяй запятой.</span><textarea required rows={2} value={trackArtists} onChange={e => setTrackArtists(e.target.value)} /></label>
          <div className="adminField"><span>Стандартные артисты</span><ArtistPicker artists={managedArtists} value={artistsChosenFromDefinitions(trackArtists, managedArtists)} onChange={selected => setTrackArtists(updateStandardArtists(trackArtists, selected, managedArtists))} /></div>
          <div className="adminField"><span>Настроения трека <small>Можно выбрать несколько — трек появится в каждой соответствующей волне.</small></span><MoodPicker definitions={managedMoods} value={trackMoods} onChange={setTrackMoods} /></div>
          <label>Описание <textarea rows={4} value={trackDescription} onChange={e => setTrackDescription(e.target.value)} /></label>
          <label>Синхронный текст <span className="fieldHint">Каждая строка: [м:сс.сс] текст, например [0:12.50] Первая строка</span><textarea rows={6} value={trackLyrics} onChange={e => setTrackLyrics(e.target.value)} placeholder={'[0:12.50] Первая строка\n[0:16.00] Следующая строка'} /></label>
          <label className="fileField">Аудиофайл <span className="fieldHint">MP3, M4A, AAC, WAV, OGG или FLAC · обязателен</span><input required type="file" accept=".mp3,.m4a,.aac,.wav,.ogg,.flac,audio/*" onChange={e => setAudioFile(e.target.files?.[0] ?? null)} />{audioFile && <small>Выбран: {audioFile.name}</small>}</label>
          <label className="fileField">Видеоклип <span className="fieldHint">MP4, WebM или MOV</span><input type="file" accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" onChange={e => setVideoFile(e.target.files?.[0] ?? null)} />{videoFile && <small>Выбран: {videoFile.name}</small>}</label>
          <label className="fileField">Обложка <span className="fieldHint">JPG, PNG или WebP</span><input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={e => setTrackArtwork(e.target.files?.[0] ?? null)} />{trackArtwork && <small>Выбрана: {trackArtwork.name}</small>}</label>
          <button className="primary" disabled={busy}>{busy ? busyMessage : "Опубликовать трек"}</button>
        </form> : form === "album" ? <form className="adminForm" onSubmit={publishAlbum}>
          <h2>Новый альбом</h2>
          <label>Название альбома<input required maxLength={160} value={albumTitle} onChange={e => setAlbumTitle(e.target.value)} /></label>
          <label>Исполнитель или исполнители <span className="fieldHint">Выбранные исполнители альбома будут предложены его трекам. Можно также вписать имя вручную.</span><textarea required rows={2} value={albumArtists} onChange={e => setAlbumArtists(e.target.value)} /></label>
          <div className="adminField"><span>Стандартные артисты альбома</span><ArtistPicker artists={managedArtists} value={artistsChosenFromDefinitions(albumArtists, managedArtists)} onChange={selected => setAlbumArtists(updateStandardArtists(albumArtists, selected, managedArtists))} /></div>
          <label>Описание <textarea rows={4} value={albumDescription} onChange={e => setAlbumDescription(e.target.value)} /></label>
          <label className="fileField">Обложка альбома <span className="fieldHint">JPG, PNG или WebP</span><input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={e => setAlbumArtwork(e.target.files?.[0] ?? null)} />{albumArtwork && <small>Выбрана: {albumArtwork.name}</small>}</label>
          <div className="albumTrackEditor"><div className="albumTrackEditorHead"><h3>Треклист альбома</h3><span className="fieldHint">Для каждого трека добавь аудио; клип — по желанию.</span></div>
            {albumTracks.map((track, index) => <fieldset className="albumTrackDraft" key={track.key}><legend>Трек {index + 1}</legend>
              <button type="button" className="removeDraft" aria-label={`Удалить трек ${index + 1} из формы`} disabled={albumTracks.length <= 1} onClick={() => setAlbumTracks(rows => rows.filter((_, rowIndex) => rowIndex !== index))}>×</button>
              <label>Название трека<input required maxLength={160} value={track.title} onChange={e => updateAlbumTrack(index, { title: e.target.value })} /></label>
              <label>Исполнители трека <span className="fieldHint">Укажи всех артистов и фитов через запятую. Пустое поле наследует исполнителей альбома.</span><input value={track.artists} onChange={e => updateAlbumTrack(index, { artists: e.target.value })} placeholder={albumArtists || "Исполнитель трека"} /></label>
              <div className="adminField"><span>Стандартные артисты трека</span><ArtistPicker artists={managedArtists} value={artistsChosenFromDefinitions(track.artists, managedArtists)} onChange={selected => updateAlbumTrack(index, { artists: updateStandardArtists(track.artists, selected, managedArtists) })} /></div>
              <div className="adminField"><span>Настроения трека <small>Выбери одно или несколько.</small></span><MoodPicker definitions={managedMoods} value={track.moods} onChange={moods => updateAlbumTrack(index, { moods })} /></div>
              <label>Описание трека<textarea rows={2} value={track.description} onChange={e => updateAlbumTrack(index, { description: e.target.value })} /></label>
              <label>Синхронный текст <span className="fieldHint">Формат: [м:сс.сс] строка</span><textarea rows={4} value={track.lyrics} onChange={e => updateAlbumTrack(index, { lyrics: e.target.value })} placeholder={'[0:12.50] Первая строка\n[0:16.00] Следующая строка'} /></label>
              <label className="fileField">Аудиофайл <span className="fieldHint">MP3, M4A, AAC, WAV, OGG или FLAC</span><input required type="file" accept=".mp3,.m4a,.aac,.wav,.ogg,.flac,audio/*" onChange={e => updateAlbumTrack(index, { audio: e.target.files?.[0] ?? null })} />{track.audio && <small>Выбран: {track.audio.name}</small>}</label>
              <label className="fileField">Клип <span className="fieldHint">MP4, WebM или MOV</span><input type="file" accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" onChange={e => updateAlbumTrack(index, { video: e.target.files?.[0] ?? null })} />{track.video && <small>Выбран: {track.video.name}</small>}</label>
            </fieldset>)}
            <button type="button" className="secondary addAlbumTrack" onClick={() => setAlbumTracks(rows => [...rows, { key: `draft-${Date.now()}-${rows.length}`, title: "", artists: "", description: "", lyrics: "", moods: [], audio: null, video: null }])}>＋ Добавить трек</button>
          </div>
          <button className="primary" disabled={busy}>{busy ? busyMessage : "Опубликовать альбом"}</button>
        </form> : form === "soon" ? <form className="adminForm" onSubmit={publishSoon}>
          <h2>{editingSoonId ? "Дополнить анонс" : "Будущий релиз"}</h2>
          <label>Тип релиза<select value={soonType} onChange={e => setSoonType(e.target.value as "single" | "ep" | "album")}><option value="single">Сингл</option><option value="ep">EP</option><option value="album">Альбом</option></select></label>
          <label>Название релиза<input required maxLength={160} value={soonTitle} onChange={e => setSoonTitle(e.target.value)} /></label>
          <label>Исполнитель или исполнители<input required value={soonArtists} onChange={e => setSoonArtists(e.target.value)} placeholder="Можно перечислить через запятую" /></label>
          <label>Описание<textarea rows={3} value={soonDescription} onChange={e => setSoonDescription(e.target.value)} /></label>
          <label>Дата выхода<input type="datetime-local" value={soonDate} onChange={e => setSoonDate(e.target.value)} /></label>
          <label className="fileField">Обложка <span className="fieldHint">JPG, PNG или WebP</span><input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={e => setSoonArtwork(e.target.files?.[0] ?? null)} />{soonArtwork && <small>Выбрана: {soonArtwork.name}</small>}</label>
          <div className="albumTrackEditor"><div className="albumTrackEditorHead"><h3>Треклист и сниппеты</h3><span className="fieldHint">Сниппет можно пропустить. Он будет доступен слушателям в «Скоро».</span></div>
            {soonTracks.map((track, index) => <fieldset className="albumTrackDraft" key={track.key}><legend>Трек {index + 1}</legend>
              <button type="button" className="removeDraft" aria-label={`Удалить трек ${index + 1}`} disabled={soonTracks.length <= 1} onClick={() => setSoonTracks(rows => rows.filter((_, rowIndex) => rowIndex !== index))}>×</button>
              <label>Название трека<input required maxLength={160} value={track.title} onChange={e => setSoonTracks(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, title: e.target.value } : row))} /></label>
              <label>Исполнители трека <span className="fieldHint">По умолчанию общий исполнитель релиза.</span><input value={track.artists} onChange={e => setSoonTracks(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, artists: e.target.value } : row))} /></label>
              <label className="fileField">Сниппет аудио <span className="fieldHint">MP3, M4A, AAC, WAV, OGG или FLAC</span><input type="file" accept=".mp3,.m4a,.aac,.wav,.ogg,.flac,audio/*" onChange={e => setSoonTracks(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, preview: e.target.files?.[0] ?? null } : row))} />{track.preview && <small>Выбран: {track.preview.name}</small>}</label>
            </fieldset>)}
            <button type="button" className="secondary addAlbumTrack" onClick={() => setSoonTracks(rows => [...rows, { key: `soon-${Date.now()}-${rows.length}`, title: "", artists: "", preview: null }])}>＋ Добавить трек</button>
          </div>
          <button className="primary" disabled={busy}>{busy ? busyMessage : editingSoonId ? "Сохранить треклист и сниппеты" : "Опубликовать в «Скоро»"}</button>
        </form> : <section className="manageContent">
          <div className="manageHeader"><h2>Опубликованный контент</h2><button type="button" className="secondary" disabled={busy} onClick={() => void loadContent()}>Обновить список</button></div>
          <h3>Анонсы «Скоро»</h3>
          {managedSoon.length ? <div className="manageList">{managedSoon.map(release => <article className="manageRow" key={release.id}><div><b>{release.title}</b><span>{release.artist_name} · {release.track_count} тр.</span></div><button type="button" className="secondary" disabled={busy} onClick={() => { setEditingSoonId(release.id); setSoonTitle(release.title); setSoonArtists(release.artist_name); setSoonDescription(release.description ?? ""); setSoonType(release.release_type); setSoonDate(release.release_at ? new Date(new Date(release.release_at).getTime() - new Date(release.release_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""); setSoonArtwork(null); setSoonTracks([{ key: `soon-${Date.now()}`, title: "", artists: "", preview: null }]); setNotice(null); setForm("soon"); }}>Добавить треки / сниппеты</button></article>)}</div> : <p className="fieldHint">Анонсов пока нет.</p>}`n          <h3>Альбомы</h3>
          {managedAlbums.length ? <div className="manageList">{managedAlbums.map(album => { const count = managedTracks.filter(track => track.album_id === album.id).length; return <article className="manageRow" key={album.id}><div><b>{album.title}</b><span>{album.artist_name} · {count} тр.</span></div><button type="button" className="deleteButton" disabled={busy} onClick={() => void deleteAlbum(album)}>Удалить альбом</button></article>; })}</div> : <p className="fieldHint">Альбомов пока нет.</p>}
          <h3>Треки</h3>
          {managedTracks.length ? <div className="manageList">{managedTracks.map(track => { const parentAlbum = managedAlbums.find(album => album.id === track.album_id); return <article className="manageRow" key={track.id}><div><b>{track.track_number ? `${track.track_number}. ` : ""}{track.title}</b><span>{track.artist_name}{parentAlbum ? ` · ${parentAlbum.title}` : " · Сингл"}</span></div><button type="button" className="deleteButton" disabled={busy} onClick={() => void deleteTrack(track)}>Удалить трек</button></article>; })}</div> : <p className="fieldHint">Треков пока нет.</p>}
        </section>}
      </>}
    </section>
    <footer><span>ТРАПЧИК.МР3 © 2026</span><span>АДМИНИСТРАТОР</span></footer>
  </main>;
}
