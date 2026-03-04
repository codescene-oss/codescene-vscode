using Microsoft.Playwright;

namespace Codescene.E2E.Playwright.Tests.Playwright.PageObjects;

public sealed class CSHealthMonitor : BasePO
{
    public CSHealthMonitor(IPage page) : base(page)
    {
    }

    // CodeScene renders the Health Monitor as a VS Code WebView.
    // From the DOM dump, the iframe is:
    // <iframe class="webview" src="...&extensionId=codescene.codescene-vscode&...&purpose=webviewView">

    private static readonly IReadOnlyDictionary<string, string> LocatorMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["webview"] = "//iframe[contains(@class, 'webview') and contains(@src, 'extensionId=codescene.codescene-vscode') and contains(@src, 'purpose=webviewView')]",
            ["cshealthmonitorframe"] = "#active-frame",

            ["Id"] = "//iframe[contains(@class, 'webview') and contains(@src, 'vscode-app')]",

            ["noCodeImpact"] = "//b[contains(text(), 'No code health impact')]",
        };

    protected override IReadOnlyDictionary<string, string> Locators => LocatorMap;

}