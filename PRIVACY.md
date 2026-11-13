# Flowline privacy notice

Flowline runs entirely in your browser. It has no accounts, no backend and no
analytics. Simulation settings and results stay on your device unless you
choose to download the CSV or JSON files.

The browser app loads only local files from its release folder:

- `index.html`
- `styles.css`
- `microscopic.css`
- `microscopic.js`
- `flowline-3d.js`
- `vendor/three.module.min.js` (only when the optional 3D view is available)
- `icon.svg`

It does not load fonts, images, analytics, iframes, or other resources from
external servers. It does not use `localStorage`, cookies, or IndexedDB.
Object URLs are created temporarily for user-requested downloads and are
revoked after download initiation.

Contact: [your email]
