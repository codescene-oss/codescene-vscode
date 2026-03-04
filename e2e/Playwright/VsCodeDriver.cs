using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Playwright;

namespace csharp.VsCodePlaywright;

public static class VsCodeDriver
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

        // IMPORTANT:
        // VS Code derives its default user-data directory as: %APPDATA%\<ProductName> (e.g. Code, Code - Insiders).
        // If we set VSCODE_APPDATA but seed settings into a different --user-data-dir, we can end up writing the *wrong*
        // User\settings.json. To keep things deterministic, when IsolateAppData is enabled we create a temp APPDATA root
        // and set userDataDir to the derived <root>\<ProductName>.
        var appDataDir = string.Empty;
        var deleteAppDataDir = false;

        var userDataDir = string.Empty;
        var deleteUserDataDir = true;

        var extensionsDir = string.Empty;
        var deleteExtensionsDir = true;

        if (!string.IsNullOrWhiteSpace(options.ExtensionsDir))
        {
            extensionsDir = Path.IsPathRooted(options.ExtensionsDir)
                ? options.ExtensionsDir
                : Path.GetFullPath(options.ExtensionsDir);
            deleteExtensionsDir = false;
        }
        else
        {
            extensionsDir = Path.Combine(Path.GetTempPath(), "pw-vscode-ext-" + Guid.NewGuid().ToString("N"));
            deleteExtensionsDir = true;
        }

        if (options.IsolateAppData)
        {
            appDataDir = Path.Combine(Path.GetTempPath(), "pw-vscode-appdata-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(appDataDir);
            deleteAppDataDir = true;

            var productDirName = Path.GetFileNameWithoutExtension(codeExe).Contains("Insiders", StringComparison.OrdinalIgnoreCase)
                ? "Code - Insiders"
                : "Code";

            userDataDir = Path.Combine(appDataDir, productDirName);
            Directory.CreateDirectory(userDataDir);

            // We'll delete the isolated APPDATA root; no need to delete the nested userDataDir separately.
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

        Directory.CreateDirectory(extensionsDir);

        // Ensure VS Code does not start maximized/fullscreen by default, otherwise window.moveTo/resizeTo
        // and some CDP window management calls may be ignored/overridden by the OS/window manager.
        EnsureVsCodeUserSetting(userDataDir, "window.newWindowDimensions", "default");

        // Make the spawned instance deterministic and avoid inheriting signed-in user state.
        // In particular, Settings Sync can pull in layout/settings that make the UI start in Chat, etc.
        if (options.DisableSettingsSync)
        {
            EnsureVsCodeUserSetting(userDataDir, "settingsSync.enabled", false);
            EnsureVsCodeUserSetting(userDataDir, "window.restoreWindows", "none");
            EnsureVsCodeUserSetting(userDataDir, "workbench.editor.restoreViewState", false);
            EnsureVsCodeUserSetting(userDataDir, "workbench.startupEditor", "none");
            EnsureVsCodeUserSetting(userDataDir, "workbench.welcomePage.enabled", false);
            EnsureVsCodeUserSetting(userDataDir, "workbench.welcomePage.walkthroughs.openOnInstall", false);
            EnsureVsCodeUserSetting(userDataDir, "update.showReleaseNotes", false);
            EnsureVsCodeUserSetting(userDataDir, "workbench.activityBar.visible", true);
            EnsureVsCodeUserSetting(userDataDir, "workbench.sideBar.location", "left");
            // "Show View by Default" for Chat/Copilot toggles this setting. Keep it hidden for deterministic startup.
            EnsureVsCodeUserSetting(userDataDir, "workbench.secondarySideBar.defaultVisibility", "hidden");

            // Chat/Copilot UI determinism: prefer *settings-only* suppression over post-start UI automation.
            // These keys exist in recent VS Code builds; unknown keys are ignored by VS Code.
            EnsureVsCodeUserSetting(userDataDir, "chat.restoreLastPanelSession", false);
            EnsureVsCodeUserSetting(userDataDir, "chat.viewWelcome.enabled", false);
            EnsureVsCodeUserSetting(userDataDir, "chat.commandCenter.enabled", false);
            EnsureVsCodeUserSetting(userDataDir, "chat.viewTitle.enabled", false);
            EnsureVsCodeUserSetting(userDataDir, "chat.disableAIFeatures", true);

            EnsureVsCodeUserSetting(userDataDir, "workbench.enableExperiments", false);
            EnsureVsCodeUserSetting(userDataDir, "telemetry.telemetryLevel", "off");
            EnsureVsCodeUserSetting(userDataDir, "workbench.tips.enabled", false);
        }

        if (options.UserSettings is not null)
        {
            foreach (var kvp in options.UserSettings)
            {
                if (!string.IsNullOrWhiteSpace(kvp.Key) && kvp.Value is not null)
                    EnsureVsCodeUserSetting(userDataDir, kvp.Key, kvp.Value);
            }
        }

        if (options.LockUserSettingsJson)
        {
            TryMakeFileReadOnly(Path.Combine(userDataDir, "User", "settings.json"));
        }

        // Defensive: some extensions/first-run flows may try to persist UI preferences back into user settings.
        // Mark the seeded settings as read-only to keep test startup deterministic.
        // NOTE: This causes VS Code to show a blocking "Unable to write" dialog, so keep it disabled.
        if (options.DisableSettingsSync)
        {
            TryMakeUserSettingsReadOnly(userDataDir);
        }

        if (!string.IsNullOrWhiteSpace(options.InstallExtensionVsixPath) && File.Exists(options.InstallExtensionVsixPath))
        {
            // Skip installation if extension is already installed
            var extensionInstalled = Directory.Exists(extensionsDir) &&
                Directory.GetDirectories(extensionsDir).Any(d =>
                    Path.GetFileName(d).StartsWith("codescene.", StringComparison.OrdinalIgnoreCase));

            if (!extensionInstalled)
            {
                InstallExtensionFromVsix(extensionsDir, options.InstallExtensionVsixPath);
            }
        }

        var workspace = options.WorkspacePath;
        if (string.IsNullOrWhiteSpace(workspace))
        {
            workspace = Path.Combine(Path.GetTempPath(), "pw-vscode-workspace-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(workspace);
        }

        var args = BuildArgs(
            cdpPort,
            userDataDir,
            extensionsDir,
            workspace,
            options.DisableWorkspaceTrust,
            options.WindowX,
            options.WindowY,
            options.WindowWidth,
            options.WindowHeight,
            options.AdditionalArgs);

        var psi = new ProcessStartInfo
        {
            FileName = codeExe,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            WorkingDirectory = options.PortableRoot
        };

        // If this env var is set, Electron runs as Node and will reject Chromium/VS Code flags as "bad option".
        psi.Environment.Remove("ELECTRON_RUN_AS_NODE");

        // Defensive: a few environment variables can force VS Code to use a particular
        // profile / extensions location even when we pass --user-data-dir/--extensions-dir.
        psi.Environment.Remove("VSCODE_PORTABLE");
        psi.Environment.Remove("VSCODE_APPDATA");
        psi.Environment.Remove("VSCODE_USER_DATA_DIR");
        psi.Environment.Remove("VSCODE_EXTENSIONS");

        // Hard isolation: ensure VS Code does not touch the host user's %APPDATA%\Code.
        // VSCODE_APPDATA controls where VS Code stores its app data root.
        if (options.IsolateAppData && !string.IsNullOrWhiteSpace(appDataDir))
            psi.Environment["VSCODE_APPDATA"] = appDataDir;

        var vscode = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start VS Code.");
        var outputBuffer = new BoundedLogBuffer(maxLines: 200);

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

        try
        {
            await WaitForCdpReadyAsync(
                process: vscode,
                url: $"http://127.0.0.1:{cdpPort}/json/version",
                timeout: options.CdpReadyTimeout,
                getLogs: () => outputBuffer.ToString());

            var playwright = await Microsoft.Playwright.Playwright.CreateAsync();
            var browser = await playwright.Chromium.ConnectOverCDPAsync($"http://127.0.0.1:{cdpPort}");

            return new VsCodeSession(
                vscode,
                cdpPort,
                codeExe,
                args,
                userDataDir,
                extensionsDir,
                appDataDir,
                deleteUserDataDir,
                deleteExtensionsDir,
                deleteAppDataDir,
                workspace,
                playwright,
                browser);
        }
        catch
        {
            try
            {
                if (!vscode.HasExited)
                    vscode.Kill(entireProcessTree: true);
            }
            catch
            {
                // ignore
            }

            if (deleteUserDataDir)
                TryDeleteDir(userDataDir);

            if (deleteExtensionsDir)
                TryDeleteDir(extensionsDir);

            if (deleteAppDataDir && !string.IsNullOrWhiteSpace(appDataDir))
                TryDeleteDir(appDataDir);

            throw;
        }
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

        // Important: Page-scoped CDP sessions often cannot call Browser.* methods.
        // Use a browser-level CDP session and pass the page's targetId.
        var browser = page.Context.Browser;
        if (browser is null)
            throw new InvalidOperationException("No Browser instance is associated with this page/context.");

        var pageSession = await page.Context.NewCDPSessionAsync(page);
        var targetInfoResp = await pageSession.SendAsync("Target.getTargetInfo");
        if (targetInfoResp is null)
            throw new InvalidOperationException("CDP did not return Target.getTargetInfo result.");

        var targetId = targetInfoResp.Value.GetProperty("targetInfo").GetProperty("targetId").GetString();
        if (string.IsNullOrWhiteSpace(targetId))
            throw new InvalidOperationException("Could not determine CDP targetId for page.");

        var browserSession = await browser.NewBrowserCDPSessionAsync();

        try
        {
            var windowForTarget = await browserSession.SendAsync(
                "Browser.getWindowForTarget",
                new System.Collections.Generic.Dictionary<string, object> { ["targetId"] = targetId });

            if (windowForTarget is null)
                throw new InvalidOperationException("CDP did not return Browser.getWindowForTarget result.");

            var windowId = windowForTarget.Value.GetProperty("windowId").GetInt32();

            var args = new System.Collections.Generic.Dictionary<string, object>
            {
                ["windowId"] = windowId,
                ["bounds"] = new System.Collections.Generic.Dictionary<string, object>
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
        catch (PlaywrightException ex) when (ex.Message.Contains("wasn't found", StringComparison.OrdinalIgnoreCase))
        {
            // Some CDP endpoints (or older Chromium builds) don't expose Browser window management.
            // Don't fail the whole test run; callers can still run with default OS window placement.
            throw new NotSupportedException(
                "This VS Code/Chromium CDP endpoint does not support window management (Browser.getWindowForTarget / Browser.setWindowBounds).",
                ex);
        }
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

    private static void EnsureVsCodeUserSetting(string userDataDir, string settingKey, string settingValue)
    {
        EnsureVsCodeUserSetting(userDataDir, settingKey, (object?)settingValue);
    }

    private static void EnsureVsCodeUserSetting(string userDataDir, string settingKey, object? settingValue)
    {
        try
        {
            var userDir = Path.Combine(userDataDir, "User");
            Directory.CreateDirectory(userDir);

            var settingsPath = Path.Combine(userDir, "settings.json");
            var settings = new System.Collections.Generic.Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);

            if (File.Exists(settingsPath))
            {
                var existing = File.ReadAllText(settingsPath);
                if (!string.IsNullOrWhiteSpace(existing))
                {
                    using var doc = JsonDocument.Parse(existing);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var prop in doc.RootElement.EnumerateObject())
                        {
                            settings[prop.Name] = prop.Value.ValueKind switch
                            {
                                JsonValueKind.String => prop.Value.GetString(),
                                JsonValueKind.Number => prop.Value.TryGetInt64(out var l) ? l : prop.Value.GetDouble(),
                                JsonValueKind.True => true,
                                JsonValueKind.False => false,
                                JsonValueKind.Null => null,
                                _ => prop.Value.Clone()
                            };
                        }
                    }
                }
            }

            settings[settingKey] = settingValue;

            var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions
            {
                WriteIndented = true
            });
            File.WriteAllText(settingsPath, json);
        }
        catch
        {
            // Best-effort only. If this fails, the caller can still enforce bounds via other mechanisms.
        }
    }

    private static void TryMakeFileReadOnly(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
                return;

            var attrs = File.GetAttributes(filePath);
            if ((attrs & FileAttributes.ReadOnly) != FileAttributes.ReadOnly)
                File.SetAttributes(filePath, attrs | FileAttributes.ReadOnly);
        }
        catch
        {
            // Best-effort only.
        }
    }

    private static void TryMakeUserSettingsReadOnly(string userDataDir)
    {
        try
        {
            var settingsPath = Path.Combine(userDataDir, "User", "settings.json");
            if (!File.Exists(settingsPath))
                return;

            var attrs = File.GetAttributes(settingsPath);
            if ((attrs & FileAttributes.ReadOnly) == 0)
                File.SetAttributes(settingsPath, attrs | FileAttributes.ReadOnly);
        }
        catch
        {
            // Best-effort only.
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
            foreach (var context in browser.Contexts)
            {
                foreach (var page in context.Pages)
                {
                    // Filter out common non-workbench pages.
                    var url = page.Url ?? string.Empty;
                    if (string.IsNullOrWhiteSpace(url) ||
                        url.Equals("about:blank", StringComparison.OrdinalIgnoreCase) ||
                        url.StartsWith("chrome-error://", StringComparison.OrdinalIgnoreCase))
                        continue;

                    // Prefer a page that already has a meaningful title.
                    try
                    {
                        var title = await page.TitleAsync();
                        if (!string.IsNullOrWhiteSpace(title))
                            return page;
                    }
                    catch
                    {
                        // Ignore transient page errors and keep scanning.
                    }

                    // If title isn't ready yet but URL looks real, keep it as a candidate.
                    return page;
                }
            }

            await Task.Delay(100);
        }

        throw new TimeoutException("Timed out waiting for a Playwright page after CDP attach.");
    }

    /// <summary>
    /// Best-effort stabilization for fresh profiles:
    /// - Dismisses transient first-run UI (e.g. walkthrough popups) by sending Escape.
    /// - Closes any startup editors (e.g. Welcome/Release Notes) via default close-all chord.
    /// - Focuses the Explorer view to get a consistent baseline layout.
    ///
    /// This intentionally avoids any Copilot/extension-specific behavior.
    /// </summary>
    public static async Task StabilizeFirstRunUiAsync(IPage page, TimeSpan? timeout = null)
    {
        if (page is null) throw new ArgumentNullException(nameof(page));

        var effectiveTimeout = timeout ?? TimeSpan.FromSeconds(10);

        // Wait until the workbench exists.
        await page.Locator(".monaco-workbench").WaitForAsync(new LocatorWaitForOptions
        {
            Timeout = (float)effectiveTimeout.TotalMilliseconds
        });

        // Ensure the VS Code window is focused so keyboard shortcuts and palette input land correctly.
        try
        {
            await page.Locator(".monaco-workbench").ClickAsync(new LocatorClickOptions
            {
                Timeout = (float)effectiveTimeout.TotalMilliseconds,
                Force = true
            });
        }
        catch
        {
            // ignore
        }

        // Dismiss any modal/popover.
        for (var i = 0; i < 3; i++)
        {
            try { await page.Keyboard.PressAsync("Escape"); } catch { /* ignore */ }
            await page.WaitForTimeoutAsync(100);
        }

        // Close any startup editors (Welcome/Release Notes/etc.).
        // Default keybinding is a chord: Ctrl+K, then Ctrl+W.
        try
        {
            await page.Keyboard.PressAsync("Control+K");
            await page.WaitForTimeoutAsync(100);
            await page.Keyboard.PressAsync("Control+W");
        }
        catch
        {
            // ignore if keybinding differs
        }

        // Stronger close: use the Command Palette to close all editors.
        // This avoids relying on keybinding chords being honored.
        await TryRunCommandPaletteCommandAsync(page, "File: Close All Editors", effectiveTimeout);

        // Extra safety: close the active editor a few times.
        // This helps if a startup view (or any other editor) survived the close-all chord.
        // Default close editor is Ctrl+F4.
        for (var i = 0; i < 6; i++)
        {
            try { await page.Keyboard.PressAsync("Control+F4"); } catch { /* ignore */ }
            await page.WaitForTimeoutAsync(100);
        }

        // If the bottom panel is visible, hide it (keeps terminals/problems/etc out of the way).
        // Default toggle is Ctrl+J.
        try
        {
            var panel = page.Locator("[id='workbench.parts.panel']");
            if (await panel.IsVisibleAsync())
            {
                try { await page.Keyboard.PressAsync("Control+J"); } catch { /* ignore */ }
            }
        }
        catch
        {
            // ignore
        }

        // If the Secondary Side Bar is visible (often used for auxiliary views), close it
        // to get a consistent baseline layout. Default toggle is Ctrl+Alt+B on Windows.
        try
        {
            var secondary = page.Locator("[id='workbench.parts.secondarySidebar']");
            if (await secondary.IsVisibleAsync())
            {
                try
                {
                    await page.Keyboard.PressAsync("Control+Alt+B");
                }
                catch
                {
                    // ignore
                }
            }
        }
        catch
        {
            // ignore if selector changes between VS Code versions
        }

        // Focus Explorer for a stable baseline (default: Ctrl+Shift+E).
        try
        {
            await page.Keyboard.PressAsync("Control+Shift+E");
        }
        catch
        {
            // As a last resort, try clicking the Explorer tab by role.
            try
            {
                var wb = new VsCodeWorkbench(page);
                await wb.Click("Explorer", timeoutMs: (float)effectiveTimeout.TotalMilliseconds);
            }
            catch
            {
                // ignore
            }
        }

        // Stronger focus: use Command Palette to show Explorer (ensures correct view container).
        await TryRunCommandPaletteCommandAsync(page, "View: Show Explorer", effectiveTimeout);

        // Ensure the primary sidebar is visible (Explorer lives there).
        // Default toggle is Ctrl+B.
        try
        {
            var sidebar = page.Locator("[id='workbench.parts.sidebar']");
            for (var i = 0; i < 2; i++)
            {
                if (await sidebar.IsVisibleAsync())
                    break;

                try { await page.Keyboard.PressAsync("Control+B"); } catch { /* ignore */ }
                await page.WaitForTimeoutAsync(150);
            }
        }
        catch
        {
            // ignore
        }

        // Prefer clicking Explorer in the activity bar (more reliable than shortcuts if keybindings differ).
        try
        {
            var wb = new VsCodeWorkbench(page);
            await wb.Click("Explorer", timeoutMs: (float)effectiveTimeout.TotalMilliseconds);
        }
        catch
        {
            // ignore
        }

        // Wait until Explorer view content is present; this makes "Explorer is active" deterministic.
        try
        {
            var explorer = new VsCodeExplorer(page);
            await explorer.WaitForAsync("Id", timeoutMs: (float)effectiveTimeout.TotalMilliseconds);
        }
        catch
        {
            // ignore
        }

        await page.WaitForTimeoutAsync(150);
    }

    private static async Task TryRunCommandPaletteCommandAsync(IPage page, string commandText, TimeSpan timeout)
    {
        try
        {
            await page.Keyboard.PressAsync("Control+Shift+P");
            await page.WaitForTimeoutAsync(200);

            // Clear anything that might already be in the input.
            try { await page.Keyboard.PressAsync("Control+A"); } catch { /* ignore */ }
            try { await page.Keyboard.PressAsync("Backspace"); } catch { /* ignore */ }

            await page.Keyboard.TypeAsync(commandText, new KeyboardTypeOptions { Delay = 10 });
            await page.WaitForTimeoutAsync(100);
            await page.Keyboard.PressAsync("Enter");

            // Give VS Code time to apply the command.
            await page.WaitForTimeoutAsync(350);

            // Dismiss palette if it stayed open.
            try { await page.Keyboard.PressAsync("Escape"); } catch { /* ignore */ }
        }
        catch
        {
            // Best-effort; avoid failing the whole test on UI automation differences.
        }
    }

    /// <summary>
    /// Returns a small layout snapshot string useful for debugging UI determinism.
    /// Best-effort only; selectors may vary across VS Code versions.
    /// </summary>
    public static async Task<string> GetUiLayoutSnapshotAsync(IPage page)
    {
        if (page is null) throw new ArgumentNullException(nameof(page));

        try
        {
            var script =
                "() => {\n" +
                "  const q = (sel) => document.querySelector(sel);\n" +
                "  const byId = (id) => q(\"[id='\" + id + \"']\");\n" +
                "  const isVisible = (el) => {\n" +
                "    if (!el) return false;\n" +
                "    const r = el.getBoundingClientRect();\n" +
                "    const s = getComputedStyle(el);\n" +
                "    return !!(r.width && r.height) && s.visibility !== 'hidden' && s.display !== 'none';\n" +
                "  };\n" +
                "  const countVisibleByAriaLabel = (re) => {\n" +
                "    try {\n" +
                "      const els = Array.from(document.querySelectorAll('[aria-label]'));\n" +
                "      return els.filter(e => re.test(e.getAttribute('aria-label') || '') && isVisible(e)).length;\n" +
                "    } catch { return 0; }\n" +
                "  };\n" +
                "\n" +
                "  const activeEl = q(\"[id='workbench.parts.activitybar'] .action-item.checked\");\n" +
                "  const activeActivity = ((activeEl && (activeEl.getAttribute('aria-label') || activeEl.textContent)) || '<unknown>').trim();\n" +
                "\n" +
                "  const sidebarVisible = isVisible(byId('workbench.parts.sidebar'));\n" +
                "  const secondaryVisible = isVisible(byId('workbench.parts.secondarySidebar'));\n" +
                "  const panelVisible = isVisible(byId('workbench.parts.panel'));\n" +
                "  const explorerVisible = isVisible(q('.explorer-folders-view'));\n" +
                "  const chatLabelVisibleCount = countVisibleByAriaLabel(/chat/i);\n" +
                "\n" +
                "  return 'activeActivity=' + activeActivity +" +
                "    '; sidebar=' + sidebarVisible +" +
                "    '; secondarySidebar=' + secondaryVisible +" +
                "    '; panel=' + panelVisible +" +
                "    '; explorer=' + explorerVisible +" +
                "    '; chatAriaVisible=' + chatLabelVisibleCount;\n" +
                "}";

            var snapshot = await page.EvaluateAsync<string>(script);
            return snapshot ?? "<no snapshot>";
        }
        catch
        {
            return "<snapshot failed>";
        }
    }

    private static void InstallExtensionFromVsix(string extensionsDir, string vsixPath)
    {
        // Extract the vsix directly - it's a zip file containing the extension.
        // This is faster and more reliable than running Code.exe --install-extension.
        try
        {
            // Parse extension ID and version from vsix filename
            // Expected format: publisher.name-version@platform.vsix or publisher.name-version.vsix
            var vsixFileName = Path.GetFileNameWithoutExtension(vsixPath);
            if (vsixFileName.Contains('@'))
                vsixFileName = vsixFileName.Substring(0, vsixFileName.IndexOf('@'));

            // Extract to extensionsDir with the correct folder name
            var targetDir = Path.Combine(extensionsDir, vsixFileName);

            if (Directory.Exists(targetDir))
            {
                // Already extracted
                return;
            }

            Directory.CreateDirectory(targetDir);

            // Extract the vsix (it's a zip file)
            System.IO.Compression.ZipFile.ExtractToDirectory(vsixPath, targetDir);

            // VS Code expects the extension files in the root, but vsix has them under "extension/"
            var extensionSubdir = Path.Combine(targetDir, "extension");
            if (Directory.Exists(extensionSubdir))
            {
                // Move contents from extension/ to the root
                foreach (var file in Directory.GetFiles(extensionSubdir))
                {
                    var destFile = Path.Combine(targetDir, Path.GetFileName(file));
                    if (!File.Exists(destFile))
                        File.Move(file, destFile);
                }
                foreach (var dir in Directory.GetDirectories(extensionSubdir))
                {
                    var destDir = Path.Combine(targetDir, Path.GetFileName(dir));
                    if (!Directory.Exists(destDir))
                        Directory.Move(dir, destDir);
                }
                TryDeleteDir(extensionSubdir);
            }

            // Remove vsix metadata files that VS Code doesn't need
            var contentTypesXml = Path.Combine(targetDir, "[Content_Types].xml");
            if (File.Exists(contentTypesXml))
                File.Delete(contentTypesXml);

            // Remove any .obsolete marker that might prevent VS Code from loading the extension
            var obsoleteFile = Path.Combine(extensionsDir, ".obsolete");
            if (File.Exists(obsoleteFile))
                File.Delete(obsoleteFile);
        }
        catch
        {
            // Best-effort extraction - if it fails, VS Code will run without the extension
        }
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
