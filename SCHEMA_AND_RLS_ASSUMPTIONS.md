# Schema And RLS Assumptions

This document captures the expected production contract for the charity-management app when deployed on Supabase.

It is intentionally explicit so another developer can compare the real database against frontend and Edge Function expectations.

## Core Tables

### `profiles`

Expected purpose:

- app-facing profile row for each `auth.users` entry
- stores UI-visible identity and permission state

Expected minimum columns:

- `id uuid primary key`
- `username text unique not null`
- `full_name text null`
- `permissions jsonb not null default '{}'::jsonb`
- `is_active boolean not null default true`
- `updated_at timestamptz`
- `last_seen_at timestamptz`

Expected relationship:

- `profiles.id = auth.users.id`

Expected behavior:

- username is the application alias
- email lives in Supabase Auth, not in `profiles`
- profile rows are the server-side source for app permissions

### `cases`

Expected purpose:

- stores case payloads as serialized JSON while preserving the current static frontend model

Expected minimum columns:

- `id text primary key`
- `data jsonb not null`
- `updated_at timestamptz not null default now()`

Expected behavior:

- frontend can still work with the current object shape inside `data`
- pagination RPCs read from this table without requiring a schema rewrite

### `audit_log`

Expected purpose:

- immutable-ish trail for privileged operations and case changes

Expected minimum columns:

- `created_at timestamptz not null default now()`
- `action text not null`
- `case_id text null`
- `details text null`
- `created_by uuid null references auth.users(id)`

Expected behavior:

- privileged user/profile operations write here
- delete/delete-all/create-user/reset-password flows leave auditable traces

## Permission Model Assumptions

Canonical runtime roles:

- `explorer`
- `manager`
- `super_admin`
- `doctor`
- `medical_committee`

Legacy compatibility:

- `hidden_super_admin` may still exist in old data
- frontend normalizes this to `super_admin` semantics for most UX paths
- backend still treats it as a protected legacy role where needed

Primary rule:

- frontend permissions are UX-only
- authoritative authorization must happen in RPCs and Edge Functions

## RLS Assumptions

### General

- anonymous users should not read app data
- authenticated users should see only what their app permissions allow
- service-role operations must exist only inside Edge Functions or controlled SQL contexts

### `profiles`

Assumptions:

- direct unrestricted table reads are not required by the frontend
- admin/manager listing should be served by `list_profiles_public`
- privileged profile updates should go through:
  - `admin_update_profile`
  - `admin_set_profile_active`
  - `admin_delete_profile`

### `cases`

Assumptions:

- case reads require `cases_read`
- case create/update require `cases_create` / `cases_edit`
- deletion should go through `delete_case` or `delete_all_cases`
- large datasets may be served through `list_cases_page`

### `audit_log`

Assumptions:

- raw reads may be restricted
- UI audit views can use `list_audit_log_page`
- inserts come from trusted mutation paths

## Required RPC Contract

The deployed database is expected to expose at least:

- `current_profile_permissions`
- `has_app_permission`
- `list_profiles_public`
- `delete_case`
- `delete_all_cases`
- `admin_update_profile`
- `admin_set_profile_active`
- `admin_delete_profile`
- `list_cases_page`
- `list_audit_log_page`

See also:

- `SUPABASE_CONTRACTS.md`
- `supabase/migrations/202604150001_security_contracts.sql`

## Deployment Verification Checklist

Before production rollout, confirm:

1. every auth user that should access the app has a matching `profiles` row
2. `profiles.username` is unique
3. `profiles.permissions.__role` is one of the documented canonical roles or a known legacy alias
4. unauthorized callers receive permission failures from protected RPCs
5. Edge Functions use the service-role key only inside the function runtime
6. `audit_log` receives entries for create-user, reset-password-link, and delete flows

## Known Constraints

- the current frontend still uses a large serialized `cases.data` payload
- server-side pagination is available by contract, but must be verified in the deployed Supabase project
- a full relational decomposition of case data is intentionally deferred to avoid risky workflow regressions
