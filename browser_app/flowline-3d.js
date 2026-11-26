import * as THREE from './vendor/three.module.min.js';

(() => {
  'use strict';

  const canvas = document.getElementById('microRoad3d');
  const roadWrap = canvas?.closest('.micro-road-wrap');
  const view2d = document.getElementById('microView2d');
  const view3d = document.getElementById('microView3d');
  if (!canvas || !roadWrap || !view2d || !view3d) return;

  const ROAD_LENGTH = 500;
  const LANE_WIDTH_M = 4;
  const LANE_COUNT = 2;
  const ROAD_WIDTH = LANE_COUNT * LANE_WIDTH_M;
  const ROAD_CENTER_Z = ((LANE_COUNT - 1) * LANE_WIDTH_M) / 2;
  const PALETTES = {
    car: [0x4F86C6, 0x3FB28A, 0xD97706, 0xC75C5C, 0x7C6FD6, 0x2F855A, 0xB45309, 0x64748B],
    motorcycle: [0xE6BB72, 0xD97706],
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
  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let renderer, camera, scene;
  let initialized = false, active = false, frame = null;
  let animationFrame = 0, lastTime = 0, fpsStart = 0, fpsFrames = 0;
  let lowGraphics = false, frozen = false, currentMode = 'chase';
  let cameraDistance = 70, orbitAngle = 0.32, orbitPitch = 0.55;
  let cameraTarget = new THREE.Vector3(250, 0, 0);
  let cameraPosition = new THREE.Vector3(195, 38, 42);
  let cameraDragging = false, previousPointer = null;
  let selectedOutline, speedLabel, eventLabel, flashRing;
  let barrierGroup, trailGroup, propGroup, roadGroup;
  let glowMaterial, contactShadows;
  let lastTrailFrame;
  const trailPool = [];
  const trailMaterials = new Map();
  let trailGeometry;
  const dummy = new THREE.Object3D();
  
  // Vehicle detail caches
  const MAX_VEHICLES = 260;
  const vehiclePools = {};
  const wheelRadiusByKind = { car: 0.34, motorcycle: 0.26, rickshaw: 0.3, bus: 0.5, truck: 0.52 };
  const prevLateral = new Map();
  const controls = Array.from(document.querySelectorAll('[data-3d-mode]'));
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

  function addRoad() {
    roadGroup = new THREE.Group();
    const asphalt = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_LENGTH, 0.18, ROAD_WIDTH),
      new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.92, metalness: 0.02 })
    );
    asphalt.position.set(250, -0.12, ROAD_CENTER_Z);
    asphalt.receiveShadow = true;
    roadGroup.add(asphalt);
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(ROAD_LENGTH, 0.12, ROAD_WIDTH + 10), material(0x9BA7B0, 0.95));
    shoulder.position.set(250, -0.25, ROAD_CENTER_Z);
    shoulder.receiveShadow = true;
    roadGroup.add(shoulder);
    for (const z of [-2, 6]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(ROAD_LENGTH, 0.04, 0.14), material(0xF3F4F6, 0.55));
      edge.position.set(250, 0.02, z);
      roadGroup.add(edge);
    }
    const lineMaterial = material(0xF7F8FA, 0.45);
    for (let x = 5; x < ROAD_LENGTH; x += 16) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(8, 0.035, 0.09), lineMaterial);
      dash.position.set(x, 0.03, 2);
      roadGroup.add(dash);
    }
    const sublaneMaterial = new THREE.MeshBasicMaterial({ color: 0xDCE3DF, transparent: true, opacity: 0.22 });
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const laneCenter = lane * LANE_WIDTH_M;
      for (let track = 1; track < 4; track += 1) {
        const z = laneCenter - LANE_WIDTH_M / 2 + (LANE_WIDTH_M * track) / 4;
        for (let x = 4; x < ROAD_LENGTH; x += 13) {
          const dash = new THREE.Mesh(new THREE.BoxGeometry(5, 0.02, 0.04), sublaneMaterial);
          dash.position.set(x, 0.025, z);
          roadGroup.add(dash);
        }
      }
    }
    for (const z of [-4.5, 8.5]) {
      const verge = new THREE.Mesh(new THREE.BoxGeometry(ROAD_LENGTH, 0.16, 5), material(0xB8C2CC, 0.95));
      verge.position.set(250, -0.22, z);
      verge.receiveShadow = true;
      roadGroup.add(verge);
    }
    scene.add(roadGroup);
  }

  function addProps() {
    propGroup = new THREE.Group();
    const poleGeometry = new THREE.CylinderGeometry(0.06, 0.08, 1.1, 8);
    const poleMat = material(0x9AA6B0, 0.65, 0, 0.1);
    for (let i = 0; i < 16; i += 1) {
      const x = 15 + i * 32;
      for (const z of [-5.5, 9.5]) {
        const pole = new THREE.Mesh(poleGeometry, poleMat);
        pole.position.set(x, 0.55, z);
        pole.receiveShadow = true;
        propGroup.add(pole);
      }
    }
    scene.add(propGroup);
  }

  function addBarrier() {
    barrierGroup = new THREE.Group();
    const striped = material(0xe5a34d);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.18), material(0x293b40));
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.28, 4), striped);
    board.position.y = 1.25;
    barrierGroup.add(post.clone(), post.clone(), board);
    barrierGroup.children[0].position.set(0, 0.7, -1.7);
    barrierGroup.children[1].position.set(0, 0.7, 1.7);
    for (let z = -1.5; z <= 1.5; z += 0.75) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.45), material(Math.round(z / 0.75) % 2 === 0 ? 0xf2e5b3 : 0x26343d));
      stripe.position.set(-0.15, 1.25, z);
      barrierGroup.add(stripe);
    }
    for (const z of [-1.2, 1.2]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 6), material(0xe77335));
      cone.position.set(-0.8, 0.38, z);
      barrierGroup.add(cone);
    }
    glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffb52e, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
    const amber = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), glowMaterial);
    amber.position.set(-0.3, 1.65, 0);
    barrierGroup.add(amber);
    barrierGroup.visible = false;
    scene.add(barrierGroup);
  }

  function vehicleGeometry(kind, length, width) { return new THREE.BoxGeometry(length, 1, width); }

  function makeVehicleGroup(kind) {
    const group = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({
      color: COLORS[kind], roughness: 0.35, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xa8c8d8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45, transmission: 0.2
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.8, metalness: 0.1 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.2, metalness: 0.9 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff4cc });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });

    const wheelGeo = new THREE.CylinderGeometry(wheelRadiusByKind[kind], wheelRadiusByKind[kind], kind === 'motorcycle' ? 0.18 : 0.22, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.95, metalness: 0.05 });
    const rimGeo = new THREE.CylinderGeometry(wheelRadiusByKind[kind] * 0.55, wheelRadiusByKind[kind] * 0.55, kind === 'motorcycle' ? 0.2 : 0.24, 12);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb0bec5, roughness: 0.25, metalness: 0.85 });

    const wheels = [];
    const addWheel = (x, y, z) => {
      const w = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      w.add(tire, rim);
      w.position.set(x, y, z);
      group.add(w);
      wheels.push(w);
    };

    let body;
    if (kind === 'car') {
      body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.15, 1.85), paint);
      body.position.y = 0.72;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 1.65), paint);
      cabin.position.set(-0.2, 1.45, 0);
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 1.5), glass);
      windshield.position.set(0.72, 1.45, 0);
      windshield.rotation.z = -0.35;
      const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 1.45), glass);
      rearGlass.position.set(-1.15, 1.42, 0);
      rearGlass.rotation.z = 0.35;
      const sideGlassL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.05), glass);
      sideGlassL.position.set(-0.2, 1.42, 0.82);
      const sideGlassR = sideGlassL.clone(); sideGlassR.position.z = -0.82;
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.35), lightMat);
      hl.position.set(2.08, 0.72, 0.55);
      const hr = hl.clone(); hr.position.z = -0.55;
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.35), tailMat);
      tl.position.set(-2.08, 0.72, 0.55); tl.name = 'tailL';
      const tr = tl.clone(); tr.position.z = -0.55; tr.name = 'tailR';
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 1.7), dark);
      bumper.position.set(2.1, 0.45, 0);
      const bumperR = bumper.clone(); bumperR.position.x = -2.1;
      group.add(body, cabin, windshield, rearGlass, sideGlassL, sideGlassR, hl, hr, tl, tr, bumper, bumperR);
      addWheel(1.35, 0.34, 0.82); addWheel(1.35, 0.34, -0.82);
      addWheel(-1.35, 0.34, 0.82); addWheel(-1.35, 0.34, -0.82);
    } else if (kind === 'motorcycle') {
      body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 0.55), paint);
      body.position.y = 0.72;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.5), dark);
      seat.position.set(-0.3, 0.98, 0);
      const tank = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.45), paint);
      tank.position.set(0.25, 0.95, 0);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.9), chrome);
      handle.position.set(0.75, 1.1, 0);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), lightMat);
      hl.position.set(1.0, 0.85, 0);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.15), tailMat);
      tl.position.set(-1.0, 0.75, 0); tl.name = 'tailL';
      group.add(body, seat, tank, handle, hl, tl);
      addWheel(0.75, 0.26, 0); addWheel(-0.75, 0.26, 0);
    } else if (kind === 'bus') {
      body = new THREE.Mesh(new THREE.BoxGeometry(11, 2.6, 2.5), paint);
      body.position.y = 1.55;
      const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 2.2), glass);
      frontGlass.position.set(5.48, 1.9, 0);
      for (let i = -4; i <= 4; i += 2) {
        const wL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.05), glass);
        wL.position.set(i * 1.0, 1.9, 1.26);
        const wR = wL.clone(); wR.position.z = -1.26;
        group.add(wL, wR);
      }
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.4), lightMat);
      hl.position.set(5.5, 0.8, 0.8);
      const hr = hl.clone(); hr.position.z = -0.8;
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.45), tailMat);
      tl.position.set(-5.5, 0.9, 0.85); tl.name = 'tailL';
      const tr = tl.clone(); tr.position.z = -0.85; tr.name = 'tailR';
      group.add(body, frontGlass, hl, hr, tl, tr);
      addWheel(3.8, 0.5, 1.15); addWheel(3.8, 0.5, -1.15);
      addWheel(-3.2, 0.5, 1.15); addWheel(-3.2, 0.5, -1.15);
    } else if (kind === 'truck') {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.2, 2.4), paint);
      cab.position.set(2.8, 1.35, 0);
      group.userData.cabPaint = paint;
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.0, 2.35), new THREE.MeshStandardMaterial({ color: 0x88939a, roughness: 0.6, metalness: 0.2 }));
      cargo.position.set(-1.5, 1.35, 0);
      const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 2.0), glass);
      cabGlass.position.set(4.18, 1.75, 0);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.35), lightMat);
      hl.position.set(4.2, 0.75, 0.8);
      const hr = hl.clone(); hr.position.z = -0.8;
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.4), tailMat);
      tl.position.set(-4.25, 0.8, 0.85); tl.name = 'tailL';
      const tr = tl.clone(); tr.position.z = -0.85; tr.name = 'tailR';
      group.add(cab, cargo, cabGlass, hl, hr, tl, tr);
      addWheel(3.0, 0.52, 1.1); addWheel(3.0, 0.52, -1.1);
      addWheel(-2.8, 0.52, 1.1); addWheel(-2.8, 0.52, -1.1);
    } else { // rickshaw
      body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 1.4), paint);
      body.position.y = 0.85;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 1.45), dark);
      roof.position.set(-0.1, 1.65, 0);
      const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 1.2), glass);
      frontGlass.position.set(0.95, 1.25, 0);
      frontGlass.rotation.z = -0.2;
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), lightMat);
      hl.position.set(1.32, 0.7, 0);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.2), tailMat);
      tl.position.set(-1.3, 0.75, 0.45); tl.name = 'tailL';
      const tr = tl.clone(); tr.position.z = -0.45; tr.name = 'tailR';
      group.add(body, roof, frontGlass, hl, tl, tr);
      addWheel(0.9, 0.3, 0); addWheel(-0.8, 0.3, 0.55); addWheel(-0.8, 0.3, -0.55);
    }

    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.userData.wheels = wheels;
    group.userData.tailL = group.getObjectByName('tailL');
    group.userData.tailR = group.getObjectByName('tailR');
    group.userData.paint = paint;
    group.userData.cabPaint = (kind === 'truck') ? group.userData.cabPaint : paint;
    group.userData.baseY = 0;
    group.visible = false;
    return group;
  }

  function createVehicleLayers() {
    contactShadows = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 10),
      new THREE.MeshBasicMaterial({ color: 0x071116, transparent: true, opacity: 0.35, depthWrite: false }),
      MAX_VEHICLES
    );
    contactShadows.rotation.x = -Math.PI / 2;
    contactShadows.position.y = 0.01;
    scene.add(contactShadows);

    for (const kind of Object.keys(COLORS)) {
      vehiclePools[kind] = [];
      for (let i = 0; i < 60; i++) {
        const g = makeVehicleGroup(kind);
        vehiclePools[kind].push(g);
        scene.add(g);
      }
    }
  }

  function updateVehicles(delta) {
    // Hide all pooled vehicles
    for (const kind of Object.keys(vehiclePools)) {
      for (const g of vehiclePools[kind]) g.visible = false;
    }
    contactShadows.count = 0;
    if (!frame) return;

    const indexes = { car: 0, motorcycle: 0, rickshaw: 0, bus: 0, truck: 0 };
    let shadowIndex = 0;

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

      const BASE_DIMS = {
        car:        { length: 4.2,  width: 1.85 },
        motorcycle: { length: 2.0,  width: 0.55 },
        rickshaw:   { length: 2.6,  width: 1.4  },
        bus:        { length: 11.0, width: 2.5  },
        truck:      { length: 8.45, width: 2.4  }
      };
      const base = BASE_DIMS[vehicle.kind] || { length: vehicle.length || 4, width: vehicle.width || 1.8 };
      const sx = vehicle.length / base.length;
      const sz = vehicle.width / base.width;
      g.scale.set(sx, 1, sz);

      // Smooth lateral interpolation for realistic lane changes
      const prev = prevLateral.has(vehicle.id) ? prevLateral.get(vehicle.id) : vehicle.lateralPositionM;
      const lateralSmooth = prev + (vehicle.lateralPositionM - prev) * Math.min(1, delta * 8);
      prevLateral.set(vehicle.id, lateralSmooth);

      // Body roll/tilt on lane change, pitch on accel/brake
      const lateralVel = (vehicle.lateralPositionM - prev) * 2;
      const pitch = Math.max(-0.03, Math.min(0.03, -(vehicle.acceleration || 0) * 0.008));
      g.position.set(vehicle.position, 0.02, lateralSmooth);
      g.rotation.y = -lateralVel * 0.04;
      g.rotation.z = -lateralVel * 0.018;
      g.rotation.x = pitch;

      // Wheel rotation
      const speed = vehicle.speed || 0;
      const radius = wheelRadiusByKind[vehicle.kind] || 0.35;
      const rotDelta = (speed / Math.max(0.1, radius)) * delta;
      for (const w of g.userData.wheels) w.rotation.x += rotDelta;

      // Brake lights
      const braking = vehicle.acceleration < -0.5;
      const tailColor = braking ? 0xff1a00 : 0x661111;
      if (g.userData.tailL) { g.userData.tailL.material.color.setHex(tailColor); }
      if (g.userData.tailR) { g.userData.tailR.material.color.setHex(tailColor); }

      // Contact shadow
      dummy.position.set(vehicle.position, 0.015, lateralSmooth);
      dummy.scale.set(Math.max(1.5, vehicle.length * 0.55), Math.max(0.4, vehicle.width * 0.55), 1);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      contactShadows.setMatrixAt(shadowIndex, dummy.matrix);
      shadowIndex++;
    }

    contactShadows.count = shadowIndex;
    contactShadows.instanceMatrix.needsUpdate = true;

    const selected = frame.vehicles.find((vehicle) => frame.selectedVehicleIds.includes(vehicle.id));
    if (selected) {
      const selLat = prevLateral.has(selected.id) ? prevLateral.get(selected.id) : selected.lateralPositionM;
      selectedOutline.visible = true;
      selectedOutline.position.set(selected.position, 0.08, selLat);
      selectedOutline.scale.set(Math.max(1.2, selected.length / 2), 1, Math.max(1.2, selected.width));
      speedLabel.visible = true;
      speedLabel.position.set(selected.position, 3.2, selLat);
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
      trail.position.set(vehicle.position - Math.min(4, 1.5 + speed / 35), 0.045, lat);
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
    let target = new THREE.Vector3(250, 0, 0);
    let desiredPosition = new THREE.Vector3(175, 42, 52);
    if (currentMode === 'chase' && selected) {
      target.set(selected.position + 22, 1.2, selected.lateralPositionM);
      desiredPosition.set(selected.position - cameraDistance, 22, selected.lateralPositionM + 28);
    } else if (currentMode === 'top') {
      target.set(250, 0, 2);
      desiredPosition.set(250, 180, 2.01);
    } else if (currentMode === 'orbit') {
      target = cameraTarget.clone();
      desiredPosition.set(target.x + Math.cos(orbitAngle) * cameraDistance, 28 + cameraDistance * orbitPitch * 0.45, target.z + Math.sin(orbitAngle) * cameraDistance);
    } else {
      target.set(250 + Math.sin(performance.now() * 0.00005) * 60, 1, 0);
      desiredPosition.set(target.x - 80, 34, 42);
    }
    const blend = 1 - Math.pow(0.0008, Math.min(delta, 0.05));
    cameraPosition.lerp(desiredPosition, blend);
    cameraTarget.lerp(target, blend);
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
  }

  function updateBarrier() {
    const position = frame?.barrierPositionM;
    barrierGroup.visible = position !== null && position !== undefined;
    if (barrierGroup.visible) {
      let laneCenter = ROAD_CENTER_Z;
      if (frame?.scenario === 'partial') {
        const closed = Number(frame?.closedLane);
        if (closed === 0 || closed === 1) laneCenter = closed * LANE_WIDTH_M;
      }
      barrierGroup.position.set(position, 0, laneCenter);
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
    camera = new THREE.PerspectiveCamera(44, 2, 0.1, 900);
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
    scene.add(trailGroup);
    selectedOutline = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.08, 32), new THREE.MeshBasicMaterial({ color: 0x5ac1bd, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    selectedOutline.rotation.x = -Math.PI / 2;
    selectedOutline.visible = false;
    scene.add(selectedOutline);
    speedLabel = makeLabel('', 'flowline-3d-label');
    eventLabel = makeLabel('', 'flowline-3d-event');
    eventLabel.visible = false;
    flashRing = new THREE.Mesh(new THREE.RingGeometry(3, 3.35, 32), new THREE.MeshBasicMaterial({ color: 0xff6857, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    flashRing.rotation.x = -Math.PI / 2;
    flashRing.visible = false;
    scene.add(flashRing);
    initialized = true;
    enableLowGraphics(false);
    return true;
  }

  function resize() {
    if (!initialized) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    renderer.setSize(bounds.width, bounds.height, false);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
  }

  function setMode(mode) {
    currentMode = mode;
    controls.forEach((control) => control.classList.toggle('is-active', control.dataset['3dMode'] === mode));
  }

  function setActive(value) {
    active = !!value;
    if (active) {
      resize();
      if (!animationFrame) {
        fpsStart = performance.now();
        animationFrame = requestAnimationFrame(render);
      }
    }
  }

  function renderFrame(nextFrame) {
    frame = nextFrame;
  }

  controls.forEach((control) => control.addEventListener('click', () => setMode(control.dataset['3dMode'])));
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
  canvas.addEventListener('pointerdown', (event) => {
    cameraDragging = currentMode === 'orbit';
    previousPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!cameraDragging || !previousPointer) return;
    orbitAngle -= (event.clientX - previousPointer.x) * 0.008;
    orbitPitch = Math.max(0.1, Math.min(1.25, orbitPitch + (event.clientY - previousPointer.y) * 0.006));
    previousPointer = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', () => { cameraDragging = false; previousPointer = null; });
  canvas.addEventListener('wheel', (event) => {
    if (currentMode === 'orbit') {
      cameraDistance = Math.max(28, Math.min(180, cameraDistance + event.deltaY * 0.08));
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
    window.flowline3d = { renderFrame, setActive, syncToPanelVisibility };
    const panel3d = canvas.closest('.viewport-panel');
    if ('ResizeObserver' in window && panel3d) new ResizeObserver(() => { resize(); syncToPanelVisibility(); }).observe(panel3d);
    if (panel3d && 'MutationObserver' in window) new MutationObserver(syncToPanelVisibility).observe(panel3d, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.dispatchEvent(new Event('flowline3dready'));
    syncToPanelVisibility();
  }
})();


