-- Ensure older hosted Supabase projects have the columns required by the app.

alter table public.profiles
  add column if not exists username text,
  add column if not exists full_name text,
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists last_seen_at timestamptz,
  add column if not exists legacy_source_id text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.cases
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.audit_log
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists action text not null default '',
  add column if not exists case_id text not null default '',
  add column if not exists details text not null default '',
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create unique index if not exists profiles_username_key
on public.profiles (username);

create unique index if not exists profiles_legacy_source_id_key
on public.profiles (legacy_source_id)
where legacy_source_id is not null;
