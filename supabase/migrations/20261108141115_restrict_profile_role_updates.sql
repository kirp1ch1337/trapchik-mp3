-- Keep self-service profile edits limited to user-facing profile fields.
-- Roles and account status can only be changed through trusted admin tooling.
revoke update on table public.profiles from anon, authenticated;
grant update (nickname, bio, avatar_key) on table public.profiles to authenticated;
