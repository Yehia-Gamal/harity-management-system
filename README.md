# Charity Case Management System

Static Arabic RTL charity/case-management application backed by Supabase.

## Main Entry Point

- `charity-management-system.html`

## Core Frontend Files

- `assets/js/app.js`
- `assets/js/modules/permissions.js`
- `assets/js/modules/utils.js`
- `assets/js/modules/api.js`
- `assets/js/modules/ui.js`
- `assets/css/style.css`

Scripts must load in this order:

1. `permissions.js`
2. `utils.js`
3. `api.js`
4. `ui.js`
5. `app.js`

The smoke check verifies this order.

## Supabase Backend

Edge Functions:

- `supabase/functions/reset-password-link`
- `supabase/functions/create-user`
- `supabase/functions/_shared/security.ts`

Database contracts:

- `supabase/migrations/202604150001_security_contracts.sql`

## Local Validation

Run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/smoke-check.ps1
```

Combined local release gate:

```powershell
powershell -ExecutionPolicy Bypass -File tools/release-gate.ps1
```

This checks:

- required files
- required docs
- JavaScript syntax
- Edge Function security markers
- migration contracts and indexes
- frontend script order
- absence of service-role secrets in frontend files

Optional when Deno is installed:

```powershell
deno check supabase/functions/reset-password-link/index.ts supabase/functions/create-user/index.ts
```

## Deployment

Read:

- `SETUP_AND_DEPLOYMENT.md`
- `RELEASE_CHECKLIST.md`
- `SUPABASE_CONTRACTS.md`
- `SCHEMA_AND_RLS_ASSUMPTIONS.md`
- `BROWSER_SMOKE_CHECKLIST.md`

Minimum deployment sequence:

1. Configure Supabase secrets.
2. Apply `supabase/migrations/202604150001_security_contracts.sql`.
3. Deploy `reset-password-link`.
4. Deploy `create-user`.
5. Run the smoke and security checks in `RELEASE_CHECKLIST.md`.

## Security Notes

- The service-role key must only exist in Supabase Edge Function secrets.
- Client-side permissions are for UI visibility only.
- Server-side authorization is enforced by Edge Functions and RPCs.
- First admin bootstrap must be done through Supabase dashboard or a controlled database operation, not frontend code.

## Refactor Tracking

- `REFACTOR_PLAN.md`
- `ARCHITECTURE_AUDIT.md`
- `SECURITY_FINDINGS.md`
- `IMPLEMENTATION_LOG.md`
- `PERFORMANCE_PLAN.md`
- `CSS_REFACTOR_NOTES.md`
