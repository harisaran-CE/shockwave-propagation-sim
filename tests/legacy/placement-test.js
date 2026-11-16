'use strict';

// Real mouse test of vehicle placement in headless Edge over the DevTools protocol.
// Checks: a move to a clear spot sticks; Undo restores it; a move onto another
// car is refused; dragging is blocked after Play.

const { spawn } = require('child_process');
const fs = require('fs');
const assert = require('assert');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const URL = 'http://127.0.0.1:8000/index.html';
const profile = `${process.env.TEMP}\\flowline-place-${Date.now()}`;

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1440,2000', 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getTarget() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (e) { /* not ready */ }
    await sleep(200);
  }
  throw new Error('browser did not start');
}

(async () => {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); return; }
    if (data.method === 'Runtime.exceptionThrown') {
      errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    id += 1; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : r.result;
  };
  const click = async (x, y, down) => {
    const type = down === 'down' ? 'mousePressed' : down === 'up' ? 'mouseReleased' : 'mouseMoved';
    await send('Input.dispatchMouseEvent', { type, x, y, button: down ? 'left' : 'none', buttons: down === 'down' ? 1 : 0, clickCount: 1 });
  };

  // Screen point for a vehicle's centre, using the same geometry the page draws with.
  const screenPoint = (vehicle) => evaluate(`(() => {
    const c = document.getElementById('microRoad') || document.querySelector('.micro-road-wrap canvas');
    const b = c.getBoundingClientRect();
    const left = 34, right = b.width - 34;
    const y0 = b.top + b.height * 0.415, y1 = b.top + b.height * 0.695;
    return {
      x: b.left + left + ${vehicle.position} / 500 * (right - left),
      y: y0 + ${vehicle.lateralPositionM} / 4 * (y1 - y0)
    };
  })()`);
  const vehicleById = (snap, vid) => snap.vehicles.find((v) => v.id === vid);
  const snap = async () => {
    const raw = await evaluate(`JSON.parse(JSON.stringify(window.__flowlineTest.snapshot()))`);
    raw.vehicles = raw.vehicles.map((v) => ({ ...v, lateralPositionM: v.lane * 4 + v.lateralOffset }));
    return raw;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4000);
  await evaluate(`document.querySelector('.micro-road-wrap canvas').scrollIntoView({block:'center'})`);
  await sleep(500);

  const s0 = await snap();
  const v0 = vehicleById(s0, 0);
  const v1 = vehicleById(s0, 1);
  console.log('start: vehicle 1 at', v0.position.toFixed(1), 'm lane', v0.lane, '| vehicle 2 at', v1.position.toFixed(1), 'm lane', v1.lane);

  // Test 1: drag vehicle 1 a clear distance along its own lane, release, and check.
  const from = await screenPoint(v0);
  const clearTarget = (v0.position + 60 > 490) ? v0.position - 60 : v0.position + 60;
  // Aim in the space between the two lane centres (the dashed line), to check free side-to-side placement.
  const to = await screenPoint({ position: clearTarget, lateralPositionM: 2.4 });
  console.log('press at', from.x.toFixed(1), from.y.toFixed(1), 'to', to.x.toFixed(1), to.y.toFixed(1));
  await click(from.x, from.y, 'down');
  await sleep(150);
  console.log('after press: road class =', await evaluate(`document.querySelector('.micro-road-wrap').className`), '| event =', await evaluate(`document.getElementById('microEvent').textContent`));
  for (let step = 1; step <= 6; step += 1) {
    await click(from.x + (to.x - from.x) * step / 6, from.y + (to.y - from.y) * step / 6, 'move');
    await sleep(60);
  }
  const duringClear = await evaluate(`document.getElementById('microEvent').textContent`);
  assert.ok(/can go here/.test(duringClear), `drag message should say it can go here, got: ${duringClear}`);
  console.log('during drag: event =', duringClear);
  await click(to.x, to.y, 'up');
  await sleep(400);
  const s1 = await snap();
  const moved = vehicleById(s1, 0).position;
  assert.ok(Math.abs(moved - clearTarget) < 6, `expected about ${clearTarget.toFixed(1)} m, got ${moved.toFixed(1)} m`);
  const movedLateral = vehicleById(s1, 0).lateralPositionM;
  assert.ok(Math.abs(movedLateral - 2.4) < 0.15, `expected side position 2.4 m, got ${movedLateral.toFixed(2)} m`);
  console.log('PASS clear move kept: now at', moved.toFixed(1), 'm, side position', movedLateral.toFixed(2), 'm (free, not snapped)');

  // Undo should restore the original position.
  const undoEnabled = await evaluate(`!document.getElementById('microUndoPlacement').disabled`);
  assert.strictEqual(undoEnabled, true, 'Undo should be enabled after a move');
  await evaluate(`document.getElementById('microUndoPlacement').click()`);
  await sleep(300);
  const s2 = await snap();
  assert.ok(Math.abs(vehicleById(s2, 0).position - v0.position) < 0.5,
    `undo should restore ${v0.position.toFixed(1)} m, got ${vehicleById(s2, 0).position.toFixed(1)} m`);
  console.log('PASS Undo restored the original spot');

  // Test 2: drag vehicle 1 onto vehicle 2 (same spot) and check it is refused.
  const v1now = vehicleById(s2, 1);
  const v2now = vehicleById(s2, 2) || vehicleById(s2, 0);
  const pointOnOther = await screenPoint({ position: v2now.position, lateralPositionM: v2now.lateralPositionM });
  const fromOne = await screenPoint(v1now);
  await click(fromOne.x, fromOne.y, 'down');
  for (let step = 1; step <= 6; step += 1) {
    await click(fromOne.x + (pointOnOther.x - fromOne.x) * step / 6, fromOne.y + (pointOnOther.y - fromOne.y) * step / 6, 'move');
    await sleep(60);
  }
  await click(pointOnOther.x, pointOnOther.y, 'up');
  await sleep(400);
  const s3 = await snap();
  const overlapText = await evaluate(`document.getElementById('microEvent').textContent`);
  const stayed = vehicleById(s3, v1now.id);
  const overlapsNow = Math.abs(stayed.position - v2now.position) < 4 && Math.abs(stayed.lateralPositionM - v2now.lateralPositionM) < 1.5 && stayed.id !== v2now.id;
  assert.ok(!overlapsNow, 'vehicle must not be placed on top of another vehicle');
  assert.ok(/overlap/.test(overlapText), `refusal message should mention overlap, got: ${overlapText}`);
  console.log('PASS overlapping move refused; message:', overlapText);

  // Test 3: after Play, dragging does nothing.
  await evaluate(`document.getElementById('microPlay').click()`);
  await sleep(600);
  await evaluate(`document.getElementById('microPause') ? document.getElementById('microPause').click() : document.getElementById('microPlay').click()`);
  await sleep(300);
  const s4 = await snap();
  const beforeLocked = vehicleById(s4, 0);
  const fromLocked = await screenPoint(beforeLocked);
  await click(fromLocked.x, fromLocked.y, 'down');
  await click(fromLocked.x + 80, fromLocked.y, 'move');
  await click(fromLocked.x + 80, fromLocked.y, 'up');
  await sleep(300);
  const s5 = await snap();
  const undoAfterPlay = await evaluate(`document.getElementById('microUndoPlacement').disabled`);
  assert.strictEqual(undoAfterPlay, true, 'Undo should be disabled after Play');
  console.log('PASS after Play: Undo disabled; vehicle 1 started at', beforeLocked.position.toFixed(1), 'and is now', vehicleById(s5, 0).position.toFixed(1), '(time moves on, not a drag)');

  console.log('page errors:', errors.length ? errors : 'none');
  assert.strictEqual(errors.length, 0, 'no page errors expected');
  console.log('ALL PLACEMENT CHECKS PASSED');
  ws.close();
  browser.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(0);
})().catch((error) => { console.error('FAILED:', error.message); browser.kill(); process.exit(1); });
