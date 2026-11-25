(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const playBtn = $('microPlay');
  const stepBtn = $('microStep');
  const resetBtn = $('microReset');
  const clearLogBtn = $('microCrashClear');
  const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
  const terminalLog = $('osTerminalLog');
  const terminalInput = $('osTerminalInput');
  const terminalRun = $('osTerminalRun');
  const dockRun = $('osDockRun');
  const dockStep = $('osDockStep');
  const dockReset = $('osDockReset');
  const dockView = $('osDockView');
  const dockClearLog = $('osDockClearLog');
  const dockStatus = $('osDockStatus');
  const fpsReadout = $('osFpsReadout');
  const metricFps = $('osMetricFps');
  const metricThroughput = $('osMetricThroughput');
  const metricPcu = $('osMetricPcu');
  const metricConflicts = $('osMetricConflicts');
  const microStatus = $('microStatus');
  const microVehicleCount = $('microVehicleCount');
  const microExited = $('microExited');
  const microTime = $('microTime');
  const microContacts = $('microContacts');
  const microCrashCount = $('microCrashCount');
  const timeline = $('microTimeline');
  const seedInput = $('microSeed');
  const speedInput = $('microSpeed');

  function log(line, cls) {
    if (!terminalLog) return;
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = line;
    terminalLog.appendChild(div);
    terminalLog.scrollTop = terminalLog.scrollHeight;
  }

  function setView(mode) {
    const btn = viewButtons.find((b) => b.dataset.view === mode);
    if (btn) btn.click();
  }

  function cycleView() {
    const active = viewButtons.find((b) => b.classList.contains('is-active'))?.dataset.view || 'split';
    setView(active === 'split' ? '3d' : active === '3d' ? '2d' : 'split');
  }

  function spawn(kind) {
    if (window.FlowlineSim && Array.isArray(window.__flowlineState?.vehicles)) {
      const S = window.FlowlineSim;
      const state = window.__flowlineState;
      const profile = S.profiles[kind];
      if (!profile) return log(`unknown vehicle type: ${kind}`, 'is-err');
      const id = state.vehicles.reduce((m, v) => Math.max(m, v.id), 0) + 1;
      const lane = state.vehicles.length % 2;
      const rear = state.vehicles.filter((v) => v.lane === lane).reduce((m, v) => Math.min(m, v.position - v.length), 470);
      const v = {
        id, kind, lane, targetLane: lane, changing: false, laneChangeProgress: 1, laneChangeDuration: 2.4,
        length: profile.length[1], width: profile.width[1],
        position: Math.max(20, rear - 12), speed: 8, acceleration: 0,
        desired: profile.desired[0], maxAcceleration: profile.acceleration[0], comfortableBraking: profile.deceleration[0],
        minGap: profile.gap[0], headway: profile.headway[0], reactionTime: profile.reaction[0],
        politeness: 0.2, laneChangeCooldown: 0, returnToPreferredLane: false, speedCapKmh: 60, crashed: false
      };
      state.vehicles.push(v);
      window.dispatchEvent(new CustomEvent('flowline:terminal-sync'));
      return log(`spawned ${kind} #${id} lane ${lane + 1}`);
    }
    log('spawn unavailable: simulation state not exposed', 'is-err');
  }

  function runCommand(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    log(`$ ${cmd}`);
    const [op, arg] = cmd.toLowerCase().split(/\s+/);
    if (op === 'run' || op === 'start') { if (playBtn?.textContent?.toLowerCase().includes('run') || playBtn?.textContent?.toLowerCase().includes('resume')) playBtn.click(); log('running'); }
    else if (op === 'pause' || op === 'stop') { if (playBtn?.textContent?.toLowerCase().includes('pause')) playBtn.click(); log('paused'); }
    else if (op === 'step') { stepBtn?.click(); log('stepped'); }
    else if (op === 'reset') { resetBtn?.click(); log('reset'); }
    else if (op === 'clearlog' || op === 'clear') { clearLogBtn?.click(); log('log cleared'); }
    else if (op === 'view' && ['2d','3d','split'].includes(arg)) { setView(arg); log(`view ${arg}`); }
    else if (op === 'seed' && arg) { if (seedInput) { seedInput.value = String(Math.max(0, parseInt(arg,10)||0)); seedInput.dispatchEvent(new Event('input',{bubbles:true})); seedInput.dispatchEvent(new Event('change',{bubbles:true})); log(`seed ${seedInput.value}`); } }
    else if (op === 'speed' && arg) { if (speedInput) { speedInput.value = arg; speedInput.dispatchEvent(new Event('change',{bubbles:true})); log(`speed ${arg}x`); } }
    else if (op === 'spawn' && arg) { spawn(arg); }
    else if (op === 'help') { log('commands: run pause step reset clearlog view 2d|3d|split seed <n> speed <0.5|1|2|4|5> spawn car|motorcycle|rickshaw|bus|truck'); }
    else { log(`unknown command: ${cmd}`, 'is-err'); }
  }

  terminalRun?.addEventListener('click', () => { runCommand(terminalInput.value); terminalInput.value = ''; terminalInput.focus(); });
  terminalInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runCommand(terminalInput.value); terminalInput.value = ''; } });

  dockRun?.addEventListener('click', () => playBtn?.click());
  dockStep?.addEventListener('click', () => stepBtn?.click());
  dockReset?.addEventListener('click', () => resetBtn?.click());
  dockView?.addEventListener('click', cycleView);
  dockClearLog?.addEventListener('click', () => clearLogBtn?.click());
  document.querySelectorAll('[data-seed-preset]').forEach((btn) => btn.addEventListener('click', () => {
    if (!seedInput) return;
    seedInput.value = btn.dataset.seedPreset;
    seedInput.dispatchEvent(new Event('input', { bubbles: true }));
    seedInput.dispatchEvent(new Event('change', { bubbles: true }));
    log(`seed preset ${seedInput.value}`);
  }));

  // FPS meter
  let frames = 0, last = performance.now(), fps = 0;
  function fpsLoop(now) {
    frames++;
    if (now - last >= 1000) {
      fps = Math.round((frames * 1000) / (now - last));
      frames = 0; last = now;
      if (fpsReadout) fpsReadout.textContent = `FPS ${fps}`;
      if (metricFps) metricFps.textContent = String(fps);
      if (dockStatus && microStatus) dockStatus.textContent = microStatus.textContent || 'READY';
    }
    requestAnimationFrame(fpsLoop);
  }
  requestAnimationFrame(fpsLoop);

  // Live diagnostics from existing DOM telemetry (no simulation logic changes)
  function updateDerivedMetrics() {
    const t = parseFloat(microTime?.textContent || '0') || 0;
    const exited = parseFloat(microExited?.textContent || '0') || 0;
    const contacts = parseFloat(microContacts?.textContent || '0') || 0;
    const crashes = parseFloat(microCrashCount?.textContent || '0') || 0;
    const mins = Math.max(t / 60, 1 / 60);
    if (metricThroughput) metricThroughput.textContent = `${(exited / mins).toFixed(1)} veh/min`;
    if (metricConflicts) metricConflicts.textContent = String(contacts + crashes);
    const pcuMap = { carsCount: 1, motorcyclesCount: 0.5, rickshawsCount: 0.8, busesCount: 3, trucksCount: 3.5 };
    let pcu = 0;
    for (const [id, factor] of Object.entries(pcuMap)) pcu += (parseFloat($(id)?.textContent || '0') || 0) * factor;
    if (metricPcu) metricPcu.textContent = pcu.toFixed(1);
  }
  setInterval(updateDerivedMetrics, 500);
  updateDerivedMetrics();
  log('Flowline OS ready. Type "help" for commands.');
})();
