# Browser Smoke Checklist

Use this checklist after deploying the static frontend and Supabase changes.

This is the manual browser-level validation layer that complements `tools/smoke-check.ps1`.

## Test Environment

Confirm first:

- the browser is loading the latest static files
- cache was cleared or querystring versions changed
- Supabase URL and anon key match the target environment

## Login And Session

1. Open `charity-management-system.html`
2. Confirm the login screen renders in Arabic RTL without layout breakage
3. Login with a valid active user
4. Refresh the page
5. Confirm the session restores correctly
6. Logout
7. Confirm the app returns to the login screen cleanly

Expected result:

- no blank screen
- no blocking browser `confirm/prompt`
- no stale permission leakage from previous user session

## Role Visibility

Repeat with at least:

- `explorer`
- `manager`
- `super_admin`

Check:

1. sidebar/nav buttons only show the sections the user may access
2. restricted screens cannot be opened from UI actions
3. case-management actions match the role

Expected result:

- role-gated navigation is consistent
- no admin-only controls are visible to basic users

## Case Workflow

1. Create a case
2. Edit the same case
3. Open case details
4. Switch tabs inside case details
5. Print the case
6. Capture screenshot if used in workflow

Expected result:

- hints and toasts render correctly
- case details open without runtime errors
- modal actions remain usable on desktop and mobile widths

## Import Workflow

1. Open case import
2. Select the approved exploration sheet
3. Import the sheet directly without legacy mandatory meta prompt
4. Open one imported case
5. Confirm family members, medical items, and generated case description render correctly

Expected result:

- import succeeds
- case details do not crash
- imported medical cases appear in the medical committee path when applicable

## Medical Committee

1. Open the medical committee screen
2. Confirm imported medical cases appear
3. Open a medical case
4. Confirm the medical block uses the intended simplified display

Expected result:

- no stale fields such as hospital/risk-degree if intentionally removed
- medical totals and estimated costs are readable

## User Management

As an admin:

1. Open user management
2. Create a user
3. Update permissions
4. Deactivate and reactivate user
5. Generate reset-password link

Expected result:

- operations complete through backend-protected paths
- user-facing feedback appears through in-app modals/toasts/hints
- no raw service-role details leak to the UI

## Reports And Export

1. Open reports
2. Change filters
3. Export Excel/Word where applicable
4. Copy summary text if supported

Expected result:

- report actions do not block on old-style browser dialogs
- exported output is generated without breaking the page

## Responsive Pass

At minimum test:

- desktop width
- tablet width
- narrow mobile width

Check:

1. main navigation remains usable
2. modals stay readable
3. inline hints do not overlap controls
4. case cards and toolbar do not collapse into unreadable layouts

## Console Pass

Open browser devtools and confirm:

- no `ReferenceError`
- no repeated auth loop errors
- no missing-script load order issues

Known acceptable items:

- external library warnings outside app control may still appear, but should be reviewed

## Sign-Off

The release is browser-smoke ready when:

- all critical flows above complete successfully
- no blocking runtime error appears in console
- role visibility is correct
- import and case details work on the deployed build
