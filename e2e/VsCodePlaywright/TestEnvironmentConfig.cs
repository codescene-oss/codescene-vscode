using YamlDotNet.Serialization;

namespace csharp.VsCodePlaywright;

public sealed class TestEnvironmentConfig
{
    [YamlMember(Alias = "vscode")]
    public VsCodeConfig Vscode { get; set; } = new();

    [YamlMember(Alias = "extension")]
    public ExtensionConfig Extension { get; set; } = new();

    public void ApplyOverrides(TestEnvironmentConfig overrides)
    {
        if (overrides is null) return;

        Vscode.ApplyOverrides(overrides.Vscode);
        Extension.ApplyOverrides(overrides.Extension);
    }
}

public sealed class VsCodeConfig
{
    [YamlMember(Alias = "installdir")]
    public string? InstallDir { get; set; }

    [YamlMember(Alias = "extensionsdir")]
    public string? ExtensionsDir { get; set; }

    /// <summary>
    /// Folder path to open as the VS Code workspace. Relative paths are resolved from project root.
    /// Overridden by environment variable VSCODE_TEST_WORKSPACE_PATH (e.g. in GitHub Actions).
    /// </summary>
    [YamlMember(Alias = "workspacepath")]
    public string? WorkspacePath { get; set; }

    [YamlMember(Alias = "disableextensions")]
    public bool? DisableExtensions { get; set; }

    /// <summary>
    /// CDP readiness / page discovery timeout in milliseconds.
    /// </summary>
    [YamlMember(Alias = "cdpreadytimeout")]
    public int? CdpReadyTimeoutMs { get; set; }

    [YamlMember(Alias = "timeout")]
    public TimeoutConfig Timeout { get; set; } = new();

    [YamlMember(Alias = "window")]
    public WindowConfig Window { get; set; } = new();

    public void ApplyOverrides(VsCodeConfig overrides)
    {
        if (overrides is null) return;

        if (!string.IsNullOrWhiteSpace(overrides.InstallDir))
            InstallDir = overrides.InstallDir;

        if (!string.IsNullOrWhiteSpace(overrides.ExtensionsDir))
            ExtensionsDir = overrides.ExtensionsDir;

        if (!string.IsNullOrWhiteSpace(overrides.WorkspacePath))
            WorkspacePath = overrides.WorkspacePath;

        if (overrides.DisableExtensions.HasValue)
            DisableExtensions = overrides.DisableExtensions;

        if (overrides.CdpReadyTimeoutMs.HasValue)
            CdpReadyTimeoutMs = overrides.CdpReadyTimeoutMs;

        Timeout.ApplyOverrides(overrides.Timeout);

        Window.ApplyOverrides(overrides.Window);
    }
}

public sealed class TimeoutConfig
{
    [YamlMember(Alias = "short")]
    public int? ShortMs { get; set; }

    public void ApplyOverrides(TimeoutConfig overrides)
    {
        if (overrides is null) return;

        if (overrides.ShortMs.HasValue)
            ShortMs = overrides.ShortMs;
    }
}

public sealed class WindowConfig
{
    [YamlMember(Alias = "x")]
    public int? X { get; set; }

    [YamlMember(Alias = "y")]
    public int? Y { get; set; }

    [YamlMember(Alias = "width")]
    public int? Width { get; set; }

    [YamlMember(Alias = "height")]
    public int? Height { get; set; }

    public void ApplyOverrides(WindowConfig overrides)
    {
        if (overrides is null) return;

        if (overrides.X.HasValue)
            X = overrides.X;

        if (overrides.Y.HasValue)
            Y = overrides.Y;

        if (overrides.Width.HasValue)
            Width = overrides.Width;

        if (overrides.Height.HasValue)
            Height = overrides.Height;
    }
}

public sealed class ExtensionConfig
{
    /// <summary>
    /// Path to the .vsix file. Overridden by environment variable VSCODE_TEST_EXTENSION_VSIX_PATH (e.g. in CI).
    /// </summary>
    [YamlMember(Alias = "name")]
    public string? Name { get; set; }

    [YamlMember(Alias = "id")]
    public string? Id { get; set; }

    /// <summary>
    /// CodeScene API token. Overridden by environment variable CS_ACCESS_TOKEN (e.g. in CI).
    /// </summary>
    [YamlMember(Alias = "authToken")]
    public string? AuthToken { get; set; }

    public void ApplyOverrides(ExtensionConfig overrides)
    {
        if (overrides is null) return;

        if (!string.IsNullOrWhiteSpace(overrides.Name))
            Name = overrides.Name;

        if (!string.IsNullOrWhiteSpace(overrides.Id))
            Id = overrides.Id;

        // Allow overriding with empty string if someone wants to clear it.
        if (overrides.AuthToken is not null)
            AuthToken = overrides.AuthToken;
    }
}
