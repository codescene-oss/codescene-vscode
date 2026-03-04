using System;
using System.Diagnostics;
using System.IO;

namespace Codescene.E2E.Playwright.Tests.Playwright;

public sealed class TestWorkspace : IDisposable
{
    public string RootPath { get; }

    public TestWorkspace()
    {
        RootPath = Path.Combine(Path.GetTempPath(), "pw-vscode-ws-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(RootPath);
    }

    public string AddFile(string relativePath, string content)
    {
        var fullPath = Path.Combine(RootPath, relativePath);
        var dir = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);
        File.WriteAllText(fullPath, content);
        return fullPath;
    }

    public void InitGitRepo(string commitMessage = "Initial commit")
    {
        RunGit("init");
        RunGit("config user.email test@test.com");
        RunGit("config user.name Test");
        RunGit("add -A");
        RunGit($"commit -m \"{commitMessage}\"");
    }

    private void RunGit(string args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "git",
            Arguments = args,
            WorkingDirectory = RootPath,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        using var process = Process.Start(psi);
        if (process == null)
            throw new InvalidOperationException($"Failed to start git with args: {args}");
        process.WaitForExit(TimeSpan.FromSeconds(30));
        if (process.ExitCode != 0)
        {
            var stderr = process.StandardError.ReadToEnd();
            throw new InvalidOperationException($"git {args} failed (exit {process.ExitCode}): {stderr}");
        }
    }

    public void Dispose()
    {
        TryDeleteDir(RootPath);
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
}
