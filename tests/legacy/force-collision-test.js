'use strict';
const assert = require('assert');
const path = require('path');
global.window = {};
require(path.resolve(__dirname, '../../browser_app/flowline-sim.js'));
const S = window.FlowlineSim;
const world = { scenario: 'busy', closedLane: null, barrierPositionM: 320, speedLimitKmh: 60,
  seed: 3, arrivalRatePerMin: 24, variationPct: 25,
  risk: { speed: 0.35, density: 0.25, conflict: 0.25, crash: 0.15 } };
const state = S.createState(world);
for (let i = 0; i < 400; i += 1) S.step(world, state);
const before = state.crashes.length;
const record = S.forceDemonstrationCollision(world, state);
assert.ok(record, 'a demonstration record should be produced on a populated road');
assert.strictEqual(record.demonstration, true);
assert.strictEqual(record.severity, 'demonstration');
assert.strictEqual(state.crashes.length, before + 1);
assert.ok(record.geometry.overlapLengthM > 0 && record.geometry.overlapWidthM > 0);
assert.strictEqual(record.vehicles.length, 2);
assert.ok(/Demonstration collision/.test(state.eventText));
const empty = S.createState({ ...world, scenario: 'busy' });
empty.vehicles = [];
assert.strictEqual(S.forceDemonstrationCollision(world, empty), null, 'empty road gives null');
console.log('PASS forced demonstration collision records one flagged crash; empty road returns null');
