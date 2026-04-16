# Sprint Plan

## Delivery assumptions

- Team size: 1 full-stack developer, 1 product owner/HR reviewer, 1 QA-on-demand.
- Duration: 2-week sprints.
- Architecture target: Laravel API + PostgreSQL + Redis + Next.js/PWA frontend.
- Initial rollout size: 50 to 55 employees.

## Sprint 0 - Foundations and alignment

Goals:

- Freeze scope and naming.
- Confirm HR policies, geofence rules, and KPI weights.
- Prepare environments and branching workflow.

Outputs:

- Approved schema baseline.
- Role and permission matrix.
- Environments for `dev`, `staging`, and `pilot`.
- UI direction for RTL admin + employee PWA.

Exit criteria:

- Product brief approved.
- Infrastructure credentials available.
- Security assumptions approved for Passkeys and location usage.

## Sprint 1 - Core identity and organization setup

Goals:

- Build user, role, permission, employee, branch, department, governorate, and complex modules.
- Establish session auth and onboarding skeleton.

Build:

- Users and employee CRUD.
- Role-permission assignment.
- Branch/department/governorate/complex management.
- Shift and attendance policy setup.
- Audit logging foundation.

Acceptance:

- HR can create and update employees.
- Employees are linked to branch, department, governorate, and complex.
- Roles gate the admin menus and APIs correctly.

## Sprint 2 - Passkeys and employee onboarding

Goals:

- Deliver Passkey registration/authentication and employee security screen.
- Prepare trusted-device tracking.

Build:

- WebAuthn registration options and verification.
- WebAuthn authentication options and verification.
- Passkey management screen in employee PWA.
- Device/session storage and trusted-device indicators.
- Re-auth flow for sensitive operations.

Acceptance:

- New employee can enroll a passkey from phone or desktop.
- System stores credential metadata safely.
- Sensitive actions can enforce re-authentication.

## Sprint 3 - Attendance core with geofence

Goals:

- Implement check-in/check-out with passkey verification, location capture, and attendance resolver.

Build:

- Attendance event endpoints.
- Geofence evaluation engine for branch and mission scopes.
- Attendance daily resolver job/service.
- Employee PWA home with check-in/out flows.
- Admin daily board with review queue.

Acceptance:

- Check-in requires successful passkey verification.
- Server time is authoritative.
- Outside-geofence or permission-denied cases are flagged for review.
- Daily board reflects first check-in, last checkout, and late/early calculations.

## Sprint 4 - Leave, permissions, and manual review

Goals:

- Add leave requests, permissions, forgotten punch flows, and manual override traceability.

Build:

- Leave types and leave request workflow.
- Attendance exceptions workflow.
- Manual review approve/reject actions.
- Manual override records and audit trails.
- Notifications for approvals and rejections.

Acceptance:

- Employees can submit leave/permission requests.
- HR/manager approval updates daily attendance status correctly.
- Original attendance evidence remains intact after overrides.

## Sprint 5 - Missions and live presence

Goals:

- Deliver mission lifecycle and on-demand location requests.

Build:

- Mission request, approval, and completion flow.
- Mission-aware geofence classification.
- Location request and response workflow.
- Live presence map and pending-response monitor.
- Escalation rules for expired location requests.

Acceptance:

- Approved mission allows outside-branch attendance under mission rules.
- HR can request live location and receive response state.
- Mission location logs are queryable historically.

## Sprint 6 - Reporting, monthly hours, and KPI

Goals:

- Add decision-ready reporting, monthly hours summary, and KPI cycle management.

Build:

- Daily/monthly attendance reports.
- Monthly hours and time-achievement dashboard.
- KPI cycles, criteria, score entry, and ranking.
- CSV/Excel and PDF export pipeline.

Acceptance:

- HR can filter monthly hours by branch, department, complex, and governorate.
- KPI totals and grades are visible per employee.
- Exports match filtered report results.

## Sprint 7 - PWA polish, notifications, and pilot hardening

Goals:

- Make the employee experience feel app-like and harden operational quality.

Build:

- Installable PWA manifest and service worker.
- Web Push subscriptions and notification templates.
- Offline shell for essential employee screens.
- Risk flag dashboards and retry handling.
- UAT fixes and pilot deployment checklist.

Acceptance:

- Employee PWA is installable.
- Push notifications reach supported devices.
- Pilot branch can run a full workday flow end to end.

## Post-pilot backlog

- Advanced analytics and trend forecasting.
- Multi-branch comparative heatmaps.
- Payroll integration hooks.
- Enterprise SSO or directory sync.
- Higher-confidence risk engine rules.

