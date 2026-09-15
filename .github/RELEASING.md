# Releasing the CodeScene extension

Git tags are the source of release identity. Pushing a supported tag builds platform-specific full and no-ACE VSIX files and attaches them to a GitHub Release.

## Stable releases

Create the release commit and tag with the appropriate version increment:

```sh
npm run release:patch
npm run release:minor
npm run release:major
```

These commands update `package.json`, `package-lock.json`, and `CHANGELOG.md`, commit the changes, and create a `vX.Y.Z` tag. Review the generated changelog, then push the commit and tag:

```sh
git push --follow-tags
```

The release workflow requires the tag version to match `package.json`. GitHub generates the release notes from the previous stable tag, ignoring intervening test tags.

Publishing to the VS Code Marketplace and Open VSX remains a separate manual action through the `Publish latest release (manual)` workflow.

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

The workflow injects the tag version into each VSIX during packaging. It creates a GitHub prerelease with `latest` disabled and never publishes the test build to either extension marketplace.

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
