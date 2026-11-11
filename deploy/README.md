# eNote Offline LAN Deployment Guide

This guide details the complete deployment of the **eNote** academic management system on a private, isolated Local Area Network (LAN) with **zero internet connection**.

The central database and shared storage server is configured at **`192.214.23.15`**.

Workstations run the same offline Electron client on **Windows x64** and **Linux x64** (AppImage, Debian/Ubuntu package, or portable archive). The server half of this guide — PostgreSQL service, SMB share, firewall rules, scheduled tasks — is written for Windows; a Linux workstation consumes that same server over TCP 5432 and a mounted SMB share. Steps that differ per client platform give both variants.

---

## 1. System Architecture Overview

```
                      +---------------------------------------+
                      |       LAN Server (192.214.23.15)      |
                      |                                       |
                      |  * PostgreSQL 15/16 (Port 5432)       |
                      |    - Database: eNote                  |
                      |    - Role: enote_app                  |
                      |                                       |
                      |  * Shared Storage (SMB Share)         |
                      |    - \\192.214.23.15\eNoteFiles       |
                      |      |- person_photos/                |
                      |      |- documents/                    |
                      |      |- library/                      |
                      |      \- screenshots/                  |
                      +---------------------------------------+
                                          |
                +-------------------------+-------------------------+
                |                         |                         |
    [Workstation 1]           [Workstation 2]           [Workstation N]
     eNote Desktop             eNote Desktop             eNote Desktop
    (Offline Electron)        (Offline Electron)        (Offline Electron)
     Local Fonts Bundled       Local Fonts Bundled       Local Fonts Bundled
```

### Key Design Pillars for Offline LAN
1. **Fully Offline Desktop App**: All assets (including Google Fonts: *Instrument Sans*, *Instrument Serif*, *JetBrains Mono*, *Noto Naskh Arabic*) are embedded directly into the application and report printer. No external HTTP requests are made.
2. **Centralized Data & Media**: The PostgreSQL database runs on `192.214.23.15`. Student photos, lesson documents, Library documents, and bug screenshots live on a dedicated SMB share (`\\192.214.23.15\eNoteFiles`).
3. **Machine-Wide Zero-Touch Preset**: A client machine configured with `%PROGRAMDATA%\eNote\deployment.json` (Windows) or a machine-wide `deployment.json` (Linux, see Step 6.3) automatically connects to `192.214.23.15` for every user account without manual typing.
4. **Pre-Login Server Settings Panel**: If an unconfigured client launches the app, the Login screen surfaces a **Server settings** button and connection status badge so a technician can test and save the connection without needing an existing user session.

---

## 2. Server Setup (IP: `192.214.23.15`)

### Step 2.1: Assign Static IP Address
On the server workstation/host:
1. Open **Network Connections** (`ncpa.cpl`).
2. Right-click your Ethernet adapter -> **Properties** -> **Internet Protocol Version 4 (TCP/IPv4)** -> **Properties**.
3. Configure:
   - **IP address**: `192.214.23.15`
   - **Subnet mask**: `255.255.255.0` (or your network mask)
   - **Default gateway**: As required by your local router/switch.

### Step 2.2: Install PostgreSQL Offline
1. Download the official PostgreSQL Windows offline installer on an internet-connected machine.
2. Transfer the installer via USB drive to `192.214.23.15`.
3. Run the installer:
   - Specify the superuser password for `postgres` (keep this safe for administrative tasks).
   - Default port: `5432`.
   - Ensure the command line tools (`psql`, `pg_dump`, `pg_restore`) are selected.
   - The backup and restore scripts search versioned folders under `C:\Program Files\PostgreSQL` for these tools when they are not on `PATH`.

### Step 2.3: Configure PostgreSQL for LAN Connections
Navigate to the PostgreSQL data directory (default: `C:\Program Files\PostgreSQL\15\data` or `%PGDATA%`).

#### A. Edit `postgresql.conf`
Open `postgresql.conf` in a text editor with administrative rights.
Locate `listen_addresses` and set it to listen on all interfaces:
```ini
listen_addresses = '*'
port = 5432
```
*(Reference: see `deploy/server/postgresql.conf.snippet` for recommended performance and logging settings).*

#### B. Edit `pg_hba.conf`
Open `pg_hba.conf` and append rules allowing the LAN subnet to connect to the `eNote` database:
```ini
# TYPE  DATABASE        USER            ADDRESS                 METHOD
host    eNote           enote_app       192.214.23.0/24         scram-sha-256
host    eNote           postgres        192.214.23.0/24         scram-sha-256
```
*(Note: If your subnet is `192.168.1.0/24` or `10.0.0.0/24`, adjust the CIDR address accordingly).*

### Step 2.4: Open Server Firewall Ports
Run the included PowerShell script as Administrator on the server:
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\server\setup-firewall.ps1
```
This automatically:
- Opens inbound TCP port `5432` for PostgreSQL.
- Enables Windows File and Printer Sharing rules (SMB port 445).

### Step 2.5: Restart PostgreSQL Service
Restart the PostgreSQL service to apply `postgresql.conf` and `pg_hba.conf`:
```powershell
Restart-Service postgresql* -Force
```

---

## 3. Database Initialization & Schema

If `psql` is not recognized, add the installed PostgreSQL `bin` directory to the
current PowerShell session's `PATH` before running the commands below:
```powershell
$pgBin = Get-ChildItem "$env:ProgramFiles\PostgreSQL" -Directory |
    Where-Object { $_.Name -match '^\d+$' } |
    Sort-Object { [int]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName "bin" } |
    Where-Object { Test-Path (Join-Path $_ "psql.exe") } |
    Select-Object -First 1
if (-not $pgBin) { throw "psql.exe was not found under $env:ProgramFiles\PostgreSQL" }
$env:Path = "$pgBin;$env:Path"
```

### Option A: Restore from Existing Working Database (Recommended)
Since migration scripts and schema evolutions occurred during development, restoring an exact dump of the verified development database is the cleanest path.

1. **On your working development machine**, take a backup dump:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy\server\backup-db.ps1 -Database eNote -BackupDir ".\backups"
   ```
   This generates `.\backups\eNote_backup_YYYYMMDD_HHMMSS.dump`.

2. **Copy the `.dump` file to the server `192.214.23.15`** via USB or shared drive.

3. **On the server**, run the initialization script to create the role `enote_app` and database `eNote`:
   ```powershell
   psql -U postgres -f .\deploy\server\01-init-enote.sql
   ```
   *(Update the password in `01-init-enote.sql` to your preferred application password).*

4. **Restore the dump onto the server**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy\server\restore-db.ps1 -BackupFile ".\eNote_backup_latest.dump"
   ```

### Option B: Fresh Database Setup
The repository does not include a standalone `schema.sql`. A fresh database must
be initialized from a full backup made from a working eNote database; the numbered
SQL files in `deploy/server` are incremental migrations, not a complete schema.

1. Initialize the role and database:
   ```powershell
   psql -U postgres -f .\deploy\server\01-init-enote.sql
   ```
2. Restore the full custom-format backup (`.dump`) made from the working database:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy\server\restore-db.ps1 -BackupFile ".\backups\eNote_backup_YYYYMMDD_HHMMSS.dump"
   ```
   Replace the filename with the backup you copied to this machine. Restore overwrites database objects in `eNote`; do not run it against data you need to keep.
3. If the restored database does not already contain an administrator account, bootstrap one:
   ```powershell
   psql -U postgres -d eNote -f .\deploy\server\02-bootstrap-admin.sql
   ```
   *Initial credentials: `Username: admin` / `Password: admin`*.

---

## 4. Shared Storage Setup (Photos & Documents)

Workstations must read and save student photos, lesson documents, Library documents, and screenshots on the central server rather than local workstation disks.

### Step 4.1: Create & Share the Storage Folder
On the server `192.214.23.15`:
1. Create folder: `C:\eNoteFiles`
2. Create subfolders:
   - `C:\eNoteFiles\person_photos`
   - `C:\eNoteFiles\documents`
   - `C:\eNoteFiles\library`
   - `C:\eNoteFiles\screenshots`
   The application creates the subfolders it needs, and files them further:
   lesson material goes to `documents\<MAJOR_CODE>\<CHAPTER_CODE>\<LESSON_CODE>\`, and Library
   documents to `library\<TYPE>\<CATEGORY_CODE>\`. You do not have to create
   those deeper folders by hand.
3. Share the folder:
   - Right-click `C:\eNoteFiles` -> **Properties** -> **Sharing** -> **Advanced Sharing**.
   - Check **Share this folder**. Share name: `eNoteFiles`.
   - Leave **Permissions** for Step 4.3, which creates one dedicated account and grants it **Change**.
     Do not open the share to `Everyone`: see Step 4.3 for why.

### Step 4.2: Verify Network Path
From any Windows workstation on the LAN, verify the UNC path opens in Windows Explorer:
```
\\192.214.23.15\eNoteFiles
```
From a Linux workstation the same share is reached through the CIFS mount described in Step 6.3:
```bash
ls /mnt/enote
```

> Opening the share in Explorer signs **that one Windows account** in for a while. It proves the
> share exists; it does not give the other workstations access. Step 4.3 is what does.

### Step 4.3: Give eNote Its Own Share Account

The client reads the share with plain file calls, so Windows needs an SMB session with the server
for the account running eNote. A workstation that was never mapped reads the share as an **empty
folder**: photos and documents look missing, saving a photo fails, while PostgreSQL keeps answering
normally — the symptom that sends people looking in the wrong place.

Give the share one dedicated account and let the client sign in with it:

1. **On the server**, in an elevated PowerShell, from `deploy\server`:
   ```powershell
   .\setup-share.ps1 -SharePath "C:\eNoteFiles"
   ```
   It creates the local account `enote_files` (asking for a password), the four subfolders, the
   `eNoteFiles` share, and grants that account **Change** on the share and **Modify** on the folder.
   Re-run it with the same parameters to rotate the password.

2. **On every workstation**, put the same account in the machine-wide preset
   `%PROGRAMDATA%\eNote\deployment.json` — the fields are `smbUser` and `smbPassword`, shown in
   [`deploy/client/deployment.json.example`](./client/deployment.json.example). Only the file
   location changes, and it must stay readable to machine administrators alone, because it now holds
   two passwords.

   `ENOTE_SMB_USER` / `ENOTE_SMB_PASSWORD` override the preset on a single machine, so a technician
   can repair one workstation without touching the shared file.

The client opens the session itself: once at startup, and again — at most every 20 seconds — whenever
a file cannot be found, so a server that comes up after the workstations needs no restart. It uses
`net use … /persistent:no`, so no drive letter and no saved mapping is left in the user's profile.

When it still does not work, the log and the storage status name the reason:

| Reason | Meaning | Fix |
|---|---|---|
| `bad-credentials` | the server refused the account or the password | rotate the password with `setup-share.ps1` and update `smbPassword` |
| `no-credentials` | the preset has no `smbUser` | add the account to `deployment.json` |
| `conflicting-session` | another account already holds a session with that server | sign out and in again, or `net use \\192.214.23.15\eNoteFiles /delete` |
| `share-missing` | the server answered, the share name is wrong | check the last part of `storageRoot` |
| `server-unreachable` | nothing answered on port 445 | check the server and the firewall rule (Step 2.4) |
| `access-denied` | the session opened, the account may not read the folder | grant Change on the share and Modify on the folder |
| `mount-required` | a Linux workstation | mount the share at boot, Step 6.3 |

> The password reaches `net use` as a command-line argument, so an administrator signed in to that
> same workstation can see it while the call runs. It is never written to the application log and
> never stored in the client's own settings — only in the deployment preset.

### Step 4.4: Migrate Existing Local Media (Optional)
If you have photos or documents currently on a local computer, migrate them to the server share:
```powershell
node scripts/migrate-resources.cjs --root "\\192.214.23.15\eNoteFiles" --apply
```

### Step 4.5: Organise Files Uploaded Before the Hierarchy (Optional)
Files uploaded by an earlier build sit directly in `documents\` and `library\`.
This script moves them into the curriculum / shelf folders and updates the
database rows. It is a dry run unless `--apply` is given:
```powershell
node scripts/organize-resources.cjs --root "\\192.214.23.15\eNoteFiles"
node scripts/organize-resources.cjs --root "\\192.214.23.15\eNoteFiles" --apply
```
The root can be omitted when the workstation already has `storage_config.json`
pointing at the share.

---

## 5. Client Application Packaging & Built Artifacts

### Step 5.1: Build Binaries
Build the offline client binaries from the repository root.

**Windows** (from a Windows x64 build machine):
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-offline.ps1
```
Or directly:
```bash
npm run build
npx electron-builder --win --x64
```

**Linux** (from a Linux x64 build machine, Node 22 or newer):
```bash
npm ci
npm run build:linux
```
Both platforms compile the same `out/` bundles from one source tree; only the packaged runtime and installer formats differ. A Windows machine cannot produce the AppImage or deb targets; from Windows, build the archive with `npm run build:linux:portable` and see Step 5.5 for the reason and the Linux-host alternatives.

### Step 5.2: Generated Artifacts & Locations
The build process produces two output directories:

1. **`dist/` (Packaged Distribution Executables)**:
   * **`dist/eNote Setup 1.0.0.exe` (~85.9 MB)**: Standard Windows NSIS installer. Recommended for workstations; installs per-user or machine-wide with Desktop & Start Menu shortcuts.
   * **`dist/eNote 1.0.0.exe` (~85.6 MB)**: Portable standalone executable. Runs immediately without installation or admin privileges.
   * **`dist/win-unpacked/`**: Unpacked application directory containing `eNote.exe` and bundled dependencies.
   * **`dist/linux-unpacked/`**: Unpacked Linux application directory containing `enote` and bundled dependencies.
   * **`dist/enote-1.0.0-x86_64.AppImage`**: Linux AppImage, a single portable file. `chmod +x` it and run; no installation or root access required.
   * **`dist/enote_1.0.0_amd64.deb`**: Debian/Ubuntu package. Install with `sudo apt install ./dist/enote_1.0.0_amd64.deb`; it registers the `enote` command, a menu entry (category *Education*) and the application icons.
   * **`dist/enote-1.0.0-x64.tar.gz`**: Archive of the unpacked Linux application. Extract it and run `./enote-1.0.0-x64/enote`; keep the directory together.

2. **`out/` (Compiled Electron/Vite Bundles)**:
   * **`out/main/index.js`**: Compiled Electron main process with deployment configuration loader and local database handlers.
   * **`out/preload/index.mjs`**: Preload bridge with IPC connection testing and database status APIs.
   * **`out/renderer/`**: Built frontend UI assets (HTML, CSS, JS, and bundled `.woff2` font files).

### Step 5.3: Bundled Offline Resources Inspection
In `dist/win-unpacked/resources/` or `dist/linux-unpacked/resources/` (and inside the packaged installer, deb or AppImage):
* **`resources/fonts/`**: Contains offline Latin & Arabic typography (*Instrument Sans*, *Instrument Serif*, *JetBrains Mono*, *Noto Naskh Arabic*).
* **`resources/deployment.json.example`**: Preset configuration template.
* **`resources/app.asar`**: Packaged application code.
* **`resources/apparmor-profile`**: Linux only; the deb installs it so the Chromium sandbox works on Ubuntu 24 and newer.

### Step 5.4: Publish an Application Update
eNote updates each workstation itself: when the server requires a newer version, a Windows client copies the published installer from the LAN share, checks it against a published checksum, and confirms it with the user in a single click. Nothing has to be installed by hand and nothing is downloaded from the internet. Build the new installer on a connected build machine, then transfer it to the isolated LAN by USB or the server share. Windows uses a Windows x64 build machine (`npx electron-builder --win --x64`); Linux uses a Linux x64 build machine (`npm run build:linux`); Linux workstations still update manually (see the end of this step).

1. Choose a new application version. From the project root on the build machine, increment the patch version (for example, `1.0.0` to `1.0.1`):
   ```powershell
   npm version patch --no-git-tag-version
   ```
   Use `npm version minor --no-git-tag-version` or `major` when appropriate. Keep the updated `package.json` and `package-lock.json` with the release source.
2. Build and package:
   ```powershell
   npm ci
   npm run build
   npx electron-builder --win --x64
   ```
3. Test the new installer on one workstation first. Confirm the application starts, connects to PostgreSQL, and can access shared media.
4. Copy the versioned installer (`dist\eNote Setup <version>.exe`) to the `installers` folder on the server share, `\\<server>\eNoteFiles\installers\`. Do not rename it: the manifest in the next step refers to it by name.
5. Write the manifest `latest.json` in that same folder. It tells every workstation which file to download and lets it prove the copy is intact:
   ```powershell
   $v = "4.0.1"
   $f = "eNote Setup $v.exe"
   @{ version = $v; file = $f; sha256 = (Get-FileHash ".\dist\$f" -Algorithm SHA256).Hash.ToLower() } |
     ConvertTo-Json | Set-Content "\\<server>\eNoteFiles\installers\latest.json" -Encoding UTF8
   ```
   The `sha256` value is the whole point: a client refuses to run an installer that does not match it, so a half-copied or tampered file is discarded instead of installed.
6. Publish the version on the server (Settings → Required client version, Admin only). Enter the same version as the manifest (for example `4.0.1`) and save. The value is stored in the shared database, so every workstation reads it. Leave it empty to remove the gate.

**What happens on a workstation.** Each client compares its own version against the published one at startup and every 30 minutes. When it is older, it is replaced by a full-screen notice instead of the application; the installer is copied from the share in the background and verified, and then a single **Restart and update** click installs it silently — reusing the existing installation, keeping the connection settings — and starts eNote again. A client that cannot read the database keeps running and a client that cannot reach the share falls back to the **Open the installers folder** button, so an outage is never treated as "update required".

Publish in the order above: the installer, then the manifest, then the version. If the version is set before the file is on the share, workstations switch to the notice and wait for the file. To roll back, put the previous installer and manifest back and publish the older version number again (or clear the field). Keep the installer and its checksum for every release you publish.

On Linux workstations, update by replacing the AppImage file, upgrading the deb (`sudo apt install ./enote_<version>_amd64.deb`), or extracting the new archive over the old directory. Settings, the saved per-user connection (`pg_config.json`) and the `deployment.json` preset live outside the package in `~/.config/eNote/`, so they survive the replacement; the database and shared storage are unaffected.

Application updates do not replace the database backup/restore process; take a database backup before a release if its changes require database migrations. Do not run `schema.sql` as an application update. For the promotion safeguards, apply `23-drop-person-history.sql` first, then `24-restrict-promotion-delete.sql`, against the target database after taking a backup. `25-add-teacher-constraint-options.sql` adds the predefined hard/soft constraint list, seeds a starter set of nine windows (five hard blocks across an 08:00–17:00 day and four soft ones, each labelled in English, Arabic and French) so teachers can declare constraints immediately, and is additive and safe to re-run (existing windows are never overwritten); the application also creates those tables on first use, so running it is only needed to own the schema explicitly (`psql -U postgres -d eNote -f 25-add-teacher-constraint-options.sql`). `26-page-locks-per-role.sql` adds per-role page locks, and `27-person-roles-all-codes.sql` lifts the trigger that limited a person record to Teacher and Student; both are additive and safe to re-run. `28-notification-person-ids-bigint.sql` widens the notification triggers that still held a person id in a 32-bit variable — the direct-message, inbox-message, bug-status and exam-seat triggers — because an imported person id can exceed the int4 range and made every send fail with *integer out of range*; it recreates those functions with the same signatures and is safe to re-run. `29-add-uniform-size-options.sql` adds `student_parade_uniform.winter_skirt_size` (the winter skirt was missing from the record) and creates `uniform_size_option`, the enumeration of allowed sizes per uniform item that an administrator maintains in Settings → Registers → Uniform sizes; it clears any skirt size stored for a male student, is additive, and is safe to re-run. The application also creates the table and the column on first use, so running the file is only needed to own the schema explicitly (`psql -U postgres -d eNote -f 29-add-uniform-size-options.sql`). `30-drop-major-teacher-id.sql` drops the legacy `major.major_teacher_id` column and its foreign key: a major's teachers live in the `major_teacher` table, no application code reads or writes the column, every row holds NULL, and the only object that mentions it — the `app_teachers_of_major` function — is recreated without it in the same file; safe to re-run. `31-scheduler-department-scope.sql` makes a department responsible for one major category (`department.major_category_id`, required for new and updated rows) and gives schedulers a department scope in `user_department_scope`, combined with their teaching-category scope; existing scheduler accounts are backfilled with every existing department so nobody is locked out, and the file is additive and safe to re-run (`psql -U postgres -d eNote -f 31-scheduler-department-scope.sql`).

### Step 5.5: Linux Packaging Details
Linux packages come from the same electron-builder configuration as Windows (`build.linux` plus the `appImage` and `deb` target blocks in `package.json`), so one source tree serves both client platforms. Build and artifact names are in Steps 5.1 and 5.2; the platform specifics are:

* **Identity**: the executable is named `enote` (`linux.executableName`); the deb installs a `.desktop` launcher with category *Education* and the icons from `build/icons/`.
* **Window association**: `desktopName` plus `linux.syncDesktopName` tie the window to its launcher entry, so the icon, taskbar grouping and app name are correct instead of showing the generic Electron icon.
* **unpacked resources**: `dist/linux-unpacked/resources/` holds `app.asar`, `fonts/` (the bundled Latin and Arabic typefaces used by the UI and PDF reports), the app icons, `deployment.json.example` and the AppArmor profile.
* **Portability**: the AppImage is self-contained and needs no root access; the deb integrates with the system menu; the tar.gz is the unpacked directory for locked-down workstations.

#### Building from a Windows workstation
AppImage and deb cannot be assembled on a Windows host: the AppImage toolset electron-builder downloads needs a POSIX filesystem (the build stops with `EPERM ... symlink` or `mksquashfs ENOENT`), and the deb target requires `fpm`, which electron-builder does not ship for Windows. On Windows only the archive target is available:

```powershell
npm run build:linux:portable
```

For the Linux installers, run `npm run build:linux` on a Linux host, or in a Linux container/WSL2 with a Linux Node installation, with the project copied to a Linux filesystem so `node_modules` are Linux builds. Do not share a Windows `node_modules` with the Linux build.

#### Linux runtime notes
* Windows-only code paths are guarded (`setAppDetails`, toast notification XML, AppUserModelID registration), so they are skipped on Linux; notifications go through the standard Electron `Notification` API and need a notification daemon on the desktop.
* The frameless window, custom title bar and IPC window controls work as on Windows under X11. Some Wayland compositors ignore `-webkit-app-region: drag`, in which case the compositor's window-move shortcut can still move the window.
* Direct-message keys use Electron `safeStorage`, which maps to libsecret (GNOME Keyring) or KWallet on Linux. When no keyring is available the key file is stored unprotected in the app data folder (`~/.config/eNote/`) rather than blocking messaging.
* PostgreSQL is reached over TCP as on Windows; configure the server the same way, and keep the application on a writable local profile directory.

---

## 6. Client Workstation Deployment & Usage

### 6.1 Native Desktop vs Web Browser
**Important Note:** eNote is an **offline native Electron desktop application**, not a website running in a web browser.
* Each workstation (Director, Secretary, Teacher, Admin) runs the desktop program locally on Windows or Linux.
* All workstations connect concurrently over the LAN to PostgreSQL at `192.214.23.15:5432` and access shared files at `\\192.214.23.15\eNoteFiles`. Linux clients use the CIFS mount described in Step 6.3 in place of the UNC path.

### 6.2 Workstation Distribution Methods
Copy the built installer or portable executable to Windows workstations using either:
* **Network Share Distribution**: Copy `eNote Setup 1.0.0.exe` into `\\192.214.23.15\eNoteFiles\installers\`. Workstations open the share and double-click the installer.
* **USB Thumb Drive**: Copy `eNote Setup 1.0.0.exe` (or `eNote 1.0.0.exe`) to a USB drive and run on each workstation.

Linux workstations take their packages from the same `installers` folder on the share:
* **AppImage**: copy `enote-1.0.0-x86_64.AppImage` to the workstation (the user's home directory is ideal), then `chmod +x enote-1.0.0-x86_64.AppImage && ./enote-1.0.0-x86_64.AppImage`. No installation or root access is needed.
* **Debian/Ubuntu package**: `sudo apt install ./enote_1.0.0_amd64.deb`. This installs `/opt/eNote`, the `enote` command on `PATH`, the menu entry and the icons; `sudo dpkg -i` followed by `sudo apt -f install` achieves the same when apt is offline.
* **Portable archive**: copy `enote-1.0.0-x64.tar.gz`, extract it to a local folder, and run `./enote-1.0.0-x64/enote`. Extract to the local disk rather than running from the SMB share: the share can be slow to start and may not preserve the executable bit. Determine the architecture with `uname -m`; the packages are x86_64/amd64.

### 6.3 Workstation Configuration Methods

#### Method 1: Zero-Touch Machine Preset (`%ProgramData%\eNote\deployment.json`) [Recommended]
Deploy the configuration machine-wide so that **any user** logging into Windows gets an instantly working eNote connection without typing server IPs or passwords:

1. Install `eNote Setup 1.0.0.exe` on the workstation.
2. Make the `deploy\client` folder available on the workstation (for example, copy it from the project), then open **PowerShell as Administrator**. From the project folder containing `deploy`, run the preset installer script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy\client\install-preset.ps1 `
       -ServerHost "192.214.23.15" `
       -Port 5432 `
       -Database "eNote" `
       -User "enote_app" `
       -Password "YourPasswordHere" `
       -StorageRoot "\\192.214.23.15\eNoteFiles"
   ```
   *Or manually copy `deploy/client/deployment.json.example` to `C:\ProgramData\eNote\deployment.json` and adjust the fields.*

   The script securely prompts for the `enote_app` database password if `-Password` is omitted. To avoid the prompt, add `-Password "YOUR_DATABASE_PASSWORD"` before the final backtick (this exposes the password in PowerShell command history).

3. Confirm the script reports the expected server and database, then check that the machine-wide file exists:
   ```powershell
   Test-Path "$env:ProgramData\eNote\deployment.json"
   ```
   The result should be `True`. Test network access separately using the checks in Section 7.

4. When users start `eNote`, the login screen should show:
   `● Connected to 192.214.23.15`
   `eNote · 192.214.23.15:5432`

   A previously saved per-user database configuration (`pg_config.json`) takes precedence over the machine-wide preset. If a user configured a wrong connection earlier, correct it in **Server settings** or remove that user's saved configuration before retrying.

#### Method 2: Portable Executable on Shared Drive or USB
1. Place `eNote 1.0.0.exe` in a shared folder or USB stick.
2. Place `deployment.json` in the same directory alongside `eNote 1.0.0.exe`.
3. Launching the executable automatically picks up the preset.

#### Method 3: Pre-Login Interactive Configuration
If a workstation is started without a preset:
1. The Login screen displays:
   `● Not connected`
2. Click **Server settings** below the sign-in form.
3. Enter:
   - **Host**: `192.214.23.15`
   - **Port**: `5432`
   - **Database**: `eNote`
   - **User**: `enote_app`
   - **Password**: *(your password)*
4. Click **Connect**.
5. Once verified, the connection is saved to the local profile (`pg_config.json`) and the user can sign in immediately.

#### Method 4: Linux Preset (`deployment.json`) and SMB Mount
Linux clients use the same `deployment.json` schema as Windows. They read the preset in this order:

1. the file named by `$ENOTE_DEPLOYMENT_FILE` (technician override),
2. `%ProgramData%\eNote\deployment.json` (only where that variable exists, i.e. Windows),
3. `deployment.json` next to the executable — for the deb that is `/opt/eNote/deployment.json`,
4. `~/.config/eNote/deployment.json` (per-user),
5. `deployment.json` in the bundled resources directory.

For a **machine-wide preset after installing the deb** (any user who launches eNote inherits it):
```bash
sudo install -m 644 deploy/client/deployment.json.example /opt/eNote/deployment.json
sudo nano /opt/eNote/deployment.json
```
For **AppImage and portable archive** installs the executable sits in a temporary mount or in the user's home, so use the per-user file:
```bash
mkdir -p ~/.config/eNote
cp deploy/client/deployment.json.example ~/.config/eNote/deployment.json
chmod 600 ~/.config/eNote/deployment.json
```
Example file pointing at the LAN server and the mounted share:
```json
{
  "host": "192.214.23.15",
  "port": 5432,
  "database": "eNote",
  "user": "enote_app",
  "password": "CHANGE_ME_PASSWORD",
  "ssl": false,
  "storageRoot": "/mnt/enote"
}
```

`storageRoot` must be a **POSIX path** on Linux. The client uses `path.join`, so a `\\192.214.23.15\eNoteFiles` UNC path does not work there; mount the share and point the setting at the mount point instead:
```bash
sudo apt install cifs-utils
sudo mkdir -p /mnt/enote
printf 'username=enote_app\npassword=YOUR_SMB_PASSWORD\n' | sudo tee /etc/enote-smb.credentials >/dev/null
sudo chmod 600 /etc/enote-smb.credentials
sudo mount -t cifs //192.214.23.15/eNoteFiles /mnt/enote -o credentials=/etc/enote-smb.credentials,uid=$(id -u),gid=$(id -g),vers=3.0,iocharset=utf8
```
Add the same line to `/etc/fstab` with `nofail` so the mount returns after a reboot. The `uid`/`gid` options are what let the desktop user read and write photos and documents; without them uploads fail with a permission error.

For a fleet of Linux workstations, set the machine-wide location once and point every launch at it:
```bash
sudo mkdir -p /etc/enote
sudo cp deploy/client/deployment.json.example /etc/enote/deployment.json
# then launch with the override, e.g. Exec=env ENOTE_DEPLOYMENT_FILE=/etc/enote/deployment.json /opt/eNote/enote
```
Environment variables (`ENOTE_DB_HOST`, `ENOTE_DB_PORT`, `ENOTE_DB_NAME`, `ENOTE_DB_USER`, `ENOTE_DB_PASSWORD`, `ENOTE_RESOURCE_ROOT`, `ENOTE_DEPLOYMENT_FILE`) override the preset, so a technician can fix a bad host without editing files. A connection saved from the login screen (`~/.config/eNote/pg_config.json`) still takes precedence over the preset.

### 6.4 Staff Workflows & Daily Operations by Role
There is no public user registration. The **Administrator** provisions accounts for all staff members under **Settings -> User accounts**:

* **Administrator**:
  - Manages staff user accounts and assigns roles (`ADMIN`, `DIRECTOR`, `SECRETARY`, `TEACHER`).
  - Resets forgotten staff passwords (via *Settings -> User passwords*).
  - Unlocks/reactivates accounts suspended after consecutive failed sign-in attempts (via *Administration -> Suspended accounts*).
  - Monitors database connectivity status and configuration.

* **Secretary**:
  - Registers new students and updates demographic information.
  - Uploads student ID photos directly (saved to `\\192.214.23.15\eNoteFiles\person_photos`).
  - Manages student section assignments and class rosters.
  - Uploads and files educational documents and lesson resources.

* **Teacher**:
  - Consults their assigned weekly class schedule.
  - Records student classroom attendance and marks session absences.
  - Logs pedagogical observations and conduct notes.
  - Checks teaching scope and class rosters.

* **Director**:
  - Conducts full institutional oversight through the **Student History** dashboard (academic dossier, attendance analytics, timeline view).
  - Manages student rewards and punishments, suspensions, and conduct logs.
  - Generates and prints official student PDF reports (utilizing locally embedded typography with zero internet dependencies).
  - Broadcasts internal notifications and communications.

### 6.5 Real-Time Data & Media Synchronization
* **Database Concurrency**: Multiple workstations can read and write simultaneously. When a teacher logs an absence or a secretary enrolls a student, PostgreSQL handles concurrent transactions cleanly, and the Director sees updated records immediately.
* **Central Media Storage**: Photos, lesson documents, Library documents, and bug report screenshots are saved to the UNC path `\\192.214.23.15\eNoteFiles\`. The database stores relative keys whose file names carry the record's information (`person_photos/<PERSON_ID>_<first name LA>_<last name LA>_<first name AR>_<last name AR>_<timestamp>.png`, `documents/<MAJOR_CODE>/<CHAPTER_CODE>/<LESSON_CODE>/<codes>_<labels>_<original name>_<timestamp>`, `library/<TYPE_CODE>/<CATEGORY_CODE>/<TYPE>_<CATEGORY>_<title>_<original name>_<timestamp>`), ensuring no absolute local paths break across different computers and a file opened on the share is identifiable without the database.
* **Workstation-Local Preferences**: Each workstation (Windows or Linux) independently maintains its own preferred interface language (Arabic RTL, French, or English) and theme (Dark/Light).

### 6.6 Working While the Server Is Unreachable

The server at `192.214.23.15` can go down — a reboot, a failed disk, a switch — while the workstations stay on. eNote then switches to **read-only saved records** instead of failing:

* Every record a workstation has already loaded is kept in a local SQLite file (`offline-cache.sqlite`, in that user's eNote application-data folder) and stays readable, together with the time its copy was taken. After each sign-in the client also pre-loads the student register, sections, majors, departments, grades, session types and time slots, so the usual pages open without a previous visit in the same session.
* An amber strip under the title bar reads **Offline — showing saved records** with the saved-copy time, and the database chip reads **Records unavailable** with a **Reconnect** button. **What's saved** on that strip lists the records, photographs and session rosters held on the computer, with how much room they take and the time each copy was taken.
* **Attendance and absences can still be recorded.** A teacher's absence, a "mark present", a behavioural observation and a "session was held" confirmation go into a local queue (`offline-outbox.sqlite`, beside the read cache) and are sent, oldest first, as soon as the server answers. A chip in the title bar shows how many are waiting and opens the list. Each teacher's sessions for the coming week — roster, absences, observations and register — are read after sign-in, so a class that was never opened on that workstation is still markable during an outage; the class in progress is found from that saved list when the server cannot answer.
* **A queued change never overwrites a colleague's.** Each entry remembers the record the teacher saw. On reconnect the server compares that with the record as it is now: unchanged means the change is applied; already in the desired state means nothing to do; changed in the meantime means the entry is **not** applied and is shown as a conflict with both versions side by side (*Keep mine* / *Keep server*). Nothing is merged field by field, because attendance is one decision per student per session. Observations are additive, so two observations for the same student in one session are both kept, and a queued one is sent as written. Deleting an observation offline follows the same rule as an absence: the note the teacher saw is remembered, and if that row now says something else the deletion is held for review instead of removing a colleague's edit. Unsent work is treated as part of the register on both the Attendance and the Observations pages: a student marked absent offline is shown absent — and cannot be observed — before the queue is sent.
* **Everything else is refused while the server is down** — student records, marks, settings. A save attempt reports that it was not kept, so no other kind of change can be lost silently. Those records stay readable and the change is made again after reconnecting.
* Student photos that have been displayed are cached locally (`offline-media/`), so rosters and printed reports stay complete. A PDF report is built from the cached records; a block whose records were never opened on that workstation prints as empty.
* Signing in works offline for **the account that signed in last on that workstation**, with the password it used. The saved value is the bcrypt hash the database already holds, encrypted with the operating-system key store where one is available; five wrong passwords lock offline sign-in until the server answers. A workstation that has never signed in still needs the server for its first sign-in.
* Documents and Library files live only on the share, so they are unavailable during an outage. The cache covers photos (thumbnails and reports) rather than the whole share, which would mean copying every workstation's material nightly.
* When the server returns, the client notices within 20 seconds (or immediately with **Reconnect**), sends the queue and reads live records again. Anything somebody else changed in the meantime is listed for review rather than applied over their version, and a short message reports how many changes were sent and how many need review.

---

## 7. Verification Checklist

Execute these checks after setting up the first client workstation:

| # | Check | Command / Action | Expected Result |
|---|-------|------------------|-----------------|
| 1 | Server Ping | `ping 192.214.23.15` | Reply from `192.214.23.15` |
| 2 | Port 5432 Reachable | `Test-NetConnection 192.214.23.15 -Port 5432` | `TcpTestSucceeded : True` |
| 3 | SMB Share Accessible | `Test-Path "\\192.214.23.15\eNoteFiles"` | `True` |
| 4 | Pre-login Badge | Launch eNote | Green dot: `Connected to 192.214.23.15` |
| 5 | Sign In | Enter `admin` / `admin` | Navigates to Dashboard |
| 6 | Offline Fonts & Arabic | Open Student Records or Personnel | Arabic and Latin typography renders crisply |
| 7 | Offline PDF Report | Student Records -> Generate PDF Report | Report opens in PDF reader with correct layout and embedded fonts |
| 8 | Photo Upload | Upload student or personnel photo | Image appears and file is stored in `\\192.214.23.15\eNoteFiles\person_photos` |

The same checks on a Linux workstation:

| # | Check | Command / Action | Expected Result |
|---|-------|------------------|-----------------|
| 1 | Server Ping | `ping -c 3 192.214.23.15` | 3 packets transmitted, 0% packet loss |
| 2 | Port 5432 Reachable | `nc -zv 192.214.23.15 5432` or `pg_isready -h 192.214.23.15 -p 5432` | `succeeded` / `accepting connections` |
| 3 | Shared Storage Mounted | `ls /mnt/enote` after the CIFS mount from Step 6.3 | The photo and document folders are listed |
| 4 | Pre-login Badge | Launch `enote` or `./enote-1.0.0-x86_64.AppImage` | Green dot: `Connected to 192.214.23.15` |
| 5 | Sign In | Enter `admin` / `admin` | Navigates to Dashboard |
| 6 | Offline Fonts & Arabic | Open Student Records or Personnel | Arabic and Latin typography renders crisply |
| 7 | Offline PDF Report | Student Records -> Generate PDF Report | Report opens with correct layout and embedded fonts |

---

## 8. Backup & Maintenance

### Daily Automated Backup (Server Scheduled Task)
Schedule `backup-db.ps1` to run nightly at 23:00 via Windows Task Scheduler:

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -File C:\eNoteDeploy\server\backup-db.ps1 -BackupDir D:\Backups\eNote -KeepDays 30"
$trigger = New-ScheduledTaskTrigger -Daily -At 23:00
Register-ScheduledTask -TaskName "eNote Database Backup" -Action $action -Trigger $trigger -User "SYSTEM" -RunLevel Highest
```

### Manual Disaster Recovery
To restore a backup file to `192.214.23.15`:
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\server\restore-db.ps1 -BackupFile "D:\Backups\eNote\eNote_backup_20261103.dump"
```

---

## 9. Troubleshooting Common Issues

### Issue 1: "Connection refused" / Red "Not connected" badge
- **Cause**: PostgreSQL is stopped, listening only on `localhost`, or Windows Firewall is blocking port 5432.
- **Fix**:
  1. On server: `Get-Service postgresql*` (ensure status is `Running`).
  2. Verify `postgresql.conf` contains `listen_addresses = '*'`.
  3. Run `.\deploy\server\setup-firewall.ps1` as Administrator.

### Issue 2: "FATAL: no pg_hba.conf entry for host ..."
- **Cause**: The client IP address is not included in `pg_hba.conf`.
- **Fix**: Check the client IP address (`ipconfig`). Add its subnet (e.g. `192.214.23.0/24`) to `pg_hba.conf` and reload PostgreSQL (`pg_ctl reload` or restart service).

### Issue 3: "Password authentication failed for user enote_app"
- **Cause**: Password mismatch or method mismatch (SCRAM-SHA-256 vs MD5).
- **Fix**: Reset user password on the server:
  ```sql
  ALTER ROLE enote_app WITH PASSWORD 'NewPasswordHere';
  ```
  Update `deployment.json` on client machines.

### Issue 4: Photos or documents fail to upload
- **Cause**: Workstation lacks write permissions to `\\192.214.23.15\eNoteFiles`.
- **Fix**: Open folder Properties on the server -> **Sharing** -> **Permissions** (grant Full Control to network users) and **Security** (grant Modify).
- **Linux**: the share must be mounted read-write at the path configured as `storageRoot`. Check it with `mount | grep enote`; if the mount is missing, remount it with the command in Step 6.3, and if it is shown as `ro` use `sudo mount -o remount,rw /mnt/enote`. Verify the mount options include `uid`/`gid` for the desktop user, otherwise the app can read the share but not write to it.

---

## 10. Coexistence with Existing Server Stacks (WampServer / Apache / MySQL / PHP)

If the central server (`192.214.23.15`) is already hosting another web application (such as a PHP application running on **WampServer**), **eNote can safely run on the same machine without conflicts**.

### 10.1 Port & Protocol Matrix

The two application stacks use completely disjoint network ports and protocols:

| Service / Component | Running Stack | Ports | LAN Conflict? |
| :--- | :--- | :--- | :---: |
| **Apache HTTP Server** | WampServer (PHP Web App) | **80** (HTTP), **443** (HTTPS) | ❌ None |
| **MySQL / MariaDB** | WampServer | **3306** (or 3307/3308) | ❌ None |
| **PostgreSQL Database** | **eNote** | **5432** (TCP) | ❌ None |
| **Windows File Sharing (SMB)** | **eNote** (photos, documents, logs) | **445** (TCP / Native Windows OS) | ❌ None |

> **Key Architectural Distinction**:
> eNote **does not run a web server** on the host. eNote is an offline desktop application running on client workstations. Workstations connect directly to **PostgreSQL (port 5432)** for data queries and **SMB (port 445)** for media files. The server's web ports (80/443) and PHP runtime are untouched.

### 10.2 Service & Process Isolation

Each stack runs as independent Windows services:

* **WampServer services**: `wampapache64` (Apache), `wampmysqld64` (MySQL) or `wampmariadb64`.
* **eNote services**: `postgresql-x64-<version>` (official PostgreSQL service) and `LanmanServer` (built-in Windows file sharing).

Both database engines manage their own distinct process memory, configuration files, and data directories.

### 10.3 Storage & File System Isolation

* WampServer serves web assets from `C:\wamp64\www\...`
* eNote shared media resides in a separate dedicated directory (e.g., `C:\eNoteFiles`, shared as `\\192.214.23.15\eNoteFiles`).
* Neither application accesses or interferes with the other's directory tree.

### 10.4 Windows Firewall Rules

Running [`deploy/server/setup-firewall.ps1`](./server/setup-firewall.ps1):
* Opens inbound traffic strictly on **TCP 5432** (PostgreSQL).
* Enables standard Windows **File and Printer Sharing** (SMB 445).
* It **does not alter or block** existing rules for Apache (ports 80 / 443) or MySQL (port 3306).

### 10.5 Deployment Recommendations & Pre-Checks

1. **Verify Port 5432 Availability Before Installation**:
   Standard WampServer installs do not bundle PostgreSQL, but to verify that port 5432 is completely free on the server, run:
   ```powershell
   Get-NetTCPConnection -LocalPort 5432 -ErrorAction SilentlyContinue
   ```
   If no output is returned, the port is available.

2. **Server RAM & Memory Sizing**:
   Both MySQL and PostgreSQL will maintain in-memory buffer pools simultaneously:
   * eNote's recommended settings in `deploy/server/postgresql.conf.snippet` allocate a conservative memory footprint (`shared_buffers = 512MB`, `work_mem = 16MB`).
   * A physical or virtual server with **8 GB RAM or more** will comfortably host WampServer (Apache + MySQL + PHP) and eNote (PostgreSQL + SMB) under active concurrent usage.
