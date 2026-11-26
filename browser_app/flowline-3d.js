import * as THREE from './vendor/three.module.min.js';

(() => {
  'use strict';

  const canvas = document.getElementById('microRoad3d');
  const roadWrap = canvas?.closest('.micro-road-wrap');
  const view2d = document.getElementById('microView2d');
  const view3d = document.getElementById('microView3d');
  if (!canvas || !roadWrap || !view2d || !view3d) return;

  const SIM = window.FlowlineSim || {};
  const ROAD_LENGTH = SIM.ROAD_LENGTH || 500;
  const LANE_WIDTH_M = SIM.LANE_WIDTH_M || 4; // simulation truth
  const SUBLANE_COUNT = SIM.SUBLANE_COUNT || 4;
  const LANE_COUNT = 2;
  const VISUAL_LANE_WIDTH = 10.0; // 3D-only visual spacing for readability
  const VISUAL_ROAD_WIDTH = LANE_COUNT * VISUAL_LANE_WIDTH;
  const VISUAL_ROAD_MIN_Z = -VISUAL_LANE_WIDTH / 2;
  const VISUAL_ROAD_MAX_Z = VISUAL_ROAD_MIN_Z + VISUAL_ROAD_WIDTH;
  const VISUAL_ROAD_CENTER_Z = (VISUAL_ROAD_MIN_Z + VISUAL_ROAD_MAX_Z) / 2;
  const visualZ = (simZ) => (simZ / LANE_WIDTH_M) * VISUAL_LANE_WIDTH;
  const TOP_FRUSTUM_WIDTH = 115;

  const PALETTES = {
    car: [0x4F86C6, 0x3FB28A, 0xD97706, 0xC75C5C, 0x7C6FD6, 0x2F855A, 0xB45309, 0x64748B, 0xE63946, 0x1D3557, 0xF4A261, 0x2A9D8F],
    motorcycle: [0xE63946, 0x1D3557, 0xF4A261, 0x2A9D8F, 0x6A4C93, 0xFF6B6B, 0x00B4D8, 0xFFB703],
    rickshaw: [0xD8A951, 0xC2410C],
    bus: [0x5FA8D3, 0x4A90A4, 0xE07A5F, 0x3D5A80, 0x7A9E7E],
    truck: [0x9AA5B1, 0x7B8794, 0xB08D57, 0x6B7280, 0x8D99AE, 0xA3A380]
  };
  function colorForVehicle(vehicle) {
    const pal = PALETTES[vehicle.kind] || [0x888888];
    const idx = Math.abs((vehicle.id * 2654435761) >>> 0) % pal.length;
    return pal[idx];
  }

  const COLORS = {
    car: 0x80c4a4, motorcycle: 0xe6bb72, rickshaw: 0xd8a951,
    bus: 0x7cabc0, truck: 0xac9d89
  };
  const TARGET_HEIGHT = { car: 1.4, motorcycle: 1.5, rickshaw: 1.7, bus: 3.2, truck: 3.2 };
  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let renderer, scene, camera, orthoCamera, perspCamera;
  let worldGroup;
  let initialized = false, active = false, frame = null;
  let animationFrame = 0, lastTime = 0, fpsStart = 0, fpsFrames = 0;
  let lowGraphics = false, frozen = false, currentMode = 'chase';
  let cameraDistance = 70, orbitAngle = 0.32, orbitPitch = 0.55;
  let cameraTarget = new THREE.Vector3(250, 0, 0);
  let cameraPosition = new THREE.Vector3(195, 38, 42);
  let topPanX = 180;
  let cameraDragging = false, previousPointer = null;
  let selectedOutline, speedLabel, eventLabel, flashRing;
  let barrierGroup, trailGroup, propGroup, roadGroup;
  let glowMaterial;
  let contactShadowTexture;
  let lastTrailFrame;
  const trailPool = [];
  const trailMaterials = new Map();
  let trailGeometry;
  
  // Vehicle detail caches
  const MAX_VEHICLES = 260;
  const vehiclePools = {};
  const wheelRadiusByKind = { car: 0.34, motorcycle: 0.26, rickshaw: 0.3, bus: 0.5, truck: 0.52 };
  const prevLateral = new Map();
  const modeButtons = Array.from(document.querySelectorAll('[data-3d-mode]'));
  const cameraControls = {
    enableRotate: true,
    object: { up: new THREE.Vector3(0, 1, 0) },
    update() { /* no OrbitControls; custom camera update in render loop */ }
  };
  const lowGraphicsToggle = document.querySelector('[data-3d-low-graphics]');
  const trailsToggle = document.querySelector('[data-3d-trails]');
  const freezeToggle = document.querySelector('[data-3d-freeze]');

  function material(color, roughness = 0.72, emissive = 0, metalness = 0.08, clearcoat = 0, clearcoatRoughness = 0.3) {
    return new THREE.MeshPhysicalMaterial({ color, roughness, metalness, emissive, emissiveIntensity: emissive ? 2 : 0, clearcoat, clearcoatRoughness });
  }

  function glassMaterial(opacity = 0.35) {
    return new THREE.MeshPhysicalMaterial({ color: 0xa8c8d8, roughness: 0.05, metalness: 0.1, transparent: true, opacity, transmission: 0.15 });
  }
  function chromeMaterial() { return new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.2, metalness: 0.9 }); }
  function tireMaterial() { return new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.95, metalness: 0.05 }); }

  function textureFromCanvas(width, height, paint) {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = width;
    textureCanvas.height = height;
    paint(textureCanvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function makeAsphaltTexture() {
    return textureFromCanvas(256, 256, (context, width, height) => {
      context.fillStyle = '#303d43';
      context.fillRect(0, 0, width, height);
      for (let i = 0; i < 1800; i += 1) {
        const shade = 38 + Math.floor(Math.random() * 25);
        context.fillStyle = `rgba(${shade},${shade + 8},${shade + 10},${0.12 + Math.random() * 0.22})`;
        context.fillRect(Math.random() * width, Math.random() * height, 1, 1);
      }
    });
  }

  function makeSkyTexture() {
    return textureFromCanvas(2, 256, (context, width, height) => {
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#08182c');
      gradient.addColorStop(0.55, '#142d4b');
      gradient.addColorStop(1, '#344c5a');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    });
  }

  function makeContactShadowTexture() {
    return textureFromCanvas(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.5);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.65, 'rgba(0,0,0,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }

  function addRoad() {
    roadGroup = new THREE.Group();

    // Shoulder/verge base: top at y=0.00
    const shoulder = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_LENGTH, 0.04, VISUAL_ROAD_WIDTH + 16),
      material(0xB6C0C8, 0.96)
    );
    shoulder.position.set(ROAD_LENGTH / 2, -0.02, VISUAL_ROAD_CENTER_Z);
    shoulder.receiveShadow = true;
    roadGroup.add(shoulder);

    // Dark asphalt: top at y=0.05, narrower than shoulder
    const asphalt = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_LENGTH, 0.04, VISUAL_ROAD_WIDTH),
      new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.92, metalness: 0.02 })
    );
    asphalt.position.set(ROAD_LENGTH / 2, 0.03, VISUAL_ROAD_CENTER_Z);
    asphalt.receiveShadow = true;
    roadGroup.add(asphalt);

    // Outer edge lines: y=0.065, solid white
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
    for (const z of [VISUAL_ROAD_MIN_Z, VISUAL_ROAD_MAX_Z]) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.065, z), new THREE.Vector3(ROAD_LENGTH, 0.065, z)
      ]);
      roadGroup.add(new THREE.Line(g, edgeMat));
    }

    // Center dashed divider: y=0.065, crisp dashed white
    const centerMat = new THREE.LineDashedMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, dashSize: 3.0, gapSize: 3.0, depthWrite: false
    });
    const centerGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.065, VISUAL_ROAD_CENTER_Z), new THREE.Vector3(ROAD_LENGTH, 0.065, VISUAL_ROAD_CENTER_Z)
    ]);
    const centerLine = new THREE.Line(centerGeo, centerMat);
    centerLine.computeLineDistances();
    roadGroup.add(centerLine);

    // Sublane guide lines: subtle dotted, low opacity
    const sublaneMat = new THREE.LineDashedMaterial({
      color: 0x94a3b8, transparent: true, opacity: 0.22, dashSize: 0.35, gapSize: 1.65, depthWrite: false
    });
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const laneCenter = lane * VISUAL_LANE_WIDTH;
      for (let track = 1; track < SUBLANE_COUNT; track += 1) {
        const z = laneCenter - VISUAL_LANE_WIDTH / 2 + (VISUAL_LANE_WIDTH * track) / SUBLANE_COUNT;
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0.065, z), new THREE.Vector3(ROAD_LENGTH, 0.065, z)
        ]);
        const line = new THREE.Line(g, sublaneMat);
        line.computeLineDistances();
        roadGroup.add(line);
      }
    }
    worldGroup.add(roadGroup);
  }

  function addProps() {
    propGroup = new THREE.Group();
    const poleGeometry = new THREE.CylinderGeometry(0.04, 0.05, 0.9, 8);
    const poleMat = material(0x9AA6B0, 0.65, 0, 0.1);
    for (let i = 0; i < 16; i += 1) {
      const x = 15 + i * 32;
      for (const z of [VISUAL_ROAD_MIN_Z - 2.6, VISUAL_ROAD_MAX_Z + 2.6]) {
        const pole = new THREE.Mesh(poleGeometry, poleMat);
        pole.position.set(x, 0.45, z);
        pole.receiveShadow = true;
        propGroup.add(pole);
      }
    }
    worldGroup.add(propGroup);
  }

  function addBarrier() {
    barrierGroup = new THREE.Group();
    barrierGroup.visible = false;
    worldGroup.add(barrierGroup);
  }

  function rebuildBarrier(scenario, closedLane) {
    if (!barrierGroup) return;
    while (barrierGroup.children.length) {
      const obj = barrierGroup.children.pop();
      obj.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        }
      });
    }
    glowMaterial = null;
    if (scenario !== 'partial' && scenario !== 'closure') {
      barrierGroup.visible = false;
      return;
    }

    const laneRanges = scenario === 'closure'
      ? [[VISUAL_ROAD_MIN_Z, VISUAL_ROAD_MAX_Z]]
      : [closedLane === 1 ? [VISUAL_LANE_WIDTH - VISUAL_LANE_WIDTH / 2, VISUAL_ROAD_MAX_Z] : [VISUAL_ROAD_MIN_Z, VISUAL_LANE_WIDTH / 2]];
    // lane 0 sim => visual [ -5,5 ], lane 1 sim => [5,15]
    const normalized = scenario === 'closure'
      ? [[VISUAL_ROAD_MIN_Z, VISUAL_ROAD_MAX_Z]]
      : (Number(closedLane) === 1 ? [[VISUAL_LANE_WIDTH / 2, VISUAL_ROAD_MAX_Z]] : [[VISUAL_ROAD_MIN_Z, VISUAL_LANE_WIDTH / 2]]);

    for (const [zMin, zMax] of normalized) {
      const width = zMax - zMin;
      const centerZ = (zMin + zMax) / 2;
      const postMat = material(0x293b40);
      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.18), postMat);
      postL.position.set(0, 0.6, centerZ - width / 2 + 0.25);
      const postR = postL.clone(); postR.position.z = centerZ + width / 2 - 0.25;
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, width - 0.5), material(0xe5a34d));
      board.position.set(0, 1.05, centerZ);
      barrierGroup.add(postL, postR, board);

      const stripeMatA = material(0xf2e5b3);
      const stripeMatB = material(0x26343d);
      for (let z = zMin + 0.7; z <= zMax - 0.7; z += 0.8) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.45), Math.round(z) % 2 === 0 ? stripeMatA : stripeMatB);
        stripe.position.set(-0.13, 1.05, z);
        barrierGroup.add(stripe);
      }
      for (let z = zMin + 1.0; z <= zMax - 1.0; z += Math.max(2.0, width / 3)) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.65, 6), material(0xe77335));
        cone.position.set(-0.7, 0.325, z);
        barrierGroup.add(cone);
      }
    }

    glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffb52e, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
    const amber = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), glowMaterial);
    amber.position.set(-0.2, 1.45, VISUAL_ROAD_CENTER_Z);
    if (scenario === 'partial') {
      amber.position.z = Number(closedLane) === 1 ? (VISUAL_LANE_WIDTH / 2 + VISUAL_ROAD_MAX_Z) / 2 : (VISUAL_ROAD_MIN_Z + VISUAL_LANE_WIDTH / 2) / 2;
    }
    barrierGroup.add(amber);
    barrierGroup.visible = true;
  }

  function vehicleGeometry(kind, length, width) { return new THREE.BoxGeometry(length, 1, width); }

  function makeVehicleGroup(kind) {
    const group = new THREE.Group();
    const base = VEHICLE_BASE_DIMS[kind] || { length: 4, width: 1.8, height: 1.5 };
    const paint = new THREE.MeshPhysicalMaterial({
      color: COLORS[kind], roughness: 0.38, metalness: 0.22, clearcoat: 0.65, clearcoatRoughness: 0.2
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x93b7c8, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.42, transmission: 0.15
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.82, metalness: 0.08 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.7, metalness: 0.2 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.22, metalness: 0.88 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff4cc, emissive: 0xfff0b8, emissiveIntensity: 1.4 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff1a00, emissiveIntensity: 0.6 });

    const wheels = [];
    const frontWheels = [];
    const indicators = { left: [], right: [] };
    const addIndicator = (x, y, z, side) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0, transparent: true, opacity: 0.35 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.12), mat);
      mesh.position.set(x, y, z);
      group.add(mesh);
      indicators[side].push(mesh);
    };
    const addWheel = (x, y, z, radius = wheelRadiusByKind[kind], width = kind === 'motorcycle' ? 0.14 : 0.22, isFront = false) => {
      const w = new THREE.Group();
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, width, 20),
        new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.88, metalness: 0.04 })
      );
      tire.rotation.x = Math.PI / 2;
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 1.02, 14),
        new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.3, metalness: 0.65 })
      );
      rim.rotation.x = Math.PI / 2;
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, width * 1.05, 10),
        new THREE.MeshStandardMaterial({ color: 0x8a939d, roughness: 0.35, metalness: 0.7 })
      );
      hub.rotation.x = Math.PI / 2;
      w.add(tire, rim, hub);
      w.position.set(x, y, z);
      w.userData.baseRadius = radius;
      group.add(w);
      wheels.push(w);
      if (isFront) frontWheels.push(w);
    };

    if (kind === 'car') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.32, 0.55, 1.82), paint);
      body.position.y = 0.62;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.58, 1.58), paint);
      cabin.position.set(-0.15, 1.15, 0);
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 1.42), glass);
      windshield.position.set(0.72, 1.14, 0); windshield.rotation.z = -0.32;
      const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 1.36), glass);
      rearGlass.position.set(-1.02, 1.12, 0); rearGlass.rotation.z = 0.3;
      const sideL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.38, 0.04), glass); sideL.position.set(-0.15, 1.12, 0.8);
      const sideR = sideL.clone(); sideR.position.z = -0.8;
      const hood = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 1.72), paint); hood.position.set(1.35, 0.83, 0);
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 1.72), paint); trunk.position.set(-1.55, 0.83, 0);
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 1.0), trim); grille.position.set(2.14, 0.58, 0);
      const bumperF = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 1.84), dark); bumperF.position.set(2.14, 0.42, 0);
      const bumperR = bumperF.clone(); bumperR.position.x = -2.14;
      const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.32), lightMat); hlL.position.set(2.14, 0.66, 0.58);
      const hlR = hlL.clone(); hlR.position.z = -0.58;
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.34), tailMat); tlL.position.set(-2.14, 0.66, 0.58); tlL.name = 'tailL';
      const tlR = tlL.clone(); tlR.position.z = -0.58; tlR.name = 'tailR';
      const mirrorL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.12), dark); mirrorL.position.set(0.55, 1.0, 0.95);
      const mirrorR = mirrorL.clone(); mirrorR.position.z = -0.95;
      const wellMat = dark;
      [[1.35, 0.82], [1.35, -0.82], [-1.35, 0.82], [-1.35, -0.82]].forEach(([x, z]) => {
        const well = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.34, 0.3), wellMat); well.position.set(x, 0.48, z); group.add(well);
      });
      group.add(body, cabin, windshield, rearGlass, sideL, sideR, hood, trunk, grille, bumperF, bumperR, hlL, hlR, tlL, tlR, mirrorL, mirrorR);
      addWheel(1.35, 0.34, 0.84, 0.34, 0.22, true); addWheel(1.35, 0.34, -0.84, 0.34, 0.22, true); addWheel(-1.35, 0.34, 0.84); addWheel(-1.35, 0.34, -0.84);
      addIndicator(2.1, 0.62, 0.9, 'left'); addIndicator(2.1, 0.62, -0.9, 'right');
      addIndicator(-2.1, 0.62, 0.9, 'left'); addIndicator(-2.1, 0.62, -0.9, 'right');
    } else if (kind === 'motorcycle') {
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x30363d, roughness: 0.55, metalness: 0.6 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.32), frameMat); body.position.y = 0.7;
      const tank = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.38), paint); tank.position.set(0.2, 0.88, 0);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.36), dark); seat.position.set(-0.35, 0.86, 0);
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), chrome); fork.position.set(0.72, 0.52, 0); fork.rotation.z = -0.25;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.72), chrome); handle.position.set(0.62, 0.98, 0);
      const fenderF = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.34), paint); fenderF.position.set(0.75, 0.52, 0);
      const fenderR = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.36), paint); fenderR.position.set(-0.72, 0.52, 0);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), lightMat); hl.position.set(0.95, 0.84, 0);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.1), tailMat); tl.position.set(-1.0, 0.72, 0); tl.name = 'tailL';
      const riderBody = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.28), dark); riderBody.position.set(-0.15, 1.08, 0);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), new THREE.MeshStandardMaterial({ color: 0x20252b, roughness: 0.35, metalness: 0.2 }));
      helmet.position.set(-0.02, 1.38, 0);
      group.add(body, tank, seat, fork, handle, fenderF, fenderR, hl, tl, riderBody, helmet);
      addWheel(0.75, 0.28, 0, 0.28, 0.14, true); addWheel(-0.75, 0.28, 0, 0.28, 0.14);
      addIndicator(0.95, 0.82, 0.32, 'left'); addIndicator(0.95, 0.82, -0.32, 'right');
      addIndicator(-0.95, 0.72, 0.24, 'left'); addIndicator(-0.95, 0.72, -0.24, 'right');
    } else if (kind === 'rickshaw') {
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 1.48), new THREE.MeshStandardMaterial({ color: 0x1f7a4d, roughness: 0.75, metalness: 0.05 }));
      canopy.position.set(-0.15, 1.62, 0);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 1.32), paint); cabin.position.set(-0.2, 1.08, 0);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 1.4), dark); floor.position.set(0, 0.55, 0);
      const frontCowl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 0.9), paint); frontCowl.position.set(0.85, 0.88, 0);
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 1.0), glass); windshield.position.set(0.52, 1.18, 0); windshield.rotation.z = -0.18;
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), lightMat); hl.position.set(1.3, 0.8, 0);
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.16), tailMat); tlL.position.set(-1.28, 0.72, 0.45); tlL.name = 'tailL';
      const tlR = tlL.clone(); tlR.position.z = -0.45; tlR.name = 'tailR';
      const rearCover = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 1.0), trim); rearCover.position.set(-1.05, 0.72, 0);
      const arch = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.38), dark); arch.position.set(0.95, 0.42, 0);
      group.add(canopy, cabin, floor, frontCowl, windshield, hl, tlL, tlR, rearCover, arch);
      addWheel(0.95, 0.28, 0, 0.28, 0.16, true); addWheel(-0.8, 0.28, 0.58, 0.28, 0.16); addWheel(-0.8, 0.28, -0.58, 0.28, 0.16);
      addIndicator(1.15, 0.95, 0.72, 'left'); addIndicator(1.15, 0.95, -0.72, 'right');
      addIndicator(-1.2, 0.8, 0.72, 'left'); addIndicator(-1.2, 0.8, -0.72, 'right');
    } else if (kind === 'bus') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(11.0, 2.45, 2.5), paint); body.position.y = 1.55;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.16, 2.35), trim); roof.position.set(0, 2.82, 0);
      const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 2.15), glass); frontGlass.position.set(5.46, 2.0, 0);
      const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.35, 2.45), dark); frontBumper.position.set(5.5, 0.42, 0);
      const rearBumper = frontBumper.clone(); rearBumper.position.x = -5.5;
      for (let i = -4; i <= 3; i += 1) {
        const wL = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.62, 0.04), glass); wL.position.set(i * 1.1 + 0.3, 2.0, 1.24);
        const wR = wL.clone(); wR.position.z = -1.24;
        group.add(wL, wR);
        if (i < 3) { const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.06), trim); pillarL.position.set(i * 1.1 + 0.85, 1.95, 1.24); const pillarR = pillarL.clone(); pillarR.position.z = -1.24; group.add(pillarL, pillarR); }
      }
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.06), trim); door.position.set(3.8, 1.1, 1.24);
      const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.38), lightMat); hlL.position.set(5.5, 0.75, 0.85);
      const hlR = hlL.clone(); hlR.position.z = -0.85;
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.42), tailMat); tlL.position.set(-5.5, 0.85, 0.9); tlL.name = 'tailL';
      const tlR = tlL.clone(); tlR.position.z = -0.9; tlR.name = 'tailR';
      const ac = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.22, 1.2), trim); ac.position.set(-1.5, 2.96, 0);
      group.add(body, roof, frontGlass, frontBumper, rearBumper, door, hlL, hlR, tlL, tlR, ac);
      addWheel(3.8, 0.5, 1.12, 0.5, 0.28, true); addWheel(3.8, 0.5, -1.12, 0.5, 0.28, true);
      addWheel(-3.0, 0.5, 1.12, 0.5, 0.28); addWheel(-3.0, 0.5, -1.12, 0.5, 0.28);
      addWheel(-4.0, 0.5, 1.12, 0.5, 0.28); addWheel(-4.0, 0.5, -1.12, 0.5, 0.28);
      addIndicator(5.45, 0.95, 1.28, 'left'); addIndicator(5.45, 0.95, -1.28, 'right');
      addIndicator(-5.45, 0.95, 1.28, 'left'); addIndicator(-5.45, 0.95, -1.28, 'right');
    } else if (kind === 'truck') {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.1, 2.38), paint); cab.position.set(2.85, 1.35, 0);
      group.userData.cabPaint = paint;
      const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 2.2), trim); cabRoof.position.set(2.7, 2.45, 0);
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(5.55, 2.05, 2.4), new THREE.MeshStandardMaterial({ color: 0x88939a, roughness: 0.62, metalness: 0.18 }));
      cargo.position.set(-1.42, 1.35, 0);
      const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 2.0), glass); cabGlass.position.set(4.23, 1.75, 0);
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 1.5), trim); grille.position.set(4.26, 0.75, 0);
      const bumperF = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.28, 2.4), dark); bumperF.position.set(4.28, 0.38, 0);
      const underrun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 2.2), dark); underrun.position.set(-4.22, 0.35, 0);
      const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.32), lightMat); hlL.position.set(4.26, 0.72, 0.82);
      const hlR = hlL.clone(); hlR.position.z = -0.82;
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.36), tailMat); tlL.position.set(-4.22, 0.78, 0.88); tlL.name = 'tailL';
      const tlR = tlL.clone(); tlR.position.z = -0.88; tlR.name = 'tailR';
      const mirrorL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.08), dark); mirrorL.position.set(3.5, 1.55, 1.28);
      const mirrorR = mirrorL.clone(); mirrorR.position.z = -1.28;
      for (let i = -1; i <= 1; i += 1) {
        const ribL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.8, 0.04), trim); ribL.position.set(-1.42 + i * 1.5, 1.35, 1.21);
        const ribR = ribL.clone(); ribR.position.z = -1.21; group.add(ribL, ribR);
      }
      group.add(cab, cabRoof, cargo, cabGlass, grille, bumperF, underrun, hlL, hlR, tlL, tlR, mirrorL, mirrorR);
      addWheel(3.05, 0.52, 1.08, 0.52, 0.3, true); addWheel(3.05, 0.52, -1.08, 0.52, 0.3, true);
      addWheel(-2.3, 0.52, 1.08, 0.52, 0.3); addWheel(-2.3, 0.52, -1.08, 0.52, 0.3);
      addWheel(-3.3, 0.52, 1.08, 0.52, 0.3); addWheel(-3.3, 0.52, -1.08, 0.52, 0.3);
      addIndicator(4.2, 0.95, 1.22, 'left'); addIndicator(4.2, 0.95, -1.22, 'right');
      addIndicator(-4.15, 0.95, 1.22, 'left'); addIndicator(-4.15, 0.95, -1.22, 'right');
    }

    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.userData.wheels = wheels;
    group.userData.frontWheels = frontWheels;
    group.userData.indicators = indicators;
    group.userData.tailL = group.getObjectByName('tailL');
    group.userData.tailR = group.getObjectByName('tailR');
    group.userData.paint = paint;
    group.userData.cabPaint = group.userData.cabPaint || paint;
    group.userData.baseY = 0;
    group.userData.yaw = 0;
    group.userData.prevVisualZ = null;
    group.visible = false;

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(base.length * 0.92, base.width * 0.88),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture, transparent: true, opacity: 0.32,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.005, 0); // relative to vehicle group; group sits at asphalt top y=0.05
    shadow.renderOrder = 1;
    group.add(shadow);
    group.userData.shadow = shadow;

    return group;
  }

  // Raw unscaled mesh Box3 extents (meters in model space), including wheels/details.
  // Scaling by vehicle.simDim / BASE_DIM makes rendered Box3 match sim footprint.
  const VEHICLE_BASE_DIMS = {
    car:        { length: 4.40, width: 2.36, height: 1.44 },
    motorcycle: { length: 2.07, width: 0.72, height: 1.54 },
    rickshaw:   { length: 2.70, width: 1.72, height: 1.66 },
    bus:        { length: 11.16, width: 3.24, height: 3.07 },
    truck:      { length: 8.63, width: 3.20, height: 2.51 }
  };

  function createVehicleLayers() {
    if (!contactShadowTexture) contactShadowTexture = makeContactShadowTexture();

    for (const kind of Object.keys(COLORS)) {
      vehiclePools[kind] = [];
      for (let i = 0; i < 60; i++) {
        const g = makeVehicleGroup(kind);
        vehiclePools[kind].push(g);
        worldGroup.add(g);
      }
    }
  }

  let lastFrameId = 0;

  function updateVehicles(delta) {
    // Hide all pooled vehicles
    for (const kind of Object.keys(vehiclePools)) {
      for (const g of vehiclePools[kind]) g.visible = false;
    }
    if (!frame) return;

    const frameId = frame.stepCount ?? frame.timeSeconds ?? 0;
    const frameReset = frameId < lastFrameId || frame.vehicles.length === 0;
    lastFrameId = frameId;
    const activeIds = new Set(frame.vehicles.map((v) => v.id));
    for (const id of Array.from(prevLateral.keys())) {
      if (!activeIds.has(id)) prevLateral.delete(id);
    }
    if (frameReset) prevLateral.clear();

    const indexes = { car: 0, motorcycle: 0, rickshaw: 0, bus: 0, truck: 0 };

    for (const vehicle of frame.vehicles) {
      const pool = vehiclePools[vehicle.kind];
      if (!pool) continue;
      const idx = indexes[vehicle.kind]++;
      if (idx >= pool.length) continue;
      const g = pool[idx];
      g.visible = true;

      g.userData.vehicleId = vehicle.id;
      const vColor = colorForVehicle(vehicle);
      if (g.userData.paint) g.userData.paint.color.setHex(vColor);
      if (g.userData.cabPaint) g.userData.cabPaint.color.setHex(vColor);

      const base = VEHICLE_BASE_DIMS[vehicle.kind] || { length: vehicle.length || 4, width: vehicle.width || 1.8 };
      const sx = vehicle.length / base.length;
      const sz = vehicle.width / base.width;
      const sy = (TARGET_HEIGHT[vehicle.kind] || base.height || 1.5) / (base.height || 1.5);
      g.scale.set(sx, sy, sz);

      // No smoothing lag on first frame for this id or after reset.
      const hasPrev = prevLateral.has(vehicle.id);
      const prev = hasPrev ? prevLateral.get(vehicle.id) : vehicle.lateralPositionM;
      const lateralSmooth = hasPrev ? prev + (vehicle.lateralPositionM - prev) * Math.min(1, delta * 8) : vehicle.lateralPositionM;
      prevLateral.set(vehicle.id, lateralSmooth);
      const visualLateral = visualZ(lateralSmooth);

      // Dynamic steering yaw, body roll, turn signals
      const prevVisualZ = g.userData.prevVisualZ ?? visualLateral;
      const vz = (visualLateral - prevVisualZ) / Math.max(delta, 1e-3);
      g.userData.prevVisualZ = visualLateral;
      const targetYaw = Math.max(-0.28, Math.min(0.28, -Math.atan2(vz, Math.max(vehicle.speed, 3.0))));
      const yawDamp = 1 - Math.exp(-10 * delta);
      g.userData.yaw = (g.userData.yaw ?? 0) + (targetYaw - (g.userData.yaw ?? 0)) * yawDamp;
      g.rotation.y = g.userData.yaw;
      g.rotation.x = pitch;
      g.rotation.z = Math.max(-0.05, Math.min(0.05, vz * 0.025));

      for (const fw of g.userData.frontWheels || []) fw.rotation.y = targetYaw * 1.4;
      const blinkOn = Math.abs(vz) > 0.15 && Math.floor(performance.now() / 200) % 2 === 0;
      const leftOn = blinkOn && vz < -0.15;
      const rightOn = blinkOn && vz > 0.15;
      for (const ind of g.userData.indicators?.left || []) { ind.material.emissiveIntensity = leftOn ? 2.2 : 0.0; ind.material.opacity = leftOn ? 1 : 0.35; }
      for (const ind of g.userData.indicators?.right || []) { ind.material.emissiveIntensity = rightOn ? 2.2 : 0.0; ind.material.opacity = rightOn ? 1 : 0.35; }

      // Wheel rotation
      const speed = vehicle.speed || 0;
      const radius = wheelRadiusByKind[vehicle.kind] || 0.35;
      const rotDelta = (speed / Math.max(0.1, radius)) * delta;
      for (const w of g.userData.wheels) w.rotation.z -= rotDelta;

      // Brake lights
      const braking = vehicle.acceleration < -0.5;
      const tailColor = braking ? 0xff1a00 : 0x661111;
      const tailEmissive = braking ? 1.6 : 0.45;
      if (g.userData.tailL) { g.userData.tailL.material.color.setHex(tailColor); g.userData.tailL.material.emissiveIntensity = tailEmissive; }
      if (g.userData.tailR) { g.userData.tailR.material.color.setHex(tailColor); g.userData.tailR.material.emissiveIntensity = tailEmissive; }
    }

    const selected = frame.vehicles.find((vehicle) => frame.selectedVehicleIds.includes(vehicle.id));
    if (selected) {
      const selLat = prevLateral.has(selected.id) ? prevLateral.get(selected.id) : selected.lateralPositionM;
      const visualSelLat = visualZ(selLat);
      selectedOutline.visible = true;
      selectedOutline.position.set(selected.position, 0.07, visualSelLat);
      selectedOutline.scale.set(Math.max(1.2, selected.length / 2 + 0.3), 1, Math.max(0.9, selected.width / 2 + 0.2));
      speedLabel.visible = true;
      speedLabel.position.set(selected.position, 3.4, visualSelLat);
      speedLabel.element.textContent = `${(selected.speed * 3.6).toFixed(0)} km/h`;
    } else {
      selectedOutline.visible = false;
      speedLabel.visible = false;
    }
  }

  function makeLabel(text, className) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    element.style.position = 'absolute';
    element.style.left = '0';
    element.style.top = '0';
    element.style.pointerEvents = 'none';
    element.style.display = 'none';
    roadWrap.appendChild(element);
    return { element, position: new THREE.Vector3(), visible: true };
  }

  function updateCrashMoment() {
    const crash = frame?.crashes?.[frame.crashes.length - 1];
    if (!crash || !flashRing) { if (flashRing) flashRing.visible = false; if (eventLabel) eventLabel.visible = false; return; }
    flashRing.visible = true;
    flashRing.position.set(crash.impactPositionM, 0.12, 0);
    const pulse = 1 + ((performance.now() / 120) % 1) * 2;
    flashRing.scale.setScalar(pulse);
    flashRing.material.opacity = 0.9 - (pulse - 1) * 0.3;
    eventLabel.visible = true;
    eventLabel.element.textContent = 'Simulated event';
    eventLabel.position.set(crash.impactPositionM, 5, 0);
  }

  function updateTrails() {
    if (lastTrailFrame === frame) return;
    lastTrailFrame = frame;
    const enabled = !lowGraphics && !REDUCED_MOTION
      && trailsToggle?.getAttribute('aria-pressed') !== 'false' && frame;
    for (const trail of trailPool) trail.visible = false;
    if (!enabled) return;
    frame.vehicles.forEach((vehicle, index) => {
      const speed = vehicle.speed * 3.6;
      const color = speed < 35 ? 0xf0a25b : speed > 75 ? 0x62c8df : 0xd0c26b;
      if (!trailGeometry) trailGeometry = new THREE.PlaneGeometry(1, 0.06);
      if (!trailMaterials.has(color)) {
        trailMaterials.set(color, new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false
        }));
      }
      const trail = trailPool[index] || new THREE.Mesh(trailGeometry, trailMaterials.get(color));
      if (!trailPool[index]) { trailPool.push(trail); trailGroup.add(trail); }
      trail.material = trailMaterials.get(color);
      trail.scale.x = Math.min(8, 1.2 + speed / 16);
      trail.rotation.x = -Math.PI / 2;
      const lat = prevLateral.has(vehicle.id) ? prevLateral.get(vehicle.id) : vehicle.lateralPositionM;
      trail.position.set(vehicle.position - Math.min(4, 1.5 + speed / 35), 0.045, visualZ(lat));
      trail.visible = true;
    });
  }

  function disposeScene() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (!scene) return;
    scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((item) => { if (item.map) item.map.dispose(); item.dispose(); });
      }
    });
    renderer?.dispose();
    trailPool.length = 0; trailMaterials.clear(); trailGeometry = null; prevLateral.clear();
    if (speedLabel?.element) speedLabel.element.remove();
    if (eventLabel?.element) eventLabel.element.remove();
    speedLabel = null; eventLabel = null; scene = null; renderer = null; initialized = false;
    for (const k of Object.keys(vehiclePools)) delete vehiclePools[k];
  }

  function updateCamera(delta) {
    const selected = frame?.vehicles?.find((vehicle) => frame.selectedVehicleIds.includes(vehicle.id));
    const lookX = selected ? selected.position : ROAD_LENGTH * 0.45;
    const lookZ = selected ? visualZ(selected.lateralPositionM) : VISUAL_ROAD_CENTER_Z;

    if (currentMode === 'top') {
      camera = orthoCamera;
      const followX = selected ? selected.position : topPanX;
      topPanX = Math.max(TOP_FRUSTUM_WIDTH / 2, Math.min(ROAD_LENGTH - TOP_FRUSTUM_WIDTH / 2, followX));
      const x = topPanX;
      const z = VISUAL_ROAD_CENTER_Z;
      camera.position.set(x, 280, z);
      camera.up.set(0, 0, -1);
      camera.lookAt(x, 0, z);
      cameraControls.object.up.copy(camera.up);
      cameraControls.enableRotate = false;
      cameraTarget.set(x, 0, z);
      cameraPosition.copy(camera.position);
      return;
    }

    camera = perspCamera;
    camera.up.set(0, 1, 0);
    cameraControls.object.up.copy(camera.up);
    cameraControls.enableRotate = true;
    if (currentMode === 'chase') {
      const lead = selected || frame?.vehicles?.slice().sort((a, b) => b.position - a.position)[0];
      if (lead) {
        const selZ = visualZ(lead.lateralPositionM);
        const target = new THREE.Vector3(lead.position + 20, 0.5, selZ);
        const desiredPosition = new THREE.Vector3(lead.position - cameraDistance, 26, selZ + 34);
        const blend = 1 - Math.pow(0.0008, Math.min(delta, 0.05));
        cameraPosition.lerp(desiredPosition, blend);
        cameraTarget.lerp(target, blend);
        camera.position.copy(cameraPosition);
        camera.lookAt(cameraTarget);
        return;
      }
    }

    if (currentMode === 'orbit') {
      const target = new THREE.Vector3(cameraTarget.x || ROAD_LENGTH / 2, 0, cameraTarget.z || VISUAL_ROAD_CENTER_Z);
      const desiredPosition = new THREE.Vector3(
        target.x + Math.cos(orbitAngle) * cameraDistance,
        36 + cameraDistance * orbitPitch * 0.35,
        target.z + Math.sin(orbitAngle) * cameraDistance
      );
      const blend = 1 - Math.pow(0.0008, Math.min(delta, 0.05));
      cameraPosition.lerp(desiredPosition, blend);
      cameraTarget.lerp(target, blend);
      camera.position.copy(cameraPosition);
      camera.lookAt(cameraTarget);
      return;
    }

    // cinematic
    const t = performance.now() * 0.00005;
    const target = new THREE.Vector3(lookX + Math.sin(t) * 40, 0.4, VISUAL_ROAD_CENTER_Z);
    const desiredPosition = new THREE.Vector3(target.x - 95, 42, VISUAL_ROAD_MAX_Z + 40);
    const blend = 1 - Math.pow(0.0008, Math.min(delta, 0.05));
    cameraPosition.lerp(desiredPosition, blend);
    cameraTarget.lerp(target, blend);
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
  }

  let lastBarrierKey = '';

  function updateBarrier() {
    const position = frame?.barrierPositionM;
    const scenario = frame?.scenario || 'busy';
    const closedLane = frame?.closedLane;
    const key = `${scenario}|${closedLane}|${position ?? ''}`;
    if (key !== lastBarrierKey) {
      rebuildBarrier(scenario, closedLane);
      lastBarrierKey = key;
    }
    barrierGroup.visible = (scenario === 'partial' || scenario === 'closure') && position !== null && position !== undefined;
    if (barrierGroup.visible) {
      barrierGroup.position.set(position, 0, 0);
      barrierGroup.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    }
    if (glowMaterial) glowMaterial.opacity = 0.45 + Math.sin(performance.now() * 0.01) * 0.35;
  }

  function render(now = performance.now()) {
    if (!initialized) return;
    const delta = lastTime ? (now - lastTime) / 1000 : 0.016;
    lastTime = now;
    if (!frozen) {
      updateCamera(delta);
      updateVehicles(delta);
      updateBarrier();
      updateTrails();
      updateCrashMoment();
    }
    if (speedLabel?.visible) {
      const p = speedLabel.position.clone().project(camera);
      const x = (p.x * 0.5 + 0.5) * canvas.clientWidth;
      const y = (-p.y * 0.5 + 0.5) * canvas.clientHeight;
      speedLabel.element.style.transform = `translate(${x}px, ${y - 24}px)`;
      speedLabel.element.style.display = p.z < 1 ? 'block' : 'none';
    } else if (speedLabel?.element) {
      speedLabel.element.style.display = 'none';
    }
    if (eventLabel?.visible) {
      const p = eventLabel.position.clone().project(camera);
      const x = (p.x * 0.5 + 0.5) * canvas.clientWidth;
      const y = (-p.y * 0.5 + 0.5) * canvas.clientHeight;
      eventLabel.element.style.transform = `translate(${x}px, ${y - 20}px)`;
      eventLabel.element.style.display = p.z < 1 ? 'block' : 'none';
    } else if (eventLabel?.element) {
      eventLabel.element.style.display = 'none';
    }
    renderer.render(scene, camera);
    if (now - fpsStart > 1500) {
      const fps = fpsFrames * 1000 / Math.max(1, now - fpsStart);
      if (fps < 22 && active) {
        enableLowGraphics(true);
        setActive(false);
      } else if (fps < 32) {
        enableLowGraphics(true);
      }
      fpsStart = now;
      fpsFrames = 0;
    }
    fpsFrames += 1;
    animationFrame = requestAnimationFrame(render);
  }

  function enableLowGraphics(value) {
    lowGraphics = value;
    if (lowGraphicsToggle) lowGraphicsToggle.setAttribute('aria-pressed', String(value));
    renderer?.setPixelRatio(value ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    if (renderer) {
      renderer.shadowMap.enabled = !value;
    }
  }

  function buildScene() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (error) {
      view3d.disabled = true;
      view3d.title = '3D is unavailable in this browser';
      return false;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xE8ECF1);
    scene.fog = new THREE.Fog(0xE8ECF1, 320, 900);
    worldGroup = new THREE.Group();
    scene.add(worldGroup);
    perspCamera = new THREE.PerspectiveCamera(44, 2, 0.1, 1200);
    orthoCamera = new THREE.OrthographicCamera(-TOP_FRUSTUM_WIDTH / 2, TOP_FRUSTUM_WIDTH / 2, 40, -40, 0.1, 2000);
    camera = perspCamera;
    scene.add(new THREE.HemisphereLight(0xcfe2f3, 0x1a2a1f, 1.15));
    const keyLight = new THREE.DirectionalLight(0xfff0d6, 3.0);
    keyLight.position.set(-80, 140, 70);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -320; keyLight.shadow.camera.right = 320;
    keyLight.shadow.camera.top = 120; keyLight.shadow.camera.bottom = -120;
    keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 550;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x9ec5e6, 0.7);
    fillLight.position.set(120, 60, -80);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffd8a8, 0.35);
    rimLight.position.set(200, 40, -120);
    scene.add(rimLight);
    addRoad();
    addProps();
    addBarrier();
    createVehicleLayers();
    trailGroup = new THREE.Group();
    worldGroup.add(trailGroup);
    selectedOutline = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.08, 32), new THREE.MeshBasicMaterial({ color: 0x5ac1bd, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    selectedOutline.rotation.x = -Math.PI / 2;
    selectedOutline.visible = false;
    worldGroup.add(selectedOutline);
    speedLabel = makeLabel('', 'flowline-3d-label');
    eventLabel = makeLabel('', 'flowline-3d-event');
    eventLabel.visible = false;
    flashRing = new THREE.Mesh(new THREE.RingGeometry(3, 3.35, 32), new THREE.MeshBasicMaterial({ color: 0xff6857, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    flashRing.rotation.x = -Math.PI / 2;
    flashRing.visible = false;
    worldGroup.add(flashRing);
    initialized = true;
    enableLowGraphics(false);
    return true;
  }

  function resize() {
    if (!initialized) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    renderer.setSize(bounds.width, bounds.height, false);
    const aspect = bounds.width / bounds.height;
    perspCamera.aspect = aspect;
    perspCamera.updateProjectionMatrix();

    const frustumWidth = currentMode === 'top' ? TOP_FRUSTUM_WIDTH : ROAD_LENGTH + 30;
    const frustumHeight = Math.max(VISUAL_ROAD_WIDTH + 24, frustumWidth / aspect);
    orthoCamera.left = -frustumWidth / 2;
    orthoCamera.right = frustumWidth / 2;
    orthoCamera.top = frustumHeight / 2;
    orthoCamera.bottom = -frustumHeight / 2;
    orthoCamera.updateProjectionMatrix();
  }

  function setMode(mode) {
    currentMode = mode;
    modeButtons.forEach((control) => {
      const active = control.dataset['3dMode'] === mode;
      control.classList.toggle('is-active', active);
      control.setAttribute('aria-pressed', String(active));
    });
    const top = mode === 'top';
    camera = top ? orthoCamera : perspCamera;
    if (worldGroup) worldGroup.scale.set(1, 1, 1);
    cameraControls.enableRotate = !top;
    cameraControls.object.up.set(0, top ? 0 : 1, top ? -1 : 0);
    resize();
  }

  function setActive(value) {
    active = !!value;
    if (active) resize();
    if (initialized && !animationFrame) {
      fpsStart = performance.now();
      animationFrame = requestAnimationFrame(render);
    }
  }

  function renderFrame(nextFrame) {
    frame = nextFrame;
  }

  function selectVehicleById(id) {
    if (!frame) return;
    const hit = frame.vehicles?.find((v) => v.id === id);
    if (!hit) return;
    const additive = false;
    if (window.__flowline2d?.applySelection) {
      window.__flowline2d.applySelection([id], additive);
      return;
    }
    frame.selectedVehicleIds = [id];
  }

  modeButtons.forEach((control) => control.addEventListener('click', () => setMode(control.dataset['3dMode'])));
  lowGraphicsToggle?.addEventListener('click', () => enableLowGraphics(lowGraphicsToggle.getAttribute('aria-pressed') !== 'true'));
  freezeToggle?.addEventListener('click', () => {
    frozen = !frozen;
    freezeToggle.setAttribute('aria-pressed', String(frozen));
    freezeToggle.textContent = frozen ? 'Resume frame' : 'Freeze frame';
  });
  trailsToggle?.addEventListener('click', () => {
    const enabled = trailsToggle.getAttribute('aria-pressed') !== 'true';
    trailsToggle.setAttribute('aria-pressed', String(enabled));
  });
  view2d.addEventListener('click', () => setActive(false));
  view3d.addEventListener('click', () => {
    if (!initialized && !buildScene()) return;
    setActive(true);
  });
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerDown = null;

  canvas.addEventListener('pointerdown', (event) => {
    pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId };
    cameraDragging = currentMode === 'orbit' || currentMode === 'top';
    previousPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!cameraDragging || !previousPointer) return;
    if (currentMode === 'top') {
      const bounds = canvas.getBoundingClientRect();
      const worldPerPx = TOP_FRUSTUM_WIDTH / Math.max(1, bounds.width);
      topPanX -= (event.clientX - previousPointer.x) * worldPerPx;
      topPanX = Math.max(TOP_FRUSTUM_WIDTH / 2, Math.min(ROAD_LENGTH - TOP_FRUSTUM_WIDTH / 2, topPanX));
      previousPointer = { x: event.clientX, y: event.clientY };
      return;
    }
    orbitAngle -= (event.clientX - previousPointer.x) * 0.008;
    orbitPitch = Math.max(0.1, Math.min(1.25, orbitPitch + (event.clientY - previousPointer.y) * 0.006));
    previousPointer = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', (event) => {
    const wasDrag = pointerDown && (Math.abs(event.clientX - pointerDown.x) > 4 || Math.abs(event.clientY - pointerDown.y) > 4);
    cameraDragging = false; previousPointer = null;
    if (wasDrag || !frame || !initialized) { pointerDown = null; return; }
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const candidates = [];
    for (const kind of Object.keys(vehiclePools)) {
      for (const g of vehiclePools[kind]) { if (g.visible) candidates.push(g); }
    }
    const hits = raycaster.intersectObjects(candidates, true);
    if (hits.length) {
      let obj = hits[0].object;
      while (obj && obj.userData?.vehicleId === undefined) obj = obj.parent;
      if (obj?.userData?.vehicleId !== undefined) selectVehicleById(obj.userData.vehicleId);
    }
    pointerDown = null;
  });
  canvas.addEventListener('wheel', (event) => {
    if (currentMode === 'orbit') {
      cameraDistance = Math.max(28, Math.min(180, cameraDistance + event.deltaY * 0.08));
      event.preventDefault();
    } else if (currentMode === 'top') {
      topPanX += event.deltaY * 0.15;
      topPanX = Math.max(TOP_FRUSTUM_WIDTH / 2, Math.min(ROAD_LENGTH - TOP_FRUSTUM_WIDTH / 2, topPanX));
      event.preventDefault();
    }
  }, { passive: false });
  function syncToPanelVisibility() {
    const panel3d = canvas.closest('.viewport-panel');
    const visible = !!(panel3d && !panel3d.classList.contains('hidden') && canvas.getClientRects().length > 0);
    setActive(visible);
  }

  window.addEventListener('resize', () => { resize(); syncToPanelVisibility(); });
    if (buildScene()) {
      setMode('chase');
      window.flowline3d = {
        renderFrame, setActive, syncToPanelVisibility, selectVehicleById,
        setMode,
        getCameraState: () => ({
          mode: currentMode,
          type: camera?.isOrthographicCamera ? 'orthographic' : 'perspective',
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
          target: { x: cameraTarget.x, y: cameraTarget.y, z: cameraTarget.z },
          controlsEnableRotate: cameraControls.enableRotate,
          worldGroupScale: worldGroup ? { x: worldGroup.scale.x, y: worldGroup.scale.y, z: worldGroup.scale.z } : null
        }),
        // Research/debug: verify rendered world Box3 against sim footprint.
        getVehicleBox: (id) => {
          for (const kind of Object.keys(vehiclePools)) {
            for (const g of vehiclePools[kind]) {
              if (g.visible && g.userData.vehicleId === id) {
                const box = new THREE.Box3().setFromObject(g);
                const size = new THREE.Vector3();
                const center = new THREE.Vector3();
                box.getSize(size); box.getCenter(center);
                return { size: { x: size.x, y: size.y, z: size.z }, center: { x: center.x, y: center.y, z: center.z } };
              }
            }
          }
          return null;
        },
        constants: { ROAD_LENGTH, LANE_WIDTH_M, SUBLANE_COUNT, LANE_COUNT, VISUAL_LANE_WIDTH, VISUAL_ROAD_WIDTH, VISUAL_ROAD_MIN_Z, VISUAL_ROAD_MAX_Z, VISUAL_ROAD_CENTER_Z, TOP_FRUSTUM_WIDTH }
      };
      const panel3d = canvas.closest('.viewport-panel');
      if ('ResizeObserver' in window && panel3d) new ResizeObserver(() => { resize(); syncToPanelVisibility(); }).observe(panel3d);
      if (panel3d && 'MutationObserver' in window) new MutationObserver(syncToPanelVisibility).observe(panel3d, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
      window.dispatchEvent(new Event('flowline3dready'));
      syncToPanelVisibility();
    }
})();


