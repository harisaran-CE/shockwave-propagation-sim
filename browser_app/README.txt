FLOWLINE — BROWSER EDITION

Start using the app
1. If you received this as a ZIP, right-click it in File Explorer and choose “Extract All…”.
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
it moves away. Drivers look ahead for a closure and attempt a lane change only
when the front and rear gaps are safe; if no gap is available, they wait rather
than force a merge. Lane changes take longer and move smoothly. Vehicles
accelerate normally when a moved barrier is far enough ahead, and brake only
when it is within a safe stopping distance. Vehicles have larger, clearer
shapes, and their apparent lengths do not shrink when traffic gets close. Use
Play, Pause, or Reset, and download run samples as CSV or JSON.

Readouts show vehicle counts by type, mean speed (km/h), density (vehicles per
kilometre per lane), vehicles that exited, vehicles queued near the barrier,
overtakes, lane changes, and vehicle contacts prevented. Exports include the
settings and a time series, including the barrier position at each sample.

The simulation uses simplified vehicle-following and lane-change rules,
including anticipatory closure merging and gradual lateral movement. These
rules are illustrative and are not calibrated for safety or engineering use.
Intersections, traffic signals, and turns are not modeled. Playback speed
changes only how quickly the animation runs. The simulation stops when the
first vehicle reaches the 500 m road end, or at the selected run length if no
vehicle reaches it first.

The browser app uses only the individual-vehicle model. The desktop LWR solver
is separate and unchanged; the browser does not run LWR or compare model
results.

For permanent hosting as a browser app, publish this folder on an HTTPS static
host (for example, GitHub Pages). Opening index.html directly works without
hosting; browser install/offline caching features generally require HTTPS.
