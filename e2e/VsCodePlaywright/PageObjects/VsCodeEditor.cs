using System;
using System.Collections.Generic;
using Microsoft.Playwright;

namespace csharp.VsCodePlaywright;

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

            // Active editor tab for ParameterCountExampleTab.cs.
            ["ParameterCountExampleTab"] = "role=tab[name=/ParameterCountExample\\.cs/i]",

            // Find widget elements.
            ["FindInput"] = "//textarea[@class='input']",
            ["MatchesCount"] = ".find-widget .matchesCount"
        };

    protected override IReadOnlyDictionary<string, string> Locators => LocatorMap;
}
