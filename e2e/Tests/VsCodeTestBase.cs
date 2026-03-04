using System.Text.Json;
using Allure.NUnit;
using Codescene.E2E.Playwright.Tests.Configuration;
using Codescene.E2E.Playwright.Tests.Playwright;
using Codescene.E2E.Playwright.Tests.Utils;
using Microsoft.Playwright;
using NUnit.Framework.Interfaces;
using Serilog;

namespace Codescene.E2E.Playwright.Tests.Tests;

[AllureNUnit]
public abstract class VsCodeTestBase
{
    protected const string DefaultPortableRoot = @".\.vscode-test\VSCode-win32-x64";

    private static int _loggingInitialized;

    protected TestWorkspace? Workspace { get; private set; }
    protected string PortableRoot { get; private set; } = DefaultPortableRoot;
    protected string WorkspacePath { get; private set; } = string.Empty;
    protected string WorkspaceSessionFilePath { get; private set; } = string.Empty;
    protected VsCodeSession? Session { get; private set; }
    protected IPage? Page { get; private set; }
    protected ILogger Logger { get; private set; } = Log.Logger;
    protected string LogFilePath { get; private set; } = "vscode.test.log";

    [OneTimeSetUp]
    public void OneTimeSetupLogging()
    {
        if (Interlocked.Exchange(ref _loggingInitialized, 1) == 1)
            return;

        var projectRoot = FindProjectRootDirectory();
        LogFilePath = Path.Combine(projectRoot, "vscode.test.log");

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .Enrich.FromLogContext()
            .WriteTo.File(
                path: LogFilePath,
                shared: true,
                flushToDiskInterval: TimeSpan.FromSeconds(1),
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
            .CreateLogger();
    }

    [OneTimeTearDown]
    public void OneTimeTearDownLogging()
    {
        Log.CloseAndFlush();
    }

    private static string FindProjectRootDirectory()
    {
        return FileUtils.FindProjectRootDirectory();
    }

    private static string? ResolveExtensionVsixPath(string projectRoot, TestEnvironmentConfig envConfig)
    {
        if (string.IsNullOrWhiteSpace(envConfig.Extension.Name))
            return null;

        if (File.Exists(envConfig.Extension.Name))
            return envConfig.Extension.Name;

        if (string.IsNullOrWhiteSpace(envConfig.Vscode.ExtensionsDir))
            return null;

        var dir = envConfig.Vscode.ExtensionsDir;
        var name = Path.GetFileName(envConfig.Extension.Name);
        var withVsix = Path.Combine(dir, name.EndsWith(".vsix", StringComparison.OrdinalIgnoreCase) ? name : name + ".vsix");
        if (File.Exists(withVsix))
            return withVsix;
        var withoutVsix = Path.Combine(dir, name);
        if (File.Exists(withoutVsix))
            return withoutVsix;
        return null;
    }

    protected virtual Task SetupWorkspace(TestWorkspace workspace) => Task.CompletedTask;

    private static void LogChatVisibilitySettingsFromJson(ILogger logger, string label, string settingsJsonPath)
    {
        try
        {
            if (!File.Exists(settingsJsonPath))
            {
                logger.Information("{Label} settings: <none> ({Path} missing)", label, settingsJsonPath);
                return;
            }

            var json = File.ReadAllText(settingsJsonPath);
            if (string.IsNullOrWhiteSpace(json))
            {
                logger.Information("{Label} settings: <empty> ({Path})", label, settingsJsonPath);
                return;
            }

            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                logger.Information("{Label} settings: <not an object> ({Path})", label, settingsJsonPath);
                return;
            }

            static bool TryGet(JsonElement root, string key, out JsonElement value)
            {
                foreach (var prop in root.EnumerateObject())
                {
                    if (string.Equals(prop.Name, key, StringComparison.OrdinalIgnoreCase))
                    {
                        value = prop.Value;
                        return true;
                    }
                }
                value = default;
                return false;
            }

            var root = doc.RootElement;
            var keys = new[]
            {
                "workbench.secondarySideBar.defaultVisibility",
                "chat.restoreLastPanelSession",
                "chat.viewWelcome.enabled",
                "chat.commandCenter.enabled",
                "chat.viewTitle.enabled",
                "chat.disableAIFeatures"
            };

            foreach (var key in keys)
            {
                if (TryGet(root, key, out var value))
                    logger.Information("{Label} setting {Key} = {Value}", label, key, value.ToString());
            }
        }
        catch (Exception ex)
        {
            logger.Warning(ex, "Failed to read {Label} settings from {Path}", label, settingsJsonPath);
        }
    }

    [SetUp]
    public async Task Setup()
    {
        Logger = Log.Logger.ForContext("Test", TestContext.CurrentContext.Test.FullName);
        LogSetupStart();
        var projectRoot = FindProjectRootDirectory();
        Logger.Information("ProjectRoot: {ProjectRoot}", projectRoot);

        var envConfig = TestEnvironmentConfigLoader.LoadFromProjectRoot(projectRoot);
        TestEnvironment.Initialize(envConfig);

        var (installDir, extensionsDir) = ResolveInstallPaths(projectRoot, envConfig);
        PortableRoot = installDir;
        LogResolvedPaths(installDir, extensionsDir, envConfig);

        await CreateWorkspaceAsync();
        LogWorkspaceSettings();
        EnsurePortableExists();

        var sessionOptions = BuildSessionOptions(projectRoot, envConfig, extensionsDir);
        Session = await VsCodeDriver.StartAndConnectAsync(sessionOptions);
        LogSessionAfterStart();
        Assert.That(Session.Process.HasExited, Is.False, "VS Code process should be running.");

        Page = await VsCodeDriver.GetFirstPageAsync(Session.Browser, sessionOptions.CdpReadyTimeout);
        await LogRendererRuntimeAsync();
        await SetWindowBoundsAsync(sessionOptions);
        Assert.That(Session, Is.Not.Null);
        Assert.That(Page, Is.Not.Null);

        Logger.Information("Connected to VS Code. CdpPort={CdpPort} Url={Url}", Session.CdpPort, Page.Url);
        Logger.Information("VS Code UI layout snapshot: {Snapshot}", await VsCodeDriver.GetUiLayoutSnapshotAsync(Page));
        Logger.Information("=== Test setup complete ===");
    }

    private void LogSetupStart()
    {
        Logger.Information("=== Test setup start ===");
        Logger.Information("WorkDirectory: {WorkDirectory}", TestContext.CurrentContext.WorkDirectory);
        Logger.Information("CurrentDirectory: {CurrentDirectory}", Directory.GetCurrentDirectory());
        Logger.Information("AppContext.BaseDirectory: {BaseDirectory}", AppContext.BaseDirectory);
        Logger.Information("ELECTRON_RUN_AS_NODE (parent): {Value}", Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE"));
    }

    private static (string installDir, string? extensionsDir) ResolveInstallPaths(string projectRoot, TestEnvironmentConfig envConfig)
    {
        var installDir = envConfig.Vscode.InstallDir;
        installDir = string.IsNullOrWhiteSpace(installDir)
            ? Path.GetFullPath(Path.Combine(projectRoot, DefaultPortableRoot))
            : Path.IsPathRooted(installDir) ? installDir : Path.GetFullPath(Path.Combine(projectRoot, installDir));

        var extensionsDir = envConfig.Vscode.ExtensionsDir;
        if (!string.IsNullOrWhiteSpace(extensionsDir) && !Path.IsPathRooted(extensionsDir))
            extensionsDir = Path.GetFullPath(Path.Combine(projectRoot, extensionsDir));
        return (installDir, extensionsDir);
    }

    private void LogResolvedPaths(string installDir, string? extensionsDir, TestEnvironmentConfig envConfig)
    {
        Logger.Information("VS Code InstallDir (config): {InstallDir}", installDir);
        Logger.Information("VS Code ExtensionsDir (resolved): {ExtensionsDir}", extensionsDir);
        Logger.Information(
            "VS Code Window (config): x={X} y={Y} width={Width} height={Height}",
            envConfig.Vscode.Window.X, envConfig.Vscode.Window.Y,
            envConfig.Vscode.Window.Width, envConfig.Vscode.Window.Height);
        Logger.Information("VS Code CDP Ready Timeout (config, ms): {TimeoutMs}", envConfig.Vscode.CdpReadyTimeoutMs);
    }

    private async Task CreateWorkspaceAsync()
    {
        Workspace = new TestWorkspace();
        await SetupWorkspace(Workspace);
        WorkspacePath = Workspace.RootPath;
        Logger.Information("WorkspacePath: {WorkspacePath}", WorkspacePath);
    }

    private void LogWorkspaceSettings()
    {
        LogChatVisibilitySettingsFromJson(Logger, "Workspace", Path.Combine(WorkspacePath, ".vscode", "settings.json"));
    }

    private void EnsurePortableExists()
    {
        if (File.Exists(Path.Combine(PortableRoot, "Code.exe")) || File.Exists(Path.Combine(PortableRoot, "Code - Insiders.exe")))
            return;
        Assert.Ignore(
            "VS Code portable not found. Expected Code.exe under: " + PortableRoot +
            ". Set VSCODE_PORTABLE_ROOT if your VS Code ZIP is elsewhere (or ensure relative paths are relative to the project root).");
    }

    private VsCodeSessionOptions BuildSessionOptions(string projectRoot, TestEnvironmentConfig envConfig, string? extensionsDir)
    {
        var installVsixPath = ResolveExtensionVsixPath(projectRoot, envConfig);
        var options = new VsCodeSessionOptions
        {
            PortableRoot = PortableRoot,
            WorkspacePath = WorkspacePath,
            ExtensionsDir = extensionsDir,
            InstallExtensionVsixPath = installVsixPath,
            DisableWorkspaceTrust = true,
            CdpReadyTimeout = TimeSpan.FromMilliseconds(envConfig.Vscode.CdpReadyTimeoutMs ?? 30000),
            WindowX = envConfig.Vscode.Window.X ?? 0,
            WindowY = envConfig.Vscode.Window.Y ?? 0,
            WindowWidth = envConfig.Vscode.Window.Width ?? 1400,
            WindowHeight = envConfig.Vscode.Window.Height ?? 1200
        };
        if (string.IsNullOrWhiteSpace(envConfig.Extension.AuthToken))
            return options;
        return options with
        {
            UserSettings = new Dictionary<string, string> { ["codescene.authToken"] = envConfig.Extension.AuthToken }
        };
    }

    private void LogSessionAfterStart()
    {
        Logger.Information("VS Code launched: {Exe} {Args}", Session!.LaunchedExecutablePath, Session.LaunchedArguments);
        Logger.Information("VS Code process: Id={Pid}", Session.Process.Id);
        try { Logger.Information("VS Code main module: {Path}", Session.Process.MainModule?.FileName ?? "<null>"); }
        catch (Exception ex) { Logger.Information(ex, "VS Code main module path unavailable"); }
        Logger.Information(
            "VS Code isolation: --user-data-dir={UserDataDir} --extensions-dir={ExtensionsDir} VSCODE_APPDATA={AppDataDir}",
            Session.UserDataDir, Session.ExtensionsDir, string.IsNullOrWhiteSpace(Session.AppDataDir) ? "<unset>" : Session.AppDataDir);
        LogChatVisibilitySettingsFromJson(Logger, "User", Path.Combine(Session.UserDataDir, "User", "settings.json"));
    }

    private async Task LogRendererRuntimeAsync()
    {
        try
        {
            var runtimeInfo = await Page!.EvaluateAsync<string>("""
                () => {
                    const p = (typeof process !== 'undefined') ? process : undefined;
                    const env = p?.env || {};
                    return JSON.stringify({ execPath: p?.execPath, argv: p?.argv, env: { VSCODE_APPDATA: env.VSCODE_APPDATA, APPDATA: env.APPDATA, USERPROFILE: env.USERPROFILE } });
                }
                """);
            Logger.Information("VS Code renderer runtime: {RuntimeInfo}", runtimeInfo);
        }
        catch (Exception ex) { Logger.Information(ex, "Failed to query VS Code renderer runtime info"); }
    }

    private async Task SetWindowBoundsAsync(VsCodeSessionOptions sessionOptions)
    {
        try
        {
            await VsCodeDriver.SetWindowBoundsAsync(Page!, sessionOptions.WindowX, sessionOptions.WindowY, sessionOptions.WindowWidth, sessionOptions.WindowHeight);
        }
        catch (NotSupportedException ex)
        {
            Logger.Warning(ex, "Window positioning/sizing is not supported by this CDP endpoint; continuing without enforcing bounds.");
        }
    }

    [TearDown]
    public async Task TearDown()
    {
        Logger.Information("=== Test teardown start ===");

        if (TestContext.CurrentContext.Result.Outcome.Status == TestStatus.Failed)
        {
            await VSCodeUtils.TryCaptureFailureScreenshotAsync(
                page: Page,
                testFullName: TestContext.CurrentContext.Test.FullName,
                logger: Logger,
                preferCdp: true);
        }

        if (Session != null)
        {
            Logger.Information("Disposing VS Code session.");
            await Session.DisposeAsync();
            Session = null;
            Page = null;
        }

        if (Workspace != null)
        {
            Workspace.Dispose();
            Workspace = null;
        }
        Logger.Information("=== Test teardown complete ===");
    }

}
