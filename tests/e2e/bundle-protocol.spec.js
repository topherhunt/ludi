const { test, expect } = require('./fixtures');
const path = require('path');
const fs = require('fs');

/**
 * The ludi-app:// scheme that serves the built renderer to the analyzer window.
 *
 * Only packaged builds load the analyzer through it (in dev, Vite serves over
 * http), so nothing else in the suite would notice this breaking until a release
 * failed to analyze anything. The scheme is registered in dev too, which lets us
 * exercise it here with net.fetch from the main process -- the same request path
 * the analyzer's fetches take.
 */

const DIST = path.resolve(__dirname, '../../dist/renderer');
const WASM_DIR = path.join(DIST, 'assets');

/** Fetch a ludi-app URL from the main process and describe the response. */
const fetchBundle = (electronApp, url) => electronApp.evaluate(async ({ net }, target) => {
  const response = await net.fetch(target);
  if (response.status !== 200) {
    return { status: response.status, contentType: null, body: 0, text: '' };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: bytes.byteLength,
    text: new TextDecoder().decode(bytes.subarray(0, 400)),
  };
}, url);

test.describe('Bundle protocol', () => {
  test.skip(!fs.existsSync(path.join(DIST, 'analyzer.html')),
    'No built renderer -- run `npm run vite:build` first');

  test('serves the analyzer page as HTML', async ({ electronApp }) => {
    const response = await fetchBundle(electronApp, 'ludi-app://bundle/analyzer.html');
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('text/html');
    expect(response.text).toContain('<script');
  });

  test('serves the ONNX Runtime wasm as application/wasm', async ({ electronApp }) => {
    // Exact type or nothing: ORT compiles it with the streaming compiler, which
    // rejects any other content type.
    const wasm = fs.readdirSync(WASM_DIR).find((file) => file.endsWith('.wasm'));
    expect(wasm, `no .wasm in ${WASM_DIR}`).toBeTruthy();

    const response = await fetchBundle(electronApp, `ludi-app://bundle/assets/${wasm}`);
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/wasm');
    expect(response.body).toBe(fs.statSync(path.join(WASM_DIR, wasm)).size);
  });

  test('serves the model weights as raw bytes', async ({ electronApp }) => {
    const model = path.join(DIST, 'models', 'msd-musicnn-1.onnx');
    const response = await fetchBundle(electronApp, 'ludi-app://bundle/models/msd-musicnn-1.onnx');
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/octet-stream');
    expect(response.body).toBe(fs.statSync(model).size);
  });

  test('404s a file that is not in the bundle', async ({ electronApp }) => {
    const response = await fetchBundle(electronApp, 'ludi-app://bundle/nope.html');
    expect(response.status).toBe(404);
  });

  test('refuses an encoded path that climbs out of the bundle', async ({ electronApp }) => {
    // Plain "../" is normalized away by the URL parser before we ever see it, so
    // the guard only earns its keep against an encoded traversal like this one.
    const response = await fetchBundle(electronApp, 'ludi-app://bundle/%2e%2e%2f%2e%2e%2fpackage.json');
    expect(response.status).toBe(403);
  });
});
