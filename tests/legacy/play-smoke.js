'use strict';

// Drives the page in headless Edge over the DevTools protocol: loads it, presses
// Play, lets it run, presses "Force a collision (demo)", and reports any errors.

const { spawn } = require('child_process');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const URL = process.argv[2] || 'http://127.0.0.1:8000/index.html';
const profile = `${process.env.TEMP}\\flowline-smoke-${Date.now()}`;

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
    } catch (e) { /* not ready yet */ }
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
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      errors.push(`console: ${data.params.args.map((a) => a.value || a.description).join(' ')}`);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    id += 1; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : r.result;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(4000);

  const before = await evaluate(`JSON.stringify({ ready: document.readyState, play: !!document.getElementById('microPlay'), force: !!document.getElementById('microForceCrash') })`);
  console.log('page:', before);

  await evaluate(`document.getElementById('microPlay').click()`);
  await sleep(8000);
  const running = await evaluate(`document.getElementById('microEvent').textContent`);
  console.log('after Play, event text:', running);

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${__dirname}\\${name}.png`, Buffer.from(r.result.data, 'base64'));
  };
  await shot('smoke-after-play');
  await evaluate(`document.getElementById('microForceCrash').click()`);
  await sleep(1500);
  await shot('smoke-after-force');
  const crash = await evaluate(`JSON.stringify({ hidden: document.getElementById('microCrashReport').hidden, summary: document.getElementById('microCrashSummary').textContent })`);
  console.log('after Force a collision:', crash);

  await sleep(3000);
  console.log('risk explanation:', await evaluate(`document.getElementById('microRiskExplanation').textContent`));
  console.log('errors:', errors.length ? errors : 'none');
  ws.close();
  browser.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(0);
})().catch((error) => { console.error('smoke failed:', error); browser.kill(); process.exit(1); });
