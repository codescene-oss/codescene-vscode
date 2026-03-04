using Codescene.E2E.Playwright.Tests.Playwright;
using Codescene.E2E.Playwright.Tests.Playwright.PageObjects;
using Codescene.E2E.Playwright.Tests.Utils;

namespace Codescene.E2E.Playwright.Tests.Tests;

public class VSCodeTests : VsCodeTestBase
{
    protected override Task SetupWorkspace(TestWorkspace workspace)
    {
        workspace.AddFile("Example.cs", "public class Example { public void TestMethod() { } }");
        return Task.CompletedTask;
    }

    [Test]
    public async Task VSCode_ShouldOpenWindow()
    {
        string title = string.Empty;
        await VSCodeUtils.RetryCondition(
            async () => { title = await Page!.TitleAsync(); },
            () => !string.IsNullOrWhiteSpace(title) && title.Contains("Visual Studio Code", StringComparison.Ordinal),
            timeoutMs: 15_000);
        Assert.That(title, Does.Contain("Visual Studio Code"));
    }

    [Test]
    public async Task VSCode_OpenFile_ShouldBeActive()
    {
        var workbench = new VsCodeWorkbench(Page!);
        await workbench.Find("Id");

        var explorer = new VsCodeExplorer(Page!);
        await explorer.Find("Id");
        await explorer.Click("File [matches: Example.cs]");

        var editor = new VsCodeEditor(Page!);
        await editor.Find("Id");
        await editor.Find("Tab [matches: Example.cs]");

        await Page!.Keyboard.PressAsync("Control+F");
        var findInput = await editor.Find("FindInput");
        await findInput.FillAsync("TestMethod");

        var matches = await editor.Find("MatchesCount");
        string matchesText = string.Empty;
        await VSCodeUtils.RetryCondition(
            async () => { matchesText = (await matches.InnerTextAsync()).Trim(); },
            () => !string.IsNullOrWhiteSpace(matchesText));

        Assert.That(matchesText, Does.Contain("1 of"));
    }
}
