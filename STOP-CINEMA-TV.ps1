param([switch]$AlsoStopDownloader)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'runtime'
$projectPath = [IO.Path]::GetFullPath($PSScriptRoot)
$servers = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match '(-m\s+cinema.server)' }
# Match the recorded PID as well as the command line; never kill a process based on PID alone.
$pidFile = Join-Path $runtime 'server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $cinemaProcessId = [int](Get-Content -LiteralPath $pidFile)
    $servers | Where-Object ProcessId -eq $cinemaProcessId | ForEach-Object { Stop-Process -Id $_.ProcessId }
}
if ($AlsoStopDownloader) {
    $profile = Join-Path $runtime 'qbit-profile'
    Get-CimInstance Win32_Process -Filter "Name='qbittorrent.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } | ForEach-Object { Stop-Process -Id $_.ProcessId }
    Write-Host 'A Cinema TV letöltője és seedelése is leállt. A normál qBittorrent-profilt ez nem érinti.'
} else { Write-Host 'A médiaszerver leállt. A külön qBittorrent letöltő/seedelő tovább fut.' }
