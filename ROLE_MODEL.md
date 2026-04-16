# Role And Permission Model

## Canonical Roles

| Role | Purpose | Default permissions |
| --- | --- | --- |
| `explorer` | Field explorer / case intake | `cases_create`, `cases_read`, `settings` |
| `manager` | Case reviewer / operational manager | `dashboard`, `cases_read`, `cases_create`, `cases_edit`, `case_status_change`, `cases_delete`, `settings` |
| `super_admin` | System administrator | all permissions |
| `doctor` | Medical committee user | `medical_committee`, `settings` |
| `medical_committee` | Medical committee only | `medical_committee` |

## Legacy Roles

- `hidden_super_admin` is deprecated.
- Existing rows may still contain it, so the frontend and Edge Functions keep read compatibility.
- New user creation normalizes `hidden_super_admin` to `super_admin`.

## Permission Keys

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

## Authorization Rule

Frontend permission checks are UX only. Supabase RLS, RPCs, and Edge Functions must enforce sensitive operations server-side.

Admin-only operations should require `users_manage` or a `super_admin` role server-side.

## Implementation Notes

- Frontend role interpretation is centralized in `normalizeRoleKey_`, `getUserRoleFromPermissions_`, `getRolePresetPermissions_`, and `roleIs_`.
- Full-access UI roles are `super_admin` and legacy `hidden_super_admin`.
- Manager-level case approval/delete UI roles are `manager`, `super_admin`, and legacy `hidden_super_admin`.
- Server-side enforcement is implemented separately in Edge Functions and RPCs; matching permission names should stay aligned with this document.
