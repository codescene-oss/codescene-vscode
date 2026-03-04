using System.Diagnostics;
using Microsoft.Playwright;

namespace Codescene.E2E.Playwright.Tests.Playwright;

public sealed class VsCodeSession : IAsyncDisposable
{
    private readonly bool _deleteUserDataDir;
    private readonly bool _deleteExtensionsDir;
    private readonly bool _deleteAppDataDir;

    internal VsCodeSession(
        Process process,
        int cdpPort,
        string launchedExecutablePath,
        string launchedArguments,
        string userDataDir,
        string extensionsDir,
        string appDataDir,
        bool deleteUserDataDir,
        bool deleteExtensionsDir,
        bool deleteAppDataDir,
        string workspacePath,
        IPlaywright playwright,
        IBrowser browser)
    {
        Process = process;
        CdpPort = cdpPort;
        LaunchedExecutablePath = launchedExecutablePath;
        LaunchedArguments = launchedArguments;
        UserDataDir = userDataDir;
        ExtensionsDir = extensionsDir;
        AppDataDir = appDataDir;
        _deleteUserDataDir = deleteUserDataDir;
        _deleteExtensionsDir = deleteExtensionsDir;
        _deleteAppDataDir = deleteAppDataDir;
        WorkspacePath = workspacePath;
        Playwright = playwright;
        Browser = browser;
    }

    public Process Process { get; }
    public int CdpPort { get; }

    public string LaunchedExecutablePath { get; }
    public string LaunchedArguments { get; }

    public string UserDataDir { get; }
    public string ExtensionsDir { get; }
    public string AppDataDir { get; }
    public string WorkspacePath { get; }

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
