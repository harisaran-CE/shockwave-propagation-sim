(() => {
  'use strict';

  const ROAD_LENGTH = 500;
  const STEP = 0.025;
  const RANDOM_SEED = 41;
  const LANE_CHANGE_DURATION = 1.9;
  const MIN_LANE_GAIN = 0.35;
  const SAFE_FOLLOWER_DECELERATION = 3.0;
  const COOLDOWN_STEPS = 20;
  const CLOSURE_LOOKAHEAD = 5;
  const ARRIVAL_MIX = [
    ['car', 0.45], ['motorcycle', 0.24], ['rickshaw', 0.13], ['bus', 0.08], ['truck', 0.10]
  ];
  const $ = (id) => document.getElementById(id);
  const canvas = $('microRoad');
  const ctx = canvas.getContext('2d');
  const ui = {
    status: $('microStatus'),
    time: $('microTime'),
    vehicles: $('microVehicleCount'),
    overtakes: $('microOvertakes'),
    laneChanges: $('microLaneChanges'),
    meanSpeed: $('microMeanSpeed'),
    event: $('microEvent'),
    play: $('microPlay'),
    playIcon: $('microPlayIcon'),
    playText: $('microPlayText'),
    reset: $('microReset'),
    speed: $('microSpeed'),
    scenario: $('microScenario'),
    scenarioHint: $('microScenarioHint'),
    laneSetting: $('microLaneSetting'),
    closedLane: $('microClosedLane'),
    barrierPosition: $('microBarrierPosition'),
    arrivalRate: $('microArrivalRate'),
    variation: $('microVariation'),
    variationValue: $('microVariationValue'),
    speedLimit: $('microSpeedLimit'),
    duration: $('microDuration'),
    csv: $('microCsv'),
    json: $('microJson')
  };

  const profiles = {
    car: {
      label: 'car', color: '#80c4a4', length: [4, 4.8], width: [1.65, 1.9],
      desired: [10, 13.8], acceleration: [1, 2.2], deceleration: [2.5, 4.5],
      gap: [1.5, 3], headway: [0.9, 2], reaction: [0.5, 1.4]
    },
    motorcycle: {
      label: 'motorcycle', color: '#e6bb72', length: [1.8, 2.3], width: [0.65, 0.9],
      desired: [10.5, 13.8], acceleration: [1.2, 2.8], deceleration: [2.5, 4.5],
      gap: [0.8, 1.8], headway: [0.7, 1.6], reaction: [0.4, 1.2]
    },
    rickshaw: {
      label: 'auto-rickshaw', color: '#d8a951', length: [2.5, 3.5], width: [1.35, 1.8],
      desired: [8.5, 11.5], acceleration: [0.7, 1.5], deceleration: [2, 3.5],
      gap: [1.2, 2.5], headway: [1, 2.2], reaction: [0.6, 1.6]
    },
    bus: {
      label: 'bus', color: '#7cabc0', length: [9, 12], width: [2.35, 2.6],
      desired: [7.5, 10.5], acceleration: [0.45, 1], deceleration: [1.5, 2.8],
      gap: [2, 4], headway: [1.5, 2.8], reaction: [0.8, 1.8]
    },
    truck: {
      label: 'truck', color: '#ac9d89', length: [7, 12], width: [2.3, 2.6],
      desired: [7.5, 10.5], acceleration: [0.4, 1], deceleration: [1.5, 2.8],
      gap: [2, 4], headway: [1.5, 2.8], reaction: [0.8, 1.8]
    }
  };

  const initialFleet = [
    ['motorcycle', 0, 28], ['car', 0, 80], ['car', 0, 132], ['bus', 0, 184],
    ['rickshaw', 0, 236], ['truck', 0, 288],
    ['car', 1, 54], ['truck', 1, 106], ['car', 1, 200], ['motorcycle', 1, 252]
  ];

  let state;
  let running = false;
  let rafId = 0;
  let previousTime = 0;
  let accumulator = 0;
  let pixelRatio = 1;
  let barrierPositionM = Number(ui.barrierPosition.value);
  let draggingBarrier = false;

  function seededRandom(seed) {
    let value = seed >>> 0 || 1;
    return () => {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      value >>>= 0;
      return value / 0x100000000;
    };
  }

  function sample(random, range) {
    return range[0] + random() * (range[1] - range[0]);
  }

  function createVehicle(id, kind, lane, position, random) {
    const profile = profiles[kind];
    const desiredSpeed = Math.min(sample(random, profile.desired), Number(ui.speedLimit.value) / 3.6);
    return {
      id, kind, lane, position, speed: desiredSpeed * (0.66 + random() * 0.25),
      length: sample(random, profile.length), width: sample(random, profile.width),
      desiredSpeed, accelerationLimit: sample(random, profile.acceleration),
      deceleration: sample(random, profile.deceleration), minimumGap: sample(random, profile.gap),
      headway: sample(random, profile.headway), reaction: sample(random, profile.reaction),
      cooldown: 0, returnLane: null, passingTargetId: null, passedTarget: false,
      waitingForMerge: false,
      laneChangeFrom: null, laneChangeElapsed: 0, previousLaneChangeElapsed: 0,
      previousPosition: position, acceleration: 0
    };
  }

  function createState() {
    const random = seededRandom(RANDOM_SEED);
    const vehicles = initialFleet
      .map(([kind, lane, position], id) => createVehicle(id, kind, lane, position, random))
      .filter((vehicle) => !barrierBlocksLane(vehicle.lane)
        || vehicle.position + vehicle.length / 2 + vehicle.minimumGap < barrierPositionM);
    const ego = vehicles.find((vehicle) => vehicle.id === 2);
    if (ego) {
      ego.speed = Math.min(11.8, Number(ui.speedLimit.value) / 3.6);
      ego.desiredSpeed = Math.min(13.2, Number(ui.speedLimit.value) / 3.6);
    }
    const slowBus = vehicles.find((vehicle) => vehicle.id === 3);
    if (slowBus) {
      slowBus.speed = 3.0;
      slowBus.desiredSpeed = 8.5;
    }
    return {
      time: 0, vehicles, overtakes: 0, laneChanges: 0, preventedContacts: 0,
      exited: 0, endReached: false, nextId: initialFleet.length, random,
      nextArrival: 0,
      events: [],
      eventText: 'Ready. Change the settings or press Play to begin.'
    };
  }

  function barrierBlocksLane(lane) {
    return ui.scenario.value === 'closure'
      || (ui.scenario.value === 'partial' && lane === Number(ui.closedLane.value));
  }

  function barrierLeader(lane, position) {
    if (!barrierBlocksLane(lane) || barrierPositionM <= position) return null;
    return {
      id: -1 - lane,
      lane,
      position: barrierPositionM,
      speed: 0,
      length: 0,
      kind: 'barrier'
    };
  }

  function laneOpenFor(vehicle, lane) {
    return !barrierBlocksLane(lane)
      || vehicle.position + vehicle.length / 2 + vehicle.speed * LANE_CHANGE_DURATION
        + vehicle.minimumGap < barrierPositionM;
  }

  function occupiedLanes(vehicle, proposedLane = null) {
    const destination = proposedLane === null ? vehicle.lane : proposedLane;
    // Reserve both lanes for the full lateral maneuver, not just its endpoints.
    if (vehicle.laneChangeFrom === null) return [destination];
    return [...new Set([vehicle.laneChangeFrom, destination])];
  }

  function laneNeighbors(vehicles, lane, position, exceptId) {
    let leader = null;
    let follower = null;
    for (const other of vehicles) {
      if (other.id === exceptId || !occupiedLanes(other).includes(lane)) continue;
      if (other.position > position && (!leader || other.position < leader.position)) leader = other;
      if (other.position < position && (!follower || other.position > follower.position)) follower = other;
    }
    const barrier = barrierLeader(lane, position);
    if (barrier && (!leader || barrier.position < leader.position)) leader = barrier;
    return { leader, follower };
  }

  function idm(vehicle, leader) {
    const speed = Math.max(0, vehicle.speed);
    const freeRoad = 1 - (speed / vehicle.desiredSpeed) ** 4;
    if (!leader) return vehicle.accelerationLimit * freeRoad;
    const gap = leader.position - leader.length / 2 - vehicle.position - vehicle.length / 2;
    if (gap <= 0) return -vehicle.deceleration;
    const closing = speed - Math.max(0, leader.speed);
    const interactionDistance = vehicle.minimumGap + Math.max(
      0,
      speed * vehicle.headway
        + speed * closing / (2 * Math.sqrt(vehicle.accelerationLimit * vehicle.deceleration))
    );
    if (leader.kind === 'barrier') {
      const comfortableStopDistance = vehicle.minimumGap
        + speed * (vehicle.headway + vehicle.reaction)
        + speed ** 2 / (2 * vehicle.deceleration);
      if (gap > comfortableStopDistance + 40) return vehicle.accelerationLimit * freeRoad;
    }
    return Math.max(
      -vehicle.deceleration,
      Math.min(vehicle.accelerationLimit, vehicle.accelerationLimit * (freeRoad - (interactionDistance / gap) ** 2))
    );
  }

  function safeGaps(vehicle, leader, follower) {
    if (leader) {
      const frontGap = leader.position - leader.length / 2 - vehicle.position - vehicle.length / 2;
      const closing = Math.max(0, vehicle.speed - leader.speed);
      const requiredGap = vehicle.minimumGap + vehicle.speed * (vehicle.headway + vehicle.reaction)
        + closing ** 2 / (2 * vehicle.deceleration);
      if (frontGap < requiredGap) return false;
    }
    if (follower) {
      const rearGap = vehicle.position - vehicle.length / 2 - follower.position - follower.length / 2;
      const closing = Math.max(0, follower.speed - vehicle.speed);
      const requiredGap = follower.minimumGap + follower.speed * follower.headway
        + follower.speed * follower.reaction + closing ** 2 / (2 * follower.deceleration);
      if (rearGap < requiredGap) return false;
      if (idm(follower, vehicle) < -SAFE_FOLLOWER_DECELERATION) return false;
    }
    return true;
  }

  function proposalFor(vehicle) {
    if (vehicle.cooldown > 0 || vehicle.laneChangeFrom !== null) return null;
    if (vehicle.returnLane !== null) {
      if (!vehicle.passedTarget || !laneOpenFor(vehicle, vehicle.returnLane)) return null;
      const { leader, follower } = laneNeighbors(
        state.vehicles, vehicle.returnLane, vehicle.position, vehicle.id
      );
      if (safeGaps(vehicle, leader, follower)) {
        return { vehicle, lane: vehicle.returnLane, gain: 0, returning: true };
      }
      return null;
    }

    const { leader: currentLeader } = laneNeighbors(
      state.vehicles, vehicle.lane, vehicle.position, vehicle.id
    );
    const barrierAhead = barrierBlocksLane(vehicle.lane)
      && barrierPositionM > vehicle.position + vehicle.length / 2;
    const barrierDistance = barrierPositionM - vehicle.position - vehicle.length / 2;
    const closureDecisionDistance = Math.max(
      150,
      vehicle.speed * (vehicle.headway + vehicle.reaction + LANE_CHANGE_DURATION + CLOSURE_LOOKAHEAD)
        + vehicle.speed ** 2 / (2 * vehicle.deceleration)
    );
    const needsClosureMerge = barrierAhead && barrierDistance <= closureDecisionDistance;
    if (!currentLeader) {
      vehicle.waitingForMerge = false;
      return null;
    }
    if (!needsClosureMerge && currentLeader.speed >= vehicle.speed - 0.3) {
      vehicle.waitingForMerge = false;
      return null;
    }
    const currentAcceleration = idm(vehicle, currentLeader);
    let best = null;
    for (const lane of [vehicle.lane - 1, vehicle.lane + 1]) {
      if (lane < 0 || lane > 1 || !laneOpenFor(vehicle, lane)) continue;
      const { leader, follower } = laneNeighbors(
        state.vehicles, lane, vehicle.position, vehicle.id
      );
      if (!safeGaps(vehicle, leader, follower)) continue;
      const gain = idm(vehicle, leader) - currentAcceleration;
      const closureGain = needsClosureMerge ? 1 + Math.max(0, (closureDecisionDistance - barrierDistance) / 20) : 0;
      const decisionGain = needsClosureMerge ? closureGain : gain;
      if ((needsClosureMerge || gain >= MIN_LANE_GAIN) && (!best || decisionGain > best.gain)) {
        best = {
          vehicle, lane, gain: decisionGain, returning: false,
          targetId: currentLeader.id, closureMerge: needsClosureMerge
        };
      }
    }
    if (needsClosureMerge && !best) {
      if (!vehicle.waitingForMerge) {
        state.eventText = `${profiles[vehicle.kind].label} ${vehicle.id + 1} is waiting for a safe gap before the closure.`;
      }
      vehicle.waitingForMerge = true;
    } else {
      vehicle.waitingForMerge = false;
    }
    return best;
  }

  function registerEvent(vehicle, fromLane, toLane, returning, targetId, closureMerge) {
    state.laneChanges += 1;
    vehicle.laneChangeFrom = fromLane;
    vehicle.laneChangeElapsed = 0;
    vehicle.previousLaneChangeElapsed = 0;
    vehicle.cooldown = COOLDOWN_STEPS;
    if (returning) {
      vehicle.returnLane = null;
      vehicle.passingTargetId = null;
      vehicle.passedTarget = false;
      state.eventText = `Vehicle ${vehicle.id + 1} has moved back into lane ${toLane + 1}.`;
      return;
    }
    vehicle.waitingForMerge = false;
    const target = state.vehicles.find((other) => other.id === targetId);
    vehicle.returnLane = fromLane;
    vehicle.passingTargetId = targetId;
    const targetName = target ? profiles[target.kind].label : 'slower traffic';
    state.eventText = closureMerge
      ? `${profiles[vehicle.kind].label} ${vehicle.id + 1} moved to lane ${toLane + 1} to merge ahead of the closure.`
      : `${profiles[vehicle.kind].label} ${vehicle.id + 1} moved to lane ${toLane + 1} to pass a ${targetName}.`;
  }

  function chooseArrivalKind() {
    let remaining = state.random();
    for (const [kind, share] of ARRIVAL_MIX) {
      remaining -= share;
      if (remaining <= 0) return kind;
    }
    return 'car';
  }

  function addArrival() {
    const kind = chooseArrivalKind();
    const lanes = state.random() < 0.5 ? [0, 1] : [1, 0];
    for (const lane of lanes) {
      const vehicle = createVehicle(state.nextId, kind, lane, 0, state.random);
      const { leader } = laneNeighbors(state.vehicles, lane, 0, vehicle.id);
      const availableGap = leader ? leader.position - leader.length / 2 : Infinity;
      if (availableGap < vehicle.length / 2 + vehicle.minimumGap) continue;
      vehicle.speed *= 0.65;
      state.vehicles.push(vehicle);
      state.nextId += 1;
      return true;
    }
    return false;
  }

  function scheduleArrival() {
    const meanInterval = 60 / Number(ui.arrivalRate.value);
    const variation = Number(ui.variation.value) / 100;
    const interval = meanInterval * (1 + (state.random() * 2 - 1) * variation);
    state.nextArrival = state.time + Math.max(0.5, interval);
  }

  function step() {
    const proposals = state.vehicles.map(proposalFor).filter(Boolean);
    proposals.sort((a, b) => b.gain - a.gain || a.vehicle.id - b.vehicle.id);
    for (const proposal of proposals) {
      const { vehicle, lane } = proposal;
      const { leader, follower } = laneNeighbors(
        state.vehicles, lane, vehicle.position, vehicle.id
      );
      if (!safeGaps(vehicle, leader, follower)) continue;
      const fromLane = vehicle.lane;
      vehicle.lane = lane;
      registerEvent(
        vehicle, fromLane, lane, proposal.returning, proposal.targetId, proposal.closureMerge
      );
    }

    const ordered = state.vehicles.slice().sort((a, b) => b.position - a.position);
    const nextPosition = new Map();
    for (const vehicle of ordered) {
      const lanes = occupiedLanes(vehicle);
      const leaders = lanes
        .map((lane) => laneNeighbors(
          state.vehicles, lane, vehicle.position, vehicle.id
        ).leader)
        .filter(Boolean);
      const leader = leaders.reduce(
        (nearest, other) => !nearest || other.position < nearest.position ? other : nearest,
        null
      );
      const acceleration = idm(vehicle, leader || null);
      const speed = Math.max(0, Math.min(vehicle.desiredSpeed, vehicle.speed + acceleration * STEP));
      vehicle.previousPosition = vehicle.position;
      let nextSpeed = speed;
      let position = vehicle.position + (vehicle.speed + nextSpeed) * 0.5 * STEP;
      if (leader) {
        const leaderPosition = leader.id < 0 ? leader.position : nextPosition.get(leader.id);
        const barrierGap = leader.id < 0 ? vehicle.minimumGap : 0;
        const maximum = Math.max(
          leader.id < 0 ? vehicle.position : -Infinity,
          leaderPosition - (vehicle.length + leader.length) / 2 - barrierGap
        );
        if (position > maximum) {
          // Reduce speed before clamping position so the next step stays consistent.
          if (leader.id >= 0) state.preventedContacts += 1;
          nextSpeed = Math.max(0, Math.min(
            speed,
            2 * (maximum - vehicle.position) / STEP - vehicle.speed
          ));
          position = vehicle.position + (vehicle.speed + nextSpeed) * 0.5 * STEP;
          if (position > maximum) position = maximum;
        }
      }
      nextPosition.set(vehicle.id, position);
      vehicle.acceleration = (nextSpeed - vehicle.speed) / STEP;
      vehicle.speed = nextSpeed;
      vehicle.position = position;
      vehicle.cooldown = Math.max(0, vehicle.cooldown - 1);
      if (vehicle.laneChangeFrom !== null) {
        vehicle.previousLaneChangeElapsed = vehicle.laneChangeElapsed;
        vehicle.laneChangeElapsed += STEP;
        if (vehicle.laneChangeElapsed >= LANE_CHANGE_DURATION) {
          vehicle.laneChangeFrom = null;
          vehicle.laneChangeElapsed = LANE_CHANGE_DURATION;
        }
      }
    }

    const byId = new Map(state.vehicles.map((vehicle) => [vehicle.id, vehicle]));
    for (const vehicle of state.vehicles) {
      if (vehicle.passingTargetId === null) continue;
      const target = byId.get(vehicle.passingTargetId);
      if (target && vehicle.position > target.position + (vehicle.length + target.length) / 2) {
        state.overtakes += 1;
        state.eventText = `${profiles[vehicle.kind].label} ${vehicle.id + 1} completed an overtake.`;
        vehicle.passingTargetId = null;
        vehicle.passedTarget = true;
      }
    }
    const remaining = [];
    for (const vehicle of state.vehicles) {
      if (vehicle.position - vehicle.length / 2 < ROAD_LENGTH) remaining.push(vehicle);
      else {
        state.exited += 1;
        state.endReached = true;
      }
    }
    state.vehicles = remaining;
    state.time = Math.round((state.time + STEP) * 1000) / 1000;
    if (state.endReached) {
      state.eventText = `Simulation stopped: a vehicle reached the ${ROAD_LENGTH} m road end.`;
    } else if (state.time >= state.nextArrival) {
      if (addArrival()) scheduleArrival();
      else state.nextArrival = state.time + 0.5;
    }
    if (Math.floor(state.time) > Math.floor(state.time - STEP)) {
      state.events.push(metricsSnapshot());
    }
  }

  function roundRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawVehicle(vehicle, x, y, scale, displayLength) {
    const spec = profiles[vehicle.kind];
    const length = displayLength;
    const height = vehicle.kind === 'motorcycle' ? 8 : vehicle.kind === 'bus' ? 16
      : vehicle.kind === 'truck' ? 14 : vehicle.kind === 'rickshaw' ? 13 : 12;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = spec.color;
    ctx.strokeStyle = '#26343a';
    ctx.lineWidth = Math.min(1.2, Math.max(0.8, scale * 0.5));
    if (vehicle.kind === 'motorcycle') {
      const wheelRadius = 1.5;
      ctx.fillStyle = '#26343a';
      ctx.beginPath(); ctx.arc(-length * .32, 1, wheelRadius, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(length * .32, 1, wheelRadius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = spec.color;
      ctx.beginPath();
      ctx.moveTo(-length * .34, 0); ctx.lineTo(-length * .08, -1.6);
      ctx.lineTo(length * .22, -1.35); ctx.lineTo(length * .35, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      const bodyLength = length;
      roundRect(-bodyLength / 2, -height / 2, bodyLength, height, vehicle.kind === 'bus' ? 2 : 3);
      ctx.fill(); ctx.stroke();
      if (vehicle.kind === 'bus') {
        ctx.fillStyle = '#e9f1ee';
        const windowStep = Math.max(1.5, 4 * scale);
        for (let windowX = -bodyLength / 2 + scale * 2; windowX < bodyLength / 2 - scale; windowX += windowStep) {
          ctx.fillRect(windowX, -height / 2 + 2, Math.max(1, scale * 2.6), 5);
        }
      } else if (vehicle.kind === 'truck') {
        ctx.fillStyle = '#e9f1ee';
        ctx.fillRect(bodyLength / 2 - Math.min(5 * scale, bodyLength * 0.45), -height / 2 + 3, Math.min(3.3 * scale, bodyLength * 0.3), 5);
        ctx.strokeStyle = '#58656a';
        ctx.beginPath(); ctx.moveTo(-bodyLength / 2 + 2, 0); ctx.lineTo(bodyLength / 2 - 6, 0); ctx.stroke();
      } else {
        ctx.fillStyle = '#e9f1ee';
        roundRect(-bodyLength * .14, -height / 2 + 2, bodyLength * .4, height * .42, Math.min(2, bodyLength * .1));
        ctx.fill();
      }
      ctx.fillStyle = '#26343a';
      const wheelRadius = 1.6;
      ctx.beginPath(); ctx.arc(-bodyLength * .28, height / 2 - 1, wheelRadius, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(bodyLength * .28, height / 2 - 1, wheelRadius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fff6d8';
    const lightSize = Math.min(1.5, scale * 0.8);
    ctx.fillRect(length / 2 - lightSize, -lightSize, lightSize, lightSize);
    ctx.restore();
  }

  function draw() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const width = Math.round(bounds.width * pixelRatio);
    const height = Math.round(bounds.height * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const w = bounds.width;
    const h = bounds.height;
    const left = 34;
    const right = w - 34;
    const roadWidth = right - left;
    const laneY = [h * .43, h * .72];
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#e9efeb';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#59646a';
    roundRect(left, h * .24, roadWidth, h * .62, 10);
    ctx.fill();
    ctx.fillStyle = '#626d72';
    roundRect(left + 5, h * .27, roadWidth - 10, h * .56, 7);
    ctx.fill();
    ctx.strokeStyle = '#dce3df';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.moveTo(left + 8, h * .55); ctx.lineTo(right - 8, h * .55); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d2dad6';
    ctx.fillRect(left + 5, h * .275, roadWidth - 10, 2);
    ctx.fillRect(left + 5, h * .815, roadWidth - 10, 2);
    ctx.fillStyle = '#e7ece9';
    ctx.font = '600 10px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('LANE 1', left + 6, h * .37);
    ctx.fillText('LANE 2', left + 6, h * .69);

    if (ui.scenario.value !== 'busy') {
      const barrierX = left + barrierPositionM / ROAD_LENGTH * roadWidth;
      const closedLanes = ui.scenario.value === 'closure'
        ? [0, 1]
        : [Number(ui.closedLane.value)];
      for (const lane of closedLanes) {
        const laneTop = lane === 0 ? h * .285 : h * .565;
        const laneBottom = lane === 0 ? h * .545 : h * .825;
        ctx.fillStyle = 'rgba(190, 110, 54, 0.16)';
        ctx.fillRect(barrierX, laneTop, right - barrierX, laneBottom - laneTop);
        ctx.fillStyle = '#e7bc83';
        ctx.fillRect(barrierX - 4, laneTop + 3, 8, laneBottom - laneTop - 6);
        ctx.strokeStyle = '#765331';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(barrierX - 3, laneTop + 4);
        ctx.lineTo(barrierX + 3, laneTop + 12);
        ctx.moveTo(barrierX - 3, laneTop + 17);
        ctx.lineTo(barrierX + 3, laneTop + 25);
        ctx.moveTo(barrierX - 3, laneTop + 30);
        ctx.lineTo(barrierX + 3, laneTop + 38);
        ctx.stroke();
        ctx.fillStyle = '#fff6e8';
        ctx.font = '700 9px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('CLOSED', Math.min(barrierX + 8, right - 46), laneTop + 15);
      }
      const handleY = h * .235;
      ctx.fillStyle = '#263f4c';
      roundRect(barrierX - 29, handleY - 10, 58, 20, 7);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 9px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${barrierPositionM} m  DRAG`, barrierX, handleY);
      ctx.textBaseline = 'alphabetic';
    }

    const interpolation = accumulator / STEP;
    const renderVehicles = state.vehicles.map((vehicle) => {
      const position = vehicle.previousPosition
        + (vehicle.position - vehicle.previousPosition) * interpolation;
      let lanePosition = vehicle.lane;
      if (vehicle.laneChangeFrom !== null) {
        const progress = Math.min(
          1,
          (vehicle.previousLaneChangeElapsed + interpolation * STEP) / LANE_CHANGE_DURATION
        );
        const easedProgress = progress * progress * (3 - 2 * progress);
        lanePosition = vehicle.laneChangeFrom + (vehicle.lane - vehicle.laneChangeFrom) * easedProgress;
      }
      return { vehicle, position, lanePosition, lanes: occupiedLanes(vehicle) };
    });
    const scale = roadWidth / ROAD_LENGTH;
    for (const rendered of renderVehicles) {
      const { vehicle, position, lanePosition, lanes } = rendered;
      const x = left + position * scale;
      const y = laneY[0] + lanePosition * (laneY[1] - laneY[0]);
      let nearestSeparation = Infinity;
      for (const other of renderVehicles) {
        if (other === rendered || !lanes.some((lane) => other.lanes.includes(lane))) continue;
        nearestSeparation = Math.min(nearestSeparation, Math.abs(other.position - position));
      }
      const physicalLength = vehicle.length * scale;
      const zoom = vehicle.kind === 'motorcycle' ? 3 : vehicle.kind === 'bus' ? 2.7 : 3.2;
      const preferredLength = Math.max(
        vehicle.kind === 'motorcycle' ? 12 : vehicle.kind === 'bus' ? 30 : 18,
        physicalLength * zoom
      );
      const spacingLimit = Number.isFinite(nearestSeparation)
        ? nearestSeparation * scale * 0.92
        : preferredLength;
      drawVehicle(vehicle, x, y, scale, Math.max(physicalLength, Math.min(preferredLength, spacingLimit)));
    }
    updateReadouts();
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
  }

  function updateReadouts() {
    const counts = { car: 0, motorcycle: 0, rickshaw: 0, bus: 0, truck: 0 };
    let speedTotal = 0;
    for (const vehicle of state.vehicles) {
      counts[vehicle.kind] += 1;
      speedTotal += vehicle.speed;
    }
    $('carsCount').textContent = counts.car;
    $('motorcyclesCount').textContent = counts.motorcycle;
    $('rickshawsCount').textContent = counts.rickshaw;
    $('busesCount').textContent = counts.bus;
    $('trucksCount').textContent = counts.truck;
    ui.vehicles.textContent = state.vehicles.length;
    ui.overtakes.textContent = state.overtakes;
    ui.laneChanges.textContent = state.laneChanges;
    $('microContacts').textContent = state.preventedContacts;
    const meanSpeed = state.vehicles.length ? speedTotal / state.vehicles.length * 3.6 : 0;
    const density = state.vehicles.length / (ROAD_LENGTH / 1000 * 2);
    const queueCount = state.vehicles.filter((vehicle) =>
      barrierBlocksLane(vehicle.lane)
        && vehicle.position + vehicle.length / 2 >= barrierPositionM - 60
        && vehicle.position + vehicle.length / 2 < barrierPositionM
        && vehicle.speed < 0.7
    ).length;
    ui.meanSpeed.innerHTML = `${meanSpeed.toFixed(1)} <small>km/h</small>`;
    $('microDensity').innerHTML = `${density.toFixed(1)} <small>veh/km/lane</small>`;
    $('microExited').textContent = state.exited;
    $('microQueue').textContent = queueCount;
    ui.time.textContent = formatTime(state.time);
    ui.event.textContent = state.eventText;
  }

  function getSettings() {
    return {
      roadLengthM: ROAD_LENGTH,
      lanes: 2,
      scenario: ui.scenario.value,
      closedLane: ui.scenario.value === 'partial' ? Number(ui.closedLane.value) + 1 : null,
      barrierPositionM: ui.scenario.value === 'busy' ? null : barrierPositionM,
      averageArrivalsPerMinute: Number(ui.arrivalRate.value),
      arrivalVariationPercent: Number(ui.variation.value),
      speedLimitKmh: Number(ui.speedLimit.value),
      durationSeconds: Number(ui.duration.value)
    };
  }

  function metricsSnapshot() {
    const counts = { car: 0, motorcycle: 0, rickshaw: 0, bus: 0, truck: 0 };
    let speedTotal = 0;
    let queue = 0;
    for (const vehicle of state.vehicles) {
      counts[vehicle.kind] += 1;
      speedTotal += vehicle.speed;
      if (barrierBlocksLane(vehicle.lane)
        && vehicle.position + vehicle.length / 2 >= barrierPositionM - 60
        && vehicle.position + vehicle.length / 2 < barrierPositionM
        && vehicle.speed < 0.7) queue += 1;
    }
    return {
      timeSeconds: state.time,
      barrierPositionM: ui.scenario.value === 'busy' ? null : barrierPositionM,
      vehiclesOnRoad: state.vehicles.length,
      vehicleCounts: counts,
      meanSpeedKmh: state.vehicles.length ? speedTotal / state.vehicles.length * 3.6 : 0,
      densityVehiclesPerKmPerLane: state.vehicles.length / (ROAD_LENGTH / 1000 * 2),
      queueAtBarrier: queue,
      exitedVehicles: state.exited,
      completedOvertakes: state.overtakes,
      laneChanges: state.laneChanges,
      contactsPrevented: state.preventedContacts
    };
  }

  function download(name, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportRows() {
    const rows = state.events.slice();
    if (!rows.length || rows[rows.length - 1].timeSeconds !== state.time) rows.push(metricsSnapshot());
    return rows;
  }

  function exportCsv() {
    if (!settingsAreValid()) return;
    const settings = getSettings();
    const columns = [
      'scenario', 'closed_lane', 'barrier_position_m', 'average_arrivals_per_minute',
      'arrival_variation_percent', 'speed_limit_kmh', 'duration_seconds',
      'time_seconds', 'barrier_position_at_sample_m', 'vehicles_on_road', 'cars', 'motorcycles', 'auto_rickshaws',
      'buses', 'trucks', 'mean_speed_kmh', 'density_vehicles_per_km_per_lane',
      'queue_at_barrier', 'exited_vehicles', 'completed_overtakes', 'lane_changes',
      'contacts_prevented'
    ];
    const rows = exportRows().map((row) => [
      settings.scenario, settings.closedLane ?? '', settings.barrierPositionM ?? '',
      settings.averageArrivalsPerMinute, settings.arrivalVariationPercent,
      settings.speedLimitKmh, settings.durationSeconds,
      row.timeSeconds, row.barrierPositionM ?? '', row.vehiclesOnRoad, row.vehicleCounts.car, row.vehicleCounts.motorcycle,
      row.vehicleCounts.rickshaw, row.vehicleCounts.bus, row.vehicleCounts.truck,
      row.meanSpeedKmh.toFixed(3), row.densityVehiclesPerKmPerLane.toFixed(3),
      row.queueAtBarrier, row.exitedVehicles, row.completedOvertakes, row.laneChanges,
      row.contactsPrevented
    ].join(','));
    download('flowline-vehicle-run.csv', [columns.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
  }

  function exportJson() {
    if (!settingsAreValid()) return;
    download('flowline-vehicle-run.json', JSON.stringify({
      model: 'individual-vehicle',
      settings: getSettings(),
      summary: metricsSnapshot(),
      samples: exportRows(),
      limitations: 'Illustrative, uncalibrated vehicle behavior; not for engineering or safety decisions.'
    }, null, 2), 'application/json');
  }

  function setRunning(value) {
    running = value;
    ui.status.textContent = running ? 'IN MOTION' : (
      state.endReached ? 'ROAD END' : (
        state.time >= Number(ui.duration.value) ? 'COMPLETE' : (state.time ? 'PAUSED' : 'READY')
      )
    );
    ui.status.classList.toggle('is-running', running);
    ui.playIcon.textContent = running ? 'Ⅱ' : '▶';
    ui.playText.textContent = running ? 'Pause' : (
      state.endReached || state.time >= Number(ui.duration.value)
        ? 'Run again' : (state.time ? 'Resume' : 'Play')
    );
  }

  function animate(now) {
    if (!running) return;
    if (previousTime) accumulator += Math.min(0.1, (now - previousTime) / 1000) * Number(ui.speed.value);
    previousTime = now;
    while (accumulator >= STEP && !state.endReached) {
      step();
      accumulator -= STEP;
    }
    if (state.endReached) accumulator = 0;
    draw();
    if (state.endReached || state.time >= Number(ui.duration.value)) {
      setRunning(false);
      return;
    }
    rafId = window.requestAnimationFrame(animate);
  }

  function start() {
    if (running) {
      setRunning(false);
      window.cancelAnimationFrame(rafId);
      previousTime = 0;
      return;
    }
    if (!settingsAreValid()) return;
    if ((state.endReached || state.time >= Number(ui.duration.value)) && !reset()) return;
    setRunning(true);
    previousTime = 0;
    rafId = window.requestAnimationFrame(animate);
  }

  function reset() {
    if (!settingsAreValid()) return false;
    if (rafId) window.cancelAnimationFrame(rafId);
    state = createState();
    accumulator = 0;
    previousTime = 0;
    setRunning(false);
    draw();
    return true;
  }

  function settingsAreValid() {
    if (ui.barrierPosition.disabled || ui.barrierPosition.checkValidity()) return true;
    ui.barrierPosition.reportValidity();
    return false;
  }

  function updateScenarioControls() {
    const active = ui.scenario.value !== 'busy';
    ui.laneSetting.hidden = ui.scenario.value !== 'partial';
    ui.barrierPosition.disabled = !active;
    ui.barrierPosition.setCustomValidity('');
    if (active && ui.barrierPosition.validity.valueMissing) {
      ui.barrierPosition.setCustomValidity('Enter a barrier distance from 50 to 450 metres.');
    } else if (active && ui.barrierPosition.validity.rangeUnderflow) {
      ui.barrierPosition.setCustomValidity('Enter a barrier distance of at least 50 metres.');
    } else if (active && ui.barrierPosition.validity.rangeOverflow) {
      ui.barrierPosition.setCustomValidity(`Enter a barrier distance no greater than ${ROAD_LENGTH - 50} metres.`);
    }
    ui.variationValue.textContent = `±${ui.variation.value}%`;
    if (ui.scenario.value === 'closure') {
      ui.scenarioHint.textContent = `Both lanes stop at ${barrierPositionM} m.`;
    } else if (ui.scenario.value === 'partial') {
      ui.scenarioHint.textContent = `Lane ${Number(ui.closedLane.value) + 1} closes at ${barrierPositionM} m.`;
    } else {
      ui.scenarioHint.textContent = 'No barrier; vehicles use both lanes.';
    }
  }

  function resize() {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    draw();
  }

  function barrierPointerPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    const left = 34;
    const roadWidth = bounds.width - 68;
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const markerX = left + barrierPositionM / ROAD_LENGTH * roadWidth;
    const withinRoad = y >= bounds.height * 0.2 && y <= bounds.height * 0.86;
    return {
      x,
      y,
      markerX,
      withinRoad,
      meters: Math.round(Math.max(50, Math.min(ROAD_LENGTH - 50, (x - left) / roadWidth * ROAD_LENGTH)))
    };
  }

  function updateBarrierFromPointer(event) {
    const point = barrierPointerPosition(event);
    barrierPositionM = point.meters;
    ui.barrierPosition.value = String(barrierPositionM);
    ui.barrierPosition.setCustomValidity('');
    updateScenarioControls();
    draw();
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (ui.scenario.value === 'busy') return;
    const point = barrierPointerPosition(event);
    if (!point.withinRoad || Math.abs(point.x - point.markerX) > 16) return;
    draggingBarrier = true;
    canvas.setPointerCapture(event.pointerId);
    canvas.closest('.micro-road-wrap').classList.add('is-barrier-dragging');
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    const point = barrierPointerPosition(event);
    if (draggingBarrier) {
      updateBarrierFromPointer(event);
      return;
    }
    canvas.closest('.micro-road-wrap').classList.toggle(
      'is-barrier-draggable',
      ui.scenario.value !== 'busy' && point.withinRoad && Math.abs(point.x - point.markerX) <= 16
    );
  });
  function stopBarrierDrag(event) {
    if (!draggingBarrier) return;
    draggingBarrier = false;
    canvas.closest('.micro-road-wrap').classList.remove('is-barrier-dragging');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', stopBarrierDrag);
  canvas.addEventListener('pointercancel', stopBarrierDrag);

  ui.play.addEventListener('click', start);
  ui.reset.addEventListener('click', reset);
  for (const control of [
    ui.scenario, ui.closedLane, ui.arrivalRate, ui.variation,
    ui.speedLimit, ui.duration
  ]) {
    control.addEventListener('change', () => {
      updateScenarioControls();
      reset();
    });
  }
  ui.barrierPosition.addEventListener('input', () => {
    ui.barrierPosition.setCustomValidity('');
    if (!ui.barrierPosition.checkValidity()) {
      updateScenarioControls();
      return;
    }
    barrierPositionM = Number(ui.barrierPosition.value);
    updateScenarioControls();
    draw();
  });
  ui.barrierPosition.addEventListener('change', () => {
    if (ui.barrierPosition.checkValidity()) return;
    ui.barrierPosition.value = String(barrierPositionM);
    updateScenarioControls();
  });
  ui.variation.addEventListener('input', () => {
    ui.variationValue.textContent = `±${ui.variation.value}%`;
  });
  ui.csv.addEventListener('click', exportCsv);
  ui.json.addEventListener('click', exportJson);
  window.addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  updateScenarioControls();
  reset();
})();
