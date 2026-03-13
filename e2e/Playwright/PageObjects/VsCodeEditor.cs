using Microsoft.Playwright;

namespace Codescene.E2E.Playwright.Tests.Playwright.PageObjects;

public sealed class VsCodeEditor : BasePO
{
    public VsCodeEditor(IPage page) : base(page)
    {
    }

    private static readonly IReadOnlyDictionary<string, string> LocatorMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            // Editor area container (Monaco).
            ["Id"] = ".editor-container .monaco-editor",

            ["Tab"] = "role=tab[name=/DYNAMIC_CONTENT/i]",

            // Find widget elements.
            ["FindInput"] = "//textarea[@class='input']",
            ["MatchesCount"] = ".find-widget .matchesCount"
        };

    protected override IReadOnlyDictionary<string, string> Locators => LocatorMap;
}
