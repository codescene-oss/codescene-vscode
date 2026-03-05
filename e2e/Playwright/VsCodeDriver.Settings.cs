using System.Text.Json;

namespace Codescene.E2E.Playwright.Tests.Playwright;

public static partial class VsCodeDriver
{
    private static void SeedUserSettings(string userDataDir, VsCodeSessionOptions options)
    {
        EnsureVsCodeUserSetting(userDataDir, "window.newWindowDimensions", "default");

        if (options.DisableSettingsSync)
            ApplyDeterministicSettings(userDataDir);

        if (options.UserSettings is not null)
        {
            foreach (var kvp in options.UserSettings)
            {
                if (!string.IsNullOrWhiteSpace(kvp.Key) && kvp.Value is not null)
                    EnsureVsCodeUserSetting(userDataDir, kvp.Key, kvp.Value);
            }
        }

        if (options.LockUserSettingsJson)
            TryMakeFileReadOnly(Path.Combine(userDataDir, "User", "settings.json"));

        if (options.DisableSettingsSync)
            TryMakeUserSettingsReadOnly(userDataDir);
    }

    private static void ApplyDeterministicSettings(string userDataDir)
    {
        var settings = new Dictionary<string, object?>
        {
            ["settingsSync.enabled"] = false,
            ["window.restoreWindows"] = "none",
            ["workbench.editor.restoreViewState"] = false,
            ["workbench.startupEditor"] = "none",
            ["workbench.welcomePage.enabled"] = false,
            ["workbench.welcomePage.walkthroughs.openOnInstall"] = false,
            ["update.showReleaseNotes"] = false,
            ["workbench.activityBar.visible"] = true,
            ["workbench.sideBar.location"] = "left",
            ["workbench.secondarySideBar.defaultVisibility"] = "hidden",
            ["chat.restoreLastPanelSession"] = false,
            ["chat.viewWelcome.enabled"] = false,
            ["chat.commandCenter.enabled"] = false,
            ["chat.viewTitle.enabled"] = false,
            ["chat.disableAIFeatures"] = true,
            ["workbench.enableExperiments"] = false,
            ["telemetry.telemetryLevel"] = "off",
            ["workbench.tips.enabled"] = false
        };

        foreach (var kvp in settings)
            EnsureVsCodeUserSetting(userDataDir, kvp.Key, kvp.Value);
    }

    private static void EnsureVsCodeUserSetting(string userDataDir, string settingKey, string settingValue)
    {
        EnsureVsCodeUserSetting(userDataDir, settingKey, (object?)settingValue);
    }

    private static void EnsureVsCodeUserSetting(string userDataDir, string settingKey, object? settingValue)
    {
        try
        {
            var userDir = Path.Combine(userDataDir, "User");
            Directory.CreateDirectory(userDir);
            var settingsPath = Path.Combine(userDir, "settings.json");
            var settings = LoadExistingSettings(settingsPath);
            settings[settingKey] = settingValue;
            var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(settingsPath, json);
        }
        catch
        {
            // Best-effort only.
        }
    }

    private static Dictionary<string, object?> LoadExistingSettings(string settingsPath)
    {
        var settings = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(settingsPath))
            return settings;
        var existing = File.ReadAllText(settingsPath);
        if (string.IsNullOrWhiteSpace(existing))
            return settings;
        using var doc = JsonDocument.Parse(existing);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            return settings;
        foreach (var prop in doc.RootElement.EnumerateObject())
            settings[prop.Name] = DeserializeJsonValue(prop.Value);
        return settings;
    }

    private static object? DeserializeJsonValue(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        _ => element.Clone()
    };

    private static void TryMakeFileReadOnly(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
                return;

            var attrs = File.GetAttributes(filePath);
            if ((attrs & FileAttributes.ReadOnly) != FileAttributes.ReadOnly)
                File.SetAttributes(filePath, attrs | FileAttributes.ReadOnly);
        }
        catch
        {
            // Best-effort only.
        }
    }

    private static void TryMakeUserSettingsReadOnly(string userDataDir)
    {
        TryMakeFileReadOnly(Path.Combine(userDataDir, "User", "settings.json"));
    }
}
