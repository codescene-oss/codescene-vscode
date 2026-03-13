using Microsoft.Playwright;

namespace Codescene.E2E.Playwright.Tests.Playwright.PageObjects;

public sealed class VsCodeWorkbench : BasePO
{
    public VsCodeWorkbench(IPage page) : base(page)
    {
    }

    private static readonly IReadOnlyDictionary<string, string> LocatorMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Id"] = ".monaco-workbench",

            // Explorer viewlet (Activity Bar). This uses Playwright's role selector engine.
            // If your VS Code build/theme differs, you may need to adjust this selector.
            ["Explorer"] = "role=tab[name=/Explorer/i]"
        };

    protected override IReadOnlyDictionary<string, string> Locators => LocatorMap;
}
