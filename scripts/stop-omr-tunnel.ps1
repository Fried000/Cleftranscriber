$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$statePath = Join-Path $projectRoot '.local-omr/processes.json'
if (!(Test-Path -LiteralPath $statePath)) { Write-Output 'No managed OMR tunnel is recorded.'; return }
$entries = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
foreach ($entry in $entries) {
    $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$entry.started).ToUniversalTime().Ticks) {
        Stop-Process -Id $entry.id
    }
}
Remove-Item -LiteralPath $statePath
Write-Output 'Stopped the managed OMR service and tunnel.'
