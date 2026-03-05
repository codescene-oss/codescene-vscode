using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Allure.Net.Commons;
using Codescene.E2E.Playwright.Tests.Playwright;
using Microsoft.Playwright;
using Serilog;

namespace Codescene.E2E.Playwright.Tests.Utils;

public static class VSCodeUtils
{
    public static async Task TryCaptureFailureScreenshotAsync(
        IPage? page,
        string testFullName,
        ILogger logger,
        bool preferCdp = true)
    {
        try
        {
            var projectRoot = FileUtils.FindProjectRootDirectory();
            var screenshotsDir = Path.Combine(projectRoot, "report", "screenshots");
            Directory.CreateDirectory(screenshotsDir);
            var fileName = FileUtils.SanitizeFileName($"{testFullName}_{DateTime.Now:yyyyMMdd_HHmmssfff}.png");
            var screenshotPath = Path.Combine(screenshotsDir, fileName);

            if (page != null)
            {
                await VsCodeDriver.CaptureScreenshotAsync(page, screenshotPath, preferCdp: preferCdp);
                logger.Information("Saved failure screenshot: {Path}", screenshotPath);
                try { AllureApi.AddAttachment("Failure screenshot", "image/png", screenshotPath); }
                catch { }
            }
            else
            {
                logger.Warning("Test failed but Page is null; skipping screenshot.");
            }
        }
        catch (Exception ex)
        {
            logger.Warning(ex, "Failed to capture failure screenshot.");
        }
    }

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
            var dir = await DumpVsCodeDomAsync(page, label, logger, includeFrames, includeMhtmlSnapshot, attachToAllure);
            logger.Information("Saved VS Code DOM dump: {Dir}", dir);
        }
        catch (Exception ex)
        {
            logger.Warning(ex, "Failed to dump VS Code DOM.");
        }
    }

    public static string DumpVsCodeDom(
        IPage page,
        string label,
        ILogger logger,
        bool includeFrames = true,
        bool includeMhtmlSnapshot = true,
        bool attachToAllure = false) =>
        RunSync(() => DumpVsCodeDomAsync(page, label, logger, includeFrames, includeMhtmlSnapshot, attachToAllure));

    public static void TryDumpVsCodeDom(
        IPage? page,
        string label,
        ILogger logger,
        bool includeFrames = true,
        bool includeMhtmlSnapshot = true,
        bool attachToAllure = false) =>
        RunSync(() => TryDumpVsCodeDomAsync(page, label, logger, includeFrames, includeMhtmlSnapshot, attachToAllure));

    private static T RunSync<T>(Func<Task<T>> asyncFunc) =>
        Task.Run(asyncFunc).GetAwaiter().GetResult();

    private static void RunSync(Func<Task> asyncFunc) =>
        Task.Run(asyncFunc).GetAwaiter().GetResult();

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

        var projectRoot = FileUtils.FindProjectRootDirectory();
        var domRoot = Path.Combine(projectRoot, "report", "dom");
        Directory.CreateDirectory(domRoot);
        var safeLabel = string.IsNullOrWhiteSpace(label) ? "dom" : label;
        var runDirName = Path.GetFileNameWithoutExtension(FileUtils.SanitizeFileName($"{safeLabel}_{DateTime.Now:yyyyMMdd_HHmmssfff}"));
        var runDir = Path.Combine(domRoot, runDirName);
        Directory.CreateDirectory(runDir);

        var meta = new Dictionary<string, object?>
        {
            ["timestampUtc"] = DateTime.UtcNow.ToString("O"),
            ["pageUrl"] = page.Url,
            ["includeFrames"] = includeFrames,
            ["includeMhtmlSnapshot"] = includeMhtmlSnapshot
        };

        await WriteMainHtmlAsync(page, runDir, attachToAllure);
        if (includeFrames)
            meta["frames"] = await WriteFramesAsync(page, runDir, attachToAllure);
        if (includeMhtmlSnapshot)
            await WriteMhtmlSnapshotAsync(page, runDir, meta, logger, attachToAllure);

        var metaPath = Path.Combine(runDir, "meta.json");
        await File.WriteAllTextAsync(metaPath, JsonSerializer.Serialize(meta, new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
        return runDir;
    }

    private static async Task WriteMainHtmlAsync(IPage page, string runDir, bool attachToAllure)
    {
        var mainHtmlPath = Path.Combine(runDir, "main.html");
        var mainHtml = await page.EvaluateAsync<string>("() => document.documentElement ? document.documentElement.outerHTML : ''");
        await File.WriteAllTextAsync(mainHtmlPath, mainHtml ?? string.Empty, Encoding.UTF8);
        if (attachToAllure)
            TryAttachToAllure("VS Code DOM (main)", "text/html", mainHtmlPath);
    }

    private static async Task<List<Dictionary<string, object?>>> WriteFramesAsync(IPage page, string runDir, bool attachToAllure)
    {
        var framesDir = Path.Combine(runDir, "frames");
        Directory.CreateDirectory(framesDir);
        var framesMeta = new List<Dictionary<string, object?>>();
        var frames = page.Frames;
        for (var i = 0; i < frames.Count; i++)
        {
            var frame = frames[i];
            string html;
            try { html = await frame.ContentAsync(); }
            catch (Exception ex) { html = "<!-- Failed to read frame content: " + ex.Message + " -->"; }
            var hint = !string.IsNullOrWhiteSpace(frame.Name) ? frame.Name : frame.Url ?? "frame";
            var frameFile = FileUtils.SanitizeFileName($"frame_{i:00}_{hint}.html", maxLength: 160);
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
                TryAttachToAllure($"VS Code DOM (frame {i:00})", "text/html", framePath);
        }
        return framesMeta;
    }

    private static async Task WriteMhtmlSnapshotAsync(IPage page, string runDir, Dictionary<string, object?> meta, ILogger logger, bool attachToAllure)
    {
        var mhtmlPath = Path.Combine(runDir, "snapshot.mhtml");
        try
        {
            var mhtml = await CaptureMhtmlSnapshotViaCdpAsync(page);
            await File.WriteAllTextAsync(mhtmlPath, mhtml ?? string.Empty, Encoding.UTF8);
            meta["mhtml"] = Path.GetFileName(mhtmlPath);
            if (attachToAllure)
                TryAttachToAllure("VS Code DOM snapshot (MHTML)", "multipart/related", mhtmlPath);
        }
        catch (Exception ex)
        {
            logger.Warning(ex, "Failed to capture MHTML snapshot via CDP.");
            meta["mhtmlError"] = ex.Message;
        }
    }

    private static async Task<string?> CaptureMhtmlSnapshotViaCdpAsync(IPage page)
    {
        var session = await page.Context.NewCDPSessionAsync(page);
        try
        {
            var resp = await session.SendAsync("Page.captureSnapshot", new Dictionary<string, object> { ["format"] = "mhtml" });
            if (resp is null) throw new InvalidOperationException("CDP returned null for Page.captureSnapshot.");
            if (!resp.Value.TryGetProperty("data", out var dataProp)) throw new InvalidOperationException("CDP response did not contain 'data' for Page.captureSnapshot.");
            return dataProp.GetString();
        }
        finally
        {
            try { await session.DetachAsync(); }
            catch { }
        }
    }

    private static void TryAttachToAllure(string name, string mimeType, string filePath)
    {
        try { AllureApi.AddAttachment(name, mimeType, filePath); }
        catch { }
    }

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

        var (success, lastError) = await RetryLoopAsync(action, stopCondition, timeoutMs, retryDelayMs);
        if (success)
            return;
        var msg = $"Retry timed out after {timeoutMs}ms." + (lastError != null ? " Last error: " + lastError.Message : string.Empty);
        throw new TimeoutException(msg);
    }

    private static async Task<(bool success, Exception? lastError)> RetryLoopAsync(Func<Task> action, Func<bool> stopCondition, int timeoutMs, int retryDelayMs)
    {
        var sw = Stopwatch.StartNew();
        Exception? lastError = null;
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            lastError = await RunAndCaptureAsync(action);
            if (stopCondition())
                return (true, null);
            if (retryDelayMs > 0)
                await Task.Delay(retryDelayMs);
        }
        return (false, lastError);
    }

    private static async Task<Exception?> RunAndCaptureAsync(Func<Task> action)
    {
        try
        {
            await action();
            return null;
        }
        catch (Exception ex)
        {
            return ex;
        }
    }
}
