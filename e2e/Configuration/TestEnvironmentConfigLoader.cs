using Microsoft.Extensions.Configuration;

namespace Codescene.E2E.Playwright.Tests.Configuration;

public static class TestEnvironmentConfigLoader
{
    public static TestEnvironmentConfig LoadFromProjectRoot(string projectRoot)
    {
        if (string.IsNullOrWhiteSpace(projectRoot))
            throw new ArgumentException("Project root must be provided.", nameof(projectRoot));

        var config = new ConfigurationBuilder()
            .SetBasePath(projectRoot)
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile("appsettings.Development.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var envConfig = new TestEnvironmentConfig();
        config.Bind(envConfig);

        NormalizePaths(projectRoot, envConfig);

        var extensionPathEnv = Environment.GetEnvironmentVariable("VSCODE_TEST_EXTENSION_VSIX_PATH");
        if (!string.IsNullOrWhiteSpace(extensionPathEnv))
            envConfig.Extension.Name = Path.GetFullPath(extensionPathEnv);

        var authTokenEnv = Environment.GetEnvironmentVariable("CS_ACCESS_TOKEN");
        if (!string.IsNullOrWhiteSpace(authTokenEnv))
            envConfig.Extension.AuthToken = authTokenEnv;

        return envConfig;
    }

    private static void NormalizePaths(string projectRoot, TestEnvironmentConfig cfg)
    {
        if (cfg is null) return;

        if (!string.IsNullOrWhiteSpace(cfg.Vscode.InstallDir))
            cfg.Vscode.InstallDir = MakeAbsolute(projectRoot, cfg.Vscode.InstallDir);

        if (!string.IsNullOrWhiteSpace(cfg.Vscode.ExtensionsDir))
            cfg.Vscode.ExtensionsDir = MakeAbsolute(projectRoot, cfg.Vscode.ExtensionsDir);

        if (!string.IsNullOrWhiteSpace(cfg.Vscode.WorkspacePath))
            cfg.Vscode.WorkspacePath = MakeAbsolute(projectRoot, cfg.Vscode.WorkspacePath);

        if (!string.IsNullOrWhiteSpace(cfg.Extension.Name))
            cfg.Extension.Name = MakeAbsolute(projectRoot, cfg.Extension.Name);
    }

    private static string MakeAbsolute(string projectRoot, string path)
    {
        if (Path.IsPathRooted(path))
            return path;

        return Path.GetFullPath(Path.Combine(projectRoot, path));
    }
}
