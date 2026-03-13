using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.Playwright;

namespace Codescene.E2E.Playwright.Tests.Playwright;

public static partial class VsCodeDriver
{
    /// <summary>
    /// Starts VS Code with remote debugging enabled and attaches Playwright over CDP.
    /// </summary>
    public static async Task<VsCodeSession> StartAndConnectAsync(VsCodeSessionOptions options)
    {
        if (options is null) throw new ArgumentNullException(nameof(options));
        if (string.IsNullOrWhiteSpace(options.PortableRoot))
            throw new ArgumentException("PortableRoot must be provided.", nameof(options));

        var codeExe = FindVsCodeExe(options.PortableRoot);
        var cdpPort = GetFreeTcpPort();
        var (userDataDir, extensionsDir, appDataDir, deleteUserDataDir, deleteExtensionsDir, deleteAppDataDir) =
            ResolveSessionDirectories(codeExe, options);

        Directory.CreateDirectory(extensionsDir);
        SeedUserSettings(userDataDir, options);

        if (ShouldInstallExtension(options.InstallExtensionVsixPath, extensionsDir))
            InstallExtensionFromVsix(extensionsDir, options.InstallExtensionVsixPath!);

        var workspace = ResolveWorkspace(options.WorkspacePath);
        var args = BuildArgs(cdpPort, userDataDir, extensionsDir, workspace, options.DisableWorkspaceTrust,
            options.WindowX, options.WindowY, options.WindowWidth, options.WindowHeight, options.AdditionalArgs);

        var psi = CreateProcessStartInfo(codeExe, args, options, appDataDir);
        var vscode = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start VS Code.");
        var outputBuffer = new BoundedLogBuffer(maxLines: 200);
        AttachOutputCapture(vscode, outputBuffer);

        try
        {
            return await ConnectPlaywrightAsync(vscode, cdpPort, options.CdpReadyTimeout, outputBuffer,
                codeExe, args, userDataDir, extensionsDir, appDataDir, workspace,
                deleteUserDataDir, deleteExtensionsDir, deleteAppDataDir);
        }
        catch
        {
            CleanupFailedSession(vscode, userDataDir, extensionsDir, appDataDir,
                deleteUserDataDir, deleteExtensionsDir, deleteAppDataDir);
            throw;
        }
    }

    private static string ResolveWorkspace(string? workspacePath)
    {
        if (!string.IsNullOrWhiteSpace(workspacePath))
            return workspacePath;

        var workspace = Path.Combine(Path.GetTempPath(), "pw-vscode-workspace-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workspace);
        return workspace;
    }

    private static ProcessStartInfo CreateProcessStartInfo(string codeExe, string args, VsCodeSessionOptions options, string appDataDir)
    {
        var psi = new ProcessStartInfo
        {
            FileName = codeExe,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            WorkingDirectory = options.PortableRoot
        };

        psi.Environment.Remove("ELECTRON_RUN_AS_NODE");
        psi.Environment.Remove("VSCODE_PORTABLE");
        psi.Environment.Remove("VSCODE_APPDATA");
        psi.Environment.Remove("VSCODE_USER_DATA_DIR");
        psi.Environment.Remove("VSCODE_EXTENSIONS");

        if (options.IsolateAppData && !string.IsNullOrWhiteSpace(appDataDir))
            psi.Environment["VSCODE_APPDATA"] = appDataDir;

        return psi;
    }

    private static void AttachOutputCapture(Process vscode, BoundedLogBuffer outputBuffer)
    {
        try
        {
            vscode.OutputDataReceived += (_, e) =>
            {
                if (!string.IsNullOrWhiteSpace(e.Data))
                    outputBuffer.Add("[stdout] " + e.Data);
            };
            vscode.ErrorDataReceived += (_, e) =>
            {
                if (!string.IsNullOrWhiteSpace(e.Data))
                    outputBuffer.Add("[stderr] " + e.Data);
            };
            vscode.BeginOutputReadLine();
            vscode.BeginErrorReadLine();
        }
        catch
        {
            // If async read setup fails, keep going; we can still try HTTP polling.
        }
    }

    private static async Task<VsCodeSession> ConnectPlaywrightAsync(
        Process vscode, int cdpPort, TimeSpan cdpReadyTimeout, BoundedLogBuffer outputBuffer,
        string codeExe, string args, string userDataDir, string extensionsDir, string appDataDir, string workspace,
        bool deleteUserDataDir, bool deleteExtensionsDir, bool deleteAppDataDir)
    {
        await WaitForCdpReadyAsync(
            process: vscode,
            url: $"http://127.0.0.1:{cdpPort}/json/version",
            timeout: cdpReadyTimeout,
            getLogs: () => outputBuffer.ToString());

        var playwright = await Microsoft.Playwright.Playwright.CreateAsync();
        var browser = await playwright.Chromium.ConnectOverCDPAsync($"http://127.0.0.1:{cdpPort}");

        var dirs = new VsCodeSession.SessionDirectories(
            cdpPort, codeExe, args, userDataDir, extensionsDir, appDataDir, workspace,
            deleteUserDataDir, deleteExtensionsDir, deleteAppDataDir);
        return new VsCodeSession(vscode, dirs, playwright, browser);
    }

    private static void CleanupFailedSession(
        Process vscode, string userDataDir, string extensionsDir, string appDataDir,
        bool deleteUserDataDir, bool deleteExtensionsDir, bool deleteAppDataDir)
    {
        try { if (!vscode.HasExited) vscode.Kill(entireProcessTree: true); } catch { }

        if (deleteUserDataDir)
            TryDeleteDir(userDataDir);
        if (deleteExtensionsDir)
            TryDeleteDir(extensionsDir);
        if (deleteAppDataDir && !string.IsNullOrWhiteSpace(appDataDir))
            TryDeleteDir(appDataDir);
    }

    /// <summary>
    /// Sets the *window* bounds (not viewport) for the VS Code Electron window.
    ///
    /// Primary mechanism: executes window.moveTo(...) + window.resizeTo(...) in the renderer JS context.
    /// Fallback mechanism: uses CDP Browser.getWindowForTarget / Browser.setWindowBounds.
    /// </summary>
    public static async Task SetWindowBoundsAsync(IPage page, int x, int y, int width, int height)
    {
        if (page is null) throw new ArgumentNullException(nameof(page));
        if (width <= 0) throw new ArgumentOutOfRangeException(nameof(width), "Width must be > 0.");
        if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height), "Height must be > 0.");

        try
        {
            await SetWindowBoundsViaRendererAsync(page, x, y, width, height);
            return;
        }
        catch (PlaywrightException)
        {
            // If the renderer path is blocked/ignored, fall back to CDP window management.
        }
        catch (NotSupportedException)
        {
            // Some environments (or window managers) may not allow programmatic moves/sizes.
            // Fall back to CDP (if available).
        }

        await SetWindowBoundsViaCdpAsync(page, x, y, width, height);
    }

    /// <summary>
    /// Renderer mechanism: run window.moveTo(...) + window.resizeTo(...) within the Chromium renderer process.
    ///
    /// Notes:
    /// - Units are CSS pixels.
    /// - If the window is maximized/fullscreen, the OS/window manager may ignore the request.
    /// - On some Linux/Wayland setups, window positioning can be restricted.
    /// </summary>
    public static async Task SetWindowBoundsViaRendererAsync(IPage page, int x, int y, int width, int height)
    {
        if (page is null) throw new ArgumentNullException(nameof(page));
        if (width <= 0) throw new ArgumentOutOfRangeException(nameof(width), "Width must be > 0.");
        if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height), "Height must be > 0.");

        await page.EvaluateAsync(
            "({ x, y, width, height }) => { window.moveTo(x, y); window.resizeTo(width, height); }",
            new { x, y, width, height });

        // Give Electron/Chromium a moment to apply native window changes.
        await page.WaitForTimeoutAsync(150);
    }

    /// <summary>
    /// CDP mechanism: sets the native window bounds via Browser.getWindowForTarget / Browser.setWindowBounds.
    /// </summary>
    public static async Task SetWindowBoundsViaCdpAsync(IPage page, int x, int y, int width, int height)
    {
        if (page is null) throw new ArgumentNullException(nameof(page));
        if (width <= 0) throw new ArgumentOutOfRangeException(nameof(width), "Width must be > 0.");
        if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height), "Height must be > 0.");

        var browser = page.Context.Browser
            ?? throw new InvalidOperationException("No Browser instance is associated with this page/context.");

        var targetId = await GetCdpTargetIdAsync(page);
        var browserSession = await browser.NewBrowserCDPSessionAsync();

        try
        {
            var windowId = await GetCdpWindowIdAsync(browserSession, targetId);
            await SetCdpWindowBoundsAsync(browserSession, windowId, x, y, width, height);
        }
        catch (PlaywrightException ex) when (ex.Message.Contains("wasn't found", StringComparison.OrdinalIgnoreCase))
        {
            throw new NotSupportedException(
                "This VS Code/Chromium CDP endpoint does not support window management (Browser.getWindowForTarget / Browser.setWindowBounds).",
                ex);
        }
    }

    private static async Task<string> GetCdpTargetIdAsync(IPage page)
    {
        var pageSession = await page.Context.NewCDPSessionAsync(page);
        var targetInfoResp = await pageSession.SendAsync("Target.getTargetInfo")
            ?? throw new InvalidOperationException("CDP did not return Target.getTargetInfo result.");

        var targetId = targetInfoResp.GetProperty("targetInfo").GetProperty("targetId").GetString();
        if (string.IsNullOrWhiteSpace(targetId))
            throw new InvalidOperationException("Could not determine CDP targetId for page.");
        return targetId;
    }

    private static async Task<int> GetCdpWindowIdAsync(ICDPSession browserSession, string targetId)
    {
        var windowForTarget = await browserSession.SendAsync(
            "Browser.getWindowForTarget",
            new Dictionary<string, object> { ["targetId"] = targetId })
            ?? throw new InvalidOperationException("CDP did not return Browser.getWindowForTarget result.");

        return windowForTarget.GetProperty("windowId").GetInt32();
    }

    private static async Task SetCdpWindowBoundsAsync(ICDPSession browserSession, int windowId, int x, int y, int width, int height)
    {
        var args = new Dictionary<string, object>
        {
            ["windowId"] = windowId,
            ["bounds"] = new Dictionary<string, object>
            {
                ["left"] = x,
                ["top"] = y,
                ["width"] = width,
                ["height"] = height,
                ["windowState"] = "normal"
            }
        };

        await browserSession.SendAsync("Browser.setWindowBounds", args);
    }

    /// <summary>
    /// Captures a screenshot of the current VS Code window.
    ///
    /// Prefers CDP (Page.captureScreenshot) when available, and falls back to Playwright's ScreenshotAsync.
    /// </summary>
    public static async Task CaptureScreenshotAsync(IPage page, string filePath, bool preferCdp = true)
    {
        if (page is null) throw new ArgumentNullException(nameof(page));
        if (string.IsNullOrWhiteSpace(filePath)) throw new ArgumentException("File path must be provided.", nameof(filePath));

        var dir = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrWhiteSpace(dir))
            Directory.CreateDirectory(dir);

        if (preferCdp)
        {
            try
            {
                await CaptureScreenshotViaCdpAsync(page, filePath);
                return;
            }
            catch
            {
                // Fall back to Playwright screenshot.
            }
        }

        await page.ScreenshotAsync(new PageScreenshotOptions
        {
            Path = filePath,
            FullPage = true
        });
    }

    private static async Task CaptureScreenshotViaCdpAsync(IPage page, string filePath)
    {
        var session = await page.Context.NewCDPSessionAsync(page);
        try
        {
            var args = new Dictionary<string, object>
            {
                ["format"] = "png",
                ["fromSurface"] = true,
                ["captureBeyondViewport"] = true
            };

            var resp = await session.SendAsync("Page.captureScreenshot", args);
            if (resp is null)
                throw new InvalidOperationException("CDP returned null for Page.captureScreenshot.");

            if (!resp.Value.TryGetProperty("data", out var dataProp))
                throw new InvalidOperationException("CDP response did not contain 'data' for Page.captureScreenshot.");

            var base64 = dataProp.GetString();
            if (string.IsNullOrWhiteSpace(base64))
                throw new InvalidOperationException("CDP returned empty screenshot data.");

            var bytes = Convert.FromBase64String(base64);
            await File.WriteAllBytesAsync(filePath, bytes);
        }
        finally
        {
            try
            {
                await session.DetachAsync();
            }
            catch
            {
                // ignore
            }
        }
    }

    public static string FindVsCodeExe(string portableRoot)
    {
        var candidates = new[]
        {
            Path.Combine(portableRoot, "Code.exe"),
            Path.Combine(portableRoot, "Code - Insiders.exe")
        };

        var found = candidates.FirstOrDefault(File.Exists);
        if (found != null)
            return found;

        throw new FileNotFoundException($"Could not find Code.exe under: {portableRoot}");
    }

    private static (string userDataDir, string extensionsDir, string appDataDir, bool deleteUserDataDir, bool deleteExtensionsDir, bool deleteAppDataDir) ResolveSessionDirectories(string codeExe, VsCodeSessionOptions options)
    {
        string extensionsDir;
        bool deleteExtensionsDir;
        if (!string.IsNullOrWhiteSpace(options.ExtensionsDir))
        {
            extensionsDir = Path.IsPathRooted(options.ExtensionsDir) ? options.ExtensionsDir : Path.GetFullPath(options.ExtensionsDir);
            deleteExtensionsDir = false;
        }
        else
        {
            extensionsDir = Path.Combine(Path.GetTempPath(), "pw-vscode-ext-" + Guid.NewGuid().ToString("N"));
            deleteExtensionsDir = true;
        }

        string userDataDir;
        string appDataDir;
        bool deleteUserDataDir;
        bool deleteAppDataDir;
        if (options.IsolateAppData)
        {
            appDataDir = Path.Combine(Path.GetTempPath(), "pw-vscode-appdata-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(appDataDir);
            deleteAppDataDir = true;
            var productDirName = Path.GetFileNameWithoutExtension(codeExe).Contains("Insiders", StringComparison.OrdinalIgnoreCase) ? "Code - Insiders" : "Code";
            userDataDir = Path.Combine(appDataDir, productDirName);
            Directory.CreateDirectory(userDataDir);
            deleteUserDataDir = false;
        }
        else
        {
            appDataDir = string.Empty;
            deleteAppDataDir = false;
            userDataDir = Path.Combine(Path.GetTempPath(), "pw-vscode-userdata-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(userDataDir);
            deleteUserDataDir = true;
        }

        return (userDataDir, extensionsDir, appDataDir, deleteUserDataDir, deleteExtensionsDir, deleteAppDataDir);
    }

    public static int GetFreeTcpPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    public static async Task WaitForHttpOkAsync(string url, TimeSpan timeout)
    {
        using var http = new HttpClient();
        var start = DateTime.UtcNow;

        while (DateTime.UtcNow - start < timeout)
        {
            try
            {
                using var resp = await http.GetAsync(url);
                if (resp.IsSuccessStatusCode)
                    return;
            }
            catch
            {
                // keep retrying
            }

            await Task.Delay(200);
        }

        throw new TimeoutException("Timed out waiting for CDP endpoint: " + url);
    }

    private static async Task WaitForCdpReadyAsync(Process process, string url, TimeSpan timeout, Func<string> getLogs)
    {
        using var http = new HttpClient();
        var start = DateTime.UtcNow;

        while (DateTime.UtcNow - start < timeout)
        {
            if (process.HasExited)
            {
                var logs = getLogs?.Invoke();
                throw new InvalidOperationException(
                    "VS Code process exited before CDP was ready. " +
                    $"ExitCode={process.ExitCode}. " +
                    "Recent logs:\n" + logs);
            }

            try
            {
                using var resp = await http.GetAsync(url);
                if (resp.IsSuccessStatusCode)
                    return;
            }
            catch
            {
                // keep retrying
            }

            await Task.Delay(200);
        }

        throw new TimeoutException(
            "Timed out waiting for CDP endpoint: " + url + "\n" +
            "Recent logs:\n" + getLogs());
    }

    /// <summary>
    /// Attempts to get a visible, top-level page from the first browser context.
    /// VS Code may create pages asynchronously; this waits up to timeout.
    /// </summary>
    public static async Task<IPage> GetFirstPageAsync(IBrowser browser, TimeSpan timeout)
    {
        var start = DateTime.UtcNow;

        while (DateTime.UtcNow - start < timeout)
        {
            var page = await TryGetWorkbenchPageAsync(browser);
            if (page != null)
                return page;
            await Task.Delay(100);
        }

        throw new TimeoutException("Timed out waiting for a Playwright page after CDP attach.");
    }

    private static bool IsWorkbenchPageUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        if (url.Equals("about:blank", StringComparison.OrdinalIgnoreCase)) return false;
        if (url.StartsWith("chrome-error://", StringComparison.OrdinalIgnoreCase)) return false;
        return true;
    }

    private static async Task<IPage?> TryGetWorkbenchPageAsync(IBrowser browser)
    {
        foreach (var context in browser.Contexts)
        {
            foreach (var page in context.Pages)
            {
                if (!IsWorkbenchPageUrl(page.Url))
                    continue;
                try
                {
                    var title = await page.TitleAsync();
                    if (!string.IsNullOrWhiteSpace(title))
                        return page;
                }
                catch
                {
                    // Ignore transient page errors.
                }
                return page;
            }
        }
        return null;
    }

    private static string BuildArgs(
        int cdpPort,
        string userDataDir,
        string extensionsDir,
        string workspace,
        bool disableWorkspaceTrust,
        int windowX,
        int windowY,
        int windowWidth,
        int windowHeight,
        string? additionalArgs)
    {
        var sb = new StringBuilder();
        sb.Append("--remote-debugging-address=127.0.0.1 ");
        sb.Append($"--remote-debugging-port={cdpPort} ");
        sb.Append($"--user-data-dir=\"{userDataDir}\" ");
        sb.Append($"--extensions-dir=\"{extensionsDir}\" ");

        sb.Append($"--window-position={windowX},{windowY} ");
        sb.Append($"--window-size={windowWidth},{windowHeight} ");

        if (disableWorkspaceTrust)
            sb.Append("--disable-workspace-trust ");

        sb.Append("--disable-extension=github.copilot ");
        sb.Append("--disable-extension=github.copilot-chat ");

        sb.Append("--new-window ");
        sb.Append($"\"{workspace}\"");

        if (!string.IsNullOrWhiteSpace(additionalArgs))
        {
            sb.Append(' ');
            sb.Append(additionalArgs.Trim());
        }

        return sb.ToString();
    }

    private static void TryDeleteDir(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, recursive: true);
        }
        catch
        {
            // ignore cleanup errors
        }
    }

    private sealed class BoundedLogBuffer
    {
        private readonly object _gate = new();
        private readonly int _maxLines;
        private readonly string[] _lines;
        private int _next;
        private int _count;

        public BoundedLogBuffer(int maxLines)
        {
            _maxLines = Math.Max(10, maxLines);
            _lines = new string[_maxLines];
        }

        public void Add(string line)
        {
            lock (_gate)
            {
                _lines[_next] = line;
                _next = (_next + 1) % _maxLines;
                if (_count < _maxLines)
                    _count++;
            }
        }

        public override string ToString()
        {
            lock (_gate)
            {
                if (_count == 0)
                    return "<no captured output>";

                var sb = new StringBuilder();
                var start = (_next - _count + _maxLines) % _maxLines;
                for (var i = 0; i < _count; i++)
                {
                    var idx = (start + i) % _maxLines;
                    sb.AppendLine(_lines[idx]);
                }
                return sb.ToString();
            }
        }
    }
}
