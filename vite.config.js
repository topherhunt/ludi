import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

// Build stamp for the About dialog. Baked in here rather than read at runtime: a
// packaged .app has no .git to ask, and the interesting commit is the one the
// bundle was built from anyway.
function gitCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim().slice(0, 8);
  } catch {
    return 'unknown';  // built outside a git checkout
  }
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
  },
  plugins: [solidPlugin()],
  base: './',
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'esnext',
    minify: false,  // Easier debugging in Electron
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html'),
        settings: path.resolve(__dirname, 'src/renderer/settings.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
