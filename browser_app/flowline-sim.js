(() => {
  'use strict';

  // Pure individual-vehicle model for Flowline. Nothing in this file touches
  // the DOM. Road-scenario settings arrive as an explicit `world` object:
  //   { scenario: 'busy'|'partial'|'closure', closedLane: 0|1|null,
  //     barrierPositionM: number, speedLimitKmh: number }
  // Changing a field on `world` changes the model; there is no hidden state.

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

  function requestedSpeed(vehicle) {
    return vehicle.requestedSpeedKmh === null
      ? vehicle.desiredSpeed : vehicle.requestedSpeedKmh / 3.6;
  }

  function barrierBlocksLane(world, lane) {
    return world.scenario === 'closure'
      || (world.scenario === 'partial' && lane === world.closedLane);
  }

  function barrierLeader(world, lane, position) {
    if (!barrierBlocksLane(world, lane) || world.barrierPositionM <= position) return null;
    return {
      id: -1 - lane,
      lane,
      position: world.barrierPositionM,
      speed: 0,
      length: 0,
      kind: 'barrier'
    };
  }

  function laneOpenFor(world, vehicle, lane) {
    return !barrierBlocksLane(world, lane)
      || vehicle.position + vehicle.length / 2 + vehicle.speed * LANE_CHANGE_DURATION
        + vehicle.minimumGap < world.barrierPositionM;
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
    world, vehicles, lane, position, exceptId, lateralPositionM = null, subjectWidth = null,
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
    const barrier = barrierLeader(world, lane, position);
    if (barrier && (!leader || barrier.position < leader.position)) leader = barrier;
    return { leader, follower };
  }

  function vehicleLeader(world, vehicles, vehicle) {
    return laneNeighbors(world, vehicles, vehicle.lane, vehicle.position, vehicle.id).leader;
  }

  function safeSpeedFor(world, vehicles, vehicle) {
    const leader = vehicleLeader(world, vehicles, vehicle);
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

  function createVehicle(id, kind, lane, position, random, speedLimitKmh) {
    const profile = profiles[kind];
    const length = sample(random, profile.length);
    const width = sample(random, profile.width);
    const provisional = { lane, width };
    const lateralTracks = lateralTrackPositions(provisional, lane);
    const lateralPositionM = lateralTracks[Math.floor(random() * lateralTracks.length)];
    const desiredSpeed = Math.min(sample(random, profile.desired), speedLimitKmh / 3.6);
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
    world, vehicles, vehicle, targetLane, targetLateralPositionM,
    duration = LANE_CHANGE_DURATION, passingTargetId = null
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
      for (const other of vehicles) {
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
        .some((lane) => barrierBlocksLane(world, lane)
          && longitudinalPosition + vehicle.length / 2 >= world.barrierPositionM)) {
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

  function registerEvent(
    state, vehicle, fromLane, toLane, targetLateralPositionM, returning, targetId, closureMerge
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

  function proposalFor(world, state, vehicle) {
    if (vehicle.cooldown > 0 || vehicle.lateralChangeFromM !== null) return null;
    if (vehicle.returnLane !== null) {
      if (!vehicle.passedTarget || state.time - vehicle.passedTargetTime < RETURN_LANE_DELAY
        || !laneOpenFor(world, vehicle, vehicle.returnLane)) return null;
      const returnLateralPositionM = vehicle.returnLateralPositionM;
      const { leader, follower } = laneNeighbors(
        world, state.vehicles, vehicle.returnLane, vehicle.position, vehicle.id,
        returnLateralPositionM
      );
      const { leader: currentLeader } = laneNeighbors(
        world, state.vehicles, vehicle.lane, vehicle.position, vehicle.id
      );
      if (lateralPathIsClear(world, state.vehicles, vehicle, vehicle.returnLane, returnLateralPositionM)
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
      world, state.vehicles, vehicle.lane, vehicle.position, vehicle.id
    );
    const barrierAhead = barrierBlocksLane(world, vehicle.lane)
      && world.barrierPositionM > vehicle.position + vehicle.length / 2;
    const barrierDistance = world.barrierPositionM - vehicle.position - vehicle.length / 2;
    const closureDecisionDistance = Math.max(
      CLOSURE_MIN_LOOKAHEAD,
      vehicle.speed * (vehicle.headway + vehicle.reaction + LANE_CHANGE_DURATION + CLOSURE_LOOKAHEAD)
        + vehicle.speed ** 2 / (2 * vehicle.deceleration)
    );
    const hasOpenMergeLane = [vehicle.lane - 1, vehicle.lane + 1]
      .some((lane) => lane >= 0 && lane <= 1 && !barrierBlocksLane(world, lane));
    const needsClosureMerge = hasOpenMergeLane
      && barrierAhead && barrierDistance <= closureDecisionDistance;
    if (!currentLeader) {
      vehicle.waitingForMerge = false;
      return null;
    }
    const closingSpeed = vehicle.speed - currentLeader.speed;
    const passTarget = currentLeader;
    const currentGap = currentLeader.position - currentLeader.length / 2
      - vehicle.position - vehicle.length / 2;
    const queuedAtFullClosure = world.scenario === 'closure'
      && barrierAhead && barrierDistance <= closureDecisionDistance;
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
          || !lateralPathIsClear(world, state.vehicles, vehicle, vehicle.lane, lateralPositionM,
            LANE_CHANGE_DURATION, passTarget.id)) continue;
        const { leader, follower } = laneNeighbors(
          world, state.vehicles, vehicle.lane, vehicle.position, vehicle.id, lateralPositionM,
          null, passTarget.id
        );
        if (!lateralPathIsClear(world, state.vehicles, vehicle, vehicle.lane, lateralPositionM,
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
      if (lane < 0 || lane > 1 || !laneOpenFor(world, vehicle, lane)) continue;
      const laneClosesAhead = barrierBlocksLane(world, lane)
        && world.barrierPositionM > vehicle.position + vehicle.length / 2
        && world.barrierPositionM - vehicle.position - vehicle.length / 2
          <= closureDecisionDistance;
      if (laneClosesAhead) continue;
      for (const lateralPositionM of lateralTrackPositions(vehicle, lane)) {
        const { leader, follower } = laneNeighbors(
          world, state.vehicles, lane, vehicle.position, vehicle.id, lateralPositionM,
          null, passTarget.id
        );
        if (!lateralPathIsClear(world, state.vehicles, vehicle, lane, lateralPositionM,
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

  function chooseArrivalKind(state) {
    let remaining = state.random();
    for (const [kind, share] of ARRIVAL_MIX) {
      remaining -= share;
      if (remaining <= 0) return kind;
    }
    return 'car';
  }

  function addArrival(world, state) {
    const kind = chooseArrivalKind(state);
    const lanes = state.random() < 0.5 ? [0, 1] : [1, 0];
    for (const lane of lanes) {
      const vehicle = createVehicle(state.nextId, kind, lane, 0, state.random, world.speedLimitKmh);
      const { leader } = laneNeighbors(
        world, state.vehicles, lane, 0, vehicle.id, vehicle.lateralPositionM, vehicle.width
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

  function scheduleArrival(world, state) {
    const meanInterval = 60 / world.arrivalRatePerMin;
    const variation = world.variationPct / 100;
    const interval = meanInterval * (1 + (state.random() * 2 - 1) * variation);
    state.nextArrival = state.time + Math.max(0.5, interval);
  }

  // Time to collision at or below TTC_CRITICAL_S scores full risk; at or above
  // TTC_SAFE_S scores none; linear in between.
  const TTC_CRITICAL_S = 1.5;
  const TTC_SAFE_S = 6;

  function riskIndex(risk, snapshot, crashCount) {
    const speedComponent = Math.min(1, Math.max(0, snapshot.meanSpeedKmh / 100));
    const densityComponent = Math.min(1, Math.max(0, snapshot.densityVehiclesPerKmPerLane / 45));
    const ttc = snapshot.minTimeToCollisionS ?? null;
    const ttcComponent = ttc === null ? 0
      : Math.min(1, Math.max(0, (TTC_SAFE_S - ttc) / (TTC_SAFE_S - TTC_CRITICAL_S)));
    const contactComponent = Math.min(1, snapshot.contactsPrevented / 12);
    const conflictComponent = Math.max(contactComponent, ttcComponent);
    const crashComponent = Math.min(1, crashCount / 3);
    const contributions = {
      speed: speedComponent * risk.speed,
      density: densityComponent * risk.density,
      conflict: conflictComponent * risk.conflict,
      crash: crashComponent * risk.crash
    };
    const score = (contributions.speed + contributions.density
      + contributions.conflict + contributions.crash) * 100;
    const top = Object.keys(contributions).reduce((a, b) => (contributions[b] > contributions[a] ? b : a));
    const explanations = {
      speed: `high average speed (${snapshot.meanSpeedKmh.toFixed(0)} km/h)`,
      density: `crowded road (${snapshot.densityVehiclesPerKmPerLane.toFixed(1)} vehicles/km/lane)`,
      conflict: ttcComponent >= contactComponent && ttc !== null
        ? `vehicles closing fast (shortest time to collision ${ttc.toFixed(1)} s)`
        : `contacts prevented (${snapshot.contactsPrevented})`,
      crash: `recorded collisions (${crashCount})`
    };
    const explanation = contributions[top] > 0
      ? `Mainly driven by ${explanations[top]}.`
      : 'No major risk factors right now.';
    return {
      score: Number(score.toFixed(2)),
      band: score >= 70 ? 'HIGH' : score >= 35 ? 'MODERATE' : 'LOW',
      explanation,
      components: {
        speed: speedComponent, density: densityComponent, conflict: conflictComponent,
        crash: crashComponent, timeToCollision: ttcComponent
      }
    };
  }

  // Shortest time, in seconds, until a following vehicle would reach the vehicle
  // ahead (or the barrier) if both kept their current speeds. Null if nothing is closing.
  function minimumTimeToCollision(world, state) {
    let best = null;
    const consider = (gap, closing) => {
      if (closing <= 0 || gap < 0) return;
      const ttc = gap / closing;
      if (best === null || ttc < best) best = ttc;
    };
    const lanes = new Set(state.vehicles.map((vehicle) => vehicle.lane));
    for (const lane of lanes) {
      const ordered = state.vehicles
        .filter((vehicle) => vehicle.lane === lane)
        .sort((a, b) => b.position - a.position);
      for (let index = 0; index + 1 < ordered.length; index += 1) {
        const leader = ordered[index];
        const follower = ordered[index + 1];
        consider(
          leader.position - leader.length / 2 - (follower.position + follower.length / 2),
          follower.speed - leader.speed
        );
      }
      if (barrierBlocksLane(world, lane)) {
        const nearest = ordered.find((vehicle) => vehicle.position < world.barrierPositionM);
        if (nearest) {
          consider(world.barrierPositionM - nearest.position - nearest.length / 2, nearest.speed);
        }
      }
    }
    return best === null ? null : Number(best.toFixed(3));
  }

  // Demonstration only: moves a follower into the car ahead of it so the
  // collision record can be shown. Changes the traffic state, so the page must
  // label it as a demonstration. Returns the record, or null if no pair exists.
  function forceDemonstrationCollision(world, state) {
    const lanes = [...new Set(state.vehicles.filter((v) => v.id >= 0).map((v) => v.lane))];
    for (const lane of lanes) {
      const ordered = state.vehicles
        .filter((v) => v.id >= 0 && v.lane === lane)
        .sort((a, b) => b.position - a.position);
      for (let index = 0; index + 1 < ordered.length; index += 1) {
        const leader = ordered[index];
        const follower = ordered[index + 1];
        follower.position = leader.position - 1;
        follower.previousPosition = follower.position;
        follower.lateralPositionM = leader.lateralPositionM;
        follower.previousLateralPositionM = leader.lateralPositionM;
        const record = observePotentialCollision(
          world, state, follower, leader, follower.position, leader.position
        );
        if (record) {
          record.demonstration = true;
          record.severity = 'demonstration';
          state.eventText = `Demonstration collision: vehicles ${leader.id + 1} and ${follower.id + 1} were placed into overlap.`;
          return record;
        }
      }
    }
    return null;
  }

  // Returns the new collision record, or null. The caller decides how to show it.
  function observePotentialCollision(world, state, vehicle, leader, position, leaderPosition) {
    if (!leader || leader.id < 0) return null;
    const pair = [vehicle.id, leader.id].sort((a, b) => a - b);
    const pairKey = pair.join(':');
    if (state.crashPairs.has(pairKey)) return null;
    const overlapLength = vehicle.position + vehicle.length / 2
      - (leaderPosition - leader.length / 2);
    const overlapWidth = (vehicle.width + leader.width) / 2
      - Math.abs(vehicle.lateralPositionM - leader.lateralPositionM);
    if (overlapLength <= 0 || overlapWidth <= 0) return null;
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
    record.riskIndex = riskIndex(world.risk, {
      meanSpeedKmh: ((vehicle.speed + leader.speed) / 2) * 3.6,
      densityVehiclesPerKmPerLane: state.vehicles.length / (ROAD_LENGTH / 1000 * 2),
      contactsPrevented: state.preventedContacts
    }, state.crashes.length);
    state.crashPairs.add(pairKey);
    state.crashes.push(record);
    state.eventLog.push(record);
    state.eventText = `Collision observed between vehicle ${pair[0] + 1} and vehicle ${pair[1] + 1}.`;
    return record;
  }

  // Advances the model by one fixed step. Does not sample frames or touch the DOM.
  function step(world, state) {
    const proposals = state.vehicles.map((vehicle) => proposalFor(world, state, vehicle)).filter(Boolean);
    proposals.sort((a, b) => b.gain - a.gain || a.vehicle.id - b.vehicle.id);
    for (const proposal of proposals) {
      const { vehicle, lane, lateralPositionM } = proposal;
      const { leader, follower } = laneNeighbors(
        world, state.vehicles, lane, vehicle.position, vehicle.id, lateralPositionM,
        null, proposal.targetId
      );
      if (!lateralPathIsClear(world, state.vehicles, vehicle, lane, lateralPositionM, LANE_CHANGE_DURATION,
        proposal.targetId)
        || !safeGaps(vehicle, leader, follower, SAFE_FOLLOWER_DECELERATION,
          proposal.targetId)) continue;
      const fromLane = vehicle.lane;
      vehicle.lane = lane;
      registerEvent(
        state, vehicle, fromLane, lane, lateralPositionM,
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
        world, state.vehicles, vehicle.lane, vehicle.position, vehicle.id
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
        world, state.vehicles, vehicle.lane, vehicle.position, vehicle.id,
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
            observePotentialCollision(world, state, vehicle, leader, position, leaderPosition);
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
          world, state.vehicles, vehicle, vehicle.lane, proposedLateralPositionM, STEP, vehicle.passingTargetId
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
      if (addArrival(world, state)) {
        state.entryBlockedSince = null;
        scheduleArrival(world, state);
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
  }

  function createState(world) {
    const random = seededRandom(world.seed);
    const vehicles = initialFleet
      .map(([kind, lane, position], id) => createVehicle(id, kind, lane, position, random, world.speedLimitKmh))
      .filter((vehicle) => !barrierBlocksLane(world, vehicle.lane)
        || vehicle.position + vehicle.length / 2 + vehicle.minimumGap < world.barrierPositionM);
    const ego = vehicles.find((vehicle) => vehicle.id === 2);
    if (ego) {
      ego.speed = Math.min(11.8, world.speedLimitKmh / 3.6);
      ego.desiredSpeed = Math.min(13.2, world.speedLimitKmh / 3.6);
    }
    const slowBus = vehicles.find((vehicle) => vehicle.id === 3);
    if (slowBus) {
      slowBus.speed = 3.0;
      slowBus.desiredSpeed = 8.5;
    }
    return {
      time: 0, seed: world.seed, vehicles, overtakes: 0, laneChanges: 0, preventedContacts: 0,
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

  function metricsSnapshot(world, state) {
    const counts = { car: 0, motorcycle: 0, rickshaw: 0, bus: 0, truck: 0 };
    let speedTotal = 0;
    let queue = 0;
    for (const vehicle of state.vehicles) {
      counts[vehicle.kind] += 1;
      speedTotal += vehicle.speed;
      if (barrierBlocksLane(world, vehicle.lane)
        && vehicle.position + vehicle.length / 2 >= world.barrierPositionM - 60
        && vehicle.position + vehicle.length / 2 < world.barrierPositionM
        && vehicle.speed < 0.7) queue += 1;
    }
    return {
      timeSeconds: state.time,
      minTimeToCollisionS: minimumTimeToCollision(world, state),
      barrierPositionM: world.scenario === 'busy' ? null : world.barrierPositionM,
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

  window.FlowlineSim = Object.freeze({
    SIM_CONFIG, STEP, ROAD_LENGTH, LANE_WIDTH_M, LATERAL_CLEARANCE_M, GEOMETRY_EPSILON_M,
    SUBLANE_COUNT, ENTRY_SPILLBACK_DURATION, LANE_CHANGE_DURATION, MIN_LANE_GAIN,
    MIN_PASSING_CLOSING_SPEED, PASSING_LOOKAHEAD, RETURN_LANE_DELAY,
    SAFE_FOLLOWER_DECELERATION, COOLDOWN_STEPS, CLOSURE_LOOKAHEAD, CLOSURE_MIN_LOOKAHEAD,
    SPEED_TARGET_OPTIONS_KMH, SPEED_TARGET_MAX_KMH, SPEED_TARGET_CONGESTION_MARGIN_KMH,
    SPEED_TARGET_SOFT_LIMIT_MARGIN_KMH, ARRIVAL_MIX,
    profiles, initialFleet,
    seededRandom, sample, createVehicle, requestedSpeed, vehicleLeader, safeSpeedFor,
    barrierBlocksLane, barrierLeader, laneOpenFor, occupiedLanes, laneNeighbors,
    lateralBounds, lateralTrackPositions, lateralPathIsClear, idm, safeGaps,
    registerEvent, proposalFor, chooseArrivalKind, addArrival, scheduleArrival,
    riskIndex, observePotentialCollision, forceDemonstrationCollision, step, createState, metricsSnapshot
  });
})();
