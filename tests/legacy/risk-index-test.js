'use strict';

// Checks the time-to-collision part of the risk index against known cases.

const assert = require('assert');
const path = require('path');

global.window = {};
require(path.resolve(__dirname, '../../browser_app/flowline-sim.js'));
const S = window.FlowlineSim;

const risk = { speed: 0.35, density: 0.25, conflict: 0.25, crash: 0.15 };
const world = { scenario: 'busy', closedLane: null, barrierPositionM: 320, speedLimitKmh: 60,
  seed: 5, arrivalRatePerMin: 24, variationPct: 25, risk };

function calm() {
  return { meanSpeedKmh: 20, densityVehiclesPerKmPerLane: 4, contactsPrevented: 0 };
}

// 1. Calm traffic with nothing closing: low risk, no TTC contribution.
{
  const r = S.riskIndex(risk, { ...calm(), minTimeToCollisionS: null }, 0);
  assert.strictEqual(r.components.timeToCollision, 0);
  assert.strictEqual(r.band, 'LOW');
  console.log('PASS calm traffic: LOW, no time-to-collision contribution');
}

// 2. Imminent collision (1 s) raises the conflict part to its maximum.
{
  const r = S.riskIndex(risk, { ...calm(), minTimeToCollisionS: 1 }, 0);
  assert.strictEqual(r.components.timeToCollision, 1);
  assert.strictEqual(r.components.conflict, 1);
  assert.ok(/shortest time to collision 1\.0 s/.test(r.explanation), r.explanation);
  console.log('PASS 1 s time to collision scores full conflict risk:', r.explanation);
}

// 3. Safe margin (6 s or more) gives no contribution; 3.75 s is halfway.
{
  assert.strictEqual(S.riskIndex(risk, { ...calm(), minTimeToCollisionS: 6 }, 0).components.timeToCollision, 0);
  const mid = S.riskIndex(risk, { ...calm(), minTimeToCollisionS: 3.75 }, 0).components.timeToCollision;
  assert.ok(Math.abs(mid - 0.5) < 1e-9, `expected 0.5 got ${mid}`);
  console.log('PASS 6 s or more is safe; 3.75 s is half');
}

// 4. A real closing pair on the road produces a finite time to collision.
{
  const state = S.createState(world);
  state.vehicles = [];
  const make = (id, position, speed) => {
    const v = S.createVehicle(id, 'car', 0, position, S.seededRandom(id + 1), 60);
    v.position = position; v.previousPosition = position; v.speed = speed;
    v.lateralPositionM = 0; v.previousLateralPositionM = 0; v.length = 4; v.width = 1.8;
    return v;
  };
  state.vehicles = [make(0, 100, 5), make(1, 80, 15)];
  const snap = S.metricsSnapshot(world, state);
  // Gap = (100 - 2) - (80 + 2) = 16 m; closing 10 m/s -> 1.6 s
  assert.ok(Math.abs(snap.minTimeToCollisionS - 1.6) < 1e-6, `expected 1.6 got ${snap.minTimeToCollisionS}`);
  console.log('PASS closing pair gives time to collision', snap.minTimeToCollisionS, 's');
}

// 5. Nothing closing gives null.
{
  const state = S.createState(world);
  state.vehicles = [];
  const v0 = S.createVehicle(0, 'car', 0, 100, S.seededRandom(1), 60);
  const v1 = S.createVehicle(1, 'car', 0, 60, S.seededRandom(2), 60);
  for (const v of [v0, v1]) { v.speed = 10; v.lateralPositionM = 0; v.length = 4; v.width = 1.8; }
  state.vehicles = [v0, v1];
  assert.strictEqual(S.metricsSnapshot(world, state).minTimeToCollisionS, null);
  console.log('PASS equal-speed cars give null time to collision');
}

// 6. Required braking raises the conflict part: at or below 2 m/s^2 scores
// nothing, at or above 6 m/s^2 scores full, and the explanation names it.
{
  const at = (required) => S.riskIndex(risk, { ...calm(), maxRequiredDecelerationMps2: required }, 0);
  assert.strictEqual(at(0).components.deceleration, 0);
  assert.strictEqual(at(2).components.deceleration, 0);
  const mid = at(4).components.deceleration;
  assert.ok(Math.abs(mid - 0.5) < 1e-9, `expected 0.5 got ${mid}`);
  const hard = at(6);
  assert.strictEqual(hard.components.deceleration, 1);
  assert.strictEqual(hard.components.conflict, 1);
  assert.ok(/hard braking to avoid a rear-end \(6\.0 m\/s² needed\)/.test(hard.explanation), hard.explanation);
  const noRoom = at(Infinity);
  assert.strictEqual(noRoom.components.deceleration, 1);
  assert.ok(/no room left to stop/.test(noRoom.explanation), noRoom.explanation);
  console.log('PASS required braking scores the conflict part:', hard.explanation);
}

// 7. Following pairs report gap, closing speed, braking demand and stopping margin.
{
  const state = S.createState(world);
  const make = (id, position, speed) => {
    const v = S.createVehicle(id, 'car', 0, position, S.seededRandom(id + 1), 60);
    v.position = position; v.previousPosition = position; v.speed = speed;
    v.lateralPositionM = 0; v.previousLateralPositionM = 0; v.length = 4; v.width = 1.8;
    v.reaction = 1; v.deceleration = 3;
    return v;
  };
  state.vehicles = [make(0, 100, 5), make(1, 80, 15)];
  const pairs = S.followingPairs(world, state);
  assert.strictEqual(pairs.length, 1, `expected one pair, got ${pairs.length}`);
  const pair = pairs[0];
  assert.strictEqual(pair.followerId, 1);
  assert.strictEqual(pair.leaderId, 0);
  assert.ok(Math.abs(pair.gapM - 16) < 1e-9, `gap ${pair.gapM}`);
  assert.ok(Math.abs(pair.closingSpeedMps - 10) < 1e-9, `closing ${pair.closingSpeedMps}`);
  assert.ok(Math.abs(pair.timeToCollisionS - 1.6) < 1e-9, `ttc ${pair.timeToCollisionS}`);
  // closing^2 / (2 * gap) = 100 / 32 = 3.125 m/s^2
  assert.ok(Math.abs(pair.requiredDecelerationMps2 - 3.125) < 1e-9, `decel ${pair.requiredDecelerationMps2}`);
  // 15 m/s * 1 s reaction + 15^2 / (2 * 3) braking = 52.5 m needed, gap 16 m -> -36.5 m margin.
  assert.ok(Math.abs(pair.stoppingMarginM + 36.5) < 1e-9, `margin ${pair.stoppingMarginM}`);
  const summary = S.summarizePairs(pairs);
  assert.strictEqual(summary.minTimeToCollisionS, 1.6);
  assert.strictEqual(summary.maxRequiredDecelerationMps2, 3.125);
  assert.strictEqual(summary.stoppingShortfallPairs, 1);
  console.log('PASS following pair metrics:', JSON.stringify(summary));
}

// 8. No-room pairs demand infinite braking; equal-speed pairs demand none.
{
  const state = S.createState(world);
  const make = (id, position, speed) => {
    const v = S.createVehicle(id, 'car', 0, position, S.seededRandom(id + 1), 60);
    v.position = position; v.length = 4; v.width = 1.8; v.speed = speed;
    v.reaction = 1; v.deceleration = 3;
    return v;
  };
  state.vehicles = [make(0, 100, 5), make(1, 98, 15)];
  const noRoom = S.followingPairs(world, state)[0];
  assert.strictEqual(noRoom.requiredDecelerationMps2, Infinity);
  assert.strictEqual(noRoom.timeToCollisionS, null, 'a gone gap has no time to collision');
  assert.strictEqual(S.summarizePairs([noRoom]).maxRequiredDecelerationMps2, Infinity);
  state.vehicles = [make(0, 100, 10), make(1, 80, 10)];
  const calmPairs = S.followingPairs(world, state);
  assert.strictEqual(calmPairs[0].requiredDecelerationMps2, null);
  assert.strictEqual(calmPairs[0].timeToCollisionS, null);
  assert.strictEqual(S.summarizePairs(calmPairs).maxRequiredDecelerationMps2, null);
  console.log('PASS no-room pairs demand infinite braking; equal speeds demand none');
}

console.log('ALL RISK-INDEX CHECKS PASSED');
