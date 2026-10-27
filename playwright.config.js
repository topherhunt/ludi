const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  // DEPRECATED (folders): song lists no longer show folder rows, so these specs
  // can't run. TODO: delete them with the rest of the folder code (see TASKS.md).
  testIgnore: ['folder-*.spec.js', 'folders.spec.js', 'chevron-dblclick.spec.js'],
  globalSetup: './tests/e2e/global-setup.js',
  timeout: 30000,
  // Spec files run in parallel, each worker with its own app (see fixtures.js).
  // Tests within a file stay in order: most share state set up in beforeAll.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 5,
  reporter: [['list'], ['./tests/e2e/pass-stamp-reporter.js']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
