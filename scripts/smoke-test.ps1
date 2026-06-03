# Pre-merge smoke test for ASIA LAB dashboard
# Run from repo root: powershell -File scripts\smoke-test.ps1
# Exit code: 0 = all passed, 1 = at least one check failed.

param(
  [switch]$SkipRuntime,   # bỏ qua các check cần server đang chạy
  [switch]$NoColor
)

$ErrorActionPreference = 'Continue'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

$script:failures = @()
$script:warnings = @()

function W-Info($msg)  { if ($NoColor) { Write-Host "[..] $msg" } else { Write-Host "[..] " -NoNewline -ForegroundColor DarkGray; Write-Host $msg } }
function W-Ok($msg)    { if ($NoColor) { Write-Host "[OK] $msg" } else { Write-Host "[OK] " -NoNewline -ForegroundColor Green;    Write-Host $msg } }
function W-Fail($msg)  { if ($NoColor) { Write-Host "[FAIL] $msg" } else { Write-Host "[FAIL] " -NoNewline -ForegroundColor Red;  Write-Host $msg } }
function W-Warn($msg)  { if ($NoColor) { Write-Host "[WARN] $msg" } else { Write-Host "[WARN] " -NoNewline -ForegroundColor Yellow; Write-Host $msg } }

function Run-Check {
  param([string]$Name, [scriptblock]$Block)
  W-Info $Name
  $global:LASTEXITCODE = 0
  try {
    & $Block | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "exit $LASTEXITCODE"
    }
    W-Ok $Name
  } catch {
    W-Fail "$Name :: $_"
    $script:failures += $Name
  }
}

Write-Host "ASIA LAB smoke test ($(Get-Date -Format 'HH:mm:ss'))"
Write-Host "Repo: $RepoRoot`n"

# --- STATIC CHECKS -------------------------------------------------------

Run-Check 'HTML inline <script> parse' {
  $htmlFiles = @(
    'dashboard.html',
    'dashboard_mobile_terracotta.html',
    'admin.html',
    'login.html',
    'feedback.html'
  ) | Where-Object { Test-Path $_ }
  if ($htmlFiles.Count -eq 0) { throw 'no HTML files found' }
  node 'scripts/html-parse-check.js' @htmlFiles
  if ($LASTEXITCODE -ne 0) { throw "node parse exit $LASTEXITCODE" }
}

Run-Check 'node --check on src/**/*.js' {
  $jsFiles = Get-ChildItem -Path 'src' -Filter '*.js' -Recurse -ErrorAction SilentlyContinue
  if (-not $jsFiles) { W-Warn 'no .js under src/ — skip'; return }
  foreach ($f in $jsFiles) {
    node --check $f.FullName 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$($f.Name) failed node --check" }
  }
}

Run-Check 'node --check on root server.js' {
  if (-not (Test-Path 'server.js')) { W-Warn 'no server.js — skip'; return }
  node --check 'server.js' 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'server.js failed node --check' }
}

Run-Check 'python -m py_compile on changed .py' {
  $pyFiles = @('auto_scrape_headless.py', 'db_manager.py', 'keylab_exporter.py') | Where-Object { Test-Path $_ }
  if ($pyFiles.Count -eq 0) { W-Warn 'no .py files — skip'; return }
  python -m py_compile @pyFiles
  if ($LASTEXITCODE -ne 0) { throw 'python syntax error' }
}

# --- RUNTIME CHECKS ------------------------------------------------------

if ($SkipRuntime) {
  Write-Host "`n(runtime checks skipped via -SkipRuntime)"
} else {

Run-Check 'PM2 asia-lab-server online' {
  # Pipe qua node để parse JSON (PowerShell ConvertFrom-Json fail trên env có key trùng case).
  # PowerShell pipe chèn BOM U+FEFF vào đầu stream → strip bằng escape ASCII-pure.
  $countScript = "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s.replace(/^\uFEFF/,''));process.stdout.write(String(j.filter(p=>p.name==='asia-lab-server'&&p.pm2_env&&p.pm2_env.status==='online').length))})"
  $online = (pm2 jlist 2>$null | node -e $countScript) 2>$null
  if ([int]$online -lt 1) { throw "no online asia-lab-server (saw $online)" }
}

Run-Check 'HTTP /status responds' {
  $code = curl.exe -sS -o NUL -w "%{http_code}" --max-time 5 'http://localhost:3000/status' 2>$null
  if ($code -notmatch '^(200|302|401)$') { throw "got HTTP $code" }
}

Run-Check 'DB freshness (Excel mtime + import_log sync)' {
  if (-not (Test-Path 'labo_data.db')) { W-Warn 'no labo_data.db - skip'; return }
  python 'scripts/db-freshness-check.py'
  if ($LASTEXITCODE -ne 0) { throw 'DB stale or out of sync with newest Excel' }
}

Run-Check 'auto-scrape log mtime < 30 min' {
  $log = 'auto_scrape.log'
  if (-not (Test-Path $log)) { W-Warn 'no auto_scrape.log — skip'; return }
  $age = (Get-Date) - (Get-Item $log).LastWriteTime
  if ($age.TotalMinutes -gt 30) {
    throw "log untouched for $([int]$age.TotalMinutes) min - scraper may be stuck"
  }
}

} # end runtime block

# --- SUMMARY -------------------------------------------------------------

Write-Host ''
if ($script:failures.Count -eq 0) {
  W-Ok "ALL PASSED ($((Get-Date).ToString('HH:mm:ss')))"
  exit 0
} else {
  W-Fail "FAILED: $($script:failures.Count) check(s)"
  $script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
