(() => {
  'use strict';

  // Browser port of the repository's LWR finite-volume solver. Units are SI.
  const ROAD_LENGTH = 1000;
  const CELL_SIZE = 7;
  const FREE_SPEED = 22.22222;
  const JAM_DENSITY = 0.142857;
  const DT = 0.25;
  const INFLOW_SAMPLE_STEPS = Math.round(1 / DT);
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
    introRun: $('introRunButton'), reset: $('resetButton'), speedSelect: $('speedSelect'), scenario: $('scenarioSelect'), hint: $('scenarioHint'),
    variability: $('inflowVariation'), variabilityValue: $('inflowVariationValue'),
    duration: $('durationSelect'), scrubber: $('scrubber'), progress: $('progressLabel'),
    csv: $('csvButton'), json: $('jsonButton')
  };

  let config = scenarioConfig();
  let frames = [];
  let frameIndex = 0;
  let inflowSeed = 0;
  let playbackPosition = 0;
  let lastPlaybackTime = 0;
  let displayFrame = null;
  let timer = 0;
  let playing = false;
  let resizeObserver;

  function scenarioConfig() {
    switch (ui.scenario.value) {
      case 'partial':
        return { inflow: DEFAULT_INFLOW, reduction: 0.5, position: 805, label: 'One lane restricted', variability: Number(ui.variability.value) / 100 };
      case 'busy':
        return { inflow: 0.45, reduction: 0, position: 805, label: 'Busy road, no blockage', variability: Number(ui.variability.value) / 100 };
      default:
        return { inflow: DEFAULT_INFLOW, reduction: 1, position: 805, label: 'Road fully blocked', variability: Number(ui.variability.value) / 100 };
    }
  }

  function makeRunSeed() {
    const value = new Uint32Array(1);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(value);
    else value[0] = Date.now() >>> 0;
    return value[0] || 1;
  }

  function makeSeededRandom(seed) {
    let state = seed >>> 0 || 1;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0x100000000;
    };
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

  function advance(density, inflowDemand = config.inflow) {
    const { demand, supply } = demandSupply(density);
    const flux = new Float64Array(CELL_COUNT + 1);
    flux[0] = Math.min(inflowDemand, supply[0]);
    for (let i = 1; i < CELL_COUNT; i++) flux[i] = Math.min(demand[i - 1], supply[i]);
    flux[CELL_COUNT] = demand[CELL_COUNT - 1];
    const bottleneck = Math.min(Math.round(config.position / CELL_SIZE), CELL_COUNT - 1);
    flux[bottleneck] *= 1 - config.reduction;
    const next = new Float64Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) {
      next[i] = density[i] - (DT / widths[i]) * (flux[i + 1] - flux[i]);
      next[i] = Math.max(0, Math.min(JAM_DENSITY, next[i]));
    }
    return { density: next, inflowFlux: flux[0] };
  }

  function snapshot(density, time, cumulativeInflow = 0, inflowDemand = config.inflow) {
    let mass = 0, densitySum = 0, speedSum = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      mass += density[i] * widths[i];
      densitySum += density[i];
      speedSum += FREE_SPEED * Math.max(0, 1 - density[i] / JAM_DENSITY);
    }
    return { time, density, mass, meanDensity: densitySum / CELL_COUNT, meanSpeed: speedSum / CELL_COUNT, cumulativeInflow, inflowDemand };
  }

  function buildRun() {
    config = scenarioConfig();
    const steps = Math.round(Number(ui.duration.value) / DT);
    let density = new Float64Array(CELL_COUNT).fill(0.02);
    let cumulativeInflow = 0;
    inflowSeed = makeRunSeed();
    const random = makeSeededRandom(inflowSeed);
    let inflowDemand = config.inflow;
    frames = new Array(steps + 1);
    for (let step = 0; step <= steps; step++) {
      if (step % INFLOW_SAMPLE_STEPS === 0) {
        const variation = (random() * 2 - 1) * config.variability;
        inflowDemand = config.inflow * (1 + variation);
      }
      frames[step] = snapshot(density, step * DT, cumulativeInflow, inflowDemand);
      if (step < steps) {
        const update = advance(density, inflowDemand);
        density = update.density;
        cumulativeInflow += DT * update.inflowFlux;
      }
    }
    frameIndex = 0;
    playbackPosition = 0;
    displayFrame = frames[0];
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

  function interpolateFrame(position) {
    const lower = Math.max(0, Math.min(frames.length - 1, Math.floor(position)));
    const upper = Math.min(lower + 1, frames.length - 1);
    const fraction = position - lower;
    if (fraction === 0 || upper === lower) return frames[lower];
    const first = frames[lower];
    const second = frames[upper];
    const density = new Float64Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) {
      density[i] = first.density[i] + (second.density[i] - first.density[i]) * fraction;
    }
    return snapshot(
      density,
      first.time + (second.time - first.time) * fraction,
      first.cumulativeInflow + (second.cumulativeInflow - first.cumulativeInflow) * fraction,
      first.inflowDemand + (second.inflowDemand - first.inflowDemand) * fraction
    );
  }

  function updateFrame(frame = frames[frameIndex], position = frameIndex) {
    if (!frame) return;
    displayFrame = frame;
    ui.time.textContent = formatTime(frame.time);
    ui.density.innerHTML = `${(frame.meanDensity * 1000).toFixed(1)} <small>PCU / km</small>`;
    ui.speed.innerHTML = `${(frame.meanSpeed * 3.6).toFixed(1)} <small>km / h</small>`;
    ui.mass.innerHTML = `${frame.mass.toFixed(1)} <small>PCU</small>`;
    ui.scrubber.value = String(position);
    const percentage = frames.length > 1 ? Math.round(position / (frames.length - 1) * 100) : 0;
    ui.progress.textContent = `${frames.length} saved frames · ${percentage}% complete`;
    drawRoad(frame);
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.roundRect(x, y, width, height, r);
  }

  function drawRoad(frame = displayFrame || frames[frameIndex]) {
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
    ctx.fillStyle = '#e8eeea'; ctx.fillRect(0, 0, 1000, 220);
    ctx.fillStyle = '#59646a'; roundedRect(ctx, 0, 38, 1000, 142, 17); ctx.fill();
    ctx.fillStyle = '#626d72'; roundedRect(ctx, 0, 50, 1000, 118, 12); ctx.fill();
    ctx.strokeStyle = '#dce3df'; ctx.lineWidth = 2; ctx.setLineDash([18, 17]);
    ctx.beginPath(); ctx.moveTo(20, 109); ctx.lineTo(980, 109); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#d2dad6'; ctx.fillRect(0, 52, 1000, 2); ctx.fillRect(0, 164, 1000, 2);

    // Subtle density wash follows the continuum solution, not an independent car model.
    if (frame) {
      for (let i = 0; i < CELL_COUNT; i++) {
        const k = frame.density[i];
        if (k <= 0.026) continue;
        const intensity = Math.min(0.36, (k - 0.026) / (JAM_DENSITY - 0.026) * 0.36);
        ctx.fillStyle = `rgba(226,177,106,${intensity})`;
        ctx.fillRect(edges[i], 52, widths[i] + 1, 112);
      }
    }

    // Restriction marker sits at the modeled interface x ≈ 805 m.
    const restrictionX = config.position;
    ctx.fillStyle = '#d79a4d';
    roundedRect(ctx, restrictionX - 6, 44, 12, 128, 5); ctx.fill();
    ctx.fillStyle = '#5c492f';
    for (let y = 51; y < 166; y += 17) {
      ctx.save(); ctx.translate(restrictionX, y); ctx.rotate(-Math.PI / 4); ctx.fillRect(-5, -3, 10, 6); ctx.restore();
    }
    ctx.fillStyle = '#26343a'; ctx.font = '600 14px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'center';
    const labelX = Math.max(48, Math.min(952, restrictionX));
    ctx.fillText(config.reduction === 0 ? 'REFERENCE POINT' : 'ROAD RESTRICTION', labelX, 29);
    ctx.fillStyle = '#526168'; ctx.font = '12px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`${Math.round(config.position)} m`, labelX, 199);

    if (frame) drawVehicles(frame);
  }

  function drawVehicles(frame) {
    const initialMass = frames.length ? frames[0].mass : frame.mass;
    const initialMarkerCount = Math.min(42, Math.max(0, Math.round(initialMass)));
    const inflowMarkerCount = Math.min(42 - initialMarkerCount, Math.floor(frame.cumulativeInflow + 0.5));
    const markers = [];
    for (let i = 0; i < initialMarkerCount; i++) {
      markers.push({ rank: (i + 0.5) * initialMass / initialMarkerCount + frame.cumulativeInflow, id: i });
    }
    for (let i = 0; i < inflowMarkerCount; i++) {
      markers.push({ rank: frame.cumulativeInflow - (i + 0.5), id: initialMarkerCount + i });
    }

    const cumulativeMass = new Float64Array(CELL_COUNT);
    let runningMass = 0;
    for (let cell = 0; cell < CELL_COUNT; cell++) {
      runningMass += frame.density[cell] * widths[cell];
      cumulativeMass[cell] = runningMass;
    }
    const restrictionIndex = Math.min(Math.round(config.position / CELL_SIZE), CELL_COUNT - 1);
    const massBeforeRestriction = restrictionIndex > 0 ? cumulativeMass[restrictionIndex - 1] : 0;
    const isFullyBlocked = config.reduction >= 1;
    const positionedMarkers = [];

    for (const marker of markers) {
      const target = marker.rank;
      if (target < 0 || target > frame.mass + 1e-8) continue;
      let cell = 0;
      while (cell < CELL_COUNT - 1 && cumulativeMass[cell] <= target) cell++;
      const massBeforeCell = cell > 0 ? cumulativeMass[cell - 1] : 0;
      const density = frame.density[cell];
      if (density <= 0) continue;
      const x = Math.max(edges[cell], Math.min(edges[cell + 1], edges[cell] + (target - massBeforeCell) / density));
      let roadX = x;
      const side = isFullyBlocked && target <= massBeforeRestriction ? 'upstream' : 'downstream';
      if (isFullyBlocked) {
        roadX = target <= massBeforeRestriction
          ? Math.min(roadX, config.position - 13)
          : Math.max(roadX, config.position + 13);
      }
      roadX = Math.max(6, Math.min(994, roadX));
      positionedMarkers.push({ x: roadX, lane: marker.id % 2, side, density, id: marker.id });
    }

    // Keep every representative marker visible: shrink the glyphs to a
    // plausible road scale and spread close centers along their lane.
    const groups = new Map();
    for (const marker of positionedMarkers) {
      const key = `${marker.lane}:${isFullyBlocked ? marker.side : 'road'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(marker);
    }
    for (const [key, group] of groups) {
      group.sort((a, b) => a.x - b.x || a.id - b.id);
      const side = key.split(':')[1];
      const minX = isFullyBlocked && side === 'downstream' ? config.position + 13 : 6;
      const maxX = isFullyBlocked && side === 'upstream' ? config.position - 13 : 994;
      const gap = 22;
      for (let i = 0; i < group.length; i++) {
        group[i].x = Math.max(minX, group[i].x, i ? group[i - 1].x + gap : minX);
      }
      if (group.length && group[group.length - 1].x > maxX) {
        group[group.length - 1].x = maxX;
        for (let i = group.length - 2; i >= 0; i--) {
          group[i].x = Math.min(group[i].x, group[i + 1].x - gap);
        }
      }
    }

    for (const marker of positionedMarkers) {
      const y = marker.lane === 0 ? 79 : 133;
      const speedFraction = Math.max(0.04, 1 - marker.density / JAM_DENSITY);
      const tint = speedFraction < .28 ? '#f0d39f' : (speedFraction < .58 ? '#c1dfcf' : '#d8e9df');
      ctx.save();
      ctx.fillStyle = tint; roundedRect(ctx, marker.x - 9, y - 5.5, 18, 11, 4); ctx.fill();
      ctx.strokeStyle = '#36454a'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#526168';
      roundedRect(ctx, marker.x - 3, y - 3.5, 6, 6, 2); ctx.fill();
      ctx.fillStyle = '#263744'; ctx.fillRect(marker.x - 5, y - 6, 3, 1.5); ctx.fillRect(marker.x + 2, y - 6, 3, 1.5);
      ctx.fillRect(marker.x - 5, y + 4.5, 3, 1.5); ctx.fillRect(marker.x + 2, y + 4.5, 3, 1.5);
      ctx.restore();
    }
  }

  function stopPlayback() {
    playing = false;
    if (timer) window.cancelAnimationFrame(timer);
    timer = 0;
    lastPlaybackTime = 0;
    ui.playIcon.textContent = '▶';
    ui.playText.textContent = frames.length ? (frameIndex >= frames.length - 1 ? 'Play again' : 'Resume') : 'Run simulation';
    setStatus(frames.length ? 'PAUSED' : 'READY', false);
  }

  function tick(now) {
    if (!playing) return;
    if (lastPlaybackTime) {
      playbackPosition += (now - lastPlaybackTime) / (DT * 1000) * Number(ui.speedSelect.value);
    }
    lastPlaybackTime = now;
    const finalPosition = frames.length - 1;
    if (playbackPosition >= finalPosition) playbackPosition = finalPosition;
    frameIndex = Math.min(Math.floor(playbackPosition), finalPosition);
    updateFrame(interpolateFrame(playbackPosition), playbackPosition);
    if (playbackPosition >= finalPosition) {
      playing = false; timer = 0; lastPlaybackTime = 0;
      setStatus('COMPLETE', false); ui.playText.textContent = 'Play again';
      return;
    }
    timer = window.requestAnimationFrame(tick);
  }

  function startPlayback() {
    if (!frames.length) buildRun();
    if (playbackPosition >= frames.length - 1) playbackPosition = 0;
    playing = true;
    lastPlaybackTime = 0;
    ui.playIcon.textContent = 'Ⅱ'; ui.playText.textContent = 'Pause simulation';
    setStatus('IN MOTION', true);
    timer = window.requestAnimationFrame(tick);
  }

  function download(name, contents, mime) {
    const blob = new Blob([contents], { type: mime });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCsv() {
    const rows = ['time_s,cell_index,x_start_m,x_end_m,density_vehicles_per_m,speed_m_per_s,flow_vehicles_per_s,vehicle_mass_pcu,inflow_demand_vehicles_per_s'];
    for (const frame of frames) {
      for (let i = 0; i < CELL_COUNT; i++) {
        const density = frame.density[i];
        rows.push(`${frame.time.toFixed(2)},${i},${edges[i].toFixed(2)},${edges[i + 1].toFixed(2)},${density.toFixed(8)},${(FREE_SPEED * Math.max(0, 1 - density / JAM_DENSITY)).toFixed(8)},${flowAt(density).toFixed(8)},${(density * widths[i]).toFixed(8)},${frame.inflowDemand.toFixed(8)}`);
      }
    }
    download('flowline-traffic-run.csv', rows.join('\n'), 'text/csv;charset=utf-8');
  }

  function exportJson() {
    const result = {
      app: 'Flowline Traffic Flow Studio', model: 'LWR finite-volume / Greenshields',
      note: 'Road scene car markers are illustrative. Playback speed does not change simulation physics.',
      parameters: { road_length_m: ROAD_LENGTH, cell_size_m: CELL_SIZE, free_flow_speed_m_per_s: FREE_SPEED, jam_density_vehicles_per_m: JAM_DENSITY, time_step_s: DT, inflow_vehicles_per_s: config.inflow, inflow_mean_vehicles_per_s: config.inflow, inflow_variability_percent: config.variability * 100, inflow_random_seed: inflowSeed, inflow_random_generator: 'xorshift32', inflow_resample_interval_s: 1, bottleneck_position_m: config.position, lane_reduction: config.reduction, scenario: config.label },
      frames: frames.map(frame => ({ time_s: frame.time, inflow_demand_vehicles_per_s: frame.inflowDemand, cumulative_inflow_pcu: frame.cumulativeInflow, total_vehicle_mass_pcu: frame.mass, mean_density_pcu_per_km: frame.meanDensity * 1000, mean_speed_km_per_h: frame.meanSpeed * 3.6, density_vehicles_per_m_by_cell: Array.from(frame.density) }))
    };
    download('flowline-traffic-run.json', JSON.stringify(result), 'application/json');
  }

  ui.play.addEventListener('click', () => playing ? stopPlayback() : startPlayback());
  ui.introRun.addEventListener('click', () => {
    if (!playing) startPlayback();
  });
  ui.reset.addEventListener('click', () => {
    stopPlayback(); buildRun(); frameIndex = 0; updateFrame(); setStatus('READY', false);
    ui.playText.textContent = 'Run simulation'; ui.playIcon.textContent = '▶';
  });
  ui.scrubber.addEventListener('input', () => {
    if (!playing && frames.length) {
      playbackPosition = Number(ui.scrubber.value);
      frameIndex = Math.floor(playbackPosition);
      updateFrame(interpolateFrame(playbackPosition), playbackPosition);
    }
  });
  ui.speedSelect.addEventListener('change', () => { if (playing) lastPlaybackTime = 0; });
  ui.variability.addEventListener('input', () => { ui.variabilityValue.textContent = `±${ui.variability.value}%`; });
  ui.variability.addEventListener('change', () => {
    if (frames.length) {
      stopPlayback(); buildRun();
      ui.playText.textContent = 'Run simulation'; ui.playIcon.textContent = '▶';
    }
  });
  ui.scenario.addEventListener('change', () => {
    stopPlayback(); frames = []; frameIndex = 0; playbackPosition = 0; displayFrame = null;
    const hints = {
      closure: 'Traffic queues behind a full restriction at 805 m.',
      partial: 'Flow through the road is reduced by 50% at 805 m.',
      busy: 'Higher arrivals; no capacity restriction is applied.'
    };
    ui.hint.textContent = hints[ui.scenario.value];
    config = scenarioConfig(); ui.scrubber.disabled = true; ui.reset.disabled = true; ui.csv.disabled = true; ui.json.disabled = true;
    displayFrame = snapshot(new Float64Array(CELL_COUNT).fill(0.02), 0, 0);
    ui.time.textContent = '00:00'; ui.density.innerHTML = '20.0 <small>PCU / km</small>'; ui.speed.innerHTML = '68.8 <small>km / h</small>'; ui.mass.innerHTML = '20.0 <small>PCU</small>';
    ui.progress.textContent = 'Ready when you are'; setStatus('READY', false); drawRoad(displayFrame);
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
  displayFrame = snapshot(new Float64Array(CELL_COUNT).fill(0.02), 0);
  drawRoad(displayFrame);
})();
