param(
    [string]$PythonPath,
    [string]$AudiverisPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$runtimeDir = Join-Path $projectRoot '.local-omr'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$statePath = Join-Path $runtimeDir 'processes.json'
if (Test-Path -LiteralPath $statePath) {
    throw 'Run scripts/stop-omr-tunnel.ps1 before starting another tunnel.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 8001 -ErrorAction SilentlyContinue) {
    throw 'Port 8001 is already in use. Stop the existing OMR service before starting this script.'
}

if (!$PythonPath) {
    $candidates = @(
        (Join-Path $projectRoot '.venv/Scripts/python.exe'),
        (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
    )
    $PythonPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (!$PythonPath) {
        throw 'Pass -PythonPath with the path to Python containing omr-service/requirements.txt dependencies.'
    }
}
if (!$AudiverisPath) {
    $candidates = @(
        (Join-Path $projectRoot '.test-deps/audiveris/portable/Audiveris/Audiveris.exe'),
        (Join-Path $env:ProgramFiles 'Audiveris/Audiveris.exe')
    )
    $AudiverisPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (!$AudiverisPath) { throw 'Install Audiveris or pass -AudiverisPath with its executable path.' }
}

$tunnelExe = Join-Path $runtimeDir 'cloudflared.exe'
if (!(Test-Path -LiteralPath $tunnelExe)) {
    Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-windows-amd64.exe' -OutFile $tunnelExe
}
$expectedHash = '76B2805253D0D6FFACB092A7ACFBEE99E7AF6917835C0C5410E23F3EF5052DA2'
if ((Get-FileHash -LiteralPath $tunnelExe -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'The cloudflared checksum does not match the official release. Remove .local-omr/cloudflared.exe and retry.'
}

$envPath = Join-Path $projectRoot '.env.local'
$envText = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
$tokenMatch = [regex]::Match($envText, '(?m)^OMR_SERVICE_TOKEN=([^\r\n]+)')
$token = if ($tokenMatch.Success) { $tokenMatch.Groups[1].Value.Trim().Trim('"').Trim("'") } else { '' }
if (!$token -or $token -eq 'local-omr-secret') {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    $envText = [regex]::Replace($envText, '(?m)^OMR_SERVICE_TOKEN=.*\r?\n?', '')
    $envText = $envText.TrimEnd() + "`r`nOMR_SERVICE_TOKEN=$token`r`n"
}
$envText = [regex]::Replace($envText, '(?m)^OMR_SERVICE_URL=.*\r?\n?', '')
$envText = $envText.TrimEnd() + "`r`nOMR_SERVICE_URL=http://127.0.0.1:8001`r`n"
[IO.File]::WriteAllText($envPath, $envText, (New-Object Text.UTF8Encoding($false)))

$managedNames = @('OMR_SERVICE_TOKEN', 'AUDIVERIS_BIN', 'PYTHONPATH', 'TESSDATA_PREFIX')
$previous = @{}
foreach ($name in $managedNames) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$owned = @()
try {
    $env:OMR_SERVICE_TOKEN = $token
    $env:AUDIVERIS_BIN = $AudiverisPath
    if (Test-Path -LiteralPath (Join-Path $projectRoot '.test-deps/fastapi')) {
        $env:PYTHONPATH = (Join-Path $projectRoot '.test-deps') + [IO.Path]::PathSeparator + $env:PYTHONPATH
    }
    $tessdata = Join-Path $projectRoot '.test-deps/audiveris/tessdata'
    if (Test-Path -LiteralPath (Join-Path $tessdata 'eng.traineddata')) { $env:TESSDATA_PREFIX = $tessdata }
    $service = Start-Process -FilePath $PythonPath -ArgumentList @('-m', 'uvicorn', 'app:app', '--app-dir', 'omr-service', '--host', '127.0.0.1', '--port', '8001') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'service.out.log') -RedirectStandardError (Join-Path $runtimeDir 'service.err.log') -PassThru
    $owned += @{ id = $service.Id; started = $service.StartTime.ToUniversalTime().ToString('o') }
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($service.HasExited) { throw 'OMR exited. See .local-omr/service.err.log.' }
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8001/health' -TimeoutSec 2
            if ($health.engine -eq 'Audiveris' -and $health.status -eq 'ok') { $healthy = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 1000
    }
    if (!$healthy) { throw 'The local Audiveris health check failed. See .local-omr/service.err.log.' }
    # Windows virtualenv launchers can keep a separate Python child listening.
    $listener = Get-NetTCPConnection -State Listen -LocalPort 8001 | Select-Object -First 1
    if ($listener.OwningProcess -ne $service.Id) {
        $worker = Get-Process -Id $listener.OwningProcess
        $owned += @{ id = $worker.Id; started = $worker.StartTime.ToUniversalTime().ToString('o') }
    }
    # The tunnel does not need the service token in its environment.
    [Environment]::SetEnvironmentVariable('OMR_SERVICE_TOKEN', $previous['OMR_SERVICE_TOKEN'], 'Process')
    $tunnel = Start-Process -FilePath $tunnelExe -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:8001', '--protocol', 'http2', '--no-autoupdate') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'tunnel.out.log') -RedirectStandardError (Join-Path $runtimeDir 'tunnel.err.log') -PassThru
    $owned += @{ id = $tunnel.Id; started = $tunnel.StartTime.ToUniversalTime().ToString('o') }
    $publicUrl = ''
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        if ($tunnel.HasExited) { throw 'Tunnel exited. See .local-omr/tunnel.err.log.' }
        $logs = [string](Get-Content -LiteralPath (Join-Path $runtimeDir 'tunnel.err.log') -Raw -ErrorAction SilentlyContinue)
        $urlMatch = [regex]::Match($logs, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($urlMatch.Success) { $publicUrl = $urlMatch.Value; break }
        Start-Sleep -Milliseconds 1000
    }
    if (!$publicUrl) { throw 'No tunnel URL was issued. See .local-omr/tunnel.err.log.' }
    $owned | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    $vercelPath = Join-Path $runtimeDir 'vercel.env'
    [IO.File]::WriteAllText($vercelPath, "OMR_SERVICE_URL=$publicUrl`r`nOMR_SERVICE_TOKEN=$token`r`n", (New-Object Text.UTF8Encoding($false)))
    Write-Output "OMR tunnel started: $publicUrl"
    Write-Output "Vercel settings are saved privately in $vercelPath"
    Write-Output 'Keep this PC awake. Restarting the tunnel changes its URL; update Vercel and redeploy.'
} catch {
    foreach ($entry in $owned) { Stop-Process -Id $entry.id -ErrorAction SilentlyContinue }
    throw
} finally {
    foreach ($name in $managedNames) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
