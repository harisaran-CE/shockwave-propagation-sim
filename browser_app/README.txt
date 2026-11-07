FLOWLINE — BROWSER EDITION

Start using the app
1. If you received this as a ZIP, right-click it in File Explorer and choose “Extract All…”.
2. Open the extracted Flowline-Browser folder.
3. Double-click index.html. It opens in your default web browser; no terminal, Python, installer, or account is needed.

The simulation runs locally in your browser. It does not upload data. Use Run simulation, choose playback speed, and download the recorded run as CSV or JSON.

Set inflow variability to 0% for steady demand or up to 50% for random one-second pulses around the selected average. CSV and JSON exports include the realized inflow; JSON also records the random seed for repeatability.

Physics note
The numerical model is a one-dimensional, conservative LWR finite-volume model using a Greenshields speed-density curve. The two-lane road and car drawings are an explanatory 2D view of cell density, not individually tracked vehicles or a fully two-dimensional traffic model. Playback speed affects presentation only; it does not change the model timestep or physics.

For permanent hosting/installing as a browser app, publish this folder on an HTTPS static host (for example, GitHub Pages). Opening index.html directly works without hosting; browser install/offline caching features generally require HTTPS hosting.
