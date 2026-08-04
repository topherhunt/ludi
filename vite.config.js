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
  // The analysis worker is loaded with `{ type: 'module' }` so it can import
  // essentia.js and ONNX Runtime; Vite's default worker output is IIFE, which
  // would drop those imports on the floor in a production build.
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Both are self-contained Emscripten/WASM bundles with no bare imports of
    // their own, so there's nothing for esbuild to usefully pre-bundle. Excluding
    // them matters for a subtler reason: they're imported only from the analysis
    // worker, so in dev Vite doesn't see them until the analyzer window opens --
    // and discovering a new dependency mid-session makes it re-optimize and
    // hard-reload every connected client, including the main window.
    exclude: ['essentia.js', 'onnxruntime-web'],
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'esnext',
    minify: false,  // Easier debugging in Electron
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html'),
        settings: path.resolve(__dirname, 'src/renderer/settings.html'),
        // Hidden window that runs audio analysis (see src/main/analysis.js).
        analyzer: path.resolve(__dirname, 'src/renderer/analyzer.html'),
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
