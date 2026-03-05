using System.Diagnostics;
using Microsoft.Playwright;

namespace Codescene.E2E.Playwright.Tests.Playwright;

public sealed class VsCodeSession : IAsyncDisposable
{
    private readonly SessionDirectories _dirs;

    internal VsCodeSession(Process process, SessionDirectories dirs, IPlaywright playwright, IBrowser browser)
    {
        Process = process;
        _dirs = dirs;
        Playwright = playwright;
        Browser = browser;
    }

    internal sealed record SessionDirectories(
        int CdpPort,
        string LaunchedExecutablePath,
        string LaunchedArguments,
        string UserDataDir,
        string ExtensionsDir,
        string AppDataDir,
        string WorkspacePath,
        bool DeleteUserDataDir,
        bool DeleteExtensionsDir,
        bool DeleteAppDataDir);

    private bool _deleteUserDataDir => _dirs.DeleteUserDataDir;
    private bool _deleteExtensionsDir => _dirs.DeleteExtensionsDir;
    private bool _deleteAppDataDir => _dirs.DeleteAppDataDir;

    public Process Process { get; }
    public int CdpPort => _dirs.CdpPort;
    public string LaunchedExecutablePath => _dirs.LaunchedExecutablePath;
    public string LaunchedArguments => _dirs.LaunchedArguments;
    public string UserDataDir => _dirs.UserDataDir;
    public string ExtensionsDir => _dirs.ExtensionsDir;
    public string AppDataDir => _dirs.AppDataDir;
    public string WorkspacePath => _dirs.WorkspacePath;

    public IPlaywright Playwright { get; }
    public IBrowser Browser { get; }

    public async ValueTask DisposeAsync()
    {
        try
        {
            try
            {
                await Browser.CloseAsync();
            }
            catch
            {
                // ignore
            }

            try
            {
                Playwright.Dispose();
            }
            catch
            {
                // ignore
            }
        }
        finally
        {
            try
            {
                if (!Process.HasExited)
                    Process.Kill(entireProcessTree: true);
            }
            catch
            {
                // ignore
            }

            if (_deleteUserDataDir)
                TryDeleteDir(UserDataDir);

            if (_deleteExtensionsDir)
                TryDeleteDir(ExtensionsDir);

            if (_deleteAppDataDir)
                TryDeleteDir(AppDataDir);
        }
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
