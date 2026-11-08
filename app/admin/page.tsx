"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase";

const BUCKET = "music-media";
const MAX_BYTES = 100 * 1024 * 1024;

type FileKind = "audio" | "video" | "image";
type RoleState = "checking" | "allowed" | "denied";
type Notice = { type: "success" | "error"; text: string } | null;

const MIME_BY_EXTENSION: Record<FileKind, Record<string, string>> = {
  audio: { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac" },
  video: { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" },
  image: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" },
};

function validateFile(file: File, kind: FileKind) {
  if (file.size === 0) return "Файл пустой. Выбери другой файл.";
  if (file.size > MAX_BYTES) return "Размер файла не должен превышать 100 МБ.";
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

export default function AdminPage() {
  const supabase = useMemo(() => { try { return supabaseBrowser(); } catch { return null; } }, []);
  const [access, setAccess] = useState<RoleState>("checking");
  const [form, setForm] = useState<"home" | "track" | "album">("home");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [trackTitle, setTrackTitle] = useState("");
  const [trackArtists, setTrackArtists] = useState("");
  const [trackDescription, setTrackDescription] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [trackArtwork, setTrackArtwork] = useState<File | null>(null);

  const [albumTitle, setAlbumTitle] = useState("");
  const [albumArtists, setAlbumArtists] = useState("");
  const [albumDescription, setAlbumDescription] = useState("");
  const [albumArtwork, setAlbumArtwork] = useState<File | null>(null);

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

  async function uploadFile(file: File, kind: FileKind) {
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

  async function publishTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!supabase || !audioFile) { setNotice({ type: "error", text: "Выбери обязательный аудиофайл." }); return; }
    const artists = artistsToText(trackArtists);
    if (!artists) { setNotice({ type: "error", text: "Укажи хотя бы одного исполнителя." }); return; }
    setBusy(true); setNotice(null);
    const uploaded: string[] = [];
    try {
      const audioKey = await uploadFile(audioFile, "audio");
      uploaded.push(audioKey);
      const videoKey = videoFile ? await uploadFile(videoFile, "video") : null;
      if (videoKey) uploaded.push(videoKey);
      const artworkKey = trackArtwork ? await uploadFile(trackArtwork, "image") : null;
      if (artworkKey) uploaded.push(artworkKey);
      const { error } = await supabase.from("tracks").insert({
        title: trackTitle.trim(), artist_name: artists, description: trackDescription.trim() || null,
        original_audio_key: audioKey, stream_audio_key: null, video_key: videoKey,
        artwork_key: artworkKey, album_id: null, status: "published", lyrics_lines: [],
      });
      if (error) throw new Error(`Файлы загружены, но трек не опубликован: ${error.message}`);
      setNotice({ type: "success", text: "Трек опубликован." });
      setTrackTitle(""); setTrackArtists(""); setTrackDescription(""); setAudioFile(null); setVideoFile(null); setTrackArtwork(null);
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
    setBusy(true); setNotice(null);
    const uploaded: string[] = [];
    try {
      const artworkKey = albumArtwork ? await uploadFile(albumArtwork, "image") : null;
      if (artworkKey) uploaded.push(artworkKey);
      const { error } = await supabase.from("albums").insert({
        title: albumTitle.trim(), artist_name: artists, description: albumDescription.trim() || null,
        artwork_key: artworkKey, status: "published",
      });
      if (error) throw new Error(`Обложка загружена, но альбом не опубликован: ${error.message}`);
      setNotice({ type: "success", text: "Альбом опубликован." });
      setAlbumTitle(""); setAlbumArtists(""); setAlbumDescription(""); setAlbumArtwork(null);
      formElement.reset();
    } catch (error) {
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
        <button className="adminCard" onClick={() => { setNotice(null); setForm("album"); }}><span className="adminCardIcon">▧</span><b>Создать альбом</b><small>Опубликовать альбом с обложкой</small><span className="adminCardArrow">↗</span></button>
      </div> : <>
        <button className="adminFormBack" type="button" onClick={() => { setForm("home"); setNotice(null); }}>← К разделам</button>
        {form === "track" ? <form className="adminForm" onSubmit={publishTrack}>
          <h2>Новый трек</h2>
          <label>Название трека<input required maxLength={160} value={trackTitle} onChange={e => setTrackTitle(e.target.value)} /></label>
          <label>Исполнитель или исполнители <span className="fieldHint">Можно указать нескольких через запятую или с новой строки</span><textarea required rows={2} value={trackArtists} onChange={e => setTrackArtists(e.target.value)} /></label>
          <label>Описание <textarea rows={4} value={trackDescription} onChange={e => setTrackDescription(e.target.value)} /></label>
          <label className="fileField">Аудиофайл <span className="fieldHint">MP3, M4A, AAC, WAV, OGG или FLAC · до 100 МБ · обязателен</span><input required type="file" accept=".mp3,.m4a,.aac,.wav,.ogg,.flac,audio/*" onChange={e => setAudioFile(e.target.files?.[0] ?? null)} />{audioFile && <small>Выбран: {audioFile.name}</small>}</label>
          <label className="fileField">Видеоклип <span className="fieldHint">MP4, WebM или MOV · до 100 МБ</span><input type="file" accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" onChange={e => setVideoFile(e.target.files?.[0] ?? null)} />{videoFile && <small>Выбран: {videoFile.name}</small>}</label>
          <label className="fileField">Обложка <span className="fieldHint">JPG, PNG или WebP · до 100 МБ</span><input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={e => setTrackArtwork(e.target.files?.[0] ?? null)} />{trackArtwork && <small>Выбрана: {trackArtwork.name}</small>}</label>
          <button className="primary" disabled={busy}>{busy ? "Публикуем…" : "Опубликовать трек"}</button>
        </form> : <form className="adminForm" onSubmit={publishAlbum}>
          <h2>Новый альбом</h2>
          <label>Название альбома<input required maxLength={160} value={albumTitle} onChange={e => setAlbumTitle(e.target.value)} /></label>
          <label>Исполнитель или исполнители <span className="fieldHint">Можно указать нескольких через запятую или с новой строки</span><textarea required rows={2} value={albumArtists} onChange={e => setAlbumArtists(e.target.value)} /></label>
          <label>Описание <textarea rows={4} value={albumDescription} onChange={e => setAlbumDescription(e.target.value)} /></label>
          <label className="fileField">Обложка альбома <span className="fieldHint">JPG, PNG или WebP · до 100 МБ</span><input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={e => setAlbumArtwork(e.target.files?.[0] ?? null)} />{albumArtwork && <small>Выбрана: {albumArtwork.name}</small>}</label>
          <button className="primary" disabled={busy}>{busy ? "Публикуем…" : "Опубликовать альбом"}</button>
        </form>}
      </>}
    </section>
    <footer><span>ТРАПЧИК.МР3 © 2026</span><span>АДМИНИСТРАТОР</span></footer>
  </main>;
}
