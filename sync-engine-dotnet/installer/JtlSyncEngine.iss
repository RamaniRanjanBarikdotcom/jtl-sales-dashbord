#define AppName "JTL Sync Engine"
#define AppVersion GetEnv("SYNC_ENGINE_VERSION")
#define SourceRoot GetEnv("SYNC_ENGINE_STAGE")

[Setup]
AppId={{C89F1AB0-6DF3-49F1-A292-C6AC780B4260}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\JTL Sync Engine
DefaultGroupName={#AppName}
OutputDir=..\..\artifacts
OutputBaseFilename=JtlSyncEngine-Installer-win-x64
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin

[Files]
Source: "{#SourceRoot}\service\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs
Source: "{#SourceRoot}\ui\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs
Source: "{#SourceRoot}\service-tools\*"; DestDir: "{app}\service-tools"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\JTL Sync Engine Management"; Filename: "{app}\JtlSyncEngine.exe"
Name: "{autodesktop}\JTL Sync Engine"; Filename: "{app}\JtlSyncEngine.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service-tools\install-service.ps1"" -InstallDirectory ""{app}"""; Flags: runhidden waituntilterminated
Filename: "{app}\JtlSyncEngine.exe"; Description: "Open JTL Sync Engine"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service-tools\uninstall-service.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveJtlSyncEngineService"
