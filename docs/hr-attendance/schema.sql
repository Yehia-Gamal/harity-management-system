BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status_enum AS ENUM ('active', 'inactive', 'suspended', 'invited');
CREATE TYPE employee_status_enum AS ENUM ('active', 'inactive', 'suspended', 'terminated', 'on_leave');
CREATE TYPE attendance_mode_enum AS ENUM ('passkeypwa');
CREATE TYPE employment_type_enum AS ENUM ('full_time', 'part_time', 'contract', 'intern');
CREATE TYPE work_mode_enum AS ENUM ('onsite', 'hybrid', 'remote', 'field');
CREATE TYPE tracking_mode_enum AS ENUM ('attendanceonly', 'missiononly', 'workhours', 'ondemand');
CREATE TYPE attendance_event_type_enum AS ENUM ('checkin', 'checkout');
CREATE TYPE attendance_event_source_enum AS ENUM ('pwa', 'web');
CREATE TYPE verification_status_enum AS ENUM ('verified', 'failed', 'pending');
CREATE TYPE geofence_status_enum AS ENUM ('insidebranch', 'outsidebranch', 'insidemission', 'unknown', 'permissiondenied');
CREATE TYPE review_status_enum AS ENUM ('none', 'pending', 'approved', 'rejected');
CREATE TYPE approval_status_enum AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE mission_approval_status_enum AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE mission_completion_status_enum AS ENUM ('notstarted', 'inprogress', 'completed', 'overdue');
CREATE TYPE location_request_status_enum AS ENUM ('pending', 'responded', 'expired', 'cancelled');
CREATE TYPE notification_channel_enum AS ENUM ('inapp', 'webpush', 'both');
CREATE TYPE notification_delivery_status_enum AS ENUM ('pending', 'sent', 'failed', 'read');
CREATE TYPE leave_category_enum AS ENUM ('permission', 'leave', 'exception');
CREATE TYPE kpi_period_type_enum AS ENUM ('monthly', 'quarterly', 'yearly');
CREATE TYPE kpi_cycle_status_enum AS ENUM ('draft', 'active', 'closed');
CREATE TYPE kpi_scoring_type_enum AS ENUM ('system', 'managermanual', 'hybrid');

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(40),
  username VARCHAR(100),
  password_hash TEXT,
  status user_status_enum NOT NULL DEFAULT 'invited',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_format_chk CHECK (email IS NULL OR position('@' IN email) > 1)
);

CREATE UNIQUE INDEX users_email_uidx ON users ((lower(email))) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_uidx ON users (phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX users_username_uidx ON users (username) WHERE username IS NOT NULL;

CREATE TABLE roles (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT
);

CREATE TABLE permissions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(150) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  module VARCHAR(100) NOT NULL
);

CREATE TABLE role_permissions (
  id BIGSERIAL PRIMARY KEY,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

CREATE TABLE user_roles (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE (user_id, role_id)
);

CREATE TABLE governorates (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (name),
  UNIQUE (code)
);

CREATE TABLE branches (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  address TEXT,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  geofence_radius_meters INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT branches_geofence_radius_chk CHECK (geofence_radius_meters IS NULL OR geofence_radius_meters > 0)
);

CREATE TABLE complexes (
  id BIGSERIAL PRIMARY KEY,
  governorate_id BIGINT NOT NULL REFERENCES governorates(id),
  branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50),
  manager_employee_id BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (governorate_id, name),
  UNIQUE (code)
);

CREATE TABLE departments (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50),
  manager_employee_id BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (branch_id, name),
  UNIQUE (code)
);

CREATE TABLE work_shifts (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 0,
  late_after_minutes INTEGER NOT NULL DEFAULT 0,
  half_day_after_minutes INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT work_shifts_grace_chk CHECK (grace_minutes >= 0),
  CONSTRAINT work_shifts_late_after_chk CHECK (late_after_minutes >= 0),
  CONSTRAINT work_shifts_half_day_chk CHECK (half_day_after_minutes IS NULL OR half_day_after_minutes >= 0)
);

CREATE TABLE employees (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  employee_code VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(200) NOT NULL,
  photo_url TEXT,
  phone VARCHAR(40),
  email VARCHAR(255),
  job_title VARCHAR(150) NOT NULL,
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
  manager_employee_id BIGINT,
  governorate_id BIGINT REFERENCES governorates(id) ON DELETE SET NULL,
  complex_id BIGINT REFERENCES complexes(id) ON DELETE SET NULL,
  employment_type employment_type_enum NOT NULL DEFAULT 'full_time',
  work_mode work_mode_enum NOT NULL DEFAULT 'onsite',
  status employee_status_enum NOT NULL DEFAULT 'active',
  hire_date DATE,
  pwa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  attendance_mode attendance_mode_enum NOT NULL DEFAULT 'passkeypwa',
  employee_category VARCHAR(100),
  is_field_employee BOOLEAN NOT NULL DEFAULT FALSE,
  tracking_mode tracking_mode_enum NOT NULL DEFAULT 'missiononly',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employees_email_format_chk CHECK (email IS NULL OR position('@' IN email) > 1)
);

CREATE INDEX employees_branch_idx ON employees (branch_id);
CREATE INDEX employees_department_idx ON employees (department_id);
CREATE INDEX employees_manager_idx ON employees (manager_employee_id);
CREATE INDEX employees_complex_idx ON employees (complex_id);
CREATE INDEX employees_governorate_idx ON employees (governorate_id);

ALTER TABLE complexes
  ADD CONSTRAINT complexes_manager_employee_fk
  FOREIGN KEY (manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE departments
  ADD CONSTRAINT departments_manager_employee_fk
  FOREIGN KEY (manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE employees
  ADD CONSTRAINT employees_manager_employee_fk
  FOREIGN KEY (manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

CREATE TABLE employee_shifts (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_shift_id BIGINT NOT NULL REFERENCES work_shifts(id),
  start_date DATE NOT NULL,
  end_date DATE,
  CONSTRAINT employee_shifts_date_range_chk CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX employee_shifts_employee_idx ON employee_shifts (employee_id, start_date);

CREATE TABLE passkey_credentials (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  transports JSONB,
  aaguid UUID,
  sign_count BIGINT,
  backed_up BOOLEAN,
  device_label VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX passkey_credentials_user_idx ON passkey_credentials (user_id);
CREATE INDEX passkey_credentials_active_idx ON passkey_credentials (user_id, revoked_at);

CREATE TABLE user_devices (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint VARCHAR(255),
  platform VARCHAR(100),
  browser VARCHAR(100),
  os_version VARCHAR(100),
  app_installed_pwa BOOLEAN NOT NULL DEFAULT FALSE,
  is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_devices_user_idx ON user_devices (user_id);
CREATE UNIQUE INDEX user_devices_user_fingerprint_uidx
  ON user_devices (user_id, device_fingerprint)
  WHERE device_fingerprint IS NOT NULL;

CREATE TABLE exception_types (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(100) NOT NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  affects_attendance BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE leave_types (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  category leave_category_enum NOT NULL,
  requires_attachment BOOLEAN NOT NULL DEFAULT FALSE,
  affects_salary BOOLEAN,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE missions (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  mission_date DATE NOT NULL,
  start_datetime TIMESTAMPTZ NOT NULL,
  end_datetime TIMESTAMPTZ NOT NULL,
  governorate_id BIGINT REFERENCES governorates(id) ON DELETE SET NULL,
  complex_id BIGINT REFERENCES complexes(id) ON DELETE SET NULL,
  location_name VARCHAR(200),
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  geofence_radius_meters INTEGER,
  approval_status mission_approval_status_enum NOT NULL DEFAULT 'pending',
  requested_by_user_id BIGINT NOT NULL REFERENCES users(id),
  approved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  completion_status mission_completion_status_enum NOT NULL DEFAULT 'notstarted',
  completion_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT missions_time_range_chk CHECK (end_datetime >= start_datetime),
  CONSTRAINT missions_geofence_radius_chk CHECK (geofence_radius_meters IS NULL OR geofence_radius_meters > 0)
);

CREATE INDEX missions_employee_idx ON missions (employee_id, mission_date);
CREATE INDEX missions_status_idx ON missions (approval_status, completion_status);

CREATE TABLE attendance_events (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type attendance_event_type_enum NOT NULL,
  event_source attendance_event_source_enum NOT NULL DEFAULT 'pwa',
  passkey_credential_id BIGINT REFERENCES passkey_credentials(id) ON DELETE SET NULL,
  verification_status verification_status_enum NOT NULL DEFAULT 'pending',
  occurred_at_server TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurred_at_client TIMESTAMPTZ,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  accuracy NUMERIC(8, 2),
  geofence_status geofence_status_enum NOT NULL DEFAULT 'unknown',
  ip_address INET,
  user_agent TEXT,
  risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  mission_id BIGINT REFERENCES missions(id) ON DELETE SET NULL,
  raw_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX attendance_events_employee_idx ON attendance_events (employee_id, occurred_at_server DESC);
CREATE INDEX attendance_events_mission_idx ON attendance_events (mission_id);
CREATE INDEX attendance_events_geofence_idx ON attendance_events (geofence_status, verification_status);

CREATE TABLE attendance_daily (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  first_check_in TIMESTAMPTZ,
  last_check_out TIMESTAMPTZ,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_leave_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  primary_status VARCHAR(80) NOT NULL,
  secondary_status VARCHAR(80),
  exception_type_id BIGINT REFERENCES exception_types(id) ON DELETE SET NULL,
  requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  review_status review_status_enum NOT NULL DEFAULT 'none',
  notes TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, attendance_date),
  CONSTRAINT attendance_daily_minutes_chk CHECK (
    worked_minutes >= 0 AND late_minutes >= 0 AND early_leave_minutes >= 0 AND overtime_minutes >= 0
  )
);

CREATE INDEX attendance_daily_status_idx ON attendance_daily (attendance_date, primary_status, review_status);

CREATE TABLE attendance_exceptions (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_date DATE,
  exception_type_id BIGINT NOT NULL REFERENCES exception_types(id),
  title VARCHAR(200),
  reason_text TEXT NOT NULL,
  start_datetime TIMESTAMPTZ,
  end_datetime TIMESTAMPTZ,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  approval_status approval_status_enum NOT NULL DEFAULT 'pending',
  requested_by_user_id BIGINT NOT NULL REFERENCES users(id),
  approved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_exceptions_time_range_chk CHECK (
    end_datetime IS NULL OR start_datetime IS NULL OR end_datetime >= start_datetime
  )
);

CREATE INDEX attendance_exceptions_employee_idx ON attendance_exceptions (employee_id, approval_status);

CREATE TABLE leave_requests (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id BIGINT NOT NULL REFERENCES leave_types(id),
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_datetime TIMESTAMPTZ NOT NULL,
  end_datetime TIMESTAMPTZ NOT NULL,
  total_minutes INTEGER,
  total_days NUMERIC(8, 2),
  reason_text TEXT NOT NULL,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  approval_status approval_status_enum NOT NULL DEFAULT 'pending',
  requested_by_user_id BIGINT NOT NULL REFERENCES users(id),
  approved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_requests_time_range_chk CHECK (end_datetime >= start_datetime),
  CONSTRAINT leave_requests_total_minutes_chk CHECK (total_minutes IS NULL OR total_minutes >= 0),
  CONSTRAINT leave_requests_total_days_chk CHECK (total_days IS NULL OR total_days >= 0)
);

CREATE INDEX leave_requests_employee_idx ON leave_requests (employee_id, approval_status, request_date);

CREATE TABLE location_requests (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  requested_by_user_id BIGINT NOT NULL REFERENCES users(id),
  related_mission_id BIGINT REFERENCES missions(id) ON DELETE SET NULL,
  request_reason TEXT NOT NULL,
  request_status location_request_status_enum NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX location_requests_employee_idx ON location_requests (employee_id, request_status, expires_at);

CREATE TABLE employee_locations (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  location_request_id BIGINT REFERENCES location_requests(id) ON DELETE SET NULL,
  mission_id BIGINT REFERENCES missions(id) ON DELETE SET NULL,
  latitude NUMERIC(9, 6) NOT NULL,
  longitude NUMERIC(9, 6) NOT NULL,
  accuracy NUMERIC(8, 2),
  address_text TEXT,
  sent_at_server TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at_client TIMESTAMPTZ,
  presence_status_text VARCHAR(200),
  geofence_status geofence_status_enum NOT NULL DEFAULT 'unknown',
  risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX employee_locations_employee_idx ON employee_locations (employee_id, sent_at_server DESC);
CREATE INDEX employee_locations_request_idx ON employee_locations (location_request_id);
CREATE INDEX employee_locations_mission_idx ON employee_locations (mission_id);

CREATE TABLE mission_location_logs (
  id BIGSERIAL PRIMARY KEY,
  mission_id BIGINT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  latitude NUMERIC(9, 6) NOT NULL,
  longitude NUMERIC(9, 6) NOT NULL,
  accuracy NUMERIC(8, 2),
  sent_at_server TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at_client TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX mission_location_logs_mission_idx ON mission_location_logs (mission_id, sent_at_server DESC);

CREATE TABLE push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX push_subscriptions_endpoint_uidx ON push_subscriptions (endpoint);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id, is_active);

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel notification_channel_enum NOT NULL DEFAULT 'inapp',
  delivery_status notification_delivery_status_enum NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notifications_user_idx ON notifications (user_id, delivery_status, created_at DESC);

CREATE TABLE official_holidays (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  holiday_date DATE NOT NULL,
  branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL,
  is_paid BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (holiday_date, branch_id, name)
);

CREATE TABLE attachments (
  id BIGSERIAL PRIMARY KEY,
  owner_type VARCHAR(100) NOT NULL,
  owner_id BIGINT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  file_size BIGINT,
  uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX attachments_owner_idx ON attachments (owner_type, owner_id);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(150) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id BIGINT,
  before_data JSONB,
  after_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, created_at DESC);

CREATE TABLE settings (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(150) NOT NULL UNIQUE,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attendance_manual_overrides (
  id BIGSERIAL PRIMARY KEY,
  attendance_daily_id BIGINT NOT NULL REFERENCES attendance_daily(id) ON DELETE CASCADE,
  changed_by_user_id BIGINT NOT NULL REFERENCES users(id),
  reason_text TEXT NOT NULL,
  before_data JSONB NOT NULL,
  after_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX attendance_manual_overrides_daily_idx ON attendance_manual_overrides (attendance_daily_id, created_at DESC);

CREATE TABLE kpi_cycles (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  period_type kpi_period_type_enum NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status kpi_cycle_status_enum NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT kpi_cycles_date_range_chk CHECK (end_date >= start_date)
);

CREATE TABLE kpi_criteria (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  weight_percentage NUMERIC(5, 2) NOT NULL,
  scoring_type kpi_scoring_type_enum NOT NULL DEFAULT 'hybrid',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT kpi_criteria_weight_chk CHECK (weight_percentage >= 0 AND weight_percentage <= 100)
);

CREATE TABLE employee_kpi_scores (
  id BIGSERIAL PRIMARY KEY,
  kpi_cycle_id BIGINT NOT NULL REFERENCES kpi_cycles(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  criterion_id BIGINT NOT NULL REFERENCES kpi_criteria(id) ON DELETE CASCADE,
  auto_score NUMERIC(8, 2),
  manual_score NUMERIC(8, 2),
  final_score NUMERIC(8, 2) NOT NULL,
  notes TEXT,
  evaluated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kpi_cycle_id, employee_id, criterion_id)
);

CREATE INDEX employee_kpi_scores_employee_idx ON employee_kpi_scores (employee_id, kpi_cycle_id);

CREATE TABLE employee_kpi_summaries (
  id BIGSERIAL PRIMARY KEY,
  kpi_cycle_id BIGINT NOT NULL REFERENCES kpi_cycles(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  total_score NUMERIC(8, 2) NOT NULL,
  performance_grade VARCHAR(50) NOT NULL,
  ranking_nullable INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kpi_cycle_id, employee_id)
);

CREATE OR REPLACE VIEW employee_monthly_time_summary AS
SELECT
  ad.employee_id,
  date_trunc('month', ad.attendance_date)::date AS month_start,
  COUNT(*) FILTER (WHERE ad.primary_status IN ('present', 'mission', 'review')) AS working_days_count,
  ROUND(COALESCE(SUM(ad.worked_minutes), 0) / 60.0, 2) AS actual_hours,
  COALESCE(SUM(ad.late_minutes), 0) AS total_late_minutes,
  COUNT(*) FILTER (WHERE ad.primary_status = 'absent') AS absence_days_count,
  COUNT(*) FILTER (WHERE ad.primary_status = 'mission') AS mission_days_count,
  COUNT(*) FILTER (WHERE ad.secondary_status = 'leave') AS leave_days_count,
  COUNT(*) FILTER (WHERE ad.late_minutes > 0) AS late_days_count
FROM attendance_daily ad
GROUP BY ad.employee_id, date_trunc('month', ad.attendance_date);

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER employees_set_updated_at
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER missions_set_updated_at
BEFORE UPDATE ON missions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER leave_requests_set_updated_at
BEFORE UPDATE ON leave_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER attendance_daily_set_updated_at
BEFORE UPDATE ON attendance_daily
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER kpi_cycles_set_updated_at
BEFORE UPDATE ON kpi_cycles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER employee_kpi_scores_set_updated_at
BEFORE UPDATE ON employee_kpi_scores
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER employee_kpi_summaries_set_updated_at
BEFORE UPDATE ON employee_kpi_summaries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
