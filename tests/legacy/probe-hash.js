'use strict';

// One-off probe: run a browser script (argv[2]) under the DOM stub and try
// to reproduce the hashes stored in golden_hashes.json with several
// plausible canonicalisations.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDomGlobals } = require('./dom-stub');

const scriptPath = path.resolve(process.argv[2]);
const golden = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../golden_hashes.json'), 'utf8'
));

function loadLegacy() {
  const { window, document } = createDomGlobals();
  const context = vm.createContext({
    window, document, console, URL, Blob: function Blob() {}, FileReader: function FileReader() {},
    Event: function Event() {}, performance: { now: () => 0 }
  });
  const simPath = path.resolve(__dirname, '../../browser_app/flowline-sim.js');
  vm.runInContext(fs.readFileSync(simPath, 'utf8'), context, { filename: simPath });
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
  return window.__flowlineTest;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

const numberModes = {
  toFixedNumber: (value) => Number(value.toFixed(9)),
  round: (value) => Math.round(value * 1e9) / 1e9,
  toFixedString: (value) => value.toFixed(9),
  raw: (value) => value
};

function variants(state) {
  const out = {};
  const shapes = {
    full: state,
    noSettings: (() => { const { roadSettings, ...rest } = state; return rest; })()
  };
  for (const [shapeName, shape] of Object.entries(shapes)) {
    for (const [modeName, mode] of Object.entries(numberModes)) {
      const replacer = (key, value) => (typeof value === 'number' ? mode(value) : value);
      out[`${shapeName}/${modeName}/insertion`] = fnv1a(JSON.stringify(shape, replacer));
      out[`${shapeName}/${modeName}/sorted`] = fnv1a(JSON.stringify(sortKeys(shape), replacer));
    }
  }
  return out;
}

const api = loadLegacy();
const tally = {};
const states = [];
for (const capture of golden.captures) {
  const state = JSON.parse(JSON.stringify(api.run(capture.seed, capture.settings || {}, capture.steps)));
  states.push({ name: capture.name, seed: capture.seed, steps: capture.steps, state });
  const results = variants(state);
  const matched = Object.entries(results).filter(([, hash]) => hash === capture.hash).map(([name]) => name);
  for (const name of matched) tally[name] = (tally[name] || 0) + 1;
  console.log(`${capture.name} seed=${capture.seed} steps=${capture.steps} golden=${capture.hash}`
    + ` vehicles=${state.vehicles.length} matched=[${matched.join(', ')}]`);
  if (!matched.length) console.log('   sample:', results['full/toFixedNumber/insertion'], results['full/toFixedNumber/sorted']);
}
console.log('tally', tally, 'of', golden.captures.length);
if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(states));
