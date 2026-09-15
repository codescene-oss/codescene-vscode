#!/usr/bin/env node

const path = require('path');
const Mocha = require('mocha');
const config = require('../.mocharc.bench.json');

for (const file of config.require) {
  require(path.join(__dirname, '..', file));
}

const mocha = new Mocha({
  ui: config.ui,
  color: config.color,
  timeout: config.timeout,
  slow: config.slow,
});
mocha.addFile(path.join(__dirname, '..', 'out/benchmark/suite/review-pipeline.bench.js'));
mocha.run((failures) => {
  process.exit(failures ? 1 : 0);
});
