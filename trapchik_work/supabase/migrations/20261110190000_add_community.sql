-- Трапчик.МР3: сообщество, общий чат, личные сообщения и наборы стикеров.
-- Дружба определяется взаимными записями в существующей public.user_follows.

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  room_type text not null check (room_type in ('general', 'dm')),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  body text,
  sticker_id uuid,
  created_at timestamptz not null default now(),
  constraint community_message_content_check check (
    (body is not null and length(btrim(body)) between 1 and 2000) or sticker_id is not null
  ),
  constraint community_message_room_check check (
    (room_type = 'general' and recipient_id is null) or
    (room_type = 'dm' and recipient_id is not null and recipient_id <> sender_id)
  )
);

create index if not exists community_messages_general_created_idx
  on public.community_messages (created_at desc) where room_type = 'general';
create index if not exists community_messages_dm_pair_created_idx
  on public.community_messages (sender_id, recipient_id, created_at desc) where room_type = 'dm';
create index if not exists community_messages_recipient_created_idx
  on public.community_messages (recipient_id, sender_id, created_at desc) where room_type = 'dm';

create table if not exists public.community_sticker_packs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 80),
  description text,
  published boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_stickers (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.community_sticker_packs(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 80),
  image_url text not null check (image_url ~ '^https://'),
  created_at timestamptz not null default now()
);

alter table public.community_messages
  add constraint community_messages_sticker_id_fkey
  foreign key (sticker_id) references public.community_stickers(id) on delete restrict;

alter table public.community_messages enable row level security;
alter table public.community_sticker_packs enable row level security;
alter table public.community_stickers enable row level security;

grant select, insert on public.community_messages to authenticated;
grant select on public.community_sticker_packs, public.community_stickers to authenticated;
grant insert, update, delete on public.community_sticker_packs, public.community_stickers to authenticated;

drop policy if exists "Community users read general messages" on public.community_messages;
create policy "Community users read general messages" on public.community_messages
  for select to authenticated using (room_type = 'general');

drop policy if exists "Participants read dm history" on public.community_messages;
create policy "Participants read dm history" on public.community_messages
  for select to authenticated using (room_type = 'dm' and auth.uid() in (sender_id, recipient_id));

drop policy if exists "Active users send general messages" on public.community_messages;
create policy "Active users send general messages" on public.community_messages
  for insert to authenticated with check (
    room_type = 'general' and sender_id = auth.uid() and recipient_id is null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
    and (sticker_id is null or exists (select 1 from public.community_stickers s join public.community_sticker_packs sp on sp.id = s.pack_id where s.id = sticker_id and sp.published))
  );

drop policy if exists "Friends send dm messages" on public.community_messages;
create policy "Friends send dm messages" on public.community_messages
  for insert to authenticated with check (
    room_type = 'dm' and sender_id = auth.uid() and recipient_id is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
    and exists (select 1 from public.user_follows f where f.follower_id = auth.uid() and f.following_id = recipient_id)
    and exists (select 1 from public.user_follows f where f.follower_id = recipient_id and f.following_id = auth.uid())
    and (sticker_id is null or exists (select 1 from public.community_stickers s join public.community_sticker_packs sp on sp.id = s.pack_id where s.id = sticker_id and sp.published))
  );

-- Историю DM можно читать после прекращения взаимной подписки, но отправлять новые сообщения нельзя.

drop policy if exists "Users read published sticker packs" on public.community_sticker_packs;
create policy "Users read published sticker packs" on public.community_sticker_packs
  for select to authenticated using (published or public.is_admin());
drop policy if exists "Admins manage sticker packs" on public.community_sticker_packs;
create policy "Admins manage sticker packs" on public.community_sticker_packs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Users read published stickers" on public.community_stickers;
create policy "Users read published stickers" on public.community_stickers
  for select to authenticated using (
    exists (select 1 from public.community_sticker_packs p where p.id = pack_id and p.published)
    or public.is_admin()
  );
drop policy if exists "Admins manage stickers" on public.community_stickers;
create policy "Admins manage stickers" on public.community_stickers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Realtime для обновления общего чата и личных переписок.
do $$ begin
  alter publication supabase_realtime add table public.community_messages;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
