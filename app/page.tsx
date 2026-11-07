"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

type Album = { id: string; title: string; artist_name: string; description: string | null; artwork_key: string | null; release_date: string | null };
type Upcoming = { id: string; title: string; artist_name: string; release_type: string; description: string | null; release_at: string | null };
type Review = { id: string; rating: number; comment: string | null; created_at: string; albums: { title: string; artist_name: string } | null };

const DEFAULT_AVATAR = "/default-avatar.png";

export default function Home() {
  const [tab, setTab] = useState<"music" | "soon" | "profile">("music");
  const [albums, setAlbums] = useState<Album[]>([]);
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

  const supabase = useMemo(() => { try { return supabaseBrowser(); } catch { return null; } }, []);

  async function loadProfile(id: string) {
    if (!supabase) return;
    const { data: p } = await supabase.from("profiles").select("nickname,bio,avatar_key,status").eq("id", id).maybeSingle();
    if (p?.status === "blocked") {
      await supabase.auth.signOut(); setUserEmail(null); setUserId(null); setMessage("Этот аккаунт заблокирован администратором."); return;
    }
    if (p) {
      setProfileName(p.nickname || "Слушатель"); setNickname(p.nickname || "Слушатель");
      setBio(p.bio || ""); setAvatarUrl(p.avatar_key || DEFAULT_AVATAR);
    }
    const { data: rows } = await supabase.from("album_reviews")
      .select("id,rating,comment,created_at,albums(title,artist_name)")
      .eq("user_id", id).order("created_at", { ascending: false });
    setReviews((rows ?? []) as unknown as Review[]);
  }

  useEffect(() => {
    if (!supabase) { setMessage("Подключи Supabase: заполни .env.local по инструкции."); return; }
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
    return () => { alive = false; };
  }, [supabase]);

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
    if (!supabase) return; await supabase.auth.signOut(); setUserEmail(null); setUserId(null); setProfileName("Слушатель"); setBio(""); setAvatarUrl(DEFAULT_AVATAR); setReviews([]); setMessage("Ты вышел из аккаунта.");
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
      <span className="online">{userEmail ? "● В сети" : "● Гость"}</span>
    </header>

    {tab !== "profile" && <section className="hero">
      <div className="heroText"><div className="eyebrow">ТВОЯ МУЗЫКА. ТВОИ ПРАВИЛА.</div><h1>Здесь звучит<br/><em>Трапчик.мп3</em></h1><p>Релизы, которые хочется переслушивать. Без лишнего шума — только музыка.</p><button className="primary" onClick={() => setTab("music")}>Открыть каталог <span>↗</span></button></div>
      <div className="heroArt" aria-hidden="true"><div className="orb orbOne"/><div className="orb orbTwo"/><div className="heroGlyph">Т<span>.</span></div><div className="heroCaption">INDEPENDENT SOUND<br/>EST. 2026</div></div>
    </section>}

    {message && <div className="notice">{message}</div>}

    {tab === "music" && <section className="section"><div className="sectionHead"><div><div className="eyebrow">БИБЛИОТЕКА</div><h2>Каталог музыки</h2></div><input className="search" placeholder="Поиск релиза..." value={search} onChange={e => setSearch(e.target.value)}/></div>
      {filtered.length ? <div className="albumGrid">{filtered.map((a, i) => <article className="album" key={a.id}><div className={`cover cover${i % 4}`}><span>Т.МР3</span><b>{a.title.slice(0,1).toUpperCase()}</b></div><div className="albumInfo"><h3>{a.title}</h3><p>{a.artist_name}</p>{a.release_date && <small>{new Date(a.release_date).toLocaleDateString("ru-RU")}</small>}</div></article>)}</div> : <div className="empty"><div className="emptyIcon">♫</div><h3>Пока здесь тихо</h3><p>Опубликованные альбомы появятся здесь, когда администратор добавит музыку.</p></div>}
    </section>}

    {tab === "soon" && <section className="section"><div className="sectionHead"><div><div className="eyebrow">НА ГОРИЗОНТЕ</div><h2>Скоро</h2></div></div>
      {upcoming.length ? <div className="soonList">{upcoming.map((r, i) => <article className="soonCard" key={r.id}><div className={`soonCover cover${i%4}`}>SOON</div><div><span className="tag">{r.release_type === "single" ? "Сингл" : r.release_type === "ep" ? "EP" : "Альбом"}</span><h3>{r.title}</h3><p>{r.artist_name}</p>{r.description && <p className="muted">{r.description}</p>}</div><div className="releaseDate">{r.release_at ? new Date(r.release_at).toLocaleDateString("ru-RU") : "Дата уточняется"}</div></article>)}</div> : <div className="empty"><div className="emptyIcon">◷</div><h3>Готовим новые релизы</h3><p>Анонсы с датами выхода и превью появятся здесь.</p></div>}
    </section>}

    {tab === "profile" && <section className="section profileSection">
      {!userEmail ? <div className="authWrap"><div className="eyebrow">АККАУНТ ТРАПЧИК.МР3</div><h2>{authMode === "register" ? "Создать аккаунт" : "С возвращением"}</h2>
        {authMode === "register" ? <form className="authCard authSingle" onSubmit={signUp}><label>Никнейм<input required maxLength={40} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Как тебя показывать?"/></label><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/></label><label>Пароль<input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Не менее 6 символов"/></label><button className="primary full" disabled={busy}>Зарегистрироваться</button><small>После регистрации нужно подтвердить email по ссылке из письма.</small><p className="authSwitch">Уже есть аккаунт? <button type="button" onClick={() => { setAuthMode("login"); setMessage(""); }}>Войти</button></p></form> : <form className="authCard authSingle" onSubmit={signIn}><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"/></label><label>Пароль<input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль"/></label><button className="primary full" disabled={busy}>Войти</button><p className="authSwitch">Нет аккаунта? <button type="button" onClick={() => { setAuthMode("register"); setMessage(""); }}>Зарегистрироваться</button></p></form>}
      </div> : <div className="userProfile">
        <div className="profileIdentity"><div className="avatarFrame"><img src={avatarUrl || DEFAULT_AVATAR} alt="Аватар пользователя" className="profileAvatar"/><label className="avatarChange">Изменить фото<input type="file" accept="image/*" onChange={e => uploadAvatar(e.target.files?.[0])} disabled={busy}/></label></div>
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
