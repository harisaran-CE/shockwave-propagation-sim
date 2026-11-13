import * as THREE from './vendor/three.module.min.js';

(() => {
  'use strict';

  const canvas = document.getElementById('microRoad3d');
  const roadWrap = canvas?.closest('.micro-road-wrap');
  const view2d = document.getElementById('microView2d');
  const view3d = document.getElementById('microView3d');
  if (!canvas || !roadWrap || !view2d || !view3d) return;

  const ROAD_LENGTH = 500;
  const ROAD_WIDTH = 18;
  const COLORS = {
    car: 0x80c4a4, motorcycle: 0xe6bb72, rickshaw: 0xd8a951,
    bus: 0x7cabc0, truck: 0xac9d89
  };
  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  let camera;
  let scene;
  let initialized = false;
  let active = false;
  let frame = null;
  let animationFrame = 0;
  let lastTime = 0;
  let fpsStart = 0;
  let fpsFrames = 0;
  let lowGraphics = false;
  let frozen = false;
  let currentMode = 'chase';
  let cameraDistance = 70;
  let orbitAngle = 0.32;
  let orbitPitch = 0.55;
  let cameraTarget = new THREE.Vector3(250, 0, 0);
  let cameraPosition = new THREE.Vector3(195, 38, 42);
  let cameraDragging = false;
  let previousPointer = null;
  let selectedOutline;
  let speedLabel;
  let eventLabel;
  let flashRing;
  let barrierGroup;
  let trailGroup;
  let vehicleLayers = {};
  let propGroup;
  let roadGroup;
  let glowMaterial;
  let contactShadows;
  let headlights;
  let taillights;
  let lastTrailFrame;
  const trailPool = [];
  const trailMaterials = new Map();
  let trailGeometry;
  const dummy = new THREE.Object3D();
  const tempColor = new THREE.Color();

  const controls = Array.from(document.querySelectorAll('[data-3d-mode]'));
  const lowGraphicsToggle = document.querySelector('[data-3d-low-graphics]');
  const trailsToggle = document.querySelector('[data-3d-trails]');
  const freezeToggle = document.querySelector('[data-3d-freeze]');

  function material(color, roughness = 0.72, emissive = 0) {
    return new THREE.MeshStandardMaterial({
      color, roughness, metalness: 0.08, emissive, emissiveIntensity: emissive ? 2 : 0
    });
  }

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
      new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.95 })
    );
    asphalt.position.set(250, -0.12, 0);
    roadGroup.add(asphalt);
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(ROAD_LENGTH, 0.12, 28), material(0x26343d));
    shoulder.position.set(250, -0.25, 0);
    roadGroup.add(shoulder);
    for (const z of [-9, 9]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(ROAD_LENGTH, 0.04, 0.14), material(0xe4ddbd));
      edge.position.set(250, 0.02, z);
      roadGroup.add(edge);
    }
    for (const z of [-4.5, 0, 4.5]) {
      const lineMaterial = material(0xf0f0dc);
      for (let x = 5; x < ROAD_LENGTH; x += 16) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(8, 0.035, 0.09), lineMaterial);
        dash.position.set(x, 0.03, z);
        roadGroup.add(dash);
      }
    }
    for (const z of [-13, 13]) {
      const verge = new THREE.Mesh(new THREE.BoxGeometry(ROAD_LENGTH, 0.16, 5), material(0x1d3a38));
      verge.position.set(250, -0.22, z);
      roadGroup.add(verge);
    }
    scene.add(roadGroup);
  }

  function addProps() {
    propGroup = new THREE.Group();
    const poleGeometry = new THREE.CylinderGeometry(0.08, 0.12, 5, 5);
    const poleMesh = new THREE.InstancedMesh(poleGeometry, material(0x5d7071), 28);
    const signGeometry = new THREE.BoxGeometry(1.7, 1.15, 0.08);
    const signMesh = new THREE.InstancedMesh(signGeometry, material(0x426e76), 14);
    for (let i = 0; i < 14; i += 1) {
      const x = 15 + i * 36;
      for (const z of [-15.5, 15.5]) {
        dummy.position.set(x, 2.5, z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        poleMesh.setMatrixAt(i * 2 + (z > 0 ? 1 : 0), dummy.matrix);
      }
      dummy.position.set(x + 2, 4, i % 2 ? -15.5 : 15.5);
      dummy.updateMatrix();
      signMesh.setMatrixAt(i, dummy.matrix);
    }
    propGroup.add(poleMesh, signMesh);
    scene.add(propGroup);
  }

  function addBarrier() {
    barrierGroup = new THREE.Group();
    const striped = material(0xe5a34d);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.18), material(0x293b40));
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.28, 8), striped);
    board.position.y = 1.25;
    barrierGroup.add(post.clone(), post.clone(), board);
    barrierGroup.children[0].position.set(0, 0.7, -3.4);
    barrierGroup.children[1].position.set(0, 0.7, 3.4);
    for (let z = -3; z <= 3; z += 1.5) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.45), material(z % 3 ? 0xf2e5b3 : 0x26343d));
      stripe.position.set(-0.15, 1.25, z);
      barrierGroup.add(stripe);
    }
    for (const z of [-7, 7]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 6), material(0xe77335));
      cone.position.set(0, 0.45, z);
      barrierGroup.add(cone);
    }
    glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffb52e, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
    const amber = new THREE.Mesh(new THREE.SphereGeometry(0.23, 8, 8), glowMaterial);
    amber.position.set(-0.3, 1.75, 0);
    barrierGroup.add(amber);
    barrierGroup.visible = false;
    scene.add(barrierGroup);
  }

  function vehicleGeometry(kind, length, width) {
    if (kind === 'motorcycle') return new THREE.CapsuleGeometry(width * 0.55, length * 0.55, 3, 6);
    if (kind === 'bus') return new THREE.BoxGeometry(length, 2.5, width);
    if (kind === 'truck') return new THREE.BoxGeometry(length, 2.15, width);
    if (kind === 'rickshaw') return new THREE.CylinderGeometry(width * 0.7, width * 0.8, length, 5);
    return new THREE.BoxGeometry(length, 1.25, width);
  }

  function createVehicleLayers() {
    const maxVehicles = 260;
    contactShadows = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 8),
      new THREE.MeshBasicMaterial({ color: 0x071116, transparent: true, opacity: 0.42, depthWrite: false }),
      maxVehicles
    );
    contactShadows.rotation.x = -Math.PI / 2;
    scene.add(contactShadows);
    headlights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.35, 0.08, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xfff0c2, transparent: true, opacity: 0.9 }),
      maxVehicles
    );
    taillights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.28, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff4238, transparent: true, opacity: 0.9, vertexColors: true }),
      maxVehicles
    );
    scene.add(headlights, taillights);
    for (const kind of Object.keys(COLORS)) {
      const geometry = vehicleGeometry(kind, kind === 'bus' ? 10 : kind === 'truck' ? 8 : kind === 'motorcycle' ? 2 : 4, kind === 'motorcycle' ? 0.8 : 2);
      const mesh = new THREE.InstancedMesh(geometry, material(COLORS[kind]), maxVehicles);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      vehicleLayers[kind] = mesh;
      scene.add(mesh);
    }
  }

  function updateVehicles() {
    for (const kind of Object.keys(vehicleLayers)) vehicleLayers[kind].count = 0;
    contactShadows.count = 0;
    headlights.count = 0;
    taillights.count = 0;
    if (!frame) return;
    const indexes = { car: 0, motorcycle: 0, rickshaw: 0, bus: 0, truck: 0 };
    let detailIndex = 0;
    for (const vehicle of frame.vehicles) {
      const mesh = vehicleLayers[vehicle.kind];
      if (!mesh || indexes[vehicle.kind] >= mesh.count + 260) continue;
      const index = indexes[vehicle.kind]++;
      const scale = vehicle.kind === 'bus' || vehicle.kind === 'truck' ? 1 : 1;
      dummy.position.set(vehicle.position, vehicle.kind === 'motorcycle' ? 0.65 : vehicle.kind === 'bus' ? 1.25 : 0.72, vehicle.lateralPositionM);
      dummy.scale.set(Math.max(0.6, vehicle.length / (vehicle.kind === 'bus' ? 10 : vehicle.kind === 'truck' ? 8 : vehicle.kind === 'motorcycle' ? 2 : 4)) * scale, 1, Math.max(0.6, vehicle.width / (vehicle.kind === 'motorcycle' ? 0.8 : 2)));
      dummy.rotation.set(0, Math.PI / 2, vehicle.kind === 'rickshaw' ? Math.PI / 2 : 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      const braking = vehicle.acceleration < -0.4;
      tempColor.set(braking ? 0xb83f3f : COLORS[vehicle.kind]);
      mesh.setColorAt(index, tempColor);
      dummy.position.set(vehicle.position, 0.04, vehicle.lateralPositionM);
      dummy.scale.set(Math.max(1.5, vehicle.length * 0.7), Math.max(0.35, vehicle.width * 0.65), 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      contactShadows.setMatrixAt(detailIndex, dummy.matrix);
      dummy.position.set(vehicle.position + vehicle.length * 0.45, 0.75, vehicle.lateralPositionM - vehicle.width * 0.3);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      headlights.setMatrixAt(detailIndex, dummy.matrix);
      dummy.position.x = vehicle.position - vehicle.length * 0.45;
      dummy.updateMatrix();
      taillights.setMatrixAt(detailIndex, dummy.matrix);
      tempColor.set(braking ? 0xff8a55 : 0xff4238);
      taillights.setColorAt(detailIndex, tempColor);
      detailIndex += 1;
    }
    for (const mesh of Object.values(vehicleLayers)) mesh.instanceMatrix.needsUpdate = true;
    contactShadows.count = detailIndex;
    headlights.count = detailIndex;
    taillights.count = detailIndex;
    contactShadows.instanceMatrix.needsUpdate = true;
    headlights.instanceMatrix.needsUpdate = true;
    taillights.instanceMatrix.needsUpdate = true;
    if (taillights.instanceColor) taillights.instanceColor.needsUpdate = true;
    const selected = frame.vehicles.find((vehicle) => frame.selectedVehicleIds.includes(vehicle.id));
    if (selected) {
      selectedOutline.visible = true;
      selectedOutline.position.set(selected.position, 0.08, selected.lateralPositionM);
      selectedOutline.scale.set(Math.max(1.2, selected.length / 2), 1, Math.max(1.2, selected.width));
      speedLabel.visible = true;
      speedLabel.position.set(selected.position, 3.2, selected.lateralPositionM);
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
    roadWrap.appendChild(element);
    return { element, position: new THREE.Vector3(), visible: true };
  }

  function updateCrashMoment() {
    const crash = frame?.crashes?.[frame.crashes.length - 1];
    if (!crash || !flashRing) return;
    flashRing.visible = true;
    flashRing.position.set(crash.impactPositionM, 0.12, 0);
    flashRing.scale.setScalar(1 + ((performance.now() / 120) % 1) * 2);
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
          color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending
        }));
      }
      const trail = trailPool[index] || new THREE.Mesh(trailGeometry, trailMaterials.get(color));
      if (!trailPool[index]) {
        trailPool.push(trail);
        trailGroup.add(trail);
      }
      trail.material = trailMaterials.get(color);
      trail.scale.x = Math.min(7, 1 + speed / 18);
      trail.rotation.x = -Math.PI / 2;
      trail.position.set(vehicle.position - 3, 0.05, vehicle.lateralPositionM);
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
        materials.forEach((item) => {
          if (item.map) item.map.dispose();
          item.dispose();
        });
      }
    });
    renderer?.dispose();
    trailPool.length = 0;
    trailMaterials.clear();
    trailGeometry = null;
    if (speedLabel?.element) speedLabel.element.remove();
    if (eventLabel?.element) eventLabel.element.remove();
    speedLabel = null;
    eventLabel = null;
    scene = null;
    renderer = null;
    initialized = false;
  }

  function updateCamera(delta) {
    const selected = frame?.vehicles?.find((vehicle) => frame.selectedVehicleIds.includes(vehicle.id));
    let target = new THREE.Vector3(250, 0, 0);
    let desiredPosition = new THREE.Vector3(175, 42, 52);
    if (currentMode === 'chase' && selected) {
      target.set(selected.position + 18, 0, selected.lateralPositionM);
      desiredPosition.set(selected.position - cameraDistance, 26, selected.lateralPositionM + 34);
    } else if (currentMode === 'top') {
      target.set(250, 0, 0);
      desiredPosition.set(250, 180, 0.01);
    } else if (currentMode === 'orbit') {
      target = cameraTarget.clone();
      desiredPosition.set(target.x + Math.cos(orbitAngle) * cameraDistance, 30 + cameraDistance * orbitPitch * 0.45, target.z + Math.sin(orbitAngle) * cameraDistance);
    } else {
      target.set(250 + Math.sin(performance.now() * 0.00005) * 60, 0, 0);
      desiredPosition.set(target.x - 75, 36, 44);
    }
    const blend = 1 - Math.pow(0.001, Math.min(delta, 0.05));
    cameraPosition.lerp(desiredPosition, blend);
    cameraTarget.lerp(target, blend);
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
  }

  function updateBarrier() {
    const position = frame?.barrierPositionM;
    barrierGroup.visible = position !== null && position !== undefined;
    if (barrierGroup.visible) barrierGroup.position.set(position, 0, 0);
    if (glowMaterial) glowMaterial.opacity = 0.45 + Math.sin(performance.now() * 0.01) * 0.35;
  }

  function render(now = performance.now()) {
    if (!initialized) return;
    const delta = lastTime ? (now - lastTime) / 1000 : 0.016;
    lastTime = now;
    if (!frozen) {
      updateCamera(delta);
      updateVehicles();
      updateBarrier();
      updateTrails();
      updateCrashMoment();
    }
    if (speedLabel.visible) speedLabel.element.style.transform = `translate3d(${(speedLabel.position.x / ROAD_LENGTH) * 100}%, 0, 0)`;
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
    if (lowGraphicsToggle) lowGraphicsToggle.setAttribute('aria-pressed', String(!value));
    renderer?.setPixelRatio(value ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
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
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    scene = new THREE.Scene();
    scene.background = makeSkyTexture();
    scene.fog = new THREE.Fog(0x182b42, 180, 620);
    camera = new THREE.PerspectiveCamera(44, 2, 0.1, 900);
    scene.add(new THREE.HemisphereLight(0x9dbbd1, 0x152329, 1.5));
    const keyLight = new THREE.DirectionalLight(0xffead0, 2.4);
    keyLight.position.set(-100, 160, 90);
    scene.add(keyLight);
    addRoad();
    addProps();
    addBarrier();
    createVehicleLayers();
    trailGroup = new THREE.Group();
    scene.add(trailGroup);
    selectedOutline = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 24), new THREE.MeshBasicMaterial({ color: 0x5ac1bd, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    selectedOutline.rotation.x = -Math.PI / 2;
    selectedOutline.visible = false;
    scene.add(selectedOutline);
    speedLabel = makeLabel('', 'flowline-3d-label');
    eventLabel = makeLabel('', 'flowline-3d-event');
    eventLabel.visible = false;
    flashRing = new THREE.Mesh(new THREE.RingGeometry(3, 3.3, 32), new THREE.MeshBasicMaterial({ color: 0xff6857, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    flashRing.rotation.x = -Math.PI / 2;
    flashRing.visible = false;
    scene.add(flashRing);
    initialized = true;
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
    active = value;
    canvas.hidden = !value;
    document.getElementById('microRoad').hidden = value;
    view2d.classList.toggle('is-active', !value);
    view3d.classList.toggle('is-active', value);
    view2d.setAttribute('aria-pressed', String(!value));
    view3d.setAttribute('aria-pressed', String(value));
    roadWrap.classList.toggle('is-3d', value);
    if (value) {
      resize();
      if (!animationFrame) {
        fpsStart = performance.now();
        animationFrame = requestAnimationFrame(render);
      }
    } else if (animationFrame) {
      disposeScene();
    } else {
      disposeScene();
    }
  }

  function renderFrame(nextFrame) {
    frame = nextFrame;
  }

  controls.forEach((control) => control.addEventListener('click', () => setMode(control.dataset['3dMode'])));
  lowGraphicsToggle?.addEventListener('click', () => enableLowGraphics(!lowGraphics));
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
  window.addEventListener('resize', resize);
  if (buildScene()) {
    window.flowline3d = { renderFrame, setActive };
    window.dispatchEvent(new Event('flowline3dready'));
  }
})();
