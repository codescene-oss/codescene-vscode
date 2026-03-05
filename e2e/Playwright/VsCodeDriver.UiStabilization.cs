using Codescene.E2E.Playwright.Tests.Playwright.PageObjects;
using Microsoft.Playwright;

namespace Codescene.E2E.Playwright.Tests.Playwright;

public static partial class VsCodeDriver
{
    /// <summary>
    /// Best-effort stabilization for fresh profiles:
    /// - Dismisses transient first-run UI (e.g. walkthrough popups) by sending Escape.
    /// - Closes any startup editors (e.g. Welcome/Release Notes) via default close-all chord.
    /// - Focuses the Explorer view to get a consistent baseline layout.
    ///
    /// This intentionally avoids any Copilot/extension-specific behavior.
    /// </summary>
    public static async Task StabilizeFirstRunUiAsync(IPage page, TimeSpan? timeout = null)
    {
        if (page is null) throw new ArgumentNullException(nameof(page));

        var effectiveTimeout = timeout ?? TimeSpan.FromSeconds(10);
        await page.Locator(".monaco-workbench").WaitForAsync(new LocatorWaitForOptions { Timeout = (float)effectiveTimeout.TotalMilliseconds });

        try { await page.Locator(".monaco-workbench").ClickAsync(new LocatorClickOptions { Timeout = (float)effectiveTimeout.TotalMilliseconds, Force = true }); }
        catch { }

        await DismissModalsAndCloseEditorsAsync(page, effectiveTimeout);
        await HidePanelAndSecondarySidebarAsync(page);
        await FocusExplorerAsync(page, effectiveTimeout);

        await page.WaitForTimeoutAsync(150);
    }

    private static async Task DismissModalsAndCloseEditorsAsync(IPage page, TimeSpan timeout)
    {
        for (var i = 0; i < 3; i++)
        {
            try { await page.Keyboard.PressAsync("Escape"); } catch { }
            await page.WaitForTimeoutAsync(100);
        }
        try { await page.Keyboard.PressAsync("Control+K"); await page.WaitForTimeoutAsync(100); await page.Keyboard.PressAsync("Control+W"); } catch { }
        await TryRunCommandPaletteCommandAsync(page, "File: Close All Editors", timeout);
        for (var i = 0; i < 6; i++)
        {
            try { await page.Keyboard.PressAsync("Control+F4"); } catch { }
            await page.WaitForTimeoutAsync(100);
        }
    }

    private static async Task HidePanelAndSecondarySidebarAsync(IPage page)
    {
        try
        {
            var panel = page.Locator("[id='workbench.parts.panel']");
            if (await panel.IsVisibleAsync()) try { await page.Keyboard.PressAsync("Control+J"); } catch { }
        }
        catch { }
        try
        {
            var secondary = page.Locator("[id='workbench.parts.secondarySidebar']");
            if (await secondary.IsVisibleAsync()) try { await page.Keyboard.PressAsync("Control+Alt+B"); } catch { }
        }
        catch { }
    }

    private static async Task FocusExplorerAsync(IPage page, TimeSpan timeout)
    {
        try { await page.Keyboard.PressAsync("Control+Shift+E"); }
        catch { try { var wb = new VsCodeWorkbench(page); await wb.Click("Explorer", timeoutMs: (float)timeout.TotalMilliseconds); } catch { } }

        await TryRunCommandPaletteCommandAsync(page, "View: Show Explorer", timeout);

        try
        {
            var sidebar = page.Locator("[id='workbench.parts.sidebar']");
            for (var i = 0; i < 2; i++)
            {
                if (await sidebar.IsVisibleAsync()) break;
                try { await page.Keyboard.PressAsync("Control+B"); } catch { }
                await page.WaitForTimeoutAsync(150);
            }
        }
        catch { }

        try { var wb = new VsCodeWorkbench(page); await wb.Click("Explorer", timeoutMs: (float)timeout.TotalMilliseconds); } catch { }
        try { var explorer = new VsCodeExplorer(page); await explorer.WaitForAsync("Id", timeoutMs: (float)timeout.TotalMilliseconds); } catch { }
    }

    private static async Task TryRunCommandPaletteCommandAsync(IPage page, string commandText, TimeSpan timeout)
    {
        try
        {
            await page.Keyboard.PressAsync("Control+Shift+P");
            await page.WaitForTimeoutAsync(200);

            try { await page.Keyboard.PressAsync("Control+A"); } catch { }
            try { await page.Keyboard.PressAsync("Backspace"); } catch { }

            await page.Keyboard.TypeAsync(commandText, new KeyboardTypeOptions { Delay = 10 });
            await page.WaitForTimeoutAsync(100);
            await page.Keyboard.PressAsync("Enter");

            await page.WaitForTimeoutAsync(350);

            try { await page.Keyboard.PressAsync("Escape"); } catch { }
        }
        catch
        {
            // Best-effort; avoid failing the whole test on UI automation differences.
        }
    }

    /// <summary>
    /// Returns a small layout snapshot string useful for debugging UI determinism.
    /// Best-effort only; selectors may vary across VS Code versions.
    /// </summary>
    public static async Task<string> GetUiLayoutSnapshotAsync(IPage page)
    {
        if (page is null) throw new ArgumentNullException(nameof(page));

        try
        {
            var script =
                "() => {\n" +
                "  const q = (sel) => document.querySelector(sel);\n" +
                "  const byId = (id) => q(\"[id='\" + id + \"']\");\n" +
                "  const isVisible = (el) => {\n" +
                "    if (!el) return false;\n" +
                "    const r = el.getBoundingClientRect();\n" +
                "    const s = getComputedStyle(el);\n" +
                "    return !!(r.width && r.height) && s.visibility !== 'hidden' && s.display !== 'none';\n" +
                "  };\n" +
                "  const countVisibleByAriaLabel = (re) => {\n" +
                "    try {\n" +
                "      const els = Array.from(document.querySelectorAll('[aria-label]'));\n" +
                "      return els.filter(e => re.test(e.getAttribute('aria-label') || '') && isVisible(e)).length;\n" +
                "    } catch { return 0; }\n" +
                "  };\n" +
                "\n" +
                "  const activeEl = q(\"[id='workbench.parts.activitybar'] .action-item.checked\");\n" +
                "  const activeActivity = ((activeEl && (activeEl.getAttribute('aria-label') || activeEl.textContent)) || '<unknown>').trim();\n" +
                "\n" +
                "  const sidebarVisible = isVisible(byId('workbench.parts.sidebar'));\n" +
                "  const secondaryVisible = isVisible(byId('workbench.parts.secondarySidebar'));\n" +
                "  const panelVisible = isVisible(byId('workbench.parts.panel'));\n" +
                "  const explorerVisible = isVisible(q('.explorer-folders-view'));\n" +
                "  const chatLabelVisibleCount = countVisibleByAriaLabel(/chat/i);\n" +
                "\n" +
                "  return 'activeActivity=' + activeActivity +" +
                "    '; sidebar=' + sidebarVisible +" +
                "    '; secondarySidebar=' + secondaryVisible +" +
                "    '; panel=' + panelVisible +" +
                "    '; explorer=' + explorerVisible +" +
                "    '; chatAriaVisible=' + chatLabelVisibleCount;\n" +
                "}";

            var snapshot = await page.EvaluateAsync<string>(script);
            return snapshot ?? "<no snapshot>";
        }
        catch
        {
            return "<snapshot failed>";
        }
    }
}
