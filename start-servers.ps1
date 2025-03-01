# PowerShell script to start all servers

# Initialize service tracking
$global:servicesStarted = @{}
$global:processes = @()

# Function to verify Redis is running
function Test-RedisConnection {
    try {
        $result = wsl -d Ubuntu-24.04 -e redis-cli ping
        return $result -eq "PONG"
    }
    catch {
        return $false
    }
}

# Function to start a process in a new terminal window and track it
function Start-ProcessInNewWindow {
    param (
        [string]$Path,
        [string]$Arguments,
        [string]$WindowTitle,
        [string]$WorkingDirectory = $PWD
    )

    try {
        # Start the process and capture the process object
        $process = Start-Process "wt.exe" -ArgumentList "-w 0 new-tab --title `"$WindowTitle`" --tabColor `"#ffaa00`" -d `"$WorkingDirectory`" cmd.exe /k `"$Path $Arguments`"" -PassThru
        
        # Track the process
        if ($process) {
            $global:processes += $process
            Write-Host "$WindowTitle started successfully (PID: $($process.Id))" -ForegroundColor Green
            return $true
        }
        else {
            Write-Host "Failed to start $WindowTitle" -ForegroundColor Red
            return $false
        }
    }
    catch {
        Write-Host "Failed to start $WindowTitle : $_" -ForegroundColor Red
        return $false
    }
}

# Start Redis Server in WSL
Write-Host "Starting Redis Server in WSL..." -ForegroundColor Yellow
$redisStarted = $false

try {
    if (Test-RedisConnection) {
        Write-Host "Redis Server is already running and responding." -ForegroundColor Green
        $redisStarted = $true
    }
    else {
        Write-Host "Starting Redis Server using sudo..." -ForegroundColor Yellow
        wsl -d Ubuntu-24.04 -e bash -c "sudo service redis-server start"
        Start-Sleep -Seconds 4
        if (Test-RedisConnection) {
            Write-Host "Redis Server started successfully and is responding." -ForegroundColor Green
            $redisStarted = $true
        }
        else {
            throw "Redis Server started but is not responding to ping"
        }
    }
}
catch {
    Write-Host "Failed to start Redis Server: $_" -ForegroundColor Red
    exit 1
}

if (-not $redisStarted) {
    Write-Host "Cannot proceed without Redis Server running." -ForegroundColor Red
    exit 1
}

# Start QuasiPeer Server
Write-Host "`nStarting QuasiPeer Server..." -ForegroundColor Yellow
$quasiPeerPath = Join-Path $PWD "quasi-peer-system"
if (-not (Test-Path $quasiPeerPath)) {
    Write-Host "QuasiPeer directory not found at: $quasiPeerPath" -ForegroundColor Red
    exit 1
}
$global:servicesStarted["QuasiPeer"] = Start-ProcessInNewWindow "npm.cmd" "run dev" "QuasiPeer" $quasiPeerPath

# Start Prometheus
Write-Host "`nStarting Prometheus..." -ForegroundColor Yellow
$prometheusPath = "C:\Users\mysel\Downloads\prometheus-2.53.3.windows-amd64\prometheus-2.53.3.windows-amd64\prometheus.exe"
$configPath = Join-Path $PWD "quasi-peer-system\config\prometheus.yml"

if (-not (Test-Path $prometheusPath)) {
    Write-Host "Prometheus not found at: $prometheusPath" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $configPath)) {
    Write-Host "Prometheus config not found at: $configPath" -ForegroundColor Red
    exit 1
}
$global:servicesStarted["Prometheus"] = Start-ProcessInNewWindow $prometheusPath "--config.file=`"$configPath`"" "Prometheus" (Split-Path $prometheusPath)

# Start Webapp
Write-Host "`nStarting Webapp..." -ForegroundColor Yellow
$global:servicesStarted["Webapp"] = Start-ProcessInNewWindow "npm.cmd" "run dev" "Webapp" $PWD

# Start Signaling Server
Write-Host "`nStarting Signaling Server..." -ForegroundColor Yellow
$signalingPath = Join-Path $PWD "signaling-server"
if (-not (Test-Path $signalingPath)) {
    Write-Host "Signaling server directory not found at: $signalingPath" -ForegroundColor Red
    exit 1
}
$global:servicesStarted["SignalingServer"] = Start-ProcessInNewWindow "npm.cmd" "run dev" "SignalingServer" $signalingPath

# Check if all services started successfully
$failedServices = $global:servicesStarted.GetEnumerator() | Where-Object { -not $_.Value }
if ($failedServices.Count -gt 0) {
    Write-Host "`nSome services failed to start:" -ForegroundColor Red
    $failedServices | ForEach-Object { Write-Host "- $($_.Key)" -ForegroundColor Red }
    exit 1
}

Write-Host "`nAll services started successfully!" -ForegroundColor Green

# Show service URLs
Write-Host "`nServices running on:" -ForegroundColor Cyan
Write-Host "- Webapp: http://localhost:3000"
Write-Host "- QuasiPeer Server: http://localhost:3002"
Write-Host "- Prometheus: http://localhost:9090"
Write-Host "`nTo view Prometheus metrics:" -ForegroundColor Magenta
Write-Host "1. Open http://localhost:9090"
Write-Host "2. Click on 'Graph'"
Write-Host "3. Available metrics:"
Write-Host "   - quasi_peer_active_participants"
Write-Host "   - quasi_peer_cpu_usage"
Write-Host "   - quasi_peer_memory_usage"
Write-Host "   - quasi_peer_network_bandwidth"
Write-Host "   - quasi_peer_active_transcriptions"
Write-Host "   - quasi_peer_active_translations"
Write-Host "   - quasi_peer_error_rate"
Write-Host "`nPress Ctrl+C to stop all services"

# Handle Ctrl+C gracefully
try {
    while ($true) { Start-Sleep -Seconds 1 }
}
finally {
    Write-Host "`nStopping all services..." -ForegroundColor Yellow

    # Stop Redis first
    wsl -d Ubuntu-24.04 -e sh -c "sudo service redis-server stop"

    # Stop all tracked processes
    foreach ($proc in $global:processes) {
        try {
            if (!$proc.HasExited) {
                Write-Host "Stopping $($proc.Id) ($($proc.ProcessName))..."
                Stop-Process -Id $proc.Id -Force
            }
        }
        catch { }
    }

    Write-Host "All services stopped." -ForegroundColor Green
}
