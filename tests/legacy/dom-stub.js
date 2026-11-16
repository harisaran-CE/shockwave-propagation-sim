'use strict';

// Minimal DOM stand-in used only to execute the pre-extraction v0.1.0
// browser script (which read its settings straight from form controls) under
// Node, so that its output can be compared with the extracted module.

const INITIAL_VALUES = {
  microSeed: '41',
  microScenario: 'busy',
  microClosedLane: '1',
  microBarrierPosition: '320',
  microArrivalRate: '24',
  microVariation: '25',
  microSpeedLimit: '60',
  microDuration: '180',
  microSpeed: '1',
  microRiskSpeedWeight: '0.35',
  microRiskDensityWeight: '0.25',
  microRiskConflictWeight: '0.25',
  microRiskCrashWeight: '0.15'
};

function createContext2d() {
  return new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => { target[key] = value; return true; }
  });
}

function createElement(id = '') {
  const element = {
    id,
    value: INITIAL_VALUES[id] ?? '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    options: [],
    selectedOptions: [],
    files: [],
    validity: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    setAttribute() {},
    getAttribute: () => null,
    checkValidity: () => true,
    reportValidity: () => true,
    setCustomValidity() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
    getContext: () => createContext2d(),
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
    querySelector: () => createElement(),
    querySelectorAll: () => [],
    closest: () => createElement(),
    append() {},
    remove() {},
    click() {}
  };
  return element;
}

function createDomGlobals() {
  const elements = new Map();
  const document = {
    documentElement: createElement('html'),
    body: createElement('body'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    },
    querySelector: () => createElement(),
    querySelectorAll: () => [],
    createElement: () => createElement(),
    addEventListener() {}
  };
  const window = {
    document,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout
  };
  return { window, document, elements };
}

module.exports = { createDomGlobals };
