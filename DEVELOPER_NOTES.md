# Flowline developer notes

## Architecture

- `browser_app/microscopic.js` owns the browser simulation state, fixed-step
  updates, metrics, exports, editor settings, and crash observations.
- `browser_app/flowline-3d.js` is presentation-only. It consumes render
  snapshots and must not modify simulation state.
- `browser_app/index.html` and `browser_app/microscopic.css` provide the UI.
- `traffic_micro.py`, `traffic_sim.py`, and desktop applications are separate
  models and are not used by the browser app.

## Source-of-truth rule

Vehicle state is owned by the browser simulation. The 2D canvas, Three.js
renderer, inspector, editor controls, and exports read that state. Rendering
must never advance or mutate the simulation.

## Configuration

`SIM_CONFIG` in `browser_app/microscopic.js` contains the fixed simulation
step, frame-delta clamp, and per-frame step cap. Three.js presentation
constants remain local to `flowline-3d.js`. Risk weights are stored with the
scenario document and are explicitly heuristic and uncalibrated.

## Adding a vehicle type

1. Add its dimensions, color, and driving ranges to `profiles` in
   `browser_app/microscopic.js`.
2. Add its arrival probability to `ARRIVAL_MIX`.
3. Add its display swatch/count if the UI needs a separate readout.
4. Add its low-poly silhouette and instanced layer in `flowline-3d.js`.
5. Update the browser guide and verify that exports retain units.
