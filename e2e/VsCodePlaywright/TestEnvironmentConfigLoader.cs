using System;
using System.IO;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace csharp.VsCodePlaywright;

public static class TestEnvironmentConfigLoader
{
    public static TestEnvironmentConfig LoadFromProjectRoot(string projectRoot)
    {
        if (string.IsNullOrWhiteSpace(projectRoot))
            throw new ArgumentException("Project root must be provided.", nameof(projectRoot));

        var basePath = Path.Combine(projectRoot, "vscodetest.yml");
        var localPath = Path.Combine(projectRoot, "local.yml");

        var config = File.Exists(basePath)
            ? LoadFile(basePath)
            : new TestEnvironmentConfig();

        if (File.Exists(localPath))
        {
            var local = LoadFile(localPath);
            config.ApplyOverrides(local);
        }

        NormalizePaths(projectRoot, config);

        var extensionPathEnv = Environment.GetEnvironmentVariable("VSCODE_TEST_EXTENSION_VSIX_PATH");
        if (!string.IsNullOrWhiteSpace(extensionPathEnv))
            config.Extension.Name = Path.GetFullPath(extensionPathEnv);

        var authTokenEnv = Environment.GetEnvironmentVariable("CS_ACCESS_TOKEN");
        if (!string.IsNullOrWhiteSpace(authTokenEnv))
            config.Extension.AuthToken = authTokenEnv;

        return config;
    }

    private static TestEnvironmentConfig LoadFile(string path)
    {
        var yaml = File.ReadAllText(path);

        var deserializer = new DeserializerBuilder()
            .WithNamingConvention(NullNamingConvention.Instance)
            .IgnoreUnmatchedProperties()
            .Build();

        var cfg = deserializer.Deserialize<TestEnvironmentConfig>(yaml);
        return cfg ?? new TestEnvironmentConfig();
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
