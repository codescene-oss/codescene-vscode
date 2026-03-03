using csharp.VsCodePlaywright;

namespace csharp;

public class CSExtHealthMonitorTests : VsCodeTestBase
{
    [Test]
    public async Task CSExtTest1()
    {
        var workbench = new VsCodeWorkbench(Page!);
        await workbench.Find("Id");

        var activitybar = new VsCodeActivitybar(Page!);
        await activitybar.Find("Id");
        await activitybar.Click("Codescene", timeoutMs: 30_000);

        var cshealthmonitor = new CSHealthMonitor(Page!);
        cshealthmonitor.SwitchToPage();
        cshealthmonitor.SwitchFrame("webview", "cshealthmonitorframe");
        await cshealthmonitor.Find("noCodeImpact");
    }
}