param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$resetFn = Join-Path $Root 'supabase/functions/reset-password-link/index.ts'
$createFn = Join-Path $Root 'supabase/functions/create-user/index.ts'

if (!(Test-Path -LiteralPath $resetFn) -or !(Test-Path -LiteralPath $createFn)) {
  throw 'Missing required Edge Function files.'
}

Write-Host '== Edge Function check =='

$deno = Get-Command deno -ErrorAction SilentlyContinue
if (-not $deno) {
  Write-Host 'SKIP: Deno is not installed; TypeScript edge-function check was not run.'
  exit 0
}

Write-Host "Using Deno: $($deno.Source)"
deno check $resetFn $createFn
Write-Host 'Edge Function check passed.'

