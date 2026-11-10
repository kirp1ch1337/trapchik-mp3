"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";
import AudioPlayer, { type PlayerTrack } from "@/components/AudioPlayer";
import CrystalizedWave from "@/components/CrystalizedWave";
import ArtistRail from "@/components/ArtistRail";
import Community from "@/components/Community";
import { MUSIC_ARTISTS, MUSIC_MOODS, splitArtistNames, type MusicArtistDefinition, type MusicMoodDefinition, type MusicMoodId } from "@/lib/music";

type Album = { id: string; title: string; artist_name: string; description: string | null; artwork_key: string | null; release_date: string | null };
type Upcoming = { id: string; title: string; artist_name: string; release_type: string; description: string | null; release_at: string | null; artwork_key: string | null };
type Track = { id: string; album_id: string | null; track_number: number | null; title: string; artist_name: string; description: string | null; lyrics_lines: unknown; moods: MusicMoodId[] | null; original_audio_key: string | null; stream_audio_key: string | null; artwork_key: string | null; video_key: string | null };
type UpcomingTrack = { id: string; upcoming_release_id: string; title: string; track_number: number | null; preview_audio_key: string | null; facts: unknown };
type Review = { id: string; rating: number; comment: string | null; created_at: string; albums: { title: string; artist_name: string } | null };
type PublicProfile = { id: string; nickname: string | null; bio: string | null; avatar_key: string | null };

const DEFAULT_AVATAR = "/default-avatar.png";

function normalizeLyrics(raw: unknown): { time: number; text: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((line: unknown) => {
    if (typeof line === "string") {
      const match = line.match(/^\[(\d+):(\d{2}(?:\.\d+)?)\]\s*(.*)$/);
      return match ? [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3] }] : [];
    }
    if (!line || typeof line !== "object") return [];
    const value = line as { time?: unknown; start?: unknown; text?: unknown; line?: unknown };
    const time = Number(value.time ?? value.start);
    const text = String(value.text ?? value.line ?? "").trim();
    return Number.isFinite(time) && text ? [{ time, text }] : [];
  }).sort((a, b) => a.time - b.time);
}

function NavProfileIcon() {
  return <svg className="navProfileIcon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.7-3.5 3-5.3 6.5-5.3s5.8 1.8 6.5 5.3"/></svg>;
}

export default function Home() {
  const [tab, setTab] = useState<"home" | "music" | "soon" | "profile" | "friends">("home");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [upcomingTracks, setUpcomingTracks] = useState<UpcomingTrack[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [waveQueueMode, setWaveQueueMode] = useState(false);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [moodDefinitions, setMoodDefinitions] = useState<MusicMoodDefinition[]>(MUSIC_MOODS);
  const [artistDefinitions, setArtistDefinitions] = useState<MusicArtistDefinition[]>(MUSIC_ARTISTS);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("Слушатель");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(DEFAULT_AVATAR);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [profileTab, setProfileTab] = useState<"inventory" | "ratings">("inventory");
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedMood, setSelectedMood] = useState<MusicMoodId | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [moodMessage, setMoodMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PublicProfile | null>(null);
  const [following, setFollowing] = useState(false);
  const [ownFollowCounts, setOwnFollowCounts] = useState({ followers: 0, following: 0 });
  const [viewedFollowCounts, setViewedFollowCounts] = useState({ followers: 0, following: 0 });
  const [followListLoading, setFollowListLoading] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [followList, setFollowList] = useState<PublicProfile[]>([]);
  const [followListMode, setFollowListMode] = useState<"followers" | "following" | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropPreview, setCropPreview] = useState("");
  const [cropDimensions, setCropDimensions] = useState({ width: 1, height: 1 });
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropZoom, setCropZoom] = useState(1);

  const supabase = useMemo(() => { try { return supabaseBrowser(); } catch { return null; } }, []);

  async function loadProfile(id: string) {
    if (!supabase) return;
    const { data: p } = await supabase.from("profiles").select("nickname,bio,avatar_key,status,role").eq("id", id).maybeSingle();
    if (p?.status === "blocked") {
      await supabase.auth.signOut(); setUserEmail(null); setUserId(null); setIsAdmin(false); setMessage("Этот аккаунт заблокирован администратором."); return;
    }
    setIsAdmin(p?.status === "active" && p?.role === "admin");
    if (p) {
      setProfileName(p.nickname || "Слушатель"); setNickname(p.nickname || "Слушатель");
      setBio(p.bio || ""); setAvatarUrl(p.avatar_key || DEFAULT_AVATAR);
    }
    const { data: rows } = await supabase.from("album_reviews")
      .select("id,rating,comment,created_at,albums(title,artist_name)")
      .eq("user_id", id).order("created_at", { ascending: false });
    setReviews((rows ?? []) as unknown as Review[]);
    await refreshFollowCounts(id, "own");
  }

  useEffect(() => {
    if (!supabase) { setMessage("Подключи Supabase: заполни .env.local по инструкции."); return; }
    let alive = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!alive) return;
      if (!data.user) { setWelcomeOpen(true); return; }
      if (window.localStorage.getItem("trapchik:welcome-after-auth") === "1") {
        window.localStorage.removeItem("trapchik:welcome-after-auth");
        changeTab("home");
      }
      setUserEmail(data.user.email ?? null); setUserId(data.user.id); await loadProfile(data.user.id);
    });
    supabase.from("albums").select("id,title,artist_name,description,artwork_key,release_date")
      .eq("status", "published").order("release_date", { ascending: false }).then(({ data, error }) => {
        if (!alive) return; if (error) setMessage("Не удалось загрузить каталог. Проверь политики доступа и подключение."); setAlbums((data ?? []) as Album[]);
      });
    supabase.from("upcoming_releases").select("id,title,artist_name,release_type,description,release_at,artwork_key")
      .eq("status", "published").order("release_at", { ascending: true }).then(({ data }) => { if (alive) setUpcoming((data ?? []) as Upcoming[]); });
    Promise.all([
      supabase.from("music_moods").select("id,name,color").order("created_at"),
      supabase.from("music_artists").select("id,name").order("name"),
    ]).then(([moodsResult, artistsResult]) => {
      if (!alive) return;
      if (moodsResult.data?.length) setMoodDefinitions(moodsResult.data as MusicMoodDefinition[]);
      if (artistsResult.data?.length) setArtistDefinitions(artistsResult.data as MusicArtistDefinition[]);
    });
    Promise.all([
      supabase.from("tracks").select("id,album_id,track_number,title,artist_name,description,lyrics_lines,moods,original_audio_key,stream_audio_key,artwork_key,video_key").eq("status", "published").order("created_at", { ascending: false }),
      supabase.from("albums").select("artwork_key").eq("status", "published"),
      supabase.from("upcoming_release_tracks").select("id,upcoming_release_id,title,track_number,preview_audio_key,facts").order("track_number", { ascending: true }),
      supabase.from("upcoming_releases").select("artwork_key").eq("status", "published"),
    ]).then(async ([trackResult, albumResult, upcomingTracksResult, upcomingArtworkResult]) => {
      if (!alive) return;
      if (trackResult.error) setMessage(`Не удалось загрузить треклист: ${trackResult.error.message}`);
      if (upcomingTracksResult.error) setMessage(`Не удалось загрузить треклисты анонсов: ${upcomingTracksResult.error.message}`);
      const rows = (trackResult.data ?? []) as Track[];
      const previewRows = (upcomingTracksResult.data ?? []) as UpcomingTrack[];
      setTracks(rows);
      setUpcomingTracks(previewRows);
      const keys = [...new Set([...rows.flatMap(t => [t.original_audio_key, t.stream_audio_key, t.video_key, t.artwork_key]), ...(albumResult.data ?? []).map(a => a.artwork_key), ...(upcomingArtworkResult.data ?? []).map(r => r.artwork_key), ...previewRows.map(t => t.preview_audio_key)].filter((key): key is string => Boolean(key)))];
      if (!keys.length) return;
      const { data: signed } = await supabase.storage.from("music-media").createSignedUrls(keys, 3600);
      if (alive && signed) setMediaUrls(Object.fromEntries(signed.flatMap(item => item.signedUrl && item.path ? [[item.path, item.signedUrl]] : [])));
    });
    return () => { alive = false; };
  }, [supabase]);

  useEffect(() => {
    const savedTab = window.localStorage.getItem("trapchik:last-tab");
    if (savedTab === "home" || savedTab === "music" || savedTab === "soon" || savedTab === "profile" || savedTab === "friends") setTab(savedTab);
  }, []);

  function changeTab(next: "home" | "music" | "soon" | "profile" | "friends") {
    setTab(next);
    window.localStorage.setItem("trapchik:last-tab", next);
  }

  const playableTracks: PlayerTrack[] = tracks.flatMap(t => {
    const audioKey = t.stream_audio_key || t.original_audio_key;
    const audioUrl = audioKey ? mediaUrls[audioKey] : undefined;
    return audioUrl ? [{ id: t.id, title: t.title, artist_name: t.artist_name, description: t.description, lyrics: normalizeLyrics(t.lyrics_lines), moods: t.moods ?? [], audioUrl, artworkUrl: t.artwork_key ? mediaUrls[t.artwork_key] : undefined, clipUrl: t.video_key ? mediaUrls[t.video_key] : undefined }] : [];
  });
  const currentTrack = queue.find(t => t.id === currentTrackId) ?? playableTracks.find(t => t.id === currentTrackId) ?? null;
  function requestPlay(track?: PlayerTrack) {
    if (!track || typeof document === "undefined") return;
    const audio = document.getElementById("trapchik-audio-player") as HTMLAudioElement | null;
    if (!audio) return;
    audio.src = track.audioUrl;
    audio.currentTime = 0;
    window.dispatchEvent(new Event("trapchik:resume-audio"));
    void audio.play().catch(() => undefined);
  }
  function shuffled<T>(items: T[]) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  function playTrack(id: string, playlist: PlayerTrack[] = playableTracks) {
    requestPlay(playlist.find(track => track.id === id));
    setQueue(playlist); setWaveQueueMode(false); setCurrentTrackId(id);
  }
  function playWave() {
    if (!playableTracks.length) return;
    const shuffledQueue = shuffled(playableTracks);
    requestPlay(shuffledQueue[0]);
    setQueue(shuffledQueue); setWaveQueueMode(true); setCurrentTrackId(shuffledQueue[0].id);
  }
  function playMood(mood: MusicMoodId) {
    const moodQueue = shuffled(playableTracks.filter(track => track.moods?.includes(mood)));
    setSelectedMood(mood);
    setMoodMessage("");
    if (!moodQueue.length) { setMoodMessage("В этой волне пока нет опубликованных треков."); return; }
    requestPlay(moodQueue[0]);
    setQueue(moodQueue); setWaveQueueMode(false); setCurrentTrackId(moodQueue[0].id);
  }
  function playPreview(track: UpcomingTrack, previews: PlayerTrack[]) {
    if (!previews.length) return;
    const id = `preview-${track.id}`;
    requestPlay(previews.find(item => item.id === id));
    setQueue(previews); setWaveQueueMode(false); setCurrentTrackId(id);
  }
  function skipTrack(direction: -1 | 1) {
    const activeQueue = queue.length ? queue : playableTracks;
    if (!activeQueue.length) return;
    const index = activeQueue.findIndex(t => t.id === currentTrackId);
    if (direction > 0 && index === activeQueue.length - 1 && waveQueueMode) {
      const nextQueue = shuffled(playableTracks);
      setQueue(nextQueue); setCurrentTrackId(nextQueue[0]?.id ?? null); return;
    }
    const nextIndex = index < 0 ? 0 : (index + direction + activeQueue.length) % activeQueue.length;
    setCurrentTrackId(activeQueue[nextIndex].id);
  }

  async function refreshFollowCounts(id: string, target: "own" | "viewed" = "own") {
    if (!supabase) return;
    const [followersResult, followingResult] = await Promise.all([
      supabase.from("user_follows").select("follower_id", { count: "exact", head: true }).eq("following_id", id),
      supabase.from("user_follows").select("following_id", { count: "exact", head: true }).eq("follower_id", id),
    ]);
    const error = followersResult.error || followingResult.error;
    if (error) { setMessage(`Не удалось обновить счётчики подписок: ${error.message}`); return; }
    const counts = { followers: followersResult.count ?? 0, following: followingResult.count ?? 0 };
    if (target === "own") setOwnFollowCounts(counts); else setViewedFollowCounts(counts);
  }

  async function searchPeople(value: string) {
    setPeopleQuery(value);
    if (!supabase || !userId || value.trim().length < 2) { setPeople([]); return; }
    setPeopleLoading(true);
    const { data, error } = await supabase.from("profiles").select("id,nickname,bio,avatar_key")
      .ilike("nickname", `%${value.trim()}%`).neq("id", userId).order("nickname", { ascending: true }).limit(20);
    setPeopleLoading(false);
    if (error) { setMessage(`Не удалось найти пользователей: ${error.message}`); return; }
    setPeople((data ?? []) as PublicProfile[]);
  }

  async function openPerson(person: PublicProfile) {
    if (!supabase || !userId) return;
    setSelectedPerson(person); setFollowListMode(null); setFollowList([]);
    const { data, error } = await supabase.from("user_follows").select("follower_id").eq("follower_id", userId).eq("following_id", person.id).maybeSingle();
    if (error) { setMessage(`Не удалось проверить подписку: ${error.message}`); setFollowing(false); }
    else setFollowing(!!data);
    await refreshFollowCounts(person.id, "viewed");
  }

  async function toggleFollow() {
    if (!supabase || !userId || !selectedPerson || selectedPerson.id === userId) return;
    setBusy(true);
    const wasFollowing = following;
    const result = wasFollowing
      ? await supabase.from("user_follows").delete().eq("follower_id", userId).eq("following_id", selectedPerson.id)
      : await supabase.from("user_follows").upsert({ follower_id: userId, following_id: selectedPerson.id }, { onConflict: "follower_id,following_id", ignoreDuplicates: true });
    if (result.error) { setBusy(false); setMessage(`Не удалось изменить подписку: ${result.error.message}`); return; }
    const { data: check, error: checkError } = await supabase.from("user_follows").select("follower_id").eq("follower_id", userId).eq("following_id", selectedPerson.id).maybeSingle();
    setBusy(false);
    if (checkError) { setMessage(`Изменение отправлено, но не удалось проверить результат: ${checkError.message}`); return; }
    const nowFollowing = !!check;
    setFollowing(nowFollowing);
    if (nowFollowing === wasFollowing) { setMessage(wasFollowing ? "Не удалось отписаться. Проверь права доступа к user_follows." : "Подписка не сохранилась. Проверь SQL-миграцию и права доступа."); return; }
    setMessage(nowFollowing ? `Ты подписался на ${selectedPerson.nickname || "пользователя"}.` : "Ты отписался от пользователя.");
    await refreshFollowCounts(selectedPerson.id, "viewed");
    await refreshFollowCounts(userId, "own");
  }

  async function showFollowList(mode: "followers" | "following") {
    if (!supabase || !userId) return;
    setFollowListMode(mode);
    setFollowListLoading(true);
    const column = mode === "followers" ? "follower_id" : "following_id";
    const matchColumn = mode === "followers" ? "following_id" : "follower_id";
    const { data, error } = await supabase.from("user_follows").select(column).eq(matchColumn, userId).limit(100);
    if (error) { setFollowListLoading(false); setMessage(`Не удалось загрузить список: ${error.message}`); return; }
    const ids = (data ?? []).map((row: any) => row[column]).filter(Boolean);
    if (!ids.length) { setFollowList([]); setFollowListLoading(false); return; }
    const { data: profiles, error: profileError } = await supabase.from("profiles").select("id,nickname,bio,avatar_key").in("id", ids);
    setFollowListLoading(false);
    if (profileError) { setMessage(`Не удалось загрузить профили: ${profileError.message}`); return; }
    const byId = new Map((profiles ?? []).map((profile: PublicProfile) => [profile.id, profile]));
    setFollowList(ids.map((id: string) => byId.get(id)).filter(Boolean) as PublicProfile[]);
  }

  async function signUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!supabase) return; setBusy(true); setMessage("");
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { nickname }, emailRedirectTo: `${window.location.origin}/` } });
    setBusy(false);
    if (error) setMessage(error.message);
    else { window.localStorage.setItem("trapchik:welcome-after-auth", "1"); setMessage(""); setEmailConfirmOpen(true); }
  }

  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!supabase) return; setBusy(true); setMessage("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password }); setBusy(false);
    if (error) { setMessage(error.message); return; }
    setUserEmail(data.user.email ?? email); setUserId(data.user.id); await loadProfile(data.user.id); changeTab("home"); setMessage("Ты вошёл в Трапчик.мп3.");
  }

  async function saveProfile() {
    if (!supabase || !userId) return; setBusy(true); setMessage("");
    const { error } = await supabase.from("profiles").update({ nickname: profileName.trim() || "Слушатель", bio: bio.trim() }).eq("id", userId);
    setBusy(false); if (error) setMessage(`Не удалось сохранить профиль: ${error.message}`); else { setNickname(profileName); setEditing(false); setMessage("Профиль сохранён."); }
  }

  function selectAvatar(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Выбери файл изображения."); return; }
    if (file.size > 10 * 1024 * 1024) { setMessage("Исходное изображение должно быть не больше 10 МБ."); return; }
    if (cropPreview) URL.revokeObjectURL(cropPreview);
    setCropFile(file); setCropPreview(URL.createObjectURL(file)); setCropDimensions({ width: 1, height: 1 }); setCropX(0); setCropY(0); setCropZoom(1); setMessage("");
  }

  function cancelAvatarCrop() {
    if (cropPreview) URL.revokeObjectURL(cropPreview);
    setCropPreview(""); setCropFile(null);
  }

  async function saveCroppedAvatar() {
    if (!supabase || !userId || !cropFile) return;
    setBusy(true); setMessage("");
    try {
      const image = await createImageBitmap(cropFile);
      const side = Math.min(image.width, image.height) / cropZoom;
      const left = (image.width - side) / 2 + (cropX / 100) * (image.width - side) / 2;
      const top = (image.height - side) / 2 + (cropY / 100) * (image.height - side) / 2;
      const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не получилось подготовить изображение.");
      context.drawImage(image, left, top, side, side, 0, 0, 512, 512);
      image.close();
      const cropped = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Не получилось обрезать изображение.")), "image/png"));
      const path = `${userId}/${Date.now()}-avatar.png`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, cropped, { upsert: false, contentType: "image/png" });
      if (uploadError) throw new Error(`Не удалось загрузить аватарку: ${uploadError.message}`);
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error } = await supabase.from("profiles").update({ avatar_key: data.publicUrl }).eq("id", userId);
      if (error) throw new Error(`Аватар загружен, но профиль не обновился: ${error.message}`);
      setAvatarUrl(data.publicUrl); cancelAvatarCrop(); setMessage("Аватарка обновлена.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить аватарку.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (!supabase) return; await supabase.auth.signOut(); setUserEmail(null); setUserId(null); setIsAdmin(false); setProfileName("Слушатель"); setBio(""); setAvatarUrl(DEFAULT_AVATAR); setReviews([]); setMessage("Ты вышел из аккаунта.");
  }

  const filtered = albums.filter(a => `${a.title} ${a.artist_name}`.toLowerCase().includes(search.toLowerCase()));
  const filteredTracks = tracks.filter(t => `${t.title} ${t.artist_name}`.toLowerCase().includes(search.toLowerCase()));
  const artistTrackCatalog = tracks.filter(t => `${t.title} ${t.artist_name}`.toLowerCase().includes(search.toLowerCase()));
  const artistNameMap = new Map<string, string>();
  for (const artist of artistDefinitions) if (!search || artist.name.toLocaleLowerCase("ru-RU").includes(search.toLocaleLowerCase("ru-RU"))) artistNameMap.set(artist.name.toLocaleLowerCase("ru-RU"), artist.name);
  for (const track of artistTrackCatalog) for (const name of splitArtistNames(track.artist_name)) artistNameMap.set(name.toLocaleLowerCase("ru-RU"), name);
  const artistOptions = [...artistNameMap.entries()]
    .map(([key, name]) => ({ key, name, count: artistTrackCatalog.filter(t => splitArtistNames(t.artist_name).some(artist => artist.toLocaleLowerCase("ru-RU") === key)).length }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const selectedArtistTracks = selectedArtist ? artistTrackCatalog.filter(t => splitArtistNames(t.artist_name).some(name => name.toLocaleLowerCase("ru-RU") === selectedArtist.toLocaleLowerCase("ru-RU"))) : [];
  const selectedArtistQueue = selectedArtistTracks.flatMap(t => { const song = playableTracks.find(item => item.id === t.id); return song ? [song] : []; });
  const selectedAlbumTracks = selectedAlbum ? tracks.filter(t => t.album_id === selectedAlbum.id).sort((a, b) => (a.track_number ?? 9999) - (b.track_number ?? 9999)) : [];
  function albumQueueFor(albumId: string) {
    return tracks.filter(t => t.album_id === albumId).sort((a, b) => (a.track_number ?? 9999) - (b.track_number ?? 9999)).flatMap(t => {
      const playerTrack = playableTracks.find(item => item.id === t.id);
      return playerTrack ? [playerTrack] : [];
    });
  }
  function previewsFor(release: Upcoming) {
    return upcomingTracks.filter(t => t.upcoming_release_id === release.id && t.preview_audio_key && mediaUrls[t.preview_audio_key]).map(t => {
      const facts = t.facts && typeof t.facts === "object" ? t.facts as { artists?: string } : {};
      return { id: `preview-${t.id}`, title: t.title, artist_name: facts.artists || release.artist_name, audioUrl: mediaUrls[t.preview_audio_key!]!, artworkUrl: release.artwork_key ? mediaUrls[release.artwork_key] : undefined };
    });
  }

  return <main className="shell">
    <header className="topbar">
      <button className="menuToggle" type="button" aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}>
        <span/><span/><span/>
      </button>
      <a className="brand" href="/"><span className="brandMark">Т</span><span>ТРАПЧИК<span className="brandDot">.МР3</span></span></a>
      <span className="online">{userEmail ? "● В сети" : "● Гость"}</span>
    </header>

    {menuOpen && <button type="button" className="menuBackdrop" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
    <aside className={menuOpen ? "sideMenu open" : "sideMenu"} aria-hidden={!menuOpen} inert={!menuOpen}>
      <div className="sideMenuHead"><span className="eyebrow">НАВИГАЦИЯ</span><button type="button" className="menuClose" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)}>×</button></div>
      <button type="button" className={tab === "home" ? "sideNav active" : "sideNav"} onClick={() => { changeTab("home"); setMenuOpen(false); }}><span>⌂</span> Главная</button>
      <button type="button" className={tab === "music" ? "sideNav active" : "sideNav"} onClick={() => { changeTab("music"); setMenuOpen(false); }}><span>♫</span> Музыка</button>
      <button type="button" className={tab === "soon" ? "sideNav active" : "sideNav"} onClick={() => { changeTab("soon"); setMenuOpen(false); }}><span>◷</span> Скоро</button>
      <button type="button" className={tab === "profile" ? "sideNav active" : "sideNav"} onClick={() => { changeTab("profile"); setMenuOpen(false); }}><NavProfileIcon/> Профиль</button>
      <button type="button" className={tab === "friends" ? "sideNav active" : "sideNav"} onClick={() => { changeTab("friends"); setMenuOpen(false); }}><span>✳</span> Сообщество</button>
      {isAdmin && <Link className="sideNav" href="/admin"><span>⚙</span> Админ-панель</Link>}
      <div className="sideMenuFoot">ТРАПЧИК.МР3</div>
    </aside>

    {tab === "home" && <section className="homeWelcome">
      <div className="homeWelcomeText"><div className="eyebrow">ДОБРО ПОЖАЛОВАТЬ</div><h1>Скррррр Пау!</h1><p>Шараут, братух, это Трапчик.мп3, место, где музыка прет отовсюду</p><button type="button" className="primary" onClick={() => { setMenuOpen(true); }}>Открыть меню</button></div>
      <div className="heroArt" aria-hidden="true"><div className="orb orbOne"/><div className="orb orbTwo"/><div className="heroGlyph">Т<span>.</span></div><div className="heroCaption">INDEPENDENT SOUND<br/>EST. 2026</div></div>
    </section>}

    {message && <div className="notice">{message}</div>}

    {welcomeOpen && !userEmail && <div className="modalBackdrop" role="presentation">
      <section className="appModal welcomeModal" role="dialog" aria-modal="true" aria-labelledby="welcomeTitle">
        <div className="modalEyebrow">ТРАПЧИК.МР3</div>
        <h2 id="welcomeTitle">Шарррррраут!</h2>
        <p>Чтобы перейти на сайт и слушать жесткий трапчик, зарегистрируйся или войди в уже существующий аккаунт!</p>
        <div className="modalActions">
          <button className="secondary" type="button" onClick={() => { setAuthMode("login"); changeTab("profile"); setWelcomeOpen(false); setMessage(""); }}>Войти</button>
          <button className="primary" type="button" onClick={() => { setAuthMode("register"); changeTab("profile"); setWelcomeOpen(false); setMessage(""); }}>Зарегистрироваться</button>
        </div>
      </section>
    </div>}

    {emailConfirmOpen && <div className="modalBackdrop" role="presentation">
      <section className="appModal" role="dialog" aria-modal="true" aria-labelledby="emailConfirmTitle">
        <div className="modalEyebrow">ПОЧТИ ГОТОВО</div>
        <h2 id="emailConfirmTitle">Ещё чуть-чуть!</h2>
        <p>Осталось подтвердить почту, шараут на нее уже отправлен!</p>
        <div className="modalActions singleAction"><button className="primary" type="button" onClick={() => setEmailConfirmOpen(false)}>Ок</button></div>
      </section>
    </div>}

    {tab === "music" && (selectedAlbum ? <section className="section albumDetailPage" key={selectedAlbum.id}>
      <button className="albumBack" type="button" onClick={() => setSelectedAlbum(null)}>← К альбомам</button>
      <div className="albumDetailLayout"><div className="albumDetailCover">{selectedAlbum.artwork_key && mediaUrls[selectedAlbum.artwork_key] ? <img src={mediaUrls[selectedAlbum.artwork_key]} alt={`Обложка: ${selectedAlbum.title}`} /> : <div className="trackArtworkEmpty">♫</div>}<div><span className="eyebrow">АЛЬБОМ</span><h1>{selectedAlbum.title}</h1><p>{selectedAlbum.artist_name}</p>{selectedAlbum.description && <small>{selectedAlbum.description}</small>}</div></div>
        <div className="albumDetailList"><div className="eyebrow">ТРЕКЛИСТ</div>{selectedAlbumTracks.length ? selectedAlbumTracks.map((track, index) => { const song = playableTracks.find(item => item.id === track.id); const albumQueue = albumQueueFor(selectedAlbum.id); return <button type="button" className={`albumTrackRow${currentTrackId === track.id ? " playing" : ""}`} key={track.id} disabled={!song} onClick={() => playTrack(track.id, albumQueue)}><span className="albumTrackNo">{String(index + 1).padStart(2, "0")}</span><span className="albumTrackText"><b>{track.title}</b><small>{track.artist_name}</small></span><span className="albumTrackPlay">{currentTrackId === track.id ? "Ⅱ" : "▶"}</span></button>; }) : <div className="empty"><p>В этом альбоме пока нет треков.</p></div>}</div>
      </div>
    </section> : <section className="section musicSection">
      <div className="sectionHead musicSearchHead"><div><div className="eyebrow">БИБЛИОТЕКА</div><h2>Музыка</h2></div></div>
      <label className="musicSearch musicSearchCentered"><span aria-hidden="true">⌕</span><input placeholder="Поиск треков и исполнителей..." value={search} onChange={e => { setSearch(e.target.value); setSelectedArtist(null); }} /></label>
      <CrystalizedWave playing={playerPlaying} disabled={!playableTracks.length} onClick={playWave} />
      <section className="moodSection" aria-label="Волны по настроению">
        <div className="moodSectionHead"><div><div className="eyebrow">ВЫБЕРИ НАСТРОЕНИЕ</div><h3>Твоя волна</h3></div>{moodMessage && <p role="status">{moodMessage}</p>}</div>
        <div className="moodMarquee"><div className="moodMarqueeTrack">{[0, 1].map(copy => <div className="moodMarqueeGroup" key={copy} aria-hidden={copy === 1 ? true : undefined}>{moodDefinitions.map(mood => <button type="button" key={mood.id} tabIndex={copy === 1 ? -1 : undefined} className={`moodButton${selectedMood === mood.id ? " active" : ""}`} style={{ "--mood-color": mood.color } as CSSProperties} onClick={() => playMood(mood.id)}><span className="moodButtonPulse"/><span className="moodButtonText">{mood.name}</span><small>{selectedMood === mood.id && playerPlaying ? "Играет волна" : "Запустить волну"}</small><span className="moodButtonArrow">↗</span></button>)}</div>)}</div></div>
      </section>
      <section className="artistSection" aria-label="Исполнители">
        <div className="artistSectionHead"><div><div className="eyebrow">ГОЛОСА И ФИТЫ</div><h3>Артисты</h3></div>{selectedArtist && <button type="button" className="artistClear" onClick={() => setSelectedArtist(null)}>Все артисты</button>}</div>
        {artistOptions.length ? <ArtistRail artists={artistOptions} selectedArtist={selectedArtist} onSelect={name => setSelectedArtist(current => current?.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU") ? null : name)} /> : <p className="artistEmpty">Артисты появятся здесь после публикации треков.</p>}
        {selectedArtist && <div className="artistTrackPanel"><div className="artistTrackPanelHead"><div><span className="eyebrow">АРТИСТ И ФИТЫ</span><h4>{selectedArtist}</h4></div><span>{selectedArtistTracks.length} {selectedArtistTracks.length === 1 ? "трек" : "треков"}</span></div>{selectedArtistTracks.length ? <div className="artistTrackList">{selectedArtistTracks.map((track, index) => { const song = selectedArtistQueue.find(item => item.id === track.id); return <article className="artistTrackRow" key={track.id}><span className="artistTrackIndex">{String(index + 1).padStart(2, "0")}</span>{track.artwork_key && mediaUrls[track.artwork_key] ? <img src={mediaUrls[track.artwork_key]} alt=""/> : <span className="artistTrackArtwork">♫</span>}<span className="artistTrackInfo"><b>{track.title}</b><small>{track.artist_name}{track.album_id ? " · альбом" : " · сингл"}</small></span><button type="button" disabled={!song} aria-label={`Слушать ${track.title}`} onClick={() => song && playTrack(track.id, selectedArtistQueue)}>{currentTrackId === track.id && playerPlaying ? "Ⅱ" : "▶"}</button></article>; })}</div> : <p className="artistEmpty">По этому запросу треки артиста не найдены.</p>}</div>}
      </section>
      {!!filteredTracks.length && <><h3 className="subsectionTitle">Все треки</h3><div className="trackList">{filteredTracks.map(t => {
        const audioKey = t.stream_audio_key || t.original_audio_key;
        return <article className="trackCard" key={t.id}>
          <div className="trackHeading">{t.artwork_key && mediaUrls[t.artwork_key] ? <img className="trackArtwork" src={mediaUrls[t.artwork_key]} alt={`Обложка: ${t.title}`}/> : <div className="trackArtwork trackArtworkEmpty">♫</div>}<div><h3>{t.title}</h3><p>{t.artist_name}</p>{t.description && <small>{t.description}</small>}</div><button type="button" className="primary trackPlay" disabled={!audioKey || !mediaUrls[audioKey]} onClick={() => playTrack(t.id)}>{currentTrackId === t.id ? "Сейчас играет" : "Слушать"}</button></div>
        </article>;
      })}</div></>}
      {filtered.length ? <><h3 className="subsectionTitle">Альбомы</h3><div className="albumGrid">{filtered.map((a, i) => { const albumTrackCount = tracks.filter(t => t.album_id === a.id).length; return <button type="button" className="album albumButton" key={a.id} onClick={() => setSelectedAlbum(a)}><div className={`cover cover${i % 4}`}>{a.artwork_key && mediaUrls[a.artwork_key] ? <img className="actualCover" src={mediaUrls[a.artwork_key]} alt={`Обложка: ${a.title}`}/> : <><span>Т.МР3</span><b>{a.title.slice(0,1).toUpperCase()}</b></>}</div><div className="albumInfo"><h3>{a.title}</h3><p>{a.artist_name}</p><small>{albumTrackCount ? `${albumTrackCount} трек(а/ов) · Открыть альбом →` : "Треклист загружается · Открыть →"}</small>{a.release_date && <small>{new Date(a.release_date).toLocaleDateString("ru-RU")}</small>}</div></button>; })}</div></> : null}
      {!filtered.length && !filteredTracks.length && <div className="empty"><div className="emptyIcon">♫</div><h3>{search ? "Ничего не найдено" : "Пока здесь тихо"}</h3><p>{search ? "Попробуй другой запрос." : "Опубликованные альбомы и треки появятся здесь."}</p></div>}
    </section>)}

    {tab === "soon" && <section className="section"><div className="sectionHead"><div><div className="eyebrow">НА ГОРИЗОНТЕ</div><h2>Скоро</h2></div></div>
      {upcoming.length ? <div className="soonList">{upcoming.map((r, i) => { const releaseTracks = upcomingTracks.filter(t => t.upcoming_release_id === r.id).sort((a,b) => (a.track_number ?? 9999) - (b.track_number ?? 9999)); const previewQueue = previewsFor(r); return <article className="soonCard" key={r.id}><div className={`soonCover cover${i%4}`}>{r.artwork_key && mediaUrls[r.artwork_key] ? <img src={mediaUrls[r.artwork_key]} alt=""/> : "SOON"}</div><div><span className="tag">{r.release_type === "single" ? "Сингл" : r.release_type === "ep" ? "EP" : "Альбом"}</span><h3>{r.title}</h3><p>{r.artist_name}</p>{r.description && <p className="muted">{r.description}</p>}{releaseTracks.length > 0 ? <div className="soonTracks">{releaseTracks.map(track => { const hasPreview = Boolean(track.preview_audio_key && mediaUrls[track.preview_audio_key]); const previewId = `preview-${track.id}`; return <div className="soonTrack" key={track.id}><span>{track.track_number ? `${track.track_number}. ` : ""}{track.title}</span>{hasPreview && <button type="button" className="previewButton" onClick={() => playPreview(track, previewQueue)}>{currentTrackId === previewId ? "Сейчас играет" : "Сниппет ▶"}</button>}</div>; })}</div> : <p className="muted soonEmptyTracks">Треклист готовится.</p>}</div><div className="releaseDate">{r.release_at ? new Date(r.release_at).toLocaleDateString("ru-RU") : "Дата уточняется"}</div></article>; })}</div> : <div className="empty"><div className="emptyIcon">◷</div><h3>Готовим новые релизы</h3><p>Анонсы с датами выхода и превью появятся здесь.</p></div>}
    </section>}

    {tab === "friends" && <Community supabase={supabase} userId={userId} isAdmin={isAdmin} onOpenProfile={(person) => { changeTab("friends"); void openPerson(person); }} />}

    {tab === "profile" && <section className="section profileSection">
      {!userEmail ? <div className="authWrap"><div className="eyebrow">АККАУНТ ТРАПЧИК.МР3</div><h2>{authMode === "register" ? "Создать аккаунт" : "С возвращением"}</h2>
        {authMode === "register" ? <form className="authCard authSingle" onSubmit={signUp}><label>Никнейм<input required maxLength={40} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Как тебя показывать?"/></label><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/></label><label>Пароль<div className="passwordField"><input type={showPassword ? "text" : "password"} required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Не менее 6 символов"/><button type="button" className="passwordToggle" aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? "◉" : "◎"}</button></div></label><button className="primary full" disabled={busy}>Зарегистрироваться</button><small>После регистрации нужно подтвердить email по ссылке из письма.</small><p className="authSwitch">Уже есть аккаунт? <button type="button" onClick={() => { setAuthMode("login"); setShowPassword(false); setMessage(""); }}>Войти</button></p></form> : <form className="authCard authSingle" onSubmit={signIn}><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/></label><label>Пароль<div className="passwordField"><input type={showPassword ? "text" : "password"} required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль"/><button type="button" className="passwordToggle" aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? "◉" : "◎"}</button></div></label><button className="primary full" disabled={busy}>Войти</button><p className="authSwitch">Нет аккаунта? <button type="button" onClick={() => { setAuthMode("register"); setShowPassword(false); setMessage(""); }}>Зарегистрироваться</button></p></form>}
      </div> : <div className="userProfile">
        <div className="profileIdentity"><div className="avatarFrame"><img src={avatarUrl || DEFAULT_AVATAR} alt="Аватар пользователя" className="profileAvatar"/><label className="avatarChange">Изменить фото<input type="file" accept="image/*" onChange={e => { selectAvatar(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} disabled={busy}/></label></div>
          {editing ? <div className="profileEdit"><label>Никнейм<input value={profileName} maxLength={40} onChange={e => setProfileName(e.target.value)}/></label><label>Описание<textarea value={bio} maxLength={300} onChange={e => setBio(e.target.value)} placeholder="Расскажи немного о себе..."/></label><div className="profileActions"><button className="primary" onClick={saveProfile} disabled={busy}>Сохранить</button><button className="secondary" onClick={() => { setEditing(false); loadProfile(userId!); }}>Отмена</button></div></div> : <><h2 className="profileNickname">{profileName}</h2><p className="profileBio">{bio || ""}</p><button className="secondary editProfile" onClick={() => setEditing(true)}>Редактировать профиль</button><div className="profileFollowNumbers"><button type="button" onClick={() => showFollowList("followers")}><b>{ownFollowCounts.followers}</b><span>Подписчики</span></button><button type="button" onClick={() => showFollowList("following")}><b>{ownFollowCounts.following}</b><span>Подписки</span></button></div></>}
        {followListMode && <div className="followPanel"><div className="followPanelHead"><b>{followListMode === "followers" ? "Подписчики" : "Подписки"}</b><button type="button" onClick={() => setFollowListMode(null)}>Закрыть</button></div>{followListLoading ? <p className="muted">Загружаем список…</p> : followList.length ? followList.map(person => <button className="personRow" type="button" key={person.id} onClick={() => { changeTab("friends"); openPerson(person); }}><img src={person.avatar_key || DEFAULT_AVATAR} alt=""/><span>{person.nickname || "Слушатель"}</span><small>Открыть профиль →</small></button>) : <p className="muted">Пока здесь никого нет.</p>}</div>}
        </div>
        <div className="profileTabs"><button className={profileTab === "inventory" ? "profileTab active" : "profileTab"} onClick={() => setProfileTab("inventory")}>Инвентарь</button><button className={profileTab === "ratings" ? "profileTab active" : "profileTab"} onClick={() => setProfileTab("ratings")}>Оценки</button></div>
        {profileTab === "inventory" ? <div className="profileEmpty"><p>Инвентарь пока пуст.</p></div> : reviews.length ? <div className="reviewList">{reviews.map(r => <article className="reviewItem" key={r.id}><div className="reviewTop"><b>{r.albums?.title || "Альбом"}</b><span>★ {r.rating}/10</span></div>{r.albums?.artist_name && <small>{r.albums.artist_name}</small>}{r.comment && <p>{r.comment}</p>}<time>{new Date(r.created_at).toLocaleDateString("ru-RU")}</time></article>)}</div> : <div className="profileEmpty"><p>бро рил еще не оставил ни одного кома бич</p></div>}
        <div className="profileLogout"><button className="secondary" onClick={signOut}>Выйти из аккаунта</button></div>
      </div>}
    </section>}

    <footer><span>ТРАПЧИК.МР3 © 2026</span><span>СДЕЛАНО ДЛЯ МУЗЫКИ</span></footer>
    <AudioPlayer track={currentTrack} onNext={() => skipTrack(1)} onPrevious={() => skipTrack(-1)} onAudioLevel={level => window.dispatchEvent(new CustomEvent("trapchik:audio-level", { detail: level }))} onPlaybackChange={setPlayerPlaying} />
    {cropFile && cropPreview && <div className="cropBackdrop" role="presentation"><section className="cropDialog" role="dialog" aria-modal="true" aria-labelledby="cropTitle">
      <button type="button" className="cropClose" aria-label="Отменить кадрирование" onClick={cancelAvatarCrop}>×</button><div className="eyebrow">ПРОФИЛЬ</div><h2 id="cropTitle">Настроить аватарку</h2><p className="cropHelp">Передвигай фото ползунками и выбери удобный масштаб.</p>
      <div className="cropViewport"><img src={cropPreview} alt="Предпросмотр аватарки" onLoad={e => setCropDimensions({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} style={(() => { const ratio = cropDimensions.width / cropDimensions.height; const width = Math.max(220, 220 * ratio) * cropZoom; const height = Math.max(220, 220 / ratio) * cropZoom; return { width: `${width}px`, height: `${height}px`, left: `${(220 - width) / 2 - (cropX / 100) * (width - 220) / 2}px`, top: `${(220 - height) / 2 - (cropY / 100) * (height - 220) / 2}px` }; })()} /></div>
      <label className="cropRange">Масштаб<input type="range" min="1" max="3" step="0.01" value={cropZoom} onChange={e => setCropZoom(Number(e.target.value))}/></label>
      <label className="cropRange">По горизонтали: {cropX}<input type="range" min="-100" max="100" value={cropX} onChange={e => { const value = Number(e.target.value); setCropX(value); if (value !== 0 && cropZoom === 1) setCropZoom(1.4); }}/></label>
      <label className="cropRange">По вертикали<input type="range" min="-100" max="100" value={cropY} onChange={e => { const value = Number(e.target.value); setCropY(value); if (value !== 0 && cropZoom === 1) setCropZoom(1.4); }}/></label>
      <div className="cropActions"><button type="button" className="secondary" disabled={busy} onClick={cancelAvatarCrop}>Отмена</button><button type="button" className="primary" disabled={busy} onClick={saveCroppedAvatar}>{busy ? "Сохраняю…" : "Сохранить аватарку"}</button></div>
    </section></div>}
  </main>;
}
