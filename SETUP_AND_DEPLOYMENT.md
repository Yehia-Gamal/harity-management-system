# Setup And Deployment

## Local Static App

The app is currently a static HTML/CSS/JS application.

Primary entry point:

- `charity-management-system.html`

Required local checks:

```powershell
powershell -ExecutionPolicy Bypass -File tools/smoke-check.ps1
```

Recommended combined local gate:

```powershell
powershell -ExecutionPolicy Bypass -File tools/release-gate.ps1
```

Optional Edge Function check, when Deno is installed:

```powershell
deno check supabase/functions/reset-password-link/index.ts supabase/functions/create-user/index.ts
```

## Frontend Runtime Dependencies

Loaded from CDN in `charity-management-system.html`:

- Supabase JS v2
- Chart.js
- html2canvas
- SheetJS/XLSX
- Google Font: Tajawal

Local scripts must load in this order:

1. `assets/js/modules/permissions.js`
2. `assets/js/modules/utils.js`
3. `assets/js/modules/api.js`
4. `assets/js/modules/ui.js`
5. `assets/js/app.js`

## Supabase Required Secrets

Set these for Edge Functions:

```powershell
supabase secrets set SUPABASE_URL="https://PROJECT.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="..."
supabase secrets set ALLOWED_ORIGINS="https://your-domain.example,http://localhost:3000,http://127.0.0.1:5500"
```

The repository includes `supabase/config.toml` with the hosted project ref, so the CLI link step is:

```powershell
supabase link --project-ref fbctibquzuxfjonhbrjr
```

Do not place the service-role key in frontend files.

Schema and RLS contracts are implemented in `supabase/migrations` and summarized in `SUPABASE_CONTRACTS.md`.

## Supabase Migration

Review and apply:

- `supabase/migrations/202604150001_security_contracts.sql`

This migration defines:

- `current_profile_permissions`
- `has_app_permission`
- `list_profiles_public`
- `delete_case`
- `delete_all_cases`
- `admin_update_profile`
- `admin_set_profile_active`
- `admin_delete_profile`

## Edge Function Deployment

Deploy:

```powershell
supabase functions deploy reset-password-link --no-verify-jwt
supabase functions deploy create-user --no-verify-jwt
```

These functions perform their own JWT and `users_manage` authorization checks in
`supabase/functions/_shared/security.ts`. Gateway JWT verification must stay disabled
for these functions because ES256 Auth JWTs can be rejected by the Edge gateway before
the function code runs.

Shared helper:

- `supabase/functions/_shared/security.ts`

## First Admin Bootstrap

Create the first admin from the Supabase dashboard or a controlled SQL migration.

Do not hardcode admin emails in frontend code.

Minimum profile permissions:

```json
{
  "__role": "super_admin",
  "users_manage": true
}
```

Recommended full admin permissions are documented in `SECURITY_FINDINGS.md`.

## Post-Deploy Security Validation

Generate command examples:

```powershell
powershell -ExecutionPolicy Bypass -File tools/security-smoke-examples.ps1 -SupabaseUrl "https://PROJECT.supabase.co" -AnonKey "PUBLIC_ANON_KEY"
```

- Call `reset-password-link` without JWT: expect 401.
- Call `reset-password-link` as non-admin: expect 403.
- Call `create-user` without JWT: expect 401.
- Call `create-user` as non-admin: expect 403.
- Call profile-admin RPCs as non-admin: expect permission failure.
- Confirm disallowed origins do not receive permissive CORS headers.

Manual browser validation after deployment:

- `BROWSER_SMOKE_CHECKLIST.md`
