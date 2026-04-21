# Decent Family

Static Arabic RTL case-management app backed by Supabase.

## Runtime

- Frontend: `charity-management-system.html`
- Backend: Supabase Auth, Postgres, RPCs, and Edge Functions
- Local server: static file server only

## Local Run

1. Copy `.env.example` to `.env`.
2. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `APP_PUBLIC_URL`.
3. Start the local static server:

```text
00-START-SYSTEM.cmd
```

4. Open:

```text
http://127.0.0.1:5500/charity-management-system.html
```

## Checks

```powershell
npm run check
npm run check:static
npm run check:js
```

## Supabase Setup

- Apply migrations in `supabase/migrations`.
- Deploy Edge Functions in `supabase/functions`.
- Link the CLI project with `supabase link --project-ref fbctibquzuxfjonhbrjr`.
- Review `SETUP_AND_DEPLOYMENT.md`, `SUPABASE_CONTRACTS.md`, `USER_LIFECYCLE.md`, and `RELEASE_CHECKLIST.md`.

Do not place the service-role key in frontend files.
