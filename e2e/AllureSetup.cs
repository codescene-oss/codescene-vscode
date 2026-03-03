using System.IO;
using NUnit.Framework;

[assembly: NonParallelizable]

namespace csharp;

[SetUpFixture]
public static class AllureSetup
{
    [OneTimeSetUp]
    public static void EnsureAllureResultsDirectoryExists()
    {
        var baseDir = AppContext.BaseDirectory;
        var allureResults = Path.Combine(baseDir, "allure-results");
        Directory.CreateDirectory(allureResults);
    }
}
