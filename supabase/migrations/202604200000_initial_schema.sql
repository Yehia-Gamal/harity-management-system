create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  full_name text not null default '',
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_seen_at timestamptz null,
  legacy_source_id text null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cases (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles (id) on delete set null,
  updated_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  action text not null default '',
  case_id text not null default '',
  details text not null default '',
  created_by uuid null references public.profiles (id) on delete set null
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists cases_set_updated_at on public.cases;
create trigger cases_set_updated_at
before update on public.cases
for each row
execute function public.set_updated_at();

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_full_name text;
begin
  v_username := nullif(trim(coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1))), '');
  v_full_name := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    coalesce(v_username, replace(new.id::text, '-', '')),
    coalesce(v_full_name, '')
  )
  on conflict (id) do update
  set
    username = excluded.username,
    full_name = case
      when coalesce(public.profiles.full_name, '') = '' then excluded.full_name
      else public.profiles.full_name
    end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_auth_user_created();

alter table public.profiles enable row level security;
alter table public.cases enable row level security;
alter table public.audit_log enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update on public.cases to authenticated;
grant select, insert on public.audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;
