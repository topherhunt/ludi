const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
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
