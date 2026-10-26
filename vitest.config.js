import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: 'jsdom',
    // Node's own Web Storage global is undefined without --localstorage-file and
    // shadows jsdom's localStorage.
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    include: ['tests/unit/**/*.test.js'],
  },
});
