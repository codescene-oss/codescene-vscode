using System;
using System.Collections.Generic;
using Microsoft.Playwright;

namespace csharp.VsCodePlaywright;

public sealed class VsCodeActivitybar : BasePO
{
    public VsCodeActivitybar(IPage page) : base(page)
    {
    }

    private static readonly IReadOnlyDictionary<string, string> LocatorMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Id"] = "[id='workbench.parts.activitybar']",
            ["Codescene"] = "[id='workbench.parts.activitybar'] a.action-label.codicon.codicon-cs-logo[aria-label='CodeScene']",
        };

    protected override IReadOnlyDictionary<string, string> Locators => LocatorMap;
}
