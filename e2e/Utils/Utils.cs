using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Allure.Net.Commons;
using Microsoft.Playwright;
using Serilog;

namespace csharp.VsCodePlaywright;

public static class Utils
{
    public static string FindProjectRootDirectory()
    {
        // Try to locate the directory that contains the .csproj so artifacts land in the project folder.
        // Start from the test binary output (AppContext.BaseDirectory) and walk upwards.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            if (dir.EnumerateFiles("*.csproj", SearchOption.TopDirectoryOnly).Any())
                return dir.FullName;

            dir = dir.Parent;
        }

        return Directory.GetCurrentDirectory();
    }

    public static string SanitizeFileName(string name, int maxLength = 180)
    {
        if (string.IsNullOrWhiteSpace(name))
            return "screenshot.png";

        var invalidChars = Path.GetInvalidFileNameChars();
        var sb = new StringBuilder(name.Length);
        foreach (var ch in name)
            sb.Append(Array.IndexOf(invalidChars, ch) >= 0 ? '_' : ch);

        // Avoid very long paths on Windows. Preserve the file extension.
        maxLength = Math.Clamp(maxLength, 16, 240);
        var sanitized = sb.ToString();

        var ext = Path.GetExtension(sanitized);
        if (string.IsNullOrWhiteSpace(ext))
            ext = ".png";

        var baseName = Path.GetFileNameWithoutExtension(sanitized);
        var maxBaseLength = Math.Max(1, maxLength - ext.Length);
        if (baseName.Length > maxBaseLength)
            baseName = baseName.Substring(0, maxBaseLength);

        return baseName + ext;
    }

    /// <summary>
    /// Best-effort failure screenshot capture. Never throws.
    /// Saves a PNG to report/screenshots under the project root.
    /// </summary>
    public static async Task TryCaptureFailureScreenshotAsync(
        IPage? page,
        string testFullName,
        ILogger logger,
        bool preferCdp = true)
    {
        try
        {
            var projectRoot = FindProjectRootDirectory();
            var screenshotsDir = Path.Combine(projectRoot, "report", "screenshots");
            Directory.CreateDirectory(screenshotsDir);

            var fileName = SanitizeFileName($"{testFullName}_{DateTime.Now:yyyyMMdd_HHmmssfff}.png");
            var screenshotPath = Path.Combine(screenshotsDir, fileName);

            if (page != null)
            {
                await VsCodeDriver.CaptureScreenshotAsync(page, screenshotPath, preferCdp: preferCdp);
                logger.Information("Saved failure screenshot: {Path}", screenshotPath);

                try
                {
                    AllureApi.AddAttachment(
                        "Failure screenshot",
                        "image/png",
                        screenshotPath);
                }
                catch
                {
                    // Best-effort: Allure should not be required for running tests.
                }
            }
            else
            {
                logger.Warning("Test failed but Page is null; skipping screenshot.");
            }
        }
        catch (Exception ex)
        {
            // Never let screenshot capture hide the original test failure.
            logger.Warning(ex, "Failed to capture failure screenshot.");
        }
    }

    /// <summary>
    /// Best-effort DOM dump for debugging/AI analysis. Never throws.
    /// Saves artifacts under report/dom/.
    /// </summary>
    public static async Task TryDumpVsCodeDomAsync(
        IPage? page,
        string label,
        ILogger logger,
        bool includeFrames = true,
        bool includeMhtmlSnapshot = true,
        bool attachToAllure = false)
    {
        try
        {
            if (page is null)
            {
                logger.Warning("Requested DOM dump but Page is null; skipping.");
                return;
            }

            var dir = await DumpVsCodeDomAsync(
                page,
                label,
                logger,
                includeFrames: includeFrames,
                includeMhtmlSnapshot: includeMhtmlSnapshot,
                attachToAllure: attachToAllure);

            logger.Information("Saved VS Code DOM dump: {Dir}", dir);
        }
        catch (Exception ex)
        {
            logger.Warning(ex, "Failed to dump VS Code DOM.");
        }
    }

    /// <summary>
    /// Synchronous wrapper around <see cref="DumpVsCodeDomAsync"/>.
    /// Useful in debugger Immediate/Watch windows where <c>await</c> is not supported.
    /// </summary>
    public static string DumpVsCodeDom(
        IPage page,
        string label,
        ILogger logger,
        bool includeFrames = true,
        bool includeMhtmlSnapshot = true,
        bool attachToAllure = false)
    {
        return Task.Run(() => DumpVsCodeDomAsync(
                page,
                label,
                logger,
                includeFrames: includeFrames,
                includeMhtmlSnapshot: includeMhtmlSnapshot,
                attachToAllure: attachToAllure))
            .GetAwaiter()
            .GetResult();
    }

    /// <summary>
    /// Synchronous wrapper around <see cref="TryDumpVsCodeDomAsync"/>.
    /// Useful in debugger Immediate/Watch windows where <c>await</c> is not supported.
    /// </summary>
    public static void TryDumpVsCodeDom(
        IPage? page,
        string label,
        ILogger logger,
        bool includeFrames = true,
        bool includeMhtmlSnapshot = true,
        bool attachToAllure = false)
    {
        Task.Run(() => TryDumpVsCodeDomAsync(
                page,
                label,
                logger,
                includeFrames: includeFrames,
                includeMhtmlSnapshot: includeMhtmlSnapshot,
                attachToAllure: attachToAllure))
            .GetAwaiter()
            .GetResult();
    }

    /// <summary>
    /// Dumps the current VS Code renderer DOM to disk for offline inspection.
    ///
    /// Output:
    /// - report/dom/&lt;label&gt;_&lt;timestamp&gt;/main.html
    /// - report/dom/&lt;label&gt;_&lt;timestamp&gt;/frames/frame_XX_*.html (optional)
    /// - report/dom/&lt;label&gt;_&lt;timestamp&gt;/snapshot.mhtml (optional, via CDP)
    /// - report/dom/&lt;label&gt;_&lt;timestamp&gt;/meta.json
    /// </summary>
    public static async Task<string> DumpVsCodeDomAsync(
        IPage page,
        string label,
        ILogger logger,
        bool includeFrames = true,
        bool includeMhtmlSnapshot = true,
        bool attachToAllure = false)
    {
        if (page is null) throw new ArgumentNullException(nameof(page));
        if (logger is null) throw new ArgumentNullException(nameof(logger));

        var projectRoot = FindProjectRootDirectory();
        var domRoot = Path.Combine(projectRoot, "report", "dom");
        Directory.CreateDirectory(domRoot);

        var safeLabel = string.IsNullOrWhiteSpace(label) ? "dom" : label;
        var runDirName = SanitizeFileName($"{safeLabel}_{DateTime.Now:yyyyMMdd_HHmmssfff}");
        runDirName = Path.GetFileNameWithoutExtension(runDirName);

        var runDir = Path.Combine(domRoot, runDirName);
        Directory.CreateDirectory(runDir);

        var meta = new Dictionary<string, object?>
        {
            ["timestampUtc"] = DateTime.UtcNow.ToString("O"),
            ["pageUrl"] = page.Url,
            ["includeFrames"] = includeFrames,
            ["includeMhtmlSnapshot"] = includeMhtmlSnapshot
        };

        // Main HTML
        var mainHtmlPath = Path.Combine(runDir, "main.html");
        var mainHtml = await page.EvaluateAsync<string>("() => document.documentElement ? document.documentElement.outerHTML : ''");
        await File.WriteAllTextAsync(mainHtmlPath, mainHtml ?? string.Empty, Encoding.UTF8);

        if (attachToAllure)
        {
            TryAttachToAllure("VS Code DOM (main)", "text/html", mainHtmlPath);
        }

        // Frames HTML
        if (includeFrames)
        {
            var framesDir = Path.Combine(runDir, "frames");
            Directory.CreateDirectory(framesDir);

            var framesMeta = new List<Dictionary<string, object?>>();
            var frames = page.Frames;
            for (var i = 0; i < frames.Count; i++)
            {
                var frame = frames[i];
                string html;

                try
                {
                    html = await frame.ContentAsync();
                }
                catch (Exception ex)
                {
                    html = "<!-- Failed to read frame content: " + ex.Message + " -->";
                }

                var hint = !string.IsNullOrWhiteSpace(frame.Name) ? frame.Name : frame.Url;
                if (string.IsNullOrWhiteSpace(hint))
                    hint = "frame";

                var frameFile = SanitizeFileName($"frame_{i:00}_{hint}.html", maxLength: 160);
                var framePath = Path.Combine(framesDir, frameFile);

                await File.WriteAllTextAsync(framePath, html ?? string.Empty, Encoding.UTF8);

                framesMeta.Add(new Dictionary<string, object?>
                {
                    ["index"] = i,
                    ["name"] = frame.Name,
                    ["url"] = frame.Url,
                    ["file"] = Path.GetFileName(framePath)
                });

                if (attachToAllure)
                {
                    TryAttachToAllure($"VS Code DOM (frame {i:00})", "text/html", framePath);
                }
            }

            meta["frames"] = framesMeta;
        }

        // Optional: MHTML snapshot via CDP (more self-contained than plain HTML)
        if (includeMhtmlSnapshot)
        {
            var mhtmlPath = Path.Combine(runDir, "snapshot.mhtml");
            try
            {
                var mhtml = await CaptureMhtmlSnapshotViaCdpAsync(page);
                await File.WriteAllTextAsync(mhtmlPath, mhtml ?? string.Empty, Encoding.UTF8);
                meta["mhtml"] = Path.GetFileName(mhtmlPath);

                if (attachToAllure)
                {
                    TryAttachToAllure("VS Code DOM snapshot (MHTML)", "multipart/related", mhtmlPath);
                }
            }
            catch (Exception ex)
            {
                logger.Warning(ex, "Failed to capture MHTML snapshot via CDP.");
                meta["mhtmlError"] = ex.Message;
            }
        }

        var metaPath = Path.Combine(runDir, "meta.json");
        var metaJson = JsonSerializer.Serialize(meta, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(metaPath, metaJson, Encoding.UTF8);

        return runDir;
    }

    private static async Task<string?> CaptureMhtmlSnapshotViaCdpAsync(IPage page)
    {
        var session = await page.Context.NewCDPSessionAsync(page);
        try
        {
            var resp = await session.SendAsync(
                "Page.captureSnapshot",
                new Dictionary<string, object>
                {
                    ["format"] = "mhtml"
                });

            if (resp is null)
                throw new InvalidOperationException("CDP returned null for Page.captureSnapshot.");

            if (!resp.Value.TryGetProperty("data", out var dataProp))
                throw new InvalidOperationException("CDP response did not contain 'data' for Page.captureSnapshot.");

            return dataProp.GetString();
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

    private static void TryAttachToAllure(string name, string mimeType, string filePath)
    {
        try
        {
            AllureApi.AddAttachment(name, mimeType, filePath);
        }
        catch
        {
            // Best-effort: Allure should not be required.
        }
    }

    /// <summary>
    /// Repeatedly executes <paramref name="action"/> until <paramref name="stopCondition"/> is true or the timeout is reached.
    /// </summary>
    public static async Task RetryCondition(
        Func<Task> action,
        Func<bool> stopCondition,
        int timeoutMs = 3_000,
        int retryDelayMs = 100)
    {
        if (action is null) throw new ArgumentNullException(nameof(action));
        if (stopCondition is null) throw new ArgumentNullException(nameof(stopCondition));
        if (timeoutMs <= 0) throw new ArgumentOutOfRangeException(nameof(timeoutMs));
        if (retryDelayMs < 0) throw new ArgumentOutOfRangeException(nameof(retryDelayMs));

        var sw = Stopwatch.StartNew();
        Exception? lastError = null;

        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            try
            {
                await action();
                lastError = null;
            }
            catch (Exception ex)
            {
                lastError = ex;
            }

            if (stopCondition())
                return;

            if (retryDelayMs > 0)
                await Task.Delay(retryDelayMs);
        }

        throw new TimeoutException(
            $"Retry timed out after {timeoutMs}ms." +
            (lastError != null ? " Last error: " + lastError.Message : string.Empty));
    }
}
