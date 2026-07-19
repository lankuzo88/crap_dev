param(
    [string]$OutFile = "",
    [string]$OrderIdsFile = "",
    [datetime]$FromDate = (Get-Date).Date.AddDays(-14),
    [datetime]$ToDate = (Get-Date).Date,
    [string]$FilterText = "su",
    [string]$ConnectionString = "",
    [string]$FixturePath = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ListProcedure = "dbo.tblDonHang_DonHangDaNhan_SelectAllByTuNgayDenNgay"
$ProgressProcedure = "dbo.tblDonHang_SelectAll_CongDoanSanXuat_ByIdDonHang"

function Load-DotEnv {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($rawLine in [IO.File]::ReadAllLines($Path)) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { continue }
        $parts = $line.Split("=", 2)
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($key -and -not [Environment]::GetEnvironmentVariable($key, "Process")) {
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

function Normalize-Text {
    param([string]$Value)
    if (-not $Value) { return "" }
    $normalized = $Value.Normalize([Text.NormalizationForm]::FormD)
    $builder = New-Object System.Text.StringBuilder
    foreach ($ch in $normalized.ToCharArray()) {
        $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
        if ($category -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$builder.Append($ch)
        }
    }
    return $builder.ToString().Replace([string][char]0x0111, "d").Replace([string][char]0x0110, "D").ToLowerInvariant()
}

function Get-Field {
    param($Row, [string]$Name)
    if ($null -eq $Row) { return $null }
    if ($Row -is [System.Data.DataRow]) {
        if ($Row.Table.Columns.Contains($Name)) {
            $value = $Row[$Name]
            if ($value -eq [DBNull]::Value) { return $null }
            return $value
        }
        return $null
    }
    $property = $Row.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Format-KeyLabDateTime {
    param($Value)
    if ($null -eq $Value -or $Value -eq [DBNull]::Value -or -not [string]$Value) { return "" }
    if ($Value -is [datetime]) { return $Value.ToString("dd/MM/yyyy HH:mm:ss") }
    try {
        $parsed = [DateTimeOffset]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture)
        return $parsed.ToOffset([TimeSpan]::FromHours(7)).ToString("dd/MM/yyyy HH:mm:ss")
    } catch {
        try { return ([datetime]$Value).ToString("dd/MM/yyyy HH:mm:ss") } catch { return "" }
    }
}

function Date-SortValue {
    param($Value)
    if ($null -eq $Value -or -not [string]$Value) { return [datetime]::MinValue }
    if ($Value -is [datetime]) { return [datetime]$Value }
    try { return [DateTimeOffset]::Parse([string]$Value).UtcDateTime } catch { return [datetime]::MinValue }
}

function Read-KeyLabListRows {
    param([System.Data.SqlClient.SqlConnection]$SqlConnection)
    $cmd = $SqlConnection.CreateCommand()
    $cmd.CommandText = "EXEC $ListProcedure @TuNgay=@TuNgay, @DenNgay=@DenNgay, @loaidonhang=0"
    $cmd.CommandTimeout = 60
    [void]$cmd.Parameters.Add("@TuNgay", [System.Data.SqlDbType]::Date)
    [void]$cmd.Parameters.Add("@DenNgay", [System.Data.SqlDbType]::Date)
    $cmd.Parameters["@TuNgay"].Value = $FromDate.Date
    $cmd.Parameters["@DenNgay"].Value = $ToDate.Date
    $table = New-Object System.Data.DataTable
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    [void]$adapter.Fill($table)
    return @($table.Rows)
}

function Read-KeyLabProgressRows {
    param(
        [System.Data.SqlClient.SqlConnection]$SqlConnection,
        [string]$InternalOrderId
    )
    $cmd = $SqlConnection.CreateCommand()
    $cmd.CommandText = "EXEC $ProgressProcedure @idonhang=@idonhang"
    $cmd.CommandTimeout = 30
    [void]$cmd.Parameters.Add("@idonhang", [System.Data.SqlDbType]::VarChar, 30)
    $cmd.Parameters["@idonhang"].Value = $InternalOrderId
    $table = New-Object System.Data.DataTable
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    [void]$adapter.Fill($table)
    return @($table.Rows)
}

function Read-KeyLabOrderRowsByExternalId {
    param(
        [System.Data.SqlClient.SqlConnection]$SqlConnection,
        [string]$OrderId
    )
    $cmd = $SqlConnection.CreateCommand()
    $cmd.CommandText = "EXEC dbo.tblDonHang_DonHangDaNhan_SelectAllByIDDonHang_SoPhieu @madonhangcuauser=@madonhangcuauser"
    $cmd.CommandTimeout = 30
    [void]$cmd.Parameters.Add("@madonhangcuauser", [System.Data.SqlDbType]::VarChar, 30)
    $cmd.Parameters["@madonhangcuauser"].Value = $OrderId
    $table = New-Object System.Data.DataTable
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    [void]$adapter.Fill($table)
    return @($table.Rows)
}

function Read-RequestedOrderIds {
    if (-not $OrderIdsFile) { return @() }
    if (-not (Test-Path -LiteralPath $OrderIdsFile)) { throw "Order IDs file not found" }
    $payload = Get-Content -LiteralPath $OrderIdsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    return @($payload | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ } | Select-Object -Unique)
}

function Select-Orders {
    param([object[]]$ListRows, [string[]]$RequestedOrderIds)
    $requested = @{}
    foreach ($id in $RequestedOrderIds) { $requested[$id] = $true }
    $needle = Normalize-Text $FilterText
    $groups = [ordered]@{}

    foreach ($row in $ListRows) {
        if ([string](Get-Field $row "giaothucte")) { continue }
        $maDh = ([string](Get-Field $row "madonhangcuauser")).Trim()
        $internalId = ([string](Get-Field $row "iddonhang")).Trim()
        if (-not $maDh -or -not $internalId) { continue }
        if ($requested.Count -and -not $requested.ContainsKey($maDh)) { continue }
        if (-not $groups.Contains($maDh)) {
            $groups[$maDh] = [pscustomobject]@{
                ma_dh = $maDh
                internal_id = $internalId
                parts = New-Object System.Collections.Generic.List[object]
            }
        }
        [void]$groups[$maDh].parts.Add($row)
    }

    $orders = @($groups.Values)
    if (-not $requested.Count -and $needle) {
        $orders = @($orders | Where-Object {
            $text = ($_.parts | ForEach-Object { [string](Get-Field $_ "sanpham") }) -join " "
            (Normalize-Text $text).Contains($needle)
        })
    }
    return $orders
}

function Build-RawRowText {
    param($ProgressRow, [object[]]$OrderParts)
    $partId = ([string](Get-Field $ProgressRow "idchitietdonhang")).Trim()
    $part = $OrderParts | Where-Object { ([string](Get-Field $_ "idchitietdonhang")).Trim() -eq $partId } | Select-Object -First 1
    $sanPham = [string](Get-Field $ProgressRow "sanpham")
    $rang = [string](Get-Field $ProgressRow "rang")
    $soLuong = Get-Field $ProgressRow "soluong"
    $loaiSanPham = [string](Get-Field $ProgressRow "loaisanpham")
    if ($part) {
        if (-not $sanPham) { $sanPham = [string](Get-Field $part "sanpham") }
        if (-not $rang) { $rang = [string](Get-Field $part "rang") }
        if ($null -eq $soLuong -or -not [string]$soLuong) { $soLuong = Get-Field $part "soluong" }
        if (-not $loaiSanPham) { $loaiSanPham = [string](Get-Field $part "loaisanpham") }
    }
    return "$($sanPham.Trim()) SL:$soLuong Rang:$($rang.Trim()) $($loaiSanPham.Trim())".Trim()
}

function Convert-OrderProgress {
    param($Order, [object[]]$ProgressRows)
    if (-not $ProgressRows.Count) { throw "KeyLab returned no progress rows for $($Order.ma_dh)" }
    $result = New-Object System.Collections.Generic.List[object]
    $stageGroups = $ProgressRows | Group-Object { [int](Get-Field $_ "thutulam") }
    foreach ($group in $stageGroups | Sort-Object { [int]$_.Name }) {
        $candidates = @($group.Group)
        $started = @($candidates | Where-Object { Format-KeyLabDateTime (Get-Field $_ "thoigianbatdau") })
        if ($started.Count) {
            $selected = $started | Sort-Object { Date-SortValue (Get-Field $_ "thoigianbatdau") } -Descending | Select-Object -First 1
        } else {
            $selected = $candidates | Sort-Object { [string](Get-Field $_ "idchitietdonhang") } | Select-Object -First 1
        }
        $time = Format-KeyLabDateTime (Get-Field $selected "thoigianbatdau")
        $ktv = ([string](Get-Field $selected "nhanvien")).Trim()
        if (-not $ktv) { $ktv = ([string](Get-Field $selected "tennhanvien")).Trim() }
        if (-not $ktv) { $ktv = "-" }
        $orderParts = @($Order.parts | ForEach-Object { $_ })
        [void]$result.Add([pscustomobject][ordered]@{
            ma_dh = $Order.ma_dh
            thu_tu = [int](Get-Field $selected "thutulam")
            cong_doan = ([string](Get-Field $selected "congdoan")).Trim()
            ten_ktv = $ktv
            xac_nhan = $(if ($time) { "C$([char]0x00F3)" } else { "Ch$([char]0x01B0)a" })
            thoi_gian_hoan_thanh = $time
            raw_row_text = Build-RawRowText -ProgressRow $selected -OrderParts $orderParts
            tai_khoan_cao = "keylab_sql"
            barcode_labo = ""
        })
    }
    return $result | ForEach-Object { $_ }
}

$requestedIds = Read-RequestedOrderIds
$sqlConnection = $null
try {
    if ($FixturePath) {
        $fixture = Get-Content -LiteralPath $FixturePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $listRows = @($fixture.list_rows)
    } else {
        Load-DotEnv -Path (Join-Path $BaseDir ".env")
        $resolvedConnection = if ($ConnectionString) { $ConnectionString } else { $env:KEYLAB_SQL_CONNECTION }
        if (-not $resolvedConnection) { throw "KEYLAB_SQL_CONNECTION is not configured" }
        if ($resolvedConnection -notmatch "Connect Timeout") { $resolvedConnection = "$resolvedConnection;Connect Timeout=10" }
        $sqlConnection = New-Object System.Data.SqlClient.SqlConnection($resolvedConnection)
        $sqlConnection.Open()
        $listRows = Read-KeyLabListRows -SqlConnection $sqlConnection
    }

    $orders = @(Select-Orders -ListRows $listRows -RequestedOrderIds $requestedIds)
    if ($requestedIds.Count) {
        $selectedIds = @{}
        foreach ($order in $orders) { $selectedIds[$order.ma_dh] = $true }
        $missingIds = @($requestedIds | Where-Object { -not $selectedIds.ContainsKey($_) })
        if ($FixturePath -and $missingIds.Count) {
            throw "KeyLab list is missing requested order(s): $($missingIds -join ', ')"
        }
        foreach ($missingId in $missingIds) {
            $directRows = @(Read-KeyLabOrderRowsByExternalId -SqlConnection $sqlConnection -OrderId $missingId)
            if (-not $directRows.Count) { continue }
            $internalId = ([string](Get-Field $directRows[0] "iddonhang")).Trim()
            if (-not $internalId) { continue }
            $orders += [pscustomobject]@{
                ma_dh = $missingId
                internal_id = $internalId
                parts = $directRows
            }
            $selectedIds[$missingId] = $true
        }
        $stillMissing = @($requestedIds | Where-Object { -not $selectedIds.ContainsKey($_) })
        if ($stillMissing.Count) {
            throw "KeyLab could not resolve requested order(s): $($stillMissing -join ', ')"
        }
    }
    if (-not $orders.Count) { throw "KeyLab returned no matching active orders" }
    $outputRows = New-Object System.Collections.Generic.List[object]
    foreach ($order in $orders) {
        if ($FixturePath) {
            $property = $fixture.progress_by_internal_order.PSObject.Properties[$order.internal_id]
            if ($null -eq $property) { throw "Fixture has no progress rows for $($order.ma_dh)" }
            $progressRows = @($property.Value)
        } else {
            $progressRows = @(Read-KeyLabProgressRows -SqlConnection $sqlConnection -InternalOrderId $order.internal_id)
        }
        foreach ($row in @(Convert-OrderProgress -Order $order -ProgressRows $progressRows)) {
            [void]$outputRows.Add($row)
        }
    }

    $sortedRows = @($outputRows | Sort-Object ma_dh, thu_tu)
    if ($DryRun) {
        [pscustomobject][ordered]@{
            source = "keylab_sql"
            orders = $orders.Count
            stages = $sortedRows.Count
            rows = $sortedRows
        } | ConvertTo-Json -Depth 7
    } else {
        if (-not $OutFile) { throw "OutFile is required unless DryRun is used" }
        $parent = Split-Path -Parent $OutFile
        if ($parent -and -not (Test-Path -LiteralPath $parent)) { [void](New-Item -ItemType Directory -Path $parent) }
        $tempPath = "$OutFile.tmp-$PID"
        try {
            $json = ConvertTo-Json -InputObject $sortedRows -Depth 7
            [IO.File]::WriteAllText($tempPath, $json, (New-Object System.Text.UTF8Encoding($false)))
            Move-Item -LiteralPath $tempPath -Destination $OutFile -Force
        } finally {
            if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
        }
        Write-Output "SAVED:$OutFile"
        Write-Output "ORDERS:$($orders.Count)"
        Write-Output "STAGES:$($sortedRows.Count)"
    }
} finally {
    if ($sqlConnection) { $sqlConnection.Close() }
}
