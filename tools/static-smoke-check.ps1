param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$htmlPath = Join-Path $Root 'charity-management-system.html'
$html = Get-Content -LiteralPath $htmlPath -Raw -Encoding UTF8

$expectedOrder = @(
  'assets/js/modules/permissions.js',
  'assets/js/modules/utils.js',
  'assets/js/modules/api.js',
  'assets/js/modules/ui.js',
  'assets/js/app.js'
)

$last = -1
foreach ($needle in $expectedOrder) {
  $idx = $html.IndexOf($needle)
  if ($idx -lt 0) { throw "HTML missing script: $needle" }
  if ($idx -le $last) { throw "HTML script order is wrong at: $needle" }
  $last = $idx
  Write-Host "OK script order: $needle"
}

foreach ($needle in @('assets/css/style.css', '@supabase/supabase-js', 'xlsx')) {
  if ($html -notlike "*$needle*") { throw "HTML missing dependency: $needle" }
  Write-Host "OK dependency: $needle"
}

$assetVersionMatches = [regex]::Matches($html, '(assets/(?:css/style\.css|js/modules/permissions\.js|js/modules/utils\.js|js/modules/api\.js|js/modules/ui\.js|js/app\.js))\?v=([0-9_]+)')
if (@($assetVersionMatches).Count -lt 6) {
  throw 'HTML must include cache-busting query versions for style.css and core scripts.'
}

$versions = @($assetVersionMatches | ForEach-Object { $_.Groups[2].Value } | Select-Object -Unique)
if ($versions.Count -ne 1) {
  throw "HTML asset versions are inconsistent: $($versions -join ', ')"
}

Write-Host "OK asset version: $($versions[0])"

Write-Host 'Static smoke checks passed.'
