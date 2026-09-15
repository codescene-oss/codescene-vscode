window.BENCHMARK_DATA = {
  "lastUpdate": 1789495566841,
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
      }
    ]
  }
}