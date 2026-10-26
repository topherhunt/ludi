const { test, expect } = require('./fixtures');
const fs = require('fs');
const path = require('path');

// The menu's click handler is async and Menu hands back no promise, so poll.
const traceItemLabel = (electronApp) => electronApp.evaluate(({ Menu }) =>
  Menu.getApplicationMenu().getMenuItemById('performance-trace').label);
const clickTraceItem = (electronApp) => electronApp.evaluate(({ Menu }) => {
  Menu.getApplicationMenu().getMenuItemById('performance-trace').click();
});

test('the View menu records a performance trace on demand and saves it', async ({ electronApp }) => {
  const traceDir = path.join(await electronApp.evaluate(({ app }) => app.getPath('userData')), 'traces');
  const before = fs.existsSync(traceDir) ? fs.readdirSync(traceDir) : [];
  expect(await traceItemLabel(electronApp)).toBe('Start Performance Trace');

  await clickTraceItem(electronApp);
  await expect.poll(() => traceItemLabel(electronApp)).toBe('Stop Performance Trace');
  await clickTraceItem(electronApp);
  await expect.poll(() => traceItemLabel(electronApp)).toBe('Start Performance Trace');

  const saved = fs.readdirSync(traceDir).filter((name) => !before.includes(name));
  expect(saved).toHaveLength(1);
  const trace = JSON.parse(fs.readFileSync(path.join(traceDir, saved[0]), 'utf8'));
  expect(trace.traceEvents.length).toBeGreaterThan(0);
});
