param([string]$ExpectedModel = 'UE55TU7092UXXH', [string]$Sdb, [string]$TizenCli)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$sdk = Join-Path (Split-Path -Parent $project) 'tools\tizen-sdk'
if (-not $Sdb) {
    $Sdb = @((Join-Path $sdk 'sdb\data\tools\sdb.exe'), 'C:\tizen-studio\tools\sdb.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $TizenCli) {
    $TizenCli = @((Join-Path $sdk 'studio\tools\ide\bin\tizen.bat'), 'C:\tizen-studio\tools\ide\bin\tizen.bat') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $Sdb -or -not $TizenCli) { throw 'Nem található a Tizen SDK. Add meg a -Sdb és -TizenCli elérési útját.' }
$package = Join-Path $project 'build\CinemaTV.wgt'
if (-not (Test-Path -LiteralPath $package)) { throw 'Előbb készíts saját tanúsítvánnyal aláírt csomagot a tools\package-tizen.ps1 segítségével.' }
Write-Host 'A saját Samsung TV keresése a helyi hálózaton…'
$foundJson = & python (Join-Path $project 'tools\find_tv.py')
if ($LASTEXITCODE -ne 0) { throw 'A helyi hálózati keresés sikertelen.' }
$found = $foundJson | ConvertFrom-Json
if (-not $found.developer_endpoints) { throw 'A TV fejlesztői kapcsolata nem elérhető. Kapcsold be a TV-t az otthoni hálózaton; a Developer Mode maradjon ON. Nem kell IP-címet vagy párosítókódot beírni.' }
foreach ($address in $found.developer_endpoints) { & $Sdb connect $address | Out-Host }
$devices = & $Sdb devices
$selectedSerials = @($devices | ForEach-Object {
    if ($_ -match '^(\S+)\s+device\s+(.+?)\s*$') {
        if ($Matches[2] -eq $ExpectedModel) { $Matches[1] }
    }
})
if ($selectedSerials.Count -ne 1) { throw 'Nem azonosítható egyetlen, megfelelő típusú saját TV. Más készülékre nem telepítünk.' }
$serial = $selectedSerials[0]
& $TizenCli install -n 'CinemaTV.wgt' -s $serial -- (Join-Path $project 'build')
if ($LASTEXITCODE -ne 0) { throw 'A TV nem fogadta el a frissítést. Ellenőrizd a Tizen telepítő fenti hibaüzenetét.' }
& $TizenCli run -p 'CinTV2020x.CinemaTV' -s $serial
if ($LASTEXITCODE -ne 0) { throw 'A frissítés települt, de az indítás nem sikerült. Nyisd meg a Cinema TV-t a TV Alkalmazások menüjéből.' }
Write-Host 'A Cinema TV frissítése települt és elindult. A saját PC-t automatikusan megkeresi.'
