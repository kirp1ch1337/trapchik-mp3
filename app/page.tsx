"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

type Album = { id: string; title: string; artist_name: string; description: string | null; artwork_key: string | null; release_date: string | null };
type Track = { id: string; title: string; artist_name: string; description: string | null; original_audio_key: string | null; stream_audio_key: string | null; artwork_key: string | null; video_key: string | null };
type Upcoming = { id: string; title: string; artist_name: string; release_type: string; description: string | null; release_at: string | null };
type Review = { id: string; rating: number; comment: string | null; created_at: string; albums: { title: string; artist_name: string } | null };

const DEFAULT_AVATAR = "/default-avatar.png";

export default function Home() {
  const [tab, setTab] = useState<"music" | "soon" | "profile">("music");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const supabase = useMemo(() => { try { return supabaseBrowser(); } catch { return null; } }, []);

  const loadProfile = useCallback(async (id: string) => {
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
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!alive || !data.user) return;
      setUserEmail(data.user.email ?? null); setUserId(data.user.id); await loadProfile(data.user.id);
    });
    supabase.from("albums").select("id,title,artist_name,description,artwork_key,release_date")
      .eq("status", "published").order("release_date", { ascending: false }).then(({ data, error }) => {
        if (!alive) return; if (error) setMessage("Не удалось загрузить каталог. Проверь политики доступа и подключение."); setAlbums((data ?? []) as Album[]);
      });
    supabase.from("upcoming_releases").select("id,title,artist_name,release_type,description,release_at")
      .eq("status", "published").order("release_at", { ascending: true }).then(({ data }) => { if (alive) setUpcoming((data ?? []) as Upcoming[]); });
    Promise.all([
      supabase.from("tracks").select("id,title,artist_name,description,original_audio_key,stream_audio_key,artwork_key,video_key").eq("status", "published").order("created_at", { ascending: false }),
      supabase.from("albums").select("artwork_key").eq("status", "published"),
    ]).then(async ([trackResult, albumResult]) => {
      if (!alive) return;
      const rows = (trackResult.data ?? []) as Track[];
      setTracks(rows);
      const keys = [...new Set([...rows.flatMap(t => [t.original_audio_key, t.stream_audio_key, t.video_key, t.artwork_key]), ...(albumResult.data ?? []).map(a => a.artwork_key)].filter((key): key is string => Boolean(key)))];
      if (!keys.length) return;
      const { data: signed } = await supabase.storage.from("music-media").createSignedUrls(keys, 3600);
      if (!alive || !signed) return;
      setMediaUrls(Object.fromEntries(signed.flatMap(item => item.signedUrl && item.path ? [[item.path, item.signedUrl]] : [])));
    });
    return () => { alive = false; };
  }, [supabase, loadProfile]);

  async function signUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!supabase) return; setBusy(true); setMessage("");
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { nickname }, emailRedirectTo: `${window.location.origin}/` } });
    setBusy(false); setMessage(error ? error.message : "Письмо для подтверждения отправлено на почту. Перейди по ссылке из письма, чтобы активировать аккаунт.");
  }

  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!supabase) return; setBusy(true); setMessage("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password }); setBusy(false);
    if (error) { setMessage(error.message); return; }
    setUserEmail(data.user.email ?? email); setUserId(data.user.id); await loadProfile(data.user.id); setMessage("Ты вошёл в Трапчик.мп3.");
  }

  async function saveProfile() {
    if (!supabase || !userId) return; setBusy(true); setMessage("");
    const { error } = await supabase.from("profiles").update({ nickname: profileName.trim() || "Слушатель", bio: bio.trim() }).eq("id", userId);
    setBusy(false); if (error) setMessage(`Не удалось сохранить профиль: ${error.message}`); else { setNickname(profileName); setEditing(false); setMessage("Профиль сохранён."); }
  }

  async function uploadAvatar(file?: File) {
    if (!supabase || !userId || !file) return;
    if (!file.type.startsWith("image/")) { setMessage("Выбери файл изображения."); return; }
    if (file.size > 5 * 1024 * 1024) { setMessage("Изображение должно быть не больше 5 МБ."); return; }
    setBusy(true); setMessage("");
    const path = `${userId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) { setBusy(false); setMessage(`Не удалось загрузить аватарку: ${uploadError.message}`); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const { error } = await supabase.from("profiles").update({ avatar_key: data.publicUrl }).eq("id", userId);
    setBusy(false); if (error) setMessage(`Аватар загружен, но профиль не обновился: ${error.message}`); else { setAvatarUrl(data.publicUrl); setMessage("Аватарка обновлена."); }
  }

  async function signOut() {
    if (!supabase) return; await supabase.auth.signOut(); setUserEmail(null); setUserId(null); setIsAdmin(false); setProfileName("Слушатель"); setBio(""); setAvatarUrl(DEFAULT_AVATAR); setReviews([]); setMessage("Ты вышел из аккаунта.");
  }

  const filtered = albums.filter(a => `${a.title} ${a.artist_name}`.toLowerCase().includes(search.toLowerCase()));

  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="brandMark">Т</span><span>ТРАПЧИК<span className="brandDot">.МР3</span></span></a>
      <nav>
        <button className={tab === "music" ? "nav active" : "nav"} onClick={() => setTab("music")}>Музыка</button>
        <button className={tab === "soon" ? "nav active" : "nav"} onClick={() => setTab("soon")}>Скоро</button>
        <button className={tab === "profile" ? "nav active" : "nav"} onClick={() => setTab("profile")}>Профиль</button>
      </nav>
      <button className="menuToggle" type="button" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}>☰</button>
      <span className="online">{userEmail ? "● В сети" : "● Гость"}</span>
    </header>
    {menuOpen && <><button className="menuScrim" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} /><aside className="sideMenu" aria-label="Боковое меню"><button className="menuClose" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню">×</button><Link className="menuBrand" href="/">ТРАПЧИК<span>.МР3</span></Link><button onClick={() => { setTab("music"); setMenuOpen(false); }}>Музыка</button><button onClick={() => { setTab("soon"); setMenuOpen(false); }}>Скоро</button><button onClick={() => { setTab("profile"); setMenuOpen(false); }}>Профиль</button>{isAdmin && <Link href="/admin">Админ-панель</Link>}</aside></>}

    {tab !== "profile" && <section className="hero">
      <div className="heroText"><div className="eyebrow">ТВОЯ МУЗЫКА. ТВОИ ПРАВИЛА.</div><h1>Здесь звучит<br/><em>Трапчик.мп3</em></h1><p>Релизы, которые хочется переслушивать. Без лишнего шума — только музыка.</p><button className="primary" onClick={() => setTab("music")}>Открыть каталог <span>↗</span></button></div>
      <div className="heroArt" aria-hidden="true"><div className="orb orbOne"/><div className="orb orbTwo"/><div className="heroGlyph">Т<span>.</span></div><div className="heroCaption">INDEPENDENT SOUND<br/>EST. 2026</div></div>
    </section>}

    {(message || (!supabase ? "Подключи Supabase: заполни .env.local по инструкции." : "")) && <div className="notice">{message || "Подключи Supabase: заполни .env.local по инструкции."}</div>}

    {tab === "music" && <section className="section"><div className="sectionHead"><div><div className="eyebrow">БИБЛИОТЕКА</div><h2>Каталог музыки</h2></div><input className="search" placeholder="Поиск релиза..." value={search} onChange={e => setSearch(e.target.value)}/></div>
      {tracks.length > 0 && <div className="trackList">{tracks.filter(t => `${t.title} ${t.artist_name}`.toLowerCase().includes(search.toLowerCase())).map(t => <article className="trackCard" key={t.id}>
        <div className="trackHeading">{t.artwork_key && mediaUrls[t.artwork_key] ? <Image className="trackArtwork" src={mediaUrls[t.artwork_key]} alt={`Обложка: ${t.title}`} width={66} height={66} unoptimized /> : <div className="trackArtwork trackArtworkEmpty">♫</div>}<div><h3>{t.title}</h3><p>{t.artist_name}</p>{t.description && <small>{t.description}</small>}</div></div>
        {(t.stream_audio_key || t.original_audio_key) && mediaUrls[t.stream_audio_key || t.original_audio_key!] && <audio controls preload="none" src={mediaUrls[t.stream_audio_key || t.original_audio_key!]} />}
        {t.video_key && mediaUrls[t.video_key] && <video controls preload="none" src={mediaUrls[t.video_key]} aria-label={`Клип: ${t.title}`} />}
      </article>)}</div>}
      {filtered.length ? <div className="albumGrid">{filtered.map((a, i) => <article className="album" key={a.id}><div className={`cover cover${i % 4}`}>{a.artwork_key && mediaUrls[a.artwork_key] ? <Image fill sizes="(max-width: 760px) 50vw, 25vw" className="actualCover" src={mediaUrls[a.artwork_key]} alt={`Обложка: ${a.title}`} unoptimized /> : <><span>Т.МР3</span><b>{a.title.slice(0,1).toUpperCase()}</b></>}</div><div className="albumInfo"><h3>{a.title}</h3><p>{a.artist_name}</p>{a.release_date && <small>{new Date(a.release_date).toLocaleDateString("ru-RU")}</small>}</div></article>)}</div> : tracks.length === 0 ? <div className="empty"><div className="emptyIcon">♫</div><h3>Пока здесь тихо</h3><p>Опубликованные альбомы появятся здесь, когда администратор добавит музыку.</p></div> : null}
    </section>}

    {tab === "soon" && <section className="section"><div className="sectionHead"><div><div className="eyebrow">НА ГОРИЗОНТЕ</div><h2>Скоро</h2></div></div>
      {upcoming.length ? <div className="soonList">{upcoming.map((r, i) => <article className="soonCard" key={r.id}><div className={`soonCover cover${i%4}`}>SOON</div><div><span className="tag">{r.release_type === "single" ? "Сингл" : r.release_type === "ep" ? "EP" : "Альбом"}</span><h3>{r.title}</h3><p>{r.artist_name}</p>{r.description && <p className="muted">{r.description}</p>}</div><div className="releaseDate">{r.release_at ? new Date(r.release_at).toLocaleDateString("ru-RU") : "Дата уточняется"}</div></article>)}</div> : <div className="empty"><div className="emptyIcon">◷</div><h3>Готовим новые релизы</h3><p>Анонсы с датами выхода и превью появятся здесь.</p></div>}
    </section>}

    {tab === "profile" && <section className="section profileSection">
      {!userEmail ? <div className="authWrap"><div className="eyebrow">АККАУНТ ТРАПЧИК.МР3</div><h2>{authMode === "register" ? "Создать аккаунт" : "С возвращением"}</h2>
        {authMode === "register" ? <form className="authCard authSingle" onSubmit={signUp}><label>Никнейм<input required maxLength={40} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Как тебя показывать?"/></label><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/></label><label>Пароль<input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Не менее 6 символов"/></label><button className="primary full" disabled={busy}>Зарегистрироваться</button><small>После регистрации нужно подтвердить email по ссылке из письма.</small><p className="authSwitch">Уже есть аккаунт? <button type="button" onClick={() => { setAuthMode("login"); setMessage(""); }}>Войти</button></p></form> : <form className="authCard authSingle" onSubmit={signIn}><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/></label><label>Пароль<input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль"/></label><button className="primary full" disabled={busy}>Войти</button><p className="authSwitch">Нет аккаунта? <button type="button" onClick={() => { setAuthMode("register"); setMessage(""); }}>Зарегистрироваться</button></p></form>}
      </div> : <div className="userProfile">
        <div className="profileIdentity"><div className="avatarFrame"><Image src={avatarUrl || DEFAULT_AVATAR} alt="Аватар пользователя" className="profileAvatar" width={158} height={158} unoptimized/><label className="avatarChange">Изменить фото<input type="file" accept="image/*" onChange={e => uploadAvatar(e.target.files?.[0])} disabled={busy}/></label></div>
          {editing ? <div className="profileEdit"><label>Никнейм<input value={profileName} maxLength={40} onChange={e => setProfileName(e.target.value)}/></label><label>Описание<textarea value={bio} maxLength={300} onChange={e => setBio(e.target.value)} placeholder="Расскажи немного о себе..."/></label><div className="profileActions"><button className="primary" onClick={saveProfile} disabled={busy}>Сохранить</button><button className="secondary" onClick={() => { setEditing(false); loadProfile(userId!); }}>Отмена</button></div></div> : <><h2 className="profileNickname">{profileName}</h2><p className="profileBio">{bio || ""}</p><button className="secondary editProfile" onClick={() => setEditing(true)}>Редактировать профиль</button></>}
        </div>
        <div className="profileTabs"><button className={profileTab === "inventory" ? "profileTab active" : "profileTab"} onClick={() => setProfileTab("inventory")}>Инвентарь</button><button className={profileTab === "ratings" ? "profileTab active" : "profileTab"} onClick={() => setProfileTab("ratings")}>Оценки</button></div>
        {profileTab === "inventory" ? <div className="profileEmpty"><p>Инвентарь пока пуст.</p></div> : reviews.length ? <div className="reviewList">{reviews.map(r => <article className="reviewItem" key={r.id}><div className="reviewTop"><b>{r.albums?.title || "Альбом"}</b><span>★ {r.rating}/10</span></div>{r.albums?.artist_name && <small>{r.albums.artist_name}</small>}{r.comment && <p>{r.comment}</p>}<time>{new Date(r.created_at).toLocaleDateString("ru-RU")}</time></article>)}</div> : <div className="profileEmpty"><p>бро рил еще не оставил ни одного кома бич</p></div>}
        <div className="profileLogout"><button className="secondary" onClick={signOut}>Выйти из аккаунта</button></div>
      </div>}
    </section>}

    <footer><span>ТРАПЧИК.МР3 © 2026</span><span>СДЕЛАНО ДЛЯ МУЗЫКИ</span></footer>
  </main>;
}
