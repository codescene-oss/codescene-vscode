using csharp.VsCodePlaywright;

namespace csharp;

public class CodesceneCodeHealthMonitorTests : VsCodeTestBase
{
    [Test]
    public async Task CodeHealthMonitor_ShouldShowNoCodeSmell()
    {
        var workbench = new VsCodeWorkbench(Page!);
        await workbench.Find("Id");

        var activitybar = new VsCodeActivitybar(Page!);
        await activitybar.Find("Id");
        await activitybar.Click("Codescene", timeoutMs: 60_000);

        var cshealthmonitor = new CSHealthMonitor(Page!);
        cshealthmonitor.SwitchToPage();
        cshealthmonitor.SwitchFrame("webview", "cshealthmonitorframe");
        await cshealthmonitor.Find("noCodeImpact");
    }
}