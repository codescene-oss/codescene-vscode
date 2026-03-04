using Codescene.E2E.Playwright.Tests.Configuration;
using Microsoft.Playwright;

namespace Codescene.E2E.Playwright.Tests.Playwright.PageObjects;

public abstract class BasePO
{
    protected BasePO(IPage page)
    {
        Page = page ?? throw new ArgumentNullException(nameof(page));
    }

    protected IPage Page { get; }

    private IFrameLocator? CurrentFrame { get; set; }

    protected abstract IReadOnlyDictionary<string, string> Locators { get; }

    /// <summary>
    /// Switches the locator context to one or more nested frames.
    ///
    /// Example for VS Code WebViews:
    /// <c>SwitchFrame("iframe.webview[...]", "#active-frame")</c>
    ///
    /// You can also pass PageObject locator logical names from <see cref="Locators"/>, e.g.
    /// <c>SwitchFrame("webview", "cshealthmonitorframe")</c>.
    /// </summary>
    public void SwitchFrame(params string[] frameSelectors)
    {
        if (frameSelectors is null || frameSelectors.Length == 0)
            throw new ArgumentException("At least one frame selector is required.", nameof(frameSelectors));

        // Allow passing either raw selectors or dictionary logical names.
        // If a value matches a locator key, use its selector; otherwise treat it as a selector.
        var firstSelector = TryResolveSelector(frameSelectors[0]) ?? frameSelectors[0];

        IFrameLocator frame = Page.FrameLocator(firstSelector);
        for (var i = 1; i < frameSelectors.Length; i++)
        {
            var selector = TryResolveSelector(frameSelectors[i]) ?? frameSelectors[i];
            frame = frame.FrameLocator(selector);
        }

        CurrentFrame = frame;
    }

    /// <summary>
    /// Clears any active frame context and returns Find/Click to the main page DOM.
    /// </summary>
    public void SwitchToPage()
    {
        CurrentFrame = null;
    }

    public async Task<ILocator> Find(string logicalName, float timeoutMs = -1)
    {
        if (string.IsNullOrWhiteSpace(logicalName)) throw new ArgumentException("Logical name is required.", nameof(logicalName));

        timeoutMs = NormalizeTimeout(timeoutMs);
        var selector = ResolveSelector(logicalName);
        var locator = CreateLocator(selector);
        await locator.WaitForAsync(new LocatorWaitForOptions { Timeout = timeoutMs });
        return locator;
    }

    public async Task Click(string logicalName, float timeoutMs = -1)
    {
        timeoutMs = NormalizeTimeout(timeoutMs);
        var locator = await Find(logicalName, timeoutMs);
        await locator.ClickAsync(new LocatorClickOptions { Timeout = timeoutMs });
    }

    public Task WaitForAsync(string logicalName)
    {
        return Find(logicalName);
    }

    public Task WaitForAsync(string logicalName, float timeoutMs)
    {
        if (string.IsNullOrWhiteSpace(logicalName)) throw new ArgumentException("Logical name is required.", nameof(logicalName));

        timeoutMs = NormalizeTimeout(timeoutMs);
        var selector = ResolveSelector(logicalName);
        return CreateLocator(selector).WaitForAsync(new LocatorWaitForOptions { Timeout = timeoutMs });
    }

    private ILocator CreateLocator(string selector)
    {
        return CurrentFrame != null
            ? CurrentFrame.Locator(selector)
            : Page.Locator(selector);
    }

    private static float NormalizeTimeout(float timeoutMs)
    {
        if (timeoutMs > 0)
            return timeoutMs;

        return TestEnvironment.ShortTimeoutMs;
    }

    protected string ResolveSelector(string logicalName)
    {
        // Supports dynamic logical names like: "File [matches: Session]"
        // - base logical name: "File"
        // - match value: "Session"
        // Replaces occurrences of "DYNAMIC_CONTENT" in the selector string.

        var baseName = logicalName;
        string? matchValue = null;

        var markerIndex = logicalName.IndexOf(" [matches:", StringComparison.OrdinalIgnoreCase);
        if (markerIndex >= 0)
        {
            baseName = logicalName.Substring(0, markerIndex).Trim();

            var start = markerIndex + " [matches:".Length;
            var end = logicalName.LastIndexOf(']');
            if (end > start)
                matchValue = logicalName.Substring(start, end - start).Trim();
        }

        if (!Locators.TryGetValue(baseName, out var selector) || string.IsNullOrWhiteSpace(selector))
            throw new KeyNotFoundException($"No locator found for logical name '{baseName}'.");

        if (!string.IsNullOrWhiteSpace(matchValue))
            selector = selector.Replace("DYNAMIC_CONTENT", matchValue, StringComparison.Ordinal);

        return selector;
    }

    private string? TryResolveSelector(string logicalNameOrSelector)
    {
        if (string.IsNullOrWhiteSpace(logicalNameOrSelector))
            return null;

        // Fast path: if it matches a key in the locator map, resolve it (supports [matches:] too).
        // We check the base name to avoid throwing on non-keys.
        var baseName = logicalNameOrSelector;
        var markerIndex = logicalNameOrSelector.IndexOf(" [matches:", StringComparison.OrdinalIgnoreCase);
        if (markerIndex >= 0)
            baseName = logicalNameOrSelector.Substring(0, markerIndex).Trim();

        if (!Locators.ContainsKey(baseName))
            return null;

        return ResolveSelector(logicalNameOrSelector);
    }
}
