-- Система подписок Трапчик.mp3
create table if not exists public.user_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_follows_pkey primary key (follower_id, following_id),
  constraint user_follows_no_self check (follower_id <> following_id)
);

create index if not exists user_follows_following_id_idx
  on public.user_follows (following_id);

alter table public.user_follows enable row level security;

grant select, insert, delete on table public.user_follows to authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists "Authenticated users can read follows" on public.user_follows;
create policy "Authenticated users can read follows"
  on public.user_follows for select to authenticated using (auth.uid() is not null);

drop policy if exists "Users can follow as themselves" on public.user_follows;
create policy "Users can follow as themselves"
  on public.user_follows for insert to authenticated
  with check (auth.uid() = follower_id and follower_id <> following_id);

drop policy if exists "Users can unfollow themselves" on public.user_follows;
create policy "Users can unfollow themselves"
  on public.user_follows for delete to authenticated
  using (auth.uid() = follower_id);

-- Публичный поиск и просмотр карточек профилей для вошедших пользователей.
drop policy if exists "Authenticated users can view profiles" on public.profiles;
create policy "Authenticated users can view profiles"
  on public.profiles for select to authenticated using (auth.uid() is not null);
