param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

Write-Host '== Release gate =='
Write-Host "Root: $Root"

powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'smoke-check.ps1') -Root $Root
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'edge-function-check.ps1') -Root $Root

Write-Host ''
Write-Host 'Next manual gates:'
Write-Host '1. Run post-deploy security examples from tools/security-smoke-examples.ps1'
Write-Host '2. Execute BROWSER_SMOKE_CHECKLIST.md in the deployed environment'
Write-Host '3. Complete RELEASE_CHECKLIST.md sign-off'
