# AGENTS.md

## Cursor Cloud specific instructions

This repo is the **CodeScene VS Code extension** (`codescene-vscode`). Prefer Makefile targets over raw `npm`/`npx` (see [CLAUDE.md](CLAUDE.md) and [BUILD_LOCAL.md](BUILD_LOCAL.md)).

### Services / components

| Component | Role | How to run |
|-----------|------|------------|
| Extension host build | TypeScript → `out/` via esbuild | `make build` or `npm run watch` for dev |
| Unit/integration tests | Mocha (VS Code API stubbed) | `make test1 TEST='…'` (do not run full suite unless asked) |
| CodeScene CLI binary | Core analysis engine used by the extension | `npm run bundle-cli-test` → `cs-linux-x64` (gitignored) |
| CWF webview assets | `cs-cwf/` for Control Center / Home UI | `GITHUB_TOKEN=$CODESCENE_IDE_DOCS_AND_WEBVIEW_TOKEN npm run updatecwf` |
| E2E (Playwright/.NET) | Windows-oriented; optional here | See `make pretest-e2e` / `make test-e2e` |

There is no long-running backend server. “Running the app” means building the extension and exercising the bundled `cs-*` CLI (or launching VS Code Extension Development Host with F5 when a desktop VS Code is available).

### Non-obvious gotchas

- **`make pretest` / `make test1` require `chronic`** (package `moreutils`). Without it, Make fails with `chronic: No such file or directory`.
- **CWF check**: without `CI=true`, `npm run pretest` requires `cs-cwf/index.html`. Fetch with the cloud secret: `GITHUB_TOKEN=$CODESCENE_IDE_DOCS_AND_WEBVIEW_TOKEN npm run updatecwf`. Setting `CI=true` skips the CWF presence check (as GitHub Actions does).
- **CLI binary** is gitignored; re-run `npm run bundle-cli-test` after clean checkouts before local F5 / analysis demos.
- **Node**: `.nvmrc` pins 20; CI uses Node 20. Cloud Agent PATH may expose `/exec-daemon/node` (newer Node) ahead of nvm — Node 20+ is fine for build/test.
- **`make lint`** runs `commitlint --from main --to HEAD` plus eslint and optional `cs delta`. Use `npm run lint` for eslint-only.
- Some git-heavy Mocha tests use the default 2s timeout and can flake under load when the shared `gitExecutor` queue is busy; re-run the suite in isolation with `make test1` if needed.
- `npm run updatedocs` may 404 depending on token/repo access; docs are separate from unit tests. CWF (`updatecwf`) is the dependency that blocks local pretest.
