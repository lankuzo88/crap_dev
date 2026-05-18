param(
    [string[]]$OrderIds = @(),
    [string]$OrderFile = "",
    [string]$OutFile = "",
    [string]$KeyLabExePath = "",
    [string]$ConnectionString = "",
    [int]$Limit = 0,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProcedureName = "dbo.tblDonHang_DonHangDaNhan_SelectAllByIDDonHang_SoPhieu"

function Load-DotEnv {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    foreach ($rawLine in [IO.File]::ReadAllLines($Path)) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            continue
        }
        $parts = $line.Split("=", 2)
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($key -and -not [Environment]::GetEnvironmentVariable($key, "Process")) {
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

function Get-PrintableStrings {
    param([byte[]]$Bytes, [Text.Encoding]$Encoding)
    $text = $Encoding.GetString($Bytes)
    return [regex]::Matches($text, "[\x20-\x7E]{8,}") | ForEach-Object { $_.Value }
}

function Resolve-KeyLabConnection {
    param(
        [string]$ExplicitConnection,
        [string]$ExplicitExePath
    )

    if ($ExplicitConnection) {
        return $ExplicitConnection
    }
    if ($env:KEYLAB_SQL_CONNECTION) {
        return $env:KEYLAB_SQL_CONNECTION
    }

    $exePath = $ExplicitExePath
    if (-not $exePath) {
        $exePath = $env:KEYLAB_EXE_PATH
    }
    if (-not $exePath) {
        $exePath = "C:\Users\Administrator\Desktop\New folder\Dentallab\KeyLab2022Pro_LABO_ASIA_BINHTAN_HCM\KeyLab2022Pro.exe"
    }
    if (-not (Test-Path -LiteralPath $exePath)) {
        throw "KeyLab exe not found. Set KEYLAB_EXE_PATH or KEYLAB_SQL_CONNECTION."
    }

    $bytes = [IO.File]::ReadAllBytes($exePath)
    $strings = @()
    $strings += Get-PrintableStrings -Bytes $bytes -Encoding ([Text.Encoding]::GetEncoding(28591))
    $strings += Get-PrintableStrings -Bytes $bytes -Encoding ([Text.Encoding]::Unicode)
    $conn = $strings |
        Where-Object { $_ -like "Data Source=*Initial Catalog*User Id*Password*" } |
        Select-Object -First 1

    if (-not $conn) {
        throw "KeyLab SQL connection string was not found in the exe."
    }
    return $conn
}

function Get-OrderIds {
    $ids = New-Object System.Collections.Generic.List[string]
    foreach ($id in $OrderIds) {
        if ($id) {
            [void]$ids.Add($id)
        }
    }
    if ($OrderFile) {
        if (-not (Test-Path -LiteralPath $OrderFile)) {
            throw "Order file not found: $OrderFile"
        }
        foreach ($line in [IO.File]::ReadAllLines($OrderFile)) {
            if ($line) {
                [void]$ids.Add($line)
            }
        }
    }

    $unique = $ids |
        ForEach-Object { [string]$_ } |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ } |
        Select-Object -Unique

    if ($Limit -gt 0) {
        $unique = $unique | Select-Object -First $Limit
    }
    return @($unique)
}

function Read-KeyLabNote {
    param(
        [System.Data.SqlClient.SqlConnection]$SqlConnection,
        [string]$OrderId
    )

    $cmd = $SqlConnection.CreateCommand()
    $cmd.CommandText = "EXEC $ProcedureName @madonhangcuauser=@madonhangcuauser"
    $cmd.CommandTimeout = 30
    $param = $cmd.Parameters.Add("@madonhangcuauser", [System.Data.SqlDbType]::VarChar, 30)
    $param.Value = $OrderId

    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)

    $notes = New-Object System.Collections.Generic.List[string]
    foreach ($row in $table.Rows) {
        if (-not $table.Columns.Contains("ghichusanxuat")) {
            continue
        }
        $note = [string]$row["ghichusanxuat"]
        $note = $note.Trim()
        if ($note -and -not $notes.Contains($note)) {
            [void]$notes.Add($note)
        }
    }

    if ($notes.Count -eq 0) {
        return $null
    }

    return [pscustomobject]@{
        ma_dh = $OrderId
        ghi_chu_sx = ($notes -join "`r`n")
        keylab_rows = $table.Rows.Count
    }
}

Load-DotEnv -Path (Join-Path $BaseDir ".env")
if (-not $OutFile) {
    $OutFile = Join-Path $BaseDir "keylab_notes.json"
}

$ordersToRead = Get-OrderIds
if ($ordersToRead.Count -eq 0) {
    throw "No order ids were provided."
}

$connString = Resolve-KeyLabConnection -ExplicitConnection $ConnectionString -ExplicitExePath $KeyLabExePath
if ($connString -notmatch "Connect Timeout") {
    $connString = "$connString;Connect Timeout=10"
}

$sqlConn = New-Object System.Data.SqlClient.SqlConnection($connString)
$orders = @()
$errorItems = @()

try {
    $sqlConn.Open()
    foreach ($orderId in $ordersToRead) {
        try {
            $note = Read-KeyLabNote -SqlConnection $sqlConn -OrderId $orderId
            if ($note) {
                $orders += $note
            }
        } catch {
            $errorItems += [pscustomobject]@{
                ma_dh = $orderId
                error = $_.Exception.Message
            }
        }
    }
} finally {
    $sqlConn.Close()
}

$payload = [pscustomobject]@{
    scraped_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    source = "keylab_sql"
    procedure = $ProcedureName
    total = $ordersToRead.Count
    matched = $orders.Count
    errors = $errorItems.Count
    orders = $orders
}

if ($errorItems.Count -gt 0) {
    $payload | Add-Member -NotePropertyName "error_items" -NotePropertyValue @($errorItems)
}

$json = $payload | ConvertTo-Json -Depth 8
if ($DryRun) {
    $json
} else {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
    Write-Output "KeyLab SQL notes written: $OutFile ($($orders.Count)/$($ordersToRead.Count) matched, $($errorItems.Count) errors)"
}
