# Building VSIX Locally for Testing

## Quick Start

### 1. Switch to Node.js 20+ (Required)

Since `vsce` requires Node.js 20+, you need to switch versions:

```bash
# If using nvm (recommended)
nvm use 20

# Verify Node version
node --version
# Should show: v20.x.x
```

### 2. Build VSIX for Your Platform

Determine your platform:
- **macOS Intel**: `darwin x64`
- **macOS Apple Silicon**: `darwin arm64`
- **Linux x64**: `linux x64`
- **Linux ARM64**: `linux arm64`
- **Windows x64**: `win32 x64`

Then run:

```bash
npm run package-platform -- <platform> <arch>
```

**Examples:**
```bash
# macOS Apple Silicon (M1/M2/M3)
npm run package-platform -- darwin arm64

# macOS Intel
npm run package-platform -- darwin x64

# Linux x64
npm run package-platform -- linux x64

# Windows x64
npm run package-platform -- win32 x64
```

### 3. Install and Test in VS Code

After building, install the VSIX:

```bash
# Find the VSIX file
ls -lh codescene-vscode-*.vsix

# Install it
code --install-extension codescene-vscode-*-<platform>-<arch>.vsix
```

Or manually:
1. Open VS Code
2. Go to Extensions view (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Click `...` menu → "Install from VSIX..."
4. Select your `.vsix` file

### 4. Verify It Works

1. **Check Extension Activation:**
   - Open VS Code Output panel (`Cmd+Shift+U` / `Ctrl+Shift+U`)
   - Select "CodeScene" from dropdown
   - Should see: "Checking for bundled CodeScene devtools binary..."
   - Should see: "CodeScene devtools binary is ready."
   - ❌ Should NOT see: "Downloading..." messages

2. **Verify Binary Path:**
   - In the output, check it found the binary at the correct path
   - Path should match: `.../codescene-vscode-X.X.X/cs-<platform>-<arch>[.exe]`

## Troubleshooting

### Node Version Error

**Error:** `ReferenceError: ReadableStream is not defined`

**Solution:**
```bash
nvm use 20
# Or if nvm not installed:
nvm install 20
nvm use 20
```

### Build Fails

**Check:**
1. Node.js version is 20+
2. Dependencies are installed: `npm ci`
3. GITHUB_TOKEN is set (if needed for docs/webview updates):
   ```bash
   export GITHUB_TOKEN=your_token_here
   ```

### VSIX Not Created

**Check:**
1. Build completed without errors
2. Look for VSIX file: `ls -lh *.vsix`
3. Check build output for errors

### Extension Fails to Activate

**Check VSIX Contents:**
```bash
# List contents of VSIX
unzip -l codescene-vscode-*-<platform>-<arch>.vsix | grep "cs-"

# Should show your platform's binary, e.g.:
# cs-darwin-arm64  (for macOS ARM64)
```

## Clean Up

After testing:

```bash
# Remove bundled binaries
rm -f cs-* *.zip

# Remove VSIX
rm -f *.vsix

# Uninstall test extension
code --uninstall-extension codescene.codescene-vscode
```



