using System.Text;

namespace Codescene.E2E.Playwright.Tests.Utils;

public static class FileUtils
{
    public static string FindProjectRootDirectory()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            if (dir.EnumerateFiles("*.csproj", SearchOption.TopDirectoryOnly).Any())
                return dir.FullName;
            dir = dir.Parent;
        }
        return Directory.GetCurrentDirectory();
    }

    public static string SanitizeFileName(string name, int maxLength = 180)
    {
        if (string.IsNullOrWhiteSpace(name))
            return "screenshot.png";

        var invalidChars = Path.GetInvalidFileNameChars();
        var sb = new StringBuilder(name.Length);
        foreach (var ch in name)
            sb.Append(Array.IndexOf(invalidChars, ch) >= 0 ? '_' : ch);

        maxLength = Math.Clamp(maxLength, 16, 240);
        var sanitized = sb.ToString();
        var ext = Path.GetExtension(sanitized);
        if (string.IsNullOrWhiteSpace(ext))
            ext = ".png";
        var baseName = Path.GetFileNameWithoutExtension(sanitized);
        var maxBaseLength = Math.Max(1, maxLength - ext.Length);
        if (baseName.Length > maxBaseLength)
            baseName = baseName.Substring(0, maxBaseLength);
        return baseName + ext;
    }
}
