'use strict';

// Real browser test of the newer placement features in headless Edge over the
// DevTools protocol. Checks: Undo and Redo round-trip a move; a new move clears
// the redo stack; a vehicle can be dragged in the 3D view; a JSON vehicle list
// adds valid entries, reports skipped ones, is refused after Play, and is
// cleared by Reset.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const URL = process.argv[2] || 'http://127.0.0.1:8000/index.html';
const profile = `${process.env.TEMP}\\flowline-features-${Date.now()}`;
const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowline-import-'));

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
  const drag = async (from, to, steps = 6) => {
    await click(from.x, from.y, 'down');
    for (let step = 1; step <= steps; step += 1) {
      await click(from.x + (to.x - from.x) * step / steps, from.y + (to.y - from.y) * step / steps, 'move');
      await sleep(60);
    }
    await click(to.x, to.y, 'up');
    await sleep(400);
  };
  const snap = async () => {
    const raw = await evaluate(`JSON.parse(JSON.stringify(window.__flowlineTest.snapshot()))`);
    raw.vehicles = raw.vehicles.map((v) => ({ ...v, lateralPositionM: v.lane * 4 + v.lateralOffset }));
    return raw;
  };
  const vehicleById = (snap, vid) => snap.vehicles.find((v) => v.id === vid);
  // Screen point on the 2D road canvas, using the same geometry the page draws with.
  const roadScreenPoint = (vehicle) => evaluate(`(() => {
    const c = document.getElementById('microRoad') || document.querySelector('.micro-road-wrap canvas');
    const b = c.getBoundingClientRect();
    const left = 34, right = b.width - 34;
    const y0 = b.top + b.height * 0.415, y1 = b.top + b.height * 0.695;
    return {
      x: b.left + left + ${vehicle.position} / 500 * (right - left),
      y: y0 + ${vehicle.lateralPositionM} / 4 * (y1 - y0)
    };
  })()`);
  const importReport = async () => evaluate(`JSON.stringify({
    hidden: document.getElementById('microVehicleImportReport').hidden,
    text: document.getElementById('microVehicleImportReport').textContent
  })`);
  const setImportFile = async (contents) => {
    const file = path.join(importDir, `vehicles-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(contents));
    const doc = await send('DOM.getDocument');
    const query = await send('DOM.querySelector', {
      nodeId: doc.result.root.nodeId, selector: '#microVehicleImport'
    });
    await send('DOM.setFileInputFiles', { files: [file], nodeId: query.result.nodeId });
    // Setting the files does not always fire change in headless mode; fire it too.
    await evaluate(`document.getElementById('microVehicleImport').dispatchEvent(new Event('change'))`);
    await sleep(600);
    return JSON.parse(await importReport());
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4000);
  await evaluate(`document.querySelector('.micro-road-wrap canvas').scrollIntoView({block:'center'})`);
  await sleep(500);

  const start = await snap();
  const v0 = vehicleById(start, 0);
  const startCount = start.vehicles.length;

  // Test 1: a move, Undo, then Redo should return to the moved spot.
  const clearTarget = (v0.position + 50 > 490) ? v0.position - 50 : v0.position + 50;
  const moveFrom = await roadScreenPoint(v0);
  const moveTo = await roadScreenPoint({ position: clearTarget, lateralPositionM: v0.lateralPositionM });
  await drag(moveFrom, moveTo);
  const afterMove = vehicleById(await snap(), 0).position;
  assert.ok(Math.abs(afterMove - clearTarget) < 6, `move should land near ${clearTarget} m, got ${afterMove}`);

  await evaluate(`document.getElementById('microUndoPlacement').click()`);
  await sleep(300);
  const afterUndo = vehicleById(await snap(), 0).position;
  assert.ok(Math.abs(afterUndo - v0.position) < 0.5, `Undo should restore ${v0.position} m, got ${afterUndo}`);
  const redoEnabled = await evaluate(`!document.getElementById('microRedoPlacement').disabled`);
  assert.strictEqual(redoEnabled, true, 'Redo should be enabled after Undo');

  await evaluate(`document.getElementById('microRedoPlacement').click()`);
  await sleep(300);
  const afterRedo = vehicleById(await snap(), 0).position;
  assert.ok(Math.abs(afterRedo - afterMove) < 0.5, `Redo should return to ${afterMove} m, got ${afterRedo}`);
  const redoStillEnabled = await evaluate(`!document.getElementById('microRedoPlacement').disabled`);
  assert.strictEqual(redoStillEnabled, false, 'Redo should be disabled once the stack is used up');
  console.log('PASS Undo/Redo round-trip:', v0.position.toFixed(1), '->', afterMove.toFixed(1), '->', afterUndo.toFixed(1), '->', afterRedo.toFixed(1), 'm');

  // A fresh move must clear the redo stack.
  const v0now = vehicleById(await snap(), 0);
  const freshFrom = await roadScreenPoint(v0now);
  const freshTo = await roadScreenPoint({ position: v0now.position - 30, lateralPositionM: v0now.lateralPositionM });
  await drag(freshFrom, freshTo);
  const redoAfterFresh = await evaluate(`!document.getElementById('microRedoPlacement').disabled`);
  assert.strictEqual(redoAfterFresh, false, 'a new move should clear the redo stack');
  console.log('PASS a new move clears the redo stack');

  // Test 2: drag the same vehicle in the 3D view.
  await evaluate(`document.getElementById('microView3d').click()`);
  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(`!!(window.flowline3d && window.flowline3d.vehicleScreenPoint)`)) break;
    await sleep(150);
  }
  await evaluate(`document.querySelector('[data-3d-mode="top"]').click()`);
  await sleep(700);
  const before3d = vehicleById(await snap(), 0);
  const from3d = await evaluate(`window.flowline3d.vehicleScreenPoint(0)`);
  const targetM = Math.min(before3d.position + 25, 480);
  const to3d = await evaluate(`window.flowline3d.screenPointFor(${targetM}, ${before3d.lateralPositionM})`);
  assert.ok(from3d && to3d, '3D view should project the vehicle and a road point');
  await drag(from3d, to3d);
  const after3d = vehicleById(await snap(), 0).position;
  assert.ok(Math.abs(after3d - targetM) < 7, `3D drag should land near ${targetM.toFixed(1)} m, got ${after3d.toFixed(1)}`);
  console.log('PASS 3D drag moved vehicle 1 to', after3d.toFixed(1), 'm');
  const undoAfter3d = await evaluate(`!document.getElementById('microUndoPlacement').disabled`);
  assert.strictEqual(undoAfter3d, true, 'a 3D move should be undoable');
  await evaluate(`document.getElementById('microView2d').click()`);
  await sleep(300);

  // Test 3: a vehicle list adds valid entries and reports the skipped one.
  const report = await setImportFile({
    format: 'flowline-vehicles',
    vehicles: [
      { kind: 'car', lane: 1, positionM: 460, speedKmh: 30 },
      { kind: 'motorcycle', lane: 2, positionM: 470, speedKmh: 20 },
      { kind: 'lorry', lane: 2, positionM: 480 }
    ]
  });
  assert.strictEqual(report.hidden, false, 'the import report should be shown');
  assert.ok(/Added 2 of 3 vehicles; 1 skipped/.test(report.text), report.text);
  assert.ok(/unknown kind "lorry"/.test(report.text), report.text);
  const imported = await snap();
  assert.strictEqual(imported.vehicles.length, startCount + 2, 'two vehicles should be added');
  const car = imported.vehicles.find((v) => Math.abs(v.position - 460) < 1 && v.type === 'car');
  assert.ok(car, 'the imported car should be on the road at 460 m');
  assert.strictEqual(car.lane, 0, 'imported lane 1 maps to lane index 0');
  assert.ok(Math.abs(car.speed - 30 / 3.6) < 0.2, `imported speed should be 30 km/h, got ${car.speed * 3.6}`);
  console.log('PASS vehicle import added 2 of 3 and reported the skipped entry');

  // A file that is not a vehicle list is refused without adding anything.
  const refused = await setImportFile({ format: 'something-else', vehicles: [] });
  assert.ok(/not a Flowline vehicle list/.test(refused.text), refused.text);
  assert.strictEqual((await snap()).vehicles.length, imported.vehicles.length);
  console.log('PASS wrong-format file refused without changes');

  // Test 4: import is refused after Play, and Reset clears added vehicles.
  await evaluate(`document.getElementById('microPlay').click()`);
  await sleep(800);
  const afterPlay = await setImportFile({
    format: 'flowline-vehicles',
    vehicles: [{ kind: 'car', lane: 1, positionM: 450 }]
  });
  assert.ok(/only before Play/.test(afterPlay.text), afterPlay.text);
  console.log('PASS import refused after Play');
  await evaluate(`document.getElementById('microReset').click()`);
  await sleep(500);
  const afterReset = await snap();
  assert.strictEqual(afterReset.vehicles.length, startCount, 'Reset should clear imported vehicles');
  console.log('PASS Reset cleared the imported vehicles');

  console.log('page errors:', errors.length ? errors : 'none');
  assert.strictEqual(errors.length, 0, 'no page errors expected');
  console.log('ALL IMPORT/REDO/3D CHECKS PASSED');
  ws.close();
  browser.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  try { fs.rmSync(importDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(0);
})().catch((error) => {
  console.error('FAILED:', error.message);
  browser.kill();
  try { fs.rmSync(importDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(1);
});
