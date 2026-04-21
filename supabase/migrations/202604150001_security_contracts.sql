-- Security contracts for the charity/case-management app.
-- Review before production: table names/columns are inferred from frontend usage.

create index if not exists cases_updated_at_idx
on public.cases (updated_at desc);

create index if not exists cases_data_governorate_idx
on public.cases ((data ->> 'governorate'));

create index if not exists cases_data_area_idx
on public.cases ((data ->> 'area'));

create index if not exists cases_data_case_grade_idx
on public.cases ((data ->> 'caseGrade'));

create index if not exists audit_log_created_at_idx
on public.audit_log (created_at desc);

create index if not exists audit_log_case_id_idx
on public.audit_log (case_id);

create index if not exists profiles_username_idx
on public.profiles (username);

-- Existing hosted projects may already have older versions of these RPCs.
-- PostgreSQL requires dropping functions when OUT parameters / return tables change.
drop function if exists public.list_profiles_public();
drop function if exists public.delete_case(text);
drop function if exists public.delete_all_cases();
drop function if exists public.admin_update_profile(text, text, jsonb, boolean);
drop function if exists public.admin_delete_profile(text);
drop function if exists public.admin_set_profile_active(text, boolean);
drop function if exists public.list_cases_page(integer, integer, text, text, text, text, text);
drop function if exists public.list_audit_log_page(integer, integer, text);

create or replace function public.current_profile_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.permissions, '{}'::jsonb)
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.has_app_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((public.current_profile_permissions() ->> permission_key)::boolean, false)
    or coalesce(public.current_profile_permissions() ->> '__role', '') in ('super_admin', 'hidden_super_admin')
$$;

create or replace function public.list_profiles_public()
returns table (
  id uuid,
  username text,
  full_name text,
  permissions jsonb,
  is_active boolean,
  updated_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not (
    public.has_app_permission('users_manage')
    or public.has_app_permission('settings')
    or public.has_app_permission('cases_read')
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    p.id,
    p.username,
    p.full_name,
    case
      when public.has_app_permission('users_manage') then coalesce(p.permissions, '{}'::jsonb)
      else jsonb_build_object('__role', coalesce(p.permissions ->> '__role', ''))
    end as permissions,
    coalesce(p.is_active, true) as is_active,
    p.updated_at,
    p.last_seen_at
  from public.profiles p
  order by p.updated_at desc nulls last, p.username asc;
end;
$$;

create or replace function public.delete_case(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_id text := nullif(trim(coalesce(p_id, '')), '');
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not public.has_app_permission('cases_delete') then
    raise exception 'forbidden';
  end if;

  if v_case_id is null then
    raise exception 'case_id_required';
  end if;

  delete from public.cases
  where id = v_case_id;

  insert into public.audit_log(action, case_id, details, created_by)
  values ('حذف حالة', v_case_id, 'delete_case RPC', auth.uid());
end;
$$;

create or replace function public.delete_all_cases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not public.has_app_permission('cases_delete_all') then
    raise exception 'forbidden';
  end if;

  delete from public.cases;
  get diagnostics v_deleted = row_count;

  insert into public.audit_log(action, case_id, details, created_by)
  values ('حذف كل الحالات', '', 'delete_all_cases RPC | deleted: ' || v_deleted::text, auth.uid());

  return v_deleted;
end;
$$;

create or replace function public.admin_update_profile(
  p_username text,
  p_full_name text default null,
  p_permissions jsonb default null,
  p_is_active boolean default null
)
returns table (
  id uuid,
  username text,
  full_name text,
  permissions jsonb,
  is_active boolean,
  updated_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := nullif(trim(coalesce(p_username, '')), '');
  v_caller_role text := coalesce(public.current_profile_permissions() ->> '__role', '');
  v_target_permissions jsonb;
  v_target_role text := '';
  v_next_permissions jsonb := p_permissions;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not public.has_app_permission('users_manage') then
    raise exception 'forbidden';
  end if;

  if v_username is null then
    raise exception 'username_required';
  end if;

  select coalesce(p.permissions, '{}'::jsonb)
  into v_target_permissions
  from public.profiles p
  where p.username = v_username
  limit 1;

  if v_target_permissions is null then
    raise exception 'profile_not_found';
  end if;

  v_target_role := coalesce(v_target_permissions ->> '__role', '');

  if v_target_role = 'hidden_super_admin' and v_caller_role <> 'hidden_super_admin' then
    raise exception 'forbidden_hidden_super_admin';
  end if;

  if v_next_permissions is not null
    and coalesce(v_next_permissions ->> '__role', '') = 'hidden_super_admin'
    and v_caller_role <> 'hidden_super_admin' then
    raise exception 'forbidden_hidden_super_admin';
  end if;

  return query
  update public.profiles p
  set
    full_name = coalesce(p_full_name, p.full_name),
    permissions = coalesce(v_next_permissions, p.permissions),
    is_active = coalesce(p_is_active, p.is_active),
    updated_at = now()
  where p.username = v_username
  returning
    p.id,
    p.username,
    p.full_name,
    coalesce(p.permissions, '{}'::jsonb) as permissions,
    coalesce(p.is_active, true) as is_active,
    p.updated_at,
    p.last_seen_at;

  insert into public.audit_log(action, case_id, details, created_by)
  values ('تحديث مستخدم', '', 'admin_update_profile RPC | username: ' || v_username, auth.uid());
end;
$$;

create or replace function public.admin_delete_profile(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := nullif(trim(coalesce(p_username, '')), '');
  v_target_id uuid;
  v_target_role text := '';
  v_caller_role text := coalesce(public.current_profile_permissions() ->> '__role', '');
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not public.has_app_permission('users_manage') then
    raise exception 'forbidden';
  end if;

  if v_username is null then
    raise exception 'username_required';
  end if;

  select p.id, coalesce(p.permissions ->> '__role', '')
  into v_target_id, v_target_role
  from public.profiles p
  where p.username = v_username
  limit 1;

  if v_target_id is null then
    raise exception 'profile_not_found';
  end if;

  if v_target_id = auth.uid() then
    raise exception 'cannot_delete_self';
  end if;

  if v_target_role = 'hidden_super_admin' and v_caller_role <> 'hidden_super_admin' then
    raise exception 'forbidden_hidden_super_admin';
  end if;

  insert into public.audit_log(action, case_id, details, created_by)
  values ('حذف مستخدم', '', 'admin_delete_profile RPC | username: ' || v_username, auth.uid());

  delete from public.profiles p
  where p.id = v_target_id;
end;
$$;

-- Override the first definition to avoid double audit entries from admin_update_profile.
create or replace function public.admin_set_profile_active(
  p_username text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := nullif(trim(coalesce(p_username, '')), '');
  v_target_permissions jsonb;
  v_target_role text := '';
  v_caller_role text := coalesce(public.current_profile_permissions() ->> '__role', '');
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not public.has_app_permission('users_manage') then
    raise exception 'forbidden';
  end if;

  if v_username is null then
    raise exception 'username_required';
  end if;

  select coalesce(p.permissions, '{}'::jsonb)
  into v_target_permissions
  from public.profiles p
  where p.username = v_username
  limit 1;

  if v_target_permissions is null then
    raise exception 'profile_not_found';
  end if;

  v_target_role := coalesce(v_target_permissions ->> '__role', '');
  if v_target_role = 'hidden_super_admin' and v_caller_role <> 'hidden_super_admin' then
    raise exception 'forbidden_hidden_super_admin';
  end if;

  update public.profiles p
  set
    is_active = coalesce(p_is_active, p.is_active),
    updated_at = now()
  where p.username = v_username;

  insert into public.audit_log(action, case_id, details, created_by)
  values (
    case when p_is_active then 'activate_user' else 'deactivate_user' end,
    '',
    'admin_set_profile_active RPC | username: ' || v_username,
    auth.uid()
  );
end;
$$;

create or replace function public.list_cases_page(
  p_limit integer default 100,
  p_offset integer default 0,
  p_search text default null,
  p_governorate text default null,
  p_area text default null,
  p_grade text default null,
  p_category text default null
)
returns table (
  id text,
  data jsonb,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_search text := lower(nullif(trim(coalesce(p_search, '')), ''));
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not public.has_app_permission('cases_read') then
    raise exception 'forbidden';
  end if;

  return query
  with filtered as (
    select c.id, c.data, c.updated_at
    from public.cases c
    where
      (v_search is null or lower(c.id || ' ' || coalesce(c.data ->> 'familyHead', '') || ' ' || coalesce(c.data ->> 'phone', '') || ' ' || coalesce(c.data ->> 'address', '')) like '%' || v_search || '%')
      and (nullif(trim(coalesce(p_governorate, '')), '') is null or coalesce(c.data ->> 'governorate', '') = trim(p_governorate))
      and (nullif(trim(coalesce(p_area, '')), '') is null or coalesce(c.data ->> 'area', '') = trim(p_area))
      and (nullif(trim(coalesce(p_grade, '')), '') is null or coalesce(c.data ->> 'caseGrade', '') = trim(p_grade))
      and (nullif(trim(coalesce(p_category, '')), '') is null or coalesce(c.data ->> 'category', '') ilike '%' || trim(p_category) || '%')
  ),
  counted as (
    select count(*) as n from filtered
  )
  select f.id, f.data, f.updated_at, counted.n
  from filtered f
  cross join counted
  order by f.updated_at desc nulls last, f.id asc
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.list_audit_log_page(
  p_limit integer default 100,
  p_offset integer default 0,
  p_case_id text default null
)
returns table (
  created_at timestamptz,
  action text,
  case_id text,
  details text,
  created_by uuid,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_case_id text := nullif(trim(coalesce(p_case_id, '')), '');
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not (
    public.has_app_permission('audit')
    or public.has_app_permission('users_manage')
    or public.has_app_permission('cases_read')
  ) then
    raise exception 'forbidden';
  end if;

  return query
  with filtered as (
    select a.created_at, a.action, a.case_id, a.details, a.created_by
    from public.audit_log a
    where v_case_id is null or a.case_id = v_case_id
  ),
  counted as (
    select count(*) as n from filtered
  )
  select f.created_at, f.action, f.case_id, f.details, f.created_by, counted.n
  from filtered f
  cross join counted
  order by f.created_at desc nulls last
  limit v_limit offset v_offset;
end;
$$;

grant execute on function public.current_profile_permissions() to authenticated;
grant execute on function public.has_app_permission(text) to authenticated;
grant execute on function public.list_profiles_public() to authenticated;
grant execute on function public.delete_case(text) to authenticated;
grant execute on function public.delete_all_cases() to authenticated;
grant execute on function public.admin_update_profile(text, text, jsonb, boolean) to authenticated;
grant execute on function public.admin_set_profile_active(text, boolean) to authenticated;
grant execute on function public.admin_delete_profile(text) to authenticated;
grant execute on function public.list_cases_page(integer, integer, text, text, text, text, text) to authenticated;
grant execute on function public.list_audit_log_page(integer, integer, text) to authenticated;

drop policy if exists profiles_select_policy on public.profiles;
create policy profiles_select_policy
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.has_app_permission('users_manage')
  or public.has_app_permission('settings')
  or public.has_app_permission('cases_read')
);

drop policy if exists profiles_update_policy on public.profiles;
create policy profiles_update_policy
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  or public.has_app_permission('users_manage')
)
with check (
  id = auth.uid()
  or public.has_app_permission('users_manage')
);

drop policy if exists cases_select_policy on public.cases;
create policy cases_select_policy
on public.cases
for select
to authenticated
using (public.has_app_permission('cases_read'));

drop policy if exists cases_insert_policy on public.cases;
create policy cases_insert_policy
on public.cases
for insert
to authenticated
with check (public.has_app_permission('cases_create'));

drop policy if exists cases_update_policy on public.cases;
create policy cases_update_policy
on public.cases
for update
to authenticated
using (public.has_app_permission('cases_edit'))
with check (public.has_app_permission('cases_edit'));

drop policy if exists audit_log_select_policy on public.audit_log;
create policy audit_log_select_policy
on public.audit_log
for select
to authenticated
using (
  public.has_app_permission('audit')
  or public.has_app_permission('users_manage')
  or public.has_app_permission('cases_read')
);

drop policy if exists audit_log_insert_policy on public.audit_log;
create policy audit_log_insert_policy
on public.audit_log
for insert
to authenticated
with check (
  auth.uid() is not null
  and (
    created_by is null
    or created_by = auth.uid()
    or public.has_app_permission('users_manage')
    or public.has_app_permission('cases_read')
    or public.has_app_permission('audit')
  )
);
