using Codescene.E2E.Playwright.Tests.Playwright;
using Codescene.E2E.Playwright.Tests.Playwright.PageObjects;

namespace Codescene.E2E.Playwright.Tests.Tests;

public class CodesceneCodeHealthMonitorTests : VsCodeTestBase
{
    protected override Task SetupWorkspace(TestWorkspace workspace)
    {
        workspace.AddFile("Clean.cs", "public class Clean { }");
        workspace.InitGitRepo();
        return Task.CompletedTask;
    }

    [Test]
    public async Task CodeHealthMonitor_ShouldShowNoCodeSmell()
    {
        var workbench = new VsCodeWorkbench(Page!);
        await workbench.Find("Id");

        var activitybar = new VsCodeActivitybar(Page!);
        await activitybar.Find("Id");
        await activitybar.Click("Codescene", timeoutMs: 10_000);

        var cshealthmonitor = new CSHealthMonitor(Page!);
        cshealthmonitor.SwitchToPage();
        cshealthmonitor.SwitchFrame("webview", "cshealthmonitorframe");
        await cshealthmonitor.Find("noCodeImpact");
    }

    [Test]
    public async Task CodeHealthMonitor_AddDirtyFile_ShouldShowCodeSmell()
    {
        var fileName = "Dirty.cs";
        var fileContent = @"
using System.Text;
using System.Text.RegularExpressions;

namespace Codescene.VSExtension.CodeSmells.Issues.CSharp;

class BumpyRoadExample
{ 
    public void Test(string t1, string t2, string t3, string t4, string t5) {

    }
}
";
        Workspace?.AddFile(fileName, fileContent);
        var workbench = new VsCodeWorkbench(Page!);
        await workbench.Find("Id");

        //var explorer = new VsCodeExplorer(Page!);
        //await explorer.Find("Id");
        //await explorer.Click($"File [matches: {fileName}]");

        var activitybar = new VsCodeActivitybar(Page!);
        await activitybar.Find("Id");
        await activitybar.Click("Codescene", timeoutMs: 10_000);

        var cshealthmonitor = new CSHealthMonitor(Page!);
        cshealthmonitor.SwitchToPage();
        cshealthmonitor.SwitchFrame("webview", "cshealthmonitorframe");
        await cshealthmonitor.Find($"codeSmell [matches: {fileName}]", timeoutMs: 30_000);
    }
}