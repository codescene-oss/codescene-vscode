namespace Codescene.E2E.Playwright.Tests.Playwright;

public sealed record VsCodeSessionOptions
{
    /// <summary>
    /// Root folder of an extracted VS Code ZIP (containing Code.exe), e.g. D:\Tools\VSCode-win32-x64.
    /// </summary>
    public required string PortableRoot { get; init; }

    /// <summary>
    /// Optional workspace folder to open. If null, a temp folder is created.
    /// </summary>
    public string? WorkspacePath { get; init; }

    /// <summary>
    /// Optional extensions directory to use (passed as --extensions-dir).
    ///
    /// If not provided, a temporary directory is created and cleaned up with the session.
    /// If provided, the directory is NOT deleted during session cleanup.
    /// </summary>
    public string? ExtensionsDir { get; init; }

    /// <summary>
    /// Optional path to a .vsix file to install into ExtensionsDir before launching VS Code.
    /// If set, runs: Code.exe --extensions-dir=... --user-data-dir=... --install-extension &lt;path&gt;
    /// </summary>
    public string? InstallExtensionVsixPath { get; init; }

    /// <summary>
    /// If true, forces VS Code to use a temporary appdata root (via VSCODE_APPDATA)
    /// so it does not read/write the host user's %APPDATA%\Code.
    /// </summary>
    public bool IsolateAppData { get; init; } = true;

    /// <summary>
    /// Additional VS Code arguments appended after automation flags.
    /// </summary>
    public string? AdditionalArgs { get; init; }

    /// <summary>
    /// User settings to write into the temporary VS Code profile (User/settings.json) before VS Code starts.
    ///
    /// Example: { "codescene.authToken" : "..." }
    /// </summary>
    public IReadOnlyDictionary<string, string>? UserSettings { get; init; }

    /// <summary>
    /// Timeout for CDP endpoint availability.
    /// </summary>
    public TimeSpan CdpReadyTimeout { get; init; } = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Initial VS Code window X position (pixels). Passed as --window-position=x,y.
    /// </summary>
    public int WindowX { get; init; } = 0;

    /// <summary>
    /// Initial VS Code window Y position (pixels). Passed as --window-position=x,y.
    /// </summary>
    public int WindowY { get; init; } = 0;

    /// <summary>
    /// Initial VS Code window width (pixels). Passed as --window-size=width,height.
    /// </summary>
    public int WindowWidth { get; init; } = 800;

    /// <summary>
    /// Initial VS Code window height (pixels). Passed as --window-size=width,height.
    /// </summary>
    public int WindowHeight { get; init; } = 1200;

    /// <summary>
    /// If true, disables VS Code Settings Sync and other profile-restoration behaviors
    /// to avoid inheriting signed-in user state (e.g. layout, synced settings).
    /// Implemented by pre-seeding settings in the temporary user profile.
    /// </summary>
    public bool DisableSettingsSync { get; init; } = true;

    /// <summary>
    /// If true, marks the temporary profile's User/settings.json as read-only after seeding.
    /// This prevents VS Code (or extensions) from mutating user settings at runtime, which can
    /// otherwise flip UI state like Chat "Show View by Default" back on.
    /// </summary>
    public bool LockUserSettingsJson { get; init; } = true;

    /// <summary>
    /// If true, disables Workspace Trust (suppresses the "Do you trust the authors" prompt).
    /// </summary>
    public bool DisableWorkspaceTrust { get; init; } = true;
}
