"""High-precision 1D LWR traffic-flow simulator.

The model is a finite-volume conservation solver for the Lighthill-Whitham-
Richards (LWR) continuum. Density is the only conserved state. The
Greenshields velocity relationship is intentionally left for manual entry in
``calculate_greenshields_velocity`` so the governing relationship remains
visible and verifiable to the student author.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
from dataclasses import dataclass
from typing import Final, Iterable

import numpy as np


# ---------------------------------------------------------------------------
# Immutable simulation contract: SI units unless explicitly stated otherwise.
# ---------------------------------------------------------------------------
ROAD_LENGTH: Final[float] = 1000.0       # Total highway stretch domain (m)
CELL_SIZE: Final[float] = 7.0            # Nominal safe-space cell footprint (m)
INITIAL_DENSITY: Final[float] = 0.02     # 20 PCU/km, converted to vehicles/m
INITIAL_SPEED: Final[float] = 16.66667   # 60 km/h, converted to m/s
FREE_FLOW_SPEED: Final[float] = 22.22222 # 80 km/h, converted to m/s
JAM_DENSITY: Final[float] = 0.142857     # Requested 1000/7 PCU/km, converted to vehicles/m
INFLOW_DEMAND: Final[float] = 0.333333  # 1200 PCU/h, converted to vehicles/s
BOTTLENECK_POSITION: Final[int] = 115    # Zero-based array index; x ≈ 805 m
LANE_REDUCTION: Final[float] = 1.0      # 1.0 = 100% complete lane closure
TIME_STEP: Final[float] = 0.25          # Chronological update delta (s)
TOTAL_DURATION: Final[int] = 720        # Number of iterations; 720 × 0.25 s = 180 s
OUTPUT_TYPE: Final[str] = "TERMINAL"    # System display target


# Long-double constants keep the update arithmetic in the widest NumPy scalar
# type available on the host. The public contract above intentionally remains
# easy to edit and compare against the project specification.
_LD_ROAD_LENGTH = np.longdouble(str(ROAD_LENGTH))
_LD_CELL_SIZE = np.longdouble(str(CELL_SIZE))
_LD_INITIAL_DENSITY = np.longdouble(str(INITIAL_DENSITY))
_LD_FREE_FLOW_SPEED = np.longdouble(str(FREE_FLOW_SPEED))
_LD_JAM_DENSITY = np.longdouble(str(JAM_DENSITY))
_LD_INFLOW_DEMAND = np.longdouble(str(INFLOW_DEMAND))
_LD_TIME_STEP = np.longdouble(str(TIME_STEP))
_DENSITY_TOLERANCE = np.longdouble("1e-18")
_EPSILON = np.longdouble("1e-30")


@dataclass(frozen=True, slots=True)
class SimulationConfig:
    """User-selectable physical inputs for one reproducible 1D run."""

    road_length_m: float = ROAD_LENGTH
    cell_size_m: float = CELL_SIZE
    initial_density_vehicles_per_m: float = INITIAL_DENSITY
    free_flow_speed_m_per_s: float = FREE_FLOW_SPEED
    jam_density_vehicles_per_m: float = JAM_DENSITY
    inflow_demand_vehicles_per_s: float = INFLOW_DEMAND
    bottleneck_position_m: float = 805.0
    lane_reduction: float = LANE_REDUCTION
    time_step_s: float = TIME_STEP


def calculate_greenshields_velocity(current_density: float, free_flow_speed: float, jam_density: float) -> float:
    # Greenshields mathematical relationship: speed = vf * (1 - (k / kj))
    return free_flow_speed * (1 - (current_density / jam_density))


@dataclass(slots=True)
class SimulationState:
    """A snapshot of the conservative LWR state on the spatial grid."""

    time_s: np.longdouble
    density_vehicles_per_m: np.ndarray
    cell_edges_m: np.ndarray
    config: SimulationConfig = SimulationConfig()
    cumulative_inflow_vehicles: np.longdouble = np.longdouble(0)
    inflow_demand_vehicles_per_s: np.longdouble | None = None

    @property
    def cell_widths_m(self) -> np.ndarray:
        """Return each finite-volume cell width in metres."""

        return np.diff(self.cell_edges_m)

    @property
    def cell_centers_m(self) -> np.ndarray:
        """Return each cell centre coordinate in metres."""

        return (self.cell_edges_m[:-1] + self.cell_edges_m[1:]) / np.longdouble(2)

    @property
    def vehicle_mass(self) -> np.longdouble:
        """Return total in-domain vehicle mass, allowing fractional PCU mass."""

        return np.sum(self.density_vehicles_per_m * self.cell_widths_m, dtype=np.longdouble)


@dataclass(frozen=True, slots=True)
class LocalCellState:
    """Exact local state values associated with one spatial cell."""

    cell_index: int
    x_start_m: np.longdouble
    x_end_m: np.longdouble
    density_vehicles_per_m: np.longdouble
    speed_m_per_s: np.longdouble
    flow_vehicles_per_s: np.longdouble


def _cell_count(config: SimulationConfig | None = None) -> int:
    """Return the number of cells needed to cover the exact domain length."""

    config = config or SimulationConfig()
    return int(math.ceil(config.road_length_m / config.cell_size_m))


def _build_cell_edges(config: SimulationConfig | None = None) -> np.ndarray:
    """Build monotonic edges, preserving the exact 1,000 m domain endpoint."""

    config = config or SimulationConfig()
    count = _cell_count(config)
    edges = np.arange(count + 1, dtype=np.longdouble) * np.longdouble(str(config.cell_size_m))
    edges[-1] = np.longdouble(str(config.road_length_m))
    return edges


def _bottleneck_index(config: SimulationConfig) -> int:
    """Map the requested physical bottleneck coordinate to its grid interface."""

    return min(int(round(config.bottleneck_position_m / config.cell_size_m)), _cell_count(config) - 1)


def validate_configuration(config: SimulationConfig | None = None) -> None:
    """Validate physical and numerical assumptions before a run begins."""

    config = config or SimulationConfig()
    if config.road_length_m <= 0.0 or config.cell_size_m <= 0.0:
        raise ValueError("ROAD_LENGTH and CELL_SIZE must be positive.")
    if not 0.0 <= config.initial_density_vehicles_per_m <= config.jam_density_vehicles_per_m:
        raise ValueError("INITIAL_DENSITY must lie within [0, JAM_DENSITY].")
    if not 0.0 < config.free_flow_speed_m_per_s:
        raise ValueError("FREE_FLOW_SPEED must be positive.")
    if not 0.0 <= config.inflow_demand_vehicles_per_s:
        raise ValueError("INFLOW_DEMAND must be non-negative.")
    if not 0.0 <= config.lane_reduction <= 1.0:
        raise ValueError("LANE_REDUCTION must lie within [0, 1].")
    if not 0.0 <= config.bottleneck_position_m < config.road_length_m:
        raise ValueError("BOTTLENECK_POSITION must lie within the road domain.")
    if config.time_step_s <= 0.0:
        raise ValueError("TIME_STEP must be positive.")

    widths = np.diff(_build_cell_edges(config))
    cfl_limit = np.min(widths) / np.longdouble(str(config.free_flow_speed_m_per_s))
    if np.longdouble(str(config.time_step_s)) > cfl_limit + _DENSITY_TOLERANCE:
        raise ValueError(
            f"CFL condition violated: TIME_STEP={config.time_step_s} exceeds "
            f"minimum-width limit {float(cfl_limit):.12g} s."
        )


def initialize_state(config: SimulationConfig | None = None) -> SimulationState:
    """Create the initial uniform-density state with an empty obstacle cell."""

    config = config or SimulationConfig()
    validate_configuration(config)
    edges = _build_cell_edges(config)
    density = np.full(_cell_count(config), np.longdouble(str(config.initial_density_vehicles_per_m)), dtype=np.longdouble)
    # The closure acts on a road interface; it does not erase the density
    # state of the adjacent physical road cell.
    return SimulationState(
        time_s=np.longdouble(0),
        density_vehicles_per_m=density,
        cell_edges_m=edges,
        config=config,
        inflow_demand_vehicles_per_s=np.longdouble(str(config.inflow_demand_vehicles_per_s)),
    )


def _velocity_from_density(density: np.ndarray, config: SimulationConfig | None = None) -> np.ndarray:
    """Evaluate the manually entered velocity law for every cell."""

    config = config or SimulationConfig()
    velocity = np.asarray(
        calculate_greenshields_velocity(
            density,
            np.longdouble(str(config.free_flow_speed_m_per_s)),
            np.longdouble(str(config.jam_density_vehicles_per_m)),
        ),
        dtype=np.longdouble,
    )
    if not np.all(np.isfinite(velocity)):
        raise FloatingPointError("The manual velocity relationship returned a non-finite value.")
    velocity_tolerance = _DENSITY_TOLERANCE * np.longdouble(10)
    if np.any(velocity < -velocity_tolerance):
        raise FloatingPointError("The manual velocity relationship returned a negative speed.")
    free_flow_speed = np.longdouble(str(config.free_flow_speed_m_per_s))
    if np.any(velocity > free_flow_speed + velocity_tolerance):
        raise FloatingPointError("The manual velocity relationship exceeded FREE_FLOW_SPEED.")
    return np.maximum(velocity, np.longdouble(0))


def _flow_from_density(
    density: np.ndarray,
    config: SimulationConfig | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Return velocity and flow arrays from a density array."""

    velocity = _velocity_from_density(density, config)
    flow = density * velocity
    if not np.all(np.isfinite(flow)):
        raise FloatingPointError("The calculated flow contains a non-finite value.")
    return velocity, np.maximum(flow, np.longdouble(0))


def _demand_supply(
    density: np.ndarray,
    flow: np.ndarray,
    config: SimulationConfig | None = None,
) -> tuple[np.ndarray, np.ndarray, np.longdouble]:
    """Build LWR demand and supply arrays for the concave Greenshields law."""

    config = config or SimulationConfig()
    jam_density = np.longdouble(str(config.jam_density_vehicles_per_m))
    critical_density = jam_density / np.longdouble(2)
    critical_velocity = _velocity_from_density(np.asarray([critical_density]), config)[0]
    capacity = critical_density * critical_velocity
    is_free_flow = density <= critical_density
    demand = np.where(is_free_flow, flow, capacity)
    supply = np.where(is_free_flow, capacity, flow)
    return demand, supply, capacity


def _interface_fluxes(
    state: SimulationState,
    inflow_demand_vehicles_per_s: float | np.longdouble | None = None,
) -> np.ndarray:
    """Return all `n + 1` interface fluxes in vehicles per second."""

    config = state.config
    density = state.density_vehicles_per_m
    _, flow = _flow_from_density(density, config)
    demand, supply, _ = _demand_supply(density, flow, config)
    flux = np.empty(density.size + 1, dtype=np.longdouble)

    # Upstream boundary: prescribed demand entering an available first cell.
    inflow_demand = np.longdouble(str(
        config.inflow_demand_vehicles_per_s
        if inflow_demand_vehicles_per_s is None
        else inflow_demand_vehicles_per_s
    ))
    if not np.isfinite(inflow_demand) or inflow_demand < 0:
        raise ValueError("Inflow demand must be finite and non-negative.")
    flux[0] = np.minimum(inflow_demand, supply[0])

    # Interior Godunov flux: sending demand from the left, receiving supply on
    # the right. This is the conservative LWR Riemann-solver construction.
    flux[1:-1] = np.minimum(demand[:-1], supply[1:])

    # Transparent free-exit boundary: no artificial receiving restriction.
    flux[-1] = demand[-1]

    # Apply the selected capacity reduction at one road interface. This keeps
    # the cell density intact and preserves the finite-volume conservation law.
    closure_multiplier = np.longdouble(1.0 - config.lane_reduction)
    obstacle_interface = _bottleneck_index(config)
    flux[obstacle_interface] *= closure_multiplier

    if not np.all(np.isfinite(flux)) or np.any(flux < 0):
        raise FloatingPointError("The interface flux array is invalid.")
    return flux


def advance_state(
    state: SimulationState,
    inflow_demand_vehicles_per_s: float | np.longdouble | None = None,
) -> SimulationState:
    """Advance one conservative time step using the LWR finite-volume update."""

    flux = _interface_fluxes(state, inflow_demand_vehicles_per_s)
    config = state.config
    widths = state.cell_widths_m
    density = state.density_vehicles_per_m
    dt = np.longdouble(str(config.time_step_s))
    jam_density = np.longdouble(str(config.jam_density_vehicles_per_m))
    inflow_demand = np.longdouble(str(
        config.inflow_demand_vehicles_per_s
        if inflow_demand_vehicles_per_s is None
        else inflow_demand_vehicles_per_s
    ))
    next_density = density - (dt / widths) * (flux[1:] - flux[:-1])

    if not np.all(np.isfinite(next_density)):
        raise FloatingPointError("The density update produced a non-finite value.")
    if np.any(next_density < -_DENSITY_TOLERANCE):
        raise FloatingPointError("The density update produced a negative density.")
    if np.any(next_density > jam_density + _DENSITY_TOLERANCE):
        raise FloatingPointError("The density update exceeded JAM_DENSITY.")

    # Only round-off-scale corrections are clipped. A material correction would
    # hide a scheme/configuration error and is therefore rejected above.
    next_density = np.clip(next_density, np.longdouble(0), jam_density)
    return SimulationState(
        time_s=state.time_s + dt,
        density_vehicles_per_m=next_density,
        cell_edges_m=state.cell_edges_m,
        config=config,
        cumulative_inflow_vehicles=state.cumulative_inflow_vehicles + dt * flux[0],
        inflow_demand_vehicles_per_s=inflow_demand,
    )


def local_cell_state(state: SimulationState, cell_index: int) -> LocalCellState:
    """Return exact density, speed, flow, and boundaries for one cell."""

    if not 0 <= cell_index < state.density_vehicles_per_m.size:
        raise IndexError("cell_index is outside the spatial grid.")
    velocity, flow = _flow_from_density(state.density_vehicles_per_m, state.config)
    return LocalCellState(
        cell_index=cell_index,
        x_start_m=state.cell_edges_m[cell_index],
        x_end_m=state.cell_edges_m[cell_index + 1],
        density_vehicles_per_m=state.density_vehicles_per_m[cell_index],
        speed_m_per_s=velocity[cell_index],
        flow_vehicles_per_s=flow[cell_index],
    )


def metrics_snapshot(state: SimulationState) -> dict[str, np.longdouble]:
    """Return Indo-HCM-oriented audit metrics for the current state."""

    velocity, flow = _flow_from_density(state.density_vehicles_per_m, state.config)
    mean_density = np.mean(state.density_vehicles_per_m, dtype=np.longdouble)
    mean_speed = np.mean(velocity, dtype=np.longdouble)
    mean_flow = np.mean(flow, dtype=np.longdouble)
    return {
        "time_s": state.time_s,
        "vehicle_mass": state.vehicle_mass,
        "mean_density_vehicles_per_m": mean_density,
        "max_density_vehicles_per_m": np.max(state.density_vehicles_per_m),
        "mean_density_pcu_per_km": mean_density * np.longdouble(1000),
        "mean_speed_m_per_s": mean_speed,
        "mean_speed_km_per_h": mean_speed * np.longdouble(3.6),
        "mean_flow_vehicles_per_s": mean_flow,
        "mean_flow_pcu_per_h": mean_flow * np.longdouble(3600),
    }


def character_mapping_array(state: SimulationState) -> np.ndarray:
    """Map the continuous density state to the requested 0/1/9 display array."""

    mapping = np.zeros(state.density_vehicles_per_m.size, dtype=np.int8)
    mapping[state.density_vehicles_per_m > _EPSILON] = 1
    mapping[_bottleneck_index(state.config)] = 9
    return mapping


def _symbols_from_mapping(mapping: Iterable[int]) -> str:
    """Render a numeric character mapping as fixed-width terminal cells."""

    symbols = {0: "[  ]", 1: "[🚗]", 9: "[💥]"}
    return "".join(symbols[int(value)] for value in mapping)


def clear_terminal() -> None:
    """Clear the terminal using a fixed cross-platform system command."""

    os.system("cls" if os.name == "nt" else "clear")


def render_terminal_frame(state: SimulationState) -> None:
    """Clear and draw one text frame of the current traffic state."""

    clear_terminal()
    metrics = metrics_snapshot(state)
    print("1D LWR SHOCKWAVE PROPAGATION SIMULATOR")
    print(
        f"t = {float(state.time_s):8.2f} s | "
        f"in-domain mass = {float(metrics['vehicle_mass']):10.6f} PCU | "
        f"mean k = {float(metrics['mean_density_pcu_per_km']):9.3f} PCU/km"
    )
    print(_symbols_from_mapping(character_mapping_array(state)))
    print("[🚗] moving/occupied   [  ] open cell   [💥] bottleneck obstacle")


def run_simulation(
    steps: int = TOTAL_DURATION,
    *,
    animate: bool = OUTPUT_TYPE == "TERMINAL",
    realtime: bool = True,
    config: SimulationConfig | None = None,
) -> SimulationState:
    """Run the requested number of updates and return the final state."""

    if steps < 0:
        raise ValueError("steps must be non-negative.")
    config = config or SimulationConfig()
    state = initialize_state(config)
    for _ in range(steps + 1):
        if animate:
            render_terminal_frame(state)
        if state.time_s >= np.longdouble(steps) * np.longdouble(str(config.time_step_s)):
            break
        state = advance_state(state)
        if animate and realtime:
            time.sleep(config.time_step_s)
    return state


def _build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--steps",
        type=int,
        default=TOTAL_DURATION,
        help=f"number of time steps (default: {TOTAL_DURATION})",
    )
    parser.add_argument(
        "--no-animation",
        action="store_true",
        help="advance the model without terminal clearing or frame rendering",
    )
    parser.add_argument(
        "--no-sleep",
        action="store_true",
        help="render frames without real-time pacing",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point with explicit handling for the manual physics hook."""

    args = _build_argument_parser().parse_args(argv)
    try:
        final_state = run_simulation(
            steps=args.steps,
            animate=not args.no_animation,
            realtime=not args.no_sleep,
        )
    except NotImplementedError as error:
        print(f"MANUAL CALCULATION REQUIRED: {error}", file=sys.stderr)
        return 2

    final_metrics = metrics_snapshot(final_state)
    print(
        f"Completed {args.steps} steps ({float(final_state.time_s):.6f} s); "
        f"final in-domain mass = {float(final_metrics['vehicle_mass']):.12f} PCU."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
