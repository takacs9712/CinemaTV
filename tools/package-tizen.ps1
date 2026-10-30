param([Parameter(Mandatory=$true)][string]$CertificateProfile, [string]$TizenCli, [string]$TvAddress)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if (-not $TizenCli) {
    $candidates = @('C:\tizen-studio\tools\ide\bin\tizen.bat', (Join-Path (Split-Path -Parent $project) 'tools\tizen-sdk\studio\tools\ide\bin\tizen.bat'))
    $installedCli = Get-Command tizen -ErrorAction SilentlyContinue
    if ($installedCli) { $candidates = @($installedCli.Source) + $candidates }
    $TizenCli = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $TizenCli) { throw 'Nem található Tizen CLI. Add meg a -TizenCli kapcsolóval.' }
if (-not (Test-Path -LiteralPath $TizenCli)) { throw 'Telepítsd a Tizen Studio Web CLI + Samsung TV Extension + Samsung Certificate Extension csomagokat, vagy add meg a -TizenCli elérési útját.' }
& python (Join-Path $PSScriptRoot 'build_widget.py')
& $TizenCli build-web -- (Join-Path $project 'tv')
if ($LASTEXITCODE -ne 0) { throw 'A Tizen web build sikertelen.' }
if ($TvAddress) {
    & python (Join-Path $PSScriptRoot 'prepare_autoconnect.py') --tv-address $TvAddress
    if ($LASTEXITCODE -ne 0) { throw 'Az automatikus TV-kapcsolat előkészítése sikertelen.' }
}
& $TizenCli package -t wgt -s $CertificateProfile -o (Join-Path $project 'build') -- (Join-Path $project 'tv\.buildResult')
if ($LASTEXITCODE -ne 0) { throw 'A Samsung-tanúsítvánnyal történő aláírás sikertelen.' }
# The Samsung 2020 installer splits an outer package filename containing spaces.
# The outer filename is not part of the signed widget contents.
$generatedPackage = Join-Path $project 'build\Cinema TV.wgt'
$installPackage = Join-Path $project 'build\CinemaTV.wgt'
if (-not (Test-Path -LiteralPath $generatedPackage)) { throw 'A csomagoló nem hozta létre a várt Cinema TV.wgt fájlt.' }
Copy-Item -LiteralPath $generatedPackage -Destination $installPackage -Force
Write-Host "Aláírt, telepíthető csomag: $installPackage"
