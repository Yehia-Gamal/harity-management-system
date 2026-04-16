# Architecture Audit

## Current Stack

- Static Arabic RTL frontend: `charity-management-system.html`.
- Main application logic: `assets/js/app.js`.
- Incremental frontend modules:
  - `assets/js/modules/permissions.js`
  - `assets/js/modules/utils.js`
  - `assets/js/modules/api.js`
  - `assets/js/modules/ui.js`
- Main styling: `assets/css/style.css`.
- Supabase JavaScript client loaded from CDN.
- Excel import/export via SheetJS CDN.
- Supabase Edge Functions under `supabase/functions`.
- Separate `hr-attendance` prototype/docs exist and are currently outside the charity app runtime.

## Runtime Entry Points

- `index.html` redirects/links into the charity app.
- `charity-management-system.html` loads:
  - Google Fonts.
  - `assets/css/style.css`.
  - Supabase JS CDN.
  - SheetJS CDN.
  - html2canvas CDN.
  - `assets/js/modules/permissions.js`.
  - `assets/js/modules/utils.js`.
  - `assets/js/modules/api.js`.
  - `assets/js/modules/ui.js`.
  - `assets/js/app.js`.

## Main Data Flow

- Browser initializes `SupabaseClient` with public project URL and anon/publishable key.
- Auth session is restored client-side.
- User profile is loaded from `profiles`.
- Application permissions are read from `profiles.permissions`.
- Cases are stored in a Supabase `cases` table as a JSON-like `data` payload.
- Audit events are inserted into `audit_log`.
- Privileged user/auth operations call protected Edge Functions or RPCs.
- Case list loading can use the `list_cases_page` RPC after deployment and falls back to legacy direct reads.

## Inferred Supabase Tables

- `profiles`
  - Expected fields: `id`, `username`, `full_name`, `permissions`, `is_active`, `updated_at`, `last_seen_at`.
- `cases`
  - Expected fields: `id`, `data`, `updated_at`.
- `audit_log`
  - Expected fields: `created_at`, `action`, `case_id`, `details`, `created_by`.

## Inferred RPCs And Edge Functions

- Existing Edge Function:
  - `reset-password-link`
- Added Edge Function:
  - `create-user`
- RPCs:
  - `delete_case`
  - `list_profiles_public`
  - `delete_all_cases`
  - `admin_update_profile`
  - `admin_set_profile_active`
  - `admin_delete_profile`
  - `list_cases_page`
  - `list_audit_log_page`

## Role And Permission Model Observed

Current roles seen in frontend code:

- `explorer`
- `manager`
- `super_admin`
- `doctor`
- `medical_committee`
- `hidden_super_admin` legacy/special role
- older preset names also exist: `admin`, `supervisor`, `data_entry`, `auditor`, `viewer`

Permissions seen in the app:

- `dashboard`
- `reports`
- `settings`
- `audit`
- `medical_committee`
- `cases_read`
- `cases_create`
- `cases_edit`
- `cases_delete`
- `cases_delete_all`
- `case_status_change`
- `users_manage`

## Current Risks

- The app is still largely a monolithic JS/CSS frontend.
- Many UI actions are wired through inline `onclick`.
- Server-side authorization contracts now exist, but must be deployed and tested against the real Supabase project.
- The frontend expects newly scaffolded backend functions/RPCs that may not yet be deployed.
- Current repo has uncommitted changes; avoid destructive git operations until checkpointed.
