# deploy/client/install-preset.ps1
# Installs or updates the machine-wide eNote deployment preset on a client workstation.
#
# Usage:
#   .\install-preset.ps1 -ServerHost "192.214.23.15"
#   .\install-preset.ps1 -PresetFile ".\deployment.json"

param(
    [string]$ServerHost = "192.214.23.15",
    [int]$Port = 5432,
    [string]$Database = "eNote",
    [string]$User = "enote_app",
    [string]$Password = "",
    [string]$StorageRoot = "\\192.214.23.15\eNoteFiles",
    [string]$PresetFile = ""
)

$ErrorActionPreference = "Stop"

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Administrator privileges are required to install the machine-wide preset. Close this window, open PowerShell with 'Run as administrator', then rerun the command."
}

$targetDir = Join-Path $env:ProgramData "eNote"
$targetFile = Join-Path $targetDir "deployment.json"

if (-not (Test-Path $targetDir)) {
    Write-Host "Creating directory $targetDir..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

if ($PresetFile) {
    if (-not (Test-Path $PresetFile -PathType Leaf)) {
        throw "Preset file not found: $PresetFile"
    }
    Write-Host "Copying preset from $PresetFile to $targetFile..." -ForegroundColor Cyan
    Copy-Item -Path $PresetFile -Destination $targetFile -Force
} else {
    if (-not $Password) {
        $securePassword = Read-Host "Enter the enote_app database password" -AsSecureString
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try {
            $Password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        }
    }
    if (-not $Password) {
        throw "A database password is required."
    }

    Write-Host "Generating machine-wide preset at $targetFile..." -ForegroundColor Cyan
    $config = [PSCustomObject]@{
        host        = $ServerHost
        port        = $Port
        database    = $Database
        user        = $User
        password    = $Password
        ssl         = $false
        storageRoot = $StorageRoot
    }
    $json = $config | ConvertTo-Json -Depth 4
    $utf8WithoutBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
    [System.IO.File]::WriteAllText($targetFile, $json, $utf8WithoutBom)
}

try {
    $installedConfig = Get-Content -Path $targetFile -Raw | ConvertFrom-Json
    if (-not $installedConfig.host -or -not $installedConfig.database -or -not $installedConfig.user) {
        throw "The preset must contain host, database, and user values."
    }
} catch {
    throw "The deployment preset at $targetFile is invalid: $($_.Exception.Message)"
}

Write-Host "Deployment preset installed successfully!" -ForegroundColor Green
Write-Host "Path: $targetFile" -ForegroundColor Yellow
Write-Host "Preset target: $($installedConfig.host):$($installedConfig.port)/$($installedConfig.database) as $($installedConfig.user)" -ForegroundColor Green
Write-Host "All users on this computer will use this preset unless they already have a saved per-user database configuration." -ForegroundColor Green
