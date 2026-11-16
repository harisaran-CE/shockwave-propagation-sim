'use strict';

// Sweeps seeds and scenario settings through the real page logic (microscopic.js
// under the DOM stub) and counts how many runs record a crash.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDomGlobals } = require('./dom-stub');

const { window, document } = createDomGlobals();
const context = vm.createContext({
  window, document, console, URL, Blob: function Blob() {}, FileReader: function FileReader() {},
  Event: function Event() {}, performance: { now: () => 0 }
});
for (const file of ['browser_app/flowline-sim.js', 'browser_app/microscopic.js']) {
  const full = path.resolve(__dirname, '../..', file);
  vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: full });
}
const api = window.__flowlineTest;

const settingsList = [
  { label: 'busy, default', settings: { scenario: 'busy' } },
  { label: 'full closure, barrier 320 m', settings: { scenario: 'full', barrierPositionM: 320 } },
  { label: 'full closure, 36/min', settings: { scenario: 'full', barrierPositionM: 320, averageArrivalsPerMinute: 36 } },
  { label: 'partial closure, 36/min', settings: { scenario: 'partial', closedLane: 1, barrierPositionM: 320, averageArrivalsPerMinute: 36 } },
  { label: 'full closure, speed 90', settings: { scenario: 'full', barrierPositionM: 320, speedLimitKmh: 90, averageArrivalsPerMinute: 36 } }
];

const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
for (const { label, settings } of settingsList) {
  let runsWithCrash = 0;
  let totalCrashes = 0;
  for (const seed of seeds) {
    const state = api.run(seed, { seed, durationSeconds: 180, ...settings }, Math.round(180 / 0.025));
    const count = (state.crashes || []).length;
    if (count) runsWithCrash += 1;
    totalCrashes += count;
  }
  console.log(`${label}: ${runsWithCrash}/${seeds.length} runs had a crash (${totalCrashes} crash records)`);
}
