const path = require('path');

// Map an audio file to the correct Content-Type for the ludi-audio:// protocol.
// Serving everything as audio/mpeg (the old behavior) made the HTML5 audio
// element refuse to decode non-mp3 files like .m4a, which surfaced to the user
// as a misleading "file not found" error even though the file was present.
function audioContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.m4a':
      return 'audio/mp4';
    case '.ogg':
      return 'audio/ogg';
    case '.mp3':
    default:
      return 'audio/mpeg';
  }
}

module.exports = { audioContentType };
