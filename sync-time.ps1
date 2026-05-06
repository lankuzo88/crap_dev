# Sync Windows time using w32tm command
# Scheduled to run every hour

Write-Host "[TIME] Syncing Windows time..."

try {
    # Try to sync with w32tm
    $result = w32tm /resync /force 2>&1
    Write-Host "[TIME] w32tm output: $result"

    if ($result -match "successfully|success|OK|Synchronization") {
        Write-Host "[TIME] SUCCESS - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        exit 0
    }
} catch {
    Write-Host "[TIME] w32tm failed, trying net time..."
}

# Fallback: try net time with NTP server
try {
    $servers = @('time.google.com', 'time.cloudflare.com', 'pool.ntp.org')

    foreach ($server in $servers) {
        Write-Host "[TIME] Trying net time /setsntp:$server..."
        net time /setsntp:$server | Out-Null

        $output = net time /querysntp 2>&1
        if ($output) {
            Write-Host "[TIME] SUCCESS - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
            exit 0
        }
    }
} catch {
    Write-Host "[TIME] net time failed: $_"
}

Write-Host "[TIME] Could not sync - check network connectivity" -ForegroundColor Yellow
exit 1
