"""Exploratory microscopic traffic model, separate from the legacy LWR solver.

The default vehicle mix, driver ranges, and hard-braking event rate are
illustrative, not calibrated to a particular urban arterial. The model
supports straight multilane following, reaction delay, reproducible
hard-braking events, and conservative gap-based lane changes.
An integration-step contact guard prevents geometric overlap and records
closing speed, but does not model collision forces, damage, or crash risk.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, replace
from enum import Enum


class VehicleClass(str, Enum):
    PASSENGER_CAR = "passenger_car"
    MOTORCYCLE = "motorcycle"
    AUTO_RICKSHAW = "auto_rickshaw"
    BUS = "bus"
    HEAVY_GOODS_VEHICLE = "heavy_goods_vehicle"


@dataclass(frozen=True, slots=True)
class _VehicleProfile:
    length_m: tuple[float, float]
    width_m: tuple[float, float]
    desired_speed_fraction: tuple[float, float]
    acceleration_m_per_s2: tuple[float, float]
    comfortable_deceleration_m_per_s2: tuple[float, float]
    minimum_gap_m: tuple[float, float]
    headway_s: tuple[float, float]
    reaction_time_s: tuple[float, float]
    emergency_deceleration_m_per_s2: tuple[float, float]


_PROFILES = {
    VehicleClass.PASSENGER_CAR: _VehicleProfile(
        (4.0, 4.8), (1.65, 1.9), (0.72, 1.0), (1.0, 2.2), (2.5, 4.5), (1.5, 3.0), (0.9, 2.0),
        (0.5, 1.4), (5.0, 8.0)
    ),
    VehicleClass.MOTORCYCLE: _VehicleProfile(
        (1.8, 2.3), (0.65, 0.9), (0.75, 1.0), (1.2, 2.8), (2.5, 4.5), (0.8, 1.8), (0.7, 1.6),
        (0.4, 1.2), (4.5, 7.0)
    ),
    VehicleClass.AUTO_RICKSHAW: _VehicleProfile(
        (2.5, 3.5), (1.35, 1.8), (0.62, 0.9), (0.7, 1.5), (2.0, 3.5), (1.2, 2.5), (1.0, 2.2),
        (0.6, 1.6), (4.0, 6.0)
    ),
    VehicleClass.BUS: _VehicleProfile(
        (9.0, 12.0), (2.35, 2.6), (0.55, 0.82), (0.45, 1.0), (1.5, 2.8), (2.0, 4.0), (1.5, 2.8),
        (0.8, 1.8), (3.0, 5.0)
    ),
    VehicleClass.HEAVY_GOODS_VEHICLE: _VehicleProfile(
        (7.0, 12.0), (2.3, 2.6), (0.55, 0.85), (0.4, 1.0), (1.5, 2.8), (2.0, 4.0), (1.5, 2.8),
        (0.8, 1.8), (3.0, 5.0)
    ),
}

_DEFAULT_CLASS_MIX = (
    (VehicleClass.PASSENGER_CAR, 0.55),
    (VehicleClass.MOTORCYCLE, 0.25),
    (VehicleClass.AUTO_RICKSHAW, 0.10),
    (VehicleClass.BUS, 0.05),
    (VehicleClass.HEAVY_GOODS_VEHICLE, 0.05),
)


@dataclass(frozen=True, slots=True)
class RoadConfig:
    """Physical and numerical settings for a straight multilane segment."""

    road_length_m: float = 500.0
    lane_count: int = 2
    speed_limit_m_per_s: float = 13.8888888889
    time_step_s: float = 0.1
    vehicles_per_lane: int = 10
    class_mix: tuple[tuple[VehicleClass, float], ...] = _DEFAULT_CLASS_MIX
    hard_braking_rate_per_vehicle_s: float = 0.0015
    hard_braking_duration_s: tuple[float, float] = (0.5, 1.2)
    lane_change_min_gain_m_per_s2: float = 0.35
    lane_change_cooldown_s: float = 2.0
    lane_change_max_safe_deceleration_m_per_s2: float = 3.0

    def __post_init__(self) -> None:
        values = (
            self.road_length_m,
            self.speed_limit_m_per_s,
            self.time_step_s,
            self.hard_braking_rate_per_vehicle_s,
            self.lane_change_min_gain_m_per_s2,
            self.lane_change_cooldown_s,
            self.lane_change_max_safe_deceleration_m_per_s2,
        )
        if not all(math.isfinite(value) for value in values):
            raise ValueError("Physical settings, event rate, and time-step values must be finite.")
        if self.road_length_m <= 0:
            raise ValueError("Road length must be positive.")
        if not isinstance(self.lane_count, int) or isinstance(self.lane_count, bool) or self.lane_count <= 0:
            raise ValueError("Lane count must be positive.")
        if self.speed_limit_m_per_s <= 0:
            raise ValueError("Speed limit must be positive.")
        if not 0 < self.time_step_s <= 0.25:
            raise ValueError("Time step must be in (0, 0.25] seconds.")
        if self.hard_braking_rate_per_vehicle_s < 0:
            raise ValueError("Hard-braking event rate must be non-negative.")
        if self.lane_change_min_gain_m_per_s2 < 0:
            raise ValueError("Minimum lane-change gain must be non-negative.")
        if self.lane_change_cooldown_s < 0:
            raise ValueError("Lane-change cooldown must be non-negative.")
        if self.lane_change_max_safe_deceleration_m_per_s2 <= 0:
            raise ValueError("Maximum safe lane-change deceleration must be positive.")
        if (
            len(self.hard_braking_duration_s) != 2
            or not all(math.isfinite(value) for value in self.hard_braking_duration_s)
            or self.hard_braking_duration_s[0] <= 0
            or self.hard_braking_duration_s[1] < self.hard_braking_duration_s[0]
        ):
            raise ValueError("Hard-braking duration bounds must be positive and ordered.")
        if (
            not isinstance(self.vehicles_per_lane, int)
            or isinstance(self.vehicles_per_lane, bool)
            or self.vehicles_per_lane < 0
        ):
            raise ValueError("Vehicles per lane cannot be negative.")
        if self.vehicles_per_lane and self.road_length_m / (self.vehicles_per_lane + 1) < 15:
            raise ValueError("Initial vehicle spacing is too small; reduce vehicles_per_lane or lengthen the road.")
        if not self.class_mix:
            raise ValueError("At least one vehicle class must be present in class_mix.")
        classes: set[VehicleClass] = set()
        total_weight = 0.0
        for vehicle_class, weight in self.class_mix:
            if not isinstance(vehicle_class, VehicleClass):
                raise ValueError("class_mix entries must use VehicleClass values.")
            if vehicle_class in classes:
                raise ValueError("class_mix cannot contain duplicate vehicle classes.")
            classes.add(vehicle_class)
            if not math.isfinite(weight) or weight <= 0:
                raise ValueError("Vehicle class weights must be finite and positive.")
            total_weight += weight
        if not math.isfinite(total_weight):
            raise ValueError("The sum of vehicle class weights must be finite.")


@dataclass(frozen=True, slots=True)
class Vehicle:
    """One vehicle, positioned by its centre along the road."""

    vehicle_id: int
    vehicle_class: VehicleClass
    lane_index: int
    position_m: float
    speed_m_per_s: float
    length_m: float
    width_m: float
    desired_speed_m_per_s: float
    max_acceleration_m_per_s2: float
    comfortable_deceleration_m_per_s2: float
    minimum_gap_m: float
    desired_headway_s: float
    reaction_time_s: float = 0.8
    emergency_deceleration_m_per_s2: float = 6.0
    hard_braking_steps_remaining: int = 0
    lane_change_cooldown_steps_remaining: int = 0
    acceleration_m_per_s2: float = 0.0


@dataclass(frozen=True, slots=True)
class SimulationState:
    """Immutable snapshot of vehicles and model time."""

    time_s: float
    seed: int
    config: RoadConfig
    vehicles: tuple[Vehicle, ...]
    exited_vehicles: int = 0
    step_index: int = 0
    perception_history: tuple[tuple[Vehicle, ...], ...] = ()
    hard_braking_events: tuple[HardBrakingEvent, ...] = ()
    contact_events: tuple[VehicleContactEvent, ...] = ()
    lane_change_events: tuple[LaneChangeEvent, ...] = ()


@dataclass(frozen=True, slots=True)
class HardBrakingEvent:
    """A seeded stochastic hard-braking event applied to one vehicle."""

    time_s: float
    vehicle_id: int
    duration_s: float
    deceleration_m_per_s2: float


@dataclass(frozen=True, slots=True)
class VehicleContactEvent:
    """A geometric vehicle contact detected at the end of one integration step."""

    time_s: float
    follower_id: int
    leader_id: int
    closing_speed_m_per_s: float


@dataclass(frozen=True, slots=True)
class LaneChangeEvent:
    """A lane change accepted after checking the target lane's available gaps."""

    time_s: float
    vehicle_id: int
    from_lane: int
    to_lane: int
    acceleration_gain_m_per_s2: float


@dataclass(frozen=True, slots=True)
class SimulationMetrics:
    time_s: float
    vehicle_count: int
    mean_speed_m_per_s: float
    mean_speed_km_per_h: float
    class_counts: tuple[tuple[VehicleClass, int], ...]
    exited_vehicles: int
    hard_braking_event_count: int
    contact_event_count: int
    lane_change_count: int


def _sample_range(rng: random.Random, limits: tuple[float, float]) -> float:
    return rng.uniform(*limits)


def _choose_class(rng: random.Random, mix: tuple[tuple[VehicleClass, float], ...]) -> VehicleClass:
    total_weight = sum(weight for _, weight in mix)
    target = rng.random() * total_weight
    for vehicle_class, weight in mix:
        target -= weight
        if target <= 0:
            return vehicle_class
    return mix[-1][0]


def _make_vehicle(
    rng: random.Random,
    vehicle_id: int,
    vehicle_class: VehicleClass,
    lane_index: int,
    position_m: float,
    config: RoadConfig,
) -> Vehicle:
    profile = _PROFILES[vehicle_class]
    desired_speed = config.speed_limit_m_per_s * _sample_range(rng, profile.desired_speed_fraction)
    return Vehicle(
        vehicle_id=vehicle_id,
        vehicle_class=vehicle_class,
        lane_index=lane_index,
        position_m=position_m,
        speed_m_per_s=desired_speed * rng.uniform(0.65, 0.9),
        length_m=_sample_range(rng, profile.length_m),
        width_m=_sample_range(rng, profile.width_m),
        desired_speed_m_per_s=desired_speed,
        max_acceleration_m_per_s2=_sample_range(rng, profile.acceleration_m_per_s2),
        comfortable_deceleration_m_per_s2=_sample_range(rng, profile.comfortable_deceleration_m_per_s2),
        minimum_gap_m=_sample_range(rng, profile.minimum_gap_m),
        desired_headway_s=_sample_range(rng, profile.headway_s),
        reaction_time_s=_sample_range(rng, profile.reaction_time_s),
        emergency_deceleration_m_per_s2=_sample_range(rng, profile.emergency_deceleration_m_per_s2),
    )


def initialize_state(config: RoadConfig | None = None, *, seed: int = 1) -> SimulationState:
    """Create a seeded, evenly spaced initial fleet with heterogeneous classes."""

    config = config or RoadConfig()
    if not isinstance(seed, int):
        raise TypeError("seed must be an integer.")
    rng = random.Random(seed)
    vehicles: list[Vehicle] = []
    spacing = config.road_length_m / (config.vehicles_per_lane + 1)

    for lane_index in range(config.lane_count):
        for offset in range(config.vehicles_per_lane):
            vehicle_class = _choose_class(rng, config.class_mix)
            position_m = spacing * (offset + 1)
            vehicle = _make_vehicle(rng, len(vehicles), vehicle_class, lane_index, position_m, config)
            vehicles.append(vehicle)

    return SimulationState(
        time_s=0.0,
        seed=seed,
        config=config,
        vehicles=tuple(vehicles),
        perception_history=(tuple(vehicles),),
    )


def _idm_acceleration(
    vehicle: Vehicle,
    leader: Vehicle | None,
    speed_limit_m_per_s: float,
    *,
    perceived_gap_m: float | None = None,
    perceived_speed_m_per_s: float | None = None,
) -> float:
    """Evaluate the Intelligent Driver Model acceleration for one vehicle."""

    desired_speed = min(vehicle.desired_speed_m_per_s, speed_limit_m_per_s)
    speed = max(0.0, vehicle.speed_m_per_s if perceived_speed_m_per_s is None else perceived_speed_m_per_s)
    free_road_term = 1.0 - (speed / desired_speed) ** 4
    if leader is None:
        return vehicle.max_acceleration_m_per_s2 * free_road_term

    gap = perceived_gap_m
    if gap is None:
        gap = leader.position_m - leader.length_m / 2 - vehicle.position_m - vehicle.length_m / 2
    if gap < -1e-9:
        raise FloatingPointError("Vehicles overlap in the current state.")
    if gap <= 0:
        return -vehicle.comfortable_deceleration_m_per_s2
    closing_speed = speed - max(0.0, leader.speed_m_per_s)
    interaction_distance = vehicle.minimum_gap_m + max(
        0.0,
        speed * vehicle.desired_headway_s
        + speed * closing_speed
        / (2.0 * math.sqrt(vehicle.max_acceleration_m_per_s2 * vehicle.comfortable_deceleration_m_per_s2)),
    )
    interaction_term = (interaction_distance / gap) ** 2
    acceleration = vehicle.max_acceleration_m_per_s2 * (free_road_term - interaction_term)
    return max(-vehicle.comfortable_deceleration_m_per_s2, min(vehicle.max_acceleration_m_per_s2, acceleration))


def _lane_neighbors(
    vehicles: list[Vehicle],
    lane_index: int,
    position_m: float,
) -> tuple[Vehicle | None, Vehicle | None]:
    """Return the nearest leader and follower around a position in one lane."""

    ahead = [vehicle for vehicle in vehicles if vehicle.lane_index == lane_index and vehicle.position_m > position_m]
    behind = [vehicle for vehicle in vehicles if vehicle.lane_index == lane_index and vehicle.position_m < position_m]
    leader = min(ahead, key=lambda vehicle: vehicle.position_m, default=None)
    follower = max(behind, key=lambda vehicle: vehicle.position_m, default=None)
    return leader, follower


def _lane_change_gaps_are_safe(
    vehicle: Vehicle,
    leader: Vehicle | None,
    follower: Vehicle | None,
    config: RoadConfig,
) -> bool:
    if leader is not None:
        front_gap = (
            leader.position_m - leader.length_m / 2 - vehicle.position_m - vehicle.length_m / 2
        )
        if front_gap < vehicle.minimum_gap_m + vehicle.speed_m_per_s * vehicle.desired_headway_s:
            return False
    if follower is not None:
        rear_gap = (
            vehicle.position_m - vehicle.length_m / 2 - follower.position_m - follower.length_m / 2
        )
        closing_speed = max(0.0, follower.speed_m_per_s - vehicle.speed_m_per_s)
        minimum_rear_gap = (
            follower.minimum_gap_m
            + follower.speed_m_per_s * follower.desired_headway_s
            + follower.speed_m_per_s * follower.reaction_time_s
            + closing_speed**2 / (2.0 * follower.comfortable_deceleration_m_per_s2)
        )
        if rear_gap < minimum_rear_gap:
            return False
        after_merge = _idm_acceleration(
            follower,
            vehicle,
            config.speed_limit_m_per_s,
            perceived_gap_m=rear_gap,
        )
        if after_merge < -config.lane_change_max_safe_deceleration_m_per_s2:
            return False
    return True


def _lane_change_proposals(state: SimulationState) -> dict[int, tuple[int, float]]:
    """Choose adjacent lanes only when the ego gain and both gaps are acceptable."""

    config = state.config
    if config.lane_count < 2:
        return {}
    vehicles = list(state.vehicles)
    by_id = {vehicle.vehicle_id: vehicle for vehicle in vehicles}
    proposals: dict[int, tuple[int, float]] = {}
    for vehicle in vehicles:
        if vehicle.lane_change_cooldown_steps_remaining > 0:
            continue
        current_leader, _ = _lane_neighbors(vehicles, vehicle.lane_index, vehicle.position_m)
        current_acceleration = _idm_acceleration(vehicle, current_leader, config.speed_limit_m_per_s)
        best: tuple[int, float] | None = None
        for target_lane in (vehicle.lane_index - 1, vehicle.lane_index + 1):
            if not 0 <= target_lane < config.lane_count:
                continue
            target_leader, target_follower = _lane_neighbors(vehicles, target_lane, vehicle.position_m)
            if not _lane_change_gaps_are_safe(vehicle, target_leader, target_follower, config):
                continue

            target_acceleration = _idm_acceleration(vehicle, target_leader, config.speed_limit_m_per_s)
            gain = target_acceleration - current_acceleration
            if gain < config.lane_change_min_gain_m_per_s2:
                continue
            if best is None or gain > best[1]:
                best = (target_lane, gain)
        if best is not None:
            proposals[vehicle.vehicle_id] = best

    # Resolve simultaneous requests deterministically; a lane cannot accept
    # overlapping vehicles even when each independently saw a safe gap.
    lane_assignments = {vehicle.vehicle_id: vehicle.lane_index for vehicle in vehicles}
    accepted: dict[int, tuple[int, float]] = {}
    ordered_proposals = sorted(
        proposals.items(),
        key=lambda item: (-item[1][1], item[0]),
    )
    for vehicle_id, (target_lane, gain) in ordered_proposals:
        vehicle = by_id[vehicle_id]
        occupants = [
            other for other in vehicles
            if lane_assignments[other.vehicle_id] == target_lane and other.vehicle_id != vehicle_id
        ]
        if any(
            abs(other.position_m - vehicle.position_m) < (other.length_m + vehicle.length_m) / 2
            for other in occupants
        ):
            continue
        leader = min(
            (other for other in occupants if other.position_m > vehicle.position_m),
            key=lambda other: other.position_m,
            default=None,
        )
        follower = max(
            (other for other in occupants if other.position_m < vehicle.position_m),
            key=lambda other: other.position_m,
            default=None,
        )
        if not _lane_change_gaps_are_safe(vehicle, leader, follower, config):
            continue
        lane_assignments[vehicle_id] = target_lane
        accepted[vehicle_id] = (target_lane, gain)
    return accepted


def advance_state(state: SimulationState) -> SimulationState:
    """Advance one step using gap-checked lane changes and delayed perception."""

    config = state.config
    state_history = state.perception_history or (state.vehicles,)
    original_by_id = {vehicle.vehicle_id: vehicle for vehicle in state.vehicles}
    for vehicle in state.vehicles:
        if not 0 <= vehicle.lane_index < config.lane_count:
            raise ValueError(f"Vehicle {vehicle.vehicle_id} has an invalid lane index.")
    lane_change_proposals = _lane_change_proposals(state)
    lane_change_events = list(state.lane_change_events)
    vehicles_for_step = tuple(
        replace(
            vehicle,
            lane_index=lane_change_proposals.get(vehicle.vehicle_id, (vehicle.lane_index, 0.0))[0],
        )
        for vehicle in state.vehicles
    )
    for vehicle_id, (target_lane, gain) in lane_change_proposals.items():
        lane_change_events.append(
            LaneChangeEvent(
                time_s=round(state.time_s, 12),
                vehicle_id=vehicle_id,
                from_lane=original_by_id[vehicle_id].lane_index,
                to_lane=target_lane,
                acceleration_gain_m_per_s2=gain,
            )
        )
    lane_vehicles: dict[int, list[Vehicle]] = {lane: [] for lane in range(config.lane_count)}
    for vehicle in vehicles_for_step:
        lane_vehicles[vehicle.lane_index].append(vehicle)

    updated: list[Vehicle] = []
    exited = state.exited_vehicles
    events = list(state.hard_braking_events)
    contacts = list(state.contact_events)
    dt = config.time_step_s
    event_rng = random.Random((state.seed << 64) ^ state.step_index ^ 0x9E3779B97F4A7C15)
    event_probability = 1.0 - math.exp(-config.hard_braking_rate_per_vehicle_s * dt)
    next_step_index = state.step_index + 1
    for lane_index, vehicles in lane_vehicles.items():
        ordered = sorted(vehicles, key=lambda vehicle: vehicle.position_m, reverse=True)
        current_next_positions: dict[int, float] = {}
        for index, vehicle in enumerate(ordered):
            delay_steps = math.ceil(vehicle.reaction_time_s / dt)
            history_index = max(0, len(state_history) - 1 - delay_steps)
            changed_lane = vehicle.vehicle_id in lane_change_proposals
            perceived_vehicles = sorted(
                (
                    item
                    for item in (vehicles_for_step if changed_lane else state_history[history_index])
                    if item.lane_index == lane_index
                ),
                key=lambda item: item.position_m,
                reverse=True,
            )
            perceived_index = next(
                (i for i, item in enumerate(perceived_vehicles) if item.vehicle_id == vehicle.vehicle_id),
                None,
            )
            perceived_leader = (
                perceived_vehicles[perceived_index - 1]
                if perceived_index is not None and perceived_index > 0
                else None
            )
            perceived_follower = (
                perceived_vehicles[perceived_index]
                if perceived_index is not None
                else None
            )
            perceived_gap = None
            if perceived_leader is not None and perceived_follower is not None:
                perceived_gap = (
                    perceived_leader.position_m
                    - perceived_leader.length_m / 2
                    - perceived_follower.position_m
                    - perceived_follower.length_m / 2
                )
            acceleration = _idm_acceleration(
                vehicle,
                perceived_leader,
                config.speed_limit_m_per_s,
                perceived_gap_m=perceived_gap,
                perceived_speed_m_per_s=(
                    perceived_follower.speed_m_per_s if perceived_follower is not None else vehicle.speed_m_per_s
                ),
            )

            braking_steps = max(0, vehicle.hard_braking_steps_remaining - 1)
            lane_change_cooldown = max(0, vehicle.lane_change_cooldown_steps_remaining - 1)
            if vehicle.vehicle_id in lane_change_proposals:
                lane_change_cooldown = math.ceil(config.lane_change_cooldown_s / dt)
            braking_deceleration = vehicle.emergency_deceleration_m_per_s2
            if vehicle.hard_braking_steps_remaining == 0 and event_rng.random() < event_probability:
                sampled_duration_s = event_rng.uniform(*config.hard_braking_duration_s)
                braking_steps = max(1, math.ceil(sampled_duration_s / dt))
                applied_duration_s = braking_steps * dt
                acceleration = -braking_deceleration
                events.append(
                    HardBrakingEvent(
                        time_s=round(state.time_s, 12),
                        vehicle_id=vehicle.vehicle_id,
                        duration_s=applied_duration_s,
                        deceleration_m_per_s2=braking_deceleration,
                    )
                )
            elif vehicle.hard_braking_steps_remaining > 0:
                acceleration = min(acceleration, -braking_deceleration)

            next_speed = max(
                0.0,
                min(
                    config.speed_limit_m_per_s,
                    vehicle.desired_speed_m_per_s,
                    vehicle.speed_m_per_s + acceleration * dt,
                ),
            )
            next_position = vehicle.position_m + (vehicle.speed_m_per_s + next_speed) * 0.5 * dt
            if index > 0:
                leader = ordered[index - 1]
                leader_next_position = current_next_positions[leader.vehicle_id]
                maximum_position = leader_next_position - leader.length_m / 2 - vehicle.length_m / 2
                if next_position > maximum_position:
                    contacts.append(
                        VehicleContactEvent(
                            time_s=round(state.time_s + dt, 12),
                            follower_id=vehicle.vehicle_id,
                            leader_id=leader.vehicle_id,
                            closing_speed_m_per_s=max(0.0, vehicle.speed_m_per_s - leader.speed_m_per_s),
                        )
                    )
                    next_speed = 0.0
                    next_position = maximum_position
            current_next_positions[vehicle.vehicle_id] = next_position
            next_vehicle = Vehicle(
                vehicle_id=vehicle.vehicle_id,
                vehicle_class=vehicle.vehicle_class,
                lane_index=lane_index,
                position_m=next_position,
                speed_m_per_s=next_speed,
                length_m=vehicle.length_m,
                width_m=vehicle.width_m,
                desired_speed_m_per_s=vehicle.desired_speed_m_per_s,
                max_acceleration_m_per_s2=vehicle.max_acceleration_m_per_s2,
                comfortable_deceleration_m_per_s2=vehicle.comfortable_deceleration_m_per_s2,
                minimum_gap_m=vehicle.minimum_gap_m,
                desired_headway_s=vehicle.desired_headway_s,
                reaction_time_s=vehicle.reaction_time_s,
                emergency_deceleration_m_per_s2=vehicle.emergency_deceleration_m_per_s2,
                hard_braking_steps_remaining=braking_steps,
                lane_change_cooldown_steps_remaining=lane_change_cooldown,
                acceleration_m_per_s2=(next_speed - vehicle.speed_m_per_s) / dt,
            )
            if next_position - next_vehicle.length_m / 2 >= config.road_length_m:
                exited += 1
            else:
                updated.append(next_vehicle)

    updated.sort(key=lambda vehicle: vehicle.vehicle_id)
    next_state = SimulationState(
        time_s=round(state.time_s + dt, 12),
        seed=state.seed,
        config=config,
        vehicles=tuple(updated),
        exited_vehicles=exited,
        step_index=next_step_index,
        perception_history=(state_history + (tuple(updated),))[
            -max(1, math.ceil(max((v.reaction_time_s for v in state.vehicles), default=0.0) / dt) + 1) :
        ],
        hard_braking_events=tuple(events),
        contact_events=tuple(contacts),
        lane_change_events=tuple(lane_change_events),
    )
    _validate_lane_spacing(next_state)
    return next_state


def _validate_lane_spacing(state: SimulationState) -> None:
    lanes: dict[int, list[Vehicle]] = {}
    for vehicle in state.vehicles:
        lanes.setdefault(vehicle.lane_index, []).append(vehicle)
    for vehicles in lanes.values():
        ordered = sorted(vehicles, key=lambda vehicle: vehicle.position_m)
        for follower, leader in zip(ordered, ordered[1:]):
            gap = leader.position_m - leader.length_m / 2 - follower.position_m - follower.length_m / 2
            if gap < -1e-9:
                raise FloatingPointError(
                    f"Vehicle overlap detected between {follower.vehicle_id} and {leader.vehicle_id}."
                )


def run_simulation(
    config: RoadConfig | None = None,
    *,
    duration_s: float = 30.0,
    seed: int = 1,
) -> tuple[SimulationState, ...]:
    """Run a reproducible scenario and return every fixed-step snapshot."""

    config = config or RoadConfig()
    if not math.isfinite(duration_s) or duration_s < 0:
        raise ValueError("Duration must be finite and non-negative.")
    steps_float = duration_s / config.time_step_s
    steps = round(steps_float)
    if not math.isclose(steps_float, steps, rel_tol=0.0, abs_tol=1e-9):
        raise ValueError("Duration must be an integer multiple of time_step_s.")
    states = [initialize_state(config, seed=seed)]
    for _ in range(steps):
        states.append(advance_state(states[-1]))
    return tuple(states)


def metrics_snapshot(state: SimulationState) -> SimulationMetrics:
    """Return descriptive run metrics without implying calibration."""

    counts = {vehicle_class: 0 for vehicle_class in VehicleClass}
    for vehicle in state.vehicles:
        counts[vehicle.vehicle_class] += 1
    mean_speed = (
        sum(vehicle.speed_m_per_s for vehicle in state.vehicles) / len(state.vehicles)
        if state.vehicles
        else 0.0
    )
    return SimulationMetrics(
        time_s=state.time_s,
        vehicle_count=len(state.vehicles),
        mean_speed_m_per_s=mean_speed,
        mean_speed_km_per_h=mean_speed * 3.6,
        class_counts=tuple((vehicle_class, count) for vehicle_class, count in counts.items() if count),
        exited_vehicles=state.exited_vehicles,
        hard_braking_event_count=len(state.hard_braking_events),
        contact_event_count=len(state.contact_events),
        lane_change_count=len(state.lane_change_events),
    )
