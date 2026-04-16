# User Lifecycle

## Identity Policy

- Supabase Auth email is the login identity.
- `profiles.username` is the application username/display alias.
- If a legacy username has no `@`, the frontend can derive a compatibility email as `username@app.local`.
- New production users should prefer a real email address in Auth and a stable username in `profiles.username`.

## Supported Admin Operations

### Create User

- Frontend calls Edge Function `create-user`.
- The function requires an authenticated caller with `users_manage` or `super_admin`.
- The service-role key is used only inside the Edge Function.
- The function creates the Auth user, then inserts a matching `profiles` row.
- If profile creation fails after Auth creation, the function attempts a best-effort Auth rollback.
- `hidden_super_admin` is not assignable through this path; it is normalized to `super_admin`.

### Update Profile / Permissions

- Frontend calls RPC `admin_update_profile`.
- The RPC requires `users_manage`.
- It updates profile name, permissions, and active status.
- Normal admins cannot edit or assign legacy `hidden_super_admin`.

### Activate / Deactivate

- Frontend calls RPC `admin_set_profile_active`.
- The RPC requires `users_manage`.
- This changes `profiles.is_active`; it does not delete the Auth user.

### Delete Profile

- Frontend calls RPC `admin_delete_profile`.
- The RPC requires `users_manage`.
- It prevents deleting the caller's own profile.
- It deletes only the app profile row, not the Supabase Auth user.

### Reset Password Link

- Frontend calls Edge Function `reset-password-link`.
- The function requires `users_manage`.
- It generates a recovery link through Supabase Admin APIs server-side.

## Remaining Production Decisions

- Decide whether profile deletion should become soft-delete only.
- Decide whether deactivation should also revoke active sessions.
- Decide whether `username@app.local` should remain supported or be migrated to real email addresses.
- Add a server-side repair/admin script for partial historical Auth/profile mismatches.
