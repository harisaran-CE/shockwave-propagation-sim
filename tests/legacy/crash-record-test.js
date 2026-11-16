'use strict';

// Direct test of the collision-record logic in browser_app/flowline-sim.js.
// Places two cars overlapping in the same lane, runs one model step, and
// checks the observation that is recorded. Also checks a clear road records nothing.

const assert = require('assert');
const path = require('path');

global.window = {};
require(path.resolve(__dirname, '../../browser_app/flowline-sim.js'));
const S = window.FlowlineSim;

const world = {
  scenario: 'busy', closedLane: null, barrierPositionM: 320, speedLimitKmh: 60,
  seed: 1, arrivalRatePerMin: 24, variationPct: 25,
  risk: { speed: 0.35, density: 0.25, conflict: 0.25, crash: 0.15 }
};

function makeCar(id, position, speed) {
  const car = S.createVehicle(id, 'car', 0, position, S.seededRandom(id + 1), 60);
  car.position = position;
  car.previousPosition = position;
  car.speed = speed;
  car.desiredSpeed = 13;
  car.lateralPositionM = 0;
  car.previousLateralPositionM = 0;
  car.length = 4;
  car.width = 1.8;
  car.cooldown = 1000; // keep lane-change logic out of this test
  return car;
}

function stateWith(vehicles) {
  const state = S.createState(world);
  state.vehicles = vehicles;
  state.nextArrival = 1e9;
  return state;
}

// Case 1: follower already overlapping a slower leader in the same lane.
{
  const leader = makeCar(0, 100, 0);
  const follower = makeCar(1, 98, 5);
  const state = stateWith([leader, follower]);
  S.step(world, state);

  assert.strictEqual(state.crashes.length, 1, 'one collision should be recorded');
  const record = state.crashes[0];
  assert.strictEqual(record.eventType, 'collision');
  assert.strictEqual(record.cause, 'following-distance-overlap');
  assert.strictEqual(record.vehicles.length, 2);
  assert.ok(record.geometry.overlapLengthM > 0, 'overlap length should be positive');
  assert.ok(record.geometry.overlapWidthM > 0, 'overlap width should be positive');
  assert.ok(record.riskIndex && typeof record.riskIndex.score === 'number', 'risk snapshot attached');
  assert.strictEqual(state.preventedContacts, 1, 'contact should be counted');
  const textMatch = /Collision observed between vehicle (\d+) and vehicle (\d+)\./.exec(state.eventText);
  assert.ok(textMatch, `unexpected event text: ${state.eventText}`);
  assert.deepStrictEqual([Number(textMatch[1]), Number(textMatch[2])].sort(), [1, 2],
    'event text should name vehicles 1 and 2 in either order');

  // Stepping again must not record the same pair twice.
  S.step(world, state);
  assert.strictEqual(state.crashes.length, 1, 'same pair must not be recorded twice');

  console.log('PASS overlap is recorded once with geometry, risk and event text');
  console.log('   record:', JSON.stringify({
    crashId: record.crashId, time: record.timeSeconds, impactM: record.impactPositionM,
    overlapM: record.geometry.overlapLengthM, relKmh: record.relativeSpeedKmh,
    risk: record.riskIndex.score, vehicles: record.vehicles.map((v) => [v.vehicleId, v.type, v.speedKmh])
  }));
}

// Case 2: two cars well apart on a clear road record nothing.
{
  const a = makeCar(0, 200, 10);
  const b = makeCar(1, 100, 10);
  const state = stateWith([a, b]);
  for (let i = 0; i < 200; i += 1) S.step(world, state);
  assert.strictEqual(state.crashes.length, 0, 'no collision expected on a clear road');
  console.log('PASS clear road records no collision');
}

// Case 3: a collision record carries the buffered states from the last 3 s.
{
  const leader = makeCar(0, 100, 0);
  const follower = makeCar(1, 98, 5);
  const state = stateWith([leader, follower]);

  // Run a few seconds of clear-road time first so the buffer has history.
  const clearState = stateWith([makeCar(0, 400, 10), makeCar(1, 200, 10)]);
  for (let i = 0; i < 400; i += 1) S.step(world, clearState);
  const bufferedSteps = clearState.preImpact.length;
  assert.ok(bufferedSteps > 1, 'the pre-impact buffer should hold samples');
  assert.ok(bufferedSteps <= Math.ceil(3 / 0.025) + 1,
    `buffer should be trimmed to 3 s, got ${bufferedSteps} samples`);
  const oldest = clearState.preImpact[0].timeSeconds;
  const newest = clearState.preImpact[clearState.preImpact.length - 1].timeSeconds;
  assert.ok(newest - oldest <= 3 + 1e-6, `buffer spans ${newest - oldest} s`);

  // Now crash two overlapping cars and check the window attached to the record.
  S.step(world, state);
  const record = state.crashes[0];
  const window = record.preImpactWindow;
  assert.ok(window, 'collision record should include a pre-impact window');
  assert.strictEqual(window.windowSeconds, 3);
  assert.ok(window.samples.length >= 1, 'window should hold at least one sample');
  assert.ok(window.samples.length <= Math.ceil(3 / 0.025) + 1, 'window is capped at 3 s');
  const last = window.samples[window.samples.length - 1];
  assert.ok(Math.abs(last.timeSeconds - record.timeSeconds) < 1e-6,
    'latest sample should be the step the collision was observed in');
  assert.strictEqual(last.vehicles.length, 2, 'both colliding cars appear in the sample');
  assert.ok(last.gapM !== null && last.closingSpeedMps !== null,
    'window samples describe the following gap');
  for (const sample of window.samples) {
    assert.ok(record.timeSeconds - sample.timeSeconds <= 3 + 1e-6, 'no sample older than 3 s');
    for (const vehicle of sample.vehicles) {
      assert.ok(typeof vehicle.vehicleId === 'number' && typeof vehicle.positionM === 'number'
        && typeof vehicle.speedMps === 'number', 'sample carries per-vehicle state');
    }
  }
  console.log('PASS collision record carries', window.samples.length,
    'pre-impact states over', (record.timeSeconds - window.samples[0].timeSeconds).toFixed(2), 's');
}

console.log('ALL CRASH-RECORD CHECKS PASSED');
