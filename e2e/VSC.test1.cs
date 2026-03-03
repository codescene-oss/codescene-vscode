using System;
using System.Threading.Tasks;
using csharp.VsCodePlaywright;

namespace csharp;

public class VSCodeTests : VsCodeTestBase
{
    [Test]
    public async Task VSCodeTitleCheck()
    {
        var title = await Page!.TitleAsync();
        Assert.That(title, Does.Contain("Visual Studio Code"));
    }

    [Test]
    public async Task VSCodeOpenFile()
    {
        var workbench = new VsCodeWorkbench(Page!);
        await workbench.Find("Id");

        var explorer = new VsCodeExplorer(Page!);
        await explorer.Find("Id");
        await explorer.Click("File [matches: ParameterCountExample]");

        var editor = new VsCodeEditor(Page!);
        await editor.Find("Id");
        await editor.Find("ParameterCountExampleTab");

        await Page!.Keyboard.PressAsync("Control+F");
        var findInput = await editor.Find("FindInput");
        await findInput.FillAsync("TestMethod");

        var matches = await editor.Find("MatchesCount");
        string matchesText = string.Empty;
        await Utils.RetryCondition(
            async () => { matchesText = (await matches.InnerTextAsync()).Trim(); },
            () => !string.IsNullOrWhiteSpace(matchesText));

        Assert.That(matchesText, Does.Contain("1 of"));
    }
}
