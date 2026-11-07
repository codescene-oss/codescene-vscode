## General guidelines

When writing tests, when possible express multiple test cases as a single array of objects to iterate on.

## Mocking

Always prefer existing mocks from `src/test/mocks/` and `src/test/setup.ts` over creating bespoke mocks. Never create inline object literals mimicking VSCode types when established mocks exist.

For unit tests, import from `src/test/mocks/vscode.ts` to get lightweight mocks of Position, Range, Selection, Uri, and command tracking via `executedCommands`/`resetExecutedCommands()`.
For integration tests, use `createTestDir()` and `ensureBinary()` from `integration_helper.ts`.

### VS Code API mocking

Production code imports the real `vscode` module. Tests run in an environment where this is replaced with `vscodeStub` from `src/test/setup.ts`.

To mock new VS Code APIs:
1. Add the stub to `vscodeStub` in `src/test/setup.ts`
2. Add corresponding helpers (setters/resetters) in `src/test/setup.ts` for test manipulation
3. If tests need lightweight mocks, add them to `src/test/mocks/vscode.ts`
4. For `instanceof` checks, ensure stub classes are defined in `setup.ts` so production code instanceof checks work

Example: mocking `vscode.window.visibleTextEditors`:
- Add `visibleTextEditors: []` to `vscodeStub.window` in setup.ts
- Export `setMockVisibleTextEditors()` and `resetMockWindow()` helpers in setup.ts
- Tests import helpers from `../setup` and call them in setup/teardown hooks

## Dealing with failing tests

Generally, tests that you write and then fail should be fixed. Do not delete them or fundamentally change their approach.

The prefered course of action for failing tests is:

- add `console.log` statements to gather fact-based feedback
- or, if no solution is found, ask the user for the preferred solution.

## Real cs-ide integration tests and the CodeScene credential

cs-ide answers its Code Health methods (review, delta, check-rules, the rules template, preflight, fns-to-refactor, refactor, watches) only with a valid CLI license. The integration tests that spawn the real bundled binary get that license from a `CS_ACCESS_TOKEN` in the environment, which the spawned server inherits.

- Without `CS_ACCESS_TOKEN`, those tests are reported as pending with the reason "needs a CodeScene credential: set CS_ACCESS_TOKEN (CLI access) to run real cs-ide analysis tests". Set the variable in the shell that runs `make test` to run them.
- Guard any new real-binary test of a license-gated method with `skipWithoutCodeSceneCredential(this)` from `integration_helper.ts`, either in its `setup` hook or as the first line of the test. Never let such a test pass silently without the credential.
- Tests that only use ungated methods (device-id, telemetry) run without it.
- The `Unlicensed cs-ide` suite always runs: it starts the real binary with `CS_ACCESS_TOKEN` removed and an empty `CODESCENE_HOME`, and checks that gated requests answer `auth/license-required` while device-id keeps working.
- Fake-based tests that go through `DevtoolsAPI.reviewWithServer` must license the extension side with `DevtoolsAPI.useLicenseGate(licensedGate())` from `src/test/fixtures/auth/auth-fixtures.ts`, after `DevtoolsAPI.init`.
