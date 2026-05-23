param(
    [string]$OutFile = "",
    [datetime]$FromDate = (Get-Date).Date.AddDays(-14),
    [datetime]$ToDate = (Get-Date).Date,
    [string]$FilterText = "su",
    [string]$KeyLabExePath = "",
    [string]$ConnectionString = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExcelDir = Join-Path $BaseDir "Excel"
$ProcedureName = "dbo.tblDonHang_DonHangDaNhan_SelectAllByTuNgayDenNgay"

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

function Format-KeyLabDate {
    param($Value)
    if ($null -eq $Value -or $Value -eq [DBNull]::Value) {
        return ""
    }
    try {
        return ([datetime]$Value).ToString("dd/MM/yyyy HH:mm")
    } catch {
        return [string]$Value
    }
}

function Normalize-Text {
    param([string]$Value)
    if (-not $Value) {
        return ""
    }
    $normalized = $Value.Normalize([Text.NormalizationForm]::FormD)
    $builder = New-Object System.Text.StringBuilder
    foreach ($ch in $normalized.ToCharArray()) {
        $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
        if ($category -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$builder.Append($ch)
        }
    }
    return $builder.ToString().ToLowerInvariant()
}

function Read-KeyLabRows {
    param(
        [System.Data.SqlClient.SqlConnection]$SqlConnection,
        [datetime]$StartDate,
        [datetime]$EndDate
    )

    $cmd = $SqlConnection.CreateCommand()
    $cmd.CommandText = "EXEC $ProcedureName @TuNgay=@TuNgay, @DenNgay=@DenNgay, @loaidonhang=0"
    $cmd.CommandTimeout = 60
    [void]$cmd.Parameters.Add("@TuNgay", [System.Data.SqlDbType]::Date)
    [void]$cmd.Parameters.Add("@DenNgay", [System.Data.SqlDbType]::Date)
    $cmd.Parameters["@TuNgay"].Value = $StartDate.Date
    $cmd.Parameters["@DenNgay"].Value = $EndDate.Date

    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)
    return ,$table
}

function Read-OrderHeader {
    param(
        [System.Data.SqlClient.SqlConnection]$SqlConnection,
        [string]$OrderId
    )

    $cmd = $SqlConnection.CreateCommand()
    $cmd.CommandText = "EXEC dbo.tblDonHang_SelectAllByIDDonHang_SoPhieu @madonhangcuauser=@madonhangcuauser"
    $cmd.CommandTimeout = 30
    [void]$cmd.Parameters.Add("@madonhangcuauser", [System.Data.SqlDbType]::VarChar, 30)
    $cmd.Parameters["@madonhangcuauser"].Value = $OrderId
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)
    if ($table.Rows.Count -eq 0) {
        return $null
    }
    return $table.Rows[0]
}

function Add-OrderHeaderFields {
    param(
        [System.Data.SqlClient.SqlConnection]$SqlConnection,
        [object[]]$Orders
    )

    foreach ($order in $Orders) {
        try {
            $header = Read-OrderHeader -SqlConnection $SqlConnection -OrderId $order.ma_dh
            if (-not $header) {
                continue
            }
            if ($header.Table.Columns.Contains("hoanthanh")) {
                $order.yc_hoan_thanh = Format-KeyLabDate $header["hoanthanh"]
            }
            if ($header.Table.Columns.Contains("gionhan")) {
                $order.nhan_luc = Format-KeyLabDate $header["gionhan"]
            }
            if ($header.Table.Columns.Contains("hengiao")) {
                $order.yc_giao = Format-KeyLabDate $header["hengiao"]
            }
            if ($header.Table.Columns.Contains("nhakhoa")) {
                $order.khach_hang = [string]$header["nhakhoa"]
            }
            if ($header.Table.Columns.Contains("tenbenhnhan")) {
                $order.benh_nhan = [string]$header["tenbenhnhan"]
            }
            if ($header.Table.Columns.Contains("trangthai")) {
                $order.trang_thai = [string]$header["trangthai"]
            }
            if ($header.Table.Columns.Contains("ghichuchodieuphoi")) {
                $order.ghi_chu_dieu_phoi = [string]$header["ghichuchodieuphoi"]
            }
        } catch {
            Write-Warning "Header lookup failed for $($order.ma_dh): $($_.Exception.Message)"
        }
    }
    return $Orders
}

function Convert-ToExportOrders {
    param(
        [System.Data.DataTable]$Table,
        [string]$Needle
    )

    $groups = [ordered]@{}
    foreach ($row in $Table.Rows) {
        if ($Table.Columns.Contains("giaothucte") -and $row["giaothucte"] -ne [DBNull]::Value -and [string]$row["giaothucte"]) {
            continue
        }
        $ma = ([string]$row["madonhangcuauser"]).Trim()
        if (-not $ma) {
            continue
        }

        if (-not $groups.Contains($ma)) {
            $groups[$ma] = [ordered]@{
                ma_dh = $ma
                nhan_luc = $row["gionhan"]
                yc_hoan_thanh = $row["hoanthanh"]
                yc_giao = $row["hengiao"]
                khach_hang = [string]$row["nhakhoa"]
                benh_nhan = [string]$row["tenbenhnhan"]
                ghi_chu = ""
                trang_thai = ""
                parts = New-Object System.Collections.Generic.List[string]
                sort_time = $row["hengiao"]
            }
        }

        $part = ([string]$row["sanpham"]).Trim()
        $rang = ([string]$row["rang"]).Trim().TrimEnd(",").Trim()
        $sl = [string]$row["soluong"]
        if ($part) {
            if ($rang -or $sl) {
                $detail = "$part ("
                if ($rang) {
                    $detail += "R:$rang"
                }
                if ($sl) {
                    if ($rang) {
                        $detail += ", "
                    }
                    $detail += "- SL: $sl"
                }
                $detail += ")"
            } else {
                $detail = $part
            }
            if (-not $groups[$ma].parts.Contains($detail)) {
                [void]$groups[$ma].parts.Add($detail)
            }
        }

        # Do not map ghichusanxuat here. Production notes are synced separately
        # into don_hang.ghi_chu_sx; this export column is only for dispatch notes.
    }

    $needleLower = Normalize-Text $Needle
    $orders = @()
    foreach ($entry in $groups.GetEnumerator()) {
        $item = $entry.Value
        $phucHinh = ($item.parts -join "; `r`n")
        if ($needleLower -and -not (Normalize-Text $phucHinh).Contains($needleLower)) {
            continue
        }
        $orders += [pscustomobject]@{
            in_bill = ""
            checked = "FALSE"
            ma_dh = $item.ma_dh
            nhan_luc = Format-KeyLabDate $item.nhan_luc
            yc_hoan_thanh = Format-KeyLabDate $item.yc_hoan_thanh
            yc_giao = Format-KeyLabDate $item.yc_giao
            khach_hang = $item.khach_hang
            benh_nhan = $item.benh_nhan
            phuc_hinh = $phucHinh
            ghi_chu_dieu_phoi = $item.ghi_chu
            trang_thai = $item.trang_thai
            dong_goi = ""
            huy_dong_goi = ""
            sort_time = $item.sort_time
        }
    }

    return @($orders | Sort-Object @{ Expression = { $_.sort_time } }, @{ Expression = { $_.ma_dh } })
}

function Export-OrdersToExcel {
    param(
        [object[]]$Orders,
        [string]$Path
    )

    $xlsx = Join-Path $BaseDir "node_modules\xlsx\xlsx.js"
    if (-not (Test-Path -LiteralPath $xlsx)) {
        throw "Node xlsx package is not available."
    }

    $tempJson = [IO.Path]::GetTempFileName()
    try {
        $cleanOrders = $Orders | ForEach-Object {
            [pscustomobject]@{
                in_bill = $_.in_bill
                checked = $_.checked
                ma_dh = $_.ma_dh
                nhan_luc = $_.nhan_luc
                yc_hoan_thanh = $_.yc_hoan_thanh
                yc_giao = $_.yc_giao
                khach_hang = $_.khach_hang
                benh_nhan = $_.benh_nhan
                phuc_hinh = $_.phuc_hinh
                ghi_chu_dieu_phoi = $_.ghi_chu_dieu_phoi
                trang_thai = $_.trang_thai
                dong_goi = $_.dong_goi
                huy_dong_goi = $_.huy_dong_goi
            }
        }
        $json = $cleanOrders | ConvertTo-Json -Depth 5
        [IO.File]::WriteAllText($tempJson, $json, (New-Object System.Text.UTF8Encoding($false)))

        $nodeCode = @"
const fs = require('fs');
const XLSX = require('xlsx');
const rows = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const out = process.argv[2];
const headers = [
  'In Bill',
  '',
  'M\u00e3 \u0110H',
  'Nh\u1eadn l\u00fac',
  'Y/c ho\u00e0n th\u00e0nh',
  'Y/c giao',
  'Kh\u00e1ch h\u00e0ng',
  'B\u1ec7nh nh\u00e2n',
  'Ph\u1ee5c h\u00ecnh',
  'Ghi ch\u00fa \u0111i\u1ec1u ph\u1ed1i',
  'Tr\u1ea1ng th\u00e1i',
  '\u0110\u00f3ng g\u00f3i',
  'H\u1ee7y \u0111\u00f3ng g\u00f3i'
];
const data = [headers].concat(rows.map(r => [
  r.in_bill || '',
  r.checked || 'FALSE',
  r.ma_dh || '',
  r.nhan_luc || '',
  r.yc_hoan_thanh || '',
  r.yc_giao || '',
  r.khach_hang || '',
  r.benh_nhan || '',
  r.phuc_hinh || '',
  r.ghi_chu_dieu_phoi || '',
  r.trang_thai || '',
  r.dong_goi || '',
  r.huy_dong_goi || ''
]));
const ws = XLSX.utils.aoa_to_sheet(data);
ws['!cols'] = [
  {wch: 8}, {wch: 8}, {wch: 14}, {wch: 18}, {wch: 18}, {wch: 18}, {wch: 28},
  {wch: 22}, {wch: 55}, {wch: 35}, {wch: 14}, {wch: 12}, {wch: 12}
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet');
XLSX.writeFile(wb, out, { bookType: 'xlsx' });
"@
        & node -e $nodeCode $tempJson $Path
        if ($LASTEXITCODE -ne 0) {
            throw "node xlsx export failed with code $LASTEXITCODE"
        }
    } finally {
        Remove-Item -LiteralPath $tempJson -ErrorAction SilentlyContinue
    }
}

function Get-VietnamNow {
    try {
        $tz = [TimeZoneInfo]::FindSystemTimeZoneById("SE Asia Standard Time")
    } catch {
        try {
            $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Asia/Ho_Chi_Minh")
        } catch {
            return (Get-Date).ToUniversalTime().AddHours(7)
        }
    }
    return [TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz)
}

Load-DotEnv -Path (Join-Path $BaseDir ".env")
if (-not (Test-Path -LiteralPath $ExcelDir)) {
    New-Item -ItemType Directory -Path $ExcelDir | Out-Null
}
if (-not $OutFile) {
    $name = (Get-VietnamNow).ToString("ddMMyyyy_HHmmss") + "_sql.xlsx"
    $OutFile = Join-Path $ExcelDir $name
}

$connString = Resolve-KeyLabConnection -ExplicitConnection $ConnectionString -ExplicitExePath $KeyLabExePath
if ($connString -notmatch "Connect Timeout") {
    $connString = "$connString;Connect Timeout=10"
}

$sqlConn = New-Object System.Data.SqlClient.SqlConnection($connString)
try {
    $sqlConn.Open()
    $table = Read-KeyLabRows -SqlConnection $sqlConn -StartDate $FromDate -EndDate $ToDate
    $orders = Convert-ToExportOrders -Table $table -Needle $FilterText
    $orders = Add-OrderHeaderFields -SqlConnection $sqlConn -Orders $orders
} finally {
    $sqlConn.Close()
}

if ($DryRun) {
    [pscustomobject]@{
        source = "keylab_sql_export"
        procedure = $ProcedureName
        from = $FromDate.ToString("yyyy-MM-dd")
        to = $ToDate.ToString("yyyy-MM-dd")
        filter = $FilterText
        detail_rows = $table.Rows.Count
        orders = $orders.Count
        sample = @($orders | Select-Object -First 5)
    } | ConvertTo-Json -Depth 6
} else {
    Export-OrdersToExcel -Orders $orders -Path $OutFile
    Write-Output "SAVED:$OutFile"
    Write-Output "ROWS:$($orders.Count)"
}
