## General guidelines

When writing tests, when possible express multiple test cases as a single array of objects to iterate on.

## Mocking

Always prefer existing mocks from `src/test/mocks/` and `src/test/setup.ts` over creating bespoke mocks. Never create inline object literals mimicking VSCode types when established mocks exist.

For unit tests, import from `src/test/mocks/vscode.ts` to get lightweight mocks of Position, Range, Selection, Uri, and command tracking via `executedCommands`/`resetExecutedCommands()`.
For integration tests, use `createTestDir()` and `ensureBinary()` from `integration_helper.ts`.

## Dealing with failing tests

Generally, tests that you write and then fail should be fixed. Do not delete them or fundamentally change their approach.

The prefered course of action for failing tests is:

- add `console.log` statements to gather fact-based feedback
- or, if no solution is found, ask the user for the preferred solution.
