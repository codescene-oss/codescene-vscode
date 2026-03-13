namespace Codescene.E2E.Playwright.Tests.Playwright;

public static partial class VsCodeDriver
{
    private static bool ShouldInstallExtension(string? vsixPath, string extensionsDir)
    {
        if (string.IsNullOrWhiteSpace(vsixPath) || !File.Exists(vsixPath))
            return false;
        if (!Directory.Exists(extensionsDir))
            return true;
        return !Directory.GetDirectories(extensionsDir).Any(d =>
            Path.GetFileName(d).StartsWith("codescene.", StringComparison.OrdinalIgnoreCase));
    }

    private static void InstallExtensionFromVsix(string extensionsDir, string vsixPath)
    {
        try
        {
            var vsixFileName = Path.GetFileNameWithoutExtension(vsixPath);
            if (vsixFileName.Contains('@'))
                vsixFileName = vsixFileName[..vsixFileName.IndexOf('@')];

            var targetDir = Path.Combine(extensionsDir, vsixFileName);
            if (Directory.Exists(targetDir))
                return;

            Directory.CreateDirectory(targetDir);
            System.IO.Compression.ZipFile.ExtractToDirectory(vsixPath, targetDir);
            MoveExtensionFilesToRoot(targetDir);
            CleanupVsixArtifacts(targetDir, extensionsDir);
        }
        catch
        {
            // Best-effort extraction.
        }
    }

    private static void MoveExtensionFilesToRoot(string targetDir)
    {
        var extensionSubdir = Path.Combine(targetDir, "extension");
        if (!Directory.Exists(extensionSubdir))
            return;
        foreach (var file in Directory.GetFiles(extensionSubdir))
            MoveIfNotExists(file, Path.Combine(targetDir, Path.GetFileName(file)), isFile: true);
        foreach (var dir in Directory.GetDirectories(extensionSubdir))
            MoveIfNotExists(dir, Path.Combine(targetDir, Path.GetFileName(dir)), isFile: false);
        TryDeleteDir(extensionSubdir);
    }

    private static void MoveIfNotExists(string source, string dest, bool isFile)
    {
        if (isFile)
        {
            if (!File.Exists(dest)) File.Move(source, dest);
        }
        else if (!Directory.Exists(dest))
        {
            Directory.Move(source, dest);
        }
    }

    private static void CleanupVsixArtifacts(string targetDir, string extensionsDir)
    {
        var contentTypesXml = Path.Combine(targetDir, "[Content_Types].xml");
        if (File.Exists(contentTypesXml))
            File.Delete(contentTypesXml);
        var obsoleteFile = Path.Combine(extensionsDir, ".obsolete");
        if (File.Exists(obsoleteFile))
            File.Delete(obsoleteFile);
    }
}
