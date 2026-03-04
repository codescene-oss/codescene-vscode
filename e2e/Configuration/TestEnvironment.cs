using System;

namespace csharp.VsCodePlaywright;

/// <summary>
/// Process-wide test environment settings loaded from appsettings.json (+ optional appsettings.Development.json and env overrides).
/// </summary>
public static class TestEnvironment
{
    private static readonly object Gate = new();
    private static TestEnvironmentConfig? _current;

    public static void Initialize(TestEnvironmentConfig config)
    {
        if (config is null) throw new ArgumentNullException(nameof(config));

        lock (Gate)
        {
            _current = config;
        }
    }

    public static int ShortTimeoutMs
    {
        get
        {
            lock (Gate)
            {
                return _current?.Vscode.Timeout.ShortMs ?? 3_000;
            }
        }
    }
}
