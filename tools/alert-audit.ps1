param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$appJs = Join-Path $Root 'assets/js/app.js'
if (!(Test-Path $appJs)) {
  throw "Missing app file: $appJs"
}

Write-Host '== Alert/confirm audit =='
Write-Host "File: $appJs"

$patterns = @(
  @{ Name = 'alert'; Regex = 'alert\(' },
  @{ Name = 'confirm'; Regex = 'confirm\(' },
  @{ Name = 'prompt'; Regex = 'prompt\(' }
)

foreach ($pattern in $patterns) {
  $matches = Select-String -Path $appJs -Pattern $pattern.Regex
  $count = @($matches).Count
  Write-Host ("{0}: {1}" -f $pattern.Name, $count)
}

Write-Host ''
Write-Host 'Remaining alert lines:'
Select-String -Path $appJs -Pattern 'alert\(' | ForEach-Object {
  Write-Host ("{0}: {1}" -f $_.LineNumber, $_.Line.Trim())
}

Write-Host ''
Write-Host 'Guidance: remaining browser dialogs should stay limited to shared-helper fallback behavior only.'
