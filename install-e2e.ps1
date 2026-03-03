param(
    [Parameter(Mandatory = $false)]
    [string]$VsixPath,
    [Parameter(Mandatory = $false)]
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path $PSScriptRoot).Path
$vscodeTest = Join-Path $repoRoot 'e2e\.vscode-test'
$extensionsDir = Join-Path $vscodeTest 'extensions'

Write-Host "Setting up e2e test environment..." -ForegroundColor Cyan
Write-Host ""

New-Item -ItemType Directory -Force -Path $extensionsDir | Out-Null

function Get-VersionFromVsix($path) {
    $tempDir = Join-Path $env:TEMP "vsix-read-$(New-Guid)"
    try {
        Expand-Archive -Path $path -DestinationPath $tempDir -Force
        $pkgPath = Join-Path $tempDir 'extension\package.json'
        if (-not (Test-Path $pkgPath)) { $pkgPath = Join-Path $tempDir 'package.json' }
        (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
    }
    finally {
        if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
    }
}

if ($VsixPath) {
    Write-Host "[1/2] Extension VSIX: using local file" -ForegroundColor Yellow
    $vsixSource = $PSCmdlet.SessionState.Path.GetUnresolvedProviderPathFromPSPath($VsixPath)
    if (-not (Test-Path $vsixSource)) { throw "Vsix not found: $vsixSource" }
    $version = Get-VersionFromVsix $vsixSource
    $vsixDest = Join-Path $extensionsDir "codescene.codescene-vscode-$version@win32-x64.vsix"
    Copy-Item -Force $vsixSource $vsixDest
    Write-Host "      Copied to $vsixDest" -ForegroundColor Gray
}
else {
    $publisher = 'CodeScene'
    $ext = 'codescene-vscode'
    $platform = 'win32-x64'
    $body = @{ filters = @(@{ criteria = @(@{ filterType = 7; value = "$publisher.$ext" }) }); flags = 914 } | ConvertTo-Json -Depth 10
    $r = Invoke-RestMethod -Method Post -Uri 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' -Headers @{ Accept = 'application/json;api-version=7.1-preview.1' } -ContentType 'application/json' -Body $body
    $v = $r.results[0].extensions[0].versions[0].version
    $vsixDest = Join-Path $extensionsDir "codescene.codescene-vscode-$v@win32-x64.vsix"
    if ((Test-Path $vsixDest) -and -not $Clean) {
        Write-Host "[1/2] Extension VSIX: skipping download (already have latest $v)" -ForegroundColor Yellow
        Write-Host "      $vsixDest" -ForegroundColor Gray
        Write-Host "      Run with -Clean to force re-download." -ForegroundColor DarkGray
    }
    else {
        if ($Clean -and (Test-Path $vsixDest)) { Remove-Item -Force $vsixDest }
        Write-Host "[1/2] Extension VSIX: downloading $v from Marketplace..." -ForegroundColor Yellow
        $u = "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/$publisher/vsextensions/$ext/$v/vspackage?targetPlatform=$platform"
        Invoke-WebRequest -Uri $u -OutFile $vsixDest -UseBasicParsing
        Write-Host "      Saved to $vsixDest" -ForegroundColor Gray
    }
}
Write-Host ""

$vscodeDir = Join-Path $vscodeTest 'VSCode-win32-x64'
$codeExe = Join-Path $vscodeDir 'Code.exe'
Write-Host "[2/2] VS Code (win32-x64):" -ForegroundColor Yellow
if ($Clean -and (Test-Path $vscodeDir)) {
    Remove-Item -Recurse -Force $vscodeDir
}
if (Test-Path $codeExe) {
    Write-Host "      Skipping download (already present at $vscodeDir)" -ForegroundColor Gray
    Write-Host "      Run with -Clean to force re-download." -ForegroundColor DarkGray
}
else {
    Write-Host "      Downloading latest stable..." -ForegroundColor Gray
    $zipPath = Join-Path $vscodeTest 'vscode-win32-x64.zip'
    Invoke-WebRequest -Uri 'https://update.code.visualstudio.com/latest/win32-x64-archive/stable' -OutFile $zipPath -UseBasicParsing
    if (Test-Path $vscodeDir) { Remove-Item -Recurse -Force $vscodeDir }
    New-Item -ItemType Directory -Force -Path $vscodeDir | Out-Null
    Write-Host "      Extracting..." -ForegroundColor Gray
    Expand-Archive -Path $zipPath -DestinationPath $vscodeDir -Force
    Remove-Item -Force $zipPath
    Write-Host "      Done. Installed to $vscodeDir" -ForegroundColor Gray
}
Write-Host ""
Write-Host "e2e environment ready. Run: dotnet test e2e/csharp.csproj" -ForegroundColor Green
