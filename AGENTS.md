## General instructions

- Always read README.md first to familiarize with the project.
- Always run the test suite, or (if it's slow) run a specific test relevant to your change, to confirm no errors.
- Always ensure there's end-to-end test coverage for a feature before considering the feature working.
- Don't run `npm start` or `npm run dev` to test or troubleshoot. Instead write integration tests in a way that can exercise the desired UI and catch any errors or misbehavior.
- Prefer writing and running tests over manual bash scripts for verification. Tests are repeatable, don't require manual review, and serve as documentation. This applies to verifying build tooling, dev servers, and any other infrastructure.

## Coding Philosophy

- **Fail-fast**: Throw errors for invalid states. Don't use `?.` or `??` for expected data—crash clearly if missing.
- **Boring > clever**: Explicit, self-documenting code with clear naming. Comments only for non-obvious WHY.
- **Imitate existing patterns**: Review similar screens before building new ones.
- **Same action = same code path**: Different triggers for the same action (e.g., context menu vs keyboard shortcut) should use the same underlying function and have the same side effects (confirmations, UI updates, etc.). Don't skip dialogs or steps for one trigger but not another.

## Testing

- Design tests so they never take longer than 1s. If a feature ABSOLUTELY requires a test to run longer than 1s, please bring it up with me and we'll figure out a solution.
- **The e2e suite runs spec files in parallel on 5 workers** (~35s total). Each worker has its own app and test home (`tests/e2e/fixtures.js`), reused by every spec that worker picks up, in no fixed order. A spec must create the data it needs rather than rely on another spec's leftovers; tests within a file still run in order. A flake that only shows up in the full run is usually an explicit timeout too tight for the parallel load.
- Follow existing test patterns: short, readable, clearly labeled.
- **Test blocks should be as compact and readable as possible** - focus on the test flow, not boilerplate
- **E2E tests for user flows, unit tests for pure logic.** Unit tests can't catch integration bugs (API mismatches between modules, wiring errors). For features like "double-click to play", write E2E tests that exercise the full code path and verify the end state (e.g., play button shows playing, song title appears).
- **Don't filter out errors in tests.** If a test filters out console errors, it provides false confidence. Only filter dev noise (Vite HMR), not application errors.
- **If you claim "all tests pass", run `npm test` first.** You can run specific test files during development, but before claiming all tests pass, run the full suite to avoid missing failures in other test files.

## Guidelines for Troubleshooting

- **Do not assume. Verify.** Read actual code before proposing changes.
- **Trace complete data flow** through all transformations.
- **State gaps explicitly**: "Covers X, Y, Z but should verify A, B" rather than claiming comprehensive coverage.
- **Respect user edits**: If you see a change was undone, don't reapply it—user removed it intentionally.
