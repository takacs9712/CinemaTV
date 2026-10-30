param([string]$Library, [string]$PcAddress, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$runtime = Join-Path $project 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$python = (Get-Command python -ErrorAction Stop).Source
$qbit = Join-Path $env:ProgramFiles 'qBittorrent\qbittorrent.exe'
if (-not (Test-Path -LiteralPath $qbit)) { throw 'Telepítsd a qBittorrentet a hivatalos qbittorrent.org oldalról.' }
if (-not $PcAddress) {
    $adapter = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address.IPAddress -notlike '169.*' } | Select-Object -First 1
    if (-not $adapter) { throw 'Nem található aktív otthoni IPv4 kapcsolat. Add meg a -PcAddress értéket.' }
    $PcAddress = $adapter.IPv4Address.IPAddress
}
$initArgs = @('-m','cinema.server','--init','--host',$PcAddress)
if ($Library) { $initArgs += @('--library',$Library) }
Push-Location -LiteralPath $project
try { & $python @initArgs; if ($LASTEXITCODE -ne 0) { throw 'A konfiguráció nem hozható létre.' } }
finally { Pop-Location }
$config = Get-Content -LiteralPath (Join-Path $runtime 'config.json') -Raw | ConvertFrom-Json
$profile = Join-Path $runtime 'qbit-profile'
$running = Get-CimInstance Win32_Process -Filter "Name='qbittorrent.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) }
if (-not $running) {
    Start-Process -FilePath $qbit -ArgumentList @("--profile=`"$profile`"",'--no-splash') -WindowStyle Hidden
}
# Check the existing Cinema TV server, not an arbitrary process ID from a stale file.
$healthy = $false
try { $reply = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/api/health" -TimeoutSec 2; $healthy = $reply.name -eq 'Cinema TV' } catch { }
if (-not $healthy) {
    Start-Process -FilePath $python -WorkingDirectory $project -ArgumentList @('-m','cinema.server') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'server.log') -RedirectStandardError (Join-Path $runtime 'server-error.log')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 300
        try { $reply = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/api/health" -TimeoutSec 1; $healthy = $reply.name -eq 'Cinema TV'; if ($healthy) { break } } catch { }
    }
}
if (-not $healthy) { throw "A szerver nem indult. Napló: $runtime\server-error.log" }
$pair = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/api/local-pairing"
Write-Host "TV-n megnyitható cím: $($pair.url)"
Write-Host 'A saját TV célzott kiadása automatikusan csatlakozik; nem kell új IP-címet vagy kódot beírni.'
Write-Host "Médiamappa: $($config.library)"
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$($config.port)/" }
