# ==============================================================================
# deploy/server/backup-db.ps1
# Takes a full backup of the eNote PostgreSQL database
# Usage:
#   .\backup-db.ps1
#   .\backup-db.ps1 -BackupDir "D:\eNoteBackups" -KeepDays 30
# ==============================================================================

param(
    [string]$HostName = "127.0.0.1",
    [int]$Port = 5432,
    [string]$Database = "eNote",
    [string]$User = "postgres",
    [string]$BackupDir = ".\backups",
    [int]$KeepDays = 14
)

$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$dumpFile = Join-Path $BackupDir "${Database}_backup_${timestamp}.dump"
$sqlFile = Join-Path $BackupDir "${Database}_backup_${timestamp}.sql"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Starting eNote Database Backup              " -ForegroundColor Cyan
Write-Host " Database: $Database on ${HostName}:$Port    " -ForegroundColor Cyan
Write-Host " Output:   $dumpFile                         " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Locate pg_dump
$pgDumpCmd = Get-Command "pg_dump" -ErrorAction SilentlyContinue
if (-not $pgDumpCmd) {
    $installRoot = Join-Path $env:ProgramFiles "PostgreSQL"
    $candidates = @()
    if (Test-Path $installRoot) {
        $candidates = Get-ChildItem -Path $installRoot -Directory |
            Where-Object { $_.Name -match '^\d+$' } |
            Sort-Object { [int]$_.Name } -Descending |
            ForEach-Object { Join-Path $_.FullName "bin\pg_dump.exe" }
    }
    foreach ($cand in $candidates) {
        if (Test-Path $cand) {
            $pgDumpCmd = $cand
            break
        }
    }
}

if (-not $pgDumpCmd) {
    Write-Error "pg_dump executable was not found. Please install PostgreSQL client tools or add PostgreSQL bin directory to PATH."
    exit 1
}

Write-Host "Using pg_dump: $pgDumpCmd" -ForegroundColor Gray

# 1. Take binary custom archive dump (best for pg_restore)
Write-Host "Exporting binary custom dump..." -ForegroundColor Cyan
& $pgDumpCmd -h $HostName -p $Port -U $User -F c -b -v -f $dumpFile $Database
if ($LASTEXITCODE -ne 0) {
    Write-Error "pg_dump custom format failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

# 2. Take plain text SQL dump (portable, searchable)
Write-Host "Exporting plain SQL schema+data dump..." -ForegroundColor Cyan
& $pgDumpCmd -h $HostName -p $Port -U $User -F p -b --clean --if-exists -f $sqlFile $Database
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Plain SQL dump failed, but binary dump succeeded."
}

$dumpSize = (Get-Item $dumpFile).Length / 1MB
Write-Host "`n[OK] Backup created successfully!" -ForegroundColor Green
Write-Host "    Binary Dump: $dumpFile ($([Math]::Round($dumpSize, 2)) MB)" -ForegroundColor Yellow
if (Test-Path $sqlFile) {
    $sqlSize = (Get-Item $sqlFile).Length / 1MB
    Write-Host "    Plain SQL:   $sqlFile ($([Math]::Round($sqlSize, 2)) MB)" -ForegroundColor Yellow
}

# Retention cleanup
if ($KeepDays -gt 0) {
    $cutoff = (Get-Date).AddDays(-$KeepDays)
    $oldFiles = Get-ChildItem -Path $BackupDir -File | Where-Object {
        $_.LastWriteTime -lt $cutoff -and ($_.Extension -in @(".dump", ".sql"))
    }
    if ($oldFiles) {
        Write-Host "`nCleaning up $($oldFiles.Count) backup file(s) older than $KeepDays days..." -ForegroundColor Gray
        $oldFiles | Remove-Item -Force
    }
}

Write-Host "=============================================" -ForegroundColor Cyan
