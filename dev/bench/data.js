window.BENCHMARK_DATA = {
  "lastUpdate": 1790065502399,
  "repoUrl": "https://github.com/codescene-oss/codescene-vscode",
  "entries": {
    "Review pipeline": [
      {
        "commit": {
          "author": {
            "email": "martin.safsten@codescene.com",
            "name": "Martin Säfsten",
            "username": "martinsafsten-codescene"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "bf78f3d9046912c10328b31250fa49a6c603d63d",
          "message": "feat(cli): CLI single process json-rpc (#340)\n\n* feat: migrate reviews to long-lived cs-ide JSON-RPC server\n\nReplace per-invocation CLI analysis with a JRE+JAR IDE daemon,\nevent-driven candidate tracking, and the new cs-ide-jre artifact naming.\n\n* feat: switch Code Health reviews to CLI-owned watch\n\nLet cs-ide watch git roots over JSON-RPC instead of plugin-side\ncandidate polling, and pin the CLI build that implements watch.\n\n* chore: bump cli version\n\nPin cs-ide 1.0.51, which rejects root-relative watcher paths. On Windows\na path such as /src/foo.ts is not absolute but does carry a root\ncomponent, so it previously bypassed watch-path validation and resolved\nagainst the repository root incorrectly.\n\n* fix: stop double-reviewing files on watch start\r\n\r\nAs of cs-ide 53b9f8cb, watchFiles scans the repository and queues the\r\nwhole inventory for review itself. The disk-seeding half of\r\nWorkspaceWatch.seed duplicated that exactly, so every changed file was\r\nreviewed twice on watch start, branch switch, and baseline change.\r\n\r\nSeed only dirty buffers, whose unsaved content the CLI cannot read from\r\ndisk. Disk results that race a dirty buffer are already discarded by the\r\ngit-blob SHA check in watchPresentation.\r\n\r\nDrop the stopWatchFiles call before re-watching as well: init-watch! has\r\nreplace semantics and preserves the native watcher, so the explicit stop\r\nonly forced a teardown and recreate.\n\n* refactor: let the CLI own the review baseline\r\n\r\nThe CLI recomputes the merge base itself whenever HEAD, refs or\r\n.codescene/config.json change, so pinning baseline-revision from the\r\nextension only froze it. Stop sending it from watchFiles, reviewFiles and\r\nthe open-files observer, and remove the plumbing that became dead with it:\r\nthe baselineScore/setBaseline chain, the inert Baseline setting, and\r\ngetMergeBaseCommit.\r\n\r\nDirty buffers are still seeded when HEAD moves, since the CLI only sees\r\ndisk. This also fixes deltas being wiped by runDeltaAnalysis, which\r\nassigned the stubbed DevtoolsAPI.delta result over deltas that watch\r\nnotifications had stored.\n\n* fix: prune the Code Health Monitor from the CLI change set\n\nNothing removed monitor entries any more. The candidate tracker that used\nto diff the change set and call ReviewPipeline.remove went away with the\nCLI-owned watch, leaving the monitor append-only: switching off a feature\nbranch kept its files listed for ever.\n\nThe CLI reports the whole change set rather than individual removals, so\nconsume cs-ide/watchInventoryChanged and drop everything it no longer\nlists. Dirty buffers survive the prune, since the CLI only sees disk, and\neach prune is scoped to repositories that have reported an inventory so\none repo cannot clear another. Stopping a watch applies an empty\ninventory locally as well, which covers the default-branch case.\n\nA delta naming a file the change set omits is ambiguous: it either left\nthe set or arrived ahead of the inventory that grew to include it. Settle\nit with cs-ide/getWatchInventory instead of guessing, debounced per repo.\nThe reply is ordered after everything already sent and can only prune, so\nan early delta keeps its monitor entry.\n\nAlso re-establish watches when the server restarts, which previously left\nevery repository unwatched until HEAD happened to move, and pin the CLI\nbuild that implements the inventory protocol.\n\n* test: add CLI performance benchmark harness\n\nThe move to a long-lived cs-ide server was justified on performance and\nresource grounds, but nothing measured it. This drives real review\nworkloads through the same ReviewPipeline the extension uses, so the\nclaim can be checked rather than assumed.\n\nScenarios run against a pinned spring-framework clone and cover 10, 100\nand 200 file batches, one large file with injected smells, a cold watch\nstart, and git stash and branch-switch operations performed while\nwatching. Metrics come from pidusage sampling over a child_process hook\nthat records every spawned pid, which keeps CPU, peak memory and process\ncounts attributed to the CLI rather than to the harness. Short-lived\nprocesses can die between sampling rounds, so cli busy time is reported\nalongside cpu time and derived from spawn and exit events instead.\n\nScenarios sit behind a BenchmarkAdapter so the same definitions can\ndrive either process strategy. The adapter for the old one-process-per-\nreview path lives in a throwaway worktree and is deliberately not merged.\n\nTwo properties of the system under test are encoded in the fixture\nbecause violating them produces results that look valid. Both\narchitectures cache reviews by content, so every scenario and iteration\ninjects distinct content or it would silently measure a cache hit. The\nfixture also creates origin/main and origin/HEAD, since the CLI resolves\nits baseline through remote-tracking refs and otherwise falls back to\nHEAD, leaving committed changes out of the change set entirely.\n\nPushes to main publish to gh-pages via github-action-benchmark. That\nneeds Pages enabled for the branch before the first run can land.\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n\n* feat: scope the CLI watch to the open workspace folders\r\n\r\nOpening one project of a monorepo should make that project the watch scope, not the whole\r\nrepository, so watchFiles now sends the workspace folders as relative-paths. The call replaces\r\nthe watched roots rather than adding to them, so the full list is resent whenever the folders\r\nchange. Files elsewhere in the repository stay reviewable on demand through reviewFiles, which\r\nwatch roots do not constrain.\r\n\r\nWatch every repository the workspace reaches into regardless of branch. On the default branch\r\nthe change set resolves to the uncommitted work, which is still worth monitoring, and gating it\r\noff meant edits made outside the IDE went unnoticed there. This retires the main-branch\r\ndetection along with the baseline plumbing it was the last caller of.\r\n\r\nResolve git roots directly as well. VS Code leaves a repository unopened when its root sits\r\nabove every workspace folder unless git.openRepositoryInParentFolders is 'always', which is\r\nexactly the monorepo case being narrowed for, so relying on the git extension alone left the\r\nwatch inactive.\n\n* fix: clear the Code Health Monitor when an unsaved edit is undone\n\nA review triggered by a buffer edit had no way to remove the monitor entry it created. It was\nsubmitted with updateMonitor false, and only reached the monitor through the delta enrichment,\nwhich fired with the flag hardcoded to true. That emission only runs when there is a delta, so\nundoing the edit left the entry behind until the file was saved.\n\nA review triggered by an edit now carries monitor ownership, the way skipMonitorUpdateForDelta did\nbefore the reviews moved to the CLI, and the enrichment keeps the flag of the submission it\nenriches. The parameter that no longer reaches the submission is dropped.\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n\n* chore: remove unused git-diff and monitor tree-view leftovers\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n\n* chore: strip unused DevtoolsAPI and baseline helpers\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n\n* chore: drop stale monitor view contributions and unused command\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n\n* chore: remove leftover focus, stats, and CLI-stdin no-ops\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n\n* chore: bump cli version\n\nPin cs-ide to 71112122d98c0589e680c937eddcaa2daa0e7030.\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n\n* fix: keep the bundled JRE intact when a rebundle hits a locked jar\n\nRecursive delete of the live distribution removed jvm.cfg before EBUSY on the jar,\nso cs-ide exited with code 1 and no useful log. Swap the new tree into place and\ninclude stderr on process exit.\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n\n* fix: stop mocha hanging on leftover cs-ide Java processes\n\nIntegration tests left the JSON-RPC daemon running after the suite,\nso CI sat until GitHub cancelled the job.\n\n* fix: make remaining mocha tests pass on Windows and no-ACE\n\nSkip preflight on the no-ACE build, await C++ diagnostics instead of\nsleeping, and give the release-script suite enough time to init git.\n\n* feat: spawn the native cs-ide binary instead of java -jar\n\nJAR+AOT did not beat native on a quiet 4-vCPU Windows runner for\nstartup, memory, or typical review batches, so package and launch\nthe Graal binary.\n\n---------\n\nCo-authored-by: Cursor <cursoragent@cursor.com>",
          "timestamp": "2026-09-15T19:54:27+02:00",
          "tree_id": "a70501f863a714c770e10031fc972e1e618b1ff0",
          "url": "https://github.com/codescene-oss/codescene-vscode/commit/bf78f3d9046912c10328b31250fa49a6c603d63d"
        },
        "date": 1789495565158,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "review-10-files / wall time",
            "value": 80,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / p95 file latency",
            "value": 80,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli busy time",
            "value": 2181,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli cpu time",
            "value": 190,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / extension cpu time",
            "value": 50,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / peak memory",
            "value": 495.71,
            "unit": "MB",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / wall time",
            "value": 719,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / p95 file latency",
            "value": 687,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli busy time",
            "value": 3128,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli cpu time",
            "value": 2880,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / extension cpu time",
            "value": 160,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / peak memory",
            "value": 632.88,
            "unit": "MB",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / wall time",
            "value": 1265,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / p95 file latency",
            "value": 1206,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli busy time",
            "value": 4061,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli cpu time",
            "value": 6950,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / extension cpu time",
            "value": 240,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / peak memory",
            "value": 763.36,
            "unit": "MB",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / wall time",
            "value": 2589,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / p95 file latency",
            "value": 2589,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli busy time",
            "value": 5899,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli cpu time",
            "value": 3820,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / extension cpu time",
            "value": 110,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / peak memory",
            "value": 733.5,
            "unit": "MB",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / wall time",
            "value": 1512,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / p95 file latency",
            "value": 1476,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli busy time",
            "value": 6616,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli cpu time",
            "value": 1360,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / extension cpu time",
            "value": 160,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / peak memory",
            "value": 532.76,
            "unit": "MB",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / wall time",
            "value": 30586,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / p95 file latency",
            "value": 30570,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli busy time",
            "value": 60435,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli cpu time",
            "value": 710,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / extension cpu time",
            "value": 900,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / peak memory",
            "value": 552.21,
            "unit": "MB",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / wall time",
            "value": 30342,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / p95 file latency",
            "value": 30326,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli busy time",
            "value": 60212,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli cpu time",
            "value": 690,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / extension cpu time",
            "value": 860,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / peak memory",
            "value": 522.98,
            "unit": "MB",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "martin.safsten@codescene.com",
            "name": "Martin Säfsten",
            "username": "martinsafsten-codescene"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "1b5116d1ded4045b7cf7ad38ce0fcc74c6048cc0",
          "message": "feat: show remaining CLI review jobs in the Code Health monitor (#348)\n\n* feat: show remaining CLI review jobs in the Code Health monitor\n\n* fix: add onDidQueue to the delta presentation fake IDE server",
          "timestamp": "2026-09-15T23:10:22+02:00",
          "tree_id": "41661014535f449be22f1bcef8686b65967397ce",
          "url": "https://github.com/codescene-oss/codescene-vscode/commit/1b5116d1ded4045b7cf7ad38ce0fcc74c6048cc0"
        },
        "date": 1789507314097,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "review-10-files / wall time",
            "value": 77,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / p95 file latency",
            "value": 77,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli busy time",
            "value": 2140,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli cpu time",
            "value": 200,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / extension cpu time",
            "value": 50,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / peak memory",
            "value": 509.75,
            "unit": "MB",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / wall time",
            "value": 575,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / p95 file latency",
            "value": 558,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli busy time",
            "value": 2894,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli cpu time",
            "value": 2910,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / extension cpu time",
            "value": 180,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / peak memory",
            "value": 570.57,
            "unit": "MB",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / wall time",
            "value": 1317,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / p95 file latency",
            "value": 1253,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli busy time",
            "value": 4132,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli cpu time",
            "value": 7080,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / extension cpu time",
            "value": 290,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / peak memory",
            "value": 648.28,
            "unit": "MB",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / wall time",
            "value": 2618,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / p95 file latency",
            "value": 2618,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli busy time",
            "value": 5923,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli cpu time",
            "value": 3820,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / extension cpu time",
            "value": 140,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / peak memory",
            "value": 718,
            "unit": "MB",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / wall time",
            "value": 1532,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / p95 file latency",
            "value": 1507,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli busy time",
            "value": 6637,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli cpu time",
            "value": 1380,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / extension cpu time",
            "value": 160,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / peak memory",
            "value": 530.74,
            "unit": "MB",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / wall time",
            "value": 30544,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / p95 file latency",
            "value": 30535,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli busy time",
            "value": 60407,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli cpu time",
            "value": 740,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / extension cpu time",
            "value": 1190,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / peak memory",
            "value": 547.55,
            "unit": "MB",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / wall time",
            "value": 30352,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / p95 file latency",
            "value": 30343,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli busy time",
            "value": 60157,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli cpu time",
            "value": 730,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / extension cpu time",
            "value": 1110,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / peak memory",
            "value": 521.86,
            "unit": "MB",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "martin.safsten@codescene.com",
            "name": "Martin Säfsten",
            "username": "martinsafsten-codescene"
          },
          "committer": {
            "email": "martin.safsten@codescene.com",
            "name": "Martin Säfsten",
            "username": "martinsafsten-codescene"
          },
          "distinct": true,
          "id": "64a4128c720e5b256c700521284d69a37b0092ff",
          "message": "chore: pin CLI to Darwin watcher JNA fix",
          "timestamp": "2026-09-17T23:51:51+02:00",
          "tree_id": "3c3d732cf6d327a952bbfa708ef5e3f914a45d22",
          "url": "https://github.com/codescene-oss/codescene-vscode/commit/64a4128c720e5b256c700521284d69a37b0092ff"
        },
        "date": 1789682644012,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "review-10-files / wall time",
            "value": 78,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / p95 file latency",
            "value": 78,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli busy time",
            "value": 2092,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli cpu time",
            "value": 200,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / extension cpu time",
            "value": 70,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / peak memory",
            "value": 511.38,
            "unit": "MB",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / wall time",
            "value": 724,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / p95 file latency",
            "value": 705,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli busy time",
            "value": 3135,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli cpu time",
            "value": 2960,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / extension cpu time",
            "value": 180,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / peak memory",
            "value": 695.4,
            "unit": "MB",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / wall time",
            "value": 1323,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / p95 file latency",
            "value": 1257,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli busy time",
            "value": 4136,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli cpu time",
            "value": 7130,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / extension cpu time",
            "value": 300,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / peak memory",
            "value": 763.07,
            "unit": "MB",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / wall time",
            "value": 2651,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / p95 file latency",
            "value": 2651,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli busy time",
            "value": 5960,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli cpu time",
            "value": 3890,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / extension cpu time",
            "value": 150,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / peak memory",
            "value": 684.67,
            "unit": "MB",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / wall time",
            "value": 1553,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / p95 file latency",
            "value": 1511,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli busy time",
            "value": 6625,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli cpu time",
            "value": 1400,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / extension cpu time",
            "value": 150,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / peak memory",
            "value": 531.66,
            "unit": "MB",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / wall time",
            "value": 30606,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / p95 file latency",
            "value": 30587,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli busy time",
            "value": 60480,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli cpu time",
            "value": 730,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / extension cpu time",
            "value": 1090,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / peak memory",
            "value": 546.86,
            "unit": "MB",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / wall time",
            "value": 30377,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / p95 file latency",
            "value": 30356,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli busy time",
            "value": 60232,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli cpu time",
            "value": 680,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / extension cpu time",
            "value": 830,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / peak memory",
            "value": 520.26,
            "unit": "MB",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "martin.safsten@codescene.com",
            "name": "Martin Säfsten",
            "username": "martinsafsten-codescene"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "f8885e1ee44f3cfd0c513ba995e9ee02379dfbe8",
          "message": "feat: add decision-level diagnostic logs for CLI and workspace (#349)\n\nMake it possible to see why a review was skipped or how the extension\ntalked to cs-ide without dumping source, tokens, or other secrets.",
          "timestamp": "2026-09-18T00:29:47+02:00",
          "tree_id": "8a2beb049728b70080949fc3b45d3899344c312f",
          "url": "https://github.com/codescene-oss/codescene-vscode/commit/f8885e1ee44f3cfd0c513ba995e9ee02379dfbe8"
        },
        "date": 1789684868156,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "review-10-files / wall time",
            "value": 64,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / p95 file latency",
            "value": 64,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli busy time",
            "value": 2171,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli cpu time",
            "value": 160,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / extension cpu time",
            "value": 40,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / peak memory",
            "value": 512.39,
            "unit": "MB",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / wall time",
            "value": 589,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / p95 file latency",
            "value": 565,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli busy time",
            "value": 2905,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli cpu time",
            "value": 2390,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / extension cpu time",
            "value": 160,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / peak memory",
            "value": 634.79,
            "unit": "MB",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / wall time",
            "value": 1047,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / p95 file latency",
            "value": 1003,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli busy time",
            "value": 3669,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli cpu time",
            "value": 5780,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / extension cpu time",
            "value": 290,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / peak memory",
            "value": 758.2,
            "unit": "MB",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / wall time",
            "value": 2137,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / p95 file latency",
            "value": 2137,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli busy time",
            "value": 5153,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli cpu time",
            "value": 3110,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / extension cpu time",
            "value": 90,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / peak memory",
            "value": 732.24,
            "unit": "MB",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / wall time",
            "value": 1151,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / p95 file latency",
            "value": 1143,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli busy time",
            "value": 6214,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli cpu time",
            "value": 1010,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / extension cpu time",
            "value": 150,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / peak memory",
            "value": 532.38,
            "unit": "MB",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / wall time",
            "value": 30422,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / p95 file latency",
            "value": 30410,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli busy time",
            "value": 60301,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli cpu time",
            "value": 590,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / extension cpu time",
            "value": 970,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / peak memory",
            "value": 549.72,
            "unit": "MB",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / wall time",
            "value": 30297,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / p95 file latency",
            "value": 30287,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli busy time",
            "value": 60164,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli cpu time",
            "value": 570,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / extension cpu time",
            "value": 870,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / peak memory",
            "value": 522.4,
            "unit": "MB",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "martin.safsten@codescene.com",
            "name": "Martin Säfsten",
            "username": "martinsafsten-codescene"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "8c6cb23235c05cfbb1c79a8924a068c6b1d4d702",
          "message": "fix: restore the Code Health Monitor when unsaved edits are discarded (#350)\n\n* fix: restore the Code Health Monitor when unsaved edits are discarded\n\nA dirty-buffer review owned the monitor until save, so closing without\nsaving left smells that no longer exist. Closing the last tab now\ntombstones the buffer review and asks the CLI for the saved file.\n\n* test: cover dirty-buffer close event wiring\n\nCodeScene's new-and-changed coverage gate failed at 76.3% because\nobserver listeners, DevtoolsAPI wrappers, and CsDiagnostics.cancel\nwere not exercised. Drive those paths through the VS Code event stubs.",
          "timestamp": "2026-09-21T15:15:43+02:00",
          "tree_id": "ed465006e8aa70e8625ee954c7ca5eace5f15104",
          "url": "https://github.com/codescene-oss/codescene-vscode/commit/8c6cb23235c05cfbb1c79a8924a068c6b1d4d702"
        },
        "date": 1789997234404,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "review-10-files / wall time",
            "value": 76,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / p95 file latency",
            "value": 76,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli busy time",
            "value": 2185,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli cpu time",
            "value": 190,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / extension cpu time",
            "value": 50,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / peak memory",
            "value": 511.61,
            "unit": "MB",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / wall time",
            "value": 567,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / p95 file latency",
            "value": 545,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli busy time",
            "value": 2882,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli cpu time",
            "value": 2880,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / extension cpu time",
            "value": 180,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / peak memory",
            "value": 674.85,
            "unit": "MB",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / wall time",
            "value": 1268,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / p95 file latency",
            "value": 1200,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli busy time",
            "value": 4087,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli cpu time",
            "value": 7000,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / extension cpu time",
            "value": 320,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / peak memory",
            "value": 720.25,
            "unit": "MB",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / wall time",
            "value": 2647,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / p95 file latency",
            "value": 2647,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli busy time",
            "value": 5864,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli cpu time",
            "value": 3840,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / extension cpu time",
            "value": 150,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / peak memory",
            "value": 716.36,
            "unit": "MB",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / wall time",
            "value": 1466,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / p95 file latency",
            "value": 1456,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli busy time",
            "value": 6523,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli cpu time",
            "value": 1340,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / extension cpu time",
            "value": 160,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / peak memory",
            "value": 527.11,
            "unit": "MB",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / wall time",
            "value": 30636,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / p95 file latency",
            "value": 30614,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli busy time",
            "value": 60457,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli cpu time",
            "value": 720,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / extension cpu time",
            "value": 1130,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / peak memory",
            "value": 535.83,
            "unit": "MB",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / wall time",
            "value": 30319,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / p95 file latency",
            "value": 30300,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli busy time",
            "value": 60150,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli cpu time",
            "value": 700,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / extension cpu time",
            "value": 990,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / peak memory",
            "value": 519.04,
            "unit": "MB",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "martin.safsten@codescene.com",
            "name": "Martin Säfsten",
            "username": "martinsafsten-codescene"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "90389d4a435d6e635de427a5546b3fdf7f52914e",
          "message": "fix: keep the signed JNA library with the macOS CLI distribution (#352)\n\n* fix: keep the signed JNA library with the macOS CLI distribution\n\nThe macOS CLI cannot start a file watch unless the signed libjnidispatch\nlibrary travels with it, so bundling only cs-ide produced a distribution whose\nCode Health monitor stayed empty. Require the library and copy it alongside the\nbinary, and fail the bundle when it is missing rather than shipping a\ndistribution that cannot watch.\n\nAsk for the inventory as soon as a watch is established as well. The CLI pushes\nit on its own, but relying on that alone means a single lost handshake leaves\nthe monitor empty until an unrelated git event happens to arrive.\n\n* chore: bump CLI to the build that ships the signed JNA library\n\nPoints the extension at b0355e0f41820771bdb1f11ea6da519515a7d6a1, the first\nmaster build whose macOS distribution contains a signed libjnidispatch.jnilib.\nThe bundling code in this branch requires that sidecar, so the pin has to move\nin step with it.\n\n* chore: bump CLI to the build that keeps stdout clean\n\nThe previous pin shipped a startup log line on stdout, which is the JSON-RPC\nchannel, so every macOS request failed. ac4e5b69 carries that fix along with\nthe signed JNA library this branch depends on.",
          "timestamp": "2026-09-22T10:13:28+02:00",
          "tree_id": "967beadec7166e41d26b29d0f1fa7f77b2de6bf6",
          "url": "https://github.com/codescene-oss/codescene-vscode/commit/90389d4a435d6e635de427a5546b3fdf7f52914e"
        },
        "date": 1790065501393,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "review-10-files / wall time",
            "value": 73,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / p95 file latency",
            "value": 73,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli busy time",
            "value": 2139,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli cpu time",
            "value": 190,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / extension cpu time",
            "value": 40,
            "unit": "ms",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / peak memory",
            "value": 511.48,
            "unit": "MB",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-10-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 10 modified files submitted as dirty buffers (10 files, 10 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / wall time",
            "value": 558,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / p95 file latency",
            "value": 542,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli busy time",
            "value": 2883,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli cpu time",
            "value": 2880,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / extension cpu time",
            "value": 170,
            "unit": "ms",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / peak memory",
            "value": 648.8,
            "unit": "MB",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-100-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 100 modified files submitted as dirty buffers (100 files, 100 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / wall time",
            "value": 1292,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / p95 file latency",
            "value": 1226,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli busy time",
            "value": 4102,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli cpu time",
            "value": 7040,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / extension cpu time",
            "value": 310,
            "unit": "ms",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / peak memory",
            "value": 717.1,
            "unit": "MB",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "review-200-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review 200 modified files submitted as dirty buffers (200 files, 200 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / wall time",
            "value": 2625,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / p95 file latency",
            "value": 2625,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli busy time",
            "value": 5841,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli cpu time",
            "value": 3840,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / extension cpu time",
            "value": 100,
            "unit": "ms",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / peak memory",
            "value": 782.02,
            "unit": "MB",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "big-smelly-file / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Review the largest source file with 40 injected code smells (1 files, 1 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / wall time",
            "value": 1511,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / p95 file latency",
            "value": 1490,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli busy time",
            "value": 6639,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli cpu time",
            "value": 1380,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / extension cpu time",
            "value": 140,
            "unit": "ms",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / peak memory",
            "value": 526.06,
            "unit": "MB",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "large-repo-watch-20-files / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Cold watch start on a large repository with a 20 file change set (20 files, 20 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / wall time",
            "value": 30621,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / p95 file latency",
            "value": 30606,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli busy time",
            "value": 60438,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli cpu time",
            "value": 710,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / extension cpu time",
            "value": 1060,
            "unit": "ms",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / peak memory",
            "value": 523.68,
            "unit": "MB",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-stash-pop / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Stash and pop a 20 file working tree change set while watching (20 files, 41 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / wall time",
            "value": 30295,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / p95 file latency",
            "value": 30281,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli busy time",
            "value": 60160,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli cpu time",
            "value": 700,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / extension cpu time",
            "value": 970,
            "unit": "ms",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / peak memory",
            "value": 516.32,
            "unit": "MB",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          },
          {
            "name": "git-checkout-branch / cli processes",
            "value": 1,
            "unit": "count",
            "extra": "Check out the baseline branch and back while watching a 20 file change set (20 files, 42 results delivered, median of 3)"
          }
        ]
      }
    ]
  }
}