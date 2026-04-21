param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

Write-Host '== Charity app smoke checks =='
Write-Host "Root: $Root"

$appJs = Join-Path $Root 'assets/js/app.js'
$permissionsJs = Join-Path $Root 'assets/js/modules/permissions.js'
$utilsJs = Join-Path $Root 'assets/js/modules/utils.js'
$apiJs = Join-Path $Root 'assets/js/modules/api.js'
$uiJs = Join-Path $Root 'assets/js/modules/ui.js'
$html = Join-Path $Root 'charity-management-system.html'
$resetFn = Join-Path $Root 'supabase/functions/reset-password-link/index.ts'
$createFn = Join-Path $Root 'supabase/functions/create-user/index.ts'
$sharedSecurity = Join-Path $Root 'supabase/functions/_shared/security.ts'
$schemaMigration = Join-Path $Root 'supabase/migrations/202604200000_initial_schema.sql'
$migration = Join-Path $Root 'supabase/migrations/202604150001_security_contracts.sql'
$requiredDocs = @(
  'README.md',
  'SECURITY_FINDINGS.md',
  'ROLE_MODEL.md',
  'SUPABASE_CONTRACTS.md',
  'USER_LIFECYCLE.md',
  'BROWSER_SMOKE_CHECKLIST.md',
  'SETUP_AND_DEPLOYMENT.md',
  'RELEASE_CHECKLIST.md'
)

foreach ($path in @($appJs, $permissionsJs, $utilsJs, $apiJs, $uiJs, $html, $resetFn, $createFn, $sharedSecurity, $schemaMigration, $migration)) {
  if (!(Test-Path -LiteralPath $path)) {
    throw "Missing required file: $path"
  }
  Write-Host "OK file: $path"
}

foreach ($doc in $requiredDocs) {
  $path = Join-Path $Root $doc
  if (!(Test-Path -LiteralPath $path)) {
    throw "Missing required documentation: $doc"
  }
  Write-Host "OK doc: $doc"
}

Write-Host 'Checking JavaScript syntax...'
node --check $appJs
node --check $permissionsJs
node --check $utilsJs
node --check $apiJs
node --check $uiJs

Write-Host 'Checking required security strings...'
$resetText = Get-Content -LiteralPath $resetFn -Raw -Encoding UTF8
$createText = Get-Content -LiteralPath $createFn -Raw -Encoding UTF8
$sharedText = Get-Content -LiteralPath $sharedSecurity -Raw -Encoding UTF8
$frontendText = @(
  (Get-Content -LiteralPath $appJs -Raw -Encoding UTF8),
  (Get-Content -LiteralPath $permissionsJs -Raw -Encoding UTF8),
  (Get-Content -LiteralPath $utilsJs -Raw -Encoding UTF8),
  (Get-Content -LiteralPath $apiJs -Raw -Encoding UTF8),
  (Get-Content -LiteralPath $uiJs -Raw -Encoding UTF8),
  (Get-Content -LiteralPath $html -Raw -Encoding UTF8)
) -join "`n"

$sensitiveMarkers = @(
  'SUPABASE_SERVICE_ROLE_KEY',
  ((121,97,104,105,97,46,101,108,115,112,97,97,64,103,109,97,105,108,46,99,111,109 | ForEach-Object { [char]$_ }) -join '')
)
foreach ($needle in $sensitiveMarkers) {
  if ($frontendText -like "*$needle*") { throw "frontend must not contain sensitive/admin marker: $needle" }
}
$legacyRuntimeMarkers = @(
  ('window.' + 'Pocket' + 'Base'),
  ('assets/vendor/' + 'pocket' + 'base.esm.js')
)
foreach ($needle in $legacyRuntimeMarkers) {
  if ($frontendText -like "*$needle*") { throw "frontend must not keep legacy runtime dependency: $needle" }
}

foreach ($needle in @('ALLOWED_ORIGINS', 'SUPABASE_SERVICE_ROLE_KEY', 'users_manage', 'authorization')) {
  if ($sharedText -notlike "*$needle*") { throw "shared security missing $needle" }
}
foreach ($needle in @('requireUsersManage', 'corsHeaders')) {
  if ($resetText -notlike "*$needle*") { throw "reset-password-link missing $needle" }
  if ($createText -notlike "*$needle*") { throw "create-user missing $needle" }
}

$schemaText = Get-Content -LiteralPath $schemaMigration -Raw -Encoding UTF8
foreach ($needle in @('create table if not exists public.profiles', 'create table if not exists public.cases', 'create table if not exists public.audit_log', 'alter table public.profiles enable row level security', 'create trigger profiles_set_updated_at', 'create trigger cases_set_updated_at')) {
  if ($schemaText -notlike "*$needle*") { throw "schema migration missing $needle" }
}

$migrationText = Get-Content -LiteralPath $migration -Raw -Encoding UTF8
foreach ($needle in @('list_profiles_public', 'delete_case', 'delete_all_cases', 'admin_update_profile', 'admin_set_profile_active', 'admin_delete_profile', 'list_cases_page', 'list_audit_log_page', 'has_app_permission')) {
  if ($migrationText -notlike "*$needle*") { throw "migration missing $needle" }
}
foreach ($needle in @('cases_updated_at_idx', 'audit_log_created_at_idx', 'profiles_username_idx')) {
  if ($migrationText -notlike "*$needle*") { throw "migration missing index $needle" }
}
foreach ($needle in @('profiles_select_policy', 'cases_select_policy', 'audit_log_insert_policy')) {
  if ($migrationText -notlike "*$needle*") { throw "migration missing policy $needle" }
}

$activeFnCount = ([regex]::Matches($migrationText, 'create or replace function public\.admin_set_profile_active')).Count
if ($activeFnCount -ne 1) {
  throw "migration should define admin_set_profile_active exactly once; found $activeFnCount"
}

Write-Host 'Checking static HTML load order...'
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'static-smoke-check.ps1') -Root $Root

Write-Host 'Auditing remaining blocking browser dialogs...'
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'alert-audit.ps1') -Root $Root

Write-Host 'Smoke checks passed.'
