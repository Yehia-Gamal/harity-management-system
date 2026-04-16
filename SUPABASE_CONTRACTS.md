# Supabase Contracts

## Required Tables

See also `USER_LIFECYCLE.md` for the Auth email / profile username policy.

### `profiles`

Expected columns:

- `id uuid primary key` matching `auth.users.id`
- `username text unique not null`
- `full_name text`
- `permissions jsonb not null default '{}'::jsonb`
- `is_active boolean not null default true`
- `updated_at timestamptz`
- `last_seen_at timestamptz`

### `cases`

Expected columns:

- `id text primary key`
- `data jsonb not null`
- `updated_at timestamptz`

### `audit_log`

Expected columns:

- `created_at timestamptz default now()`
- `action text`
- `case_id text`
- `details text`
- `created_by uuid null references auth.users(id)`

## Required Edge Functions

### `create-user`

Input:

```json
{
  "email": "user@example.com",
  "password": "optional-temp-password",
  "username": "explorer1",
  "full_name": "اسم المستخدم",
  "permissions": {
    "__role": "explorer",
    "cases_read": true
  }
}
```

Behavior:

- Requires authenticated caller.
- Caller must have `users_manage` or `super_admin`.
- Creates Supabase Auth user with service-role key.
- Creates matching `profiles` row.
- Writes `audit_log`.

### `reset-password-link`

Input:

```json
{ "email": "user@example.com" }
```

Behavior:

- Requires authenticated caller.
- Caller must have `users_manage` or `super_admin`.
- Generates recovery link with service-role key.
- Writes `audit_log`.

## Required RPCs

Reference migration:

- `supabase/migrations/202604150001_security_contracts.sql`

### `list_profiles_public`

Purpose:

- Return restricted profile rows for manager/admin screens without exposing unnecessary sensitive fields.

Recommended output fields:

- `id`
- `username`
- `full_name`
- `is_active`
- `last_seen_at`
- limited role/permission summary if caller is allowed

### `delete_case`

Purpose:

- Enforce server-side case deletion/soft deletion.

Required behavior:

- Require authenticated caller.
- Require `cases_delete` or stronger permission.
- Prefer soft deletion or audit-backed deletion.
- Write `audit_log` or expose enough result details for reliable audit insertion.

### `delete_all_cases`

Purpose:

- Enforce server-side bulk deletion permission checks.

Required behavior:

- Require authenticated caller.
- Require `cases_delete_all` or stronger permission.
- Write an `audit_log` entry with the number of deleted rows.

### `list_cases_page`

Purpose:

- Provide a server-driven page of cases for large datasets.

Required behavior:

- Require authenticated caller.
- Require `cases_read`.
- Support limit/offset and common filters.
- Return `id`, `data`, `updated_at`, and `total_count`.

### `list_audit_log_page`

Purpose:

- Provide a server-driven page of audit log rows.

Required behavior:

- Require authenticated caller.
- Require `audit`, `users_manage`, or a documented read permission.
- Support optional case filtering.
- Return only UI-needed fields and `total_count`.

### `admin_update_profile`

Purpose:

- Enforce server-side updates for profile name, active status, and permissions.

Required behavior:

- Require authenticated caller.
- Require `users_manage` or stronger permission.
- Reject normal callers trying to edit or assign `hidden_super_admin`.
- Write `audit_log`.

Input parameters:

- `p_username text`
- `p_full_name text default null`
- `p_permissions jsonb default null`
- `p_is_active boolean default null`

### `admin_set_profile_active`

Purpose:

- Enforce server-side activation/deactivation of user profiles.

Required behavior:

- Require authenticated caller.
- Require `users_manage` or stronger permission.
- Reject normal callers trying to alter `hidden_super_admin`.
- Write `audit_log`.

### `admin_delete_profile`

Purpose:

- Enforce server-side deletion of profile rows from the admin UI.

Required behavior:

- Require authenticated caller.
- Require `users_manage` or stronger permission.
- Prevent deleting the caller's own profile.
- Reject normal callers trying to delete `hidden_super_admin`.
- Write `audit_log`.

## Required Edge Function Secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS`
