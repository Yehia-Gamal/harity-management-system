# Refactor Plan

## Phase 0 - Baseline Audit And Safety Net

- Document current architecture, Supabase dependencies, roles, risks, and missing backend pieces.
- Preserve the static app stack while security guardrails are added.
- Use `node --check assets/js/app.js` as the minimum JS syntax check.
- Use Deno checks for Edge Functions when available.

Acceptance:

- Architecture, security findings, and release checklist are present in the repo.
- Missing backend contracts are explicitly documented.

## Phase 1 - Security Hardening

- Harden `reset-password-link` as an authenticated admin-only function.
- Add protected `create-user` Edge Function.
- Restrict CORS with `ALLOWED_ORIGINS`.
- Move privileged user/reset operations to server-side service-role functions.
- Remove browser-side hardcoded admin elevation.

Acceptance:

- Anonymous reset-link calls fail.
- Non-admin reset-link/create-user calls fail.
- Admin user creation and reset link generation are audited.

## Phase 2 - Role And Permission Normalization

- Use canonical roles: `explorer`, `manager`, `super_admin`, `doctor`, `medical_committee`.
- Treat `hidden_super_admin` as legacy only.
- Keep older role names documented as migration aliases.
- Centralize permission presets in frontend and Edge Function helpers.

Acceptance:

- Permission behavior is easier to reason about and consistent between UI and backend.

## Phase 3 - Auth/Profile/User Lifecycle Cleanup

- Normalize username/email policy.
- Document `profiles` requirements and RLS expectations.
- Handle duplicate users, inactive profiles, missing profiles, and partial setup errors.

## Phase 4 - Frontend Architecture Refactor

- Extract pure helpers first.
- Then extract API wrappers and auth/user/case/report modules.
- Replace inline event handlers gradually.
- Keep global compatibility while migrating.

## Phase 5 - UX Stabilization

- Replace frequent alerts with shared toast/modal flows.
- Improve loading, empty, validation, and success states.
- Preserve Arabic RTL workflows.

## Phase 6 - Performance

- Debounce filters/search.
- Reduce full-list rerenders.
- Document server-side pagination candidates for `cases` and `audit_log`.

## Phase 7 - CSS Reorganization

- Group CSS into components/layout/forms/tables/modals/nav sections.
- Remove unused selectors after audit.

## Phase 8 - Testing And Release Readiness

- Add smoke-test checklist or lightweight browser tests.
- Document setup, deployment, env vars, Supabase functions, schema/RPC assumptions, and release steps.

