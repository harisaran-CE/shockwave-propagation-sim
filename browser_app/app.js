(() => {
  'use strict';

  // Browser port of the repository's LWR finite-volume solver. Units are SI.
  const ROAD_LENGTH = 1000;
  const CELL_SIZE = 7;
  const FREE_SPEED = 22.22222;
  const JAM_DENSITY = 0.142857;
  const DT = 0.25;
  const DEFAULT_INFLOW = 1200 / 3600;
  const CRITICAL_DENSITY = JAM_DENSITY / 2;
  const CAPACITY = CRITICAL_DENSITY * FREE_SPEED * (1 - CRITICAL_DENSITY / JAM_DENSITY);
  const CELL_COUNT = Math.ceil(ROAD_LENGTH / CELL_SIZE);
  const edges = Float64Array.from({ length: CELL_COUNT + 1 }, (_, i) => Math.min(i * CELL_SIZE, ROAD_LENGTH));
  const widths = Float64Array.from({ length: CELL_COUNT }, (_, i) => edges[i + 1] - edges[i]);

  const $ = (id) => document.getElementById(id);
  const canvas = $('roadCanvas');
  const ctx = canvas.getContext('2d');
  const ui = {
    time: $('timeReadout'), density: $('densityReadout'), speed: $('speedReadout'), mass: $('massReadout'),
    status: $('sceneStatus'), play: $('playButton'), playIcon: $('playIcon'), playText: $('playText'),
    reset: $('resetButton'), speedSelect: $('speedSelect'), scenario: $('scenarioSelect'), hint: $('scenarioHint'),
    duration: $('durationSelect'), scrubber: $('scrubber'), progress: $('progressLabel'),
    csv: $('csvButton'), json: $('jsonButton')
  };

  let config = scenarioConfig();
  let frames = [];
  let frameIndex = 0;
  let timer = 0;
  let playing = false;
  let resizeObserver;

  function scenarioConfig() {
    switch (ui.scenario.value) {
      case 'partial':
        return { inflow: DEFAULT_INFLOW, reduction: 0.5, position: 805, label: 'One lane restricted' };
      case 'busy':
        return { inflow: 0.45, reduction: 0, position: 805, label: 'Busy road, no blockage' };
      default:
        return { inflow: DEFAULT_INFLOW, reduction: 1, position: 805, label: 'Road fully blocked' };
    }
  }

  function flowAt(k) { return k * FREE_SPEED * (1 - k / JAM_DENSITY); }
  function demandSupply(density) {
    const demand = new Float64Array(CELL_COUNT);
    const supply = new Float64Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) {
      const flow = flowAt(density[i]);
      if (density[i] <= CRITICAL_DENSITY) {
        demand[i] = flow;
        supply[i] = CAPACITY;
      } else {
        demand[i] = CAPACITY;
        supply[i] = flow;
      }
    }
    return { demand, supply };
  }

  function advance(density) {
    const { demand, supply } = demandSupply(density);
    const flux = new Float64Array(CELL_COUNT + 1);
    flux[0] = Math.min(config.inflow, supply[0]);
    for (let i = 1; i < CELL_COUNT; i++) flux[i] = Math.min(demand[i - 1], supply[i]);
    flux[CELL_COUNT] = demand[CELL_COUNT - 1];
    const bottleneck = Math.min(Math.round(config.position / CELL_SIZE), CELL_COUNT - 1);
    flux[bottleneck] *= 1 - config.reduction;
    const next = new Float64Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) {
      next[i] = density[i] - (DT / widths[i]) * (flux[i + 1] - flux[i]);
      next[i] = Math.max(0, Math.min(JAM_DENSITY, next[i]));
    }
    return next;
  }

  function snapshot(density, time) {
    let mass = 0, densitySum = 0, speedSum = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      mass += density[i] * widths[i];
      densitySum += density[i];
      speedSum += FREE_SPEED * Math.max(0, 1 - density[i] / JAM_DENSITY);
    }
    return { time, density, mass, meanDensity: densitySum / CELL_COUNT, meanSpeed: speedSum / CELL_COUNT };
  }

  function buildRun() {
    config = scenarioConfig();
    const steps = Math.round(Number(ui.duration.value) / DT);
    let density = new Float64Array(CELL_COUNT).fill(0.02);
    frames = new Array(steps + 1);
    for (let step = 0; step <= steps; step++) {
      frames[step] = snapshot(density, step * DT);
      if (step < steps) density = advance(density);
    }
    frameIndex = 0;
    ui.scrubber.max = String(frames.length - 1);
    ui.scrubber.value = '0';
    ui.scrubber.disabled = false;
    ui.reset.disabled = false;
    ui.csv.disabled = false;
    ui.json.disabled = false;
    ui.progress.textContent = `${frames.length} saved frames · 0% complete`;
    setStatus('READY', false);
    updateFrame();
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function setStatus(text, active) {
    ui.status.textContent = text;
    ui.status.classList.toggle('is-running', Boolean(active));
  }

  function updateFrame() {
    const frame = frames[frameIndex];
    if (!frame) return;
    ui.time.textContent = formatTime(frame.time);
    ui.density.innerHTML = `${(frame.meanDensity * 1000).toFixed(1)} <small>PCU / km</small>`;
    ui.speed.innerHTML = `${(frame.meanSpeed * 3.6).toFixed(1)} <small>km / h</small>`;
    ui.mass.innerHTML = `${frame.mass.toFixed(1)} <small>PCU</small>`;
    ui.scrubber.value = String(frameIndex);
    const percentage = frames.length > 1 ? Math.round(frameIndex / (frames.length - 1) * 100) : 0;
    ui.progress.textContent = `${frames.length} saved frames · ${percentage}% complete`;
    drawRoad(frame);
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.roundRect(x, y, width, height, r);
  }

  function drawRoad(frame = frames[frameIndex]) {
    if (!ctx) return;
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(bounds.width * dpr));
    const pixelHeight = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(pixelWidth / 1000, 0, 0, pixelHeight / 220, 0, 0);
    ctx.clearRect(0, 0, 1000, 220);

    // Soft roadside glow and an outlined two-lane road.
    const glow = ctx.createLinearGradient(0, 0, 0, 220);
    glow.addColorStop(0, '#142c35'); glow.addColorStop(.5, '#13202b'); glow.addColorStop(1, '#142c35');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 1000, 220);
    ctx.fillStyle = '#283746'; roundedRect(ctx, 0, 38, 1000, 142, 17); ctx.fill();
    ctx.fillStyle = '#303e4c'; roundedRect(ctx, 0, 50, 1000, 118, 12); ctx.fill();
    ctx.strokeStyle = '#c2d1dc68'; ctx.lineWidth = 2; ctx.setLineDash([18, 17]);
    ctx.beginPath(); ctx.moveTo(20, 109); ctx.lineTo(980, 109); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#bdcbd344'; ctx.fillRect(0, 52, 1000, 2); ctx.fillRect(0, 164, 1000, 2);

    // Subtle density wash follows the continuum solution, not an independent car model.
    if (frame) {
      for (let i = 0; i < CELL_COUNT; i++) {
        const k = frame.density[i];
        if (k <= 0.026) continue;
        const intensity = Math.min(0.48, (k - 0.026) / (JAM_DENSITY - 0.026) * 0.48);
        ctx.fillStyle = `rgba(240,181,111,${intensity})`;
        ctx.fillRect(edges[i], 52, widths[i] + 1, 112);
      }
    }

    // Restriction marker sits at the modeled interface x ≈ 805 m.
    const restrictionX = config.position;
    ctx.fillStyle = '#f0b56f';
    roundedRect(ctx, restrictionX - 6, 44, 12, 128, 5); ctx.fill();
    ctx.fillStyle = '#27231d';
    for (let y = 51; y < 166; y += 17) {
      ctx.save(); ctx.translate(restrictionX, y); ctx.rotate(-Math.PI / 4); ctx.fillRect(-5, -3, 10, 6); ctx.restore();
    }
    ctx.fillStyle = '#f0c48f'; ctx.font = '500 14px "DM Mono", monospace'; ctx.textAlign = 'center';
    const labelX = Math.max(48, Math.min(952, restrictionX));
    ctx.fillText(config.reduction === 0 ? 'REFERENCE POINT' : 'ROAD RESTRICTION', labelX, 29);
    ctx.fillStyle = '#98aab7'; ctx.font = '12px "DM Mono", monospace';
    ctx.fillText(`${Math.round(config.position)} m`, labelX, 199);

    if (frame) drawVehicles(frame);
  }

  function drawVehicles(frame) {
    const totalMarkers = Math.min(42, Math.max(1, Math.round(frame.mass)));
    let cell = 0, cumulative = 0;
    const targets = Array.from({ length: totalMarkers }, (_, i) => (i + 0.5) * frame.mass / totalMarkers);
    const positions = [];
    for (let j = 0; j < targets.length; j++) {
      const target = targets[j];
      while (cell < CELL_COUNT - 1 && cumulative + frame.density[cell] * widths[cell] < target) {
        cumulative += frame.density[cell] * widths[cell]; cell++;
      }
      const within = frame.density[cell] > 0 ? (target - cumulative) / frame.density[cell] : 0;
      positions.push(Math.max(edges[cell] + 2, Math.min(edges[cell + 1] - 2, edges[cell] + within)));
    }
    for (let i = 0; i < positions.length; i++) {
      const x = positions[i];
      const y = i % 2 === 0 ? 79 : 133;
      const localCell = Math.min(CELL_COUNT - 1, Math.floor(x / CELL_SIZE));
      const speedFraction = Math.max(0.04, 1 - frame.density[localCell] / JAM_DENSITY);
      const tint = speedFraction < .28 ? '#f1b778' : (speedFraction < .58 ? '#9bd8ba' : '#88dfe0');
      ctx.save();
      ctx.shadowColor = `${tint}55`; ctx.shadowBlur = 7;
      ctx.fillStyle = tint; roundedRect(ctx, x - 9, y - 7, 18, 13, 5); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#21313b';
      roundedRect(ctx, x - 3.5, y - 5, 8, 9, 3); ctx.fill();
      ctx.fillStyle = '#263744'; ctx.fillRect(x - 6, y - 8, 4, 2); ctx.fillRect(x + 3, y - 8, 4, 2);
      ctx.fillRect(x - 6, y + 6, 4, 2); ctx.fillRect(x + 3, y + 6, 4, 2);
      ctx.restore();
    }
  }

  function stopPlayback() {
    playing = false;
    window.clearTimeout(timer);
    ui.playIcon.textContent = '▶';
    ui.playText.textContent = frames.length ? (frameIndex >= frames.length - 1 ? 'Play again' : 'Resume') : 'Run simulation';
    setStatus(frames.length ? 'PAUSED' : 'READY', false);
  }

  function tick() {
    if (!playing) return;
    if (frameIndex >= frames.length - 1) {
      stopPlayback(); setStatus('COMPLETE', false); ui.playText.textContent = 'Play again'; return;
    }
    frameIndex++;
    updateFrame();
    const delay = Math.max(20, DT * 1000 / Number(ui.speedSelect.value));
    timer = window.setTimeout(tick, delay);
  }

  function startPlayback() {
    if (!frames.length) buildRun();
    if (frameIndex >= frames.length - 1) frameIndex = 0;
    playing = true;
    ui.playIcon.textContent = 'Ⅱ'; ui.playText.textContent = 'Pause simulation';
    setStatus('IN MOTION', true);
    updateFrame(); tick();
  }

  function download(name, contents, mime) {
    const blob = new Blob([contents], { type: mime });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCsv() {
    const rows = ['time_s,cell_index,x_start_m,x_end_m,density_vehicles_per_m,speed_m_per_s,flow_vehicles_per_s,vehicle_mass_pcu'];
    for (const frame of frames) {
      for (let i = 0; i < CELL_COUNT; i++) {
        const density = frame.density[i];
        rows.push(`${frame.time.toFixed(2)},${i},${edges[i].toFixed(2)},${edges[i + 1].toFixed(2)},${density.toFixed(8)},${(FREE_SPEED * Math.max(0, 1 - density / JAM_DENSITY)).toFixed(8)},${flowAt(density).toFixed(8)},${(density * widths[i]).toFixed(8)}`);
      }
    }
    download('flowline-traffic-run.csv', rows.join('\n'), 'text/csv;charset=utf-8');
  }

  function exportJson() {
    const result = {
      app: 'Flowline Traffic Flow Studio', model: 'LWR finite-volume / Greenshields',
      note: 'Road scene car markers are illustrative. Playback speed does not change simulation physics.',
      parameters: { road_length_m: ROAD_LENGTH, cell_size_m: CELL_SIZE, free_flow_speed_m_per_s: FREE_SPEED, jam_density_vehicles_per_m: JAM_DENSITY, time_step_s: DT, inflow_vehicles_per_s: config.inflow, bottleneck_position_m: config.position, lane_reduction: config.reduction, scenario: config.label },
      frames: frames.map(frame => ({ time_s: frame.time, total_vehicle_mass_pcu: frame.mass, mean_density_pcu_per_km: frame.meanDensity * 1000, mean_speed_km_per_h: frame.meanSpeed * 3.6, density_vehicles_per_m_by_cell: Array.from(frame.density) }))
    };
    download('flowline-traffic-run.json', JSON.stringify(result), 'application/json');
  }

  ui.play.addEventListener('click', () => playing ? stopPlayback() : startPlayback());
  ui.reset.addEventListener('click', () => {
    stopPlayback(); buildRun(); frameIndex = 0; updateFrame(); setStatus('READY', false);
    ui.playText.textContent = 'Run simulation'; ui.playIcon.textContent = '▶';
  });
  ui.scrubber.addEventListener('input', () => { if (!playing && frames.length) { frameIndex = Number(ui.scrubber.value); updateFrame(); } });
  ui.speedSelect.addEventListener('change', () => { if (playing) { window.clearTimeout(timer); tick(); } });
  ui.scenario.addEventListener('change', () => {
    stopPlayback(); frames = []; frameIndex = 0;
    const hints = {
      closure: 'Traffic queues behind a full restriction at 805 m.',
      partial: 'Flow through the road is reduced by 50% at 805 m.',
      busy: 'Higher arrivals; no capacity restriction is applied.'
    };
    ui.hint.textContent = hints[ui.scenario.value];
    config = scenarioConfig(); ui.scrubber.disabled = true; ui.reset.disabled = true; ui.csv.disabled = true; ui.json.disabled = true;
    ui.time.textContent = '00:00'; ui.density.innerHTML = '20.0 <small>PCU / km</small>'; ui.speed.innerHTML = '— <small>km / h</small>'; ui.mass.innerHTML = '20.0 <small>PCU</small>';
    ui.progress.textContent = 'Ready when you are'; setStatus('READY', false); drawRoad();
    ui.playText.textContent = 'Run simulation'; ui.playIcon.textContent = '▶';
  });
  ui.duration.addEventListener('change', () => {
    if (frames.length) { stopPlayback(); buildRun(); ui.playText.textContent = 'Run simulation'; }
  });
  ui.csv.addEventListener('click', exportCsv);
  ui.json.addEventListener('click', exportJson);

  function resize() { drawRoad(); }
  if ('ResizeObserver' in window) { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); }
  else window.addEventListener('resize', resize);

  config = scenarioConfig();
  frames = [];
  drawRoad(snapshot(new Float64Array(CELL_COUNT).fill(0.02), 0));
})();
