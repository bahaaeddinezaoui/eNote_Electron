<#
.SYNOPSIS
    Create the account and the share the eNote client signs in to.

.DESCRIPTION
    The eNote client reads photos, lesson documents and screenshots with plain
    file calls, so Windows needs an SMB session with this server for the account
    running the client. A workstation that was never mapped therefore reads the
    share as an empty folder: every photo and document looks missing while
    PostgreSQL answers normally.

    This script gives the share one dedicated local account (default
    `enote_files`), creates the folders the client files into, publishes the
    share, and grants that account Change on the share and Modify on the folder.
    The client then signs in with the same account, configured once per machine
    in deployment.json (smbUser / smbPassword).

    Re-run it to change the password; workstations pick the new one up the next
    time they are given the new deployment.json.

.PARAMETER SharePath
    Folder to share. Default C:\eNoteFiles.

.PARAMETER ShareName
    Share name the client's storageRoot refers to. Default eNoteFiles.

.PARAMETER Account
    Local account name. Default enote_files.

.PARAMETER Password
    Password for that account. Omitted, it is asked for without echoing.

.EXAMPLE
    .\setup-share.ps1 -SharePath "C:\eNoteFiles"

.NOTES
    Run on the server, in an elevated PowerShell, once during deployment.
#>
[CmdletBinding()]
param(
    [string]$SharePath = 'C:\eNoteFiles',
    [string]$ShareName = 'eNoteFiles',
    [string]$Account = 'enote_files',
    [string]$Password
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this script from an elevated PowerShell (Run as administrator).'
    }
}

Assert-Administrator

if (-not $Password) {
    $secure = Read-Host -AsSecureString "Password for the '$Account' account"
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    )
}
if (-not $Password) { throw 'A password is required: workstations sign in with it.' }

# 1. The folders. The client creates the deeper curriculum / shelf folders itself.
Write-Host "`n[+] Creating $SharePath ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $SharePath -Force | Out-Null
foreach ($folder in 'person_photos', 'documents', 'library', 'screenshots') {
    New-Item -ItemType Directory -Path (Join-Path $SharePath $folder) -Force | Out-Null
}
Write-Host '[OK] Folder tree ready.' -ForegroundColor Green

# 2. The account. Password never expires: a workstation that was switched off
#    for a term must still open the share without a technician.
Write-Host "`n[+] Preparing the '$Account' account ..." -ForegroundColor Cyan
$secret = ConvertTo-SecureString $Password -AsPlainText -Force
if (Get-LocalUser -Name $Account -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $Account -Password $secret -PasswordNeverExpires $true
    Write-Host '[OK] Account exists; password updated.' -ForegroundColor Green
} else {
    New-LocalUser -Name $Account -Password $secret `
        -FullName 'eNote file share' `
        -Description 'Read/write access to the eNote shared folder' `
        -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    Write-Host '[OK] Account created.' -ForegroundColor Green
}
$usersGroup = (Get-LocalGroup -SID 'S-1-5-32-545').Name
if (-not (Get-LocalGroupMember -Group $usersGroup -Member $Account -ErrorAction SilentlyContinue)) {
    Add-LocalGroupMember -Group $usersGroup -Member $Account
}

# 3. NTFS: Modify on the folder and everything below it.
Write-Host "`n[+] Granting Modify on $SharePath ..." -ForegroundColor Cyan
$acl = Get-Acl -Path $SharePath
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $Account, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
)
$acl.SetAccessRule($rule)
Set-Acl -Path $SharePath -AclObject $acl
Write-Host '[OK] Folder permissions set.' -ForegroundColor Green

# 4. The share itself: Change for the account, full control for administrators.
Write-Host "`n[+] Publishing the '$ShareName' share ..." -ForegroundColor Cyan
if (Get-SmbShare -Name $ShareName -ErrorAction SilentlyContinue) {
    Grant-SmbShareAccess -Name $ShareName -AccountName $Account -AccessRight Change -Force | Out-Null
    Write-Host '[OK] Share exists; access granted.' -ForegroundColor Green
} else {
    New-SmbShare -Name $ShareName -Path $SharePath -ChangeAccess $Account `
        -FullAccess 'Administrators' -Description 'eNote shared files' | Out-Null
    Write-Host '[OK] Share created.' -ForegroundColor Green
}

# 5. Anything wider than the account is reported, never revoked silently: the
#    share may be used by another application.
$open = Get-SmbShareAccess -Name $ShareName |
    Where-Object { $_.AccountName -match 'Everyone|ANONYMOUS|Utilisateurs|Users$' }
if ($open) {
    Write-Host "`n[!] This share is also open to broad groups:" -ForegroundColor Yellow
    $open | ForEach-Object { Write-Host "      $($_.AccountName) — $($_.AccessRight)" -ForegroundColor Yellow }
    Write-Host '    Close it once every workstation has the deployment preset:' -ForegroundColor Yellow
    Write-Host "      Revoke-SmbShareAccess -Name $ShareName -AccountName 'Everyone' -Force" -ForegroundColor Yellow
}

# 6. What to put on the workstations.
$hostIp = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1).IPAddress
Write-Host "`n[Done] Add these to %PROGRAMDATA%\eNote\deployment.json on every workstation:" -ForegroundColor Cyan
Write-Host "  `"storageRoot`": `"\\\\$hostIp\$ShareName`"," -ForegroundColor White
Write-Host "  `"smbUser`": `"$Account`"," -ForegroundColor White
Write-Host "  `"smbPassword`": `"<the password you just entered>`"" -ForegroundColor White
Write-Host "`nThe client opens the session itself at startup; no drive mapping is needed." -ForegroundColor Cyan
