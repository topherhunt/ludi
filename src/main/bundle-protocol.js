/**
 * Serving the built renderer bundle over a real URL scheme.
 *
 * Most of the app loads happily from file://, because it only ever navigates and
 * loads <script>/<link> tags. The analyzer window can't: it fetch()es the ONNX
 * models and the ONNX Runtime WASM binary, and Chromium blocks fetch/XHR against
 * file:// outright. There is no flag for it, and disabling web security to work
 * around it would be a far worse trade.
 *
 * So in packaged builds the analyzer loads from ludi-app://bundle/analyzer.html
 * instead. Everything it pulls in -- its own chunk, the worker chunk, the wasm,
 * the models -- resolves relative to that, so it all arrives over a scheme that
 * supports fetch. In dev nothing changes: Vite is already serving over http.
 *
 * The scheme is read-only and rooted at dist/renderer, so it can't be talked into
 * serving anything outside the bundle.
 */

const path = require('path');
const fs = require('fs');
const { protocol } = require('electron');

const SCHEME = 'ludi-app';
const HOST = 'bundle';
const ROOT = path.join(__dirname, '../../dist/renderer');

// `standard` so relative URLs resolve normally; `supportFetchAPI` is the whole
// point; `secure` so the page counts as a secure context (Web Workers with
// module type, among other things, require one).
const BUNDLE_SCHEME_PRIVILEGES = {
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },
};

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  // Must be exact: ORT instantiates the runtime with the streaming compiler,
  // which refuses anything that isn't application/wasm.
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.map': 'application/json',
};

/** A URL for a file inside the built bundle, e.g. bundleUrl('analyzer.html'). */
function bundleUrl(relativePath) {
  return `${SCHEME}://${HOST}/${relativePath}`;
}

function registerBundleProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const requested = decodeURIComponent(new URL(request.url).pathname);
    const filePath = path.normalize(path.join(ROOT, requested));

    // path.join already collapses "..", but a request for "/../../secrets" would
    // still land outside ROOT. Refuse anything that escaped.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      console.error('ludi-app: refusing path outside the bundle:', requested);
      return new Response(null, { status: 403 });
    }

    let data;
    try {
      data = await fs.promises.readFile(filePath);
    } catch (err) {
      console.error('ludi-app: not found:', requested, err.message);
      return new Response(null, { status: 404 });
    }

    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
    return new Response(data, {
      status: 200,
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
    });
  });
}

module.exports = { BUNDLE_SCHEME_PRIVILEGES, registerBundleProtocol, bundleUrl };
