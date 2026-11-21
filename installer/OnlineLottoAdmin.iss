; Online Lotto Admin - Windows x64 installer
; Build from the repository root after `dotnet publish` creates installer\publish.

#define AppName "Online Lotto Admin"
#define AppVersion "1.0.0"
#define AppPublisher "Online Lotto"
#define AppExeName "OnlineLottoAdmin.exe"

[Setup]
AppId={{2A9B5936-9C44-4A77-9A77-22F69B7F2F19}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\Online Lotto Admin
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=Online-Lotto-Admin-Setup-{#AppVersion}
SetupIconFile=..\online-admin-wpf\Assets\app.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}
VersionInfoVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
