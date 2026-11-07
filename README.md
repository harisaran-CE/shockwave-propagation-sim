# Shockwave Propagation Simulator

This repository is a high-precision, one-dimensional macroscopic traffic-flow
baseline for studying the formation and propagation of traffic shockwaves on a
straight highway segment. The engine is intentionally narrow: it implements the
Lighthill-Whitham-Richards (LWR) conservation continuum, represents traffic as
cell-average density, and advances the conservation law with a finite-volume
Godunov-style interface flux.

The project is structured as a transparent learning and research shell for a
first-year civil engineering workflow. The numerical framework is complete and
auditable, while the single Greenshields velocity relationship is left as a
high-visibility manual calculation for the student to enter and verify.

## Executive summary

The modeled state is density, `k(x, t)`, in PCU-equivalent vehicles per metre.
LWR treats traffic as a compressible continuum governed by

```text
∂k/∂t + ∂q/∂x = 0,       q(k) = k · v(k)
```

The supplied baseline uses the Greenshields family of fundamental diagrams,
but its velocity equation is deliberately not pre-filled. After the manual
relationship is entered in `traffic_sim.py`, the engine computes cell flow,
interface demand/supply, and the conserved density update using extended
precision NumPy arrays (`np.longdouble`). The implementation uses variable
finite-volume cell widths only for the final remainder cell: 142 cells are 7 m
wide and the 143rd cell closes the exact 1,000 m domain at 6 m.

The configured bottleneck is the cell at array index 115, whose upstream edge
is 805 m from the origin. With `LANE_REDUCTION = 1.0`, the obstacle is modeled
as a complete closure: no conservation flux enters or exits the obstacle cell.
The downstream boundary is an unrestricted, transparent free-exit boundary, so
vehicles can leave the domain without an artificial downstream queue.

The terminal renderer is diagnostic only. It maps the continuous cell state to
the requested visual symbols:

```text
1 → [🚗]     0 → [  ]     9 → [💥]
```

A positive cell-average density is displayed as an occupied cell; this is a
visual occupancy indicator, not a claim that every 7 m cell contains exactly
one physical vehicle. The conservation state remains the floating-point density
array and is never replaced by the display grid.

## Standards and metric scope

The configuration is expressed in SI units and uses PCU-equivalent quantities
to make the intended connections to IRC:106-1990 and Indo-HCM traffic-flow
practice explicit. The supplied values are a computational baseline, not a
certification of a road design or a substitute for the latest published Indian
standard, local field calibration, lane geometry, vehicle mix, or an approved
Indo-HCM Level of Service procedure.

The metric helpers in `traffic_sim.py` expose the common audit quantities:

- density in vehicles/PCU per metre and PCU per kilometre;
- speed in metres/second and kilometres/hour;
- flow in vehicles/PCU per second and PCU per hour;
- total in-domain vehicle mass, boundary inflow, and free-exit outflow.

The first-order LWR model has no explicit vehicle class, reaction time,
intersection delay, grade, weather, lane-changing, or stochastic headway
model. Those effects require additional calibrated models and must not be
silently inferred from this 1D baseline.

## Exact configuration baseline

The immutable `Final` constants at the top of `traffic_sim.py` are the requested
simulation contract:

| Key | Value | Interpretation |
| --- | ---: | --- |
| `ROAD_LENGTH` | `1000.0` m | linear model domain |
| `CELL_SIZE` | `7.0` m | nominal cell/headway footprint |
| `INITIAL_DENSITY` | `0.02` veh/m | 20 PCU/km upstream baseline |
| `INITIAL_SPEED` | `16.66667` m/s | 60 km/h Level-of-Service-B reference |
| `FREE_FLOW_SPEED` | `22.22222` m/s | 80 km/h design-speed ceiling |
| `JAM_DENSITY` | `0.142857` veh/m | requested 1/7 veh/m jam bound |
| `INFLOW_DEMAND` | `0.333333` veh/s | 1,200 PCU/h boundary demand |
| `BOTTLENECK_POSITION` | `115` | zero-based array index; upstream edge ≈805 m |
| `LANE_REDUCTION` | `1.0` | 100% capacity reduction |
| `TIME_STEP` | `0.25` s | chronological update interval |
| `TOTAL_DURATION` | `720` steps | 180 s at 0.25 s/step |
| `OUTPUT_TYPE` | `"TERMINAL"` | text renderer target |

`INITIAL_SPEED` is retained as a calibration/reference metric. In a first-order
LWR model, velocity is derived from density through the manually entered
fundamental diagram; speed is not an independent conserved state.

## Repository layout

```text
shockwave-propagation-sim/
├── .gitignore
├── LICENSE
├── README.md
└── traffic_sim.py
```

## Setup in VS Code

1. Open this folder in VS Code.
2. Create and activate a local virtual environment named `venv`.
3. Install NumPy, for example: `python -m pip install numpy`.
4. Open `traffic_sim.py` and verify the manually entered Greenshields function.
5. Run the static compile check: `python -m py_compile traffic_sim.py`.
6. Run the simulator: `python traffic_sim.py`.

The Greenshields relationship is now entered in the physics hook, so the
simulator is runnable immediately. Keep the relationship visible and verify it
before changing any other model assumptions.

Useful command-line options are available for development:

```text
python traffic_sim.py --no-animation
python traffic_sim.py --no-sleep
python traffic_sim.py --steps 20 --no-sleep
```

`--no-animation` advances the full requested run without clearing the terminal
or drawing frames. `--no-sleep` keeps the terminal renderer enabled but removes
real-time pacing. Both options are useful for debugging and repeatable checks.

## Desktop application

The Windows desktop app is called Flowline Traffic Studio. Users can run
`FlowlineTrafficStudio.exe` without installing Python or using a terminal. The
app has a guided demo, an animated traffic-density view, a build-up chart,
plain-language status, playback speed and timeline controls, and CSV/JSON
exports. Users can vary arrivals randomly around a selected mean demand. For
the portable user package, see [`USER_GUIDE.md`](./USER_GUIDE.md).
To rebuild the Windows release, follow [`PUBLISHING.md`](./PUBLISHING.md) and
run [`build_windows.ps1`](./build_windows.ps1).

## Microscopic model prototype

[`traffic_micro.py`](./traffic_micro.py) is an isolated, exploratory
vehicle-level prototype. It models seeded initial fleets of passenger cars,
motorcycles, auto-rickshaws, buses, and heavy goods vehicles on a straight,
fixed-lane road, with an Intelligent Driver Model (IDM) car-following update,
sampled reaction delays, reproducible hard-braking events, and conservative
adjacent-lane changes for passing slower traffic when the speed gain and front
and rear gaps satisfy the configured checks. Lane changes are applied at the
start of a time step, with deterministic conflict resolution and a cooldown
to limit repeated switching. Brake-event rates and durations, vehicle
proportions, lane-change thresholds, and driver-parameter ranges are
illustrative, not calibrated to a specific road or dataset.
Reaction delay uses each driver's sampled perception history; hard braking is
sampled from a seeded per-vehicle event rate and logged with its applied
duration. If a step would create overlap, the model records a contact and
closing speed, then clamps the vehicles to touching; it does not model impact
forces, damage, or crash risk.

The desktop LWR engine remains separate and unchanged. The browser app at
[`browser_app/index.html`](./browser_app/index.html) now runs only an
individual-vehicle simulation; it does not run or compare against LWR. The
browser model is an independent, simplified implementation, not a direct
execution of the Python prototype. It supports seeded arrivals, vehicle
classes, gap-checked lane changes, overtaking, one-lane restrictions, and full
road closures. Its lane-change and driving rules are illustrative, not
calibrated. Intersections and signals are not modeled; validate against
observed traffic data before using it for research or engineering decisions.

Run its focused tests with `python -m unittest -v test_traffic_micro`. To
open the Python visual preview, run `python traffic_micro_app.pyw`; it can
regenerate seeded runs, play/pause, and scrub saved frames. To view individual
vehicle classes and overtaking in a browser, open `browser_app/index.html`.
Choose the road scenario, barrier distance, arrivals, speed limit, and run
length in the settings panel. The browser run stops when the first vehicle
reaches the 500 m road end, or at the selected run length if none reaches it
first. During a barrier scenario, drag the barrier marker directly on the
animated road or edit its distance in the settings; it moves live without
resetting the run. Approaching vehicles stop safely ahead and can resume if it
moves away. Vehicles have larger, clearer shapes that do not shrink when
traffic gets close. Drivers look ahead for lane closures, attempt
a merge when a safe gap is available, and wait rather than force an unsafe
change. Vehicles accelerate normally when the moved barrier is well ahead and
brake within a safe stopping distance. Lane changes are gradual. Runs can be
downloaded as CSV or JSON; samples record the live barrier position. To inspect
a reproducible scenario from Python:

```python
import traffic_micro

states = traffic_micro.run_simulation(duration_s=30, seed=7)
print(traffic_micro.metrics_snapshot(states[-1]))
```

## Numerical method

For cell `i`, width `Δxᵢ`, and interface fluxes `Fᵢ₋₁/₂` and `Fᵢ₊₁/₂`, the
conservative update is

```text
kᵢⁿ⁺¹ = kᵢⁿ − (Δt / Δxᵢ) · (Fᵢ₊₁/₂ − Fᵢ₋₁/₂)
```

The interior interface uses the LWR demand/supply construction for the
concave Greenshields diagram. The left boundary uses the lesser of configured
arrival demand and the first cell's receiving supply. The right boundary uses
the last cell's sending demand with no downstream restriction. The bottleneck
capacity multiplier is `1 - LANE_REDUCTION`; with the requested value it is
zero. The engine checks density bounds after every update and raises a
`FloatingPointError` rather than silently hiding an unstable or invalid state.

The CFL audit is performed against the smallest actual cell width, so the final
6 m remainder cell is included in the stability check:

```text
Δt ≤ min(Δxᵢ) / vf
```

## Manual physics entry point

Find this exact function in `traffic_sim.py`:

```python
def calculate_greenshields_velocity(current_density: float, free_flow_speed: float, jam_density: float) -> float:
```

The relationship is entered at the marked physics hook:

```python
speed = vf * (1 - (k / kj))
```

Use the function parameters rather than hard-coding constants so the remainder
of the engine remains auditable and the manual relationship controls all
velocity, flow, demand, supply, and metric calculations.

## Research-use limitations

This repository is a reproducible computational baseline, not a traffic
operations approval tool. Before using any result for design or policy, verify
units, PCU equivalence, calibration data, lane count, bottleneck geometry,
boundary assumptions, standards edition, and convergence under grid/time-step
refinement. Preserve the raw configuration and terminal output with every
experiment.
