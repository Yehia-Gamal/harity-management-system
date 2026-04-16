# Supabase Edge Functions

## Functions

- `reset-password-link`: admin-only password recovery link generation.
- `create-user`: admin-only Auth user and profile creation.
- `_shared/security.ts`: shared CORS, JWT validation, role normalization, and `users_manage` authorization helpers.

## Required Secrets

Set these before deployment:

```bash
supabase secrets set SUPABASE_URL="https://PROJECT.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="..."
supabase secrets set ALLOWED_ORIGINS="https://your-domain.example,http://localhost:3000,http://127.0.0.1:5500"
```

## Deploy

```bash
supabase functions deploy reset-password-link
supabase functions deploy create-user
```

## Security Expectations

- Do not call service-role APIs from frontend code.
- Keep `ALLOWED_ORIGINS` explicit per environment.
- Both functions require a valid user JWT and `users_manage`/`super_admin`.
- Both functions use the service-role key only inside Edge runtime.
- Keep backend role checks aligned with `ROLE_MODEL.md`.
