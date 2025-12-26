General instructions:

- Always read README.md first to familiarize with the project.
- Always run the test suite, or (if it's slow) run a specific test relevant to your change, to confirm no errors.
- Don't run `npm start` or `npm run dev` to test or troubleshoot. Instead write integration tests in a way that can exercise the desired UI and catch any errors or misbehavior.
- Prefer writing and running tests over manual bash scripts for verification. Tests are repeatable, don't require manual review, and serve as documentation. This applies to verifying build tooling, dev servers, and any other infrastructure.
