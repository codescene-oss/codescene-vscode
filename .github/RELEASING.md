# Releasing the CodeScene extension

Git tags are the source of release identity. Pushing a supported tag runs the `Release` workflow (`.github/workflows/github-release.yml`). It builds platform-specific full and no-ACE VSIX files, attaches them to a GitHub Release and, for stable tags, publishes them to the VS Code Marketplace and Open VSX.

The tag alone sets the version. A release needs no version bump, changelog or release notes edits in the repository.

## Stable releases

1. Pick a PR merge commit on `main` whose `Run tests` run is green:

   ```sh
   git fetch origin main
   git log --merges --first-parent --oneline origin/main
   gh run list --workflow test.yml --commit <sha>
   ```

2. Create an annotated tag on that commit and push it:

   ```sh
   git tag -a vX.Y.Z -m "Release vX.Y.Z" <sha>
   git push origin vX.Y.Z
   ```

Do not edit `package.json`, `package-lock.json` or any release notes first. The workflow injects `X.Y.Z` from the tag into each VSIX while packaging, and records the released version on `main` once the extension is published.

### Tagging rule

A stable tag must point at a commit on `main` that has a successful `Run tests` run. Two kinds of commits cannot pass the test gate:

- Commits whose tests are still running or have failed. Wait for the run to finish and be green.
- The `chore(release): set version to ...` commit that the workflow pushes to `main` after a release. Pushes made with the workflow token do not trigger `Run tests`, so that commit never has a test run.

When the bot commit is the tip of `main`, tag the PR merge commit directly below it.

## What the workflow does

For a stable tag the jobs run in this order:

1. `Resolve Release Metadata` (`metadata`) validates the tag and works out the version and the release notes range. A stable tag must point at a commit on `main`. The notes start at the previous stable release that is an ancestor of the tagged commit.
2. `Build <variant> <platform>-<arch>` (`build`) packages the ten VSIX files (full and no-ACE for darwin x64 and arm64, linux x64 and arm64, and win32 x64) with the tag version injected, and verifies each one. It runs in parallel with the next job.
3. `Create Release` (`create-release`) creates the GitHub Release for the tag up front with generated notes. It is created without `latest`, or it is updated if it already exists.
4. `Upload Release Assets` (`upload`) waits for the builds and the release, then attaches only the VSIX files the release does not already have.
5. `Verify Tests Passed` (`test-gate`) requires a successful `Run tests` run for the tagged commit.
6. `Publish Extension` (`publish`) logs in to Azure with OIDC, verifies the Marketplace publish rights, then publishes the full variant to the VS Code Marketplace and the full and no-ACE variants to Open VSX. Versions that are already published are skipped.
7. `Record Released Version` (`record-version`) commits `chore(release): set version to X.Y.Z` to `main`, updating `package.json` and `package-lock.json`.
8. `Mark Release Latest` (`promote`) marks the release as latest.

The release only becomes latest at the end, after the tests, the publish and the version record have all succeeded. A release that fails before then stays on GitHub as a release that is not latest. Its assets are already attached if the failure happened after `Upload Release Assets`.

The workflow authenticates to the VS Code Marketplace with Microsoft Entra ID through GitHub OIDC, so it needs no Marketplace token.

Runs are serialised by the `github-release` concurrency group, so two tags pushed close together are processed one after the other.

## Release notes

GitHub generates the release notes from the merged pull requests since the previous stable tag, ignoring intervening test tags. Grouping is configured in `.github/release.yml` and is based on the labels on each pull request:

| Section | Labels |
| --- | --- |
| Breaking Changes | `breaking-change`, `breaking` |
| Features | `feature`, `enhancement` |
| Bug Fixes | `bug`, `fix`, `defect` |
| Security | `security` |
| Documentation | `documentation`, `docs` |
| Dependencies | `dependencies` |
| Other Changes | any other label, or no label |

Pull requests labelled `ignore-for-release` or `skip-changelog`, and pull requests authored by `dependabot` or `github-actions`, are left out of the notes.

Labels are not enforced. A pull request without a matching label is listed under Other Changes. Label the pull request before the release to place it in the right section. If one of the label names above does not exist in the repository yet, create it when you need it.

## Recovery

If a release run fails, fix the cause and either:

- open the run on the Actions page and choose **Re-run failed jobs**, or
- dispatch the workflow for the tag:

  ```sh
  gh workflow run github-release.yml --ref main -f tag=vX.Y.Z
  ```

The dispatch must be made from `main` (`--ref main`) and the tag must already exist, otherwise the `Resolve Release Metadata` job fails. The `tag` input is the existing tag to build, publish and promote.

A re-run is safe to repeat. It rebuilds the VSIX files, then:

- `Create Release` updates the existing release's title and notes instead of creating another one.
- `Upload Release Assets` attaches only the files that are missing.
- `Verify Tests Passed` is evaluated again, so a run that failed because the tests were still running passes once they finish.
- `Publish Extension` skips versions that are already on the Marketplace and Open VSX.
- `Record Released Version` does nothing when `main` is already at the released version or a newer one.
- `Mark Release Latest` does nothing when the release is already latest.

Recovering an older tag never lowers the version on `main` and never moves latest away from a newer release. The older release is left as it is.

## Test releases

Create a test release tag without changing package metadata:

```sh
npm run release:test
npm run release:test -- minor
npm run release:test -- major
```

The default increment is `patch`. The equivalent Make command is:

```sh
make test-release BUMP=patch
```

The command requires a clean worktree and creates an annotated tag such as `v0.28.1-test.abc1234`. It prints the exact `git push origin <tag>` command that triggers the release workflow.

The workflow injects the tag version into each VSIX during packaging. It creates a GitHub prerelease at the start of the run, with `latest` disabled, and never publishes the test build to either extension marketplace. Test releases skip the test gate and do not record a version on `main` or change latest.

For the first test of a base version, GitHub generates notes from the latest stable tag. Later tests of the same base version show changes since the previous test and include a full comparison link back to the latest stable release.

## Installing a test release

Download the VSIX matching the tester's platform and architecture from the GitHub prerelease. Install it with **Extensions: Install from VSIX...** or:

```sh
code --install-extension path/to/codescene-vscode-X.Y.Z-test.SHA-platform-architecture.vsix
```

The exact test version appears in the Extensions view and in:

```sh
code --list-extensions --show-versions
```

VSIX installations do not update automatically from GitHub Releases. Testers must download and install each requested build.

## Changelog history

Releases made before this flow have their changelog sections in the old `CHANGELOG.md`, which is no longer in the repository. `scripts/migrate-changelog-to-releases.js` copies those sections into the bodies of the matching GitHub Releases. By default it reads the last committed `CHANGELOG.md` from git history; pass `--file <path>` to use another copy and `--repo <owner/name>` to target another repository.

```sh
node ./scripts/migrate-changelog-to-releases.js
node ./scripts/migrate-changelog-to-releases.js --apply
```

The first command is a dry run: it only prints the releases it would update. Pass `--apply` to write the changes. The script can be run again safely, because it replaces the block it added earlier.
