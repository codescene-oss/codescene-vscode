All commands for building, testing, linting etc are maintained at the Makefile. Do favor those over `npm` or `npx` commands.

Use `make test1 TEST='<test name>'` to run a single test.

If a linting issue is found, you must prioritize fixing it before resuming your previous intent.

Don't add comments to any code you add, however keep any existing comments you find.

When writing tests, when possible express multiple test cases as a single array of objects to iterate on.

Validate your work using `make lint`.
