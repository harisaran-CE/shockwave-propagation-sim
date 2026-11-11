# Flowline Traffic Studio

## Start a run

1. Open `FlowlineTrafficStudio.exe`.
2. Use the starting settings or change traffic, inflow variability, restriction location/strength, and run length.
3. Select **Run simulation**.
4. Press **Play** to watch the road, or drag the timeline to inspect a moment.

No Python installation, command prompt, or internet connection is needed.

## Watch and save

- Choose playback from 0.25x to 3x. This changes viewing speed only, not the model time step.
- Set inflow variability to 0% for steady demand or up to 50% for one-second random pulses around the selected average. The exported run records its seed so the random sequence can be reproduced.
- Save the completed run as CSV for tables, or JSON for all frames and settings.
If vehicles are selected, the CSV includes their count and IDs in dedicated
cells, and the JSON marks each selected vehicle with `selected: true`.
- Select **Start over** to return to the starting view.

The car markers are a visual representation of the continuous traffic-density model. They are not independently simulated vehicles. PCU means passenger-car units, a standard way to express traffic quantity.

This release is a one-dimensional traffic model. It does not yet model lane changes, individual driver decisions, or vehicle-to-vehicle collisions.

## Browser vehicle simulation

Open `browser_app/index.html` for the individual-vehicle model. Drag across the
road to select one or more moving vehicles. The vehicle inspector shows type,
live speed, lane, forward gap, leader, and restriction status from the selected
vehicle's point of view.

Choose a requested travel speed for the selected vehicles and press **Apply
speed**. The vehicle tries to travel at that speed. Safe following distance,
barriers, and lane-change
rules always take priority, so congestion can still make the actual speed
lower. The available choices follow each vehicle's normal desired speed with a
small soft-limit allowance rather than an unrestricted high-speed target; the
available choices extend to 120 km/h.
Playback runs at 0.5x while a speed edit is being adjusted. The browser
edition works with mouse, touch, laptop, and mobile layouts.
