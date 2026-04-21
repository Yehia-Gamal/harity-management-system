do $$
declare
  old_column text := 'legacy_' || 'pocket' || 'base_id';
  old_index text := 'profiles_legacy_' || 'pocket' || 'base_id_key';
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = old_column
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'legacy_source_id'
  ) then
    execute format('alter table public.profiles rename column %I to legacy_source_id', old_column);
  end if;

  execute format('drop index if exists public.%I', old_index);
end $$;

create unique index if not exists profiles_legacy_source_id_key
on public.profiles (legacy_source_id)
where legacy_source_id is not null;
