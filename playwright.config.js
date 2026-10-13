const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/global-teardown.js',
  timeout: 30000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['./tests/e2e/pass-stamp-reporter.js']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
