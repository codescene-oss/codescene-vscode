All commands for building, testing, linting etc are maintained at the Makefile. Do favor those over `npm` or `npx` commands.

Use `make test1 TEST='<test name>'` to run a single test. Do not run the entire test suite unless asked to.

If a linting issue is found, you must prioritize fixing it before resuming your previous intent.

Don't add comments to any code you add, however keep any existing comments you find.

Testing practices: see [TESTING.md](.claude/TESTING.md).

Validate your work using `make lint`. Satifying all linter faults is mandatory - they must be addressed before proceeding with other work.

If you find an issue at any stage, you must fix it immediately, regardless of whether you think it's pre-existing.

Commit messages follow Conventional Commits. Keep the subject line (`type: imperative summary`) to at most 100 characters and do not end it with a period. Put the why in the body after a blank line, wrapped near 80 columns. The commit-msg hook rejects messages that fail commitlint. `make lint` checks every commit from `main` to `HEAD`.
