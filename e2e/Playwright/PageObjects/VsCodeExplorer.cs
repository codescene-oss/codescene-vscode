using System;
using System.Collections.Generic;
using Microsoft.Playwright;

namespace csharp.VsCodePlaywright;

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

            // File item for .cs in the Explorer tree.
            ["File"] = "role=treeitem[name=/DYNAMIC_CONTENT\\.cs/i]"
        };

    protected override IReadOnlyDictionary<string, string> Locators => LocatorMap;
}
