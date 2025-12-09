# Building and Running the Extension Locally

This guide covers both **development mode** (running with F5) and **building VSIX files** for testing.

## Prerequisites

### 1. Node.js 20+ (Required)

Since `vsce` requires Node.js 20+, you need to switch versions:

```bash
# If using nvm (recommended)
nvm use 20

# Verify Node version
node --version
# Should show: v20.x.x
```

### 2. Install Dependencies

```bash
npm install
```

## Development Mode (Running with F5)

This is the fastest way to test changes during development.

### 1. Bundle CLI Binary for Your Platform

The extension needs the CLI binary for your current platform:

```bash
npm run bundle-cli-test
```

This will:
- Detect your platform automatically (darwin/arm64, darwin/x64, linux/x64, etc.)
- Download and extract the appropriate CLI binary
- Place it in the project root (e.g., `cs-darwin-arm64`)

**Note:** You only need to run this once, or when switching platforms.

### 2. Build the Extension

```bash
npm run build
```

This compiles TypeScript and bundles the extension code.

### 3. Run in Extension Development Host

1. **Open the project in VS Code:**
   ```bash
   code /path/to/codescene-vscode
   ```

2. **Press F5** (or go to Run → Start Debugging)

3. **A new VS Code window opens** - this is the Extension Development Host

4. **Test your changes** in the new window

### 4. Watch Mode (Auto-rebuild on changes)

For faster iteration, use watch mode:

```bash
npm run watch
```

Then press F5. The extension will automatically rebuild when you save changes.

### 5. Verify Extension is Running

In the Extension Development Host window:

1. **Check Output panel:**
   - `Cmd+Shift+U` (Mac) or `Ctrl+Shift+U` (Windows/Linux)
   - Select "CodeScene" from dropdown
   - Should see: "⚙️ Activating extension..."
   - Should see: "Checking for bundled CodeScene devtools binary..."
   - Should see: "CodeScene devtools binary is ready."

2. **Check Extension is loaded:**
   - Go to Extensions view
   - Search for "CodeScene"
   - Should show as installed and enabled

### Testing Git Unavailable Scenario

To test the extension when Git is not available:

1. **In the Extension Development Host window:**
   - Open Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
   - Find "Git" extension
   - Click gear icon → "Disable"
   - Reload window (`Cmd+R` / `Ctrl+R`)

2. **Expected behavior:**
   - Extension activates successfully
   - Information message appears: "CodeScene: Code Health Monitor is unavailable. Git is required for delta analysis features. Other CodeScene features remain available."
   - No error messages
   - Other features (code review, diagnostics) still work

## Building VSIX Files for Testing

Use this when you want to test the packaged extension (as users would install it).

### 1. Switch to Node.js 20+ (Required)

```bash
nvm use 20
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

## Common Commands

### Development

```bash
# Bundle CLI for current platform (required before F5)
npm run bundle-cli-test

# Build extension
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch

# Type check only
npm run tsc

# Lint code
npm run lint

# Run tests
npm run test
```

### Building VSIX

```bash
# Build VSIX for specific platform
npm run package-platform -- <platform> <arch>

# Examples:
npm run package-platform -- darwin arm64  # macOS Apple Silicon
npm run package-platform -- darwin x64     # macOS Intel
npm run package-platform -- linux x64      # Linux x64
npm run package-platform -- win32 x64      # Windows x64
```

## Troubleshooting

### Development Mode Issues

#### Binary Not Found Error

**Error:** `The devtools binary "cs-darwin-arm64" does not exist`

**Solution:**
```bash
# Bundle the CLI binary for your platform
npm run bundle-cli-test

# Then rebuild
npm run build

# Reload VS Code window (F5 again)
```

#### Extension Doesn't Activate

**Check:**
1. Binary is bundled: `ls -lh cs-*` should show your platform's binary
2. Extension is built: `ls -lh out/main.js` should exist
3. Check Output panel for errors
4. Check Developer Console: Help → Toggle Developer Tools

### VSIX Building Issues

#### Node Version Error

**Error:** `ReferenceError: ReadableStream is not defined`

**Solution:**
```bash
nvm use 20
# Or if nvm not installed:
nvm install 20
nvm use 20
```

#### Build Fails

**Check:**
1. Node.js version is 20+
2. Dependencies are installed: `npm ci`
3. GITHUB_TOKEN is set (if needed for docs/webview updates):
   ```bash
   export GITHUB_TOKEN=your_token_here
   ```

#### VSIX Not Created

**Check:**
1. Build completed without errors
2. Look for VSIX file: `ls -lh *.vsix`
3. Check build output for errors

#### Extension Fails to Activate After Installing VSIX

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
# Remove bundled binaries (optional - you may want to keep them for development)
rm -f cs-* *.zip

# Remove VSIX files
rm -f *.vsix

# Uninstall test extension (if installed from VSIX)
code --uninstall-extension codescene.codescene-vscode
```

## Development Workflow

### Typical Development Cycle

1. **Make code changes** in `src/`

2. **If you changed TypeScript:**
   ```bash
   npm run build
   # Or use watch mode:
   npm run watch  # (runs in background)
   ```

3. **If you need to test with a fresh binary:**
   ```bash
   npm run bundle-cli-test
   ```

4. **Reload Extension Development Host:**
   - Press `Cmd+R` / `Ctrl+R` in the Extension Development Host window
   - Or stop (Shift+F5) and restart (F5)

5. **Test your changes**

### Testing Checklist

- [ ] Extension activates without errors
- [ ] Binary is found and verified
- [ ] Code review features work
- [ ] Diagnostics appear correctly
- [ ] Monitor works (if Git is available)
- [ ] Extension handles Git unavailable gracefully
- [ ] No console errors in Developer Tools

## Additional Resources

- See `TESTING_GIT_UNAVAILABLE.md` for detailed Git unavailable testing
- See `README.md` for extension features and usage
- See `.github/workflows/` for CI/CD build processes



