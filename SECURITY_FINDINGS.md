# Security Findings

## High Severity

1. `reset-password-link` was unauthenticated and used the Supabase service-role key to generate recovery links. **Fixed in this refactor pass.**
   - Impact: anyone able to call the function could generate password reset links for arbitrary emails.
   - Fix target: require authenticated caller, check `profiles.permissions.users_manage`, restrict CORS, and audit the action.

2. Frontend contained hardcoded super-admin elevation for a specific email. **Fixed in this refactor pass.**
   - Impact: privilege source existed in browser code and could drift from server-side authorization.
   - Fix target: remove client-side privilege elevation and document bootstrap/admin seeding as a server/database task.
   - Regression guard: `tools/smoke-check.ps1` fails if that email or `SUPABASE_SERVICE_ROLE_KEY` appears in frontend files.

3. `create-user` was referenced by the frontend but no Edge Function existed. **Fixed in this refactor pass.**
   - Impact: user creation flow was incomplete and encouraged manual Supabase Auth workarounds.
   - Fix target: add protected server-side `create-user` function using service-role only inside Edge runtime.

## Medium Severity

1. Role and permission helpers are duplicated and inconsistent.
   - Status: frontend role presets, legacy aliases, and role checks are now centralized in helper functions.
   - Remaining target: keep Edge Function/backend role helpers aligned with `ROLE_MODEL.md`.

2. RPC dependencies are not documented in the repo.
   - Status: documented and scaffolded expected `delete_case`, `delete_all_cases`, `list_profiles_public`, and profile-admin RPC contracts.

3. UI permission checks may create a false sense of security.
   - Status: reset links, user creation, case deletion, bulk case deletion, profile update, activation/deactivation, and profile deletion now have server-side Edge Function/RPC contracts.
   - Remaining validation: deploy migrations/functions and confirm unauthorized callers receive 401/403-style failures.

## Required Supabase Secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS`

Recommended `ALLOWED_ORIGINS` example:

```text
https://your-production-domain.example,http://localhost:3000,http://127.0.0.1:5500
```

## Bootstrap Note

The first admin should be created or elevated through a controlled database migration or Supabase dashboard action, not browser code. Set `profiles.permissions` to include:

```json
{
  "__role": "super_admin",
  "users_manage": true,
  "cases_read": true,
  "cases_create": true,
  "cases_edit": true,
  "cases_delete": true,
  "cases_delete_all": true,
  "case_status_change": true,
  "dashboard": true,
  "reports": true,
  "settings": true,
  "audit": true,
  "medical_committee": true
}
```
