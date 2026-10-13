// Records when the e2e suite last passed, for scripts/release.sh to check. The test
// count lets the release script tell a full run from a filtered one (a single spec,
// --grep, test.only). It counts tests that actually finished, because `--list` also
// reaches onEnd with status 'passed' while running nothing.

const fs = require('fs');
const path = require('path');

const STAMP_PATH = path.join(__dirname, '../..', '.last-test-pass.json');

class PassStampReporter {
  constructor() {
    this.finishedTestIds = new Set();
  }

  onTestEnd(test) {
    this.finishedTestIds.add(test.id);
  }

  onEnd(result) {
    if (result.status !== 'passed' || this.finishedTestIds.size === 0) return;
    const stamp = { passedAt: Math.floor(Date.now() / 1000), testCount: this.finishedTestIds.size };
    fs.writeFileSync(STAMP_PATH, JSON.stringify(stamp) + '\n');
  }
}

module.exports = PassStampReporter;
