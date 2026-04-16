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
$migration = Join-Path $Root 'supabase/migrations/202604150001_security_contracts.sql'
$requiredDocs = @(
  'README.md',
  'REFACTOR_PLAN.md',
  'ARCHITECTURE_AUDIT.md',
  'SECURITY_FINDINGS.md',
  'ROLE_MODEL.md',
  'SUPABASE_CONTRACTS.md',
  'SCHEMA_AND_RLS_ASSUMPTIONS.md',
  'USER_LIFECYCLE.md',
  'PERFORMANCE_PLAN.md',
  'BROWSER_SMOKE_CHECKLIST.md',
  'CSS_REFACTOR_NOTES.md',
  'SETUP_AND_DEPLOYMENT.md',
  'RELEASE_CHECKLIST.md',
  'IMPLEMENTATION_LOG.md'
)

foreach ($path in @($appJs, $permissionsJs, $utilsJs, $apiJs, $uiJs, $html, $resetFn, $createFn, $sharedSecurity, $migration)) {
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

foreach ($needle in @('SUPABASE_SERVICE_ROLE_KEY', 'yahia.elspaa@gmail.com')) {
  if ($frontendText -like "*$needle*") { throw "frontend must not contain sensitive/admin marker: $needle" }
}

foreach ($needle in @('ALLOWED_ORIGINS', 'SUPABASE_SERVICE_ROLE_KEY', 'users_manage', 'authorization')) {
  if ($sharedText -notlike "*$needle*") { throw "shared security missing $needle" }
}
foreach ($needle in @('requireUsersManage', 'corsHeaders')) {
  if ($resetText -notlike "*$needle*") { throw "reset-password-link missing $needle" }
  if ($createText -notlike "*$needle*") { throw "create-user missing $needle" }
}

$migrationText = Get-Content -LiteralPath $migration -Raw -Encoding UTF8
foreach ($needle in @('list_profiles_public', 'delete_case', 'delete_all_cases', 'admin_update_profile', 'admin_set_profile_active', 'admin_delete_profile', 'list_cases_page', 'list_audit_log_page', 'has_app_permission')) {
  if ($migrationText -notlike "*$needle*") { throw "migration missing $needle" }
}
foreach ($needle in @('cases_updated_at_idx', 'audit_log_created_at_idx', 'profiles_username_idx')) {
  if ($migrationText -notlike "*$needle*") { throw "migration missing index $needle" }
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
