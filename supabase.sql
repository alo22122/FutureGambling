-- ARCADE CLUB: Supabase SQL setup
-- Run this whole file in Supabase -> SQL Editor.
-- Coins are virtual points. Never expose the service_role key in browser code.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (char_length(username) between 3 and 20),
  avatar_url text,
  balance bigint not null default 1000 check (balance >= 0),
  level integer not null default 1,
  xp bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  claim_date date not null default (now() at time zone 'utc')::date,
  reward bigint not null,
  unique(user_id, claim_date)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text not null default '#888888',
  is_system boolean not null default false
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text unique not null,
  description text
);

create table if not exists public.role_permissions (
  role_id uuid references public.roles(id) on delete cascade,
  permission_id uuid references public.permissions(id) on delete cascade,
  primary key(role_id, permission_id)
);

create table if not exists public.user_roles (
  user_id uuid references public.profiles(id) on delete cascade,
  role_id uuid references public.roles(id) on delete cascade,
  primary key(user_id, role_id)
);

create table if not exists public.bans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  banned_by uuid references public.profiles(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.roles(name,color,is_system) values
 ('Player','#94a3b8',true),('Helper','#22c55e',true),
 ('Moderator','#3b82f6',true),('Admin','#ef4444',true)
on conflict(name) do nothing;

insert into public.permissions(permission_key,description) values
 ('admin.access','Open admin panel'),('chat.moderate','Delete chat messages'),
 ('users.view','View player administration'),('users.ban','Ban players'),
 ('users.unban','Remove bans'),('roles.manage','Create and edit custom roles'),
 ('roles.assign','Assign roles')
on conflict(permission_key) do nothing;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  uname text;
  player_role uuid;
begin
  uname := coalesce(nullif(new.raw_user_meta_data->>'username',''),
                    'Player_' || substr(new.id::text,1,8));
  insert into public.profiles(id,username) values(new.id,uname);
  select id into player_role from public.roles where name='Player';
  if player_role is not null then
    insert into public.user_roles(user_id,role_id) values(new.id,player_role)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.has_permission(permission_name text)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_id=ur.role_id
    join public.permissions p on p.id=rp.permission_id
    where ur.user_id=(select auth.uid())
      and p.permission_key=permission_name
  );
$$;

create or replace function public.claim_daily_reward()
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  reward_amount bigint := 100;
  today_utc date := (now() at time zone 'utc')::date;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform 1 from public.profiles where id=uid for update;
  if not found then raise exception 'Profile not found'; end if;
  if exists(select 1 from public.daily_claims where user_id=uid and claim_date=today_utc) then
    raise exception 'Already claimed today';
  end if;
  insert into public.daily_claims(user_id,claim_date,reward)
    values(uid,today_utc,reward_amount);
  update public.profiles set balance=balance+reward_amount where id=uid;
  insert into public.transactions(user_id,amount,reason)
    values(uid,reward_amount,'Daily reward');
  return reward_amount;
end;
$$;

create or replace view public.leaderboard
with (security_invoker=true) as
select id,username,avatar_url,level,xp,
       rank() over(order by xp desc) as rank
from public.profiles;

alter table public.profiles enable row level security;
alter table public.daily_claims enable row level security;
alter table public.transactions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.bans enable row level security;

-- Public authenticated profile display; users can only change their username/avatar.
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update(username,avatar_url) on public.profiles to authenticated;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using(true);
drop policy if exists "profile update own" on public.profiles;
create policy "profile update own" on public.profiles for update to authenticated
using(id=(select auth.uid())) with check(id=(select auth.uid()));

drop policy if exists "daily claims own read" on public.daily_claims;
create policy "daily claims own read" on public.daily_claims for select to authenticated
using(user_id=(select auth.uid()));
drop policy if exists "transactions own read" on public.transactions;
create policy "transactions own read" on public.transactions for select to authenticated
using(user_id=(select auth.uid()));

drop policy if exists "chat read" on public.chat_messages;
create policy "chat read" on public.chat_messages for select to authenticated using(true);
drop policy if exists "chat insert own" on public.chat_messages;
create policy "chat insert own" on public.chat_messages for insert to authenticated
with check(user_id=(select auth.uid()) and char_length(message) between 1 and 500);
drop policy if exists "chat moderation" on public.chat_messages;
create policy "chat moderation" on public.chat_messages for delete to authenticated
using(public.has_permission('chat.moderate'));

drop policy if exists "roles read" on public.roles;
create policy "roles read" on public.roles for select to authenticated using(true);
drop policy if exists "permissions read" on public.permissions;
create policy "permissions read" on public.permissions for select to authenticated using(true);
drop policy if exists "role permissions read" on public.role_permissions;
create policy "role permissions read" on public.role_permissions for select to authenticated using(true);
drop policy if exists "user roles read" on public.user_roles;
create policy "user roles read" on public.user_roles for select to authenticated using(true);

drop policy if exists "roles admin manage" on public.roles;
create policy "roles admin manage" on public.roles for all to authenticated
using(public.has_permission('roles.manage')) with check(public.has_permission('roles.manage'));
drop policy if exists "permissions admin manage" on public.permissions;
create policy "permissions admin manage" on public.permissions for all to authenticated
using(public.has_permission('roles.manage')) with check(public.has_permission('roles.manage'));
drop policy if exists "role permissions admin manage" on public.role_permissions;
create policy "role permissions admin manage" on public.role_permissions for all to authenticated
using(public.has_permission('roles.manage')) with check(public.has_permission('roles.manage'));
drop policy if exists "user roles admin manage" on public.user_roles;
create policy "user roles admin manage" on public.user_roles for all to authenticated
using(public.has_permission('roles.assign')) with check(public.has_permission('roles.assign'));

drop policy if exists "bans read own or staff" on public.bans;
create policy "bans read own or staff" on public.bans for select to authenticated
using(user_id=(select auth.uid()) or public.has_permission('users.view'));
drop policy if exists "bans admin manage" on public.bans;
create policy "bans admin manage" on public.bans for all to authenticated
using(public.has_permission('users.ban')) with check(public.has_permission('users.ban'));

-- Enable realtime updates for the chat table.
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;

-- IMPORTANT: after creating your own account, grant yourself Admin using
-- the SQL snippet in README.md. Do not make public signup an admin operation.
