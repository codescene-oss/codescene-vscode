using Microsoft.Playwright;

namespace Codescene.E2E.Playwright.Tests.Playwright.PageObjects;

public sealed class VsCodeExplorer : BasePO
{
    public VsCodeExplorer(IPage page) : base(page)
    {
    }

    private static readonly IReadOnlyDictionary<string, string> LocatorMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            // Explorer container. This is a reasonably stable class for the Explorer tree.
            ["Id"] = ".explorer-folders-view",

            ["File"] = "role=treeitem[name=/DYNAMIC_CONTENT/i]"
        };

    protected override IReadOnlyDictionary<string, string> Locators => LocatorMap;
}
