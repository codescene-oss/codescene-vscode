# VS Code + Playwright (CDP) NUnit tests

This project starts a VS Code (portable ZIP) instance, attaches Playwright via the VS Code Chromium DevTools (CDP) endpoint and uses PageObjects to verify scenarios.

## Prerequisites

- .NET SDK installed
- A **portable/extracted VS Code ZIP** folder containing `Code.exe` (from https://code.visualstudio.com/Download#)
- Playwright browsers installed for your environment

## Configure

### YAML environment config

Test environment settings are loaded from:

- `vscodetest.yml` (baseline, committed)
- `local.yml` (optional override, ignored by git)

`local.yml` overrides only the keys it specifies.

Schema (high-level):

- `vscode.installdir`
- `vscode.extensionsdir`
- `vscode.cdpreadytimeout`
- `vscode.timeout.short`
- `vscode.window.{x,y,width,height}`
- `extension.{name,id,authToken}`

### VS Code portable install

The tests expect an **extracted VS Code ZIP** under:

- `.vscode-test/VSCode-win32-x64/Code.exe`

This path is resolved relative to the project folder containing the `.csproj`.


### VS Code window size/position

The test harness enforces a deterministic VS Code window location/size during setup.

- Configured in [VsCodeTestBase.cs](VsCodeTestBase.cs) inside `Setup()` via `sessionOptions.WindowX/WindowY/WindowWidth/WindowHeight`.

Mechanisms used (in order):

- Renderer JS: [VsCodePlaywright/VsCodeDriver.cs](VsCodePlaywright/VsCodeDriver.cs) calls `window.moveTo(x,y)` + `window.resizeTo(w,h)` inside the VS Code renderer page.
- CDP fallback: if the renderer path is blocked/ignored, it falls back to `Browser.getWindowForTarget` + `Browser.setWindowBounds`.

Important behavioral constraints:

- If the window is maximized or fullscreen, the OS/window manager may ignore or override size/position requests.
- Arguments are in “CSS pixels” (HiDPI displays will be scaled by Chromium).
- Multi-monitor coordinates are global screen coordinates; negative values can be valid depending on monitor arrangement.
- Some Linux/Wayland environments may restrict programmatic window positioning.


### VS Code extensions (local)

The test harness starts VS Code with a persistent extensions directory so you can deploy a VSIX once and have tests pick it up:

- Extensions directory: `.vscode-test/extensions`
- Tests start VS Code with `--extensions-dir` pointing at that folder (see [VsCodeTestBase.cs](VsCodeTestBase.cs)).

The harness also isolates VS Code app data via `VSCODE_APPDATA` (see below) so the test instance does not use the host user's
`%APPDATA%\Code` (including `%APPDATA%\Code\extensions`).

## Build VSIX locally

In the git root, build the VSIX locally. See [BUILD_LOCAL.md](../BUILD_LOCAL.md)

## Download the latest VSIX from the Marketplace

```powershell
$publisher="CodeScene";$ext="codescene-vscode";$platform="win32-x64";$body=@{filters=@(@{criteria=@(@{filterType=7;value="$publisher.$ext"})});flags=914}|ConvertTo-Json -Depth 10;$r=Invoke-RestMethod -Method Post -Uri "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" -Headers @{Accept="application/json;api-version=7.1-preview.1"} -ContentType "application/json" -Body $body;$v=$r.results[0].extensions[0].versions[0].version;$u="https://marketplace.visualstudio.com/_apis/public/gallery/publishers/$publisher/vsextensions/$ext/$v/vspackage?targetPlatform=$platform";Invoke-WebRequest -Uri $u -OutFile "codescene.codescene-vscode-$v-$platform.vsix"
```

POSIX shell equivalent (requires `python3` + `curl`):

```sh
publisher="CodeScene"; ext="codescene-vscode"; platform="win32-x64"; v="$(python3 -c 'import json,urllib.request; body=json.dumps({"filters":[{"criteria":[{"filterType":7,"value":"CodeScene.codescene-vscode"}]}],"flags":914}).encode(); req=urllib.request.Request("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", data=body, headers={"Content-Type":"application/json","Accept":"application/json;api-version=7.1-preview.1"}); r=json.load(urllib.request.urlopen(req)); print(r["results"][0]["extensions"][0]["versions"][0]["version"])')"; curl -L "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/$publisher/vsextensions/$ext/$v/vspackage?targetPlatform=$platform" -o "codescene.codescene-vscode-$v-$platform.vsix"
```

## Install a VSIX into that directory

```powershell
& ".\.vscode-test\VSCode-win32-x64\bin\code.cmd" --install-extension ".\codescene.codescene-vscode-0.25.0-win32-x64.vsix" --force --extensions-dir ".\.vscode-test\extensions"
```

POSIX shell equivalent:

```sh
./.vscode-test/VSCode-win32-x64/bin/code --install-extension ./codescene.codescene-vscode-0.25.0-win32-x64.vsix --force --extensions-dir ./.vscode-test/extensions
```

### VS Code user profile (`userDataDir`)

The harness starts VS Code with a **fresh temporary user profile directory** per test run:

- VS Code argument: `--user-data-dir="..."`
- Variable name in code: `userDataDir` in [VsCodePlaywright/VsCodeDriver.cs](VsCodePlaywright/VsCodeDriver.cs)

Why this exists:

- **Isolation / repeatability:** avoids inheriting random state from your real VS Code profile.
- **Deterministic configuration:** the harness can write `User/settings.json` in that directory *before VS Code starts*.
- **Cleanup:** the directory is created under `%TEMP%` and deleted at the end of the session.

This is also how extension configuration is injected without UI automation. If `extension.authToken` is set in YAML, the test harness writes it into VS Code user settings as:

- `codescene.authToken` (in the test profile’s `User/settings.json`)

Note: CDP is great for window/page automation, but it is not a supported way to call extension-host VS Code APIs directly. Pre-seeding settings is the stable approach for tests.


### VS Code app data (`VSCODE_APPDATA`)

In addition to the Chromium/Electron profile (`--user-data-dir`), VS Code maintains its own *app data root* under the user's roaming profile
(on Windows this is typically `%APPDATA%\Code`).

To prevent tests from reading/writing the developer machine's VS Code state, the harness sets the `VSCODE_APPDATA` environment variable for the
spawned VS Code process to a **fresh temporary directory** per test run.

Effects:

- VS Code will not use the host user's `%APPDATA%\Code`.
- Extensions/state/settings that normally live under that tree won't leak into the test run.
- The directory is created under `%TEMP%` and deleted at the end of the session.


## Install Playwright browsers (one-time)

From this folder:

```powershell
pwsh -Command "dotnet tool restore"  # if you use local tools (optional)
# Recommended:
dotnet build
pwsh -Command "& dotnet playwright install"
```

If you don’t have `pwsh`, you can run `dotnet playwright install` from PowerShell as well.

## Run tests

```powershell
dotnet test
```

## Allure HTML report

This project is configured to produce Allure results into:

- `report/allure-results/`

### How Allure is wired into the tests

Allure reporting is enabled through a few “hooks” in the code:

- **Adapter hook (NUnit):** the base class [VsCodeTestBase.cs](VsCodeTestBase.cs) is annotated with `[AllureNUnit]`. Because all test fixtures inherit from this base class, Allure is enabled for the whole suite.
- **Results directory:** [allureConfig.json](allureConfig.json) configures `allure.directory` (where Allure NUnit writes `*-result.json` files). The config file is copied to the test output folder by [csharp.csproj](csharp.csproj) so the adapter can find it at runtime.
- **Attachments (screenshots):** on test failure, teardown captures a VS Code screenshot and saves it to `report/screenshots/`, then attaches the PNG to the current Allure test result via `AllureApi.AddAttachment(...)` in [VsCodePlaywright/Utils.cs](VsCodePlaywright/Utils.cs).

### 1) Install Allure CLI (Windows)

Allure CLI requires Java.

If you use Scoop:

```powershell
scoop install allure
```

### 2) Run tests (generates results)

```powershell
dotnet test
```

### 3) Generate and view HTML report

Generate a persistent HTML report:

```powershell
allure generate .\report\allure-results -o .\report\allure-html --clean --single-file
```

If `allure` is not on your PATH, you can run it via Node.js without installing anything globally:

```powershell
npx -y allure-commandline generate .\report\allure-results -o .\report\allure-html --clean --single-file
```

Open the generated report:

```powershell
allure open .\report\allure-html
```

Or via `npx`:

```powershell
npx -y allure-commandline open .\report\allure-html
```

Note: don’t double-click/open `report\allure-html\index.html` directly. Most browsers restrict local `file://` pages from loading the report’s JSON data, so the UI can look empty. Use `allure open` / `allure serve` (starts a local web server), or generate a single-file report:

```powershell
npx -y allure-commandline generate .\report\allure-results -o .\report\allure-html --clean --single-file
```

Tip: `allure serve .\report\allure-results` builds + opens a temporary report.

## Code

- Helper library: `VsCodePlaywright/`
- NUnit test: `VSC.test1.cs`

## Debug

Att a debug breakpoint, it's possible to

```
Utils.DumpVsCodeDom(Page, "breakpoint", Logger, includeFrames: true, includeMhtmlSnapshot: true), run-all-threads
```
