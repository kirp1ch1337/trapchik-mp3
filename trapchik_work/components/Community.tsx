"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Profile = { id: string; nickname: string | null; bio?: string | null; avatar_key?: string | null };
type ChatMessage = { id: string; sender_id: string; recipient_id: string | null; body: string | null; sticker_id: string | null; created_at: string; sender?: Profile | null; community_stickers?: { title: string; image_url: string } | null };
type Sticker = { id: string; title: string; image_url: string; pack_id: string };
type Pack = { id: string; title: string; description: string | null; stickers?: Sticker[] };
type Props = { supabase: SupabaseClient | null; userId: string | null; isAdmin: boolean; onOpenProfile: (profile: Profile) => void };

const AVATAR = "/default-avatar.png";

export default function Community({ supabase, userId, isAdmin, onOpenProfile }: Props) {
  const [section, setSection] = useState<"friends" | "general" | "dm" | "stickers">("friends");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Profile[]>([]);
  const [friends, setFriends] = useState<Profile[]>([]);
  const [conversations, setConversations] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [viewProfile, setViewProfile] = useState<Profile | null>(null);
  const [viewFollowing, setViewFollowing] = useState(false);
  const [viewFriend, setViewFriend] = useState(false);
  const [viewReviews, setViewReviews] = useState<{id:string;rating:number;comment:string|null;created_at:string;albums:{title:string;artist_name:string}|null}[]>([]);
  const [viewCounts, setViewCounts] = useState({ followers: 0, following: 0 });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [packTitle, setPackTitle] = useState("");
  const [stickerTitle, setStickerTitle] = useState("");
  const [stickerUrl, setStickerUrl] = useState("");
  const [activePack, setActivePack] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    if (!supabase || !userId) return;
    const { data, error: followError } = await supabase.from("user_follows").select("follower_id,following_id").or(`follower_id.eq.${userId},following_id.eq.${userId}`);
    if (followError) { setError(followError.message); return; }
    const rows = data ?? [];
    const ids = [...new Set(rows.flatMap((r: any) => r.follower_id === userId ? [r.following_id] : [r.follower_id]))];
    const mutual = ids.filter(id => rows.some((r: any) => r.follower_id === id && r.following_id === userId) && rows.some((r: any) => r.follower_id === userId && r.following_id === id));
    if (!mutual.length) { setFriends([]); return; }
    const { data: profiles, error: profileError } = await supabase.from("profiles").select("id,nickname,bio,avatar_key").in("id", mutual);
    if (profileError) setError(profileError.message);
    setFriends((profiles ?? []) as Profile[]);
  }, [supabase, userId]);

  const loadConversations = useCallback(async () => {
    if (!supabase || !userId) return;
    const { data, error: historyError } = await supabase.from("community_messages").select("sender_id,recipient_id,created_at").eq("room_type", "dm").or(`sender_id.eq.${userId},recipient_id.eq.${userId}`).order("created_at", { ascending: false }).limit(200);
    if (historyError) { setError(historyError.message); return; }
    const ids = [...new Set((data ?? []).map((m: any) => m.sender_id === userId ? m.recipient_id : m.sender_id).filter(Boolean))] as string[];
    if (!ids.length) { setConversations([]); return; }
    const { data: profiles, error: profileError } = await supabase.from("profiles").select("id,nickname,bio,avatar_key").in("id", ids);
    if (profileError) { setError(profileError.message); return; }
    const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    setConversations(ids.map(id => byId.get(id)).filter(Boolean) as Profile[]);
  }, [supabase, userId]);

  const loadPacks = useCallback(async () => {
    if (!supabase) return;
    let packQuery = supabase.from("community_sticker_packs").select("id,title,description,published,community_stickers(id,title,image_url,pack_id)").order("created_at", { ascending: false });
    if (!isAdmin) packQuery = packQuery.eq("published", true);
    const { data, error: packError } = await packQuery;
    if (packError) { setError(packError.message); return; }
    setPacks((data ?? []).map((p: any) => ({ ...p, stickers: p.community_stickers ?? [] })) as Pack[]);
  }, [supabase, isAdmin]);

  const loadMessages = useCallback(async () => {
    if (!supabase || !userId || (section === "dm" && !selected)) { setMessages([]); return; }
    setLoading(true);
    let request = supabase.from("community_messages").select("id,sender_id,recipient_id,body,sticker_id,created_at,community_stickers(title,image_url)").order("created_at", { ascending: true }).limit(100);
    if (section === "general") request = request.eq("room_type", "general");
    else request = request.eq("room_type", "dm").or(`and(sender_id.eq.${userId},recipient_id.eq.${selected!.id}),and(sender_id.eq.${selected!.id},recipient_id.eq.${userId})`);
    const { data, error: messageError } = await request;
    setLoading(false);
    if (messageError) { setError(messageError.message); setMessages([]); return; }
    const rows = (data ?? []) as ChatMessage[];
    const senderIds = [...new Set(rows.map(m => m.sender_id))];
    if (senderIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id,nickname,avatar_key").in("id", senderIds);
      const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      rows.forEach(m => { m.sender = map.get(m.sender_id) ?? null; });
    }
    setMessages(rows);
  }, [supabase, userId, section, selected]);

  useEffect(() => { void loadFriends(); void loadPacks(); void loadConversations(); }, [loadFriends, loadPacks, loadConversations]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase.channel("community-live").on("postgres_changes", { event: "INSERT", schema: "public", table: "community_messages" }, () => { void loadMessages(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, userId, loadMessages]);

  async function openCommunityProfile(profile: Profile) {
    setViewProfile(profile);
    onOpenProfile(profile);
    if (!supabase || !userId) return;
    const [followingResult, followersResult, followingCount, followerCount, reviewsResult] = await Promise.all([
      supabase.from("user_follows").select("follower_id").eq("follower_id", userId).eq("following_id", profile.id).maybeSingle(),
      supabase.from("user_follows").select("follower_id").eq("follower_id", profile.id).eq("following_id", userId).maybeSingle(),
      supabase.from("user_follows").select("following_id", { count: "exact", head: true }).eq("follower_id", profile.id),
      supabase.from("user_follows").select("follower_id", { count: "exact", head: true }).eq("following_id", profile.id),
      supabase.from("album_reviews").select("id,rating,comment,created_at,albums(title,artist_name)").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(20),
    ]);
    setViewFollowing(!!followingResult.data);
    setViewFriend(!!followingResult.data && !!followersResult.data);
    setViewCounts({ followers: followerCount.count ?? 0, following: followingCount.count ?? 0 });
    setViewReviews((reviewsResult.data ?? []) as any);
    if (followersResult.error || followingResult.error) setError("Не удалось полностью загрузить данные профиля.");
  }

  async function toggleCommunityFollow() {
    if (!supabase || !userId || !viewProfile) return;
    const result = viewFollowing
      ? await supabase.from("user_follows").delete().eq("follower_id", userId).eq("following_id", viewProfile.id)
      : await supabase.from("user_follows").upsert({ follower_id: userId, following_id: viewProfile.id }, { onConflict: "follower_id,following_id", ignoreDuplicates: true });
    if (result.error) { setError(result.error.message); return; }
    setViewFollowing(!viewFollowing);
    await openCommunityProfile(viewProfile);
    await loadFriends();
  }

  async function searchPeople(value: string) {
    setQuery(value);
    if (!supabase || value.trim().length < 2) { setPeople([]); return; }
    const { data, error: searchError } = await supabase.from("profiles").select("id,nickname,bio,avatar_key").ilike("nickname", `%${value.trim()}%`).neq("id", userId ?? "").limit(20);
    if (searchError) setError(searchError.message);
    setPeople((data ?? []) as Profile[]);
  }

  async function sendMessage(stickerId?: string) {
    if (!supabase || !userId || (section === "dm" && !selected)) return;
    const body = draft.trim();
    if (!body && !stickerId) return;
    setError("");
    const payload = { room_type: section === "general" ? "general" : "dm", sender_id: userId, recipient_id: section === "dm" ? selected!.id : null, body: body || null, sticker_id: stickerId ?? null };
    const { error: sendError } = await supabase.from("community_messages").insert(payload);
    if (sendError) { setError(sendError.message.includes("friend") || sendError.message.includes("policy") ? "Личные сообщения доступны только взаимным подпискам." : sendError.message); return; }
    setDraft(""); await loadMessages(); if (section === "dm") await loadConversations();
  }

  async function createPack() {
    if (!supabase || !packTitle.trim()) return;
    const { error: createError } = await supabase.from("community_sticker_packs").insert({ title: packTitle.trim(), published: false });
    if (createError) setError(createError.message); else { setPackTitle(""); await loadPacks(); setError("Набор создан. Добавь стикеры ниже после публикации или выбери его в списке."); }
  }
  async function addSticker() {
    if (!supabase || !activePack || !stickerTitle.trim() || !/^https:\/\//i.test(stickerUrl)) return;
    const { error: addError } = await supabase.from("community_stickers").insert({ pack_id: activePack, title: stickerTitle.trim(), image_url: stickerUrl.trim() });
    if (addError) setError(addError.message); else { setStickerTitle(""); setStickerUrl(""); await loadPacks(); }
  }
  async function togglePack(pack: Pack, published: boolean) {
    if (!supabase) return;
    const { error: updateError } = await supabase.from("community_sticker_packs").update({ published }).eq("id", pack.id);
    if (updateError) setError(updateError.message); else await loadPacks();
  }

  if (!userId) return <section className="section communitySection"><div className="communityHero"><div className="eyebrow">ТРАПЧИК.МР3 / COMMUNITY</div><h2>Сообщество</h2><p>Войди в аккаунт, чтобы общаться, находить друзей и отправлять стикеры.</p></div><div className="empty"><h3>Сначала нужен аккаунт</h3></div></section>;

  return <section className="section communitySection">
    <div className="communityHero"><div className="eyebrow">ТРАПЧИК.МР3 / COMMUNITY</div><h2>Сообщество</h2><p>Твои люди, общение и музыкальная движуха в одном месте.</p></div>
    <div className="communityTabs">
      <button className={section === "friends" ? "active" : ""} onClick={() => { setSection("friends"); setSelected(null); }}>Друзья</button>
      <button className={section === "general" ? "active" : ""} onClick={() => { setSection("general"); setSelected(null); }}>Общий чат</button>
      <button className={section === "dm" ? "active" : ""} onClick={() => setSection("dm")}>Личные сообщения</button>
      <button className={section === "stickers" ? "active" : ""} onClick={() => setSection("stickers")}>Стикеры</button>
    </div>
    {error && <p className="communityNotice" role="status">{error}</p>}
    {viewProfile && <div className="communityPanel communityViewedProfile"><button className="communityBack" onClick={() => setViewProfile(null)}>← Закрыть профиль</button><div className="communityViewedIdentity"><img src={viewProfile.avatar_key || AVATAR} alt=""/><div><h3>{viewProfile.nickname || "Слушатель"}</h3><p>{viewProfile.bio || "Пока без описания"}</p></div></div><div className="communityViewedStats"><span><b>{viewCounts.followers}</b> подписчиков</span><span><b>{viewCounts.following}</b> подписок</span></div>{viewProfile.id !== userId && <div className="communityFormRow"><button className="primary" onClick={() => void toggleCommunityFollow()}>{viewFollowing ? "Отписаться" : "Подписаться"}</button>{viewFriend && <button className="secondary" onClick={() => { setSelected(viewProfile); setSection("dm"); }}>Написать</button>}</div>}<div className="communityProfileRatings"><h4>Оценки альбомов</h4>{viewReviews.length ? viewReviews.map(r => <div className="communityRating" key={r.id}><b>{r.albums?.title || "Альбом"}</b><span>★ {r.rating}/10</span>{r.comment && <p>{r.comment}</p>}</div>) : <p className="communityMuted">Пока нет оценок.</p>}<h4>Инвентарь</h4><p className="communityMuted">Инвентарь пока пуст.</p></div></div>}
    {section === "friends" && <div className="communityGrid"><div className="communityPanel"><h3>Найти людей</h3><input className="communityInput" value={query} onChange={e => void searchPeople(e.target.value)} placeholder="Поиск по никнейму…"/><div className="communityPeople">{people.map(p => <button className="communityPerson" key={p.id} onClick={() => void openCommunityProfile(p)}><img src={p.avatar_key || AVATAR} alt=""/><span><b>{p.nickname || "Слушатель"}</b><small>{p.bio || "Профиль слушателя"}</small></span><i>Профиль →</i></button>)}</div></div><div className="communityPanel"><h3>Твои друзья</h3>{friends.length ? friends.map(p => <div className="communityFriend" key={p.id}><button className="communityPerson" onClick={() => void openCommunityProfile(p)}><img src={p.avatar_key || AVATAR} alt=""/><span><b>{p.nickname || "Слушатель"}</b><small>Взаимная подписка</small></span></button><button className="communitySmallButton" onClick={() => { setSelected(p); setSection("dm"); }}>Написать</button></div>) : <p className="communityMuted">Друзья появятся здесь, когда вы подпишетесь друг на друга.</p>}</div></div>}
    {section === "general" && <ChatPanel messages={messages} draft={draft} setDraft={setDraft} send={sendMessage} loading={loading} title="Общий чат" subtitle="Доступен всем активным пользователям Трапчика" packs={packs}/>}
    {section === "dm" && <div className="communityPanel"><h3>Личные сообщения</h3>{!selected ? <>{[...new Map([...conversations, ...friends].map(p => [p.id, p])).values()].length ? [...new Map([...conversations, ...friends].map(p => [p.id, p])).values()].map(p => <button className="communityPerson" key={p.id} onClick={() => setSelected(p)}><img src={p.avatar_key || AVATAR} alt=""/><span><b>{p.nickname || "Слушатель"}</b><small>{friends.some(f => f.id === p.id) ? "Взаимная подписка · можно писать" : "История переписки · отправка доступна друзьям"}</small></span><i>→</i></button>) : <p className="communityMuted">Личные сообщения доступны друзьям с взаимной подпиской. История появится здесь после первого диалога.</p>}</> : <><button className="communityBack" onClick={() => setSelected(null)}>← Все диалоги</button><ChatPanel messages={messages} draft={draft} setDraft={setDraft} send={sendMessage} loading={loading} title={selected.nickname || "Диалог"} subtitle="История сохраняется после отмены взаимной подписки" packs={packs}/></>}</div>}
    {section === "stickers" && <div className="communityPanel"><h3>Стикеры</h3>{packs.length ? packs.map(pack => <div className="stickerPack" key={pack.id}><h4>{pack.title}</h4>{isAdmin && <small className="communityMuted">{(pack as Pack & { published?: boolean }).published ? "Опубликован" : "Черновик"}</small>}{pack.description && <p>{pack.description}</p>}<div className="stickerGrid">{pack.stickers?.map(sticker => <span className="stickerPreview" key={sticker.id} title={sticker.title}><img src={sticker.image_url} alt={sticker.title}/></span>)}</div></div>) : <p className="communityMuted">Стикеры скоро появятся.</p>}{isAdmin && <div className="communityAdmin"><h4>Управление стикерами</h4><div className="communityFormRow"><input className="communityInput" value={packTitle} onChange={e => setPackTitle(e.target.value)} placeholder="Название набора"/><button className="primary" onClick={createPack}>Создать набор</button></div><select className="communityInput" value={activePack ?? ""} onChange={e => setActivePack(e.target.value || null)}><option value="">Выбери набор</option>{packs.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{activePack && <><input className="communityInput" value={stickerTitle} onChange={e => setStickerTitle(e.target.value)} placeholder="Название стикера"/><input className="communityInput" value={stickerUrl} onChange={e => setStickerUrl(e.target.value)} placeholder="HTTPS-ссылка на PNG/WebP/GIF"/><button className="primary" onClick={addSticker}>Добавить стикер</button><div className="communityFormRow"><button className="secondary" onClick={() => { const p = packs.find(x => x.id === activePack); if (p) void togglePack(p, true); }}>Опубликовать набор</button><button className="secondary" onClick={() => { const p = packs.find(x => x.id === activePack); if (p) void togglePack(p, false); }}>Скрыть набор</button></div></>}</div>}</div>}
  </section>;
}

function ChatPanel({ messages, draft, setDraft, send, loading, title, subtitle, packs }: { messages: ChatMessage[]; draft: string; setDraft: (v: string) => void; send: (stickerId?: string) => void; loading: boolean; title: string; subtitle: string; packs: Pack[] }) {
  const [showStickers, setShowStickers] = useState(false);
  return <div className="communityPanel chatPanel"><div className="chatHeading"><div><h3>{title}</h3><p>{subtitle}</p></div><span className="chatLive">● LIVE</span></div><div className="chatMessages">{loading ? <p className="communityMuted">Загружаем сообщения…</p> : messages.length ? messages.map(m => <article className="chatMessage" key={m.id}><img src={m.sender?.avatar_key || AVATAR} alt=""/><div><b>{m.sender?.nickname || "Слушатель"}</b>{m.body && <p>{m.body}</p>}{m.community_stickers?.image_url && <img className="chatStickerImage" src={m.community_stickers.image_url} alt={m.community_stickers.title || "Стикер"}/>}<time>{new Date(m.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></div></article>) : <p className="communityMuted">Здесь пока тихо. Начни разговор первым.</p>}</div><div className="chatComposer"><button className="secondary" onClick={() => setShowStickers(v => !v)} aria-label="Открыть стикеры">☺</button><input className="communityInput" value={draft} maxLength={2000} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Написать сообщение…"/><button className="primary" onClick={() => send()} disabled={!draft.trim()}>Отправить</button></div>{showStickers && <div className="composerStickers">{packs.flatMap(p => p.stickers ?? []).map(s => <button key={s.id} title={s.title} onClick={() => { send(s.id); setShowStickers(false); }}><img src={s.image_url} alt={s.title}/></button>)}</div>}</div>;
}
