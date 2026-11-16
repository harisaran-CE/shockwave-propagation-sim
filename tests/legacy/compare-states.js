'use strict';

// Exact deep comparison of two captured-state files produced by probe-hash.js.
// Usage: node compare-states.js <baseline.json> <candidate.json>
// Exits non-zero and prints the first differing path if anything differs.

const fs = require('fs');
const path = require('path');

const [baselinePath, candidatePath] = process.argv.slice(2).map((file) => path.resolve(file));
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));

function firstDifference(a, b, where) {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || (a === null) !== (b === null)) return `${where}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (typeof a !== 'object') return `${where}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${where}: array mismatch`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const diff = firstDifference(a[key], b[key], `${where}.${key}`);
    if (diff) return diff;
  }
  return null;
}

if (baseline.length !== candidate.length) {
  console.log(`FAIL: capture count ${baseline.length} vs ${candidate.length}`);
  process.exit(1);
}
let failures = 0;
baseline.forEach((entry, index) => {
  const diff = firstDifference(entry.state, candidate[index].state, `${entry.name}#${index}`);
  if (diff) {
    failures += 1;
    console.log(`FAIL ${diff}`);
  }
});
if (failures) {
  console.log(`${failures} of ${baseline.length} captures differ`);
  process.exit(1);
}
console.log(`OK: all ${baseline.length} captures identical`);
