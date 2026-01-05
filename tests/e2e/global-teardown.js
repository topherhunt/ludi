const { teardownElectronApp } = require('./fixtures');

module.exports = async () => {
  await teardownElectronApp();
};
