param(
  [Parameter(Mandatory = $true)]
  [string]$SupabaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$AnonKey,

  [string]$AdminJwt = '<ADMIN_JWT>',
  [string]$NonAdminJwt = '<NON_ADMIN_JWT>',
  [string]$TargetEmail = 'user@example.com'
)

$ErrorActionPreference = 'Stop'

$base = $SupabaseUrl.TrimEnd('/')
$resetUrl = "$base/functions/v1/reset-password-link"
$createUrl = "$base/functions/v1/create-user"

Write-Host '== Security smoke examples =='
Write-Host ''
Write-Host '1) reset-password-link without JWT should return 401'
Write-Host "curl -i -X POST `"$resetUrl`" -H `"apikey: $AnonKey`" -H `"content-type: application/json`" --data '{`"email`":`"$TargetEmail`"}'"
Write-Host ''
Write-Host '2) reset-password-link as non-admin should return 403'
Write-Host "curl -i -X POST `"$resetUrl`" -H `"apikey: $AnonKey`" -H `"authorization: Bearer $NonAdminJwt`" -H `"content-type: application/json`" --data '{`"email`":`"$TargetEmail`"}'"
Write-Host ''
Write-Host '3) reset-password-link as admin should return 200 and action_link'
Write-Host "curl -i -X POST `"$resetUrl`" -H `"apikey: $AnonKey`" -H `"authorization: Bearer $AdminJwt`" -H `"content-type: application/json`" --data '{`"email`":`"$TargetEmail`"}'"
Write-Host ''
Write-Host '4) create-user without JWT should return 401'
Write-Host "curl -i -X POST `"$createUrl`" -H `"apikey: $AnonKey`" -H `"content-type: application/json`" --data '{`"email`":`"new-user@example.com`",`"username`":`"new-user`"}'"
Write-Host ''
Write-Host '5) create-user as non-admin should return 403'
Write-Host "curl -i -X POST `"$createUrl`" -H `"apikey: $AnonKey`" -H `"authorization: Bearer $NonAdminJwt`" -H `"content-type: application/json`" --data '{`"email`":`"new-user@example.com`",`"username`":`"new-user`"}'"
Write-Host ''
Write-Host 'Replace placeholder JWT values before running these commands.'
