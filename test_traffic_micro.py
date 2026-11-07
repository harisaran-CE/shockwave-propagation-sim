import unittest
from dataclasses import replace

import traffic_micro


class RoadConfigTests(unittest.TestCase):
    def test_rejects_invalid_physical_and_numerical_inputs(self) -> None:
        with self.assertRaisesRegex(ValueError, "Road length must be positive"):
            traffic_micro.RoadConfig(road_length_m=0)
        with self.assertRaisesRegex(ValueError, "Lane count must be positive"):
            traffic_micro.RoadConfig(lane_count=0)
        with self.assertRaisesRegex(ValueError, "Time step"):
            traffic_micro.RoadConfig(time_step_s=0.3)
        with self.assertRaisesRegex(ValueError, "spacing is too small"):
            traffic_micro.RoadConfig(road_length_m=100, vehicles_per_lane=10)

    def test_rejects_invalid_vehicle_mix(self) -> None:
        with self.assertRaisesRegex(ValueError, "weights must be finite and positive"):
            traffic_micro.RoadConfig(class_mix=((traffic_micro.VehicleClass.BUS, 0),))

    def test_rejects_invalid_hard_braking_settings(self) -> None:
        with self.assertRaisesRegex(ValueError, "event rate"):
            traffic_micro.RoadConfig(hard_braking_rate_per_vehicle_s=-0.1)
        with self.assertRaisesRegex(ValueError, "duration bounds"):
            traffic_micro.RoadConfig(hard_braking_duration_s=(1.0, 0.5))
        with self.assertRaisesRegex(ValueError, "duration bounds"):
            traffic_micro.RoadConfig(hard_braking_duration_s=(1.0,))


class FleetGenerationTests(unittest.TestCase):
    def test_seed_reproduces_initial_fleet_and_driver_parameters(self) -> None:
        config = traffic_micro.RoadConfig(vehicles_per_lane=12)
        first = traffic_micro.initialize_state(config, seed=41)
        second = traffic_micro.initialize_state(config, seed=41)
        self.assertEqual(first, second)
        self.assertNotEqual(first, traffic_micro.initialize_state(config, seed=42))

    def test_seeded_fleet_contains_configured_vehicle_classes(self) -> None:
        state = traffic_micro.initialize_state(seed=41)
        classes = {vehicle.vehicle_class for vehicle in state.vehicles}
        self.assertGreaterEqual(len(classes), 3)
        self.assertEqual(len(state.vehicles), state.config.lane_count * state.config.vehicles_per_lane)

    def test_seed_reproduces_complete_trajectory(self) -> None:
        first = traffic_micro.run_simulation(duration_s=2.0, seed=19)
        second = traffic_micro.run_simulation(duration_s=2.0, seed=19)
        self.assertEqual(first, second)

    def test_initial_spacing_does_not_overlap(self) -> None:
        state = traffic_micro.initialize_state(seed=14)
        traffic_micro._validate_lane_spacing(state)


class CarFollowingTests(unittest.TestCase):
    @staticmethod
    def _vehicle(
        vehicle_id: int,
        position_m: float,
        speed_m_per_s: float,
    ) -> traffic_micro.Vehicle:
        return traffic_micro.Vehicle(
            vehicle_id=vehicle_id,
            vehicle_class=traffic_micro.VehicleClass.PASSENGER_CAR,
            lane_index=0,
            position_m=position_m,
            speed_m_per_s=speed_m_per_s,
            length_m=4.5,
            width_m=1.8,
            desired_speed_m_per_s=13.0,
            max_acceleration_m_per_s2=1.5,
            comfortable_deceleration_m_per_s2=3.0,
            minimum_gap_m=2.0,
            desired_headway_s=1.5,
        )

    def test_free_road_acceleration_is_bounded_and_fades_near_desired_speed(self) -> None:
        vehicle = self._vehicle(0, 20.0, 6.0)
        acceleration = traffic_micro._idm_acceleration(vehicle, None, 13.9)
        self.assertGreater(acceleration, 0)
        self.assertLessEqual(acceleration, vehicle.max_acceleration_m_per_s2)

        near_target = self._vehicle(0, 20.0, 12.99)
        target_acceleration = traffic_micro._idm_acceleration(near_target, None, 13.9)
        self.assertLess(target_acceleration, 0.01)
        self.assertGreater(target_acceleration, -0.01)

    def test_close_slow_leader_causes_bounded_deceleration(self) -> None:
        follower = self._vehicle(0, 20.0, 12.0)
        leader = self._vehicle(1, 30.0, 0.0)
        acceleration = traffic_micro._idm_acceleration(follower, leader, 13.9)
        self.assertLess(acceleration, 0)
        self.assertGreaterEqual(acceleration, -follower.comfortable_deceleration_m_per_s2)

    def test_reaction_delay_uses_older_perceived_gap(self) -> None:
        config = traffic_micro.RoadConfig(
            lane_count=1,
            vehicles_per_lane=0,
            hard_braking_rate_per_vehicle_s=0,
        )
        leader = self._vehicle(1, 65.0, 0.0)
        follower = replace(self._vehicle(0, 20.0, 12.0), reaction_time_s=0.1)
        old_leader = replace(leader, position_m=100.0)
        old_follower = replace(follower, position_m=20.0)
        past = (old_leader, old_follower)
        current = (leader, follower)
        state = traffic_micro.SimulationState(
            time_s=0.1,
            seed=1,
            config=config,
            vehicles=current,
            step_index=1,
            perception_history=(past, current),
        )

        delayed_result = traffic_micro.advance_state(state)
        immediate_follower = replace(follower, reaction_time_s=0.0)
        immediate_state = replace(
            state,
            vehicles=(leader, immediate_follower),
            perception_history=(past, (leader, immediate_follower)),
        )
        immediate_result = traffic_micro.advance_state(immediate_state)
        delayed_acceleration = next(v for v in delayed_result.vehicles if v.vehicle_id == 0).acceleration_m_per_s2
        immediate_acceleration = next(v for v in immediate_result.vehicles if v.vehicle_id == 0).acceleration_m_per_s2
        self.assertGreater(delayed_acceleration, immediate_acceleration)

    def test_hard_braking_events_are_seeded_logged_and_bounded(self) -> None:
        config = traffic_micro.RoadConfig(hard_braking_rate_per_vehicle_s=0.2)
        first = traffic_micro.run_simulation(config, duration_s=5.0, seed=9)
        second = traffic_micro.run_simulation(config, duration_s=5.0, seed=9)
        events = first[-1].hard_braking_events
        self.assertTrue(events)
        self.assertEqual(events, second[-1].hard_braking_events)
        self.assertTrue(all(0 <= event.time_s < 5.0 for event in events))
        self.assertTrue(all(config.hard_braking_duration_s[0] <= event.duration_s for event in events))
        self.assertTrue(all(event.duration_s <= config.hard_braking_duration_s[1] + config.time_step_s for event in events))
        self.assertEqual(
            traffic_micro.metrics_snapshot(first[-1]).hard_braking_event_count,
            len(events),
        )

    def test_hard_braking_can_be_disabled(self) -> None:
        config = traffic_micro.RoadConfig(hard_braking_rate_per_vehicle_s=0)
        states = traffic_micro.run_simulation(config, duration_s=5.0, seed=9)
        self.assertEqual(states[-1].hard_braking_events, ())

    def test_unavoidable_overlap_is_recorded_as_contact_without_interpenetration(self) -> None:
        config = traffic_micro.RoadConfig(
            lane_count=1,
            vehicles_per_lane=0,
            hard_braking_rate_per_vehicle_s=0,
        )
        leader = self._vehicle(1, 30.0, 0.0)
        follower = self._vehicle(0, 25.3, 12.0)
        state = traffic_micro.SimulationState(
            time_s=0.0,
            seed=1,
            config=config,
            vehicles=(follower, leader),
            perception_history=((follower, leader),),
        )

        result = traffic_micro.advance_state(state)

        self.assertEqual(len(result.contact_events), 1)
        contact = result.contact_events[0]
        self.assertEqual((contact.follower_id, contact.leader_id), (0, 1))
        self.assertAlmostEqual(contact.closing_speed_m_per_s, 12.0)
        traffic_micro._validate_lane_spacing(result)
        self.assertEqual(traffic_micro.metrics_snapshot(result).contact_event_count, 1)

    def test_representative_runs_stay_within_speed_limit_and_without_overlap(self) -> None:
        config = traffic_micro.RoadConfig(vehicles_per_lane=12)
        for seed in range(1, 11):
            states = traffic_micro.run_simulation(config, duration_s=20.0, seed=seed)
            self.assertEqual(len(states), 201)
            self.assertEqual(states[-1].time_s, 20.0)
            for state in states:
                traffic_micro._validate_lane_spacing(state)
                self.assertTrue(
                    all(vehicle.speed_m_per_s <= config.speed_limit_m_per_s for vehicle in state.vehicles)
                )
                self.assertTrue(all(vehicle.speed_m_per_s >= 0 for vehicle in state.vehicles))

    def test_step_is_immutable_and_metrics_are_consistent(self) -> None:
        initial = traffic_micro.initialize_state(seed=5)
        next_state = traffic_micro.advance_state(initial)
        self.assertEqual(initial.time_s, 0.0)
        self.assertEqual(len(initial.vehicles), len(next_state.vehicles))
        self.assertAlmostEqual(next_state.time_s, initial.config.time_step_s)
        metrics = traffic_micro.metrics_snapshot(next_state)
        self.assertEqual(metrics.vehicle_count, len(next_state.vehicles))
        self.assertAlmostEqual(metrics.mean_speed_km_per_h, metrics.mean_speed_m_per_s * 3.6)

    def test_run_duration_must_match_fixed_time_step(self) -> None:
        with self.assertRaisesRegex(ValueError, "integer multiple"):
            traffic_micro.run_simulation(duration_s=0.15)


if __name__ == "__main__":
    unittest.main()
