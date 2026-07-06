<#
.SYNOPSIS
    Refreshes the source Power Query dashboard, exports the 5 sheets the Sales
    Performance Dashboard app parses into a fresh "Sales update.xlsx", and uploads
    it automatically. Replaces the manual refresh/copy/save/browser-upload routine.

.DESCRIPTION
    1. Opens a separate, invisible Excel instance (does not touch any interactive
       session you may already have the source workbook open in) and refreshes all
       Power Query connections and pivot tables.
    2. Copies the used range of 5 source sheets as values into a new workbook,
       renamed to the exact sheet names the app's parser expects.
    3. Saves that workbook to -OutputPath.
    4. POSTs it to <AppUrl>/api/upload with the x-upload-api-key header.

    The source workbook is never saved by this script - only read and refreshed
    in memory, so it's safe to run even if you also have it open interactively
    (Excel will silently fall back to read-only for the second instance, which
    is all this script needs).

.NOTES
    Requires:
      - Excel installed on the machine running this script (COM automation).
      - Windows Integrated Auth to PINEFROSTSERVER for the account this task
        runs as (Task Scheduler: "Run whether user is logged on or not", using
        an account with the same DB access the interactive user has).
      - UPLOAD_API_KEY set in the web app's environment, and the same value
        passed here via -ApiKey (or the UPLOAD_API_KEY environment variable).
#>

param(
    [string]$SourcePath = "D:\Reports & Extractions\SAP Extraction\Executive_Sales & Finance Dashboard_Pinefrost.xlsm",
    [string]$OutputPath = "C:\Users\IT\Downloads\Sales update.xlsx",
    [string]$AppUrl = "https://pinefrostdb.netlify.app",
    [string]$ApiKey = $env:UPLOAD_API_KEY,
    [int]$RefreshTimeoutSeconds = 1200,
    # Skip the Power Query/pivot refresh and export the workbook's last-saved data
    # as-is. Useful for quickly retrying the export/upload steps after a failure,
    # since a full refresh against SAP takes ~25 minutes.
    [switch]$SkipRefresh
)

$ErrorActionPreference = "Stop"

# Sheet in the source workbook -> sheet name the app's parser requires.
$SheetMap = [ordered]@{
    "Sales Preview"        = "Sales Vs Target"
    "Calls & Productivity" = "Coverage & Productivity"
    "Stock Listing"        = "Stock Balances"
    "Full Year Trend"      = "Trended Revenue"
    "Weekly Sales"         = "Weekly Projection"
}

$xlPasteValuesAndNumberFormats = 12
$xlOpenXMLWorkbook = 51

function Write-Log {
    param([string]$Message)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
    Write-Output $line
}

function Wait-QueriesDone {
    param($ExcelApp, [int]$TimeoutSeconds)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    try {
        # Blocks until all Power Query background refreshes finish. Available on
        # Excel 2016+ with Get & Transform, which this workbook already requires.
        $ExcelApp.CalculateUntilAsyncQueriesDone()
        return
    } catch {
        Write-Log "CalculateUntilAsyncQueriesDone unavailable, falling back to polling."
    }
    while ((Get-Date) -lt $deadline) {
        if ($ExcelApp.CalculationState -eq -4105) { return } # xlDone
        Start-Sleep -Seconds 2
    }
    throw "Timed out after $TimeoutSeconds seconds waiting for query refresh to finish."
}

function Invoke-MultipartUpload {
    param([string]$Uri, [string]$FilePath, [string]$ApiKeyHeader)

    $fileBytes = [System.IO.File]::ReadAllBytes($FilePath)
    $fileName = [System.IO.Path]::GetFileName($FilePath)
    $boundary = [System.Guid]::NewGuid().ToString()
    $LF = "`r`n"

    $preamble = (
        "--$boundary$LF" +
        "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"$LF" +
        "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet$LF$LF"
    )
    $epilogue = "$LF--$boundary--$LF"

    $preambleBytes = [System.Text.Encoding]::UTF8.GetBytes($preamble)
    $epilogueBytes = [System.Text.Encoding]::UTF8.GetBytes($epilogue)
    $bodyBytes = New-Object byte[] ($preambleBytes.Length + $fileBytes.Length + $epilogueBytes.Length)
    [System.Buffer]::BlockCopy($preambleBytes, 0, $bodyBytes, 0, $preambleBytes.Length)
    [System.Buffer]::BlockCopy($fileBytes, 0, $bodyBytes, $preambleBytes.Length, $fileBytes.Length)
    [System.Buffer]::BlockCopy($epilogueBytes, 0, $bodyBytes, $preambleBytes.Length + $fileBytes.Length, $epilogueBytes.Length)

    try {
        return Invoke-RestMethod -Uri $Uri -Method Post `
            -Headers @{ "x-upload-api-key" = $ApiKeyHeader } `
            -ContentType "multipart/form-data; boundary=$boundary" `
            -Body $bodyBytes
    } catch [System.Net.WebException] {
        # Surface the server's JSON error body (e.g. the parser's message) instead
        # of just "400 Bad Request".
        $resp = $_.Exception.Response
        if ($resp -ne $null) {
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $body = $reader.ReadToEnd()
            $reader.Close()
            throw ("Upload rejected (HTTP " + [int]$resp.StatusCode + "): " + $body)
        }
        throw
    }
}

if (-not $ApiKey) {
    throw "No API key provided. Pass -ApiKey or set the UPLOAD_API_KEY environment variable (must match the value configured in Netlify)."
}
if (-not (Test-Path $SourcePath)) {
    throw "Source workbook not found: $SourcePath"
}

$excel = $null
$srcWb = $null
$destWb = $null
$comObjects = New-Object System.Collections.Generic.List[object]

try {
    Write-Log "Starting Excel..."
    $excel = New-Object -ComObject Excel.Application
    $comObjects.Add($excel)
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false

    Write-Log "Opening source workbook (read-only if already open elsewhere)..."
    $srcWb = $excel.Workbooks.Open($SourcePath, $false, $false)
    $comObjects.Add($srcWb)

    if ($SkipRefresh) {
        Write-Log "Skipping refresh (-SkipRefresh) - exporting last-saved data."
    } else {
        Write-Log "Refreshing all queries and pivot tables - this can take a while against SAP..."
        $srcWb.RefreshAll()
        Wait-QueriesDone -ExcelApp $excel -TimeoutSeconds $RefreshTimeoutSeconds
        foreach ($sheetName in $SheetMap.Keys) {
            $ws = $srcWb.Worksheets.Item($sheetName)
            foreach ($pt in $ws.PivotTables()) {
                try { $pt.RefreshTable() | Out-Null } catch {}
            }
        }
        Write-Log "Refresh complete."
    }

    Write-Log "Building export workbook..."
    $destWb = $excel.Workbooks.Add()
    $comObjects.Add($destWb)

    foreach ($sourceName in $SheetMap.Keys) {
        $targetName = $SheetMap[$sourceName]
        Write-Log "  $sourceName -> $targetName"
        $srcSheet = $srcWb.Worksheets.Item($sourceName)
        $srcSheet.UsedRange.Copy() | Out-Null

        $newSheet = $destWb.Worksheets.Add()
        $newSheet.Name = $targetName
        $newSheet.Range("A1").PasteSpecial($xlPasteValuesAndNumberFormats) | Out-Null
    }

    # Excel seeds a new workbook with one default blank sheet ("Sheet1") - remove it,
    # leaving only the 5 renamed sheets above.
    foreach ($ws in @($destWb.Worksheets)) {
        if ($SheetMap.Values -notcontains $ws.Name) {
            $ws.Delete()
        }
    }

    if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }
    Write-Log "Saving export to $OutputPath..."
    $destWb.SaveAs($OutputPath, $xlOpenXMLWorkbook)
    $destWb.Close($false)

    Write-Log "Uploading to $AppUrl/api/upload..."
    $response = Invoke-MultipartUpload -Uri "$AppUrl/api/upload" -FilePath $OutputPath -ApiKeyHeader $ApiKey
    Write-Log "Upload succeeded. Snapshot: $($response.snapshot.id)"
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
}
finally {
    if ($srcWb) { try { $srcWb.Close($false) } catch {} }
    if ($excel) { try { $excel.Quit() } catch {} }
    foreach ($obj in $comObjects) {
        try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) | Out-Null } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
