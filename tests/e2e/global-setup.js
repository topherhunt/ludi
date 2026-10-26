const { startViteServer } = require('../../scripts/vite-server');

// One dev server for the whole run, shared by every worker's app. Workers inherit
// VITE_PORT; the returned function is Playwright's global teardown. See
// scripts/vite-server.js -- a killed test run used to leak a Vite server every time.
module.exports = async () => {
  const viteServer = await startViteServer({
    role: 'test',
    onOutput: (text) => console.log('[Vite]:', text),
  });
  // Vite reports "ready" a beat before it will serve the first module.
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.env.VITE_PORT = String(viteServer.port);
  return () => viteServer.stop();
};
