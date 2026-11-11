# ==============================================================================
# deploy/server/setup-firewall.ps1
# Configures Windows Firewall on the eNote server (192.214.23.15)
# Run as Administrator in PowerShell
# ==============================================================================

#Requires -RunAsAdministrator

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " eNote Offline LAN Server Firewall Setup    " -ForegroundColor Cyan
Write-Host " Server IP: 192.214.23.15                   " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. PostgreSQL Port 5432 Inbound Rule
$RuleName = "PostgreSQL eNote LAN (Port 5432)"
$ExistingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue

if ($ExistingRule) {
    Write-Host "`n[OK] Firewall rule '$RuleName' already exists. Updating..." -ForegroundColor Yellow
    Set-NetFirewallRule -DisplayName $RuleName -Enabled True -Action Allow -Direction Inbound -Protocol TCP -LocalPort 5432
} else {
    Write-Host "`n[+] Creating inbound firewall rule for PostgreSQL port 5432..." -ForegroundColor Green
    New-NetFirewallRule -DisplayName $RuleName `
                        -Description "Allows incoming PostgreSQL traffic for eNote client workstations on LAN." `
                        -Direction Inbound `
                        -Protocol TCP `
                        -LocalPort 5432 `
                        -Action Allow `
                        -Profile Any `
                        -Enabled True | Out-Null
}

Write-Host "[OK] PostgreSQL Port 5432 is open for inbound LAN connections." -ForegroundColor Green

# 2. File and Printer Sharing (SMB / Port 445) for Shared Resource Storage
Write-Host "`n[+] Enabling File and Printer Sharing for shared resources (\\192.214.23.15\eNoteFiles)..." -ForegroundColor Cyan
try {
    Enable-NetFirewallRule -DisplayGroup "File and Printer Sharing" -ErrorAction SilentlyContinue | Out-Null
    Write-Host "[OK] File and Printer Sharing rules enabled." -ForegroundColor Green
} catch {
    Write-Host "[!] Note: Could not enable 'File and Printer Sharing' group automatically. Verify SMB port 445 is allowed." -ForegroundColor Yellow
}

# 3. Network profile check
$profiles = Get-NetConnectionProfile
Write-Host "`nNetwork connection profiles detected:" -ForegroundColor Cyan
foreach ($p in $profiles) {
    $color = if ($p.NetworkCategory -eq "Public") { "Yellow" } else { "Green" }
    Write-Host "  - Interface: $($p.InterfaceAlias) | IP: $($p.IPv4Address) | Category: $($p.NetworkCategory)" -ForegroundColor $color
}

if ($profiles.NetworkCategory -contains "Public") {
    Write-Host "`n[WARNING] One or more network interfaces are set to 'Public'." -ForegroundColor Red
    Write-Host "For a LAN server, consider changing the network category to 'Private':" -ForegroundColor Yellow
    Write-Host "  Set-NetConnectionProfile -InterfaceAlias '<Name>' -NetworkCategory Private" -ForegroundColor Gray
}

Write-Host "`n=============================================" -ForegroundColor Cyan
Write-Host "Firewall configuration complete!" -ForegroundColor Green
Write-Host "Test connection from a client workstation with:" -ForegroundColor White
Write-Host "  Test-NetConnection -ComputerName 192.214.23.15 -Port 5432" -ForegroundColor Yellow
Write-Host "=============================================" -ForegroundColor Cyan

