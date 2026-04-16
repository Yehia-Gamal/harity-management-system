# API Contract

## Conventions

- Base URL: `/api`
- Auth strategy:
  - Session cookie for admin web app.
  - Same-site secure cookie for employee PWA.
  - Re-auth via WebAuthn challenge for sensitive actions.
- Time source:
  - Server timestamp is authoritative for attendance and location logs.
- Error envelope:

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Passkey assertion is required."
  }
}
```

- Success envelope:

```json
{
  "success": true,
  "data": {}
}
```

## Authentication

### POST `/auth/login`

Authenticate the user and create a session.

Request:

```json
{
  "identifier": "employee.code.or.email",
  "password": "optional-if-password-enabled"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": 14,
      "fullName": "Ahmed Salah",
      "roles": ["employee"],
      "employeeId": 28
    },
    "requiresPasskeyEnrollment": true
  }
}
```

### POST `/auth/logout`

Invalidate the active session.

### GET `/auth/me`

Return current user, employee profile, permissions, trusted-device state, and current shift.

## Passkeys

### POST `/passkeys/register/options`

Create WebAuthn registration challenge for the current user.

Response:

```json
{
  "success": true,
  "data": {
    "challenge": "base64url",
    "rp": {
      "name": "HR Attendance",
      "id": "attendance.example.com"
    },
    "user": {
      "id": "14",
      "name": "employee-028",
      "displayName": "Ahmed Salah"
    },
    "pubKeyCredParams": [
      { "alg": -7, "type": "public-key" },
      { "alg": -257, "type": "public-key" }
    ]
  }
}
```

### POST `/passkeys/register/verify`

Verify registration response and persist credential.

Request:

```json
{
  "credential": {
    "id": "base64url",
    "rawId": "base64url",
    "type": "public-key",
    "response": {
      "clientDataJSON": "base64url",
      "attestationObject": "base64url"
    }
  },
  "deviceLabel": "iPhone 15 - Safari"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "credentialId": 51,
    "deviceTrusted": true
  }
}
```

### POST `/passkeys/auth/options`

Create WebAuthn authentication challenge.

Optional body:

```json
{
  "purpose": "attendance_check_in"
}
```

### POST `/passkeys/auth/verify`

Verify assertion and return short-lived verification token for the intended action.

Response:

```json
{
  "success": true,
  "data": {
    "verificationToken": "opaque-short-lived-token",
    "verifiedAt": "2026-04-13T18:00:12Z",
    "credentialId": 51
  }
}
```

### GET `/passkeys`

List active passkeys for the current user.

### DELETE `/passkeys/{id}`

Revoke a credential after re-authentication.

## Employees

### GET `/employees`

Filters:

- `branchId`
- `departmentId`
- `complexId`
- `governorateId`
- `status`
- `trackingMode`
- `search`

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 28,
        "employeeCode": "EMP-028",
        "fullName": "Ahmed Salah",
        "jobTitle": "Field Supervisor",
        "branch": "Giza Branch",
        "department": "Operations",
        "complex": "Pyramids Complex",
        "passkeyStatus": "registered",
        "todayStatus": "checked_in",
        "lastLocationAt": "2026-04-13T09:57:00Z"
      }
    ],
    "meta": {
      "page": 1,
      "pageSize": 25,
      "total": 55
    }
  }
}
```

### POST `/employees`

Create employee, linked user, initial shift assignment, and invitation flow settings.

### GET `/employees/{id}`

Return profile, roles, shift, passkeys, devices, attendance summary, leave balances, and KPI snapshot.

### PUT `/employees/{id}`

Update profile, branch, department, complex, governorate, shift, or tracking mode.

## Attendance

### POST `/attendance/check-in`

Record attendance event after passkey verification.

Request:

```json
{
  "verificationToken": "opaque-short-lived-token",
  "clientTimestamp": "2026-04-13T09:59:11+02:00",
  "location": {
    "latitude": 29.977312,
    "longitude": 31.132495,
    "accuracy": 14.5
  },
  "device": {
    "appInstalledPwa": true,
    "platform": "ios",
    "browser": "safari"
  },
  "meta": {
    "locationPermission": "granted"
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "eventId": 4401,
    "occurredAtServer": "2026-04-13T08:00:13Z",
    "verificationStatus": "verified",
    "geofenceStatus": "insidebranch",
    "primaryStatus": "present",
    "requiresReview": false,
    "riskFlags": []
  }
}
```

### POST `/attendance/check-out`

Same contract as check-in with `eventType = checkout`.

### GET `/attendance/daily`

Filters:

- `date`
- `branchId`
- `departmentId`
- `employeeId`
- `reviewStatus`

Response includes `firstCheckIn`, `lastCheckOut`, `workedMinutes`, `lateMinutes`, `earlyLeaveMinutes`, `primaryStatus`, `secondaryStatus`, `requiresReview`, and active exception/mission labels.

### GET `/attendance/events`

Event log with `riskFlags`, `rawMeta`, geofence classification, device, and credential references.

### POST `/attendance/manual-review/{dailyId}/approve`

Approve reviewed day and optionally apply manual override.

Request:

```json
{
  "note": "Approved because employee had an active mission.",
  "override": {
    "primaryStatus": "mission",
    "workedMinutes": 450
  }
}
```

### POST `/attendance/manual-review/{dailyId}/reject`

Reject reviewed day with mandatory note.

## Leave, Permission, and Exceptions

### POST `/leave-requests`

Create leave or permission request.

### GET `/leave-requests`

List by employee, date range, approval status, or leave type.

### POST `/leave-requests/{id}/approve`

Approve request and trigger attendance recalculation.

### POST `/leave-requests/{id}/reject`

Reject request with reason.

### POST `/exceptions`

Create legacy attendance exception request such as forgotten checkout.

## Missions

### GET `/missions`

Filters:

- `employeeId`
- `approvalStatus`
- `completionStatus`
- `dateFrom`
- `dateTo`

### POST `/missions`

Create mission request.

Request:

```json
{
  "employeeId": 28,
  "title": "Branch inspection visit",
  "description": "On-site inspection and partner meeting",
  "missionDate": "2026-04-14",
  "startDateTime": "2026-04-14T10:00:00+02:00",
  "endDateTime": "2026-04-14T15:30:00+02:00",
  "governorateId": 3,
  "complexId": 7,
  "locationName": "Fayoum Complex",
  "latitude": 29.30995,
  "longitude": 30.8418,
  "geofenceRadiusMeters": 250
}
```

### POST `/missions/{id}/approve`

Approve mission and activate mission geofence rules.

### POST `/missions/{id}/reject`

Reject mission with reason.

### POST `/missions/{id}/complete`

Close mission with completion notes and optional attachment summary.

## Location & Presence

### POST `/location/request`

Create a live location request for employee or mission tracking.

Request:

```json
{
  "employeeId": 28,
  "relatedMissionId": 80,
  "requestReason": "Please confirm your current site.",
  "expiresInMinutes": 15
}
```

### POST `/location/respond`

Employee submits live location request response.

```json
{
  "requestId": 1203,
  "location": {
    "latitude": 29.30995,
    "longitude": 30.8418,
    "accuracy": 18.2
  },
  "presenceStatusText": "At client office"
}
```

### GET `/location/requests`

List pending and historical location requests with response status and expiration.

### GET `/location/latest`

Return last known location per employee, filterable by branch or field employee status.

### GET `/location/map`

Provide geo-ready payload for dashboard map view.

## Notifications

### POST `/push/subscribe`

Persist Web Push subscription.

### POST `/push/unsubscribe`

Disable subscription endpoint.

### POST `/notifications/send`

Internal admin endpoint to send templated or ad hoc notifications.

### GET `/notifications`

Current user notifications with pagination and unread counts.

### POST `/notifications/{id}/read`

Mark notification as read.

## Reports

### GET `/reports/daily`

Daily attendance summary by branch, department, complex, or employee.

### GET `/reports/monthly-hours`

Monthly time-performance report.

Filters:

- `month=2026-04`
- `branchId`
- `departmentId`
- `complexId`
- `governorateId`

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "employeeId": 28,
        "employeeName": "Ahmed Salah",
        "requiredHours": 176,
        "actualHours": 168.5,
        "timeAchievementPercent": 95.74,
        "lateDays": 2,
        "absenceDays": 0,
        "missionDays": 4,
        "leaveDays": 1
      }
    ]
  }
}
```

### GET `/reports/export/pdf`

Generate export job or immediate binary for report payload.

### GET `/reports/export/excel`

Generate spreadsheet export.

## KPI

### GET `/kpi/cycles`

List KPI cycles with status and period.

### POST `/kpi/cycles`

Create monthly, quarterly, or yearly KPI cycle.

### GET `/kpi/criteria`

List criteria with weights and scoring type.

### PUT `/kpi/criteria/{id}`

Update weights or descriptions.

### POST `/kpi/scores`

Submit manager or HR manual score.

```json
{
  "kpiCycleId": 12,
  "employeeId": 28,
  "criterionId": 5,
  "manualScore": 18.5,
  "notes": "Strong coordination during branch missions."
}
```

### GET `/kpi/summary`

Return employee KPI totals, performance grade, and ranking.

## Admin Configuration

### GET `/settings`

Fetch geofence, shift, notification, KPI, and PWA settings.

### PUT `/settings/{key}`

Update configuration item with audit logging and optional re-auth requirement.

### GET `/audit-log`

Paginated audit log filtered by user, module, entity, or date range.

