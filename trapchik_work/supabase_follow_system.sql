-- Трапчик.мп3: система подписок и уведомления о новых подписчиках
-- Выполни весь файл в Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint follows_pkey primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists follows_following_id_created_at_idx
  on public.follows (following_id, created_at desc);
create index if not exists follows_follower_id_created_at_idx
  on public.follows (follower_id, created_at desc);

alter table public.follows enable row level security;

drop policy if exists "Authenticated users can view follows" on public.follows;
create policy "Authenticated users can view follows"
  on public.follows for select to authenticated using (true);

drop policy if exists "Users can follow as themselves" on public.follows;
create policy "Users can follow as themselves"
  on public.follows for insert to authenticated
  with check (auth.uid() = follower_id and follower_id <> following_id);

drop policy if exists "Users can unfollow as themselves" on public.follows;
create policy "Users can unfollow as themselves"
  on public.follows for delete to authenticated
  using (auth.uid() = follower_id);

create table if not exists public.follow_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists follow_notifications_user_id_created_at_idx
  on public.follow_notifications (user_id, created_at desc);

alter table public.follow_notifications enable row level security;

drop policy if exists "Users can view their follow notifications" on public.follow_notifications;
create policy "Users can view their follow notifications"
  on public.follow_notifications for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can mark their follow notifications read" on public.follow_notifications;
create policy "Users can mark their follow notifications read"
  on public.follow_notifications for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.follow_follow_notifications (user_id, actor_id, type)
  values (new.following_id, new.follower_id, 'new_follower');
  return new;
end;
$$;

drop trigger if exists follows_notify_new_follower on public.follows;
create trigger follows_notify_new_follower
after insert on public.follows
for each row execute function public.notify_new_follower();


-- Безопасный поиск: наружу выдаются только публичные поля профиля,
-- а не внутренние поля profiles (например role/status).
create or replace function public.search_public_profiles(
  search_term text default null,
  profile_ids uuid[] default null
)
returns table (id uuid, nickname text, bio text, avatar_key text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.nickname, p.bio, p.avatar_key
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.status is distinct from 'blocked'
    and (profile_ids is null or p.id = any(profile_ids))
    and (search_term is null or p.nickname ilike ('%' || search_term || '%'))
  order by p.nickname nulls last
  limit 100;
$$;

grant execute on function public.search_public_profiles(text, uuid[]) to authenticated;
