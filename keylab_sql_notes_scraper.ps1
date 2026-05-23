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
$HeaderProcedureName = "dbo.tblDonHang_SelectAllByIDDonHang_SoPhieu"

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

function Read-KeyLabHeader {
    param(
        [System.Data.SqlClient.SqlConnection]$SqlConnection,
        [string]$OrderId
    )

    $cmd = $SqlConnection.CreateCommand()
    $cmd.CommandText = "EXEC $HeaderProcedureName @madonhangcuauser=@madonhangcuauser"
    $cmd.CommandTimeout = 30
    $param = $cmd.Parameters.Add("@madonhangcuauser", [System.Data.SqlDbType]::VarChar, 30)
    $param.Value = $OrderId

    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)
    if ($table.Rows.Count -eq 0) {
        return $null
    }
    return $table.Rows[0]
}

function Get-FieldText {
    param(
        [object]$Row,
        [string]$Name
    )
    if (-not $Row -or -not $Row.Table.Columns.Contains($Name)) {
        return ""
    }
    $value = $Row[$Name]
    if ($null -eq $value -or $value -is [DBNull]) {
        return ""
    }
    return ([string]$value).Trim()
}

function Test-TruthyField {
    param([string]$Value)
    $text = ([string]$Value).Trim().ToLowerInvariant()
    return $text -and $text -notin @("0", "false", "no", "khong", "khong co", "không", "không có")
}

function Add-UniqueValue {
    param(
        [System.Collections.IList]$List,
        [string]$Value
    )
    $text = ([string]$Value).Trim()
    if ((Test-TruthyField $text) -and $text.ToLowerInvariant() -ne "true" -and -not $List.Contains($text)) {
        [void]$List.Add($text)
    }
}

function Add-UniqueItem {
    param(
        [System.Collections.IList]$List,
        [string]$Label,
        [string]$Value
    )
    $text = ([string]$Value).Trim()
    if (-not $text) {
        return
    }
    foreach ($item in $List) {
        if ($item.label -eq $Label -and $item.value -eq $text) {
            return
        }
    }
    [void]$List.Add([pscustomobject]@{ label = $Label; value = $text })
}

function Add-FlagItem {
    param(
        [System.Collections.IList]$List,
        [string]$Label,
        [string]$Value
    )
    if (Test-TruthyField $Value) {
        Add-UniqueItem -List $List -Label $Label -Value "co"
    }
}

function Format-AccessoryProduct {
    param([object]$Product)
    $parts = New-Object System.Collections.Generic.List[string]
    if ($Product.san_pham) { [void]$parts.Add($Product.san_pham) }
    if ($Product.rang) { [void]$parts.Add("R: $($Product.rang)") }
    if ($Product.so_luong) { [void]$parts.Add("SL: $($Product.so_luong)") }
    return ($parts -join " - ")
}

function Test-AccessoryProduct {
    param([string]$Name)
    $text = ([string]$Name).Normalize([Text.NormalizationForm]::FormD)
    $builder = New-Object System.Text.StringBuilder
    foreach ($ch in $text.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$builder.Append($ch)
        }
    }
    $n = $builder.ToString().ToLowerInvariant()
    return (
        $n -like "*in mau*" -or
        $n -like "*mau ham*" -or
        $n -like "*rang tam*" -or
        $n -like "*cui gia*" -or
        $n -like "*sap can*" -or
        $n -like "*khay*" -or
        $n -like "*dau*"
    )
}

function Build-KeyLabProductionInfo {
    param(
        [System.Data.DataTable]$DetailTable,
        [object]$HeaderRow,
        [string]$OrderId
    )

    $colors = New-Object System.Collections.ArrayList
    $attributes = New-Object System.Collections.ArrayList
    $instructions = New-Object System.Collections.ArrayList
    $products = New-Object System.Collections.ArrayList

    if ($HeaderRow) {
        Add-UniqueValue -List $colors -Value (Get-FieldText -Row $HeaderRow -Name "rangmau")
        Add-UniqueValue -List $colors -Value (Get-FieldText -Row $HeaderRow -Name "mautk")

        Add-FlagItem -List $attributes -Label "sap_can" -Value (Get-FieldText -Row $HeaderRow -Name "sapcan")
        Add-FlagItem -List $attributes -Label "gia_khop" -Value (Get-FieldText -Row $HeaderRow -Name "giakhop")
        Add-FlagItem -List $attributes -Label "khay_lay_dau" -Value (Get-FieldText -Row $HeaderRow -Name "khaylaydau")
        Add-FlagItem -List $attributes -Label "ham_doi" -Value (Get-FieldText -Row $HeaderRow -Name "hamdoi")
        Add-FlagItem -List $attributes -Label "tren_nuou" -Value (Get-FieldText -Row $HeaderRow -Name "istrennuou")
        Add-FlagItem -List $attributes -Label "ngang_nuou" -Value (Get-FieldText -Row $HeaderRow -Name "isngangnuou")
        Add-FlagItem -List $attributes -Label "duoi_nuou" -Value (Get-FieldText -Row $HeaderRow -Name "isduoinuou")
        Add-FlagItem -List $attributes -Label "bo_vai" -Value (Get-FieldText -Row $HeaderRow -Name "isbovai")
        Add-FlagItem -List $attributes -Label "khac" -Value (Get-FieldText -Row $HeaderRow -Name "khac")
        $trayCount = Get-FieldText -Row $HeaderRow -Name "sokhaylaydau"
        if ($trayCount) {
            Add-UniqueItem -List $attributes -Label "so_khay_lay_dau" -Value $trayCount
        }
        Add-UniqueItem -List $instructions -Label "chi_dinh" -Value (Get-FieldText -Row $HeaderRow -Name "chidinh")
        Add-UniqueItem -List $instructions -Label "noi_dung_khac" -Value (Get-FieldText -Row $HeaderRow -Name "noidungkhac")
        Add-UniqueItem -List $instructions -Label "trao_doi_bac_si" -Value (Get-FieldText -Row $HeaderRow -Name "noidungtraodoivoibacsi")
    }

    foreach ($row in $DetailTable.Rows) {
        Add-UniqueValue -List $colors -Value (Get-FieldText -Row $row -Name "maurang")
        $product = [pscustomobject]@{
            san_pham = Get-FieldText -Row $row -Name "sanpham"
            rang = Get-FieldText -Row $row -Name "rang"
            so_luong = Get-FieldText -Row $row -Name "soluong"
            loai_san_pham = Get-FieldText -Row $row -Name "loaisanpham"
            mau_rang = Get-FieldText -Row $row -Name "maurang"
        }
        if ($product.mau_rang -or $product.loai_san_pham) {
            [void]$products.Add($product)
        }
        if (Test-AccessoryProduct $product.san_pham) {
            Add-UniqueItem -List $attributes -Label "phu_kien" -Value (Format-AccessoryProduct $product)
        }
        if (Test-TruthyField (Get-FieldText -Row $row -Name "issanphamguilabo")) {
            $labName = Get-FieldText -Row $row -Name "tenlabo"
            Add-UniqueItem -List $attributes -Label "gui_labo_ngoai" -Value $(if ($labName) { $labName } else { "co" })
        }
    }

    return [pscustomobject]@{
        ma_dh = $OrderId
        colors = @($colors)
        attributes = @($attributes)
        instructions = @($instructions)
        products = @($products)
    }
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

    $header = Read-KeyLabHeader -SqlConnection $SqlConnection -OrderId $OrderId
    $sxInfo = Build-KeyLabProductionInfo -DetailTable $table -HeaderRow $header -OrderId $OrderId

    if ($notes.Count -eq 0 -and $sxInfo.colors.Count -eq 0 -and $sxInfo.attributes.Count -eq 0 -and $sxInfo.instructions.Count -eq 0 -and $sxInfo.products.Count -eq 0) {
        return $null
    }

    return [pscustomobject]@{
        ma_dh = $OrderId
        ghi_chu_sx = ($notes -join "`r`n")
        sx_info = $sxInfo
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
