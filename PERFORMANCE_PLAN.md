# Performance And Data Flow Plan

## Current Improvements Already Present

- Case list rendering is scheduled through `scheduleCasesListRender_()` instead of rendering immediately on every filter input.
- Case list pagination uses an incremental client-side limit through `AppState._casesListLimit`.
- Excel import prefers array-of-arrays parsing for XLSX to avoid large CSV strings.
- Supabase access is being routed through `assets/js/modules/api.js` so future server-driven queries can be introduced in one place.

## Remaining Bottlenecks

- `loadCasesFromDb()` still loads up to 5000 cases into the browser.
- Reports and dashboard calculations still scan `AppState.cases` in memory.
- Audit log loads the latest 500 rows client-side.
- Profile list can load up to 5000 profiles for admin views.

## Server-Driven Pagination Candidates

### Cases

Implemented contract:

- `list_cases_page(p_limit int, p_offset int, p_search text, p_governorate text, p_area text, p_grade text, p_category text)`

Expected behavior:

- Require `cases_read`.
- Return `id`, `data`, `updated_at`, and `total_count`.
- Apply filters server-side where practical.
- Sort by `updated_at desc`.

### Audit Log

Implemented contract:

- `list_audit_log_page(p_limit int, p_offset int, p_case_id text default null)`

Expected behavior:

- Require `audit` or `users_manage`.
- Return only fields needed by the UI.
- Avoid exposing internal sensitive data beyond `details`.

### Profiles

Recommended RPC:

- Extend `list_profiles_public` with `p_limit`, `p_offset`, and `p_search`.

Expected behavior:

- Require allowed profile read permissions.
- Return restricted permission data unless caller has `users_manage`.

## Acceptance Criteria For Future Phase 6 Completion

- Large case lists do not require full-table fetch.
- Filters remain responsive above 5000 cases.
- Audit log can page through results.
- API module owns pagination calls.

## Implementation Status

- `list_cases_page` and `list_audit_log_page` are scaffolded in `supabase/migrations/202604150001_security_contracts.sql`.
- `assets/js/modules/api.js` exposes `listCasesPage` and `listAuditLogPage`.
- The current UI still uses the legacy full-list load by default until the deployed RPCs are verified.
- The migration adds supporting indexes for `cases.updated_at`, common case JSON fields, `audit_log.created_at`, `audit_log.case_id`, and `profiles.username`.
