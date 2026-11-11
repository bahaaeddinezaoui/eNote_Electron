# ==============================================================================
# deploy/server/restore-db.ps1
# Restores a backup dump into the eNote database
# Usage:
#   .\restore-db.ps1 -BackupFile ".\backups\eNote_backup_20261103.dump"
# ==============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupFile,
    [string]$HostName = "127.0.0.1",
    [int]$Port = 5432,
    [string]$Database = "eNote",
    [string]$User = "postgres",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupFile)) {
    Write-Error "Backup file does not exist: $BackupFile"
    exit 1
}

Write-Host "=============================================" -ForegroundColor Red
Write-Host " WARNING: DATABASE RESTORE OPERATION         " -ForegroundColor Red
Write-Host " Target DB:  $Database on ${HostName}:$Port  " -ForegroundColor Red
Write-Host " Backup File: $BackupFile                   " -ForegroundColor Red
Write-Host "=============================================" -ForegroundColor Red

if (-not $Force) {
    $confirm = Read-Host "This will OVERWRITE existing data in database '$Database'. Are you sure you want to proceed? (yes/no)"
    if ($confirm -ne "yes") {
        Write-Host "Operation cancelled by user." -ForegroundColor Yellow
        exit 0
    }
}

# Locate psql and pg_restore
$installRoot = Join-Path $env:ProgramFiles "PostgreSQL"
$binDirs = @()
if (Test-Path $installRoot) {
    $binDirs = Get-ChildItem -Path $installRoot -Directory |
        Where-Object { $_.Name -match '^\d+$' } |
        Sort-Object { [int]$_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName "bin" }
}

function Find-PgTool([string]$ToolName) {
    $cmd = Get-Command $ToolName -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($dir in $binDirs) {
        $candidate = Join-Path $dir "$ToolName.exe"
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

$psqlCmd = Find-PgTool "psql"
$pgRestoreCmd = Find-PgTool "pg_restore"

if (-not $psqlCmd) {
    Write-Error "psql executable was not found. Please install PostgreSQL tools or add bin to PATH."
    exit 1
}

# 1. Terminate existing connections to allow clean restore
Write-Host "`n1. Terminating active connections to '$Database'..." -ForegroundColor Cyan
$termSql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Database' AND pid <> pg_backend_pid();"
& $psqlCmd -h $HostName -p $Port -U $User -d postgres -c $termSql | Out-Null

# 2. Check file type (custom archive .dump vs plain .sql)
$isCustom = $BackupFile.EndsWith(".dump", [System.StringComparison]::OrdinalIgnoreCase)

if ($isCustom) {
    if (-not $pgRestoreCmd) {
        Write-Error "pg_restore executable was not found. Required for .dump files."
        exit 1
    }
    Write-Host "2. Restoring custom binary dump using pg_restore..." -ForegroundColor Cyan
    # --clean drops database objects before recreating them; -e exits on error
    & $pgRestoreCmd -h $HostName -p $Port -U $User -d $Database --clean --if-exists -v $BackupFile
    if ($LASTEXITCODE -gt 1) { # pg_restore exits with 1 on warnings (like drops on non-existing tables)
        Write-Error "pg_restore failed with exit code $LASTEXITCODE."
        exit $LASTEXITCODE
    }
} else {
    Write-Host "2. Restoring plain SQL dump using psql..." -ForegroundColor Cyan
    & $psqlCmd -h $HostName -p $Port -U $User -d $Database -f $BackupFile
    if ($LASTEXITCODE -ne 0) {
        Write-Error "psql failed with exit code $LASTEXITCODE."
        exit $LASTEXITCODE
    }
}

# 3. Verification
Write-Host "`n3. Verifying database restored tables..." -ForegroundColor Cyan
$verifySql = "SELECT count(*) AS total_tables FROM information_schema.tables WHERE table_schema = 'public';"
& $psqlCmd -h $HostName -p $Port -U $User -d $Database -c $verifySql

Write-Host "`n[OK] Database restore completed successfully!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Cyan
