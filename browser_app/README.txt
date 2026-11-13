FLOWLINE - BROWSER EDITION

Start using the app
1. If you received this as a ZIP, right-click it in File Explorer and choose "Extract All".
2. Open the extracted Flowline-Browser folder.
3. Double-click index.html. It opens in your browser; no terminal, Python, installer, or account is needed.

The browser app runs locally and does not upload data. It simulates individual
cars, motorcycles, auto-rickshaws, buses, and trucks. Set the road situation,
barrier distance from the start, average arrivals, arrival variation, speed
limit, and run length. Enter a barrier distance from 50 to 450 metres. A lane
restriction closes one lane; a full closure stops both lanes. Vehicles may
change lanes if there is enough room. While a barrier scenario is running,
drag the barrier marker directly on the animated road, or edit the distance
field, to move it without restarting the simulation. Vehicles already past the
barrier continue; vehicles approaching it stop safely ahead and can resume when
it moves away. Drivers look at least 220 m ahead for a closure and attempt a lane change when
the front and rear gaps are safe; if no gap is available, they wait rather
than force a merge. Only a vehicle behind slower traffic can request a pass; the
leader never brakes or moves aside to make room for a follower. Each physical
lane has four marked paths, and vehicles move between path positions gradually.
The paths do not let vehicles overlap: a move is rejected unless the vehicle's
full width and length fit with a clear front and rear gap. Vehicles follow a
fixed traffic snapshot each step and brake for traffic ahead to maintain a gap
when possible. Drivers wait before returning to their old lane. Moves between
paths take about 2.4 seconds.
accelerate normally when a moved barrier is far enough ahead, and brake only
when it is within a safe stopping distance. Vehicles have larger, clearer
shapes, and their apparent lengths do not shrink when traffic gets close. Use
Play, Pause, or Reset, and download run samples as CSV or JSON.
Editor mode exposes a single scenario state for editing, JSON save/load, and a
configurable 0-100 risk index based on speed, density, prevented contacts, and
simulated crash observations. Crash records include timing, geometry, relative
speed, cause, and the risk snapshot at observation time.

Readouts show vehicle counts by type, mean speed (km/h), density (vehicles per
kilometre per lane), vehicles that exited, vehicles queued near the barrier,
overtakes, lane changes, and vehicle contacts prevented. Exports include the
settings and a time series, including the barrier position at each sample.

The simulation uses simplified vehicle-following and lane-change rules,
including anticipatory closure merging and gradual lateral movement. These
rules are illustrative and are not calibrated for safety or engineering use.
Intersections, traffic signals, and turns are not modeled. Playback speed
changes only how quickly the animation runs. Vehicles that reach the 500 m
downstream end exit and are counted without stopping the run. It stops at the
selected run length, or when congestion persistently blocks new vehicles from
entering at the 0 m upstream end.

The browser app uses only the individual-vehicle model. The desktop LWR solver
is separate and unchanged; the browser does not run LWR or compare model
results.

For permanent hosting as a browser app, publish this folder on an HTTPS static
host (for example, GitHub Pages). Opening index.html directly works without
hosting; browser install/offline caching features generally require HTTPS.
