/**
 * Preload for the hidden analyzer window. Deliberately tiny and separate from
 * preload.js: that window runs no UI and has no business reaching the library,
 * settings, playback or filesystem APIs -- it takes tasks and returns vectors.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('analyzerAPI', {
  /** Models are loaded and the worker pool is up; `slots` is its concurrency. */
  ready: (info) => ipcRenderer.send('analysis:ready', info),

  /** One song finished (or failed). See src/main/analysis.js for the shape. */
  reportResult: (result) => ipcRenderer.send('analysis:result', result),

  /** Startup failed; the window is useless and the main process should say so. */
  reportFatal: (message) => ipcRenderer.send('analysis:fatal', message),

  onTask: (callback) => {
    ipcRenderer.on('analysis:task', (event, task) => callback(task));
  },
});
