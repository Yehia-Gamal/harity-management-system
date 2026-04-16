# Release Checklist

## Pre-Release

- [ ] Confirm worktree is committed or backed up.
- [ ] Review `SETUP_AND_DEPLOYMENT.md`.
- [ ] Review `SCHEMA_AND_RLS_ASSUMPTIONS.md`.
- [ ] Confirm Supabase project URL and anon key are correct for target environment.
- [ ] Set Edge Function secrets:
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `ALLOWED_ORIGINS`
- [ ] Deploy Edge Functions:
  - [ ] `reset-password-link`
  - [ ] `create-user`
- [ ] Confirm required RPCs exist:
  - [ ] `delete_case`
  - [ ] `delete_all_cases`
  - [ ] `list_profiles_public`
  - [ ] `admin_update_profile`
  - [ ] `admin_set_profile_active`
  - [ ] `admin_delete_profile`
  - [ ] `list_cases_page`
  - [ ] `list_audit_log_page`
- [ ] Confirm first `super_admin` profile is seeded server-side or via Supabase dashboard.

## Smoke Tests

- [ ] Run `powershell -ExecutionPolicy Bypass -File tools/release-gate.ps1`.
- [ ] Run `powershell -ExecutionPolicy Bypass -File tools/smoke-check.ps1`.
- [ ] Review `tools/alert-audit.ps1` output and confirm remaining browser dialogs are limited to shared-helper fallback behavior only.
- [ ] Execute `BROWSER_SMOKE_CHECKLIST.md` on the deployed build.
- [ ] Login/logout works.
- [ ] Session restore works after refresh.
- [ ] Role-gated navigation renders correctly.
- [ ] Create case.
- [ ] Edit case.
- [ ] Import approved exploration sheet.
- [ ] Open case details.
- [ ] Medical committee includes imported medical cases.
- [ ] Admin creates user through Edge Function.
- [ ] Creating a duplicate username returns a clear admin-facing error.
- [ ] Creating a duplicate email returns a clear admin-facing error.
- [ ] Admin updates profile permissions through `admin_update_profile`.
- [ ] Admin deactivates user through `admin_set_profile_active`.
- [ ] Case reject/delete dialogs render and complete correctly without browser `confirm/prompt`.
- [ ] Delete-all-cases typed confirmation works through the in-app modal dialog.
- [ ] Admin generates reset password link.
- [ ] Non-admin reset password link request fails.
- [ ] Reports/export flows run.
- [ ] `list_cases_page` returns a page with `total_count`.
- [ ] `list_audit_log_page` returns a page with `total_count`.

## Security Checks

- [ ] `reset-password-link` without token returns 401.
- [ ] `reset-password-link` as non-admin returns 403.
- [ ] `create-user` without token returns 401.
- [ ] `create-user` as non-admin returns 403.
- [ ] Generate post-deploy curl examples with `tools/security-smoke-examples.ps1`.
- [ ] Profile admin RPCs as non-admin return 403.
- [ ] Profile admin RPCs cannot delete or modify the caller's own protected admin path.
- [ ] Disallowed browser origin does not receive permissive CORS headers.
- [ ] Service-role key is present only in Supabase Function secrets, not frontend code.
