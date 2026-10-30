param([string]$TvAddress, [switch]$AllowLocalSubnet)
$ErrorActionPreference = 'Stop'
$remoteScope = $null
if ($AllowLocalSubnet -and $TvAddress) { throw 'Válassz: egyetlen TV-cím vagy a privát helyi alhálózat.' }
if ($AllowLocalSubnet) { $remoteScope = 'LocalSubnet' }
elseif ($TvAddress) {
    $parsed = [Net.IPAddress]::Parse($TvAddress)
    if ($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'IPv4 címet adj meg.' }
    $remoteScope = $TvAddress
} else { throw 'Add meg a -TvAddress értéket, vagy kifejezett helyi hálózati engedélyhez a -AllowLocalSubnet kapcsolót.' }
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime\config.json') -Raw | ConvertFrom-Json
$ruleName = 'CinemaTV-Local-TV'
$existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Set-NetFirewallRule -Name $ruleName -Direction Inbound -Action Allow -Profile Private -Enabled True -RemoteAddress $remoteScope -Protocol TCP -LocalPort $config.port -ErrorAction Stop | Out-Null
} else {
    New-NetFirewallRule -Name $ruleName -DisplayName 'Cinema TV – otthoni TV-k' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $config.port -RemoteAddress $remoteScope -Profile Private -ErrorAction Stop | Out-Null
}
if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction Stop)) { throw 'A tűzfalszabály létrehozása nem igazolt.' }
Write-Host "Cinema TV port engedélyezve, kizárólag Privát hálózaton, forrás: $remoteScope. Visszavonás: Remove-NetFirewallRule -Name $ruleName"
