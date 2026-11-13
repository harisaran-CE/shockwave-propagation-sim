(() => {
  'use strict';

  const APP_VERSION = '0.1.0';
  const ROAD_LENGTH = 500;
  const LANE_WIDTH_M = 4;
  const LATERAL_CLEARANCE_M = 0.15;
  const GEOMETRY_EPSILON_M = 1e-6;
  const SUBLANE_COUNT = 4;
  const SIM_CONFIG = Object.freeze({
    SIM_DT: 0.025,
    MAX_FRAME_DELTA: 0.1,
    MAX_STEPS_PER_FRAME: 10
  });
  const STEP = SIM_CONFIG.SIM_DT;
  const ENTRY_SPILLBACK_DURATION = 3;
  const LANE_CHANGE_DURATION = 2.4;
  const MIN_LANE_GAIN = 0.9;
  const MIN_PASSING_CLOSING_SPEED = 1.2;
  const PASSING_LOOKAHEAD = 8;
  const RETURN_LANE_DELAY = 2.5;
  const SAFE_FOLLOWER_DECELERATION = 3.0;
  const COOLDOWN_STEPS = 80;
  const CLOSURE_LOOKAHEAD = 8;
  const CLOSURE_MIN_LOOKAHEAD = 220;
  const SPEED_TARGET_OPTIONS_KMH = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
  const SPEED_TARGET_MAX_KMH = 120;
  const SPEED_TARGET_CONGESTION_MARGIN_KMH = 15;
  const SPEED_TARGET_SOFT_LIMIT_MARGIN_KMH = 15;
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
    selectionCount: $('microSelectionCount'),
    inspectorTitle: $('microInspectorTitle'),
    inspectorHelp: $('microInspectorHelp'),
    inspectorEmpty: $('microInspectorEmpty'),
    inspectorContent: $('microInspectorContent'),
    clearSelection: $('microClearSelection'),
    selectedType: $('microSelectedType'),
    selectedSpeed: $('microSelectedSpeed'),
    selectedLane: $('microSelectedLane'),
    selectedGap: $('microSelectedGap'),
    selectedLeader: $('microSelectedLeader'),
    selectedStatus: $('microSelectedStatus'),
    selectedSpeedCap: $('microSelectedSpeedCap'),
    applySpeedCap: $('microApplySpeedCap'),
    cancelSpeedCap: $('microCancelSpeedCap'),
    speedAvailability: $('microSpeedAvailability'),
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
    seed: $('microSeed'),
    timeline: $('microTimeline'),
    timelineTime: $('microTimelineTime'),
    timelineMarkers: $('microTimelineMarkers'),
    themeToggle: $('microThemeToggle'),
    crashReport: $('microCrashReport'),
    crashCount: $('microCrashCount'),
    crashSummary: $('microCrashSummary'),
    crashVehicles: $('microCrashVehicles'),
    crashExport: $('microCrashExport'),
    editorToggle: $('microEditorToggle'),
    editorBody: $('microEditorBody'),
    scenarioSave: $('microScenarioSave'),
    scenarioLoad: $('microScenarioLoad'),
    riskSpeedWeight: $('microRiskSpeedWeight'),
    riskDensityWeight: $('microRiskDensityWeight'),
    riskConflictWeight: $('microRiskConflictWeight'),
    riskCrashWeight: $('microRiskCrashWeight'),
    riskIndex: $('microRiskIndex'),
    riskBand: $('microRiskBand'),
    csv: $('microCsv'),
    json: $('microJson')
  };
  const errorBanner = $('microErrorBanner');
  const appModel = {
    mode: 'simulation',
    settings: null,
    risk: { speed: 0.35, density: 0.25, conflict: 0.25, crash: 0.15 }
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
  let viewFrameIndex = null;
  let replayingHistory = false;
  let replayAccumulator = 0;
  const selectedVehicleIds = new Set();
  let speedEditActive = false;
  let selectionDrag = null;
  let droppedTimeSeconds = 0;
  let runningSlow = false;

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
    const length = sample(random, profile.length);
    const width = sample(random, profile.width);
    const provisional = { lane, width };
    const lateralTracks = lateralTrackPositions(provisional, lane);
    const lateralPositionM = lateralTracks[Math.floor(random() * lateralTracks.length)];
    const desiredSpeed = Math.min(sample(random, profile.desired), Number(ui.speedLimit.value) / 3.6);
    return {
      id, kind, lane, position, speed: desiredSpeed * (0.66 + random() * 0.25),
      length, width,
      desiredSpeed, accelerationLimit: sample(random, profile.acceleration),
      deceleration: sample(random, profile.deceleration), minimumGap: sample(random, profile.gap),
      headway: sample(random, profile.headway), reaction: sample(random, profile.reaction),
      cooldown: 0, returnLane: null, passingTargetId: null, passedTarget: false,
      passedTargetTime: null,
      waitingForMerge: false,
      lateralChangeDuration: LANE_CHANGE_DURATION,
      returnLateralPositionM: null,
      laneChangeFrom: null, laneChangeElapsed: 0, previousLaneChangeElapsed: 0,
      lateralPositionM, previousLateralPositionM: lateralPositionM, lateralSpeedMps: 0,
      lateralChangeFromM: null, lateralChangeTargetM: null,
      lateralChangeElapsed: 0, previousLateralChangeElapsed: 0,
      previousPosition: position, acceleration: 0, requestedSpeedKmh: null
    };
  }

  function requestedSpeed(vehicle) {
    return vehicle.requestedSpeedKmh === null
      ? vehicle.desiredSpeed : vehicle.requestedSpeedKmh / 3.6;
  }

  function vehicleLeader(vehicle, vehicles = state.vehicles) {
    return laneNeighbors(vehicles, vehicle.lane, vehicle.position, vehicle.id).leader;
  }

  function safeSpeedFor(vehicle) {
    const leader = vehicleLeader(vehicle);
    const unconstrainedCeiling = SPEED_TARGET_MAX_KMH;
    if (!leader) return unconstrainedCeiling;
    const gap = Math.max(0, leader.position - leader.length / 2
      - vehicle.position - vehicle.length / 2);
    if (leader.kind === 'barrier') {
      const available = Math.max(0, gap - vehicle.minimumGap);
      const responseTime = vehicle.headway + vehicle.reaction;
      const discriminant = responseTime ** 2 + 2 * available / vehicle.deceleration;
      return Math.max(0, Math.min(unconstrainedCeiling,
        (-responseTime + Math.sqrt(discriminant)) * vehicle.deceleration * 3.6
          + SPEED_TARGET_CONGESTION_MARGIN_KMH));
    }
    return Math.max(0, Math.min(unconstrainedCeiling,
      (leader.speed + Math.max(0, gap - vehicle.minimumGap)
        / Math.max(0.5, vehicle.headway)) * 3.6 + SPEED_TARGET_CONGESTION_MARGIN_KMH));
  }

  function speedOptionsForSelection() {
    const selected = state.vehicles.filter((vehicle) => selectedVehicleIds.has(vehicle.id));
    return SPEED_TARGET_OPTIONS_KMH.map((speed) => ({
      speed,
      available: selected.length > 0 && selected.every((vehicle) =>
        speed <= safeSpeedFor(vehicle) + 0.1
          && speed <= vehicle.desiredSpeed * 3.6 + SPEED_TARGET_SOFT_LIMIT_MARGIN_KMH
      )
    }));
  }

  function createState() {
    const seed = Number(ui.seed.value);
    const random = seededRandom(seed);
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
      time: 0, seed, vehicles, overtakes: 0, laneChanges: 0, preventedContacts: 0,
      stepCount: 0,
      exited: 0, endReached: false, entryBlockedSince: null,
      nextId: initialFleet.length, random,
      nextArrival: 0,
      events: [],
      frames: [],
      eventLog: [],
      crashes: [],
      crashPairs: new Set(),
      nextCrashId: 1,
      settings: null,
      eventText: 'Ready. Change the settings or press Play to begin.'
    };
  }

  function observePotentialCollision(vehicle, leader, position, leaderPosition) {
    if (!leader || leader.id < 0) return;
    const pair = [vehicle.id, leader.id].sort((a, b) => a - b);
    const pairKey = pair.join(':');
    if (state.crashPairs.has(pairKey)) return;
    const overlapLength = vehicle.position + vehicle.length / 2
      - (leaderPosition - leader.length / 2);
    const overlapWidth = (vehicle.width + leader.width) / 2
      - Math.abs(vehicle.lateralPositionM - leader.lateralPositionM);
    if (overlapLength <= 0 || overlapWidth <= 0) return;
    const record = {
      eventType: 'collision',
      crashId: state.nextCrashId++,
      timeSeconds: state.time,
      impactPositionM: Number(((position + leaderPosition) / 2).toFixed(3)),
      signalState: null,
      cause: leader.kind === 'barrier' ? 'barrier-overlap' : 'following-distance-overlap',
      severity: 'simulated-observation',
      relativeSpeedKmh: Number((Math.abs(vehicle.speed - leader.speed) * 3.6).toFixed(3)),
      riskIndex: null,
      recordedAtStep: state.stepCount,
      geometry: {
        roadLengthM: ROAD_LENGTH,
        laneWidthM: LANE_WIDTH_M,
        overlapLengthM: Number(overlapLength.toFixed(3)),
        overlapWidthM: Number(overlapWidth.toFixed(3))
      },
      vehicles: [vehicle, leader].map((item) => ({
        vehicleId: item.id,
        type: profiles[item.kind].label,
        speedKmh: Number((item.speed * 3.6).toFixed(3)),
        lane: item.lane + 1,
        positionM: Number((item.id === vehicle.id ? position : leaderPosition).toFixed(3)),
        lengthM: Number(item.length.toFixed(3)),
        widthM: Number(item.width.toFixed(3)),
        lateralPositionM: Number(item.lateralPositionM.toFixed(3)),
        accelerationMps2: Number(item.acceleration.toFixed(3))
      }))
    };
    record.riskIndex = riskSnapshot({
      meanSpeedKmh: ((vehicle.speed + leader.speed) / 2) * 3.6,
      densityVehiclesPerKmPerLane: state.vehicles.length / (ROAD_LENGTH / 1000 * 2),
      contactsPrevented: state.preventedContacts
    });
    state.crashPairs.add(pairKey);
    state.crashes.push(record);
    state.eventLog.push(record);
    state.eventText = `Collision observed between vehicle ${pair[0] + 1} and vehicle ${pair[1] + 1}.`;
    renderCrashReport(record);
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

  function occupiedLanes(vehicle, lateralPositionM = vehicle.lateralPositionM) {
    const halfWidth = vehicle.width / 2;
    const firstLane = Math.max(0, Math.floor(
      (lateralPositionM - halfWidth + LANE_WIDTH_M / 2) / LANE_WIDTH_M
    ));
    const lastLane = Math.min(1, Math.floor(
      (lateralPositionM + halfWidth + LANE_WIDTH_M / 2 - 1e-6) / LANE_WIDTH_M
    ));
    return Array.from({ length: Math.max(1, lastLane - firstLane + 1) },
      (_, index) => firstLane + index);
  }

  function laneNeighbors(
    vehicles, lane, position, exceptId, lateralPositionM = null, subjectWidth = null,
    ignoredId = null
  ) {
    let leader = null;
    let follower = null;
    const subject = vehicles.find((vehicle) => vehicle.id === exceptId);
    const subjectLateral = lateralPositionM
      ?? subject?.lateralPositionM
      ?? lane * LANE_WIDTH_M;
    const width = subjectWidth ?? subject?.width ?? profiles.car.width[0];
    for (const other of vehicles) {
      if (other.id === exceptId || other.id === ignoredId) continue;
      const lateralGap = Math.abs(other.lateralPositionM - subjectLateral)
        - (other.width + width) / 2;
      if (lateralGap >= LATERAL_CLEARANCE_M - GEOMETRY_EPSILON_M) continue;
      const isAhead = other.position > position
        || (other.position === position && other.id < exceptId);
      if (isAhead && (!leader || other.position < leader.position)) leader = other;
      if (!isAhead && (!follower || other.position > follower.position)) follower = other;
    }
    const barrier = barrierLeader(lane, position);
    if (barrier && (!leader || barrier.position < leader.position)) leader = barrier;
    return { leader, follower };
  }

  function lateralBounds(vehicle, lane = vehicle.lane) {
    const laneCenter = lane * LANE_WIDTH_M;
    const edgeClearance = LATERAL_CLEARANCE_M / 2;
    return {
      min: laneCenter - LANE_WIDTH_M / 2 + vehicle.width / 2 + edgeClearance,
      max: laneCenter + LANE_WIDTH_M / 2 - vehicle.width / 2 - edgeClearance
    };
  }

  function lateralTrackPositions(vehicle, lane = vehicle.lane) {
    const { min, max } = lateralBounds(vehicle, lane);
    const laneCenter = lane * LANE_WIDTH_M;
    return Array.from({ length: SUBLANE_COUNT }, (_, index) => {
      const offset = ((index + 0.5) / SUBLANE_COUNT - 0.5) * LANE_WIDTH_M;
      return Math.max(min, Math.min(max, laneCenter + offset));
    }).filter((position, index, positions) =>
      positions.findIndex((other) => Math.abs(other - position) < 0.05) === index
    );
  }

  function lateralPathIsClear(
    vehicle, targetLane, targetLateralPositionM, duration = LANE_CHANGE_DURATION,
    passingTargetId = null
  ) {
    const startLateralPositionM = vehicle.lateralPositionM;
    const sampleCount = 12;
    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
      const progress = sampleIndex / sampleCount;
      const elapsed = progress * duration;
      const eased = progress * progress * (3 - 2 * progress);
      const lateralPosition = startLateralPositionM
        + (targetLateralPositionM - startLateralPositionM) * eased;
      if (lateralPosition - vehicle.width / 2 < -LANE_WIDTH_M / 2
        || lateralPosition + vehicle.width / 2 > 1.5 * LANE_WIDTH_M) return false;
      const longitudinalPosition = vehicle.position + vehicle.speed * elapsed;
      for (const other of state.vehicles) {
        if (other.id === vehicle.id) continue;
        const otherLongitudinalPosition = other.position + other.speed * elapsed;
        let otherLateralPositionM = other.lateralPositionM;
        if (other.lateralChangeFromM !== null) {
          const otherProgress = Math.min(
            1, (other.lateralChangeElapsed + elapsed) / other.lateralChangeDuration
          );
          const otherEasedProgress = otherProgress * otherProgress * (3 - 2 * otherProgress);
          otherLateralPositionM = other.lateralChangeFromM
            + (other.lateralChangeTargetM - other.lateralChangeFromM) * otherEasedProgress;
        }
        const lateralGap = Math.abs(otherLateralPositionM - lateralPosition)
          - (other.width + vehicle.width) / 2;
        const longitudinalGap = Math.abs(otherLongitudinalPosition - longitudinalPosition)
          - (other.length + vehicle.length) / 2;
        if (lateralGap < LATERAL_CLEARANCE_M
          && longitudinalGap < LATERAL_CLEARANCE_M) return false;
      }
      if (occupiedLanes({ width: vehicle.width, lane: targetLane }, lateralPosition)
        .some((lane) => barrierBlocksLane(lane)
          && longitudinalPosition + vehicle.length / 2 >= barrierPositionM)) {
        return false;
      }
    }
    return true;
  }

  function idm(vehicle, leader) {
    const speed = Math.max(0, vehicle.speed);
    const desiredSpeed = Math.max(0.1, requestedSpeed(vehicle));
    const freeRoad = 1 - (speed / desiredSpeed) ** 4;
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

  function safeGaps(
    vehicle, leader, follower, maxFollowerDeceleration = SAFE_FOLLOWER_DECELERATION,
    ignoredLeaderId = null
  ) {
    if (leader && leader.id === ignoredLeaderId) leader = null;
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
      if (idm(follower, vehicle) < -maxFollowerDeceleration) return false;
    }
    return true;
  }

  function proposalFor(vehicle) {
    if (vehicle.cooldown > 0 || vehicle.lateralChangeFromM !== null) return null;
    if (vehicle.returnLane !== null) {
      if (!vehicle.passedTarget || state.time - vehicle.passedTargetTime < RETURN_LANE_DELAY
        || !laneOpenFor(vehicle, vehicle.returnLane)) return null;
      const returnLateralPositionM = vehicle.returnLateralPositionM;
      const { leader, follower } = laneNeighbors(
        state.vehicles, vehicle.returnLane, vehicle.position, vehicle.id,
        returnLateralPositionM
      );
      const { leader: currentLeader } = laneNeighbors(
        state.vehicles, vehicle.lane, vehicle.position, vehicle.id
      );
      if (lateralPathIsClear(vehicle, vehicle.returnLane, returnLateralPositionM)
        && safeGaps(vehicle, leader, follower)
        && idm(vehicle, leader) >= idm(vehicle, currentLeader) - 0.25) {
        return {
          vehicle, lane: vehicle.returnLane, lateralPositionM: returnLateralPositionM,
          gain: 0, returning: true
        };
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
      CLOSURE_MIN_LOOKAHEAD,
      vehicle.speed * (vehicle.headway + vehicle.reaction + LANE_CHANGE_DURATION + CLOSURE_LOOKAHEAD)
        + vehicle.speed ** 2 / (2 * vehicle.deceleration)
    );
    const hasOpenMergeLane = [vehicle.lane - 1, vehicle.lane + 1]
      .some((lane) => lane >= 0 && lane <= 1 && !barrierBlocksLane(lane));
    const needsClosureMerge = hasOpenMergeLane
      && barrierAhead && barrierDistance <= closureDecisionDistance;
    const queuedAtFullClosure = ui.scenario.value === 'closure'
      && barrierAhead && barrierDistance <= closureDecisionDistance;
    if (!currentLeader) {
      vehicle.waitingForMerge = false;
      return null;
    }
    const currentGap = currentLeader.position - currentLeader.length / 2
      - vehicle.position - vehicle.length / 2;
    const closingSpeed = vehicle.speed - currentLeader.speed;
    const passTarget = currentLeader;
    const passGap = passTarget.position - passTarget.length / 2
      - vehicle.position - vehicle.length / 2;
    const needsPass = !queuedAtFullClosure && currentLeader.kind !== 'barrier'
      && closingSpeed >= MIN_PASSING_CLOSING_SPEED
      && currentGap
        <= Math.max(25,
        closingSpeed * PASSING_LOOKAHEAD);
    if (!needsClosureMerge && !needsPass) {
      vehicle.waitingForMerge = false;
      return null;
    }
    const currentAcceleration = idm(vehicle, currentLeader);
    let best = null;
    if (needsPass && !needsClosureMerge) {
      for (const lateralPositionM of lateralTrackPositions(vehicle, vehicle.lane)) {
        if (Math.abs(lateralPositionM - vehicle.lateralPositionM) < 0.35
          || !lateralPathIsClear(vehicle, vehicle.lane, lateralPositionM,
            LANE_CHANGE_DURATION, passTarget.id)) continue;
        const { leader, follower } = laneNeighbors(
          state.vehicles, vehicle.lane, vehicle.position, vehicle.id, lateralPositionM,
          null, passTarget.id
        );
        if (!lateralPathIsClear(vehicle, vehicle.lane, lateralPositionM,
          LANE_CHANGE_DURATION, passTarget.id)
          || !safeGaps(vehicle, leader, follower, SAFE_FOLLOWER_DECELERATION, passTarget.id)) {
          continue;
        }
        const gain = idm(vehicle, leader) - currentAcceleration;
        const score = gain - Math.abs(lateralPositionM - vehicle.lateralPositionM) * 0.05;
        if (gain >= MIN_LANE_GAIN
          && (!best || score > best.score)) {
          best = {
            vehicle, lane: vehicle.lane, lateralPositionM, gain, score, returning: false,
            targetId: passTarget.id, closureMerge: false
          };
        }
      }
    }
    for (const lane of [vehicle.lane - 1, vehicle.lane + 1]) {
      if (lane < 0 || lane > 1 || !laneOpenFor(vehicle, lane)) continue;
      const laneClosesAhead = barrierBlocksLane(lane)
        && barrierPositionM > vehicle.position + vehicle.length / 2
        && barrierPositionM - vehicle.position - vehicle.length / 2
          <= closureDecisionDistance;
      if (laneClosesAhead) continue;
      for (const lateralPositionM of lateralTrackPositions(vehicle, lane)) {
        const { leader, follower } = laneNeighbors(
          state.vehicles, lane, vehicle.position, vehicle.id, lateralPositionM,
          null, passTarget.id
        );
        if (!lateralPathIsClear(vehicle, lane, lateralPositionM,
          LANE_CHANGE_DURATION, passTarget.id)
          || !safeGaps(
            vehicle, leader, follower,
            needsClosureMerge ? 0.5 : SAFE_FOLLOWER_DECELERATION,
            passTarget.id
          )) continue;
        const gain = idm(vehicle, leader) - currentAcceleration;
        const closureGain = needsClosureMerge
          ? 1 + Math.max(0, (closureDecisionDistance - barrierDistance) / 20) : 0;
        const decisionGain = needsClosureMerge ? closureGain : gain;
        const score = decisionGain
          - Math.abs(lateralPositionM - vehicle.lateralPositionM) * 0.05;
        if ((needsClosureMerge || gain >= MIN_LANE_GAIN)
          && (!best || score > best.score)) {
          best = {
            vehicle, lane, lateralPositionM,
            gain: decisionGain, score, returning: false,
            targetId: passTarget.id, closureMerge: needsClosureMerge
          };
        }
      }
    }
    if (needsClosureMerge && !best && !vehicle.waitingForMerge) {
      state.eventText = `${profiles[vehicle.kind].label} ${vehicle.id + 1} is waiting for a safe gap before the closure.`;
    }
    vehicle.waitingForMerge = needsClosureMerge && !best;
    return best;
  }

  function registerEvent(
    vehicle, fromLane, toLane, targetLateralPositionM, returning, targetId, closureMerge
  ) {
    state.laneChanges += 1;
    const fromLateralPositionM = vehicle.lateralPositionM;
    const target = state.vehicles.find((other) => other.id === targetId);
    vehicle.laneChangeFrom = fromLane === toLane ? null : fromLane;
    vehicle.laneChangeElapsed = 0;
    vehicle.previousLaneChangeElapsed = 0;
    vehicle.lateralChangeFromM = fromLateralPositionM;
    vehicle.lateralChangeTargetM = targetLateralPositionM;
    vehicle.lateralChangeElapsed = 0;
    vehicle.previousLateralChangeElapsed = 0;
    vehicle.lateralChangeDuration = LANE_CHANGE_DURATION;
    vehicle.cooldown = COOLDOWN_STEPS;
    if (returning) {
      vehicle.returnLane = null;
      vehicle.returnLateralPositionM = null;
      vehicle.passingTargetId = null;
      vehicle.passedTarget = false;
      vehicle.passedTargetTime = null;
      state.eventText = `Vehicle ${vehicle.id + 1} has moved back into lane ${toLane + 1}.`;
      return;
    }
    vehicle.waitingForMerge = false;
    vehicle.returnLane = fromLane;
    vehicle.returnLateralPositionM = fromLateralPositionM;
    vehicle.passingTargetId = targetId;
    const targetName = target
      ? `${profiles[target.kind].label} ${target.id + 1}`
      : 'slower traffic';
    state.eventText = closureMerge
      ? `${profiles[vehicle.kind].label} ${vehicle.id + 1} moved to lane ${toLane + 1} to merge ahead of the closure.`
      : toLane === fromLane
        ? `${profiles[vehicle.kind].label} ${vehicle.id + 1} is moving aside to pass ${targetName}.`
        : `${profiles[vehicle.kind].label} ${vehicle.id + 1} moved to lane ${toLane + 1} to pass ${targetName}.`;
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
      const { leader } = laneNeighbors(
        state.vehicles, lane, 0, vehicle.id, vehicle.lateralPositionM, vehicle.width
      );
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
      const { vehicle, lane, lateralPositionM } = proposal;
      const { leader, follower } = laneNeighbors(
        state.vehicles, lane, vehicle.position, vehicle.id, lateralPositionM,
        null, proposal.targetId
      );
      if (!lateralPathIsClear(vehicle, lane, lateralPositionM, LANE_CHANGE_DURATION,
        proposal.targetId)
        || !safeGaps(vehicle, leader, follower, SAFE_FOLLOWER_DECELERATION,
          proposal.targetId)) continue;
      const fromLane = vehicle.lane;
      vehicle.lane = lane;
      registerEvent(
        vehicle, fromLane, lane, lateralPositionM,
        proposal.returning, proposal.targetId, proposal.closureMerge
      );
    }

    const ordered = state.vehicles.map((vehicle) => ({ ...vehicle }))
      .sort((a, b) => b.position - a.position || a.id - b.id);
    const nextPosition = new Map();
    const nextSpeeds = new Map();
    const nextAccelerations = new Map();
    const nextLateralStates = new Map();
    for (const vehicle of ordered) {
      const { leader: detectedLeader } = laneNeighbors(
        state.vehicles, vehicle.lane, vehicle.position, vehicle.id
      );
      const passingTarget = vehicle.passingTargetId === null
        ? null
        : state.vehicles.find((other) => other.id === vehicle.passingTargetId);
      const passingTargetIsLaterallyClear = passingTarget
        && Math.abs(vehicle.lateralPositionM - passingTarget.lateralPositionM)
          - (vehicle.width + passingTarget.width) / 2 >= LATERAL_CLEARANCE_M;
      const passingTargetIdToIgnore = passingTargetIsLaterallyClear
        ? passingTarget.id
        : null;
      const { leader: effectiveLeader } = laneNeighbors(
        state.vehicles, vehicle.lane, vehicle.position, vehicle.id,
        vehicle.lateralPositionM, null, passingTargetIdToIgnore
      );
      const leader = detectedLeader
        && passingTarget === detectedLeader
        && passingTargetIsLaterallyClear
        ? effectiveLeader
        : detectedLeader;
      const acceleration = idm(vehicle, leader || null);
      const speed = Math.max(0, Math.min(requestedSpeed(vehicle), vehicle.speed + acceleration * STEP));
      let nextSpeed = speed;
      let position = vehicle.position + (vehicle.speed + nextSpeed) * 0.5 * STEP;
      if (leader) {
        const leaderPosition = leader.id < 0 ? leader.position : nextPosition.get(leader.id);
        const physicalMaximum = leaderPosition
          - (vehicle.length + leader.length) / 2
          - (leader.id < 0 ? vehicle.minimumGap : 0);
        const maximum = Math.max(
          vehicle.position,
          physicalMaximum - (leader.id >= 0 ? vehicle.minimumGap : 0)
        );
        if (position > maximum) {
          // Reduce speed before clamping position so the next step stays consistent.
          if (leader.id >= 0 && position > physicalMaximum) {
            state.preventedContacts += 1;
            observePotentialCollision(vehicle, leader, position, leaderPosition);
          }
          nextSpeed = Math.max(0, Math.min(
            speed,
            2 * (maximum - vehicle.position) / STEP - vehicle.speed
          ));
          position = vehicle.position + (vehicle.speed + nextSpeed) * 0.5 * STEP;
          if (position > maximum) position = maximum;
        }
      }
      nextPosition.set(vehicle.id, position);
      nextSpeeds.set(vehicle.id, nextSpeed);
      nextAccelerations.set(vehicle.id, (nextSpeed - vehicle.speed) / STEP);
      let lateralPositionM = vehicle.lateralPositionM;
      let lateralChangeElapsed = vehicle.lateralChangeElapsed;
      let lateralChangeFromM = vehicle.lateralChangeFromM;
      let lateralChangeTargetM = vehicle.lateralChangeTargetM;
      if (lateralChangeFromM !== null) {
        const changeDuration = vehicle.lateralChangeDuration;
        const proposedElapsed = Math.min(changeDuration, lateralChangeElapsed + STEP);
        const progress = proposedElapsed / changeDuration;
        const easedProgress = progress * progress * (3 - 2 * progress);
        const proposedLateralPositionM = lateralChangeFromM
          + (lateralChangeTargetM - lateralChangeFromM) * easedProgress;
        if (lateralPathIsClear(
          vehicle, vehicle.lane, proposedLateralPositionM, STEP, vehicle.passingTargetId
        )) {
          lateralPositionM = proposedLateralPositionM;
          lateralChangeElapsed = proposedElapsed;
        }
        if (lateralChangeElapsed >= changeDuration) {
          lateralPositionM = lateralChangeTargetM;
          lateralChangeFromM = null;
          lateralChangeTargetM = null;
        }
      }
      nextLateralStates.set(vehicle.id, {
        lateralPositionM, lateralChangeElapsed, lateralChangeFromM, lateralChangeTargetM
      });
    }
    for (const vehicle of state.vehicles) {
      vehicle.previousPosition = vehicle.position;
      vehicle.position = nextPosition.get(vehicle.id);
      vehicle.speed = nextSpeeds.get(vehicle.id);
      vehicle.acceleration = nextAccelerations.get(vehicle.id);
      vehicle.cooldown = Math.max(0, vehicle.cooldown - 1);
      vehicle.previousLateralPositionM = vehicle.lateralPositionM;
      const lateralState = nextLateralStates.get(vehicle.id);
      if (vehicle.lateralChangeFromM !== null) {
        vehicle.previousLateralChangeElapsed = vehicle.lateralChangeElapsed;
        vehicle.lateralPositionM = lateralState.lateralPositionM;
        vehicle.lateralChangeElapsed = lateralState.lateralChangeElapsed;
        vehicle.lateralChangeFromM = lateralState.lateralChangeFromM;
        vehicle.lateralChangeTargetM = lateralState.lateralChangeTargetM;
      }
      vehicle.lateralSpeedMps = (vehicle.lateralPositionM - vehicle.previousLateralPositionM) / STEP;
      if (vehicle.laneChangeFrom !== null) {
        vehicle.previousLaneChangeElapsed = vehicle.laneChangeElapsed;
        vehicle.laneChangeElapsed = vehicle.lateralChangeElapsed;
        if (vehicle.lateralChangeFromM === null) {
          vehicle.laneChangeFrom = null;
          vehicle.laneChangeElapsed = vehicle.lateralChangeDuration;
        }
      }
    }

    const byId = new Map(state.vehicles.map((vehicle) => [vehicle.id, vehicle]));
    for (const vehicle of state.vehicles) {
      if (vehicle.passingTargetId === null) continue;
      const target = byId.get(vehicle.passingTargetId);
      const lateralGap = target
        ? Math.abs(vehicle.lateralPositionM - target.lateralPositionM)
          - (vehicle.width + target.width) / 2
        : -Infinity;
      if (target
        && lateralGap >= LATERAL_CLEARANCE_M
        && vehicle.position > target.position + (vehicle.length + target.length) / 2) {
        state.overtakes += 1;
        state.eventText = `${profiles[vehicle.kind].label} ${vehicle.id + 1} passed vehicle ${target.id + 1}.`;
        vehicle.passingTargetId = null;
        vehicle.passedTarget = true;
        vehicle.passedTargetTime = state.time;
      }
    }
    const remaining = [];
    for (const vehicle of state.vehicles) {
      if (vehicle.position - vehicle.length / 2 < ROAD_LENGTH) remaining.push(vehicle);
      else state.exited += 1;
    }
    state.vehicles = remaining;
    state.time = Math.round((state.time + STEP) * 1000) / 1000;
    state.stepCount += 1;
    if (state.time >= state.nextArrival) {
      if (addArrival()) {
        state.entryBlockedSince = null;
        scheduleArrival();
      } else {
        if (state.entryBlockedSince === null) state.entryBlockedSince = state.time;
        if (state.time - state.entryBlockedSince >= ENTRY_SPILLBACK_DURATION) {
          state.endReached = true;
          state.eventText = 'Simulation stopped: congestion backed up to the upstream entrance (0 m).';
        } else {
          state.nextArrival = state.time + 0.5;
        }
      }
    }
    if (Math.floor(state.time) > Math.floor(state.time - STEP)) {
      recordFrame();
    }
  }

  function recordFrame(force = false) {
    const sample = metricsSnapshot();
    const previousFrame = state.frames[state.frames.length - 1];
    if (!force && previousFrame && previousFrame.timeSeconds === state.time) return;
    state.events.push(sample);
    state.frames.push({
      ...sample,
      overtakes: state.overtakes,
      preventedContacts: state.preventedContacts,
      exited: state.exited,
      vehicles: state.vehicles.map((vehicle) => ({ ...vehicle })),
      eventText: state.eventText,
      eventLog: state.eventLog.slice(-20),
      crashes: state.crashes.slice(),
      settings: getSettings()
    });
    ui.timeline.max = String(state.frames.length - 1);
    if (viewFrameIndex === null) ui.timeline.value = String(state.frames.length - 1);
    updateTimelineReadout();
    updateTimelineMarkers();
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
    const height = Math.max(4, Math.min(
      vehicle.kind === 'bus' ? 17 : vehicle.kind === 'truck' ? 15 : 13,
      length * (vehicle.kind === 'motorcycle' ? 0.8 : vehicle.kind === 'bus' ? 0.62
        : vehicle.kind === 'truck' ? 0.7 : 0.78)
    ));
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = spec.color;
    ctx.strokeStyle = '#26343a';
    ctx.lineWidth = Math.min(1.2, Math.max(0.8, scale * 0.5));
    if (vehicle.kind === 'motorcycle') {
      const wheelRadius = Math.min(1.5, height * 0.35);
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
          ctx.fillRect(windowX, -height / 2 + 1, Math.max(1, scale * 2.6), height * 0.45);
        }
      } else if (vehicle.kind === 'truck') {
        ctx.fillStyle = '#e9f1ee';
        ctx.fillRect(bodyLength / 2 - Math.min(5 * scale, bodyLength * 0.45),
          -height / 2 + 1, Math.min(3.3 * scale, bodyLength * 0.3), height * 0.55);
        ctx.strokeStyle = '#58656a';
        ctx.beginPath(); ctx.moveTo(-bodyLength / 2 + 2, 0); ctx.lineTo(bodyLength / 2 - 6, 0); ctx.stroke();
      } else {
        ctx.fillStyle = '#e9f1ee';
        roundRect(-bodyLength * .14, -height / 2 + 1, bodyLength * .4,
          height * 0.4, Math.min(2, bodyLength * .1));
        ctx.fill();
      }
      ctx.fillStyle = '#26343a';
      const wheelRadius = Math.min(1.6, height * 0.22);
      ctx.beginPath(); ctx.arc(-bodyLength * .28, height / 2 - wheelRadius * 0.4, wheelRadius, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(bodyLength * .28, height / 2 - wheelRadius * 0.4, wheelRadius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fff6d8';
    const lightSize = Math.min(1.5, scale * 0.8);
    ctx.fillRect(length / 2 - lightSize, -lightSize, lightSize, lightSize);
    ctx.restore();
  }

  function displayVehicleLength(vehicle, scale) {
    return Math.max(
      vehicle.kind === 'motorcycle' ? 9 : 12,
      vehicle.length * scale * 1.8
    );
  }

  function roadMetrics() {
    const bounds = canvas.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      left: 34,
      right: bounds.width - 34,
      laneY: [bounds.height * .415, bounds.height * .695]
    };
  }

  function vehicleCanvasRect(vehicle, metrics = roadMetrics()) {
    const scale = (metrics.right - metrics.left) / ROAD_LENGTH;
    const x = metrics.left + vehicle.position * scale;
    const lanePosition = vehicle.lateralPositionM / LANE_WIDTH_M;
    const y = metrics.laneY[0] + lanePosition * (metrics.laneY[1] - metrics.laneY[0]);
    const length = displayVehicleLength(vehicle, scale);
    const height = Math.max(12, vehicle.kind === 'bus' ? 16 : 14);
    return { x, y, width: length + 8, height: height + 8 };
  }

  function selectedVehicles() {
    return state.vehicles.filter((vehicle) => selectedVehicleIds.has(vehicle.id));
  }

  function applySelection(nextIds, additive = false) {
    if (!additive) selectedVehicleIds.clear();
    for (const id of nextIds) selectedVehicleIds.add(id);
    speedEditActive = false;
    updateInspector();
    canvas.closest('.micro-road-wrap').classList.toggle('has-selection', selectedVehicleIds.size > 0);
    draw();
  }

  function hitVehicle(point) {
    const metrics = roadMetrics();
    return state.vehicles.slice().reverse().find((vehicle) => {
      const rect = vehicleCanvasRect(vehicle, metrics);
      return Math.abs(point.x - rect.x) <= rect.width / 2
        && Math.abs(point.y - rect.y) <= rect.height / 2;
    });
  }

  function vehiclesInSelection(rect) {
    const metrics = roadMetrics();
    return state.vehicles.filter((vehicle) => {
      const point = vehicleCanvasRect(vehicle, metrics);
      return point.x >= rect.left && point.x <= rect.right
        && point.y >= rect.top && point.y <= rect.bottom;
    }).map((vehicle) => vehicle.id);
  }

  function congestionDetails(vehicle) {
    const leader = vehicleLeader(vehicle);
    if (!leader) {
      return { leader: 'Clear road', gap: 'No leader', status: 'Free flow' };
    }
    const gap = Math.max(0, leader.position - leader.length / 2
      - vehicle.position - vehicle.length / 2);
    const status = leader.kind === 'barrier'
      ? 'Barrier ahead'
      : gap < vehicle.minimumGap + vehicle.speed * vehicle.headway
        ? 'Following closely' : 'Leader ahead';
    return {
      leader: leader.kind === 'barrier' ? 'Road restriction' : `${profiles[leader.kind].label} ${leader.id + 1}`,
      gap: `${gap.toFixed(1)} m`,
      status
    };
  }

  function updateInspector() {
    const selected = selectedVehicles();
    ui.selectionCount.textContent = `${selected.length} SELECTED`;
    ui.clearSelection.disabled = selected.length === 0;
    ui.inspectorContent.hidden = selected.length === 0;
    ui.inspectorEmpty.hidden = selected.length > 0;
    ui.inspectorTitle.textContent = selected.length
      ? selected.length === 1 ? `Vehicle ${selected[0].id + 1}` : `${selected.length} vehicles selected`
      : 'Select a vehicle on the road';
    ui.inspectorHelp.textContent = selected.length
      ? 'Values update live. Congestion and safe speed options are calculated from each vehicle forward view.'
      : 'Drag across the road to select one or more vehicles. Details are shown from each selected vehicle forward view.';
    if (!selected.length) {
      ui.applySpeedCap.disabled = true;
      ui.cancelSpeedCap.hidden = true;
      ui.speedAvailability.textContent = 'Select a vehicle to see safe speed options.';
      return;
    }
    const first = selected[0];
    const details = congestionDetails(first);
    ui.selectedType.textContent = selected.length === 1
      ? profiles[first.kind].label : `${selected.length} vehicle types`;
    ui.selectedSpeed.textContent = selected.length === 1
      ? `${(first.speed * 3.6).toFixed(1)} km/h` : `${(selected.reduce((sum, v) => sum + v.speed, 0) / selected.length * 3.6).toFixed(1)} km/h avg`;
    ui.selectedLane.textContent = selected.length === 1 ? `Lane ${first.lane + 1}` : 'Multiple';
    ui.selectedGap.textContent = selected.length === 1 ? details.gap : 'Per vehicle';
    ui.selectedLeader.textContent = selected.length === 1 ? details.leader : 'Per vehicle';
    ui.selectedStatus.textContent = selected.length === 1 ? details.status : 'Mixed POV';

    const options = speedOptionsForSelection();
    for (const option of ui.selectedSpeedCap.options) {
      const result = options.find((item) => item.speed === Number(option.value));
      option.disabled = !result?.available;
      const label = `${option.value} km/h`;
      option.textContent = result?.available ? label : `${label} - unavailable`;
    }
    if (!speedEditActive) {
      const currentTarget = selected.every((vehicle) => vehicle.requestedSpeedKmh !== null
        && vehicle.requestedSpeedKmh === selected[0].requestedSpeedKmh)
        ? selected[0].requestedSpeedKmh : null;
      ui.selectedSpeedCap.value = currentTarget === null
        ? String(options.find((option) => option.available)?.speed ?? SPEED_TARGET_OPTIONS_KMH[0])
        : String(currentTarget);
    }
    ui.applySpeedCap.disabled = !options.some((option) => option.available)
      || ui.selectedSpeedCap.selectedOptions[0]?.disabled;
    const minSafeSpeed = Math.min(...selected.map(safeSpeedFor));
    ui.speedAvailability.textContent = speedEditActive
      ? 'Edit mode active - playback is slowed to 0.5x while you adjust the requested speed.'
      : `Requested speed can reach ${minSafeSpeed.toFixed(0)} km/h safely from the selected vehicle${selected.length > 1 ? 's' : ''} forward view; distance rules still take priority.`;
    ui.cancelSpeedCap.hidden = !speedEditActive;
  }

  function draw() {
    const frame = viewFrameIndex === null ? null : state.frames[viewFrameIndex];
    const displayState = frame || state;
    const displaySettings = frame ? frame.settings : getSettings();
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
    const laneY = [h * .415, h * .695];
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
    ctx.strokeStyle = 'rgba(220, 227, 223, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    for (const laneTop of [h * .275, h * .555]) {
      for (let track = 1; track < SUBLANE_COUNT; track += 1) {
        const y = laneTop + (h * .28 * track) / SUBLANE_COUNT;
        ctx.moveTo(left + 8, y);
        ctx.lineTo(right - 8, y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d2dad6';
    ctx.fillRect(left + 5, h * .275, roadWidth - 10, 2);
    ctx.fillRect(left + 5, h * .815, roadWidth - 10, 2);
    ctx.fillStyle = '#e7ece9';
    ctx.font = '600 8px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'right'; ctx.fillText('LANE 1', left - 3, laneY[0] + 3);
    ctx.fillText('LANE 2', left - 3, laneY[1] + 3);

    if (displaySettings.scenario !== 'busy') {
      const displayedBarrierPosition = frame ? frame.barrierPositionM : barrierPositionM;
      const barrierX = left + displayedBarrierPosition / ROAD_LENGTH * roadWidth;
      const closedLanes = displaySettings.scenario === 'closure'
        ? [0, 1]
        : [displaySettings.closedLane - 1];
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
      ctx.fillText(`${displayedBarrierPosition} m${frame ? '' : '  DRAG'}`, barrierX, handleY);
      ctx.textBaseline = 'alphabetic';
    }

    const interpolation = frame ? 0 : accumulator / STEP;
    const renderVehicles = displayState.vehicles.map((vehicle) => {
      const position = vehicle.previousPosition
        + (vehicle.position - vehicle.previousPosition) * interpolation;
      const lateralPositionM = vehicle.previousLateralPositionM
        + (vehicle.lateralPositionM - vehicle.previousLateralPositionM) * interpolation;
      return { vehicle, position, lateralPositionM };
    });
    const scale = roadWidth / ROAD_LENGTH;
    const drawOrder = renderVehicles.map((rendered) => ({
      ...rendered,
      displayLength: displayVehicleLength(rendered.vehicle, scale)
    })).sort((a, b) =>
      (a.position - a.displayLength / (2 * scale))
        - (b.position - b.displayLength / (2 * scale))
    );
    for (const rendered of drawOrder) {
      const { vehicle, position, lateralPositionM, displayLength } = rendered;
      const x = left + position * scale;
      const lanePosition = lateralPositionM / LANE_WIDTH_M;
      const y = laneY[0] + lanePosition * (laneY[1] - laneY[0]);
      drawVehicle(vehicle, x, y, scale, displayLength);
      if (selectedVehicleIds.has(vehicle.id)) {
        ctx.strokeStyle = '#f6d46b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x - displayLength / 2 - 4, y - 10, displayLength + 8, 20);
        ctx.setLineDash([]);
      }
    }
    if (selectionDrag) {
      const leftEdge = Math.min(selectionDrag.startX, selectionDrag.currentX);
      const topEdge = Math.min(selectionDrag.startY, selectionDrag.currentY);
      const selectionWidth = Math.abs(selectionDrag.currentX - selectionDrag.startX);
      const selectionHeight = Math.abs(selectionDrag.currentY - selectionDrag.startY);
      ctx.fillStyle = 'rgba(40, 109, 114, 0.12)';
      ctx.strokeStyle = '#286d72';
      ctx.lineWidth = 1;
      ctx.fillRect(leftEdge, topEdge, selectionWidth, selectionHeight);
      ctx.strokeRect(leftEdge, topEdge, selectionWidth, selectionHeight);
    }
    updateReadouts(displayState, displaySettings);
    if (window.flowline3d) {
      window.flowline3d.renderFrame({
        scenario: displaySettings.scenario,
        barrierPositionM: displaySettings.scenario === 'busy'
          ? null
          : (frame ? frame.barrierPositionM : barrierPositionM),
        selectedVehicleIds: Array.from(selectedVehicleIds),
        crashes: displayState.crashes || [],
        timeSeconds: displayState.time,
        vehicles: renderVehicles.map(({ vehicle, position, lateralPositionM }) => ({
          id: vehicle.id,
          kind: vehicle.kind,
          position,
          lateralPositionM,
          length: vehicle.length,
          width: vehicle.width,
          speed: vehicle.speed,
          acceleration: vehicle.acceleration
        }))
      });
    }
    if (viewFrameIndex === null) updateInspector();
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
  }

  function updateReadouts(displayState = state, displaySettings = getSettings()) {
    const counts = { car: 0, motorcycle: 0, rickshaw: 0, bus: 0, truck: 0 };
    let speedTotal = 0;
    for (const vehicle of displayState.vehicles) {
      counts[vehicle.kind] += 1;
      speedTotal += vehicle.speed;
    }
    $('carsCount').textContent = counts.car;
    $('motorcyclesCount').textContent = counts.motorcycle;
    $('rickshawsCount').textContent = counts.rickshaw;
    $('busesCount').textContent = counts.bus;
    $('trucksCount').textContent = counts.truck;
    ui.vehicles.textContent = displayState.vehicles.length;
    ui.overtakes.textContent = displayState.overtakes;
    ui.laneChanges.textContent = displayState.laneChanges;
    $('microContacts').textContent = displayState.preventedContacts;
    const meanSpeed = displayState.vehicles.length ? speedTotal / displayState.vehicles.length * 3.6 : 0;
    const density = displayState.vehicles.length / (ROAD_LENGTH / 1000 * 2);
    const displayedBarrierPosition = displaySettings.barrierPositionM ?? barrierPositionM;
    const queueCount = displayState.vehicles.filter((vehicle) =>
      (displaySettings.scenario === 'closure'
        || (displaySettings.scenario === 'partial' && vehicle.lane === displaySettings.closedLane - 1))
        && vehicle.position + vehicle.length / 2 >= displayedBarrierPosition - 60
        && vehicle.position + vehicle.length / 2 < displayedBarrierPosition
        && vehicle.speed < 0.7
    ).length;
    ui.meanSpeed.innerHTML = `${meanSpeed.toFixed(1)} <small>km/h</small>`;
    $('microDensity').innerHTML = `${density.toFixed(1)} <small>veh/km/lane</small>`;
    $('microExited').textContent = displayState.exited;
    $('microQueue').textContent = queueCount;
    updateRiskReadout({
      meanSpeedKmh: meanSpeed,
      densityVehiclesPerKmPerLane: density,
      contactsPrevented: displayState.preventedContacts
    });
    ui.time.textContent = formatTime(displayState.time);
    ui.event.textContent = displayState.eventText;
    ui.event.classList.toggle('is-alert', /stopped|contact|crash|conflict/i.test(displayState.eventText));
    updateTimelineReadout();
    renderCrashReport(displayState.crashes && displayState.crashes[displayState.crashes.length - 1]);
  }

  function updateTimelineReadout() {
    const index = viewFrameIndex === null ? state.frames.length - 1 : viewFrameIndex;
    const frame = state.frames[index];
    if (!frame) return;
    ui.timelineTime.textContent = formatTime(frame.timeSeconds);
    ui.timeline.value = String(index);
  }

  function updateTimelineMarkers() {
    const markers = {
      conflict: ui.timelineMarkers.querySelector('[data-event="conflict"]'),
      braking: ui.timelineMarkers.querySelector('[data-event="braking"]'),
      crash: ui.timelineMarkers.querySelector('[data-event="crash"]')
    };
    const firstConflict = state.frames.findIndex((frame) => frame.preventedContacts > 0);
    const firstBraking = state.frames.findIndex((frame) => frame.queueAtBarrier > 0);
    const firstCrash = state.frames.findIndex((frame) => frame.crashes && frame.crashes.length);
    for (const [type, index] of Object.entries({ conflict: firstConflict, braking: firstBraking, crash: firstCrash })) {
      const marker = markers[type];
      if (!marker) continue;
      marker.hidden = index < 0;
      if (index >= 0) {
        marker.style.left = `${(index / Math.max(1, state.frames.length - 1)) * 100}%`;
        marker.dataset.frameIndex = String(index);
      }
    }
    if (markers.crash && firstCrash >= 0) {
      markers.crash.disabled = false;
      markers.crash.hidden = false;
      markers.crash.style.left = `${(firstCrash / Math.max(1, state.frames.length - 1)) * 100}%`;
      markers.crash.dataset.frameIndex = String(firstCrash);
    }
  }

  function renderCrashReport(record = state.crashes[state.crashes.length - 1]) {
    if (!record) {
      ui.crashReport.hidden = true;
      return;
    }
    ui.crashReport.hidden = false;
    ui.crashCount.textContent = `${state.crashes.length} EVENT${state.crashes.length === 1 ? '' : 'S'}`;
    ui.crashSummary.textContent = `Observed at ${formatTime(record.timeSeconds)} | position ${record.impactPositionM.toFixed(1)} m | overlap ${record.geometry.overlapLengthM.toFixed(2)} m | relative speed ${record.relativeSpeedKmh.toFixed(1)} km/h | ${record.cause}`;
    ui.crashVehicles.innerHTML = record.vehicles.map((vehicle) => `
      <tr><td>Vehicle ${vehicle.vehicleId + 1}</td><td>${vehicle.type}</td><td>${vehicle.speedKmh.toFixed(1)} km/h</td><td>${vehicle.lane}</td><td>${vehicle.positionM.toFixed(1)} m</td></tr>
    `).join('');
  }

  function getSettings() {
    const settings = {
      roadLengthM: ROAD_LENGTH,
      lanes: 2,
      seed: Number(ui.seed.value),
      scenario: ui.scenario.value,
      closedLane: ui.scenario.value === 'partial' ? Number(ui.closedLane.value) + 1 : null,
      barrierPositionM: ui.scenario.value === 'busy' ? null : barrierPositionM,
      averageArrivalsPerMinute: Number(ui.arrivalRate.value),
      arrivalVariationPercent: Number(ui.variation.value),
      speedLimitKmh: Number(ui.speedLimit.value),
      durationSeconds: Number(ui.duration.value),
      riskConfig: { ...appModel.risk },
      selectedVehicleIds: Array.from(selectedVehicleIds).sort((a, b) => a - b),
      requestedVehicleSpeedsKmh: state
        ? state.vehicles
          .filter((vehicle) => vehicle.requestedSpeedKmh !== null)
          .map((vehicle) => ({ vehicleId: vehicle.id, requestedSpeedKmh: vehicle.requestedSpeedKmh }))
        : []
    };
    appModel.settings = settings;
    if (state) state.settings = settings;
    return settings;
  }

  function readRiskConfig() {
    const values = {
      speed: Number(ui.riskSpeedWeight.value),
      density: Number(ui.riskDensityWeight.value),
      conflict: Number(ui.riskConflictWeight.value),
      crash: Number(ui.riskCrashWeight.value)
    };
    const total = Object.values(values).reduce((sum, value) =>
      sum + (Number.isFinite(value) && value >= 0 ? value : 0), 0) || 1;
    for (const key of Object.keys(values)) values[key] = Math.max(0, values[key] || 0) / total;
    appModel.risk = values;
    for (const [key, value] of Object.entries(values)) ui[`risk${key[0].toUpperCase()}${key.slice(1)}Weight`].value = value.toFixed(2);
    return values;
  }

  function riskSnapshot(snapshot = metricsSnapshot()) {
    const risk = appModel.risk;
    const speedComponent = Math.min(1, Math.max(0, snapshot.meanSpeedKmh / 100));
    const densityComponent = Math.min(1, Math.max(0, snapshot.densityVehiclesPerKmPerLane / 45));
    const conflictComponent = Math.min(1, snapshot.contactsPrevented / 12);
    const crashComponent = Math.min(1, state.crashes.length / 3);
    const score = (speedComponent * risk.speed + densityComponent * risk.density
      + conflictComponent * risk.conflict + crashComponent * risk.crash) * 100;
    return {
      score: Number(score.toFixed(2)),
      band: score >= 70 ? 'HIGH' : score >= 35 ? 'MODERATE' : 'LOW',
      components: { speed: speedComponent, density: densityComponent, conflict: conflictComponent, crash: crashComponent }
    };
  }

  function updateRiskReadout(snapshot = metricsSnapshot()) {
    const result = riskSnapshot(snapshot);
    ui.riskIndex.textContent = result.score.toFixed(1);
    ui.riskBand.textContent = result.band;
    ui.riskBand.dataset.risk = result.band.toLowerCase();
    return result;
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
    const selectedIds = Array.from(selectedVehicleIds).sort((a, b) => a - b);
    const selectedIdCell = selectedIds.map((id) => `Vehicle ${id + 1}`).join('; ');
    const columns = [
      'app_version', 'seed', 'scenario', 'closed_lane', 'barrier_position_m', 'average_arrivals_per_minute',
      'arrival_variation_percent', 'speed_limit_kmh', 'duration_seconds',
      'time_seconds', 'barrier_position_at_sample_m', 'vehicles_on_road', 'cars', 'motorcycles', 'auto_rickshaws',
      'buses', 'trucks', 'mean_speed_kmh', 'density_vehicles_per_km_per_lane',
      'queue_at_barrier', 'exited_vehicles', 'completed_overtakes', 'lane_changes',
      'contacts_prevented', 'dropped_time_seconds', 'selected_vehicle_count', 'selected_vehicle_ids', 'selection_highlight'
    ];
    const rows = exportRows().map((row) => [
      APP_VERSION, settings.seed, settings.scenario, settings.closedLane ?? '', settings.barrierPositionM ?? '',
      settings.averageArrivalsPerMinute, settings.arrivalVariationPercent,
      settings.speedLimitKmh, settings.durationSeconds,
      row.timeSeconds, row.barrierPositionM ?? '', row.vehiclesOnRoad, row.vehicleCounts.car, row.vehicleCounts.motorcycle,
      row.vehicleCounts.rickshaw, row.vehicleCounts.bus, row.vehicleCounts.truck,
      row.meanSpeedKmh.toFixed(3), row.densityVehiclesPerKmPerLane.toFixed(3),
      row.queueAtBarrier, row.exitedVehicles, row.completedOvertakes, row.laneChanges,
      row.contactsPrevented, droppedTimeSeconds.toFixed(9), selectedIds.length, selectedIdCell,
      selectedIds.length ? 'HIGHLIGHTED' : ''
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
    download('flowline-vehicle-run.csv', [columns.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
  }

  function exportJson() {
    if (!settingsAreValid()) return;
    download('flowline-vehicle-run.json', JSON.stringify({
      appVersion: APP_VERSION,
      model: 'individual-vehicle',
      settings: getSettings(),
      metadata: {
        simDtSeconds: SIM_CONFIG.SIM_DT,
        droppedTimeSeconds,
        riskIndex: riskSnapshot()
      },
      summary: metricsSnapshot(),
      selectedVehicles: selectedVehicles().map((vehicle) => ({
        selected: true,
        highlighted: true,
        vehicleId: vehicle.id,
        type: profiles[vehicle.kind].label,
        lane: vehicle.lane + 1,
        speedKmh: Number((vehicle.speed * 3.6).toFixed(3)),
        requestedSpeedKmh: vehicle.requestedSpeedKmh,
        forwardView: congestionDetails(vehicle)
      })),
      samples: exportRows(),
      crashEvents: state.crashes,
      limitations: 'Illustrative, uncalibrated vehicle behavior; not for engineering or safety decisions.'
    }, null, 2), 'application/json');
  }

  function scenarioDocument() {
    return {
      format: 'flowline-scenario',
      version: 1,
      appVersion: APP_VERSION,
      settings: getSettings(),
      risk: { ...appModel.risk }
    };
  }

  function loadScenario(documentData) {
    if (!documentData || documentData.format !== 'flowline-scenario'
      || !documentData.settings) throw new Error('This file is not a Flowline scenario.');
    const settings = documentData.settings;
    ui.scenario.value = ['busy', 'partial', 'closure'].includes(settings.scenario)
      ? settings.scenario : 'busy';
    if (settings.closedLane) ui.closedLane.value = String(Number(settings.closedLane) - 1);
    if (settings.barrierPositionM !== null && settings.barrierPositionM !== undefined) {
      barrierPositionM = Number(settings.barrierPositionM);
      ui.barrierPosition.value = String(barrierPositionM);
    }
    for (const [control, key] of [[ui.seed, 'seed'], [ui.arrivalRate, 'averageArrivalsPerMinute'],
      [ui.variation, 'arrivalVariationPercent'], [ui.speedLimit, 'speedLimitKmh'],
      [ui.duration, 'durationSeconds']]) {
      if (settings[key] !== undefined) control.value = String(settings[key]);
    }
    if (documentData.risk) {
      for (const [key, input] of [['speed', ui.riskSpeedWeight], ['density', ui.riskDensityWeight],
        ['conflict', ui.riskConflictWeight], ['crash', ui.riskCrashWeight]]) {
        if (documentData.risk[key] !== undefined) input.value = String(documentData.risk[key]);
      }
      readRiskConfig();
    }
    updateScenarioControls();
    reset();
  }

  function setRunning(value) {
    running = value;
    ui.status.textContent = runningSlow ? 'RUNNING SLOW' : running ? 'IN MOTION' : (
      viewFrameIndex !== null ? 'HISTORY' : state.endReached ? 'QUEUE SPILLBACK' : (
        state.time >= Number(ui.duration.value) ? 'COMPLETE' : (state.time ? 'PAUSED' : 'READY')
      )
    );
    ui.status.classList.toggle('is-running', running);
    ui.status.classList.toggle('is-history', viewFrameIndex !== null);
    ui.status.classList.toggle('is-congestion', !running && state.endReached);
    ui.status.classList.toggle('is-complete', !running && !state.endReached
      && state.time >= Number(ui.duration.value));
    ui.playIcon.textContent = running ? '||' : '>';
    ui.playText.textContent = running ? 'Pause' : viewFrameIndex !== null ? 'Replay from here' : (
      state.endReached || state.time >= Number(ui.duration.value)
        ? 'Run again' : (state.time ? 'Resume' : 'Play')
    );
  }

  function showNumericalError(vehicle, field) {
    running = false;
    window.cancelAnimationFrame(rafId);
    const message = `Simulation paused: non-finite ${field} for vehicle ${vehicle.id}.`;
    ui.event.textContent = message;
    if (errorBanner) {
      errorBanner.textContent = message;
      errorBanner.hidden = false;
    }
    setRunning(false);
  }

  function validateNumericalState() {
    for (const vehicle of state.vehicles) {
      for (const field of ['position', 'speed', 'acceleration', 'lateralPositionM']) {
        if (!Number.isFinite(vehicle[field])) {
          showNumericalError(vehicle, field);
          return false;
        }
      }
    }
    return Number.isFinite(state.time);
  }

  function animate(now) {
    if (!running) return;
    const elapsed = previousTime
      ? Math.min(SIM_CONFIG.MAX_FRAME_DELTA, (now - previousTime) / 1000) : 0;
    previousTime = now;
    if (replayingHistory) {
      replayAccumulator += elapsed * Number(ui.speed.value);
      const frameAdvance = Math.floor(replayAccumulator);
      if (frameAdvance > 0) {
        replayAccumulator -= frameAdvance;
        viewFrameIndex = Math.min(state.frames.length - 1, viewFrameIndex + frameAdvance);
        if (viewFrameIndex >= state.frames.length - 1) {
          viewFrameIndex = null;
          replayingHistory = false;
          replayAccumulator = 0;
          accumulator = 0;
        }
        updateTimelineReadout();
      }
      draw();
      rafId = window.requestAnimationFrame(animate);
      return;
    }
    accumulator += elapsed * Number(ui.speed.value) * (speedEditActive ? 0.5 : 1);
    let stepsThisFrame = 0;
    while (accumulator >= STEP && !state.endReached
      && stepsThisFrame < SIM_CONFIG.MAX_STEPS_PER_FRAME) {
      step();
      accumulator -= STEP;
      stepsThisFrame += 1;
    }
    if (accumulator >= STEP && !state.endReached) {
      droppedTimeSeconds += accumulator;
      accumulator = 0;
      runningSlow = true;
      ui.status.textContent = 'RUNNING SLOW';
    } else {
      runningSlow = false;
      if (running) ui.status.textContent = 'IN MOTION';
    }
    if (state.endReached) accumulator = 0;
    if (!validateNumericalState()) return;
    draw();
    if (state.endReached || state.time >= Number(ui.duration.value)) {
      if (state.frames[state.frames.length - 1]?.timeSeconds !== state.time) recordFrame();
      updateTimelineReadout();
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
    if (viewFrameIndex !== null && viewFrameIndex < state.frames.length - 1) {
      replayingHistory = true;
      replayAccumulator = 0;
    } else {
      viewFrameIndex = null;
      replayingHistory = false;
      if ((state.endReached || state.time >= Number(ui.duration.value)) && !reset()) return;
    }
    setRunning(true);
    previousTime = 0;
    rafId = window.requestAnimationFrame(animate);
  }

  function reset() {
    if (!settingsAreValid()) return false;
    if (rafId) window.cancelAnimationFrame(rafId);
    state = createState();
    state.settings = getSettings();
    if (errorBanner) errorBanner.hidden = true;
    viewFrameIndex = null;
    replayingHistory = false;
    replayAccumulator = 0;
    accumulator = 0;
    droppedTimeSeconds = 0;
    runningSlow = false;
    previousTime = 0;
    selectedVehicleIds.clear();
    speedEditActive = false;
    selectionDrag = null;
    canvas.closest('.micro-road-wrap').classList.remove('has-selection', 'is-selecting');
    recordFrame(true);
    setRunning(false);
    draw();
    return true;
  }

  function settingsAreValid() {
    if (!ui.seed.checkValidity()) {
      ui.seed.reportValidity();
      return false;
    }
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
    ui.variationValue.textContent = `+/-${ui.variation.value}%`;
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
    const point = barrierPointerPosition(event);
    if (ui.scenario.value !== 'busy' && point.withinRoad && Math.abs(point.x - point.markerX) <= 16) {
      draggingBarrier = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.closest('.micro-road-wrap').classList.add('is-barrier-dragging');
      event.preventDefault();
      return;
    }
    if (viewFrameIndex !== null || !point.withinRoad) return;
    const hit = hitVehicle(point);
    if (hit && !event.shiftKey) {
      applySelection([hit.id]);
      event.preventDefault();
      return;
    }
    selectionDrag = {
      startX: point.x, startY: point.y, currentX: point.x, currentY: point.y,
      additive: event.shiftKey
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.closest('.micro-road-wrap').classList.add('is-selecting');
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    const point = barrierPointerPosition(event);
    if (draggingBarrier) {
      updateBarrierFromPointer(event);
      return;
    }
    if (selectionDrag) {
      selectionDrag.currentX = point.x;
      selectionDrag.currentY = point.y;
      draw();
      return;
    }
    canvas.closest('.micro-road-wrap').classList.toggle(
      'is-barrier-draggable',
      ui.scenario.value !== 'busy' && point.withinRoad && Math.abs(point.x - point.markerX) <= 16
    );
  });
  function stopBarrierDrag(event) {
    if (draggingBarrier) {
      draggingBarrier = false;
      canvas.closest('.micro-road-wrap').classList.remove('is-barrier-dragging');
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      return;
    }
    if (!selectionDrag) return;
    const drag = selectionDrag;
    selectionDrag = null;
    canvas.closest('.micro-road-wrap').classList.remove('is-selecting');
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    const rect = {
      left: Math.min(drag.startX, drag.currentX),
      right: Math.max(drag.startX, drag.currentX),
      top: Math.min(drag.startY, drag.currentY),
      bottom: Math.max(drag.startY, drag.currentY)
    };
    const hit = width < 8 && height < 8 ? hitVehicle({ x: drag.currentX, y: drag.currentY }) : null;
    const ids = hit ? [hit.id] : vehiclesInSelection(rect);
    applySelection(ids, drag.additive);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', stopBarrierDrag);
  canvas.addEventListener('pointercancel', stopBarrierDrag);

  ui.play.addEventListener('click', start);
  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, select, textarea, button, a, summary')) return;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      start();
    }
  });
  ui.reset.addEventListener('click', reset);
  ui.clearSelection.addEventListener('click', (event) => {
    event.stopPropagation();
    applySelection([]);
  });
  ui.selectedSpeedCap.addEventListener('change', () => {
    speedEditActive = true;
    updateInspector();
  });
  ui.applySpeedCap.addEventListener('click', () => {
    const selected = selectedVehicles();
    const option = ui.selectedSpeedCap.selectedOptions[0];
    if (!selected.length || !option || option.disabled) return;
    const target = Number(option.value);
    for (const vehicle of selected) vehicle.requestedSpeedKmh = target;
    speedEditActive = false;
    state.eventText = `Set ${selected.length} selected vehicle${selected.length === 1 ? '' : 's'} to a requested ${target} km/h travel speed.`;
    recordFrame(true);
    updateInspector();
    draw();
  });
  ui.timelineMarkers.addEventListener('click', (event) => {
    const marker = event.target.closest('.timeline-marker');
    if (!marker || marker.disabled || marker.hidden) return;
    ui.timeline.value = marker.dataset.frameIndex;
    ui.timeline.dispatchEvent(new Event('input', { bubbles: true }));
  });
  ui.themeToggle.addEventListener('click', () => {
    const light = document.documentElement.dataset.theme !== 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    ui.themeToggle.textContent = light ? 'DARK VIEW' : 'LIGHT VIEW';
    ui.themeToggle.setAttribute('aria-pressed', String(light));
  });
  ui.cancelSpeedCap.addEventListener('click', () => {
    speedEditActive = false;
    updateInspector();
  });
  ui.timeline.addEventListener('input', () => {
    if (running) {
      window.cancelAnimationFrame(rafId);
      setRunning(false);
      previousTime = 0;
    }
    replayingHistory = false;
    viewFrameIndex = Number(ui.timeline.value);
    updateTimelineReadout();
    draw();
  });
  for (const control of [
    ui.scenario, ui.closedLane, ui.arrivalRate, ui.variation,
    ui.speedLimit, ui.duration, ui.seed
  ]) {
    control.addEventListener('change', () => {
      updateScenarioControls();
      readRiskConfig();
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
    ui.variationValue.textContent = `+/-${ui.variation.value}%`;
  });
  ui.csv.addEventListener('click', exportCsv);
  ui.json.addEventListener('click', exportJson);
  ui.crashExport.addEventListener('click', () => {
    if (!state.crashes.length) return;
    download('flowline-crash-report.json', JSON.stringify({
      model: 'individual-vehicle',
      reportType: 'report-only collision observation',
      appVersion: APP_VERSION,
      settings: getSettings(),
      crashEvents: state.crashes,
      limitations: 'Illustrative, uncalibrated vehicle behavior; not for engineering or safety decisions.'
    }, null, 2), 'application/json');
  });
  ui.editorToggle.addEventListener('click', () => {
    appModel.mode = appModel.mode === 'editor' ? 'simulation' : 'editor';
    ui.editorBody.hidden = appModel.mode !== 'editor';
    ui.editorToggle.setAttribute('aria-pressed', String(appModel.mode === 'editor'));
    ui.editorToggle.textContent = appModel.mode === 'editor' ? 'Close editor' : 'Editor mode';
  });
  ui.scenarioSave.addEventListener('click', () => {
    download('flowline-scenario.json', JSON.stringify(scenarioDocument(), null, 2), 'application/json');
  });
  ui.scenarioLoad.addEventListener('change', () => {
    const file = ui.scenarioLoad.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { loadScenario(JSON.parse(reader.result)); }
      catch (error) {
        ui.event.textContent = `Scenario not loaded: ${error.message}`;
        ui.event.classList.add('is-alert');
      }
      ui.scenarioLoad.value = '';
    };
    reader.readAsText(file);
  });
  for (const input of [ui.riskSpeedWeight, ui.riskDensityWeight,
    ui.riskConflictWeight, ui.riskCrashWeight]) {
    input.addEventListener('change', () => {
      readRiskConfig();
      draw();
    });
  }

  function canonicalObservableState() {
    const queuedAtBarrier = state.vehicles.filter((vehicle) =>
      barrierBlocksLane(vehicle.lane)
      && vehicle.position + vehicle.length / 2 >= barrierPositionM - 60
      && vehicle.position + vehicle.length / 2 < barrierPositionM
      && vehicle.speed < 0.7
    ).length;
    return {
      stepCount: state.stepCount,
      timeSeconds: state.time,
      vehicles: state.vehicles
        .slice()
        .sort((left, right) => left.id - right.id)
        .map((vehicle) => ({
          id: vehicle.id,
          type: vehicle.kind,
          lane: vehicle.lane,
          position: vehicle.position,
          lateralOffset: vehicle.lateralPositionM - vehicle.lane * LANE_WIDTH_M,
          speed: vehicle.speed,
          acceleration: vehicle.acceleration,
          laneChange: {
            fromLane: vehicle.laneChangeFrom,
            elapsed: vehicle.laneChangeElapsed,
            duration: vehicle.lateralChangeDuration,
            fromOffset: vehicle.lateralChangeFromM === null
              ? null
              : vehicle.lateralChangeFromM - vehicle.lane * LANE_WIDTH_M,
            targetOffset: vehicle.lateralChangeTargetM === null
              ? null
              : vehicle.lateralChangeTargetM - vehicle.lane * LANE_WIDTH_M,
            progress: vehicle.lateralChangeFromM === null
              ? null
              : vehicle.lateralChangeElapsed / vehicle.lateralChangeDuration
          }
        })),
      counters: {
        vehiclesOnRoad: state.vehicles.length,
        exited: state.exited,
        queuedAtBarrier,
        completedOvertakes: state.overtakes,
        laneChanges: state.laneChanges,
        contactsPrevented: state.preventedContacts
      },
      barrier: {
        scenario: ui.scenario.value,
        positionM: ui.scenario.value === 'busy' ? null : barrierPositionM,
        closedLane: ui.scenario.value === 'partial' ? Number(ui.closedLane.value) : null
      },
      roadSettings: getSettings()
    };
  }

  window.__flowlineTest = {
    run(seed, settings = {}, steps = 0) {
      ui.seed.value = String(seed);
      ui.scenario.value = settings.scenario ?? 'busy';
      if (settings.closedLane !== undefined) ui.closedLane.value = String(settings.closedLane);
      if (settings.barrierPositionM !== undefined) {
        barrierPositionM = Number(settings.barrierPositionM);
        ui.barrierPosition.value = String(barrierPositionM);
      }
      if (settings.arrivalRate !== undefined) ui.arrivalRate.value = String(settings.arrivalRate);
      else ui.arrivalRate.value = '24';
      if (settings.variation !== undefined) ui.variation.value = String(settings.variation);
      else ui.variation.value = '25';
      if (settings.speedLimit !== undefined) ui.speedLimit.value = String(settings.speedLimit);
      else ui.speedLimit.value = '60';
      updateScenarioControls();
      if (!reset()) throw new Error('Unable to reset the simulation for testing.');
      for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) step();
      draw();
      return canonicalObservableState();
    },
    snapshot: canonicalObservableState
  };

  window.addEventListener('resize', resize);
  window.addEventListener('flowline3dready', draw);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  updateScenarioControls();
  reset();
})();
